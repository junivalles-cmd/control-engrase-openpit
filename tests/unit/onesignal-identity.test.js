// tests/unit/onesignal-identity.test.js
//
// Arquitectura de notificaciones (lote 2026-09-30, pedido explícito del
// usuario) — identidad de OneSignal atada al USUARIO Auth actual, nunca al
// dispositivo/cuadrilla (§9-§13), y el bug real de disablePushForCurrentUser()
// (§14): buscaba la fila push_tokens por `tok_${userId}` (sin plataforma),
// pero saveOneSignalId() SIEMPRE la guarda como `tok_${userId}_${plataforma}`
// — esa clave nunca existía, así que la función jamás desactivó nada en
// ningún logout real, desde que se escribió.
//
// Funciones REALES extraídas de app.js vía loadNotificationIdentityLogic()
// (tests/helpers/loadNotificationLogic.js) — `window`/`App`/`DB`/`stamp` se
// inyectan como parámetros, igual que loadOneSignalPlatformLogic() ya hacía
// para initWebPush()/initPushNotifications() (ver notificaciones-plataforma.test.js).

import { describe, it, expect, vi } from 'vitest';
import { loadNotificationIdentityLogic } from '../helpers/loadNotificationLogic.js';

function makeFakeDB(seedRows) {
  const rows = new Map((seedRows || []).map(r => [r.id, r]));
  return {
    allActive: vi.fn(async (store) => {
      if (store !== 'push_tokens') return [];
      return [...rows.values()].filter(r => r.active !== false);
    }),
    get: vi.fn(async (store, id) => (store === 'push_tokens' ? rows.get(id) : undefined)),
    put: vi.fn(async (store, row) => { if (store === 'push_tokens') rows.set(row.id, row); }),
    _rows: rows,
  };
}
const stamp = (obj) => ({ ...obj, updatedAt: '2026-09-30T00:00:00.000Z' });

describe('bindOneSignalIdentity()/clearOneSignalIdentity() — §9-§13, identidad atada al usuario Auth', () => {
  it('I. login: asocia OneSignal.login(userId) — la identidad pasa a ser la del usuario ACTUAL, nunca deviceId/crewId', async () => {
    const oneSignal = { login: vi.fn(async () => {}), logout: vi.fn(async () => {}) };
    const window_ = { OneSignal: oneSignal };
    const { bindOneSignalIdentity } = loadNotificationIdentityLogic()('APP_ID_DE_PRUEBA', window_, {}, makeFakeDB(), stamp);

    await bindOneSignalIdentity('u_carlos');
    expect(oneSignal.login).toHaveBeenCalledWith('u_carlos');
    expect(oneSignal.login).toHaveBeenCalledTimes(1);
  });

  it('J. logout: retira la identidad (OneSignal.logout()) — nunca se le pasa un userId a logout, solo limpia la asociación vigente', async () => {
    const oneSignal = { login: vi.fn(async () => {}), logout: vi.fn(async () => {}) };
    const window_ = { OneSignal: oneSignal };
    const { clearOneSignalIdentity } = loadNotificationIdentityLogic()('APP_ID_DE_PRUEBA', window_, {}, makeFakeDB(), stamp);

    await clearOneSignalIdentity();
    expect(oneSignal.logout).toHaveBeenCalledTimes(1);
  });

  it('demostración user A -> user B (§35): login A, "logout" (retira A), login B -> login() se llamó con A y luego con B, nunca simultáneo', async () => {
    const oneSignal = { login: vi.fn(async () => {}), logout: vi.fn(async () => {}) };
    const window_ = { OneSignal: oneSignal };
    const { bindOneSignalIdentity, clearOneSignalIdentity } = loadNotificationIdentityLogic()('APP_ID_DE_PRUEBA', window_, {}, makeFakeDB(), stamp);

    await bindOneSignalIdentity('u_A');
    await clearOneSignalIdentity();
    await bindOneSignalIdentity('u_B');

    expect(oneSignal.login.mock.calls.map(c => c[0])).toEqual(['u_A', 'u_B']);
    expect(oneSignal.logout).toHaveBeenCalledTimes(1);
  });

  it('sin ONESIGNAL_APP_ID (como está hoy en producción): ni login ni logout se llaman — feature apagada, nunca lanza', async () => {
    const oneSignal = { login: vi.fn(async () => {}), logout: vi.fn(async () => {}) };
    const window_ = { OneSignal: oneSignal };
    const { bindOneSignalIdentity, clearOneSignalIdentity } = loadNotificationIdentityLogic()('', window_, {}, makeFakeDB(), stamp);

    await bindOneSignalIdentity('u_carlos');
    await clearOneSignalIdentity();
    expect(oneSignal.login).not.toHaveBeenCalled();
    expect(oneSignal.logout).not.toHaveBeenCalled();
  });

  it('sin OneSignal disponible en window (web sin SDK cargado, o plugin nativo ausente): no lanza', async () => {
    const window_ = {};
    const { bindOneSignalIdentity, clearOneSignalIdentity } = loadNotificationIdentityLogic()('APP_ID_DE_PRUEBA', window_, {}, makeFakeDB(), stamp);
    await expect(bindOneSignalIdentity('u_carlos')).resolves.toBeUndefined();
    await expect(clearOneSignalIdentity()).resolves.toBeUndefined();
  });

  it('bindOneSignalIdentity(): sin userId no llama a login (nunca asocia una identidad vacía)', async () => {
    const oneSignal = { login: vi.fn(async () => {}) };
    const window_ = { OneSignal: oneSignal };
    const { bindOneSignalIdentity } = loadNotificationIdentityLogic()('APP_ID_DE_PRUEBA', window_, {}, makeFakeDB(), stamp);
    await bindOneSignalIdentity(null);
    await bindOneSignalIdentity(undefined);
    expect(oneSignal.login).not.toHaveBeenCalled();
  });

  it('prioriza window.plugins?.OneSignal (nativo) sobre window.OneSignal (web) cuando ambos existen', async () => {
    const nativo = { login: vi.fn(async () => {}) };
    const web = { login: vi.fn(async () => {}) };
    const window_ = { plugins: { OneSignal: nativo }, OneSignal: web };
    const { bindOneSignalIdentity } = loadNotificationIdentityLogic()('APP_ID_DE_PRUEBA', window_, {}, makeFakeDB(), stamp);
    await bindOneSignalIdentity('u_carlos');
    expect(nativo.login).toHaveBeenCalledWith('u_carlos');
    expect(web.login).not.toHaveBeenCalled();
  });
});

describe('disablePushForCurrentUser() — §14, bug real de llave rota (corregido)', () => {
  it('BUG (comportamiento viejo demostrado): buscar por `tok_${userId}` sin plataforma nunca encontraba la fila real', async () => {
    const fakeDB = makeFakeDB([{ id: 'tok_u1_android', userId: 'u1', active: true }]);
    // Esto es exactamente lo que el código VIEJO hacía — se documenta aquí
    // como regresión, no como comportamiento deseado.
    const filaViejaClave = await fakeDB.get('push_tokens', 'tok_u1');
    expect(filaViejaClave).toBeUndefined();
  });

  it('corregido: desactiva la fila real de la plataforma actual (android)', async () => {
    const fakeDB = makeFakeDB([{ id: 'tok_u1_android', userId: 'u1', active: true }]);
    const App = { currentUser: { id: 'u1', name: 'Ana' } };
    const { disablePushForCurrentUser } = loadNotificationIdentityLogic()('', {}, App, fakeDB, stamp);

    await disablePushForCurrentUser();
    expect(fakeDB._rows.get('tok_u1_android').active).toBe(false);
  });

  it('desactiva TODAS las plataformas de la persona (android Y web), no solo una', async () => {
    const fakeDB = makeFakeDB([
      { id: 'tok_u1_android', userId: 'u1', active: true },
      { id: 'tok_u1_web', userId: 'u1', active: true },
    ]);
    const App = { currentUser: { id: 'u1', name: 'Ana' } };
    const { disablePushForCurrentUser } = loadNotificationIdentityLogic()('', {}, App, fakeDB, stamp);

    await disablePushForCurrentUser();
    expect(fakeDB._rows.get('tok_u1_android').active).toBe(false);
    expect(fakeDB._rows.get('tok_u1_web').active).toBe(false);
  });

  it('nunca toca la fila de OTRA persona', async () => {
    const fakeDB = makeFakeDB([
      { id: 'tok_u1_android', userId: 'u1', active: true },
      { id: 'tok_u2_android', userId: 'u2', active: true },
    ]);
    const App = { currentUser: { id: 'u1', name: 'Ana' } };
    const { disablePushForCurrentUser } = loadNotificationIdentityLogic()('', {}, App, fakeDB, stamp);

    await disablePushForCurrentUser();
    expect(fakeDB._rows.get('tok_u1_android').active).toBe(false);
    expect(fakeDB._rows.get('tok_u2_android').active).toBe(true);
  });

  it('sin App.currentUser: no hace nada, no lanza', async () => {
    const fakeDB = makeFakeDB([{ id: 'tok_u1_android', userId: 'u1', active: true }]);
    const App = { currentUser: null };
    const { disablePushForCurrentUser } = loadNotificationIdentityLogic()('', {}, App, fakeDB, stamp);
    await expect(disablePushForCurrentUser()).resolves.toBeUndefined();
    expect(fakeDB._rows.get('tok_u1_android').active).toBe(true);
  });
});

describe('cancelAllLocalNotifications() — §15', () => {
  it('cancela IDs fijos y ventana dual DAY/NIGHT, sin exigir App.currentUser', async () => {
    const cancel = vi.fn(async () => {});
    const window_ = { Capacitor: { Plugins: { LocalNotifications: { cancel } } } };
    const { cancelAllLocalNotifications } = loadNotificationIdentityLogic()('', window_, {}, makeFakeDB(), stamp);

    await cancelAllLocalNotifications();
    expect(cancel).toHaveBeenCalledTimes(1);
    // 11 IDs fijos (incluye NOTIF_ID_VALIDATION/_REC — panel de tareas:
    // "validación pendiente" ahora también se recuerda localmente, mismo
    // patrón que NOTIF_ID_ASSIGNED/_REC) + 14 de la ventana dual DAY/NIGHT.
    expect(cancel.mock.calls[0][0].notifications.length).toBe(27);
  });

  it('sin el plugin LocalNotifications disponible: no lanza', async () => {
    const { cancelAllLocalNotifications } = loadNotificationIdentityLogic()('', {}, {}, makeFakeDB(), stamp);
    await expect(cancelAllLocalNotifications()).resolves.toBeUndefined();
  });
});
