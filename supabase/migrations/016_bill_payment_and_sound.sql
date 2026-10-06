-- Apply after 015_staff_management.sql. Existing bills stay valid.
begin;
alter table public.qr_service_requests add column if not exists payment_method text
  check (payment_method is null or (payment_method in ('CASH','CARD','MIXED') and kind='BILL'));

-- Wrap the existing bill routine so its own-visit, location, rate and table guards stay intact.
create or replace function public.qr_request_bill(p_slug text,p_token text,p_visit_id uuid,p_secret text,p_request_id uuid,p_payment_method text,p_latitude numeric,p_longitude numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.qr_dining_sessions; v_receipt private.qr_action_receipts; v_call public.qr_service_requests;
begin
  v_session:=private.qr_visit_session(p_slug,p_token,p_visit_id,p_secret);
  if p_request_id is null then raise exception 'INVALID_REQUEST'; end if;
  if p_payment_method is null or p_payment_method not in ('CASH','CARD','MIXED') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_session.restaurant_id::text,0));
  perform 1 from public.tables where id=v_session.table_id for update;
  perform 1 from public.qr_dining_sessions where id=v_session.id for update;
  select * into v_receipt from private.qr_action_receipts where visit_id=p_visit_id and request_id=p_request_id;
  if found then
    if v_receipt.kind<>'BILL' or v_receipt.response->>'payment_method' is distinct from p_payment_method then raise exception 'REQUEST_CONFLICT'; end if;
    return public.qr_get_visit(p_slug,p_token,p_visit_id,p_secret);
  end if;
  perform public.qr_request_service(p_slug,p_token,p_visit_id,p_secret,p_request_id,'BILL',p_latitude,p_longitude);
  select * into v_receipt from private.qr_action_receipts where visit_id=p_visit_id and request_id=p_request_id;
  select * into v_call from public.qr_service_requests where id=(v_receipt.response->>'call_id')::uuid for update;
  -- First specified method wins for the entire table, including simultaneous phones.
  if v_call.payment_method is null then
    update public.qr_service_requests set payment_method=p_payment_method,version=version+1,updated_at=now() where id=v_call.id;
    insert into public.audit_logs(restaurant_id,branch_id,action,entity_type,entity_id,details)
      values(v_session.restaurant_id,v_session.branch_id,'qr.bill_payment_selected','qr_service_requests',v_call.id,jsonb_build_object('payment_method',p_payment_method));
  end if;
  update private.qr_action_receipts set response=response||jsonb_build_object('payment_method',p_payment_method) where visit_id=p_visit_id and request_id=p_request_id;
  return public.qr_get_visit(p_slug,p_token,p_visit_id,p_secret);
end $$;
revoke all on function public.qr_request_bill(text,text,uuid,text,uuid,text,numeric,numeric) from public,anon,authenticated;
grant execute on function public.qr_request_bill(text,text,uuid,text,uuid,text,numeric,numeric) to service_role;

create or replace function public.qr_get_visit(p_slug text,p_token text,p_visit_id uuid,p_secret text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.qr_dining_sessions;
begin
  v_session:=private.qr_visit_session(p_slug,p_token,p_visit_id,p_secret);
  return jsonb_build_object('session',jsonb_build_object('id',v_session.id,'status',v_session.status,'table_name',v_session.table_name),
    'orders',coalesce((select jsonb_agg(private.qr_order_json(o.id) order by o.created_at desc) from public.qr_orders o where o.visit_id=p_visit_id),'[]'::jsonb),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'payment_method',c.payment_method,'status',c.status,'created_at',c.created_at,'updated_at',c.updated_at) order by c.created_at desc)
      from public.qr_service_requests c where c.session_id=v_session.id and c.status<>'DONE'),'[]'::jsonb));
end $$;

create or replace function public.qr_staff_board(p_restaurant_id uuid,p_branch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not private.qr_can_manage_branch(p_restaurant_id,p_branch_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  return jsonb_build_object('sound_enabled',coalesce((select sound_enabled from public.restaurant_settings where restaurant_id=p_restaurant_id),true),'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'version',s.version,'table_name',s.table_name,'table_number',s.table_number,'opened_at',s.opened_at,
    'total',coalesce((select sum(o.total_amount) from public.qr_orders o where o.session_id=s.id and o.status<>'CANCELLED'),0),
    'currency',coalesce((select o.currency from public.qr_orders o where o.session_id=s.id order by o.created_at limit 1),'AZN'),
    'orders',coalesce((select jsonb_agg(private.qr_order_json(o.id) order by o.created_at) from public.qr_orders o where o.session_id=s.id),'[]'::jsonb),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'payment_method',c.payment_method,'status',c.status,'version',c.version,'created_at',c.created_at) order by c.created_at) from public.qr_service_requests c where c.session_id=s.id and c.status<>'DONE'),'[]'::jsonb)) order by s.table_number)
    from public.qr_dining_sessions s where s.restaurant_id=p_restaurant_id and s.branch_id=p_branch_id and s.status<>'CLOSED'),'[]'::jsonb));
end $$;

revoke all on function public.qr_get_visit(text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.qr_get_visit(text,text,uuid,text) to service_role;
revoke all on function public.qr_staff_board(uuid,uuid) from public,anon;
grant execute on function public.qr_staff_board(uuid,uuid) to authenticated;
commit;
