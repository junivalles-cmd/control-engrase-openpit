// tests/ui/weekly-matrix-dual-shift.spec.js
//
// "Cerrar la MATRIZ SEMANAL" (auditoría 2026-10-18) — renderMatrizSemanal()
// REAL (app.js), nunca una reimplementación. Cubre específicamente lo que
// matrix-occurrence-detail.spec.js no cubre: casos reales 05-0870/20-5530,
// filtro Turno basado en plan.shiftId (nunca equipment.shiftId), métricas
// por occurrence (no por equipmentId) y effectiveDate futuro/alcanzada.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, LUBRICATION_STATUS_JS_PATH, OPERATIONAL_SCOPE_JS_PATH, WEEKLY_MATRIX_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const appNames = ['$', '$$', 'esc', 'ic', 'renderMatrizSemanal'];
const app = appNames.map(n => extractDeclaration(readSource(APP_JS_PATH), n)).join('\n');
const core = [LUBRICATION_STATUS_JS_PATH, OPERATIONAL_SCOPE_JS_PATH, WEEKLY_MATRIX_JS_PATH].map(readSource).join('\n');

function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function boot(page, { equipment = [], plans = [], records = [] } = {}) {
  await page.setContent('<main id="app-content"></main>');
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `${core}\n${app}
      window.App = { matrizOffset: 0, currentUser: { id: 'u', name: 'Admin', role: 'ADMINISTRADOR' }, generalSettings: { shiftDayStart: 6, shiftNightStart: 18, complianceTarget: 85 } };
      const kpiCard = (label, value) => '<div class="kpi" data-kpi-label="' + label + '" data-kpi-value="' + value + '">' + label + ': ' + value + '</div>';
      const wireMatrizScrollHint = () => {};
      const openSinPlanModal = () => {};
      window.__data = { equipment: ${JSON.stringify(equipment)}, lubrication_plans: ${JSON.stringify(plans)}, lubrication_records: ${JSON.stringify(records)}, lubrication_assignments: [], lubrication_skips: [], equipment_types: [], locations: [] };
      window.DB = { allActive: async (store) => window.__data[store] || [], all: async (store) => window.__data[store] || [] };
      window.renderMatrizSemanal = renderMatrizSemanal;
    `,
  });
}

function dayISO(offsetFromToday) { return addDaysISO(todayISO(), offsetFromToday); }

const ALL_DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

test('1. Solo Día (sin doble turno) -> aparece únicamente en la matriz Día', async ({ page }) => {
  const equipment = [{ id: 'e1', code: '05-0870', shiftId: 'shift_dia', status: 'Operativo' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: ALL_DAYS, shiftId: 'shift_dia', requiredShifts: [] }];
  await boot(page, { equipment, plans });
  await page.evaluate(() => renderMatrizSemanal());
  const diaTable = page.locator('table.matriz', { hasText: 'TURNO DÍA' });
  const nocheTable = page.locator('table.matriz', { hasText: 'TURNO NOCHE' });
  await expect(diaTable).toHaveCount(1);
  await expect(nocheTable).toHaveCount(0);
  await expect(diaTable.locator('tbody tr')).toHaveCount(1);
});

test('2. Solo Noche (sin doble turno) -> aparece únicamente en la matriz Noche', async ({ page }) => {
  const equipment = [{ id: 'e1', code: 'T-99', shiftId: 'shift_dia', status: 'Operativo' }]; // equipment.shiftId divergente a propósito
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: ALL_DAYS, shiftId: 'shift_noche', requiredShifts: [] }];
  await boot(page, { equipment, plans });
  await page.evaluate(() => renderMatrizSemanal());
  const diaTable = page.locator('table.matriz', { hasText: 'TURNO DÍA' });
  const nocheTable = page.locator('table.matriz', { hasText: 'TURNO NOCHE' });
  await expect(diaTable).toHaveCount(0);
  await expect(nocheTable).toHaveCount(1);
  await expect(nocheTable.locator('tbody tr')).toContainText('T-99');
});

test('3. Día + Noche activo (effectiveDate ya alcanzada) -> aparece en ambas matrices, una fila en cada una', async ({ page }) => {
  const equipment = [{ id: 'e1', code: '20-5530', shiftId: 'shift_dia', status: 'Operativo' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: ALL_DAYS, shiftId: 'shift_dia', requiredShifts: ['shift_dia', 'shift_noche'], effectiveDate: dayISO(-7) }];
  await boot(page, { equipment, plans });
  await page.evaluate(() => renderMatrizSemanal());
  const diaTable = page.locator('table.matriz', { hasText: 'TURNO DÍA' });
  const nocheTable = page.locator('table.matriz', { hasText: 'TURNO NOCHE' });
  await expect(diaTable.locator('tbody tr')).toHaveCount(1);
  await expect(nocheTable.locator('tbody tr')).toHaveCount(1);
  await expect(diaTable.locator('tbody tr')).toContainText('20-5530');
  await expect(nocheTable.locator('tbody tr')).toContainText('20-5530');
  await expect(page.locator('.matrix-occurrence-shift')).toHaveCount(0);
});

test('4. Día + Noche con effectiveDate futuro -> todavía NO aparece doble (solo en la tabla de su turno único)', async ({ page }) => {
  const equipment = [{ id: 'e1', code: '05-0870', shiftId: 'shift_dia', status: 'Operativo' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: ALL_DAYS, shiftId: 'shift_dia', requiredShifts: ['shift_dia', 'shift_noche'], effectiveDate: dayISO(30) }];
  await boot(page, { equipment, plans });
  await page.evaluate(() => renderMatrizSemanal());
  const diaTable = page.locator('table.matriz', { hasText: 'TURNO DÍA' });
  const nocheTable = page.locator('table.matriz', { hasText: 'TURNO NOCHE' });
  await expect(diaTable.locator('tbody tr')).toHaveCount(1);
  await expect(nocheTable).toHaveCount(0);
});

test('5. EffectiveDate HOY -> doble turno ya activo desde hoy (fila en ambas matrices esta semana)', async ({ page }) => {
  const equipment = [{ id: 'e1', code: '20-5530', shiftId: 'shift_dia', status: 'Operativo' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: ALL_DAYS, shiftId: 'shift_dia', requiredShifts: ['shift_dia', 'shift_noche'], effectiveDate: todayISO() }];
  await boot(page, { equipment, plans });
  await page.evaluate(() => renderMatrizSemanal());
  const diaTable = page.locator('table.matriz', { hasText: 'TURNO DÍA' });
  const nocheTable = page.locator('table.matriz', { hasText: 'TURNO NOCHE' });
  await expect(diaTable.locator('tbody tr')).toHaveCount(1);
  await expect(nocheTable.locator('tbody tr')).toHaveCount(1);
  // Antes de hoy (ayer, dentro de la misma semana) la obligación seguía siendo de un solo turno:
  // la celda de Noche de ayer debe quedar vacía (sin obligación), nunca "no realizado".
  const nocheRow = nocheTable.locator('tbody tr').first();
  const headers = nocheTable.locator('thead tr').nth(1).locator('th');
  const todayIdx = await nocheTable.locator('th.is-today').evaluate(el => [...el.parentElement.children].indexOf(el));
  if (todayIdx > 1) {
    const ayerCell = nocheRow.locator('td').nth(todayIdx - 1);
    await expect(ayerCell).toHaveText('');
  }
});

test('6. Nunca mini-celdas Día/Noche dentro de una celda, en ningún escenario de doble turno', async ({ page }) => {
  const equipment = [{ id: 'e1', code: '20-5530', status: 'Operativo' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: ALL_DAYS, shiftId: 'shift_dia', requiredShifts: ['shift_dia', 'shift_noche'], effectiveDate: dayISO(-7) }];
  await boot(page, { equipment, plans });
  await page.evaluate(() => renderMatrizSemanal());
  await expect(page.locator('.matrix-dual-cell')).toHaveCount(0);
  await expect(page.locator('.matrix-occurrence-shift')).toHaveCount(0);
  await expect(page.locator('[data-matrix-shift]')).toHaveCount(0);
});

test('7. Dos ocurrencias del mismo equipo (Día + Noche) no se deduplican por equipmentId — cada tabla cuenta su propia fila', async ({ page }) => {
  const equipment = [{ id: 'e1', code: '20-5530', status: 'Operativo' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: ALL_DAYS, shiftId: 'shift_dia', requiredShifts: ['shift_dia', 'shift_noche'], effectiveDate: dayISO(-7) }];
  await boot(page, { equipment, plans });
  await page.evaluate(() => renderMatrizSemanal());
  // PROGRAMADOS cuenta occurrences: 2 filas (Día+Noche) x 7 días = 14 celdas con obligación.
  const programados = page.locator('[data-kpi-label="PROGRAMADOS"]');
  await expect(programados).toHaveAttribute('data-kpi-value', '14');
});

test('8. Caso 05-0870 (OFF + Día, sin requiredShifts) -> aparece solo en Día, nunca "Día + Noche"', async ({ page }) => {
  const equipment = [{ id: 'e1', code: '05-0870', shiftId: 'shift_dia', status: 'Operativo' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: ALL_DAYS, shiftId: 'shift_dia', requiredShifts: [] }];
  await boot(page, { equipment, plans });
  await page.evaluate(() => renderMatrizSemanal());
  const diaTable = page.locator('table.matriz', { hasText: 'TURNO DÍA' });
  const nocheTable = page.locator('table.matriz', { hasText: 'TURNO NOCHE' });
  await expect(diaTable.locator('tbody tr')).toContainText('05-0870');
  await expect(nocheTable).toHaveCount(0);
});

test('9. Caso 20-5530 (ON desde 17/10/2026, ya alcanzada) -> aparece en ambas matrices desde effectiveDate', async ({ page }) => {
  const equipment = [{ id: 'e1', code: '20-5530', shiftId: 'shift_dia', status: 'Operativo' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: ALL_DAYS, shiftId: 'shift_dia', requiredShifts: ['shift_dia', 'shift_noche'], effectiveDate: '2026-10-17' }];
  await boot(page, { equipment, plans });
  await page.evaluate(() => renderMatrizSemanal());
  const diaTable = page.locator('table.matriz', { hasText: 'TURNO DÍA' });
  const nocheTable = page.locator('table.matriz', { hasText: 'TURNO NOCHE' });
  await expect(diaTable.locator('tbody tr')).toContainText('20-5530');
  await expect(nocheTable.locator('tbody tr')).toContainText('20-5530');
});

test('11/12. Métricas por occurrence: PROGRAMADOS/REALIZADOS/CUMPLIMIENTO reflejan ambas ocurrencias de un equipo dual, numerador/denominador documentados', async ({ page }) => {
  const todayIso = todayISO();
  const equipment = [{ id: 'e1', code: '20-5530', status: 'Operativo' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: ALL_DAYS, shiftId: 'shift_dia', requiredShifts: ['shift_dia', 'shift_noche'], effectiveDate: dayISO(-7) }];
  // Hoy: turno Día realizado, turno Noche todavía pendiente (no cuenta en contra).
  const records = [{ id: 'r1', equipmentId: 'e1', date: `${todayIso}T08:00:00`, shiftId: 'shift_dia', userName: 'Ana', qty: 1, details: [],
    operationalSnapshot: { operationalDate: todayIso, occurrenceKey: `p1:${todayIso}:shift_dia` } }];
  await boot(page, { equipment, plans, records });
  await page.evaluate(() => renderMatrizSemanal());
  // Denominador (yaVencidas) = hechas + no_realizado + pendiente + parcial + skip (excluye futuro/pausado/vacío).
  // Con 1 equipo dual x 7 días x 2 turnos = 14 celdas con obligación -> PROGRAMADOS=14.
  await expect(page.locator('[data-kpi-label="PROGRAMADOS"]')).toHaveAttribute('data-kpi-value', '14');
  // Al menos la ocurrencia de hoy-Día cuenta como realizada.
  const realizados = Number(await page.locator('[data-kpi-label="REALIZADOS"]').getAttribute('data-kpi-value'));
  expect(realizados).toBeGreaterThanOrEqual(1);
  const pct = Number(await page.locator('[data-kpi-label="CUMPLIMIENTO %"]').getAttribute('data-kpi-value'));
  expect(pct).toBeGreaterThanOrEqual(0);
  expect(pct).toBeLessThanOrEqual(100);
});

test('13/14. Pendiente hoy vs no realizado no se duplican; pausado no entra al cumplimiento', async ({ page }) => {
  // Único día asignado = HOY (para ambos equipos), a propósito: evita que
  // días pasados de la semana (fuera del alcance de esta prueba) generen
  // "no realizado" y contaminen la lectura del cumplimiento.
  const hoyNombre = ALL_DAYS[new Date().getDay()];
  const equipment = [
    { id: 'e1', code: 'E1', status: 'Operativo' },
    { id: 'e2', code: 'E2', status: 'Detenido' },
  ];
  const plans = [
    { id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyNombre], shiftId: 'shift_dia', requiredShifts: [] },
    { id: 'p2', equipmentId: 'e2', controlType: 'Día y turno de la semana', assignedDays: [hoyNombre], shiftId: 'shift_dia', requiredShifts: [] },
  ];
  await boot(page, { equipment, plans });
  await page.evaluate(() => renderMatrizSemanal());
  const pendientes = Number(await page.locator('[data-kpi-label="PENDIENTES HOY"]').getAttribute('data-kpi-value'));
  const noRealizados = Number(await page.locator('[data-kpi-label="NO REALIZADOS"]').getAttribute('data-kpi-value'));
  const pausados = Number(await page.locator('[data-kpi-label="PAUSADOS"]').getAttribute('data-kpi-value'));
  // E1 (Operativo, hoy es su único día) está PENDIENTE HOY (1) — nunca
  // simultáneamente "no realizado" (son estados mutuamente excluyentes).
  expect(pendientes).toBe(1);
  expect(noRealizados).toBe(0);
  // E2 (Detenido, hoy es su único día) aporta exactamente 1 "pausado".
  expect(pausados).toBe(1);
  const pct = Number(await page.locator('[data-kpi-label="CUMPLIMIENTO %"]').getAttribute('data-kpi-value'));
  // Denominador = hechas+no_realizado+pendiente+parcial+skip: con hechas=0
  // y pendiente=1 (E1) da 0%. Si "pausado" (E2) entrara al denominador
  // como incumplimiento, bajaría aún más injustamente — PAUSADOS está
  // fuera del cálculo por diseño (ver `yaVencidas` en renderMatrizSemanal).
  expect(pct).toBe(0);
});

test('15. Regresión: equipo de un solo turno sigue detectando "realizado atrasado" (arrastre entre turnos) sin cambios', async ({ page }) => {
  const todayIso = todayISO();
  const equipment = [{ id: 'e1', code: 'A11', status: 'Operativo' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: ALL_DAYS, shiftId: 'shift_dia', requiredShifts: [] }];
  const records = [{ id: 'r1', equipmentId: 'e1', date: `${todayIso}T20:00:00`, shiftId: 'shift_noche', userName: 'Ana', qty: 1, details: [] }];
  await boot(page, { equipment, plans, records });
  await page.evaluate(() => renderMatrizSemanal());
  const diaTable = page.locator('table.matriz', { hasText: 'TURNO DÍA' });
  await expect(diaTable.locator('tbody tr')).toContainText('REALIZADO ATRASADO');
});
