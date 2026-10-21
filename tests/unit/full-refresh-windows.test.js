// tests/unit/full-refresh-windows.test.js
//
// Pre-cutover — ventanas diarias de "full refresh" (07:00/19:00) + catch-up
// (ver docs/SESSION_HANDOFF.md, lote PIN+sync+storage). Contra el código
// REAL de sync.js (dueFullRefreshWindows()/Sync.runFullRefreshIfDue()/
// Sync.fullSync()), con fetch/DB/Auth fake en memoria — sin red, sin
// producción. El sync incremental en sí (pushAll/pullAll/CAS) ya está
// cubierto en tests/unit/sync-*.test.js — aquí solo se prueba la capa
// nueva de ventanas + catch-up.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadSyncLogic } from '../helpers/loadLubricationLogic.js';

const ACCOUNT_KEY = 'fixture-auth:fixture-fp'; // identidad del fakeAuth por defecto de loadSyncLogic()
const accountState = async db => (await db.getConfig()).accountSyncStates?.[ACCOUNT_KEY] || {};
const setAccountState = async (db, patch) => {
  const cfg = await db.getConfig();
  await db.setConfig({ ...cfg, accountSyncStates: { ...cfg.accountSyncStates, [ACCOUNT_KEY]: { ...cfg.accountSyncStates?.[ACCOUNT_KEY], ...patch } } });
};

function makeFakeDB(seed = {}) {
  const data = {};
  for (const [store, rows] of Object.entries(seed)) data[store] = [...rows];
  // El cursor y el estado de las ventanas son account-scoped: viven en
  // accountSyncStates[cuenta:fingerprint], no en cfg.lastPull (ver sync.js
  // getAccountSyncState()/runFullRefreshIfDue()).
  let config = { url: 'https://fake.supabase.co', anonKey: 'anon-test', lastPull: '2026-01-01T00:00:00.000Z',
    activeAccountSyncKey: ACCOUNT_KEY,
    accountSyncStates: { [ACCOUNT_KEY]: { authUserId: 'fixture-auth', authorizationFingerprint: 'fixture-fp',
      bootstrapComplete: true, lastPull: '2026-01-01T00:00:00.000Z' } } };
  return {
    _data: data,
    async getConfig() { return config; },
    async setConfig(v) { config = v; return v; },
    async all(store) { return data[store] ? [...data[store]] : []; },
    async allActive(store) { return (data[store] || []).filter(r => r.active !== false); },
    async get(store, id) { return (data[store] || []).find(r => r.id === id) || null; },
    async put(store, obj) {
      data[store] = data[store] || [];
      const i = data[store].findIndex(r => r.id === obj.id);
      if (i >= 0) data[store][i] = obj; else data[store].push(obj);
      return obj;
    },
    async recordConflicts() {},
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('dueFullRefreshWindows() — pura, sin red', () => {
  it('antes de las 07:00: ninguna ventana pendiente', () => {
    const { dueFullRefreshWindows } = loadSyncLogic(makeFakeDB(), []);
    const now = new Date('2026-09-29T06:59:00');
    expect(dueFullRefreshWindows(now, null)).toEqual([]);
  });

  it('a las 07:00 en punto, sin estado previo: ventana AM pendiente', () => {
    const { dueFullRefreshWindows } = loadSyncLogic(makeFakeDB(), []);
    const now = new Date('2026-09-29T07:00:00');
    const due = dueFullRefreshWindows(now, null);
    expect(due.map(w => w.id)).toEqual(['AM']);
  });

  it('AM ya cumplida hoy: no vuelve a pedirla, aunque ya sean las 08:00', () => {
    const { dueFullRefreshWindows } = loadSyncLogic(makeFakeDB(), []);
    const now = new Date('2026-09-29T08:00:00');
    const due = dueFullRefreshWindows(now, { date: '2026-09-29', windows: ['AM'] });
    expect(due).toEqual([]);
  });

  it('después de las 19:00 con AM ya cumplida: solo PM pendiente', () => {
    const { dueFullRefreshWindows } = loadSyncLogic(makeFakeDB(), []);
    const now = new Date('2026-09-29T19:05:00');
    const due = dueFullRefreshWindows(now, { date: '2026-09-29', windows: ['AM'] });
    expect(due.map(w => w.id)).toEqual(['PM']);
  });

  it('ambas cumplidas hoy: ninguna pendiente', () => {
    const { dueFullRefreshWindows } = loadSyncLogic(makeFakeDB(), []);
    const now = new Date('2026-09-29T23:00:00');
    const due = dueFullRefreshWindows(now, { date: '2026-09-29', windows: ['AM', 'PM'] });
    expect(due).toEqual([]);
  });

  it('día distinto al guardado: reinicia (catch-up del 07:00 de HOY, sin arrastrar lo de ayer)', () => {
    const { dueFullRefreshWindows } = loadSyncLogic(makeFakeDB(), []);
    const now = new Date('2026-09-30T09:15:00'); // catch-up: app abierta después de las 07:00
    const due = dueFullRefreshWindows(now, { date: '2026-09-29', windows: ['AM', 'PM'] });
    expect(due.map(w => w.id)).toEqual(['AM']);
  });
});

describe('Sync.runFullRefreshIfDue()', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('sin ninguna ventana pendiente: null, CERO requests de red', async () => {
    vi.setSystemTime(new Date('2026-09-29T06:00:00'));
    const db = makeFakeDB();
    const { Sync } = loadSyncLogic(db, ['equipment']);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await Sync.runFullRefreshIfDue();
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ventana pendiente: retrocede el cursor, hace pull+push completo, y marca la ventana cumplida', async () => {
    vi.setSystemTime(new Date('2026-09-29T07:30:00'));
    const db = makeFakeDB();
    const { Sync } = loadSyncLogic(db, ['equipment']);
    let seenPullUrl = null;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (!opts || !opts.method) { seenPullUrl = url; return { ok: true, json: async () => [] }; } // GET (pull)
      return { ok: true, status: 200, json: async () => [] }; // push (nada dirty)
    }));

    const result = await Sync.runFullRefreshIfDue();

    expect(result.ok).toBe(true);
    expect(result.window).toBe('AM');
    expect(seenPullUrl).toContain('updated_at=gt.1970-01-01'); // cursor retrocedido, re-pull completo
    const state = await accountState(db);
    expect(state.lastFullRefreshWindow).toEqual({ date: '2026-09-29', windows: ['AM'] });
    expect(state.lastFullRefreshAt).toBeTruthy();
  });

  it('si el pull falla: NO marca la ventana como cumplida, y restaura el cursor anterior (se reintenta después)', async () => {
    vi.setSystemTime(new Date('2026-09-29T07:30:00'));
    const db = makeFakeDB();
    await setAccountState(db, { lastPull: '2026-09-28T10:00:00.000Z' });
    const { Sync } = loadSyncLogic(db, ['equipment']);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('sin red'); }));

    const result = await Sync.runFullRefreshIfDue();

    expect(result.ok).toBe(false);
    const state = await accountState(db);
    expect(state.lastFullRefreshWindow).toBeFalsy();
    expect(state.lastPull).toBe('2026-09-28T10:00:00.000Z'); // restaurado, no se perdió el cursor incremental
  });

  it('segunda ventana pendiente el mismo día (ej. AM ya cumplida, ahora es de noche): solo procesa PM, no repite AM', async () => {
    vi.setSystemTime(new Date('2026-09-29T19:10:00'));
    const db = makeFakeDB();
    await setAccountState(db, { lastFullRefreshWindow: { date: '2026-09-29', windows: ['AM'] } });
    const { Sync } = loadSyncLogic(db, ['equipment']);
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => (!opts || !opts.method) ? { ok: true, json: async () => [] } : { ok: true, status: 200, json: async () => [] }));

    const result = await Sync.runFullRefreshIfDue();

    expect(result.window).toBe('PM');
    expect((await accountState(db)).lastFullRefreshWindow.windows).toEqual(['AM', 'PM']);
  });
});

describe('Sync.fullSync() en sí — NUNCA dispara el full refresh (evita que el reloj real filtre comportamiento en los ~30 archivos de tests/unit/sync-*.test.js que la llaman directamente)', () => {
  it('con una ventana claramente pendiente (07:30, sin estado previo) y lastPull ya seteado: fullSync() no toca lastFullRefreshWindow ni pide un pull extra', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T07:30:00'));
    vi.stubGlobal('navigator', { onLine: true });
    const db = makeFakeDB();
    const { Sync } = loadSyncLogic(db, ['equipment']);
    let pullCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (!opts || !opts.method) { pullCalls++; return { ok: true, json: async () => [] }; }
      return { ok: true, status: 200, json: async () => [] };
    }));

    await Sync.fullSync();

    expect((await accountState(db)).lastFullRefreshWindow).toBeFalsy();
    expect(pullCalls).toBe(1); // solo el pull incremental normal
  });
});

describe('Sync.runAutoCycle() — punto de entrada de los ciclos AUTOMÁTICOS (arranque, timer, reconexión, foreground); integra el full refresh SOLO cuando corresponde (§23: nunca reemplaza el incremental)', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('primera sincronización del dispositivo (esPrimeraVez): NUNCA dispara full refresh aunque haya una ventana pendiente', async () => {
    vi.setSystemTime(new Date('2026-09-29T07:30:00'));
    vi.stubGlobal('navigator', { onLine: true });
    const db = makeFakeDB();
    await db.setConfig({ url: 'https://fake.supabase.co', anonKey: 'anon-test', lastPull: null }); // dispositivo nuevo
    const { Sync } = loadSyncLogic(db, ['equipment']);
    let pullCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (!opts || !opts.method) { pullCalls++; return { ok: true, json: async () => [] }; }
      return { ok: true, status: 200, json: async () => [] };
    }));

    await Sync.runAutoCycle();

    expect((await accountState(db)).lastFullRefreshWindow).toBeFalsy(); // no se ejecutó
    expect(pullCalls).toBe(1); // solo el pull normal de esPrimeraVez, ningún pull extra de full refresh
  });

  it('sync normal con ventana pendiente y todo OK: corre el full refresh además del incremental', async () => {
    vi.setSystemTime(new Date('2026-09-29T07:30:00'));
    vi.stubGlobal('navigator', { onLine: true });
    const db = makeFakeDB(); // lastPull ya seteado -> no es primera vez
    const { Sync } = loadSyncLogic(db, ['equipment']);
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => (!opts || !opts.method) ? { ok: true, json: async () => [] } : { ok: true, status: 200, json: async () => [] }));

    await Sync.runAutoCycle();

    expect((await accountState(db)).lastFullRefreshWindow).toEqual({ date: '2026-09-29', windows: ['AM'] });
  });

  it('catch-up real: app se abre a las 09:15 con la ventana de las 07:00 pendiente -> se ejecuta igual, sin bloquear el login/PIN (runAutoCycle corre solo, nadie lo espera para mostrar la app)', async () => {
    vi.setSystemTime(new Date('2026-09-29T09:15:00'));
    vi.stubGlobal('navigator', { onLine: true });
    const db = makeFakeDB();
    const { Sync } = loadSyncLogic(db, ['equipment']);
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => (!opts || !opts.method) ? { ok: true, json: async () => [] } : { ok: true, status: 200, json: async () => [] }));

    await Sync.runAutoCycle();

    expect((await accountState(db)).lastFullRefreshWindow.windows).toContain('AM');
  });

  it('sin sesión válida en AUTH_MODE=supabase: NUNCA corre el full refresh (mismo gate que pushAll/pullAll)', async () => {
    vi.setSystemTime(new Date('2026-09-29T07:30:00'));
    vi.stubGlobal('navigator', { onLine: true });
    const db = makeFakeDB();
    const fakeAuth = { getMode: () => 'supabase', isSupabaseMode: () => true, isAuthenticated: () => false, getSession: () => null };
    const { Sync } = loadSyncLogic(db, ['equipment'], fakeAuth);
    vi.stubGlobal('fetch', vi.fn());

    await Sync.runAutoCycle();

    expect((await accountState(db)).lastFullRefreshWindow).toBeFalsy();
  });
});
