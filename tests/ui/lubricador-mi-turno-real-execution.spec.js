import { LUBRICATION_FOLLOW_UP_APP_NAMES } from '../helpers/lubricationFollowUpFixture.js';
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
const statusNames = ['fmt', 'WEEKDAY_NAMES', 'mostRecentAssignedDate', 'weekdayStatusFor', 'dualShiftStatusFor', 'statusFor'];
const statusSrc = statusNames.map(n => extractDeclaration(statusSource, n)).join('\n\n');
const scopeNames = [
  'EXECUTION_TYPE', 'ASSIGNMENT_STATUS', 'EXECUTION_COMPLETENESS', 'REQUIRED_SHIFT_IDS', 'requiredShiftsForPlan',
  'operationalDateForShift', 'resolveOccurrenceState', 'previousShiftOccurrence', 'computeExecutionCompleteness',
  'findActivePendingAssignment', 'resolveRecordExecutionType',
  'resolveRecordCompleteness', 'findCarriedOverSkipForToday', 'ROLES_CREW_SCOPED', 'getAuthorizedCrews',
  'resolveDefaultCrewForLocation', 'resolveCrewLocationCoverage', 'resolveOperationalScope', 'classifyEquipmentWork', 'equiposForLubricadorMatriz', 'computeOccurrenceKey',
  'parseOccurrenceKeyDate', // Fix 2026-10-17 ("FECHA VISUAL DE ASIGNACIÓN ATRASADA") — usado dentro de renderLubricadorHome()
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
  'getCurrentOperationalScope', 'loadAssignmentContext', 'equipoOccurrenceKey', 'crewCoveragePresentation', ...LUBRICATION_FOLLOW_UP_APP_NAMES, 'renderLubricadorHome',
];
const appSrc = appNames.map(n => extractDeclaration(appSource, n)).join('\n\n');

const LOCATIONS = [{ id: 'l1', name: 'Rajo Principal' }, { id: 'l2', name: 'Rajo Sur' }];
const CREW = [{ id: 'crew1', name: 'Cuadrilla A', active: true, locationId: 'l1', isDefault: true, memberUserIds: ['lub1'] }];
// Explicit authorization for the assigned execution/status cases below.
// An assignment alone never grants coverage; unconfigured cases stay legacy.
const ASSIGNMENT_COVERAGE = [
  { id: 'cl:crew1:l1', crew_id: 'crew1', location_id: 'l1', role: 'PRINCIPAL', active: true },
  { id: 'cl:crew1:l2', crew_id: 'crew1', location_id: 'l2', role: 'APOYO', active: true },
];

test('PRE-0008: grant puntual legacy (occurrenceKey de semanas atrás) persiste como PENDIENTE DEL TURNO ANTERIOR, nunca desaparece; CANCEL lo retira',async({page})=>{
  await page.clock.install({time:new Date('2026-10-16T08:00:00')});
  const equipo={id:'support-real-shaped',code:'05-0870',brand:'CAT',model:'fixture',status:'Operativo',locationId:'l2'};
  const plan={id:'support-plan',equipmentId:equipo.id,controlType:'Día y turno de la semana',assignedDays:['Viernes'],shiftId:await page.evaluate(()=>new Date().getHours()>=18?'shift_noche':'shift_dia')};
  const assignment={id:'legacy-support',equipmentId:equipo.id,planId:plan.id,assignedCrewId:'crew1',occurrenceKey:'support-plan:2026-09-30',status:'PENDING',active:true,assignmentType:null,_supportOperational:true};
  await bootPage(page,{equipos:[equipo],plans:[plan],assignments:[assignment],crewLocations:[]});
  await page.evaluate(()=>renderLubricadorHome());
  // occurrenceKey de 2026-09-30 (>2 semanas antes del reloj instalado) — regla
  // de doble turno (E/G): una PENDING vieja NUNCA desaparece, se clasifica
  // como arrastre ("Pendientes del turno anterior"), nunca se descarta por
  // antigüedad ni se mezcla con "MI TURNO" (reservado al trabajo del turno actual).
  await expect(seccion(page,'ATRASADOS')).toContainText('05-0870');
  await page.evaluate(async()=>{__mockData.lubrication_assignments[0].status='CANCELLED';__mockData.lubrication_assignments[0]._supportOperational=false;await renderLubricadorHome();});
  await expect(page.locator('.lub-eq-code',{hasText:'05-0870'})).toHaveCount(0);
});

function weekdayName(d) {
  return ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][d.getDay()];
}
function isoDaysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString();
}
function weekdayNDaysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return weekdayName(d);
}
// Mismo formato EXACTO que computeOccurrenceKey() real para planes "Día y
// turno de la semana" (`${planId}:${YYYY-MM-DD}`, operational-scope.js) —
// reconstruido aquí solo para armar el fixture (satisfiedOccurrenceKey),
// nunca para calcular el estado real (eso lo hace weekdayStatusFor() real).
function isoDateOnly(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function bootPage(page, { equipos = [], plans = [], records = [], skips = [], assignments = [], validations = [], crewLocations = [] } = {}) {
  // page.setContent() a secas deja la página en about:blank (origen opaco) —
  // localStorage lanza SecurityError ahí (silenciado por el try/catch de
  // abajo, dejando la selección de cuadrilla SIN persistir). Mismo fix ya
  // usado en lubricador-config.spec.js/qr-grease-register-management.spec.js:
  // se bloquea toda request real y se navega a la baseURL (origen http real)
  // antes de inyectar el contenido de prueba.
  await page.route('**/*', (route) => {
    if (route.request().resourceType() === 'document') {
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    } else {
      route.continue();
    }
  });
  await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({status:200,contentType:'text/css',body:''}));
  await page.goto('/');
  await page.setContent('<div id="app-content"></div>');
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.App = {
        route: 'turno', currentUser: { id: 'lub1', name: 'Lubricador de prueba', role: 'LUBRICADOR' },
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18, complianceTarget: 85 },
      };
      // Fix 2026-10-17 ("coherencia ubicación/cuadrilla"): renderLubricadorHome()
      // ahora exige una selección de cuadrilla EXPLÍCITA de esta sesión incluso
      // con 1 sola cuadrilla autorizada (antes se auto-seleccionaba en silencio).
      // Este archivo prueba el trabajo DENTRO de Mi Turno, no el selector en sí
      // (eso lo cubre tests/ui/mi-turno-selected-crew.spec.js) — se simula la
      // confirmación ya hecha, igual que un usuario real que ya eligió 'crew1'.
      try { localStorage.setItem('engrase_session_crew', JSON.stringify({ userId: 'lub1', crewId: 'crew1' })); } catch (e) {}
      let lastSyncState = { status: 'ok' };
      window.Sync={getAccountSyncState:async()=>({bootstrapComplete:true}),fullSync:async()=>{}};
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
      // window.__mockData es MUTABLE a propósito (fix 2026-10-08, "refrescar
      // alertas tras engrasar"): algunos tests empujan un record NUEVO
      // (simulando el DB.put() real que hace el flujo de registrar) y
      // vuelven a llamar renderLubricadorHome() — igual que el usuario real
      // volviendo a "Mi Turno" después de guardar, sin reload/logout.
      window.__mockData = {
        equipment: ${JSON.stringify(equipos)},
        locations: ${JSON.stringify(LOCATIONS)},
        cuadrillas: ${JSON.stringify(CREW)},
        crew_locations: ${JSON.stringify(crewLocations)},
        lubrication_plans: ${JSON.stringify(plans)},
        lubrication_records: ${JSON.stringify(records)},
        lubrication_skips: ${JSON.stringify(skips)},
        lubrication_assignments: ${JSON.stringify(assignments)},
        grease_validations: ${JSON.stringify(validations)},
      };
      window.DB = {
        getConfig: async () => ({ lastPull: 'fixture-pulled' }), all: async (store) => window.DB.allActive(store), allActive: async (store) => window.__mockData[store] || [],
      };
      ${shiftsSrc}
      ${statusSrc}
      ${scopeSrc}
      ${validationSrc}
      ${appSrc}
      window.currentShiftId = currentShiftId;
      window.renderLubricadorHome = renderLubricadorHome;
      // Expuesto para los tests del INVARIANTE "local-first" (625355f):
      // permite simular, desde fuera, que la sincronización remota falla
      // DESPUÉS de un guardado local (lastSyncState es la misma variable
      // global que lee la fila de contexto — nunca filtra los cálculos de
      // Realizados/Mi Turno/Alertas, solo el texto del chip).
      window.lastSyncState = lastSyncState;
    `,
  });
}

// Localiza la lista (.lub-eq-list) de una sección por el texto de su
// encabezado — null si la sección está oculta (sin trabajo que mostrar),
// igual que hace la pantalla real.
function seccion(page, textoEncabezado) {
  if (textoEncabezado === 'REQUIEREN SEGUIMIENTO') return page.locator('#lub-follow-up > .lub-eq-list');
  if (textoEncabezado === 'ATRASADOS') return page.locator('.lub-section-head:has-text("ATRASADOS") + .lub-eq-list, .lub-section-head:has-text("PENDIENTES DEL TURNO ANTERIOR") + .lub-eq-list');
  return page.locator(`.lub-section-head:has-text("${textoEncabezado}") + .lub-eq-list`);
}

// Lee el número de UN KPI por su etiqueta (los 4 .lub-kpi-card no tienen id
// propio) — mismo método "ubicar por texto" que seccion() arriba.
function kpiValue(page, label) {
  return page.locator('.lub-kpi-card', { hasText: label }).locator('.lub-kpi-value');
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

  await bootPage(page, { crewLocations: ASSIGNMENT_COVERAGE, equipos, plans, assignments, records });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  expect(await enCuantasSeccionesDeTrabajo(page, 'T-31')).toBe(1);
  await expect(seccion(page, 'REALIZADOS')).toContainText('T-31');
});

// ============================================================
// Fix 2026-10-08 ("refrescar alertas tras engrasar") — bug real: un equipo
// en REQUIEREN SEGUIMIENTO/REQUIERE ATENCIÓN seguía ahí después de un COMPLETE. Causa
// raíz encontrada trazando el flujo real (nunca asumida):
//   1. lastRecordByEquipoLub contaba CUALQUIER record (incluido PARTIAL)
//      como "último engrase" — violaba el punto 2 del pedido.
//   2. .slice(0, 5) nunca excluía a un equipo YA realizado hoy — con pocos
//      equipos en `normal` (el caso real), seguía ocupando un lugar aunque
//      ya no tuviera urgencia real.
// A/F/G (equipo en alerta + COMPLETE sale; funciona offline con el record
// local; desaparece en el siguiente render sin reload) se prueban juntos
// abajo: el mock de DB es 100% local (nunca red) y el 2do render se dispara
// a mano, igual que al volver a "Mi Turno" después de guardar.
// ============================================================

test('A/F/G — equipo en REQUIEREN SEGUIMIENTO con un COMPLETE nuevo (guardado solo localmente) sale de la alerta en el siguiente render, sin reload/logout/sync', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  // Fix 2026-10-09 (bug real de Alertas, "Ficha AL DÍA pero en Alertas"):
  // Alertas ya NO acepta un equipo "SIN PLAN" (GRIS, nunca por tiempo, ver
  // §6 del pedido) — necesita un plan real con un día VENCIDO (ROJO) para
  // justificar de verdad por qué aparece, igual que exigiría la Ficha.
  const diaVencido = weekdayNDaysAgo(3);
  const equipos = [{ id: 'e1', code: 'T-40', brand: 'Caterpillar', model: '740B', status: 'Operativo', locationId: 'l1', hourmeter: 1000 }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [diaVencido] }];

  await bootPage(page, { equipos, plans });
  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);
  await expect(seccion(page, 'ATRASADOS')).toContainText('T-40');
  await expect(page.locator('#lub-follow-up .lub-eq-code', { hasText: 'T-40' })).toHaveCount(0); // antes del engrase: en la alerta

  // Simula el DB.put() real de un engrase COMPLETE — SOLO local, sin tocar
  // red/sync (punto F) — y vuelve a renderizar (punto G: "al rerender
  // desaparece inmediatamente", sin esperar nada más).
  await page.evaluate(() => {
    window.__mockData.lubrication_records.push({
      id: 'r-nuevo', equipmentId: 'e1', date: new Date().toISOString(), createdAt: new Date().toISOString(),
      userName: 'Lubricador de prueba', qty: 2.0, shiftId: 'shift_dia',
    });
    return window.renderLubricadorHome();
  });

  // El encabezado "REQUIEREN SEGUIMIENTO" SIEMPRE se muestra (fix 2026-10-09, §7 del
  // pedido) — ya sin urgencia real, muestra "Sin alertas de engrase" en vez
  // de desaparecer en silencio.
  await expect(page.locator('#lub-pending-follow-up')).toBeVisible();
  await expect(page.locator('#app-content')).toContainText('Sin pendientes ni equipos que requieran seguimiento.');
  expect(await page.locator('.lub-section-head:has-text("REQUIEREN SEGUIMIENTO") + .lub-eq-list .lub-eq-code', { hasText: 'T-40' }).count()).toBe(0);
});

test('B — un registro COMPLETE se usa como el "último engrase" real (ignora un PARTIAL más viejo), nunca una fecha vieja', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  // Fix 2026-10-09: necesita un plan real con status real (AMARILLO,
  // "PROGRAMADO HOY") para que el equipo pueda aparecer en Alertas — ya no
  // basta con "sin registro de hoy" (ver §6/§8 del pedido, "una sola fuente
  // de verdad con la Ficha"). Programado HOY, sin registro de hoy (el
  // COMPLETE es de ayer): weekdayStatusFor() da AMARILLO real.
  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'T-41', brand: 'Volvo', model: 'A40', status: 'Operativo', locationId: 'l1', hourmeter: 1000 }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  const records = [
    { id: 'r-viejo', equipmentId: 'e1', date: isoDaysAgo(20), createdAt: isoDaysAgo(20), userName: 'Pedro L.', qty: 1.0, shiftId: 'shift_dia', operationalSnapshot: { executionCompleteness: 'PARTIAL' } },
    { id: 'r-nuevo', equipmentId: 'e1', date: isoDaysAgo(1), createdAt: isoDaysAgo(1), userName: 'Ana G.', qty: 2.0, shiftId: 'shift_dia' }, // COMPLETE (sin snapshot = no PARTIAL)
  ];

  await bootPage(page, { equipos, plans, records });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  // Regla E de doble turno (grease-validation.js: isRecordPendingValidation
  // ya NO excluye "vencida") — ambos registros de T-41 (hace 1 día y hace
  // 20 días) quedan fuera del plazo de validación, así que el equipo
  // entero sale de "REQUIEREN SEGUIMIENTO" (antigüedad) y pasa a "EN
  // SEGUIMIENTO · VALIDACIÓN" (ambos registros, cada uno pendiente de
  // firmar, nunca ocultos por antigüedad). El criterio original de esta
  // prueba ("latest COMPLETE gana sobre PARTIAL más viejo" en
  // buildCrewLubricationFollowUp) sigue probado en
  // tests/unit/lubrication-follow-up.test.js.
  await expect(page.locator('.lub-section-head:has-text("EN SEGUIMIENTO")')).toContainText('(2)');
  const pending = page.locator('#lub-pending-validations');
  await expect(pending).toContainText('T-41');
  await expect(pending).toContainText('Ana G.');
  await expect(pending).toContainText('Pedro L.');
});

test('C — un equipo con SOLO un registro PARTIAL permanece en Alertas (un PARTIAL nunca limpia la alerta)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  // Fix 2026-10-09: plan real con un día vencido reciente (ROJO) — el
  // PARTIAL de hace 20 días queda fuera de la ventana de 7 días de
  // mostRecentAssignedDate(), así que por sí solo nunca satisface la
  // ocurrencia vigente; el equipo es ROJO real, igual que diría la Ficha.
  const diaVencido = weekdayNDaysAgo(2);
  const equipos = [{ id: 'e1', code: 'T-42', brand: 'Hitachi', model: 'EX200', status: 'Operativo', locationId: 'l1', hourmeter: 1000 }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [diaVencido] }];
  const records = [{ id: 'r1', equipmentId: 'e1', date: isoDaysAgo(20), createdAt: isoDaysAgo(20), userName: 'Pedro L.', qty: 1.0, shiftId: 'shift_dia', operationalSnapshot: { executionCompleteness: 'PARTIAL' } }];

  await bootPage(page, { equipos, plans, records });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(seccion(page, 'ATRASADOS')).toContainText('T-42');
  await expect(page.locator('#lub-follow-up .lub-eq-code', { hasText: 'T-42' })).toHaveCount(0);
});

test('D — un equipo con un skip ("no se pudo ejecutar") y ningún record permanece en Alertas (un skip nunca crea un record ni limpia la alerta)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  // Fix 2026-10-09: plan real con un día vencido (ROJO) — un skip nunca crea
  // un record, así que por sí solo nunca cambia el estado real del equipo.
  const diaVencido = weekdayNDaysAgo(2);
  const equipos = [{ id: 'e1', code: 'T-43', brand: 'Komatsu', model: 'WA470', status: 'Operativo', locationId: 'l1', hourmeter: 1000 }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [diaVencido] }];
  const skips = [{ id: 's1', equipmentId: 'e1', date: isoDaysAgo(0), createdAt: isoDaysAgo(0), reason: 'SIN_TIEMPO', active: true, userName: 'Pedro L.' }];

  await bootPage(page, { equipos, plans, skips });
  await page.evaluate(() => { window.__mockData.lubrication_skips[0].shiftId = currentShiftId(); });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(seccion(page, 'ATRASADOS')).toContainText('T-43');
  await expect(page.locator('#lub-follow-up .lub-eq-code', { hasText: 'T-43' })).toHaveCount(0);
});

test('E — un equipo con COMPLETE de hoy nunca aparece a la vez en Realizados y en Alertas (sin duplicados)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'T-44', brand: 'Caterpillar', model: 'D8T', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  const records = [{ id: 'r1', equipmentId: 'e1', date: isoDaysAgo(0), createdAt: isoDaysAgo(0), userName: 'Ana G.', qty: 2.0, shiftId: 'shift_dia' }];

  await bootPage(page, { equipos, plans, records });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(seccion(page, 'REALIZADOS')).toContainText('T-44');
  const enAlertas = await page.locator('.lub-section-head:has-text("REQUIEREN SEGUIMIENTO")').count();
  if (enAlertas) {
    const alertCodes = await seccion(page, 'REQUIEREN SEGUIMIENTO').locator('.lub-eq-code').allTextContents();
    expect(alertCodes).not.toContain('T-44');
  }
});

// ============================================================
// INVARIANTE "local-first" (congelada sobre 625355f, 2026-10-08) — un
// COMPLETE guardado SOLO localmente debe reflejarse de inmediato (mismo
// rerender, sin Supabase/sync/conexión/logout/reload), y si la
// sincronización remota falla DESPUÉS, el resultado local visible NO debe
// revertirse. Confirmado leyendo el código real: ni `realizadosHoyList` ni
// `alertasTiempoSinEngrase` ni Atrasados/Mi Turno leen `lastSyncState` —
// esa variable solo alimenta el texto del chip de contexto (syncChip). La
// regla ya estaba cumplida por 625355f; estos tests la congelan para que
// una futura regresión (p.ej. alguien gateando estos cálculos con
// `lastSyncState`/`navigator.onLine`) rompa el build.
// ============================================================

test('A/B/C — COMPLETE local (sin red) sale de Alertas, sale de Mi Turno y entra a Realizados, todo en el mismo rerender', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'T-50', brand: 'Caterpillar', model: '740B', status: 'Operativo', locationId: 'l1', hourmeter: 1000 }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];

  await bootPage(page, { equipos, plans });
  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);
  // Antes del engrase: pendiente en Mi Turno y, sin registro, también en Alertas.
  await expect(seccion(page, 'MI TURNO')).toContainText('T-50');
  await expect(seccion(page, 'REQUIEREN SEGUIMIENTO')).toContainText('T-50');

  // Guarda SOLO local (igual que DB.put() real del flujo de registrar) —
  // sin tocar lastSyncState/red — y vuelve a renderizar, igual que el
  // usuario real volviendo a "Mi Turno" después de guardar.
  await page.evaluate(() => {
    window.__mockData.lubrication_records.push({
      id: 'r-nuevo', equipmentId: 'e1', date: new Date().toISOString(), createdAt: new Date().toISOString(),
      userName: 'Lubricador de prueba', qty: 2.0, shiftId: 'shift_dia',
    });
    return window.renderLubricadorHome();
  });

  expect(await enCuantasSeccionesDeTrabajo(page, 'T-50')).toBe(1);
  await expect(seccion(page, 'REALIZADOS')).toContainText('T-50'); // C: entra a Realizados
  const enAlertas = await page.locator('.lub-section-head:has-text("REQUIEREN SEGUIMIENTO")').count();
  if (enAlertas) {
    expect(await seccion(page, 'REQUIEREN SEGUIMIENTO').locator('.lub-eq-code').allTextContents()).not.toContain('T-50'); // A: sale de Alertas
  }
  // B: sale de Mi Turno — ya cubierto por enCuantasSeccionesDeTrabajo === 1 (solo Realizados).
});

test('D — si la sincronización remota falla DESPUÉS de guardar localmente, el resultado visual local (Realizados, fuera de Alertas) NO revierte', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const equipos = [{ id: 'e1', code: 'T-51', brand: 'Volvo', model: 'A40', status: 'Operativo', locationId: 'l1', hourmeter: 1000 }];

  await bootPage(page, { equipos });
  await page.evaluate(() => {
    window.__mockData.lubrication_records.push({
      id: 'r-nuevo', equipmentId: 'e1', date: new Date().toISOString(), createdAt: new Date().toISOString(),
      userName: 'Lubricador de prueba', qty: 2.0, shiftId: 'shift_dia',
    });
    return window.renderLubricadorHome();
  });
  expect(errors).toEqual([]);
  await expect(seccion(page, 'REALIZADOS')).toContainText('T-51');

  // La sincronización remota falla DESPUÉS del guardado local — sin tocar
  // ningún record/skip, solo el estado global de sync — y se vuelve a
  // renderizar (p.ej. el usuario revisa "Mi Turno" otra vez mientras no hay
  // conexión).
  await page.evaluate(() => {
    window.lastSyncState.status = 'error';
    window.lastSyncState.message = 'Falló: fetch failed';
    return window.renderLubricadorHome();
  });

  // El resultado local no revierte: sigue solo en Realizados, nunca de
  // vuelta en Mi Turno/Atrasados/Alertas.
  expect(await enCuantasSeccionesDeTrabajo(page, 'T-51')).toBe(1);
  await expect(seccion(page, 'REALIZADOS')).toContainText('T-51');
  const enAlertas = await page.locator('.lub-section-head:has-text("REQUIEREN SEGUIMIENTO")').count();
  if (enAlertas) {
    expect(await seccion(page, 'REQUIEREN SEGUIMIENTO').locator('.lub-eq-code').allTextContents()).not.toContain('T-51');
  }
});

test('E — un PARTIAL guardado localmente conserva el trabajo formal y nunca entra a Realizados tras el rerender', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  // Fix 2026-10-09: plan real con un día vencido (ROJO) ANTES del PARTIAL.
  // Al guardar el PARTIAL de hoy, weekdayStatusFor() pasa a VERDE (cuenta
  // cualquier record como "hecho", sin tocar esa función) — pero
  // partialPendienteIds (mismo criterio que reclasifica Mi Turno/Atrasados)
  // mantiene la alerta real, nunca un VERDE a secas.
  const diaVencido = weekdayNDaysAgo(2);
  const equipos = [{ id: 'e1', code: 'T-52', brand: 'Hitachi', model: 'EX200', status: 'Operativo', locationId: 'l1', hourmeter: 1000 }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [diaVencido] }];

  await bootPage(page, { equipos, plans });
  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);
  await expect(seccion(page, 'ATRASADOS')).toContainText('T-52');
  await expect(page.locator('#lub-follow-up .lub-eq-code', { hasText: 'T-52' })).toHaveCount(0);

  await page.evaluate(() => {
    window.__mockData.lubrication_records.push({
      id: 'r-partial', equipmentId: 'e1', date: new Date().toISOString(), createdAt: new Date().toISOString(),
      userName: 'Lubricador de prueba', qty: 1.0, shiftId: 'shift_dia',
      operationalSnapshot: { executionCompleteness: 'PARTIAL' },
    });
    return window.renderLubricadorHome();
  });

  await expect(page.locator('#lub-follow-up .lub-eq-code', { hasText: 'T-52' })).toHaveCount(0); // last record is today; age matches Admin
  await expect(seccion(page, 'ATRASADOS')).toContainText('T-52'); // formal PARTIAL work is preserved
  const enRealizados = await page.locator('.lub-section-head:has-text("REALIZADOS")').count();
  if (enRealizados) {
    expect(await seccion(page, 'REALIZADOS').locator('.lub-eq-code').allTextContents()).not.toContain('T-52');
  }
});

test('F — un skip ("no se pudo ejecutar") guardado localmente (sin red) permanece en Alertas y nunca entra a Realizados tras el rerender', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  // Fix 2026-10-09: plan real con un día vencido (ROJO) — un skip nunca crea
  // un record, así que el estado real se mantiene ROJO después de guardarlo.
  const diaVencido = weekdayNDaysAgo(2);
  const equipos = [{ id: 'e1', code: 'T-53', brand: 'Komatsu', model: 'WA470', status: 'Operativo', locationId: 'l1', hourmeter: 1000 }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [diaVencido] }];

  await bootPage(page, { equipos, plans });
  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);
  await expect(seccion(page, 'ATRASADOS')).toContainText('T-53');
  await expect(page.locator('#lub-follow-up .lub-eq-code', { hasText: 'T-53' })).toHaveCount(0);

  await page.evaluate(() => {
    window.__mockData.lubrication_skips.push({
      id: 's-nuevo', equipmentId: 'e1', date: new Date().toISOString(), createdAt: new Date().toISOString(),
      reason: 'SIN_TIEMPO', active: true, userName: 'Lubricador de prueba', shiftId: currentShiftId(),
    });
    return window.renderLubricadorHome();
  });

  await expect(seccion(page, 'ATRASADOS')).toContainText('T-53');
  await expect(page.locator('#lub-follow-up .lub-eq-code', { hasText: 'T-53' })).toHaveCount(0); // un skip nunca crea un record ni limpia la alerta
  const enRealizados = await page.locator('.lub-section-head:has-text("REALIZADOS")').count();
  if (enRealizados) {
    expect(await seccion(page, 'REALIZADOS').locator('.lub-eq-code').allTextContents()).not.toContain('T-53');
  }
});

// Pedido "MATRIZ LUBRICADOR POR UBICACIÓN COMPLETA" (2026-10-09): integración
// real del botón "Matriz semanal" dentro de renderLubricadorHome() — confirma
// que el wiring REAL (no un test aislado de la función pura) pasa
// equiposForLubricadorMatriz(equipos, scope) — TODA la ubicación, turno Día Y
// Noche — en vez de `normal` (el scope restrictivo de "Mi Turno").
test('botón "Matriz semanal": abre con TODOS los equipos de la ubicación activa (turno Día y Noche), nunca otra ubicación — Mi Turno sigue igual de restringido', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const equipos = [
    { id: 'e1', code: 'VOL-DIA', brand: 'Caterpillar', model: 'D8T', status: 'Operativo', locationId: 'l1' },
    { id: 'e2', code: 'VOL-NOCHE', brand: 'Komatsu', model: 'WA470', status: 'Operativo', locationId: 'l1' },
    { id: 'e3', code: 'OTRA-UBIC', brand: 'Volvo', model: 'A40', status: 'Operativo', locationId: 'l2' },
  ];
  // e1: turno Día (shiftId en el plan). e2: turno Noche. Ninguno de los 2
  // tiene registro hoy — ambos quedan "pendientes" para Mi Turno, lo que
  // además confirma que SÍ pertenecen al scope restrictivo normal de la
  // cuadrilla default (sirve para distinguir "Mi Turno" de "Matriz" abajo).
  const hoyWeekday = weekdayName(new Date());
  const plans = [
    { id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday], shiftId: 'shift_dia' },
    { id: 'p2', equipmentId: 'e2', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday], shiftId: 'shift_noche' },
    { id: 'p3', equipmentId: 'e3', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] },
  ];

  await bootPage(page, { equipos, plans });
  await page.evaluate(() => {
    window.__capturedMatriz = null;
    // Reemplaza el stub no-op de bootPage() SOLO para capturar los
    // argumentos reales con los que el botón real lo invoca — nunca
    // reimplementa la función en sí (eso ya se prueba en
    // tests/unit/lubricador-matriz-modal.test.js).
    window.openLubricadorMatrizModal = (args) => { window.__capturedMatriz = args; };
  });
  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);

  await page.click('#lub-quick-matriz');
  expect(errors).toEqual([]); // el click no debe lanzar (p. ej. ReferenceError por una dependencia sin cargar)
  const captured = await page.evaluate(() => window.__capturedMatriz);

  const idsMatriz = captured.equipos.map((e) => e.id).sort();
  expect(idsMatriz).toEqual(['e1', 'e2']); // turno Día Y Noche de l1, nunca e3 (l2)
  expect(captured.locationName).toBe('Rajo Principal'); // LOCATIONS[0] = l1
  expect(new Set(idsMatriz).size).toBe(idsMatriz.length); // sin duplicados

  // "Mi Turno" (secciones reales ya pintadas) sigue viendo e1/e2 como
  // trabajo normal de la cuadrilla default — sin cambios de scope ahí.
  expect(await enCuantasSeccionesDeTrabajo(page, 'VOL-DIA')).toBe(1);
  expect(await enCuantasSeccionesDeTrabajo(page, 'VOL-NOCHE')).toBe(1);
});

// ============================================================
// "PULIDA FINAL MI TURNO + AUDITORÍA KPI" (2026-10-09) — bug real reportado
// con captura: "MI TURNO (2)" mostraba 2 equipos ASIGNADOS ("45-77"/"A-02",
// PROGRAMADO HOY) pero el KPI "Pendientes hoy" marcaba 0. Causa raíz
// trazada en código (nunca asumida): Pendientes hoy/Arrastrados/Realizados
// hoy leían listas previas al merge con statusesAssigned
// (pendientesHoyList/arrastrados/realizadosHoy) — un equipo que llegaba
// SOLO por el camino de asignación nunca entraba ahí, aunque sí aparecía en
// la sección ya fusionada (miTurnoTotal/arrastradosTotal/realizadosHoyList,
// las MISMAS que ya usaba updateLubricadorWidgetSnapshot()). Casos A-G del
// pedido, todos contra la función real.
// ============================================================

test('A/F — 2 equipos ASIGNADOS "PROGRAMADO HOY" en Mi Turno: el KPI "Pendientes hoy" es 2, igual al contador real de la sección (nunca 0)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  // locationId 'l2' (no la ubicación default de crew1, 'l1') + assignment a
  // crew1 → clasifican como `assigned`, nunca `normal` (mismo patrón que el
  // caso real "T-31" de arriba) — reproduce exactamente "45-77"/"A-02".
  const equipos = [
    { id: 'e1', code: '45-77', brand: 'Komatsu', model: 'WA470', status: 'Operativo', locationId: 'l2' },
    { id: 'e2', code: 'A-02', brand: 'Caterpillar', model: 'D8T', status: 'Operativo', locationId: 'l2' },
  ];
  const plans = [
    { id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] },
    { id: 'p2', equipmentId: 'e2', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] },
  ];
  const assignments = [
    { id: 'a1', equipmentId: 'e1', assignedCrewId: 'crew1', status: 'PENDING', active: true },
    { id: 'a2', equipmentId: 'e2', assignedCrewId: 'crew1', status: 'PENDING', active: true },
  ];

  await bootPage(page, { crewLocations: ASSIGNMENT_COVERAGE, equipos, plans, assignments });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(page.locator('.lub-section-head:has-text("MI TURNO")')).toContainText('(2)');
  await expect(seccion(page, 'MI TURNO')).toContainText('45-77');
  await expect(seccion(page, 'MI TURNO')).toContainText('A-02');
  // El bug real: esto marcaba "0" antes del fix.
  await expect(kpiValue(page, 'Pendientes hoy')).toHaveText('2');
});

test('B — una de las 2 asignaciones pasa a COMPLETE: sale de Mi Turno (Pendientes hoy → 1) y entra a Realizados hoy (KPI → 1), nunca ambos a la vez', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const equipos = [
    { id: 'e1', code: '45-77', brand: 'Komatsu', model: 'WA470', status: 'Operativo', locationId: 'l2' },
    { id: 'e2', code: 'A-02', brand: 'Caterpillar', model: 'D8T', status: 'Operativo', locationId: 'l2' },
  ];
  const plans = [
    { id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] },
    { id: 'p2', equipmentId: 'e2', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] },
  ];
  const assignments = [
    { id: 'a1', equipmentId: 'e1', assignedCrewId: 'crew1', status: 'PENDING', active: true },
    { id: 'a2', equipmentId: 'e2', assignedCrewId: 'crew1', status: 'PENDING', active: true },
  ];

  await bootPage(page, { crewLocations: ASSIGNMENT_COVERAGE, equipos, plans, assignments });
  await page.evaluate(() => window.renderLubricadorHome());
  await expect(kpiValue(page, 'Pendientes hoy')).toHaveText('2');
  await expect(kpiValue(page, 'Realizados hoy')).toHaveText('0');

  await page.evaluate(() => {
    window.__mockData.lubrication_records.push({
      id: 'r-nuevo', equipmentId: 'e1', date: new Date().toISOString(), createdAt: new Date().toISOString(),
      userName: 'Lubricador de prueba', qty: 2.0, shiftId: 'shift_dia',
    });
    return window.renderLubricadorHome();
  });

  expect(errors).toEqual([]);
  await expect(kpiValue(page, 'Pendientes hoy')).toHaveText('1');
  await expect(kpiValue(page, 'Realizados hoy')).toHaveText('1');
  expect(await enCuantasSeccionesDeTrabajo(page, '45-77')).toBe(1); // solo Realizados
  await expect(seccion(page, 'MI TURNO')).toContainText('A-02');
});

test('C — un equipo ASIGNADO con un PARTIAL de hoy sigue PENDIENTE (nunca desaparece, nunca cuenta como Realizado) — antes del fix se perdía por completo', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'T-60', brand: 'Volvo', model: 'A40', status: 'Operativo', locationId: 'l2' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  const assignments = [{ id: 'a1', equipmentId: 'e1', assignedCrewId: 'crew1', status: 'PENDING', active: true }];
  const records = [{
    id: 'r1', equipmentId: 'e1', date: isoDaysAgo(0), createdAt: isoDaysAgo(0), userName: 'Ana G.', qty: 1.0, shiftId: 'shift_dia',
    operationalSnapshot: { executionCompleteness: 'PARTIAL' },
  }];

  await bootPage(page, { crewLocations: ASSIGNMENT_COVERAGE, equipos, plans, assignments, records });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(seccion(page, 'MI TURNO')).toContainText('T-60');
  await expect(seccion(page, 'MI TURNO')).toContainText('PROGRAMADO HOY');
  expect(await enCuantasSeccionesDeTrabajo(page, 'T-60')).toBe(1); // solo Mi Turno, nunca Realizados
  await expect(kpiValue(page, 'Pendientes hoy')).toHaveText('1');
  await expect(kpiValue(page, 'Realizados hoy')).toHaveText('0');
});

test('A/C — un equipo NORMAL vencido por HORÓMETRO cuenta en "Vencidos por horas" (+1), nunca infla "Pendientes hoy" ni aparece en Mi Turno', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  // "Horas de operación": 500h desde el último engrase, frecuencia 250h →
  // muy vencido (ROJO), sin asignación — puramente `normal`.
  const equipos = [{ id: 'e1', code: 'T-61', brand: 'Hitachi', model: 'EX200', status: 'Operativo', locationId: 'l1', hourmeter: 600 }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Horas de operación', frequency: 250, lastGreaseHour: 100, alertYellowHours: 10 }];

  await bootPage(page, { equipos, plans });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(kpiValue(page, 'Vencidos por horas')).toHaveText('1');
  await expect(kpiValue(page, 'Pendientes hoy')).toHaveText('0'); // no también contado aquí
  expect(await page.locator('.lub-section-head:has-text("MI TURNO")').count()).toBe(0); // nunca se cuela en Mi Turno
});

test('C — un equipo ROJO por plan "Día y turno de la semana" (vencido de calendario, no de horas) NO cuenta en "Vencidos por horas"', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const diaVencido = weekdayNDaysAgo(2);
  const equipos = [{ id: 'e1', code: 'T-65', brand: 'Komatsu', model: 'WA470', status: 'Operativo', locationId: 'l1', hourmeter: 1000 }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [diaVencido] }];

  await bootPage(page, { equipos, plans });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(seccion(page, 'ATRASADOS')).toContainText('T-65'); // sí es trabajo atrasado real
  await expect(kpiValue(page, 'Vencidos por horas')).toHaveText('0'); // pero no es un vencimiento por horas
});

test('B — un equipo ASIGNADO (no normal) vencido por HORÓMETRO también cuenta en "Vencidos por horas" (el ESTADO decide, no el origen) — antes del fix quedaba fuera por completo', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  // locationId 'l2' (no la ubicación default de crew1) + assignment a
  // crew1 → clasifica como `assigned`, nunca `normal`.
  const equipos = [{ id: 'e1', code: 'T-66', brand: 'Volvo', model: 'A40', status: 'Operativo', locationId: 'l2', hourmeter: 600 }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Horas de operación', frequency: 250, lastGreaseHour: 100, alertYellowHours: 10 }];
  const assignments = [{ id: 'a1', equipmentId: 'e1', assignedCrewId: 'crew1', status: 'PENDING', active: true }];

  await bootPage(page, { crewLocations: ASSIGNMENT_COVERAGE, equipos, plans, assignments });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(kpiValue(page, 'Vencidos por horas')).toHaveText('1');
  // §4 del pedido: aceptable que además aparezca en Atrasados (overlap a
  // propósito — estado técnico vs. bandeja de trabajo, significados
  // distintos) — el merge de asignados ya mete cualquier ROJO asignado ahí.
  await expect(seccion(page, 'ATRASADOS')).toContainText('T-66');
});

test('D — un equipo que clasifica como asignado a SU PROPIA cuadrilla (redundante) cuenta una sola vez en "Vencidos por horas", nunca 2 veces', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  // En la ubicación/cuadrilla default (l1/crew1) — candidato natural a
  // "normal" — PERO con una asignación activa a esa MISMA cuadrilla:
  // classifyEquipmentWork() lo deja SOLO en `assigned` (nunca duplicado en
  // `normal`, ver operational-scope.js) — igual, confirma end-to-end que
  // el KPI nunca lo cuenta 2 veces aunque pudiera llegar por los 2 caminos.
  const equipos = [{ id: 'e1', code: 'T-67', brand: 'Caterpillar', model: 'D8T', status: 'Operativo', locationId: 'l1', hourmeter: 600 }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Horas de operación', frequency: 250, lastGreaseHour: 100, alertYellowHours: 10 }];
  const assignments = [{ id: 'a1', equipmentId: 'e1', assignedCrewId: 'crew1', status: 'PENDING', active: true }];

  await bootPage(page, { crewLocations: ASSIGNMENT_COVERAGE, equipos, plans, assignments });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(kpiValue(page, 'Vencidos por horas')).toHaveText('1'); // nunca "2"
});

test('E — tras registrar el engrase (lastGreaseHour avanza, status deja de ser ROJO), el equipo deja de contar en "Vencidos por horas" en el siguiente render', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const equipos = [{ id: 'e1', code: 'T-68', brand: 'Hitachi', model: 'EX200', status: 'Operativo', locationId: 'l1', hourmeter: 600 }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Horas de operación', frequency: 250, lastGreaseHour: 100, alertYellowHours: 10 }];

  await bootPage(page, { equipos, plans });
  await page.evaluate(() => window.renderLubricadorHome());
  await expect(kpiValue(page, 'Vencidos por horas')).toHaveText('1');

  // Simula lo que el flujo real de registrar hace para un plan por horas
  // (app.js: `plan.lastGreaseHour = newHourmeter`, ver confirmHourmeterChange()
  // / finalizeGreaseRecord()) — statusFor() para "Horas de operación" NUNCA
  // mira lubrication_records, solo plan.lastGreaseHour vs equipment.hourmeter
  // (lubrication-status.js) — así que el COMPLETE real se refleja así, no
  // empujando un record.
  await page.evaluate(() => {
    window.__mockData.lubrication_plans[0].lastGreaseHour = 600;
    return window.renderLubricadorHome();
  });

  expect(errors).toEqual([]);
  await expect(kpiValue(page, 'Vencidos por horas')).toHaveText('0');
});

test('E — sin duplicados: cada equipo cuenta en el KPI de UNA sola categoría de trabajo pendiente/realizado', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const diaVencido = weekdayNDaysAgo(2);
  const equipos = [
    { id: 'e1', code: 'T-62', brand: 'Volvo', model: 'A40', status: 'Operativo', locationId: 'l1' }, // pendiente hoy
    { id: 'e2', code: 'T-63', brand: 'Hitachi', model: 'EX200', status: 'Operativo', locationId: 'l1' }, // arrastrado
    { id: 'e3', code: 'T-64', brand: 'Komatsu', model: 'WA470', status: 'Operativo', locationId: 'l1' }, // realizado
  ];
  const plans = [
    { id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] },
    { id: 'p2', equipmentId: 'e2', controlType: 'Día y turno de la semana', assignedDays: [diaVencido] },
    { id: 'p3', equipmentId: 'e3', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] },
  ];
  const records = [{ id: 'r1', equipmentId: 'e3', date: isoDaysAgo(0), createdAt: isoDaysAgo(0), userName: 'Ana G.', qty: 2.0, shiftId: 'shift_dia' }];

  await bootPage(page, { equipos, plans, records });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(kpiValue(page, 'Pendientes hoy')).toHaveText('1');
  await expect(kpiValue(page, 'Pendientes del turno anterior')).toHaveText('1');
  await expect(kpiValue(page, 'Realizados hoy')).toHaveText('1');
  for (const code of ['T-62', 'T-63', 'T-64']) {
    expect(await enCuantasSeccionesDeTrabajo(page, code)).toBe(1);
  }
});

test('G — 0 pendientes del turno actual: el KPI "Pendientes hoy" es 0 y la sección "MI TURNO" no se muestra (mismo universo, nunca contradictorios)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  await bootPage(page, { equipos: [] });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(kpiValue(page, 'Pendientes hoy')).toHaveText('0');
  expect(await page.locator('.lub-section-head:has-text("MI TURNO")').count()).toBe(0);
});

// ============================================================
// Pedido "...REALIZADO ADELANTADO" (2026-10-09), Parte O. Causa raíz
// confirmada en código (nunca asumida): weekdayStatusFor()
// (lubrication-status.js) ahora lee operationalSnapshot.satisfiedOccurrenceKey
// (resolveOutOfPlanSatisfaction(), operational-scope.js, ventana de 1 día
// — nunca 7) — la MISMA señal que ya usa la Matriz (estadoCelda()). Esta
// suite confirma el efecto end-to-end sobre renderLubricadorHome() real:
// la ocurrencia de HOY, satisfecha AYER, nunca vuelve a aparecer como
// pendiente/atrasada, nunca se cuenta en "Realizados hoy" (esa es SOLO
// records de HOY) y aparece en su propia sección informativa.
// ============================================================

test('O-A — plan programado HOY + COMPLETE fuera de plan AYER que satisfizo esta ocurrencia: aparece en "REALIZADOS ADELANTADOS", nunca en Pendientes hoy/Atrasados/Mi Turno/Realizados hoy', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: '20-5530', brand: 'Caterpillar', model: 'D8T', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'plan_x', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  const records = [{
    id: 'r1', equipmentId: 'e1', date: isoDaysAgo(1), createdAt: isoDaysAgo(1), userName: 'Jose Guerrero', qty: 2.0, shiftId: 'shift_dia',
    operationalSnapshot: { executionType: 'OUT_OF_PLAN', outOfPlanReason: 'PM', executionCompleteness: 'COMPLETE', satisfiedOccurrenceKey: `plan_x:${isoDateOnly(0)}`, crewId: 'crew1', crewLocationIdAtExecution: 'l1' },
  }];

  await bootPage(page, { equipos, plans, records });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  await expect(page.locator('.lub-section-head:has-text("REALIZADOS ADELANTADOS")')).toContainText('(1)');
  await expect(seccion(page, 'REALIZADOS ADELANTADOS')).toContainText('20-5530');
  await expect(seccion(page, 'REALIZADOS ADELANTADOS')).toContainText('Jose Guerrero');
  await expect(seccion(page, 'REALIZADOS ADELANTADOS')).toContainText('Cuadrilla A');

  // H/I/J/K del pedido: nunca pendiente/atrasado/realizado-hoy a la vez.
  await expect(kpiValue(page, 'Pendientes hoy')).toHaveText('0');
  await expect(kpiValue(page, 'Pendientes del turno anterior')).toHaveText('0');
  await expect(kpiValue(page, 'Realizados hoy')).toHaveText('0'); // la ejecución real fue AYER, no hoy
  expect(await page.locator('.lub-section-head:has-text("MI TURNO")').count()).toBe(0);
  expect(await page.locator('.lub-section-head:has-text("ATRASADOS")').count()).toBe(0);
  expect(await page.locator('.lub-section-head:has-text("REALIZADOS (")').count()).toBe(0); // "Realizados hoy" (no adelantados) oculta, nunca una tarjeta en 0
  // Q del pedido: sin duplicados — '20-5530' aparece UNA sola vez en toda
  // las secciones formales. El seguimiento informativo PUEDE coexistir —
  // regla E de doble turno (grease-validation.js): el registro de AYER ya
  // pasó el plazo de validación ("vencida" ya no se oculta), así que el
  // seguimiento real que coexiste es "EN SEGUIMIENTO · VALIDACIÓN"
  // (nunca "REQUIEREN SEGUIMIENTO" por antigüedad — ese excluye equipos ya
  // cubiertos por su propia tarjeta de validación pendiente).
  await expect(seccion(page, 'REALIZADOS ADELANTADOS').locator('.lub-eq-code', { hasText: '20-5530' })).toHaveCount(1);
  await expect(page.locator('#lub-pending-validations')).toContainText('20-5530');
});

test('O-B/P — PARTIAL ayer NUNCA satisface hoy: sigue pendiente en MI TURNO, nunca en "Realizados Adelantados"', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: '20-5531', brand: 'Caterpillar', model: 'D8T', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'plan_y', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  const records = [{
    id: 'r2', equipmentId: 'e1', date: isoDaysAgo(1), createdAt: isoDaysAgo(1), userName: 'Jose Guerrero', qty: 1.0, shiftId: 'shift_dia',
    operationalSnapshot: { executionType: 'OUT_OF_PLAN', outOfPlanReason: 'PM', executionCompleteness: 'PARTIAL', satisfiedOccurrenceKey: null },
  }];

  await bootPage(page, { equipos, plans, records });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  expect(await page.locator('.lub-section-head:has-text("REALIZADOS ADELANTADOS")').count()).toBe(0);
  await expect(seccion(page, 'MI TURNO')).toContainText('20-5531');
  await expect(kpiValue(page, 'Pendientes hoy')).toHaveText('1');
});

test('O-D — COMPLETE a +3 días (fuera de la ventana de 1 día) NUNCA satisface automáticamente: sigue pendiente, nunca "Realizados Adelantados"', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: '20-5532', brand: 'Caterpillar', model: 'D8T', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'plan_z', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  const records = [{
    id: 'r3', equipmentId: 'e1', date: isoDaysAgo(3), createdAt: isoDaysAgo(3), userName: 'Jose Guerrero', qty: 2.0, shiftId: 'shift_dia',
    // Fuera de la ventana real de 1 día -> resolveOutOfPlanSatisfaction()
    // real ya habría devuelto null al guardar esto (ver operational-scope
    // .test.js, CASO N actualizado) — se simula ese resultado real.
    operationalSnapshot: { executionType: 'OUT_OF_PLAN', outOfPlanReason: 'OTRO', executionCompleteness: 'COMPLETE', satisfiedOccurrenceKey: null },
  }];

  await bootPage(page, { equipos, plans, records });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  expect(await page.locator('.lub-section-head:has-text("REALIZADOS ADELANTADOS")').count()).toBe(0);
  await expect(seccion(page, 'MI TURNO')).toContainText('20-5532');
});

// Fix 2026-10-09 ("DIAGNÓSTICO A-02 SIGUE EN MI TURNO") — hueco real: O-A/
// O-B/O-D (arriba) nunca probaron un equipo que llega por el camino
// ASIGNADO (statusesAssigned, vía lubrication_assignments) combinado con
// "adelantado". El merge real (renderLubricadorHome(), bloque
// "statusesAssigned.forEach" tras "Mi Turno simplificado") ya filtra por
// `s.code !== 'VERDE'` antes de reinsertar un equipo asignado — si
// weekdayStatusFor() (lubrication-status.js) marcó VERDE/adelantado=true,
// el assignment NUNCA debe reinsertarlo. Estos 4 casos (A/B/C/D del pedido)
// lo prueban de verdad, con una assignment PENDING real hacia la cuadrilla
// del Lubricador — equipo en OTRA ubicación (l2) para pasar 100% por
// "asignado", nunca por "normal".
test('ASIGNADO-A — assignment activo + plan hoy + COMPLETE fuera de plan AYER que satisface la ocurrencia: NUNCA reinsertado en Mi Turno, SÍ en Realizados Adelantados', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'A-02', brand: 'Caterpillar', model: '740B', status: 'Operativo', locationId: 'l2' }];
  const plans = [{ id: 'plan_asig_a', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  const records = [{
    id: 'r_asig_a', equipmentId: 'e1', date: isoDaysAgo(1), createdAt: isoDaysAgo(1), userName: 'Jose Guerrero', qty: 6.0, shiftId: 'shift_dia',
    operationalSnapshot: { executionType: 'OUT_OF_PLAN', outOfPlanReason: 'OPORTUNIDAD', executionCompleteness: 'COMPLETE', satisfiedOccurrenceKey: `plan_asig_a:${isoDateOnly(0)}`, crewId: 'crew1', crewLocationIdAtExecution: 'l1' },
  }];
  const assignments = [{
    id: 'asg1', active: true, status: 'PENDING', occurrenceKey: `plan_asig_a:${isoDateOnly(0)}`,
    equipmentId: 'e1', planId: 'plan_asig_a', assignedCrewId: 'crew1',
  }];

  await bootPage(page, { crewLocations: ASSIGNMENT_COVERAGE, equipos, plans, records, assignments });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  expect(await page.locator('.lub-section-head:has-text("MI TURNO")').count()).toBe(0);
  expect(await page.locator('.lub-section-head:has-text("ATRASADOS")').count()).toBe(0);
  await expect(page.locator('.lub-section-head:has-text("REALIZADOS ADELANTADOS")')).toContainText('(1)');
  await expect(seccion(page, 'REALIZADOS ADELANTADOS')).toContainText('A-02');
  await expect(kpiValue(page, 'Pendientes hoy')).toHaveText('0');
});

test('ASIGNADO-B — assignment activo + plan hoy + COMPLETE hace 2 días (fuera de ventana): SIGUE pendiente en Mi Turno', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'A-02', brand: 'Caterpillar', model: '740B', status: 'Operativo', locationId: 'l2' }];
  const plans = [{ id: 'plan_asig_b', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  const records = [{
    id: 'r_asig_b', equipmentId: 'e1', date: isoDaysAgo(2), createdAt: isoDaysAgo(2), userName: 'Jose Guerrero', qty: 6.0, shiftId: 'shift_dia',
    operationalSnapshot: { executionType: 'OUT_OF_PLAN', outOfPlanReason: 'OTRO', executionCompleteness: 'COMPLETE', satisfiedOccurrenceKey: null },
  }];
  const assignments = [{
    id: 'asg2', active: true, status: 'PENDING', occurrenceKey: `plan_asig_b:${isoDateOnly(0)}`,
    equipmentId: 'e1', planId: 'plan_asig_b', assignedCrewId: 'crew1',
  }];

  await bootPage(page, { crewLocations: ASSIGNMENT_COVERAGE, equipos, plans, records, assignments });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  expect(await page.locator('.lub-section-head:has-text("REALIZADOS ADELANTADOS")').count()).toBe(0);
  await expect(seccion(page, 'MI TURNO')).toContainText('A-02');
  await expect(kpiValue(page, 'Pendientes hoy')).toHaveText('1');
});

test('ASIGNADO-C — assignment activo + PARTIAL ayer: PARTIAL nunca satisface, sigue pendiente en Mi Turno', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'A-02', brand: 'Caterpillar', model: '740B', status: 'Operativo', locationId: 'l2' }];
  const plans = [{ id: 'plan_asig_c', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  const records = [{
    id: 'r_asig_c', equipmentId: 'e1', date: isoDaysAgo(1), createdAt: isoDaysAgo(1), userName: 'Jose Guerrero', qty: 3.0, shiftId: 'shift_dia',
    operationalSnapshot: { executionType: 'OUT_OF_PLAN', outOfPlanReason: 'OTRO', executionCompleteness: 'PARTIAL', satisfiedOccurrenceKey: null },
  }];
  const assignments = [{
    id: 'asg3', active: true, status: 'PENDING', occurrenceKey: `plan_asig_c:${isoDateOnly(0)}`,
    equipmentId: 'e1', planId: 'plan_asig_c', assignedCrewId: 'crew1',
  }];

  await bootPage(page, { crewLocations: ASSIGNMENT_COVERAGE, equipos, plans, records, assignments });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  expect(await page.locator('.lub-section-head:has-text("REALIZADOS ADELANTADOS")').count()).toBe(0);
  await expect(seccion(page, 'MI TURNO')).toContainText('A-02');
});

test('ASIGNADO-D — una occurrence ya satisfecha (adelantado) nunca vuelve a aparecer aunque exista un assignment activo apuntando exactamente a esa misma occurrenceKey', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'A-02', brand: 'Caterpillar', model: '740B', status: 'Operativo', locationId: 'l2' }];
  const plans = [{ id: 'plan_asig_d', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  const occurrenceKeyHoy = `plan_asig_d:${isoDateOnly(0)}`;
  const records = [{
    id: 'r_asig_d', equipmentId: 'e1', date: isoDaysAgo(1), createdAt: isoDaysAgo(1), userName: 'Jose Guerrero', qty: 6.0, shiftId: 'shift_dia',
    operationalSnapshot: { executionType: 'OUT_OF_PLAN', outOfPlanReason: 'OPORTUNIDAD', executionCompleteness: 'COMPLETE', satisfiedOccurrenceKey: occurrenceKeyHoy, crewId: 'crew1', crewLocationIdAtExecution: 'l1' },
  }];
  // La misma occurrenceKey que ya satisfizo el record de arriba — simula el
  // caso real reportado: una assignment PENDING sigue viva para la MISMA
  // ocurrencia que un COMPLETE adelantado ya resolvió.
  const assignments = [{
    id: 'asg4', active: true, status: 'PENDING', occurrenceKey: occurrenceKeyHoy,
    equipmentId: 'e1', planId: 'plan_asig_d', assignedCrewId: 'crew1',
  }];

  await bootPage(page, { crewLocations: ASSIGNMENT_COVERAGE, equipos, plans, records, assignments });
  await page.evaluate(() => window.renderLubricadorHome());

  expect(errors).toEqual([]);
  expect(await page.locator('.lub-section-head:has-text("MI TURNO")').count()).toBe(0);
  expect(await page.locator('.lub-section-head:has-text("ATRASADOS")').count()).toBe(0);
  await expect(seccion(page, 'REALIZADOS ADELANTADOS').locator('.lub-eq-code', { hasText: 'A-02' })).toHaveCount(1);
  // Regla E de doble turno: el registro ya pasó el plazo de validación —
  // coexiste con "EN SEGUIMIENTO · VALIDACIÓN", no con "REQUIEREN
  // SEGUIMIENTO" (ver comentario de O-A, misma causa).
  await expect(page.locator('#lub-pending-validations')).toContainText('A-02');
  await expect(page.locator('.lub-section-head:has-text("REALIZADOS ADELANTADOS")')).toContainText('(1)');
});

// Fix 2026-10-09 ("FIX REALIZADO ADELANTADO + QR INTERNO", Parte A del
// pedido) — CIERRA el diagnóstico anterior ("A-02 sigue en Mi Turno"):
// resolveEarlyOccurrenceSatisfaction() (renombrada de
// resolveOutOfPlanSatisfaction()) ahora se llama SIEMPRE al guardar,
// nunca solo para executionType === 'OUT_OF_PLAN' — executionType describe
// CÓMO se ejecutó, nunca si satisface técnicamente la ocurrencia. A/B/C del
// pedido: PLANNED/ASSIGNED/OUT_OF_PLAN COMPLETE 1 día antes satisfacen por
// igual — mismo satisfiedOccurrenceKey, mismo resultado.
for (const tipo of ['PLANNED', 'ASSIGNED', 'OUT_OF_PLAN']) {
  test(`A/B/C — COMPLETE ${tipo} 1 día antes SÍ satisface la ocurrencia de hoy (executionType nunca decide, solo describe) → Realizado Adelantado`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e));

    const hoyWeekday = weekdayName(new Date());
    // l1: misma ubicación que la cuadrilla del fixture (Cuadrilla A) — para
    // ASSIGNED se agrega además una assignment (redundante con "normal",
    // igual que ya prueba ASIGNADO-D) sin cambiar la ubicación del equipo.
    const equipos = [{ id: 'e1', code: 'A-02', brand: 'Caterpillar', model: '740B', status: 'Operativo', locationId: 'l1' }];
    const plans = [{ id: 'plan_tipo_' + tipo, equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
    const occKey = `plan_tipo_${tipo}:${isoDateOnly(0)}`;
    const records = [{
      id: 'r_tipo_' + tipo, equipmentId: 'e1', date: isoDaysAgo(1), createdAt: isoDaysAgo(1), userName: 'Jose Guerrero', qty: 6.0, shiftId: 'shift_dia',
      // Mismo resultado real que produce app.js al guardar DESPUÉS del fix:
      // resolveEarlyOccurrenceSatisfaction() se llama sin importar
      // executionType -> satisfiedOccurrenceKey queda resuelto igual.
      operationalSnapshot: { executionType: tipo, executionCompleteness: 'COMPLETE', satisfiedOccurrenceKey: occKey, crewId: 'crew1', crewLocationIdAtExecution: 'l1', assignmentId: tipo === 'ASSIGNED' ? 'asg_tipo' : null },
    }];
    const assignments = tipo === 'ASSIGNED' ? [{
      id: 'asg_tipo', active: true, status: 'PENDING', occurrenceKey: occKey,
      equipmentId: 'e1', planId: 'plan_tipo_' + tipo, assignedCrewId: 'crew1',
    }] : [];

    await bootPage(page, { crewLocations: ASSIGNMENT_COVERAGE, equipos, plans, records, assignments });
    await page.evaluate(() => window.renderLubricadorHome());

    expect(errors).toEqual([]);
    expect(await page.locator('.lub-section-head:has-text("MI TURNO")').count()).toBe(0);
    expect(await page.locator('.lub-section-head:has-text("ATRASADOS")').count()).toBe(0);
    await expect(seccion(page, 'REALIZADOS ADELANTADOS').locator('.lub-eq-code', { hasText: 'A-02' })).toHaveCount(1);
    // Regla E de doble turno — ver comentario de O-A, misma causa.
    await expect(page.locator('#lub-pending-validations')).toContainText('A-02');
    await expect(page.locator('.lub-section-head:has-text("REALIZADOS ADELANTADOS")')).toContainText('(1)');
    await expect(kpiValue(page, 'Pendientes hoy')).toHaveText('0');
  });
}

// Fix 2026-10-09 ("PULIDA LOGIN/QUICK UNLOCK/MI TURNO", Parte 0B del
// pedido) — la tarjeta de "Mi Turno" (.lub-eq-btn) es un <div> CONTENEDOR,
// nunca un botón: antes tenía cursor:pointer + feedback :active (scale +
// fondo) en TODA la tarjeta, dando la impresión de que cualquier parte era
// clicable. Solo los <button> explícitos (.lub-mt-reg/.lub-mt-ver) deben
// disparar acciones reales — se prueba clickeando ÁREAS SIN BOTÓN
// (código/modelo/ubicación) y confirmando que NO pasa nada, contra el
// click EN los botones reales, que SÍ debe pasar.
test('§0.8/§0.9/§0.10 — la card de Mi Turno NO es clicable fuera de sus botones explícitos (Registrar engrase / Ver ficha)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));

  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: '20-5540', brand: 'Caterpillar', model: 'D8T', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'plan_card', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];

  await bootPage(page, { equipos, plans });
  await page.evaluate(() => {
    window.__detailCalls = [];
    window.__greaseFlowCalls = [];
    window.openEquipmentDetail = (id) => window.__detailCalls.push(id);
    window.startLubricadorGreaseFlow = (id) => window.__greaseFlowCalls.push(id);
  });
  await page.evaluate(() => window.renderLubricadorHome());

  const card = page.locator('.lub-eq-btn', { hasText: '20-5540' });
  await expect(card).toBeVisible();

  // F del pedido: click en código/modelo/ubicación/área blanca -> NADA.
  await card.locator('.lub-eq-code').click();
  await card.locator('.lub-eq-model').click();
  await card.locator('.lub-eq-location').click();
  await card.click({ position: { x: 5, y: 5 } }); // área blanca real de la tarjeta
  expect(await page.evaluate(() => window.__detailCalls)).toEqual([]);
  expect(await page.evaluate(() => window.__greaseFlowCalls)).toEqual([]);

  // I del pedido: la card nunca es role="button".
  expect(await card.getAttribute('role')).toBeNull();
  // cursor:default real (nunca pointer) — confirma que §0.8/§0.12 ya no la
  // hace VERSE clicable tampoco, no solo que no responda.
  expect(await card.evaluate((el) => getComputedStyle(el).cursor)).not.toBe('pointer');

  // G del pedido: click en "Registrar engrase" SÍ dispara el flujo real.
  await card.locator('.lub-mt-reg').click();
  expect(await page.evaluate(() => window.__greaseFlowCalls)).toEqual(['e1']);

  // H del pedido: click en "Ver ficha" SÍ abre la Ficha real.
  await card.locator('.lub-mt-ver').click();
  expect(await page.evaluate(() => window.__detailCalls)).toEqual(['e1']);

  expect(errors).toEqual([]);
});

// Desbloqueado: classifyEquipmentWork({selectedCrewOnly:true}) forzaba
// "normal" a [] para CUALQUIER equipo sin asignación manual — bug real
// (no finalizado) de la misma sesión, ya corregido en operational-scope.js
// (ver su comentario). Equipo de plan dual puro, SIN asignación — camino
// "normal" real, el mismo que ya prueba dualShiftStatusFor/
// resolveOccurrenceState en tests/unit/double-shift-lifecycle.test.js.
test('doble turno: el COMPLETE de DAY no oculta la obligación NIGHT actual', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-13T20:00:00') });
  const equipo = { id: 'exc1', code: 'EXC-1', brand: 'CAT', model: '336', status: 'Operativo', locationId: 'l1' };
  const plan = { id: 'dual1', equipmentId: 'exc1', controlType: 'Horas de operación', frequency: 250,
    lastGreaseHour: 100, requiredShifts: ['shift_dia', 'shift_noche'], effectiveDate: '2026-10-13' };
  const recordDay = { id: 'r-day', equipmentId: 'exc1', date: '2026-10-13T08:00:00', createdAt: '2026-10-13T08:00:00',
    userName: 'Lubricador', qty: 2, shiftId: 'shift_dia', details: [],
    operationalSnapshot: { occurrenceKey: 'dual1:2026-10-13:shift_dia', operationalDate: '2026-10-13', executionCompleteness: 'COMPLETE' } };
  await bootPage(page, { equipos: [equipo], plans: [plan], records: [recordDay] });
  await page.evaluate(() => window.renderLubricadorHome());
  const current = seccion(page, 'MI TURNO').locator('.lub-eq-btn', { hasText: 'EXC-1' });
  await expect(current).toBeVisible();
  await expect(current).toContainText('PENDIENTE TURNO NOCHE');
  await expect(seccion(page, 'REALIZADOS')).toContainText('DÍA');
  await expect(seccion(page, 'PENDIENTES DEL TURNO ANTERIOR').locator('.lub-eq-code', { hasText: 'EXC-1' })).toHaveCount(0);
});

// Desbloqueado — ver comentario del test anterior.
test('doble turno: el turno anterior pendiente y NIGHT actual coexisten como ocurrencias distintas', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-13T20:00:00') });
  const equipo = { id: 'exc1', code: 'EXC-1', brand: 'CAT', model: '336', status: 'Operativo', locationId: 'l1' };
  const plan = { id: 'dual1', equipmentId: 'exc1', controlType: 'Horas de operación', frequency: 250,
    lastGreaseHour: 100, requiredShifts: ['shift_dia', 'shift_noche'], effectiveDate: '2026-10-13' };
  await bootPage(page, { equipos: [equipo], plans: [plan] });
  await page.evaluate(() => window.renderLubricadorHome());
  await expect(seccion(page, 'PENDIENTES DEL TURNO ANTERIOR').locator('.lub-eq-code', { hasText: 'EXC-1' })).toHaveCount(1);
  await expect(seccion(page, 'MI TURNO').locator('.lub-eq-btn', { hasText: 'EXC-1' })).toContainText('PENDIENTE TURNO NOCHE');
  await expect(page.locator('.lub-pending-context', { hasText: 'Turno Día' })).toHaveCount(1);
});

// ============================================================
// Lote POST-0014 (2026-10-17) — auditoría dirigida de dos bugs reales
// reportados con captura (05-0870 mostrando "Jue 15/10" en vez de su fecha
// real de asignación, 30/09; y parpadeo de Mi Turno en cada sync
// incremental). Ver docs de la auditoría — aquí solo las pruebas, la
// decisión de implementación vive en app.js/operational-scope.js.
// ============================================================

test('FIX "FECHA VISUAL DE ASIGNACIÓN ATRASADA": una assignment vieja (cross-crew/cross-location) muestra SU fecha real (occurrenceKey), NUNCA la recalculada contra "hoy" (mostRecentAssignedDate())', async ({ page }) => {
  // "Hoy" = sábado 17/10 — el Jueves más reciente contra HOY es 15/10, que
  // es exactamente la fecha incorrecta reportada en producción. La
  // assignment real quedó fijada el 30/09 (miércoles) — mucho antes.
  await page.clock.install({ time: new Date('2026-10-17T10:00:00') });
  const errors = []; page.on('pageerror', (e) => errors.push(e));

  const equipo = { id: 'e1', code: '05-0870', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l2' };
  const plan = { id: 'plan_mskx6bbstrbbsz', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: ['Jueves'], shiftId: 'shift_dia' };
  const assignment = {
    id: 'asg_muoqddz6p24k34', equipmentId: 'e1', planId: plan.id, assignedCrewId: 'crew1',
    occurrenceKey: 'plan_mskx6bbstrbbsz:2026-09-30', status: 'PENDING', active: true,
  };
  await bootPage(page, { crewLocations: ASSIGNMENT_COVERAGE, equipos: [equipo], plans: [plan], assignments: [assignment] });
  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);

  const card = seccion(page, 'ATRASADOS').locator('.lub-pending-card', { hasText: '05-0870' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('30/09'); // fecha real de la assignment (occurrenceKey)
  await expect(card).not.toContainText('15/10'); // NUNCA la recalculada contra "hoy"
  await expect(card).toContainText('Turno Día');
});

test('FIX "FECHA VISUAL DE ASIGNACIÓN ATRASADA": un equipo normal (SIN assignment) sigue usando el cálculo de siempre del plan — sin cambio de comportamiento', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-17T10:00:00') });
  const errors = []; page.on('pageerror', (e) => errors.push(e));

  // Mismo plan/assignedDays que el caso anterior, pero SIN assignment —
  // trabajo normal de la propia cuadrilla, en su propia ubicación. Debe
  // seguir mostrando la fecha RECALCULADA (15/10), nunca una fecha fija.
  const equipo = { id: 'e1', code: 'NORMAL-15', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' };
  const plan = { id: 'plan-normal', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: ['Jueves'], shiftId: 'shift_dia' };
  await bootPage(page, { equipos: [equipo], plans: [plan] });
  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);

  const card = seccion(page, 'ATRASADOS').locator('.lub-pending-card', { hasText: 'NORMAL-15' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('15/10'); // SIN assignment: sigue siendo mostRecentAssignedDate() contra hoy
});

test('FIX "CHIP SUPPORT_OTHER_LOCATION": "APOYO · <UBICACIÓN>" aparece SOLO para una assignment cross-location real (_supportOperational===true + ubicación distinta de la principal) — nunca para trabajo normal, nunca sin ese grant, y un equipo de otra ubicación sin asignar nunca aparece', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-17T10:00:00') });
  const errors = []; page.on('pageerror', (e) => errors.push(e));

  const equipoApoyo = { id: 'e-apoyo', code: '05-0870', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l2' };
  const planApoyo = { id: 'plan-apoyo', equipmentId: 'e-apoyo', controlType: 'Día y turno de la semana', assignedDays: ['Jueves'], shiftId: 'shift_dia' };
  const asgApoyo = {
    id: 'asg-apoyo', equipmentId: 'e-apoyo', planId: planApoyo.id, assignedCrewId: 'crew1',
    occurrenceKey: 'plan-apoyo:2026-09-30', status: 'PENDING', active: true, _supportOperational: true,
  };

  // Misma ubicación APOYO, misma forma de assignment, pero SIN el grant real
  // (_supportOperational ausente) — sigue siendo trabajo visible (l2 ya es
  // APOYO autorizada de crew1 por cobertura), pero sin el chip.
  const equipoSinGrant = { id: 'e-sin-grant', code: 'SIN-GRANT', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l2' };
  const planSinGrant = { id: 'plan-sin-grant', equipmentId: 'e-sin-grant', controlType: 'Día y turno de la semana', assignedDays: ['Jueves'], shiftId: 'shift_dia' };
  const asgSinGrant = {
    id: 'asg-sin-grant', equipmentId: 'e-sin-grant', planId: planSinGrant.id, assignedCrewId: 'crew1',
    occurrenceKey: 'plan-sin-grant:2026-09-30', status: 'PENDING', active: true,
  };

  // Trabajo normal (sin assignment) en la ubicación PRINCIPAL de la propia
  // cuadrilla — nunca debe mostrar el chip.
  const hoyWeekday = weekdayName(new Date('2026-10-17T10:00:00'));
  const equipoNormal = { id: 'e-normal', code: 'NORMAL-1', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' };
  const planNormal = { id: 'plan-normal', equipmentId: 'e-normal', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] };

  // Equipo de una ubicación que esta cuadrilla NO tiene autorizada de
  // ninguna forma (ni PRINCIPAL ni APOYO) y SIN assignment — equivalente a
  // "equipo de Mojón sin asignar, visto por la cuadrilla de Volcán": nunca
  // debe aparecer en ninguna sección.
  const equipoOtraUbicacion = { id: 'e-otra', code: 'MOJON-NOASIGNADO', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l3' };

  await bootPage(page, {
    crewLocations: ASSIGNMENT_COVERAGE,
    equipos: [equipoApoyo, equipoSinGrant, equipoNormal, equipoOtraUbicacion],
    plans: [planApoyo, planSinGrant, planNormal],
    assignments: [asgApoyo, asgSinGrant],
  });
  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);

  const cardApoyo = seccion(page, 'ATRASADOS').locator('.lub-pending-card', { hasText: '05-0870' });
  await expect(cardApoyo).toBeVisible();
  await expect(cardApoyo).toContainText('APOYO · RAJO SUR');

  const cardSinGrant = seccion(page, 'ATRASADOS').locator('.lub-pending-card', { hasText: 'SIN-GRANT' });
  await expect(cardSinGrant).toBeVisible();
  await expect(cardSinGrant).not.toContainText('APOYO ·');

  const cardNormal = page.locator('.lub-eq-btn', { hasText: 'NORMAL-1' });
  await expect(cardNormal).toBeVisible();
  await expect(cardNormal).not.toContainText('APOYO ·');

  // Equipo de otra ubicación, sin asignar: invisible en TODA la pantalla —
  // nunca cambia ubicación maestra/authorizedLocationIds, solo deja de
  // mostrarse porque nunca estuvo en el scope de esta cuadrilla.
  await expect(page.locator('.lub-eq-code', { hasText: 'MOJON-NOASIGNADO' })).toHaveCount(0);
});

test('FIX "ELIMINAR PARPADEO EN SYNC INCREMENTAL": un repintado silent SIN cambios relevantes no toca el DOM (nunca "Cargando tu turno…", nunca reemplaza el contenido)', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e));
  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'T-60', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];

  await bootPage(page, { equipos, plans });
  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);
  await expect(seccion(page, 'MI TURNO')).toContainText('T-60');

  // Marca el DOM actual a mano: si renderLubricadorHome({silent:true}) de
  // verdad reemplaza #app-content, este marcador desaparece (el template
  // real nunca lo escribe).
  await page.evaluate(() => document.querySelector('.lub-welcome-card').setAttribute('data-marker', 'untouched'));
  await page.evaluate(() => window.renderLubricadorHome({ silent: true }));

  await expect(page.locator('#app-content')).not.toContainText('Cargando tu turno…');
  expect(await page.locator('.lub-welcome-card').getAttribute('data-marker')).toBe('untouched'); // el DOM NO se tocó
  await expect(seccion(page, 'MI TURNO')).toContainText('T-60');
  expect(errors).toEqual([]);
});

test('FIX "ELIMINAR PARPADEO EN SYNC INCREMENTAL": un repintado silent CON un cambio relevante SÍ actualiza el contenido, sin mostrar "Cargando tu turno…" en ningún momento', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e));
  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'T-61', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];

  await bootPage(page, { equipos, plans });
  await page.evaluate(() => window.renderLubricadorHome());
  expect(errors).toEqual([]);
  await expect(seccion(page, 'MI TURNO')).toContainText('T-61');

  await page.evaluate(() => document.querySelector('.lub-welcome-card').setAttribute('data-marker', 'untouched'));
  await page.evaluate(() => {
    // Mismo patrón que los tests "local-first" de arriba: simula el
    // DB.put() real de un engrase COMPLETE guardado localmente, y un sync
    // incremental que acaba de traer ESE mismo cambio (silent:true).
    window.__mockData.lubrication_records.push({
      id: 'r-nuevo', equipmentId: 'e1', date: new Date().toISOString(), createdAt: new Date().toISOString(),
      userName: 'Lubricador de prueba', qty: 2.0, shiftId: 'shift_dia',
    });
    return window.renderLubricadorHome({ silent: true });
  });

  await expect(page.locator('#app-content')).not.toContainText('Cargando tu turno…'); // NUNCA, ni en silent con cambio
  await expect(seccion(page, 'REALIZADOS')).toContainText('T-61'); // el cambio real SÍ se refleja
  expect(await enCuantasSeccionesDeTrabajo(page, 'T-61')).toBe(1);
  // Hubo algo real que actualizar -> el DOM SÍ se reemplazó (el marcador manual no sobrevive).
  expect(await page.locator('.lub-welcome-card').getAttribute('data-marker')).toBeNull();
  expect(errors).toEqual([]);
});
