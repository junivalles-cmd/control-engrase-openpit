// tests/unit/broadcast-sync.test.js
//
// BROADCAST_NOTIFICATIONS (2026-10-18) — broadcast_messages/
// broadcast_message_reads (0017, ACTIVE en producción):
//   A) localAuthorizationState() (db.js) — el filtro LOCAL que decide qué
//      fila ya pulled sigue siendo "mía" para un LUBRICADOR/SUPERVISOR
//      CREW_SCOPED, reactivo a cambios de cuadrilla/ubicación (nunca
//      "si está local ya es válido" — ver comentario en la función).
//   B) round-trip REAL de Sync.pushAll()/pullAll() (nunca reimplementado)
//      contra un "remoto" en memoria con la misma forma/CAS de
//      engrase_sync — "Marcar como leída" offline/reconexión/no-duplicado,
//      mismo patrón que tests/unit/manual-tasks-sync.test.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadDbLogic, loadSyncLogic, loadDbAuthorizationLogic } from '../helpers/loadLubricationLogic.js';

const { localAuthorizationState } = loadDbLogic();
const { DB: DBAuth } = loadDbAuthorizationLogic();

const CREW_SCOPED_CTX = { appUserId: 'u1', active: true, scopeType: 'CREW_SCOPED', authorizedCrewIds: ['cq1'], authorizedLocationIds: ['loc1'] };
const GLOBAL_CTX = { appUserId: 'u1', active: true, scopeType: 'GLOBAL' };

function row(overrides = {}) {
  return { __authorizationAppUserId: 'u1', updatedAt: 't0', _pushedVersion: 't0', ...overrides };
}

describe('A) localAuthorizationState("broadcast_messages", ...) — targeting reactivo, nunca "presencia implica autorizado"', () => {
  it('1. ALL_LUBRICATORS siempre AUTHORIZED para CREW_SCOPED', () => {
    expect(localAuthorizationState('broadcast_messages', row({ targetType: 'ALL_LUBRICATORS' }), CREW_SCOPED_CTX, 'u1')).toBe('AUTHORIZED');
  });

  it('2. USER exacto (targetId === appUserId) AUTHORIZED', () => {
    expect(localAuthorizationState('broadcast_messages', row({ targetType: 'USER', targetId: 'u1' }), CREW_SCOPED_CTX, 'u1')).toBe('AUTHORIZED');
  });

  it('3. USER de otro OUT_OF_SCOPE', () => {
    expect(localAuthorizationState('broadcast_messages', row({ targetType: 'USER', targetId: 'u2' }), CREW_SCOPED_CTX, 'u1')).toBe('OUT_OF_SCOPE');
  });

  it('4. CREW propia (en authorizedCrewIds) AUTHORIZED', () => {
    expect(localAuthorizationState('broadcast_messages', row({ targetType: 'CREW', targetId: 'cq1' }), CREW_SCOPED_CTX, 'u1')).toBe('AUTHORIZED');
  });

  it('5. CREW distinta OUT_OF_SCOPE', () => {
    expect(localAuthorizationState('broadcast_messages', row({ targetType: 'CREW', targetId: 'cq2' }), CREW_SCOPED_CTX, 'u1')).toBe('OUT_OF_SCOPE');
  });

  // Corrección 2026-10-18: LOCATION NUNCA se resuelve con
  // authorizedLocationIds (alcance de sync/equipo, no cobertura operativa
  // de cuadrilla) — localAuthorizationState() es pura/síncrona y no puede
  // leer crew_locations, así que SIEMPRE falla cerrado acá, aunque
  // authorizedLocationIds contenga el targetId. El cálculo real (crew_locations
  // + resolveCrewLocationCoverage()) vive en DB.authorizationStateForRow(),
  // ver describe "A3" más abajo — nunca se debe "ampliar" el acceso desde
  // esta función pura.
  it('6. LOCATION SIEMPRE OUT_OF_SCOPE aquí, aunque authorizedLocationIds contenga el targetId (la respuesta real la da authorizationStateForRow)', () => {
    expect(localAuthorizationState('broadcast_messages', row({ targetType: 'LOCATION', targetId: 'loc1' }), CREW_SCOPED_CTX, 'u1')).toBe('OUT_OF_SCOPE');
  });

  it('7. LOCATION no cubierta tampoco por authorizedLocationIds — mismo OUT_OF_SCOPE', () => {
    expect(localAuthorizationState('broadcast_messages', row({ targetType: 'LOCATION', targetId: 'loc9' }), CREW_SCOPED_CTX, 'u1')).toBe('OUT_OF_SCOPE');
  });

  it('8. targetType desconocido falla cerrado (igual que el RLS)', () => {
    expect(localAuthorizationState('broadcast_messages', row({ targetType: 'UNKNOWN', targetId: 'x' }), CREW_SCOPED_CTX, 'u1')).toBe('OUT_OF_SCOPE');
  });

  it('9. reactivo: si la cuadrilla deja de estar autorizada, el MISMO broadcast CREW pasa a OUT_OF_SCOPE (sin esperar un pull nuevo)', () => {
    const r = row({ targetType: 'CREW', targetId: 'cq1' });
    expect(localAuthorizationState('broadcast_messages', r, CREW_SCOPED_CTX, 'u1')).toBe('AUTHORIZED');
    const ctxSinCrew = { ...CREW_SCOPED_CTX, authorizedCrewIds: [] };
    expect(localAuthorizationState('broadcast_messages', r, ctxSinCrew, 'u1')).toBe('OUT_OF_SCOPE');
  });

  it('10. GLOBAL (ADMIN/PLANIFICADOR) ve cualquier targetType/targetId', () => {
    expect(localAuthorizationState('broadcast_messages', row({ targetType: 'CREW', targetId: 'cq-cualquiera' }), GLOBAL_CTX, 'u1')).toBe('AUTHORIZED');
  });
});

describe('A2) localAuthorizationState("broadcast_message_reads", ...) — ownership, nunca ajeno', () => {
  it('11. receipt propio AUTHORIZED', () => {
    expect(localAuthorizationState('broadcast_message_reads', row({ messageId: 'm1', userId: 'u1' }), CREW_SCOPED_CTX, 'u1')).toBe('AUTHORIZED');
  });
  it('12. receipt ajeno OUT_OF_SCOPE (nunca visible, aunque llegara local por error)', () => {
    expect(localAuthorizationState('broadcast_message_reads', row({ messageId: 'm1', userId: 'u2' }), CREW_SCOPED_CTX, 'u1')).toBe('OUT_OF_SCOPE');
  });
});

// ---------------------------------------------------------------
// A3) DB.authorizationStateForRow() — broadcast_messages targetType=LOCATION
// resuelto con la cobertura OPERATIVA real de cuadrilla (crew_locations +
// resolveCrewLocationCoverage(), reusada tal cual — NUNCA una 2da
// implementación), corrección 2026-10-18. No es pura (necesita DB), así
// que se invoca con `.call(fakeThis, ...)` y un `allRaw` en memoria —
// nunca IndexedDB real, mismo criterio que el resto de este archivo. El
// filtro local NUNCA debe ampliar acceso respecto al RLS
// (broadcast_row_in_scope, 0017): cada caso abajo es uno de los 6
// escenarios pedidos explícitamente en la corrección.
// ---------------------------------------------------------------
function fakeAuthThis({ cuadrillas = [], crewLocations = [] } = {}) {
  return {
    allRaw: async (store) => (store === 'cuadrillas' ? cuadrillas : store === 'crew_locations' ? crewLocations : []),
    getRaw: async () => null,
  };
}

function locationRow(targetId, overrides = {}) {
  return { __authorizationAppUserId: 'u1', targetType: 'LOCATION', targetId, updatedAt: 't0', _pushedVersion: 't0', ...overrides };
}

describe('A3) DB.authorizationStateForRow — broadcast LOCATION vía cobertura real de cuadrilla (nunca authorizedLocationIds)', () => {
  it('1. crew con LOC_A PRINCIPAL + LOC_B APOYO -> ambas visibles', async () => {
    const fakeThis = fakeAuthThis({
      cuadrillas: [{ id: 'cq1', active: true }],
      crewLocations: [
        { crew_id: 'cq1', location_id: 'LOC_A', role: 'PRINCIPAL', active: true },
        { crew_id: 'cq1', location_id: 'LOC_B', role: 'APOYO', active: true },
      ],
    });
    const ctx = { appUserId: 'u1', active: true, scopeType: 'CREW_SCOPED', authorizedCrewIds: ['cq1'], authorizedLocationIds: [] };
    expect(await DBAuth.authorizationStateForRow.call(fakeThis, 'broadcast_messages', locationRow('LOC_A'), ctx, 'u1')).toBe('AUTHORIZED');
    expect(await DBAuth.authorizationStateForRow.call(fakeThis, 'broadcast_messages', locationRow('LOC_B'), ctx, 'u1')).toBe('AUTHORIZED');
  });

  it('2. authorizedLocationIds contiene LOC_C pero la crew NO la cubre -> OUT_OF_SCOPE (authorizedLocationIds nunca sustituye cobertura)', async () => {
    const fakeThis = fakeAuthThis({
      cuadrillas: [{ id: 'cq1', active: true }],
      crewLocations: [{ crew_id: 'cq1', location_id: 'LOC_A', role: 'PRINCIPAL', active: true }],
    });
    const ctx = { appUserId: 'u1', active: true, scopeType: 'CREW_SCOPED', authorizedCrewIds: ['cq1'], authorizedLocationIds: ['LOC_C'] };
    expect(await DBAuth.authorizationStateForRow.call(fakeThis, 'broadcast_messages', locationRow('LOC_C'), ctx, 'u1')).toBe('OUT_OF_SCOPE');
  });

  it('3. crew cubre LOC_B pero authorizedLocationIds NO la contiene -> AUTHORIZED (el cliente nunca oculta algo que el RLS sí autorizó por cobertura)', async () => {
    const fakeThis = fakeAuthThis({
      cuadrillas: [{ id: 'cq1', active: true }],
      crewLocations: [{ crew_id: 'cq1', location_id: 'LOC_B', role: 'APOYO', active: true }],
    });
    const ctx = { appUserId: 'u1', active: true, scopeType: 'CREW_SCOPED', authorizedCrewIds: ['cq1'], authorizedLocationIds: ['LOC_OTRA_COSA'] };
    expect(await DBAuth.authorizationStateForRow.call(fakeThis, 'broadcast_messages', locationRow('LOC_B'), ctx, 'u1')).toBe('AUTHORIZED');
  });

  it('4. crew_locations existe y contradice el legacy locationId -> gana crew_locations (legacy se ignora)', async () => {
    const fakeThis = fakeAuthThis({
      cuadrillas: [{ id: 'cq1', active: true, locationId: 'LOC_LEGACY' }],
      crewLocations: [{ crew_id: 'cq1', location_id: 'LOC_REAL', role: 'PRINCIPAL', active: true }],
    });
    const ctx = { appUserId: 'u1', active: true, scopeType: 'CREW_SCOPED', authorizedCrewIds: ['cq1'], authorizedLocationIds: [] };
    expect(await DBAuth.authorizationStateForRow.call(fakeThis, 'broadcast_messages', locationRow('LOC_LEGACY'), ctx, 'u1')).toBe('OUT_OF_SCOPE');
    expect(await DBAuth.authorizationStateForRow.call(fakeThis, 'broadcast_messages', locationRow('LOC_REAL'), ctx, 'u1')).toBe('AUTHORIZED');
  });

  it('5. sin crew_locations (ninguna fila) -> fallback legacy cuadrillas.locationId funciona', async () => {
    const fakeThis = fakeAuthThis({
      cuadrillas: [{ id: 'cq1', active: true, locationId: 'LOC_LEGACY' }],
      crewLocations: [],
    });
    const ctx = { appUserId: 'u1', active: true, scopeType: 'CREW_SCOPED', authorizedCrewIds: ['cq1'], authorizedLocationIds: [] };
    expect(await DBAuth.authorizationStateForRow.call(fakeThis, 'broadcast_messages', locationRow('LOC_LEGACY'), ctx, 'u1')).toBe('AUTHORIZED');
  });

  it('5b. fila crew_locations INACTIVA (no cero filas) suprime el fallback legacy, igual que el RLS', async () => {
    const fakeThis = fakeAuthThis({
      cuadrillas: [{ id: 'cq1', active: true, locationId: 'LOC_LEGACY' }],
      crewLocations: [{ crew_id: 'cq1', location_id: 'LOC_OTRA', role: 'PRINCIPAL', active: false }],
    });
    const ctx = { appUserId: 'u1', active: true, scopeType: 'CREW_SCOPED', authorizedCrewIds: ['cq1'], authorizedLocationIds: [] };
    expect(await DBAuth.authorizationStateForRow.call(fakeThis, 'broadcast_messages', locationRow('LOC_LEGACY'), ctx, 'u1')).toBe('OUT_OF_SCOPE');
  });

  it('6. ALL_LUBRICATORS/CREW/USER no pasan por este camino (siguen resolviéndose en localAuthorizationState, sin romperse)', async () => {
    const fakeThis = fakeAuthThis({ cuadrillas: [], crewLocations: [] }); // nunca se consultan para estos targetType
    const ctx = { appUserId: 'u1', active: true, scopeType: 'CREW_SCOPED', authorizedCrewIds: ['cq1'], authorizedLocationIds: [] };
    expect(await DBAuth.authorizationStateForRow.call(fakeThis, 'broadcast_messages', { __authorizationAppUserId: 'u1', targetType: 'ALL_LUBRICATORS', updatedAt: 't0', _pushedVersion: 't0' }, ctx, 'u1')).toBe('AUTHORIZED');
    expect(await DBAuth.authorizationStateForRow.call(fakeThis, 'broadcast_messages', { __authorizationAppUserId: 'u1', targetType: 'CREW', targetId: 'cq1', updatedAt: 't0', _pushedVersion: 't0' }, ctx, 'u1')).toBe('AUTHORIZED');
    expect(await DBAuth.authorizationStateForRow.call(fakeThis, 'broadcast_messages', { __authorizationAppUserId: 'u1', targetType: 'USER', targetId: 'u1', updatedAt: 't0', _pushedVersion: 't0' }, ctx, 'u1')).toBe('AUTHORIZED');
  });
});

// ---------------------------------------------------------------
// B) Round-trip real de Sync.pushAll()/pullAll() — "Marcar como leída"
// ---------------------------------------------------------------
const STORES_TEST = ['broadcast_messages', 'broadcast_message_reads'];

function makeFakeDB() {
  const stores = {};
  let config = null;
  return {
    async getConfig() { return config; },
    async setConfig(v) { config = v; return v; },
    async get(store, id) { const m = stores[store]; return m && m.has(id) ? m.get(id) : null; },
    async put(store, obj) { if (!stores[store]) stores[store] = new Map(); stores[store].set(obj.id, obj); return obj; },
    async all(store) { return stores[store] ? Array.from(stores[store].values()) : []; },
  };
}

function makeFakeRemote() {
  let rows = [];
  const post = vi.fn();
  const patch = vi.fn();
  async function handleFetch(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      const storeEq = u.searchParams.get('store');
      const idEq = u.searchParams.get('id');
      if (storeEq && idEq && idEq.startsWith('eq.')) {
        const match = rows.find(r => r.store === storeEq.replace(/^eq\./, '') && r.id === idEq.replace(/^eq\./, ''));
        return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(match ? [{ updated_at: match.updated_at }] : [])) };
      }
      const since = (u.searchParams.get('updated_at') || 'gt.1970-01-01T00:00:00.000Z').replace(/^gt\./, '');
      const limit = parseInt(u.searchParams.get('limit') || '1000', 10);
      const offset = parseInt(u.searchParams.get('offset') || '0', 10);
      const filtered = rows.filter(r => r.updated_at > since).sort((a, b) => (`${a.updated_at}|${a.store}|${a.id}` < `${b.updated_at}|${b.store}|${b.id}` ? -1 : 1));
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(filtered.slice(offset, offset + limit))) };
    }
    if (method === 'POST') {
      post(url, init);
      const body = JSON.parse(init.body);
      const inserted = [];
      body.forEach(item => {
        if (rows.some(r => r.store === item.store && r.id === item.id)) return;
        const entry = { store: item.store, id: item.id, payload: item.payload, updated_at: item.updated_at, deleted: item.deleted };
        rows.push(entry); inserted.push(entry);
      });
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(inserted)) };
    }
    if (method === 'PATCH') {
      patch(url, init);
      const storeVal = (u.searchParams.get('store') || '').replace(/^eq\./, '');
      const idVal = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      const expected = (u.searchParams.get('updated_at') || '').replace(/^eq\./, '');
      const idx = rows.findIndex(r => r.store === storeVal && r.id === idVal && r.updated_at === expected);
      if (idx === -1) return { ok: true, status: 200, json: async () => [] };
      rows[idx] = { ...rows[idx], ...JSON.parse(init.body) };
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify([rows[idx]])) };
    }
    throw new Error(`método no soportado: ${method}`);
  }
  return { get rows() { return rows; }, seed(list) { rows = rows.concat(list); }, handleFetch, postCalls: post, patchCalls: patch };
}

let fakeDB, remote, Sync, networkDown;

beforeEach(async () => {
  fakeDB = makeFakeDB();
  remote = makeFakeRemote();
  networkDown = false;
  vi.stubGlobal('fetch', (url, init) => networkDown ? Promise.reject(new TypeError('Failed to fetch')) : remote.handleFetch(url, init));
  await fakeDB.setConfig({ url: 'https://fake.test', anonKey: 'anon-test' });
  ({ Sync } = loadSyncLogic(fakeDB, STORES_TEST));
});

afterEach(() => { vi.unstubAllGlobals(); });

function seedBroadcast(version = '2026-10-18T08:00:00.000Z') {
  remote.seed([{ store: 'broadcast_messages', id: 'bcast1',
    payload: { id: 'bcast1', title: 'Corte de agua', message: 'Sin agua 10-12', priority: 'IMPORTANTE',
      targetType: 'ALL_LUBRICATORS', targetId: null, createdBy: 'u-admin', createdAt: version, updatedAt: version },
    updated_at: version, deleted: false }]);
}

describe('B) Marcar como leída — push real, sin diff-check (broadcast_message_reads nunca lo exige)', () => {
  it('13. crear el recibo localmente y pushAll() lo sube como INSERT (POST, fila nueva)', async () => {
    seedBroadcast();
    await Sync.pullAll();
    await fakeDB.put('broadcast_message_reads', { id: 'bcast1:u1', messageId: 'bcast1', userId: 'u1', readAt: '2026-10-18T09:00:00.000Z', createdAt: '2026-10-18T09:00:00.000Z', updatedAt: '2026-10-18T09:00:00.000Z', active: true });
    const pushRes = await Sync.pushAll();
    expect(pushRes.pushed).toBe(1);
    expect(remote.postCalls).toHaveBeenCalledTimes(1);
    expect(remote.rows.find(r => r.store === 'broadcast_message_reads' && r.id === 'bcast1:u1').payload.readAt).toBe('2026-10-18T09:00:00.000Z');
  });

  it('14. restart: tras pull, el recibo local trae _pushedVersion correcto (leído persiste)', async () => {
    seedBroadcast();
    await Sync.pullAll();
    await fakeDB.put('broadcast_message_reads', { id: 'bcast1:u1', messageId: 'bcast1', userId: 'u1', readAt: 't', createdAt: 't', updatedAt: 't', active: true });
    await Sync.pushAll();
    await Sync.pullAll(); // "reinicio" = vuelve a traer lo que el servidor ya tiene
    const local = await fakeDB.get('broadcast_message_reads', 'bcast1:u1');
    expect(local.readAt).toBe('t');
    expect(local._pushedVersion).toBe(local.updatedAt);
  });

  it('15. offline: marcar leído sin red deja el recibo local intacto, no llega al servidor', async () => {
    seedBroadcast();
    await Sync.pullAll();
    await fakeDB.put('broadcast_message_reads', { id: 'bcast1:u1', messageId: 'bcast1', userId: 'u1', readAt: 't', createdAt: 't', updatedAt: 't', active: true });
    networkDown = true;
    const offlinePush = await Sync.pushAll();
    expect(offlinePush.pushed).toBe(0);
    networkDown = false;
    expect(remote.rows.find(r => r.store === 'broadcast_message_reads')).toBeUndefined();
    expect((await fakeDB.get('broadcast_message_reads', 'bcast1:u1')).readAt).toBe('t');
  });

  it('16. reconectar sincroniza exactamente 1 vez, nunca duplica el recibo', async () => {
    seedBroadcast();
    await Sync.pullAll();
    await fakeDB.put('broadcast_message_reads', { id: 'bcast1:u1', messageId: 'bcast1', userId: 'u1', readAt: 't', createdAt: 't', updatedAt: 't', active: true });
    networkDown = true;
    await Sync.pushAll();
    networkDown = false;
    const pushRes = await Sync.pushAll();
    expect(pushRes.pushed).toBe(1);
    expect(remote.rows.filter(r => r.store === 'broadcast_message_reads' && r.id === 'bcast1:u1')).toHaveLength(1);
    expect(remote.postCalls).toHaveBeenCalledTimes(1);
  });

  it('17. un pushAll() extra tras sincronizar no reintenta (fila ya no dirty)', async () => {
    seedBroadcast();
    await Sync.pullAll();
    await fakeDB.put('broadcast_message_reads', { id: 'bcast1:u1', messageId: 'bcast1', userId: 'u1', readAt: 't', createdAt: 't', updatedAt: 't', active: true });
    await Sync.pushAll();
    remote.postCalls.mockClear();
    const pushRes2 = await Sync.pushAll();
    expect(pushRes2.pushed).toBe(0);
    expect(remote.postCalls).not.toHaveBeenCalled();
  });
});
