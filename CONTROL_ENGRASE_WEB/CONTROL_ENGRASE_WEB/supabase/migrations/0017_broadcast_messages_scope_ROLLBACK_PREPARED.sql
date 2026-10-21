-- MANUAL-PRODUCTION-PREPARED rollback for 0017 ONLY. Restores
-- authorization_row_in_scope() to byte-for-byte the body 0016 installed
-- (no broadcast_messages/broadcast_message_reads/manual_tasks branch).
-- Does NOT drop authorization_private.broadcast_row_in_scope() or
-- authorization_private.manual_task_row_in_scope() (never destructive —
-- same philosophy as 0016's own rollback, which kept support_row_granted
-- installed, revoked, unused): both stay installed, revoked, unreachable.
-- Restores I/U/D policies to their original baseline_0013 bindings.
-- Does not edit migration 0013/0014/0015/0016 files, remove their objects,
-- or touch any existing operational store's data.
--
-- Removes ONLY 0017's matrix rows. Keeping them would allow GLOBAL users
-- through baseline_0013 after rollback (it accepts unknown stores for
-- GLOBAL roles). New-store data rows are preserved, but no API role can
-- access them without a matrix grant. Helper functions remain revoked;
-- consequently a future re-apply requires separate review of those
-- retained objects and is intentionally rejected by forward preconditions.
begin;

do $preconditions$
begin
  if to_regprocedure('authorization_private.authorization_row_in_scope_baseline_0013(text,text,jsonb,text,jsonb)') is null
     or to_regprocedure('authorization_private.support_row_granted(text,text,jsonb)') is null
     or to_regprocedure('authorization_private.broadcast_row_in_scope(text,text,jsonb,text,jsonb)') is null
     or to_regprocedure('authorization_private.manual_task_row_in_scope(text,text,jsonb,text,jsonb)') is null
  then
    raise exception '0017 rollback requires 0013/0014/0016 objects (unchanged by 0017) and broadcast_row_in_scope()/manual_task_row_in_scope() (installed by 0017) to still be present';
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
    and authorization_private.support_row_granted(p_store,p_id,p_context) then return true; end if;
  return authorization_private.authorization_row_in_scope_baseline_0013(p_store,p_id,p_payload,p_action,p_context);
end $$;

-- Restore the original 0013 write-policy bindings retained by 0014/0016.
alter policy authorization_scope_insert on public.engrase_sync with check (
  authorization_private.authorization_row_in_scope_baseline_0013(store,id,payload,'INSERT',(select public.get_authorization_context()))
);
alter policy authorization_scope_update on public.engrase_sync using (
  authorization_private.authorization_row_in_scope_baseline_0013(store,id,payload,'UPDATE',(select public.get_authorization_context()))
) with check (
  authorization_private.authorization_row_in_scope_baseline_0013(store,id,payload,'UPDATE',(select public.get_authorization_context()))
);
alter policy authorization_scope_delete on public.engrase_sync using (
  authorization_private.authorization_row_in_scope_baseline_0013(store,id,payload,'DELETE',(select public.get_authorization_context()))
);

-- baseline_0013 accepts unknown stores for GLOBAL roles. Remove ONLY
-- 0017 matrix grants or rollback would expose unclassified new rows.
delete from public.app_store_permissions
where store in ('broadcast_messages','broadcast_message_reads','manual_tasks');

revoke all on function authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb) from public,anon;
grant execute on function authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb) to authenticated;
comment on function authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb) is
  '0017 rolled back: dispatcher restored to the 0016-installed form (support_row_granted() fast path + authorization_row_in_scope_baseline_0013() fallback only). broadcast_row_in_scope()/manual_task_row_in_scope() left installed but unreachable.';

-- Left installed but unreachable (nothing calls them once the dispatcher
-- above no longer references them) — never dropped.
revoke all on function authorization_private.broadcast_row_in_scope(text,text,jsonb,text,jsonb) from public,anon,authenticated;
revoke all on function authorization_private.manual_task_row_in_scope(text,text,jsonb,text,jsonb) from public,anon,authenticated;

delete from authorization_private.release_migration_state where version='0017_broadcast_messages_scope';

commit;
