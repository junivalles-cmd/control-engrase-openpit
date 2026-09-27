// tests/unit/sync-pull-push.test.js
//
// Corrige 2 bugs reales encontrados en producción (ver auditoría de la guía de
// modelos): 1) pullAll() no marcaba las filas recién bajadas como "ya
// sincronizadas", así que pushAll() las volvía a subir de inmediato al servidor
// (pull -> push involuntario); 2) pullAll() no paginaba, y Supabase/PostgREST
// limita cada respuesta a ~1000 filas sin importar el "limit" pedido, así que
// un historial más grande quedaba truncado en silencio.
//
// Todo esto se prueba contra un DB y un "remoto" 100% en memoria — NUNCA contra
// producción (ver instrucción explícita del usuario: "Sin tocar producción para
// estos tests").

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadSyncLogic } from '../helpers/loadLubricationLogic.js';

const STORES_TEST = ['shifts', 'lubrication_points', 'grease_validations', 'lubrication_records', 'equipment'];

function makeFakeDB() {
  const stores = {};
  let config = null;
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
    _stores: stores
  };
}

// "Servidor" en memoria: misma forma que la tabla real engrase_sync
// (store, id, payload, updated_at, deleted), y el mismo comportamiento de
// paginación (tope duro de PAGE_SIZE filas por página, como Supabase real).
//
// P0-1 (endurecimiento CAS): pushAll() ya NO hace GET+POST — hace UNA
// operación atómica por fila. Este fake modela las 2 formas reales que usa:
//   - POST .../engrase_sync?on_conflict=store,id con
//     Prefer: resolution=ignore-duplicates,return=representation -> INSERT
//     protegido por la PK real (store,id): filas nuevas se insertan y se
//     devuelven, una fila cuyo id YA existe se omite de la respuesta (nunca
//     la pisa).
//   - PATCH .../engrase_sync?store=eq.X&id=eq.Y&updated_at=eq.<base> con
//     Prefer: return=representation -> UPDATE condicionado: si el WHERE no
//     matchea (el updated_at remoto ya cambió), devuelve 0 filas.
function makeFakeRemote(pageSizeCap = 1000) {
  let rows = [];
  const sortKey = r => `${r.updated_at}|${r.store}|${r.id}`;
  const post = vi.fn();
  const patch = vi.fn();
  async function handleFetch(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      const storeEq = u.searchParams.get('store');
      const idEq = u.searchParams.get('id');
      if (storeEq && idEq && idEq.startsWith('eq.')) {
        // Diagnóstico puntual (fetchRemoteUpdatedAt) — nunca decide nada,
        // solo completa metadata de un conflicto ya detectado atómicamente.
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
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(page)) };
    }
    if (method === 'POST') {
      post(url, init);
      const body = JSON.parse(init.body);
      const inserted = [];
      body.forEach(item => {
        const exists = rows.some(r => r.store === item.store && r.id === item.id);
        if (exists) return; // ignore-duplicates: nunca pisa una fila que ya existe
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
      const idx = rows.findIndex(r => r.store === storeVal && r.id === idVal && r.updated_at === expected);
      if (idx === -1) return { ok: true, status: 200, json: async () => [] }; // CAS falló: 0 filas
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
    patchCalls: patch
  };
}

let fakeDB, remote, Sync;

beforeEach(async () => {
  fakeDB = makeFakeDB();
  remote = makeFakeRemote();
  vi.stubGlobal('fetch', (url, init) => remote.handleFetch(url, init));
  await fakeDB.setConfig({ url: 'https://fake.test', anonKey: 'anon-test' });
  ({ Sync } = loadSyncLogic(fakeDB, STORES_TEST));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function row(store, id, payload, updatedAt, deleted = false) {
  return { store, id, payload: { id, ...payload, updatedAt }, updated_at: updatedAt, deleted };
}

describe('A) pull trae una fila -> pushAll inmediato no la vuelve a subir', () => {
  it('0 pushes tras un pull limpio', async () => {
    remote.seed([row('shifts', 's1', { name: 'Turno Día' }, '2026-01-01T00:00:00.000Z')]);

    const pullRes = await Sync.pullAll();
    expect(pullRes.pulled).toBe(1);
    const local = await fakeDB.get('shifts', 's1');
    expect(local._pushedVersion).toBe('2026-01-01T00:00:00.000Z');

    const pushRes = await Sync.pushAll();
    expect(pushRes.pushed).toBe(0);
    expect(remote.postCalls).not.toHaveBeenCalled();
  });
});

describe('B) pull de 1500+ filas', () => {
  it('todas quedan locales, ninguna se pierde ni se duplica', async () => {
    const seedRows = [];
    for (let i = 0; i < 1500; i++) {
      const t = `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`;
      seedRows.push(row('lubrication_points', `pt${i}`, { point: `Punto ${i}` }, t));
    }
    remote.seed(seedRows);

    const pullRes = await Sync.pullAll();
    expect(pullRes.pulled).toBe(1500);
    const localPoints = await fakeDB.all('lubrication_points');
    expect(localPoints).toHaveLength(1500);
    expect(new Set(localPoints.map(p => p.id)).size).toBe(1500);
  });
});

describe('C) pull de 2500+ filas', () => {
  it('mismo resultado: sin pérdidas ni duplicados en 3 páginas', async () => {
    const seedRows = [];
    for (let i = 0; i < 2500; i++) {
      const t = `2026-01-02T${String(Math.floor(i / 3600)).padStart(2, '0')}:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`;
      seedRows.push(row('lubrication_points', `q${i}`, { point: `Punto ${i}` }, t));
    }
    remote.seed(seedRows);

    const pullRes = await Sync.pullAll();
    expect(pullRes.pulled).toBe(2500);
    const localPoints = await fakeDB.all('lubrication_points');
    expect(localPoints).toHaveLength(2500);
    expect(new Set(localPoints.map(p => p.id)).size).toBe(2500);
  });
});

describe('D) cambio local real después del pull', () => {
  it('pushAll sube exactamente 1 versión nueva', async () => {
    remote.seed([row('shifts', 's1', { name: 'Turno Día' }, '2026-01-01T00:00:00.000Z')]);
    await Sync.pullAll();

    const local = await fakeDB.get('shifts', 's1');
    local.name = 'Turno Día (editado)';
    local.updatedAt = '2026-01-02T00:00:00.000Z'; // simula stamp() al editar
    await fakeDB.put('shifts', local);

    const pushRes = await Sync.pushAll();
    expect(pushRes.pushed).toBe(1);
    // s1 ya tenía _pushedVersion (viene de un pull previo) -> UPDATE vía
    // PATCH condicionado, no POST (ese solo se usa para filas nunca antes
    // confirmadas por el servidor).
    expect(remote.patchCalls).toHaveBeenCalledTimes(1);
    expect(remote.postCalls).not.toHaveBeenCalled();
    const remoteRow = remote.rows.find(r => r.store === 'shifts' && r.id === 's1');
    expect(remoteRow.payload.name).toBe('Turno Día (editado)');

    const localAfter = await fakeDB.get('shifts', 's1');
    expect(localAfter._pushedVersion).toBe('2026-01-02T00:00:00.000Z');
  });
});

describe('E) registro local offline nuevo', () => {
  it('se sube correctamente aunque nunca haya pasado por un pull', async () => {
    await fakeDB.put('equipment', { id: 'eq_nuevo', code: 'X-01', brand: 'Test', model: 'Y', active: true, updatedAt: '2026-01-01T00:00:00.000Z' });

    const pushRes = await Sync.pushAll();
    expect(pushRes.pushed).toBe(1);
    const remoteRow = remote.rows.find(r => r.store === 'equipment' && r.id === 'eq_nuevo');
    expect(remoteRow).toBeTruthy();
    expect(remoteRow.deleted).toBe(false);
  });
});

describe('F) soft delete local', () => {
  it('se sube con deleted:true', async () => {
    remote.seed([row('equipment', 'eq1', { code: 'A-01', active: true }, '2026-01-01T00:00:00.000Z')]);
    await Sync.pullAll();

    const local = await fakeDB.get('equipment', 'eq1');
    local.active = false;
    local.updatedAt = '2026-01-02T00:00:00.000Z';
    await fakeDB.put('equipment', local);

    await Sync.pushAll();
    const remoteRow = remote.rows.find(r => r.store === 'equipment' && r.id === 'eq1');
    expect(remoteRow.deleted).toBe(true);
  });
});

describe('G) grease_validations con signatureLocal/signatureUrl', () => {
  it('conserva la firma local completa y no la vuelve a subir solo por haberla pulido', async () => {
    // El dispositivo ya tiene la firma completa (la creó aquí mismo y la subió antes).
    await fakeDB.put('grease_validations', {
      id: 'val1', signatureLocal: 'data:image/png;base64,AAAA', signatureUploaded: true,
      updatedAt: '2026-01-01T00:00:00.000Z', _pushedVersion: '2026-01-01T00:00:00.000Z'
    });
    // El servidor devuelve el eco de ese mismo push: ya sin base64, con la URL.
    remote.seed([row('grease_validations', 'val1', { signatureLocal: null, signatureUrl: 'https://fake.test/storage/val1.png' }, '2026-01-01T00:00:00.000Z')]);

    await Sync.pullAll();
    const local = await fakeDB.get('grease_validations', 'val1');
    expect(local.signatureLocal).toBe('data:image/png;base64,AAAA'); // preservada, no reemplazada por null
    expect(local._pushedVersion).toBe('2026-01-01T00:00:00.000Z');

    const pushRes = await Sync.pushAll();
    expect(pushRes.pushed).toBe(0);
    expect(remote.postCalls).not.toHaveBeenCalled();
  });
});

describe('H) fullSync completo (pull -> push) sin cambios locales', () => {
  it('0 escrituras remotas cuando no hay nada pendiente', async () => {
    // Mismo orden que fullSync() para sincronizaciones normales (no la primera vez):
    // pushAll() primero, pullAll() después — se ejercen directamente en vez de
    // fullSync() para no depender de globals de navegador (navigator/document) que
    // ese método también usa y que no existen en el entorno de pruebas (node).
    remote.seed([
      row('shifts', 's1', { name: 'Turno Día' }, '2026-01-01T00:00:00.000Z'),
      row('lubrication_records', 'r1', { equipmentId: 'eq1' }, '2026-01-01T00:00:01.000Z')
    ]);

    await Sync.pullAll();
    remote.postCalls.mockClear();

    const pushRes = await Sync.pushAll();
    const pullRes = await Sync.pullAll();

    expect(pushRes.pushed).toBe(0);
    expect(pullRes.pulled).toBe(0);
    expect(remote.postCalls).not.toHaveBeenCalled();
  });
});
