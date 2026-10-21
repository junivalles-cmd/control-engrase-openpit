// tests/unit/push-insert-forbidden-isolation.test.js
//
// Hallazgo real (sesión E2E Android, 2026-10-20): dentro de UN mismo store,
// pushAll() procesa primero el lote INSERT (newRows) y luego el lote UPDATE
// (updateRows) — pero si el POST del lote INSERT recibía un 403
// (AUTH_FORBIDDEN), el código hacía `continue` justo ahí. Como no hay
// ningún loop propio entre ese punto y `for (const store of STORES)`, ese
// `continue` saltaba al SIGUIENTE STORE — el `for (const r of updateRows)`
// de ESE MISMO store nunca se ejecutaba. Una sola fila con INSERT
// rechazado bloqueaba cualquier UPDATE legítimo pendiente del mismo store
// en cada ciclo de sync (caso real: un manual_tasks huérfano sin
// `_pushedVersion` nunca dejaba subir la finalización real de otra tarea
// distinta, para siempre, hasta limpiar la fila atascada).
//
// Contra el código REAL de sync.js (loadSyncLogic), nunca una
// reimplementación. Sin red real, sin IndexedDB real, sin producción.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadSyncLogic } from '../helpers/loadLubricationLogic.js';

afterEach(() => vi.unstubAllGlobals());

function makeFixtureDB() {
  const rows = {};
  let config = { url: 'https://fixture.test', anonKey: 'anon-test' };
  return {
    async getConfig() { return config; },
    async setConfig(v) { config = v; return v; },
    async get(store, id) { return rows[store]?.[id] ?? null; },
    async put(store, obj) { (rows[store] ||= {})[obj.id] = structuredClone(obj); return obj; },
    async all(store) { return Object.values(rows[store] || {}); },
    async recordConflicts() {},
  };
}

function fakeAuth() {
  return {
    isSupabaseMode: () => true, isAuthenticated: () => true,
    getSession: () => ({ accessToken: 'user-jwt' }),
    getProfile: () => ({ role: 'LUBRICADOR', appUserId: 'u1', authUserId: 'auth-u1', authorizationFingerprint: 'fp1', rowScopeEnforced: true }),
    getSessionEpoch: () => 1,
  };
}

const rowNewForbidden = { id: 'orphan1', title: 'huérfano (nunca autorizado a crear)', updatedAt: '2026-10-20T10:00:00.000Z' };
const rowDirtyUpdate = { id: 'legit1', title: 'completando mi propia tarea', updatedAt: '2026-10-20T11:00:00.000Z', _pushedVersion: '2026-10-20T09:00:00.000Z' };

describe('pushAll() — un INSERT rechazado (403) en un store NO debe bloquear los UPDATE pendientes del MISMO store', () => {
  it('rowDirtyUpdate (PATCH) se intenta y se marca subido aunque rowNewForbidden (POST) reciba 403 antes', async () => {
    const db = makeFixtureDB();
    await db.put('manual_tasks', rowNewForbidden);
    await db.put('manual_tasks', rowDirtyUpdate);
    const { Sync } = loadSyncLogic(db, ['manual_tasks'], fakeAuth());

    const fetchMock = vi.fn(async (url, opts) => {
      const method = opts?.method;
      if (method === 'POST') {
        return { ok: false, status: 403, json: async () => ({ message: 'new row violates row-level security policy' }) };
      }
      if (method === 'PATCH') {
        return { ok: true, status: 200, json: async () => ([{ id: 'legit1' }]) };
      }
      throw new Error(`unexpected method ${method}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await Sync.pushAll();

    // El PATCH de la fila legítima SÍ se intentó — antes del fix, el
    // `continue` tras el 403 del POST saltaba al siguiente store y este
    // fetch jamás se disparaba.
    const patchCalls = fetchMock.mock.calls.filter(([, opts]) => opts?.method === 'PATCH');
    expect(patchCalls.length).toBe(1);

    // Y se confirmó como subida (CAS avanzado a su updatedAt real).
    const stored = await db.get('manual_tasks', 'legit1');
    expect(stored._pushedVersion).toBe('2026-10-20T11:00:00.000Z');
    expect(res.pushed).toBeGreaterThanOrEqual(1);

    // La fila huérfana sigue dirty, reportada como error de autorización —
    // nunca se inventa un _pushedVersion falso para ella.
    const orphanStored = await db.get('manual_tasks', 'orphan1');
    expect(orphanStored._pushedVersion).toBeUndefined();
    expect(res.authErrors).toBeGreaterThanOrEqual(1);
    expect((res.authErrorDetails || []).some(d => d.id === 'orphan1' && d.operation === 'INSERT')).toBe(true);
  });
});
