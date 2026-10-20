-- 029: Sahib panelinin tam cavabını bərpa edir.
-- 028_daily_operations.sql yeniləməsindən sonra tam faylı SQL Editor-də işlət.
-- Məlumat silinmir; yalnız sahib panelinin oxuma funksiyası yenilənir.
begin;

create or replace function public.owner_dashboard(p_restaurant_id uuid,p_branch_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_today date:=(now() at time zone 'Asia/Baku')::date; v_start timestamptz; v_end timestamptz; v_currency text; v_result jsonb;
begin
  perform private.require_owner_panel(p_restaurant_id);
  if p_branch_id is not null and not exists(select 1 from public.branches where id=p_branch_id and restaurant_id=p_restaurant_id) then
    raise exception using errcode='42501',message='FORBIDDEN';
  end if;
  v_start:=v_today::timestamp at time zone 'Asia/Baku';v_end:=(v_today+1)::timestamp at time zone 'Asia/Baku';
  select currency into v_currency from public.restaurant_settings where restaurant_id=p_restaurant_id;
  v_currency:=coalesce(v_currency,'AZN');
  with today_orders as (
    select branch_id,count(*) as n,count(*) filter(where status='CANCELLED') as cancelled
    from public.qr_orders where restaurant_id=p_restaurant_id and created_at>=v_start and created_at<v_end group by branch_id
  ), working as (
    select o.branch_id,count(*) filter(where o.status='NEW') as fresh,
      count(*) filter(where o.status in ('ACCEPTED','PREPARING','READY')) as preparing
    from public.qr_orders o join public.qr_dining_sessions s on s.id=o.session_id and s.restaurant_id=o.restaurant_id
    where o.restaurant_id=p_restaurant_id and s.status<>'CLOSED' and o.status in ('NEW','ACCEPTED','PREPARING','READY') group by o.branch_id
  ), open_tables as (
    select s.branch_id,count(*) as n from public.qr_dining_sessions s where s.restaurant_id=p_restaurant_id and s.status<>'CLOSED'
      and exists(select 1 from public.qr_orders where session_id=s.id and status<>'CANCELLED') group by s.branch_id
  ), calls as (
    select c.branch_id,count(*) as n,count(*) filter(where c.kind='BILL') as bills
    from public.qr_service_requests c join public.qr_dining_sessions s on s.id=c.session_id and s.restaurant_id=c.restaurant_id
    where c.restaurant_id=p_restaurant_id and c.status<>'DONE' and s.status<>'CLOSED' group by c.branch_id
  ), closed_tables as (
    select s.branch_id,count(*) as n from public.qr_dining_sessions s where s.restaurant_id=p_restaurant_id and s.status='CLOSED'
      and s.closed_at>=v_start and s.closed_at<v_end and exists(select 1 from public.qr_orders where session_id=s.id and status='SERVED') group by s.branch_id
  ), amounts as (
    select s.branch_id,p.currency,sum(p.total_amount) as total
    from public.qr_payments p join public.qr_dining_sessions s on s.id=p.session_id and s.restaurant_id=p.restaurant_id
    where s.restaurant_id=p_restaurant_id and s.status='CLOSED' and s.closed_at>=v_start and s.closed_at<v_end group by s.branch_id,p.currency
  ), tables as (
    select branch_id,count(*) as n from public.tables where restaurant_id=p_restaurant_id and is_active group by branch_id
  ), staff as (
    select m.branch_id,count(*) as n from public.restaurant_members m join public.profiles p on p.id=m.user_id
    join public.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
    where m.restaurant_id=p_restaurant_id and m.role='STAFF' and m.is_active and p.is_active and b.is_active group by m.branch_id
  ), branch_data as (
    select b.id,b.name,b.address,b.is_active,b.accepting_orders,b.allowed_radius_meters,
      coalesce(d.n,0) as today_orders,coalesce(d.cancelled,0) as cancelled_orders,coalesce(w.fresh,0) as new_orders,coalesce(w.preparing,0) as working_orders,
      coalesce(o.n,0) as open_tables,coalesce(c.n,0) as pending_calls,coalesce(c.bills,0) as pending_bills,
      coalesce(z.n,0) as closed_tables,coalesce(t.n,0) as table_count,coalesce(u.n,0) as staff_count
    from public.branches b left join today_orders d on d.branch_id=b.id left join working w on w.branch_id=b.id
      left join open_tables o on o.branch_id=b.id left join calls c on c.branch_id=b.id left join closed_tables z on z.branch_id=b.id
      left join tables t on t.branch_id=b.id left join staff u on u.branch_id=b.id where b.restaurant_id=p_restaurant_id
  ), selected as (select * from branch_data where p_branch_id is null or id=p_branch_id), totals as (
    select currency,sum(total) as total from amounts where p_branch_id is null or branch_id=p_branch_id group by currency
  )
  select jsonb_build_object(
    'restaurant',(select jsonb_build_object('id',id,'name',name,'slug',slug,'can_manage',is_active and status in ('active','trial')) from public.restaurants where id=p_restaurant_id),
    'day',v_today,'timezone','Asia/Baku','refreshed_at',now(),'branch_id',p_branch_id,
    'totals',jsonb_build_object('today_orders',coalesce(sum(today_orders),0),'cancelled_orders',coalesce(sum(cancelled_orders),0),
      'new_orders',coalesce(sum(new_orders),0),'working_orders',coalesce(sum(working_orders),0),'open_tables',coalesce(sum(open_tables),0),
      'pending_calls',coalesce(sum(pending_calls),0),'pending_bills',coalesce(sum(pending_bills),0),'closed_tables',coalesce(sum(closed_tables),0),
      'table_count',coalesce(sum(table_count),0),'staff_count',coalesce(sum(staff_count),0)),
    'closed_amounts',coalesce((select jsonb_agg(jsonb_build_object('currency',currency,'total',total::text) order by currency) from totals),jsonb_build_array(jsonb_build_object('currency',v_currency,'total','0.00'))),
    'branches',coalesce((select jsonb_agg(to_jsonb(b) order by b.name,b.id) from branch_data b),'[]'::jsonb),
    'recent_activity',coalesce((select jsonb_agg(private.owner_event_json(a) order by a.created_at desc,a.id desc) from
      (select * from public.audit_logs where restaurant_id=p_restaurant_id and (p_branch_id is null or branch_id=p_branch_id) order by created_at desc,id desc limit 5) a),'[]'::jsonb)
  ) into v_result from selected;
  return v_result;
end $$;

-- İcazələr əvvəlki kimi: funksiyanın daxilində restoran sahibinin girişi yoxlanır.
revoke all on function public.owner_dashboard(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.owner_dashboard(uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
