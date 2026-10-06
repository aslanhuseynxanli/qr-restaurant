-- Apply after 018. Historical accounts stay intact; their payment split is unknown.
begin;

create table if not exists public.qr_payments (
  id uuid primary key default gen_random_uuid(),
  receipt_number bigint generated always as identity unique,
  session_id uuid not null unique references public.qr_dining_sessions(id),
  restaurant_id uuid not null references public.restaurants(id),
  branch_id uuid not null references public.branches(id),
  branch_name text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null,
  actor_role text not null,
  request_id uuid not null unique,
  session_version integer not null,
  payment_method text not null check(payment_method in ('CASH','CARD','MIXED')),
  total_amount numeric(18,2) not null check(total_amount>=0 and total_amount<10000000000000000),
  cash_amount numeric(18,2) not null check(cash_amount>=0 and cash_amount<10000000000000000),
  card_amount numeric(18,2) not null check(card_amount>=0 and card_amount<10000000000000000),
  currency text not null,
  paid_at timestamptz not null default now(),
  check(cash_amount+card_amount=total_amount),
  check((payment_method='CASH' and card_amount=0) or (payment_method='CARD' and cash_amount=0)
    or (payment_method='MIXED' and cash_amount>0 and card_amount>0))
);
alter table public.qr_payments enable row level security;
revoke all on public.qr_payments from public,anon,authenticated,service_role;
revoke all on sequence public.qr_payments_receipt_number_seq from public,anon,authenticated,service_role;
create index if not exists qr_payment_rest_date on public.qr_payments(restaurant_id,paid_at desc);
create index if not exists qr_closed_history_cursor on public.qr_dining_sessions(restaurant_id,closed_at desc,id desc) where status='CLOSED';
create index if not exists qr_closed_branch_history_cursor on public.qr_dining_sessions(restaurant_id,branch_id,closed_at desc,id desc) where status='CLOSED';

-- Text inputs are checked before numeric conversion: no rounding, negative, NaN or Infinity.
create or replace function private.qr_payment_amount(p_value text)
returns numeric language plpgsql immutable set search_path='' as $$
begin
  if p_value is null or p_value !~ '^[0-9]{1,16}([.][0-9]{1,2})?$' then raise exception 'INVALID_PAYMENT_AMOUNT'; end if;
  return p_value::numeric;
end $$;

-- Older clients cannot close a payable account without recording its payment.
create or replace function private.qr_require_payment_on_close()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_total numeric;v_currency text;v_payment public.qr_payments;
begin
  if old.status='CLOSED' and new.status<>'CLOSED' and exists(select 1 from public.qr_payments where session_id=old.id) then
    raise exception 'PAID_ACCOUNT_LOCKED';
  end if;
  if old.status<>'CLOSED' and new.status='CLOSED' and exists(select 1 from public.qr_orders where session_id=new.id and status<>'CANCELLED') then
    if exists(select 1 from public.qr_orders where session_id=new.id and status not in ('SERVED','CANCELLED')) then raise exception 'UNFINISHED_ORDERS'; end if;
    select * into v_payment from public.qr_payments where session_id=new.id and restaurant_id=new.restaurant_id and branch_id=new.branch_id;
    if not found then raise exception 'PAYMENT_REQUIRED'; end if;
    select sum(total_amount),min(currency) into v_total,v_currency from public.qr_orders where session_id=new.id and status='SERVED';
    if v_total is distinct from v_payment.total_amount or v_currency is distinct from v_payment.currency then raise exception 'PAYMENT_TOTAL_CHANGED'; end if;
  end if;
  return new;
end $$;
drop trigger if exists qr_require_payment_on_close on public.qr_dining_sessions;
create trigger qr_require_payment_on_close before update of status on public.qr_dining_sessions
  for each row execute function private.qr_require_payment_on_close();

create or replace function public.qr_settle_account(p_restaurant_id uuid,p_branch_id uuid,p_session_id uuid,p_version integer,
  p_request_id uuid,p_payment_method text,p_cash text,p_card text,p_expected_total text,p_currency text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.qr_dining_sessions;v_payment public.qr_payments;v_cash numeric;v_card numeric;v_expected numeric;
  v_total numeric;v_currency text;v_name text;v_role text;v_branch_name text;v_count integer;v_currencies integer;
begin
  if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if p_session_id is null or p_request_id is null or p_version is null or p_version<1 then raise exception 'INVALID_REQUEST'; end if;
  if p_payment_method is null or p_payment_method not in ('CASH','CARD','MIXED') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  v_cash:=private.qr_payment_amount(p_cash);v_card:=private.qr_payment_amount(p_card);v_expected:=private.qr_payment_amount(p_expected_total);
  if v_cash+v_card<>v_expected or (p_payment_method='CASH' and v_card<>0) or (p_payment_method='CARD' and v_cash<>0)
    or (p_payment_method='MIXED' and (v_cash<=0 or v_card<=0)) then raise exception 'PAYMENT_SUM_MISMATCH'; end if;
  select * into v_session from public.qr_dining_sessions where id=p_session_id and restaurant_id=p_restaurant_id and branch_id=p_branch_id for update;
  if not found then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  -- Recheck after waiting for another worker's lock.
  if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  select * into v_payment from public.qr_payments where session_id=p_session_id;
  if found then
    if v_payment.request_id=p_request_id and v_payment.actor_id=auth.uid() then
      if v_payment.session_version is distinct from p_version or v_payment.payment_method is distinct from p_payment_method
        or v_payment.cash_amount<>v_cash or v_payment.card_amount<>v_card or v_payment.total_amount<>v_expected
        or v_payment.currency is distinct from p_currency then raise exception 'REQUEST_CONFLICT'; end if;
    else raise exception 'ACCOUNT_ALREADY_PAID'; end if;
  else
    if exists(select 1 from public.qr_payments where request_id=p_request_id) then raise exception 'REQUEST_CONFLICT'; end if;
    if v_session.status='CLOSED' then raise exception 'TABLE_CLOSED'; end if;
    if v_session.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
    if v_session.status<>'BILL_REQUESTED' then raise exception 'INVALID_TRANSITION'; end if;
    if exists(select 1 from public.qr_orders where session_id=p_session_id and status not in ('SERVED','CANCELLED')) then raise exception 'UNFINISHED_ORDERS'; end if;
    select count(*),sum(total_amount),min(currency),count(distinct currency) into v_count,v_total,v_currency,v_currencies
      from public.qr_orders where session_id=p_session_id and status='SERVED';
    if v_count=0 then raise exception 'NO_PAYABLE_ORDERS'; end if;
    if v_expected<>v_total or p_currency is distinct from v_currency or v_currencies<>1 then raise exception 'PAYMENT_TOTAL_CHANGED'; end if;
    select coalesce(nullif(btrim(full_name),''),'İstifadəçi') into v_name from public.profiles where id=auth.uid();
    v_role:=case when private.is_super_admin() then 'Platforma admini'
      when private.has_restaurant_role(p_restaurant_id,'RESTAURANT_ADMIN') then 'Restoran sahibi' else 'İşçi' end;
    select name into v_branch_name from public.branches where id=p_branch_id and restaurant_id=p_restaurant_id;
    begin
      insert into public.qr_payments(session_id,restaurant_id,branch_id,branch_name,actor_id,actor_name,actor_role,request_id,session_version,
        payment_method,total_amount,cash_amount,card_amount,currency)
        values(p_session_id,p_restaurant_id,p_branch_id,v_branch_name,auth.uid(),v_name,v_role,p_request_id,p_version,p_payment_method,v_total,v_cash,v_card,v_currency)
        returning * into v_payment;
    exception when unique_violation then raise exception 'REQUEST_CONFLICT'; end;
    update public.qr_dining_sessions set status='CLOSED',version=version+1,closed_at=v_payment.paid_at where id=p_session_id;
    update public.qr_service_requests set status='DONE',version=version+1,updated_at=v_payment.paid_at where session_id=p_session_id and status<>'DONE';
    insert into public.audit_logs(restaurant_id,branch_id,actor_id,action,entity_type,entity_id,details)
      values(p_restaurant_id,p_branch_id,auth.uid(),'qr.staff_action','qr_close',p_session_id,
        jsonb_build_object('payment_method',p_payment_method,'cash_amount',v_cash::text,'card_amount',v_card::text,'total',v_total::text,'receipt_number',v_payment.receipt_number::text));
  end if;
  return jsonb_build_object('board',public.qr_staff_board(p_restaurant_id,p_branch_id),
    'payment',jsonb_build_object('session_id',p_session_id,'number',v_payment.receipt_number::text,'method',v_payment.payment_method,
      'total',v_payment.total_amount::text,'cash',v_payment.cash_amount::text,'card',v_payment.card_amount::text,'currency',v_payment.currency,'paid_at',v_payment.paid_at));
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
  return jsonb_build_object('id',p_session.id,'branch_name',coalesce(v_payment.branch_name,v_branch),'table_name',p_session.table_name,
    'table_number',p_session.table_number,'opened_at',p_session.opened_at,'closed_at',p_session.closed_at,
    'kind',case when v_payment.id is not null then 'PAID' when v_served>0 then 'LEGACY' else 'EMPTY' end,
    'order_count',v_orders,'item_count',v_items,'total',coalesce(v_payment.total_amount,v_total)::text,'currency',coalesce(v_payment.currency,v_currency,'AZN'),
    'payment',case when v_payment.id is null then null else jsonb_build_object('number',v_payment.receipt_number::text,'method',v_payment.payment_method,
      'cash',v_payment.cash_amount::text,'card',v_payment.card_amount::text,'actor_name',v_payment.actor_name,'actor_role',v_payment.actor_role,'paid_at',v_payment.paid_at) end);
end $$;

create or replace function public.owner_account_history(p_restaurant_id uuid,p_branch_id uuid default null,p_method text default null,
  p_from date default null,p_to date default null,p_search text default '',p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_from date:=coalesce(p_from,(now() at time zone 'Asia/Baku')::date-6);v_to date:=coalesce(p_to,(now() at time zone 'Asia/Baku')::date);
  v_start timestamptz;v_end timestamptz;v_search text:=btrim(coalesce(p_search,''));v_result jsonb;
begin
  perform private.require_owner_panel(p_restaurant_id);
  if p_branch_id is not null and not exists(select 1 from public.branches where id=p_branch_id and restaurant_id=p_restaurant_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if v_to<v_from or v_to-v_from>365 or length(v_search)>80 or p_limit is null or p_limit not between 1 and 50
    or ((p_before_at is null)<>(p_before_id is null)) or (p_method is not null and p_method not in ('CASH','CARD','MIXED','LEGACY','EMPTY')) then raise exception 'INVALID_FILTER'; end if;
  v_start:=v_from::timestamp at time zone 'Asia/Baku';v_end:=(v_to+1)::timestamp at time zone 'Asia/Baku';
  with base as materialized (
    select s.*,p.id as payment_id,p.payment_method,p.total_amount as paid_total,p.cash_amount,p.card_amount,
      coalesce(p.currency,o.currency,'AZN') as account_currency,coalesce(o.served_total,0) as served_total,coalesce(o.served_count,0) as served_count
    from public.qr_dining_sessions s left join public.qr_payments p on p.session_id=s.id and p.restaurant_id=s.restaurant_id
    left join lateral (select sum(total_amount) filter(where status='SERVED') as served_total,count(*) filter(where status='SERVED') as served_count,min(currency) as currency
      from public.qr_orders where session_id=s.id and restaurant_id=s.restaurant_id) o on true
    where s.restaurant_id=p_restaurant_id and s.status='CLOSED' and s.closed_at>=v_start and s.closed_at<v_end
      and (p_branch_id is null or s.branch_id=p_branch_id)
      and (v_search='' or strpos(lower(s.table_name),lower(v_search))>0 or s.table_number::text=v_search or p.receipt_number::text=v_search)
  ), matched as materialized (
    select * from base where p_method is null or payment_method=p_method
      or (p_method='LEGACY' and payment_id is null and served_count>0) or (p_method='EMPTY' and payment_id is null and served_count=0)
  ), selected as (
    select * from matched where p_before_at is null or (closed_at,id)<(p_before_at,p_before_id) order by closed_at desc,id desc limit p_limit+1
  ), page as (select * from selected order by closed_at desc,id desc limit p_limit), amounts as (
    select account_currency as currency,coalesce(sum(paid_total),0)::text as recorded,coalesce(sum(cash_amount),0)::text as cash,
      coalesce(sum(card_amount),0)::text as card,coalesce(sum(served_total) filter(where payment_id is null and served_count>0),0)::text as legacy
    from matched where payment_id is not null or served_count>0 group by account_currency
  )
  select jsonb_build_object('restaurant_name',(select name from public.restaurants where id=p_restaurant_id),
    'branches',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'is_active',is_active) order by name,id) from public.branches where restaurant_id=p_restaurant_id),'[]'::jsonb),
    'filters',jsonb_build_object('branch_id',p_branch_id,'method',p_method,'from',v_from,'to',v_to,'search',v_search),
    'summary',jsonb_build_object('count',(select count(*) from matched),'recorded_count',(select count(*) from matched where payment_id is not null),
      'legacy_count',(select count(*) from matched where payment_id is null and served_count>0),'empty_count',(select count(*) from matched where payment_id is null and served_count=0),
      'amounts',coalesce((select jsonb_agg(to_jsonb(a) order by currency) from amounts a),'[]'::jsonb)),
    'accounts',coalesce((select jsonb_agg(private.owner_account_json(s) order by s.closed_at desc,s.id desc)
      from public.qr_dining_sessions s join page p on p.id=s.id),'[]'::jsonb),
    'next_cursor',case when (select count(*) from selected)>p_limit then (select jsonb_build_object('at',closed_at,'id',id) from page order by closed_at,id limit 1) else null end)
    into v_result;
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
    'account',private.owner_account_json(v_session),'orders',coalesce((select jsonb_agg(jsonb_build_object(
      'id',o.id,'number',o.order_number::text,'status',o.status,'total',o.total_amount::text,'currency',o.currency,'note',o.note,'created_at',o.created_at,
      'items',coalesce((select jsonb_agg(jsonb_build_object('name',product_name,'price',unit_price::text,'quantity',quantity,'total',line_total::text) order by id)
        from public.qr_order_items where order_id=o.id and restaurant_id=p_restaurant_id),'[]'::jsonb),
      'events',coalesce((select jsonb_agg(jsonb_build_object('status',e.status,'at',e.created_at,'actor_name',coalesce(nullif(btrim(p.full_name),''),'Sistem')) order by e.created_at,e.id)
        from public.qr_order_events e left join public.profiles p on p.id=e.actor_id where e.order_id=o.id and e.restaurant_id=p_restaurant_id),'[]'::jsonb)
      ) order by o.created_at,o.order_number) from public.qr_orders o where o.session_id=p_session_id and o.restaurant_id=p_restaurant_id),'[]'::jsonb)) into v_result;
  return v_result;
end $$;

revoke all on function private.qr_payment_amount(text),private.qr_require_payment_on_close(),private.owner_account_json(public.qr_dining_sessions) from public,anon,authenticated,service_role;
revoke all on function public.qr_settle_account(uuid,uuid,uuid,integer,uuid,text,text,text,text,text),
  public.owner_account_history(uuid,uuid,text,date,date,text,timestamptz,uuid,integer),public.owner_account_detail(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.qr_settle_account(uuid,uuid,uuid,integer,uuid,text,text,text,text,text),
  public.owner_account_history(uuid,uuid,text,date,date,text,timestamptz,uuid,integer),public.owner_account_detail(uuid,uuid) to authenticated;

-- Exact decimal total for the payment form; existing queue totals are preserved.
create or replace function public.qr_staff_board(p_restaurant_id uuid,p_branch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  return jsonb_build_object('sound_enabled',coalesce((select sound_enabled from public.restaurant_settings where restaurant_id=p_restaurant_id),true),'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'version',s.version,'table_name',s.table_name,'table_number',s.table_number,'opened_at',s.opened_at,
    'total',coalesce((select sum(o.total_amount) from public.qr_orders o where o.session_id=s.id and o.status<>'CANCELLED'),0),
    'payment_total',coalesce((select sum(o.total_amount) from public.qr_orders o where o.session_id=s.id and o.status<>'CANCELLED'),0)::text,
    'currency',coalesce((select o.currency from public.qr_orders o where o.session_id=s.id order by o.created_at limit 1),'AZN'),
    'orders',coalesce((select jsonb_agg(private.qr_order_json(o.id) order by o.created_at) from public.qr_orders o where o.session_id=s.id),'[]'::jsonb),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'payment_method',c.payment_method,'status',c.status,'version',c.version,'created_at',c.created_at) order by c.created_at) from public.qr_service_requests c where c.session_id=s.id and c.status<>'DONE'),'[]'::jsonb)) order by s.table_number)
    from public.qr_dining_sessions s where s.restaurant_id=p_restaurant_id and s.branch_id=p_branch_id and s.status<>'CLOSED'),'[]'::jsonb));
end $$;


-- Include only the safe payment fields in the existing activity cards.
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
  elsif p_log.entity_type in ('qr_close','qr_clear','qr_reopen') then
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
      'status',p_log.details->'status','from_status',p_log.details->'from_status','to_status',p_log.details->'to_status',
      'kind',coalesce(p_log.details->'kind',to_jsonb(v_kind)),'payment_method',p_log.details->'payment_method',
      'is_active',p_log.details->'is_active','is_available',p_log.details->'is_available','is_visible',p_log.details->'is_visible',
      'base_price',p_log.details->'base_price','price_override',p_log.details->'price_override','sort_order',p_log.details->'sort_order',
      'cash_amount',p_log.details->'cash_amount','card_amount',p_log.details->'card_amount','receipt_number',p_log.details->'receipt_number',
      'total',p_log.details->'total','table_number',p_log.details->'table_number',
      'allowed_radius_meters',p_log.details->'allowed_radius_meters',
      'created_products',p_log.details->'products_created','updated_products',p_log.details->'products_updated','created_categories',p_log.details->'categories_created','skipped_products',p_log.details->'products_skipped',
      'old_branch_name',(select name from public.branches where restaurant_id=p_log.restaurant_id and id::text=p_log.details->>'old_branch_id'),
      'branch_name',(select name from public.branches where restaurant_id=p_log.restaurant_id and id::text=p_log.details->>'branch_id')
    )));
end $$;


commit;
