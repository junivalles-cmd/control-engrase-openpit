// NOTIF-ANDROID-001 (docs/BUG_REGISTER.md): protege que la selección de
// mecanismo de notificaciones push elija correctamente SDK Web vs. plugin
// nativo según la plataforma, sin doble inicialización, y que el SDK Web
// nunca se cargue dentro de Capacitor/Android.
//
// Esto es un TEST UNITARIO de la lógica de selección de plataforma —
// NO envía ni simula una notificación push real (eso queda fuera de
// alcance de esta prueba, ver docs/BUG_REGISTER.md "PUSH REAL").
import { describe, it, expect, vi } from 'vitest';
import { loadOneSignalPlatformLogic } from '../helpers/loadNotificationLogic.js';

function makeDom() {
  const createdElements = [];
  const headChildren = [];
  const document = {
    createElement: (tag) => {
      const el = { tag, src: null, defer: null };
      createdElements.push(el);
      return el;
    },
    head: { appendChild: (el) => headChildren.push(el) },
  };
  return { document, createdElements, headChildren };
}

function makeNativeOneSignal() {
  return {
    Notifications: { requestPermission: vi.fn(async () => true) },
    User: { pushSubscription: { id: 'native-sub-123' } },
  };
}

const factory = loadOneSignalPlatformLogic();

describe('NOTIF-ANDROID-001 — selección de plataforma para notificaciones push', () => {
  it('en el NAVEGADOR (sin window.Capacitor), con App ID configurado, crea el <script> del SDK Web de OneSignal', async () => {
    const { document, createdElements, headChildren } = makeDom();
    const navigator = { serviceWorker: {} };
    const window = { PushManager: {}, Capacitor: undefined };
    const App = { currentUser: null };
    const saveOneSignalId = vi.fn();

    const { initWebPush } = factory('APP_ID_DE_PRUEBA', window, document, navigator, App, saveOneSignalId);
    await initWebPush();

    expect(createdElements.length).toBe(1);
    expect(createdElements[0].tag).toBe('script');
    expect(createdElements[0].src).toContain('onesignal.com');
    expect(headChildren.length).toBe(1);
  });

  it('con window.Capacitor presente (Android), initWebPush() NO crea ningún <script> — el SDK Web nunca se carga dentro de la app nativa', async () => {
    const { document, createdElements } = makeDom();
    const navigator = { serviceWorker: {} };
    const window = { PushManager: {}, Capacitor: {} };
    const App = { currentUser: null };
    const saveOneSignalId = vi.fn();

    const { initWebPush } = factory('APP_ID_DE_PRUEBA', window, document, navigator, App, saveOneSignalId);
    await initWebPush();

    expect(createdElements.length).toBe(0);
  });

  it('initPushNotifications(): en Android (window.Capacitor presente), usa el plugin NATIVO y no toca el SDK Web', async () => {
    const { document, createdElements } = makeDom();
    const navigator = { serviceWorker: {} };
    const nativeOneSignal = makeNativeOneSignal();
    const window = { PushManager: {}, Capacitor: {}, plugins: { OneSignal: nativeOneSignal } };
    const App = { currentUser: { id: 'u1', name: 'Tester' } };
    const saveOneSignalId = vi.fn();

    const { initPushNotifications } = factory('APP_ID_DE_PRUEBA', window, document, navigator, App, saveOneSignalId);
    await initPushNotifications();

    expect(nativeOneSignal.Notifications.requestPermission).toHaveBeenCalledTimes(1);
    expect(createdElements.length).toBe(0); // el SDK Web nunca se cargó
    expect(saveOneSignalId).toHaveBeenCalledWith('native-sub-123', 'android');
  });

  it('initPushNotifications(): en el NAVEGADOR (sin window.Capacitor), usa el mecanismo Web y no llama al plugin nativo', async () => {
    const { document, createdElements } = makeDom();
    const navigator = { serviceWorker: {} };
    const nativeOneSignal = makeNativeOneSignal();
    const window = { PushManager: {}, Capacitor: undefined, plugins: { OneSignal: nativeOneSignal } };
    const App = { currentUser: { id: 'u1', name: 'Tester' } };
    const saveOneSignalId = vi.fn();

    const { initPushNotifications } = factory('APP_ID_DE_PRUEBA', window, document, navigator, App, saveOneSignalId);
    await initPushNotifications();

    expect(createdElements.length).toBe(1); // sí cargó el SDK Web
    expect(nativeOneSignal.Notifications.requestPermission).not.toHaveBeenCalled();
  });

  it('sin App ID configurado (como está hoy en producción), initPushNotifications() no hace nada en ninguna plataforma', async () => {
    for (const capacitor of [undefined, {}]) {
      const { document, createdElements } = makeDom();
      const navigator = { serviceWorker: {} };
      const nativeOneSignal = makeNativeOneSignal();
      const window = { PushManager: {}, Capacitor: capacitor, plugins: { OneSignal: nativeOneSignal } };
      const App = { currentUser: { id: 'u1', name: 'Tester' } };
      const saveOneSignalId = vi.fn();

      const { initPushNotifications } = factory('', window, document, navigator, App, saveOneSignalId);
      await initPushNotifications();

      expect(createdElements.length).toBe(0);
      expect(nativeOneSignal.Notifications.requestPermission).not.toHaveBeenCalled();
    }
  });

  it('no hay doble inicialización: llamar initPushNotifications() dos veces en Android solo pide permiso una vez por llamada explícita (no se auto-repite)', async () => {
    const { document, createdElements } = makeDom();
    const navigator = { serviceWorker: {} };
    const nativeOneSignal = makeNativeOneSignal();
    const window = { PushManager: {}, Capacitor: {}, plugins: { OneSignal: nativeOneSignal } };
    const App = { currentUser: { id: 'u1', name: 'Tester' } };
    const saveOneSignalId = vi.fn();

    const { initPushNotifications } = factory('APP_ID_DE_PRUEBA', window, document, navigator, App, saveOneSignalId);
    await initPushNotifications();
    await initPushNotifications();

    // Cada llamada explícita pide permiso una vez (es responsabilidad de quien
    // llama no invocarla dos veces sin motivo) — lo que NO debe pasar nunca es
    // que además se cree un <script> del SDK Web en el camino nativo.
    expect(nativeOneSignal.Notifications.requestPermission).toHaveBeenCalledTimes(2);
    expect(createdElements.length).toBe(0);
  });
});
