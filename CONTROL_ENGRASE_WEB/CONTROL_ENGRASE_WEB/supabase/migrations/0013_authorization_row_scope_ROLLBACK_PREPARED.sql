-- MANUAL-PRODUCTION-PREPARED safe stop of repaired 0013, before later rollout.
-- Stop sync clients first. Restore readiness=false and exactly the four prior
-- READ=false bits asserted by repaired 0013's installation precondition.
-- KEEP all eight restrictive policies, helpers and data. Never use CASCADE.
-- This does not disable direct authenticated table access, repair legacy
-- rows/tombstones, or resolve anonymous exposure from legacy ALL/true.
-- Keep 0012 helpers: restrictive policies depend on them even after rollback.
-- Do not use this rollback alone after 0015/cutover: its equipment read change
-- would diverge from the recorded target-matrix digest. Use release safe-stop.
begin;
do $rollback_preconditions$
begin
  if to_regprocedure('authorization_private.authorization_store_action_allowed(text,text,boolean)') is null
     or (select count(*) from pg_catalog.pg_policies where schemaname='public'
       and tablename='engrase_sync' and policyname in (
        'authorization_store_select','authorization_store_insert','authorization_store_update','authorization_store_delete',
        'authorization_scope_select','authorization_scope_insert','authorization_scope_update','authorization_scope_delete')
       and permissive='RESTRICTIVE' and roles=array['authenticated']::name[])<>8 then
    raise exception 'Rollback requires repaired 0013 with all eight restrictive protections';
  end if;
  if to_regprocedure('public.assignment_skip_operation(text,text,text,timestamptz,text,text,text,text,text,timestamptz,text,text,text,text)') is not null
     or to_regclass('authorization_private.release_migration_state') is not null then
    raise exception 'Later rollout detected; use the separately reviewed release safe-stop';
  end if;
  perform 1 from public.app_store_permissions
    where (store='equipment' and role='LUBRICADOR')
       or (store='settings' and role in ('PLANIFICADOR','SUPERVISOR','LUBRICADOR'))
    for update;
  if (select count(*) from public.app_store_permissions
       where (store='equipment' and role='LUBRICADOR')
          or (store='settings' and role in ('PLANIFICADOR','SUPERVISOR','LUBRICADOR')))<>4
     or exists (select 1 from public.app_store_permissions
       where (store='equipment' and role='LUBRICADOR')
          or (store='settings' and role in ('PLANIFICADOR','SUPERVISOR','LUBRICADOR'))
       group by store,role having count(*)<>1 or bool_or(can_read is null))
     or (select count(*) from public.app_store_permissions
       where ((store='equipment' and role='LUBRICADOR')
          or (store='settings' and role in ('PLANIFICADOR','SUPERVISOR','LUBRICADOR'))) and can_read) not in (0,4) then
    raise exception 'READ bits drifted; expected installed all true or already rolled back all false';
  end if;
end
$rollback_preconditions$;
create or replace function public.get_authorization_context()
returns jsonb language sql stable security definer set search_path=pg_catalog as $bootstrap$
  select case when c->>'status'='AUTHORIZED'
    then jsonb_set(c,'{context,rowScopeEnforced}','false'::jsonb,false)
    else c end
  from (select public.resolve_authorization_scope(auth.uid()) as c) s;
$bootstrap$;
revoke all on function public.get_authorization_context() from public,anon;
grant execute on function public.get_authorization_context() to authenticated;
update public.app_store_permissions set can_read=false
  where (store='equipment' and role='LUBRICADOR')
     or (store='settings' and role in ('PLANIFICADOR','SUPERVISOR','LUBRICADOR'));
commit;
