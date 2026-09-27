// tests/unit/sync-multidevice.test.js
//
// PRIORIDAD P0-1 — endurecer sync multidispositivo sin pérdida de datos.
//
// Riesgo real encontrado en la auditoría inicial: pushAll() hacía upsert
// remoto sin comprobar si el servidor ya tenía una versión más nueva, y
// pullAll() podía sobrescribir un cambio local pendiente con lo que llegaba
// del servidor — ninguno de los dos comparaba contra una "base" común (el
// primero en sincronizar ganaba en silencio, LWW ciego).
//
// Endurecimiento posterior: la primera versión de este fix hacía un GET
// (versión remota actual) seguido de un POST/UPSERT separado. Eso deja una
// ventana real entre leer y escribir — dos dispositivos pueden leer T0 al
// mismo tiempo, los dos recibir luz verde, y el segundo en escribir pisa al
// primero de todos modos (ver escenario K abajo, que reproduce exactamente
// esa carrera). Ahora pushAll() usa UNA sola operación atómica por fila:
//   - fila nueva (_pushedVersion undefined) -> INSERT protegido por la PK
//     real (store,id) con ignore-duplicates.
//   - fila con base conocida -> UPDATE (PATCH) condicionado por
//     `updated_at=eq.<_pushedVersion>` en el WHERE — Postgres compara y
//     escribe en la MISMA sentencia, sin ventana entre medio.
//
// Estas pruebas simulan 2 dispositivos (A y B) contra el MISMO servidor
// falso en memoria — NUNCA contra producción (NO login real, NO fullSync
// real, ver instrucción explícita del usuario). No hay columna `version` en
// engrase_sync (ver schema.sql) — la única base confiable es `updatedAt`
// (local) / `updated_at` (remoto) comparada contra `_pushedVersion`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadSyncLogic } from '../helpers/loadLubricationLogic.js';

const STORES_TEST = ['equipment', 'lubrication_points', 'grease_validations', 'lubrication_records'];

const T0 = '2026-02-01T00:00:00.000Z';
const T1 = '2026-02-01T01:00:00.000Z';
const T2 = '2026-02-01T02:00:00.000Z';

function row(store, id, payload, updatedAt, deleted = false) {
  return { store, id, payload: { id, ...payload, updatedAt }, updated_at: updatedAt, deleted };
}

// DB fake en memoria — mismo patrón que tests/unit/sync-pull-push.test.js,
// más getSyncConflicts()/recordConflicts() (mismo contrato que db.js real:
// dedup por store+id, nunca acumula copias viejas del mismo conflicto).
function makeFakeDB() {
  const stores = {};
  let config = null;
  let conflicts = [];
  return {
    async getConfig() { return config; },
    async setConfig(v) { config = v; return v; },
    async get(store, id) {
      const m = stores[store];
      return m && m.has(id) ? m.get(id) : null;
    },
    async put(store, obj) {
      if (!stores[store]) stores[store] = new Map();
      stores[store].set(obj.id, obj);
      return obj;
    },
    async all(store) {
      return stores[store] ? Array.from(stores[store].values()) : [];
    },
    async getSyncConflicts() { return conflicts; },
    async recordConflicts(list) {
      if (!list || !list.length) return;
      const byKey = new Map(conflicts.map(c => [`${c.store}:${c.id}`, c]));
      for (const c of list) byKey.set(`${c.store}:${c.id}`, c);
      conflicts = Array.from(byKey.values());
    },
    _stores: stores,
  };
}

// Servidor en memoria compartido por ambos dispositivos — misma forma que
// engrase_sync real (store, id, payload, updated_at, deleted) y modela las
// operaciones ATÓMICAS reales que usa pushAll():
//   - POST ?on_conflict=store,id, Prefer: resolution=ignore-duplicates ->
//     INSERT protegido por la PK real: filas nuevas se insertan y se
//     devuelven, un id que YA existe se omite de la respuesta (nunca lo pisa).
//   - PATCH ?store=eq.X&id=eq.Y&updated_at=eq.<base> -> UPDATE condicionado:
//     si el WHERE no matchea (la base ya cambió), 0 filas, sin pisar nada.
//   - GET puntual (?select=updated_at&store=eq.X&id=eq.Y) -> SOLO
//     diagnóstico post-conflicto (fetchRemoteUpdatedAt), nunca decide nada.
//   - GET de paginación (?select=*&updated_at=gt....) -> pull normal.
// executeSequentially() simula la carrera real: dos "requests" que llegan
// casi al mismo tiempo pero el servidor los procesa uno por uno (como
// cualquier base de datos real con locking a nivel de fila).
function makeFakeRemote(pageSizeCap = 1000) {
  let rows = [];
  const sortKey = r => `${r.updated_at}|${r.store}|${r.id}`;
  const post = vi.fn();
  const patch = vi.fn();
  async function handleFetch(url, init = {}) {
    // Estas pruebas no ejercitan Storage (fotos/firmas) — si algún test
    // deja signatureLocal/photos en base64 en una fila dirty,
    // uploadPhotoIfNeeded()/uploadSignatureIfNeeded() intentan subirlas
    // antes del PATCH/POST de sync; devolver "no ok" (en vez de dejar que
    // el POST de engrase_sync intente parsear un Blob como JSON) activa la
    // misma rama de resiliencia real ("se queda en base64, se reintenta
    // después") sin ensuciar la salida con un error de parseo.
    if (!String(url).includes('/rest/v1/engrase_sync')) {
      return { ok: false, status: 404 };
    }
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      const storeEq = u.searchParams.get('store');
      const idEq = u.searchParams.get('id');
      if (storeEq && idEq && idEq.startsWith('eq.')) {
        const storeVal = storeEq.replace(/^eq\./, '');
        const idVal = idEq.replace(/^eq\./, '');
        const match = rows.find(r => r.store === storeVal && r.id === idVal);
        const result = match ? [{ updated_at: match.updated_at }] : [];
        return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(result)) };
      }
      const sinceParam = u.searchParams.get('updated_at') || 'gt.1970-01-01T00:00:00.000Z';
      const since = sinceParam.replace(/^gt\./, '');
      const limit = parseInt(u.searchParams.get('limit') || '1000', 10);
      const offset = parseInt(u.searchParams.get('offset') || '0', 10);
      const filtered = rows.filter(r => r.updated_at > since).sort((a, b) => sortKey(a) < sortKey(b) ? -1 : 1);
      const page = filtered.slice(offset, offset + Math.min(limit, pageSizeCap));
      // Clon profundo — un fetch() real deserializa JSON fresco en cada
      // respuesta, nunca entrega la misma referencia en memoria que guarda
      // el "servidor" (si no, dos dispositivos que pullean la misma fila
      // terminarían compartiendo el mismo objeto JS).
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(page)) };
    }
    if (method === 'POST') {
      post(url, init);
      const body = JSON.parse(init.body);
      const inserted = [];
      body.forEach(item => {
        const exists = rows.some(r => r.store === item.store && r.id === item.id);
        if (exists) return; // ignore-duplicates: NUNCA pisa una fila que ya existe
        const entry = { store: item.store, id: item.id, payload: item.payload, updated_at: item.updated_at, deleted: item.deleted };
        rows.push(entry);
        inserted.push(entry);
      });
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(inserted)) };
    }
    if (method === 'PATCH') {
      patch(url, init);
      const storeVal = (u.searchParams.get('store') || '').replace(/^eq\./, '');
      const idVal = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      const expected = (u.searchParams.get('updated_at') || '').replace(/^eq\./, '');
      // CAS atómico: el WHERE (store+id+updated_at=base esperada) se evalúa
      // y se escribe en la MISMA operación — no hay "leer" y luego "escribir"
      // por separado, así que no existe ventana para que otro request se
      // meta en medio (a diferencia del viejo GET+POST).
      const idx = rows.findIndex(r => r.store === storeVal && r.id === idVal && r.updated_at === expected);
      if (idx === -1) return { ok: true, status: 200, json: async () => [] };
      rows[idx] = { ...rows[idx], ...JSON.parse(init.body) };
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify([rows[idx]])) };
    }
    throw new Error(`método no soportado en el remoto falso: ${method}`);
  }
  return {
    get rows() { return rows; },
    seed(list) { rows = rows.concat(list); },
    handleFetch,
    postCalls: post,
    patchCalls: patch,
  };
}

let dbA, dbB, remote, SyncA, SyncB, decidePullAction, isRowDirty;

beforeEach(async () => {
  dbA = makeFakeDB();
  dbB = makeFakeDB();
  remote = makeFakeRemote();
  vi.stubGlobal('fetch', (url, init) => remote.handleFetch(url, init));
  await dbA.setConfig({ url: 'https://fake.test', anonKey: 'anon-test' });
  await dbB.setConfig({ url: 'https://fake.test', anonKey: 'anon-test' });
  ({ Sync: SyncA, decidePullAction, isRowDirty } = loadSyncLogic(dbA, STORES_TEST));
  ({ Sync: SyncB } = loadSyncLogic(dbB, STORES_TEST));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ============================================================
   Funciones puras de decisión del lado PULL (secciones 2 y 3 de la tarea):
   SINCRONIZADA / CAMBIO LOCAL PENDIENTE / CAMBIO REMOTO NUEVO / CONFLICTO
   REAL. "remote existe" nunca se confunde con "hay conflicto". El lado PUSH
   ya NO tiene una función pura de decisión — la decisión y la escritura son
   la MISMA operación atómica en el servidor (ver checkPushAllowed
   eliminada en sync.js), por eso solo se prueba a nivel de integración
   abajo (Sync.pushAll() contra el remoto falso).
   ============================================================ */

describe('isRowDirty() — único criterio de "cambio local sin confirmar"', () => {
  it('sin fila local -> false', () => { expect(isRowDirty(null)).toBe(false); });
  it('updatedAt === _pushedVersion (SINCRONIZADA) -> false', () => {
    expect(isRowDirty({ updatedAt: 'a', _pushedVersion: 'a' })).toBe(false);
  });
  it('updatedAt !== _pushedVersion (CAMBIO LOCAL PENDIENTE) -> true', () => {
    expect(isRowDirty({ updatedAt: 'b', _pushedVersion: 'a' })).toBe(true);
  });
});

describe('decidePullAction() — regla de pull segura', () => {
  it('CASO 1: no existe local todavía -> ACCEPT', () => {
    expect(decidePullAction(null, 'x')).toEqual({ action: 'ACCEPT' });
  });
  it('CASO 1: local SIN cambios pendientes -> ACCEPT (remote es la fuente de verdad)', () => {
    const local = { updatedAt: 'a', _pushedVersion: 'a' };
    expect(decidePullAction(local, 'z')).toEqual({ action: 'ACCEPT' });
  });
  it('CASO 2: local pendiente y remote sigue EXACTAMENTE en la base conocida -> KEEP_LOCAL', () => {
    const local = { updatedAt: 'b', _pushedVersion: 'a' };
    expect(decidePullAction(local, 'a')).toEqual({ action: 'KEEP_LOCAL' });
  });
  it('CASO 3: local pendiente y remote se movió desde esa base -> CONFLICT (ninguno gana en silencio)', () => {
    const local = { updatedAt: 'b', _pushedVersion: 'a' };
    expect(decidePullAction(local, 'c')).toEqual({ action: 'CONFLICT', localVersion: 'b', remoteVersion: 'c' });
  });
});

/* ============================================================
   Escenarios multidispositivo end-to-end (sección 8 de la tarea).
   ============================================================ */

describe('A) A y B parten igual; A cambia y sincroniza; B (sin cambios) pull -> recibe el cambio de A', () => {
  it('B ve el cambio de A tal cual', async () => {
    remote.seed([row('equipment', 'eq1', { code: 'BASE' }, T0)]);
    await SyncA.pullAll();
    await SyncB.pullAll();

    const localA = await dbA.get('equipment', 'eq1');
    localA.code = 'A-CHANGE';
    localA.updatedAt = T1;
    await dbA.put('equipment', localA);
    await SyncA.pushAll();

    await SyncB.pullAll();
    const localB = await dbB.get('equipment', 'eq1');
    expect(localB.code).toBe('A-CHANGE');
  });
});

describe('B) A offline cambia; B cambia y sincroniza primero; A reconecta -> NO sobrescribe a B', () => {
  it('push de A es rechazado (conflicto), servidor conserva el cambio de B, A sigue pendiente', async () => {
    remote.seed([row('equipment', 'eq1', { code: 'BASE' }, T0)]);
    await SyncA.pullAll();
    await SyncB.pullAll();

    // A cambia OFFLINE (no sincroniza todavía).
    const localA = await dbA.get('equipment', 'eq1');
    localA.code = 'A-CHANGE';
    localA.updatedAt = T1;
    await dbA.put('equipment', localA);

    // B cambia y sincroniza PRIMERO.
    const localB = await dbB.get('equipment', 'eq1');
    localB.code = 'B-CHANGE';
    localB.updatedAt = T2;
    await dbB.put('equipment', localB);
    const pushB = await SyncB.pushAll();
    expect(pushB.pushed).toBe(1);

    // A reconecta e intenta subir su cambio offline. El PATCH de A lleva
    // updated_at=eq.T0 (su _pushedVersion) pero el servidor ya está en T2
    // (B lo cambió) -> 0 filas afectadas -> conflicto, atómico, servidor.
    const pushA = await SyncA.pushAll();
    expect(pushA.pushed).toBe(0);
    expect(pushA.conflicts).toBe(1);
    expect(remote.patchCalls).toHaveBeenCalledTimes(2); // el intento de B (éxito) + el de A (0 filas)

    const remoteRow = remote.rows.find(r => r.store === 'equipment' && r.id === 'eq1');
    expect(remoteRow.payload.code).toBe('B-CHANGE'); // el servidor NO se pisó

    const localAafter = await dbA.get('equipment', 'eq1');
    expect(localAafter.code).toBe('A-CHANGE'); // el cambio de A no se descartó
    expect(isRowDirty(localAafter)).toBe(true); // sigue pendiente, listo para reintentar

    const conflicts = await dbA.getSyncConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ store: 'equipment', id: 'eq1', localVersion: T1, remoteVersion: T2 });
    expect(typeof conflicts[0].detectedAt).toBe('string'); // sin firmas/fotos/base64 en el registro
  });
});

describe('C) A cambia y sincroniza; B solo tenía copia vieja sin cambios; B reconecta -> acepta remoto, 0 push', () => {
  it('B queda igual a A y no sube nada', async () => {
    remote.seed([row('equipment', 'eq1', { code: 'BASE' }, T0)]);
    await SyncA.pullAll();
    await SyncB.pullAll();

    const localA = await dbA.get('equipment', 'eq1');
    localA.code = 'A-CHANGE';
    localA.updatedAt = T1;
    await dbA.put('equipment', localA);
    await SyncA.pushAll();

    const pullB = await SyncB.pullAll();
    expect(pullB.pulled).toBe(1);
    expect(pullB.conflicts).toBe(0);
    const localB = await dbB.get('equipment', 'eq1');
    expect(localB.code).toBe('A-CHANGE');

    const pushB = await SyncB.pushAll();
    expect(pushB.pushed).toBe(0);
  });
});

describe('D) A cambia localmente; remote sigue igual que la base -> A puede subir', () => {
  it('push permitido vía PATCH (CAS matchea), 0 conflictos', async () => {
    remote.seed([row('equipment', 'eq1', { code: 'BASE' }, T0)]);
    await SyncA.pullAll();

    const localA = await dbA.get('equipment', 'eq1');
    localA.code = 'A-CHANGE';
    localA.updatedAt = T1;
    await dbA.put('equipment', localA);

    const pushA = await SyncA.pushAll();
    expect(pushA.pushed).toBe(1);
    expect(pushA.conflicts).toBe(0);
    expect(remote.patchCalls).toHaveBeenCalledTimes(1);
  });
});

describe('E) A soft-delete local; B cambia remoto -> conflicto, NO delete remoto', () => {
  it('el servidor conserva el cambio de B, deleted sigue false', async () => {
    remote.seed([row('equipment', 'eq1', { code: 'BASE', active: true }, T0)]);
    await SyncA.pullAll();
    await SyncB.pullAll();

    const localA = await dbA.get('equipment', 'eq1');
    localA.active = false; // soft delete local
    localA.updatedAt = T1;
    await dbA.put('equipment', localA);

    const localB = await dbB.get('equipment', 'eq1');
    localB.code = 'B-CHANGE';
    localB.updatedAt = T2;
    await dbB.put('equipment', localB);
    await SyncB.pushAll();

    const pushA = await SyncA.pushAll();
    expect(pushA.pushed).toBe(0);
    expect(pushA.conflicts).toBe(1);

    const remoteRow = remote.rows.find(r => r.store === 'equipment' && r.id === 'eq1');
    expect(remoteRow.deleted).toBe(false);
    expect(remoteRow.payload.code).toBe('B-CHANGE');
  });
});

describe('F) Remote soft-delete; A tiene cambio local pendiente -> conflicto', () => {
  it('el pull de A detecta conflicto y NO aplica el delete a ciegas', async () => {
    remote.seed([row('equipment', 'eq1', { code: 'BASE', active: true }, T0)]);
    await SyncA.pullAll();
    await SyncB.pullAll();

    // A cambia localmente (pendiente, no sincroniza todavía).
    const localA = await dbA.get('equipment', 'eq1');
    localA.code = 'A-CHANGE';
    localA.updatedAt = T1;
    await dbA.put('equipment', localA);

    // B borra (soft-delete) y sincroniza.
    const localB = await dbB.get('equipment', 'eq1');
    localB.active = false;
    localB.updatedAt = T2;
    await dbB.put('equipment', localB);
    await SyncB.pushAll();

    // A hace pull antes de su propio push (llega el delete remoto de B).
    const pullA = await SyncA.pullAll();
    expect(pullA.conflicts).toBe(1);

    const localAafter = await dbA.get('equipment', 'eq1');
    expect(localAafter.active).toBe(true); // el delete remoto NO se aplicó a ciegas
    expect(localAafter.code).toBe('A-CHANGE'); // el cambio local pendiente sigue intacto
  });
});

describe('G) 2 dispositivos crean registros DISTINTOS sin conocerse -> ambos sobreviven', () => {
  it('cada dispositivo termina viendo los 2 registros', async () => {
    await dbA.put('equipment', { id: 'eq_a', code: 'CREADO-POR-A', active: true, updatedAt: T0 });
    await dbB.put('equipment', { id: 'eq_b', code: 'CREADO-POR-B', active: true, updatedAt: T0 });

    await SyncA.pushAll();
    await SyncB.pushAll();
    await SyncA.pullAll();
    await SyncB.pullAll();

    expect((await dbA.get('equipment', 'eq_b')).code).toBe('CREADO-POR-B');
    expect((await dbB.get('equipment', 'eq_a')).code).toBe('CREADO-POR-A');
  });
});

describe('G2) 2 dispositivos crean el MISMO id sin conocerse -> el segundo NO pisa al primero, conflicto de creación', () => {
  it('el servidor conserva la primera creación; el segundo dispositivo queda con conflicto y su fila local intacta', async () => {
    await dbA.put('equipment', { id: 'eq_x', code: 'CREADO-POR-A', active: true, updatedAt: T0 });
    await dbB.put('equipment', { id: 'eq_x', code: 'CREADO-POR-B', active: true, updatedAt: T0 });

    const pushA = await SyncA.pushAll(); // llega primero
    expect(pushA.pushed).toBe(1);
    expect(pushA.conflicts).toBe(0);

    const pushB = await SyncB.pushAll(); // mismo id, INSERT con ignore-duplicates -> se omite
    expect(pushB.pushed).toBe(0);
    expect(pushB.conflicts).toBe(1);

    const remoteRow = remote.rows.find(r => r.store === 'equipment' && r.id === 'eq_x');
    expect(remoteRow.payload.code).toBe('CREADO-POR-A'); // NUNCA se convirtió en overwrite

    const localBafter = await dbB.get('equipment', 'eq_x');
    expect(localBafter.code).toBe('CREADO-POR-B'); // la fila de B no se descartó ni se pisó
    expect(isRowDirty(localBafter)).toBe(true); // sigue pendiente de resolución

    const conflicts = await dbB.getSyncConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ store: 'equipment', id: 'eq_x', localVersion: T0 });
  });
});

describe('H) fullSync sin cambios locales en ningún dispositivo -> 0 escrituras', () => {
  it('ninguna ronda posterior sube nada si nadie cambió nada', async () => {
    remote.seed([row('equipment', 'eq1', { code: 'BASE' }, T0)]);
    await SyncA.pullAll();
    await SyncB.pullAll();
    remote.postCalls.mockClear();
    remote.patchCalls.mockClear();

    const pushA = await SyncA.pushAll();
    const pushB = await SyncB.pushAll();
    expect(pushA.pushed).toBe(0);
    expect(pushB.pushed).toBe(0);
    expect(remote.postCalls).not.toHaveBeenCalled();
    expect(remote.patchCalls).not.toHaveBeenCalled();
  });
});

describe('I) pull paginado (2500+) con una fila local dirty mezclada -> pagina completo, no pisa la fila local', () => {
  it('2500 filas remotas + 1 local offline, sin pérdidas ni sobrescrituras', async () => {
    const seedRows = [];
    for (let i = 0; i < 2500; i++) {
      const t = `2026-02-02T${String(Math.floor(i / 3600)).padStart(2, '0')}:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`;
      seedRows.push(row('lubrication_points', `pt${i}`, { point: `Punto ${i}` }, t));
    }
    remote.seed(seedRows);
    // Fila local creada offline, todavía no existe en el remoto.
    await dbA.put('lubrication_points', { id: 'pt_local_offline', point: 'Offline', active: true, updatedAt: T0 });

    const pullRes = await SyncA.pullAll();
    expect(pullRes.pulled).toBe(2500);
    const allPoints = await dbA.all('lubrication_points');
    expect(allPoints).toHaveLength(2501);
    const offlineAfter = await dbA.get('lubrication_points', 'pt_local_offline');
    expect(offlineAfter.point).toBe('Offline'); // nunca se tocó
  });
});

describe('J) grease_validations con signatureLocal pendiente en conflicto -> nunca se pierde ni se pisa', () => {
  it('el conflicto se detecta sin tocar la fila local ni loguear la firma', async () => {
    remote.seed([row('grease_validations', 'val1', { signerRole: 'OPERADOR' }, T0)]);
    await SyncA.pullAll();
    await SyncB.pullAll();

    // A firma localmente (offline): agrega signatureLocal, queda dirty.
    const localA = await dbA.get('grease_validations', 'val1');
    localA.signatureLocal = 'data:image/png;base64,AAAA';
    localA.updatedAt = T1;
    await dbA.put('grease_validations', localA);

    // B también cambia el registro y sincroniza primero.
    const localB = await dbB.get('grease_validations', 'val1');
    localB.signerRole = 'ENCARGADO';
    localB.updatedAt = T2;
    await dbB.put('grease_validations', localB);
    await SyncB.pushAll();

    const pushA = await SyncA.pushAll();
    expect(pushA.conflicts).toBe(1);

    const localAafter = await dbA.get('grease_validations', 'val1');
    expect(localAafter.signatureLocal).toBe('data:image/png;base64,AAAA'); // intacta, nunca pisada

    const conflicts = await dbA.getSyncConflicts();
    // El conflicto guarda SOLO versiones/ids/timestamps — nunca el payload.
    expect(Object.keys(conflicts[0]).sort()).toEqual(['detectedAt', 'id', 'localVersion', 'remoteVersion', 'store']);
  });
});

describe('K) CARRERA REAL: A y B leen T0 casi al mismo tiempo y los DOS intentan escribir', () => {
  it('EXACTAMENTE uno gana (A), el otro (B) recibe conflicto — nunca los dos "éxito", nunca se pisan', async () => {
    remote.seed([row('equipment', 'eq1', { code: 'BASE' }, T0)]);
    await SyncA.pullAll();
    await SyncB.pullAll();

    // Los dos parten de la MISMA base T0 (ninguno sabe todavía del otro).
    const localA = await dbA.get('equipment', 'eq1');
    expect(localA._pushedVersion).toBe(T0);
    const localB = await dbB.get('equipment', 'eq1');
    expect(localB._pushedVersion).toBe(T0);

    localA.code = 'A-WINS';
    localA.updatedAt = T1;
    await dbA.put('equipment', localA);

    localB.code = 'B-LOSES';
    localB.updatedAt = T2;
    await dbB.put('equipment', localB);

    // "Casi al mismo tiempo": los dos pushAll() se lanzan juntos con
    // Promise.all — el remoto falso (como cualquier base de datos real)
    // procesa las escrituras una por una internamente (JS es de un solo
    // hilo: no hay forma de que las dos PATCH lleguen literalmente en el
    // mismo instante), así que esto reproduce la carrera real: la SEGUNDA
    // en llegar al WHERE updated_at=eq.T0 ya no lo encuentra, porque la
    // PRIMERA ya lo cambió a T1 en la MISMA operación atómica.
    //
    // Con la implementación VIEJA (GET remoto -> checkPushAllowed() ->
    // POST separado) este test falla: los dos GET leen T0 antes de que
    // ninguno escriba, los dos reciben luz verde, y el segundo POST pisa
    // al primero — exactamente el escenario que describe la tarea.
    const [resA, resB] = await Promise.all([SyncA.pushAll(), SyncB.pushAll()]);

    const results = [resA, resB];
    const winners = results.filter(r => r.pushed === 1 && r.conflicts === 0);
    const losers = results.filter(r => r.pushed === 0 && r.conflicts === 1);
    expect(winners).toHaveLength(1); // EXACTAMENTE uno gana
    expect(losers).toHaveLength(1); // EXACTAMENTE uno pierde (nunca los dos ganan)

    // El servidor conserva la escritura del que ganó, sea cual sea —
    // nunca queda en un estado mixto ni pisado por el que perdió.
    const remoteRow = remote.rows.find(r => r.store === 'equipment' && r.id === 'eq1');
    expect(['A-WINS', 'B-LOSES']).toContain(remoteRow.payload.code);

    // El perdedor NO perdió su cambio local: sigue pendiente, intacto.
    const loserIsA = resA.conflicts === 1;
    const loserDb = loserIsA ? dbA : dbB;
    const loserExpectedCode = loserIsA ? 'A-WINS' : 'B-LOSES';
    const loserLocal = await loserDb.get('equipment', 'eq1');
    expect(loserLocal.code).toBe(loserExpectedCode);
    expect(isRowDirty(loserLocal)).toBe(true);
  });
});

describe('L) sync_conflicts es metadata LOCAL únicamente — nunca se sincroniza', () => {
  it('STORES no incluye app_config, y un conflicto detectado nunca aparece en el otro dispositivo', async () => {
    // Import directo de STORES/LOCAL_STORES reales de db.js — auditoría en
    // código, no una copia a mano que pueda desincronizarse del original.
    const { readSource } = await import('../helpers/extractFromSource.js');
    const { DB_JS_PATH } = await import('../helpers/loadLubricationLogic.js');
    const dbSource = readSource(DB_JS_PATH);
    expect(dbSource).toMatch(/const LOCAL_STORES = \[[^\]]*'app_config'[^\]]*\];/);
    const storesMatch = dbSource.match(/const STORES = \[([^\]]*)\];/);
    expect(storesMatch[1]).not.toContain('app_config'); // pushAll/pullAll solo iteran STORES

    // Genera un conflicto real en A (contra B) y confirma que B, al pull,
    // nunca ve nada de la metadata de conflicto de A (no hay ningún store
    // "conflictos" que sincronice, y el remoto falso no tiene forma de
    // recibir sync_conflicts porque pushAll() nunca la incluye en STORES).
    remote.seed([row('equipment', 'eq1', { code: 'BASE' }, T0)]);
    await SyncA.pullAll();
    await SyncB.pullAll();
    const localA = await dbA.get('equipment', 'eq1');
    localA.code = 'A-CHANGE'; localA.updatedAt = T1;
    await dbA.put('equipment', localA);
    const localB = await dbB.get('equipment', 'eq1');
    localB.code = 'B-CHANGE'; localB.updatedAt = T2;
    await dbB.put('equipment', localB);
    await SyncB.pushAll();
    await SyncA.pushAll(); // genera conflicto en A

    expect(await dbA.getSyncConflicts()).toHaveLength(1);
    await SyncB.pullAll(); // B sincroniza de nuevo
    expect(await dbB.getSyncConflicts()).toHaveLength(0); // nunca le llegó nada de A
    // Y el remoto falso (que representa TODO lo que viaja por la red) no
    // tiene ninguna fila de ningún store parecido a "conflict"/"config".
    expect(remote.rows.some(r => /conflict|app_config/i.test(r.store))).toBe(false);
  });
});
