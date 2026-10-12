// tests/unit/storage-privacy.test.js
//
// P0-3 — preparación de Storage privado/autenticado (ver
// docs/STORAGE_PRIVACY_DESIGN.md). El bucket `engrase-photos` SIGUE público
// en producción — este archivo prueba el código nuevo que hace falta para
// cuando deje de estarlo (resolvePhotoStoragePath/getSignedPhotoUrl,
// headers de Storage con el JWT real), contra el código REAL de sync.js
// (nunca reimplementado), con fetch/DB/Auth fake en memoria — sin red, sin
// producción.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadSyncLogic } from '../helpers/loadLubricationLogic.js';

const CFG = { url: 'https://fake.supabase.co', anonKey: 'anon-test' };

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

function makeFakeAuth({ mode = 'legacy', authenticated = true, accessToken = 'FAKE-USER-JWT' } = {}) {
  return {
    getMode() { return mode; },
    isSupabaseMode() { return mode === 'supabase'; },
    isAuthenticated() { return authenticated; },
    getSession() { return { accessToken }; },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolvePhotoStoragePath() — compatibilidad con URLs públicas YA guardadas (I: legacy sigue soportada)', () => {
  it('extrae el path desde una URL pública completa del bucket (formato que TODO registro sincronizado usa hoy)', () => {
    const { resolvePhotoStoragePath, PHOTO_BUCKET } = loadSyncLogic(makeFakeDB(), []);
    const url = `${CFG.url}/storage/v1/object/public/${PHOTO_BUCKET}/lubrication_records/rec_1_0.jpg`;
    expect(resolvePhotoStoragePath(url)).toBe('lubrication_records/rec_1_0.jpg');
  });

  it('acepta un path suelto tal cual (formato futuro, si algún día se decide escribirlo así)', () => {
    const { resolvePhotoStoragePath } = loadSyncLogic(makeFakeDB(), []);
    expect(resolvePhotoStoragePath('anomalies/an_1_0.jpg')).toBe('anomalies/an_1_0.jpg');
  });

  it('devuelve null para base64 (foto local todavía sin subir)', () => {
    const { resolvePhotoStoragePath } = loadSyncLogic(makeFakeDB(), []);
    expect(resolvePhotoStoragePath('data:image/jpeg;base64,AAAA')).toBeNull();
  });

  it('devuelve null para null/undefined/string vacío', () => {
    const { resolvePhotoStoragePath } = loadSyncLogic(makeFakeDB(), []);
    expect(resolvePhotoStoragePath(null)).toBeNull();
    expect(resolvePhotoStoragePath(undefined)).toBeNull();
    expect(resolvePhotoStoragePath('')).toBeNull();
  });

  it('devuelve null para una URL absoluta que no es de nuestro bucket público conocido (ej. ya es un signed URL)', () => {
    const { resolvePhotoStoragePath } = loadSyncLogic(makeFakeDB(), []);
    expect(resolvePhotoStoragePath('https://otro.example/foo.jpg')).toBeNull();
  });
});

describe('Sync.getSignedPhotoUrl() — URL firmada TEMPORAL para ver evidencia que este dispositivo no tiene en local', () => {
  it('construye la URL firmada completa a partir del path resuelto, usando el JWT real en modo supabase (D: lectura permitida con Auth válido)', async () => {
    const fakeAuth = makeFakeAuth({ mode: 'supabase', authenticated: true, accessToken: 'REAL-USER-JWT-XYZ' });
    const { Sync, PHOTO_BUCKET } = loadSyncLogic(makeFakeDB(), [], fakeAuth);
    let seenUrl = null, seenHeaders = null, seenBody = null;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      seenUrl = url; seenHeaders = opts.headers; seenBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ signedURL: `/object/sign/${PHOTO_BUCKET}/anomalies/an_1_0.jpg?token=abc123` }) };
    }));
    const legacyUrl = `${CFG.url}/storage/v1/object/public/${PHOTO_BUCKET}/anomalies/an_1_0.jpg`;
    const signed = await Sync.getSignedPhotoUrl(legacyUrl, CFG);

    expect(seenUrl).toBe(`${CFG.url}/storage/v1/object/sign/${PHOTO_BUCKET}/anomalies/an_1_0.jpg`);
    expect(seenHeaders.Authorization).toBe('Bearer REAL-USER-JWT-XYZ'); // NUNCA el anon key
    expect(seenHeaders.apikey).toBe(CFG.anonKey);
    expect(seenBody).toEqual({ expiresIn: 3600 });
    expect(signed).toBe(`${CFG.url}/storage/v1/object/sign/${PHOTO_BUCKET}/anomalies/an_1_0.jpg?token=abc123`);
  });

  it('en modo legacy no solicita URLs firmadas sin Auth Supabase', async () => {
    const { Sync, PHOTO_BUCKET } = loadSyncLogic(makeFakeDB(), [], makeFakeAuth({ mode: 'legacy' }));
    let seenHeaders = null;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      seenHeaders = opts.headers;
      return { ok: true, json: async () => ({ signedURL: '/object/sign/x/y?token=z' }) };
    }));
    await Sync.getSignedPhotoUrl(`${CFG.url}/storage/v1/object/public/${PHOTO_BUCKET}/x/y`, CFG);
    expect(seenHeaders).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  describe('cache EN MEMORIA (§39 docs/STORAGE_PRIVACY_DESIGN.md)', () => {
    it('dentro de la ventana de vigencia: la segunda llamada para el mismo path NO pide otra al servidor', async () => {
      const { Sync, PHOTO_BUCKET } = loadSyncLogic(makeFakeDB(), []);
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ signedURL: '/object/sign/x/y.jpg?token=first' }) }));
      vi.stubGlobal('fetch', fetchMock);
      const url = `${CFG.url}/storage/v1/object/public/${PHOTO_BUCKET}/x/y.jpg`;

      const first = await Sync.getSignedPhotoUrl(url, CFG);
      const second = await Sync.getSignedPhotoUrl(url, CFG);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });

    it('`force: true` (reintento tras fallo, ver app.js resolveEvidenceSrc) ignora el cache y pide una URL nueva', async () => {
      const { Sync, PHOTO_BUCKET } = loadSyncLogic(makeFakeDB(), []);
      let n = 0;
      vi.stubGlobal('fetch', vi.fn(async () => { n++; return { ok: true, json: async () => ({ signedURL: `/object/sign/x/y.jpg?token=v${n}` }) }; }));
      const url = `${CFG.url}/storage/v1/object/public/${PHOTO_BUCKET}/x/y.jpg`;

      const first = await Sync.getSignedPhotoUrl(url, CFG);
      const forced = await Sync.getSignedPhotoUrl(url, CFG, { force: true });

      expect(first).toContain('token=v1');
      expect(forced).toContain('token=v2');
    });

    it('paths distintos nunca comparten entrada de cache', async () => {
      const { Sync, PHOTO_BUCKET } = loadSyncLogic(makeFakeDB(), []);
      const fetchMock = vi.fn(async (url) => ({ ok: true, json: async () => ({ signedURL: url.endsWith('/1.jpg') ? '/object/sign/x/1.jpg?token=uno' : '/object/sign/x/2.jpg?token=dos' }) }));
      vi.stubGlobal('fetch', fetchMock);

      const a = await Sync.getSignedPhotoUrl(`${CFG.url}/storage/v1/object/public/${PHOTO_BUCKET}/x/1.jpg`, CFG);
      const b = await Sync.getSignedPhotoUrl(`${CFG.url}/storage/v1/object/public/${PHOTO_BUCKET}/x/2.jpg`, CFG);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(a).not.toBe(b);
    });
  });

  it('C) sin sesión válida en AUTH_MODE=supabase: null, CERO requests de red (nunca fallback anon)', async () => {
    const fakeAuth = makeFakeAuth({ mode: 'supabase', authenticated: false });
    const { Sync, PHOTO_BUCKET } = loadSyncLogic(makeFakeDB(), [], fakeAuth);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await Sync.getSignedPhotoUrl(`${CFG.url}/storage/v1/object/public/${PHOTO_BUCKET}/x/y.jpg`, CFG);
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('E) offline/base64: null sin ningún fetch (la foto local se muestra directo, sin pedir nada a la red)', async () => {
    const { Sync } = loadSyncLogic(makeFakeDB(), []);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await Sync.getSignedPhotoUrl('data:image/jpeg;base64,AAAA', CFG);
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin configuración (cfg vacío): null, sin fetch', async () => {
    const { Sync, PHOTO_BUCKET } = loadSyncLogic(makeFakeDB(), []);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await Sync.getSignedPhotoUrl(`x/${PHOTO_BUCKET}/y.jpg`, null);
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('si la request de firmado falla (!resp.ok): null, nunca lanza — quien llama cae de vuelta al valor original', async () => {
    const { Sync, PHOTO_BUCKET } = loadSyncLogic(makeFakeDB(), []);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })));
    const result = await Sync.getSignedPhotoUrl(`${CFG.url}/storage/v1/object/public/${PHOTO_BUCKET}/x/y.jpg`, CFG);
    expect(result).toBeNull();
  });

  it('si fetch rechaza (sin internet): null, nunca lanza', async () => {
    const { Sync, PHOTO_BUCKET } = loadSyncLogic(makeFakeDB(), []);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const result = await Sync.getSignedPhotoUrl(`${CFG.url}/storage/v1/object/public/${PHOTO_BUCKET}/x/y.jpg`, CFG);
    expect(result).toBeNull();
  });

  it('B) el signed URL nunca se persiste — es responsabilidad de quien llama, getSignedPhotoUrl no toca DB.put', async () => {
    const db = makeFakeDB({ anomalies: [{ id: 'an1', photo: 'placeholder' }] });
    const putSpy = vi.spyOn(db, 'put');
    const { Sync, PHOTO_BUCKET } = loadSyncLogic(db, []);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ signedURL: '/object/sign/x/y?token=z' }) })));
    await Sync.getSignedPhotoUrl(`${CFG.url}/storage/v1/object/public/${PHOTO_BUCKET}/x/y.jpg`, CFG);
    expect(putSpy).not.toHaveBeenCalled();
  });
});

describe('Uploads de Storage (fotos/firmas) usan el JWT real en modo supabase — mismo criterio que engrase_sync (P0-2)', () => {
  it('uploadPhotoIfNeeded: legacy no sube evidencia sin Auth Supabase', async () => {
    const db = makeFakeDB({ anomalies: [] });
    const { Sync } = loadSyncLogic(db, ['anomalies'], makeFakeAuth({ mode: 'legacy' }));
    let seenHeaders = null;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => { seenHeaders = opts.headers; return { ok: true }; }));
    const row = { id: 'an1', photo: 'data:image/jpeg;base64,AAAA' };
    await Sync.uploadPhotoIfNeeded('anomalies', row, CFG);
    expect(seenHeaders).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uploadPhotoIfNeeded: modo supabase autenticado usa el JWT de la persona, nunca el anon key', async () => {
    const db = makeFakeDB({ anomalies: [] });
    const fakeAuth = makeFakeAuth({ mode: 'supabase', authenticated: true, accessToken: 'REAL-USER-JWT-XYZ' });
    const { Sync } = loadSyncLogic(db, ['anomalies'], fakeAuth);
    let seenHeaders = null;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => { seenHeaders = opts.headers; return { ok: true }; }));
    const row = { id: 'an1', photo: 'data:image/jpeg;base64,AAAA' };
    await Sync.uploadPhotoIfNeeded('anomalies', row, CFG);
    expect(seenHeaders.Authorization).toBe('Bearer REAL-USER-JWT-XYZ');
    expect(seenHeaders.apikey).toBe(CFG.anonKey);
  });

  it('uploadSignatureIfNeeded: modo supabase autenticado usa el JWT de la persona, nunca el anon key', async () => {
    const db = makeFakeDB({ grease_validations: [] });
    const fakeAuth = makeFakeAuth({ mode: 'supabase', authenticated: true, accessToken: 'REAL-USER-JWT-XYZ' });
    const { Sync } = loadSyncLogic(db, ['grease_validations'], fakeAuth);
    let seenHeaders = null;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => { seenHeaders = opts.headers; return { ok: true }; }));
    const row = { id: 'val1', signatureLocal: 'data:image/png;base64,AAAA' };
    await Sync.uploadSignatureIfNeeded('grease_validations', row, CFG);
    expect(seenHeaders.Authorization).toBe('Bearer REAL-USER-JWT-XYZ');
  });

  it('A/J) el resultado subido nunca lleva un token de signed URL — solo la URL pública estable (storagePath derivable en cualquier momento con resolvePhotoStoragePath)', async () => {
    const db = makeFakeDB({ anomalies: [] });
    const { Sync, PHOTO_BUCKET, resolvePhotoStoragePath } = loadSyncLogic(db, ['anomalies']);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
    const row = { id: 'an1', photo: 'data:image/jpeg;base64,AAAA' };
    const result = await Sync.uploadPhotoIfNeeded('anomalies', row, CFG);

    expect(result.photo).not.toContain('token=');
    expect(result.photo).toBe(`${CFG.url}/storage/v1/object/public/${PHOTO_BUCKET}/anomalies/an1_0.jpg`);
    // El storagePath sigue siendo derivable de inmediato desde lo que se subió —
    // no hace falta esperar ningún signed URL para saber a qué objeto corresponde.
    expect(resolvePhotoStoragePath(result.photo)).toBe('anomalies/an1_0.jpg');

    const stored = await db.get('anomalies', 'an1');
    expect(JSON.stringify(stored)).not.toContain('token=');
  });

  it.each(['anomalies', 'lubrication_records'])('F) %s: retry uploads identical image bytes, without stamping again', async (store) => {
    const db = makeFakeDB({ [store]: [{ id: 'an1', photo: 'data:image/jpeg;base64,AAAA', photoUploaded: undefined }] });
    const { Sync } = loadSyncLogic(db, [store]);
    const bodies = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      bodies.push([...new Uint8Array(await options.body.arrayBuffer())]);
      return { ok: false, status: 500 };
    }));
    const row1 = await db.get(store, 'an1');
    const attempt1 = await Sync.uploadPhotoIfNeeded(store, row1, CFG);
    expect(attempt1.photo).toBe('data:image/jpeg;base64,AAAA'); // sigue en base64, se reintentará

    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      bodies.push([...new Uint8Array(await options.body.arrayBuffer())]);
      return { ok: true };
    }));
    const row2 = await db.get(store, 'an1'); // sin marca de subida, sigue pendiente
    const attempt2 = await Sync.uploadPhotoIfNeeded(store, row2, CFG);
    expect(attempt2.photo).toContain('/storage/v1/object/public/');
    expect(bodies).toEqual([[0, 0, 0], [0, 0, 0]]);
    const local = await db.get(store, 'an1');
    expect(local.photo).toBe('data:image/jpeg;base64,AAAA');
    await Sync.uploadPhotoIfNeeded(store, local, CFG);
    expect(bodies).toEqual([[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  });
});
