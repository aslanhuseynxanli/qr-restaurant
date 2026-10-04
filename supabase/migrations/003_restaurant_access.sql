begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- Aktiv Super Admin hesabını yoxlayır.
create function private.is_super_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins a
    join public.profiles p on p.id = a.user_id
    where a.user_id = (select auth.uid())
      and a.is_active and p.is_active
  );
$$;

-- Aktiv restoran üzvlüyünü və tələb olunan rolu yoxlayır.
create function private.has_restaurant_role(
  target_restaurant uuid,
  required_role text default null
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.restaurant_members m
    join public.profiles p on p.id = m.user_id
    join public.restaurants r on r.id = m.restaurant_id
    where m.user_id = (select auth.uid())
      and m.restaurant_id = target_restaurant
      and m.is_active and p.is_active and r.is_active
      and r.status in ('active', 'trial')
      and (required_role is null or m.role = required_role)
  );
$$;

-- İşçi yalnız öz aktiv filialını görə bilər.
create function private.can_read_branch(
  target_restaurant uuid,
  target_branch uuid
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.branches b
    where b.id = target_branch
      and b.restaurant_id = target_restaurant
  ) and (
    private.is_super_admin()
    or private.has_restaurant_role(
      target_restaurant, 'RESTAURANT_ADMIN'
    )
    or exists (
      select 1
      from public.restaurant_members m
      join public.profiles p on p.id = m.user_id
      join public.restaurants r on r.id = m.restaurant_id
      join public.branches b
        on b.id = m.branch_id
        and b.restaurant_id = m.restaurant_id
      where m.user_id = (select auth.uid())
        and m.restaurant_id = target_restaurant
        and m.branch_id = target_branch
        and m.role = 'STAFF'
        and m.is_active and p.is_active
        and r.is_active and b.is_active
        and r.status in ('active', 'trial')
    )
  );
$$;

revoke all on function private.is_super_admin()
  from public, anon;
revoke all on function private.has_restaurant_role(uuid, text)
  from public, anon;
revoke all on function private.can_read_branch(uuid, uuid)
  from public, anon;

grant execute on function private.is_super_admin()
  to authenticated;
grant execute on function private.has_restaurant_role(uuid, text)
  to authenticated;
grant execute on function private.can_read_branch(uuid, uuid)
  to authenticated;

-- Platform statusunu yalnız Super Admin dəyişə bilər.
create function private.protect_restaurant_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.status is distinct from old.status
      or new.is_active is distinct from old.is_active)
     and current_user in ('anon', 'authenticated')
     and not private.is_super_admin() then
    raise exception 'Restoran statusunu yalnız Super Admin dəyişə bilər.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_restaurant_status()
  from public, anon;
grant execute on function private.protect_restaurant_status()
  to authenticated;

create trigger restaurants_protect_status
before update on public.restaurants
for each row
execute function private.protect_restaurant_status();

-- Oxuma və yaratma icazələri
grant select, insert on
  public.restaurants,
  public.branches,
  public.restaurant_settings
to authenticated;

-- Dəyişdirilə bilən sütunlar
grant update (
  name, slug, logo_url, phone, email, status, is_active
) on public.restaurants to authenticated;

grant update (
  name, address, phone, latitude, longitude,
  allowed_radius_meters, is_active, accepting_orders
) on public.branches to authenticated;

grant update (
  currency, language, order_enabled, location_check_enabled,
  default_location_radius, sound_enabled
) on public.restaurant_settings to authenticated;

-- Restoran qaydaları
create policy restaurants_read
on public.restaurants for select to authenticated
using (
  (select private.is_super_admin())
  or private.has_restaurant_role(id)
);

create policy restaurants_create
on public.restaurants for insert to authenticated
with check ((select private.is_super_admin()));

create policy restaurants_edit
on public.restaurants for update to authenticated
using (
  (select private.is_super_admin())
  or private.has_restaurant_role(id, 'RESTAURANT_ADMIN')
)
with check (
  (select private.is_super_admin())
  or private.has_restaurant_role(id, 'RESTAURANT_ADMIN')
);

-- Filial qaydaları
create policy branches_read
on public.branches for select to authenticated
using (private.can_read_branch(restaurant_id, id));

create policy branches_create
on public.branches for insert to authenticated
with check (
  (select private.is_super_admin())
  or private.has_restaurant_role(
    restaurant_id, 'RESTAURANT_ADMIN'
  )
);

create policy branches_edit
on public.branches for update to authenticated
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

-- Restoran ayarları
create policy restaurant_settings_read
on public.restaurant_settings for select to authenticated
using (
  (select private.is_super_admin())
  or private.has_restaurant_role(restaurant_id)
);

create policy restaurant_settings_create
on public.restaurant_settings for insert to authenticated
with check (
  (select private.is_super_admin())
  or private.has_restaurant_role(
    restaurant_id, 'RESTAURANT_ADMIN'
  )
);

create policy restaurant_settings_edit
on public.restaurant_settings for update to authenticated
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

-- Üzvlüklərin idarə edilməsi
grant insert on public.restaurant_members to authenticated;

grant update (role, branch_id, is_active)
on public.restaurant_members to authenticated;

create policy restaurant_members_admin_read
on public.restaurant_members for select to authenticated
using (
  (select private.is_super_admin())
  or private.has_restaurant_role(
    restaurant_id, 'RESTAURANT_ADMIN'
  )
);

create policy restaurant_members_create
on public.restaurant_members for insert to authenticated
with check (
  (select private.is_super_admin())
  or (
    role = 'STAFF'
    and private.has_restaurant_role(
      restaurant_id, 'RESTAURANT_ADMIN'
    )
  )
);

create policy restaurant_members_edit
on public.restaurant_members for update to authenticated
using (
  (select private.is_super_admin())
  or (
    role = 'STAFF'
    and private.has_restaurant_role(
      restaurant_id, 'RESTAURANT_ADMIN'
    )
  )
)
with check (
  (select private.is_super_admin())
  or (
    role = 'STAFF'
    and private.has_restaurant_role(
      restaurant_id, 'RESTAURANT_ADMIN'
    )
  )
);

-- Admin öz restoranındakı üzvlərin profillərini oxuya bilər.
create policy profiles_admin_read
on public.profiles for select to authenticated
using (
  (select private.is_super_admin())
  or exists (
    select 1
    from public.restaurant_members m
    where m.user_id = profiles.id
      and private.has_restaurant_role(
        m.restaurant_id, 'RESTAURANT_ADMIN'
      )
  )
);

commit;