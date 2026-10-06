begin;

do $$ begin
  if not (true) then raise exception 'INSTALLER_REQUIRED: Əvvəl install.mjs işlət, sonra layihədəki 013 SQL faylını tətbiq et.'; end if;
end $$;

-- This workflow uses its own explicitly versioned schema. Existing menu data is reused.
create table if not exists public.qr_dining_sessions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  branch_id uuid not null references public.branches(id),
  table_id uuid not null references public.tables(id),
  table_name text not null,
  table_number integer not null,
  status text not null default 'OPEN' check (status in ('OPEN','BILL_REQUESTED','CLOSED')),
  version integer not null default 1,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index if not exists qr_one_open_session on public.qr_dining_sessions(table_id) where status <> 'CLOSED';
create index if not exists qr_sessions_branch on public.qr_dining_sessions(branch_id, opened_at desc);

create table if not exists private.qr_visits (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.qr_dining_sessions(id),
  secret_hash bytea not null,
  expires_at timestamptz not null default now() + interval '8 hours',
  created_at timestamptz not null default now()
);
create index if not exists qr_visits_session on private.qr_visits(session_id);

create table if not exists public.qr_orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  session_id uuid not null references public.qr_dining_sessions(id),
  restaurant_id uuid not null references public.restaurants(id),
  branch_id uuid not null references public.branches(id),
  table_id uuid not null references public.tables(id),
  visit_id uuid not null references private.qr_visits(id),
  request_id uuid not null,
  payload jsonb not null,
  status text not null default 'NEW' check (status in ('NEW','ACCEPTED','PREPARING','READY','SERVED','CANCELLED')),
  total_amount numeric(12,2) not null check (total_amount >= 0),
  currency text not null,
  note text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(visit_id,request_id)
);
create index if not exists qr_orders_session on public.qr_orders(session_id,created_at);
create index if not exists qr_orders_visit on public.qr_orders(visit_id,created_at);
create index if not exists qr_orders_branch on public.qr_orders(branch_id,created_at desc);

create table if not exists public.qr_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.qr_orders(id),
  restaurant_id uuid not null references public.restaurants(id),
  branch_id uuid not null references public.branches(id),
  product_id uuid not null,
  product_name text not null,
  unit_price numeric(12,2) not null check(unit_price >= 0),
  quantity integer not null check(quantity between 1 and 20),
  line_total numeric(12,2) not null check(line_total >= 0)
);
create index if not exists qr_items_order on public.qr_order_items(order_id);

create table if not exists public.qr_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.qr_orders(id),
  restaurant_id uuid not null references public.restaurants(id),
  branch_id uuid not null references public.branches(id),
  actor_id uuid references public.profiles(id) on delete set null,
  status text not null,
  created_at timestamptz not null default now()
);
create index if not exists qr_events_order on public.qr_order_events(order_id,created_at);

create table if not exists public.qr_service_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.qr_dining_sessions(id),
  restaurant_id uuid not null references public.restaurants(id),
  branch_id uuid not null references public.branches(id),
  table_id uuid not null references public.tables(id),
  kind text not null check(kind in ('WAITER','BILL')),
  status text not null default 'NEW' check(status in ('NEW','SEEN','DONE')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists qr_one_open_call on public.qr_service_requests(session_id,kind) where status <> 'DONE';
create index if not exists qr_calls_session on public.qr_service_requests(session_id,created_at desc);

create table if not exists private.qr_action_receipts (
  visit_id uuid not null references private.qr_visits(id),
  request_id uuid not null,
  kind text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(visit_id,request_id)
);
create table if not exists private.qr_limits (
  key text not null,
  bucket bigint not null,
  hits integer not null,
  primary key(key,bucket)
);
create index if not exists qr_limits_bucket on private.qr_limits(bucket);
revoke all on private.qr_visits,private.qr_action_receipts,private.qr_limits from public,anon,authenticated;

create or replace function private.qr_can_manage_branch(p_restaurant_id uuid,p_branch_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
    and exists(select 1 from public.profiles where id=auth.uid() and is_active)
    and exists(select 1 from public.branches b join public.restaurants r on r.id=b.restaurant_id
      where b.id=p_branch_id and r.id=p_restaurant_id and r.is_active and r.status in ('trial','active'))
    and (private.is_super_admin() or exists(select 1 from public.restaurant_members m
      where m.user_id=auth.uid() and m.restaurant_id=p_restaurant_id and m.is_active
        and (m.role::text='RESTAURANT_ADMIN' or (m.role::text='STAFF' and m.branch_id=p_branch_id))));
$$;
revoke all on function private.qr_can_manage_branch(uuid,uuid) from public,anon;
grant execute on function private.qr_can_manage_branch(uuid,uuid) to authenticated;

do $$ declare t text; begin
  foreach t in array array['qr_dining_sessions','qr_orders','qr_order_items','qr_order_events','qr_service_requests'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('drop policy if exists qr_branch_read on public.%I',t);
    execute format('create policy qr_branch_read on public.%I for select to authenticated using (private.qr_can_manage_branch(restaurant_id,branch_id))',t);
  end loop;
end $$;
revoke all on sequence public.qr_orders_order_number_seq from public,anon,authenticated;

create or replace function public.qr_gateway_limit(p_key text,p_read boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_hits integer; v_bucket bigint:=floor(extract(epoch from clock_timestamp())/60)::bigint;
begin
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then return false; end if;
  insert into private.qr_limits(key,bucket,hits) values(p_key,v_bucket,1)
    on conflict(key,bucket) do update set hits=private.qr_limits.hits+1 returning hits into v_hits;
  delete from private.qr_limits where (key,bucket) in
    (select key,bucket from private.qr_limits where bucket<v_bucket-1440 order by bucket limit 100);
  return v_hits<=case when p_read then 1800 else 120 end;
end $$;

create or replace function private.qr_checked_menu(p_slug text,p_token text,p_latitude numeric,p_longitude numeric,p_order boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_menu jsonb; v_rest uuid;
begin
  if p_slug is null or char_length(p_slug)>200 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or p_token is null or p_token !~ '^[0-9a-f]{32}$' then raise exception 'INVALID_QR'; end if;
  v_menu:=public.get_qr_menu(p_slug,p_token,p_latitude,p_longitude);
  v_rest:=(v_menu->'restaurant'->>'id')::uuid;
  if v_rest is null then raise exception 'INVALID_QR'; end if;
  -- Same lock as menu management/imports: prices and availability cannot change during submission.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_rest::text,0));
  perform 1 from public.tables where id=(v_menu->'table'->>'id')::uuid for update;
  v_menu:=public.get_qr_menu(p_slug,p_token,p_latitude,p_longitude);
  if coalesce(v_menu->'location'->>'status','') not in ('ALLOWED','NOT_REQUIRED') then raise exception 'LOCATION_REQUIRED'; end if;
  if p_order and (not coalesce((v_menu->>'can_order')::boolean,false) or not coalesce((v_menu->>'accepting_orders')::boolean,false)) then raise exception 'ORDERS_PAUSED'; end if;
  return v_menu;
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
      and r.slug=p_slug and t.qr_token=p_token and r.is_active and r.status in ('trial','active') and t.is_active and b.is_active;
  if not found then raise exception 'VISIT_EXPIRED'; end if;
  return v_session;
end $$;

create or replace function private.qr_order_json(p_order_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',o.id,'request_id',o.request_id,'number',o.order_number,'status',o.status,'version',o.version,
    'total',o.total_amount,'currency',o.currency,'note',o.note,'created_at',o.created_at,'updated_at',o.updated_at,
    'items',coalesce((select jsonb_agg(jsonb_build_object('name',i.product_name,'price',i.unit_price,'quantity',i.quantity,'total',i.line_total) order by i.product_name,i.id)
      from public.qr_order_items i where i.order_id=o.id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('status',e.status,'at',e.created_at) order by e.created_at,e.id)
      from public.qr_order_events e where e.order_id=o.id),'[]'::jsonb))
  from public.qr_orders o where o.id=p_order_id;
$$;

create or replace function public.qr_get_visit(p_slug text,p_token text,p_visit_id uuid,p_secret text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.qr_dining_sessions;
begin
  v_session:=private.qr_visit_session(p_slug,p_token,p_visit_id,p_secret);
  return jsonb_build_object('session',jsonb_build_object('id',v_session.id,'status',v_session.status,'table_name',v_session.table_name),
    'orders',coalesce((select jsonb_agg(private.qr_order_json(o.id) order by o.created_at desc) from public.qr_orders o where o.visit_id=p_visit_id),'[]'::jsonb),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'status',c.status,'created_at',c.created_at,'updated_at',c.updated_at) order by c.created_at desc)
      from public.qr_service_requests c where c.session_id=v_session.id and c.status<>'DONE'),'[]'::jsonb));
end $$;

create or replace function public.qr_open_visit(p_slug text,p_token text,p_latitude numeric,p_longitude numeric,p_visit_id uuid default null,p_secret text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_menu jsonb; v_session public.qr_dining_sessions; v_id uuid; v_secret text; v_old public.qr_dining_sessions;
begin
  v_menu:=private.qr_checked_menu(p_slug,p_token,p_latitude,p_longitude,false);
  if p_visit_id is not null then
    begin
      v_old:=private.qr_visit_session(p_slug,p_token,p_visit_id,p_secret);
      if v_old.status<>'CLOSED' then return jsonb_build_object('visit_id',p_visit_id,'secret',p_secret,'view',public.qr_get_visit(p_slug,p_token,p_visit_id,p_secret)); end if;
    exception when raise_exception then null;
    end;
  end if;
  select * into v_session from public.qr_dining_sessions where table_id=(v_menu->'table'->>'id')::uuid and status<>'CLOSED' for update;
  if not found then
    insert into public.qr_dining_sessions(restaurant_id,branch_id,table_id,table_name,table_number)
      values((v_menu->'restaurant'->>'id')::uuid,(v_menu->'branch'->>'id')::uuid,(v_menu->'table'->>'id')::uuid,v_menu->'table'->>'name',(v_menu->'table'->>'table_number')::integer)
      returning * into v_session;
  end if;
  if (select count(*) from private.qr_visits where session_id=v_session.id and created_at>now()-interval '1 minute')>=10
     or (select count(*) from private.qr_visits where session_id=v_session.id)>=100 then raise exception 'TOO_MANY_REQUESTS'; end if;
  v_secret:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  insert into private.qr_visits(session_id,secret_hash) values(v_session.id,sha256(convert_to(v_secret,'UTF8'))) returning id into v_id;
  return jsonb_build_object('visit_id',v_id,'secret',v_secret,'view',public.qr_get_visit(p_slug,p_token,v_id,v_secret));
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
  if v_session.status<>'OPEN' then raise exception 'TABLE_CLOSED'; end if;
  if (select count(*) from public.qr_orders where visit_id=p_visit_id and created_at>now()-interval '5 minutes')>=6
     or (select count(*) from public.qr_orders where session_id=v_session.id and created_at>now()-interval '5 minutes')>=20 then raise exception 'TOO_MANY_REQUESTS'; end if;
  v_menu:=private.qr_checked_menu(p_slug,p_token,p_latitude,p_longitude,true);
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
  v_menu:=private.qr_checked_menu(p_slug,p_token,p_latitude,p_longitude,false);
  select * into v_call from public.qr_service_requests where session_id=v_session.id and kind=p_kind and status<>'DONE';
  if not found then
    if exists(select 1 from public.qr_service_requests where session_id=v_session.id and kind=p_kind and created_at>now()-interval '1 minute') then raise exception 'TOO_MANY_REQUESTS'; end if;
    if p_kind='BILL' and not exists(select 1 from public.qr_orders where session_id=v_session.id and status<>'CANCELLED') then raise exception 'NO_ORDERS'; end if;
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

create or replace function public.qr_staff_board(p_restaurant_id uuid,p_branch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  return jsonb_build_object('sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'version',s.version,'table_name',s.table_name,'table_number',s.table_number,'opened_at',s.opened_at,
    'total',coalesce((select sum(o.total_amount) from public.qr_orders o where o.session_id=s.id and o.status<>'CANCELLED'),0),
    'currency',coalesce((select o.currency from public.qr_orders o where o.session_id=s.id order by o.created_at limit 1),'AZN'),
    'orders',coalesce((select jsonb_agg(private.qr_order_json(o.id) order by o.created_at) from public.qr_orders o where o.session_id=s.id),'[]'::jsonb),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'status',c.status,'version',c.version,'created_at',c.created_at) order by c.created_at) from public.qr_service_requests c where c.session_id=s.id and c.status<>'DONE'),'[]'::jsonb)) order by s.table_number)
    from public.qr_dining_sessions s where s.restaurant_id=p_restaurant_id and s.branch_id=p_branch_id and s.status<>'CLOSED'),'[]'::jsonb));
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
  if not found or v_session.status='CLOSED' then raise exception 'TABLE_CLOSED'; end if;
  if p_kind='ORDER' then
    select * into v_order from public.qr_orders where id=p_id for update;
    if p_version is distinct from v_order.version then raise exception 'STALE_VERSION'; end if;
    if p_status is null or not ((v_order.status='NEW' and p_status in ('ACCEPTED','CANCELLED'))
      or (v_order.status='ACCEPTED' and p_status in ('PREPARING','CANCELLED'))
      or (v_order.status='PREPARING' and p_status in ('READY','CANCELLED'))
      or (v_order.status='READY' and p_status in ('SERVED','CANCELLED'))) then raise exception 'INVALID_TRANSITION'; end if;
    update public.qr_orders set status=p_status,version=version+1,updated_at=now() where id=p_id;
    insert into public.qr_order_events(order_id,restaurant_id,branch_id,actor_id,status) values(p_id,p_restaurant_id,p_branch_id,auth.uid(),p_status);
  elsif p_kind='SERVICE' then
    select * into v_call from public.qr_service_requests where id=p_id for update;
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
  insert into public.audit_logs(restaurant_id,branch_id,actor_id,action,entity_type,entity_id,details)
    values(p_restaurant_id,p_branch_id,auth.uid(),'qr.staff_action','qr_'||lower(p_kind),p_id,jsonb_build_object('status',p_status,'version',p_version));
  return public.qr_staff_board(p_restaurant_id,p_branch_id);
end $$;

-- Retire browser access to legacy order routines: the customer must pass the protected gateway.
-- Existing legacy records are retained; no old table or row is removed.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and p.proname=any(array['create_order','get_order_receipt','change_order_status']::text[]) loop
    execute format('revoke execute on function %s from public,anon,authenticated',f.signature);
  end loop;
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature,p.proname,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname like 'qr_%' and p.prokind='f' loop
    if not (f.nspname='private' and f.proname='qr_can_manage_branch') then
      execute format('revoke execute on function %s from public,anon,authenticated',f.signature);
    end if;
    if f.nspname='public' then
      if f.proname in ('qr_staff_board','qr_staff_action') then execute format('grant execute on function %s to authenticated',f.signature);
      else execute format('grant execute on function %s to service_role',f.signature); end if;
    end if;
  end loop;
end $$;

commit;
