// tests/ui/lubricador-mi-turno-real-execution.spec.js
//
// Fix 2026-10-08 ("alinear estado y trabajo realizado") — bug real reportado
// con captura: equipos mostraban badge "AL DÍA" con botón "Registrar
// engrase" a la vez, y equipos COMPLETE (05-0870/A-02) aparecían
// simultáneamente en "Mi Turno" y "Realizados". Carga renderLubricadorHome()
// REAL y TODAS sus dependencias reales (mismo patrón que
// dashboard-real-execution.spec.js) dentro de una página real de
// Playwright, con DB reemplazado por un store en memoria — y la EJECUTA de
// verdad contra datos reales, nunca solo un patrón de texto.
//
// Las secciones (Atrasados/Mi Turno/Realizados/Alertas) NO tienen id propio
// en el markup real — se ubican por el texto de su encabezado
// (".lub-section-head:has-text(...)") + el ".lub-eq-list" inmediatamente
// siguiente (combinador "+", mismo orden real que genera la función).

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
  'resolveDefaultCrewForLocation', 'resolveOperationalScope', 'classifyEquipmentWork', 'computeOccurrenceKey',
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

const LOCATIONS = [{ id: 'l1', name: 'Rajo Principal' }, { id: 'l2', name: 'Rajo Sur' }];
const CREW = [{ id: 'crew1', name: 'Cuadrilla A', active: true, locationId: 'l1', isDefault: true, memberUserIds: ['lub1'] }];

function weekdayName(d) {
  return ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][d.getDay()];
}
function isoDaysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString();
}

async function bootPage(page, { equipos = [], plans = [], records = [], skips = [], assignments = [], validations = [] } = {}) {
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
      window.DB = {
        allActive: async (store) => ({
          equipment: ${JSON.stringify(equipos)},
          locations: ${JSON.stringify(LOCATIONS)},
          cuadrillas: ${JSON.stringify(CREW)},
          lubrication_plans: ${JSON.stringify(plans)},
          lubrication_records: ${JSON.stringify(records)},
          lubrication_skips: ${JSON.stringify(skips)},
          lubrication_assignments: ${JSON.stringify(assignments)},
          grease_validations: ${JSON.stringify(validations)},
        }[store] || []),
      };
      ${shiftsSrc}
      ${statusSrc}
      ${scopeSrc}
      ${validationSrc}
      ${appSrc}
      window.currentShiftId = currentShiftId;
      window.renderLubricadorHome = renderLubricadorHome;
    `,
  });
}

// Localiza la lista (.lub-eq-list) de una sección por el texto de su
// encabezado — null si la sección está oculta (sin trabajo que mostrar),
// igual que hace la pantalla real.
function seccion(page, textoEncabezado) {
  return page.locator(`.lub-section-head:has-text("${textoEncabezado}") + .lub-eq-list`);
}

// Dedup real (punto E del pedido): un código solo puede estar en UNA de
// Atrasados/Mi Turno/Realizados — nunca en 2 a la vez. Alertas queda FUERA
// a propósito: puede repetir un equipo que también esté en otra sección
// (es información de riesgo, no otra tarea — permitido explícitamente).
async function enCuantasSeccionesDeTrabajo(page, code) {
  let n = 0;
  for (const encabezado of ['ATRASADOS', 'MI TURNO', 'REALIZADOS']) {
    const count = await seccion(page, encabezado).locator('.lub-eq-code', { hasText: code }).count();
    if (count > 0) n++;
  }
  return n;
}

test('un equipo con un registro COMPLETE de hoy sale de Mi Turno/Atrasados y aparece SOLO en Realizados (fix real, bug con captura)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: '05-0870', brand: 'Caterpillar', model: 'D8T', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  const records = [{ id: 'r1', equipmentId: 'e1', date: isoDaysAgo(0), createdAt: isoDaysAgo(0), userName: 'Juan Pérez', qty: 2.5, shiftId: 'shift_dia' }];

  await bootPage(page, { equipos, plans, records });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  // Dedup real (punto E del pedido): UNA sola de Atrasados/Mi Turno/Realizados.
  expect(await enCuantasSeccionesDeTrabajo(page, '05-0870')).toBe(1);
  await expect(seccion(page, 'REALIZADOS')).toContainText('05-0870');
});

test('un equipo "AL DÍA" por un registro COMPLETE nunca muestra botón "Registrar engrase" (ya no está en Mi Turno) ni el texto "AL DÍA"', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'A-02', brand: 'Komatsu', model: 'WA470', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  const records = [{ id: 'r1', equipmentId: 'e1', date: isoDaysAgo(0), createdAt: isoDaysAgo(0), userName: 'Ana G.', qty: 1.5, shiftId: 'shift_dia' }];

  await bootPage(page, { equipos, plans, records });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(page.locator('#app-content')).not.toContainText('AL DÍA'); // nunca como estado principal de una tarea pendiente
  expect(await page.locator('.lub-mt-reg').count()).toBe(0); // nada pendiente que registrar: ya está en Realizados
});

test('un equipo con un registro PARTIAL de hoy (programado hoy) permanece en Mi Turno con label "PROGRAMADO HOY", nunca "AL DÍA", nunca en Realizados', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'T-15', brand: 'Volvo', model: 'A40', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  const records = [{
    id: 'r1', equipmentId: 'e1', date: isoDaysAgo(0), createdAt: isoDaysAgo(0), userName: 'Pedro L.', qty: 1.0, shiftId: 'shift_dia',
    operationalSnapshot: { executionCompleteness: 'PARTIAL' },
  }];

  await bootPage(page, { equipos, plans, records });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(seccion(page, 'MI TURNO')).toContainText('T-15');
  await expect(seccion(page, 'MI TURNO')).toContainText('PROGRAMADO HOY');
  await expect(page.locator('#app-content')).not.toContainText('AL DÍA');
  // Nunca también en Realizados (PARTIAL jamás cuenta como completo).
  expect(await enCuantasSeccionesDeTrabajo(page, 'T-15')).toBe(1);
});

test('un equipo con un registro PARTIAL de un día YA VENCIDO (plan de esta semana, día pasado) aparece en Atrasados, no en Mi Turno', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  // Día asignado: hace 2 días (sigue siendo la ocurrencia activa de la
  // semana — mostRecentAssignedDate() solo mira hasta 7 días atrás).
  const haceDosDias = new Date(); haceDosDias.setDate(haceDosDias.getDate() - 2);
  const diaAsignado = weekdayName(haceDosDias);
  const equipos = [{ id: 'e1', code: 'T-22', brand: 'Hitachi', model: 'EX200', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [diaAsignado] }];
  const records = [{
    id: 'r1', equipmentId: 'e1', date: haceDosDias.toISOString(), createdAt: haceDosDias.toISOString(), userName: 'Pedro L.', qty: 1.0, shiftId: 'shift_dia',
    operationalSnapshot: { executionCompleteness: 'PARTIAL' },
  }];

  await bootPage(page, { equipos, plans, records });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(seccion(page, 'ATRASADOS')).toContainText('T-22');
  expect(await enCuantasSeccionesDeTrabajo(page, 'T-22')).toBe(1); // nunca también en Mi Turno
});

test('un equipo asignado (ASIGNADO) con un registro COMPLETE de hoy también sale de Mi Turno/Atrasados y aparece solo en Realizados (dedup también en el camino de asignaciones)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const equipos = [{ id: 'e1', code: 'T-31', brand: 'Komatsu', model: 'PC200', status: 'Operativo', locationId: 'l2', hourmeter: 500 }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Horas de operación', frequency: 250, lastGreaseHour: 100, alertYellowHours: 10 }];
  const assignments = [{ id: 'a1', equipmentId: 'e1', assignedCrewId: 'crew1', status: 'PENDING', active: true }];
  const records = [{ id: 'r1', equipmentId: 'e1', date: isoDaysAgo(0), createdAt: isoDaysAgo(0), userName: 'Ana G.', qty: 2.0, shiftId: 'shift_dia' }];

  await bootPage(page, { equipos, plans, assignments, records });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  expect(await enCuantasSeccionesDeTrabajo(page, 'T-31')).toBe(1);
  await expect(seccion(page, 'REALIZADOS')).toContainText('T-31');
});
