-- MANUAL-PRODUCTION-PREPARED: performance-only hotfix for the 0014 SELECT
-- wrapper on public.engrase_sync. Root cause (confirmed live against the
-- real device/account, not assumed — see diagnosis session): 0014 replaced
-- authorization_private.authorization_row_in_scope() so that, for EVERY
-- SELECT-action row it evaluates (any store), it first runs
--   EXISTS(SELECT 1 FROM authorization_private.support_grant_rows() g
--          WHERE g.store=p_store AND g.id=p_id)
-- support_grant_rows() takes NO row-specific input — it recomputes the
-- COMPLETE support-grant set from scratch (CTEs + UNIONs + a 5-table
-- self-join inside support_assignment_valid(), itself called once per
-- lubrication_assignments row) on every single invocation. Measured live
-- via the equivalent public RPC (get_assignment_support_context(), which
-- runs the same support_grant_rows() computation): ~580ms-1.8s PER CALL.
-- Postgres cannot memoize a zero-argument table function across row-level
-- policy evaluations within one statement, so pullAll()'s combined pull
-- (SELECT * ... ORDER BY updated_at,store,id LIMIT 1000, no store filter)
-- pays that cost on every candidate row it scans — confirmed to end in
-- Postgres error 57014 "canceling statement due to statement timeout".
--
-- This migration changes ONLY how that EXISTS check is computed — from
-- "build the whole grant set, then look up (p_store,p_id) in it" to
-- "check directly whether THIS (p_store,p_id) is granted", dispatched by a
-- cheap CASE on p_store so only stores support_grant_rows() could ever
-- emit do any work at all. It is derived DIRECTLY from decomposing each
-- UNION branch of the existing support_grant_rows() (0014) — see the
-- per-branch comments below for the exact correspondence. It changes
-- NOTHING about WHAT is authorized — same crews, same assignment validity
-- rule (still delegates to the unmodified support_assignment_valid()),
-- same support_links semantics, same support_control.enabled gate (still
-- inherited transitively through support_assignment_valid() for
-- operational grants; still absent for historical grants, exactly as
-- support_grant_rows()'s `historical` CTE never checked it either).
--
-- Uses CREATE OR REPLACE on authorization_row_in_scope() with the SAME
-- name/signature the 0014 wrapper already has — the existing
-- authorization_scope_select policy references it by OID, which CREATE OR
-- REPLACE preserves, so the policy needs NO change (0014's own comment,
-- line ~155: "Policies depend on function OIDs"). INSERT/UPDATE/DELETE
-- policies are untouched (they call authorization_row_in_scope_baseline_
-- 0013() directly, per 0014 — never routed through this function).
-- support_grant_rows()/support_assignment_valid()/support_links and every
-- 0013/0014 object remain installed, unmodified, reachable exactly as
-- before (nothing dropped — reversible via 0016_..._ROLLBACK_PREPARED.sql).
-- No RLS policy text changes, no grant/revoke widening, no data changes,
-- no 0007/0008/0015/cutover/master-location/local-cache change.
--
-- PRE-PRODUCTION REVIEW FIX (two corrections, found and fixed before this
-- file was ever applied — see the per-branch comments in
-- support_row_granted() for each): the `lubrication_assignments` historical
-- branch wrongly filtered by `l.store='lubrication_assignments'` (refs in
-- 0014 is NOT filtered by l.store, so this denied assignment grants coming
-- from support_links rows of other stores); the `locations` historical
-- branch wrongly kept `not e.deleted` (0014's locations UNION branch has no
-- deleted filter at all, so this denied a location behind an equipment
-- deleted after the support_links row was created). Both were FALTANTES
-- (narrower than 0014, never an access widening) and are fixed below.
begin;

do $preconditions$
begin
  if to_regprocedure('authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb)') is null
     or to_regprocedure('authorization_private.authorization_row_in_scope_baseline_0013(text,text,jsonb,text,jsonb)') is null
     or to_regprocedure('authorization_private.support_grant_rows()') is null
     or to_regprocedure('authorization_private.support_assignment_valid(text)') is null
     or to_regclass('authorization_private.support_links') is null
  then
    raise exception '0016 requires 0014 (support gateways + SELECT wrapper) already installed';
  end if;
  -- Positive-match guard (not an exact body hash — this hotfix never saw a
  -- live catalog read, see diagnosis session): confirms the INSTALLED
  -- authorization_row_in_scope() still calls support_grant_rows() (i.e.
  -- this hotfix was not already applied, and the function was not replaced
  -- by something else unexpected since 0014). Stop rather than guess.
  if not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='authorization_private' and p.proname='authorization_row_in_scope'
      and p.prosrc ilike '%support_grant_rows%'
  ) then
    raise exception '0016 baseline drift: authorization_row_in_scope() does not match the expected 0014 body — review before applying (may already be hotfixed, or diverged)';
  end if;
end
$preconditions$;

-- Row-specific replacement for "EXISTS(SELECT 1 FROM support_grant_rows()
-- g WHERE g.store=p_store AND g.id=p_id)". Each CASE branch below is the
-- row-scoped form of the matching UNION branch in support_grant_rows()
-- (0014_assignment_skip_gateways_PREPARED.sql) — same predicates, same
-- crews/support_assignment_valid()/support_links dependencies, nothing
-- added, nothing widened. Internal-only (never granted to authenticated
-- directly — reachable only through authorization_row_in_scope(), same as
-- support_grant_rows()/support_assignment_valid() already are).
create function authorization_private.support_row_granted(
  p_store text, p_id text, p_context jsonb
) returns boolean
language plpgsql stable security definer set search_path=pg_catalog as $granted$
declare
  crews jsonb;
begin
  if p_store is null or p_id is null then return false; end if;
  crews := coalesce(p_context->'context'->'authorizedCrewIds','[]'::jsonb);
  case p_store
    -- support_grant_rows(): `select 'lubrication_assignments',r.assignment_id
    -- from refs r` (refs = operational UNION historical). `historical`
    -- selects `l.*` from ALL of support_links — NOT filtered by l.store —
    -- so refs.assignment_id comes from l.assignment_id regardless of which
    -- store that support_links row was originally linked under (e.g. a
    -- 'lubrication_records' link still grants its assignment_id here).
    -- FIX (caught in review before production): a prior draft of this
    -- branch filtered the historical exists() by `l.store=
    -- 'lubrication_assignments'`, which would deny assignment grants coming
    -- from support_links rows of any OTHER store — a real regression vs.
    -- 0014 (FALTANTES). Matching refs exactly requires matching on
    -- l.assignment_id alone, with no l.store filter.
    when 'lubrication_assignments' then
      return exists(
        select 1 from public.engrase_sync a
        where a.store='lubrication_assignments' and a.id=p_id and not a.deleted
          and (crews ? (a.payload->>'assignedCrewId'))
          and authorization_private.support_assignment_valid(a.id)
      ) or exists(
        select 1 from authorization_private.support_links l
        where l.assignment_id=p_id and (crews ? l.crew_id)
      );
    -- support_grant_rows(): `select 'equipment',r.equipment_id from refs r`.
    when 'equipment' then
      return exists(
        select 1 from public.engrase_sync a
        where a.store='lubrication_assignments' and a.payload->>'equipmentId'=p_id and not a.deleted
          and (crews ? (a.payload->>'assignedCrewId'))
          and authorization_private.support_assignment_valid(a.id)
      ) or exists(
        select 1 from authorization_private.support_links l
        where l.equipment_id=p_id and (crews ? l.crew_id)
      );
    -- support_grant_rows(): `select 'lubrication_plans',r.plan_id from refs r`.
    when 'lubrication_plans' then
      return exists(
        select 1 from public.engrase_sync a
        where a.store='lubrication_assignments' and a.payload->>'planId'=p_id and not a.deleted
          and (crews ? (a.payload->>'assignedCrewId'))
          and authorization_private.support_assignment_valid(a.id)
      ) or exists(
        select 1 from authorization_private.support_links l
        where l.plan_id=p_id and (crews ? l.crew_id)
      );
    -- support_grant_rows(): `select 'lubrication_points',p.id from
    -- engrase_sync p join operational a on p.store='lubrication_points'
    -- and p.payload->>'planId'=a.payload->>'planId'` — joins `operational`
    -- ONLY, never `historical`. Preserved verbatim: no support_links branch
    -- here on purpose (a historical/support_links branch would WIDEN
    -- access beyond what 0014 actually grants for this store).
    when 'lubrication_points' then
      return exists(
        select 1 from public.engrase_sync pt
        join public.engrase_sync a on a.store='lubrication_assignments'
          and a.payload->>'planId'=pt.payload->>'planId' and not a.deleted
        where pt.store='lubrication_points' and pt.id=p_id
          and (crews ? (a.payload->>'assignedCrewId'))
          and authorization_private.support_assignment_valid(a.id)
      );
    -- support_grant_rows(): `select 'locations',e.payload->>'locationId'
    -- from engrase_sync e join refs r on e.store='equipment' and
    -- e.id=r.equipment_id` (refs = operational UNION historical) — this
    -- UNION branch in 0014 has NO `not e.deleted` filter at all, for either
    -- source of refs.equipment_id.
    -- The operational exists() below keeps `not e.deleted` as a harmless
    -- redundancy: any equipment_id reachable through `operational`/
    -- support_assignment_valid() is ALREADY guaranteed not deleted by that
    -- function's own join (`join engrase_sync e on ... and not e.deleted`
    -- in support_assignment_valid()), so adding the filter here changes
    -- nothing for that branch — left untouched per review.
    -- FIX (caught in review before production): the historical exists()
    -- below had the SAME `not e.deleted` filter, but support_links.
    -- equipment_id is captured once at link time with no ongoing validity
    -- check, so 0014 can still grant a location behind an equipment that
    -- was deleted AFTER the link was created. Keeping `not e.deleted` here
    -- would deny that case — a real regression vs. 0014 (FALTANTES) —
    -- removed to match 0014 exactly.
    when 'locations' then
      return exists(
        select 1 from public.engrase_sync e
        join public.engrase_sync a on a.store='lubrication_assignments'
          and a.payload->>'equipmentId'=e.id and not a.deleted
        where e.store='equipment' and e.payload->>'locationId'=p_id and not e.deleted
          and (crews ? (a.payload->>'assignedCrewId'))
          and authorization_private.support_assignment_valid(a.id)
      ) or exists(
        select 1 from public.engrase_sync e
        join authorization_private.support_links l on l.equipment_id=e.id
        where e.store='equipment' and e.payload->>'locationId'=p_id
          and (crews ? l.crew_id)
      );
    -- support_grant_rows(): `select h.store,h.entity_id from historical h`
    -- — every OTHER store it can ever emit comes ONLY from this branch
    -- (support_links directly, e.g. lubrication_records/lubrication_skips/
    -- anomalies/grease_validations today — see link_support_entity() call
    -- sites). Checking support_links by (store,id) here for ANY store,
    -- rather than a hardcoded allow-list, keeps this exactly as permissive
    -- as the original for every store in use today AND never silently
    -- diverges if a future migration calls link_support_entity() with a
    -- new store — it only ever fails CLOSED (returns false) for a store
    -- that never appears in support_links, same as today.
    else
      return exists(
        select 1 from authorization_private.support_links l
        where l.store=p_store and l.entity_id=p_id and (crews ? l.crew_id)
      );
  end case;
end
$granted$;

revoke all on function authorization_private.support_row_granted(text,text,jsonb) from public,anon,authenticated;
comment on function authorization_private.support_row_granted(text,text,jsonb) is
  'Row-specific replacement for the EXISTS(SELECT ... FROM support_grant_rows()) pattern in authorization_row_in_scope() (0014) — same grant semantics, derived by direct decomposition, never callable except through that wrapper.';

-- Same name/signature as the installed 0014 wrapper: CREATE OR REPLACE
-- preserves its OID, so authorization_scope_select (which references it by
-- OID) needs no change. Only the SELECT fast-path's EXISTS(...) changed —
-- the outer guards (p_action='SELECT', auth.uid()/status/authUserId) and
-- the baseline_0013 fallback for every non-support row are byte-for-byte
-- the same as the installed 0014 body.
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

revoke all on function authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb) from public,anon;
grant execute on function authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb) to authenticated;
comment on function authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb) is
  '0016 perf hotfix: SELECT fast-path now calls support_row_granted() (row-specific, indexed by store/id) instead of materializing the full support_grant_rows() set per row. Semantics unchanged from 0014 — see support_row_granted() for the per-branch correspondence. All non-SELECT actions and the no-grant case still delegate to authorization_row_in_scope_baseline_0013(), byte-for-byte as installed by 0014.';

create table if not exists authorization_private.release_migration_state (
  version text primary key, applied_at timestamptz not null default clock_timestamp(), matrix_digest text not null
);
insert into authorization_private.release_migration_state(version,matrix_digest)
  values('0016_fix_support_rls_performance','n/a: performance-only, no app_store_permissions change')
  on conflict(version) do update set applied_at=excluded.applied_at,matrix_digest=excluded.matrix_digest;

commit;
