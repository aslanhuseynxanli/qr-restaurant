begin;

create index if not exists qr_owner_active_tables on public.tables(restaurant_id,branch_id) where is_active;
create index if not exists qr_owner_orders_date on public.qr_orders(restaurant_id,created_at desc);
create index if not exists qr_owner_closed_date on public.qr_dining_sessions(restaurant_id,closed_at desc) where status='CLOSED';
create index if not exists qr_owner_open_branch on public.qr_dining_sessions(restaurant_id,branch_id) where status<>'CLOSED';
create index if not exists qr_owner_open_calls on public.qr_service_requests(restaurant_id,branch_id) where status<>'DONE';
create index if not exists owner_activity_cursor on public.audit_logs(restaurant_id,created_at desc,id desc);
create index if not exists owner_activity_branch_cursor on public.audit_logs(restaurant_id,branch_id,created_at desc,id desc);

create or replace function private.require_owner_panel(p_restaurant_id uuid)
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_active)
    or not exists(select 1 from public.restaurants where id=p_restaurant_id)
    or not (private.is_super_admin() or private.has_restaurant_role(p_restaurant_id,'RESTAURANT_ADMIN')) then
    raise exception using errcode='42501',message='FORBIDDEN';
  end if;
end $$;

create or replace function private.owner_event_category(p_action text,p_entity_type text)
returns text language sql immutable set search_path='' as $$
  select case
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

-- A limited display object: never return raw details, Auth data, visit IDs or QR tokens.
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
    select table_name into v_table from public.qr_dining_sessions where id=p_log.entity_id and restaurant_id=p_log.restaurant_id;
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
      'total',p_log.details->'total','table_number',p_log.details->'table_number',
      'allowed_radius_meters',p_log.details->'allowed_radius_meters',
      'created_products',p_log.details->'products_created','updated_products',p_log.details->'products_updated','created_categories',p_log.details->'categories_created','skipped_products',p_log.details->'products_skipped',
      'old_branch_name',(select name from public.branches where restaurant_id=p_log.restaurant_id and id::text=p_log.details->>'old_branch_id'),
      'branch_name',(select name from public.branches where restaurant_id=p_log.restaurant_id and id::text=p_log.details->>'branch_id')
    )));
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
    'closed_amounts',coalesce((select jsonb_agg(jsonb_build_object('currency',currency,'total',total::text) order by currency) from totals),jsonb_build_array(jsonb_build_object('currency',v_currency,'total','0.00'))),
    'branches',coalesce((select jsonb_agg(to_jsonb(b) order by b.name,b.id) from branch_data b),'[]'::jsonb),
    'recent_activity',coalesce((select jsonb_agg(private.owner_event_json(a) order by a.created_at desc,a.id desc) from
      (select * from public.audit_logs where restaurant_id=p_restaurant_id and (p_branch_id is null or branch_id=p_branch_id) order by created_at desc,id desc limit 5) a),'[]'::jsonb)
  ) into v_result from selected;
  return v_result;
end $$;

create or replace function public.owner_activity(p_restaurant_id uuid,p_branch_id uuid default null,p_category text default null,
  p_from date default null,p_to date default null,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_from date:=coalesce(p_from,(now() at time zone 'Asia/Baku')::date-6); v_to date:=coalesce(p_to,(now() at time zone 'Asia/Baku')::date);
  v_start timestamptz;v_end timestamptz;v_result jsonb;
begin
  perform private.require_owner_panel(p_restaurant_id);
  if p_branch_id is not null and not exists(select 1 from public.branches where id=p_branch_id and restaurant_id=p_restaurant_id) then
    raise exception using errcode='42501',message='FORBIDDEN';
  end if;
  if v_to<v_from or v_to-v_from>365 or p_limit is null or p_limit not between 1 and 50
    or ((p_before_at is null)<>(p_before_id is null))
    or (p_category is not null and p_category not in ('ORDERS','TABLES','CALLS','MENU','TEAM','BRANCHES','RESTAURANT','OTHER')) then raise exception 'INVALID_FILTER'; end if;
  v_start:=v_from::timestamp at time zone 'Asia/Baku';v_end:=(v_to+1)::timestamp at time zone 'Asia/Baku';
  with selected as (
    select * from public.audit_logs where restaurant_id=p_restaurant_id and (p_branch_id is null or branch_id=p_branch_id)
      and created_at>=v_start and created_at<v_end
      and (p_category is null or private.owner_event_category(action,entity_type)=p_category)
      and (p_before_at is null or (created_at,id)<(p_before_at,p_before_id))
      order by created_at desc,id desc limit p_limit+1
  ), page as (select * from selected order by created_at desc,id desc limit p_limit)
  select jsonb_build_object(
    'restaurant_name',(select name from public.restaurants where id=p_restaurant_id),
    'branches',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'is_active',is_active) order by name,id) from public.branches where restaurant_id=p_restaurant_id),'[]'::jsonb),
    'filters',jsonb_build_object('branch_id',p_branch_id,'category',p_category,'from',v_from,'to',v_to),
    'events',coalesce((select jsonb_agg(private.owner_event_json(a) order by a.created_at desc,a.id desc) from page a),'[]'::jsonb),
    'next_cursor',case when (select count(*) from selected)>p_limit then
      (select jsonb_build_object('at',created_at,'id',id) from page order by created_at,id limit 1) else null end
  ) into v_result;
  return v_result;
end $$;

revoke all on function private.require_owner_panel(uuid),private.owner_event_category(text,text),private.owner_event_json(public.audit_logs) from public,anon,authenticated;
revoke all on function public.owner_dashboard(uuid,uuid),public.owner_activity(uuid,uuid,text,date,date,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function public.owner_dashboard(uuid,uuid),public.owner_activity(uuid,uuid,text,date,date,timestamptz,uuid,integer) to authenticated;

commit;
