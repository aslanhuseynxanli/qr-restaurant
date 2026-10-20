-- Read-only structural check. Run after 028 in Supabase SQL Editor.
select to_regprocedure('public.qr_adjust_order(uuid,uuid,uuid,integer,uuid,jsonb,text)') is not null as item_adjustment,
 to_regprocedure('public.qr_transfer_table(uuid,uuid,uuid,integer,uuid,uuid)') is not null as table_transfer,
 to_regprocedure('public.qr_adjust_bill(uuid,uuid,uuid,integer,text,text,text,uuid)') is not null as owner_bill_adjustment,
 to_regprocedure('public.qr_pay_part(uuid,uuid,uuid,integer,uuid,text,text,text,text,text,text)') is not null as partial_payment,
 to_regprocedure('public.qr_account_receipt(uuid,uuid,uuid)') is not null as account_receipt,
 to_regprocedure('public.platform_operational_health()') is not null as platform_health;
select count(*)=8 and bool_and(c.relrowsecurity) as all_required_rls_enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('restaurants','branches','tables','products','qr_orders','qr_order_items','qr_dining_sessions','qr_payments');
select not has_function_privilege('anon','public.qr_adjust_order(uuid,uuid,uuid,integer,uuid,jsonb,text)','execute') as anonymous_adjustment_blocked,
 not has_function_privilege('anon','public.qr_pay_part(uuid,uuid,uuid,integer,uuid,text,text,text,text,text,text)','execute') as anonymous_payment_blocked,
 not has_function_privilege('authenticated','public.platform_backup_record(boolean,integer,integer,bigint,text)','execute') as ordinary_backup_write_blocked;
