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
  -- Recheck the real 0007 catalog policies at the cutover boundary. 0015
  -- checked them before changing the matrix; fail if they were later removed
  -- or weakened. Do not recreate or replace guards here.
  if exists (
    with expected(policyname,cmd,using_parts,check_parts) as (values
      ('push_tokens_select_owner_only','SELECT',array[$q$store<>'push_tokens'$q$,$q$current_app_active()$q$,$q$payload->>'userid'$q$,$q$app_profiles$q$,$q$auth.uid()$q$,$q$active=true$q$]::text[],array[]::text[]),
      ('push_tokens_insert_owner_only','INSERT',array[]::text[],array[$q$store<>'push_tokens'$q$,$q$current_app_active()$q$,$q$notdeleted$q$,$q$payload->>'id'=id$q$,$q$payload->>'userid'$q$,$q$app_profiles$q$,$q$auth.uid()$q$,$q$active=true$q$]::text[]),
      ('push_tokens_update_owner_only','UPDATE',array[$q$store<>'push_tokens'$q$,$q$current_app_active()$q$,$q$notdeleted$q$,$q$payload->>'userid'$q$,$q$app_profiles$q$,$q$auth.uid()$q$,$q$active=true$q$]::text[],array[$q$store<>'push_tokens'$q$,$q$current_app_active()$q$,$q$notdeleted$q$,$q$payload->>'id'=id$q$,$q$payload->>'userid'$q$,$q$app_profiles$q$,$q$auth.uid()$q$,$q$active=true$q$]::text[]),
      ('push_tokens_no_hard_delete','DELETE',array[$q$store<>'push_tokens'$q$]::text[],array[]::text[])
    ), actual as (
      select e.*,p.permissive,p.roles,p.cmd as actual_cmd,
        lower(regexp_replace(coalesce(p.qual,''),'[[:space:]]','','g')) as using_sql,
        lower(regexp_replace(coalesce(p.with_check,''),'[[:space:]]','','g')) as check_sql
      from expected e left join pg_catalog.pg_policies p
        on p.schemaname='public' and p.tablename='engrase_sync' and p.policyname=e.policyname
    )
    select 1 from actual a
    where a.permissive is distinct from 'RESTRICTIVE' or a.actual_cmd is distinct from a.cmd
       or cardinality(a.roles) is distinct from 1
       or not ('authenticated'=any(coalesce(a.roles,array[]::name[])))
       or exists(select 1 from unnest(a.using_parts) as req(fragment) where position(req.fragment in a.using_sql)=0)
       or exists(select 1 from unnest(a.check_parts) as req(fragment) where position(req.fragment in a.check_sql)=0)
  ) then raise exception 'Cutover requires all four intact 0007 authenticated restrictive owner guards'; end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid=to_regprocedure('public.get_authorization_context()')
      and position($q$jsonb_set(c,'{context,rowscopeenforced}','true'::jsonb,false)$q$
        in lower(regexp_replace(pg_catalog.pg_get_functiondef(p.oid),'[[:space:]]','','g'))) > 0
  ) then raise exception 'Cutover requires 0013 rowScopeEnforced=true bootstrap implementation'; end if;
  if (select count(*) from pg_catalog.pg_policies where schemaname='public' and tablename='engrase_sync'
      and policyname in ('authorization_scope_select','authorization_scope_insert','authorization_scope_update','authorization_scope_delete')
      and permissive='RESTRICTIVE' and cardinality(roles)=1 and 'authenticated'=any(roles)
      and case policyname
        when 'authorization_scope_select' then coalesce(qual,'') ilike '%authorization_private.authorization_row_in_scope%'
        when 'authorization_scope_insert' then coalesce(with_check,'') ilike '%authorization_private.authorization_row_in_scope%'
        when 'authorization_scope_update' then coalesce(qual,'') ilike '%authorization_private.authorization_row_in_scope%'
          and coalesce(with_check,'') ilike '%authorization_private.authorization_row_in_scope%'
        when 'authorization_scope_delete' then coalesce(qual,'') ilike '%authorization_private.authorization_row_in_scope%'
        else false end) <> 4 then
    raise exception 'Cutover requires all four 0013 authenticated row-scope policies'; end if;
  if not exists(select 1 from pg_catalog.pg_proc p where p.oid=to_regprocedure(
      'authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb)')
      and pg_catalog.pg_get_functiondef(p.oid) ilike '%auth.uid() is null%'
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
        where acl.grantee=0 and acl.privilege_type='EXECUTE')) then
    raise exception 'Cutover requires the 0013 row-scope classifier'; end if;
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
