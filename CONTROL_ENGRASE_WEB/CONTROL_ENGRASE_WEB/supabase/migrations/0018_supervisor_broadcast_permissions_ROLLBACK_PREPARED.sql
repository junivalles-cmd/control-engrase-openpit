-- MANUAL-PRODUCTION-PREPARED rollback for 0018 ONLY. Restores
-- authorization_private.broadcast_row_in_scope() to byte-for-byte the
-- body 0017 installed (SUPERVISOR excluded from broadcast_messages
-- entirely — no INSERT/UPDATE/DELETE/SELECT access of any kind). Does NOT
-- touch 0014/0015/0016/0017 files, their objects, or manual_tasks (0018
-- never touched manual_task_row_in_scope() either). broadcast_message_reads
-- and LUBRICADOR targeting (including real crew_locations-based LOCATION
-- coverage) are untouched by this rollback — 0018 never changed that half
-- of the function.
--
-- Removes ONLY the SUPERVISOR matrix grant 0018 added (can_read/can_insert/
-- can_update on broadcast_messages) — ADMIN/PLANIFICADOR/LUBRICADOR rows
-- for broadcast_messages, and all rows for broadcast_message_reads/
-- manual_tasks, are left exactly as 0017 installed them (not deleted, not
-- touched at all).
begin;

do $preconditions$
begin
  if to_regprocedure('authorization_private.broadcast_row_in_scope(text,text,jsonb,text,jsonb)') is null then
    raise exception '0018 rollback requires authorization_private.broadcast_row_in_scope() (installed by 0017/modified by 0018) to still be present';
  end if;
end
$preconditions$;

create or replace function authorization_private.broadcast_row_in_scope(
  p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb
) returns boolean
language plpgsql stable security definer set search_path=pg_catalog as $broadcast$
declare
  ctx jsonb;
  app_user text;
  app_role text;
  crews jsonb;
  target_type text;
  target_id text;
  linked_payload jsonb;
begin
  if auth.uid() is null or p_store is null or p_id is null or p_payload is null then return false; end if;
  if p_context->>'status' is distinct from 'AUTHORIZED' then return false; end if;
  ctx := p_context->'context';
  if ctx->>'authUserId' is distinct from auth.uid()::text then return false; end if;
  app_user := ctx->>'appUserId';
  app_role := ctx->>'role';
  crews := coalesce(ctx->'authorizedCrewIds','[]'::jsonb);

  if p_store = 'broadcast_messages' then
    if app_role is null or app_role not in ('ADMINISTRADOR','PLANIFICADOR','LUBRICADOR') then return false; end if;
    if p_action = 'INSERT' then
      return app_role in ('ADMINISTRADOR','PLANIFICADOR') and p_payload->>'createdBy' = app_user;
    elsif p_action in ('UPDATE','DELETE') then
      return app_role in ('ADMINISTRADOR','PLANIFICADOR');
    end if;

    if p_action is distinct from 'SELECT' then return false; end if;
    if app_role in ('ADMINISTRADOR','PLANIFICADOR') then return true; end if;
    target_type := p_payload->>'targetType';
    target_id := p_payload->>'targetId';
    if target_type = 'ALL_LUBRICATORS' then
      return app_role = 'LUBRICADOR';
    elsif target_type = 'USER' then
      return app_role = 'LUBRICADOR' and target_id = app_user;
    elsif target_type = 'CREW' then
      return app_role = 'LUBRICADOR' and (crews ? target_id);
    elsif target_type = 'LOCATION' then
      return app_role = 'LUBRICADOR' and exists (
        select 1 from jsonb_array_elements_text(crews) as member(crew_id)
        where exists (
          select 1 from public.engrase_sync cl
          where cl.store='crew_locations' and not cl.deleted
            and cl.payload->>'crew_id'=member.crew_id
            and coalesce(cl.payload->>'active','true')='true'
            and cl.payload->>'location_id'=target_id
        ) or (
          not exists (select 1 from public.engrase_sync cl
            where cl.store='crew_locations' and cl.payload->>'crew_id'=member.crew_id)
          and exists (select 1 from public.engrase_sync c
            where c.store='cuadrillas' and c.id=member.crew_id and not c.deleted
              and coalesce(c.payload->>'active','true')='true'
              and c.payload->>'locationId'=target_id)
        )
      );
    else
      return false;
    end if;
  end if;

  if p_store = 'broadcast_message_reads' then
    if app_role is distinct from 'LUBRICADOR' then return false; end if;
    if p_action is null or p_action not in ('SELECT','INSERT','UPDATE') then return false; end if;
    if p_payload->>'userId' is distinct from app_user then return false; end if;
    if p_id is distinct from (coalesce(p_payload->>'messageId','') || ':' || coalesce(p_payload->>'userId','')) then
      return false;
    end if;
    select e.payload into linked_payload from public.engrase_sync e
      where e.store = 'broadcast_messages' and e.id = (p_payload->>'messageId') and not e.deleted;
    if linked_payload is null then return false; end if;
    return authorization_private.broadcast_row_in_scope('broadcast_messages', p_payload->>'messageId', linked_payload, 'SELECT', p_context);
  end if;

  return false;
end
$broadcast$;

revoke all on function authorization_private.broadcast_row_in_scope(text,text,jsonb,text,jsonb) from public,anon,authenticated;
comment on function authorization_private.broadcast_row_in_scope(text,text,jsonb,text,jsonb) is
  '0018 rolled back: SUPERVISOR excluded from broadcast_messages again (0017 baseline body — ADMINISTRADOR/PLANIFICADOR create/manage, LUBRICADOR receives, SUPERVISOR has zero access). broadcast_message_reads unchanged.';

update public.app_store_permissions
set can_read = false, can_insert = false, can_update = false
where store = 'broadcast_messages' and role = 'SUPERVISOR';

do $assertions$
begin
  if exists (select 1 from public.app_store_permissions where store='broadcast_messages' and role='SUPERVISOR'
      and (can_read or can_insert or can_update or can_delete)) then
    raise exception '0018 rollback must leave SUPERVISOR with zero broadcast_messages matrix access (0017 baseline)';
  end if;
end
$assertions$;

delete from authorization_private.release_migration_state where version='0018_supervisor_broadcast_permissions';

commit;
