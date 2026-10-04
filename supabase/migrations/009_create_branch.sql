begin;

create or replace function public.create_branch(
  p_restaurant_id uuid,
  p_name text,
  p_latitude numeric,
  p_longitude numeric,
  p_address text default null,
  p_phone text default null,
  p_allowed_radius_meters integer default 150,
  p_accepting_orders boolean default false
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_name text := btrim(p_name);
  v_address text := nullif(btrim(p_address), '');
  v_phone text := nullif(btrim(p_phone), '');
begin
  if v_actor is null or not (
    private.is_super_admin()
    or private.has_restaurant_role(
      p_restaurant_id, 'RESTAURANT_ADMIN'
    )
  ) then
    raise exception 'Bu restorana filial əlavə etmək icazən yoxdur.'
      using errcode = '42501';
  end if;

  if v_name is null or length(v_name) not between 1 and 150 then
    raise exception 'Filial adı 1–150 simvol olmalıdır.';
  end if;

  if p_latitude is null or p_longitude is null
     or not (p_latitude between -90 and 90)
     or not (p_longitude between -180 and 180) then
    raise exception 'Koordinatları düzgün daxil et.';
  end if;

  if p_allowed_radius_meters is null
     or p_allowed_radius_meters < 1 then
    raise exception 'Radius müsbət tam ədəd olmalıdır.';
  end if;

  if p_accepting_orders is null then
    raise exception 'Sifariş qəbulu ayarı düzgün deyil.';
  end if;

  if v_address is not null and length(v_address) > 500 then
    raise exception 'Ünvan maksimum 500 simvol ola bilər.';
  end if;

  if v_phone is not null and length(v_phone) > 30 then
    raise exception 'Telefon maksimum 30 simvol ola bilər.';
  end if;

  perform 1 from public.restaurants
  where id = p_restaurant_id
    and is_active
    and status in ('active', 'trial')
  for share;

  if not found then
    raise exception 'Restoran tapılmadı və ya aktiv deyil.';
  end if;

  insert into public.branches(
    restaurant_id, name, address, phone,
    latitude, longitude, allowed_radius_meters,
    accepting_orders, is_active
  ) values (
    p_restaurant_id, v_name, v_address, v_phone,
    p_latitude, p_longitude, p_allowed_radius_meters,
    p_accepting_orders, true
  ) returning id into v_id;

  insert into public.audit_logs(
    restaurant_id, branch_id, actor_id, action,
    entity_type, entity_id, details
  ) values (
    p_restaurant_id,
    v_id,
    v_actor,
    'branch.created',
    'branches',
    v_id,
    jsonb_build_object(
      'name', v_name,
      'allowed_radius_meters', p_allowed_radius_meters,
      'accepting_orders', p_accepting_orders
    )
  );

  return v_id;
end;
$$;

revoke all on function public.create_branch(
  uuid, text, numeric, numeric, text, text, integer, boolean
) from public, anon, authenticated;

grant execute on function public.create_branch(
  uuid, text, numeric, numeric, text, text, integer, boolean
) to authenticated;

revoke insert on public.branches from authenticated;

commit;