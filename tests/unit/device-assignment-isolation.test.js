// tests/unit/device-assignment-isolation.test.js
//
// §3 del cierre de lote operativo — garantía explícita de que
// getDeviceAssignment()/saveDeviceAssignment() (app.js) aíslan
// COMPLETAMENTE la cuadrilla de un dispositivo de la de cualquier otro,
// incluso después de sincronizar (push_tokens es una tabla COMPARTIDA — el
// aislamiento lo da que cada dispositivo SOLO lee/escribe la fila de SU
// PROPIO deviceId, nunca las demás). Contra el código REAL de app.js, con
// IndexedDB/localStorage reemplazados por fakes en memoria — sin red, sin
// dispositivos reales.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadDeviceIdentityLogic } from '../helpers/loadLubricationLogic.js';

function makeFakeDB(seed = {}) {
  const data = {};
  for (const [store, rows] of Object.entries(seed)) data[store] = [...rows];
  const puts = [];
  return {
    _data: data,
    _puts: puts,
    async get(store, id) { return (data[store] || []).find(r => r.id === id) || null; },
    async put(store, obj) {
      puts.push({ store, id: obj.id });
      data[store] = data[store] || [];
      const i = data[store].findIndex(r => r.id === obj.id);
      if (i >= 0) data[store][i] = obj; else data[store].push(obj);
      return obj;
    },
  };
}

// Simula localStorage por dispositivo: cada "dispositivo" en este test es
// simplemente un valor distinto guardado bajo 'engrase_device_id' — en la
// realidad cada teléfono tiene su PROPIO localStorage físico y nunca ve el
// de otro; aquí se simula cambiando el valor antes de cada llamada, que es
// justo lo que hace getDeviceId() puertas adentro (leer esa única clave).
function makeFakeLocalStorage() {
  let store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _asDevice(id) { store['engrase_device_id'] = id; },
  };
}

describe('Aislamiento de device assignment entre dispositivos (§3)', () => {
  let db, ls, fullSyncCalls, App;

  beforeEach(() => {
    db = makeFakeDB({ push_tokens: [] });
    ls = makeFakeLocalStorage();
    fullSyncCalls = 0;
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('window', { Capacitor: undefined });
    vi.stubGlobal('Sync', { fullSync: () => { fullSyncCalls++; } });
    App = { currentUser: { id: 'u1', name: 'Junior Valles' } };
  });

  it('dispositivo A guarda su cuadrilla sin crear ninguna fila para B', async () => {
    const { getDeviceAssignment, saveDeviceAssignment } = loadDeviceIdentityLogic(db, App);
    ls._asDevice('dev_A');
    await saveDeviceAssignment({ cuadrillaId: 'crew_mojon', nombre: 'Teléfono Mojón' });

    expect(db._data.push_tokens).toHaveLength(1);
    expect(db._data.push_tokens[0]).toMatchObject({ id: 'dev_A', cuadrillaId: 'crew_mojon' });

    const asigA = await getDeviceAssignment();
    expect(asigA.cuadrillaId).toBe('crew_mojon');
  });

  it('cambiar A a Taller NO toca la fila de B (aunque ambas ya existan en la tabla compartida tras sync)', async () => {
    const { getDeviceAssignment, saveDeviceAssignment } = loadDeviceIdentityLogic(db, App);

    ls._asDevice('dev_A');
    await saveDeviceAssignment({ cuadrillaId: 'crew_mojon', nombre: 'Teléfono Mojón' });
    ls._asDevice('dev_B');
    await saveDeviceAssignment({ cuadrillaId: 'crew_volcan', nombre: 'Teléfono Volcán' });
    expect(db._data.push_tokens).toHaveLength(2);

    // A cambia a Taller
    ls._asDevice('dev_A');
    await saveDeviceAssignment({ cuadrillaId: 'crew_taller' });

    const filaA = db._data.push_tokens.find(r => r.id === 'dev_A');
    const filaB = db._data.push_tokens.find(r => r.id === 'dev_B');
    expect(filaA.cuadrillaId).toBe('crew_taller');
    expect(filaB.cuadrillaId).toBe('crew_volcan'); // NUNCA tocada
    expect(filaB.deviceName).toBe('Teléfono Volcán'); // ningún otro campo de B se movió tampoco

    // getDeviceAssignment() de B sigue leyendo SU PROPIA fila, ignorando el cambio de A
    ls._asDevice('dev_B');
    const asigB = await getDeviceAssignment();
    expect(asigB.cuadrillaId).toBe('crew_volcan');
  });

  it('leer la asignación de A nunca devuelve datos de B, incluso con ambas filas ya sincronizadas localmente', async () => {
    db._data.push_tokens = [
      { id: 'dev_A', cuadrillaId: 'crew_mojon', deviceName: 'Tel A' },
      { id: 'dev_B', cuadrillaId: 'crew_volcan', deviceName: 'Tel B' },
    ];
    const { getDeviceAssignment } = loadDeviceIdentityLogic(db, App);

    ls._asDevice('dev_A');
    expect((await getDeviceAssignment()).cuadrillaId).toBe('crew_mojon');
    ls._asDevice('dev_B');
    expect((await getDeviceAssignment()).cuadrillaId).toBe('crew_volcan');
  });

  it('saveDeviceAssignment() escribe ÚNICAMENTE en push_tokens — nunca en settings/general ni ninguna otra tabla "global"', async () => {
    const { saveDeviceAssignment } = loadDeviceIdentityLogic(db, App);
    ls._asDevice('dev_A');
    await saveDeviceAssignment({ cuadrillaId: 'crew_mojon' });
    expect(db._puts.every(p => p.store === 'push_tokens')).toBe(true);
  });

  it('logout/Quick Unlock/offline: getDeviceId() nunca depende de App.currentUser ni de sesión — conserva el mismo id sin importar si hay usuario logueado', async () => {
    const { getDeviceId } = loadDeviceIdentityLogic(db, App);
    ls._asDevice('dev_A');
    const idConSesion = getDeviceId();
    App.currentUser = null; // logout
    const idSinSesion = getDeviceId();
    expect(idSinSesion).toBe(idConSesion);
  });

  it('getDeviceAssignment() funciona sin red (fakeDB no simula fetch alguno) — offline no rompe ni cambia la cuadrilla', async () => {
    db._data.push_tokens = [{ id: 'dev_A', cuadrillaId: 'crew_mojon' }];
    const { getDeviceAssignment } = loadDeviceIdentityLogic(db, App);
    ls._asDevice('dev_A');
    const asig = await getDeviceAssignment();
    expect(asig.cuadrillaId).toBe('crew_mojon');
  });

  it('un dispositivo NUEVO (localStorage vacío) genera su propio id único y arranca sin cuadrilla — nunca hereda la de otro', async () => {
    const { getDeviceId, getDeviceAssignment } = loadDeviceIdentityLogic(db, App);
    db._data.push_tokens = [{ id: 'dev_A', cuadrillaId: 'crew_mojon' }];
    // localStorage recién instalado: sin 'engrase_device_id' todavía
    const nuevoId = getDeviceId();
    expect(nuevoId).not.toBe('dev_A');
    expect(nuevoId.startsWith('dev_')).toBe(true);
    const asig = await getDeviceAssignment();
    expect(asig.cuadrillaId).toBe(''); // sin cuadrilla — nunca cae a la de dev_A
  });

  it('guardar la asignación llama a Sync.fullSync() (sube el cambio, nunca queda solo local sin intentar sincronizar)', async () => {
    const { saveDeviceAssignment } = loadDeviceIdentityLogic(db, App);
    ls._asDevice('dev_A');
    await saveDeviceAssignment({ cuadrillaId: 'crew_mojon' });
    expect(fullSyncCalls).toBe(1);
  });
});
