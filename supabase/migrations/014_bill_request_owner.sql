-- Apply after 013_qr_orders_and_service.sql. No table or order data is changed.
begin;

create or replace function public.qr_request_service(p_slug text,p_token text,p_visit_id uuid,p_secret text,p_request_id uuid,p_kind text,p_latitude numeric,p_longitude numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.qr_dining_sessions; v_receipt private.qr_action_receipts; v_call public.qr_service_requests; v_response jsonb; v_menu jsonb;
begin
  v_session:=private.qr_visit_session(p_slug,p_token,p_visit_id,p_secret);
  if p_request_id is null or p_kind is null or p_kind not in ('WAITER','BILL') then raise exception 'INVALID_REQUEST'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_session.restaurant_id::text,0));
  perform 1 from public.tables where id=v_session.table_id for update;
  select * into v_session from public.qr_dining_sessions where id=v_session.id for update;
  select * into v_receipt from private.qr_action_receipts where visit_id=p_visit_id and request_id=p_request_id;
  if found then
    if v_receipt.kind<>p_kind then raise exception 'REQUEST_CONFLICT'; end if;
    return public.qr_get_visit(p_slug,p_token,p_visit_id,p_secret);
  end if;
  if v_session.status='CLOSED' then raise exception 'TABLE_CLOSED'; end if;
  -- Eligibility belongs to this visit, including when another guest already requested the bill.
  if p_kind='BILL' and not exists(
    select 1 from public.qr_orders
    where session_id=v_session.id and visit_id=p_visit_id and status<>'CANCELLED'
  ) then raise exception 'NO_ORDERS'; end if;
  v_menu:=private.qr_checked_menu(p_slug,p_token,p_latitude,p_longitude,false);
  select * into v_call from public.qr_service_requests where session_id=v_session.id and kind=p_kind and status<>'DONE';
  if not found then
    if exists(select 1 from public.qr_service_requests where session_id=v_session.id and kind=p_kind and created_at>now()-interval '1 minute') then raise exception 'TOO_MANY_REQUESTS'; end if;
    insert into public.qr_service_requests(session_id,restaurant_id,branch_id,table_id,kind)
      values(v_session.id,v_session.restaurant_id,v_session.branch_id,v_session.table_id,p_kind) returning * into v_call;
    if p_kind='BILL' then update public.qr_dining_sessions set status='BILL_REQUESTED',version=version+1 where id=v_session.id; end if;
    insert into public.audit_logs(restaurant_id,branch_id,action,entity_type,entity_id,details)
      values(v_session.restaurant_id,v_session.branch_id,'qr.service_requested','qr_service_requests',v_call.id,jsonb_build_object('kind',p_kind,'table_id',v_session.table_id));
  end if;
  v_response:=jsonb_build_object('call_id',v_call.id);
  insert into private.qr_action_receipts(visit_id,request_id,kind,response) values(p_visit_id,p_request_id,p_kind,v_response);
  return public.qr_get_visit(p_slug,p_token,p_visit_id,p_secret);
end $$;

revoke all on function public.qr_request_service(text,text,uuid,text,uuid,text,numeric,numeric) from public,anon,authenticated;
grant execute on function public.qr_request_service(text,text,uuid,text,uuid,text,numeric,numeric) to service_role;

commit;
