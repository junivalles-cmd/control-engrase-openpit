-- MANUAL-PRODUCTION-PREPARED: additive authorization for THREE NEW logical
-- stores inside the EXISTING public.engrase_sync bus — broadcast_messages,
-- broadcast_message_reads (informational broadcasts + per-user read
-- receipts) and manual_tasks (crew-targeted operational tasks). NO new
-- physical Supabase table, no manual_task_evidence store (see PHOTO/
-- EVIDENCE note below — reuses the existing generic photo pipeline
-- inline on manual_tasks, same as anomalies/lubrication_records already
-- do). Does NOT edit 0013/0014/0015/0016 (those files stay byte-for-byte
-- as applied) — this migration only ADDS a new dispatch branch on top of
-- what 0016 installed, via CREATE OR REPLACE preserving the existing OID.
-- I/U/D policies still reference baseline_0013's OID after 0014's rename:
-- this file retargets ONLY new-store writes, with the unchanged baseline
-- as the explicit ELSE path for all existing stores. 0014/0015/0016 files
-- are never edited or executed against a remote database by this work.
--
-- REVISION 2026-10-18: supersedes the first PREPARED draft of 0017. Two
-- real product changes from that draft, both reflected below:
--   1. manual_tasks is a NEW concept (operational, crew+equipment
--      targeted, completable, not in the first draft at all).
--   2. broadcast_messages creator roles NARROWED from (ADMINISTRADOR,
--      PLANIFICADOR, SUPERVISOR) to (ADMINISTRADOR, PLANIFICADOR) ONLY —
--      SUPERVISOR creates TASKS, never general broadcasts. This is an
--      explicit reversal of the first draft, not an oversight.
--
-- Revision 3: LUBRICADOR-only receivers, real coverage + legacy fallback,
-- owner-only visible-message receipts, correct I/U/D policy routing,
-- and full completion-field allowlist after a reproduced draft RLS bug.
-- Scope of this file: authorization only. No UI, no client wiring, no
-- `STORES`/`db.js` change (separate, additive client step once reviewed
-- and applied), no migration execution. PREPARED is a filename marker,
-- NOT application approval: see docs/0017_VALIDATION_2026-10-18.md.
--
-- ============================================================
-- PHOTO/EVIDENCE ARCHITECTURE AUDIT (required before designing evidence,
-- done BEFORE writing this file — see report for the full citation list):
-- ============================================================
-- CONTROL_ENGRASE already has ONE generic, store-agnostic photo pipeline
-- (sync.js): photos are captured/stored LOCALLY as base64 data URLs in a
-- `photos` (array) or `photo` (single) field on the SAME row (anomalies,
-- lubrication_records, and — for signatures — grease_validations via
-- `signatureLocal`/uploadSignatureIfNeeded). `Sync.uploadPhotoIfNeeded
-- (store, row, cfg)` takes the STORE NAME AS A PARAMETER and uploads any
-- base64 entries to the SAME shared Supabase Storage bucket
-- ('engrase-photos'), at path `${store}/${row.id}_${i}.${ext}` — it is
-- ALREADY fully generic, works for ANY store name with zero code change.
-- The public URL replaces the base64 in the row that gets pushed to
-- engrase_sync (never the base64 itself — avoids bloating the jsonb
-- payload); the LOCAL IndexedDB copy keeps the full base64 for offline
-- viewing. `getSignedPhotoUrl()`/`resolvePhotoStoragePath()` (also
-- generic) resolve a stored URL back into a (signed, when the bucket
-- stops being public) display URL. Client-side display helpers
-- (photosOf()/photoThumbHTML()/resolveEvidenceSrc()/
-- resolvePhotoThumbSrcs(), app.js) are likewise generic over any record
-- shape with a `photos` field.
-- Storage RLS (0005_storage_privacy_PREPARED.sql) is NOT path-prefix-
-- scoped at all: `bucket_id='engrase-photos' and current_app_active()`
-- for SELECT/INSERT/UPDATE — any active authenticated user, any path
-- prefix. A brand-new prefix like `manual_tasks/<id>_<i>.jpg` needs ZERO
-- Storage policy change.
-- CONCLUSION: manual_tasks evidence reuses this EXACT mechanism via an
-- inline `photos` array field on the manual_tasks row itself (same shape
-- as anomalies.photos) — attached at completion time, uploaded by the
-- SAME `Sync.uploadPhotoIfNeeded('manual_tasks', row, cfg)` with no
-- sync.js change. NO separate `manual_task_evidence` store: the task's
-- own "0..N evidence" relation is just that array, matching exactly how
-- anomalies already models "a photo set for one entity" — a second store
-- for the same relationship shape would duplicate, not add, structure.
-- (UI/capture flow is explicitly NOT built in this stage — see the
-- separate report section; this comment documents the DATA model only.)
--
-- ============================================================
-- A. BROADCAST_MESSAGES / BROADCAST_MESSAGE_READS (revision 3)
-- ============================================================
-- WHY NOT touch authorizedLocationIds (resolve_authorization_scope, 0012):
-- PRE-0008, derives from cuadrillas.payload->>'locationId' (ONE legacy
-- location per crew) — NOT crew_locations (PRINCIPAL/APOYO, multi-
-- location real coverage). Using it for LOCATION-targeted visibility
-- would silently exclude any crew whose real coverage is APOYO-only or a
-- 2nd/3rd location. This migration reads
-- public.engrase_sync WHERE store='crew_locations' DIRECTLY inside the
-- SECURITY DEFINER row classifier (same escape hatch
-- resolve_authorization_scope()/authorization_row_in_scope_baseline_0013()
-- already use for 'cuadrillas'/'locations'/'equipment') — works
-- regardless of whether store='crew_locations' itself is client-readable
-- (it currently is not, per 0013's PRE-0008 denial; SECURITY DEFINER
-- bypasses that for this internal read only, never changes that denial).
--
-- WHY validFrom/validUntil are NOT enforced in RLS: vigencia is a DISPLAY
-- concern, same pattern as plan.reprogramadoHasta (read client-side,
-- never RLS-gated) — avoids clock-skew-dependent row visibility.
--
-- WHO CAN PUBLISH A BROADCAST (ADMINISTRADOR/PLANIFICADOR ONLY — narrowed
-- from the first draft): these are system-wide informational announcements
-- ("mañana habrá mantenimiento...", "cambia el horario..."), not
-- equipment-specific operational work — SUPERVISOR creates TASKS instead
-- (section B/C below), never a general broadcast.
--
-- ADMINISTRADOR/PLANIFICADOR see/administer every broadcast. Receivers
-- for ALL_LUBRICATORS / USER / CREW / LOCATION are exclusively LUBRICADOR.
-- SUPERVISOR and VISOR have no broadcast access. LOCATION uses active,
-- nondeleted crew_locations (PRINCIPAL and APOYO both count). ANY stored
-- coverage row for that crew suppresses legacy fallback, even inactive
-- or deleted rows. Only a crew with ZERO coverage rows may fall back to
-- cuadrillas.locationId. Unknown recipient targets fail closed.
--
-- broadcast_message_reads: owner-only, id MUST be "<messageId>:<userId>",
-- only LUBRICADOR can SELECT/INSERT/UPDATE their OWN receipt, and its
-- referenced message must remain visible for EACH of these operations.
-- No hard delete, global receipt download or management-role exception.
--
-- ============================================================
-- B. MANUAL_TASKS (NEW — crew+equipment targeted operational task)
-- ============================================================
-- taskType is a free TEXT value, NOT a DB check constraint/enum: the
-- request explicitly asks not to hardcode exclusively to the 4 initial
-- names (ENGRASE/REVISAR_NIVEL_LUBRICANTE/REVISAR_PUNTO_ENGRASE/OTRO) —
-- This migration does not add taskType catalog/content validation.
--
-- WHO CAN CREATE (ADMINISTRADOR/PLANIFICADOR/SUPERVISOR): matches
-- ROLES_CAN_MANAGE_ASSIGNMENTS (src/core/operational-scope.js) — same 3
-- roles already allowed to create/reassign/cancel lubrication_assignments
-- today. LUBRICADOR never creates a task for a crew. VISOR has no
-- operational access at all (SELECT nor anything else).
--
-- crewId and equipmentId are BOTH required on INSERT (enforced in RLS as
-- defense-in-depth, not only client-side) — the task is an EXPLICIT
-- equipo->cuadrilla assignment, independent of equipment.locationId, by
-- design (enables cross-location support without moving the equipment).
--
-- WHO SEES WHAT (SELECT): ADMINISTRADOR/PLANIFICADOR see every task;
-- SUPERVISOR/LUBRICADOR see only tasks whose crewId is in their
-- authorizedCrewIds (pure in-memory jsonb containment — same O(1) cost as
-- the existing cuadrillas/lubrication_assignments branches, see
-- PERFORMANCE below).
--
-- WHO CAN UPDATE and HOW (the crux of this store's design):
--   ADMINISTRADOR: any task, any field (full CRUD, matches the request).
--   PLANIFICADOR: any task, any field (full CRUD, matches the request).
--   SUPERVISOR: only tasks where createdBy=own appUserId (same ownership
--     rule of the original manual_tasks draft) — can
--     reassign crewId, edit, or cancel. Flagged for explicit confirmation
--     exactly like the broadcast ownership rule was: the request says
--     "actualizar/cancelar tareas permitidas por reglas del sistema"
--     without naming the exact rule, so this migration picks the least-
--     privilege, already-precedented interpretation rather than leaving
--     it unspecified.
--   LUBRICADOR: ONLY completing a PENDING task that belongs to their own
--     crew — and ONLY the completion fields may change (status->
--     COMPLETED, completedBy=self, completedAt, completionComment,
--     photos). crewId/equipmentId/createdBy/priority/description/title/
--     taskType/dueAt MUST be byte-identical to the currently persisted
--     row. Enforced via authorization_private.manual_task_row_in_scope()
--     re-reading the CURRENTLY PERSISTED row by (store,id) and comparing
--     it against the proposed payload — NEVER a trigger (no existing
--     precedent for field-immutability triggers on engrase_sync; this
--     reuses the EXACT subquery-compare technique already used by this
--     same migration's broadcast_message_reads branch, and by Postgres
--     RLS design: during UPDATE, a same-table subquery evaluated inside
--     USING/WITH CHECK still sees the PRE-update tuple for the row
--     currently being processed — this reliance is called out explicitly
--     in the report and MUST be confirmed by tests/sql/0017-security.sql
--     against real staging before trusting it in production).
--   The SAME function is called for BOTH the USING clause (payload = OLD
--     row, by Postgres's own binding rules) and the WITH CHECK clause
--     (payload = proposed NEW row) — it cannot tell which one invoked it,
--     so its logic is written to be correct under EITHER binding (see
--     inline comments in the function body for the exact reasoning).
--     An identical payload is accepted for USING/no-op; every changed
--     payload must be COMPLETED with completedBy=self and completedAt.
--
-- REASSIGNMENT: just a normal UPDATE changing crewId, available to
-- ADMINISTRADOR/PLANIFICADOR/SUPERVISOR per the rules above — no new
-- identity, no new row, same task.id throughout. `previousCrewId` is a
-- CLIENT-set trace field (mirrors lubrication_assignments.previousCrewId,
-- an EXISTING precedent for the exact same concept) — never read or
-- enforced by RLS, purely for audit/history, avoiding over-design (no
-- separate event-log store, matching the request's explicit "no
-- sobrediseñar todavía").
--
-- CANCELLED: reachable only by the same creator-tier UPDATE path above
-- (ADMINISTRADOR/PLANIFICADOR any task, SUPERVISOR own task) setting
-- status='CANCELLED' — once cancelled it is no longer PENDING, so client-
-- side panel logic (src/core/tasks-notifications-panel.js, extended
-- later, NOT in this stage) naturally stops showing it as a pending task.
--
-- PANEL INTEGRATION (design note only, per explicit "no UI todavía" —
-- NOTHING below is implemented in this migration or in app.js):
-- src/core/tasks-notifications-panel.js would gain a
-- buildManualTaskItems({manualTasks, visibleCrewIds}) following the SAME
-- shape/dedupe pattern already used for anomalies/validations/assignments
-- in that module — identity `manual-task:<task.id>` (stable, matches the
-- request), kind='TAREA', type='MANUAL', actions "Ver equipo"/"Completar
-- tarea". Recomputing from the same synced rows never duplicates, by the
-- SAME Map-by-id dedupe already implemented there.
--
-- ============================================================
-- Unknown stores fail closed through the independent restrictive MATRIX
-- gate (no permission row). baseline_0013 alone accepts GLOBAL roles for
-- unknown stores; it is NOT effective RLS. Never add a wildcard matrix
-- grant. Rollback removes the new grants for exactly this reason.
begin;

do $preconditions$
begin
  if to_regprocedure('authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb)') is null
     or to_regprocedure('authorization_private.authorization_row_in_scope_baseline_0013(text,text,jsonb,text,jsonb)') is null
     or to_regprocedure('authorization_private.support_row_granted(text,text,jsonb)') is null
  then
    raise exception '0017 requires 0013/0014/0016 (authorization_row_in_scope chain) already installed';
  end if;
  -- Positive-match guard (same technique 0016 used against 0014's body):
  -- confirms the INSTALLED authorization_row_in_scope() is still exactly
  -- 0016's form (calls support_row_granted, does not already know about
  -- broadcast_row_in_scope/manual_task_row_in_scope) — stop rather than
  -- guess if it already diverged.
  if not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='authorization_private' and p.proname='authorization_row_in_scope'
      and p.prosrc ilike '%support_row_granted%'
  ) or exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='authorization_private' and p.proname='authorization_row_in_scope'
      and (p.prosrc ilike '%broadcast_row_in_scope%' or p.prosrc ilike '%manual_task_row_in_scope%')
  ) then
    raise exception '0017 baseline drift: authorization_row_in_scope() does not match the expected 0016 body, or 0017 was already applied — review before applying';
  end if;
  if to_regprocedure('authorization_private.broadcast_row_in_scope(text,text,jsonb,text,jsonb)') is not null
     or to_regprocedure('authorization_private.manual_task_row_in_scope(text,text,jsonb,text,jsonb)') is not null then
    raise exception '0017 already installed (broadcast_row_in_scope and/or manual_task_row_in_scope exist); do not overwrite';
  end if;
  if exists (select 1 from public.app_store_permissions where store in ('broadcast_messages','broadcast_message_reads','manual_tasks')) then
    raise exception '0017 requires no prior app_store_permissions rows for the three new stores';
  end if;
end
$preconditions$;

-- ------------------------------------------------------------
-- Row classifier for broadcast_messages/broadcast_message_reads.
-- ------------------------------------------------------------
create function authorization_private.broadcast_row_in_scope(
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
      -- SOLO ADMINISTRADOR/PLANIFICADOR publican broadcasts generales
      -- (REVISIÓN: SUPERVISOR removido — crea TAREAS, nunca un broadcast).
      -- Siempre a nombre propio.
      return app_role in ('ADMINISTRADOR','PLANIFICADOR') and p_payload->>'createdBy' = app_user;
    elsif p_action in ('UPDATE','DELETE') then
      return app_role in ('ADMINISTRADOR','PLANIFICADOR');
    end if;

    if p_action is distinct from 'SELECT' then return false; end if;
    -- SELECT
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
      -- Cobertura REAL vía crew_locations (PRINCIPAL o APOYO, activa) —
      -- nunca authorizedLocationIds (legacy, una sola ubicación por
      -- cuadrilla, ver cabecera de este archivo).
      return app_role = 'LUBRICADOR' and exists (
        select 1 from jsonb_array_elements_text(crews) as member(crew_id)
        where exists (
          select 1 from public.engrase_sync cl
          where cl.store='crew_locations' and not cl.deleted
            and cl.payload->>'crew_id'=member.crew_id
            and coalesce(cl.payload->>'active','true')='true'
            and cl.payload->>'location_id'=target_id
        ) or (
          -- Any stored relation (even inactive/deleted) suppresses legacy.
          -- Otherwise disabling real coverage could silently re-enable legacy.
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
  'Row classifier for broadcast_messages/broadcast_message_reads ONLY. INSERT/UPDATE/DELETE on broadcast_messages restricted to ADMINISTRADOR/PLANIFICADOR only (revised: SUPERVISOR creates manual_tasks instead, never a general broadcast). LOCATION targeting reads crew_locations directly (SECURITY DEFINER bypass), never authorizedLocationIds. validFrom/validUntil intentionally NOT enforced — display-only, same as plan.reprogramadoHasta.';

-- ------------------------------------------------------------
-- Row classifier for manual_tasks.
-- ------------------------------------------------------------
create function authorization_private.manual_task_row_in_scope(
  p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb
) returns boolean
language plpgsql stable security definer set search_path=pg_catalog as $manual_task$
declare
  ctx jsonb;
  app_user text;
  app_role text;
  crews jsonb;
  old_payload jsonb;
begin
  if auth.uid() is null or p_id is null or p_payload is null then return false; end if;
  if p_context->>'status' is distinct from 'AUTHORIZED' then return false; end if;
  ctx := p_context->'context';
  if ctx->>'authUserId' is distinct from auth.uid()::text then return false; end if;
  app_user := ctx->>'appUserId';
  app_role := ctx->>'role';
  crews := coalesce(ctx->'authorizedCrewIds','[]'::jsonb);

  if app_role not in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR') then return false; end if;

  if p_action = 'INSERT' then
    -- LUBRICADOR nunca crea una tarea para una cuadrilla. crewId/
    -- equipmentId obligatorios (defensa en profundidad, no solo UI).
    -- Siempre a nombre propio, incluso para ADMIN/PLANIFICADOR.
    return app_role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR')
      and p_payload->>'createdBy' = app_user
      and coalesce(p_payload->>'crewId','') <> ''
      and coalesce(p_payload->>'equipmentId','') <> '';
  end if;

  if p_action = 'DELETE' then
    -- Borrado físico no es el flujo real (se cancela, status='CANCELLED',
    -- vía UPDATE) — solo ADMIN/PLANIFICADOR por si se necesita limpiar un
    -- dato mal creado; SUPERVISOR nunca, LUBRICADOR nunca.
    return app_role in ('ADMINISTRADOR','PLANIFICADOR');
  end if;

  if p_action = 'UPDATE' then
    if app_role in ('ADMINISTRADOR','PLANIFICADOR') then return true; end if;
    if app_role = 'SUPERVISOR' then
      -- Solo administra (reasigna/edita/cancela) sus PROPIAS tareas
      -- creadas — se conserva el criterio del borrador de manual_tasks.
      return p_payload->>'createdBy' = app_user;
    end if;

    -- LUBRICADOR: SOLO completar una tarea PENDING de su propia cuadrilla,
    -- y SOLO los campos de cierre pueden cambiar. `p_payload` aquí puede
    -- ser la fila VIEJA (si Postgres evalúa esto desde la cláusula USING)
    -- o la fila NUEVA propuesta (si lo evalúa desde WITH CHECK) — esta
    -- función no puede distinguir cuál de las dos es, así que vuelve a
    -- leer la fila YA PERSISTIDA (old_payload) y escribe la regla para
    -- que sea correcta bajo CUALQUIERA de los dos casos:
    --   - Si p_payload = old_payload (caso USING, nada cambió todavía):
    --     todas las comparaciones "distinct from" son falsas, status
    --     persistido debe ser PENDING -> permite.
    --   - Si p_payload = fila propuesta (caso WITH CHECK): debe coincidir
    --     con old_payload en TODO excepto status (PENDING->COMPLETED) y
    --     los campos de cierre -> permite SOLO esa transición exacta.
    -- Depende de que, durante el procesamiento de ESTA fila por UPDATE,
    -- una sub-consulta a la MISMA tabla siga viendo la versión ANTERIOR
    -- (comportamiento estándar de Postgres/RLS, mismo principio que ya
    -- usa la rama broadcast_message_reads de este archivo) — confirmar
    -- esto empíricamente en staging (tests/sql/0017-security.sql)
    -- antes de confiar en esta regla en producción.
    select e.payload into old_payload from public.engrase_sync e where e.store='manual_tasks' and e.id=p_id;
    if old_payload is null then return false; end if;
    if old_payload->>'status' is distinct from 'PENDING' then return false; end if;
    if not (crews ? (old_payload->>'crewId')) then return false; end if;
    -- Proven local RLS bug in draft: PENDING + arbitrary extra keys was
    -- accepted. Compare full JSONB with an explicit completion allowlist,
    -- preserving types, absent-vs-null, and future protected fields too.
    if p_payload = old_payload then return true; end if; -- USING / exact no-op
    -- Existing uploadPhotoIfNeeded()/stripLocalAuthorizationMetadata()
    -- persist photos + first-photo alias + boolean photoUploaded marker.
    -- Evidence can change only together with completion, never while
    -- PENDING. Validate their shapes; an alias cannot carry task metadata.
    if p_payload ? 'photos' then
      if jsonb_typeof(p_payload->'photos') is distinct from 'array' then return false; end if;
      if exists(select 1 from jsonb_array_elements(p_payload->'photos') item
        where jsonb_typeof(item) is distinct from 'string') then return false; end if;
    end if;
    if p_payload ? 'photo' then
      if jsonb_typeof(p_payload->'photo') not in ('string','null') then return false; end if;
      if jsonb_typeof(p_payload->'photo')='string'
        and (p_payload->'photo') is distinct from (p_payload->'photos'->0) then return false; end if;
    end if;
    if p_payload ? 'photoUploaded' and jsonb_typeof(p_payload->'photoUploaded') is distinct from 'boolean' then return false; end if;
    return p_payload->>'status' = 'COMPLETED'
      and p_payload->>'completedBy' = app_user
      and coalesce(p_payload->>'completedAt','') <> ''
      and (p_payload - array['status','completedBy','completedAt','completionComment','photos','photo','photoUploaded'])
        = (old_payload - array['status','completedBy','completedAt','completionComment','photos','photo','photoUploaded']);
  end if;

  -- SELECT
  if app_role in ('ADMINISTRADOR','PLANIFICADOR') then return true; end if;
  return crews ? (p_payload->>'crewId'); -- SUPERVISOR/LUBRICADOR: solo su(s) cuadrilla(s), O(1) en memoria.
end
$manual_task$;

revoke all on function authorization_private.manual_task_row_in_scope(text,text,jsonb,text,jsonb) from public,anon,authenticated;
comment on function authorization_private.manual_task_row_in_scope(text,text,jsonb,text,jsonb) is
  'Row classifier for manual_tasks ONLY. LUBRICADOR may ONLY transition PENDING->COMPLETED on a task of their own crew, with every other field byte-identical to the persisted row (re-read by id, since USING/CHECK cannot be told apart) — never crewId/equipmentId/createdBy/priority/description/title/taskType/dueAt. SUPERVISOR manages (reassign/edit/cancel) only tasks they created; ADMINISTRADOR/PLANIFICADOR manage any task.';

-- ------------------------------------------------------------
-- Dispatcher: SAME name/signature as the 0016-installed function —
-- CREATE OR REPLACE preserves its OID, so authorization_scope_select
-- follows this dispatcher. I/U/D need the explicit CASE routing below.
-- The 0016 SELECT fast path and fallback remain unchanged.
-- ------------------------------------------------------------
create or replace function authorization_private.authorization_row_in_scope(
  p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb
) returns boolean
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  if p_store in ('broadcast_messages','broadcast_message_reads') then
    return authorization_private.broadcast_row_in_scope(p_store,p_id,p_payload,p_action,p_context);
  end if;
  if p_store = 'manual_tasks' then
    return authorization_private.manual_task_row_in_scope(p_store,p_id,p_payload,p_action,p_context);
  end if;
  if p_action='SELECT' and auth.uid() is not null and p_context->>'status'='AUTHORIZED'
    and p_context->'context'->>'authUserId'=auth.uid()::text
    and authorization_private.support_row_granted(p_store,p_id,p_context) then return true; end if;
  return authorization_private.authorization_row_in_scope_baseline_0013(p_store,p_id,p_payload,p_action,p_context);
end $$;

revoke all on function authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb) from public,anon;
grant execute on function authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb) to authenticated;
comment on function authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb) is
  '0017: adds dispatch branches for broadcast_messages/broadcast_message_reads (-> broadcast_row_in_scope()) and manual_tasks (-> manual_task_row_in_scope()). Every other store (SELECT fast-path via support_row_granted(), fallback to authorization_row_in_scope_baseline_0013()) is byte-for-byte unchanged from the 0016-installed body.';

-- ------------------------------------------------------------
-- Outer store-level matrix gate rows. Without these, the new stores fail
-- closed for EVERY role, including ADMINISTRADOR. VISOR excluded from
-- all three (never mentioned as sender, task creator, or recipient).
-- ------------------------------------------------------------
-- 0014 renamed the original function: existing I/U/D policies still bind
-- to its OID (baseline_0013). Retarget ONLY the three new stores; every
-- existing store must continue calling that exact original baseline.
alter policy authorization_scope_insert on public.engrase_sync with check (
  case when store in ('broadcast_messages','broadcast_message_reads','manual_tasks')
    then authorization_private.authorization_row_in_scope(store,id,payload,'INSERT',(select public.get_authorization_context()))
    else authorization_private.authorization_row_in_scope_baseline_0013(store,id,payload,'INSERT',(select public.get_authorization_context())) end
);
alter policy authorization_scope_update on public.engrase_sync using (
  case when store in ('broadcast_messages','broadcast_message_reads','manual_tasks')
    then authorization_private.authorization_row_in_scope(store,id,payload,'UPDATE',(select public.get_authorization_context()))
    else authorization_private.authorization_row_in_scope_baseline_0013(store,id,payload,'UPDATE',(select public.get_authorization_context())) end
) with check (
  case when store in ('broadcast_messages','broadcast_message_reads','manual_tasks')
    then authorization_private.authorization_row_in_scope(store,id,payload,'UPDATE',(select public.get_authorization_context()))
    else authorization_private.authorization_row_in_scope_baseline_0013(store,id,payload,'UPDATE',(select public.get_authorization_context())) end
);
alter policy authorization_scope_delete on public.engrase_sync using (
  case when store in ('broadcast_messages','broadcast_message_reads','manual_tasks')
    then authorization_private.authorization_row_in_scope(store,id,payload,'DELETE',(select public.get_authorization_context()))
    else authorization_private.authorization_row_in_scope_baseline_0013(store,id,payload,'DELETE',(select public.get_authorization_context())) end
);

insert into public.app_store_permissions (store, role, can_read, can_insert, can_update, can_delete) values
  -- broadcast_messages: SOLO ADMIN/PLANIFICADOR crean/editan (revisado).
  ('broadcast_messages', 'ADMINISTRADOR', true, true,  true,  true),
  ('broadcast_messages', 'PLANIFICADOR',  true, true,  true,  true),
  ('broadcast_messages', 'SUPERVISOR',    false, false, false, false),
  ('broadcast_messages', 'LUBRICADOR',    true, false, false, false),
  ('broadcast_message_reads', 'ADMINISTRADOR', false, false, false, false),
  ('broadcast_message_reads', 'PLANIFICADOR',  false, false, false, false),
  ('broadcast_message_reads', 'SUPERVISOR',    false, false, false, false),
  ('broadcast_message_reads', 'LUBRICADOR',    true, true, true, false),
  -- manual_tasks: ADMIN/PLANIFICADOR/SUPERVISOR crean+editan; LUBRICADOR
  -- SÍ necesita can_update=true a nivel de matriz (para completar su
  -- propia tarea) — el row-scope de arriba es lo que realmente restringe
  -- QUÉ puede cambiar, nunca esta fila sola.
  ('manual_tasks', 'ADMINISTRADOR', true, true, true, true),
  ('manual_tasks', 'PLANIFICADOR',  true, true, true, true),
  ('manual_tasks', 'SUPERVISOR',    true, true, true, false),
  ('manual_tasks', 'LUBRICADOR',    true, false, true, false);

do $assertions$
begin
  if (select count(*) from public.app_store_permissions where store in ('broadcast_messages','broadcast_message_reads','manual_tasks')) <> 12 then
    raise exception '0017 requires exactly 12 new matrix rows (3 stores x 4 roles)';
  end if;
  if exists (select 1 from public.app_store_permissions where store='broadcast_messages'
      and role='SUPERVISOR' and (can_read or can_insert or can_update or can_delete)) then
    raise exception '0017: SUPERVISOR must have no broadcast_messages access';
  end if;
  if exists (select 1 from public.app_store_permissions where store='broadcast_messages'
      and role='LUBRICADOR' and (can_insert or can_update or can_delete)) then
    raise exception '0017: LUBRICADOR must stay read-only on broadcast_messages';
  end if;
  if exists (select 1 from public.app_store_permissions where store='broadcast_message_reads' and can_delete) then
    raise exception '0017: broadcast_message_reads must have no can_delete=true rows';
  end if;
  if exists (select 1 from public.app_store_permissions where store='manual_tasks'
      and role='LUBRICADOR' and (can_insert or can_delete)) then
    raise exception '0017: LUBRICADOR must never create or delete manual_tasks at the matrix level (can_update=true is intentional, for completing only)';
  end if;
end
$assertions$;

create table if not exists authorization_private.release_migration_state (
  version text primary key, applied_at timestamptz not null default clock_timestamp(), matrix_digest text not null
);
insert into authorization_private.release_migration_state(version,matrix_digest)
  select '0017_broadcast_messages_scope',
    md5(string_agg(store||':'||role||':'||can_read||':'||can_insert||':'||can_update||':'||can_delete,'|' order by store,role))
  from public.app_store_permissions where store in ('broadcast_messages','broadcast_message_reads','manual_tasks')
  on conflict(version) do update set applied_at=excluded.applied_at,matrix_digest=excluded.matrix_digest;

commit;
