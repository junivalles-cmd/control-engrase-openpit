// tests/unit/sync-auth-gate.test.js
//
// P0-2 Etapa B1 — el gate de Auth en sync.js (pushAll/pullAll), preparado
// pero NO activado (AUTH_MODE='legacy' por defecto en src/core/auth.js).
// Cubre J/K/M del pedido: 401 y 403 NUNCA se confunden con el CAS de
// concurrencia de P0-1, y AUTH_MODE='legacy' mantiene el comportamiento
// exacto de antes. Todo con mocks — nunca contra producción.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadSyncLogic } from '../helpers/loadLubricationLogic.js';

const STORES_TEST = ['equipment'];
const T0 = '2026-03-01T00:00:00.000Z';
const T1 = '2026-03-01T01:00:00.000Z';

function makeFakeDB() {
  const stores = {};
  let config = null;
  let conflicts = [];
  return {
    async getConfig() { return config; },
    async setConfig(v) { config = v; return v; },
    async get(store, id) { const m = stores[store]; return m && m.has(id) ? m.get(id) : null; },
    async put(store, obj) { if (!stores[store]) stores[store] = new Map(); stores[store].set(obj.id, obj); return obj; },
    async all(store) { return stores[store] ? Array.from(stores[store].values()) : []; },
    async getSyncConflicts() { return conflicts; },
    async recordConflicts(list) {
      if (!list || !list.length) return;
      const byKey = new Map(conflicts.map(c => [`${c.store}:${c.id}`, c]));
      for (const c of list) byKey.set(`${c.store}:${c.id}`, c);
      conflicts = Array.from(byKey.values());
    },
  };
}

function makeFakeAuth({ mode = 'legacy', authenticated = true } = {}) {
  return {
    getMode() { return mode; },
    isSupabaseMode() { return mode === 'supabase'; },
    isAuthenticated() { return authenticated; },
  };
}

let db;

beforeEach(async () => {
  db = makeFakeDB();
  await db.setConfig({ url: 'https://fake.test', anonKey: 'anon-test' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('M) AUTH_MODE="legacy" (o Auth ausente) mantiene el comportamiento exacto de 588f076', () => {
  it('con Auth en modo legacy, pushAll sigue subiendo normalmente vía PATCH/POST atómico', async () => {
    await db.put('equipment', { id: 'eq1', code: 'BASE', active: true, updatedAt: T0 }); // fila nueva
    const { Sync } = loadSyncLogic(db, STORES_TEST, makeFakeAuth({ mode: 'legacy' }));
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      if (method === 'POST') return { ok: true, status: 200, json: async () => [{ id: 'eq1' }] };
      throw new Error('unexpected ' + method);
    }));

    const res = await Sync.pushAll();
    expect(res.ok).toBe(true);
    expect(res.pushed).toBe(1);
    expect(res.reason).toBeUndefined(); // nunca AUTH_REQUIRED en modo legacy
  });

  it('sin ningún Auth inyectado (undefined), pushAll se comporta igual (compatibilidad total con tests previos)', async () => {
    await db.put('equipment', { id: 'eq1', code: 'BASE', active: true, updatedAt: T0 });
    const { Sync } = loadSyncLogic(db, STORES_TEST); // sin 3er argumento
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => [{ id: 'eq1' }] })));

    const res = await Sync.pushAll();
    expect(res.ok).toBe(true);
    expect(res.pushed).toBe(1);
  });
});

describe('J) 401 en pushAll -> AUTH_REQUIRED, NUNCA un conflicto CAS, dirty local intacto', () => {
  it('detiene el push de ese store, no incrementa conflicts', async () => {
    await db.put('equipment', { id: 'eq1', code: 'A-CHANGE', active: true, updatedAt: T0 }); // fila nueva (_pushedVersion undefined)
    const { Sync } = loadSyncLogic(db, STORES_TEST, makeFakeAuth({ mode: 'supabase', authenticated: true }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));

    const res = await Sync.pushAll();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('AUTH_REQUIRED');
    expect(res.conflicts).toBe(0); // NUNCA se confunde con el CAS de P0-1
    expect(res.pushed).toBe(0);

    const localAfter = await db.get('equipment', 'eq1');
    expect(localAfter.code).toBe('A-CHANGE'); // el cambio local NO se descartó
    expect(localAfter._pushedVersion).not.toBe(localAfter.updatedAt); // sigue dirty
  });

  it('pushAll ni siquiera intenta la red si ya se sabe que no hay sesión (gate previo)', async () => {
    await db.put('equipment', { id: 'eq1', code: 'X', active: true, updatedAt: T0 });
    const { Sync } = loadSyncLogic(db, STORES_TEST, makeFakeAuth({ mode: 'supabase', authenticated: false }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await Sync.pushAll();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('AUTH_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401 en pullAll -> se corta el pull entero, sin escribir nada local, sin conflicto CAS', async () => {
    const { Sync } = loadSyncLogic(db, STORES_TEST, makeFakeAuth({ mode: 'supabase', authenticated: true }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ([]) })));

    const res = await Sync.pullAll();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('AUTH_REQUIRED');
    expect(res.conflicts).toBeUndefined();
    expect((await db.all('equipment')).length).toBe(0);
  });
});

describe('K) 403 en pushAll -> AUTH_FORBIDDEN, NUNCA un conflicto CAS, dirty local intacto', () => {
  it('esa fila no se sube, sigue dirty, no aparece en conflicts', async () => {
    await db.put('equipment', { id: 'eq1', code: 'A-CHANGE', active: true, updatedAt: T0 });
    const { Sync } = loadSyncLogic(db, STORES_TEST, makeFakeAuth({ mode: 'supabase', authenticated: true }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })));

    const res = await Sync.pushAll();
    expect(res.pushed).toBe(0);
    expect(res.conflicts).toBe(0); // NUNCA se confunde con el CAS de P0-1
    expect(res.authErrors).toBe(1);
    expect(res.ok).toBe(false);

    const localAfter = await db.get('equipment', 'eq1');
    expect(localAfter.code).toBe('A-CHANGE');
    expect(localAfter._pushedVersion).not.toBe(localAfter.updatedAt); // sigue dirty
  });

  it('403 sobre una fila UPDATE (ya con base conocida) tampoco se confunde con el CAS de 0 filas', async () => {
    // Simula una fila que YA pasó por un pull (tiene _pushedVersion) y ahora está dirty.
    await db.put('equipment', { id: 'eq1', code: 'BASE', active: true, updatedAt: T0, _pushedVersion: T0 });
    const localA = await db.get('equipment', 'eq1');
    localA.code = 'EDITADO'; localA.updatedAt = T1;
    await db.put('equipment', localA);

    const { Sync } = loadSyncLogic(db, STORES_TEST, makeFakeAuth({ mode: 'supabase', authenticated: true }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })));

    const res = await Sync.pushAll();
    expect(res.conflicts).toBe(0);
    expect(res.authErrors).toBe(1);
    const localAfter = await db.get('equipment', 'eq1');
    expect(localAfter.code).toBe('EDITADO');
    expect(localAfter._pushedVersion).toBe(T0); // no se tocó, sigue dirty
  });
});

describe('L) el CAS de concurrencia de P0-1 sigue intacto (regresión rápida)', () => {
  it('0 filas devueltas por un PATCH normal (200 OK) sigue siendo conflicto CAS, no AUTH_*', async () => {
    await db.put('equipment', { id: 'eq1', code: 'BASE', active: true, updatedAt: T0, _pushedVersion: T0 });
    const localA = await db.get('equipment', 'eq1');
    localA.code = 'EDITADO'; localA.updatedAt = T1;
    await db.put('equipment', localA);

    const { Sync } = loadSyncLogic(db, STORES_TEST, makeFakeAuth({ mode: 'supabase', authenticated: true }));
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      if (method === 'PATCH') return { ok: true, status: 200, json: async () => [] }; // CAS: 0 filas, base ya cambió
      if (method === 'GET') return { ok: true, status: 200, json: async () => [] }; // fetchRemoteUpdatedAt (diagnóstico)
      throw new Error('unexpected ' + method);
    }));

    const res = await Sync.pushAll();
    expect(res.conflicts).toBe(1); // SIGUE siendo conflicto CAS
    expect(res.authErrors).toBe(0); // NO es un problema de autorización
    expect(res.reason).toBeUndefined();
  });
});
