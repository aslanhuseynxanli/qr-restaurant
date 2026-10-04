begin;

create or replace function public.create_restaurant(
  p_name text,
  p_slug text,
  p_phone text default null,
  p_email text default null
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_name text := btrim(p_name);
  v_slug text := lower(btrim(p_slug));
  v_phone text := nullif(btrim(p_phone), '');
  v_email text := nullif(lower(btrim(p_email)), '');
begin
  if v_actor is null or not private.is_super_admin() then
    raise exception 'Restoran yaratmaq üçün SUPER_ADMIN rolu lazımdır.'
      using errcode = '42501';
  end if;

  if v_name is null or length(v_name) not between 1 and 150 then
    raise exception 'Restoran adı 1–150 simvol olmalıdır.';
  end if;

  if v_slug is null or length(v_slug) not between 1 and 80
     or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Keçid adında kiçik ingilis hərfləri, rəqəm və tire istifadə et.';
  end if;

  if v_phone is not null and length(v_phone) > 30 then
    raise exception 'Telefon maksimum 30 simvol ola bilər.';
  end if;

  if v_email is not null and (
    length(v_email) > 254
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    raise exception 'Email düzgün formatda deyil.';
  end if;

  begin
    insert into public.restaurants(
      name, slug, phone, email, status, is_active
    )
    values (v_name, v_slug, v_phone, v_email, 'trial', true)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Bu keçid adı artıq istifadə olunur.'
      using errcode = '23505';
  end;

  insert into public.restaurant_settings(restaurant_id)
  values (v_id);

  insert into public.audit_logs(
    restaurant_id, actor_id, action,
    entity_type, entity_id, details
  ) values (
    v_id,
    v_actor,
    'restaurant.created',
    'restaurants',
    v_id,
    jsonb_build_object(
      'name', v_name,
      'slug', v_slug,
      'status', 'trial'
    )
  );

  return v_id;
end;
$$;

revoke all on function public.create_restaurant(
  text, text, text, text
) from public, anon, authenticated;

grant execute on function public.create_restaurant(
  text, text, text, text
) to authenticated;

revoke insert on public.restaurants, public.restaurant_settings
  from authenticated;

commit;