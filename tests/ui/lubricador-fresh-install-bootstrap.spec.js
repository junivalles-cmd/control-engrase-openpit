import { LUBRICATION_FOLLOW_UP_APP_NAMES } from '../helpers/lubricationFollowUpFixture.js';
// tests/ui/lubricador-fresh-install-bootstrap.spec.js
//
// Fix 2026-10-09 ("FIX FRESH INSTALL / FALSE NO_CREW_ASSIGNED") — bug real:
// una instalación nueva en una tablet nueva mostraba "Sin cuadrilla
// autorizada" aunque el usuario SÍ tiene membership en el backend. Causa
// raíz trazada en código (nunca asumida): boot() dispara
// Sync.runAutoCycle() SIN esperarlo y sigue directo a bootLubricador() →
// renderLubricadorHome() — ese primer render corre con IndexedDB todavía
// vacío, así que scope.kind === 'NO_CREW_ASSIGNED' en ese instante es
// indistinguible de un usuario REALMENTE sin cuadrilla.
//
// Carga renderLubricadorHome() REAL (mismo patrón que
// lubricador-mi-turno-real-execution.spec.js) con DB/Sync reemplazados por
// stores controlables en memoria, y la EJECUTA de verdad contra los 3
// estados de bootstrap (Sincronizando/Falló/Sin cuadrilla real) — nunca un
// patrón de texto aislado.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import {
  APP_JS_PATH, SHIFTS_JS_PATH, LUBRICATION_STATUS_JS_PATH,
  OPERATIONAL_SCOPE_JS_PATH, GREASE_VALIDATION_JS_PATH,
} from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

const appSource = readSource(APP_JS_PATH);
const shiftsSource = readSource(SHIFTS_JS_PATH);
const statusSource = readSource(LUBRICATION_STATUS_JS_PATH);
const scopeSource = readSource(OPERATIONAL_SCOPE_JS_PATH);
const validationSource = readSource(GREASE_VALIDATION_JS_PATH);

const shiftsSrc = extractDeclaration(shiftsSource, 'currentShiftId');
const statusNames = ['fmt', 'WEEKDAY_NAMES', 'mostRecentAssignedDate', 'weekdayStatusFor', 'statusFor'];
const statusSrc = statusNames.map(n => extractDeclaration(statusSource, n)).join('\n\n');
const scopeNames = [
  'EXECUTION_TYPE', 'ASSIGNMENT_STATUS', 'EXECUTION_COMPLETENESS', 'resolveRecordExecutionType',
  'resolveRecordCompleteness', 'findCarriedOverSkipForToday', 'ROLES_CREW_SCOPED', 'getAuthorizedCrews',
  'resolveDefaultCrewForLocation', 'resolveCrewLocationCoverage', 'resolveOperationalScope', 'classifyEquipmentWork', 'equiposForLubricadorMatriz', 'computeOccurrenceKey',
  'toISODateUTCLocal', 'operationalDateForShift', 'REQUIRED_SHIFT_IDS', 'previousShiftOccurrence',
];
const scopeSrc = scopeNames.map(n => extractDeclaration(scopeSource, n)).join('\n\n');
const validationNames = [
  'VALIDATION_STATUS', 'VALIDATION_BADGE', 'GREASE_VALIDATION_ENABLED_FROM', 'MAX_VALIDATION_SHIFTS',
  'isRecordSubjectToValidation', 'statusForSignerRole', 'findActiveValidations', 'hasValidationConflict',
  'findActiveValidation', 'shiftKindAt', 'shiftDurationHours', 'shiftWindowStart', 'validationDeadline',
  'isValidationExpired', 'validationStatusFor', 'validationStatusForRecord', 'isRecordPendingValidation',
  'isRecordValidationExpired', 'isRecordInConflict',
];
const validationSrc = validationNames.map(n => extractDeclaration(validationSource, n)).join('\n\n');
const appNames = [
  '$', '$$', 'esc', 'ic', 'todayDateISO', 'STATUS_COLOR', 'GREASE_UNIT', 'NO_EXECUTION_REASON_LABELS',
  'colorLegendHTML', 'validationBadgeHTML', 'computeAllStatuses', 'getSelectedCrewId', 'setSelectedCrewId',
  'getCurrentOperationalScope', 'loadAssignmentContext', 'equipoOccurrenceKey', 'crewCoveragePresentation', ...LUBRICATION_FOLLOW_UP_APP_NAMES, 'renderLubricadorHome',
  // Fix 2026-10-17 ("BOOTSTRAP HANG EN ERROR"): reales, nunca reimplementados
  // — necesarios para el test que dispara onSyncStateChange() de verdad.
  'onSyncStateChange', 'updateConnBadge', 'redibujarPantallaActual',
];
const appSrc = appNames.map(n => extractDeclaration(appSource, n)).join('\n\n');

const LOCATIONS = [{ id: 'l1', name: 'Rajo Principal' }];

// `cfg` es exactamente lo que persiste DB.getConfig() (app_config, store
// 'sync') — `cfg.lastPull` solo existe tras un pullAll() exitoso
// (sync.js), nunca antes. `null`/sin `lastPull` = "nunca hubo pull exitoso
// en este dispositivo", la señal real que usa el fix.
// `shell`: envuelve #app-content en <div class="lub-shell"> — igual que el
// DOM real de bootLubricador() (app.js). Por defecto false (no afecta a
// ningún test existente); solo lo necesita el test de onSyncStateChange()
// real de abajo, porque redibujarPantallaActual() (app.js) decide su
// camino real mirando `document.querySelector('.lub-shell')` — sin esto
// tomaría la rama "no soy Lubricador" (navigate(), un stub no-op aquí) y
// nunca llegaría a renderLubricadorHome({silent:true}).
async function bootPage(page, { cuadrillas = [], cfg = null, syncState = { status: 'idle' }, shell = false, selectedCrewId = '' } = {}) {
  await page.route('**/__bootstrap_fixture', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto('/__bootstrap_fixture');
  await page.evaluate(crewId => {
    localStorage.removeItem('engrase_session_crew');
    if (crewId) localStorage.setItem('engrase_session_crew', JSON.stringify({ userId: 'lub1', crewId }));
  }, selectedCrewId);
  await page.setContent(shell ? '<div class="lub-shell"><div id="app-content"></div></div>' : '<div id="app-content"></div>');
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.App = {
        route: 'turno', currentUser: { id: 'lub1', name: 'Lubricador de prueba', role: 'LUBRICADOR' },
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18, complianceTarget: 85 },
        _lubBootstrapRetrying: false,
      };
      let lastSyncState = ${JSON.stringify(syncState)};
      let _syncWatchdogTimer = null;
      ${extractDeclaration(appSource, 'armSyncWatchdog')}
      window.updateTareasMensajesNavBadge = () => {};
      window.navigate = () => {};
      window.renderAnomalias = () => {}; window.renderLubricadorHistorial = () => {};
      // redibujarPantallaActual() (app.js) construye su tabla "pintar" evaluando
      // TODAS las funciones del objeto de una vez (object literal) — igual que
      // navigate(), revienta con ReferenceError si falta una, aunque la ruta
      // activa sea 'turno'. 'tareas-mensajes' se agregó a esa tabla en el lote
      // "Tareas y Mensajes" (2026-10-18) y nunca se reflejó aquí — ESE
      // ReferenceError (atrapado en silencio por el try/catch de
      // redibujarPantallaActual(), nunca reportado) era la causa real de
      // "BOOTSTRAP HANG EN ERROR" en este test, no un bug de app.js (root
      // cause real cerrado 2026-10-19, ver CLAUDE.md/reporte de la tarea).
      window.renderTareasYMensajes = () => {};
      window.openModal = () => {}; window.closeModal = () => {};
      window.openAnomalyForm = () => {}; window.openQrScanner = () => {};
      window.openOutOfPlanEquipmentPicker = () => {}; window.openLubricadorMatrizModal = () => {};
      window.openEquipmentDetail = () => {}; window.startLubricadorGreaseFlow = () => {};
      window.openValidationDetailModal = () => {}; window.refreshPushTokenCrewScope = async () => {};
      window.updateLubricadorWidgetSnapshot = () => {};
      window.__mockData = {
        equipment: [], locations: ${JSON.stringify(LOCATIONS)}, cuadrillas: ${JSON.stringify(cuadrillas)},
        lubrication_plans: [], lubrication_records: [], lubrication_skips: [],
        lubrication_assignments: [], grease_validations: [],
      };
      window.__mockCfg = ${JSON.stringify(cfg)};
      // Punto G del pedido ("sin writes/delete a crews/memberships
      // provocados por DB local vacía"): DB.put/DB.delete NUNCA se definen
      // en este stub — si alguna rama de las 3 pantallas de bootstrap
      // intentara escribir o borrar algo, lanzaría un pageerror real
      // (capturado por los tests de abajo con errors.toEqual([])), nunca
      // pasaría desapercibido.
      window.DB = {
        all: async (store) => window.DB.allActive(store), allActive: async (store) => window.__mockData[store] || [],
        getConfig: async () => window.__mockCfg,
      };
      // Sync.fullSync() real NUNCA se reimplementa aquí — este stub solo
      // delega a window.__fullSyncImpl, que cada test controla desde afuera
      // (igual que el resto de este archivo nunca reimplementa lógica de
      // negocio, solo sustituye el I/O real por algo observable).
      window.__fullSyncImpl = async () => {};
      // Fix 2026-10-17 ("RACE BOOTSTRAP/SCOPE"): renderLubricadorHome() real
      // ya NO lee DB.getConfig().lastPull directamente — su ÚNICO gate de
      // bootstrap es Sync.getAccountSyncState().bootstrapComplete (ver
      // app.js). Este stub lo deriva de window.__mockCfg.lastPull (mismo
      // significado que siempre tuvo ese parámetro en este archivo: "hubo
      // un pull exitoso"), reevaluado en vivo en cada llamada — permite que
      // los tests (p.ej. E) muten __mockCfg a mitad de camino, igual que ya
      // hacían antes de este fix.
      window.Sync = { syncing: false, fullSync: () => window.__fullSyncImpl(),
        getAccountSyncState: async () => ({ bootstrapComplete: !!(window.__mockCfg && window.__mockCfg.lastPull) }) };
      ${shiftsSrc}
      ${statusSrc}
      ${scopeSrc}
      ${validationSrc}
      ${appSrc}
      window.currentShiftId = currentShiftId;
      // UX CAMPO V2 (2026-10-24): los 3 acordeones de Mi Turno nacen
      // colapsados — se expanden automáticamente tras cada render
      // (idempotente; no-op mientras la pantalla siga en los estados de
      // bootstrap, que no tienen acordeones) para no romper la
      // cobertura de este archivo, ajena a la interacción propia del
      // acordeón.
      renderLubricadorHome = (() => {
        const real = renderLubricadorHome;
        return async (...args) => {
          const result = await real(...args);
          document.querySelectorAll('.lub-accordion-panel').forEach(p => { p.hidden = false; });
          document.querySelectorAll('.lub-accordion-head').forEach(b => b.setAttribute('aria-expanded', 'true'));
          return result;
        };
      })();
      window.renderLubricadorHome = renderLubricadorHome;
      window.onSyncStateChange = onSyncStateChange;
      window.redibujarPantallaActual = redibujarPantallaActual;
      window.lastSyncState = lastSyncState;
    `,
  });
}

test('A — fresh install, IndexedDB vacío, sync en curso → "Sincronizando datos…", NUNCA "Sin cuadrilla autorizada"', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  await bootPage(page, { cuadrillas: [], cfg: { url: 'https://x.supabase.co', anonKey: 'k' }, syncState: { status: 'syncing' } });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(page.locator('#app-content')).toContainText('Sincronizando datos…');
  await expect(page.locator('#app-content')).toContainText('Cargando tu asignación de trabajo.');
  await expect(page.locator('#app-content')).not.toContainText('Sin cuadrilla autorizada');
  await expect(page.locator('#app-content')).not.toContainText('No se pudo cargar');
});

test('B — fresh install, sync exitoso, 1 membership real → Mi Turno con la cuadrilla correcta, nunca pantalla de bootstrap', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const cuadrillas = [{ id: 'crew1', name: 'Cuadrilla A', active: true, locationId: 'l1', isDefault: true, memberUserIds: ['lub1'] }];
  await bootPage(page, { cuadrillas, cfg: { url: 'x', anonKey: 'k', lastPull: '2026-10-09T00:00:00.000Z' }, syncState: { status: 'ok', pulled: 5 } });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(page.locator('#app-content')).not.toContainText('Sin cuadrilla autorizada');
  await expect(page.locator('#app-content')).not.toContainText('Sincronizando datos…');
  // Con 1 sola cuadrilla autorizada, Mi Turno se auto-selecciona sin pedir
  // confirmación (ver operational-scope.js) — nunca el selector.
  await expect(page.locator('.crew-select-btn')).toHaveCount(0);
  await expect(page.locator('.lub-turno-header')).toBeVisible(); // pantalla real de Mi Turno, no la de bootstrap
  await expect(page.locator('#app-content')).toContainText('Cuadrilla A');
});

test('C — fresh install, sync exitoso, 0 memberships → "Sin cuadrilla autorizada" (caso real, no instalación nueva)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  await bootPage(page, { cuadrillas: [], cfg: { url: 'x', anonKey: 'k', lastPull: '2026-10-09T00:00:00.000Z' }, syncState: { status: 'ok', pulled: 3 } });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(page.locator('#app-content')).toContainText('Sin cuadrilla autorizada');
  await expect(page.locator('#app-content')).not.toContainText('Sincronizando datos…');
});

test('D — fresh install, el primer sync falla → "No se pudo cargar tu asignación de trabajo." + botón Reintentar', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  await bootPage(page, { cuadrillas: [], cfg: { url: 'x', anonKey: 'k' }, syncState: { status: 'backend_unreachable', message: 'fetch failed' } });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(page.locator('#app-content')).toContainText('No se pudo cargar tu asignación de trabajo.');
  await expect(page.locator('#app-content')).toContainText('Verifica la conexión');
  await expect(page.locator('#lub-retry-bootstrap')).toBeVisible();
  await expect(page.locator('#app-content')).not.toContainText('Sin cuadrilla autorizada');
});

test('E — Reintentar (mismo Sync.fullSync real) + sync exitoso → desaparece el error, pasa por "Sincronizando" y termina en Mi Turno con la crew real', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  await bootPage(page, { cuadrillas: [], cfg: { url: 'x', anonKey: 'k' }, syncState: { status: 'backend_unreachable' } });
  await page.evaluate(() => window.renderLubricadorHome());
  await expect(page.locator('#lub-retry-bootstrap')).toBeVisible();

  // Controla el momento exacto en que termina el "Sync.fullSync()" real —
  // nunca un sync alternativo: el botón real llama exactamente a
  // Sync.fullSync(), este test solo decide cuándo resuelve esa promesa.
  await page.evaluate(() => {
    window.__fullSyncResolve = null;
    window.__fullSyncImpl = () => new Promise((resolve) => { window.__fullSyncResolve = resolve; });
  });
  await page.click('#lub-retry-bootstrap');

  // Mientras la promesa de Sync.fullSync() sigue pendiente: vuelve a
  // "Sincronizando" de inmediato (§2 del pedido), nunca se queda mostrando
  // el error viejo.
  await expect(page.locator('#app-content')).toContainText('Sincronizando datos…');
  await expect(page.locator('#app-content')).not.toContainText('No se pudo cargar');

  // Resuelve el sync simulando EXACTAMENTE lo que pullAll()/notify('ok')
  // reales habrían dejado: cfg.lastPull avanza y la cuadrilla real ya está
  // en IndexedDB — nunca una segunda implementación de sync, solo el
  // efecto que el real ya deja.
  await page.evaluate(() => {
    window.__mockCfg = { url: 'x', anonKey: 'k', lastPull: '2026-10-09T00:00:01.000Z' };
    window.__mockData.cuadrillas = [{ id: 'crew1', name: 'Cuadrilla A', active: true, locationId: 'l1', isDefault: true, memberUserIds: ['lub1'] }];
    window.lastSyncState.status = 'ok';
    window.__fullSyncResolve();
  });

  await expect(page.locator('#app-content')).not.toContainText('No se pudo cargar');
  await expect(page.locator('#app-content')).not.toContainText('Sincronizando datos…');
  // 1 sola cuadrilla autorizada: auto-selecciona, sin selector.
  await expect(page.locator('.lub-turno-header')).toBeVisible();
  await expect(page.locator('#app-content')).toContainText('Cuadrilla A');
  expect(errors).toEqual([]);
});

test('E2 — Reintentar y el sync vuelve a fallar → se mantiene el estado de error (nunca spinner infinito, nunca duplica el botón)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  await bootPage(page, { cuadrillas: [], cfg: { url: 'x', anonKey: 'k' }, syncState: { status: 'backend_unreachable' } });
  await page.evaluate(() => window.renderLubricadorHome());
  await expect(page.locator('#lub-retry-bootstrap')).toBeVisible();

  await page.evaluate(() => {
    window.__fullSyncResolve = null;
    window.__fullSyncImpl = () => new Promise((resolve) => { window.__fullSyncResolve = resolve; });
  });
  await page.click('#lub-retry-bootstrap');
  await expect(page.locator('#app-content')).toContainText('Sincronizando datos…');

  // El segundo intento también falla — mismo contrato REAL de Sync.fullSync()
  // (sync.js): su propio try/catch interno atrapa cualquier error y SIEMPRE
  // resuelve (nunca rechaza), comunicando el fallo solo vía notify()
  // actualizando lastSyncState — nunca una promesa rechazada. Simular un
  // reject aquí habría probado un contrato que fullSync() real no tiene.
  await page.evaluate(() => {
    window.lastSyncState.status = 'backend_unreachable';
    window.__fullSyncResolve();
  });

  await expect(page.locator('#app-content')).toContainText('No se pudo cargar tu asignación de trabajo.');
  await expect(page.locator('#lub-retry-bootstrap')).toBeVisible();
  await expect(page.locator('#app-content')).not.toContainText('Sincronizando datos…');
  await expect(page.locator('#app-content')).not.toContainText('Sin cuadrilla autorizada');
  // Nunca dos botones Reintentar acumulados de renders superpuestos.
  await expect(page.locator('#lub-retry-bootstrap')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('A2 — fresh install SIN internet desde el arranque (nunca hubo pull) → explica que necesita conexión inicial, nunca inventa datos ni cierra sesión', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  // Distinto de F (ya tiene caché válida de una sesión anterior): aquí
  // jamás hubo un pull exitoso en este dispositivo (sin cfg.lastPull) y el
  // estado real de sync es 'offline' — nunca se debe confundir con "Sin
  // cuadrilla autorizada" (eso exige haber podido CONSULTAR el backend).
  await bootPage(page, { cuadrillas: [], cfg: { url: 'x', anonKey: 'k' }, syncState: { status: 'offline' } });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(page.locator('#app-content')).toContainText('No se pudo cargar tu asignación de trabajo.');
  await expect(page.locator('#lub-retry-bootstrap')).toBeVisible();
  await expect(page.locator('#app-content')).not.toContainText('Sin cuadrilla autorizada');
  await expect(page.locator('#app-content')).not.toContainText('Sincronizando datos…');
  // La sesión Auth sigue disponible: nada en este camino toca login/logout —
  // confirmado leyendo renderLubricadorHome()/onSyncStateChange() (sin
  // llamadas a logout()/signOut() en ningún punto de este archivo), y aquí
  // además se confirma que App.currentUser (la sesión real) nunca se borra.
  const currentUserIntact = await page.evaluate(() => !!window.App.currentUser && window.App.currentUser.id === 'lub1');
  expect(currentUserIntact).toBe(true);
});

test('F — dispositivo con pull previo exitoso + offline ahora + cache local válida → sigue usando la crew local, NUNCA una pantalla falsa de bootstrap', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const cuadrillas = [{ id: 'crew1', name: 'Cuadrilla A', active: true, locationId: 'l1', isDefault: true, memberUserIds: ['lub1'] }];
  // cfg.lastPull YA existe (pull previo de una sesión anterior) — el
  // dispositivo está offline AHORA (lastSyncState refleja eso), pero el
  // fix es específico de "cache inicial vacía", nunca de "offline en
  // general" (§4 del pedido).
  await bootPage(page, { cuadrillas, selectedCrewId: 'crew1', cfg: { url: 'x', anonKey: 'k', lastPull: '2026-10-01T00:00:00.000Z' }, syncState: { status: 'offline' } });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(page.locator('#app-content')).not.toContainText('Sincronizando datos…');
  await expect(page.locator('#app-content')).not.toContainText('No se pudo cargar');
  await expect(page.locator('#app-content')).not.toContainText('Sin cuadrilla autorizada');
  await expect(page.locator('.lub-turno-header')).toBeVisible();
  await expect(page.locator('#app-content')).toContainText('Cuadrilla A');
});

test('G — ninguno de los 3 estados de bootstrap escribe o borra cuadrillas/memberships solo porque IndexedDB está vacío (DB.put/DB.delete nunca se invocan)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  // Cada escenario navega a about:blank primero — bootPage() inyecta `let
  // lastSyncState` a nivel de script; sin una navegación real de por
  // medio, el 2do addScriptTag() en la MISMA página chocaría con la
  // declaración anterior (realm no reseteado por page.setContent() solo).
  for (const syncState of [{ status: 'idle' }, { status: 'syncing' }, { status: 'backend_unreachable' }]) {
    await page.goto('about:blank');
    await bootPage(page, { cuadrillas: [], cfg: { url: 'x', anonKey: 'k' }, syncState });
    await page.evaluate(() => window.renderLubricadorHome());
  }
  // Caso real (no instalación nueva): tampoco escribe nada al confirmar
  // "sin cuadrilla" de verdad.
  await page.goto('about:blank');
  await bootPage(page, { cuadrillas: [], cfg: { url: 'x', anonKey: 'k', lastPull: '2026-10-09T00:00:00.000Z' }, syncState: { status: 'ok' } });
  await page.evaluate(() => window.renderLubricadorHome());

  // window.DB nunca definió put/delete (ver bootPage) — si alguna rama
  // hubiera intentado escribir, esto habría sido un pageerror real.
  expect(errors).toEqual([]);
});

// ============================================================
// Fix 2026-10-17 ("RACE BOOTSTRAP/SCOPE EN MI TURNO") — bug real reportado:
// un LUBRICADOR AUTHORIZED/CREW_SCOPED con 2+ cuadrillas válidas en el
// backend (RLS funcionando, cuadrillas/ubicaciones correctas) podía ver
// "Sin cuadrilla autorizada" o nunca el selector de 2+ cuadrillas en una
// instalación nueva. Causa: scope.kind === 'NO_CREW_ASSIGNED' se combinaba
// con !accountBootstrap.bootstrapComplete en una misma condición
// (app.js, antes de este fix), y el `scope` usado para decidir
// NEEDS_CREW_SELECTION/NO_CREW_ASSIGNED se calculaba ANTES de confirmar
// bootstrap, sin recalcularse después. Estos tests cubren exactamente los
// 6 escenarios pedidos — nunca solo el de 0/1 cuadrilla ya cubierto arriba.
// ============================================================

const DOS_CUADRILLAS = [
  { id: 'crew1', name: 'Cuadrilla A', active: true, locationId: 'l1', isDefault: true, memberUserIds: ['lub1'] },
  { id: 'crew2', name: 'Cuadrilla B', active: true, locationId: 'l1', memberUserIds: ['lub1'] },
];

test('RACE-A — instalación nueva, bootstrap incompleto + 2 cuadrillas ya en IndexedDB → NUNCA "Sin cuadrilla autorizada" ni el selector todavía (hay que esperar a que termine)', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e));
  // Las 2 cuadrillas YA están en IndexedDB (p.ej. llegaron en la primera
  // página del pull), pero el bootstrap como un todo no se confirmó
  // todavía (sin cfg.lastPull) — ni "sin cuadrilla" ni el selector deben
  // afirmarse con datos todavía no confirmados.
  await bootPage(page, { cuadrillas: DOS_CUADRILLAS, cfg: { url: 'x', anonKey: 'k' }, syncState: { status: 'syncing' } });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(page.locator('#app-content')).toContainText('Sincronizando datos…');
  await expect(page.locator('#app-content')).not.toContainText('Sin cuadrilla autorizada');
  await expect(page.locator('#app-content')).not.toContainText('Elige tu cuadrilla de trabajo');
});

test('RACE-B — bootstrap pasa de incompleto a completo durante el arranque → el siguiente render recalcula el scope fresco (2 cuadrillas reales → selector, nunca "sin cuadrilla")', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e));
  await bootPage(page, { cuadrillas: [], cfg: { url: 'x', anonKey: 'k' }, syncState: { status: 'syncing' } });
  await page.evaluate(() => window.renderLubricadorHome());
  await expect(page.locator('#app-content')).toContainText('Sincronizando datos…');

  // El bootstrap "termina" entre un render y el siguiente — mismo efecto
  // real que pullAll()/notify('ok') habrían dejado: cfg.lastPull avanza y
  // las cuadrillas reales ya están en IndexedDB.
  await page.evaluate((cuadrillas) => {
    window.__mockCfg = { url: 'x', anonKey: 'k', lastPull: '2026-10-17T00:00:00.000Z' };
    window.__mockData.cuadrillas = cuadrillas;
    window.lastSyncState.status = 'ok';
    return window.renderLubricadorHome();
  }, DOS_CUADRILLAS);

  expect(errors).toEqual([]);
  await expect(page.locator('#app-content')).toContainText('Elige tu cuadrilla de trabajo');
  await expect(page.locator('.crew-select-btn')).toHaveCount(2);
  await expect(page.locator('#app-content')).not.toContainText('Sin cuadrilla autorizada');
});

test('RACE-C — bootstrap completo + 2 cuadrillas sin selección válida → NEEDS_CREW_SELECTION (selector visible con ambas)', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e));
  await bootPage(page, { cuadrillas: DOS_CUADRILLAS, cfg: { url: 'x', anonKey: 'k', lastPull: '2026-10-17T00:00:00.000Z' }, syncState: { status: 'ok', pulled: 2 } });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(page.locator('#app-content')).toContainText('Elige tu cuadrilla de trabajo');
  await expect(page.locator('.crew-select-btn', { hasText: 'Cuadrilla A' })).toBeVisible();
  await expect(page.locator('.crew-select-btn', { hasText: 'Cuadrilla B' })).toBeVisible();
  await expect(page.locator('#app-content')).not.toContainText('Sin cuadrilla autorizada');
});

test('RACE-D — bootstrap completo + 1 cuadrilla → auto-selecciona directo a Mi Turno, sin selector', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e));
  const cuadrillas = [{ id: 'crew1', name: 'Cuadrilla Única', active: true, locationId: 'l1', isDefault: true, memberUserIds: ['lub1'] }];
  await bootPage(page, { cuadrillas, cfg: { url: 'x', anonKey: 'k', lastPull: '2026-10-17T00:00:00.000Z' }, syncState: { status: 'ok', pulled: 1 } });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(page.locator('#app-content')).not.toContainText('Elige tu cuadrilla de trabajo');
  await expect(page.locator('#app-content')).not.toContainText('Sin cuadrilla autorizada');
  await expect(page.locator('.lub-turno-header')).toBeVisible();
  await expect(page.locator('#app-content')).toContainText('Cuadrilla Única');
});

test('RACE-E — bootstrap completo + 0 cuadrillas → NO_CREW_ASSIGNED real ("Sin cuadrilla autorizada")', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e));
  await bootPage(page, { cuadrillas: [], cfg: { url: 'x', anonKey: 'k', lastPull: '2026-10-17T00:00:00.000Z' }, syncState: { status: 'ok', pulled: 0 } });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(page.locator('#app-content')).toContainText('Sin cuadrilla autorizada');
  await expect(page.locator('#app-content')).not.toContainText('Sincronizando datos…');
  await expect(page.locator('#app-content')).not.toContainText('Elige tu cuadrilla de trabajo');
});

test('RACE-F — authorizedCrewIds vacío al principio y poblado recién después (varios ticks intermedios) → la UI nunca concluye nada intermedio, termina en el scope correcto (2 cuadrillas → selector)', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e));
  // Paso 1: "authorizedCrewIds" todavía vacío (simulado: cuadrillas=[]
  // localmente, aunque el backend ya las tenga) + bootstrap incompleto.
  await bootPage(page, { cuadrillas: [], cfg: { url: 'x', anonKey: 'k' }, syncState: { status: 'syncing' } });
  await page.evaluate(() => window.renderLubricadorHome());
  await expect(page.locator('#app-content')).toContainText('Sincronizando datos…');
  await expect(page.locator('#app-content')).not.toContainText('Sin cuadrilla autorizada');

  // Paso 2: otro tick del MISMO estado todavía incompleto — nunca debe
  // "adelantarse" a concluir nada mientras siga sin confirmar.
  await page.evaluate(() => window.renderLubricadorHome());
  await expect(page.locator('#app-content')).toContainText('Sincronizando datos…');
  await expect(page.locator('#app-content')).not.toContainText('Sin cuadrilla autorizada');
  await expect(page.locator('#app-content')).not.toContainText('Elige tu cuadrilla de trabajo');

  // Paso 3: ahora sí termina — authorizedCrewIds ya poblado (cuadrillas
  // reales disponibles) + bootstrapComplete.
  await page.evaluate((cuadrillas) => {
    window.__mockCfg = { url: 'x', anonKey: 'k', lastPull: '2026-10-17T00:00:00.000Z' };
    window.__mockData.cuadrillas = cuadrillas;
    window.lastSyncState.status = 'ok';
    return window.renderLubricadorHome();
  }, DOS_CUADRILLAS);

  expect(errors).toEqual([]);
  await expect(page.locator('#app-content')).toContainText('Elige tu cuadrilla de trabajo');
  await expect(page.locator('.crew-select-btn')).toHaveCount(2);
});

// ============================================================
// Fix 2026-10-17 ("BOOTSTRAP HANG EN ERROR") — bug real confirmado en
// dispositivo (tablet Samsung SM-X135G): un pull que falla repetidamente
// (500 del backend) dejaba Mi Turno congelado para siempre en
// "Sincronizando…", aunque lastSyncState.status ya reflejara 'error' en
// memoria — porque nada volvía a llamar renderLubricadorHome(). Este test
// dispara onSyncStateChange() REAL (el mismo callback real que Sync.notify()
// invoca en producción) con un estado de error, mientras el bootstrap de la
// cuenta sigue incompleto, y confirma que la pantalla SÍ transiciona de
// "Sincronizando…" al estado de error/reintentar — sin llamar
// renderLubricadorHome() manualmente, igual que pasaría en producción.
// ============================================================
test('FIX "BOOTSTRAP HANG EN ERROR": onSyncStateChange() con un sync que termina en error, mientras el bootstrap sigue incompleto, saca a Mi Turno de "Sincronizando…" hacia "No se pudo cargar" — sin llamar renderLubricadorHome() a mano', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e));

  // Bootstrap incompleto desde el arranque (sin cfg.lastPull) — primer
  // render real, mismo mecanismo que usa boot()/enterAppAsProfile().
  await bootPage(page, { shell: true, cuadrillas: [], cfg: { url: 'x', anonKey: 'k' }, syncState: { status: 'syncing' } });
  await page.evaluate(() => window.renderLubricadorHome());
  await expect(page.locator('#app-content')).toContainText('Sincronizando datos…');
  await expect(page.locator('#app-content')).not.toContainText('No se pudo cargar');

  // El sync real TERMINA en error (nunca 'ok') — exactamente lo que
  // Sync.notify() habría llamado en producción tras el 500. Se dispara
  // onSyncStateChange() de verdad, SIN tocar el DOM ni llamar
  // renderLubricadorHome() manualmente desde el test.
  await page.evaluate(() => window.onSyncStateChange({ status: 'error', message: 'Error al descargar cambios: 500' }));

  await expect(page.locator('#app-content')).toContainText('No se pudo cargar tu asignación de trabajo.');
  await expect(page.locator('#lub-retry-bootstrap')).toBeVisible();
  await expect(page.locator('#app-content')).not.toContainText('Sincronizando datos…');
  await expect(page.locator('#app-content')).not.toContainText('Sin cuadrilla autorizada');
  expect(errors).toEqual([]);
});

test('FIX "BOOTSTRAP HANG EN ERROR": una vez bootstrapComplete es true, un error de sync NO vuelve a mostrar las pantallas de bootstrap (ya se usa el camino normal de arriba)', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e));

  const cuadrillas = [{ id: 'crew1', name: 'Cuadrilla A', active: true, locationId: 'l1', isDefault: true, memberUserIds: ['lub1'] }];
  await bootPage(page, { shell: true, cuadrillas, selectedCrewId: 'crew1', cfg: { url: 'x', anonKey: 'k', lastPull: '2026-10-17T00:00:00.000Z' }, syncState: { status: 'ok', pulled: 1 } });
  await page.evaluate(() => window.renderLubricadorHome());
  await expect(page.locator('.lub-turno-header')).toBeVisible();
  await expect(page.locator('#app-content')).toContainText('Cuadrilla A');

  // Un error de sync DESPUÉS de que el bootstrap ya terminó (p. ej. un
  // incremental normal que falla) nunca debe hacer aparecer las pantallas
  // de bootstrap — Mi Turno real se queda tal cual (comportamiento normal
  // del fix anterior "ELIMINAR PARPADEO EN SYNC INCREMENTAL", sin cambios).
  await page.evaluate(() => window.onSyncStateChange({ status: 'error', message: 'Error al descargar cambios: 500' }));

  await expect(page.locator('.lub-turno-header')).toBeVisible();
  await expect(page.locator('#app-content')).not.toContainText('Sincronizando datos…');
  await expect(page.locator('#app-content')).not.toContainText('No se pudo cargar');
  expect(errors).toEqual([]);
});
