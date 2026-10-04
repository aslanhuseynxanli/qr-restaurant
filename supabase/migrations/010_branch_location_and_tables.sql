begin;

create or replace function public.create_table(
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_table_number integer,
  p_name text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text;
  v_table_id uuid;
begin
  if v_actor is null or not (
    private.is_super_admin()
    or private.has_restaurant_role(p_restaurant_id, 'RESTAURANT_ADMIN')
  ) then
    raise exception using errcode = '42501', message = 'Masa yaratmaq üçün icazən yoxdur.';
  end if;

  if p_table_number is null or p_table_number < 1 then
    raise exception using errcode = 'P0001', message = 'Masa nömrəsi müsbət tam ədəd olmalıdır.';
  end if;
  v_name := coalesce(nullif(btrim(p_name), ''), 'Masa ' || p_table_number::text);
  if char_length(v_name) > 150 then
    raise exception using errcode = 'P0001', message = 'Masa adı 150 simvoldan uzun ola bilməz.';
  end if;

  perform 1
  from public.branches b
  join public.restaurants r on r.id = b.restaurant_id
  where b.id = p_branch_id and b.restaurant_id = p_restaurant_id
    and b.is_active and r.is_active and r.status in ('trial', 'active')
  for share of b, r;
  if not found then
    raise exception using errcode = 'P0001', message = 'Aktiv filial tapılmadı.';
  end if;

  begin
    insert into public.tables (restaurant_id, branch_id, name, table_number)
    values (p_restaurant_id, p_branch_id, v_name, p_table_number)
    returning id into v_table_id;
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'Bu filialda həmin nömrəli masa artıq var.';
  end;

  insert into public.audit_logs (restaurant_id, branch_id, actor_id, action, entity_type, entity_id, details)
  values (p_restaurant_id, p_branch_id, v_actor, 'table.created', 'tables', v_table_id,
    jsonb_build_object('name', v_name, 'table_number', p_table_number));
  return v_table_id;
end;
$$;

create or replace function public.set_branch_location(
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_latitude numeric,
  p_longitude numeric,
  p_allowed_radius_meters integer,
  p_address text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_address text := nullif(btrim(p_address), '');
begin
  if v_actor is null or not (
    private.is_super_admin()
    or private.has_restaurant_role(p_restaurant_id, 'RESTAURANT_ADMIN')
  ) then
    raise exception using errcode = '42501', message = 'Filialın yerini dəyişmək üçün icazən yoxdur.';
  end if;
  if p_latitude is null or not (p_latitude between -90 and 90)
     or p_longitude is null or not (p_longitude between -180 and 180) then
    raise exception using errcode = 'P0001', message = 'Xəritədə düzgün yer seç.';
  end if;
  if p_allowed_radius_meters is null or p_allowed_radius_meters < 1 then
    raise exception using errcode = 'P0001', message = 'Radius müsbət tam ədəd olmalıdır.';
  end if;
  if char_length(v_address) > 500 then
    raise exception using errcode = 'P0001', message = 'Ünvan 500 simvoldan uzun ola bilməz.';
  end if;

  perform 1
  from public.branches b
  join public.restaurants r on r.id = b.restaurant_id
  where b.id = p_branch_id and b.restaurant_id = p_restaurant_id
    and r.is_active and r.status in ('trial', 'active')
  for update of b for share of r;
  if not found then
    raise exception using errcode = 'P0001', message = 'Filial tapılmadı və ya restoran aktiv deyil.';
  end if;

  update public.branches
  set latitude = p_latitude, longitude = p_longitude,
      allowed_radius_meters = p_allowed_radius_meters, address = v_address
  where id = p_branch_id and restaurant_id = p_restaurant_id;

  insert into public.audit_logs (restaurant_id, branch_id, actor_id, action, entity_type, entity_id, details)
  values (p_restaurant_id, p_branch_id, v_actor, 'branch.location_updated', 'branches', p_branch_id,
    jsonb_build_object('latitude', p_latitude, 'longitude', p_longitude,
      'allowed_radius_meters', p_allowed_radius_meters, 'address', v_address));
  return p_branch_id;
end;
$$;

revoke all on function public.create_table(uuid, uuid, integer, text) from public, anon;
revoke all on function public.set_branch_location(uuid, uuid, numeric, numeric, integer, text) from public, anon;
grant execute on function public.create_table(uuid, uuid, integer, text) to authenticated;
grant execute on function public.set_branch_location(uuid, uuid, numeric, numeric, integer, text) to authenticated;
revoke insert on public.tables from authenticated;

commit;
