-- Apply after 021 (022 may already be installed). Role separation includes the kitchen routines.
begin;
alter table public.restaurant_members add column if not exists staff_kind text not null default 'WAITER' check(staff_kind in ('WAITER','KITCHEN'));
alter table private.staff_account_jobs add column if not exists staff_kind text not null default 'WAITER' check(staff_kind in ('WAITER','KITCHEN'));
revoke update(staff_kind) on public.restaurant_members from authenticated;

create or replace function private.qr_branch_role(p_restaurant_id uuid,p_branch_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case
    when auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_active)
      or not exists(select 1 from public.branches b join public.restaurants r on r.id=b.restaurant_id
        where b.id=p_branch_id and r.id=p_restaurant_id and r.is_active and r.status in ('active','trial')) then null
    when private.is_super_admin() or exists(select 1 from public.restaurant_members where restaurant_id=p_restaurant_id
      and user_id=auth.uid() and role='RESTAURANT_ADMIN' and is_active) then 'OWNER'
    else (select m.staff_kind from public.restaurant_members m join public.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
      where m.restaurant_id=p_restaurant_id and m.branch_id=p_branch_id and m.user_id=auth.uid() and m.role='STAFF' and m.is_active and b.is_active)
  end;
$$;
create or replace function private.qr_can_manage_branch(p_restaurant_id uuid,p_branch_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(private.qr_branch_role(p_restaurant_id,p_branch_id) in ('OWNER','WAITER'),false);
$$;
create or replace function private.qr_can_kitchen(p_restaurant_id uuid,p_branch_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(private.qr_branch_role(p_restaurant_id,p_branch_id) in ('OWNER','KITCHEN'),false);
$$;
revoke all on function private.qr_branch_role(uuid,uuid),private.qr_can_kitchen(uuid,uuid) from public,anon,authenticated,service_role;


create or replace function public.staff_management_board(p_restaurant_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not private.staff_can_admin(auth.uid(),p_restaurant_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  return jsonb_build_object(
    'restaurant_name',(select name from public.restaurants where id=p_restaurant_id),
    'branches',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'is_active',is_active) order by name)
      from public.branches where restaurant_id=p_restaurant_id),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'user_id',m.user_id,'full_name',p.full_name,'email',u.email,
      'branch_id',m.branch_id,'staff_kind',m.staff_kind,'is_active',m.is_active,'profile_active',p.is_active,'version',m.version) order by m.created_at desc)
      from public.restaurant_members m join public.profiles p on p.id=m.user_id join auth.users u on u.id=m.user_id
      where m.restaurant_id=p_restaurant_id and m.role='STAFF'),'[]'::jsonb));
end $$;

create or replace function public.staff_prepare_account(p_restaurant_id uuid,p_branch_id uuid,p_full_name text,p_email text,p_fingerprint text,p_request_id uuid,p_staff_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_job private.staff_account_jobs; v_token uuid; v_name text:=btrim(p_full_name); v_email text:=lower(btrim(p_email));
begin
  if not private.staff_can_admin(v_actor,p_restaurant_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if p_staff_kind is null or p_staff_kind not in ('WAITER','KITCHEN') then raise exception 'INVALID_STAFF'; end if;
  if p_request_id is null or v_name is null or length(v_name) not between 1 and 150 or v_email is null
    or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_STAFF'; end if;
  if not exists(select 1 from public.branches where id=p_branch_id and restaurant_id=p_restaurant_id and is_active) then raise exception 'INVALID_BRANCH'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-account:'||v_actor::text,0));
  if not private.staff_can_admin(v_actor,p_restaurant_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  select * into v_job from private.staff_account_jobs where actor_id=v_actor and request_id=p_request_id for update;
  if not found then
    -- A refresh may have lost the request ID after Auth committed. Resume the exact same attempt.
    select * into v_job from private.staff_account_jobs where actor_id=v_actor and restaurant_id=p_restaurant_id and email=v_email and status='PENDING' for update;
    if found and (v_job.fingerprint<>p_fingerprint or v_job.branch_id<>p_branch_id or v_job.full_name<>v_name or v_job.staff_kind<>p_staff_kind) then
      if v_job.lease_until>now() then raise exception 'CREATION_BUSY'; end if;
      if exists(select 1 from auth.users where lower(email)=v_email and raw_app_meta_data->>'qr_staff_job_id'=v_job.id::text) then raise exception 'PENDING_ACCOUNT'; end if;
      update private.staff_account_jobs set status='FAILED',lease_token=null,lease_until=null where id=v_job.id;
      v_job:=null;
    end if;
  end if;
  if v_job.id is not null then
    if v_job.restaurant_id<>p_restaurant_id or v_job.branch_id<>p_branch_id or v_job.full_name<>v_name or v_job.email<>v_email or v_job.fingerprint<>p_fingerprint or v_job.staff_kind<>p_staff_kind then raise exception 'REQUEST_CONFLICT'; end if;
    if v_job.status='COMPLETE' then
      if v_job.member_id is null then raise exception 'INVALID_STAFF'; end if;
      return jsonb_build_object('status','COMPLETE','member_id',v_job.member_id);
    end if;
    if v_job.status='FAILED' then raise exception 'REQUEST_CONFLICT'; end if;
    if v_job.lease_until>now() then raise exception 'CREATION_BUSY'; end if;
  else
    if (select count(*) from private.staff_account_jobs where actor_id=v_actor and created_at>now()-interval '1 hour')>=30 then raise exception 'TOO_MANY_REQUESTS'; end if;
    insert into private.staff_account_jobs(actor_id,request_id,restaurant_id,branch_id,full_name,email,fingerprint,staff_kind)
      values(v_actor,p_request_id,p_restaurant_id,p_branch_id,v_name,v_email,p_fingerprint,p_staff_kind) returning * into v_job;
  end if;
  v_token:=gen_random_uuid();
  update private.staff_account_jobs set lease_token=v_token,lease_until=now()+interval '90 seconds' where id=v_job.id;
  return jsonb_build_object('status','PENDING','job_id',v_job.id,'lease_token',v_token);
end $$;

-- Legacy callers create only waiters; exact pending jobs remain recoverable.
create or replace function public.staff_prepare_account(p_restaurant_id uuid,p_branch_id uuid,p_full_name text,p_email text,p_fingerprint text,p_request_id uuid)
returns jsonb language sql security definer set search_path='' as $$
  select public.staff_prepare_account(p_restaurant_id,p_branch_id,p_full_name,p_email,p_fingerprint,p_request_id,'WAITER');
$$;

create or replace function public.staff_complete_account(p_job_id uuid,p_lease_token uuid,p_user_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_job private.staff_account_jobs; v_member uuid;
begin
  select * into v_job from private.staff_account_jobs where id=p_job_id and actor_id=auth.uid() for update;
  if not found or not private.staff_can_admin(auth.uid(),v_job.restaurant_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if v_job.status='COMPLETE' then
    if not exists(select 1 from public.restaurant_members where id=v_job.member_id and user_id=p_user_id) then raise exception 'REQUEST_CONFLICT'; end if;
    return v_job.member_id;
  end if;
  if v_job.status<>'PENDING' or v_job.lease_token is distinct from p_lease_token or v_job.lease_until is null or v_job.lease_until<=now() then raise exception 'CREATION_BUSY'; end if;
  if not exists(select 1 from public.branches where id=v_job.branch_id and restaurant_id=v_job.restaurant_id and is_active) then raise exception 'INVALID_BRANCH'; end if;
  if p_user_id is null or not exists(select 1 from auth.users u join public.profiles p on p.id=u.id
    where u.id=p_user_id and lower(u.email)=v_job.email and p.is_active and u.raw_app_meta_data->>'qr_staff_job_id'=v_job.id::text)
    or exists(select 1 from public.platform_admins where user_id=p_user_id)
    or exists(select 1 from public.restaurant_members where user_id=p_user_id) then raise exception 'INVALID_STAFF'; end if;
  insert into public.restaurant_members(restaurant_id,user_id,role,branch_id,staff_kind)
    values(v_job.restaurant_id,p_user_id,'STAFF',v_job.branch_id,v_job.staff_kind) returning id into v_member;
  update public.profiles set full_name=v_job.full_name where id=p_user_id;
  update private.staff_account_jobs set status='COMPLETE',member_id=v_member,lease_token=null,lease_until=null where id=v_job.id;
  insert into public.audit_logs(restaurant_id,branch_id,actor_id,action,entity_type,entity_id,details)
    values(v_job.restaurant_id,v_job.branch_id,auth.uid(),'staff.created','restaurant_members',v_member,jsonb_build_object('user_id',p_user_id,'branch_id',v_job.branch_id,'staff_kind',v_job.staff_kind));
  return v_member;
end $$;

create or replace function public.staff_update_member(p_restaurant_id uuid,p_member_id uuid,p_branch_id uuid,p_is_active boolean,p_version integer,p_staff_kind text)
returns void language plpgsql security definer set search_path='' as $$
declare v_member public.restaurant_members;
begin
  if not private.staff_can_admin(auth.uid(),p_restaurant_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  select * into v_member from public.restaurant_members where id=p_member_id and restaurant_id=p_restaurant_id and role='STAFF' for update;
  if not found then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if not private.staff_can_admin(auth.uid(),p_restaurant_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if p_staff_kind is null or p_staff_kind not in ('WAITER','KITCHEN') then raise exception 'INVALID_STAFF'; end if;
  if p_version is null or v_member.version<>p_version then raise exception 'STALE_VERSION'; end if;
  if p_is_active is null or not exists(select 1 from public.branches where id=p_branch_id and restaurant_id=p_restaurant_id and (not p_is_active or is_active)) then raise exception 'INVALID_BRANCH'; end if;
  if v_member.branch_id=p_branch_id and v_member.is_active=p_is_active and v_member.staff_kind=p_staff_kind then return; end if;
  update public.restaurant_members set branch_id=p_branch_id,is_active=p_is_active,staff_kind=p_staff_kind where id=v_member.id;
  insert into public.audit_logs(restaurant_id,branch_id,actor_id,action,entity_type,entity_id,details)
    values(p_restaurant_id,p_branch_id,auth.uid(),'staff.updated','restaurant_members',v_member.id,
      jsonb_build_object('old_branch_id',v_member.branch_id,'branch_id',p_branch_id,'is_active',p_is_active,'old_staff_kind',v_member.staff_kind,'staff_kind',p_staff_kind));
end $$;

-- Older browser forms keep the assigned role instead of resetting it.
create or replace function public.staff_update_member(p_restaurant_id uuid,p_member_id uuid,p_branch_id uuid,p_is_active boolean,p_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_member public.restaurant_members;
begin
  if not private.staff_can_admin(auth.uid(),p_restaurant_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  select * into v_member from public.restaurant_members where id=p_member_id and restaurant_id=p_restaurant_id and role='STAFF' for update;
  if not found then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  perform public.staff_update_member(p_restaurant_id,p_member_id,p_branch_id,p_is_active,p_version,v_member.staff_kind);
end $$;
revoke all on function public.staff_prepare_account(uuid,uuid,text,text,text,uuid,text),
  public.staff_update_member(uuid,uuid,uuid,boolean,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.staff_prepare_account(uuid,uuid,text,text,text,uuid,text),
  public.staff_update_member(uuid,uuid,uuid,boolean,integer,text) to authenticated;

create or replace function public.qr_staff_board(p_restaurant_id uuid,p_branch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  return jsonb_build_object('can_prepare',private.qr_branch_role(p_restaurant_id,p_branch_id)='OWNER','viewer_role',private.qr_branch_role(p_restaurant_id,p_branch_id),'sound_enabled',coalesce((select sound_enabled from public.restaurant_settings where restaurant_id=p_restaurant_id),true),'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'version',s.version,'table_name',s.table_name,'table_number',s.table_number,'opened_at',s.opened_at,
    'total',coalesce((select sum(o.total_amount) from public.qr_orders o where o.session_id=s.id and o.status<>'CANCELLED'),0),
    'payment_total',coalesce((select sum(o.total_amount) from public.qr_orders o where o.session_id=s.id and o.status<>'CANCELLED'),0)::text,
    'currency',coalesce((select o.currency from public.qr_orders o where o.session_id=s.id order by o.created_at limit 1),'AZN'),
    'orders',coalesce((select jsonb_agg(private.qr_order_json(o.id) order by o.created_at) from public.qr_orders o where o.session_id=s.id),'[]'::jsonb),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'payment_method',c.payment_method,'status',c.status,'version',c.version,'created_at',c.created_at) order by c.created_at) from public.qr_service_requests c where c.session_id=s.id and c.status<>'DONE'),'[]'::jsonb)) order by s.table_number)
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
  if not found then raise exception 'TABLE_CLOSED'; end if;
  if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if v_session.status='CLOSED' then raise exception 'TABLE_CLOSED'; end if;
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
  insert into public.audit_logs(restaurant_id,branch_id,actor_id,action,entity_type,entity_id,details)
    values(p_restaurant_id,p_branch_id,auth.uid(),'qr.staff_action','qr_'||lower(p_kind),p_id,jsonb_build_object('status',p_status,'version',p_version));
  return public.qr_staff_board(p_restaurant_id,p_branch_id);
end $$;

create index if not exists qr_kitchen_active_orders on public.qr_orders(branch_id,created_at,id)
  where status in ('NEW','ACCEPTED','PREPARING','READY');

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
  if not private.qr_can_kitchen(p_restaurant_id,p_branch_id) then
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
  if not private.qr_can_kitchen(p_restaurant_id,p_branch_id) then
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
      'total',p_log.details->'total','table_number',p_log.details->'table_number',
      'allowed_radius_meters',p_log.details->'allowed_radius_meters',
      'created_products',p_log.details->'products_created','updated_products',p_log.details->'products_updated','created_categories',p_log.details->'categories_created','skipped_products',p_log.details->'products_skipped',
      'old_branch_name',(select name from public.branches where restaurant_id=p_log.restaurant_id and id::text=p_log.details->>'old_branch_id'),
      'branch_name',(select name from public.branches where restaurant_id=p_log.restaurant_id and id::text=p_log.details->>'branch_id')
    )));
end $$;

commit;
