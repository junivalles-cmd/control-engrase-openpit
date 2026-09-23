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
