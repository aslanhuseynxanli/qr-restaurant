begin;

alter table public.restaurant_members add column if not exists version integer not null default 1;
create or replace function private.staff_member_version()
returns trigger language plpgsql set search_path='' as $$
begin new.version:=old.version+1; return new; end $$;
drop trigger if exists restaurant_members_version on public.restaurant_members;
create trigger restaurant_members_version before update on public.restaurant_members
for each row execute function private.staff_member_version();
revoke all on function private.staff_member_version() from public,anon,authenticated;

-- No passwords are stored. The fingerprint is keyed with the server secret.
create table if not exists private.staff_account_jobs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  restaurant_id uuid not null references public.restaurants(id),
  branch_id uuid not null references public.branches(id),
  full_name text not null,
  email text not null,
  fingerprint text not null,
  status text not null default 'PENDING' check(status in ('PENDING','COMPLETE','FAILED')),
  member_id uuid references public.restaurant_members(id) on delete set null,
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  unique(actor_id,request_id)
);
create unique index if not exists staff_pending_email on private.staff_account_jobs(actor_id,restaurant_id,email) where status='PENDING';
create index if not exists staff_jobs_created on private.staff_account_jobs(actor_id,created_at);
revoke all on private.staff_account_jobs from public,anon,authenticated,service_role;

create or replace function private.staff_can_admin(p_actor uuid,p_restaurant uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=p_actor and is_active)
    and exists(select 1 from public.restaurants where id=p_restaurant and is_active and status in ('active','trial'))
    and (exists(select 1 from public.platform_admins where user_id=p_actor and is_active)
      or exists(select 1 from public.restaurant_members where user_id=p_actor and restaurant_id=p_restaurant and role='RESTAURANT_ADMIN' and is_active));
$$;
revoke all on function private.staff_can_admin(uuid,uuid) from public,anon,authenticated;

create or replace function public.staff_management_board(p_restaurant_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not private.staff_can_admin(auth.uid(),p_restaurant_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  return jsonb_build_object(
    'restaurant_name',(select name from public.restaurants where id=p_restaurant_id),
    'branches',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'is_active',is_active) order by name)
      from public.branches where restaurant_id=p_restaurant_id),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'user_id',m.user_id,'full_name',p.full_name,'email',u.email,
      'branch_id',m.branch_id,'is_active',m.is_active,'profile_active',p.is_active,'version',m.version) order by m.created_at desc)
      from public.restaurant_members m join public.profiles p on p.id=m.user_id join auth.users u on u.id=m.user_id
      where m.restaurant_id=p_restaurant_id and m.role='STAFF'),'[]'::jsonb));
end $$;

create or replace function public.staff_prepare_account(p_restaurant_id uuid,p_branch_id uuid,p_full_name text,p_email text,p_fingerprint text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_job private.staff_account_jobs; v_token uuid; v_name text:=btrim(p_full_name); v_email text:=lower(btrim(p_email));
begin
  if not private.staff_can_admin(v_actor,p_restaurant_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if p_request_id is null or v_name is null or length(v_name) not between 1 and 150 or v_email is null
    or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_STAFF'; end if;
  if not exists(select 1 from public.branches where id=p_branch_id and restaurant_id=p_restaurant_id and is_active) then raise exception 'INVALID_BRANCH'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-account:'||v_actor::text,0));
  select * into v_job from private.staff_account_jobs where actor_id=v_actor and request_id=p_request_id for update;
  if not found then
    -- A refresh may have lost the request ID after Auth committed. Resume the exact same attempt.
    select * into v_job from private.staff_account_jobs where actor_id=v_actor and restaurant_id=p_restaurant_id and email=v_email and status='PENDING' for update;
    if found and (v_job.fingerprint<>p_fingerprint or v_job.branch_id<>p_branch_id or v_job.full_name<>v_name) then
      if v_job.lease_until>now() then raise exception 'CREATION_BUSY'; end if;
      if exists(select 1 from auth.users where lower(email)=v_email and raw_app_meta_data->>'qr_staff_job_id'=v_job.id::text) then raise exception 'PENDING_ACCOUNT'; end if;
      update private.staff_account_jobs set status='FAILED',lease_token=null,lease_until=null where id=v_job.id;
      v_job:=null;
    end if;
  end if;
  if v_job.id is not null then
    if v_job.restaurant_id<>p_restaurant_id or v_job.branch_id<>p_branch_id or v_job.full_name<>v_name or v_job.email<>v_email or v_job.fingerprint<>p_fingerprint then raise exception 'REQUEST_CONFLICT'; end if;
    if v_job.status='COMPLETE' then
      if v_job.member_id is null then raise exception 'INVALID_STAFF'; end if;
      return jsonb_build_object('status','COMPLETE','member_id',v_job.member_id);
    end if;
    if v_job.status='FAILED' then raise exception 'REQUEST_CONFLICT'; end if;
    if v_job.lease_until>now() then raise exception 'CREATION_BUSY'; end if;
  else
    if (select count(*) from private.staff_account_jobs where actor_id=v_actor and created_at>now()-interval '1 hour')>=30 then raise exception 'TOO_MANY_REQUESTS'; end if;
    insert into private.staff_account_jobs(actor_id,request_id,restaurant_id,branch_id,full_name,email,fingerprint)
      values(v_actor,p_request_id,p_restaurant_id,p_branch_id,v_name,v_email,p_fingerprint) returning * into v_job;
  end if;
  v_token:=gen_random_uuid();
  update private.staff_account_jobs set lease_token=v_token,lease_until=now()+interval '90 seconds' where id=v_job.id;
  return jsonb_build_object('status','PENDING','job_id',v_job.id,'lease_token',v_token);
end $$;

-- Only the backend can resolve a newly-created Auth account. Existing accounts never qualify.
create or replace function public.staff_created_user(p_job_id uuid,p_lease_token uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_job private.staff_account_jobs; v_id uuid;
begin
  select * into v_job from private.staff_account_jobs where id=p_job_id and status='PENDING' and lease_token=p_lease_token and lease_until>now();
  if not found or not private.staff_can_admin(v_job.actor_id,v_job.restaurant_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  select id into v_id from auth.users where lower(email)=v_job.email
    and raw_app_meta_data->>'qr_staff_job_id'=v_job.id::text;
  return v_id;
end $$;

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
  insert into public.restaurant_members(restaurant_id,user_id,role,branch_id)
    values(v_job.restaurant_id,p_user_id,'STAFF',v_job.branch_id) returning id into v_member;
  update public.profiles set full_name=v_job.full_name where id=p_user_id;
  update private.staff_account_jobs set status='COMPLETE',member_id=v_member,lease_token=null,lease_until=null where id=v_job.id;
  insert into public.audit_logs(restaurant_id,branch_id,actor_id,action,entity_type,entity_id,details)
    values(v_job.restaurant_id,v_job.branch_id,auth.uid(),'staff.created','restaurant_members',v_member,jsonb_build_object('user_id',p_user_id,'branch_id',v_job.branch_id));
  return v_member;
end $$;

create or replace function public.staff_release_account(p_job_id uuid,p_lease_token uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update private.staff_account_jobs set lease_token=null,lease_until=null
    where id=p_job_id and actor_id=auth.uid() and status='PENDING' and lease_token=p_lease_token;
end $$;

create or replace function public.staff_update_member(p_restaurant_id uuid,p_member_id uuid,p_branch_id uuid,p_is_active boolean,p_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_member public.restaurant_members;
begin
  if not private.staff_can_admin(auth.uid(),p_restaurant_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  select * into v_member from public.restaurant_members where id=p_member_id and restaurant_id=p_restaurant_id and role='STAFF' for update;
  if not found then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if p_version is null or v_member.version<>p_version then raise exception 'STALE_VERSION'; end if;
  if p_is_active is null or not exists(select 1 from public.branches where id=p_branch_id and restaurant_id=p_restaurant_id and (not p_is_active or is_active)) then raise exception 'INVALID_BRANCH'; end if;
  if v_member.branch_id=p_branch_id and v_member.is_active=p_is_active then return; end if;
  update public.restaurant_members set branch_id=p_branch_id,is_active=p_is_active where id=v_member.id;
  insert into public.audit_logs(restaurant_id,branch_id,actor_id,action,entity_type,entity_id,details)
    values(p_restaurant_id,p_branch_id,auth.uid(),'staff.updated','restaurant_members',v_member.id,
      jsonb_build_object('old_branch_id',v_member.branch_id,'branch_id',p_branch_id,'is_active',p_is_active));
end $$;

revoke insert,update,delete on public.restaurant_members from authenticated;
revoke update(role,branch_id,is_active) on public.restaurant_members from authenticated;

revoke all on function public.staff_management_board(uuid),public.staff_prepare_account(uuid,uuid,text,text,text,uuid),
  public.staff_complete_account(uuid,uuid,uuid),public.staff_release_account(uuid,uuid),public.staff_update_member(uuid,uuid,uuid,boolean,integer)
  from public,anon,authenticated;
grant execute on function public.staff_management_board(uuid),public.staff_prepare_account(uuid,uuid,text,text,text,uuid),
  public.staff_complete_account(uuid,uuid,uuid),public.staff_release_account(uuid,uuid),public.staff_update_member(uuid,uuid,uuid,boolean,integer)
  to authenticated;
revoke all on function public.staff_created_user(uuid,uuid) from public,anon,authenticated;
grant execute on function public.staff_created_user(uuid,uuid) to service_role;

-- Owners may manage inactive branches; staff lose access when their branch is deactivated.
create or replace function private.qr_can_manage_branch(p_restaurant_id uuid,p_branch_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
    and exists(select 1 from public.profiles where id=auth.uid() and is_active)
    and exists(select 1 from public.branches b join public.restaurants r on r.id=b.restaurant_id
      where b.id=p_branch_id and r.id=p_restaurant_id and r.is_active and r.status in ('trial','active'))
    and (private.is_super_admin() or exists(select 1 from public.restaurant_members m
      where m.user_id=auth.uid() and m.restaurant_id=p_restaurant_id and m.is_active
        and (m.role='RESTAURANT_ADMIN' or (m.role='STAFF' and m.branch_id=p_branch_id
          and exists(select 1 from public.branches where id=p_branch_id and is_active)))));
$$;

commit;
