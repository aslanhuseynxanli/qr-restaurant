-- SQL Editor-də oxuma yoxlaması: məlumatları dəyişmir.
select p.oid::regprocedure as function,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as user_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as server_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('account_auth_limit','account_recovery_open','account_recovery_check','account_recovery_claim');
select 'restaurants' as table_name,count(*) from public.restaurants
union all select 'branches',count(*) from public.branches
union all select 'tables',count(*) from public.tables
union all select 'products',count(*) from public.products
union all select 'qr_orders',count(*) from public.qr_orders
union all select 'qr_payments',count(*) from public.qr_payments;
