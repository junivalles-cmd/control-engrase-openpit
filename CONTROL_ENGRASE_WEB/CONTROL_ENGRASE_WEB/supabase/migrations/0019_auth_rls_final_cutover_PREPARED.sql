-- MANUAL-PRODUCTION-PREPARED: final Auth/RLS cutover after 0007, 0015,
-- 0017 and 0018. This file never recreates or replaces authorization logic.
-- Its only state changes are the explicit grants/policy cutover and ledger.
begin;

do $preconditions$
declare
  expected_digest text;
  current_digest text;
begin
  if exists(select 1 from authorization_private.release_migration_state
      where version='0019_auth_rls_final_cutover') then
    raise exception '0019 is already recorded';
  end if;

  if not exists(select 1 from pg_catalog.pg_class
      where oid='public.engrase_sync'::regclass and relrowsecurity and not relforcerowsecurity) then
    raise exception 'engrase_sync RLS must be enabled and FORCE RLS disabled';
  end if;

  select matrix_digest into expected_digest
  from authorization_private.release_migration_state
  where version='0015_store_permission_target';
  if expected_digest is null then raise exception '0015 ledger is missing'; end if;

  if (select count(*) from public.app_store_permissions
      where role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
        and store in ('anomalies','audit_log','cuadrillas','equipment','equipment_types','grease_validations','locations','lubricants',
          'lubrication_assignments','lubrication_plans','lubrication_points','lubrication_records','lubrication_skips',
          'notification_dispatch_log','push_tokens','settings','shifts','users')) <> 72 then
    raise exception 'Expected 72 target matrix rows';
  end if;

  select md5(string_agg(store||':'||role||':'||can_read||':'||can_insert||':'||can_update||':'||can_delete,
      '|' order by store,role)) into current_digest
  from public.app_store_permissions
  where role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
    and store in ('anomalies','audit_log','cuadrillas','equipment','equipment_types','grease_validations','locations','lubricants',
      'lubrication_assignments','lubrication_plans','lubrication_points','lubrication_records','lubrication_skips',
      'notification_dispatch_log','push_tokens','settings','shifts','users');
  if current_digest is distinct from expected_digest then
    raise exception '0015 matrix digest drift';
  end if;

  if exists(select 1 from public.app_store_permissions
      where store in ('lubrication_assignments','lubrication_skips','lubrication_records','anomalies','grease_validations')
        and role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
        and (can_insert or can_update or can_delete)) then
    raise exception 'RPC-only stores retain generic mutation permissions';
  end if;

  if (select count(*) from pg_catalog.pg_policies
      where schemaname='public' and tablename='engrase_sync'
        and policyname in ('push_tokens_select_owner_only','push_tokens_insert_owner_only',
          'push_tokens_update_owner_only','push_tokens_no_hard_delete')
        and permissive='RESTRICTIVE' and cardinality(roles)=1 and 'authenticated'=any(roles)) <> 4 then
    raise exception '0007 owner guards are missing or weakened';
  end if;

  if exists(select 1 from unnest(array[
      'engrase_sync: leer según matriz','engrase_sync: crear según matriz','engrase_sync: actualizar según matriz',
      'authorization_store_select','authorization_store_insert','authorization_store_update','authorization_store_delete',
      'authorization_scope_select','authorization_scope_insert','authorization_scope_update','authorization_scope_delete',
      'assignment_skip_rpc_insert_only','assignment_skip_rpc_update_only','assignment_skip_rpc_delete_only',
      'evidence_rpc_insert_only','evidence_rpc_update_only','evidence_rpc_delete_only',
      'catalog_insert_roles','catalog_update_roles','catalog_delete_roles','catalog_settings_read'
    ]) required(policyname) where not exists(select 1 from pg_catalog.pg_policies p
      where p.schemaname='public' and p.tablename='engrase_sync' and p.policyname=required.policyname)) then
    raise exception 'Required matrix/0013/0014 policies are missing';
  end if;

  if not exists(select 1 from authorization_private.release_migration_state
      where version='0017_broadcast_messages_scope')
     or not exists(select 1 from authorization_private.release_migration_state
      where version='0018_supervisor_broadcast_permissions')
     or to_regprocedure('authorization_private.broadcast_row_in_scope(text,text,jsonb,text,jsonb)') is null
     or to_regprocedure('authorization_private.manual_task_row_in_scope(text,text,jsonb,text,jsonb)') is null
     or not exists(select 1 from pg_catalog.pg_proc p
       where p.oid=to_regprocedure('authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb)')
         and p.prosrc ilike '%broadcast_row_in_scope%'
         and p.prosrc ilike '%manual_task_row_in_scope%') then
    raise exception '0017/0018 authorization state is incomplete';
  end if;

  if (select count(*) from pg_catalog.pg_policies
      where schemaname='public' and tablename='engrase_sync'
        and policyname in ('authorization_scope_insert','authorization_scope_update','authorization_scope_delete')
        and coalesce(qual,'')||coalesce(with_check,'') ilike '%broadcast_messages%'
        and coalesce(qual,'')||coalesce(with_check,'') ilike '%manual_tasks%') <> 3 then
    raise exception '0017/0018 write-scope routes are incomplete';
  end if;

  if (select count(*) from pg_catalog.pg_policies
      where schemaname='public' and tablename='engrase_sync'
        and policyname='acceso interno con anon key'
        and cmd='ALL' and permissive='PERMISSIVE' and 'public'=any(roles)
        and coalesce(qual,'') in ('true','(true)')
        and coalesce(with_check,'') in ('true','(true)')) <> 1 then
    raise exception 'Legacy public policy does not match expected cutover baseline';
  end if;

  if not (has_table_privilege('anon','public.engrase_sync','SELECT')
      and has_table_privilege('anon','public.engrase_sync','INSERT')
      and has_table_privilege('anon','public.engrase_sync','UPDATE')
      and has_table_privilege('anon','public.engrase_sync','DELETE')) then
    raise exception 'anon grants differ from expected pre-cutover baseline';
  end if;

  if not (has_table_privilege('authenticated','public.engrase_sync','SELECT')
      and has_table_privilege('authenticated','public.engrase_sync','INSERT')
      and has_table_privilege('authenticated','public.engrase_sync','UPDATE')
      and has_table_privilege('authenticated','public.engrase_sync','DELETE')) then
    raise exception 'authenticated grants differ from expected pre-cutover baseline';
  end if;
end
$preconditions$;

revoke all on public.engrase_sync from anon;
revoke delete on public.engrase_sync from authenticated;
drop policy "acceso interno con anon key" on public.engrase_sync;

insert into authorization_private.release_migration_state(version,matrix_digest)
select '0019_auth_rls_final_cutover',matrix_digest
from authorization_private.release_migration_state
where version='0015_store_permission_target';

do $postconditions$
begin
  if exists(select 1 from pg_catalog.pg_policies
      where schemaname='public' and tablename='engrase_sync'
        and policyname='acceso interno con anon key') then
    raise exception 'Legacy public policy still exists';
  end if;
  if has_table_privilege('anon','public.engrase_sync','SELECT')
      or has_table_privilege('anon','public.engrase_sync','INSERT')
      or has_table_privilege('anon','public.engrase_sync','UPDATE')
      or has_table_privilege('anon','public.engrase_sync','DELETE') then
    raise exception 'anon retains engrase_sync privileges';
  end if;
  if not has_table_privilege('authenticated','public.engrase_sync','SELECT')
      or not has_table_privilege('authenticated','public.engrase_sync','INSERT')
      or not has_table_privilege('authenticated','public.engrase_sync','UPDATE')
      or has_table_privilege('authenticated','public.engrase_sync','DELETE') then
    raise exception 'authenticated grants do not match final target';
  end if;
  if not exists(select 1 from authorization_private.release_migration_state
      where version='0019_auth_rls_final_cutover') then
    raise exception '0019 ledger entry missing';
  end if;
end
$postconditions$;

commit;
