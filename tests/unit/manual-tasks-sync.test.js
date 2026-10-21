// tests/unit/manual-tasks-sync.test.js
//
// MANUAL_TASKS_UI (2026-10-18) — round-trip REAL de Sync.pullAll()/pushAll()
// (nunca reimplementado) contra un "remoto" en memoria con la MISMA forma
// de engrase_sync (store/id/payload/updated_at/deleted) y el MISMO
// comportamiento de CAS optimista (PATCH condicionado a `updated_at=eq.
// <esperado>`) que producción — mismo patrón que
// tests/unit/sync-pull-push.test.js, extendido acá con el endpoint de
// Storage (fotos) porque manual_tasks sí las ejercita.
//
// Objetivo: probar, con el CÓDIGO REAL de sync.js (no una simulación de
// payload), que una completación de LUBRICADOR (buildManualTaskCompletionRow,
// db.js) efectivamente produce el payload exacto que
// authorization_private.manual_task_row_in_scope (0017, ACTIVE en
// producción) exige — byte-idéntico fuera del allowlist de cierre,
// incluyendo `updatedAt` embebido (que esa función NO perdona) — sin tocar
// producción, confirmando el fix de stripLocalAuthorizationMetadata().
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadSyncLogic, loadDbLogic } from '../helpers/loadLubricationLogic.js';

const { buildManualTaskCompletionRow } = loadDbLogic();
const STORES_TEST = ['manual_tasks'];
const PHOTO_BUCKET = 'engrase-photos';
// PNG 1x1 real (válido para atob/Blob) — mismo fixture que otros tests de fotos del proyecto.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function makeFakeDB() {
  const stores = {};
  let config = null;
  return {
    async getConfig() { return config; },
    async setConfig(v) { config = v; return v; },
    async get(store, id) { const m = stores[store]; return m && m.has(id) ? m.get(id) : null; },
    async put(store, obj) { if (!stores[store]) stores[store] = new Map(); stores[store].set(obj.id, obj); return obj; },
    async all(store) { return stores[store] ? Array.from(stores[store].values()) : []; },
    _stores: stores,
  };
}

// Mismo fake remoto que sync-pull-push.test.js (CAS optimista real), más el
// endpoint de Storage que manual_tasks SÍ necesita (anomalies/grease_validations
// lo prueban vía RPC en evidence-gateway.spec.js — manual_tasks va por el
// pipeline GENÉRICO de pushAll(), nunca por ese camino, ver 0017 cabecera).
function makeFakeRemote() {
  let rows = [];
  const storageUploads = [];
  const post = vi.fn();
  const patch = vi.fn();
  async function handleFetch(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    if (u.pathname.includes(`/storage/v1/object/${PHOTO_BUCKET}/`)) {
      storageUploads.push(url);
      return { ok: true, status: 200, json: async () => ({}) };
    }
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
    throw new Error(`método no soportado en el remoto falso: ${method}`);
  }
  return { get rows() { return rows; }, seed(list) { rows = rows.concat(list); }, handleFetch, postCalls: post, patchCalls: patch, storageUploads };
}

let fakeDB, remote, Sync, networkDown;

beforeEach(async () => {
  fakeDB = makeFakeDB();
  remote = makeFakeRemote();
  networkDown = false;
  vi.stubGlobal('fetch', (url, init) => {
    if (networkDown) return Promise.reject(new TypeError('Failed to fetch'));
    return remote.handleFetch(url, init);
  });
  await fakeDB.setConfig({ url: 'https://fake.test', anonKey: 'anon-test' });
  ({ Sync } = loadSyncLogic(fakeDB, STORES_TEST));
});

afterEach(() => { vi.unstubAllGlobals(); });

const BASE_TASK_PAYLOAD = { equipmentId: 'e1', crewId: 'cq1', createdBy: 'u-admin', title: null,
  description: 'Revisar punto trasero', taskType: 'ENGRASE', priority: 'ALTA', dueAt: null, status: 'PENDING' };

function seedCreatedTask(version = '2026-10-18T08:00:00.000Z') {
  remote.seed([{ store: 'manual_tasks', id: 'mtask1', payload: { id: 'mtask1', ...BASE_TASK_PAYLOAD, createdAt: version, updatedAt: version }, updated_at: version, deleted: false }]);
}

describe('A) completar sin foto — PATCH real con payload compatible con manual_task_row_in_scope (0017)', () => {
  it('1. el PATCH llega con el embedded updatedAt CONGELADO (igual al remoto previo, nunca el bumpeado)', async () => {
    seedCreatedTask();
    await Sync.pullAll();
    const local = await fakeDB.get('manual_tasks', 'mtask1');
    expect(local._pushedVersion).toBe('2026-10-18T08:00:00.000Z');

    const completion = buildManualTaskCompletionRow(local, { completedBy: 'u-lub1', completionComment: 'Listo', photos: [] });
    await fakeDB.put('manual_tasks', completion);
    const pushRes = await Sync.pushAll();

    expect(pushRes.pushed).toBe(1);
    expect(remote.patchCalls).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(remote.patchCalls.mock.calls[0][1].body);
    expect(sentBody.payload.updatedAt).toBe('2026-10-18T08:00:00.000Z'); // congelado, NO el bumpeado
    expect(sentBody.payload).not.toHaveProperty('_pushedVersion');
    expect(sentBody.payload).not.toHaveProperty('__freezeEmbeddedUpdatedAt');
    expect(sentBody.payload.status).toBe('COMPLETED');
    // Byte-idéntico fuera del allowlist de cierre (lo que exige 0017 de verdad).
    const allowlist = ['status', 'completedBy', 'completedAt', 'completionComment', 'photos', 'photo', 'photoUploaded', 'updatedAt'];
    for (const key of Object.keys(BASE_TASK_PAYLOAD)) {
      if (allowlist.includes(key)) continue;
      expect(sentBody.payload[key]).toEqual(BASE_TASK_PAYLOAD[key]);
    }
  });

  it('2. la fila remota queda COMPLETED tras el push (confirmación real, no simulada)', async () => {
    seedCreatedTask();
    await Sync.pullAll();
    const local = await fakeDB.get('manual_tasks', 'mtask1');
    await fakeDB.put('manual_tasks', buildManualTaskCompletionRow(local, { completedBy: 'u-lub1', completionComment: '', photos: [] }));
    await Sync.pushAll();
    const remoteRow = remote.rows.find(r => r.id === 'mtask1');
    expect(remoteRow.payload.status).toBe('COMPLETED');
    expect(remoteRow.payload.completedBy).toBe('u-lub1');
  });

  it('3. la columna top-level updated_at SÍ avanza (CAS real) — solo el embebido queda congelado', async () => {
    seedCreatedTask();
    await Sync.pullAll();
    const local = await fakeDB.get('manual_tasks', 'mtask1');
    await fakeDB.put('manual_tasks', buildManualTaskCompletionRow(local, { completedBy: 'u-lub1', completionComment: '', photos: [] }));
    await Sync.pushAll();
    const remoteRow = remote.rows.find(r => r.id === 'mtask1');
    expect(remoteRow.updated_at).not.toBe('2026-10-18T08:00:00.000Z');
    expect(remoteRow.updated_at).toBe((await fakeDB.get('manual_tasks', 'mtask1'))._pushedVersion);
  });
});

describe('B) completar CON foto — upload real a Storage, local conserva base64', () => {
  it('4. sube la foto a engrase-photos/manual_tasks/... y el payload remoto trae la URL, nunca base64', async () => {
    seedCreatedTask();
    await Sync.pullAll();
    const local = await fakeDB.get('manual_tasks', 'mtask1');
    await fakeDB.put('manual_tasks', buildManualTaskCompletionRow(local, { completedBy: 'u-lub1', completionComment: 'Listo', photos: [TINY_PNG] }));
    await Sync.pushAll();

    expect(remote.storageUploads).toHaveLength(1);
    expect(remote.storageUploads[0]).toContain('manual_tasks/mtask1_0');
    const remoteRow = remote.rows.find(r => r.id === 'mtask1');
    expect(remoteRow.payload.photos[0]).toMatch(/^https:\/\/fake\.test\/storage\/v1\/object\/public\/engrase-photos\/manual_tasks\//);
    // Local conserva la base64 completa para verla offline (mismo criterio que anomalies).
    const localAfter = await fakeDB.get('manual_tasks', 'mtask1');
    expect(localAfter.photos[0]).toBe(TINY_PNG);
  });
});

describe('C) offline / reconexión / no-duplicado', () => {
  it('5. completar offline deja la fila dirty localmente; push falla sin tocar el servidor', async () => {
    seedCreatedTask();
    await Sync.pullAll();
    const local = await fakeDB.get('manual_tasks', 'mtask1');
    await fakeDB.put('manual_tasks', buildManualTaskCompletionRow(local, { completedBy: 'u-lub1', completionComment: 'Listo', photos: [] }));

    networkDown = true;
    const offlinePush = await Sync.pushAll();
    networkDown = false;
    expect(offlinePush.ok).toBe(false);
    expect(offlinePush.pushed).toBe(0);

    expect(remote.rows.find(r => r.id === 'mtask1').payload.status).toBe('PENDING'); // el servidor nunca se tocó
    const localStill = await fakeDB.get('manual_tasks', 'mtask1');
    expect(localStill.status).toBe('COMPLETED'); // el cambio local sobrevive, durable
  });

  it('6. al reconectar, el mismo pushAll() sincroniza sin duplicar ni perder la completación', async () => {
    seedCreatedTask();
    await Sync.pullAll();
    const local = await fakeDB.get('manual_tasks', 'mtask1');
    await fakeDB.put('manual_tasks', buildManualTaskCompletionRow(local, { completedBy: 'u-lub1', completionComment: 'Listo', photos: [] }));

    networkDown = true;
    const offlinePush = await Sync.pushAll();
    expect(offlinePush.pushed).toBe(0);
    networkDown = false;

    const pushRes = await Sync.pushAll();
    expect(pushRes.pushed).toBe(1);
    expect(remote.rows.filter(r => r.id === 'mtask1')).toHaveLength(1); // nunca una 2da fila
    expect(remote.patchCalls).toHaveBeenCalledTimes(1); // el intento offline nunca llegó a la red
  });

  it('7. un pushAll() extra después de sincronizar no reintenta (fila ya no dirty, nunca duplica)', async () => {
    seedCreatedTask();
    await Sync.pullAll();
    const local = await fakeDB.get('manual_tasks', 'mtask1');
    await fakeDB.put('manual_tasks', buildManualTaskCompletionRow(local, { completedBy: 'u-lub1', completionComment: '', photos: [] }));
    await Sync.pushAll();
    remote.patchCalls.mockClear();

    const pushRes2 = await Sync.pushAll();
    expect(pushRes2.pushed).toBe(0);
    expect(remote.patchCalls).not.toHaveBeenCalled();
  });
});
