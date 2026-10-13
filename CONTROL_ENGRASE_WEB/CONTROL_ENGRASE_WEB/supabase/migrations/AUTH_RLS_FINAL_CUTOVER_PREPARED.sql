-- PREPARED ONLY. Manual, separately authorized production cutover; never auto-run.
-- All gateways, 0013 row scope and 0015 target matrix must be installed first.
-- This transaction confirms the target and removes only the named legacy policy.
begin;
do $preconditions$
declare
  expected_digest text;
  current_digest text;
begin
  select matrix_digest into expected_digest from authorization_private.release_migration_state where version='0015_store_permission_target';
  if expected_digest is null then
    raise exception 'Target permission matrix 0015 is not installed'; end if;
  if not exists(select 1 from pg_catalog.pg_class where oid='public.engrase_sync'::regclass and relrowsecurity and not relforcerowsecurity) then
    raise exception 'engrase_sync RLS must be enabled and FORCE RLS disabled'; end if;
  if exists(select 1 from unnest(array[
      'public.lubrication_execution(text,text,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,boolean,numeric,boolean,text,text,numeric,text,text,jsonb,jsonb,timestamptz,timestamptz,timestamptz,timestamptz)',
      'public.report_anomaly(text,text,text,text,text,text,text,jsonb)',
      'public.edit_anomaly(text,text,text,timestamptz,text,text,text,text,jsonb)',
      'public.close_anomaly(text,text,text,timestamptz,text)',
      'public.retire_anomaly(text,text,timestamptz)',
      'public.repeat_anomaly_from_execution(text,text,text,timestamptz)',
      'public.capture_grease_validation(text,text,text,text,timestamptz,text,text,text,text)',
      'public.resolve_grease_validation_conflict(text,text,text,text,jsonb)',
      'public.move_equipment_master_location(text,text,timestamptz,text)',
      'public.set_equipment_shift(text,text,timestamptz,text)',
      'public.set_equipment_alert_pause(text,text,text,timestamptz,date,text)',
      'public.update_equipment_hourmeter(text,text,timestamptz,numeric,boolean)',
      'public.reprogram_lubrication_plan(text,text,text,timestamptz,date,text)',
      'public.manage_lubrication_assignment(text,text,text,timestamptz,text,text,text,text,text)',
      'public.record_lubrication_skip(text,text,timestamptz,text,text,text,text,timestamptz,text,text,text,text)',
      'public.get_authorization_context()',
      'public.resolve_authorization_scope(uuid)'
    ]) as required(signature) where to_regprocedure(required.signature) is null) then
    raise exception 'One or more required release RPC/bootstrap functions are missing'; end if;
  if exists(select 1 from unnest(array[
      'engrase_sync: leer según matriz','engrase_sync: crear según matriz','engrase_sync: actualizar según matriz',
      'authorization_scope_select','authorization_scope_insert','authorization_scope_update','authorization_scope_delete',
      'assignment_skip_rpc_insert_only','assignment_skip_rpc_update_only','assignment_skip_rpc_delete_only',
      'evidence_rpc_insert_only','evidence_rpc_update_only','evidence_rpc_delete_only',
      'catalog_insert_roles','catalog_update_roles','catalog_delete_roles','catalog_settings_read'
    ]) as required(policyname) where not exists(select 1 from pg_catalog.pg_policies p
      where p.schemaname='public' and p.tablename='engrase_sync'
        and p.policyname=required.policyname
        and (required.policyname in ('engrase_sync: leer según matriz','engrase_sync: crear según matriz',
          'engrase_sync: actualizar según matriz','catalog_settings_read') and p.permissive='PERMISSIVE'
          or required.policyname not in ('engrase_sync: leer según matriz','engrase_sync: crear según matriz',
          'engrase_sync: actualizar según matriz','catalog_settings_read') and p.permissive='RESTRICTIVE'))) then
    raise exception 'One or more required matrix/row-scope/RPC/catalog policies are missing'; end if;
  if (select count(*) from public.app_store_permissions where role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
      and store in ('anomalies','audit_log','cuadrillas','equipment','equipment_types','grease_validations','locations','lubricants',
        'lubrication_assignments','lubrication_plans','lubrication_points','lubrication_records','lubrication_skips',
        'notification_dispatch_log','push_tokens','settings','shifts','users')) <> 72 then
    raise exception 'Expected target matrix rows are missing'; end if;
  select md5(string_agg(store||':'||role||':'||can_read||':'||can_insert||':'||can_update||':'||can_delete,'|' order by store,role))
    into current_digest from public.app_store_permissions where role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
      and store in ('anomalies','audit_log','cuadrillas','equipment','equipment_types','grease_validations','locations','lubricants',
        'lubrication_assignments','lubrication_plans','lubrication_points','lubrication_records','lubrication_skips',
        'notification_dispatch_log','push_tokens','settings','shifts','users');
  if current_digest is distinct from expected_digest then raise exception 'Target permission matrix changed after 0015'; end if;
  if exists(select 1 from public.app_store_permissions where store='notification_dispatch_log'
      and role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR') and (can_read or can_insert or can_update or can_delete)) then
    raise exception 'notification_dispatch_log must be server-only'; end if;
  if exists(select 1 from public.app_store_permissions where store in ('lubrication_assignments','lubrication_skips',
      'lubrication_records','anomalies','grease_validations') and role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
      and (can_insert or can_update or can_delete)) then raise exception 'Typed RPC stores retain generic mutation permissions'; end if;
end
$preconditions$;

-- Explicitly remove anon's SQL privileges as defense in depth. RLS remains the
-- authority for authenticated operations; SECURITY DEFINER gateways perform
-- narrow server-validated writes.
revoke all on public.engrase_sync from anon;
revoke delete on public.engrase_sync from authenticated;
grant select,insert,update on public.engrase_sync to authenticated;
drop policy if exists "acceso interno con anon key" on public.engrase_sync;

do $postconditions$
begin
  if exists(select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='engrase_sync'
      and policyname='acceso interno con anon key') then raise exception 'Legacy anonymous policy still exists'; end if;
  if not exists(select 1 from pg_catalog.pg_class where oid='public.engrase_sync'::regclass and relrowsecurity) then
    raise exception 'RLS was unexpectedly disabled'; end if;
  if not exists(select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='engrase_sync'
      and policyname='engrase_sync: leer según matriz') then raise exception 'Matrix SELECT policy missing'; end if;
  if exists(select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='engrase_sync'
      and cmd='SELECT' and permissive='PERMISSIVE' and 'public'=any(roles)
      and coalesce(qual,'') in ('true','(true)')) then raise exception 'An open permissive SELECT policy remains'; end if;
  if has_table_privilege('anon','public.engrase_sync','SELECT') or has_table_privilege('anon','public.engrase_sync','INSERT')
      or has_table_privilege('anon','public.engrase_sync','UPDATE') or has_table_privilege('anon','public.engrase_sync','DELETE') then
    raise exception 'anon still has direct table privileges'; end if;
  if not has_table_privilege('authenticated','public.engrase_sync','SELECT')
      or not has_table_privilege('authenticated','public.engrase_sync','INSERT')
      or not has_table_privilege('authenticated','public.engrase_sync','UPDATE')
      or has_table_privilege('authenticated','public.engrase_sync','DELETE') then
    raise exception 'authenticated grants must allow RLS-governed select/insert/update and deny hard delete'; end if;
end
$postconditions$;
commit;
