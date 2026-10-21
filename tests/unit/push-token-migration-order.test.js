import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const root = process.cwd();
const migrationPath = `${root}/CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations`;
const m0007 = readFileSync(`${migrationPath}/0007_push_tokens_ownership_rls_PREPARED.sql`, 'utf8');
const m0015 = readFileSync(`${migrationPath}/0015_store_permission_target_PREPARED.sql`, 'utf8');
const cutover = readFileSync(`${migrationPath}/AUTH_RLS_FINAL_CUTOVER_PREPARED.sql`, 'utf8');
const preflight = readFileSync(`${root}/docs/PRODUCTION_SYNC_BACKEND_PREFLIGHT_READ_ONLY.sql`, 'utf8');

const requiredGuards = [
  'push_tokens_select_owner_only',
  'push_tokens_insert_owner_only',
  'push_tokens_update_owner_only',
  'push_tokens_no_hard_delete',
];

function model0015GuardCheck(catalogPolicies) {
  return requiredGuards.every(name => {
    const policy = catalogPolicies.find(item => item.name === name);
    return policy?.table === 'public.engrase_sync'
      && policy.mode === 'RESTRICTIVE'
      && policy.roles.length === 1
      && policy.roles[0] === 'authenticated'
      && policy.ownerPredicate === true;
  });
}

// A small truth-table model of PostgreSQL policy composition. This exercises
// the documented contract; it is not a PostgreSQL/RLS integration test.
function allowed({ operation, callerRole, userId, legacyPresent, owner, newOwner = owner, rowIdMatches = true }) {
  const permissive = legacyPresent || callerRole === 'authenticated';
  if (!permissive) return false;
  if (callerRole !== 'authenticated') return true; // 0007 policies target authenticated only.
  if (operation === 'delete') return false;
  if (operation === 'insert') return owner === userId && rowIdMatches;
  if (operation === 'select') return owner === userId;
  if (operation === 'update') return owner === userId && newOwner === userId && rowIdMatches;
  return false;
}

describe('0007 / 0015 push-token migration order contract', () => {
  it('0007 header states pre-cutover scope and remaining anon exposure', () => {
    expect(m0007).toMatch(/before 0015 \/ the final cutover/i);
    expect(m0007).toMatch(/does NOT restrict anon/i);
    expect(m0007).toMatch(/legacy[\s\S]*PERMISSIVE policy remains/i);
  });

  it('models legacy-present owner A/B read, insert, update, deactivation, transfer and delete cases', () => {
    for (const owner of ['A', 'B']) {
      const other = owner === 'A' ? 'B' : 'A';
      expect(allowed({ operation: 'select', callerRole: 'authenticated', userId: owner, legacyPresent: true, owner })).toBe(true);
      expect(allowed({ operation: 'insert', callerRole: 'authenticated', userId: owner, legacyPresent: true, owner })).toBe(true);
      expect(allowed({ operation: 'update', callerRole: 'authenticated', userId: owner, legacyPresent: true, owner })).toBe(true);
      expect(allowed({ operation: 'update', callerRole: 'authenticated', userId: owner, legacyPresent: true, owner, newOwner: other })).toBe(false);
      expect(allowed({ operation: 'insert', callerRole: 'authenticated', userId: owner, legacyPresent: true, owner, rowIdMatches: false })).toBe(false);
      expect(allowed({ operation: 'delete', callerRole: 'authenticated', userId: owner, legacyPresent: true, owner })).toBe(false);
      expect(allowed({ operation: 'select', callerRole: 'authenticated', userId: owner, legacyPresent: true, owner: other })).toBe(false);
      expect(allowed({ operation: 'update', callerRole: 'authenticated', userId: owner, legacyPresent: true, owner: other, newOwner: other })).toBe(false);
    }
  });

  it('documents anon exposure with legacy and RLS default-deny after legacy removal', () => {
    expect(allowed({ operation: 'select', callerRole: 'anon', legacyPresent: true, owner: 'A' })).toBe(true);
    expect(allowed({ operation: 'insert', callerRole: 'anon', legacyPresent: true, owner: 'A' })).toBe(true);
    expect(allowed({ operation: 'update', callerRole: 'anon', legacyPresent: true, owner: 'A' })).toBe(true);
    expect(allowed({ operation: 'delete', callerRole: 'anon', legacyPresent: true, owner: 'A' })).toBe(true);
    expect(allowed({ operation: 'select', callerRole: 'anon', legacyPresent: false, owner: 'A' })).toBe(false);
  });

  it('0015 checks real pg_policies state and aborts unless every 0007 guard is intact', () => {
    expect(m0015).toContain('pg_catalog.pg_policies');
    expect(m0015).toContain("p.schemaname='public' and p.tablename='engrase_sync'");
    expect(m0015).toContain("a.permissive is distinct from 'RESTRICTIVE'");
    expect(m0015).toContain("'authenticated'=any(coalesce(a.roles,array[]::name[]))");
    expect(m0015).toContain("raise exception '0015 requires all four exact-scope 0007 restrictive owner guards");
    for (const guard of requiredGuards) expect(m0015).toContain(guard);
  });

  it('the 0015 guard contract rejects missing/weak policies and accepts the expected catalog shape', () => {
    const expected = requiredGuards.map(name => ({
      name,
      table: 'public.engrase_sync',
      mode: 'RESTRICTIVE',
      roles: ['authenticated'],
      ownerPredicate: true,
    }));
    expect(model0015GuardCheck(expected.slice(1))).toBe(false);
    expect(model0015GuardCheck(expected.map((policy, i) => i === 2 ? { ...policy, mode: 'PERMISSIVE' } : policy))).toBe(false);
    expect(model0015GuardCheck(expected)).toBe(true);
  });

  it('cutover independently rechecks 0007, 0015 digest, and row-scope catalog state', () => {
    for (const guard of requiredGuards) expect(cutover).toContain(guard);
    expect(cutover).toContain("'0015_store_permission_target'");
    expect(cutover).toContain('matrix_digest');
    expect(cutover).toContain('rowScopeEnforced');
    expect(cutover).toContain('authorization_scope_select');
    expect(cutover).toContain('authorization_private.authorization_row_in_scope');
  });

  it('preflight exposes guard readiness and ownerless inventory without selecting token values', () => {
    expect(preflight).toContain('push-token-guard:');
    expect(preflight).toContain('0015:readiness');
    expect(preflight).toContain("e.store='push_tokens' AND NOT (e.payload ? 'userId')");
    expect(preflight).not.toMatch(/payload\s*->>\s*'token'|payload\s*->\s*'token'/i);
  });
});
