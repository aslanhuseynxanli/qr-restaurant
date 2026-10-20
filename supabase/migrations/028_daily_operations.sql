-- 028: gündəlik sifariş düzəlişi, masa köçürmə və hesab əməliyyatları. 027-dən sonra.
begin;
create table if not exists private.qr_kitchen_notices(id bigint generated always as identity primary key,restaurant_id uuid not null,branch_id uuid not null,order_number text,table_name text not null,message text not null,created_at timestamptz not null default now());
create index if not exists qr_notices_branch on private.qr_kitchen_notices(branch_id,id desc);
revoke all on private.qr_kitchen_notices from public,anon,authenticated,service_role;
revoke all on sequence private.qr_kitchen_notices_id_seq from public,anon,authenticated,service_role;
alter table public.qr_order_items add column if not exists original_quantity integer;
update public.qr_order_items set original_quantity=quantity where original_quantity is null;
alter table public.qr_order_items drop constraint if exists qr_order_items_quantity_check;
alter table public.qr_order_items add constraint qr_order_items_quantity_check check(quantity between 0 and 20);
create or replace function private.qr_original_quantity() returns trigger language plpgsql set search_path='' as $$
begin new.original_quantity:=coalesce(new.original_quantity,new.quantity);return new;end $$;
drop trigger if exists qr_original_quantity on public.qr_order_items;
create trigger qr_original_quantity before insert on public.qr_order_items for each row execute function private.qr_original_quantity();
alter table public.qr_dining_sessions add column if not exists discount_amount numeric(12,2) not null default 0 check(discount_amount>=0);
alter table public.qr_dining_sessions add column if not exists service_percent numeric(5,2) not null default 0 check(service_percent between 0 and 100);
create table if not exists private.qr_revision_receipts(actor_id uuid not null references public.profiles(id),request_id uuid not null,payload jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,request_id));
create table if not exists private.qr_item_changes(id uuid primary key default gen_random_uuid(),order_id uuid not null references public.qr_orders(id),item_id uuid not null references public.qr_order_items(id),old_quantity integer not null,new_quantity integer not null,reason text not null,actor_id uuid references public.profiles(id),created_at timestamptz not null default now());
create index if not exists qr_item_changes_order on private.qr_item_changes(order_id,created_at);
create table if not exists private.qr_payment_parts(id uuid primary key default gen_random_uuid(),session_id uuid not null references public.qr_dining_sessions(id),request_id uuid not null unique,actor_id uuid references public.profiles(id),label text not null default '',cash_amount numeric(18,2) not null check(cash_amount>=0),card_amount numeric(18,2) not null check(card_amount>=0),created_at timestamptz not null default now(),check(cash_amount+card_amount>=0));
create index if not exists qr_parts_session on private.qr_payment_parts(session_id);
revoke all on private.qr_revision_receipts,private.qr_item_changes,private.qr_payment_parts from public,anon,authenticated,service_role;

-- Stable amounts are always computed from server-side prices; no client totals are trusted.
create or replace function private.qr_account_totals(p_session uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.qr_dining_sessions;sub numeric;disc numeric;svc numeric;paid numeric;cash numeric;card numeric;cur text;
begin
 select * into s from public.qr_dining_sessions where id=p_session;
 select coalesce(sum(total_amount) filter(where status<>'CANCELLED'),0),min(currency) into sub,cur from public.qr_orders where session_id=p_session;
 disc:=least(s.discount_amount,sub);svc:=round((sub-disc)*s.service_percent/100,2);
 select coalesce(sum(cash_amount),0),coalesce(sum(card_amount),0) into cash,card from private.qr_payment_parts where session_id=p_session;paid:=cash+card;if not exists(select 1 from private.qr_payment_parts where session_id=p_session) then select coalesce((select total_amount from public.qr_payments where session_id=p_session),0) into paid;end if;
 return jsonb_build_object('subtotal',sub::text,'discount',disc::text,'service_percent',s.service_percent::text,'service',svc::text,'total',(sub-disc+svc)::text,'paid',paid::text,'remaining',(sub-disc+svc-paid)::text,'cash',cash::text,'card',card::text,'currency',coalesce(cur,'AZN'));
end $$;
create or replace function private.qr_revision_replay(p_request uuid,p_payload jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare old jsonb;
begin
 if p_request is null or auth.uid() is null then raise exception 'INVALID_REQUEST';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('revision:'||auth.uid()::text||':'||p_request::text,0));
 select payload into old from private.qr_revision_receipts where actor_id=auth.uid() and request_id=p_request;
 if found then if old is distinct from p_payload then raise exception 'REQUEST_CONFLICT';end if;return true;end if;
 return false;
end $$;

create or replace function public.qr_adjust_order(p_restaurant_id uuid,p_branch_id uuid,p_order_id uuid,p_version integer,p_request_id uuid,p_changes jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.qr_orders;s public.qr_dining_sessions;i public.qr_order_items;x jsonb;payload jsonb;seen uuid[]:='{}';qty integer;changed boolean:=false;new_total numeric;
begin
 if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN';end if;
 if p_changes is null or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes) not between 1 and 50 or octet_length(p_changes::text)>12000 or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'INVALID_ADJUSTMENT';end if;
 payload:=jsonb_build_object('kind','ITEMS','restaurant',p_restaurant_id,'branch',p_branch_id,'order',p_order_id,'version',p_version,'changes',p_changes,'reason',btrim(p_reason));
 if private.qr_revision_replay(p_request_id,payload) then return public.qr_staff_board(p_restaurant_id,p_branch_id);end if;
 select s1.* into s from public.qr_dining_sessions s1 join public.qr_orders o1 on o1.session_id=s1.id where o1.id=p_order_id and o1.restaurant_id=p_restaurant_id and o1.branch_id=p_branch_id for update of s1;
 if not found then raise exception using errcode='42501',message='FORBIDDEN';end if;
 if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN';end if;
 if s.status='CLOSED' then raise exception 'TABLE_CLOSED';end if;
 if exists(select 1 from private.qr_payment_parts where session_id=s.id) then raise exception 'PAYMENTS_STARTED';end if;
 select * into o from public.qr_orders where id=p_order_id for update;
 if o.version is distinct from p_version then raise exception 'STALE_VERSION';end if;
 if o.status='CANCELLED' then raise exception 'INVALID_TRANSITION';end if;
 if o.status='SERVED' and private.qr_branch_role(p_restaurant_id,p_branch_id)<>'OWNER' then raise exception using errcode='42501',message='FORBIDDEN';end if;
 for x in select value from jsonb_array_elements(p_changes) loop
  if jsonb_typeof(x)<>'object' or coalesce(x->>'id','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or coalesce(x->>'quantity','') !~ '^[0-9]{1,2}$' then raise exception 'INVALID_ADJUSTMENT';end if;
  if (x->>'id')::uuid=any(seen) then raise exception 'INVALID_ADJUSTMENT';end if;seen:=array_append(seen,(x->>'id')::uuid);
  select * into i from public.qr_order_items where id=(x->>'id')::uuid and order_id=o.id for update;
  if not found then raise exception 'INVALID_ADJUSTMENT';end if;
  qty:=(x->>'quantity')::integer;if qty>i.quantity then raise exception 'INVALID_ADJUSTMENT';end if;
  if qty<>i.quantity then
   changed:=true;insert into private.qr_item_changes(order_id,item_id,old_quantity,new_quantity,reason,actor_id) values(o.id,i.id,i.quantity,qty,btrim(p_reason),auth.uid());
   update public.qr_order_items set quantity=qty,line_total=unit_price*qty where id=i.id;
  end if;
 end loop;
 if not changed then raise exception 'NO_CHANGES';end if;
 select sum(line_total) into new_total from public.qr_order_items where order_id=o.id;
 update public.qr_orders set total_amount=new_total,status=case when not exists(select 1 from public.qr_order_items where order_id=o.id and quantity>0) then 'CANCELLED' else status end,version=version+1,updated_at=now() where id=o.id;
 if not exists(select 1 from public.qr_order_items where order_id=o.id and quantity>0) then insert into public.qr_order_events(order_id,restaurant_id,branch_id,actor_id,status) values(o.id,p_restaurant_id,p_branch_id,auth.uid(),'CANCELLED');end if;
 update public.qr_dining_sessions set version=version+1,discount_amount=least(discount_amount,(select coalesce(sum(total_amount),0) from public.qr_orders where session_id=s.id and status<>'CANCELLED')) where id=s.id;
 insert into private.qr_kitchen_notices(restaurant_id,branch_id,order_number,table_name,message) values(p_restaurant_id,p_branch_id,o.order_number::text,s.table_name,'Sifariş dəyişdirildi: '||btrim(p_reason));
 insert into public.audit_logs(restaurant_id,branch_id,actor_id,action,entity_type,entity_id,details) values(p_restaurant_id,p_branch_id,auth.uid(),'qr.items_adjusted','qr_orders',o.id,jsonb_build_object('reason',btrim(p_reason),'old_total',o.total_amount::text,'total',new_total::text));
 insert into private.qr_revision_receipts values(auth.uid(),p_request_id,payload,now());
 return public.qr_staff_board(p_restaurant_id,p_branch_id);
end $$;

create table if not exists private.qr_move_tokens(visit_id uuid not null references private.qr_visits(id),qr_token text not null,primary key(visit_id,qr_token));
revoke all on private.qr_move_tokens from public,anon,authenticated,service_role;
create or replace function public.qr_transfer_table(p_restaurant_id uuid,p_branch_id uuid,p_session_id uuid,p_version integer,p_target_table uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.qr_dining_sessions;t public.tables;payload jsonb;old_token text;
begin
 if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN';end if;
 payload:=jsonb_build_object('kind','MOVE','restaurant',p_restaurant_id,'branch',p_branch_id,'session',p_session_id,'version',p_version,'target',p_target_table);
 if private.qr_revision_replay(p_request_id,payload) then return public.qr_staff_board(p_restaurant_id,p_branch_id);end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_restaurant_id::text,0));
 -- Match the order used by QR/manual ordering: restaurant, table, then session.
 perform 1 from public.tables where id in(p_target_table,(select table_id from public.qr_dining_sessions where id=p_session_id)) order by id for update;
 select * into s from public.qr_dining_sessions where id=p_session_id and restaurant_id=p_restaurant_id and branch_id=p_branch_id for update;
 if not found or not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN';end if;
 if s.status='CLOSED' then raise exception 'TABLE_CLOSED';end if;
 if s.version is distinct from p_version then raise exception 'STALE_VERSION';end if;
 if exists(select 1 from private.qr_payment_parts where session_id=s.id) then raise exception 'PAYMENTS_STARTED';end if;
 select * into t from public.tables where id=p_target_table and restaurant_id=p_restaurant_id and branch_id=p_branch_id and is_active;
 if not found or t.id=s.table_id then raise exception 'INVALID_TABLE';end if;
 if exists(select 1 from public.qr_dining_sessions where table_id=t.id and status<>'CLOSED') then raise exception 'TARGET_TABLE_BUSY';end if;
 select qr_token into old_token from public.tables where id=s.table_id;
 insert into private.qr_move_tokens select id,old_token from private.qr_visits where session_id=s.id and expires_at>now() on conflict do nothing;
 begin update public.qr_dining_sessions set table_id=t.id,table_name=t.name,table_number=t.table_number,version=version+1 where id=s.id;
 exception when unique_violation then raise exception 'TARGET_TABLE_BUSY';end;
 update public.qr_orders set table_id=t.id,version=version+1,updated_at=now() where session_id=s.id;
 update public.qr_service_requests set table_id=t.id,version=version+1,updated_at=now() where session_id=s.id;
 insert into private.qr_kitchen_notices(restaurant_id,branch_id,table_name,message) values(p_restaurant_id,p_branch_id,t.name,'Masa dəyişdi: '||s.table_name||' → '||t.name);
 insert into public.audit_logs(restaurant_id,branch_id,actor_id,action,entity_type,entity_id,details) values(p_restaurant_id,p_branch_id,auth.uid(),'qr.table_transferred','qr_session',s.id,jsonb_build_object('from_table',s.table_name,'to_table',t.name));
 insert into private.qr_revision_receipts values(auth.uid(),p_request_id,payload,now());
 return public.qr_staff_board(p_restaurant_id,p_branch_id);
end $$;
create or replace function private.qr_clear_move_tokens() returns trigger language plpgsql security definer set search_path='' as $$
begin if old.qr_token is distinct from new.qr_token then delete from private.qr_move_tokens where visit_id in(select v.id from private.qr_visits v join public.qr_dining_sessions s on s.id=v.session_id where s.table_id=new.id);end if;return new;end $$;
drop trigger if exists qr_clear_move_tokens on public.tables;
create trigger qr_clear_move_tokens after update of qr_token on public.tables for each row execute function private.qr_clear_move_tokens();

create or replace function public.qr_adjust_bill(p_restaurant_id uuid,p_branch_id uuid,p_session_id uuid,p_version integer,p_discount text,p_service_percent text,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.qr_dining_sessions;disc numeric;rate numeric;sub numeric;payload jsonb;
begin
 if private.qr_branch_role(p_restaurant_id,p_branch_id) is distinct from 'OWNER' then raise exception using errcode='42501',message='FORBIDDEN';end if;
 disc:=private.qr_payment_amount(p_discount);rate:=private.qr_payment_amount(p_service_percent);
 if rate>100 or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'INVALID_ADJUSTMENT';end if;
 payload:=jsonb_build_object('kind','BILL_ADJUST','restaurant',p_restaurant_id,'branch',p_branch_id,'session',p_session_id,'version',p_version,'discount',disc,'rate',rate,'reason',btrim(p_reason));
 if private.qr_revision_replay(p_request_id,payload) then return public.qr_staff_board(p_restaurant_id,p_branch_id);end if;
 select * into s from public.qr_dining_sessions where id=p_session_id and restaurant_id=p_restaurant_id and branch_id=p_branch_id for update;
 if not found or private.qr_branch_role(p_restaurant_id,p_branch_id) is distinct from 'OWNER' then raise exception using errcode='42501',message='FORBIDDEN';end if;
 if s.status='CLOSED' then raise exception 'TABLE_CLOSED';end if;
 if s.version is distinct from p_version then raise exception 'STALE_VERSION';end if;
 if exists(select 1 from private.qr_payment_parts where session_id=s.id) then raise exception 'PAYMENTS_STARTED';end if;
 select coalesce(sum(total_amount),0) into sub from public.qr_orders where session_id=s.id and status<>'CANCELLED';
 if disc>sub or sub=0 then raise exception 'INVALID_ADJUSTMENT';end if;
 update public.qr_dining_sessions set discount_amount=disc,service_percent=rate,version=version+1 where id=s.id;
 insert into public.audit_logs(restaurant_id,branch_id,actor_id,action,entity_type,entity_id,details) values(p_restaurant_id,p_branch_id,auth.uid(),'qr.bill_adjusted','qr_session',s.id,jsonb_build_object('reason',btrim(p_reason),'discount',disc::text,'service_percent',rate::text));
 insert into private.qr_revision_receipts values(auth.uid(),p_request_id,payload,now());
 return public.qr_staff_board(p_restaurant_id,p_branch_id);
end $$;

create or replace function private.qr_accept_payment(p_restaurant_id uuid,p_branch_id uuid,p_session_id uuid,p_version integer,p_request_id uuid,p_payment_method text,p_cash text,p_card text,p_expected_total text,p_currency text,p_label text,p_close boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.qr_dining_sessions;p public.qr_payments;tot jsonb;cash numeric;card numeric;expected numeric;left_amount numeric;all_cash numeric;all_card numeric;payload jsonb;replay boolean;closing boolean;role_name text;
begin
 if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN';end if;
 if p_version is null or p_version<1 or p_request_id is null or p_payment_method is null or p_payment_method not in('CASH','CARD','MIXED') or length(coalesce(p_label,''))>80 then raise exception 'INVALID_PAYMENT_METHOD';end if;
 cash:=private.qr_payment_amount(p_cash);card:=private.qr_payment_amount(p_card);expected:=private.qr_payment_amount(p_expected_total);
 if (p_payment_method='CASH' and card<>0) or(p_payment_method='CARD' and cash<>0) or(p_payment_method='MIXED' and(cash<=0 or card<=0)) then raise exception 'PAYMENT_SUM_MISMATCH';end if;
 payload:=jsonb_build_object('kind','PAY','restaurant',p_restaurant_id,'branch',p_branch_id,'session',p_session_id,'version',p_version,'method',p_payment_method,'cash',cash,'card',card,'expected',expected,'currency',p_currency,'label',coalesce(p_label,''),'close',p_close);
 replay:=private.qr_revision_replay(p_request_id,payload);
 select * into s from public.qr_dining_sessions where id=p_session_id and restaurant_id=p_restaurant_id and branch_id=p_branch_id for update;
 if not found or not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN';end if;
 if not replay then
  if s.status='CLOSED' then raise exception 'ACCOUNT_ALREADY_PAID';end if;
  if s.version is distinct from p_version then raise exception 'STALE_VERSION';end if;
  if s.status<>'BILL_REQUESTED' then raise exception 'INVALID_TRANSITION';end if;
  if exists(select 1 from public.qr_orders where session_id=s.id and status not in('SERVED','CANCELLED')) then raise exception 'UNFINISHED_ORDERS';end if;
  if not exists(select 1 from public.qr_orders where session_id=s.id and status='SERVED') then raise exception 'NO_PAYABLE_ORDERS';end if;
  if (select count(distinct currency) from public.qr_orders where session_id=s.id and status='SERVED')<>1 then raise exception 'CURRENCY_CHANGED';end if;
  tot:=private.qr_account_totals(s.id);left_amount:=(tot->>'remaining')::numeric;
  if expected<>left_amount or p_currency is distinct from tot->>'currency' then raise exception 'PAYMENT_TOTAL_CHANGED';end if;
  if cash+card>left_amount or (cash+card=0 and left_amount>0) or (p_close and cash+card<>left_amount) then raise exception 'PAYMENT_SUM_MISMATCH';end if;
  insert into private.qr_payment_parts(session_id,request_id,actor_id,label,cash_amount,card_amount) values(s.id,p_request_id,auth.uid(),coalesce(p_label,''),cash,card);
  closing:=cash+card=left_amount;
  if closing then
   select sum(cash_amount),sum(card_amount) into all_cash,all_card from private.qr_payment_parts where session_id=s.id;
   role_name:=case when private.qr_branch_role(p_restaurant_id,p_branch_id)='OWNER' then 'Restoran sahibi' else 'Ofisiant' end;
   insert into public.qr_payments(session_id,restaurant_id,branch_id,branch_name,actor_id,actor_name,actor_role,request_id,session_version,payment_method,total_amount,cash_amount,card_amount,currency)
   select s.id,p_restaurant_id,p_branch_id,b.name,auth.uid(),coalesce(nullif(btrim(pr.full_name),''),'İstifadəçi'),role_name,p_request_id,p_version,case when all_cash>0 and all_card>0 then 'MIXED' when all_card>0 then 'CARD' else 'CASH' end,(tot->>'total')::numeric,all_cash,all_card,p_currency from public.branches b join public.profiles pr on pr.id=auth.uid() where b.id=p_branch_id returning * into p;
   update public.qr_dining_sessions set status='CLOSED',version=version+1,closed_at=p.paid_at where id=s.id;
   update public.qr_service_requests set status='DONE',version=version+1,updated_at=p.paid_at where session_id=s.id and status<>'DONE';
  else update public.qr_dining_sessions set version=version+1 where id=s.id;end if;
  insert into public.audit_logs(restaurant_id,branch_id,actor_id,action,entity_type,entity_id,details) values(p_restaurant_id,p_branch_id,auth.uid(),case when closing then 'qr.account_paid' else 'qr.partial_paid' end,'qr_session',s.id,jsonb_build_object('cash_amount',cash::text,'card_amount',card::text,'total',(cash+card)::text,'label',coalesce(p_label,'')));
  insert into private.qr_revision_receipts values(auth.uid(),p_request_id,payload,now());
 end if;
 select * into p from public.qr_payments where session_id=s.id;
 return jsonb_build_object('board',public.qr_staff_board(p_restaurant_id,p_branch_id),'closed',p.id is not null,'remaining',private.qr_account_totals(s.id)->>'remaining',
 'payment',case when p.id is null then null else jsonb_build_object('session_id',s.id,'number',p.receipt_number::text,'method',p.payment_method,'total',p.total_amount::text,'cash',p.cash_amount::text,'card',p.card_amount::text,'currency',p.currency,'paid_at',p.paid_at) end);
end $$;
create or replace function public.qr_settle_account(p_restaurant_id uuid,p_branch_id uuid,p_session_id uuid,p_version integer,p_request_id uuid,p_payment_method text,p_cash text,p_card text,p_expected_total text,p_currency text)
returns jsonb language sql security definer set search_path='' as $$ select private.qr_accept_payment(p_restaurant_id,p_branch_id,p_session_id,p_version,p_request_id,p_payment_method,p_cash,p_card,p_expected_total,p_currency,'',true) $$;
create or replace function public.qr_pay_part(p_restaurant_id uuid,p_branch_id uuid,p_session_id uuid,p_version integer,p_request_id uuid,p_payment_method text,p_cash text,p_card text,p_expected_total text,p_currency text,p_label text)
returns jsonb language sql security definer set search_path='' as $$ select private.qr_accept_payment(p_restaurant_id,p_branch_id,p_session_id,p_version,p_request_id,p_payment_method,p_cash,p_card,p_expected_total,p_currency,p_label,false) $$;

create or replace function private.qr_require_payment_on_close() returns trigger language plpgsql security definer set search_path='' as $$
declare tot jsonb;p public.qr_payments;
begin
 if old.status='CLOSED' and new.status<>'CLOSED' and exists(select 1 from public.qr_payments where session_id=old.id) then raise exception 'PAID_ACCOUNT_LOCKED';end if;
 if old.status<>'CLOSED' and new.status='CLOSED' and exists(select 1 from public.qr_orders where session_id=new.id and status<>'CANCELLED') then
  if exists(select 1 from public.qr_orders where session_id=new.id and status not in('SERVED','CANCELLED')) then raise exception 'UNFINISHED_ORDERS';end if;
  select * into p from public.qr_payments where session_id=new.id and restaurant_id=new.restaurant_id and branch_id=new.branch_id;
  if not found then raise exception 'PAYMENT_REQUIRED';end if;tot:=private.qr_account_totals(new.id);
  if p.total_amount<>(tot->>'total')::numeric or p.currency is distinct from tot->>'currency' then raise exception 'PAYMENT_TOTAL_CHANGED';end if;
 end if;return new;
end $$;

create or replace function private.qr_visit_session(p_slug text,p_token text,p_visit_id uuid,p_secret text)
returns public.qr_dining_sessions language plpgsql security definer set search_path='' as $$
declare v_session public.qr_dining_sessions;
begin
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' then raise exception 'VISIT_EXPIRED'; end if;
  select s.* into v_session from private.qr_visits v join public.qr_dining_sessions s on s.id=v.session_id
    join public.tables t on t.id=s.table_id join public.restaurants r on r.id=s.restaurant_id
    join public.branches b on b.id=s.branch_id
    where v.id=p_visit_id and v.secret_hash=sha256(convert_to(p_secret,'UTF8')) and v.expires_at>now()
      and r.slug=p_slug and (t.qr_token=p_token or exists(select 1 from private.qr_move_tokens mt where mt.visit_id=v.id and mt.qr_token=p_token)) and r.is_active and r.status in ('trial','active') and t.is_active and b.is_active;
  if not found then raise exception 'VISIT_EXPIRED'; end if;
  return v_session;
end $$;

create or replace function public.qr_submit_order(p_slug text,p_token text,p_visit_id uuid,p_secret text,p_request_id uuid,p_latitude numeric,p_longitude numeric,p_items jsonb,p_currency text,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_menu jsonb; v_session public.qr_dining_sessions; v_old public.qr_orders; v_payload jsonb; v_item jsonb; v_product jsonb;
  v_lines jsonb:='[]'::jsonb; v_seen uuid[]:='{}'; v_product_id uuid; v_quantity integer; v_price numeric; v_total numeric:=0; v_order uuid;
begin
  v_session:=private.qr_visit_session(p_slug,p_token,p_visit_id,p_secret);
  if p_request_id is null or p_currency is null or char_length(p_currency) not between 1 and 10 or p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'INVALID_ORDER'; end if;
  if jsonb_array_length(p_items) not between 1 and 50 or octet_length(p_items::text)>32768 or char_length(coalesce(p_note,''))>500 then raise exception 'INVALID_ORDER'; end if;
  v_payload:=jsonb_build_object('items',p_items,'currency',p_currency,'note',nullif(btrim(p_note),''));
  -- Serialize duplicate retries with other writes at this table, then return an existing receipt.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_session.restaurant_id::text,0));
  perform 1 from public.tables where id=v_session.table_id for update;
  select * into v_session from public.qr_dining_sessions where id=v_session.id for update;
  select * into v_old from public.qr_orders where visit_id=p_visit_id and request_id=p_request_id;
  if found then
    if v_old.payload<>v_payload then raise exception 'REQUEST_CONFLICT'; end if;
    return jsonb_build_object('order_id',v_old.id,'view',public.qr_get_visit(p_slug,p_token,p_visit_id,p_secret));
  end if;
  if exists(select 1 from private.qr_payment_parts where session_id=v_session.id) then raise exception 'PAYMENTS_STARTED';end if;
  if v_session.status<>'OPEN' then raise exception 'TABLE_CLOSED'; end if;
  if (select count(*) from public.qr_orders where visit_id=p_visit_id and created_at>now()-interval '5 minutes')>=6
     or (select count(*) from public.qr_orders where session_id=v_session.id and created_at>now()-interval '5 minutes')>=20 then raise exception 'TOO_MANY_REQUESTS'; end if;
  v_menu:=private.qr_checked_menu(p_slug,(select qr_token from public.tables where id=v_session.table_id),p_latitude,p_longitude,true);
  if p_currency is distinct from v_menu->>'currency' or exists(select 1 from public.qr_orders where session_id=v_session.id and currency<>p_currency) then raise exception 'CURRENCY_CHANGED'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item)<>'object' or coalesce(v_item->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(v_item->>'quantity','') !~ '^[0-9]+$' or char_length(v_item->>'quantity')>2 then raise exception 'INVALID_ORDER'; end if;
    v_product_id:=(v_item->>'id')::uuid; v_quantity:=(v_item->>'quantity')::integer;
    if v_quantity not between 1 and 20 or v_product_id=any(v_seen) then raise exception 'INVALID_ORDER'; end if;
    v_seen:=array_append(v_seen,v_product_id);
    select p.value into v_product from jsonb_array_elements(v_menu->'categories') c
      cross join lateral jsonb_array_elements(c.value->'products') p where p.value->>'id'=v_product_id::text;
    if not found or not coalesce((v_product->>'is_available')::boolean,false) then raise exception 'PRODUCT_UNAVAILABLE'; end if;
    v_price:=round((v_product->>'price')::numeric,2);
    if v_price<0 or v_price>99999999.99 or coalesce(v_item->>'price','') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'INVALID_ORDER'; end if;
    if (v_item->>'price')::numeric<>v_price then raise exception 'PRICE_CHANGED'; end if;
    v_total:=v_total+v_price*v_quantity;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('id',v_product_id,'name',v_product->>'name','price',v_price,'quantity',v_quantity,'total',v_price*v_quantity));
  end loop;
  if v_total>99999999.99 then raise exception 'INVALID_ORDER'; end if;
  insert into public.qr_orders(session_id,restaurant_id,branch_id,table_id,visit_id,request_id,payload,total_amount,currency,note)
    values(v_session.id,v_session.restaurant_id,v_session.branch_id,v_session.table_id,p_visit_id,p_request_id,v_payload,v_total,v_menu->>'currency',nullif(btrim(p_note),'')) returning id into v_order;
  insert into public.qr_order_items(order_id,restaurant_id,branch_id,product_id,product_name,unit_price,quantity,line_total)
    select v_order,v_session.restaurant_id,v_session.branch_id,(x->>'id')::uuid,x->>'name',(x->>'price')::numeric,(x->>'quantity')::integer,(x->>'total')::numeric from jsonb_array_elements(v_lines) x;
  insert into public.qr_order_events(order_id,restaurant_id,branch_id,status) values(v_order,v_session.restaurant_id,v_session.branch_id,'NEW');
  insert into public.audit_logs(restaurant_id,branch_id,action,entity_type,entity_id,details)
    values(v_session.restaurant_id,v_session.branch_id,'qr.order_created','qr_orders',v_order,jsonb_build_object('table_id',v_session.table_id,'total',v_total));
  update public.qr_dining_sessions set version=version+1 where id=v_session.id;
  return jsonb_build_object('order_id',v_order,'view',public.qr_get_visit(p_slug,p_token,p_visit_id,p_secret));
end $$;

create or replace function public.qr_request_service(p_slug text,p_token text,p_visit_id uuid,p_secret text,p_request_id uuid,p_kind text,p_latitude numeric,p_longitude numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.qr_dining_sessions; v_receipt private.qr_action_receipts; v_call public.qr_service_requests; v_response jsonb; v_menu jsonb;
begin
  v_session:=private.qr_visit_session(p_slug,p_token,p_visit_id,p_secret);
  if p_request_id is null or p_kind is null or p_kind not in ('WAITER','BILL') then raise exception 'INVALID_REQUEST'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_session.restaurant_id::text,0));
  perform 1 from public.tables where id=v_session.table_id for update;
  select * into v_session from public.qr_dining_sessions where id=v_session.id for update;
  select * into v_receipt from private.qr_action_receipts where visit_id=p_visit_id and request_id=p_request_id;
  if found then
    if v_receipt.kind<>p_kind then raise exception 'REQUEST_CONFLICT'; end if;
    return public.qr_get_visit(p_slug,p_token,p_visit_id,p_secret);
  end if;
  if v_session.status='CLOSED' then raise exception 'TABLE_CLOSED'; end if;
  -- Eligibility belongs to this visit, including when another guest already requested the bill.
  if p_kind='BILL' and not exists(
    select 1 from public.qr_orders
    where session_id=v_session.id and visit_id=p_visit_id and status<>'CANCELLED'
  ) then raise exception 'NO_ORDERS'; end if;
  v_menu:=private.qr_checked_menu(p_slug,p_token,p_latitude,p_longitude,false);
  select * into v_call from public.qr_service_requests where session_id=v_session.id and kind=p_kind and status<>'DONE';
  if not found then
    if exists(select 1 from public.qr_service_requests where session_id=v_session.id and kind=p_kind and created_at>now()-interval '1 minute') then raise exception 'TOO_MANY_REQUESTS'; end if;
    insert into public.qr_service_requests(session_id,restaurant_id,branch_id,table_id,kind)
      values(v_session.id,v_session.restaurant_id,v_session.branch_id,v_session.table_id,p_kind) returning * into v_call;
    if p_kind='BILL' then update public.qr_dining_sessions set status='BILL_REQUESTED',version=version+1 where id=v_session.id; end if;
    insert into public.audit_logs(restaurant_id,branch_id,action,entity_type,entity_id,details)
      values(v_session.restaurant_id,v_session.branch_id,'qr.service_requested','qr_service_requests',v_call.id,jsonb_build_object('kind',p_kind,'table_id',v_session.table_id));
  end if;
  v_response:=jsonb_build_object('call_id',v_call.id);
  insert into private.qr_action_receipts(visit_id,request_id,kind,response) values(p_visit_id,p_request_id,p_kind,v_response);
  return public.qr_get_visit(p_slug,p_token,p_visit_id,p_secret);
end $$;

create or replace function public.qr_request_bill(p_slug text,p_token text,p_visit_id uuid,p_secret text,p_request_id uuid,p_payment_method text,p_latitude numeric,p_longitude numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.qr_dining_sessions; v_receipt private.qr_action_receipts; v_call public.qr_service_requests;
begin
  v_session:=private.qr_visit_session(p_slug,p_token,p_visit_id,p_secret);
  if p_request_id is null then raise exception 'INVALID_REQUEST'; end if;
  if p_payment_method is null or p_payment_method not in ('CASH','CARD','MIXED') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_session.restaurant_id::text,0));
  perform 1 from public.tables where id=v_session.table_id for update;
  perform 1 from public.qr_dining_sessions where id=v_session.id for update;
  select * into v_receipt from private.qr_action_receipts where visit_id=p_visit_id and request_id=p_request_id;
  if found then
    if v_receipt.kind<>'BILL' or v_receipt.response->>'payment_method' is distinct from p_payment_method then raise exception 'REQUEST_CONFLICT'; end if;
    return public.qr_get_visit(p_slug,p_token,p_visit_id,p_secret);
  end if;
  perform public.qr_request_service(p_slug,p_token,p_visit_id,p_secret,p_request_id,'BILL',p_latitude,p_longitude);
  select * into v_receipt from private.qr_action_receipts where visit_id=p_visit_id and request_id=p_request_id;
  select * into v_call from public.qr_service_requests where id=(v_receipt.response->>'call_id')::uuid for update;
  -- First specified method wins for the entire table, including simultaneous phones.
  if v_call.payment_method is null then
    update public.qr_service_requests set payment_method=p_payment_method,version=version+1,updated_at=now() where id=v_call.id;
    insert into public.audit_logs(restaurant_id,branch_id,action,entity_type,entity_id,details)
      values(v_session.restaurant_id,v_session.branch_id,'qr.bill_payment_selected','qr_service_requests',v_call.id,jsonb_build_object('payment_method',p_payment_method));
  end if;
  update private.qr_action_receipts set response=response||jsonb_build_object('payment_method',p_payment_method) where visit_id=p_visit_id and request_id=p_request_id;
  return public.qr_get_visit(p_slug,p_token,p_visit_id,p_secret);
end $$;

create or replace function public.qr_manual_submit(p_restaurant_id uuid,p_branch_id uuid,p_table_id uuid,p_session_id uuid,
  p_request_id uuid,p_items jsonb,p_currency text,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_payload jsonb;v_old private.operation_receipts;v_table public.tables;v_session public.qr_dining_sessions;
  v_visit uuid;v_order uuid;v_number bigint;v_currency text;v_item jsonb;v_product record;v_id uuid;v_qty integer;
  v_seen uuid[]:='{}';v_lines jsonb:='[]';v_total numeric:=0;v_response jsonb;
begin
  if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if p_request_id is null or p_table_id is null or p_currency is null or p_items is null or jsonb_typeof(p_items)<>'array'
    or jsonb_array_length(p_items) not between 1 and 50 or octet_length(p_items::text)>32768 or length(coalesce(p_note,''))>500 then raise exception 'INVALID_ORDER'; end if;
  v_payload:=jsonb_build_object('restaurant',p_restaurant_id,'branch',p_branch_id,'table',p_table_id,'session',p_session_id,
    'items',p_items,'currency',p_currency,'note',nullif(btrim(p_note),''));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('operation:'||v_actor::text||':'||p_request_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_restaurant_id::text,0));
  if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  select * into v_old from private.operation_receipts where actor_id=v_actor and kind='MANUAL' and request_id=p_request_id;
  if found then if v_old.payload<>v_payload then raise exception 'REQUEST_CONFLICT'; end if;return v_old.response;end if;
  select * into v_table from public.tables where id=p_table_id and restaurant_id=p_restaurant_id and branch_id=p_branch_id and is_active for update;
  if not found then raise exception 'INVALID_TABLE'; end if;
  if not exists(select 1 from public.branches b join public.restaurant_settings s on s.restaurant_id=b.restaurant_id
    where b.id=p_branch_id and b.restaurant_id=p_restaurant_id and b.is_active and b.accepting_orders and s.order_enabled) then raise exception 'ORDERS_PAUSED'; end if;
  select * into v_session from public.qr_dining_sessions where table_id=p_table_id and status<>'CLOSED' for update;
  if found then
    if v_session.id is distinct from p_session_id then raise exception 'STALE_TABLE'; end if;
    if exists(select 1 from private.qr_payment_parts where session_id=v_session.id) then raise exception 'PAYMENTS_STARTED';end if;
    if v_session.status<>'OPEN' then raise exception 'TABLE_CLOSED'; end if;
  else
    if p_session_id is not null then raise exception 'STALE_TABLE'; end if;
    insert into public.qr_dining_sessions(restaurant_id,branch_id,table_id,table_name,table_number)
      values(p_restaurant_id,p_branch_id,p_table_id,v_table.name,v_table.table_number) returning * into v_session;
  end if;
  if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if (select count(*) from public.qr_orders where session_id=v_session.id and created_at>now()-interval '5 minutes')>=20
    or (select count(*) from private.operation_receipts where actor_id=v_actor and kind='MANUAL' and created_at>now()-interval '5 minutes')>=120 then raise exception 'TOO_MANY_REQUESTS'; end if;
  select currency into v_currency from public.restaurant_settings where restaurant_id=p_restaurant_id;
  if p_currency is distinct from v_currency or exists(select 1 from public.qr_orders where session_id=v_session.id and currency<>v_currency) then raise exception 'CURRENCY_CHANGED'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item)<>'object' or coalesce(v_item->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(v_item->>'quantity','') !~ '^[0-9]{1,2}$' or coalesce(v_item->>'price','') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' then raise exception 'INVALID_ORDER'; end if;
    v_id:=(v_item->>'id')::uuid;v_qty:=(v_item->>'quantity')::integer;
    if v_qty not between 1 and 20 or v_id=any(v_seen) then raise exception 'INVALID_ORDER'; end if;v_seen:=array_append(v_seen,v_id);
    select p.name,coalesce(bs.price_override,p.base_price) as price into v_product from public.products p
      join public.categories c on c.id=p.category_id and c.restaurant_id=p.restaurant_id
      left join public.branch_product_settings bs on bs.product_id=p.id and bs.restaurant_id=p.restaurant_id and bs.branch_id=p_branch_id
      where p.id=v_id and p.restaurant_id=p_restaurant_id and p.is_active and c.is_active
        and coalesce(bs.is_visible,true) and coalesce(bs.is_available,true);
    if not found then raise exception 'PRODUCT_UNAVAILABLE'; end if;
    if v_product.price<>(v_item->>'price')::numeric then raise exception 'PRICE_CHANGED'; end if;
    v_total:=v_total+v_product.price*v_qty;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('id',v_id,'name',v_product.name,'price',v_product.price,'quantity',v_qty,'total',v_product.price*v_qty));
  end loop;
  if v_total>99999999.99 then raise exception 'INVALID_ORDER'; end if;
  select o.visit_id into v_visit from public.qr_orders o join public.qr_order_events e on e.order_id=o.id and e.status='NEW' and e.actor_id=v_actor where o.session_id=v_session.id and o.source='STAFF' limit 1;
  if v_visit is null then
    insert into private.qr_visits(session_id,secret_hash,expires_at) values(v_session.id,sha256(convert_to(gen_random_uuid()::text,'UTF8')),now()) returning id into v_visit;
  end if;
  insert into public.qr_orders(session_id,restaurant_id,branch_id,table_id,visit_id,request_id,payload,total_amount,currency,note,source)
    values(v_session.id,p_restaurant_id,p_branch_id,p_table_id,v_visit,p_request_id,v_payload,v_total,v_currency,nullif(btrim(p_note),''),'STAFF') returning id,order_number into v_order,v_number;
  insert into public.qr_order_items(order_id,restaurant_id,branch_id,product_id,product_name,unit_price,quantity,line_total)
    select v_order,p_restaurant_id,p_branch_id,(x->>'id')::uuid,x->>'name',(x->>'price')::numeric,(x->>'quantity')::integer,(x->>'total')::numeric from jsonb_array_elements(v_lines) x;
  insert into public.qr_order_events(order_id,restaurant_id,branch_id,actor_id,status) values(v_order,p_restaurant_id,p_branch_id,v_actor,'NEW');
  insert into public.audit_logs(restaurant_id,branch_id,actor_id,action,entity_type,entity_id,details)
    values(p_restaurant_id,p_branch_id,v_actor,'qr.manual_order_created','qr_orders',v_order,jsonb_build_object('table_id',p_table_id,'total',v_total,'source','STAFF'));
  update public.qr_dining_sessions set version=version+1 where id=v_session.id;
  v_response:=jsonb_build_object('order_id',v_order,'number',v_number::text,'table_name',v_table.name,'total',v_total::text,'currency',v_currency);
  insert into private.operation_receipts(actor_id,kind,request_id,payload,response) values(v_actor,'MANUAL',p_request_id,v_payload,v_response);
  return v_response;
end $$;

create or replace function public.qr_staff_action(p_restaurant_id uuid,p_branch_id uuid,p_kind text,p_id uuid,p_version integer,p_status text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.qr_orders; v_session public.qr_dining_sessions; v_call public.qr_service_requests; v_session_id uuid;
begin
  if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if p_kind='ORDER' then select session_id into v_session_id from public.qr_orders where id=p_id and restaurant_id=p_restaurant_id and branch_id=p_branch_id;
  elsif p_kind='SERVICE' then select session_id into v_session_id from public.qr_service_requests where id=p_id and restaurant_id=p_restaurant_id and branch_id=p_branch_id;
  elsif p_kind in ('CLOSE','REOPEN','CLEAR') then v_session_id:=p_id;
  else raise exception 'INVALID_REQUEST'; end if;
  select * into v_session from public.qr_dining_sessions where id=v_session_id and restaurant_id=p_restaurant_id and branch_id=p_branch_id for update;
  if not found then raise exception 'TABLE_CLOSED'; end if;
  if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if exists(select 1 from private.qr_payment_parts where session_id=v_session.id) and p_kind<>'SERVICE' then raise exception 'PAYMENTS_STARTED';end if;
  if v_session.status='CLOSED' then raise exception 'TABLE_CLOSED'; end if;
  if p_kind='ORDER' and p_status='CANCELLED' then raise exception 'ADJUSTMENT_REQUIRED';end if;
  if p_kind='ORDER' then
    select * into v_order from public.qr_orders where id=p_id and restaurant_id=p_restaurant_id and branch_id=p_branch_id and session_id=v_session.id for update;
    if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
    if private.qr_branch_role(p_restaurant_id,p_branch_id)<>'OWNER' and (p_status is null or p_status not in ('SERVED','CANCELLED')) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
    if p_version is distinct from v_order.version then raise exception 'STALE_VERSION'; end if;
    if p_status is null or not ((v_order.status='NEW' and p_status in ('ACCEPTED','CANCELLED'))
      or (v_order.status='ACCEPTED' and p_status in ('PREPARING','CANCELLED'))
      or (v_order.status='PREPARING' and p_status in ('READY','CANCELLED'))
      or (v_order.status='READY' and p_status in ('SERVED','CANCELLED'))) then raise exception 'INVALID_TRANSITION'; end if;
    update public.qr_orders set status=p_status,version=version+1,updated_at=now() where id=p_id;
    insert into public.qr_order_events(order_id,restaurant_id,branch_id,actor_id,status) values(p_id,p_restaurant_id,p_branch_id,auth.uid(),p_status);
  elsif p_kind='SERVICE' then
    select * into v_call from public.qr_service_requests where id=p_id and restaurant_id=p_restaurant_id and branch_id=p_branch_id and session_id=v_session.id for update;
    if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
    if p_version is distinct from v_call.version then raise exception 'STALE_VERSION'; end if;
    if p_status is null or not ((v_call.status='NEW' and p_status='SEEN') or (v_call.status='SEEN' and p_status='DONE' and v_call.kind='WAITER')) then raise exception 'INVALID_TRANSITION'; end if;
    update public.qr_service_requests set status=p_status,version=version+1,updated_at=now() where id=p_id;
  else
    if p_version is distinct from v_session.version then raise exception 'STALE_VERSION'; end if;
    if p_kind='CLEAR' then
      if exists(select 1 from public.qr_orders where session_id=p_id and status<>'CANCELLED') then raise exception 'UNFINISHED_ORDERS'; end if;
      update public.qr_dining_sessions set status='CLOSED',version=version+1,closed_at=now() where id=p_id;
      update public.qr_service_requests set status='DONE',version=version+1,updated_at=now() where session_id=p_id and status<>'DONE';
    elsif p_kind='CLOSE' then
      if v_session.status<>'BILL_REQUESTED' then raise exception 'INVALID_TRANSITION'; end if;
      if exists(select 1 from public.qr_orders where session_id=p_id and status not in ('SERVED','CANCELLED')) then raise exception 'UNFINISHED_ORDERS'; end if;
      update public.qr_dining_sessions set status='CLOSED',version=version+1,closed_at=now() where id=p_id;
      update public.qr_service_requests set status='DONE',version=version+1,updated_at=now() where session_id=p_id and status<>'DONE';
    elsif p_kind='REOPEN' then
      if v_session.status<>'BILL_REQUESTED' then raise exception 'INVALID_TRANSITION'; end if;
      update public.qr_dining_sessions set status='OPEN',version=version+1 where id=p_id;
      update public.qr_service_requests set status='DONE',version=version+1,updated_at=now() where session_id=p_id and kind='BILL' and status<>'DONE';
    end if;
  end if;
  if p_kind in('ORDER','SERVICE') then update public.qr_dining_sessions set version=version+1 where id=v_session.id;end if;
  insert into public.audit_logs(restaurant_id,branch_id,actor_id,action,entity_type,entity_id,details)
    values(p_restaurant_id,p_branch_id,auth.uid(),'qr.staff_action','qr_'||lower(p_kind),p_id,jsonb_build_object('status',p_status,'version',p_version));
  return public.qr_staff_board(p_restaurant_id,p_branch_id);
end $$;

create or replace function private.qr_order_json(p_order_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',o.id,'request_id',o.request_id,'number',o.order_number,'status',o.status,'version',o.version,
    'total',o.total_amount,'currency',o.currency,'note',o.note,'created_at',o.created_at,'updated_at',o.updated_at,
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'original_quantity',i.original_quantity,'name',i.product_name,'price',i.unit_price,'quantity',i.quantity,'total',i.line_total) order by i.product_name,i.id)
      from public.qr_order_items i where i.order_id=o.id),'[]'::jsonb),
    'changes',coalesce((select jsonb_agg(jsonb_build_object('name',i.product_name,'old_quantity',c.old_quantity,'quantity',c.new_quantity,'reason',c.reason,'at',c.created_at) order by c.created_at,c.id) from private.qr_item_changes c join public.qr_order_items i on i.id=c.item_id where c.order_id=o.id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('status',e.status,'at',e.created_at) order by e.created_at,e.id)
      from public.qr_order_events e where e.order_id=o.id),'[]'::jsonb))
  from public.qr_orders o where o.id=p_order_id;
$$;

create or replace function public.qr_get_visit(p_slug text,p_token text,p_visit_id uuid,p_secret text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.qr_dining_sessions;
begin
  v_session:=private.qr_visit_session(p_slug,p_token,p_visit_id,p_secret);
  return jsonb_build_object('totals',private.qr_account_totals(v_session.id),'session',jsonb_build_object('id',v_session.id,'status',v_session.status,'table_name',v_session.table_name),
    'orders',coalesce((select jsonb_agg(private.qr_order_json(o.id) order by o.created_at desc) from public.qr_orders o where o.visit_id=p_visit_id),'[]'::jsonb),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'payment_method',c.payment_method,'status',c.status,'created_at',c.created_at,'updated_at',c.updated_at) order by c.created_at desc)
      from public.qr_service_requests c where c.session_id=v_session.id and c.status<>'DONE'),'[]'::jsonb));
end $$;

create or replace function public.qr_kitchen_board(
  p_restaurant_id uuid,p_branch_id uuid,p_search text default null,p_limit integer default 30
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_search text:=nullif(btrim(p_search),'');v_result jsonb;
begin
  if not private.qr_can_kitchen(p_restaurant_id,p_branch_id) then
    raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if p_limit is null or p_limit<30 or p_limit>150 or p_limit%30<>0
    or char_length(coalesce(v_search,''))>80 then raise exception 'INVALID_KITCHEN_FILTER'; end if;
  with active as materialized (
    select o.id,o.order_number,o.status,o.version,o.note,o.created_at,o.updated_at,
      s.table_id,s.table_number,s.table_name,
      case when o.status='NEW' then 'NEW' when o.status='READY' then 'READY' else 'WORKING' end as lane
    from public.qr_orders o join public.qr_dining_sessions s on s.id=o.session_id
      and s.restaurant_id=o.restaurant_id and s.branch_id=o.branch_id and s.table_id=o.table_id
    where o.restaurant_id=p_restaurant_id and o.branch_id=p_branch_id and s.status<>'CLOSED'
      and o.status in ('NEW','ACCEPTED','PREPARING','READY')
  ), filtered as materialized (
    select * from active where v_search is null or case
      when v_search~'^#[0-9]+$' then order_number::numeric=substring(v_search from 2)::numeric
      when v_search~'^[0-9]+$' then table_number::numeric=v_search::numeric
      else strpos(lower(table_name),lower(v_search))>0 end
  ), ranked as (
    select *,row_number() over(partition by lane order by created_at,id) as row_index from filtered
  ), page as (
    select * from ranked where row_index<=p_limit
  )
  select jsonb_build_object(
    'restaurant_name',(select name from public.restaurants where id=p_restaurant_id),
    'branch_name',(select name from public.branches where id=p_branch_id and restaurant_id=p_restaurant_id),
    'generated_at',now(),'filters',jsonb_build_object('search',coalesce(v_search,''),'limit',p_limit),
    'can_service',private.qr_branch_role(p_restaurant_id,p_branch_id)='OWNER',
    'sound_enabled',coalesce((select sound_enabled from public.restaurant_settings where restaurant_id=p_restaurant_id),true),
    -- Branch-wide notification marker also covers new orders beyond the displayed page/search.
    'latest_change_number',(select max(id)::text from private.qr_kitchen_notices where restaurant_id=p_restaurant_id and branch_id=p_branch_id),'recent_changes',coalesce((select jsonb_agg(to_jsonb(n) order by n.id::bigint desc) from(select id::text,order_number,table_name,message,created_at from private.qr_kitchen_notices where restaurant_id=p_restaurant_id and branch_id=p_branch_id and created_at>now()-interval '4 hours' order by private.qr_kitchen_notices.id desc limit 20)n),'[]'::jsonb),'latest_new_number',(select max(order_number)::text from active where status='NEW'),
    'counts',jsonb_build_object('NEW',(select count(*)::text from filtered where lane='NEW'),
      'WORKING',(select count(*)::text from filtered where lane='WORKING'),
      'READY',(select count(*)::text from filtered where lane='READY')),
    'product_summary',coalesce((select jsonb_agg(jsonb_build_object('id',g.product_id,'name',g.product_name,
      'new_qty',g.new_qty::text,'accepted_qty',g.accepted_qty::text,'preparing_qty',g.preparing_qty::text,'ready_qty',g.ready_qty::text,
      'to_prepare',(g.new_qty+g.accepted_qty+g.preparing_qty)::text,'note_count',g.note_count::text) order by g.product_name,g.product_id)
      from (select i.product_id,i.product_name,
        coalesce(sum(i.quantity) filter(where f.status='NEW'),0) as new_qty,
        coalesce(sum(i.quantity) filter(where f.status='ACCEPTED'),0) as accepted_qty,
        coalesce(sum(i.quantity) filter(where f.status='PREPARING'),0) as preparing_qty,
        coalesce(sum(i.quantity) filter(where f.status='READY'),0) as ready_qty,
        count(distinct f.id) filter(where nullif(btrim(f.note),'') is not null) as note_count
        from filtered f join public.qr_order_items i on i.quantity>0 and i.order_id=f.id and i.restaurant_id=p_restaurant_id and i.branch_id=p_branch_id
        group by i.product_id,i.product_name) g),'[]'::jsonb),
    'orders',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'number',p.order_number::text,'status',p.status,'version',p.version,'lane',p.lane,
      'table_id',p.table_id,'table_number',p.table_number,'table_name',p.table_name,
      'note',p.note,'created_at',p.created_at,'updated_at',p.updated_at,
      'changed_at',(select max(created_at) from private.qr_item_changes where order_id=p.id),'changes',coalesce((select jsonb_agg(jsonb_build_object('name',ii.product_name,'old_quantity',ch.old_quantity,'quantity',ch.new_quantity,'reason',ch.reason,'at',ch.created_at) order by ch.created_at,ch.id) from private.qr_item_changes ch join public.qr_order_items ii on ii.id=ch.item_id where ch.order_id=p.id),'[]'::jsonb),'items',coalesce((select jsonb_agg(jsonb_build_object('name',i.product_name,'quantity',i.quantity::text) order by i.id)
        from public.qr_order_items i where i.quantity>0 and i.order_id=p.id and i.restaurant_id=p_restaurant_id and i.branch_id=p_branch_id),'[]'::jsonb)
    ) order by p.created_at,p.id) from page p),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

create or replace function public.owner_account_detail(p_restaurant_id uuid,p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_session public.qr_dining_sessions;v_result jsonb;
begin
  perform private.require_owner_panel(p_restaurant_id);
  select * into v_session from public.qr_dining_sessions where id=p_session_id and restaurant_id=p_restaurant_id and status='CLOSED';
  if not found then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  select jsonb_build_object('restaurant_name',(select name from public.restaurants where id=p_restaurant_id),
    'totals',private.qr_account_totals(v_session.id),'account',private.owner_account_json(v_session),'orders',coalesce((select jsonb_agg(jsonb_build_object(
      'id',o.id,'number',o.order_number::text,'status',o.status,'total',o.total_amount::text,'currency',o.currency,'note',o.note,'created_at',o.created_at,
      'changes',private.qr_order_json(o.id)->'changes','items',coalesce((select jsonb_agg(jsonb_build_object('name',product_name,'price',unit_price::text,'quantity',quantity,'total',line_total::text) order by id)
        from public.qr_order_items where order_id=o.id and restaurant_id=p_restaurant_id),'[]'::jsonb),
      'events',coalesce((select jsonb_agg(jsonb_build_object('status',e.status,'at',e.created_at,'actor_name',coalesce(nullif(btrim(p.full_name),''),'Sistem')) order by e.created_at,e.id)
        from public.qr_order_events e left join public.profiles p on p.id=e.actor_id where e.order_id=o.id and e.restaurant_id=p_restaurant_id),'[]'::jsonb)
      ) order by o.created_at,o.order_number) from public.qr_orders o where o.session_id=p_session_id and o.restaurant_id=p_restaurant_id),'[]'::jsonb)) into v_result;
  return v_result;
end $$;

create or replace function private.owner_event_json(p_log public.audit_logs)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor text; v_role text; v_branch text; v_name text; v_table text; v_number text; v_currency text; v_kind text;
begin
  select nullif(btrim(full_name),'') into v_actor from public.profiles where id=p_log.actor_id;
  if p_log.actor_id is null then
    v_actor:=case when p_log.action in ('qr.order_created','qr.service_requested','qr.bill_payment_selected','order.created') then 'Müştəri' else 'Sistem' end;
  else
    v_role:=case when exists(select 1 from public.platform_admins where user_id=p_log.actor_id) then 'Platforma admini'
      when exists(select 1 from public.restaurant_members where restaurant_id=p_log.restaurant_id and user_id=p_log.actor_id and role='RESTAURANT_ADMIN') then 'Restoran sahibi'
      when exists(select 1 from public.restaurant_members where restaurant_id=p_log.restaurant_id and user_id=p_log.actor_id and role='STAFF') then 'İşçi'
      else 'İstifadəçi' end;
    v_actor:=coalesce(v_actor,v_role);
  end if;
  select name into v_branch from public.branches where id=p_log.branch_id and restaurant_id=p_log.restaurant_id;
  if p_log.entity_type in ('qr_orders','qr_order') then
    select o.order_number::text,s.table_name,o.currency into v_number,v_table,v_currency
      from public.qr_orders o join public.qr_dining_sessions s on s.id=o.session_id and s.restaurant_id=o.restaurant_id
      where o.id=p_log.entity_id and o.restaurant_id=p_log.restaurant_id;
  elsif p_log.entity_type in ('qr_service_requests','qr_service') then
    select s.table_name,c.kind into v_table,v_kind from public.qr_service_requests c
      join public.qr_dining_sessions s on s.id=c.session_id and s.restaurant_id=c.restaurant_id
      where c.id=p_log.entity_id and c.restaurant_id=p_log.restaurant_id;
  elsif p_log.entity_type in ('qr_close','qr_clear','qr_reopen','qr_session') then
    select s.table_name,p.currency into v_table,v_currency from public.qr_dining_sessions s left join public.qr_payments p on p.session_id=s.id and p.restaurant_id=s.restaurant_id where s.id=p_log.entity_id and s.restaurant_id=p_log.restaurant_id;
  elsif p_log.entity_type='orders' then
    select order_number::text,table_name,currency into v_number,v_table,v_currency from public.orders where id=p_log.entity_id and restaurant_id=p_log.restaurant_id;
  elsif p_log.entity_type='restaurant_members' then
    select p.full_name into v_name from public.restaurant_members m join public.profiles p on p.id=m.user_id
      where m.id=p_log.entity_id and m.restaurant_id=p_log.restaurant_id;
  elsif p_log.entity_type='branch_product_settings' then
    select p.name into v_name from public.branch_product_settings b join public.products p on p.id=b.product_id and p.restaurant_id=b.restaurant_id
      where b.id=p_log.entity_id and b.restaurant_id=p_log.restaurant_id;
  end if;
  return jsonb_build_object('id',p_log.id,'created_at',p_log.created_at,'action',p_log.action,'entity_type',p_log.entity_type,
    'category',private.owner_event_category(p_log.action,p_log.entity_type),'actor_name',v_actor,'actor_role',v_role,
    'branch_name',v_branch,'name',coalesce(p_log.details->>'name',nullif(v_name,'')),
    'table_name',v_table,'order_number',v_number,'currency',v_currency,
    'details',jsonb_strip_nulls(jsonb_build_object(
      'reason',p_log.details->'reason','from_table',p_log.details->'from_table','to_table',p_log.details->'to_table','discount',p_log.details->'discount','service_percent',p_log.details->'service_percent','label',p_log.details->'label','status',p_log.details->'status','from_status',p_log.details->'from_status','to_status',p_log.details->'to_status',
      'kind',coalesce(p_log.details->'kind',to_jsonb(v_kind)),'payment_method',p_log.details->'payment_method',
      'staff_kind',p_log.details->'staff_kind','old_staff_kind',p_log.details->'old_staff_kind',
      'is_active',p_log.details->'is_active','is_available',p_log.details->'is_available','is_visible',p_log.details->'is_visible',
      'base_price',p_log.details->'base_price','price_override',p_log.details->'price_override','sort_order',p_log.details->'sort_order',
      'cash_amount',p_log.details->'cash_amount','card_amount',p_log.details->'card_amount','receipt_number',p_log.details->'receipt_number',
      'count',p_log.details->'count','source',p_log.details->'source','old_status',p_log.details->'old_status',
      'total',p_log.details->'total','table_number',p_log.details->'table_number',
      'allowed_radius_meters',p_log.details->'allowed_radius_meters',
      'created_products',p_log.details->'products_created','updated_products',p_log.details->'products_updated','created_categories',p_log.details->'categories_created','skipped_products',p_log.details->'products_skipped',
      'old_branch_name',(select name from public.branches where restaurant_id=p_log.restaurant_id and id::text=p_log.details->>'old_branch_id'),
      'branch_name',(select name from public.branches where restaurant_id=p_log.restaurant_id and id::text=p_log.details->>'branch_id')
    )));
end $$;

create or replace function private.owner_account_json(p_session public.qr_dining_sessions)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_payment public.qr_payments;v_total numeric;v_currency text;v_served integer;v_orders integer;v_items bigint;v_branch text;
begin
  select * into v_payment from public.qr_payments where session_id=p_session.id and restaurant_id=p_session.restaurant_id;
  select count(*),count(*) filter(where status='SERVED'),coalesce(sum(total_amount) filter(where status='SERVED'),0),min(currency)
    into v_orders,v_served,v_total,v_currency from public.qr_orders where session_id=p_session.id and restaurant_id=p_session.restaurant_id;
  select coalesce(sum(i.quantity),0) into v_items from public.qr_order_items i join public.qr_orders o on o.id=i.order_id
    where o.session_id=p_session.id and o.restaurant_id=p_session.restaurant_id and o.status='SERVED';
  select name into v_branch from public.branches where id=p_session.branch_id and restaurant_id=p_session.restaurant_id;
  return jsonb_build_object('branch_id',p_session.branch_id,'totals',private.qr_account_totals(p_session.id),'id',p_session.id,'branch_name',coalesce(v_payment.branch_name,v_branch),'table_name',p_session.table_name,
    'table_number',p_session.table_number,'opened_at',p_session.opened_at,'closed_at',p_session.closed_at,
    'kind',case when v_payment.id is not null then 'PAID' when v_served>0 then 'LEGACY' else 'EMPTY' end,
    'order_count',v_orders,'item_count',v_items,'total',coalesce(v_payment.total_amount,v_total)::text,'currency',coalesce(v_payment.currency,v_currency,'AZN'),
    'payment',case when v_payment.id is null then null else jsonb_build_object('number',v_payment.receipt_number::text,'method',v_payment.payment_method,
      'cash',v_payment.cash_amount::text,'card',v_payment.card_amount::text,'actor_name',v_payment.actor_name,'actor_role',v_payment.actor_role,'paid_at',v_payment.paid_at) end);
end $$;

create or replace function public.owner_sales_report(p_restaurant_id uuid,p_branch_id uuid default null,p_from date default null,p_to date default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_day date:=(now() at time zone 'Asia/Baku')::date;v_from date:=coalesce(p_from,v_day);v_to date:=coalesce(p_to,v_day);
  v_start timestamptz;v_end timestamptz;v_result jsonb;
begin
  perform private.require_owner_panel(p_restaurant_id);
  if p_branch_id is not null and not exists(select 1 from public.branches where id=p_branch_id and restaurant_id=p_restaurant_id) then
    raise exception using errcode='42501',message='FORBIDDEN';
  end if;
  if v_from<date '0001-01-01' or v_to>date '9999-12-31' or v_to<v_from or v_to-v_from>365 then raise exception 'INVALID_FILTER'; end if;
  v_start:=v_from::timestamp at time zone 'Asia/Baku';v_end:=(v_to+1)::timestamp at time zone 'Asia/Baku';
  with closed as materialized (
    select s.id,s.branch_id,s.closed_at,(s.closed_at at time zone 'Asia/Baku')::date as day
    from public.qr_dining_sessions s where s.restaurant_id=p_restaurant_id and s.status='CLOSED' and s.closed_at>=v_start and s.closed_at<v_end
      and (p_branch_id is null or s.branch_id=p_branch_id)
  ), items as materialized (
    select s.id as session_id,s.branch_id,s.day,s.closed_at,o.created_at,o.currency,i.id as item_id,i.product_id,i.product_name,i.quantity,i.line_total
    from closed s join public.qr_orders o on o.session_id=s.id and o.restaurant_id=p_restaurant_id and o.status='SERVED'
      join public.qr_order_items i on i.quantity>0 and i.order_id=o.id and i.restaurant_id=p_restaurant_id
  ), orders as (
    select s.id as session_id,o.currency,sum(o.total_amount) as total
    from closed s join public.qr_orders o on o.session_id=s.id and o.restaurant_id=p_restaurant_id and o.status='SERVED' group by s.id,o.currency
  ), quantities as (select session_id,currency,sum(quantity) as quantity from items group by session_id,currency), accounts as materialized (
    -- A recorded payment is one account. Legacy totals are grouped by currency defensively.
    select s.id,s.branch_id,s.day,p.currency,true as recorded,p.total_amount as total,p.cash_amount as cash,p.card_amount as card,coalesce(q.quantity,0) as quantity
    from closed s join public.qr_payments p on p.session_id=s.id and p.restaurant_id=p_restaurant_id
      left join quantities q on q.session_id=s.id and q.currency=p.currency
    union all
    select s.id,s.branch_id,s.day,o.currency,false,o.total,0::numeric,0::numeric,coalesce(q.quantity,0)
    from closed s join orders o on o.session_id=s.id left join quantities q on q.session_id=s.id and q.currency=o.currency
    where not exists(select 1 from public.qr_payments where session_id=s.id and restaurant_id=p_restaurant_id)
  ), metrics as materialized (
    select branch_id,day,currency,
      count(*) filter(where recorded) as recorded_count,coalesce(sum(total) filter(where recorded),0) as recorded_total,
      coalesce(sum(cash) filter(where recorded),0) as cash,coalesce(sum(card) filter(where recorded),0) as card,
      coalesce(sum(quantity) filter(where recorded),0) as quantity,
      count(*) filter(where not recorded) as legacy_count,coalesce(sum(total) filter(where not recorded),0) as legacy_total,
      coalesce(sum(quantity) filter(where not recorded),0) as legacy_quantity
    from accounts group by branch_id,day,currency
  ), totals as (
    select currency,sum(recorded_count)::text as count,sum(recorded_total)::text as total,sum(cash)::text as cash,sum(card)::text as card,
      round(coalesce(sum(recorded_total)/nullif(sum(recorded_count),0),0),2)::text as average,sum(quantity)::text as quantity,
      sum(legacy_count)::text as legacy_count,sum(legacy_total)::text as legacy_total,sum(legacy_quantity)::text as legacy_quantity
    from metrics group by currency
  ), branch_metrics as (
    select b.id,b.name,b.is_active,m.currency,coalesce(sum(m.recorded_count),0)::text as count,coalesce(sum(m.recorded_total),0)::text as total,
      coalesce(sum(m.cash),0)::text as cash,coalesce(sum(m.card),0)::text as card,
      round(coalesce(sum(m.recorded_total)/nullif(sum(m.recorded_count),0),0),2)::text as average,coalesce(sum(m.quantity),0)::text as quantity,
      coalesce(sum(m.legacy_count),0)::text as legacy_count,coalesce(sum(m.legacy_total),0)::text as legacy_total,coalesce(sum(m.legacy_quantity),0)::text as legacy_quantity
    from public.branches b left join metrics m on m.branch_id=b.id
    where b.restaurant_id=p_restaurant_id and (p_branch_id is null or b.id=p_branch_id) group by b.id,b.name,b.is_active,m.currency
  ), daily as (
    select day,currency,sum(recorded_count)::text as count,sum(recorded_total)::text as total,sum(cash)::text as cash,sum(card)::text as card,
      sum(quantity)::text as quantity,sum(legacy_count)::text as legacy_count,sum(legacy_total)::text as legacy_total,sum(legacy_quantity)::text as legacy_quantity
    from metrics group by day,currency
  ), products as (
    select i.product_id as id,i.currency,
      (array_agg(i.product_name order by i.closed_at desc,i.created_at desc,i.item_id desc))[1] as name,
      coalesce(sum(i.quantity) filter(where p.id is not null),0)::text as quantity,
      coalesce(sum(i.line_total) filter(where p.id is not null),0)::text as total,
      count(distinct i.session_id) filter(where p.id is not null)::text as account_count,
      coalesce(sum(i.quantity) filter(where p.id is null),0)::text as legacy_quantity,
      coalesce(sum(i.line_total) filter(where p.id is null),0)::text as legacy_total,
      count(distinct i.session_id) filter(where p.id is null)::text as legacy_account_count
    from items i left join public.qr_payments p on p.session_id=i.session_id and p.restaurant_id=p_restaurant_id
    group by i.product_id,i.currency
  )
  select jsonb_build_object('restaurant_name',(select name from public.restaurants where id=p_restaurant_id),
    'day',v_day,'timezone','Asia/Baku','generated_at',now(),
    'filters',jsonb_build_object('branch_id',p_branch_id,'from',v_from,'to',v_to),
    'branches',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'is_active',is_active) order by name,id) from public.branches where restaurant_id=p_restaurant_id),'[]'::jsonb),
    'empty_count',(select count(*)::text from closed s where not exists(select 1 from accounts a where a.id=s.id)),
    'totals',coalesce((select jsonb_agg(to_jsonb(t) order by currency) from totals t),'[]'::jsonb),
    'by_branch',coalesce((select jsonb_agg(to_jsonb(b) order by name,id,currency nulls last) from branch_metrics b),'[]'::jsonb),
    'daily',coalesce((select jsonb_agg(to_jsonb(d) order by day,currency) from daily d),'[]'::jsonb),
    'products',coalesce((select jsonb_agg(to_jsonb(p) order by (quantity::numeric) desc,(total::numeric) desc,name,id,currency)
      from (select * from products order by quantity::numeric desc,total::numeric desc,name,id,currency limit 20001) p),'[]'::jsonb)) into v_result;
  if jsonb_array_length(v_result->'products')>20000 then raise exception 'REPORT_TOO_LARGE'; end if;
  return v_result;
end $$;
create or replace function public.qr_staff_board(p_restaurant_id uuid,p_branch_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN';end if;
 return jsonb_build_object('can_prepare',private.qr_branch_role(p_restaurant_id,p_branch_id)='OWNER','viewer_role',private.qr_branch_role(p_restaurant_id,p_branch_id),'sound_enabled',coalesce((select sound_enabled from public.restaurant_settings where restaurant_id=p_restaurant_id),true),
 'tables',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'number',t.table_number,'busy',exists(select 1 from public.qr_dining_sessions s where s.table_id=t.id and s.status<>'CLOSED')) order by t.table_number) from public.tables t where t.restaurant_id=p_restaurant_id and t.branch_id=p_branch_id and t.is_active),'[]'::jsonb),
 'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'table_id',s.table_id,'status',s.status,'version',s.version,'table_name',s.table_name,'table_number',s.table_number,'opened_at',s.opened_at,
 'total',(a.tot->>'total')::numeric,'payment_total',a.tot->>'remaining','currency',a.tot->>'currency','totals',a.tot,
 'parts',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'label',p.label,'cash',p.cash_amount::text,'card',p.card_amount::text,'at',p.created_at) order by p.created_at,p.id) from private.qr_payment_parts p where p.session_id=s.id),'[]'::jsonb),
 'orders',coalesce((select jsonb_agg(private.qr_order_json(o.id) order by o.created_at) from public.qr_orders o where o.session_id=s.id),'[]'::jsonb),
 'services',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'payment_method',c.payment_method,'status',c.status,'version',c.version,'created_at',c.created_at) order by c.created_at) from public.qr_service_requests c where c.session_id=s.id and c.status<>'DONE'),'[]'::jsonb)) order by s.table_number)
 from public.qr_dining_sessions s cross join lateral(select private.qr_account_totals(s.id) as tot) a where s.restaurant_id=p_restaurant_id and s.branch_id=p_branch_id and s.status<>'CLOSED'),'[]'::jsonb));
end $$;

create or replace function public.qr_account_receipt(p_restaurant_id uuid,p_branch_id uuid,p_session_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.qr_dining_sessions;p public.qr_payments;
begin
 if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN';end if;
 select * into s from public.qr_dining_sessions where id=p_session_id and restaurant_id=p_restaurant_id and branch_id=p_branch_id;
 if not found then raise exception using errcode='42501',message='FORBIDDEN';end if;
 select * into p from public.qr_payments where session_id=s.id;
 return jsonb_build_object('restaurant_name',(select name from public.restaurants where id=p_restaurant_id),'branch_name',(select name from public.branches where id=p_branch_id),'session',jsonb_build_object('id',s.id,'status',s.status,'table_name',s.table_name,'opened_at',s.opened_at,'closed_at',s.closed_at),
 'totals',private.qr_account_totals(s.id),'number',p.receipt_number::text,'payment',case when p.id is null then null else jsonb_build_object('method',p.payment_method,'cash',p.cash_amount::text,'card',p.card_amount::text,'total',p.total_amount::text,'at',p.paid_at) end,
 'parts',coalesce((select jsonb_agg(jsonb_build_object('label',pp.label,'cash',pp.cash_amount::text,'card',pp.card_amount::text,'at',pp.created_at) order by pp.created_at,pp.id) from private.qr_payment_parts pp where pp.session_id=s.id),'[]'::jsonb),
 'orders',coalesce((select jsonb_agg(private.qr_order_json(o.id) order by o.created_at) from public.qr_orders o where o.session_id=s.id),'[]'::jsonb));
end $$;

-- No anonymous or service caller can use the new operational mutations or private helpers.
do $$ declare f record;begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in('qr_original_quantity','qr_account_totals','qr_revision_replay','qr_accept_payment','qr_clear_move_tokens') loop execute 'revoke all on function '||f.sig||' from public,anon,authenticated,service_role';end loop;
end $$;
revoke all on function public.qr_adjust_order(uuid,uuid,uuid,integer,uuid,jsonb,text),public.qr_transfer_table(uuid,uuid,uuid,integer,uuid,uuid),public.qr_adjust_bill(uuid,uuid,uuid,integer,text,text,text,uuid),public.qr_pay_part(uuid,uuid,uuid,integer,uuid,text,text,text,text,text,text),public.qr_account_receipt(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.qr_adjust_order(uuid,uuid,uuid,integer,uuid,jsonb,text),public.qr_transfer_table(uuid,uuid,uuid,integer,uuid,uuid),public.qr_adjust_bill(uuid,uuid,uuid,integer,text,text,text,uuid),public.qr_pay_part(uuid,uuid,uuid,integer,uuid,text,text,text,text,text,text),public.qr_account_receipt(uuid,uuid,uuid) to authenticated;
create or replace function public.owner_live_tables(
  p_restaurant_id uuid, p_branch_id uuid default null, p_view text default 'ALL',
  p_search text default null, p_limit integer default 30
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_search text := nullif(btrim(p_search),'');
  v_result jsonb;
begin
  perform private.require_owner_panel(p_restaurant_id);
  if p_branch_id is not null and not exists(
    select 1 from public.branches where id=p_branch_id and restaurant_id=p_restaurant_id
  ) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if p_view is null or p_view not in ('ALL','OPEN','NEW','WORKING','READY','BILL','WAITER','FREE')
    or p_limit is null or p_limit<30 or p_limit>300 or p_limit%30<>0
    or char_length(coalesce(v_search,''))>80
  then raise exception 'INVALID_LIVE_FILTER'; end if;

  with base as materialized (
    select t.id,t.branch_id,coalesce(s.table_name,nullif(btrim(t.name),''),'Masa '||t.table_number::text) as name,
      coalesce(s.table_number,t.table_number) as number,t.is_active,
      b.name as branch_name,b.is_active as branch_active,b.accepting_orders,
      s.id as session_id,s.status as session_status,s.opened_at
    from public.tables t join public.branches b on b.id=t.branch_id and b.restaurant_id=t.restaurant_id
      left join public.qr_dining_sessions s on s.table_id=t.id and s.restaurant_id=t.restaurant_id
        and s.branch_id=t.branch_id and s.status<>'CLOSED'
    where t.restaurant_id=p_restaurant_id and (t.is_active or s.id is not null)
      and (p_branch_id is null or t.branch_id=p_branch_id)
      and (v_search is null or case when v_search~'^[0-9]+$'
        then coalesce(s.table_number,t.table_number)::numeric=v_search::numeric
        else strpos(lower(coalesce(s.table_name,nullif(btrim(t.name),''),'Masa '||t.table_number::text)),lower(v_search))>0 end)
  ), orders as materialized (
    select o.session_id,o.status,o.currency,o.total_amount,o.created_at
    from public.qr_orders o join base b on b.session_id=o.session_id
    where o.restaurant_id=p_restaurant_id and o.branch_id=b.branch_id and o.table_id=b.id
  ), counts as (
    select session_id,count(*)::text as all_orders,
      count(*) filter(where status='NEW')::text as new_orders,
      count(*) filter(where status in ('ACCEPTED','PREPARING'))::text as working_orders,
      count(*) filter(where status='READY')::text as ready_orders,
      count(*) filter(where status='SERVED')::text as served_orders,
      count(*) filter(where status='CANCELLED')::text as cancelled_orders,
      min(created_at) filter(where status not in ('SERVED','CANCELLED')) as oldest_order_at
    from orders group by session_id
  ), amounts as (
    select session_id,currency,private.qr_account_totals(session_id)->>'total' as total
    from orders where status<>'CANCELLED' group by session_id,currency
  ), services as materialized (
    select c.session_id,c.kind,c.status,c.payment_method,c.created_at
    from public.qr_service_requests c join base b on b.session_id=c.session_id
    where c.restaurant_id=p_restaurant_id and c.branch_id=b.branch_id and c.table_id=b.id and c.status<>'DONE'
  ), calls as (
    select session_id,bool_or(kind='WAITER') as waiter,
      min(created_at) filter(where kind='WAITER') as waiter_at,
      min(created_at) filter(where kind='BILL') as bill_at,
      jsonb_agg(jsonb_build_object('kind',kind,'status',status,'method',payment_method,'created_at',created_at)
        order by created_at,kind) as services
    from services group by session_id
  ), states as materialized (
    select b.*,coalesce(c.all_orders,'0') as all_orders,coalesce(c.new_orders,'0') as new_orders,
      coalesce(c.working_orders,'0') as working_orders,coalesce(c.ready_orders,'0') as ready_orders,
      coalesce(c.served_orders,'0') as served_orders,coalesce(c.cancelled_orders,'0') as cancelled_orders,
      c.oldest_order_at,coalesce(k.waiter,false) as waiter,k.waiter_at,k.bill_at,
      coalesce(k.services,'[]'::jsonb) as services,
      coalesce((select jsonb_agg(jsonb_build_object('currency',a.currency,'total',a.total) order by a.currency)
        from amounts a where a.session_id=b.session_id),'[]'::jsonb) as amounts
    from base b left join counts c on c.session_id=b.session_id left join calls k on k.session_id=b.session_id
  ), filtered as materialized (
    select * from states where case p_view
      when 'ALL' then true when 'OPEN' then session_id is not null
      when 'NEW' then new_orders::bigint>0 when 'WORKING' then working_orders::bigint>0
      when 'READY' then ready_orders::bigint>0 when 'BILL' then session_status='BILL_REQUESTED'
      when 'WAITER' then waiter when 'FREE' then session_id is null else false end
  ), page as (
    -- Stable table order: status changes do not make cards jump between positions.
    select * from filtered order by branch_name,branch_id,number,id limit p_limit
  )
  select jsonb_build_object(
    'restaurant_name',(select name from public.restaurants where id=p_restaurant_id),'generated_at',now(),
    'filters',jsonb_build_object('branch_id',p_branch_id,'view',p_view,'search',coalesce(v_search,''),'limit',p_limit),
    'branches',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'is_active',is_active) order by name,id)
      from public.branches where restaurant_id=p_restaurant_id),'[]'::jsonb),
    'summary',jsonb_build_object(
      'ALL',(select count(*)::text from states),'OPEN',(select count(*)::text from states where session_id is not null),
      'NEW',(select count(*)::text from states where new_orders::bigint>0),
      'WORKING',(select count(*)::text from states where working_orders::bigint>0),
      'READY',(select count(*)::text from states where ready_orders::bigint>0),
      'BILL',(select count(*)::text from states where session_status='BILL_REQUESTED'),
      'WAITER',(select count(*)::text from states where waiter),'FREE',(select count(*)::text from states where session_id is null)
    ),
    'matched_count',(select count(*)::text from filtered),
    'has_more',(select count(*)>p_limit from filtered),
    'tables',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'name',name,'number',number,'is_active',is_active,'branch_id',branch_id,'branch_name',branch_name,
      'branch_active',branch_active,'accepting_orders',accepting_orders,'session_id',session_id,
      'session_status',session_status,'opened_at',opened_at,'oldest_order_at',oldest_order_at,
      'waiter_at',waiter_at,'bill_at',bill_at,'services',services,'amounts',amounts,
      'orders',jsonb_build_object('all',all_orders,'new',new_orders,'working',working_orders,'ready',ready_orders,
        'served',served_orders,'cancelled',cancelled_orders)
    ) order by branch_name,branch_id,number,id) from page),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

create or replace function public.owner_live_table_detail(
  p_restaurant_id uuid,p_table_id uuid,p_mode text default 'ACTIVE',p_limit integer default 30
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_table public.tables;v_session public.qr_dining_sessions;v_result jsonb;
begin
  perform private.require_owner_panel(p_restaurant_id);
  select * into v_table from public.tables where id=p_table_id and restaurant_id=p_restaurant_id;
  if not found then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if p_mode is null or p_mode not in ('ACTIVE','ALL') or p_limit is null
    or p_limit<30 or p_limit>300 or p_limit%30<>0 then raise exception 'INVALID_LIVE_FILTER'; end if;
  select * into v_session from public.qr_dining_sessions where table_id=v_table.id and restaurant_id=p_restaurant_id
    and branch_id=v_table.branch_id and status<>'CLOSED';
  with orders as materialized (
    select id,order_number::text as number,status,total_amount::text as total,currency,note,created_at
    from public.qr_orders where session_id=v_session.id and restaurant_id=p_restaurant_id
      and branch_id=v_table.branch_id and table_id=v_table.id
  ), filtered as materialized (
    select * from orders where p_mode='ALL' or status not in ('SERVED','CANCELLED')
  ), page as (
    select * from filtered order by created_at,id limit p_limit
  ), amounts as (
    select currency,private.qr_account_totals(v_session.id)->>'total' as total from orders where status<>'CANCELLED' group by currency
  )
  select jsonb_build_object(
    'restaurant_name',(select name from public.restaurants where id=p_restaurant_id),'generated_at',now(),
    'filters',jsonb_build_object('mode',p_mode,'limit',p_limit),
    'table',jsonb_build_object('id',v_table.id,'name',coalesce(v_session.table_name,nullif(btrim(v_table.name),''),'Masa '||v_table.table_number::text),
      'number',coalesce(v_session.table_number,v_table.table_number),'is_active',v_table.is_active,
      'branch_id',v_table.branch_id,'branch_name',(select name from public.branches where id=v_table.branch_id and restaurant_id=p_restaurant_id),
      'branch_active',(select is_active from public.branches where id=v_table.branch_id and restaurant_id=p_restaurant_id),
      'accepting_orders',(select accepting_orders from public.branches where id=v_table.branch_id and restaurant_id=p_restaurant_id)),
    'session',case when v_session.id is null then null else jsonb_build_object(
      'id',v_session.id,'status',v_session.status,'opened_at',v_session.opened_at,
      'counts',jsonb_build_object('all',(select count(*)::text from orders),
        'active',(select count(*)::text from orders where status not in ('SERVED','CANCELLED')),
        'served',(select count(*)::text from orders where status='SERVED'),
        'cancelled',(select count(*)::text from orders where status='CANCELLED')),
      'amounts',coalesce((select jsonb_agg(to_jsonb(a) order by currency) from amounts a),'[]'::jsonb),
      'services',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'status',status,'method',payment_method,'created_at',created_at) order by created_at,kind)
        from public.qr_service_requests where session_id=v_session.id and restaurant_id=p_restaurant_id
          and branch_id=v_table.branch_id and table_id=v_table.id and status<>'DONE'),'[]'::jsonb)
    ) end,
    'matched_count',(select count(*)::text from filtered),'has_more',(select count(*)>p_limit from filtered),
    'orders',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'number',p.number,'status',p.status,'total',p.total,'currency',p.currency,'note',p.note,'created_at',p.created_at,
      'items',coalesce((select jsonb_agg(jsonb_build_object('name',i.product_name,'quantity',i.quantity::text,
        'price',i.unit_price::text,'total',i.line_total::text) order by i.id)
        from public.qr_order_items i where i.order_id=p.id and i.restaurant_id=p_restaurant_id and i.branch_id=v_table.branch_id),'[]'::jsonb)
    ) order by p.created_at,p.id) from page p),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

create or replace function public.owner_dashboard(p_restaurant_id uuid,p_branch_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_today date:=(now() at time zone 'Asia/Baku')::date; v_start timestamptz; v_end timestamptz; v_currency text; v_result jsonb;
begin
  perform private.require_owner_panel(p_restaurant_id);
  if p_branch_id is not null and not exists(select 1 from public.branches where id=p_branch_id and restaurant_id=p_restaurant_id) then
    raise exception using errcode='42501',message='FORBIDDEN';
  end if;
  v_start:=v_today::timestamp at time zone 'Asia/Baku';v_end:=(v_today+1)::timestamp at time zone 'Asia/Baku';
  select currency into v_currency from public.restaurant_settings where restaurant_id=p_restaurant_id;
  v_currency:=coalesce(v_currency,'AZN');
  with today_orders as (
    select branch_id,count(*) as n,count(*) filter(where status='CANCELLED') as cancelled
    from public.qr_orders where restaurant_id=p_restaurant_id and created_at>=v_start and created_at<v_end group by branch_id
  ), working as (
    select o.branch_id,count(*) filter(where o.status='NEW') as fresh,
      count(*) filter(where o.status in ('ACCEPTED','PREPARING','READY')) as preparing
    from public.qr_orders o join public.qr_dining_sessions s on s.id=o.session_id and s.restaurant_id=o.restaurant_id
    where o.restaurant_id=p_restaurant_id and s.status<>'CLOSED' and o.status in ('NEW','ACCEPTED','PREPARING','READY') group by o.branch_id
  ), open_tables as (
    select s.branch_id,count(*) as n from public.qr_dining_sessions s where s.restaurant_id=p_restaurant_id and s.status<>'CLOSED'
      and exists(select 1 from public.qr_orders where session_id=s.id and status<>'CANCELLED') group by s.branch_id
  ), calls as (
    select c.branch_id,count(*) as n,count(*) filter(where c.kind='BILL') as bills
    from public.qr_service_requests c join public.qr_dining_sessions s on s.id=c.session_id and s.restaurant_id=c.restaurant_id
    where c.restaurant_id=p_restaurant_id and c.status<>'DONE' and s.status<>'CLOSED' group by c.branch_id
  ), closed_tables as (
    select s.branch_id,count(*) as n from public.qr_dining_sessions s where s.restaurant_id=p_restaurant_id and s.status='CLOSED'
      and s.closed_at>=v_start and s.closed_at<v_end and exists(select 1 from public.qr_orders where session_id=s.id and status='SERVED') group by s.branch_id
  ), amounts as (
    select s.branch_id,o.currency,sum(o.total_amount) as total from public.qr_dining_sessions s join public.qr_orders o on o.session_id=s.id and o.restaurant_id=s.restaurant_id
    where s.restaurant_id=p_restaurant_id and s.status='CLOSED' and s.closed_at>=v_start and s.closed_at<v_end and o.status='SERVED' group by s.branch_id,o.currency
  ), tables as (
    select branch_id,count(*) as n from public.tables where restaurant_id=p_restaurant_id and is_active group by branch_id
  ), staff as (
    select m.branch_id,count(*) as n from public.restaurant_members m join public.profiles p on p.id=m.user_id
    join public.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
    where m.restaurant_id=p_restaurant_id and m.role='STAFF' and m.is_active and p.is_active and b.is_active group by m.branch_id
  ), branch_data as (
    select b.id,b.name,b.address,b.is_active,b.accepting_orders,b.allowed_radius_meters,
      coalesce(d.n,0) as today_orders,coalesce(d.cancelled,0) as cancelled_orders,coalesce(w.fresh,0) as new_orders,coalesce(w.preparing,0) as working_orders,
      coalesce(o.n,0) as open_tables,coalesce(c.n,0) as pending_calls,coalesce(c.bills,0) as pending_bills,
      coalesce(z.n,0) as closed_tables,coalesce(t.n,0) as table_count,coalesce(u.n,0) as staff_count
    from public.branches b left join today_orders d on d.branch_id=b.id left join working w on w.branch_id=b.id
      left join open_tables o on o.branch_id=b.id left join calls c on c.branch_id=b.id left join closed_tables z on z.branch_id=b.id
      left join tables t on t.branch_id=b.id left join staff u on u.branch_id=b.id where b.restaurant_id=p_restaurant_id
  ), selected as (select * from branch_data where p_branch_id is null or id=p_branch_id), totals as (
    select currency,sum(total) as total from amounts where p_branch_id is null or branch_id=p_branch_id group by currency
  )
  select jsonb_build_object(
    'restaurant',(select jsonb_build_object('id',id,'name',name,'slug',slug,'can_manage',is_active and status in ('active','trial')) from public.restaurants where id=p_restaurant_id),
    'day',v_today,'timezone','Asia/Baku','refreshed_at',now(),'branch_id',p_branch_id,
    'totals',jsonb_build_object('today_orders',coalesce(sum(today_orders),0),'cancelled_orders',coalesce(sum(cancelled_orders),0),
      'new_orders',coalesce(sum(new_orders),0),'working_orders',coalesce(sum(working_orders),0),'open_tables',coalesce(sum(open_tables),0),
      'pending_calls',coalesce(sum(pending_calls),0),'pending_bills',coalesce(sum(pending_bills),0),'closed_tables',coalesce(sum(closed_tables),0),
      'table_count',coalesce(sum(table_count),0),'staff_count',coalesce(sum(staff_count),0)),
    'closed_amounts',coalesce((select jsonb_agg(jsonb_build_object('currency',x.currency,'total',x.total) order by x.currency) from(select p.currency,sum(p.total_amount)::text as total from public.qr_payments p join public.qr_dining_sessions s on s.id=p.session_id where p.restaurant_id=p_restaurant_id and s.closed_at>=v_start and s.closed_at<v_end and (p_branch_id is null or s.branch_id=p_branch_id) group by p.currency)x),'[]'::jsonb),
    'recent_activity',coalesce((select jsonb_agg(private.owner_event_json(a) order by a.created_at desc,a.id desc) from
      (select * from public.audit_logs where restaurant_id=p_restaurant_id and (p_branch_id is null or branch_id=p_branch_id) order by created_at desc,id desc limit 5) a),'[]'::jsonb)
  ) into v_result from selected;
  return v_result;
end $$;

create table if not exists private.qr_backup_runs(id uuid primary key default gen_random_uuid(),completed_at timestamptz not null default now(),success boolean not null,files integer not null,images integer not null,total_bytes bigint not null,manifest_hash text not null);
revoke all on private.qr_backup_runs from public,anon,authenticated,service_role;
create or replace function public.platform_backup_record(p_success boolean,p_files integer,p_images integer,p_total_bytes bigint,p_manifest_hash text) returns void language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'service_role' then raise exception using errcode='42501',message='FORBIDDEN';end if;
 if p_success is null or p_files is null or p_files<0 or p_images is null or p_images<0 or p_total_bytes is null or p_total_bytes<0 or p_manifest_hash is null or p_manifest_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_BACKUP';end if;
 insert into private.qr_backup_runs(success,files,images,total_bytes,manifest_hash) values(p_success,p_files,p_images,p_total_bytes,p_manifest_hash);
end $$;
revoke all on function public.platform_backup_record(boolean,integer,integer,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.platform_backup_record(boolean,integer,integer,bigint,text) to service_role;
create or replace function public.platform_operational_health() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rls_ok boolean;b jsonb;
begin
 if not private.is_super_admin() then raise exception using errcode='42501',message='FORBIDDEN';end if;
 select coalesce(bool_and(c.relrowsecurity),false) into rls_ok from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('restaurants','branches','tables','products','qr_orders','qr_order_items','qr_dining_sessions','qr_payments');
 select to_jsonb(x) into b from(select completed_at,success,files,images,total_bytes::text from private.qr_backup_runs order by completed_at desc,id desc limit 1)x;
 return jsonb_build_object('checked_at',now(),'rls_enabled',rls_ok,'operations_version','028','last_backup',b,'open_partial_accounts',(select count(*)::text from public.qr_dining_sessions s where status<>'CLOSED' and exists(select 1 from private.qr_payment_parts p where p.session_id=s.id)));
end $$;
revoke all on function public.platform_operational_health() from public,anon,authenticated,service_role;
grant execute on function public.platform_operational_health() to authenticated;

create or replace function private.owner_event_category(p_action text,p_entity_type text)
returns text language sql immutable set search_path='' as $$
  select case
    when p_action='qr.items_adjusted' then 'ORDERS'
    when p_action in('qr.table_transferred','qr.bill_adjusted','qr.partial_paid','qr.account_paid') then 'TABLES' 
    when p_action='qr.staff_action' and p_entity_type in ('qr_close','qr_clear','qr_reopen') then 'TABLES'
    when p_action in ('qr.service_requested','qr.bill_payment_selected') or (p_action='qr.staff_action' and p_entity_type='qr_service') then 'CALLS'
    when p_action like 'qr.order_%' or p_action like 'order.%' or (p_action='qr.staff_action' and p_entity_type='qr_order') then 'ORDERS'
    when p_action like 'table.%' then 'TABLES'
    when p_action like 'category.%' or p_action like 'product.%' or p_action like 'branch_product.%' or p_action like 'menu.%' then 'MENU'
    when p_action like 'staff.%' or p_action like 'owner.%' then 'TEAM'
    when p_action like 'branch.%' then 'BRANCHES'
    when p_action like 'restaurant.%' then 'RESTAURANT'
    else 'OTHER' end;
$$;
commit;
