# Phase 2D-1: authorization context bootstrap

## Manual production preparation (0012, before 0013)

The original "Do not run this file against production" header was a phase preparation restriction introduced with the bootstrap in commit `4ba6269`, not a SQL dependency on 0007, 0008 or 0011. The phase deliberately blocked transport until row scope was installed. For the manually confirmed baseline (0009/0010 PASS; 0007/0008/0011/0013+ absent; existing Auth/profile/permission/sync tables; RLS enabled, FORCE RLS disabled; table owners postgres), 0012 is additive and is now marked **MANUAL-PRODUCTION-PREPARED**. No executable migration or rollback SQL changed. This status does not authorize execution, deployment or cutover.

Apply the complete 0012 transaction manually as `postgres`, after checking the required schema/keys, `auth.uid()`, roles and schema usage described in its header. If either helper already exists, inspect ownership, all direct/inherited ACLs and callers first: replacement retains ownership and grants not explicitly revoked. Verify both helpers' owner, SECURITY DEFINER, `search_path=pg_catalog`, resolver ACLs and authenticated-only bootstrap execution after installation. Verify all four active roles: global ADMINISTRADOR/PLANIFICADOR; SUPERVISOR/LUBRICADOR need valid active membership and locations. Missing `active` in legacy payloads is treated as active; deleted or explicitly inactive rows are excluded. One matched active crew with an invalid legacy location denies the scoped context entirely.

Exact order: **0012 complete transaction → validate bootstrap/ACLs/scopes with `rowScopeEnforced=false` → separately review and authorize 0013 → validate its restrictive policies and `rowScopeEnforced=true`**. 0013 changes the LUBRICADOR/equipment read permission; that change is outside this 0012 audit and is not authorized by it. Do not reapply 0012 after 0013, since it resets readiness. 0012 alone cannot recover sync; later gateways and the current permission matrix still determine full sync compatibility.

The rollback stops clients first and removes only the two helpers, within one transaction and without CASCADE. It is applicable only before 0013 and other callers/dependents. After 0013 (even after the 0013 rollback), keep both helpers: the restrictive policies still require them. Tracked policy dependencies cause the original rollback to fail atomically; string-bodied function dependencies also need manual review.

Residual risk: the legacy `acceso interno con anon key` ALL/true policy remains untouched. Anonymous table access remains possible wherever table grants allow it; even 0013's authenticated-only restrictions do not close that anonymous path. The deterministic MD5 fingerprint is a cache/context change detector, not a security token or permission-matrix version. Membership/location edits, role and identity edits change it; display name and store permission changes do not. No remote SQL or production access is part of this preparation.

## Original phase behavior

This phase adds a PRE-0008 authorization-context RPC and client cache metadata. It does not install row-scoped policies, change `app_store_permissions`, remove the legacy policy, or authorize a first pull. The SQL returns `rowScopeEnforced: false`; the client must stop before push/pull while that remains false.

The identity source is `app_profiles(auth_user_id, app_user_id, role, active)`. For `SUPERVISOR` and `LUBRICADOR`, membership comes from active `cuadrillas` rows whose `payload.memberUserIds` contains `app_profiles.app_user_id`; the legacy location is `payload.locationId`, and that location must exist and be active in the `locations` store. No device assignment or `crew_locations` data participates. `ADMINISTRADOR` and `PLANIFICADOR` resolve as global. Missing, inactive, unsupported, membership-free, or ambiguous scoped profiles are denied.

The RPC returns only profile identity, role/status, scope type, sorted authorized crew/location ids, a deterministic fingerprint, and the `rowScopeEnforced` readiness bit. The internal resolver is not executable by API roles. The authenticated RPC is executable by `authenticated` only.

IndexedDB stores authorization context under `authorization_context:<app_user_id>`. Operational rows receive local owner/scope metadata, which is stripped before transport. Reads through `DB.get` / `DB.all` classify rows against the active account and cached scope; scoped legacy users and audit rows are hidden. Out-of-scope pending rows stay physically present and are filtered from reads and generic sync, preserving their local intent for later review. Changing accounts therefore does not transfer visibility or ownership.

Offline, the app may use only the last context cached for the same app user. A remote revocation cannot be detected without a connection. On reconnect, `fullSync()` refreshes Auth and the bootstrap before transport; a new fingerprint stops the cycle. Because row-scoped RLS is deliberately not included in this phase, all Supabase push/pull remains blocked until a later phase installs and validates scoped policies and returns `rowScopeEnforced: true`.

Quick Unlock remains tied to its stored `appUserId`; it does not refresh this context, change accounts, or authorize network sync.
