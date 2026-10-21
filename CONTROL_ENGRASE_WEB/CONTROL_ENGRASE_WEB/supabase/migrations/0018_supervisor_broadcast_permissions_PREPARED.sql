-- MANUAL-PRODUCTION-PREPARED: additive authorization change on TOP of
-- 0017 (broadcast_messages/broadcast_message_reads/manual_tasks, ACTIVE in
-- production). Does NOT edit 0014/0015/0016/0017 files — those stay
-- byte-for-byte as applied. This migration ONLY widens who may CREATE and
-- manage a broadcast_messages row: SUPERVISOR, previously excluded from
-- broadcast_messages entirely (0017 revision 2: "SUPERVISOR crea
-- manual_tasks, nunca un broadcast general"), may now also publish
-- operational messages — a deliberate product reversal of that earlier
-- decision, requested explicitly for the unified "Tareas y mensajes"
-- module. manual_tasks is UNCHANGED by this file (SUPERVISOR already could
-- create those since 0017; nothing here touches
-- authorization_private.manual_task_row_in_scope()).
--
-- SCOPE OF THE CHANGE (CREATE OR REPLACE on the SAME signature, preserving
-- the function's OID exactly like 0016/0017 did for
-- authorization_row_in_scope()):
--   authorization_private.broadcast_row_in_scope(text,text,jsonb,text,jsonb)
-- The OUTER dispatcher (authorization_row_in_scope()) and the I/U/D
-- policies on public.engrase_sync are NOT touched — they already route
-- broadcast_messages/broadcast_message_reads to this function (0017), so
-- no policy ALTER is needed here at all.
--
-- RULES (explicit, as requested):
--   SUPERVISOR:
--     INSERT  = ALLOW, always as self (createdBy = own appUserId), same
--               ownership rule 0017 already enforces for ADMIN/PLANIFICADOR.
--     SELECT  = ALLOW, but ONLY messages this SUPERVISOR created
--               (createdBy = own appUserId) — never another SUPERVISOR's,
--               never ADMIN/PLANIFICADOR's, never acts as a RECEIVER (no
--               targetType/targetId matching for this role — that remains
--               LUBRICADOR-only, unchanged).
--     UPDATE  = ALLOW, ONLY on messages this SUPERVISOR created
--               (createdBy = own appUserId) — covers both "edit" and
--               "cancel" (cancel = shortening/zeroing validUntil via a
--               normal UPDATE; broadcast_messages has no separate status
--               field, matching how 0017 already left vigencia as a
--               display-only concern, never RLS-gated).
--     DELETE  = DENY (never granted here; ADMIN/PLANIFICADOR keep sole
--               physical-delete capability, same as 0017's original intent
--               — "borrado físico no es el flujo real").
--   ADMINISTRADOR / PLANIFICADOR: unchanged — manage (SELECT/INSERT/
--     UPDATE/DELETE) ANY broadcast_messages row, exactly as 0017 already
--     grants.
--   LUBRICADOR: unchanged — receiver-only (SELECT by targeting rules;
--     never INSERT/UPDATE/DELETE). This migration does not touch that
--     branch's logic at all.
--   VISOR: unchanged — zero access (fails the role allowlist at the top of
--     the function, exactly as 0017 left it).
--   broadcast_message_reads: UNCHANGED. Nothing in this file touches that
--     branch — owner-only receipts, LUBRICADOR-only, exactly as 0017.
--   LOCATION targeting (received by LUBRICADOR): UNCHANGED — still real
--     crew_locations coverage (PRINCIPAL/APOYO, legacy fallback only when a
--     crew has zero coverage rows), never authorizedLocationIds. Nothing
--     in this file touches that logic.
--   Unknown stores / unknown targetType: UNCHANGED — fail closed, exactly
--     as 0017 (the independent restrictive matrix gate in
--     app_store_permissions has no wildcard; this migration adds no new
--     wildcard either).
--
-- manual_tasks/0014/0015/0016/0017: byte-for-byte unchanged by this file.
-- PREPARED is a filename marker, NOT application approval — see
-- docs/0018_VALIDATION_2026-10-18.md and tests/sql/0018-security.sql
-- (forged-session equivalence tests, never executed against production by
-- this migration file itself; NOT run against any live Postgres in this
-- authoring session either — see that doc for the exact status).
begin;

do $preconditions$
begin
  if to_regprocedure('authorization_private.broadcast_row_in_scope(text,text,jsonb,text,jsonb)') is null then
    raise exception '0018 requires 0017 (authorization_private.broadcast_row_in_scope) already installed';
  end if;
  -- Positive-match guard (same technique 0017 used against 0016's body):
  -- confirms the INSTALLED broadcast_row_in_scope() is still exactly
  -- 0017's form (SUPERVISOR excluded from the role allowlist) — stop
  -- rather than silently widen an already-different function.
  if not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='authorization_private' and p.proname='broadcast_row_in_scope'
      and p.prosrc ilike '%ADMINISTRADOR'',''PLANIFICADOR'',''LUBRICADOR''%'
  ) or exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='authorization_private' and p.proname='broadcast_row_in_scope'
      and p.prosrc ilike '%ADMINISTRADOR'',''PLANIFICADOR'',''SUPERVISOR'',''LUBRICADOR''%'
  ) then
    raise exception '0018 baseline drift: broadcast_row_in_scope() does not match the expected 0017 body (role allowlist), or 0018 was already applied — review before applying';
  end if;
  if exists (select 1 from public.app_store_permissions where store='broadcast_messages' and role='SUPERVISOR'
      and (can_read or can_insert or can_update or can_delete)) then
    raise exception '0018 requires SUPERVISOR to currently have zero broadcast_messages matrix access (0017 baseline) — already applied?';
  end if;
end
$preconditions$;

-- ------------------------------------------------------------
-- Row classifier for broadcast_messages/broadcast_message_reads.
-- SAME signature as 0017's install — CREATE OR REPLACE preserves its OID,
-- so the dispatcher (authorization_row_in_scope(), unchanged by this
-- file) keeps calling this exact function without needing any edit.
-- broadcast_message_reads branch below is byte-for-byte copied from
-- 0017 — not a single character changed in that half of the function.
-- ------------------------------------------------------------
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
    -- 0018: SUPERVISOR agregado al allowlist de roles (antes solo
    -- ADMINISTRADOR/PLANIFICADOR/LUBRICADOR) — nunca VISOR, nunca ningún
    -- rol fuera de estos 4.
    if app_role is null or app_role not in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR') then return false; end if;
    if p_action = 'INSERT' then
      -- 0018: ADMINISTRADOR/PLANIFICADOR/SUPERVISOR publican broadcasts —
      -- siempre a nombre propio (createdBy=app_user, defensa en
      -- profundidad igual que manual_tasks). LUBRICADOR nunca crea.
      return app_role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR') and p_payload->>'createdBy' = app_user;
    elsif p_action in ('UPDATE','DELETE') then
      -- 0018: ADMINISTRADOR/PLANIFICADOR administran cualquier broadcast
      -- (sin cambio respecto a 0017). SUPERVISOR SOLO administra
      -- (editar/cancelar vía UPDATE) los que ÉL MISMO creó — nunca otro
      -- SUPERVISOR, nunca ADMIN/PLANIFICADOR, nunca un DELETE físico
      -- (ese sigue siendo exclusivo de ADMIN/PLANIFICADOR, igual que antes).
      -- `createdBy` es inmutable (nunca cambia en un UPDATE legítimo), así
      -- que esta comparación es correcta sin importar si Postgres evalúa
      -- esto desde USING (fila vieja) o WITH CHECK (fila propuesta) —
      -- mismo principio que 0017 ya documenta para manual_tasks.
      if app_role in ('ADMINISTRADOR','PLANIFICADOR') then return true; end if;
      if app_role = 'SUPERVISOR' then
        return p_action = 'UPDATE' and p_payload->>'createdBy' = app_user;
      end if;
      return false; -- LUBRICADOR nunca edita/cancela/borra un broadcast.
    end if;

    if p_action is distinct from 'SELECT' then return false; end if;
    -- SELECT
    if app_role in ('ADMINISTRADOR','PLANIFICADOR') then return true; end if;
    if app_role = 'SUPERVISOR' then
      -- 0018: SOLO sus propios mensajes enviados — un SUPERVISOR NUNCA es
      -- receptor de un broadcast (eso sigue siendo exclusivamente
      -- LUBRICADOR, sin cambio), así que no evalúa targetType/targetId.
      return p_payload->>'createdBy' = app_user;
    end if;
    -- LUBRICADOR: targeting real — idéntico a 0017, ni un carácter cambiado.
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
      return false; -- targetType desconocido: fail closed.
    end if;
  end if;

  -- broadcast_message_reads: SIN CAMBIOS respecto a 0017 (copiado tal
  -- cual, byte a byte).
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
  '0018: SUPERVISOR added to broadcast_messages — INSERT always as self; SELECT/UPDATE restricted to own createdBy (never a receiver, never another creator''s message); DELETE still ADMIN/PLANIFICADOR-only. broadcast_message_reads and LUBRICADOR targeting (including real crew_locations-based LOCATION coverage) unchanged from 0017.';

-- ------------------------------------------------------------
-- Outer store-level matrix gate: SUPERVISOR gains read+insert+update
-- (never delete) on broadcast_messages. Nothing else in
-- app_store_permissions changes — ADMIN/PLANIFICADOR/LUBRICADOR rows for
-- broadcast_messages, and ALL rows for broadcast_message_reads/
-- manual_tasks, are left exactly as 0017 inserted them.
-- ------------------------------------------------------------
update public.app_store_permissions
set can_read = true, can_insert = true, can_update = true
where store = 'broadcast_messages' and role = 'SUPERVISOR';

do $assertions$
begin
  if not exists (select 1 from public.app_store_permissions where store='broadcast_messages' and role='SUPERVISOR'
      and can_read and can_insert and can_update and not can_delete) then
    raise exception '0018 requires SUPERVISOR to have read+insert+update (never delete) on broadcast_messages';
  end if;
  if exists (select 1 from public.app_store_permissions where store='broadcast_messages' and role='LUBRICADOR'
      and (can_insert or can_update or can_delete)) then
    raise exception '0018: LUBRICADOR must stay receiver-only on broadcast_messages (unchanged from 0017)';
  end if;
  if (select count(*) from public.app_store_permissions where store in ('broadcast_messages','broadcast_message_reads','manual_tasks')) <> 12 then
    raise exception '0018 must not add or remove matrix rows, only update broadcast_messages/SUPERVISOR (expected 12 total, same as 0017)';
  end if;
end
$assertions$;

insert into authorization_private.release_migration_state(version,matrix_digest)
  select '0018_supervisor_broadcast_permissions',
    md5(string_agg(store||':'||role||':'||can_read||':'||can_insert||':'||can_update||':'||can_delete,'|' order by store,role))
  from public.app_store_permissions where store in ('broadcast_messages','broadcast_message_reads','manual_tasks')
  on conflict(version) do update set applied_at=excluded.applied_at,matrix_digest=excluded.matrix_digest;

commit;
