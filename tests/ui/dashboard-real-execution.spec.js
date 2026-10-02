// tests/ui/dashboard-real-execution.spec.js
//
// Deuda de testing señalada varias veces en docs/SESSION_HANDOFF.md:
// "renderDashboard() NUNCA se ejecuta de verdad en ningún test (todo es
// texto-fuente o fixtures estáticas) — así sobrevivió [un] bug 2 sesiones
// completas". Ese bug real (`turnoActual` leído en su temporal dead zone,
// solo se manifestaba con un carryover REAL) tiene su propio test de
// ORDEN DE FUENTE en tests/unit/dashboard-carryover.test.js — pero un test
// de orden de fuente no prueba que la función efectivamente CORRA sin
// reventar con datos reales. Este archivo cierra esa deuda: carga
// renderDashboard() y TODAS sus dependencias reales (extraídas de app.js +
// src/core/shifts.js + lubrication-status.js + operational-scope.js +
// grease-validation.js, mismo patrón que mis-engrases-flow.spec.js) dentro
// de una página real de Playwright, con DB reemplazado por un store en
// memoria (sin red, sin IndexedDB real) — y la EJECUTA de verdad.

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
const scopeNames = ['EXECUTION_TYPE', 'ASSIGNMENT_STATUS', 'resolveRecordExecutionType', 'findCarriedOverSkipForToday'];
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
  '$', '$$', 'esc', 'fmtDate', 'todayDateISO', 'SCHEDULE_WEEKDAYS', 'STATUS_COLOR', 'WEEKDAY_ABBR_DASH',
  'NO_EXECUTION_REASON_LABELS', 'PERMISSIONS', 'computeAllStatuses', 'colorPorCumplimiento',
  'dashHeroCard', 'dashActivityCard', 'dashComplianceCard', 'tiempoExcepcionRowHTML', 'renderDashboard',
];
const appSrc = appNames.map(n => extractDeclaration(appSource, n)).join('\n\n');

const TYPES = [{ id: 't1', name: 'Excavadora' }];
const LOCATIONS = [{ id: 'l1', name: 'Botadero Norte' }];
const EQUIPOS = [
  { id: 'e1', code: '45-77', brand: 'Caterpillar', model: '740B', status: 'Operativo', typeId: 't1', locationId: 'l1' },
  { id: 'e2', code: 'EXC-02', brand: 'Komatsu', model: 'PC200', status: 'Operativo', typeId: 't1', locationId: 'l1' },
];

async function bootPage(page, { skips = [], records = [], assignments = [], plans = [], anomalies = [], validations = [] } = {}) {
  await page.setContent('<div id="app-content"></div>');
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.App = {
        route: 'dashboard', currentUser: { id: 'admin1', name: 'Junior', role: 'ADMINISTRADOR' },
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18, complianceTarget: 85 },
      };
      window.navigate = () => {};
      window.startGreaseFlow = () => {};
      window.openModal = () => {}; window.closeModal = () => {};
      window.makeTablesResponsive = () => {};
      window.showInAppToast = () => {};
      window.DB = {
        allActive: async (store) => ({
          equipment: ${JSON.stringify(EQUIPOS)},
          equipment_types: ${JSON.stringify(TYPES)},
          locations: ${JSON.stringify(LOCATIONS)},
          lubrication_plans: ${JSON.stringify(plans)},
          lubrication_records: ${JSON.stringify(records)},
          anomalies: ${JSON.stringify(anomalies)},
          grease_validations: ${JSON.stringify(validations)},
          lubrication_assignments: ${JSON.stringify(assignments)},
          lubrication_skips: ${JSON.stringify(skips)},
        }[store] || []),
      };
      ${shiftsSrc}
      ${statusSrc}
      ${scopeSrc}
      ${validationSrc}
      ${appSrc}
      window.currentShiftId = currentShiftId;
      window.renderDashboard = renderDashboard;
    `,
  });
}

test('renderDashboard() corre de verdad sin datos (flota vacía de trabajo pendiente) — nunca revienta, muestra la estructura real', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  await bootPage(page);
  await page.evaluate(() => window.renderDashboard());

  expect(errors).toEqual([]);
  // Las 6 KPI principales reales (docs/SESSION_HANDOFF.md, parte 7, sección B) — en este orden.
  await expect(page.locator('#app-content .dash-hero-card .dash-hero-label')).toHaveText([
    'Vencidos', 'Pendientes hoy', 'Próximos', 'Realizados hoy', 'Pendientes de validación', 'Cumplimiento hoy',
  ]);
  await expect(page.locator('#dash-pendientes-anterior-panel')).toContainText('Ninguno — nada heredado del turno anterior.');
});

test('REGRESIÓN real (ver tests/unit/dashboard-carryover.test.js) — con un carryover REAL del turno anterior, renderDashboard() sigue sin reventar y muestra el equipo', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  // shiftId DISTINTO al turno actual real (lo que realmente dispara el bug
  // histórico de TDZ: turnoActual se leía antes de declararse) — se calcula
  // en Node (misma fórmula real, sin DOM) para que el test sea válido sin
  // importar la hora real al correrlo, y sin tener que bootear la página 2
  // veces (los `const` de un <script> ya inyectado quedan declarados en el
  // mismo realm — una 2ª inyección con setContent() de por medio revienta
  // con "Identifier already declared").
  const turnoDeAhora = new Function('App', `${shiftsSrc}\nreturn currentShiftId();`)({ generalSettings: { shiftDayStart: 6, shiftNightStart: 18 } });
  const turnoAnterior = turnoDeAhora === 'shift_dia' ? 'shift_noche' : 'shift_dia';
  const hoyISO = new Date().toISOString().slice(0, 10);

  await bootPage(page, {
    skips: [{ id: 'skip1', equipmentId: 'e1', date: `${hoyISO}T05:00:00`, shiftId: turnoAnterior, motivo: 'SIN_TIEMPO', active: true, createdAt: `${hoyISO}T05:00:00` }],
  });
  await page.evaluate(() => window.renderDashboard());

  expect(errors).toEqual([]); // el bug real de TDZ reventaba la pantalla ENTERA exactamente en este escenario
  await expect(page.locator('#dash-pendientes-anterior-panel')).toContainText('45-77');
});
