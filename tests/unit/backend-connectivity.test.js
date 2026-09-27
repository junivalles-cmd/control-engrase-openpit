// tests/unit/backend-connectivity.test.js
//
// Mejora pre-cutover — Bloque B: navigator.onLine es una SEÑAL, nunca la
// autoridad final de conectividad backend. Cubre las letras B, C y F del
// pedido de cierre (A/D/E/G/H/I/J/K/L ya están cubiertas por archivos
// existentes — sync-auth-gate.test.js, sync-auto-interval.test.js,
// sync-multidevice.test.js, tests/ui/registro-sync-guard.spec.js — sin
// cambios de comportamiento ahí). Todo con mocks, nunca contra producción.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadSyncLogic, loadAuthLogic } from '../helpers/loadLubricationLogic.js';

function makeFakeDB() {
  let config = null;
  let authTokens = null;
  let authProfileSnapshot = null;
  return {
    async getConfig() { return config; },
    async setConfig(v) { config = v; return v; },
    async getAuthTokens() { return authTokens; },
    async setAuthTokens(v) { authTokens = v; return v; },
    async getAuthProfileSnapshot() { return authProfileSnapshot; },
    async setAuthProfileSnapshot(v) { authProfileSnapshot = v; return v; },
  };
}

const STORES_TEST = ['equipment'];
const T0 = '2026-03-01T00:00:00.000Z';

let db;

beforeEach(async () => {
  db = makeFakeDB();
  await db.setConfig({ url: 'https://fake.test', anonKey: 'anon-test' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isNetworkFailure() — clasificación pura de fallas de red', () => {
  let isNetworkFailure;
  beforeEach(() => {
    ({ isNetworkFailure } = loadSyncLogic(db, STORES_TEST));
  });

  it('TypeError ("Failed to fetch") -> falla de red', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
  });
  it('AbortError/TimeoutError (AbortSignal.timeout()) -> falla de red', () => {
    const abort = new Error('timeout'); abort.name = 'AbortError';
    const timeout = new Error('timeout'); timeout.name = 'TimeoutError';
    expect(isNetworkFailure(abort)).toBe(true);
    expect(isNetworkFailure(timeout)).toBe(true);
  });
  it('un Error genérico (bug de la app, no de red) -> NO es falla de red', () => {
    expect(isNetworkFailure(new Error('algo inesperado'))).toBe(false);
  });
  it('un 401/403 real NUNCA llega aquí como excepción (son respuestas HTTP, no throws) — null/undefined -> false', () => {
    expect(isNetworkFailure(null)).toBe(false);
    expect(isNetworkFailure(undefined)).toBe(false);
  });
});

describe('B) fullSync(): navigator.onLine=true pero el backend no responde -> backend_unreachable, NUNCA "ok"', () => {
  it('pullAll() lanza un TypeError de red -> status backend_unreachable, dirty intacto, sin conflicto', async () => {
    const { Sync } = loadSyncLogic(db, STORES_TEST);
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    let notified = null;
    Sync.onChange((s) => { notified = s; });
    await Sync.fullSync();

    expect(notified.status).toBe('backend_unreachable');
    expect(notified.status).not.toBe('ok'); // NUNCA se confunde con sincronizado
  });

  it('un error que NO es de red (bug real) sigue clasificándose como "error", no "backend_unreachable"', async () => {
    const { Sync } = loadSyncLogic(db, STORES_TEST);
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('bug interno inesperado'); }));

    let notified = null;
    Sync.onChange((s) => { notified = s; });
    await Sync.fullSync();

    expect(notified.status).toBe('error');
  });
});

describe('C) timeout -> dirty local intacto (ninguna escritura se pierde ni se marca como confirmada)', () => {
  it('un registro dirty sigue dirty después de un fullSync() que falla por timeout', async () => {
    const localDb = makeFakeDB();
    await localDb.setConfig({ url: 'https://fake.test', anonKey: 'anon-test' });
    const stores = { equipment: new Map() };
    const dbWithStore = {
      ...localDb,
      async all(store) { return Array.from(stores[store].values()); },
      async get(store, id) { return stores[store].get(id) || null; },
      async put(store, obj) { stores[store].set(obj.id, obj); return obj; },
      async recordConflicts() {},
    };
    await dbWithStore.put('equipment', { id: 'eq1', code: 'DIRTY', active: true, updatedAt: T0 }); // nunca confirmada por el servidor

    const { Sync } = loadSyncLogic(dbWithStore, ['equipment']);
    vi.stubGlobal('navigator', { onLine: true });
    const abortErr = new Error('The operation was aborted'); abortErr.name = 'TimeoutError';
    vi.stubGlobal('fetch', vi.fn(async () => { throw abortErr; }));

    let notified = null;
    Sync.onChange((s) => { notified = s; });
    await Sync.fullSync();

    expect(notified.status).toBe('backend_unreachable');
    const after = await dbWithStore.get('equipment', 'eq1');
    expect(after.code).toBe('DIRTY');
    expect(after._pushedVersion).not.toBe(after.updatedAt); // sigue dirty, nunca se marcó como subida
  });
});

describe('F) fallo temporal de red durante refresh -> Auth/tokens permanecen, NUNCA se cierra sesión', () => {
  it('restoreSession(): refresh falla por red (TypeError) -> pending_validation, tokens y snapshot SIGUEN en DB', async () => {
    await db.setAuthTokens({ accessToken: 'OLD', refreshToken: 'RT-BUENO', expiresAt: Date.now() - 1000, authUserId: 'u1' });
    await db.setAuthProfileSnapshot({ authUserId: 'u1', appUserId: 'u_jvalles', displayName: 'Junior Valles', role: 'ADMINISTRADOR', active: true });

    const { Auth } = loadAuthLogic(db);
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    const result = await Auth.restoreSession();

    expect(result.user.displayName).toBe('Junior Valles'); // snapshot cacheado, sigue disponible
    expect(await db.getAuthTokens()).not.toBeNull(); // NUNCA se borran por una falla de red
    expect(await db.getAuthProfileSnapshot()).not.toBeNull();
    expect(Auth.isAuthenticated()).toBe(false); // el token sigue sin refrescar -> sync sigue bloqueado (correcto)
  });

  it('contraste: un 401 REAL del servidor (refresh token inválido) sigue cerrando sesión — regla existente intacta', async () => {
    await db.setAuthTokens({ accessToken: 'OLD', refreshToken: 'RT-MALO', expiresAt: Date.now() - 1000, authUserId: 'u1' });
    await db.setAuthProfileSnapshot({ authUserId: 'u1', appUserId: 'u_jvalles', displayName: 'Junior Valles', role: 'ADMINISTRADOR', active: true });

    const { Auth } = loadAuthLogic(db);
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));

    expect(await Auth.restoreSession()).toBeNull();
    expect(await db.getAuthTokens()).toBeNull(); // esto SÍ debe borrarse: rechazo real, no de red
    expect(await db.getAuthProfileSnapshot()).toBeNull();
  });

  it('refreshProfile(): app_profiles falla por red -> el perfil YA cacheado se conserva, nunca se pisa con null', async () => {
    await db.setAuthTokens({ accessToken: 'VIGENTE', refreshToken: 'RT', expiresAt: Date.now() + 3600000, authUserId: 'u1' });
    await db.setAuthProfileSnapshot({ authUserId: 'u1', appUserId: 'u_jvalles', displayName: 'Junior Valles', role: 'ADMINISTRADOR', active: true });

    const { Auth } = loadAuthLogic(db);
    await Auth.restoreSession(); // sesión vigente -> carga el snapshot en memoria, sin red todavía
    expect(Auth.getProfile().displayName).toBe('Junior Valles');

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await Auth.refreshProfile();

    expect(Auth.getProfile().displayName).toBe('Junior Valles'); // NUNCA se reemplazó por null
    expect(await db.getAuthProfileSnapshot()).not.toBeNull();
  });
});
