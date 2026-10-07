-- Apply after 023_staff_roles.sql. Shared waiter and kitchen accounts remain supported.
begin;
create table if not exists private.operation_receipts (
  actor_id uuid not null references public.profiles(id),kind text not null check(kind in ('MANUAL','TABLES','BILL')),
  request_id uuid not null,payload jsonb not null,response jsonb not null,created_at timestamptz not null default now(),
  primary key(actor_id,kind,request_id)
);
revoke all on private.operation_receipts from public,anon,authenticated,service_role;
alter table public.qr_orders add column if not exists source text not null default 'QR' check(source in ('QR','STAFF'));

create or replace function public.qr_manual_menu(p_restaurant_id uuid,p_branch_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  return jsonb_build_object('restaurant_name',(select name from public.restaurants where id=p_restaurant_id),
    'branch_name',(select name from public.branches where id=p_branch_id and restaurant_id=p_restaurant_id),
    'currency',(select currency from public.restaurant_settings where restaurant_id=p_restaurant_id),
    'accepting_orders',coalesce((select b.is_active and b.accepting_orders and s.order_enabled from public.branches b
      join public.restaurant_settings s on s.restaurant_id=b.restaurant_id where b.id=p_branch_id and b.restaurant_id=p_restaurant_id),false),
    'tables',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'number',t.table_number,
      'session_id',s.id,'status',coalesce(s.status,'EMPTY')) order by t.table_number) from public.tables t
      left join public.qr_dining_sessions s on s.table_id=t.id and s.restaurant_id=t.restaurant_id and s.branch_id=t.branch_id and s.status<>'CLOSED'
      where t.restaurant_id=p_restaurant_id and t.branch_id=p_branch_id and t.is_active),'[]'::jsonb),
    'products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'category',c.name,
      'price',coalesce(bs.price_override,p.base_price)::text,'available',coalesce(bs.is_available,true)) order by c.sort_order,c.name,p.sort_order,p.name,p.id)
      from public.products p join public.categories c on c.id=p.category_id and c.restaurant_id=p.restaurant_id
      left join public.branch_product_settings bs on bs.product_id=p.id and bs.restaurant_id=p.restaurant_id and bs.branch_id=p_branch_id
      where p.restaurant_id=p_restaurant_id and p.is_active and c.is_active and coalesce(bs.is_visible,true)),'[]'::jsonb));
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
  v_response:=jsonb_build_object('order_id',v_order,'number',v_number::text,'table_name',v_table.name,'total',v_total::text,'currency',v_currency);
  insert into private.operation_receipts(actor_id,kind,request_id,payload,response) values(v_actor,'MANUAL',p_request_id,v_payload,v_response);
  return v_response;
end $$;

create or replace function public.qr_staff_bill(p_restaurant_id uuid,p_branch_id uuid,p_session_id uuid,p_version integer,p_request_id uuid,p_method text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_payload jsonb;v_old private.operation_receipts;v_session public.qr_dining_sessions;v_call uuid;
begin
  if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if p_request_id is null or p_version is null or p_version<1 or p_method is null or p_method not in ('CASH','CARD','MIXED') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  v_payload:=jsonb_build_object('restaurant',p_restaurant_id,'branch',p_branch_id,'session',p_session_id,'version',p_version,'method',p_method);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('operation:'||v_actor::text||':'||p_request_id::text,0));
  select * into v_old from private.operation_receipts where actor_id=v_actor and kind='BILL' and request_id=p_request_id;
  if found then if v_old.payload<>v_payload then raise exception 'REQUEST_CONFLICT'; end if;return public.qr_staff_board(p_restaurant_id,p_branch_id);end if;
  select * into v_session from public.qr_dining_sessions where id=p_session_id and restaurant_id=p_restaurant_id and branch_id=p_branch_id for update;
  if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if v_session.id is null or v_session.status<>'OPEN' then raise exception 'TABLE_CLOSED'; end if;
  if v_session.version<>p_version then raise exception 'STALE_VERSION'; end if;
  if not exists(select 1 from public.qr_orders where session_id=p_session_id and status<>'CANCELLED') then raise exception 'NO_ORDERS'; end if;
  update public.qr_dining_sessions set status='BILL_REQUESTED',version=version+1 where id=p_session_id;
  insert into public.qr_service_requests(session_id,restaurant_id,branch_id,table_id,kind,payment_method)
    values(p_session_id,p_restaurant_id,p_branch_id,v_session.table_id,'BILL',p_method) returning id into v_call;
  insert into public.audit_logs(restaurant_id,branch_id,actor_id,action,entity_type,entity_id,details)
    values(p_restaurant_id,p_branch_id,v_actor,'qr.staff_bill_requested','qr_service_requests',v_call,jsonb_build_object('kind','BILL','payment_method',p_method));
  insert into private.operation_receipts(actor_id,kind,request_id,payload,response) values(v_actor,'BILL',p_request_id,v_payload,jsonb_build_object('call_id',v_call));
  return public.qr_staff_board(p_restaurant_id,p_branch_id);
end $$;

create or replace function public.create_tables_batch(p_restaurant_id uuid,p_branch_id uuid,p_start integer,p_count integer,p_prefix text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_payload jsonb;v_old private.operation_receipts;v_response jsonb;v_prefix text:=btrim(p_prefix);
begin
  if not private.staff_can_admin(v_actor,p_restaurant_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if p_request_id is null or p_start is null or p_start<1 or p_count is null or p_count not between 1 and 100
    or p_start::bigint+p_count-1>2147483647 or v_prefix is null or length(v_prefix) not between 1 and 120 then raise exception 'INVALID_TABLE_BATCH'; end if;
  v_payload:=jsonb_build_object('restaurant',p_restaurant_id,'branch',p_branch_id,'start',p_start,'count',p_count,'prefix',v_prefix);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('operation:'||v_actor::text||':'||p_request_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_restaurant_id::text,0));
  perform 1 from public.branches where id=p_branch_id and restaurant_id=p_restaurant_id and is_active for update;
  if not found then raise exception 'INVALID_BRANCH'; end if;
  if not private.staff_can_admin(v_actor,p_restaurant_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  select * into v_old from private.operation_receipts where actor_id=v_actor and kind='TABLES' and request_id=p_request_id;
  if found then if v_old.payload<>v_payload then raise exception 'REQUEST_CONFLICT'; end if;return v_old.response;end if;
  if exists(select 1 from public.tables where branch_id=p_branch_id and table_number between p_start and p_start+(p_count-1)) then raise exception 'TABLE_NUMBER_EXISTS'; end if;
  if (select count(*) from public.tables where branch_id=p_branch_id)+p_count>1000 then raise exception 'TABLE_LIMIT'; end if;
  insert into public.tables(restaurant_id,branch_id,table_number,name)
    select p_restaurant_id,p_branch_id,n,v_prefix||' '||n::text from generate_series(p_start,p_start+(p_count-1)) n;
  insert into public.audit_logs(restaurant_id,branch_id,actor_id,action,entity_type,entity_id,details)
    values(p_restaurant_id,p_branch_id,v_actor,'table.bulk_created','branches',p_branch_id,jsonb_build_object('count',p_count,'start',p_start,'name',v_prefix));
  v_response:=jsonb_build_object('count',p_count,'start',p_start);
  insert into private.operation_receipts(actor_id,kind,request_id,payload,response) values(v_actor,'TABLES',p_request_id,v_payload,v_response);
  return v_response;
end $$;

alter table public.restaurants add column if not exists version integer not null default 1;
create or replace function private.restaurant_operation_version() returns trigger language plpgsql set search_path='' as $$
begin new.version:=old.version+1;return new;end $$;
drop trigger if exists restaurants_operation_version on public.restaurants;
create trigger restaurants_operation_version before update on public.restaurants for each row execute function private.restaurant_operation_version();
revoke all on function private.restaurant_operation_version() from public,anon,authenticated,service_role;
revoke update(status,is_active,version) on public.restaurants from authenticated;

create or replace function public.platform_restaurants_board(p_search text default null,p_status text default null,p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_search text:=nullif(btrim(p_search),'');
begin
  if not private.is_super_admin() then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if length(coalesce(v_search,''))>80 or p_limit is null or p_limit not between 30 and 150 or p_limit%30<>0
    or p_status is not null and p_status not in ('active','trial','suspended','inactive') then raise exception 'INVALID_FILTER'; end if;
  return jsonb_build_object('generated_at',now(),'filters',jsonb_build_object('search',coalesce(v_search,''),'status',p_status,'limit',p_limit),
    'count',(select count(*)::text from public.restaurants r where (v_search is null or strpos(lower(r.name||' '||r.slug),lower(v_search))>0)
      and (p_status is null or case when p_status='inactive' then not r.is_active else r.is_active and r.status=p_status end)),
    'restaurants',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'slug',r.slug,'status',r.status,'is_active',r.is_active,'version',r.version,
      'branches',(select count(*)::text from public.branches where restaurant_id=r.id),'tables',(select count(*)::text from public.tables where restaurant_id=r.id),
      'staff',(select count(*)::text from public.restaurant_members where restaurant_id=r.id and role='STAFF' and is_active)) order by r.created_at desc,r.id)
      from (select * from public.restaurants r where (v_search is null or strpos(lower(r.name||' '||r.slug),lower(v_search))>0)
        and (p_status is null or case when p_status='inactive' then not r.is_active else r.is_active and r.status=p_status end)
        order by r.created_at desc,r.id limit p_limit) r),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'at',a.created_at,'restaurant',r.name,'status',a.details->>'status','is_active',a.details->'is_active') order by a.created_at desc,a.id)
      from (select * from public.audit_logs where action='platform.restaurant_updated' order by created_at desc,id limit 15) a join public.restaurants r on r.id=a.restaurant_id),'[]'::jsonb));
end $$;
create or replace function public.platform_update_restaurant(p_restaurant_id uuid,p_status text,p_is_active boolean,p_version integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_rest public.restaurants;
begin
  if not private.is_super_admin() then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if p_status is null or p_status not in ('active','trial','suspended') or p_is_active is null or p_version is null or p_version<1 then raise exception 'INVALID_RESTAURANT'; end if;
  select * into v_rest from public.restaurants where id=p_restaurant_id for update;
  if not private.is_super_admin() then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if v_rest.id is null then raise exception 'INVALID_RESTAURANT'; end if;
  if v_rest.version<>p_version then raise exception 'STALE_VERSION'; end if;
  if v_rest.status=p_status and v_rest.is_active=p_is_active then return v_rest.id;end if;
  update public.restaurants set status=p_status,is_active=p_is_active where id=p_restaurant_id;
  insert into public.audit_logs(restaurant_id,actor_id,action,entity_type,entity_id,details)
    values(p_restaurant_id,auth.uid(),'platform.restaurant_updated','restaurants',p_restaurant_id,
      jsonb_build_object('status',p_status,'old_status',v_rest.status,'is_active',p_is_active,'old_is_active',v_rest.is_active));
  return p_restaurant_id;
end $$;

revoke all on function public.qr_manual_menu(uuid,uuid),public.qr_manual_submit(uuid,uuid,uuid,uuid,uuid,jsonb,text,text),
  public.qr_staff_bill(uuid,uuid,uuid,integer,uuid,text),public.create_tables_batch(uuid,uuid,integer,integer,text,uuid),
  public.platform_restaurants_board(text,text,integer),public.platform_update_restaurant(uuid,text,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function public.qr_manual_menu(uuid,uuid),public.qr_manual_submit(uuid,uuid,uuid,uuid,uuid,jsonb,text,text),
  public.qr_staff_bill(uuid,uuid,uuid,integer,uuid,text),public.create_tables_batch(uuid,uuid,integer,integer,text,uuid),
  public.platform_restaurants_board(text,text,integer),public.platform_update_restaurant(uuid,text,boolean,integer) to authenticated;
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
    'latest_new_number',(select max(order_number)::text from active where status='NEW'),
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
        from filtered f join public.qr_order_items i on i.order_id=f.id and i.restaurant_id=p_restaurant_id and i.branch_id=p_branch_id
        group by i.product_id,i.product_name) g),'[]'::jsonb),
    'orders',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'number',p.order_number::text,'status',p.status,'version',p.version,'lane',p.lane,
      'table_id',p.table_id,'table_number',p.table_number,'table_name',p.table_name,
      'note',p.note,'created_at',p.created_at,'updated_at',p.updated_at,
      'items',coalesce((select jsonb_agg(jsonb_build_object('name',i.product_name,'quantity',i.quantity::text) order by i.id)
        from public.qr_order_items i where i.order_id=p.id and i.restaurant_id=p_restaurant_id and i.branch_id=p_branch_id),'[]'::jsonb)
    ) order by p.created_at,p.id) from page p),'[]'::jsonb)
  ) into v_result;
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
commit;
