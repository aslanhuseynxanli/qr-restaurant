begin;

-- Email, IP, şifrə və bərpa tokeni bu cədvəllərə açıq mətnlə yazılmır.
create table if not exists private.account_auth_limits (
  kind text not null check (kind in ('RESET_EMAIL','RESET_IP','VERIFY','CHANGE')),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  hits integer not null check (hits > 0),
  primary key (kind,key_hash)
);
create table if not exists private.account_recovery_grants (
  grant_hash text primary key check (grant_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null,
  expires_at timestamptz not null
);
create index if not exists account_recovery_user_idx on private.account_recovery_grants(user_id);
alter table private.account_auth_limits enable row level security;
alter table private.account_recovery_grants enable row level security;
revoke all on private.account_auth_limits,private.account_recovery_grants from public,anon,authenticated,service_role;

create or replace function public.account_auth_limit(p_kind text,p_key_hash text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_seconds integer;v_limit integer;v_start timestamptz;v_hits integer;
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_AUTH_LIMIT';end if;
  case p_kind
    when 'RESET_EMAIL' then v_seconds:=3600;v_limit:=3;
    when 'RESET_IP' then v_seconds:=3600;v_limit:=20;
    when 'VERIFY' then v_seconds:=900;v_limit:=30;
    when 'CHANGE' then v_seconds:=900;v_limit:=10;
    else raise exception 'INVALID_AUTH_LIMIT';
  end case;
  v_start:=to_timestamp(floor(extract(epoch from clock_timestamp())/v_seconds)*v_seconds);
  delete from private.account_auth_limits where window_start<clock_timestamp()-interval '2 hours';
  insert into private.account_auth_limits(kind,key_hash,window_start,hits)
  values(p_kind,p_key_hash,v_start,1)
  on conflict(kind,key_hash) do update set window_start=excluded.window_start,
    hits=case when account_auth_limits.window_start=excluded.window_start then least(account_auth_limits.hits+1,1000000) else 1 end
  returning hits into v_hits;
  return v_hits<=v_limit;
end;
$$;
create or replace function public.account_recovery_open(p_user_id uuid,p_session_id uuid,p_grant_hash text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_session_id is null or p_grant_hash is null or p_grant_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_RECOVERY';end if;
  perform 1 from public.profiles where id=p_user_id and is_active for update;
  if not found then raise exception 'INACTIVE_ACCOUNT';end if;
  delete from private.account_recovery_grants where user_id=p_user_id or expires_at<=clock_timestamp();
  insert into private.account_recovery_grants(grant_hash,user_id,session_id,expires_at)
  values(p_grant_hash,p_user_id,p_session_id,clock_timestamp()+interval '15 minutes');
end;
$$;
create or replace function public.account_recovery_check(p_user_id uuid,p_session_id uuid,p_grant_hash text)
returns boolean language sql security definer set search_path='' as $$
  select exists(select 1 from private.account_recovery_grants g join public.profiles p on p.id=g.user_id
    where g.user_id=p_user_id and g.session_id=p_session_id and g.grant_hash=p_grant_hash
    and g.expires_at>clock_timestamp() and p.is_active);
$$;
create or replace function public.account_recovery_claim(p_user_id uuid,p_session_id uuid,p_grant_hash text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_claimed text;
begin
  delete from private.account_recovery_grants g where g.user_id=p_user_id and g.session_id=p_session_id
    and g.grant_hash=p_grant_hash and g.expires_at>clock_timestamp()
    and exists(select 1 from public.profiles p where p.id=g.user_id and p.is_active)
    returning grant_hash into v_claimed;
  return v_claimed is not null;
end;
$$;
revoke all on function public.account_auth_limit(text,text),public.account_recovery_open(uuid,uuid,text),
  public.account_recovery_check(uuid,uuid,text),public.account_recovery_claim(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.account_auth_limit(text,text),public.account_recovery_open(uuid,uuid,text),
  public.account_recovery_check(uuid,uuid,text),public.account_recovery_claim(uuid,uuid,text) to service_role;
commit;
