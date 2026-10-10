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
  'toISODateUTCLocal',
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
  'colorLegendHTML', 'validationBadgeHTML', 'computeAllStatuses', 'getSelectedCrewId',
  'getCurrentOperationalScope', 'loadAssignmentContext', 'equipoOccurrenceKey', 'renderLubricadorHome',
];
const appSrc = appNames.map(n => extractDeclaration(appSource, n)).join('\n\n');

const LOCATIONS = [{ id: 'l1', name: 'Rajo Principal' }];

// `cfg` es exactamente lo que persiste DB.getConfig() (app_config, store
// 'sync') — `cfg.lastPull` solo existe tras un pullAll() exitoso
// (sync.js), nunca antes. `null`/sin `lastPull` = "nunca hubo pull exitoso
// en este dispositivo", la señal real que usa el fix.
async function bootPage(page, { cuadrillas = [], cfg = null, syncState = { status: 'idle' } } = {}) {
  await page.setContent('<div id="app-content"></div>');
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.App = {
        route: 'turno', currentUser: { id: 'lub1', name: 'Lubricador de prueba', role: 'LUBRICADOR' },
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18, complianceTarget: 85 },
        _lubBootstrapRetrying: false,
      };
      let lastSyncState = ${JSON.stringify(syncState)};
      window.navigate = () => {};
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
      window.Sync = { syncing: false, fullSync: () => window.__fullSyncImpl() };
      ${shiftsSrc}
      ${statusSrc}
      ${scopeSrc}
      ${validationSrc}
      ${appSrc}
      window.currentShiftId = currentShiftId;
      window.renderLubricadorHome = renderLubricadorHome;
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
  await expect(page.locator('.lub-kpi-row')).toBeVisible(); // pantalla real de Mi Turno, no la de bootstrap
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
  await expect(page.locator('.lub-kpi-row')).toBeVisible();
  await expect(page.locator('#app-content')).toContainText('Cuadrilla A');
  expect(errors).toEqual([]);
});

test('F — dispositivo con pull previo exitoso + offline ahora + cache local válida → sigue usando la crew local, NUNCA una pantalla falsa de bootstrap', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const cuadrillas = [{ id: 'crew1', name: 'Cuadrilla A', active: true, locationId: 'l1', isDefault: true, memberUserIds: ['lub1'] }];
  // cfg.lastPull YA existe (pull previo de una sesión anterior) — el
  // dispositivo está offline AHORA (lastSyncState refleja eso), pero el
  // fix es específico de "cache inicial vacía", nunca de "offline en
  // general" (§4 del pedido).
  await bootPage(page, { cuadrillas, cfg: { url: 'x', anonKey: 'k', lastPull: '2026-10-01T00:00:00.000Z' }, syncState: { status: 'offline' } });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(page.locator('#app-content')).not.toContainText('Sincronizando datos…');
  await expect(page.locator('#app-content')).not.toContainText('No se pudo cargar');
  await expect(page.locator('#app-content')).not.toContainText('Sin cuadrilla autorizada');
  await expect(page.locator('.lub-kpi-row')).toBeVisible();
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
