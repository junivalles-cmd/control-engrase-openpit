// tests/helpers/loadNotificationLogic.js
//
// Carga, del código REAL de app.js, la lógica de selección de plataforma
// para notificaciones push (SDK Web de OneSignal vs. plugin nativo).
// `ONESIGNAL_APP_ID`, `window`, `document`, `navigator`, `App` y
// `saveOneSignalId` se inyectan como parámetros (en vez de leerlos también
// del archivo) para poder probar ambos escenarios (App ID configurado o
// no, dentro/fuera de Capacitor) sin duplicar la lógica ni depender de un
// navegador real — ver docs/BUG_REGISTER.md #NOTIF-ANDROID-001.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource, extractDeclaration } from './extractFromSource.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS_PATH = path.resolve(__dirname, '../../CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js');

export function loadOneSignalPlatformLogic() {
  const source = readSource(APP_JS_PATH);
  const names = ['initWebPush', 'initPushNotifications'];
  const chunks = names.map((n) => extractDeclaration(source, n));
  const body = `${chunks.join('\n\n')}\n\nreturn { initWebPush, initPushNotifications };`;
  const factory = new Function('ONESIGNAL_APP_ID', 'window', 'document', 'navigator', 'App', 'saveOneSignalId', body);
  return factory;
}

// Arquitectura de notificaciones (lote 2026-09-30) — identidad OneSignal
// (bindOneSignalIdentity/clearOneSignalIdentity/oneSignalHandle) +
// disablePushForCurrentUser() (bug real de llave rota, corregido) +
// cancelAllLocalNotifications(). Todas dependen de `window`/`App`/`DB`/
// `stamp` inyectados — igual que loadOneSignalPlatformLogic(), para poder
// probar con un OneSignal falso sin depender de un navegador/SDK real.
export function loadNotificationIdentityLogic() {
  const source = readSource(APP_JS_PATH);
  const names = [
    'oneSignalHandle', 'bindOneSignalIdentity', 'clearOneSignalIdentity',
    'disablePushForCurrentUser', 'cancelAllLocalNotifications',
  ];
  const chunks = names.map((n) => extractDeclaration(source, n));
  // LOCAL_NOTIF_IDS es un const global (no una función) que a su vez
  // referencia los NOTIF_ID_* individuales — hay que traerlos también,
  // o el array literal lanzaría ReferenceError al evaluarse.
  const constNames = [
    'NOTIF_ID_DAILY_TASKS', 'NOTIF_ID_COMPLIANCE', 'NOTIF_ID_WEEKDAY_PLAN',
    'NOTIF_ID_VENCIDOS', 'NOTIF_ID_POR_ENGRASAR', 'NOTIF_ID_VENCIDOS_REC',
    'NOTIF_ID_POR_ENGRASAR_REC', 'NOTIF_ID_SEMANAL', 'NOTIF_ID_ESCALADO',
    'NOTIF_ID_ASSIGNED', 'NOTIF_ID_ASSIGNED_REC',
    'NOTIF_ID_VALIDATION', 'NOTIF_ID_VALIDATION_REC', 'NOTIF_ID_DUAL_SHIFT_BASE',
    'LOCAL_DUAL_SHIFT_NOTIF_IDS', 'LOCAL_NOTIF_IDS',
  ];
  const constChunks = constNames.map((n) => extractDeclaration(source, n));
  const body = `${constChunks.join('\n\n')}\n\n${chunks.join('\n\n')}\n\nreturn { oneSignalHandle, bindOneSignalIdentity, clearOneSignalIdentity, disablePushForCurrentUser, cancelAllLocalNotifications };`;
  const factory = new Function('ONESIGNAL_APP_ID', 'window', 'App', 'DB', 'stamp', body);
  return factory;
}
