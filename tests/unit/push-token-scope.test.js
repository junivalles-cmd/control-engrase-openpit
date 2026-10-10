// tests/unit/push-token-scope.test.js
//
// Arquitectura de notificaciones (lote 2026-09-30) — BUG REAL encontrado en
// la auditoría de notify-vencidos/notify-push (Edge Functions): esos
// Edge Functions filtran Lubricador por `disp.shiftId`/`disp.locationId`/
// `disp.cuadrillaId`, pero saveOneSignalId() nunca escribía esos campos en
// la fila push_tokens de LA PERSONA.
//
// REESCRITO 2026-10-02 (corrección arquitectónica — ver
// docs/OPERATIONAL_SCOPE.md): el scope de push ya NO viene del dispositivo
// (`saveDeviceAssignment()`, eliminado) — viene de la cuadrilla AUTORIZADA
// del usuario (`cuadrillas[].memberUserIds`, resuelta por
// getCurrentOperationalScope()/resolveOperationalScope()), con
// `setSelectedCrewId()` como la única huella local (comodidad de sesión
// cuando hay 2+ cuadrillas autorizadas, nunca la fuente del dato).
//
// También cubre notificationShift/notificationAvailability/receiveAllShifts
// (autoservicio, §2/§29) vía saveOneSignalId()/saveNotificationPreferences().
//
// Contra el código REAL de app.js + src/core/operational-scope.js, con
// IndexedDB/localStorage/Sync reemplazados por fakes en memoria — mismo
// patrón que device-assignment-isolation.test.js.

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
    async all(store) { return data[store] || []; },
    async allActive(store) { return (data[store] || []).filter(r => r.active !== false); },
  };
}
function makeFakeLocalStorage() {
  let store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

describe('saveOneSignalId() — copia el scope de la cuadrilla AUTORIZADA sobre la fila de la persona (bug real corregido, ahora sin dispositivo)', () => {
  let db, ls, fullSyncCalls, App;

  beforeEach(() => {
    db = makeFakeDB({ push_tokens: [], cuadrillas: [{ id: 'crew_mojon', locationId: 'loc_mojon', active: true, memberUserIds: ['u_lub1'] }] });
    ls = makeFakeLocalStorage();
    fullSyncCalls = 0;
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('window', { Capacitor: undefined });
    vi.stubGlobal('Sync', { fullSync: () => { fullSyncCalls++; } });
    App = { currentUser: { id: 'u_lub1', name: 'Ana', role: 'LUBRICADOR' }, generalSettings: { shiftDayStart: 6, shiftNightStart: 18 } };
  });

  it('el usuario está autorizado en 1 sola cuadrilla (se autoselecciona) -> la fila de la persona copia cuadrillaId/locationId/shiftId reales (ANTES quedaban vacíos/undefined con el viejo scope de dispositivo)', async () => {
    const { saveOneSignalId } = loadDeviceIdentityLogic(db, App);
    await saveOneSignalId('sub_123', 'android');

    const fila = db._data.push_tokens.find(r => r.id === 'tok_u_lub1_android');
    expect(fila.cuadrillaId).toBe('crew_mojon');
    expect(fila.locationId).toBe('loc_mojon');
    expect(fila.shiftId).toMatch(/^shift_(dia|noche)$/); // currentShiftId() real, hora del momento del test
    expect(fila.token).toBe('sub_123');
  });

  it('usuario SIN ninguna cuadrilla autorizada -> campos de scope quedan vacíos, nunca undefined/erróneos', async () => {
    db._data.cuadrillas = [];
    const { saveOneSignalId } = loadDeviceIdentityLogic(db, App);
    await saveOneSignalId('sub_456', 'android');
    const fila = db._data.push_tokens.find(r => r.id === 'tok_u_lub1_android');
    expect(fila.cuadrillaId).toBe('');
    expect(fila.locationId).toBe('');
  });

  it('usuario con 2+ cuadrillas autorizadas SIN elegir ninguna todavía (NEEDS_CREW_SELECTION) -> campos de scope vacíos, nunca adivina una', async () => {
    db._data.cuadrillas.push({ id: 'crew_taller', locationId: 'loc_taller', active: true, memberUserIds: ['u_lub1'] });
    const { saveOneSignalId } = loadDeviceIdentityLogic(db, App);
    await saveOneSignalId('sub_789', 'android');
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

describe('refreshPushTokenCrewScope() — el scope de push se actualiza si la persona cambia su cuadrilla de sesión, sin tocar el dispositivo', () => {
  let db, ls, App;

  beforeEach(() => {
    db = makeFakeDB({
      push_tokens: [{ id: 'tok_u_lub1_android', userId: 'u_lub1', userName: 'Ana', role: 'LUBRICADOR', token: 'sub_existente', platform: 'android', active: true, cuadrillaId: 'crew_volcan', locationId: 'loc_volcan', shiftId: 'shift_dia' }],
      cuadrillas: [
        { id: 'crew_volcan', locationId: 'loc_volcan', active: true, memberUserIds: ['u_lub1'] },
        { id: 'crew_mojon', locationId: 'loc_mojon', active: true, memberUserIds: ['u_lub1'] },
      ],
    });
    ls = makeFakeLocalStorage();
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('window', { Capacitor: {} });
    vi.stubGlobal('Sync', { fullSync: () => {} });
    App = { currentUser: { id: 'u_lub1', name: 'Ana', role: 'LUBRICADOR' }, generalSettings: { shiftDayStart: 6, shiftNightStart: 18 } };
  });

  it('elegir una NUEVA cuadrilla de sesión (setSelectedCrewId) + refreshPushTokenCrewScope() actualiza de inmediato la fila de push de quien está conectado', async () => {
    const { setSelectedCrewId, refreshPushTokenCrewScope } = loadDeviceIdentityLogic(db, App);
    setSelectedCrewId('u_lub1', 'crew_mojon');
    await refreshPushTokenCrewScope();

    const fila = db._data.push_tokens.find(r => r.id === 'tok_u_lub1_android');
    expect(fila.cuadrillaId).toBe('crew_mojon');
    expect(fila.locationId).toBe('loc_mojon');
    expect(fila.token).toBe('sub_existente'); // el subscription id NUNCA se toca aquí
  });

  it('sin push_token existente para la persona (nunca activó push en este dispositivo): no inventa una fila', async () => {
    db._data.push_tokens = [];
    const { setSelectedCrewId, refreshPushTokenCrewScope } = loadDeviceIdentityLogic(db, App);
    setSelectedCrewId('u_lub1', 'crew_mojon');
    await refreshPushTokenCrewScope();
    expect(db._data.push_tokens.find(r => r.id === 'tok_u_lub1_android')).toBeUndefined();
  });

  it('sin App.currentUser (nadie conectado ahora mismo): no lanza, no hace nada', async () => {
    App.currentUser = null;
    const { refreshPushTokenCrewScope } = loadDeviceIdentityLogic(db, App);
    await expect(refreshPushTokenCrewScope()).resolves.toBeUndefined();
  });
});

describe('aislamiento por USUARIO de la selección de cuadrilla de sesión (reemplaza el viejo aislamiento por dispositivo)', () => {
  it('getSelectedCrewId() de un usuario nunca devuelve la selección guardada para OTRO usuario en el MISMO localStorage', () => {
    const ls = makeFakeLocalStorage();
    vi.stubGlobal('localStorage', ls);
    const { setSelectedCrewId, getSelectedCrewId } = loadDeviceIdentityLogic(makeFakeDB(), { currentUser: null });
    setSelectedCrewId('u_lub1', 'crew_mojon');
    expect(getSelectedCrewId('u_lub1')).toBe('crew_mojon');
    expect(getSelectedCrewId('u_lub2')).toBe(''); // otra persona en el mismo teléfono: nunca hereda
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
