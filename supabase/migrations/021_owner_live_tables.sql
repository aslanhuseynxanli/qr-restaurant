-- Apply after 020. Read-only owner monitor; existing order/payment functions stay intact.
begin;

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
    select session_id,currency,sum(total_amount)::text as total
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
    select currency,sum(total::numeric)::text as total from orders where status<>'CANCELLED' group by currency
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

revoke all on function public.owner_live_tables(uuid,uuid,text,text,integer),
  public.owner_live_table_detail(uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.owner_live_tables(uuid,uuid,text,text,integer),
  public.owner_live_table_detail(uuid,uuid,text,integer) to authenticated;

commit;
