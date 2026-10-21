-- MANUAL-PRODUCTION-PREPARED rollback for 0016 ONLY. Restores
-- authorization_row_in_scope() to byte-for-byte the body 0014 installed
-- (EXISTS(SELECT ... FROM support_grant_rows())). Does NOT drop
-- support_row_granted() (never destructive — same philosophy as every
-- other rollback in this folder): it stays installed, revoked, unused.
-- Does not touch policies (same OID, same reasoning as 0016 forward), does
-- not touch 0013/0014 objects, does not touch data, does not touch
-- app_store_permissions. Safe to re-apply 0016 again afterward.
begin;

do $preconditions$
begin
  if to_regprocedure('authorization_private.authorization_row_in_scope_baseline_0013(text,text,jsonb,text,jsonb)') is null
     or to_regprocedure('authorization_private.support_grant_rows()') is null
  then
    raise exception '0016 rollback requires 0014 objects (unchanged by 0016) to still be present';
  end if;
end
$preconditions$;

create or replace function authorization_private.authorization_row_in_scope(
  p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb
) returns boolean
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if p_action='SELECT' and auth.uid() is not null and p_context->>'status'='AUTHORIZED'
   and p_context->'context'->>'authUserId'=auth.uid()::text
   and exists(select 1 from authorization_private.support_grant_rows() g where g.store=p_store and g.id=p_id) then return true; end if;
 return authorization_private.authorization_row_in_scope_baseline_0013(p_store,p_id,p_payload,p_action,p_context);
end $$;

revoke all on function authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb) from public,anon;
grant execute on function authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb) to authenticated;
comment on function authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb) is
  '0016 rolled back: SELECT fast-path restored to the 0014-installed EXISTS(support_grant_rows()) form.';

-- support_row_granted() is left installed but unreachable (nothing calls
-- it once the wrapper above no longer references it) — never dropped.
revoke all on function authorization_private.support_row_granted(text,text,jsonb) from public,anon,authenticated;

delete from authorization_private.release_migration_state where version='0016_fix_support_rls_performance';

commit;
