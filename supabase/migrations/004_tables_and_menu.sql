begin;

-- Masalar və QR tokenləri
create table public.tables (
  id uuid primary key default gen_random_uuid(),

  restaurant_id uuid not null
    references public.restaurants(id) on delete restrict,

  branch_id uuid not null,

  name text not null check (length(trim(name)) > 0),
  table_number integer not null check (table_number > 0),

  qr_token text not null unique
    default replace(gen_random_uuid()::text, '-', '')
    check (qr_token ~ '^[a-f0-9]{32}$'),

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (branch_id, table_number),
  unique (id, branch_id, restaurant_id),

  foreign key (branch_id, restaurant_id)
    references public.branches(id, restaurant_id)
    on delete restrict
);

-- Kateqoriyalar restoran səviyyəsindədir.
create table public.categories (
  id uuid primary key default gen_random_uuid(),

  restaurant_id uuid not null
    references public.restaurants(id) on delete restrict,

  name text not null check (length(trim(name)) > 0),
  description text,
  image_url text,

  sort_order integer not null default 0
    check (sort_order >= 0),

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, restaurant_id)
);

-- Məhsulun əsas məlumatları
create table public.products (
  id uuid primary key default gen_random_uuid(),

  restaurant_id uuid not null
    references public.restaurants(id) on delete restrict,

  category_id uuid not null,

  name text not null check (length(trim(name)) > 0),
  description text,

  base_price numeric(10,2) not null
    check (
      base_price >= 0
      and base_price <> 'NaN'::numeric
    ),

  image_url text,

  sort_order integer not null default 0
    check (sort_order >= 0),

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, restaurant_id),

  foreign key (category_id, restaurant_id)
    references public.categories(id, restaurant_id)
    on delete restrict
);

-- Filial üzrə qiymət və mövcudluq
create table public.branch_product_settings (
  id uuid primary key default gen_random_uuid(),

  restaurant_id uuid not null
    references public.restaurants(id) on delete restrict,

  branch_id uuid not null,
  product_id uuid not null,

  price_override numeric(10,2)
    check (
      price_override >= 0
      and price_override <> 'NaN'::numeric
    ),

  is_available boolean not null default true,
  is_visible boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (branch_id, product_id),

  foreign key (branch_id, restaurant_id)
    references public.branches(id, restaurant_id)
    on delete restrict,

  foreign key (product_id, restaurant_id)
    references public.products(id, restaurant_id)
    on delete restrict
);

-- İndekslər
create index categories_restaurant_sort_idx
  on public.categories(restaurant_id, sort_order);

create index products_restaurant_category_sort_idx
  on public.products(
    restaurant_id, category_id, sort_order
  );

create index branch_product_settings_product_idx
  on public.branch_product_settings(
    product_id, restaurant_id
  );

-- Dəyişiklik vaxtı
create trigger tables_updated_at
before update on public.tables
for each row execute function public.set_updated_at();

create trigger categories_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

create trigger products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create trigger branch_product_settings_updated_at
before update on public.branch_product_settings
for each row execute function public.set_updated_at();

-- Təhlükəsizlik
alter table public.tables enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.branch_product_settings enable row level security;

revoke all on table
  public.tables,
  public.categories,
  public.products,
  public.branch_product_settings
from anon, authenticated;

grant select, insert on table
  public.tables,
  public.categories,
  public.products,
  public.branch_product_settings
to authenticated;

-- Restoran və filial aidiyyətini dəyişmək icazəsi verilmir.
grant update (
  name, table_number, qr_token, is_active
) on public.tables to authenticated;

grant update (
  name, description, image_url, sort_order, is_active
) on public.categories to authenticated;

grant update (
  category_id, name, description, base_price,
  image_url, sort_order, is_active
) on public.products to authenticated;

grant update (
  price_override, is_available, is_visible
) on public.branch_product_settings to authenticated;

-- Masalar
create policy tables_read
on public.tables for select to authenticated
using (
  private.can_read_branch(restaurant_id, branch_id)
);

create policy tables_create
on public.tables for insert to authenticated
with check (
  (select private.is_super_admin())
  or private.has_restaurant_role(
    restaurant_id, 'RESTAURANT_ADMIN'
  )
);

create policy tables_edit
on public.tables for update to authenticated
using (
  (select private.is_super_admin())
  or private.has_restaurant_role(
    restaurant_id, 'RESTAURANT_ADMIN'
  )
)
with check (
  (select private.is_super_admin())
  or private.has_restaurant_role(
    restaurant_id, 'RESTAURANT_ADMIN'
  )
);

-- Kateqoriyalar
create policy categories_read
on public.categories for select to authenticated
using (
  (select private.is_super_admin())
  or private.has_restaurant_role(
    restaurant_id, 'RESTAURANT_ADMIN'
  )
);

create policy categories_create
on public.categories for insert to authenticated
with check (
  (select private.is_super_admin())
  or private.has_restaurant_role(
    restaurant_id, 'RESTAURANT_ADMIN'
  )
);

create policy categories_edit
on public.categories for update to authenticated
using (
  (select private.is_super_admin())
  or private.has_restaurant_role(
    restaurant_id, 'RESTAURANT_ADMIN'
  )
)
with check (
  (select private.is_super_admin())
  or private.has_restaurant_role(
    restaurant_id, 'RESTAURANT_ADMIN'
  )
);

-- Məhsullar
create policy products_read
on public.products for select to authenticated
using (
  (select private.is_super_admin())
  or private.has_restaurant_role(
    restaurant_id, 'RESTAURANT_ADMIN'
  )
);

create policy products_create
on public.products for insert to authenticated
with check (
  (select private.is_super_admin())
  or private.has_restaurant_role(
    restaurant_id, 'RESTAURANT_ADMIN'
  )
);

create policy products_edit
on public.products for update to authenticated
using (
  (select private.is_super_admin())
  or private.has_restaurant_role(
    restaurant_id, 'RESTAURANT_ADMIN'
  )
)
with check (
  (select private.is_super_admin())
  or private.has_restaurant_role(
    restaurant_id, 'RESTAURANT_ADMIN'
  )
);

-- Filial üzrə məhsul ayarları
create policy branch_product_settings_read
on public.branch_product_settings
for select to authenticated
using (
  private.can_read_branch(restaurant_id, branch_id)
);

create policy branch_product_settings_create
on public.branch_product_settings
for insert to authenticated
with check (
  (select private.is_super_admin())
  or private.has_restaurant_role(
    restaurant_id, 'RESTAURANT_ADMIN'
  )
);

create policy branch_product_settings_edit
on public.branch_product_settings
for update to authenticated
using (
  (select private.is_super_admin())
  or private.has_restaurant_role(
    restaurant_id, 'RESTAURANT_ADMIN'
  )
)
with check (
  (select private.is_super_admin())
  or private.has_restaurant_role(
    restaurant_id, 'RESTAURANT_ADMIN'
  )
);

commit;