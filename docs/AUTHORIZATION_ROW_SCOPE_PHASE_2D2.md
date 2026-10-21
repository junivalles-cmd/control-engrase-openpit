# Phase 2D-2: production-prepared authenticated first pull

**VERDICT: SAFE_ADDITIVE_BEFORE_CUTOVER**, conditional on manual preconditions and post-install validation. This certifies the repaired 0013 transaction for authenticated matrix + row scope with legacy PUBLIC ALL/true retained. It does not certify anonymous access, full sync, later migrations or production data completeness.

## Exact correction

Four independent RESTRICTIVE policies `authorization_store_select/insert/update/delete` now enforce the real active Auth profile's `app_store_permissions`, in addition to the four existing row-scope policies. Central SECURITY DEFINER helper `authorization_store_action_allowed(text,text,boolean)` reads the authenticated profile directly; it does not trust a caller-supplied role. SELECT uses can_read; INSERT can_insert; UPDATE USING can_update OR can_delete; UPDATE WITH CHECK uses deleted AND can_delete or NOT deleted AND can_update; DELETE can_delete. This matches the existing matrix policy, including soft deletion. A parallel permissive legacy policy can no longer expand authenticated store/action permissions. Existing permissive policies and 0009/0010 restrictive RPC guards remain intact.

The separate matrix policies are deliberate: 0014 replaces `authorization_scope_select` and adds an OR for settings. That cannot bypass the independent `authorization_store_select` gate. The existing row-classifier signature remains compatible. No 0003/0007/0008/0011/0014/0015 installation is included.

`lubrication_points` now uses point.planId -> non-deleted lubrication_plans -> plan.equipmentId -> non-deleted equipment.locationId. It never substitutes a point equipmentId for a missing plan. A missing parent/location denies scoped access. GLOBAL remains subject to the matrix.

## Minimal READ changes and safe stop

The real client reads settings/general for operational shift times, compliance thresholds and sync intervals, plus settings/notifications. All four roles need shared reads; the 0015 target grants all four READ. Repaired 0013 changes only equipment/LUBRICADOR and settings/PLANIFICADOR,SUPERVISOR,LUBRICADOR can_read from false to true. Admin settings remains unchanged. No other permission bits change.

Installation asserts exactly one row for each of those four combinations, all with prior can_read=false. It aborts on a different baseline or a pre-existing repaired helper instead of silently overwriting a prior installation. This establishes the rollback's prior values explicitly. Apply complete transactions, not individual statements.

Rollback requires the repaired helper and all eight authenticated restrictive policies. It rejects partial READ drift and later 0014/0015 release state; returns readiness=false and restores only those four READ bits to false. It retains every restrictive policy/helper/schema and all operational data. It is repeatable when all four READ bits are already false. Do not run 0012 rollback afterward. The original unrepaired 0013 rollback is not supported by this repaired rollback. After later rollout, use a separately reviewed release safe-stop.

## Stores and legacy data

| Store | Authenticated behavior after matrix authorization |
| --- | --- |
| shifts / equipment_types / lubricants / settings | Shared reference/configuration data; actual matrix decides every action. |
| cuadrillas / locations | Scoped ids must belong to the current 0012 arrays; GLOBAL can read matrix-admitted rows. |
| equipment | Scoped payload.locationId must be authorized; retained-location tombstones may pass. |
| lubrication_plans | Scoped equipmentId must resolve to live equipment in an authorized location. |
| lubrication_points | Scoped planId resolves through live plan and equipment to authorized location. |
| lubrication_records / lubrication_skips / anomalies | Snapshot location/crew, payload links or live equipment-location fallback must verify scope; at least one link required, every supplied link must match. No guessed historical scope. |
| lubrication_assignments | Scoped live equipment/location required; assignedCrewId, when supplied, must match scope. |
| grease_validations | Scoped live record required; that record's verifiable crew/location determines scope. |
| users | Owner-only for all roles by id/appUserId/authUserId, AND matrix. Scoped client hides legacy users; Auth management uses manage-users/app_profiles. |
| push_tokens | Owner-only for all roles plus matching payload.id, AND matrix. 0007 remains needed later for extra not-deleted/no-hard-delete guards. |
| audit_log | Scoped SELECT/DELETE denied; INSERT/UPDATE requires own Auth identity AND matrix. GLOBAL still requires actual matrix bits. |
| notification_dispatch_log | Scoped unknown/denied; GLOBAL only when current matrix permits. Target 0015 denies all client access. |
| crew_locations | DENIED for every authenticated role, even if a matrix row accidentally grants it. PRE-0008 remains unchanged. |
| unknown stores | Scoped fail closed. GLOBAL still requires an actual matrix grant; no universal GLOBAL access. |

Confirmed production data, treated as input from the user: 1050 live points use planId (60 valid chains, 990 missing plans). The 990 are untouched and hidden from scoped first pull; GLOBAL sees only what the matrix permits. Of 103 live records, 19 have no remaining parent or historical scope, plus four similar tombstones: scoped denied, matrix-authorized GLOBAL retained, no repair/deletion/recreation. The other 84 records still need valid scope/location relationships. The 0012 scoped roles each have three crews/three locations; GLOBAL has three crews/four locations.

Filtering does not raise SQL errors, but historical data availability is intentionally incomplete for scoped users. Parent-dependent child tombstones may be hidden, so an existing cache can retain stale children; no IndexedDB cleanup or queue changes are included. A clean first pull and existing-cache reconciliation are different checks.

## Manual production preconditions

- 0009/0010/0012 PASS; 0008 and 0013+ absent. 0012 active profiles/scopes already validated, readiness=false. 0007/0011 are not dependencies of 0013.
- Install manually as postgres. Owner of engrase_sync, app_profiles and app_store_permissions; FORCE RLS disabled; engrase_sync RLS enabled, existing SELECT matrix policy present. Existing profile and matrix keys/columns valid. Four prior READ bits must all be false.
- authorization_private is confirmed absent in the stated baseline. Verify it is excluded from the actual Supabase Data API exposed schemas. SQL settings returned no pgrst.db_schemas and cannot establish exclusion. After installation, verify owner, SECURITY DEFINER, search_path=pg_catalog, minimum ACLs, authenticated USAGE without CREATE, no PUBLIC/anon helper EXECUTE, and all eight policies.
- Execute exactly `docs/0013_PRODUCTION_PREFLIGHT_READ_ONLY.sql` manually before installation. It is SELECT-only plus READ ONLY transaction boundaries, contains no JWT impersonation, and projects the corrected matrix/point chain. Validate the READ baseline and intended legacy omissions, not only the 72-row count. Production data/performance verification is manual; this audit performs no remote SQL.

## Readiness and subsequent order

Policies, four READ changes and readiness=true commit together. An injected late failure restores the prior bootstrap definition and READ bits and leaves no new helper/policies. After successful commit, all four authorized real profiles must return rowScopeEnforced=true with unchanged user/crew/location identity scope. A denied profile has no authorized context. The flag is not an assertion that anonymous risk or every client gateway is resolved.

Order: manual preflight / private-schema exclusion check -> repaired 0013 complete transaction -> verify eight policies, ACLs, four READ bits, bootstrap and authenticated first pull -> separately approved 0011 -> 0014 -> 0007 (or independently earlier, but always before 0015) -> validate gateways/clients and resolve later gates -> 0015 -> digest/matrix validation -> separately authorized final cutover -> verify legacy removed and anon grants revoked. Keep 0008 absent. Do not enable/certify full sync while required gateways are missing.

The existing 0015/final-cutover guards compare pg_policies text fragments that do not recognize deparsed casts/parentheses (`payload ->> 'id'::text`, etc.). That is a separate later migration gate issue; those mixed local files were left intact. It blocks end-to-end certification of the later rollout, not installation of repaired 0013. Repaired 0013's independent matrix gates preserve security when 0014 replaces its row SELECT policy; test that explicitly.

## Local evidence

Directed PGlite cases A-L cover legacy ALL/true, GLOBAL/scoped matrix denial and allowance, valid/missing point planId chains, unlinked history, foreign tokens even Admin, PRE-0008 crew_locations denial, settings matrix enforcement, UPDATE versus soft deletion, atomic late failure, eight-policy ACL/hardening and safe repeatable rollback with drift rejection. Run authorization-row-scope and bootstrap-production-prepared validators, exact preflight syntax checks and tsc --noEmit. Local fixtures are not production evidence.

Residual risk: anonymous access is unchanged because legacy PUBLIC ALL/true and anon grants remain. Offline revocation, stale cache/tombstones and orphan history remain operational limits. No production connection, SQL execution, deploy, push, commit or DAY/NIGHT changes are authorized or performed.
