-- PREPARED ONLY. Safe client rollback: return the bootstrap readiness bit to
-- false and revert the single LUBRICADOR/equipment read bit, but KEEP
-- restrictive row policies installed. Dropping them after 0003 would reopen
-- the broader store-matrix policies.
begin;
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
  where store='equipment' and role='LUBRICADOR';
commit;
