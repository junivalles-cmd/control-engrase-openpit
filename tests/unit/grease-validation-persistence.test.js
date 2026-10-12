// tests/unit/grease-validation-persistence.test.js
//
// Persistencia REAL de grease_validations — contra el código REAL de
// db.js (STORES/DB_VERSION) y sync.js (Sync.uploadSignatureIfNeeded/
// pushAll/pullAll), con IndexedDB/Supabase reemplazados por un DB y un
// fetch fake en memoria (sin red, sin datos reales). Ver
// docs/GREASE_VALIDATION_AUDIT.md para el modelo y la justificación de la
// entidad separada.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readSource } from '../helpers/extractFromSource.js';
import { loadSyncLogic, DB_JS_PATH } from '../helpers/loadLubricationLogic.js';

const dbSource = readSource(DB_JS_PATH);

describe('db.js — store grease_validations registrado correctamente', () => {
  it('DB_VERSION es 6 o superior (necesario para que onupgradeneeded haya creado el store nuevo)', () => {
    const m = dbSource.match(/const DB_VERSION = (\d+);/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(6);
  });

  it('STORES incluye "grease_validations" (participa en push/pull genérico, igual que el resto)', () => {
    expect(dbSource).toMatch(/const STORES = \[[\s\S]*?'grease_validations'[\s\S]*?\];/);
  });

  it('grease_validations NO está en LOCAL_STORES (debe sincronizar, no quedarse solo en el dispositivo)', () => {
    const localStoresMatch = dbSource.match(/const LOCAL_STORES = \[([^\]]*)\];/);
    expect(localStoresMatch[1]).not.toContain('grease_validations');
  });
});

// ---- DB fake en memoria (sin IndexedDB real) ----
function makeFakeDB(seed = {}) {
  const data = {};
  for (const [store, rows] of Object.entries(seed)) data[store] = [...rows];
  return {
    _data: data,
    async all(store) { return data[store] ? [...data[store]] : []; },
    async allActive(store) { return (data[store] || []).filter(r => r.active !== false); },
    async get(store, id) { return (data[store] || []).find(r => r.id === id) || null; },
    async put(store, obj) {
      data[store] = data[store] || [];
      const i = data[store].findIndex(r => r.id === obj.id);
      if (i >= 0) data[store][i] = obj; else data[store].push(obj);
      return obj;
    },
  };
}

const CFG = { url: 'https://fake.supabase.co', anonKey: 'anon-key' };

describe('Sync.uploadSignatureIfNeeded() — firma local (base64) → Storage → URL, mismo mecanismo que las fotos', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn(async (url) => {
      if (String(url).includes('/storage/v1/object/')) return { ok: true };
      throw new Error('unexpected fetch: ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('sube la firma al bucket existente (mismo PHOTO_BUCKET), bajo el prefijo natural "<store>/<id>"', async () => {
    const db = makeFakeDB({ grease_validations: [] });
    const { Sync, PHOTO_BUCKET } = loadSyncLogic(db, ['grease_validations']);
    const row = { id: 'val_1', signatureLocal: 'data:image/png;base64,AAAA' };

    const result = await Sync.uploadSignatureIfNeeded('grease_validations', row, CFG);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain(`/storage/v1/object/${PHOTO_BUCKET}/grease_validations/val_1.png`);
    expect(result.signatureUrl).toBe(`${CFG.url}/storage/v1/object/public/${PHOTO_BUCKET}/grease_validations/val_1.png`);
  });

  it('la copia para el servidor NO lleva el base64 (evita duplicar el peso en el payload jsonb)', async () => {
    const db = makeFakeDB({ grease_validations: [] });
    const { Sync } = loadSyncLogic(db, ['grease_validations']);
    const row = { id: 'val_1', signatureLocal: 'data:image/png;base64,AAAA' };

    const result = await Sync.uploadSignatureIfNeeded('grease_validations', row, CFG);
    expect(result.signatureLocal).toBeNull();
  });

  it('el registro LOCAL conserva la firma completa — solo se marca signatureUploaded (offline sigue funcionando)', async () => {
    const db = makeFakeDB({ grease_validations: [{ id: 'val_1', signatureLocal: 'data:image/png;base64,AAAA' }] });
    const { Sync } = loadSyncLogic(db, ['grease_validations']);
    const row = (await db.all('grease_validations'))[0];

    await Sync.uploadSignatureIfNeeded('grease_validations', row, CFG);

    const stored = await db.get('grease_validations', 'val_1');
    expect(stored.signatureLocal).toBe('data:image/png;base64,AAAA'); // NUNCA se borra localmente
    expect(stored.signatureUploaded).toBe(true);
  });

  it('sin signatureLocal (ya subida o inexistente) no hace ningún fetch — evita reintentos infinitos', async () => {
    const db = makeFakeDB({});
    const { Sync } = loadSyncLogic(db, ['grease_validations']);
    const row = { id: 'val_1', signatureLocal: null, signatureUrl: 'https://ya-subida.example/x.png' };

    const result = await Sync.uploadSignatureIfNeeded('grease_validations', row, CFG);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toBe(row);
  });

  it('si Storage responde con error, conserva el base64 local para reintentar en la próxima sincronización', async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 500 }));
    const db = makeFakeDB({});
    const { Sync } = loadSyncLogic(db, ['grease_validations']);
    const row = { id: 'val_1', signatureLocal: 'data:image/png;base64,AAAA' };

    const result = await Sync.uploadSignatureIfNeeded('grease_validations', row, CFG);
    expect(result.signatureLocal).toBe('data:image/png;base64,AAAA');
    expect(result.signatureUrl).toBeUndefined();
  });
});

describe('Sync.pushAll() - restricted evidence transport', () => {
  for (const active of [true, false]) it('quarantines unmarked legacy evidence, active=' + active, async () => {
    const validation = { id: 'val_1', active, updatedAt: 'local', signatureLocal: 'data:image/png;base64,AAAA' };
    const db = makeFakeDB({ grease_validations: [validation] }); db.getConfig = async () => CFG;
    const { Sync } = loadSyncLogic(db, ['grease_validations']);
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const result = await Sync.pushAll();
    expect(result.ok).toBe(false); expect(result.errors).toContain('EVIDENCE_LEGACY_REVIEW_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled(); expect(await db.get('grease_validations','val_1')).toEqual(validation);
  });
  it('never marks an unacknowledged signature as pushed', async () => {
    const validation = { id:'val_1', updatedAt:'local', _evidenceOperationId:'v1' };
    const db = makeFakeDB({ grease_validations:[validation] }); db.getConfig=async()=>CFG;
    const { Sync }=loadSyncLogic(db,['grease_validations']); const fetchMock=vi.fn(); vi.stubGlobal('fetch',fetchMock);
    await Sync.pushAll();expect(fetchMock).not.toHaveBeenCalled();
    expect((await db.get('grease_validations','val_1'))._pushedVersion).toBeUndefined();
  });
});

describe('Sync.pullAll() — NUNCA pierde la firma local por el eco del propio push', () => {
  it('si el dispositivo ya tiene signatureLocal real, lo conserva aunque el servidor devuelva signatureLocal:null', async () => {
    const existing = {
      id: 'val_1', lubricationRecordId: 'greg_1', equipmentId: 'e1', signerRole: 'OPERADOR',
      signatureLocal: 'data:image/png;base64,AAAA', signatureUrl: null,
      createdAt: '2026-09-25T10:00:00.000Z', updatedAt: '2026-09-25T10:00:00.000Z', active: true,
      _pushedVersion: '2026-09-25T10:00:00.000Z',
    };
    const db = makeFakeDB({ grease_validations: [existing] });
    db.getConfig = async () => CFG;
    db.setConfig = async (v) => { db._cfg = v; };
    const { Sync } = loadSyncLogic(db, ['grease_validations']);

    // El servidor devuelve el eco del propio push: signatureLocal:null + signatureUrl con link.
    const remoteRow = {
      store: 'grease_validations', id: 'val_1',
      payload: { ...existing, signatureLocal: null, signatureUrl: 'https://fake.supabase.co/storage/v1/object/public/engrase-photos/grease_validations/val_1.png' },
      updated_at: '2026-09-25T10:00:00.000Z', deleted: false,
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [remoteRow] })));

    await Sync.pullAll();
    const stored = await db.get('grease_validations', 'val_1');
    expect(stored.signatureLocal).toBe('data:image/png;base64,AAAA'); // NO se perdió
    expect(stored.signatureUrl).toContain('grease_validations/val_1.png'); // sí toma el link nuevo
  });
});
