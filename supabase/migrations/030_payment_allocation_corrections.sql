-- 030: sahibin kart/nağd qeydini səbəb göstərərək düzəltməsi. 029-dan sonra.
-- Tam faylı bir dəfə SQL Editor-də işlət; təkrar icra məlumatı dəyişdirmir.
begin;
create table if not exists private.qr_payment_allocation_changes(
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null references public.restaurants(id),
 branch_id uuid not null references public.branches(id),
 session_id uuid not null references public.qr_dining_sessions(id),
 part_id uuid references private.qr_payment_parts(id),
 actor_id uuid references public.profiles(id) on delete set null,
 actor_name text not null,
 label text not null,
 old_cash numeric(18,2) not null check(old_cash>=0),old_card numeric(18,2) not null check(old_card>=0),
 cash numeric(18,2) not null check(cash>=0),card numeric(18,2) not null check(card>=0),
 reason text not null check(length(btrim(reason)) between 3 and 500),
 created_at timestamptz not null default now(),
 check(old_cash+old_card=cash+card)
);
create index if not exists qr_payment_allocation_session on private.qr_payment_allocation_changes(session_id,created_at desc,id desc);
alter table private.qr_payment_allocation_changes enable row level security;
revoke all on private.qr_payment_allocation_changes from public,anon,authenticated,service_role;

create or replace function private.owner_can_correct_payment(p_restaurant_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null
  and exists(select 1 from public.profiles where id=auth.uid() and is_active)
  and exists(select 1 from public.restaurants where id=p_restaurant_id and is_active and status in('active','trial'))
  and exists(select 1 from public.restaurant_members where restaurant_id=p_restaurant_id and user_id=auth.uid() and role='RESTAURANT_ADMIN' and is_active);
$$;
revoke all on function private.owner_can_correct_payment(uuid) from public,anon,authenticated,service_role;

create or replace function public.owner_payment_allocations(p_restaurant_id uuid,p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.qr_dining_sessions;p public.qr_payments;parts jsonb;changes jsonb;change_count bigint;
begin
 perform private.require_owner_panel(p_restaurant_id);
 select * into s from public.qr_dining_sessions where id=p_session_id and restaurant_id=p_restaurant_id;
 if not found then raise exception using errcode='42501',message='FORBIDDEN';end if;
 select * into p from public.qr_payments where session_id=s.id and restaurant_id=p_restaurant_id and branch_id=s.branch_id;
 select jsonb_agg(jsonb_build_object('id',id,'label',label,'cash',cash_amount::text,'card',card_amount::text,'total',(cash_amount+card_amount)::text,'at',created_at) order by created_at,id)
 into parts from private.qr_payment_parts where session_id=s.id;
 if parts is null then
  parts:=case when p.id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id',null,'label','Tam ödəniş','cash',p.cash_amount::text,'card',p.card_amount::text,'total',p.total_amount::text,'at',p.paid_at)) end;
 end if;
 select count(*) into change_count from private.qr_payment_allocation_changes where session_id=s.id;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc,x.id desc),'[]'::jsonb) into changes from (
  select id,part_id,label,actor_name,old_cash::text,old_card::text,cash::text,card::text,reason,created_at as at
  from private.qr_payment_allocation_changes where session_id=s.id order by created_at desc,id desc limit 50
 )x;
 return jsonb_build_object('user_id',auth.uid(),'session_id',s.id,'branch_id',s.branch_id,'version',s.version,'table_name',s.table_name,'status',s.status,
  'currency',coalesce(p.currency,private.qr_account_totals(s.id)->>'currency','AZN'),
  'can_correct',private.owner_can_correct_payment(p_restaurant_id),'parts',parts,'changes',changes,'change_count',change_count::text);
end $$;
revoke all on function public.owner_payment_allocations(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.owner_payment_allocations(uuid,uuid) to authenticated;

create or replace function public.owner_correct_payment_allocation(
 p_restaurant_id uuid,p_session_id uuid,p_part_id uuid,p_version integer,p_request_id uuid,p_cash text,p_card text,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.qr_dining_sessions;p public.qr_payments;part private.qr_payment_parts;
 cash numeric;card numeric;old_cash numeric;old_card numeric;all_cash numeric;all_card numeric;target_total numeric;label text;actor text;cur text;payload jsonb;replay boolean;
begin
 if not private.owner_can_correct_payment(p_restaurant_id) then raise exception using errcode='42501',message='FORBIDDEN';end if;
 if p_version is null or p_version<1 or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'INVALID_CORRECTION';end if;
 cash:=private.qr_payment_amount(p_cash);card:=private.qr_payment_amount(p_card);
 payload:=jsonb_build_object('kind','PAYMENT_ALLOCATION','restaurant',p_restaurant_id,'session',p_session_id,'part',p_part_id,'version',p_version,'cash',cash,'card',card,'reason',btrim(p_reason));
 replay:=private.qr_revision_replay(p_request_id,payload);
 select * into s from public.qr_dining_sessions where id=p_session_id and restaurant_id=p_restaurant_id for update;
 if not found or not private.owner_can_correct_payment(p_restaurant_id) then raise exception using errcode='42501',message='FORBIDDEN';end if;
 if replay then return public.owner_payment_allocations(p_restaurant_id,p_session_id);end if;
 if s.version is distinct from p_version then raise exception 'STALE_VERSION';end if;
 select * into p from public.qr_payments where session_id=s.id and restaurant_id=p_restaurant_id and branch_id=s.branch_id for update;
 if p_part_id is not null then
  select * into part from private.qr_payment_parts where id=p_part_id and session_id=s.id for update;
  if not found then raise exception 'INVALID_PAYMENT_PART';end if;
  old_cash:=part.cash_amount;old_card:=part.card_amount;label:=coalesce(nullif(part.label,''),'Ödəniş hissəsi');
 else
  if p.id is null or s.status<>'CLOSED' or exists(select 1 from private.qr_payment_parts where session_id=s.id) then raise exception 'INVALID_PAYMENT_PART';end if;
  old_cash:=p.cash_amount;old_card:=p.card_amount;label:='Tam ödəniş';
 end if;
 target_total:=old_cash+old_card;
 if target_total=0 then raise exception 'NO_PAYABLE_PART';end if;
 if cash+card<>target_total then raise exception 'CORRECTION_TOTAL_CHANGED';end if;
 if cash=old_cash and card=old_card then raise exception 'NO_CHANGES';end if;
 if s.status='CLOSED' and p.id is null or s.status<>'CLOSED' and p.id is not null then raise exception 'INVALID_PAYMENT_STATE';end if;
 select coalesce(nullif(btrim(full_name),''),'Restoran sahibi') into actor from public.profiles where id=auth.uid();
 cur:=coalesce(p.currency,private.qr_account_totals(s.id)->>'currency','AZN');
 insert into private.qr_payment_allocation_changes(restaurant_id,branch_id,session_id,part_id,actor_id,actor_name,label,old_cash,old_card,cash,card,reason)
 values(p_restaurant_id,s.branch_id,s.id,p_part_id,auth.uid(),actor,label,old_cash,old_card,cash,card,btrim(p_reason));
 if p_part_id is not null then
  update private.qr_payment_parts set cash_amount=cash,card_amount=card where id=part.id;
 end if;
 if p.id is not null then
  if p_part_id is null then all_cash:=cash;all_card:=card;
  else select sum(cash_amount),sum(card_amount) into all_cash,all_card from private.qr_payment_parts where session_id=s.id;end if;
  if all_cash+all_card<>p.total_amount then raise exception 'INVALID_PAYMENT_STATE';end if;
  update public.qr_payments set cash_amount=all_cash,card_amount=all_card,
   payment_method=case when all_cash>0 and all_card>0 then 'MIXED' when all_card>0 then 'CARD' else 'CASH' end
  where id=p.id;
 end if;
 update public.qr_dining_sessions set version=version+1 where id=s.id;
 insert into public.audit_logs(restaurant_id,branch_id,actor_id,action,entity_type,entity_id,details)
 values(p_restaurant_id,s.branch_id,auth.uid(),'qr.payment_corrected','qr_session',s.id,jsonb_build_object(
  'reason',btrim(p_reason),'cash_amount',cash::text,'card_amount',card::text,'total',target_total::text,
  'label',label||' · Əvvəl: nağd '||old_cash::text||' '||cur||', kart '||old_card::text||' '||cur));
 insert into private.qr_revision_receipts(actor_id,request_id,payload) values(auth.uid(),p_request_id,payload);
 return public.owner_payment_allocations(p_restaurant_id,p_session_id);
end $$;
revoke all on function public.owner_correct_payment_allocation(uuid,uuid,uuid,integer,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.owner_correct_payment_allocation(uuid,uuid,uuid,integer,uuid,text,text,text) to authenticated;

create or replace function private.owner_event_category(p_action text,p_entity_type text)
returns text language sql immutable set search_path='' as $$
  select case
    when p_action='qr.items_adjusted' then 'ORDERS'
    when p_action in('qr.table_transferred','qr.bill_adjusted','qr.partial_paid','qr.account_paid','qr.payment_corrected') then 'TABLES' 
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
notify pgrst, 'reload schema';
commit;
