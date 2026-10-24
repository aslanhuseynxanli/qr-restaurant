-- 031: sahib panelindən filialın yeni sifariş qəbulunu açıb-bağlamaq.
-- Mövcud sifarişlərə, çağırışlara və ödənişlərə toxunmur. 030-dan sonra.
begin;

create or replace function public.set_branch_order_acceptance(
 p_restaurant_id uuid, p_branch_id uuid, p_accepting_orders boolean,
 p_expected_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.branches;
begin
 if auth.uid() is null or not (
  private.is_super_admin() or private.has_restaurant_role(p_restaurant_id,'RESTAURANT_ADMIN')
 ) then raise exception using errcode='42501',message='FORBIDDEN';end if;
 if p_accepting_orders is null or p_expected_updated_at is null then raise exception 'INVALID_BRANCH_SETTING';end if;

 -- Yeni sifarişlərin yoxlaması ilə eyni kilid: bağlandıqdan sonra yeni sifariş keçmir.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_restaurant_id::text,0));
 select br.* into b from public.branches br join public.restaurants r on r.id=br.restaurant_id
 where br.id=p_branch_id and br.restaurant_id=p_restaurant_id and br.is_active
  and r.is_active and r.status in('active','trial')
 for update of br for share of r;
 if not found or not (private.is_super_admin() or private.has_restaurant_role(p_restaurant_id,'RESTAURANT_ADMIN')) then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 if b.accepting_orders is distinct from p_accepting_orders then
  if b.updated_at is distinct from p_expected_updated_at then raise exception 'STALE_BRANCH';end if;
  update public.branches set accepting_orders=p_accepting_orders where id=b.id returning * into b;
  insert into public.audit_logs(restaurant_id,branch_id,actor_id,action,entity_type,entity_id,details)
  values(p_restaurant_id,b.id,auth.uid(),'branch.orders_updated','branches',b.id,
   jsonb_build_object('accepting_orders',b.accepting_orders));
 end if;
 -- Eyni vəziyyətə təkrar sorğu əvvəlki nəticəni təsdiqləyir, əlavə dəyişiklik yaratmır.
 return jsonb_build_object('id',b.id,'accepting_orders',b.accepting_orders,'updated_at',b.updated_at);
end $$;
revoke all on function public.set_branch_order_acceptance(uuid,uuid,boolean,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.set_branch_order_acceptance(uuid,uuid,boolean,timestamptz) to authenticated;

notify pgrst, 'reload schema';
commit;
