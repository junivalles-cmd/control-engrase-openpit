// tests/unit/notification-prefs-admin-edit.test.js
//
// Cierre de uno de los pendientes documentados en varias partes del
// handoff ("Admin editando preferencias de notificación de OTRA persona —
// sigue siendo autoservicio únicamente, documentado como pendiente").
// saveNotificationPreferencesForUser() reusa exactamente el mismo
// mecanismo de escritura que saveNotificationPreferences() (autoservicio,
// tests/unit/push-token-scope.test.js) vía applyNotificationPreferencesToRows()
// — mismo patrón de prueba (DB/App/window/Sync fakes).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadDeviceIdentityLogic, APP_JS_PATH } from '../helpers/loadLubricationLogic.js';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';

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

describe('saveNotificationPreferencesForUser() — un ADMINISTRADOR edita las preferencias de otra persona', () => {
  let db, App, fullSyncCalls;

  beforeEach(() => {
    db = makeFakeDB({
      push_tokens: [
        { id: 'tok_u1_android', userId: 'u1', userName: 'Ana', active: true, notificationShift: 'BOTH', notificationAvailability: 'AVAILABLE', receiveAllShifts: false },
        { id: 'tok_u1_web', userId: 'u1', userName: 'Ana', active: true, notificationShift: 'BOTH', notificationAvailability: 'AVAILABLE', receiveAllShifts: false },
        { id: 'tok_u2_android', userId: 'u2', userName: 'Pedro', active: true, notificationShift: 'BOTH', notificationAvailability: 'AVAILABLE', receiveAllShifts: false },
        // Fila de DISPOSITIVO (sin userId) — nunca debe verse afectada por esta función.
        { id: 'device_abc123', active: true, cuadrillaId: 'crew_volcan', deviceName: 'Tablet Volcán' },
      ],
    });
    fullSyncCalls = 0;
    vi.stubGlobal('window', { Capacitor: undefined });
    vi.stubGlobal('Sync', { fullSync: () => { fullSyncCalls++; } });
    App = { currentUser: { id: 'admin1', name: 'Junior', role: 'ADMINISTRADOR' } };
  });

  it('actualiza TODAS las plataformas de la persona elegida (android Y web)', async () => {
    const { saveNotificationPreferencesForUser } = loadDeviceIdentityLogic(db, App);
    await saveNotificationPreferencesForUser('u1', { notificationShift: 'NIGHT', notificationAvailability: 'RESTING' });

    expect(db._data.push_tokens.find(r => r.id === 'tok_u1_android')).toMatchObject({ notificationShift: 'NIGHT', notificationAvailability: 'RESTING' });
    expect(db._data.push_tokens.find(r => r.id === 'tok_u1_web')).toMatchObject({ notificationShift: 'NIGHT', notificationAvailability: 'RESTING' });
  });

  it('nunca toca las filas de OTRA persona ni la fila de dispositivo', async () => {
    const { saveNotificationPreferencesForUser } = loadDeviceIdentityLogic(db, App);
    await saveNotificationPreferencesForUser('u1', { notificationShift: 'NIGHT' });

    expect(db._data.push_tokens.find(r => r.id === 'tok_u2_android').notificationShift).toBe('BOTH');
    expect(db._data.push_tokens.find(r => r.id === 'device_abc123')).toMatchObject({ cuadrillaId: 'crew_volcan', deviceName: 'Tablet Volcán' });
  });

  it('preserva createdBy del dueño original de la fila (stamp() nunca lo pisa si ya existe) — el admin edita, no se adueña de la fila', async () => {
    db._data.push_tokens.find(r => r.id === 'tok_u1_android').createdBy = 'Ana';
    const { saveNotificationPreferencesForUser } = loadDeviceIdentityLogic(db, App);
    await saveNotificationPreferencesForUser('u1', { notificationShift: 'DAY' });
    expect(db._data.push_tokens.find(r => r.id === 'tok_u1_android').createdBy).toBe('Ana');
  });

  it('llama a Sync.fullSync() al guardar', async () => {
    const { saveNotificationPreferencesForUser } = loadDeviceIdentityLogic(db, App);
    await saveNotificationPreferencesForUser('u1', { notificationShift: 'DAY' });
    expect(fullSyncCalls).toBe(1);
  });

  it('rechaza a quien NO es ADMINISTRADOR, sin escribir nada', async () => {
    App.currentUser = { id: 'sup1', name: 'Marta', role: 'SUPERVISOR' };
    const { saveNotificationPreferencesForUser } = loadDeviceIdentityLogic(db, App);
    await expect(saveNotificationPreferencesForUser('u1', { notificationShift: 'DAY' })).rejects.toThrow();
    expect(db._data.push_tokens.find(r => r.id === 'tok_u1_android').notificationShift).toBe('BOTH');
  });

  it('sin sesión activa: rechaza, nunca escribe', async () => {
    App.currentUser = null;
    const { saveNotificationPreferencesForUser } = loadDeviceIdentityLogic(db, App);
    await expect(saveNotificationPreferencesForUser('u1', { notificationShift: 'DAY' })).rejects.toThrow();
  });

  it('persona sin ningún push_token activo: rechaza con mensaje claro, nunca crea una fila fantasma', async () => {
    const { saveNotificationPreferencesForUser } = loadDeviceIdentityLogic(db, App);
    await expect(saveNotificationPreferencesForUser('u3-sin-token', { notificationShift: 'DAY' })).rejects.toThrow(/activó/);
    expect(db._data.push_tokens.some(r => r.userId === 'u3-sin-token')).toBe(false);
  });
});

describe('renderConfig() — tabla de notificaciones push: solo filas de persona, con botón "Editar"', () => {
  const src = extractDeclaration(readSource(APP_JS_PATH), 'renderConfig');

  it('filtra las filas de DISPOSITIVO (sin userId) antes de listarlas — esta tabla es Usuario/Rol', () => {
    expect(src).toContain("const pushTokens = (await DB.allActive('push_tokens')).filter(t => t.userId);");
  });

  it('cada fila trae un botón "Editar" con el userId/nombre en data-*', () => {
    expect(src).toMatch(/data-edit-notif-user="\$\{esc\(t\.userId\)\}" data-edit-notif-name="\$\{esc\(t\.userName\)\}"/);
  });

  it('wirea el click al modal real, nunca un placeholder', () => {
    expect(src).toContain("openEditUserNotificationPrefsModal(btn.dataset.editNotifUser, btn.dataset.editNotifName)");
  });
});

describe('openEditUserNotificationPrefsModal() — llama al guardado con admin, nunca al autoservicio propio', () => {
  it('llama a saveNotificationPreferencesForUser(), no a saveNotificationPreferences()', () => {
    const src = extractDeclaration(readSource(APP_JS_PATH), 'openEditUserNotificationPrefsModal');
    expect(src).toContain('await saveNotificationPreferencesForUser(targetUserId, {');
  });
});
