begin;

-- All menu writes use the signed-in user's restaurant role and an audit record.
create or replace function private.require_menu_admin(p_restaurant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (
    private.is_super_admin()
    or private.has_restaurant_role(p_restaurant_id, 'RESTAURANT_ADMIN')
  ) then
    raise exception using errcode = '42501', message = 'Bu restoranın menyusunu idarə etmək üçün icazən yoxdur.';
  end if;
  perform 1 from public.restaurants
  where id = p_restaurant_id and is_active and status in ('trial', 'active') for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'Aktiv restoran tapılmadı.';
  end if;
end;
$$;
revoke all on function private.require_menu_admin(uuid) from public, anon, authenticated;

create or replace function private.can_upload_menu_image(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_restaurant_id uuid;
begin
  if p_name is null or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$' then
    return false;
  end if;
  v_restaurant_id := split_part(p_name, '/', 1)::uuid;
  return auth.uid() is not null and (
    private.is_super_admin() or private.has_restaurant_role(v_restaurant_id, 'RESTAURANT_ADMIN')
  ) and exists (select 1 from public.restaurants r where r.id = v_restaurant_id
    and r.is_active and r.status in ('trial', 'active'));
end;
$$;
revoke all on function private.can_upload_menu_image(text) from public, anon;
grant execute on function private.can_upload_menu_image(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists menu_images_owner_insert on storage.objects;
create policy menu_images_owner_insert on storage.objects for insert to authenticated
with check (bucket_id = 'menu-images' and private.can_upload_menu_image(name));

create or replace function public.save_menu_category(
  p_restaurant_id uuid, p_category_id uuid, p_name text,
  p_description text, p_sort_order integer, p_is_active boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := coalesce(p_category_id, gen_random_uuid());
  v_name text := btrim(p_name);
  v_description text := nullif(btrim(p_description), '');
begin
  perform private.require_menu_admin(p_restaurant_id);
  if v_name is null or char_length(v_name) not between 1 and 150
    or char_length(v_description) > 2000 or p_sort_order is null
    or p_sort_order < 0 or p_is_active is null then
    raise exception using errcode = 'P0001', message = 'Kateqoriya məlumatlarını düzgün doldur.';
  end if;
  if p_category_id is null then
    insert into public.categories (id, restaurant_id, name, description, sort_order, is_active)
    values (v_id, p_restaurant_id, v_name, v_description, p_sort_order, p_is_active);
  else
    update public.categories set name = v_name, description = v_description,
      sort_order = p_sort_order, is_active = p_is_active
    where id = v_id and restaurant_id = p_restaurant_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'Bu restoranda kateqoriya tapılmadı.';
    end if;
  end if;
  insert into public.audit_logs (restaurant_id, actor_id, action, entity_type, entity_id, details)
  values (p_restaurant_id, auth.uid(), case when p_category_id is null then 'category.created' else 'category.updated' end,
    'categories', v_id, jsonb_build_object('name', v_name, 'is_active', p_is_active, 'sort_order', p_sort_order));
  return v_id;
end;
$$;

create or replace function public.save_menu_product(
  p_restaurant_id uuid, p_product_id uuid, p_category_id uuid, p_name text,
  p_description text, p_base_price numeric, p_image_url text,
  p_sort_order integer, p_is_active boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := coalesce(p_product_id, gen_random_uuid());
  v_name text := btrim(p_name);
  v_description text := nullif(btrim(p_description), '');
  v_image_url text := nullif(btrim(p_image_url), '');
  v_image_path text;
begin
  perform private.require_menu_admin(p_restaurant_id);
  if v_name is null or char_length(v_name) not between 1 and 150
    or char_length(v_description) > 2000 or p_sort_order is null or p_sort_order < 0
    or p_is_active is null or p_base_price is null
    or not (p_base_price between 0 and 99999999.99)
    or p_base_price <> round(p_base_price, 2) then
    raise exception using errcode = 'P0001', message = 'Məhsulun adı, qiyməti və digər məlumatlarını yoxla.';
  end if;
  perform 1 from public.categories where id = p_category_id and restaurant_id = p_restaurant_id for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'Bu restorana aid kateqoriya seç.';
  end if;
  if v_image_url is not null then
    if char_length(v_image_url) > 2048 or v_image_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/menu-images/' then
      raise exception using errcode = 'P0001', message = 'Şəkli fayl seçimi ilə yüklə.';
    end if;
    v_image_path := split_part(v_image_url, '/storage/v1/object/public/menu-images/', 2);
    if split_part(v_image_path, '/', 1) <> p_restaurant_id::text
      or v_image_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
      or not exists (select 1 from storage.objects where bucket_id = 'menu-images' and name = v_image_path) then
      raise exception using errcode = 'P0001', message = 'Yüklənmiş şəkil bu restorana aid deyil.';
    end if;
  end if;
  if p_product_id is null then
    insert into public.products (id, restaurant_id, category_id, name, description, base_price, image_url, sort_order, is_active)
    values (v_id, p_restaurant_id, p_category_id, v_name, v_description, p_base_price, v_image_url, p_sort_order, p_is_active);
  else
    update public.products set category_id = p_category_id, name = v_name, description = v_description,
      base_price = p_base_price, image_url = v_image_url, sort_order = p_sort_order, is_active = p_is_active
    where id = v_id and restaurant_id = p_restaurant_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'Bu restoranda məhsul tapılmadı.';
    end if;
  end if;
  insert into public.audit_logs (restaurant_id, actor_id, action, entity_type, entity_id, details)
  values (p_restaurant_id, auth.uid(), case when p_product_id is null then 'product.created' else 'product.updated' end,
    'products', v_id, jsonb_build_object('name', v_name, 'base_price', p_base_price, 'category_id', p_category_id, 'is_active', p_is_active));
  return v_id;
end;
$$;

create or replace function public.save_branch_product(
  p_restaurant_id uuid, p_branch_id uuid, p_product_id uuid,
  p_price_override numeric, p_is_available boolean, p_is_visible boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_menu_admin(p_restaurant_id);
  if p_is_available is null or p_is_visible is null or (p_price_override is not null and (
    not (p_price_override between 0 and 99999999.99) or p_price_override <> round(p_price_override, 2))) then
    raise exception using errcode = 'P0001', message = 'Filial qiymətini və məhsulun vəziyyətini yoxla.';
  end if;
  perform 1 from public.branches where id = p_branch_id and restaurant_id = p_restaurant_id and is_active for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'Aktiv filial tapılmadı.';
  end if;
  perform 1 from public.products where id = p_product_id and restaurant_id = p_restaurant_id for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'Bu restorana aid məhsul seç.';
  end if;
  insert into public.branch_product_settings (restaurant_id, branch_id, product_id, price_override, is_available, is_visible)
  values (p_restaurant_id, p_branch_id, p_product_id, p_price_override, p_is_available, p_is_visible)
  on conflict (branch_id, product_id) do update set price_override = excluded.price_override,
    is_available = excluded.is_available, is_visible = excluded.is_visible
  returning id into v_id;
  insert into public.audit_logs (restaurant_id, branch_id, actor_id, action, entity_type, entity_id, details)
  values (p_restaurant_id, p_branch_id, auth.uid(), 'branch_product.updated', 'branch_product_settings', v_id,
    jsonb_build_object('product_id', p_product_id, 'price_override', p_price_override,
      'is_available', p_is_available, 'is_visible', p_is_visible));
  return v_id;
end;
$$;

revoke all on function public.save_menu_category(uuid, uuid, text, text, integer, boolean) from public, anon;
revoke all on function public.save_menu_product(uuid, uuid, uuid, text, text, numeric, text, integer, boolean) from public, anon;
revoke all on function public.save_branch_product(uuid, uuid, uuid, numeric, boolean, boolean) from public, anon;
grant execute on function public.save_menu_category(uuid, uuid, text, text, integer, boolean) to authenticated;
grant execute on function public.save_menu_product(uuid, uuid, uuid, text, text, numeric, text, integer, boolean) to authenticated;
grant execute on function public.save_branch_product(uuid, uuid, uuid, numeric, boolean, boolean) to authenticated;
revoke insert, update on public.categories, public.products, public.branch_product_settings from authenticated;
revoke update (name, description, image_url, sort_order, is_active) on public.categories from authenticated;
revoke update (category_id, name, description, base_price, image_url, sort_order, is_active) on public.products from authenticated;
revoke update (price_override, is_available, is_visible) on public.branch_product_settings from authenticated;

commit;
