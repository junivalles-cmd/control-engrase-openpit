-- PREPARED ONLY. Post-cutover recovery for the generic permission matrix.
-- This NEVER recreates "acceso interno con anon key" and never disables RLS.
-- It restores prior safe catalog permissions where the installed server
-- guards remain compatible. It deliberately keeps records, assignments,
-- skips, anomalies, validations, users and dispatch generic writes denied;
-- 0009 has no direct-write RLS guard for records. Does not roll back data/schema.
begin;
do $preconditions$
begin
  if not exists(select 1 from pg_catalog.pg_class where oid='public.engrase_sync'::regclass and relrowsecurity) then
    raise exception 'Refusing rollback while engrase_sync RLS is disabled'; end if;
  if exists(select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='engrase_sync'
      and policyname='acceso interno con anon key') then
    raise exception 'Legacy anonymous policy unexpectedly exists; do not use this rollback'; end if;
  if (select count(*) from public.app_store_permissions where role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
      and store in ('anomalies','audit_log','cuadrillas','equipment','equipment_types','grease_validations','locations','lubricants',
        'lubrication_assignments','lubrication_plans','lubrication_points','lubrication_records','lubrication_skips',
        'notification_dispatch_log','push_tokens','settings','shifts','users')) <> 72 then
    raise exception 'Expected 72 known permission rows before restoring prior matrix'; end if;
end
$preconditions$;
with prior(store,role,can_read,can_insert,can_update,can_delete) as (values
 ('anomalies','ADMINISTRADOR',true,false,false,false),('audit_log','ADMINISTRADOR',true,false,false,false),
 ('cuadrillas','ADMINISTRADOR',true,true,true,true),('equipment','ADMINISTRADOR',true,true,true,true),
 ('equipment_types','ADMINISTRADOR',true,true,true,true),('grease_validations','ADMINISTRADOR',true,false,false,false),
 ('locations','ADMINISTRADOR',true,true,true,true),('lubricants','ADMINISTRADOR',true,true,true,true),
 ('lubrication_assignments','ADMINISTRADOR',true,false,false,false),('lubrication_plans','ADMINISTRADOR',true,true,true,true),
 ('lubrication_points','ADMINISTRADOR',true,true,true,true),('lubrication_records','ADMINISTRADOR',true,false,false,false),
 ('lubrication_skips','ADMINISTRADOR',true,false,false,false),('notification_dispatch_log','ADMINISTRADOR',false,false,false,false),
 ('push_tokens','ADMINISTRADOR',true,true,true,false),('settings','ADMINISTRADOR',true,true,true,true),
 ('shifts','ADMINISTRADOR',true,true,true,true),('users','ADMINISTRADOR',false,false,false,false),
 ('anomalies','PLANIFICADOR',false,false,false,false),('audit_log','PLANIFICADOR',false,false,false,false),
 ('cuadrillas','PLANIFICADOR',true,false,false,false),('equipment','PLANIFICADOR',true,false,false,false),
 ('equipment_types','PLANIFICADOR',true,false,false,false),('grease_validations','PLANIFICADOR',true,false,false,false),
 ('locations','PLANIFICADOR',true,false,false,false),('lubricants','PLANIFICADOR',true,false,false,false),
 ('lubrication_assignments','PLANIFICADOR',true,false,false,false),('lubrication_plans','PLANIFICADOR',true,false,false,false),
 ('lubrication_points','PLANIFICADOR',true,false,false,false),('lubrication_records','PLANIFICADOR',true,false,false,false),
 ('lubrication_skips','PLANIFICADOR',true,false,false,false),('notification_dispatch_log','PLANIFICADOR',false,false,false,false),
 ('push_tokens','PLANIFICADOR',true,true,true,false),('settings','PLANIFICADOR',false,false,false,false),
 ('shifts','PLANIFICADOR',true,false,false,false),('users','PLANIFICADOR',false,false,false,false),
 ('anomalies','SUPERVISOR',true,false,false,false),('audit_log','SUPERVISOR',false,false,false,false),
 ('cuadrillas','SUPERVISOR',true,false,false,false),('equipment','SUPERVISOR',true,false,false,false),
 ('equipment_types','SUPERVISOR',true,false,false,false),('grease_validations','SUPERVISOR',true,false,false,false),
 ('locations','SUPERVISOR',true,false,false,false),('lubricants','SUPERVISOR',true,false,false,false),
 ('lubrication_assignments','SUPERVISOR',true,false,false,false),('lubrication_plans','SUPERVISOR',true,false,false,false),
 ('lubrication_points','SUPERVISOR',true,false,false,false),('lubrication_records','SUPERVISOR',true,false,false,false),
 ('lubrication_skips','SUPERVISOR',true,false,false,false),('notification_dispatch_log','SUPERVISOR',false,false,false,false),
 ('push_tokens','SUPERVISOR',true,true,true,false),('settings','SUPERVISOR',false,false,false,false),
 ('shifts','SUPERVISOR',true,false,false,false),('users','SUPERVISOR',false,false,false,false),
 ('anomalies','LUBRICADOR',true,false,false,false),('audit_log','LUBRICADOR',false,false,false,false),
 ('cuadrillas','LUBRICADOR',true,false,false,false),('equipment','LUBRICADOR',false,false,false,false),
 ('equipment_types','LUBRICADOR',true,false,false,false),('grease_validations','LUBRICADOR',true,false,false,false),
 ('locations','LUBRICADOR',true,false,false,false),('lubricants','LUBRICADOR',true,false,false,false),
 ('lubrication_assignments','LUBRICADOR',true,false,false,false),('lubrication_plans','LUBRICADOR',true,false,false,false),
 ('lubrication_points','LUBRICADOR',true,false,false,false),('lubrication_records','LUBRICADOR',true,false,false,false),
 ('lubrication_skips','LUBRICADOR',true,false,false,false),('notification_dispatch_log','LUBRICADOR',false,false,false,false),
 ('push_tokens','LUBRICADOR',true,true,true,false),('settings','LUBRICADOR',false,false,false,false),
 ('shifts','LUBRICADOR',true,false,false,false),('users','LUBRICADOR',false,false,false,false)
)
update public.app_store_permissions p set can_read=v.can_read,can_insert=v.can_insert,
  can_update=v.can_update,can_delete=v.can_delete from prior v where p.store=v.store and p.role=v.role;
delete from authorization_private.release_migration_state where version='0015_store_permission_target';
commit;
