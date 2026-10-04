begin;

create or replace function public.get_qr_menu(
  p_slug text,
  p_table_token text,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_context record;
  v_categories jsonb := '[]'::jsonb;
  v_location_status text;
  v_menu_allowed boolean := false;
  v_h double precision;
  v_distance double precision;
begin
  if p_slug is null or length(p_slug) > 200
     or p_table_token is null
     or p_table_token !~ '^[a-f0-9]{32}$' then
    raise exception 'QR kod düzgün deyil.';
  end if;

  select
    r.id as restaurant_id,
    r.name as restaurant_name,
    r.slug,
    r.logo_url,
    r.phone as restaurant_phone,
    b.id as branch_id,
    b.name as branch_name,
    b.address,
    b.phone as branch_phone,
    b.accepting_orders,
    b.latitude,
    b.longitude,
    b.allowed_radius_meters,
    t.id as table_id,
    t.name as table_name,
    t.table_number,
    s.currency,
    s.language,
    s.order_enabled,
    s.location_check_enabled
  into v_context
  from public.tables t
  join public.restaurants r
    on r.id = t.restaurant_id
  join public.branches b
    on b.id = t.branch_id
    and b.restaurant_id = t.restaurant_id
  join public.restaurant_settings s
    on s.restaurant_id = r.id
  where r.slug = p_slug
    and t.qr_token = p_table_token
    and r.is_active
    and r.status in ('active', 'trial')
    and b.is_active
    and t.is_active;

  if not found then
    raise exception 'QR kod etibarlı deyil və ya restoran hazırda aktiv deyil.';
  end if;

  if not v_context.location_check_enabled then
    v_location_status := 'NOT_REQUIRED';
    v_menu_allowed := true;

  elsif p_latitude is null and p_longitude is null then
    v_location_status := 'REQUIRED';

  elsif p_latitude is null or p_longitude is null
     or not (p_latitude between -90 and 90)
     or not (p_longitude between -180 and 180) then
    v_location_status := 'INVALID';

  else
    v_h :=
      power(sin(radians(
        (p_latitude - v_context.latitude::double precision) / 2
      )), 2)
      + cos(radians(p_latitude))
      * cos(radians(v_context.latitude::double precision))
      * power(sin(radians(
        (p_longitude - v_context.longitude::double precision) / 2
      )), 2);

    v_distance :=
      12742000 * asin(sqrt(greatest(0, least(1, v_h))));

    v_menu_allowed :=
      v_distance <= v_context.allowed_radius_meters;

    v_location_status := case
      when v_menu_allowed then 'ALLOWED'
      else 'OUTSIDE'
    end;
  end if;

  if v_menu_allowed then
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'description', c.description,
        'image_url', c.image_url,
        'products', m.products
      ) order by c.sort_order, c.name, c.id),
      '[]'::jsonb
    )
    into v_categories
    from public.categories c
    cross join lateral (
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'description', p.description,
        'image_url', p.image_url,
        'price', coalesce(bs.price_override, p.base_price),
        'is_available', coalesce(bs.is_available, true)
      ) order by p.sort_order, p.name, p.id) as products
      from public.products p
      left join public.branch_product_settings bs
        on bs.product_id = p.id
        and bs.branch_id = v_context.branch_id
        and bs.restaurant_id = p.restaurant_id
      where p.category_id = c.id
        and p.restaurant_id = c.restaurant_id
        and p.is_active
        and coalesce(bs.is_visible, true)
    ) m
    where c.restaurant_id = v_context.restaurant_id
      and c.is_active
      and m.products is not null;
  end if;

  return jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', v_context.restaurant_id,
      'name', v_context.restaurant_name,
      'slug', v_context.slug,
      'logo_url', v_context.logo_url,
      'phone', v_context.restaurant_phone
    ),
    'branch', jsonb_build_object(
      'id', v_context.branch_id,
      'name', v_context.branch_name,
      'address', v_context.address,
      'phone', v_context.branch_phone
    ),
    'table', jsonb_build_object(
      'id', v_context.table_id,
      'name', v_context.table_name,
      'table_number', v_context.table_number
    ),
    'currency', v_context.currency,
    'language', v_context.language,
    'accepting_orders',
      v_context.order_enabled
      and v_context.accepting_orders,
    'can_order',
      v_menu_allowed
      and v_context.order_enabled
      and v_context.accepting_orders,
    'location', jsonb_build_object(
      'required', v_context.location_check_enabled,
      'status', v_location_status,
      'allowed_radius_meters', v_context.allowed_radius_meters,
      'distance_meters', round(v_distance::numeric, 1)
    ),
    'categories', v_categories
  );
end;
$$;

revoke all on function public.get_qr_menu(
  text, text, double precision, double precision
) from public, anon, authenticated;

grant execute on function public.get_qr_menu(
  text, text, double precision, double precision
) to anon, authenticated;

commit;