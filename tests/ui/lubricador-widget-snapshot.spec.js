// tests/ui/lubricador-widget-snapshot.spec.js
//
// Pedido "WIDGET ANDROID + PALETA CORPORATIVA FINAL + MODO SOL"
// (2026-10-09), Parte A — integración real: renderLubricadorHome() (la
// ÚNICA fuente de Atrasados/Mi Turno/Realizados, §4 "NO duplicar lógica en
// Android") REAL, ejecutada contra datos reales dentro de una página real
// de Playwright (mismo mecanismo que lubricador-mi-turno-real-execution.spec.js),
// con window.Capacitor.Plugins.WidgetBridge reemplazado por un espía — su
// implementación nativa real (SharedPreferences/RemoteViews) se verifica
// aparte con un build real de Android (ver REPORTE FINAL de esta sesión),
// nunca con un mock.
//
// Casos A-E del pedido (§20): F/G/H/I son nativos (tap/layout/build) y se
// verifican por revisión de código + build real, no aquí.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import {
  APP_JS_PATH, SHIFTS_JS_PATH, LUBRICATION_STATUS_JS_PATH,
  OPERATIONAL_SCOPE_JS_PATH, GREASE_VALIDATION_JS_PATH,
} from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const WIDGET_SNAPSHOT_JS_PATH = 'CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/widget-snapshot.js';

const appSource = readSource(APP_JS_PATH);
const shiftsSource = readSource(SHIFTS_JS_PATH);
const statusSource = readSource(LUBRICATION_STATUS_JS_PATH);
const scopeSource = readSource(OPERATIONAL_SCOPE_JS_PATH);
const validationSource = readSource(GREASE_VALIDATION_JS_PATH);
const widgetSnapshotSource = readSource(WIDGET_SNAPSHOT_JS_PATH);

const shiftsSrc = extractDeclaration(shiftsSource, 'currentShiftId');
const statusNames = ['fmt', 'WEEKDAY_NAMES', 'mostRecentAssignedDate', 'weekdayStatusFor', 'statusFor'];
const statusSrc = statusNames.map((n) => extractDeclaration(statusSource, n)).join('\n\n');
const scopeNames = [
  'EXECUTION_TYPE', 'ASSIGNMENT_STATUS', 'EXECUTION_COMPLETENESS', 'resolveRecordExecutionType',
  'resolveRecordCompleteness', 'findCarriedOverSkipForToday', 'ROLES_CREW_SCOPED', 'getAuthorizedCrews',
  'resolveDefaultCrewForLocation', 'resolveCrewLocationCoverage', 'resolveOperationalScope', 'classifyEquipmentWork', 'equiposForLubricadorMatriz', 'computeOccurrenceKey',
  'toISODateUTCLocal',
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
  'getCurrentOperationalScope', 'loadAssignmentContext', 'equipoOccurrenceKey', 'renderLubricadorHome',
  'isNative', 'updateLubricadorWidgetSnapshot', 'clearLubricadorWidgetSnapshot', 'logout',
];
const appSrc = appNames.map((n) => extractDeclaration(appSource, n)).join('\n\n');
const widgetSnapshotSrc = extractDeclaration(widgetSnapshotSource, 'buildWidgetSnapshot');

const LOCATIONS = [{ id: 'l1', name: 'Volcán' }];
const CREW = [{ id: 'crew1', name: '76-08', active: true, locationId: 'l1', isDefault: true, memberUserIds: ['lub1'] }];

function weekdayName(d) { return ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][d.getDay()]; }
function isoDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); }

async function bootPage(page, { equipos = [], plans = [], records = [], skips = [], assignments = [], nativePlatform = true } = {}) {
  await page.setContent('<div id="app-content"></div>');
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.App = {
        route: 'turno', currentUser: { id: 'lub1', name: 'Lubricador de prueba', role: 'LUBRICADOR' },
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18, complianceTarget: 85 },
      };
      let lastSyncState = { status: 'ok' };
      window.navigate = () => {};
      window.openModal = () => {}; window.closeModal = () => {};
      window.openAnomalyForm = () => {}; window.openQrScanner = () => {};
      window.openOutOfPlanEquipmentPicker = () => {}; window.openLubricadorMatrizModal = () => {};
      window.openEquipmentDetail = () => {}; window.startLubricadorGreaseFlow = () => {};
      window.openValidationDetailModal = () => {}; window.refreshPushTokenCrewScope = async () => {};
      window.__mockData = {
        equipment: ${JSON.stringify(equipos)},
        locations: ${JSON.stringify(LOCATIONS)},
        cuadrillas: ${JSON.stringify(CREW)},
        lubrication_plans: ${JSON.stringify(plans)},
        lubrication_records: ${JSON.stringify(records)},
        lubrication_skips: ${JSON.stringify(skips)},
        lubrication_assignments: ${JSON.stringify(assignments)},
        grease_validations: [],
      };
      window.DB = { getConfig: async () => ({ lastPull: 'fixture-pulled' }), all: async (store) => window.DB.allActive(store), allActive: async (store) => window.__mockData[store] || [] };
      window.__widgetUpdateCalls = [];
      window.__widgetClearCalls = [];
      window.Capacitor = {
        isNativePlatform: () => ${nativePlatform},
        Plugins: {
          WidgetBridge: {
            updateSnapshot: async (data) => { window.__widgetUpdateCalls.push(data); },
            clearSnapshot: async () => { window.__widgetClearCalls.push(true); },
          },
        },
      };
      // disablePushForCurrentUser()/clearOneSignalIdentity()/cancelAllLocalNotifications()/
      // stopInactivityTimer() son dependencias de logout() ajenas a este
      // lote (OneSignal/notificaciones/inactividad) — espías para poder
      // ejecutar el logout() REAL sin esas piezas.
      window.clearAppBadge = () => {};
      window.disablePushForCurrentUser = () => {};
      window.clearOneSignalIdentity = () => {};
      window.cancelAllLocalNotifications = () => {};
      window.stopInactivityTimer = () => {};
      window.Auth = { isSupabaseMode: () => true, signOut: async () => {} };
      window.QuickUnlock = { disable: async () => {} };
      window.renderAuthGateSupabase = () => {};
      ${shiftsSrc}
      ${statusSrc}
      ${scopeSrc}
      ${validationSrc}
      ${widgetSnapshotSrc}
      ${appSrc}
      window.currentShiftId = currentShiftId;
      window.renderLubricadorHome = renderLubricadorHome;
      window.logout = logout;
      window.lastSyncState = lastSyncState;
    `,
  });
}

test('A. snapshot del turno correcto: ubicación, turno, 3 contadores y hasta 3 equipos (Atrasados primero)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const diaVencido = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][(new Date(Date.now() - 2 * 86400000)).getDay()];
  const hoyWeekday = weekdayName(new Date());
  const equipos = [
    { id: 'e1', code: '45-77', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' },
    { id: 'e2', code: 'A11', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' },
    { id: 'e3', code: '25-46', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' },
  ];
  const plans = [
    { id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [diaVencido] },
    { id: 'p2', equipmentId: 'e2', controlType: 'Día y turno de la semana', assignedDays: [diaVencido] },
    { id: 'p3', equipmentId: 'e3', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] },
  ];

  await bootPage(page, { equipos, plans });
  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);

  const calls = await page.evaluate(() => window.__widgetUpdateCalls);
  expect(calls.length).toBeGreaterThanOrEqual(1);
  const snap = calls[calls.length - 1];
  expect(snap.location).toBe('Volcán');
  expect(snap.overdue).toBe(2); // e1/e2 vencidos (día pasado, sin registro)
  expect(snap.pending).toBe(1); // e3 programado hoy
  expect(snap.completed).toBe(0);
  expect(snap.equipment.length).toBeLessThanOrEqual(3);
  expect(snap.equipment).toContain('45-77');
  expect(snap.equipment).toContain('A11');
});

test('B. un COMPLETE guardado SOLO localmente (sin red) actualiza el widget en el MISMO render, sin esperar Supabase', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'T-60', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];

  await bootPage(page, { equipos, plans });
  await page.evaluate(() => window.renderLubricadorHome());
  let calls = await page.evaluate(() => window.__widgetUpdateCalls);
  expect(calls[calls.length - 1].completed).toBe(0);
  expect(calls[calls.length - 1].pending).toBe(1);

  await page.evaluate(() => {
    window.__mockData.lubrication_records.push({
      id: 'r1', equipmentId: 'e1', date: new Date().toISOString(), createdAt: new Date().toISOString(),
      userName: 'Lubricador de prueba', qty: 2, shiftId: 'shift_dia',
    });
    return window.renderLubricadorHome();
  });
  expect(errors).toEqual([]);
  calls = await page.evaluate(() => window.__widgetUpdateCalls);
  const last = calls[calls.length - 1];
  expect(last.completed).toBe(1);
  expect(last.pending).toBe(0);
});

test('C. un PARTIAL no cuenta como COMPLETE en el snapshot del widget', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'T-61', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  const records = [{
    id: 'r1', equipmentId: 'e1', date: isoDaysAgo(0), createdAt: isoDaysAgo(0), userName: 'Lubricador de prueba', qty: 1, shiftId: 'shift_dia',
    operationalSnapshot: { executionCompleteness: 'PARTIAL' },
  }];

  await bootPage(page, { equipos, plans, records });
  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);
  const calls = await page.evaluate(() => window.__widgetUpdateCalls);
  const last = calls[calls.length - 1];
  expect(last.completed).toBe(0); // un PARTIAL nunca cuenta como Realizado
});

test('D. cambiar de cuenta (logout real) limpia el snapshot del widget — nunca deja datos del usuario anterior', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => window.logout());
  const clearCalls = await page.evaluate(() => window.__widgetClearCalls);
  expect(clearCalls.length).toBe(1);
});

test('E. fuera de Android (isNativePlatform=false) nunca llama al plugin — la versión web no hace nada', async ({ page }) => {
  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'T-62', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];

  await bootPage(page, { equipos, plans, nativePlatform: false });
  await page.evaluate(() => window.renderLubricadorHome());
  await page.evaluate(() => window.logout());
  const updateCalls = await page.evaluate(() => window.__widgetUpdateCalls);
  const clearCalls = await page.evaluate(() => window.__widgetClearCalls);
  expect(updateCalls).toEqual([]);
  expect(clearCalls).toEqual([]);
});
