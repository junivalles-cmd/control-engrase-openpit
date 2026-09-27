// tests/unit/db-seed-auth-mode.test.js
//
// P0-2 — eliminar el bootstrap de usuarios legacy (u_admin/PIN
// 1111-4444) cuando AUTH_MODE='supabase'. Encontrado en el piloto real
// con Junior Valles: un navegador nuevo generaba localmente un
// `u_admin` temporal (PIN 1111) que colisionaba con el `u_admin` legacy
// real de producción, generando un intento de push (bloqueado en la
// prueba, y de todos modos rechazado por el CAS de P0-1 vía
// ignore-duplicates — pero nunca debió intentarse). Todo con mocks
// (DB/fetch/localStorage/navigator en memoria) — nunca contra producción.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadDbSeedLogic, loadSyncLogic } from '../helpers/loadLubricationLogic.js';

function makeFakeDbSeed() {
  const stores = {};
  let config = null;
  let authTokens = null;
  let authProfileSnapshot = null;
  return {
    async getConfig() { return config; },
    async setConfig(v) { config = v; return v; },
    async get(store, id) { const m = stores[store]; return m && m.has(id) ? m.get(id) : null; },
    async put(store, obj) { if (!stores[store]) stores[store] = new Map(); stores[store].set(obj.id, obj); return obj; },
    async all(store) { return stores[store] ? Array.from(stores[store].values()) : []; },
    async getSyncConflicts() { return []; },
    async recordConflicts() {},
    async getAuthTokens() { return authTokens; },
    async setAuthTokens(v) { authTokens = v; return v; },
    async getAuthProfileSnapshot() { return authProfileSnapshot; },
    async setAuthProfileSnapshot(v) { authProfileSnapshot = v; return v; },
  };
}

function makeFakeLocalStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
  };
}

function makeFakeAuth(mode) {
  return {
    getMode() { return mode; },
    isSupabaseMode() { return mode === 'supabase'; },
    isAuthenticated() { return true; }, // solo relevante para el gate de sync.js en el test D
  };
}

const CFG = { url: 'https://fake.test', anonKey: 'anon-test' };

beforeEach(() => {
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('A) AUTH_MODE=supabase + servidor vacío (instalación totalmente nueva) -> 0 usuarios sembrados', () => {
  it('users queda en 0, pero el resto del catálogo SÍ se siembra (sin relación con identidad)', async () => {
    const db = makeFakeDbSeed();
    await db.setConfig(CFG);
    vi.stubGlobal('localStorage', makeFakeLocalStorage());
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] }))); // servidor vacío

    const { seedSoloSiElSistemaEstaVacio } = loadDbSeedLogic(db, makeFakeAuth('supabase'));
    await seedSoloSiElSistemaEstaVacio();

    expect(await db.all('users')).toHaveLength(0);
    // el catálogo no-identidad se sigue sembrando igual que siempre
    expect(await db.all('shifts')).toHaveLength(2);
    expect(await db.all('locations')).toHaveLength(3);
    expect(await db.all('cuadrillas')).toHaveLength(4);
    expect(await db.all('lubricants')).toHaveLength(3);
  });
});

describe('B) AUTH_MODE=supabase + servidor YA tiene datos (se une a sistema existente) -> 0 u_admin', () => {
  it('no crea el admin temporal con PIN 1111', async () => {
    const db = makeFakeDbSeed();
    await db.setConfig(CFG);
    vi.stubGlobal('localStorage', makeFakeLocalStorage());
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ id: 'x' }] }))); // servidor CON datos

    const { seedSoloSiElSistemaEstaVacio } = loadDbSeedLogic(db, makeFakeAuth('supabase'));
    await seedSoloSiElSistemaEstaVacio();

    expect(await db.get('users', 'u_admin')).toBeNull();
    expect(await db.all('users')).toHaveLength(0);
  });
});

describe('C) AUTH_MODE=supabase -> 0 registros dirty generados por bootstrap, ningún PIN default en ningún lado', () => {
  it('ni el camino "servidor vacío" ni "servidor con datos" dejan un PIN 1111/2222/3333/4444', async () => {
    for (const seedFirst of [[], [{ id: 'x' }]]) {
      const db = makeFakeDbSeed();
      await db.setConfig(CFG);
      vi.stubGlobal('localStorage', makeFakeLocalStorage());
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => seedFirst })));

      const { seedSoloSiElSistemaEstaVacio } = loadDbSeedLogic(db, makeFakeAuth('supabase'));
      await seedSoloSiElSistemaEstaVacio();

      const users = await db.all('users');
      expect(users.some(u => ['1111', '2222', '3333', '4444'].includes(u.pin))).toBe(false);
      expect(users).toHaveLength(0); // sin usuarios en absoluto -> 0 dirty, nada que subir
    }
  });

  it('no re-siembra el catálogo completo en cada boot (guard por flag, no por users.length)', async () => {
    const db = makeFakeDbSeed();
    await db.setConfig(CFG);
    const ls = makeFakeLocalStorage();
    vi.stubGlobal('localStorage', ls);
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { seedSoloSiElSistemaEstaVacio } = loadDbSeedLogic(db, makeFakeAuth('supabase'));
    await seedSoloSiElSistemaEstaVacio(); // 1er boot: siembra catálogo, users sigue en 0
    expect(await db.all('shifts')).toHaveLength(2);

    // Simula un segundo boot del mismo dispositivo (users sigue vacío,
    // a propósito) — SIN el fix, esto volvería a llamar a fetch/reseed;
    // con el fix, el flag `engrase_seed_hecho` corta antes de tocar red.
    fetchMock.mockClear();
    await seedSoloSiElSistemaEstaVacio();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.all('shifts')).toHaveLength(2); // no se duplicó
  });
});

describe('D) AUTH_MODE=supabase, pull/push -> 0 push artificial originado por bootstrap', () => {
  it('con users vacío tras el seed, pushAll() no intenta ninguna escritura para ese store', async () => {
    const db = makeFakeDbSeed();
    await db.setConfig(CFG);
    vi.stubGlobal('localStorage', makeFakeLocalStorage());
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ id: 'x' }] }))); // servidor con datos

    const fakeAuth = makeFakeAuth('supabase');
    const { seedSoloSiElSistemaEstaVacio } = loadDbSeedLogic(db, fakeAuth);
    await seedSoloSiElSistemaEstaVacio();
    expect(await db.all('users')).toHaveLength(0);

    // Ahora sí, fetch real de sync — cualquier llamada a
    // /rest/v1/engrase_sync con método distinto de GET se considera una
    // escritura (lo que este test debe demostrar que NUNCA ocurre para
    // "users", porque no hay nada dirty que subir).
    const writes = [];
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      if (method !== 'GET') writes.push(`${method} ${url}`);
      if (String(url).includes('/rest/v1/engrase_sync') && method !== 'GET') {
        return { ok: true, status: 200, json: async () => [] };
      }
      throw new Error('unexpected fetch in this test: ' + method + ' ' + url);
    }));
    const { Sync } = loadSyncLogic(db, ['users'], fakeAuth);
    const res = await Sync.pushAll();
    expect(res.pushed).toBe(0);
    expect(writes).toHaveLength(0); // 0 escrituras — nada que empujar
  });
});

describe('E) AUTH_MODE=legacy (o Auth ausente) conserva el bootstrap temporal — sin regresión', () => {
  it('servidor con datos -> sigue creando u_admin/PIN 1111 igual que siempre', async () => {
    const db = makeFakeDbSeed();
    await db.setConfig(CFG);
    vi.stubGlobal('localStorage', makeFakeLocalStorage());
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ id: 'x' }] })));

    const { seedSoloSiElSistemaEstaVacio } = loadDbSeedLogic(db, makeFakeAuth('legacy'));
    await seedSoloSiElSistemaEstaVacio();

    const admin = await db.get('users', 'u_admin');
    expect(admin).toBeTruthy();
    expect(admin.pin).toBe('1111');
  });

  it('servidor vacío -> sigue sembrando los 4 usuarios de ejemplo con sus PIN', async () => {
    const db = makeFakeDbSeed();
    await db.setConfig(CFG);
    vi.stubGlobal('localStorage', makeFakeLocalStorage());
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));

    // Sin Auth cargado en absoluto (undefined) -> debe comportarse igual
    // que 'legacy' (default más seguro, nunca asume 'supabase').
    const { seedSoloSiElSistemaEstaVacio } = loadDbSeedLogic(db, undefined);
    await seedSoloSiElSistemaEstaVacio();

    const users = await db.all('users');
    expect(users).toHaveLength(4);
    expect(users.map(u => u.pin).sort()).toEqual(['1111', '2222', '3333', '4444']);
  });
});

describe('F) Junior (Auth real) funciona sin ningún usuario legacy en `users`', () => {
  it('con users completamente vacío, Auth.signIn() sigue devolviendo un perfil válido (nunca lee `users`)', async () => {
    const db = makeFakeDbSeed();
    await db.setConfig(CFG);
    vi.stubGlobal('localStorage', makeFakeLocalStorage());
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ id: 'x' }] })));

    const fakeAuth = makeFakeAuth('supabase');
    const { seedSoloSiElSistemaEstaVacio } = loadDbSeedLogic(db, fakeAuth);
    await seedSoloSiElSistemaEstaVacio();
    expect(await db.all('users')).toHaveLength(0);

    // Ahora el login real de Junior — nunca toca el store "users".
    const { loadAuthLogic } = await import('../helpers/loadLubricationLogic.js');
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/auth/v1/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, user: { id: 'u1' } }) };
      if (String(url).includes('/rest/v1/app_profiles')) return { ok: true, status: 200, json: async () => ([{ auth_user_id: 'u1', app_user_id: 'u_jvalles', display_name: 'Junior Valles', role: 'ADMINISTRADOR', active: true }]) };
      if (String(url).includes('/rest/v1/users') || String(url).includes("store=eq.users")) throw new Error('Auth.signIn() NUNCA debería consultar el store users');
      throw new Error('unexpected fetch ' + url);
    }));
    const { Auth } = loadAuthLogic(db);
    const result = await Auth.signIn('jvalles', 'lo-que-sea');
    expect(result.user.role).toBe('ADMINISTRADOR');
    expect(await db.all('users')).toHaveLength(0); // sigue vacío, nadie lo tocó
  });
});
