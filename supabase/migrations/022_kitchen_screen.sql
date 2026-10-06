-- Apply after 021. Kitchen uses the existing branch staff assignments.
begin;

create index if not exists qr_kitchen_active_orders on public.qr_orders(branch_id,created_at,id)
  where status in ('NEW','ACCEPTED','PREPARING','READY');

create or replace function public.qr_kitchen_board(
  p_restaurant_id uuid,p_branch_id uuid,p_search text default null,p_limit integer default 30
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_search text:=nullif(btrim(p_search),'');v_result jsonb;
begin
  if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then
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
    'sound_enabled',coalesce((select sound_enabled from public.restaurant_settings where restaurant_id=p_restaurant_id),true),
    -- Branch-wide notification marker also covers new orders beyond the displayed page/search.
    'latest_new_number',(select max(order_number)::text from active where status='NEW'),
    'counts',jsonb_build_object('NEW',(select count(*)::text from filtered where lane='NEW'),
      'WORKING',(select count(*)::text from filtered where lane='WORKING'),
      'READY',(select count(*)::text from filtered where lane='READY')),
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

create or replace function public.qr_kitchen_action(
  p_restaurant_id uuid,p_branch_id uuid,p_order_id uuid,p_version integer,p_status text,
  p_search text default null,p_limit integer default 30
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.qr_orders;v_session public.qr_dining_sessions;v_session_id uuid;
begin
  if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then
    raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if p_status is null or p_status not in ('ACCEPTED','PREPARING','READY') then raise exception 'INVALID_TRANSITION'; end if;
  if p_order_id is null or p_version is null or p_version<1 then raise exception 'INVALID_REQUEST'; end if;
  if p_limit is null or p_limit<30 or p_limit>150 or p_limit%30<>0
    or char_length(coalesce(btrim(p_search),''))>80 then raise exception 'INVALID_KITCHEN_FILTER'; end if;
  select session_id into v_session_id from public.qr_orders
    where id=p_order_id and restaurant_id=p_restaurant_id and branch_id=p_branch_id;
  if not found then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  -- Same lock order as the existing staff/payment workflow: session, then order.
  select * into v_session from public.qr_dining_sessions
    where id=v_session_id and restaurant_id=p_restaurant_id and branch_id=p_branch_id for update;
  if not found then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if v_session.status='CLOSED' then raise exception 'TABLE_CLOSED'; end if;
  select * into v_order from public.qr_orders where id=p_order_id and session_id=v_session.id
    and restaurant_id=p_restaurant_id and branch_id=p_branch_id and table_id=v_session.table_id for update;
  if not found then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  -- Recheck assignment after waiting for another employee or payment transaction.
  if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then
    raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if p_version is distinct from v_order.version then raise exception 'STALE_VERSION'; end if;
  if not ((v_order.status='NEW' and p_status='ACCEPTED')
    or (v_order.status='ACCEPTED' and p_status='PREPARING')
    or (v_order.status='PREPARING' and p_status='READY')) then raise exception 'INVALID_TRANSITION'; end if;
  update public.qr_orders set status=p_status,version=version+1,updated_at=now() where id=p_order_id;
  insert into public.qr_order_events(order_id,restaurant_id,branch_id,actor_id,status)
    values(p_order_id,p_restaurant_id,p_branch_id,auth.uid(),p_status);
  insert into public.audit_logs(restaurant_id,branch_id,actor_id,action,entity_type,entity_id,details)
    values(p_restaurant_id,p_branch_id,auth.uid(),'qr.staff_action','qr_order',p_order_id,
      jsonb_build_object('status',p_status,'version',p_version,'source','KITCHEN'));
  return public.qr_kitchen_board(p_restaurant_id,p_branch_id,p_search,p_limit);
end $$;

revoke all on function public.qr_kitchen_board(uuid,uuid,text,integer),
  public.qr_kitchen_action(uuid,uuid,uuid,integer,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.qr_kitchen_board(uuid,uuid,text,integer),
  public.qr_kitchen_action(uuid,uuid,uuid,integer,text,text,integer) to authenticated;

commit;
