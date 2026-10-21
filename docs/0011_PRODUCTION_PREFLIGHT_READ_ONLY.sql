-- Exact manual READ-ONLY preflight for 0011 before cutover; run as postgres.
-- No impersonation, writes, RPC mutations, grants or schema changes.
-- Check actual Data API exposed schemas separately: authorization_private
-- must remain excluded. Existing production PASS results remain authoritative.
begin transaction read only;
select current_user as installer;
select c.relname,pg_get_userbyid(c.relowner) as owner,c.relrowsecurity,c.relforcerowsecurity,c.relacl
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('engrase_sync','app_profiles','app_store_permissions');

-- All eight must be RESTRICTIVE / authenticated-only; inspect expressions.
select policyname,permissive,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename='engrase_sync'
 and (policyname like 'authorization_store_%' or policyname like 'authorization_scope_%'
      or policyname='acceso interno con anon key') order by policyname;
select count(*) as expected_eight_restrictive from pg_policies
where schemaname='public' and tablename='engrase_sync' and permissive='RESTRICTIVE'
 and roles=array['authenticated']::name[] and policyname in (
 'authorization_store_select','authorization_store_insert','authorization_store_update','authorization_store_delete',
 'authorization_scope_select','authorization_scope_insert','authorization_scope_update','authorization_scope_delete');
select pg_get_functiondef('public.get_authorization_context()'::regprocedure) as bootstrap_definition;
select role,store,can_read,can_insert,can_update,can_delete from public.app_store_permissions
where role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
 and store in ('equipment','lubrication_plans','lubrication_points','settings') order by role,store;

-- New 0011 objects must be absent (CREATE intentionally aborts on duplicates).
select to_regclass('public.operational_catalog_receipts') as receipts_must_be_null;
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig,p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('catalog_writer_role','operational_catalog_operation',
 'move_equipment_master_location','set_equipment_shift','set_equipment_alert_pause',
 'update_equipment_hourmeter','reprogram_lubrication_plan');
select policyname from pg_policies where schemaname='public' and tablename='engrase_sync'
 and policyname in ('catalog_insert_roles','catalog_update_roles','catalog_delete_roles','catalog_settings_read');

-- Invalid legacy values would block RPCs; report counts, never repair data.
-- Hourmeter NULL/missing means 0 in the existing gateway. Finite numeric
-- strings/scientific notation are accepted; NaN/Infinity/negative need review.
select count(*) as live_equipment,
 count(*) filter(where not case
   when payload->>'hourmeter' is null then true
   when btrim(payload->>'hourmeter') ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
     then (payload->>'hourmeter')::numeric>=0
   else false end) as invalid_existing_hourmeters
from public.engrase_sync where store='equipment' and not deleted and coalesce(payload->>'active','true')='true';
select count(*) as live_crews,
 count(*) filter(where jsonb_typeof(s.payload->'memberUserIds') is distinct from 'array') as malformed_membership,
 count(*) filter(where not exists(select 1 from public.engrase_sync l where l.store='locations'
   and l.id=s.payload->>'locationId' and not l.deleted and coalesce(l.payload->>'active','true')='true')) as invalid_legacy_location
from public.engrase_sync s where s.store='cuadrillas' and not s.deleted and coalesce(s.payload->>'active','true')='true';
commit;
