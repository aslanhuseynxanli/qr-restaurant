begin;

-- İstifadəçi profilləri
create table public.profiles (
  id uuid primary key
    references auth.users(id) on delete cascade,

  full_name text not null default '',
  phone text,
  avatar_url text,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Platformanın Super Admin hesabları
create table public.platform_admins (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null unique
    references public.profiles(id) on delete cascade,

  role text not null default 'SUPER_ADMIN'
    check (role = 'SUPER_ADMIN'),

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Restoran adminləri və işçiləri
create table public.restaurant_members (
  id uuid primary key default gen_random_uuid(),

  restaurant_id uuid not null
    references public.restaurants(id) on delete restrict,

  user_id uuid not null
    references public.profiles(id) on delete cascade,

  role text not null
    check (role in ('RESTAURANT_ADMIN', 'STAFF')),

  branch_id uuid,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Bir istifadəçinin bir restoranda bir üzvlüyü olur.
  unique (restaurant_id, user_id),

  -- Filial mütləq üzvlüyün restoranına aid olmalıdır.
  foreign key (branch_id, restaurant_id)
    references public.branches(id, restaurant_id)
    on delete restrict,

  -- Admin bütün filiallara, işçi konkret filiala bağlıdır.
  check (
    (role = 'RESTAURANT_ADMIN' and branch_id is null)
    or
    (role = 'STAFF' and branch_id is not null)
  )
);

create index restaurant_members_user_id_idx
  on public.restaurant_members(user_id);

create index restaurant_members_branch_idx
  on public.restaurant_members(branch_id, restaurant_id);

-- Dəyişiklik vaxtını avtomatik yeniləyir.
create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger platform_admins_updated_at
before update on public.platform_admins
for each row execute function public.set_updated_at();

create trigger restaurant_members_updated_at
before update on public.restaurant_members
for each row execute function public.set_updated_at();

-- Auth-da istifadəçi yarananda profil də yaranır.
-- Bu funksiya istifadəçiyə heç bir admin rolu vermir.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Əvvəldən yaradılmış istifadəçilərin profilləri
insert into public.profiles (id, full_name)
select
  id,
  coalesce(raw_user_meta_data ->> 'full_name', '')
from auth.users
on conflict (id) do nothing;

-- Təhlükəsizlik
alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.restaurant_members enable row level security;

revoke all on table
  public.profiles,
  public.platform_admins,
  public.restaurant_members
from anon, authenticated;

grant usage on schema public to authenticated;

-- İstifadəçi öz profilini və rol qeydlərini oxuya bilər.
grant select on table
  public.profiles,
  public.platform_admins,
  public.restaurant_members
to authenticated;

-- Öz profilində yalnız bu məlumatları dəyişə bilər.
grant update (full_name, phone, avatar_url)
  on public.profiles to authenticated;

create policy profiles_read_own
on public.profiles
for select to authenticated
using (id = (select auth.uid()));

create policy profiles_update_own
on public.profiles
for update to authenticated
using (
  id = (select auth.uid()) and is_active = true
)
with check (
  id = (select auth.uid()) and is_active = true
);

create policy platform_admins_read_own
on public.platform_admins
for select to authenticated
using (user_id = (select auth.uid()));

create policy restaurant_members_read_own
on public.restaurant_members
for select to authenticated
using (user_id = (select auth.uid()));

commit;