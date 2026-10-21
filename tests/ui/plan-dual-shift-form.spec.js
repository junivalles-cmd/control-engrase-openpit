// tests/ui/plan-dual-shift-form.spec.js
//
// "Simplificar selector de turno en Plan de Engrase" — reemplaza el
// checkbox "Obligaciones Día y Noche" + el selector "Turno" separado por
// UN único selector: Turno Día / Turno Noche / Día + Noche.
//
// Historial (caso real 05-0870, ya resuelto antes de este cambio): el
// checkbox ON + selector "Turno Día" visible + resumen de tabla mostrando
// solo "Día" era una contradicción real. La causa raíz (selector leyendo
// equipment.shiftId en vez de plan.shiftId, selector visible con dual
// activo, dual sin effectiveDate persistiendo a medias) ya estaba
// corregida; este archivo reescribe los mismos escenarios contra el NUEVO
// control único, sin reabrir ninguna de esas tres causas.
//
// openPlanForm()/openBulkPlanForm() se EJECUTAN de verdad (mismo patrón
// que ficha-programacion-semana.spec.js) — fixtures sintéticos, sin red,
// sin Supabase. requiredShiftsForPlan()/REQUIRED_SHIFT_IDS (fuente real,
// operational-scope.js) deciden si el modelo de datos subyacente
// (plan.shiftId / plan.requiredShifts / plan.effectiveDate) es correcto —
// nunca se reimplementa esa lógica en el test.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, DB_JS_PATH, OPERATIONAL_SCOPE_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

const appSource = readSource(APP_JS_PATH);
const dbSource = readSource(DB_JS_PATH);
const scopeSource = readSource(OPERATIONAL_SCOPE_JS_PATH);

const dbNames = ['uid', 'nowISO', 'stamp'];
const dbSrc = dbNames.map(n => extractDeclaration(dbSource, n)).join('\n\n');
const scopeNames = ['REQUIRED_SHIFT_IDS', 'requiredShiftsForPlan'];
const scopeSrc = scopeNames.map(n => extractDeclaration(scopeSource, n)).join('\n\n');
const appNames = [
  '$', '$$', 'esc', 'ic', 'fmtDateOnly', 'SCHEDULE_WEEKDAYS',
  'openModal', 'closeModal', 'openPlanForm', 'openBulkPlanForm',
];
const appSrc = appNames.map(n => extractDeclaration(appSource, n)).join('\n\n');

async function bootPage(page, { equipos = [], plans = [] } = {}) {
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
      window.App = { currentUser: { id: 'admin1', name: 'Admin de prueba', role: 'ADMINISTRADOR' },
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18, defaultAlertYellowHours: 10 } };
      window.__mockData = {
        equipment: ${JSON.stringify(equipos)},
        lubrication_plans: ${JSON.stringify(plans)},
        lubrication_points: [],
      };
      window.__queuedShiftChanges = [];
      window.DB = {
        get: async (store, id) => (window.__mockData[store] || []).find(r => r.id === id) || null,
        allActive: async (store) => window.__mockData[store] || [],
        put: async (store, row) => {
          const list = window.__mockData[store] || (window.__mockData[store] = []);
          const i = list.findIndex(r => r.id === row.id);
          if (i >= 0) list[i] = row; else list.push(row);
          return row;
        },
        queueCatalogOperation: async (kind, equipment, patch) => {
          window.__queuedShiftChanges.push({ kind, equipmentId: equipment.id, patch });
          Object.assign(equipment, patch);
        },
      };
      window.logAudit = async () => {};
      window.showInAppToast = () => {};
      window.navigate = () => {};
      window.wirePhotoThumbs = () => {};
      window.resolveEvidenceSrc = async () => null;
      window.openPointForm = () => {};
      window.openCopyPointsForm = () => {};
      ${dbSrc}
      ${scopeSrc}
      ${appSrc}
      window.openPlanForm = openPlanForm;
      window.openBulkPlanForm = openBulkPlanForm;
    `,
  });
}

const shiftMode = page => page.locator('#plan-form [name="shiftMode"]');
const effectiveDateField = page => page.locator('#plan-effective-date-field');
const effectiveDateInput = page => page.locator('#plan-form [name="effectiveDate"]');

function planFor(page) {
  return page.evaluate(() => window.__mockData.lubrication_plans.find(p => p.id === 'p1'));
}

test('1. Crear plan Día: selector único, sin fecha efectiva, requiredShifts vacío y shiftId=shift_dia', async ({ page }) => {
  const equipo = { id: 'e1', code: '05-0870', shiftId: 'shift_dia' };
  await bootPage(page, { equipos: [equipo], plans: [] });
  await page.evaluate(() => openPlanForm('e1', null, []));
  await page.locator('#plan-control-type').selectOption('Día y turno de la semana');
  await shiftMode(page).selectOption('shift_dia');
  await expect(effectiveDateField(page)).toBeHidden();
  await page.locator('[name="assignedDays"][value="Martes"]').check();
  await page.evaluate(() => { document.querySelector('#plan-form input[name="id"]'); });
  await page.locator('#plan-form button[type="submit"]').click();
  const plan = await page.evaluate(() => window.__mockData.lubrication_plans[0]);
  expect(plan.shiftId).toBe('shift_dia');
  expect(plan.requiredShifts).toEqual([]);
});

test('2. Crear plan Noche: shiftId=shift_noche, nunca lee equipment.shiftId (equipo queda en Día)', async ({ page }) => {
  const equipo = { id: 'e1', code: 'T-99', shiftId: 'shift_dia' };
  await bootPage(page, { equipos: [equipo], plans: [] });
  await page.evaluate(() => openPlanForm('e1', null, []));
  await page.locator('#plan-control-type').selectOption('Día y turno de la semana');
  await shiftMode(page).selectOption('shift_noche');
  await page.locator('[name="assignedDays"][value="Lunes"]').check();
  await page.locator('#plan-form button[type="submit"]').click();
  const plan = await page.evaluate(() => window.__mockData.lubrication_plans[0]);
  expect(plan.shiftId).toBe('shift_noche');
  expect(plan.requiredShifts).toEqual([]);
  // El plan manda; sincroniza equipment.shiftId para "Mi Turno" (mismo
  // contrato que el selector anterior), pero la LECTURA del selector al
  // abrir el formulario nunca depende de equipment.shiftId (test 6).
  const equipoDespues = await page.evaluate(() => window.__mockData.equipment[0]);
  expect(equipoDespues.shiftId).toBe('shift_noche');
});

test('3. Crear Día+Noche: requiere fecha efectiva, guarda requiredShifts completo', async ({ page }) => {
  const equipo = { id: 'e1', code: '05-0870', shiftId: 'shift_dia' };
  await bootPage(page, { equipos: [equipo], plans: [] });
  await page.evaluate(() => openPlanForm('e1', null, []));
  await page.locator('#plan-control-type').selectOption('Día y turno de la semana');
  await shiftMode(page).selectOption('dual');
  await expect(effectiveDateField(page)).toBeVisible();
  await effectiveDateInput(page).fill('2026-10-20');
  await page.locator('[name="assignedDays"][value="Martes"]').check();
  await page.locator('#plan-form button[type="submit"]').click();
  const plan = await page.evaluate(() => window.__mockData.lubrication_plans[0]);
  expect(plan.requiredShifts).toEqual(['shift_dia', 'shift_noche']);
  expect(plan.effectiveDate).toBe('2026-10-20');
});

test('4. Dual sin fecha efectiva: Guardar queda bloqueado, nunca se persiste la contradicción', async ({ page }) => {
  const equipo = { id: 'e1', code: '05-0870', shiftId: 'shift_dia' };
  const plan = { id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', frequency: 50, shiftId: 'shift_dia', assignedDays: ['Martes'], requiredShifts: [] };
  await bootPage(page, { equipos: [equipo], plans: [plan] });
  await page.evaluate(() => openPlanForm('e1', 'p1', []));
  await shiftMode(page).selectOption('dual');
  // A propósito NO se llena effectiveDate — reproduce el estado real.
  let alertMessage = null;
  page.once('dialog', async d => { alertMessage = d.message(); await d.accept(); });
  await page.locator('#plan-form button[type="submit"]').click();
  expect(alertMessage).toContain('fecha efectiva');
  const planDespues = await planFor(page);
  expect(planDespues.requiredShifts).toEqual([]);
});

test('5. Editar plan dual existente: selector preselecciona "Día + Noche" y muestra la fecha', async ({ page }) => {
  const equipo = { id: 'e1', code: '05-0870', shiftId: 'shift_dia' };
  const plan = { id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', frequency: 50, shiftId: 'shift_dia',
    assignedDays: ['Martes', 'Jueves'], requiredShifts: ['shift_dia', 'shift_noche'], effectiveDate: '2026-10-01' };
  await bootPage(page, { equipos: [equipo], plans: [plan] });
  await page.evaluate(() => openPlanForm('e1', 'p1', []));
  await expect(shiftMode(page)).toHaveValue('dual');
  await expect(effectiveDateField(page)).toBeVisible();
  await expect(effectiveDateInput(page)).toHaveValue('2026-10-01');
});

test('6. Editar plan single: selector preselecciona su turno (lee plan.shiftId, nunca equipment.shiftId)', async ({ page }) => {
  // Caso real de divergencia: equipment.shiftId quedó en "shift_dia" (turno
  // global, quizás cambiado desde otra pantalla) pero ESTE plan es de Noche.
  const equipo = { id: 'e1', code: 'T-99', shiftId: 'shift_dia' };
  const plan = { id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', frequency: 50, shiftId: 'shift_noche', assignedDays: ['Lunes'], requiredShifts: [] };
  await bootPage(page, { equipos: [equipo], plans: [plan] });
  await page.evaluate(() => openPlanForm('e1', 'p1', []));
  await expect(shiftMode(page)).toHaveValue('shift_noche');
  await expect(effectiveDateField(page)).toBeHidden();
});

test('7. Cambiar Día -> Día + Noche: exige fecha nueva, actualiza requiredShifts sin perder shiftId', async ({ page }) => {
  const equipo = { id: 'e1', code: '05-0870', shiftId: 'shift_dia' };
  const plan = { id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', frequency: 50, shiftId: 'shift_dia', assignedDays: ['Martes'], requiredShifts: [] };
  await bootPage(page, { equipos: [equipo], plans: [plan] });
  await page.evaluate(() => openPlanForm('e1', 'p1', []));
  await expect(shiftMode(page)).toHaveValue('shift_dia');
  await shiftMode(page).selectOption('dual');
  await effectiveDateInput(page).fill('2026-11-01');
  await page.locator('#plan-form button[type="submit"]').click();
  const planGuardado = await planFor(page);
  expect(planGuardado.requiredShifts).toEqual(['shift_dia', 'shift_noche']);
  expect(planGuardado.effectiveDate).toBe('2026-11-01');
  expect(planGuardado.shiftId).toBe('shift_dia'); // respaldo histórico para antes de la fecha efectiva
});

test('8. Cambiar Día + Noche -> Día: vuelve a turno simple, conserva effectiveDate histórico sin activar dual', async ({ page }) => {
  const equipo = { id: 'e1', code: '05-0870', shiftId: 'shift_dia' };
  const plan = { id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', frequency: 50, shiftId: 'shift_dia',
    assignedDays: ['Martes'], requiredShifts: ['shift_dia', 'shift_noche'], effectiveDate: '2026-10-01' };
  await bootPage(page, { equipos: [equipo], plans: [plan] });
  await page.evaluate(() => openPlanForm('e1', 'p1', []));
  await expect(shiftMode(page)).toHaveValue('dual');
  await shiftMode(page).selectOption('shift_noche');
  await page.locator('#plan-form button[type="submit"]').click();
  const planGuardado = await planFor(page);
  expect(planGuardado.requiredShifts).toEqual([]);
  expect(planGuardado.shiftId).toBe('shift_noche');
  // Historial NUNCA se borra a ciegas — la fecha vieja queda, pero inerte:
  // requiredShiftsForPlan() ya no la consulta sin requiredShifts dual.
  expect(planGuardado.effectiveDate).toBe('2026-10-01');
  const shifts = await page.evaluate(() => {
    const p = window.__mockData.lubrication_plans.find(x => x.id === 'p1');
    return requiredShiftsForPlan(p, p.effectiveDate);
  });
  expect(shifts).toEqual(['shift_noche']);
});

test('9. Guardar y reabrir conserva exactamente el estado guardado (dual y single)', async ({ page }) => {
  const equipo = { id: 'e1', code: '05-0870', shiftId: 'shift_dia' };
  const plan = { id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', frequency: 50, shiftId: 'shift_dia', assignedDays: ['Martes', 'Jueves', 'Sábado'], requiredShifts: [] };
  await bootPage(page, { equipos: [equipo], plans: [plan] });
  await page.evaluate(() => openPlanForm('e1', 'p1', []));
  await shiftMode(page).selectOption('dual');
  await effectiveDateInput(page).fill('2026-10-20');
  await page.locator('#plan-form button[type="submit"]').click();
  await page.evaluate(() => { closeModal(); openPlanForm('e1', 'p1', []); });
  await expect(shiftMode(page)).toHaveValue('dual');
  await expect(effectiveDateInput(page)).toHaveValue('2026-10-20');
  await expect(effectiveDateField(page)).toBeVisible();
});

test('14. Plan en lote: selector único (Conservar/Día/Noche/Día+Noche) aplica a todos los equipos seleccionados', async ({ page }) => {
  const equipos = [
    { id: 'e1', code: 'A1', shiftId: 'shift_dia' },
    { id: 'e2', code: 'A2', shiftId: 'shift_noche' },
  ];
  const plans = [
    { id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', frequency: 50, shiftId: 'shift_dia', assignedDays: ['Lunes'], requiredShifts: [] },
  ];
  await bootPage(page, { equipos, plans });
  await page.evaluate(() => openBulkPlanForm(['e1', 'e2']));
  const bulkShiftMode = page.locator('#bulk-plan-form [name="shiftMode"]');
  const bulkEffectiveDateField = page.locator('#bulk-plan-effective-date-field');
  await expect(bulkEffectiveDateField).toBeHidden();
  await page.locator('#bulk-plan-control-type').selectOption('Día y turno de la semana');
  await bulkShiftMode.selectOption('dual');
  await expect(bulkEffectiveDateField).toBeVisible();
  await page.locator('#bulk-plan-form [name="effectiveDate"]').fill('2026-10-25');
  await page.locator('[name="assignedDays"][value="Lunes"]').check();
  await page.locator('#bulk-plan-form button[type="submit"]').click();
  const plansDespues = await page.evaluate(() => window.__mockData.lubrication_plans);
  expect(plansDespues).toHaveLength(2);
  for (const p of plansDespues) {
    expect(p.requiredShifts).toEqual(['shift_dia', 'shift_noche']);
    expect(p.effectiveDate).toBe('2026-10-25');
  }
});

test('14b. Plan en lote con "Conservar configuración de cada plan": no toca turno/requiredShifts/effectiveDate existentes', async ({ page }) => {
  const equipos = [{ id: 'e1', code: 'A1', shiftId: 'shift_dia' }];
  const plans = [
    { id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', frequency: 50, shiftId: 'shift_dia',
      assignedDays: ['Lunes'], requiredShifts: ['shift_dia', 'shift_noche'], effectiveDate: '2026-09-01' },
  ];
  await bootPage(page, { equipos, plans });
  await page.evaluate(() => openBulkPlanForm(['e1']));
  await page.locator('#bulk-plan-control-type').selectOption('Día y turno de la semana');
  await page.locator('[name="assignedDays"][value="Martes"]').check();
  await page.locator('#bulk-plan-form button[type="submit"]').click();
  const planDespues = await page.evaluate(() => window.__mockData.lubrication_plans.find(p => p.id === 'p1'));
  expect(planDespues.requiredShifts).toEqual(['shift_dia', 'shift_noche']);
  expect(planDespues.effectiveDate).toBe('2026-09-01');
  expect(planDespues.shiftId).toBe('shift_dia');
});
