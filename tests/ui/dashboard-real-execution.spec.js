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
const scopeNames = [
  'EXECUTION_TYPE', 'ASSIGNMENT_STATUS', 'resolveRecordExecutionType', 'findCarriedOverSkipForToday',
  // Scope por cuadrilla del SUPERVISOR en Dashboard (hardening pre-release
  // 2026-10-08) — MISMAS funciones reales ya usadas por renderLubricadorHome().
  'ROLES_CREW_SCOPED', 'getAuthorizedCrews', 'resolveDefaultCrewForLocation',
  'resolveOperationalScope', 'classifyEquipmentWork', 'computeOccurrenceKey', 'toISODateUTCLocal',
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
  '$', '$$', 'esc', 'fmtDate', 'todayDateISO', 'SCHEDULE_WEEKDAYS', 'STATUS_COLOR', 'WEEKDAY_ABBR_DASH',
  'NO_EXECUTION_REASON_LABELS', 'PERMISSIONS', 'computeAllStatuses', 'colorPorCumplimiento',
  'dashHeroCard', 'dashActivityCard', 'dashComplianceCard', 'tiempoExcepcionRowHTML', 'renderDashboard',
  'openModal', 'closeModal', 'dashListRowActionsHTML', 'wireDashListActions',
  'tiempoPendienteDesde', 'pendienteValidacionRowHTML',
  // Scope por cuadrilla del SUPERVISOR en Dashboard (hardening pre-release 2026-10-08).
  'getSelectedCrewId', 'getCurrentOperationalScope', 'equipoOccurrenceKey',
];
const appSrc = appNames.map(n => extractDeclaration(appSource, n)).join('\n\n');

const TYPES = [{ id: 't1', name: 'Excavadora' }];
const LOCATIONS = [{ id: 'l1', name: 'Botadero Norte' }];
const EQUIPOS = [
  { id: 'e1', code: '45-77', brand: 'Caterpillar', model: '740B', status: 'Operativo', typeId: 't1', locationId: 'l1' },
  { id: 'e2', code: 'EXC-02', brand: 'Komatsu', model: 'PC200', status: 'Operativo', typeId: 't1', locationId: 'l1' },
];

async function bootPage(page, {
  skips = [], records = [], assignments = [], plans = [], anomalies = [], validations = [], cuadrillas = [],
  types = TYPES, locations = LOCATIONS, typesAll = types, locationsAll = locations, equipos = EQUIPOS,
  currentUser = { id: 'admin1', name: 'Junior', role: 'ADMINISTRADOR' },
} = {}) {
  await page.setContent('<div id="app-content"></div>');
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.App = {
        route: 'dashboard', currentUser: ${JSON.stringify(currentUser)},
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18, complianceTarget: 85 },
      };
      window.navigate = () => {};
      window.__startGreaseFlowCalls = [];
      window.startGreaseFlow = (id) => window.__startGreaseFlowCalls.push(id);
      window.makeTablesResponsive = () => {};
      window.showInAppToast = () => {};
      window.DB = {
        // DB.allActive filtra a solo activas (lo que ya pasaba antes del fix
        // de DATA-PENDING-A02); DB.all() devuelve TODAS — distinción real
        // que renderDashboard ahora explota a propósito para equipment_types/
        // locations (ver docs/BUG_REGISTER.md).
        allActive: async (store) => ({
          equipment: ${JSON.stringify(equipos)},
          equipment_types: ${JSON.stringify(types)},
          locations: ${JSON.stringify(locations)},
          lubrication_plans: ${JSON.stringify(plans)},
          lubrication_records: ${JSON.stringify(records)},
          anomalies: ${JSON.stringify(anomalies)},
          grease_validations: ${JSON.stringify(validations)},
          lubrication_assignments: ${JSON.stringify(assignments)},
          lubrication_skips: ${JSON.stringify(skips)},
          cuadrillas: ${JSON.stringify(cuadrillas)},
        }[store] || []),
        all: async (store) => ({
          equipment_types: ${JSON.stringify(typesAll)},
          locations: ${JSON.stringify(locationsAll)},
        }[store] || []),
      };
      ${shiftsSrc}
      ${statusSrc}
      ${scopeSrc}
      ${validationSrc}
      ${appSrc}
      window.currentShiftId = currentShiftId;
      window.renderDashboard = renderDashboard;
      window.openModal = openModal; window.closeModal = closeModal;
      window.dashListRowActionsHTML = dashListRowActionsHTML;
      window.wireDashListActions = wireDashListActions;
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
  // Fix 2026-10-09 (flake preexistente detectado, no causado por este lote):
  // toISOString() es UTC — en cualquier zona con offset negativo (ej. HAC,
  // UTC-6), la tarde/noche local ya es "mañana" en UTC, así que esta fecha
  // nunca coincidía con `todayDateISO()` real (LOCAL, app.js) y el carryover
  // dejaba de encontrarse. Mismo criterio LOCAL que el real, nunca UTC.
  const hoyLocal = new Date();
  const hoyISO = `${hoyLocal.getFullYear()}-${String(hoyLocal.getMonth() + 1).padStart(2, '0')}-${String(hoyLocal.getDate()).padStart(2, '0')}`;

  await bootPage(page, {
    skips: [{ id: 'skip1', equipmentId: 'e1', date: `${hoyISO}T05:00:00`, shiftId: turnoAnterior, motivo: 'SIN_TIEMPO', active: true, createdAt: `${hoyISO}T05:00:00` }],
  });
  await page.evaluate(() => window.renderDashboard());

  expect(errors).toEqual([]); // el bug real de TDZ reventaba la pantalla ENTERA exactamente en este escenario
  await expect(page.locator('#dash-pendientes-anterior-panel')).toContainText('45-77');
});

test('FIX real (DATA-PENDING-A02, ver docs/BUG_REGISTER.md) — un equipo con la ubicación ya desactivada sigue mostrando su nombre real en "Mayor tiempo sin engrasar", nunca "—"', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  // "Botadero Norte" se desactivó DESPUÉS de que e1/e2 se la asignaran — el
  // equipo nunca cambió su propio locationId (el soft-delete de una
  // ubicación, por diseño, "no modifica" los equipos que ya la tenían
  // asignada, ver confirm() de wireSimpleListPanel/.sl-remove en app.js).
  // `locations` (activas, alimenta el <select> de filtro) queda vacía a
  // propósito — el caso más estricto — mientras `locationsAll` (DB.all(),
  // lo que el fix ahora usa para el NOMBRE en pantalla) sí la trae.
  await bootPage(page, {
    locations: [], locationsAll: [{ id: 'l1', name: 'Botadero Norte', active: false }],
  });
  await page.evaluate(() => window.renderDashboard());

  expect(errors).toEqual([]);
  // Línea "marca modelo · ubicación" (dash-exc-line2) — se apunta a esa
  // línea en particular (no al panel entero) porque "días sin engrasar" SÍ
  // muestra "—" legítimamente cuando el equipo nunca tiene un registro
  // (otro dato, sin relación con este fix). e1 Y e2 comparten locationId
  // 'l1' — las 2 líneas deben terminar con el nombre real, nunca "—".
  const lineas = await page.locator('#dash-tiempo-sin-engrase-panel .dash-exc-line2').allTextContents();
  expect(lineas.length).toBeGreaterThan(0);
  for (const linea of lineas) expect(linea).toContain('· Botadero Norte');
});

// Hardening pre-release 2026-10-08: Dashboard del SUPERVISOR debe respetar
// su(s) cuadrilla(s)/ubicación(es) autorizadas (scope CREW_SCOPED, igual
// criterio que renderLubricadorHome()) — ADMINISTRADOR mantiene el alcance
// GLOBAL de siempre, ver bootPage() (currentUser por defecto). e3 vive en
// l2 ("Botadero Sur"), FUERA de la cuadrilla/ubicación autorizada del
// SUPERVISOR de prueba (crew1, locationId l1) — su anomalía nunca debe
// contarse para ese rol.
const EQUIPOS_2_UBICACIONES = [
  ...EQUIPOS,
  { id: 'e3', code: 'EXC-03', brand: 'Hitachi', model: 'EX200', status: 'Operativo', typeId: 't1', locationId: 'l2' },
];
const LOCATIONS_2 = [...LOCATIONS, { id: 'l2', name: 'Botadero Sur' }];
const CUADRILLA_SUPERVISOR = [{ id: 'crew1', name: 'Cuadrilla Norte', active: true, locationId: 'l1', isDefault: true, memberUserIds: ['sup1'] }];
const ANOMALIAS_2_UBICACIONES = [
  { id: 'an1', equipmentId: 'e1', status: 'Abierta', criticality: 'Media' }, // l1 — dentro del scope
  { id: 'an2', equipmentId: 'e3', status: 'Abierta', criticality: 'Media' }, // l2 — fuera del scope del Supervisor
];

test('SUPERVISOR: "Anomalías abiertas" solo cuenta equipos de su(s) cuadrilla(s)/ubicación(es) autorizadas', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  await bootPage(page, {
    equipos: EQUIPOS_2_UBICACIONES, locations: LOCATIONS_2, locationsAll: LOCATIONS_2,
    anomalies: ANOMALIAS_2_UBICACIONES, cuadrillas: CUADRILLA_SUPERVISOR,
    currentUser: { id: 'sup1', name: 'Supervisor de prueba', role: 'SUPERVISOR' },
  });
  await page.evaluate(() => window.renderDashboard());

  expect(errors).toEqual([]);
  const card = page.locator('.dash-activity-card', { has: page.locator('.dash-activity-label', { hasText: 'Anomalías abiertas' }) });
  await expect(card.locator('.dash-activity-value')).toHaveText('1'); // solo e1 (l1) — e3 (l2) queda fuera de scope
});

test('ADMINISTRADOR: "Anomalías abiertas" sigue siendo GLOBAL (mismo alcance de siempre, scope GLOBAL no cambia)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  await bootPage(page, {
    equipos: EQUIPOS_2_UBICACIONES, locations: LOCATIONS_2, locationsAll: LOCATIONS_2,
    anomalies: ANOMALIAS_2_UBICACIONES, cuadrillas: CUADRILLA_SUPERVISOR,
    // currentUser por defecto: ADMINISTRADOR (scope GLOBAL) — MISMA cuadrilla/datos de arriba.
  });
  await page.evaluate(() => window.renderDashboard());

  expect(errors).toEqual([]);
  const card = page.locator('.dash-activity-card', { has: page.locator('.dash-activity-label', { hasText: 'Anomalías abiertas' }) });
  await expect(card.locator('.dash-activity-value')).toHaveText('2'); // e1 Y e3 — sin scope para GLOBAL
});

test('tarjeta "Pendientes hoy" (categoría "Qué requiere acción") es clicable y manda a la acción real (Registrar), no solo informa', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  // e1 programado HOY (Día y turno de la semana) sin registro de hoy → cae
  // en pendientesHoyList. hoyWeekday calculado en Node con la MISMA tabla
  // real (lubrication-status.js) para que el test valga cualquier día.
  const WEEKDAY_NAMES_NODE = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const hoyWeekday = WEEKDAY_NAMES_NODE[new Date().getDay()];

  await bootPage(page, {
    plans: [{ id: 'plan1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }],
  });
  await page.evaluate(() => window.renderDashboard());

  // Antes del fix: esta tarjeta no tenía data-kpi-action (null) — no era
  // clicable, a diferencia de "Vencidos"/"Próximos" en la misma sección.
  const card = page.locator('.dash-hero-card', { has: page.locator('.dash-hero-label', { hasText: 'Pendientes hoy' }) });
  await expect(card).toHaveClass(/kpi-clickable/);
  await card.click();

  const modal = page.locator('.modal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('45-77');
  const registrarBtn = modal.locator('.dash-list-registrar');
  await expect(registrarBtn).toBeVisible();

  await registrarBtn.click();

  expect(errors).toEqual([]);
  const calls = await page.evaluate(() => window.__startGreaseFlowCalls);
  expect(calls).toEqual(['e1']); // la acción real (Registrar engrase), no un listado de solo lectura
  await expect(modal).toBeHidden(); // wireDashListActions cierra el modal antes de startGreaseFlow
});

test('tarjeta "Pendientes de validación" es clicable y manda a la acción real (botón Validar), verificado contra un registro real pendiente', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  // Registro de HOY, sujeto a validación (posterior a GREASE_VALIDATION_
  // ENABLED_FROM, 2026-09-27), 0 firmas activas y dentro de plazo (mismo
  // turno en que se engrasó) → isRecordPendingValidation() real = true.
  const turnoDeAhora = new Function('App', `${shiftsSrc}\nreturn currentShiftId();`)({ generalSettings: { shiftDayStart: 6, shiftNightStart: 18 } });
  const nowISO = new Date().toISOString();

  await bootPage(page, {
    records: [{ id: 'rec1', equipmentId: 'e1', date: nowISO, createdAt: nowISO, shiftId: turnoDeAhora, userName: 'Junior' }],
  });
  await page.evaluate(() => window.renderDashboard());

  const card = page.locator('.dash-hero-card', { has: page.locator('.dash-hero-label', { hasText: 'Pendientes de validación' }) });
  await expect(card).toHaveClass(/kpi-clickable/);
  await card.click();

  const modal = page.locator('.modal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('45-77');
  await expect(modal.locator('.dash-validar-btn')).toBeVisible();

  expect(errors).toEqual([]);
});

test('"Pendientes hoy" y "Pendientes de validación" son clicables incluso en 0 (consistente con "Vencidos"/"Próximos", nunca se desactiva la tarjeta solo por estar vacía)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  await bootPage(page); // flota vacía de trabajo pendiente: ambas listas dan 0
  await page.evaluate(() => window.renderDashboard());

  const pendientesHoyCard = page.locator('.dash-hero-card', { has: page.locator('.dash-hero-label', { hasText: 'Pendientes hoy' }) });
  const pendientesValidacionCard = page.locator('.dash-hero-card', { has: page.locator('.dash-hero-label', { hasText: 'Pendientes de validación' }) });
  await expect(pendientesHoyCard).toHaveClass(/kpi-clickable/);
  await expect(pendientesValidacionCard).toHaveClass(/kpi-clickable/);

  await pendientesHoyCard.click();
  await expect(page.locator('.modal')).toContainText('Sin pendientes');
  await page.evaluate(() => window.closeModal());

  await pendientesValidacionCard.click();
  await expect(page.locator('.modal')).toContainText('Sin pendientes');

  expect(errors).toEqual([]);
});

test('"Próximos" incluye un equipo Día/turno "al día" (VERDE) cuyo PRÓXIMO día asignado es MAÑANA — pedido explícito del usuario (2026-10-02)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  // e1: plan con 2 días asignados — AYER (ya engrasado, por eso queda VERDE
  // "al día" y no ROJO) y MAÑANA (su próxima ocurrencia real). Calculado en
  // Node con la MISMA tabla real para que el test valga cualquier día.
  const WEEKDAY_NAMES_NODE = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const hoyIdx = new Date().getDay();
  const ayerWeekday = WEEKDAY_NAMES_NODE[(hoyIdx + 6) % 7];
  const mananaWeekday = WEEKDAY_NAMES_NODE[(hoyIdx + 1) % 7];
  const ayerISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  await bootPage(page, {
    plans: [{ id: 'plan1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [ayerWeekday, mananaWeekday] }],
    records: [{ id: 'r1', equipmentId: 'e1', date: ayerISO, createdAt: ayerISO, shiftId: 'shift_dia' }],
  });
  await page.evaluate(() => window.renderDashboard());

  expect(errors).toEqual([]);
  const card = page.locator('.dash-hero-card', { has: page.locator('.dash-hero-label', { hasText: 'Próximos' }) });
  await card.click();

  const modal = page.locator('.modal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('45-77');
  await expect(modal).toContainText('PROGRAMADO MAÑANA');
});

test('"Próximos" NO incluye un equipo Día/turno reprogramado a una fecha DISTINTA de mañana (respeta reprogramadoHasta, no avisa un día que ya no aplica)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const WEEKDAY_NAMES_NODE = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const hoyIdx = new Date().getDay();
  const mananaWeekday = WEEKDAY_NAMES_NODE[(hoyIdx + 1) % 7];
  // Reprogramado 4 días adelante (NO a mañana) — margen amplio a propósito
  // (nunca 48h) para que la comparación sea inequívoca sin importar la zona
  // horaria de la máquina que corre el test: reprogramadoHasta es un string
  // de solo fecha ("YYYY-MM-DD", mismo formato que manda un <input
  // type="date">), que el motor JS interpreta en UTC — con 4 días de
  // diferencia real, ningún desfase de huso horario puede confundirlo con
  // "mañana" (que sí se calcula en hora local). El reprogramado activo
  // manda sobre el día habitual del plan, aunque "mañana" esté en
  // assignedDays.
  const en4DiasISO = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  await bootPage(page, {
    plans: [{
      id: 'plan1', equipmentId: 'e1', controlType: 'Día y turno de la semana',
      assignedDays: [mananaWeekday], reprogramadoHasta: en4DiasISO,
    }],
  });
  await page.evaluate(() => window.renderDashboard());

  expect(errors).toEqual([]);
  const proximosValue = await page.locator('.dash-hero-card', { has: page.locator('.dash-hero-label', { hasText: 'Próximos' }) })
    .locator('.dash-hero-value').textContent();
  expect(proximosValue.trim()).toBe('0');
});
