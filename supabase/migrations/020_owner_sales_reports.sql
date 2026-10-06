-- Apply after 019. Read-only reports; no payment or order mutations.
begin;

create or replace function public.owner_sales_report(p_restaurant_id uuid,p_branch_id uuid default null,p_from date default null,p_to date default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_day date:=(now() at time zone 'Asia/Baku')::date;v_from date:=coalesce(p_from,v_day);v_to date:=coalesce(p_to,v_day);
  v_start timestamptz;v_end timestamptz;v_result jsonb;
begin
  perform private.require_owner_panel(p_restaurant_id);
  if p_branch_id is not null and not exists(select 1 from public.branches where id=p_branch_id and restaurant_id=p_restaurant_id) then
    raise exception using errcode='42501',message='FORBIDDEN';
  end if;
  if v_from<date '0001-01-01' or v_to>date '9999-12-31' or v_to<v_from or v_to-v_from>365 then raise exception 'INVALID_FILTER'; end if;
  v_start:=v_from::timestamp at time zone 'Asia/Baku';v_end:=(v_to+1)::timestamp at time zone 'Asia/Baku';
  with closed as materialized (
    select s.id,s.branch_id,s.closed_at,(s.closed_at at time zone 'Asia/Baku')::date as day
    from public.qr_dining_sessions s where s.restaurant_id=p_restaurant_id and s.status='CLOSED' and s.closed_at>=v_start and s.closed_at<v_end
      and (p_branch_id is null or s.branch_id=p_branch_id)
  ), items as materialized (
    select s.id as session_id,s.branch_id,s.day,s.closed_at,o.created_at,o.currency,i.id as item_id,i.product_id,i.product_name,i.quantity,i.line_total
    from closed s join public.qr_orders o on o.session_id=s.id and o.restaurant_id=p_restaurant_id and o.status='SERVED'
      join public.qr_order_items i on i.order_id=o.id and i.restaurant_id=p_restaurant_id
  ), orders as (
    select s.id as session_id,o.currency,sum(o.total_amount) as total
    from closed s join public.qr_orders o on o.session_id=s.id and o.restaurant_id=p_restaurant_id and o.status='SERVED' group by s.id,o.currency
  ), quantities as (select session_id,currency,sum(quantity) as quantity from items group by session_id,currency), accounts as materialized (
    -- A recorded payment is one account. Legacy totals are grouped by currency defensively.
    select s.id,s.branch_id,s.day,p.currency,true as recorded,p.total_amount as total,p.cash_amount as cash,p.card_amount as card,coalesce(q.quantity,0) as quantity
    from closed s join public.qr_payments p on p.session_id=s.id and p.restaurant_id=p_restaurant_id
      left join quantities q on q.session_id=s.id and q.currency=p.currency
    union all
    select s.id,s.branch_id,s.day,o.currency,false,o.total,0::numeric,0::numeric,coalesce(q.quantity,0)
    from closed s join orders o on o.session_id=s.id left join quantities q on q.session_id=s.id and q.currency=o.currency
    where not exists(select 1 from public.qr_payments where session_id=s.id and restaurant_id=p_restaurant_id)
  ), metrics as materialized (
    select branch_id,day,currency,
      count(*) filter(where recorded) as recorded_count,coalesce(sum(total) filter(where recorded),0) as recorded_total,
      coalesce(sum(cash) filter(where recorded),0) as cash,coalesce(sum(card) filter(where recorded),0) as card,
      coalesce(sum(quantity) filter(where recorded),0) as quantity,
      count(*) filter(where not recorded) as legacy_count,coalesce(sum(total) filter(where not recorded),0) as legacy_total,
      coalesce(sum(quantity) filter(where not recorded),0) as legacy_quantity
    from accounts group by branch_id,day,currency
  ), totals as (
    select currency,sum(recorded_count)::text as count,sum(recorded_total)::text as total,sum(cash)::text as cash,sum(card)::text as card,
      round(coalesce(sum(recorded_total)/nullif(sum(recorded_count),0),0),2)::text as average,sum(quantity)::text as quantity,
      sum(legacy_count)::text as legacy_count,sum(legacy_total)::text as legacy_total,sum(legacy_quantity)::text as legacy_quantity
    from metrics group by currency
  ), branch_metrics as (
    select b.id,b.name,b.is_active,m.currency,coalesce(sum(m.recorded_count),0)::text as count,coalesce(sum(m.recorded_total),0)::text as total,
      coalesce(sum(m.cash),0)::text as cash,coalesce(sum(m.card),0)::text as card,
      round(coalesce(sum(m.recorded_total)/nullif(sum(m.recorded_count),0),0),2)::text as average,coalesce(sum(m.quantity),0)::text as quantity,
      coalesce(sum(m.legacy_count),0)::text as legacy_count,coalesce(sum(m.legacy_total),0)::text as legacy_total,coalesce(sum(m.legacy_quantity),0)::text as legacy_quantity
    from public.branches b left join metrics m on m.branch_id=b.id
    where b.restaurant_id=p_restaurant_id and (p_branch_id is null or b.id=p_branch_id) group by b.id,b.name,b.is_active,m.currency
  ), daily as (
    select day,currency,sum(recorded_count)::text as count,sum(recorded_total)::text as total,sum(cash)::text as cash,sum(card)::text as card,
      sum(quantity)::text as quantity,sum(legacy_count)::text as legacy_count,sum(legacy_total)::text as legacy_total,sum(legacy_quantity)::text as legacy_quantity
    from metrics group by day,currency
  ), products as (
    select i.product_id as id,i.currency,
      (array_agg(i.product_name order by i.closed_at desc,i.created_at desc,i.item_id desc))[1] as name,
      coalesce(sum(i.quantity) filter(where p.id is not null),0)::text as quantity,
      coalesce(sum(i.line_total) filter(where p.id is not null),0)::text as total,
      count(distinct i.session_id) filter(where p.id is not null)::text as account_count,
      coalesce(sum(i.quantity) filter(where p.id is null),0)::text as legacy_quantity,
      coalesce(sum(i.line_total) filter(where p.id is null),0)::text as legacy_total,
      count(distinct i.session_id) filter(where p.id is null)::text as legacy_account_count
    from items i left join public.qr_payments p on p.session_id=i.session_id and p.restaurant_id=p_restaurant_id
    group by i.product_id,i.currency
  )
  select jsonb_build_object('restaurant_name',(select name from public.restaurants where id=p_restaurant_id),
    'day',v_day,'timezone','Asia/Baku','generated_at',now(),
    'filters',jsonb_build_object('branch_id',p_branch_id,'from',v_from,'to',v_to),
    'branches',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'is_active',is_active) order by name,id) from public.branches where restaurant_id=p_restaurant_id),'[]'::jsonb),
    'empty_count',(select count(*)::text from closed s where not exists(select 1 from accounts a where a.id=s.id)),
    'totals',coalesce((select jsonb_agg(to_jsonb(t) order by currency) from totals t),'[]'::jsonb),
    'by_branch',coalesce((select jsonb_agg(to_jsonb(b) order by name,id,currency nulls last) from branch_metrics b),'[]'::jsonb),
    'daily',coalesce((select jsonb_agg(to_jsonb(d) order by day,currency) from daily d),'[]'::jsonb),
    'products',coalesce((select jsonb_agg(to_jsonb(p) order by (quantity::numeric) desc,(total::numeric) desc,name,id,currency)
      from (select * from products order by quantity::numeric desc,total::numeric desc,name,id,currency limit 20001) p),'[]'::jsonb)) into v_result;
  if jsonb_array_length(v_result->'products')>20000 then raise exception 'REPORT_TOO_LARGE'; end if;
  return v_result;
end $$;
revoke all on function public.owner_sales_report(uuid,uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.owner_sales_report(uuid,uuid,date,date) to authenticated;

commit;
