// tests/unit/push-token-scope.test.js
//
// Arquitectura de notificaciones (lote 2026-09-30) — BUG REAL encontrado en
// la auditoría de notify-vencidos/notify-push (Edge Functions): esos
// Edge Functions filtran Lubricador por `disp.shiftId`/`disp.locationId`/
// `disp.cuadrillaId`, pero saveOneSignalId() nunca escribía esos campos en
// la fila push_tokens de LA PERSONA (solo existían en la fila APARTE del
// DISPOSITIVO, que nunca tiene un `token` real) — en la práctica ese
// filtro de zona/turno para Lubricador nunca hacía nada. Corregido
// copiando el scope del dispositivo (cuadrillaId/locationId/shiftId)
// sobre la fila de la persona, refrescado también cuando cambia la
// asignación del dispositivo mientras alguien sigue conectado (§6/§7 del
// pedido: "El dispositivo pertenece a una cuadrilla... push identity →
// Auth user", pero el SCOPE de push sigue necesitando saber a qué
// cuadrilla/ubicación pertenece el dispositivo en este momento).
//
// También cubre notificationShift/notificationAvailability/receiveAllShifts
// (autoservicio, §2/§29) vía saveOneSignalId()/saveNotificationPreferences().
//
// Contra el código REAL de app.js, con IndexedDB/localStorage/Sync
// reemplazados por fakes en memoria — mismo patrón que
// device-assignment-isolation.test.js.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadDeviceIdentityLogic } from '../helpers/loadLubricationLogic.js';

function makeFakeDB(seed = {}) {
  const data = {};
  for (const [store, rows] of Object.entries(seed)) data[store] = [...rows];
  return {
    _data: data,
    async get(store, id) { return (data[store] || []).find(r => r.id === id) || null; },
    async put(store, obj) {
      data[store] = data[store] || [];
      const i = data[store].findIndex(r => r.id === obj.id);
      if (i >= 0) data[store][i] = obj; else data[store].push(obj);
      return obj;
    },
    async allActive(store) { return (data[store] || []).filter(r => r.active !== false); },
  };
}
function makeFakeLocalStorage() {
  let store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _asDevice(id) { store['engrase_device_id'] = id; },
  };
}

describe('saveOneSignalId() — copia el scope del dispositivo sobre la fila de la persona (bug real corregido)', () => {
  let db, ls, fullSyncCalls, App;

  beforeEach(() => {
    db = makeFakeDB({ push_tokens: [], cuadrillas: [{ id: 'crew_mojon', locationId: 'loc_mojon', active: true }] });
    ls = makeFakeLocalStorage();
    fullSyncCalls = 0;
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('window', { Capacitor: undefined });
    vi.stubGlobal('Sync', { fullSync: () => { fullSyncCalls++; } });
    App = { currentUser: { id: 'u_lub1', name: 'Ana', role: 'LUBRICADOR' } };
    ls._asDevice('dev_mojon');
  });

  it('el dispositivo ya tiene cuadrilla/turno asignados -> la fila de la persona copia cuadrillaId/locationId/shiftId reales (ANTES quedaban vacíos/undefined, que es justo por qué el filtro del Edge Function nunca funcionaba)', async () => {
    const { saveDeviceAssignment, saveOneSignalId } = loadDeviceIdentityLogic(db, App);
    await saveDeviceAssignment({ cuadrillaId: 'crew_mojon', shiftId: 'shift_noche', nombre: 'Tel Mojón' });

    await saveOneSignalId('sub_123', 'android');

    const fila = db._data.push_tokens.find(r => r.id === 'tok_u_lub1_android');
    expect(fila).toMatchObject({ cuadrillaId: 'crew_mojon', locationId: 'loc_mojon', shiftId: 'shift_noche', token: 'sub_123' });
  });

  it('dispositivo SIN cuadrilla asignada -> campos de scope quedan vacíos, nunca undefined/erróneos', async () => {
    const { saveOneSignalId } = loadDeviceIdentityLogic(db, App);
    await saveOneSignalId('sub_456', 'android');
    const fila = db._data.push_tokens.find(r => r.id === 'tok_u_lub1_android');
    expect(fila.cuadrillaId).toBe('');
    expect(fila.locationId).toBe('');
  });

  it('preferencias por defecto en una fila NUEVA: BOTH/AVAILABLE/false', async () => {
    const { saveOneSignalId } = loadDeviceIdentityLogic(db, App);
    await saveOneSignalId('sub_789', 'android');
    const fila = db._data.push_tokens.find(r => r.id === 'tok_u_lub1_android');
    expect(fila).toMatchObject({ notificationShift: 'BOTH', notificationAvailability: 'AVAILABLE', receiveAllShifts: false });
  });

  it('un segundo llamado (subscription id renovado) PRESERVA las preferencias ya configuradas, nunca las resetea', async () => {
    const { saveOneSignalId, saveNotificationPreferences } = loadDeviceIdentityLogic(db, App);
    await saveOneSignalId('sub_1', 'android');
    await saveNotificationPreferences({ notificationShift: 'NIGHT', notificationAvailability: 'RESTING' });

    await saveOneSignalId('sub_2_renovado', 'android'); // OneSignal renovó el id de suscripción

    const fila = db._data.push_tokens.find(r => r.id === 'tok_u_lub1_android');
    expect(fila.token).toBe('sub_2_renovado');
    expect(fila.notificationShift).toBe('NIGHT');
    expect(fila.notificationAvailability).toBe('RESTING');
  });

  it('llama a Sync.fullSync() al guardar (sube el cambio, nunca queda solo local)', async () => {
    const { saveOneSignalId } = loadDeviceIdentityLogic(db, App);
    await saveOneSignalId('sub_1', 'android');
    expect(fullSyncCalls).toBe(1);
  });
});

describe('refreshPushTokenDeviceScope() — el scope de push se actualiza si cambia la cuadrilla del dispositivo mientras la persona sigue conectada', () => {
  let db, ls, App;

  beforeEach(() => {
    db = makeFakeDB({
      push_tokens: [{ id: 'tok_u_lub1_android', userId: 'u_lub1', userName: 'Ana', role: 'LUBRICADOR', token: 'sub_existente', platform: 'android', active: true, cuadrillaId: 'crew_volcan', locationId: 'loc_volcan', shiftId: 'shift_dia' }],
      cuadrillas: [{ id: 'crew_mojon', locationId: 'loc_mojon', active: true }],
    });
    ls = makeFakeLocalStorage();
    vi.stubGlobal('localStorage', ls);
    // window.Capacitor presente (verdadero) para que resuelva la MISMA
    // plataforma ('android') de la fila sembrada (tok_u_lub1_android) —
    // si no coincidieran, refreshPushTokenDeviceScope() buscaría
    // 'tok_u_lub1_web' (inexistente) y no haría nada, sin que sea un bug
    // real (solo un dispositivo real siempre resuelve SU plataforma real).
    vi.stubGlobal('window', { Capacitor: {} });
    vi.stubGlobal('Sync', { fullSync: () => {} });
    App = { currentUser: { id: 'u_lub1', name: 'Ana' } };
    ls._asDevice('dev_mojon');
  });

  it('saveDeviceAssignment() a una NUEVA cuadrilla refresca de inmediato la fila de push de quien está conectado', async () => {
    const { saveDeviceAssignment } = loadDeviceIdentityLogic(db, App);
    await saveDeviceAssignment({ cuadrillaId: 'crew_mojon', shiftId: 'shift_noche' });

    const fila = db._data.push_tokens.find(r => r.id === 'tok_u_lub1_android');
    expect(fila).toMatchObject({ cuadrillaId: 'crew_mojon', locationId: 'loc_mojon', shiftId: 'shift_noche' });
    expect(fila.token).toBe('sub_existente'); // el subscription id NUNCA se toca aquí
  });

  it('sin push_token existente para la persona (nunca activó push en este dispositivo): no inventa una fila', async () => {
    db._data.push_tokens = [];
    const { saveDeviceAssignment } = loadDeviceIdentityLogic(db, App);
    await saveDeviceAssignment({ cuadrillaId: 'crew_mojon' });
    expect(db._data.push_tokens.find(r => r.id === 'tok_u_lub1_android')).toBeUndefined();
  });

  it('sin App.currentUser (nadie conectado en este dispositivo ahora): no lanza, no hace nada', async () => {
    App.currentUser = null;
    const { saveDeviceAssignment } = loadDeviceIdentityLogic(db, App);
    await expect(saveDeviceAssignment({ cuadrillaId: 'crew_mojon' })).resolves.toBeUndefined();
  });
});

describe('saveNotificationPreferences() — autoservicio (§2/§21/§22/§29)', () => {
  let db, App;

  beforeEach(() => {
    db = makeFakeDB({
      push_tokens: [
        { id: 'tok_u1_android', userId: 'u1', active: true, notificationShift: 'BOTH', notificationAvailability: 'AVAILABLE', receiveAllShifts: false },
        { id: 'tok_u1_web', userId: 'u1', active: true, notificationShift: 'BOTH', notificationAvailability: 'AVAILABLE', receiveAllShifts: false },
        { id: 'tok_u2_android', userId: 'u2', active: true, notificationShift: 'BOTH', notificationAvailability: 'AVAILABLE', receiveAllShifts: false },
      ],
    });
    vi.stubGlobal('window', { Capacitor: undefined });
    vi.stubGlobal('Sync', { fullSync: () => {} });
    App = { currentUser: { id: 'u1', name: 'Carlos' } };
  });

  it('actualiza TODAS las plataformas de la persona (android Y web), nunca solo la primera', async () => {
    const { saveNotificationPreferences } = loadDeviceIdentityLogic(db, App);
    await saveNotificationPreferences({ notificationShift: 'DAY', notificationAvailability: 'AVAILABLE' });

    expect(db._data.push_tokens.find(r => r.id === 'tok_u1_android').notificationShift).toBe('DAY');
    expect(db._data.push_tokens.find(r => r.id === 'tok_u1_web').notificationShift).toBe('DAY');
  });

  it('nunca toca las filas de OTRA persona', async () => {
    const { saveNotificationPreferences } = loadDeviceIdentityLogic(db, App);
    await saveNotificationPreferences({ notificationShift: 'NIGHT' });
    expect(db._data.push_tokens.find(r => r.id === 'tok_u2_android').notificationShift).toBe('BOTH');
  });

  it('RESTING (§22, ejemplo del pedido: "Pedro" marca descanso)', async () => {
    const { saveNotificationPreferences } = loadDeviceIdentityLogic(db, App);
    await saveNotificationPreferences({ notificationAvailability: 'RESTING' });
    expect(db._data.push_tokens.find(r => r.id === 'tok_u1_android').notificationAvailability).toBe('RESTING');
  });

  it('sin sesión activa: lanza, nunca escribe nada', async () => {
    App.currentUser = null;
    const { saveNotificationPreferences } = loadDeviceIdentityLogic(db, App);
    await expect(saveNotificationPreferences({ notificationShift: 'DAY' })).rejects.toThrow();
  });

  it('sin ningún push_token activado todavía en este dispositivo: lanza un mensaje claro, nunca crea una fila fantasma', async () => {
    db._data.push_tokens = [];
    const { saveNotificationPreferences } = loadDeviceIdentityLogic(db, App);
    await expect(saveNotificationPreferences({ notificationShift: 'DAY' })).rejects.toThrow(/activaste/);
  });
});
