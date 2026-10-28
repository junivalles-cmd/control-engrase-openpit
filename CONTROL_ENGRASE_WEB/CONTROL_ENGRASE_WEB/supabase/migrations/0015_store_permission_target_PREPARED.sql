-- PREPARED ONLY. Installs the generic transport matrix for PRE-0008.
-- Capability available only through a typed RPC is deliberately not represented
-- as a generic can_insert/can_update/can_delete grant.
begin;
do $preconditions$
begin
  if to_regprocedure('public.manage_lubrication_assignment(text,text,text,timestamptz,text,text,text,text,text)') is null
     or to_regprocedure('public.record_lubrication_skip(text,text,timestamptz,text,text,text,text,timestamptz,text,text,text,text)') is null then
    raise exception '0015 requires the 0014 assignment/skip gateways';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class c
    where c.oid='public.engrase_sync'::regclass and c.relrowsecurity and not c.relforcerowsecurity
  ) then
    raise exception '0015 requires engrase_sync RLS enabled and FORCE RLS disabled';
  end if;
  -- Require the actual 0007 catalog policies, not a migration filename or
  -- ledger entry. Verify table, command, restrictive mode, exact audience,
  -- and essential owner predicates before enabling generic push-token RIU.
  if exists (
    with expected(policyname,cmd,using_parts,check_parts) as (values
      ('push_tokens_select_owner_only','SELECT',
        array[$q$store<>'push_tokens'$q$,$q$current_app_active()$q$,$q$payload->>'userid'$q$,$q$app_profiles$q$,$q$auth.uid()$q$,$q$active=true$q$]::text[],
        array[]::text[]),
      ('push_tokens_insert_owner_only','INSERT',
        array[]::text[],
        array[$q$store<>'push_tokens'$q$,$q$current_app_active()$q$,$q$notdeleted$q$,$q$payload->>'userid'$q$,$q$app_profiles$q$,$q$auth.uid()$q$,$q$active=true$q$]::text[]),
      ('push_tokens_update_owner_only','UPDATE',
        array[$q$store<>'push_tokens'$q$,$q$current_app_active()$q$,$q$notdeleted$q$,$q$payload->>'userid'$q$,$q$app_profiles$q$,$q$auth.uid()$q$,$q$active=true$q$]::text[],
        array[$q$store<>'push_tokens'$q$,$q$current_app_active()$q$,$q$notdeleted$q$,$q$payload->>'userid'$q$,$q$app_profiles$q$,$q$auth.uid()$q$,$q$active=true$q$]::text[]),
      ('push_tokens_no_hard_delete','DELETE',
        array[$q$store<>'push_tokens'$q$]::text[],array[]::text[])
    ), actual as (
      select e.*,p.permissive,p.roles,p.cmd as actual_cmd,
        lower(regexp_replace(coalesce(p.qual,''),'[[:space:]]','','g')) as using_sql,
        lower(regexp_replace(coalesce(p.with_check,''),'[[:space:]]','','g')) as check_sql,
        regexp_replace(
          regexp_replace(lower(coalesce(p.with_check,'')),'::text','','g'),
          '[[:space:]()]','','g'
        ) as check_semantic_sql
      from expected e left join pg_catalog.pg_policies p
        on p.schemaname='public' and p.tablename='engrase_sync' and p.policyname=e.policyname
    )
    select 1 from actual a
    where a.permissive is distinct from 'RESTRICTIVE'
       or a.actual_cmd is distinct from a.cmd
       or cardinality(a.roles) is distinct from 1
       or not ('authenticated'=any(coalesce(a.roles,array[]::name[])))
       or exists(select 1 from unnest(a.using_parts) as req(fragment) where position(req.fragment in a.using_sql)=0)
       or exists(select 1 from unnest(a.check_parts) as req(fragment) where position(req.fragment in a.check_sql)=0)
       -- PostgreSQL deparses this invariant with parentheses/casts (and may
       -- qualify id). Normalize only those formatting artifacts, then still
       -- require payload.id to equal the row id for INSERT and UPDATE.
       or (a.policyname in ('push_tokens_insert_owner_only','push_tokens_update_owner_only')
           and a.check_semantic_sql !~ $rx$payload->>'id'=(engrase_sync\.)?id$rx$)
  ) then
    raise exception '0015 requires all four exact-scope 0007 restrictive owner guards on public.engrase_sync for authenticated';
  end if;
  if (select count(*) from public.app_store_permissions
      where role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
        and store in ('anomalies','audit_log','cuadrillas','equipment','equipment_types','grease_validations','locations','lubricants',
          'lubrication_assignments','lubrication_plans','lubrication_points','lubrication_records','lubrication_skips',
          'notification_dispatch_log','push_tokens','settings','shifts','users')) <> 72 then
    raise exception '0015 requires exactly the known 72 role/store rows; reconcile missing or duplicate matrix rows first';
  end if;
end
$preconditions$;

with target(store,role,can_read,can_insert,can_update,can_delete) as (values
 ('anomalies','ADMINISTRADOR',true,false,false,false),('audit_log','ADMINISTRADOR',true,false,false,false),
 ('cuadrillas','ADMINISTRADOR',true,true,true,true),('equipment','ADMINISTRADOR',true,true,true,true),
 ('equipment_types','ADMINISTRADOR',true,true,true,true),('grease_validations','ADMINISTRADOR',true,false,false,false),
 ('locations','ADMINISTRADOR',true,true,true,true),('lubricants','ADMINISTRADOR',true,true,true,true),
 ('lubrication_assignments','ADMINISTRADOR',true,false,false,false),('lubrication_plans','ADMINISTRADOR',true,true,true,true),
 ('lubrication_points','ADMINISTRADOR',true,true,true,true),('lubrication_records','ADMINISTRADOR',true,false,false,false),
 ('lubrication_skips','ADMINISTRADOR',true,false,false,false),('notification_dispatch_log','ADMINISTRADOR',false,false,false,false),
 ('push_tokens','ADMINISTRADOR',true,true,true,false),('settings','ADMINISTRADOR',true,true,true,false),
 ('shifts','ADMINISTRADOR',true,true,true,true),('users','ADMINISTRADOR',false,false,false,false),
 ('anomalies','PLANIFICADOR',false,false,false,false),('audit_log','PLANIFICADOR',false,false,false,false),
 ('cuadrillas','PLANIFICADOR',true,false,false,false),('equipment','PLANIFICADOR',true,false,false,false),
 ('equipment_types','PLANIFICADOR',true,false,false,false),('grease_validations','PLANIFICADOR',true,false,false,false),
 ('locations','PLANIFICADOR',true,false,false,false),('lubricants','PLANIFICADOR',true,false,false,false),
 ('lubrication_assignments','PLANIFICADOR',true,false,false,false),('lubrication_plans','PLANIFICADOR',true,true,true,false),
 ('lubrication_points','PLANIFICADOR',true,true,true,false),('lubrication_records','PLANIFICADOR',true,false,false,false),
 ('lubrication_skips','PLANIFICADOR',true,false,false,false),('notification_dispatch_log','PLANIFICADOR',false,false,false,false),
 ('push_tokens','PLANIFICADOR',true,true,true,false),('settings','PLANIFICADOR',true,false,false,false),
 ('shifts','PLANIFICADOR',true,false,false,false),('users','PLANIFICADOR',false,false,false,false),
 ('anomalies','SUPERVISOR',true,false,false,false),('audit_log','SUPERVISOR',false,false,false,false),
 ('cuadrillas','SUPERVISOR',true,false,false,false),('equipment','SUPERVISOR',true,false,false,false),
 ('equipment_types','SUPERVISOR',true,false,false,false),('grease_validations','SUPERVISOR',true,false,false,false),
 ('locations','SUPERVISOR',true,false,false,false),('lubricants','SUPERVISOR',true,false,false,false),
 ('lubrication_assignments','SUPERVISOR',true,false,false,false),('lubrication_plans','SUPERVISOR',true,false,false,false),
 ('lubrication_points','SUPERVISOR',true,false,false,false),('lubrication_records','SUPERVISOR',true,false,false,false),
 ('lubrication_skips','SUPERVISOR',true,false,false,false),('notification_dispatch_log','SUPERVISOR',false,false,false,false),
 ('push_tokens','SUPERVISOR',true,true,true,false),('settings','SUPERVISOR',true,false,false,false),
 ('shifts','SUPERVISOR',true,false,false,false),('users','SUPERVISOR',false,false,false,false),
 ('anomalies','LUBRICADOR',true,false,false,false),('audit_log','LUBRICADOR',false,false,false,false),
 ('cuadrillas','LUBRICADOR',true,false,false,false),('equipment','LUBRICADOR',true,false,false,false),
 ('equipment_types','LUBRICADOR',true,false,false,false),('grease_validations','LUBRICADOR',true,false,false,false),
 ('locations','LUBRICADOR',true,false,false,false),('lubricants','LUBRICADOR',true,false,false,false),
 ('lubrication_assignments','LUBRICADOR',true,false,false,false),('lubrication_plans','LUBRICADOR',true,false,false,false),
 ('lubrication_points','LUBRICADOR',true,false,false,false),('lubrication_records','LUBRICADOR',true,false,false,false),
 ('lubrication_skips','LUBRICADOR',true,false,false,false),('notification_dispatch_log','LUBRICADOR',false,false,false,false),
 ('push_tokens','LUBRICADOR',true,true,true,false),('settings','LUBRICADOR',true,false,false,false),
 ('shifts','LUBRICADOR',true,false,false,false),('users','LUBRICADOR',false,false,false,false)
)
update public.app_store_permissions p set can_read=t.can_read,can_insert=t.can_insert,
  can_update=t.can_update,can_delete=t.can_delete
from target t where p.store=t.store and p.role=t.role;

do $assertions$
begin
  if exists(select 1 from public.app_store_permissions where store='notification_dispatch_log'
      and role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
      and (can_read or can_insert or can_update or can_delete)) then raise exception 'dispatch log must remain server-only'; end if;
  if exists(select 1 from public.app_store_permissions where store in ('lubrication_assignments','lubrication_skips',
      'lubrication_records','anomalies','grease_validations') and role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
      and (can_insert or can_update or can_delete)) then raise exception 'typed RPC stores cannot retain generic mutation permissions'; end if;
end
$assertions$;
create table if not exists authorization_private.release_migration_state (
  version text primary key, applied_at timestamptz not null default clock_timestamp(), matrix_digest text not null
);
revoke all on authorization_private.release_migration_state from public,anon,authenticated;
insert into authorization_private.release_migration_state(version,matrix_digest)
  select '0015_store_permission_target',md5(string_agg(store||':'||role||':'||can_read||':'||can_insert||':'||can_update||':'||can_delete,'|' order by store,role))
  from public.app_store_permissions where role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
    and store in ('anomalies','audit_log','cuadrillas','equipment','equipment_types','grease_validations','locations','lubricants',
      'lubrication_assignments','lubrication_plans','lubrication_points','lubrication_records','lubrication_skips',
      'notification_dispatch_log','push_tokens','settings','shifts','users')
  on conflict(version) do update set applied_at=excluded.applied_at,matrix_digest=excluded.matrix_digest;
commit;
