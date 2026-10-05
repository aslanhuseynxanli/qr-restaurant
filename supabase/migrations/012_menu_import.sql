begin;

create or replace function private.require_menu_admin(p_restaurant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (
    private.is_super_admin() or private.has_restaurant_role(p_restaurant_id, 'RESTAURANT_ADMIN')
  ) then
    raise exception using errcode = '42501', message = 'Bu restoranın menyusunu idarə etmək üçün icazən yoxdur.';
  end if;
  -- Serialize menu writes for one restaurant, including manual edits and imports.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_restaurant_id::text, 0));
  perform 1 from public.restaurants where id = p_restaurant_id and is_active and status in ('trial', 'active') for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'Aktiv restoran tapılmadı.';
  end if;
end;
$$;
revoke all on function private.require_menu_admin(uuid) from public, anon, authenticated;

create or replace function private.menu_import_name_key(p_name text)
returns text language sql immutable set search_path = '' as $$
  select pg_catalog.lower(pg_catalog.translate(
    pg_catalog.regexp_replace(pg_catalog.btrim(normalize(p_name, NFC)), '[[:space:]]+', ' ', 'g'),
    'IİƏÇÖŞĞÜ', 'ıiəçöşğü'));
$$;
revoke all on function private.menu_import_name_key(text) from public, anon, authenticated;

create or replace function private.valid_menu_image_url(p_restaurant_id uuid, p_url text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_path text;
begin
  if p_url is null or p_url = '' then return true; end if;
  if char_length(p_url) > 2048 or p_url !~ '^https://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$' then return false; end if;
  if strpos(p_url, '/storage/v1/object/public/menu-images/') > 0 then
    v_path := split_part(split_part(split_part(p_url, '/storage/v1/object/public/menu-images/', 2), '?', 1), '#', 1);
    return split_part(v_path, '/', 1) = p_restaurant_id::text
      and v_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
      and exists (select 1 from storage.objects where bucket_id = 'menu-images' and name = v_path);
  end if;
  return true;
end;
$$;
revoke all on function private.valid_menu_image_url(uuid, text) from public, anon, authenticated;

create table if not exists private.menu_import_requests (
  restaurant_id uuid not null references public.restaurants(id),
  request_id uuid not null,
  actor_id uuid references public.profiles(id) on delete set null,
  mode text not null check (mode in ('skip', 'update')),
  payload jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (restaurant_id, request_id)
);
revoke all on private.menu_import_requests from public, anon, authenticated;

create or replace function public.import_restaurant_menu(
  p_restaurant_id uuid, p_request_id uuid, p_mode text, p_rows jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_previous private.menu_import_requests%rowtype;
  v_categories jsonb;
  v_products jsonb;
  v_seen jsonb := '{}'::jsonb;
  v_category_ids jsonb := '[]'::jsonb;
  v_created_ids jsonb := '[]'::jsonb;
  v_updated_ids jsonb := '[]'::jsonb;
  v_row jsonb;
  v_index integer := 0;
  v_category_name text;
  v_name text;
  v_description text;
  v_image text;
  v_price_text text;
  v_price numeric;
  v_category_key text;
  v_product_key text;
  v_category_info jsonb;
  v_product_info jsonb;
  v_category_id uuid;
  v_product_id uuid;
  v_categories_created integer := 0;
  v_products_created integer := 0;
  v_products_updated integer := 0;
  v_products_skipped integer := 0;
  v_response jsonb;
begin
  perform private.require_menu_admin(p_restaurant_id);
  if p_request_id is null or p_mode is null or p_mode not in ('skip', 'update') then
    raise exception using errcode = 'P0001', message = 'İmport məlumatları düzgün deyil.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = 'P0001', message = 'İmport üçün məhsul siyahısı göndər.';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 1000 or octet_length(p_rows::text) > 524288 then
    raise exception using errcode = 'P0001', message = 'Bir importda ən çox 1000 məhsul və 512 KB menyu məlumatı ola bilər.';
  end if;
  select * into v_previous from private.menu_import_requests where restaurant_id = p_restaurant_id and request_id = p_request_id;
  if found then
    if v_previous.mode <> p_mode or v_previous.payload <> p_rows then
      raise exception using errcode = 'P0001', message = 'Bu import sorğusu artıq başqa məlumatla işlədilib. Faylı yenidən seç.';
    end if;
    return v_previous.response;
  end if;

  select coalesce(jsonb_object_agg(key, jsonb_build_object('id', id, 'count', matches)), '{}'::jsonb) into v_categories
  from (select private.menu_import_name_key(name) as key, min(id::text) as id, count(*) as matches
    from public.categories where restaurant_id = p_restaurant_id group by private.menu_import_name_key(name)) c;
  select coalesce(jsonb_object_agg(key, jsonb_build_object('id', id, 'count', matches)), '{}'::jsonb) into v_products
  from (select category_id::text || '|' || private.menu_import_name_key(name) as key, min(id::text) as id, count(*) as matches
    from public.products where restaurant_id = p_restaurant_id group by category_id, private.menu_import_name_key(name)) p;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    if jsonb_typeof(v_row) <> 'object' or jsonb_typeof(v_row->'category') <> 'string'
      or jsonb_typeof(v_row->'name') <> 'string' or jsonb_typeof(v_row->'price') not in ('number','string')
      or (v_row ? 'description' and jsonb_typeof(v_row->'description') not in ('string','null'))
      or (v_row ? 'image_url' and jsonb_typeof(v_row->'image_url') not in ('string','null')) then
      raise exception using errcode = 'P0001', message = 'İmport sətri ' || v_index || ': məlumat formatı düzgün deyil.';
    end if;
    v_category_name := btrim(v_row->>'category'); v_name := btrim(v_row->>'name');
    v_description := nullif(btrim(v_row->>'description'), ''); v_image := nullif(btrim(v_row->>'image_url'), '');
    v_price_text := v_row->>'price';
    if v_category_name is null or char_length(v_category_name) not between 1 and 150
      or v_name is null or char_length(v_name) not between 1 and 150
      or char_length(v_description) > 2000 or v_price_text is null
      or v_price_text !~ '^(0|[1-9][0-9]{0,7})(\.[0-9]{1,2})?$'
      or not private.valid_menu_image_url(p_restaurant_id, v_image) then
      raise exception using errcode = 'P0001', message = 'İmport sətri ' || v_index || ': ad, kateqoriya, qiymət və şəkil keçidini yoxla.';
    end if;
    v_price := v_price_text::numeric;
    v_category_key := private.menu_import_name_key(v_category_name);
    v_product_key := v_category_key || chr(31) || private.menu_import_name_key(v_name);
    if v_seen ? v_product_key then
      raise exception using errcode = 'P0001', message = 'İmport sətri ' || v_index || ': eyni məhsul faylda təkrarlanır.';
    end if;
    v_seen := jsonb_set(v_seen, array[v_product_key], 'true'::jsonb);
    v_category_info := v_categories->v_category_key;
    if (v_category_info->>'count')::integer > 1 then
      raise exception using errcode = 'P0001', message = 'İmport sətri ' || v_index || ': restoranda bu adda bir neçə kateqoriya var.';
    end if;
    if v_category_info is null then
      insert into public.categories (restaurant_id, name) values (p_restaurant_id, v_category_name) returning id into v_category_id;
      v_categories := jsonb_set(v_categories, array[v_category_key], jsonb_build_object('id', v_category_id, 'count', 1));
      v_categories_created := v_categories_created + 1; v_category_ids := v_category_ids || jsonb_build_array(v_category_id);
    else v_category_id := (v_category_info->>'id')::uuid;
    end if;
    v_product_key := v_category_id::text || '|' || private.menu_import_name_key(v_name);
    v_product_info := v_products->v_product_key;
    if (v_product_info->>'count')::integer > 1 then
      raise exception using errcode = 'P0001', message = 'İmport sətri ' || v_index || ': kateqoriyada bu adda bir neçə məhsul var.';
    end if;
    if v_product_info is null then
      insert into public.products (restaurant_id, category_id, name, description, base_price, image_url)
      values (p_restaurant_id, v_category_id, v_name, v_description, v_price, v_image) returning id into v_product_id;
      v_products := jsonb_set(v_products, array[v_product_key], jsonb_build_object('id', v_product_id, 'count', 1));
      v_products_created := v_products_created + 1; v_created_ids := v_created_ids || jsonb_build_array(v_product_id);
    elsif p_mode = 'skip' then
      v_products_skipped := v_products_skipped + 1;
    else
      v_product_id := (v_product_info->>'id')::uuid;
      update public.products set base_price = v_price,
        description = coalesce(v_description, description), image_url = coalesce(v_image, image_url)
      where id = v_product_id and restaurant_id = p_restaurant_id;
      v_products_updated := v_products_updated + 1; v_updated_ids := v_updated_ids || jsonb_build_array(v_product_id);
    end if;
  end loop;
  v_response := jsonb_build_object('categories_created', v_categories_created, 'products_created', v_products_created,
    'products_updated', v_products_updated, 'products_skipped', v_products_skipped, 'rows', v_index);
  insert into private.menu_import_requests (restaurant_id, request_id, actor_id, mode, payload, response)
  values (p_restaurant_id, p_request_id, auth.uid(), p_mode, p_rows, v_response);
  insert into public.audit_logs (restaurant_id, actor_id, action, entity_type, entity_id, details)
  values (p_restaurant_id, auth.uid(), 'menu.imported', 'restaurants', p_restaurant_id,
    v_response || jsonb_build_object('request_id', p_request_id, 'mode', p_mode, 'category_ids', v_category_ids,
      'created_product_ids', v_created_ids, 'updated_product_ids', v_updated_ids));
  return v_response;
end;
$$;
revoke all on function public.import_restaurant_menu(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.import_restaurant_menu(uuid, uuid, text, jsonb) to authenticated;

-- Imported public image URLs remain editable in the existing product form.
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
  if not private.valid_menu_image_url(p_restaurant_id, v_image_url) then
    raise exception using errcode = 'P0001', message = 'Şəkil üçün düzgün HTTPS keçidi seç.';
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

revoke all on function public.save_menu_product(uuid, uuid, uuid, text, text, numeric, text, integer, boolean) from public, anon;
grant execute on function public.save_menu_product(uuid, uuid, uuid, text, text, numeric, text, integer, boolean) to authenticated;
commit;
