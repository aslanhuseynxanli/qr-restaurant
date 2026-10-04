begin;

-- Restoranlar
create table public.restaurants (
  id uuid primary key default gen_random_uuid(),

  name text not null check (length(trim(name)) > 0),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  logo_url text,
  phone text,
  email text,

  status text not null default 'trial'
    check (status in ('active', 'trial', 'suspended')),

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Filiallar
create table public.branches (
  id uuid primary key default gen_random_uuid(),

  restaurant_id uuid not null
    references public.restaurants(id) on delete restrict,

  name text not null check (length(trim(name)) > 0),
  address text,
  phone text,

  latitude numeric(9,6) not null
    check (latitude between -90 and 90),

  longitude numeric(9,6) not null
    check (longitude between -180 and 180),

  allowed_radius_meters integer not null default 150
    check (allowed_radius_meters > 0),

  is_active boolean not null default true,
  accepting_orders boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Sonrakı cədvəllərdə filialın restoranını da yoxlayacağıq.
  unique (id, restaurant_id)
);

create index branches_restaurant_id_idx
  on public.branches(restaurant_id);

-- Hər restoran üçün bir ayarlar qeydi
create table public.restaurant_settings (
  id uuid primary key default gen_random_uuid(),

  restaurant_id uuid not null unique
    references public.restaurants(id) on delete restrict,

  currency text not null default 'AZN'
    check (currency ~ '^[A-Z]{3}$'),

  language text not null default 'az',

  order_enabled boolean not null default true,
  location_check_enabled boolean not null default true,

  default_location_radius integer not null default 150
    check (default_location_radius > 0),

  sound_enabled boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Dəyişiklik vaxtını avtomatik yeniləyir.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger restaurants_updated_at
before update on public.restaurants
for each row execute function public.set_updated_at();

create trigger branches_updated_at
before update on public.branches
for each row execute function public.set_updated_at();

create trigger restaurant_settings_updated_at
before update on public.restaurant_settings
for each row execute function public.set_updated_at();

-- Giriş qaydaları qurulana qədər vebdən məlumatlara giriş bağlıdır.
alter table public.restaurants enable row level security;
alter table public.branches enable row level security;
alter table public.restaurant_settings enable row level security;

revoke all on table
  public.restaurants,
  public.branches,
  public.restaurant_settings
from anon, authenticated;

commit;