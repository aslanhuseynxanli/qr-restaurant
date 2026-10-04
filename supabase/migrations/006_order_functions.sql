begin;

create function private.order_receipt(target_order uuid)
returns jsonb
language sql security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id,
    'order_number', o.order_number,
    'tracking_token', o.tracking_token,
    'status', o.status,
    'restaurant_name', r.name,
    'branch_name', b.name,
    'table_name', o.table_name,
    'total_amount', o.total_amount,
    'currency', o.currency,
    'note', o.note,
    'created_at', o.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_name', i.product_name,
        'unit_price', i.unit_price,
        'quantity', i.quantity,
        'line_total', i.line_total,
        'note', i.note
      ) order by i.product_name, i.id)
      from public.order_items i
      where i.order_id = o.id
        and i.restaurant_id = o.restaurant_id
    ), '[]'::jsonb)
  )
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  join public.branches b
    on b.id = o.branch_id
    and b.restaurant_id = o.restaurant_id
  where o.id = target_order;
$$;

revoke all on function private.order_receipt(uuid)
  from public, anon, authenticated;

create function public.create_order(
  p_slug text,
  p_table_token text,
  p_items jsonb,
  p_idempotency_key uuid,
  p_note text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_expected_total numeric default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_context record;
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_item jsonb;
  v_quantity numeric;
  v_item_note text;
  v_note text;
  v_validated jsonb := '[]'::jsonb;
  v_items jsonb;
  v_payload jsonb;
  v_snapshot jsonb;
  v_total numeric;
  v_count bigint;
  v_order_number bigint;
  v_h double precision;
  v_distance double precision;
begin
  if p_slug is null or length(p_slug) > 200
     or p_table_token is null
     or p_table_token !~ '^[a-f0-9]{32}$'
     or p_idempotency_key is null then
    raise exception 'Sifariş məlumatları düzgün deyil.';
  end if;

  if p_note is not null and length(p_note) > 1000 then
    raise exception 'Sifariş qeydi maksimum 1000 simvol ola bilər.';
  end if;
  v_note := btrim(coalesce(p_note, ''));

  if p_items is null
     or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Səbət düzgün formatda deyil.';
  end if;

  if jsonb_array_length(p_items) not between 1 and 50
     or octet_length(p_items::text) > 65536 then
    raise exception 'Səbətdə 1–50 məhsul sətri olmalıdır.';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item -> 'product_id')
         is distinct from 'string'
       or (v_item ->> 'product_id')
         !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_item -> 'quantity')
         is distinct from 'number' then
      raise exception 'Məhsul və miqdar məlumatları düzgün deyil.';
    end if;

    v_quantity := (v_item ->> 'quantity')::numeric;

    if v_quantity not between 1 and 99
       or v_quantity <> trunc(v_quantity) then
      raise exception 'Məhsul miqdarı 1–99 arasında tam ədəd olmalıdır.';
    end if;

    if v_item ? 'note'
       and jsonb_typeof(v_item -> 'note')
         not in ('string', 'null') then
      raise exception 'Məhsul qeydi mətn olmalıdır.';
    end if;

    v_item_note := coalesce(v_item ->> 'note', '');

    if length(v_item_note) > 500 then
      raise exception 'Məhsul qeydi maksimum 500 simvol ola bilər.';
    end if;

    v_validated := v_validated || jsonb_build_array(
      jsonb_build_object(
        'product_id', ((v_item ->> 'product_id')::uuid)::text,
        'quantity', v_quantity::integer,
        'note', btrim(v_item_note)
      )
    );
  end loop;

  select jsonb_agg(jsonb_build_object(
    'product_id', x.product_id,
    'quantity', x.quantity,
    'note', x.note
  ) order by x.product_id, x.note)
  into v_items
  from (
    select product_id, note, sum(quantity)::integer as quantity
    from jsonb_to_recordset(v_validated)
      as i(product_id uuid, quantity integer, note text)
    group by product_id, note
  ) x;

  if exists (
    select 1 from jsonb_to_recordset(v_items)
      as i(product_id uuid, quantity integer, note text)
    where i.quantity > 99
  ) then
    raise exception 'Eyni məhsul və qeyd üçün maksimum miqdar 99-dur.';
  end if;

  select
    r.id as restaurant_id,
    r.is_active as restaurant_active,
    r.status as restaurant_status,
    b.id as branch_id,
    b.is_active as branch_active,
    b.accepting_orders,
    b.latitude,
    b.longitude,
    b.allowed_radius_meters,
    t.id as table_id,
    t.name as table_name,
    t.is_active as table_active,
    s.currency,
    s.order_enabled,
    s.location_check_enabled
  into v_context
  from public.tables t
  join public.restaurants r on r.id = t.restaurant_id
  join public.branches b
    on b.id = t.branch_id
    and b.restaurant_id = t.restaurant_id
  join public.restaurant_settings s
    on s.restaurant_id = r.id
  where r.slug = p_slug
    and t.qr_token = p_table_token
  for share of r, b, t, s;

  if not found then
    raise exception 'QR kod etibarlı deyil və ya restoran ayarları hazır deyil.';
  end if;

  v_payload := jsonb_build_object(
    'table_id', v_context.table_id,
    'items', v_items,
    'note', v_note
  );

  insert into private.order_counters(restaurant_id, last_number)
  select v_context.restaurant_id, coalesce(max(order_number), 0)
  from public.orders
  where restaurant_id = v_context.restaurant_id
  on conflict (restaurant_id) do nothing;

  perform 1 from private.order_counters
  where restaurant_id = v_context.restaurant_id
  for update;

  select * into v_existing
  from public.orders
  where restaurant_id = v_context.restaurant_id
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_payload <> v_payload then
      raise exception 'Bu sifariş açarı başqa məlumatlarla istifadə edilib.';
    end if;
    return private.order_receipt(v_existing.id);
  end if;

  if not v_context.restaurant_active
     or v_context.restaurant_status not in ('active', 'trial')
     or not v_context.branch_active
     or not v_context.table_active then
    raise exception 'Bu restoran, filial və ya masa hazırda aktiv deyil.';
  end if;

  if not v_context.order_enabled
     or not v_context.accepting_orders then
    raise exception 'Bu filial hazırda sifariş qəbul etmir.';
  end if;

  if v_context.location_check_enabled then
    if p_latitude is null or p_longitude is null
       or not (p_latitude between -90 and 90)
       or not (p_longitude between -180 and 180) then
      raise exception 'Sifariş üçün məkan icazəsini aktiv edin.';
    end if;

    v_h :=
      power(
        sin(radians(
          (p_latitude - v_context.latitude::double precision) / 2
        )),
        2
      )
      + cos(radians(p_latitude))
      * cos(radians(v_context.latitude::double precision))
      * power(
        sin(radians(
          (p_longitude - v_context.longitude::double precision) / 2
        )),
        2
      );

    v_distance :=
      12742000 * asin(sqrt(greatest(0, least(1, v_h))));

    if v_distance > v_context.allowed_radius_meters then
      raise exception 'Sifariş yalnız restoranın icazə verilən ərazisindən göndərilə bilər.';
    end if;
  end if;

  select
    jsonb_agg(jsonb_build_object(
      'product_id', p.id,
      'product_name', p.name,
      'unit_price', coalesce(bs.price_override, p.base_price),
      'quantity', i.quantity,
      'note', i.note
    ) order by i.product_id, i.note),
    coalesce(
      sum(coalesce(bs.price_override, p.base_price) * i.quantity),
      0
    ),
    count(*)
  into v_snapshot, v_total, v_count
  from jsonb_to_recordset(v_items)
    as i(product_id uuid, quantity integer, note text)
  join public.products p
    on p.id = i.product_id
    and p.restaurant_id = v_context.restaurant_id
  join public.categories c
    on c.id = p.category_id
    and c.restaurant_id = p.restaurant_id
  left join public.branch_product_settings bs
    on bs.product_id = p.id
    and bs.branch_id = v_context.branch_id
    and bs.restaurant_id = p.restaurant_id
  where p.is_active
    and c.is_active
    and coalesce(bs.is_available, true)
    and coalesce(bs.is_visible, true);

  if v_count <> jsonb_array_length(v_items) then
    raise exception 'Seçilən məhsullardan biri hazırda sifariş edilə bilmir.';
  end if;

  if v_total > 99999999.99 then
    raise exception 'Sifariş məbləği icazə verilən həddi aşır.';
  end if;

  if p_expected_total is not null
     and (
       p_expected_total = 'NaN'::numeric
       or p_expected_total <> v_total
     ) then
    raise exception 'Məhsul qiyməti dəyişib. Menyunu yeniləyib məbləği yoxlayın.';
  end if;

  update private.order_counters
  set last_number = last_number + 1
  where restaurant_id = v_context.restaurant_id
  returning last_number into v_order_number;

  insert into public.orders(
    restaurant_id, branch_id, table_id, table_name,
    order_number, total_amount, currency, note,
    idempotency_key, request_payload
  ) values (
    v_context.restaurant_id,
    v_context.branch_id,
    v_context.table_id,
    v_context.table_name,
    v_order_number,
    v_total,
    v_context.currency,
    nullif(v_note, ''),
    p_idempotency_key,
    v_payload
  ) returning * into v_order;

  insert into public.order_items(
    restaurant_id, order_id, product_id, product_name,
    unit_price, quantity, note
  )
  select
    v_order.restaurant_id,
    v_order.id,
    i.product_id,
    i.product_name,
    i.unit_price,
    i.quantity,
    nullif(i.note, '')
  from jsonb_to_recordset(v_snapshot) as i(
    product_id uuid,
    product_name text,
    unit_price numeric,
    quantity integer,
    note text
  );

  insert into public.order_status_history(
    restaurant_id, order_id, to_status
  )
  values (v_order.restaurant_id, v_order.id, 'NEW');

  insert into public.audit_logs(
    restaurant_id, branch_id, action,
    entity_type, entity_id, details
  ) values (
    v_order.restaurant_id,
    v_order.branch_id,
    'order.created',
    'orders',
    v_order.id,
    jsonb_build_object(
      'source', 'QR',
      'order_number', v_order.order_number,
      'total_amount', v_order.total_amount,
      'currency', v_order.currency
    )
  );

  return private.order_receipt(v_order.id);
end;
$$;

revoke all on function public.create_order(
  text, text, jsonb, uuid, text,
  double precision, double precision, numeric
) from public, anon, authenticated;

grant execute on function public.create_order(
  text, text, jsonb, uuid, text,
  double precision, double precision, numeric
) to anon, authenticated;

create function public.get_order_receipt(p_tracking_token uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.orders
  where tracking_token = p_tracking_token;

  if not found then
    raise exception 'Sifariş tapılmadı.';
  end if;

  return private.order_receipt(v_id);
end;
$$;

revoke all on function public.get_order_receipt(uuid)
  from public, anon, authenticated;

grant execute on function public.get_order_receipt(uuid)
  to anon, authenticated;

create function public.change_order_status(
  p_order_id uuid,
  p_expected_status text,
  p_new_status text,
  p_reason text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_actor uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_actor is null then
    raise exception 'Daxil olmaq lazımdır.' using errcode = '42501';
  end if;

  if p_expected_status is null or p_new_status is null
     or p_expected_status not in (
       'NEW', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'
     )
     or p_new_status not in (
       'NEW', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'
     ) then
    raise exception 'Status düzgün deyil.';
  end if;

  if p_reason is not null and length(p_reason) > 1000 then
    raise exception 'Səbəb maksimum 1000 simvol ola bilər.';
  end if;

  if p_new_status = 'CANCELLED' and v_reason = '' then
    raise exception 'Ləğvetmə səbəbini yazın.';
  end if;

  select * into v_order from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Bu sifarişə giriş icazəsi yoxdur.'
      using errcode = '42501';
  end if;

  if not private.can_read_branch(
    v_order.restaurant_id, v_order.branch_id
  ) then
    raise exception 'Bu sifarişə giriş icazəsi yoxdur.'
      using errcode = '42501';
  end if;

  if v_order.status = p_new_status then
    return private.order_receipt(v_order.id);
  end if;

  if v_order.status <> p_expected_status then
    raise exception 'Sifarişin statusu artıq dəyişib. Siyahını yeniləyin.';
  end if;

  if not (
    (v_order.status = 'NEW'
      and p_new_status in ('PREPARING', 'CANCELLED'))
    or (v_order.status = 'PREPARING'
      and p_new_status in ('READY', 'CANCELLED'))
    or (v_order.status = 'READY'
      and p_new_status in ('COMPLETED', 'CANCELLED'))
  ) then
    raise exception 'Bu status keçidinə icazə verilmir.';
  end if;

  update public.orders
  set status = p_new_status
  where id = v_order.id;

  insert into public.order_status_history(
    restaurant_id, order_id, from_status,
    to_status, changed_by, reason
  ) values (
    v_order.restaurant_id,
    v_order.id,
    v_order.status,
    p_new_status,
    v_actor,
    nullif(v_reason, '')
  );

  insert into public.audit_logs(
    restaurant_id, branch_id, actor_id, action,
    entity_type, entity_id, details
  ) values (
    v_order.restaurant_id,
    v_order.branch_id,
    v_actor,
    'order.status_changed',
    'orders',
    v_order.id,
    jsonb_build_object(
      'from_status', v_order.status,
      'to_status', p_new_status,
      'reason', nullif(v_reason, '')
    )
  );

  return private.order_receipt(v_order.id);
end;
$$;

revoke all on function public.change_order_status(
  uuid, text, text, text
) from public, anon, authenticated;

grant execute on function public.change_order_status(
  uuid, text, text, text
) to authenticated;

commit;