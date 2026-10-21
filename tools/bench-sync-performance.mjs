// tools/bench-sync-performance.mjs
//
// SYNC_PERFORMANCE (2026-10-18) — benchmark REAL (no inventado) del código
// REAL de sync.js/db.js (nunca reimplementado), ejecutado contra un
// "remoto" en memoria con la misma forma/CAS de engrase_sync que
// tests/unit/sync-pull-push.test.js/manual-tasks-sync.test.js/
// broadcast-sync.test.js — mismo patrón ya establecido, reusado tal cual.
//
// LIMITACIÓN HONESTA (declarada, no escondida): este entorno no tiene
// acceso a producción ni a un dispositivo real. Los números de abajo son:
//   - REALES para: conteo de llamadas (allRaw/getAuthorizationContext/
//     fetch), y para el costo algorítmico/JS puro (autorización,
//     parseo JSON, iteración) medido con performance.now() en Node.
//   - NO representan latencia de red real a Supabase ni latencia real de
//     IndexedDB en un teléfono (el "remoto" fake responde en memoria sin
//     latencia de red, y el "IDB" de estos helpers es un Map de JS, no
//     IndexedDB real) — son una COTA INFERIOR / comparación relativa
//     ANTES/DESPUÉS de una optimización, nunca una predicción absoluta de
//     experiencia en dispositivo.
// Uso: node tools/bench-sync-performance.mjs
import { loadSyncLogic, loadDbLogic, loadDbAuthorizationLogic } from '../tests/helpers/loadLubricationLogic.js';

// Los tests (vitest/jsdom) ya traen `navigator.onLine=true` por defecto;
// este script corre en Node puro (sin DOM) — fullSync() lo necesita (ver
// su primer gate). Nunca se simula una condición real de red con esto,
// solo se completa el global que un navegador real siempre tiene.
if (typeof globalThis.navigator === 'undefined' || typeof globalThis.navigator.onLine === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
}

const { buildManualTaskCompletionRow } = loadDbLogic();

function makeFakeDB(spies = {}) {
  const stores = {};
  let config = null;
  let authContext = null;
  return {
    async getConfig() { return config; },
    async setConfig(v) { config = v; return v; },
    async get(store, id) { const m = stores[store]; return m && m.has(id) ? m.get(id) : null; },
    async put(store, obj) { if (!stores[store]) stores[store] = new Map(); stores[store].set(obj.id, obj); return obj; },
    async all(store) { spies.all?.(store); return stores[store] ? Array.from(stores[store].values()) : []; },
    async allRaw(store) { spies.allRaw?.(store); return stores[store] ? Array.from(stores[store].values()) : []; },
    async getRaw(store, id) { const m = stores[store]; return m && m.has(id) ? m.get(id) : null; },
    async getAuthorizationContext(appUserId) { spies.getAuthorizationContext?.(appUserId); return authContext; },
    async setAuthorizationContext(appUserId, value) { authContext = value; return value; },
    async recordConflicts() {},
    _stores: stores,
  };
}

function makeFakeRemote() {
  let rows = [];
  async function handleFetch(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    if (u.pathname.includes('/storage/v1/object/')) return { ok: true, status: 200, json: async () => ({}) };
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
    // CREW_SCOPED (ver FAKE_AUTH abajo) hace una llamada REAL a este RPC
    // (fetchSupportManifest, sync.js) antes de cada pull — GLOBAL la salta
    // (short-circuit en el propio sync.js), por eso los tests existentes
    // (fakeAuth por defecto, GLOBAL) nunca la ejercitan. Manifiesto vacío
    // (sin grants de soporte puntuales) — no es lo que este benchmark mide.
    if (u.pathname.endsWith('/rpc/get_assignment_support_context')) {
      return { ok: true, status: 200, json: async () => ({ status: 'AUTHORIZED', authUserId: 'bench-auth', appUserId: 'bench-app', rows: [], operational: [], revision: 'bench-rev' }) };
    }
    if (method === 'POST') {
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
  return { get rows() { return rows; }, seed(list) { rows = rows.concat(list); }, handleFetch };
}

const FAKE_AUTH = {
  isSupabaseMode: () => true, isAuthenticated: () => true,
  getSession: () => ({ accessToken: 'bench-jwt' }), getSessionEpoch: () => 1,
  getProfile: () => ({ role: 'LUBRICADOR', authUserId: 'bench-auth', appUserId: 'bench-app', authorizationFingerprint: 'bench-fp', rowScopeEnforced: true, scopeType: 'CREW_SCOPED', authorizedCrewIds: ['cq1'], authorizedLocationIds: ['loc1'] }),
  restoreSession: async () => {},
  refreshAuthorizationContext: async () => ({ ok: true, changed: false, firstSnapshot: false, context: { rowScopeEnforced: true } }),
};

const STORES = ['equipment', 'lubrication_records', 'audit_log', 'cuadrillas', 'crew_locations', 'locations', 'manual_tasks', 'broadcast_messages', 'broadcast_message_reads'];

// --- Dataset "realista" (ver §5 del pedido: top de volumen por store) ---
function seedRealisticDataset(remote, { lubricationRecords = 2000, equipment = 150, auditLog = 500, broadcastsLocation = 15 } = {}) {
  const v = '2026-10-01T00:00:00.000Z';
  const rows = [];
  rows.push({ store: 'cuadrillas', id: 'cq1', payload: { id: 'cq1', active: true, memberUserIds: ['bench-app'] }, updated_at: v, deleted: false });
  rows.push({ store: 'crew_locations', id: 'cl1', payload: { crew_id: 'cq1', location_id: 'loc1', role: 'PRINCIPAL', active: true }, updated_at: v, deleted: false });
  rows.push({ store: 'locations', id: 'loc1', payload: { id: 'loc1', active: true, name: 'Faena Bench' }, updated_at: v, deleted: false });
  for (let i = 0; i < equipment; i++) rows.push({ store: 'equipment', id: `e${i}`, payload: { id: `e${i}`, locationId: 'loc1', code: `EQ-${i}` }, updated_at: v, deleted: false });
  for (let i = 0; i < lubricationRecords; i++) rows.push({ store: 'lubrication_records', id: `r${i}`, payload: { id: `r${i}`, equipmentId: `e${i % Math.max(equipment, 1)}`, qty: 10, hourmeter: 100, date: v, operationalSnapshot: { crewId: 'cq1' } }, updated_at: v, deleted: false });
  for (let i = 0; i < auditLog; i++) rows.push({ store: 'audit_log', id: `a${i}`, payload: { id: `a${i}`, action: 'X', detail: 'y' }, updated_at: v, deleted: false });
  // Broadcasts targetType=LOCATION — el caso que antes releía cuadrillas/crew_locations por fila.
  for (let i = 0; i < broadcastsLocation; i++) rows.push({ store: 'broadcast_messages', id: `bl${i}`, payload: { id: `bl${i}`, title: `Aviso ${i}`, message: 'x', priority: 'INFORMATIVA', targetType: 'LOCATION', targetId: 'loc1', createdBy: 'u-admin', createdAt: v, updatedAt: v }, updated_at: v, deleted: false });
  remote.seed(rows);
  return rows.length;
}

function fmt(ms) { return `${ms.toFixed(1)}ms`; }

async function runScenario(name, { seed, action }) {
  const spies = { allRawCalls: [], getAuthorizationContextCalls: 0 };
  const fakeDB = makeFakeDB({
    allRaw: (store) => spies.allRawCalls.push(store),
    getAuthorizationContext: () => { spies.getAuthorizationContextCalls++; },
  });
  const remote = makeFakeRemote();
  globalThis.fetch = (url, init) => remote.handleFetch(url, init);
  await fakeDB.setConfig({ url: 'https://bench.test', anonKey: 'anon-bench' });
  const { Sync } = loadSyncLogic(fakeDB, STORES, FAKE_AUTH);
  const perfLog = [];
  Sync._logPerf = (perf) => perfLog.push(perf);
  const rowCount = seed ? seed(remote) : 0;
  const t0 = performance.now();
  const result = await action({ Sync, fakeDB, remote });
  const totalMs = performance.now() - t0;
  return { name, rowCount, totalMs, result, perfLog, spies };
}

function printScenario(s) {
  console.log(`\n--- ${s.name} ---`);
  console.log(`filas sembradas: ${s.rowCount}`);
  console.log(`tiempo total medido (Node, en memoria): ${fmt(s.totalMs)}`);
  for (const p of s.perfLog) {
    console.log(`  fullSync perf: push=${fmt(p.push?.ms ?? 0)} (${p.push?.rows ?? 0} rows) | pull network=${fmt(p.pull?.networkMs ?? 0)} parse=${fmt(p.pull?.parseMs ?? 0)} merge=${fmt(p.pull?.mergeMs ?? 0)} idbWrite=${fmt(p.pull?.idbWriteMs ?? 0)} (${p.pull?.rows ?? 0} rows, ${p.pull?.pages ?? 0} pages, ${p.pull?.puts ?? 0} puts) | total=${fmt(p.totalMs)} | bootstrap=${p.bootstrap}`);
  }
  console.log(`  allRaw() calls: ${s.spies.allRawCalls.length} (${JSON.stringify(countBy(s.spies.allRawCalls))})`);
  console.log(`  getAuthorizationContext() calls: ${s.spies.getAuthorizationContextCalls}`);
}

function countBy(list) {
  const out = {};
  for (const v of list) out[v] = (out[v] || 0) + 1;
  return out;
}

async function main() {
  const results = [];

  results.push(await runScenario('A) Bootstrap inicial (fresh install, dataset completo)', {
    seed: (remote) => seedRealisticDataset(remote),
    action: async ({ Sync }) => Sync.fullSync(),
  }));

  results.push(await runScenario('B) Incremental no-op (nada nuevo desde el cursor)', {
    seed: (remote) => { const n = seedRealisticDataset(remote); return n; },
    action: async ({ Sync }) => { await Sync.fullSync(); return Sync.fullSync(); }, // 1ra deja bootstrapComplete=true, 2da es el no-op medido
  }));

  results.push(await runScenario('C) Incremental con 1 fila cambiada', {
    seed: (remote) => seedRealisticDataset(remote),
    action: async ({ Sync, fakeDB }) => {
      await Sync.fullSync();
      await fakeDB.put('equipment', { id: 'e0', locationId: 'loc1', code: 'EQ-0-EDITADO', updatedAt: new Date().toISOString(), active: true });
      return Sync.fullSync();
    },
  }));

  results.push(await runScenario('D) Completar manual_task (DB.put + Sync.fullSync, patrón real de la app)', {
    seed: (remote) => {
      const n = seedRealisticDataset(remote);
      remote.seed([{ store: 'manual_tasks', id: 'mtask1', payload: { id: 'mtask1', equipmentId: 'e0', crewId: 'cq1', status: 'PENDING', description: 'x', priority: 'ALTA', createdBy: 'u-admin', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }, updated_at: '2026-10-01T00:00:00.000Z', deleted: false }]);
      return n + 1;
    },
    action: async ({ Sync, fakeDB }) => {
      await Sync.fullSync();
      const current = await fakeDB.get('manual_tasks', 'mtask1');
      const completion = buildManualTaskCompletionRow(current, { completedBy: 'bench-app', completionComment: 'Listo', photos: [] });
      await fakeDB.put('manual_tasks', completion);
      return Sync.fullSync();
    },
  }));

  results.push(await runScenario('E) Marcar broadcast como leído (DB.put + Sync.fullSync, patrón real de markBroadcastAsRead())', {
    seed: (remote) => seedRealisticDataset(remote),
    action: async ({ Sync, fakeDB }) => {
      await Sync.fullSync();
      await fakeDB.put('broadcast_message_reads', { id: 'bl0:bench-app', messageId: 'bl0', userId: 'bench-app', readAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), active: true });
      return Sync.fullSync();
    },
  }));

  results.push(await runScenario('F) Offline -> reconnect (push falla sin red, luego reintenta igual)', {
    seed: (remote) => seedRealisticDataset(remote),
    action: async ({ Sync, fakeDB }) => {
      await Sync.fullSync();
      await fakeDB.put('broadcast_message_reads', { id: 'bl0:bench-app', messageId: 'bl0', userId: 'bench-app', readAt: 't', createdAt: 't', updatedAt: 't', active: true });
      const realFetch = globalThis.fetch;
      globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
      await Sync.fullSync(); // offline
      globalThis.fetch = realFetch;
      return Sync.fullSync(); // reconnect
    },
  }));

  for (const r of results) printScenario(r);

  // --- Prueba dedicada: impacto del cache de cobertura (cuadrillas/crew_locations) ---
  // Mismo código REAL (authorizationStateForRow), comparando compartir UN
  // cache por ciclo (comportamiento actual) vs uno nuevo por fila (el
  // comportamiento ANTES del fix) — misma función, mismo dataset, única
  // variable: si el cache se comparte o no.
  console.log('\n--- G) Impacto del cache de cobertura (broadcast_messages targetType=LOCATION) ---');
  const { DB: DBAuth } = loadDbAuthorizationLogic();
  const N = 50; // cantidad de broadcasts LOCATION en esta prueba puntual
  const cuadrillas = [{ id: 'cq1', active: true }];
  const crewLocations = [{ crew_id: 'cq1', location_id: 'loc1', role: 'PRINCIPAL', active: true }];
  const ctx = { appUserId: 'u1', active: true, scopeType: 'CREW_SCOPED', authorizedCrewIds: ['cq1'], authorizedLocationIds: [] };
  function makeFakeAuthThis(counter) {
    return {
      allRaw: async (store) => { counter.calls++; return store === 'cuadrillas' ? cuadrillas : store === 'crew_locations' ? crewLocations : []; },
      getRaw: async () => null,
    };
  }
  const rows = Array.from({ length: N }, (_, i) => ({ __authorizationAppUserId: 'u1', targetType: 'LOCATION', targetId: 'loc1', updatedAt: 't0', _pushedVersion: 't0', id: `bl${i}` }));

  const beforeCounter = { calls: 0 };
  const beforeThis = makeFakeAuthThis(beforeCounter);
  const t0b = performance.now();
  for (const row of rows) await DBAuth.authorizationStateForRow.call(beforeThis, 'broadcast_messages', row, ctx, 'u1', {}); // cache NUEVO cada vez = comportamiento ANTES del fix
  const beforeMs = performance.now() - t0b;

  const afterCounter = { calls: 0 };
  const afterThis = makeFakeAuthThis(afterCounter);
  const sharedCache = {};
  const t0a = performance.now();
  for (const row of rows) await DBAuth.authorizationStateForRow.call(afterThis, 'broadcast_messages', row, ctx, 'u1', sharedCache); // cache COMPARTIDO = comportamiento actual
  const afterMs = performance.now() - t0a;

  console.log(`${N} broadcasts LOCATION, mismo dataset, misma función (DB.authorizationStateForRow):`);
  console.log(`  ANTES  (cache nuevo por fila): ${beforeCounter.calls} llamadas a allRaw() | ${fmt(beforeMs)}`);
  console.log(`  DESPUÉS (cache por ciclo):     ${afterCounter.calls} llamadas a allRaw() | ${fmt(afterMs)}`);
  console.log(`  reducción de llamadas allRaw(): ${(100 * (1 - afterCounter.calls / beforeCounter.calls)).toFixed(1)}%`);
}

main().catch(e => { console.error(e); process.exit(1); });
