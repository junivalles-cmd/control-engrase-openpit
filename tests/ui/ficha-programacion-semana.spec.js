// tests/ui/ficha-programacion-semana.spec.js
//
// Pedido "MEJORA FICHA OPERATIVA" (2026-10-10), Parte A — rediseño de la
// sección PLAN -> PROGRAMACIÓN de openEquipmentDetail(): elimina la lista
// de puntos, agrega un indicador de 7 días (semana operativa actual) que
// reusa estadoCelda() (src/core/weekly-matrix.js) — la MISMA función pura
// que ya usa renderMatrizSemanal() — para que la Ficha NUNCA pueda divergir
// de la Matriz (§A5 del pedido: "una sola fuente funcional").
//
// openEquipmentDetail() se EJECUTA de verdad (no solo patrón de fuente,
// mismo técnica real que dashboard-real-execution.spec.js) para poder
// verificar colores/estados reales con fixtures reales, incluyendo "hoy"
// determinístico vía page.clock (nunca depende del día real en que corra
// el test).

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import {
  APP_JS_PATH, LUBRICATION_STATUS_JS_PATH, WEEKLY_MATRIX_JS_PATH,
  OPERATIONAL_SCOPE_JS_PATH, GREASE_VALIDATION_JS_PATH,
} from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

const appSource = readSource(APP_JS_PATH);
const statusSource = readSource(LUBRICATION_STATUS_JS_PATH);
const matrixSource = readSource(WEEKLY_MATRIX_JS_PATH);
const scopeSource = readSource(OPERATIONAL_SCOPE_JS_PATH);
const validationSource = readSource(GREASE_VALIDATION_JS_PATH);

const statusNames = ['fmt', 'WEEKDAY_NAMES', 'mostRecentAssignedDate', 'weekdayStatusFor', 'statusFor'];
const statusSrc = statusNames.map(n => extractDeclaration(statusSource, n)).join('\n\n');
const matrixSrc = extractDeclaration(matrixSource, 'estadoCelda');
const scopeNames = [
  'ASSIGNMENT_STATUS', 'ROLES_CAN_MANAGE_ASSIGNMENTS', 'ROLES_CAN_MOVE_EQUIPMENT', 'ROLES_CAN_REGISTER_OUT_OF_PLAN',
  'canManageAssignments', 'canMoveEquipment', 'canRegisterOutOfPlan',
  'EXECUTION_TYPE', 'resolveRecordExecutionType', 'resolveRecordCompleteness', 'resolveRecordOutOfPlanReason',
  'resolveRecordCrewId', 'findActivePendingAssignment', 'findCarriedOverSkipForToday', 'computeOccurrenceKey', 'toISODateUTCLocal',
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
  '$', '$$', 'esc', 'ic', 'fmtDate', 'fmtDateOnly', 'fmtTime', 'todayDateISO', 'GREASE_UNIT', 'STATUS_COLOR', 'CRIT_COLOR',
  'WEEKDAY_ABBR_DASH', 'NO_EXECUTION_REASON_LABELS', 'openModal', 'closeModal', 'trackRecentEquipment',
  'photosOf', 'photoIndicatorHTML', 'photoThumbHTML', 'evidenceValueAttr', 'validationBadgeHTML',
  'openEquipmentDetail',
];
const appSrc = appNames.map(n => extractDeclaration(appSource, n)).join('\n\n');

async function bootPage(page, {
  equipos = [], plans = [], records = [], assignments = [], skips = [], locations = [], cuadrillas = [],
  anomalies = [], validations = [], lubricants = [],
  currentUser = { id: 'lub1', name: 'Lubricador de prueba', role: 'LUBRICADOR' },
} = {}) {
  await page.route('**/*', (route) => {
    if (route.request().resourceType() === 'document') {
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    } else {
      route.continue();
    }
  });
  await page.goto('/');
  await page.setContent('<div id="app-content"></div>');
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.App = {
        currentUser: ${JSON.stringify(currentUser)},
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18, complianceTarget: 85 },
      };
      window.__mockData = {
        equipment: ${JSON.stringify(equipos)},
        lubrication_plans: ${JSON.stringify(plans)},
        lubrication_records: ${JSON.stringify(records)},
        lubrication_points: [],
        lubrication_assignments: ${JSON.stringify(assignments)},
        lubrication_skips: ${JSON.stringify(skips)},
        locations: ${JSON.stringify(locations)},
        cuadrillas: ${JSON.stringify(cuadrillas)},
        anomalies: ${JSON.stringify(anomalies)},
        grease_validations: ${JSON.stringify(validations)},
        lubricants: ${JSON.stringify(lubricants)},
      };
      window.__dbCalls = [];
      window.DB = {
        allActive: async (store) => { window.__dbCalls.push(store); return window.__mockData[store] || []; },
        get: async (store, id) => (window.__mockData[store] || []).find(r => r.id === id) || null,
      };
      ${statusSrc}
      ${matrixSrc}
      ${scopeSrc}
      ${validationSrc}
      ${appSrc}
      window.estadoCelda = estadoCelda;
      window.openEquipmentDetail = openEquipmentDetail;
      window.openModal = openModal; window.closeModal = closeModal;
    `,
  });
}

// "Hoy" fijo = viernes 2026-10-16 (Lun 10-12 ... Dom 10-18 es la semana
// completa) — determinístico, nunca depende del día real de ejecución.
const HOY_FIJO = '2026-10-16T12:00:00';
const LUN = '2026-10-12', MAR = '2026-10-13', MIE = '2026-10-14', JUE = '2026-10-15', VIE = '2026-10-16', SAB = '2026-10-17', DOM = '2026-10-18';

const PLAN_SEMANAL = {
  id: 'plan1', equipmentId: 'e1', controlType: 'Día y turno de la semana',
  assignedDays: ['Lunes', 'Miércoles', 'Viernes'], shiftId: 'shift_noche',
};
const EQUIPO = { id: 'e1', code: 'A-02', shortCode: '45-69', brand: 'Caterpillar', model: '740B', status: 'Operativo', hourmeter: 0 };

function recordAt(id, dateISO, extra = {}) {
  return { id, equipmentId: 'e1', date: `${dateISO}T20:00:00.000Z`, hourmeter: 10, qty: 1, userId: 'lub1', userName: 'Lubricador de prueba', shiftId: 'shift_noche', details: [], ...extra };
}

test.describe('A-E: cada día de la semana usa EXACTAMENTE el color de estadoCelda() (Matrix)', () => {
  test('A — día programado + COMPLETE (ya pasó) -> verde (hecho)', async ({ page }) => {
    await page.clock.install({ time: new Date(HOY_FIJO) });
    await bootPage(page, { equipos: [EQUIPO], plans: [PLAN_SEMANAL], records: [recordAt('r1', LUN)] });
    await page.evaluate(() => window.openEquipmentDetail('e1'));
    const lun = page.locator('.ficha-dia', { hasText: 'LUN' });
    await expect(lun).toHaveClass(/ficha-dia-relleno/);
    await expect(lun).toHaveCSS('--c', '#3FB950');
    await expect(lun).toHaveAttribute('title', /Realizado/);
  });

  test('B — día programado ya vencido SIN COMPLETE -> rojo (no_realizado)', async ({ page }) => {
    await page.clock.install({ time: new Date(HOY_FIJO) });
    await bootPage(page, { equipos: [EQUIPO], plans: [PLAN_SEMANAL], records: [] });
    await page.evaluate(() => window.openEquipmentDetail('e1'));
    const mie = page.locator('.ficha-dia', { hasText: 'MIÉ' });
    await expect(mie).toHaveClass(/ficha-dia-relleno/);
    await expect(mie).toHaveCSS('--c', '#E5484D');
    await expect(mie).toHaveAttribute('title', /No realizado/);
  });

  test('C — día programado HOY, todavía pendiente -> amarillo (pendiente)', async ({ page }) => {
    await page.clock.install({ time: new Date(HOY_FIJO) });
    await bootPage(page, { equipos: [EQUIPO], plans: [PLAN_SEMANAL], records: [] });
    await page.evaluate(() => window.openEquipmentDetail('e1'));
    const vie = page.locator('.ficha-dia', { hasText: 'VIE' });
    await expect(vie).toHaveClass(/ficha-dia-relleno/);
    await expect(vie).toHaveCSS('--c', '#E8A33D');
    await expect(vie).toHaveAttribute('title', /Programado hoy.*pendiente/);
  });

  test('D — REALIZADO ADELANTADO (satisfiedOccurrenceKey de un día antes) -> azul (hecho_adelantado)', async ({ page }) => {
    await page.clock.install({ time: new Date(HOY_FIJO) });
    // computeOccurrenceKey() de un plan "Día y turno de la semana" es
    // literalmente `${plan.id}:${dateISO}` (src/core/operational-scope.js)
    // — se arma el fixture directo, sin reimplementar la función.
    const occurrenceKeyViernes = `${PLAN_SEMANAL.id}:${VIE}`;
    const records = [recordAt('r-adelantado', JUE, { operationalSnapshot: { satisfiedOccurrenceKey: occurrenceKeyViernes } })];
    await bootPage(page, { equipos: [EQUIPO], plans: [PLAN_SEMANAL], records });
    await page.evaluate(() => window.openEquipmentDetail('e1'));
    const vie = page.locator('.ficha-dia', { hasText: 'VIE' });
    await expect(vie).toHaveClass(/ficha-dia-relleno/);
    await expect(vie).toHaveCSS('--c', '#5B7FBF');
    await expect(vie).toHaveAttribute('title', /Realizado adelantado/);
  });

  test('E — día NO programado (Martes/Jueves/Sábado/Domingo) -> gris, sin relleno', async ({ page }) => {
    await page.clock.install({ time: new Date(HOY_FIJO) });
    await bootPage(page, { equipos: [EQUIPO], plans: [PLAN_SEMANAL], records: [] });
    await page.evaluate(() => window.openEquipmentDetail('e1'));
    for (const abbr of ['MAR', 'JUE', 'SÁB', 'DOM']) {
      const dia = page.locator('.ficha-dia', { hasText: abbr });
      await expect(dia).not.toHaveClass(/ficha-dia-relleno/);
      await expect(dia).toHaveAttribute('title', /No programado/);
    }
  });
});

test('F — un registro PARTIAL en un día programado lo muestra igual que Matrix (estadoCelda no distingue completeness, por diseño)', async ({ page }) => {
  await page.clock.install({ time: new Date(HOY_FIJO) });
  const records = [recordAt('r-partial', LUN, { details: [{ done: true }, { done: false }] })]; // PARTIAL real
  await bootPage(page, { equipos: [EQUIPO], plans: [PLAN_SEMANAL], records });
  await page.evaluate(() => window.openEquipmentDetail('e1'));
  // Mismo criterio que Matrix: CUALQUIER registro en la fecha -> 'hecho' (verde),
  // completeness se muestra aparte en "Última ejecución" (Estado: Parcial), nunca
  // en el color del día — si esto cambiara, Ficha divergiría de Matrix.
  const lun = page.locator('.ficha-dia', { hasText: 'LUN' });
  await expect(lun).toHaveCSS('--c', '#3FB950');
});

test('G — un lubrication_skips (No se pudo ejecutar) en un día programado NO lo convierte en realizado (estadoCelda nunca lee skips)', async ({ page }) => {
  await page.clock.install({ time: new Date(HOY_FIJO) });
  const skips = [{ id: 'sk1', equipmentId: 'e1', date: `${MIE}T20:00:00.000Z`, reason: 'SIN_TIEMPO', shiftId: 'shift_noche' }];
  await bootPage(page, { equipos: [EQUIPO], plans: [PLAN_SEMANAL], records: [], skips });
  await page.evaluate(() => window.openEquipmentDetail('e1'));
  const mie = page.locator('.ficha-dia', { hasText: 'MIÉ' });
  await expect(mie).toHaveCSS('--c', '#E5484D'); // sigue "vencido sin registrar", el skip no lo tapa
});

test('H — el color de cada día en la Ficha coincide EXACTO con llamar estadoCelda() directamente (misma fuente, nunca puede divergir)', async ({ page }) => {
  await page.clock.install({ time: new Date(HOY_FIJO) });
  const records = [recordAt('r1', LUN)];
  await bootPage(page, { equipos: [EQUIPO], plans: [PLAN_SEMANAL], records });
  await page.evaluate(() => window.openEquipmentDetail('e1'));
  const tiposReales = await page.evaluate(({ plan, records, equipo, fechas }) => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    return fechas.map(f => window.estadoCelda(equipo, new Date(f + 'T00:00:00'), [plan], records, hoy).tipo);
  }, { plan: PLAN_SEMANAL, records, equipo: EQUIPO, fechas: [LUN, MAR, MIE, JUE, VIE, SAB, DOM] });
  expect(tiposReales).toEqual(['hecho', 'vacio', 'no_realizado', 'vacio', 'pendiente', 'vacio', 'vacio']);
  // Y la Ficha debe reflejar el mismo patrón de relleno (hecho/no_realizado/pendiente = relleno; vacio = no relleno).
  const rellenos = await page.locator('.ficha-dia').evaluateAll(els => els.map(el => el.classList.contains('ficha-dia-relleno')));
  expect(rellenos).toEqual([true, false, true, false, true, false, false]);
});

test('I — plan por HORAS no muestra una semana falsa (sin .ficha-semana/.ficha-week-grid)', async ({ page }) => {
  const planHoras = { id: 'planH', equipmentId: 'e1', controlType: 'Horas de operación', frequency: 250, lastGreaseHour: 0, shiftId: 'shift_dia' };
  const equipoHoras = { ...EQUIPO, hourmeter: 50 };
  await bootPage(page, { equipos: [equipoHoras], plans: [planHoras], records: [] });
  await page.evaluate(() => window.openEquipmentDetail('e1'));
  await expect(page.locator('.ficha-semana')).toHaveCount(0);
  await expect(page.locator('.ficha-week-grid')).toHaveCount(0);
  await expect(page.locator('#modal-overlay')).toContainText('Cada 250 h');
  await expect(page.locator('#modal-overlay')).toContainText('Turno programado');
});

test('J/K — la Ficha nunca muestra el listado de puntos ni el conteo "Puntos", y nunca consulta lubrication_points', async ({ page }) => {
  await page.clock.install({ time: new Date(HOY_FIJO) });
  await bootPage(page, { equipos: [EQUIPO], plans: [PLAN_SEMANAL], records: [recordAt('r1', LUN)] });
  await page.evaluate(() => window.openEquipmentDetail('e1'));
  const texto = await page.locator('#modal-overlay').innerText();
  expect(texto).not.toMatch(/\bPUNTOS\b/i);
  expect(texto).not.toMatch(/Cilindro/i);
  const calls = await page.evaluate(() => window.__dbCalls);
  expect(calls).not.toContain('lubrication_points');
});

test('L — 360px: la semana de 7 días cabe sin overflow horizontal (nunca scroll/carrusel)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.clock.install({ time: new Date(HOY_FIJO) });
  await bootPage(page, { equipos: [EQUIPO], plans: [PLAN_SEMANAL], records: [recordAt('r1', LUN)] });
  await page.evaluate(() => window.openEquipmentDetail('e1'));
  const grid = page.locator('.ficha-week-grid');
  await expect(grid).toBeVisible();
  const overflow = await grid.evaluate(el => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1); // tolerancia de redondeo subpixel
});

test('M — la semana se ve correctamente en los 4 temas (Claro/Oscuro/Modo Sol/Alto Contraste), sin errores de página', async ({ page }) => {
  await page.clock.install({ time: new Date(HOY_FIJO) });
  await bootPage(page, { equipos: [EQUIPO], plans: [PLAN_SEMANAL], records: [recordAt('r1', LUN)] });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  for (const modo of ['dark', 'light', 'sun', 'contrast']) {
    await page.evaluate((m) => document.documentElement.setAttribute('data-mode', m), modo);
    await page.evaluate(() => window.openEquipmentDetail('e1'));
    const lun = page.locator('.ficha-dia', { hasText: 'LUN' });
    const bg = await lun.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)'); // el verde resuelve a un color real, nunca transparente
    await page.evaluate(() => window.closeModal());
  }
  expect(errors).toEqual([]);
});
