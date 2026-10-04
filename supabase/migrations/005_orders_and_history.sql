begin;

-- Restoran üzrə sifariş nömrəsini ayıran daxili sayğac
create table private.order_counters (
  restaurant_id uuid primary key
    references public.restaurants(id) on delete restrict,

  last_number bigint not null default 0
    check (last_number >= 0)
);

revoke all on private.order_counters
  from public, anon, authenticated;

-- Sifarişin əsas qeydi
create table public.orders (
  id uuid primary key default gen_random_uuid(),

  restaurant_id uuid not null
    references public.restaurants(id) on delete restrict,

  branch_id uuid not null,
  table_id uuid not null,

  table_name text not null
    check (length(trim(table_name)) > 0),

  order_number bigint not null
    check (order_number > 0),

  status text not null default 'NEW'
    check (
      status in (
        'NEW', 'PREPARING', 'READY',
        'COMPLETED', 'CANCELLED'
      )
    ),

  total_amount numeric(10,2) not null
    check (
      total_amount >= 0
      and total_amount <> 'NaN'::numeric
    ),

  currency text not null default 'AZN'
    check (currency ~ '^[A-Z]{3}$'),

  note text check (length(note) <= 1000),

  -- Eyni göndərmənin təkrarlanmasını müəyyən edir.
  idempotency_key uuid not null,

  request_payload jsonb not null
    check (jsonb_typeof(request_payload) = 'object'),

  -- Müştərinin öz sifarişini izləməsi üçündür.
  tracking_token uuid not null unique
    default gen_random_uuid(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, restaurant_id),
  unique (restaurant_id, order_number),
  unique (restaurant_id, idempotency_key),

  foreign key (branch_id, restaurant_id)
    references public.branches(id, restaurant_id)
    on delete restrict,

  foreign key (table_id, branch_id, restaurant_id)
    references public.tables(id, branch_id, restaurant_id)
    on delete restrict
);

-- Məhsul adı və qiyməti sifariş anındakı məlumatlardır.
create table public.order_items (
  id uuid primary key default gen_random_uuid(),

  restaurant_id uuid not null
    references public.restaurants(id) on delete restrict,

  order_id uuid not null,
  product_id uuid not null,

  product_name text not null
    check (length(trim(product_name)) > 0),

  unit_price numeric(10,2) not null
    check (
      unit_price >= 0
      and unit_price <> 'NaN'::numeric
    ),

  quantity integer not null
    check (quantity between 1 and 99),

  line_total numeric(12,2)
    generated always as (unit_price * quantity) stored,

  note text check (length(note) <= 500),

  created_at timestamptz not null default now(),

  foreign key (order_id, restaurant_id)
    references public.orders(id, restaurant_id)
    on delete restrict,

  foreign key (product_id, restaurant_id)
    references public.products(id, restaurant_id)
    on delete restrict
);

-- Sifarişin status tarixçəsi
create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),

  restaurant_id uuid not null
    references public.restaurants(id) on delete restrict,

  order_id uuid not null,

  from_status text,
  to_status text not null,

  changed_by uuid
    references public.profiles(id) on delete set null,

  reason text check (length(reason) <= 1000),

  created_at timestamptz not null default now(),

  foreign key (order_id, restaurant_id)
    references public.orders(id, restaurant_id)
    on delete restrict,

  check (
    (from_status is null and to_status = 'NEW')
    or (
      from_status is not null and (
        (
          from_status = 'NEW'
          and to_status in ('PREPARING', 'CANCELLED')
        )
        or (
          from_status = 'PREPARING'
          and to_status in ('READY', 'CANCELLED')
        )
        or (
          from_status = 'READY'
          and to_status in ('COMPLETED', 'CANCELLED')
        )
      )
    )
  )
);

-- Platform və restoran əməliyyatlarının tarixçəsi
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),

  restaurant_id uuid
    references public.restaurants(id) on delete restrict,

  branch_id uuid,

  actor_id uuid
    references public.profiles(id) on delete set null,

  action text not null
    check (length(trim(action)) > 0),

  entity_type text not null
    check (length(trim(entity_type)) > 0),

  entity_id uuid,

  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),

  created_at timestamptz not null default now(),

  check (
    branch_id is null or restaurant_id is not null
  ),

  foreign key (branch_id, restaurant_id)
    references public.branches(id, restaurant_id)
    on delete restrict
);

-- İndekslər
create index orders_branch_status_date_idx
  on public.orders(
    restaurant_id, branch_id, status, created_at desc
  );

create index orders_table_date_idx
  on public.orders(table_id, created_at desc);

create index order_items_order_idx
  on public.order_items(order_id, restaurant_id);

create index order_items_product_idx
  on public.order_items(product_id, restaurant_id);

create index order_status_history_order_date_idx
  on public.order_status_history(
    order_id, restaurant_id, created_at
  );

create index audit_logs_restaurant_date_idx
  on public.audit_logs(restaurant_id, created_at desc);

create index audit_logs_branch_idx
  on public.audit_logs(branch_id, restaurant_id);

create trigger orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

-- Birbaşa sifariş və tarixçə yazmaq bağlıdır.
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.audit_logs enable row level security;

revoke all on table
  public.orders,
  public.order_items,
  public.order_status_history,
  public.audit_logs
from anon, authenticated;

grant select on table
  public.orders,
  public.order_items,
  public.order_status_history,
  public.audit_logs
to authenticated;

-- Sifarişləri rol və filial əsasında oxumaq
create policy orders_read
on public.orders for select to authenticated
using (
  private.can_read_branch(restaurant_id, branch_id)
);

create policy order_items_read
on public.order_items for select to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and o.restaurant_id = order_items.restaurant_id
  )
);

create policy order_status_history_read
on public.order_status_history
for select to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_status_history.order_id
      and o.restaurant_id =
        order_status_history.restaurant_id
  )
);

-- Audit tarixçəsi yalnız adminlərə açıqdır.
create policy audit_logs_read
on public.audit_logs for select to authenticated
using (
  (select private.is_super_admin())
  or private.has_restaurant_role(
    restaurant_id, 'RESTAURANT_ADMIN'
  )
);

-- Sifariş cədvəlini Realtime üçün hazırlayır.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) then
    execute 'create publication supabase_realtime';
  end if;

  execute
    'alter publication supabase_realtime add table public.orders';
end;
$$;

commit;