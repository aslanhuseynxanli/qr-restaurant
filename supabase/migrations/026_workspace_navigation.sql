begin;

-- Naviqasiya üçün yalnız daxil olan hesabın icazəli iş yerləri qaytarılır.
-- Sifariş, ödəniş və status əməliyyatlarının mövcud icazələri dəyişmir.
create or replace function public.portal_workspace(p_restaurant_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();v_profile public.profiles;v_super boolean;v_restaurants jsonb;v_branches jsonb;v_assignments jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
  select * into v_profile from public.profiles where id=v_uid;
  if not found or not v_profile.is_active then
    return jsonb_build_object('active',false,'name',coalesce(v_profile.full_name,''),'super_admin',false,'restaurants','[]'::jsonb,'branches','[]'::jsonb,'assignments','[]'::jsonb);
  end if;
  select exists(select 1 from public.platform_admins where user_id=v_uid and is_active and role='SUPER_ADMIN') into v_super;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'slug',r.slug,'status',r.status,'is_active',r.is_active,'can_manage',r.is_active and r.status in ('trial','active')) order by r.name,r.id),'[]'::jsonb)
  into v_restaurants from public.restaurants r
  where (v_super and r.id=p_restaurant_id) or exists(select 1 from public.restaurant_members m where m.restaurant_id=r.id and m.user_id=v_uid and m.role='RESTAURANT_ADMIN' and m.is_active);
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'restaurant_id',b.restaurant_id,'name',b.name,'address',b.address,'latitude',b.latitude,'longitude',b.longitude,'allowed_radius_meters',b.allowed_radius_meters,'accepting_orders',b.accepting_orders,'is_active',b.is_active,'updated_at',b.updated_at,'table_count',(select count(*) from public.tables t where t.branch_id=b.id and t.is_active)) order by b.name,b.id),'[]'::jsonb)
  into v_branches from public.branches b
  where (v_super and b.restaurant_id=p_restaurant_id) or exists(select 1 from public.restaurant_members m where m.restaurant_id=b.restaurant_id and m.user_id=v_uid and m.role='RESTAURANT_ADMIN' and m.is_active);
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'restaurant_id',r.id,'restaurant_name',r.name,'staff_kind',m.staff_kind) order by r.name,b.name,b.id),'[]'::jsonb)
  into v_assignments from public.restaurant_members m join public.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id join public.restaurants r on r.id=m.restaurant_id
  where m.user_id=v_uid and m.role='STAFF' and m.is_active and b.is_active and r.is_active and r.status in ('trial','active');
  return jsonb_build_object('active',true,'name',v_profile.full_name,'super_admin',v_super,'restaurants',v_restaurants,'branches',v_branches,'assignments',v_assignments);
end;
$$;
revoke all on function public.portal_workspace(uuid) from public,anon,service_role;
grant execute on function public.portal_workspace(uuid) to authenticated;
commit;
