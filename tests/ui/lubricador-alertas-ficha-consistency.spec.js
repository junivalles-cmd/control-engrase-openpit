import { LUBRICATION_FOLLOW_UP_APP_NAMES } from '../helpers/lubricationFollowUpFixture.js';
// tests/ui/lubricador-alertas-ficha-consistency.spec.js
//
// Bug real (2026-10-09): un equipo (ejemplo real reportado: "A11") aparecía
// en REQUIEREN SEGUIMIENTO ("1 día") mientras su Ficha mostraba ESTADO DE
// ENGRASE: AL DÍA, con un engrase COMPLETE reciente. Causa raíz real
// (trazada ANTES de tocar nada, ver comentarios en renderLubricadorHome()/
// app.js): el filtro de Alertas solo excluía un COMPLETE de HOY
// (`realizadosHoyIds`) — un COMPLETE de AYER que YA satisface la ocurrencia
// programada (statusFor()/weekdayStatusFor() dice VERDE/"AL DÍA") seguía
// entrando a Alertas por "días sin engrasar".
//
// Carga renderLubricadorHome() REAL + statusFor()/weekdayStatusFor() REALES
// (la MISMA función que usa openEquipmentDetail() para la Ficha, ver
// app.js:5428 `const s = await statusFor(e);`) dentro de una página real de
// Playwright — nunca un mock del cálculo de estado. Mismo mecanismo que
// lubricador-mi-turno-real-execution.spec.js.

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
  'operationalDateForShift', 'EXECUTION_TYPE', 'ASSIGNMENT_STATUS', 'EXECUTION_COMPLETENESS', 'resolveRecordExecutionType',
  'resolveRecordCompleteness', 'findCarriedOverSkipForToday', 'ROLES_CREW_SCOPED', 'getAuthorizedCrews',
  'resolveDefaultCrewForLocation', 'resolveCrewLocationCoverage', 'resolveOperationalScope', 'classifyEquipmentWork', 'equiposForLubricadorMatriz', 'computeOccurrenceKey',
  'toISODateUTCLocal',
];
const scopeSrc = scopeSource;
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
];
const appSrc = appNames.map((n) => extractDeclaration(appSource, n)).join('\n\n');

const LOCATIONS = [{ id: 'l1', name: 'Rajo Principal' }];
const CREW = [{ id: 'crew1', name: 'Cuadrilla A', active: true, locationId: 'l1', isDefault: true, memberUserIds: ['lub1'] }];
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function weekdayName(d) { return DIAS[d.getDay()]; }
function weekdayNDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return weekdayName(d); }
function isoDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); }

async function bootPage(page, { equipos = [], plans = [], records = [], skips = [], assignments = [] } = {}) {
  await page.setContent('<div id="app-content"></div>');
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.Sync = {getAccountSyncState: async () => ({bootstrapComplete:true})};
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
      // Widget de pantalla de inicio (lote "WIDGET ANDROID", 2026-10-09):
      // renderLubricadorHome() ya lo llama siempre — espía no-op aquí, su
      // comportamiento real se prueba aparte en
      // tests/ui/lubricador-widget-snapshot.spec.js.
      window.updateLubricadorWidgetSnapshot = () => {};
      window.__mockData = {
        equipment: ${JSON.stringify(equipos)},
        locations: ${JSON.stringify(LOCATIONS)},
        cuadrillas: ${JSON.stringify(CREW)},
        lubrication_plans: ${JSON.stringify(plans)},
        lubrication_records: ${JSON.stringify(records)},
        lubrication_skips: ${JSON.stringify(skips)},
        lubrication_assignments: ${JSON.stringify(assignments)},
        // Age-only follow-up scenarios represent already signed executions.
        grease_validations: ${JSON.stringify(records.map(r=>({id:'v:'+r.id,lubricationRecordId:r.id,signerRole:'OPERADOR',active:true})))},
      };
      window.DB = { getConfig: async () => ({ lastPull: 'fixture-pulled' }), all: async (store) => window.DB.allActive(store), allActive: async (store) => window.__mockData[store] || [] };
      ${shiftsSrc}
      ${statusSrc}
      ${scopeSrc}
      ${validationSrc}
      ${appSrc}
      window.currentShiftId = currentShiftId;
      window.renderLubricadorHome = renderLubricadorHome;
      window.statusFor = statusFor;
      window.lastSyncState = lastSyncState;
    `,
  });
}

// Localiza la lista de Alertas (igual patrón que lubricador-mi-turno-real-execution.spec.js).
function alertasSeccion(page) {
  return page.locator('#lub-follow-up > .lub-eq-list');
}
async function alertasCodes(page) {
  return alertasSeccion(page).locator('.lub-eq-code:visible').allTextContents();
}

test('A. registro de ayer conserva Ficha AL DÍA y aparece solo como seguimiento informativo', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  // Equipo programado solo el día de AYER (no hoy) — mostRecentAssignedDate()
  // resuelve lastDue = ayer; un COMPLETE fechado ayer satisface esa ocurrencia.
  const diaAyer = weekdayNDaysAgo(1);
  const equipos = [{ id: 'a11', code: 'A11', brand: 'Caterpillar', model: 'D8T', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'a11', controlType: 'Día y turno de la semana', assignedDays: [diaAyer] }];
  const records = [{ id: 'r1', equipmentId: 'a11', date: isoDaysAgo(1), createdAt: isoDaysAgo(1), userName: 'Juan', qty: 2, shiftId: 'shift_dia' }];

  await bootPage(page, { equipos, plans, records });
  const s = await page.evaluate((e) => window.statusFor(e), equipos[0]);
  expect(s.code).toBe('VERDE'); // confirma la premisa: la Ficha SÍ diría "AL DÍA"

  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);
  expect(await alertasCodes(page)).toContain('A11');
  await expect(page.locator('#lub-follow-up')).toContainText('1 día');
});

test('B. cinco días: seguimiento crítico sin cambiar el estado VERDE de la Ficha', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const dia5Atras = weekdayNDaysAgo(5);
  const equipos = [{ id: 'e1', code: 'VERDE-01', brand: 'Komatsu', model: 'WA470', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [dia5Atras] }];
  const records = [{ id: 'r1', equipmentId: 'e1', date: isoDaysAgo(5), createdAt: isoDaysAgo(5), userName: 'Ana', qty: 1, shiftId: 'shift_dia' }];

  await bootPage(page, { equipos, plans, records });
  const s = await page.evaluate((e) => window.statusFor(e), equipos[0]);
  expect(s.code).toBe('VERDE');

  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);
  expect(await alertasCodes(page)).toContain('VERDE-01');
  await expect(page.locator('.lub-follow-up-priority')).toHaveText('Crítico');
});

test('C. vencido programado → pendiente real, excluido del seguimiento', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const diaReciente = weekdayNDaysAgo(3);
  const equipos = [{ id: 'e1', code: 'ROJO-01', brand: 'Volvo', model: 'A40', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [diaReciente] }];

  await bootPage(page, { equipos, plans, records: [] });
  const s = await page.evaluate((e) => window.statusFor(e), equipos[0]);
  expect(s.code).toBe('ROJO');

  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);
  await expect(page.locator('.lub-pending-card .lub-eq-code', { hasText: 'ROJO-01' })).toHaveCount(1);
  expect(await alertasCodes(page)).not.toContain('ROJO-01');
});

test('D. próximo (AMARILLO, "PROGRAMADO HOY") → comportamiento según el helper real (puede aparecer)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'AMARILLO-01', brand: 'Hitachi', model: 'EX200', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];

  await bootPage(page, { equipos, plans, records: [] });
  const s = await page.evaluate((e) => window.statusFor(e), equipos[0]);
  expect(s.code).toBe('AMARILLO');

  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);
  expect(await alertasCodes(page)).toContain('AMARILLO-01');
});

test('E. COMPLETE local (de HOY) → sale del seguimiento de inmediato, aparece en Realizados', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'HOY-01', brand: 'Caterpillar', model: 'D8T', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  const records = [{ id: 'r1', equipmentId: 'e1', date: isoDaysAgo(0), createdAt: isoDaysAgo(0), userName: 'Pedro', qty: 2, shiftId: 'shift_dia' }];

  await bootPage(page, { equipos, plans, records });
  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);
  expect(await alertasCodes(page)).not.toContain('HOY-01');
  await expect(page.locator('.lub-section-head:has-text("REALIZADOS") + .lub-eq-list')).toContainText('HOY-01');
});

test('F. PARTIAL → pendiente real conservado, excluido del seguimiento', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const diaAyer = weekdayNDaysAgo(1);
  const equipos = [{ id: 'e1', code: 'PARTIAL-01', brand: 'Komatsu', model: 'PC200', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [diaAyer] }];
  const records = [{
    id: 'r1', equipmentId: 'e1', date: isoDaysAgo(1), createdAt: isoDaysAgo(1), userName: 'Luis', qty: 1, shiftId: 'shift_dia',
    operationalSnapshot: { executionCompleteness: 'PARTIAL' },
  }];

  await bootPage(page, { equipos, plans, records });
  const s = await page.evaluate((e) => window.statusFor(e), equipos[0]);
  expect(s.code).toBe('VERDE'); // weekdayStatusFor() cuenta cualquier record como "hecho" — por diseño, sin tocarlo

  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);
  await expect(page.locator('.lub-pending-card .lub-eq-code', { hasText: 'PARTIAL-01' })).toHaveCount(1);
  expect(await alertasCodes(page)).not.toContain('PARTIAL-01'); // el PARTIAL mantiene la atención real
});

test('G. SKIP no satisface: conserva pendiente real sin duplicar seguimiento', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const diaReciente = weekdayNDaysAgo(2);
  const equipos = [{ id: 'e1', code: 'SKIP-01', brand: 'Volvo', model: 'L220', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [diaReciente] }];
  const skips = [{ id: 's1', equipmentId: 'e1', date: isoDaysAgo(2), createdAt: isoDaysAgo(2), reason: 'SIN_TIEMPO', active: true, userName: 'Lubricador de prueba' }];

  await bootPage(page, { equipos, plans, records: [], skips });
  const s = await page.evaluate((e) => window.statusFor(e), equipos[0]);
  expect(s.code).toBe('ROJO'); // un skip nunca crea un record ni satisface la ocurrencia

  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);
  await expect(page.locator('.lub-pending-card .lub-eq-code', { hasText: 'SKIP-01' })).toHaveCount(1);
  expect(await alertasCodes(page)).not.toContain('SKIP-01');
});

test('H. siete pendientes reales excluidos; dos equipos al día conservan seguimiento', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const diaReciente = weekdayNDaysAgo(2);
  const equipos = [];
  const plans = [];
  // 7 equipos ROJO (vencidos, sin registro) — más de 5, para probar el tope.
  for (let i = 0; i < 7; i++) {
    equipos.push({ id: `rojo${i}`, code: `ROJO-${i}`, brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' });
    plans.push({ id: `pr${i}`, equipmentId: `rojo${i}`, controlType: 'Día y turno de la semana', assignedDays: [diaReciente] });
  }
  // 2 equipos VERDE real con un día desde el último engrase también requieren seguimiento.
  // Los equipos sin registro se muestran primero; Ver todos conserva ambos.
  const diaAyer = weekdayNDaysAgo(1);
  for (let i = 0; i < 2; i++) {
    equipos.push({ id: `verde${i}`, code: `VERDE-${i}`, brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' });
    plans.push({ id: `pv${i}`, equipmentId: `verde${i}`, controlType: 'Día y turno de la semana', assignedDays: [diaAyer] });
  }
  const records = [0, 1].map((i) => ({
    id: `rv${i}`, equipmentId: `verde${i}`, date: isoDaysAgo(1), createdAt: isoDaysAgo(1), userName: 'Ana', qty: 1, shiftId: 'shift_dia',
  }));

  await bootPage(page, { equipos, plans, records });
  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);

  const codes = await alertasCodes(page);
  expect(codes).toEqual(['VERDE-0', 'VERDE-1']);
  await expect(page.locator('.lub-pending-card')).toHaveCount(7);
});

test('I. seguimiento por antigüedad conserva todos los estados reales de la Ficha', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const diaAyer = weekdayNDaysAgo(1);
  const diaReciente = weekdayNDaysAgo(2);
  const hoyWeekday = weekdayName(new Date());
  const equipos = [
    { id: 'e1', code: 'MIX-ROJO', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' },
    { id: 'e2', code: 'MIX-AMARILLO', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' },
    { id: 'e3', code: 'MIX-PARTIAL', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' },
    { id: 'e4', code: 'MIX-VERDE', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' },
  ];
  const plans = [
    { id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [diaReciente] },
    { id: 'p2', equipmentId: 'e2', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] },
    { id: 'p3', equipmentId: 'e3', controlType: 'Día y turno de la semana', assignedDays: [diaAyer] },
    { id: 'p4', equipmentId: 'e4', controlType: 'Día y turno de la semana', assignedDays: [diaAyer] },
  ];
  const records = [
    { id: 'r3', equipmentId: 'e3', date: isoDaysAgo(1), createdAt: isoDaysAgo(1), userName: 'Luis', qty: 1, shiftId: 'shift_dia', operationalSnapshot: { executionCompleteness: 'PARTIAL' } },
    { id: 'r4', equipmentId: 'e4', date: isoDaysAgo(1), createdAt: isoDaysAgo(1), userName: 'Luis', qty: 1, shiftId: 'shift_dia' },
  ];

  await bootPage(page, { equipos, plans, records });
  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);

  const codes = await alertasCodes(page);
  await expect(page.locator('.lub-pending-card .lub-eq-code', { hasText: 'MIX-ROJO' })).toHaveCount(1);
  expect(codes).not.toContain('MIX-ROJO');
  expect(codes).toContain('MIX-AMARILLO');
  await expect(page.locator('.lub-pending-card .lub-eq-code', { hasText: 'MIX-PARTIAL' })).toHaveCount(1);
  expect(codes).not.toContain('MIX-PARTIAL');
  expect(codes).toContain('MIX-VERDE'); // informational age does not change the plan state

  for (const code of codes) {
    const equipo = equipos.find((e) => e.code === code);
    const s = await page.evaluate((e) => window.statusFor(e), equipo);
    expect(['ROJO', 'AMARILLO', 'VERDE']).toContain(s.code);
  }
});
