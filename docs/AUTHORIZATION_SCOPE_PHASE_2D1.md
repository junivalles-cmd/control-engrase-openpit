# Phase 2D-1: authorization context bootstrap

This phase adds a PRE-0008 authorization-context RPC and client cache metadata. It does not install row-scoped policies, change `app_store_permissions`, remove the legacy policy, or authorize a first pull. The SQL returns `rowScopeEnforced: false`; the client must stop before push/pull while that remains false.

The identity source is `app_profiles(auth_user_id, app_user_id, role, active)`. For `SUPERVISOR` and `LUBRICADOR`, membership comes from active `cuadrillas` rows whose `payload.memberUserIds` contains `app_profiles.app_user_id`; the legacy location is `payload.locationId`, and that location must exist and be active in the `locations` store. No device assignment or `crew_locations` data participates. `ADMINISTRADOR` and `PLANIFICADOR` resolve as global. Missing, inactive, unsupported, membership-free, or ambiguous scoped profiles are denied.

The RPC returns only profile identity, role/status, scope type, sorted authorized crew/location ids, a deterministic fingerprint, and the `rowScopeEnforced` readiness bit. The internal resolver is not executable by API roles. The authenticated RPC is executable by `authenticated` only.

IndexedDB stores authorization context under `authorization_context:<app_user_id>`. Operational rows receive local owner/scope metadata, which is stripped before transport. Reads through `DB.get` / `DB.all` classify rows against the active account and cached scope; scoped legacy users and audit rows are hidden. Out-of-scope pending rows stay physically present and are filtered from reads and generic sync, preserving their local intent for later review. Changing accounts therefore does not transfer visibility or ownership.

Offline, the app may use only the last context cached for the same app user. A remote revocation cannot be detected without a connection. On reconnect, `fullSync()` refreshes Auth and the bootstrap before transport; a new fingerprint stops the cycle. Because row-scoped RLS is deliberately not included in this phase, all Supabase push/pull remains blocked until a later phase installs and validates scoped policies and returns `rowScopeEnforced: true`.

Quick Unlock remains tied to its stored `appUserId`; it does not refresh this context, change accounts, or authorize network sync.
