begin;
-- Platforma üçün restoran və sahib hesablarının vəziyyəti. Sifariş və ödəniş məlumatı qaytarmır.
create or replace function public.platform_restaurants_board(p_search text default null,p_status text default null,p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_search text:=nullif(btrim(p_search),'');v_result jsonb;
begin
 if not private.is_super_admin() then raise exception using errcode='42501',message='FORBIDDEN';end if;
 if length(coalesce(v_search,''))>80 or p_limit is null or p_limit not between 30 and 150 or p_limit%30<>0
   or p_status is not null and p_status not in ('active','trial','suspended','inactive','without_owner') then raise exception 'INVALID_FILTER';end if;
 with base as materialized (
   select r.*,(select count(*) from public.restaurant_members m join public.profiles p on p.id=m.user_id where m.restaurant_id=r.id and m.role='RESTAURANT_ADMIN' and m.is_active and p.is_active) as active_owners,
   (select count(*) from public.restaurant_members m where m.restaurant_id=r.id and m.role='RESTAURANT_ADMIN') as owners from public.restaurants r
 ), filtered as materialized (
   select * from base r where (v_search is null or strpos(lower(r.name||' '||r.slug),lower(v_search))>0)
   and (p_status is null or case when p_status='without_owner' then r.active_owners=0 when p_status='inactive' then not r.is_active else r.is_active and r.status=p_status end)
 ), page as (select * from filtered order by created_at desc,id limit p_limit)
 select jsonb_build_object('generated_at',now(),'filters',jsonb_build_object('search',coalesce(v_search,''),'status',p_status,'limit',p_limit),
 'count',(select count(*)::text from filtered),
 'summary',jsonb_build_object('total',(select count(*)::text from base),'active',(select count(*)::text from base where is_active and status='active'),
   'trial',(select count(*)::text from base where is_active and status='trial'),'suspended',(select count(*)::text from base where is_active and status='suspended'),
   'inactive',(select count(*)::text from base where not is_active),'without_owner',(select count(*)::text from base where active_owners=0)),
 'restaurants',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'slug',r.slug,'status',r.status,'is_active',r.is_active,'version',r.version,
   'branches',(select count(*)::text from public.branches where restaurant_id=r.id),'tables',(select count(*)::text from public.tables where restaurant_id=r.id),
   'staff',(select count(*)::text from public.restaurant_members where restaurant_id=r.id and role='STAFF' and is_active),'owners',r.owners::text,'active_owners',r.active_owners::text) order by r.created_at desc,r.id) from page r),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'at',a.created_at,'restaurant',r.name,'status',a.details->>'status','is_active',a.details->'is_active') order by a.created_at desc,a.id)
   from (select * from public.audit_logs where action='platform.restaurant_updated' order by created_at desc,id limit 15) a join public.restaurants r on r.id=a.restaurant_id),'[]'::jsonb)) into v_result;
 return v_result;
end $$;
revoke all on function public.platform_restaurants_board(text,text,integer) from public,anon,service_role;
grant execute on function public.platform_restaurants_board(text,text,integer) to authenticated;
commit;
