import { LUBRICATION_FOLLOW_UP_APP_NAMES } from '../helpers/lubricationFollowUpFixture.js';
// tests/ui/lubricador-shell-boot-regression.spec.js
//
// Fix 2026-10-09 ("BLOCKER SOLO EN PERFIL LUBRICADOR") — bug real reportado:
// bootLubricador() dejaba una línea huérfana ($('#btn-logout').addEventListener(...))
// de cuando "Cerrar sesión" vivía en el header del Lubricador. El botón se
// quitó del template (se movió a Mi Cuenta), pero esa línea de wiring quedó
// sin su elemento — $('#btn-logout') devuelve null y
// null.addEventListener() revienta de forma SÍNCRONA dentro de
// bootLubricador(), ANTES de wireQuickFind(), del wiring de
// .lub-nav-item y de la llamada final a renderLubricadorHome(). Resultado
// real: header/bottom-nav/badge de sync sí aparecen (ya se insertaron por
// innerHTML antes del throw), pero #app-content queda VACÍO (nunca se llama
// renderLubricadorHome()) y ningún botón responde (sus listeners nunca se
// adjuntaron). Administrador nunca se vio afectado: boot() tiene su propio
// shell/wiring separado, con su propio #btn-logout real e intacto.
//
// Carga bootLubricador() REAL (no un stub) — este test debe reventar con el
// bug (HEAD 4022c4fa1f918d7eb1a3e6fce48bd6ae6ec9540c) y pasar con el fix.

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
const statusSrc = statusNames.map((n) => extractDeclaration(statusSource, n)).join('\n\n');
const scopeNames = [
  'EXECUTION_TYPE', 'ASSIGNMENT_STATUS', 'EXECUTION_COMPLETENESS', 'resolveRecordExecutionType',
  'resolveRecordCompleteness', 'findCarriedOverSkipForToday', 'ROLES_CREW_SCOPED', 'getAuthorizedCrews',
  'resolveDefaultCrewForLocation', 'resolveCrewLocationCoverage', 'resolveOperationalScope', 'classifyEquipmentWork', 'equiposForLubricadorMatriz',
  'computeOccurrenceKey', 'toISODateUTCLocal',
];
const scopeSrc = scopeNames.map((n) => extractDeclaration(scopeSource, n)).join('\n\n');
const validationNames = [
  'VALIDATION_STATUS', 'VALIDATION_BADGE', 'GREASE_VALIDATION_ENABLED_FROM', 'MAX_VALIDATION_SHIFTS',
  'isRecordSubjectToValidation', 'statusForSignerRole', 'findActiveValidations', 'hasValidationConflict',
  'findActiveValidation', 'shiftKindAt', 'shiftDurationHours', 'shiftWindowStart', 'validationDeadline',
  'isValidationExpired', 'validationStatusFor', 'validationStatusForRecord', 'isRecordPendingValidation',
  'isRecordValidationExpired', 'isRecordInConflict',
];
const validationSrc = validationNames.map((n) => extractDeclaration(validationSource, n)).join('\n\n');
const appNames = [
  '$', '$$', 'esc', 'ic', 'todayDateISO', 'STATUS_COLOR', 'GREASE_UNIT', 'NO_EXECUTION_REASON_LABELS',
  'colorLegendHTML', 'validationBadgeHTML', 'computeAllStatuses', 'getSelectedCrewId',
  'getCurrentOperationalScope', 'loadAssignmentContext', 'equipoOccurrenceKey', 'crewCoveragePresentation', ...LUBRICATION_FOLLOW_UP_APP_NAMES, 'renderLubricadorHome',
  // El shell real — esto es lo que se rompió. openModal/closeModal reales
  // (nunca un stub no-op) para que el modal de "Mi cuenta" sea verificable.
  'openModal', 'closeModal', 'updateConnBadge', 'wireShiftTimer', 'wireQuickFind', 'openLubAccountMenu', 'bootLubricador',
];
const appSrc = appNames.map((n) => extractDeclaration(appSource, n)).join('\n\n');

const LOCATIONS = [{ id: 'l1', name: 'Rajo Principal' }];
const CREW = [{ id: 'crew1', name: 'Cuadrilla A', active: true, locationId: 'l1', isDefault: true, memberUserIds: ['lub1'] }];

function weekdayName(d) {
  return ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][d.getDay()];
}

async function bootShell(page) {
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => errors.push(e.stack || e.message || String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.setContent('<div></div>');
  await page.addStyleTag({ path: STYLES_PATH });

  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: '45-77', brand: 'Caterpillar', model: 'D8T', status: 'Operativo', locationId: 'l1', hourmeter: 1200 }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];

  await page.addScriptTag({
    content: `
      window.App = {
        route: 'turno', currentUser: { id: 'lub1', name: 'Lubricador de prueba', role: 'LUBRICADOR' },
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18, complianceTarget: 85 },
      };
      let lastSyncState = { status: 'ok' };
      window.navigate = () => {};
      window.openAnomalyForm = () => {}; window.openQrScanner = () => {};
      window.openOutOfPlanEquipmentPicker = () => {}; window.openLubricadorMatrizModal = () => {};
      window.openEquipmentDetail = () => {}; window.startLubricadorGreaseFlow = () => {};
      window.openValidationDetailModal = () => {}; window.refreshPushTokenCrewScope = async () => {};
      window.updateLubricadorWidgetSnapshot = () => {};
      window.handleQrDeepLink = () => {};
      window.wireKeyboardOpenWatcher = () => {};
      window.confirmLogout = () => { window.__confirmLogoutCalled = true; };
      window.Auth = { isSupabaseMode: () => true };
      window.Sync = { pendingCount: async () => 0 };
      // Pantallas fuera de alcance de este bug (sin cambios en este lote) —
      // marcadores reconocibles para probar que el wiring de .lub-nav-item
      // SÍ despacha a cada una, sin extraer sus cuerpos reales/enormes.
      window.renderAnomalias = () => { document.querySelector('#app-content').innerHTML = '<div id="marker-anomalias">ANOMALIAS</div>'; };
      window.renderLubricadorHistorial = () => { document.querySelector('#app-content').innerHTML = '<div id="marker-historial">HISTORIAL</div>'; };
      window.renderAyuda = () => { document.querySelector('#app-content').innerHTML = '<div id="marker-ayuda">AYUDA</div>'; };
      window.__mockData = {
        equipment: ${JSON.stringify(equipos)},
        locations: ${JSON.stringify(LOCATIONS)},
        cuadrillas: ${JSON.stringify(CREW)},
        lubrication_plans: ${JSON.stringify(plans)},
        lubrication_records: [],
        lubrication_skips: [],
        lubrication_assignments: [],
        grease_validations: [],
      };
      window.DB = {
        all: async (store) => window.DB.allActive(store), allActive: async (store) => window.__mockData[store] || [],
        getConfig: async () => ({ lastPull: Date.now() }),
      };
      ${shiftsSrc}
      ${statusSrc}
      ${scopeSrc}
      ${validationSrc}
      ${appSrc}
      window.currentShiftId = currentShiftId;
      window.bootLubricador = bootLubricador;
      window.lastSyncState = lastSyncState;
    `,
  });

  await page.evaluate(() => window.bootLubricador());
  await page.waitForTimeout(250);
  return { errors, consoleErrors };
}

test('LUBRICADOR: bootLubricador() renderiza el shell completo y Mi Turno, sin pageerrors/console.error', async ({ page }) => {
  const { errors, consoleErrors } = await bootShell(page);
  expect(errors, 'no debe haber pageerror').toEqual([]);
  expect(consoleErrors, 'no debe haber console.error').toEqual([]);

  await expect(page.locator('.lub-topbar')).toBeVisible();
  await expect(page.locator('.lub-bottom-nav')).toBeVisible();
  const html = await page.locator('#app-content').innerHTML();
  expect(html.length, 'el contenido central NUNCA debe quedar vacío').toBeGreaterThan(0);
  await expect(page.locator('.lub-welcome-card')).toBeVisible();
});

test('LUBRICADOR: los 4 botones de navegación inferior SÍ responden (wiring real, no solo presencia en el DOM)', async ({ page }) => {
  const { errors } = await bootShell(page);
  expect(errors).toEqual([]);

  await page.locator('.lub-nav-item[data-route="anomalias"]').click();
  await expect(page.locator('#marker-anomalias')).toBeVisible();

  await page.locator('.lub-nav-item[data-route="historial"]').click();
  await expect(page.locator('#marker-historial')).toBeVisible();

  await page.locator('.lub-nav-item[data-route="ayuda"]').click();
  await expect(page.locator('#marker-ayuda')).toBeVisible();

  await page.locator('.lub-nav-item[data-route="turno"]').click();
  await expect(page.locator('.lub-welcome-card')).toBeVisible();
});

test('LUBRICADOR: "Mi cuenta" (gear) SÍ responde y abre el modal real', async ({ page }) => {
  const { errors } = await bootShell(page);
  expect(errors).toEqual([]);

  await page.locator('#btn-lub-account-menu').click();
  const menu = page.locator('.lub-account-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('#lub-menu-logout')).toContainText('Cerrar sesión');
});
