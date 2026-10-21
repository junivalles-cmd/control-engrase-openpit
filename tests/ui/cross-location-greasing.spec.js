// tests/ui/cross-location-greasing.spec.js
//
// Pedido "...ENGRASE DE EQUIPO DE OTRA UBICACIÓN" (2026-10-09), Parte E/N.
// Carga y EJECUTA de verdad handleOutOfPlanEquipoSelected() (app.js) —
// la ÚNICA puerta real para decidir ASSIGNED/normal/advertencia de
// cross-location/OUT_OF_PLAN — con DB/App reemplazados por stores
// controlables, mismo patrón real-execution que el resto del proyecto.
// startLubricadorGreaseFlow()/startGreaseFlow() se reemplazan por espías
// (su comportamiento real ya se prueba aparte) — lo que se verifica es
// CUÁNDO se muestra la advertencia y con qué argumentos se llama el
// arranque del flujo real.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, LUBRICATION_STATUS_JS_PATH, OPERATIONAL_SCOPE_JS_PATH, SHIFTS_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const appSource = readSource(APP_JS_PATH);
const statusSource = readSource(LUBRICATION_STATUS_JS_PATH);
const scopeSource = readSource(OPERATIONAL_SCOPE_JS_PATH);
const shiftsSource = readSource(SHIFTS_JS_PATH);

const shiftsSrc = extractDeclaration(shiftsSource, 'currentShiftId');
const statusNames = ['fmt', 'WEEKDAY_NAMES', 'mostRecentAssignedDate', 'weekdayStatusFor', 'statusFor'];
const statusSrc = statusNames.map(n => extractDeclaration(statusSource, n)).join('\n\n');
const scopeNames = [
  'ASSIGNMENT_STATUS', 'ROLES_CREW_SCOPED', 'getAuthorizedCrews', 'resolveCrewLocationCoverage', 'resolveOperationalScope',
  'operationalDateForShift', 'computeOccurrenceKey', 'toISODateUTCLocal', 'findActivePendingAssignment',
  'canLubricadorExecuteEquipment', 'findExistingWorkForEquipment', 'classifyEquipmentWork',
];
const scopeSrc = scopeNames.map(n => extractDeclaration(scopeSource, n)).join('\n\n');
const appNames = [
  '$', '$$', 'esc', 'ic', 'openModal', 'closeModal',
  'getSelectedCrewId', 'setSelectedCrewId', 'getCurrentOperationalScope', 'loadAssignmentContext',
  'equipoOccurrenceKey', 'handleOutOfPlanEquipoSelected',
];
const appSrc = appNames.map(n => extractDeclaration(appSource, n)).join('\n\n');

const LOCATIONS = [{ id: 'l_volcan', name: 'Volcán' }, { id: 'l_mojon', name: 'Mojón' }];
const CREW = [{ id: 'crew_volcan', name: 'Cuadrilla Volcán', active: true, locationId: 'l_volcan', isDefault: true, memberUserIds: ['lub1'] }];

function weekdayName(d) {
  return ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][d.getDay()];
}

async function bootPage(page, { equipos = [], plans = [], assignments = [] } = {}) {
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
        route: 'turno', currentUser: { id: 'lub1', name: 'Lubricador de prueba', role: 'LUBRICADOR' },
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18 },
      };
      window.__calls = { startLubricadorGreaseFlow: [], startGreaseFlow: [] };
      window.startLubricadorGreaseFlow = (...a) => { window.__calls.startLubricadorGreaseFlow.push(a); };
      window.startGreaseFlow = (...a) => { window.__calls.startGreaseFlow.push(a); };
      window.__mockData = {
        equipment: ${JSON.stringify(equipos)}, locations: ${JSON.stringify(LOCATIONS)}, cuadrillas: ${JSON.stringify(CREW)},
        lubrication_plans: ${JSON.stringify(plans)}, lubrication_assignments: ${JSON.stringify(assignments)},
        lubrication_records: [],
      };
      window.DB = {
        all: async (store) => window.DB.allActive(store), allActive: async (store) => window.__mockData[store] || [],
        get: async (store, id) => (window.__mockData[store] || []).find(r => r.id === id) || null,
      };
      ${shiftsSrc}
      ${statusSrc}
      ${scopeSrc}
      ${appSrc}
      window.currentShiftId = currentShiftId;
      window.handleOutOfPlanEquipoSelected = handleOutOfPlanEquipoSelected;
    `,
  });
}

test('A — crew Volcán + equipo Volcán (misma ubicación): nunca muestra la advertencia de cross-location', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  const hoy = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: '10-01', brand: 'Cat', model: 'D8T', status: 'Operativo', locationId: 'l_volcan' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoy] }];

  await bootPage(page, { equipos, plans });
  await page.evaluate(() => window.handleOutOfPlanEquipoSelected('e1'));

  expect(errors).toEqual([]);
  await expect(page.locator('.modal-title-text, #modal-title-text')).not.toContainText('fuera de tu ubicación');
  // Plan normal pendiente hoy -> "ya tiene un engrase pendiente" (PLANNED), nunca cross-location.
  await expect(page.locator('#modal-title-text')).toContainText('ya tiene un engrase pendiente');
});

test('B — assignment fuera de cobertura no autoriza ejecución', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  const equipos = [{ id: 'e2', code: '20-5530', brand: 'Cat', model: 'D8T', status: 'Operativo', locationId: 'l_mojon' }];
  const plans = [{ id: 'p2', equipmentId: 'e2', controlType: 'Horas de operación', frequency: 250, lastGreaseHour: 100 }];
  const occurrenceKey = 'p2:h:100';
  const assignments = [{ id: 'a1', occurrenceKey, equipmentId: 'e2', assignedCrewId: 'crew_volcan', status: 'PENDING', active: true }];

  await bootPage(page, { equipos, plans, assignments });
  await page.evaluate(() => window.handleOutOfPlanEquipoSelected('e2'));

  expect(errors).toEqual([]);
  await expect(page.locator('#modal-title-text')).toContainText('cobertura autorizada');
  await expect(page.locator('#oop-cross-continue')).toHaveCount(0);
  expect(await page.evaluate(() => window.__calls.startLubricadorGreaseFlow)).toEqual([]);
});

test('C/D — crew Volcán + equipo Mojón SIN assignment: muestra la advertencia real; Cancelar no inicia ningún flujo', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  const equipos = [{ id: 'e3', code: '20-5531', brand: 'Komatsu', model: 'WA470', status: 'Operativo', locationId: 'l_mojon' }];

  await bootPage(page, { equipos });
  await page.evaluate(() => window.handleOutOfPlanEquipoSelected('e3'));

  expect(errors).toEqual([]);
  await expect(page.locator('#modal-title-text')).toContainText('cobertura autorizada');
  await expect(page.locator('.modal-body')).toContainText('Una asignación no amplía');
  await expect(page.locator('#oop-cross-continue')).toHaveCount(0);

  await page.locator('#oop-cross-cancel').click();
  const calls = await page.evaluate(() => window.__calls.startLubricadorGreaseFlow);
  expect(calls).toEqual([]); // D: Cancelar nunca inicia ningún flujo
  await expect(page.locator('#modal-overlay.open')).toHaveCount(0);
});

test('E — fuera de cobertura no ofrece bypass OUT_OF_PLAN', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  const equipos = [{ id: 'e4', code: '20-5532', brand: 'Komatsu', model: 'WA470', status: 'Operativo', locationId: 'l_mojon' }];

  await bootPage(page, { equipos });
  await page.evaluate(() => window.handleOutOfPlanEquipoSelected('e4'));
  await expect(page.locator('#oop-cross-continue')).toHaveCount(0);
  await page.locator('#oop-cross-cancel').click();

  expect(errors).toEqual([]);
  await expect(page.locator('#modal-overlay.open')).toHaveCount(0); // se cierra antes de abrir el flujo
  const calls = await page.evaluate(() => window.__calls.startLubricadorGreaseFlow);
  expect(calls).toEqual([]);
});

test('F/G — equipment.locationId y crew.locationId NUNCA cambian, sin importar Cancelar o Continuar', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  const equipos = [{ id: 'e5', code: '20-5533', brand: 'Komatsu', model: 'WA470', status: 'Operativo', locationId: 'l_mojon' }];

  await bootPage(page, { equipos });
  await page.evaluate(() => window.handleOutOfPlanEquipoSelected('e5'));
  await page.locator('#oop-cross-cancel').click();

  expect(errors).toEqual([]);
  const equipoLocId = await page.evaluate(() => window.__mockData.equipment[0].locationId);
  const crewLocId = await page.evaluate(() => window.__mockData.cuadrillas[0].locationId);
  expect(equipoLocId).toBe('l_mojon'); // el equipo SIGUE siendo de Mojón
  expect(crewLocId).toBe('l_volcan'); // la cuadrilla SIGUE siendo de Volcán
});

test('sin cuadrilla o selección ambigua: no ofrece bypass y no inicia flujo',async({page})=>{
  await bootPage(page,{equipos:[{id:'e1',locationId:'l_volcan',status:'Operativo'}]});
  for(const crews of [[],[...CREW,{...CREW[0],id:'second'}]]){
    await page.evaluate(crews=>{window.__mockData.cuadrillas=crews;},crews);
    await page.evaluate(()=>handleOutOfPlanEquipoSelected('e1'));
    await expect(page.locator('#oop-cross-continue')).toHaveCount(0);
    expect(await page.evaluate(()=>__calls.startLubricadorGreaseFlow)).toEqual([]);
    await page.locator('#oop-cross-cancel').click();
  }
});
