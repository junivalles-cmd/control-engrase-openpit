// tests/ui/bug-auth-001-bootstrap-retry.spec.js
//
// BUG-AUTH-001 (continuación) — bug real reportado: un ADMINISTRADOR recién
// creado podía loguearse correctamente (CREATE_USER y LOGIN ambos OK) y
// aun así la UI mostraba "SESIÓN REQUERIDA" tras entrar. Causa raíz
// (app.js): Sync.startAuto() arranca un timer periódico en el boot de la
// página que NUNCA se detiene al cerrar sesión (no existe stopAuto()) —
// sigue disparando fullSync() cada syncIntervalSeconds pase lo que pase.
// Si uno de esos ciclos (típico: uno disparado mientras la pantalla de
// login estaba visible, sin sesión, reportando 'AUTH_REQUIRED'
// legítimamente) sigue en vuelo justo cuando una cuenta NUEVA
// (bootstrapComplete=false — la única que llega a llamar fullSync() desde
// enterAppAsProfile(), un admin ya existente nunca lo hace) termina de
// loguearse, el guard de single-flight de Sync.fullSync() (this.syncing)
// hace que la llamada de bootstrap del login devuelva sin hacer NADA — el
// banner "SESIÓN REQUERIDA" del ciclo anterior queda pegado aunque
// Auth.isAuthenticated() ya sea true. Fix: enterAppAsProfile() reintenta
// hasta 2 veces, re-consultando Sync.getAccountSyncState() entre intentos,
// antes de entrar con un estado híbrido ("reconocido" pero "sin sesión").
//
// Carga enterAppAsProfile()/currentUserFromAuthProfile() REALES de app.js
// (mismo patrón extractDeclaration que el resto de tests/ui/*.spec.js) con
// Sync/Auth/boot reemplazados por stubs controlables — nunca reimplementa
// la lógica bajo prueba.

import { test, expect } from '@playwright/test';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const src = ['currentUserFromAuthProfile', 'enterAppAsProfile'].map(n => extractDeclaration(appSource, n)).join('\n\n');

// `bootstrapSequence`: una entrada por llamada a Sync.getAccountSyncState()
// (la primera, antes de cualquier fullSync(), y una más tras cada intento) —
// simula exactamente lo que el ciclo ajeno en vuelo (o su propia
// finalización) habría dejado en cfg.accountSyncStates en cada momento.
async function bootPage(page, { bootstrapSequence, fullSyncImpl = 'async () => { window.calls.fullSync++; }', authenticatedAfter = () => true }) {
  await page.route('**/__enter_app_fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto('/__enter_app_fixture');
  await page.addScriptTag({
    content: `
      window.App = { currentUser: null };
      window.calls = { fullSync: 0, boot: 0, replayDeeplink: 0 };
      window.bindOneSignalIdentity = () => {};
      window.boot = () => { window.calls.boot++; };
      window.replayPendingDeeplink = () => { window.calls.replayDeeplink++; };
      window._epochDebug = () => {}; // instrumentación TEMP de BUG-AUTH-001, irrelevante para este test
      let __bootstrapSequence = ${JSON.stringify(bootstrapSequence)};
      let __bootstrapIdx = 0;
      let __authOk = true;
      window.Sync = {
        getAccountSyncState: async () => ({ bootstrapComplete: __bootstrapSequence[Math.min(__bootstrapIdx++, __bootstrapSequence.length - 1)] }),
        fullSync: ${fullSyncImpl},
      };
      window.Auth = { isAuthenticated: () => __authOk, getSessionEpoch: () => 0, getSession: () => ({ authUserId: 'fixture' }) };
      window.__setAuthOk = v => { __authOk = v; };
      ${src}
      window.currentUserFromAuthProfile = currentUserFromAuthProfile;
      window.enterAppAsProfile = enterAppAsProfile;
    `,
  });
}

const PROFILE = { appUserId: 'u_nuevoadmin', displayName: 'Nuevo Admin', role: 'ADMINISTRADOR' };

test('A) login normal de cuenta nueva: fullSync() corre UNA vez, confirma bootstrap, boot() se llama — sin reintentos', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e));
  // 1ra lectura (false, antes de sincronizar) -> fullSync corre -> 2da
  // lectura (true, el ciclo propio sí terminó) -> sale del loop.
  await bootPage(page, { bootstrapSequence: [false, true] });
  await page.evaluate(profile => window.enterAppAsProfile(profile), PROFILE);
  const calls = await page.evaluate(() => window.calls);
  expect(calls).toEqual({ fullSync: 1, boot: 1, replayDeeplink: 1 });
  expect(errors).toEqual([]);
});

test('B) ciclo ajeno en vuelo durante el primer intento (fullSync() real no hace nada ese ciclo) -> reintenta y SÍ completa el bootstrap, nunca entra en estado híbrido', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e));
  // Simula el guard de single-flight de Sync.fullSync() real: el primer
  // intento es "tragado" por un ciclo ajeno (this.syncing ya era true) y
  // NO avanza el bootstrap; recién el segundo intento (ciclo ajeno ya
  // terminado) sí corre de verdad y confirma bootstrapComplete.
  await bootPage(page, { bootstrapSequence: [false, false, true] });
  await page.evaluate(profile => window.enterAppAsProfile(profile), PROFILE);
  const calls = await page.evaluate(() => window.calls);
  expect(calls).toEqual({ fullSync: 2, boot: 1, replayDeeplink: 1 }); // 2 intentos, pero SÍ terminó logueado con boot() real
  expect(errors).toEqual([]);
});

test('tope de reintentos: si sigue sin completar bootstrap tras 2 intentos, igual entra a boot() (nunca deja a la persona atascada en una pantalla muerta)', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e));
  await bootPage(page, { bootstrapSequence: [false, false, false] }); // nunca confirma bootstrap
  await page.evaluate(profile => window.enterAppAsProfile(profile), PROFILE);
  const calls = await page.evaluate(() => window.calls);
  expect(calls).toEqual({ fullSync: 2, boot: 1, replayDeeplink: 1 }); // exactamente 2 intentos (tope), igual entra — el banner de sync, no el login, es quien comunica el estado real
  expect(errors).toEqual([]);
});

test('E) admin EXISTENTE (bootstrapComplete ya true desde el primer momento) -> 0 llamadas a fullSync(), entra directo (comparación contra el camino del admin nuevo)', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e));
  await bootPage(page, { bootstrapSequence: [true] });
  await page.evaluate(profile => window.enterAppAsProfile(profile), { ...PROFILE, appUserId: 'u_adminviejo', displayName: 'Admin Viejo' });
  const calls = await page.evaluate(() => window.calls);
  expect(calls).toEqual({ fullSync: 0, boot: 1, replayDeeplink: 1 }); // nunca llama fullSync() — nunca puede chocar con el ciclo ajeno
  expect(errors).toEqual([]);
});

test('si Auth.isAuthenticated() se vuelve false a mitad del reintento, sale de inmediato sin llamar boot() (nunca un estado híbrido "reconocido pero sin sesión")', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e));
  await bootPage(page, {
    bootstrapSequence: [false, false],
    fullSyncImpl: 'async () => { window.calls.fullSync++; window.__setAuthOk(false); }',
  });
  await page.evaluate(profile => window.enterAppAsProfile(profile), PROFILE);
  const calls = await page.evaluate(() => window.calls);
  expect(calls).toEqual({ fullSync: 1, boot: 0, replayDeeplink: 0 }); // se detuvo ANTES de boot() — vuelve a login, nunca un estado a medias
  expect(errors).toEqual([]);
});
