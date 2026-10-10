// Production scope/render/matrix and real IndexedDB; local fixtures only.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, DB_JS_PATH, SHIFTS_JS_PATH, LUBRICATION_STATUS_JS_PATH,
  OPERATIONAL_SCOPE_JS_PATH, GREASE_VALIDATION_JS_PATH, WEEKLY_MATRIX_JS_PATH } from '../helpers/loadLubricationLogic.js';

const declarations = (file, names) => names.map(name => extractDeclaration(readSource(file), name)).join('\n');
const source = [
  declarations(DB_JS_PATH, ['DB_NAME', 'DB_VERSION', 'STORES', 'LOCAL_STORES', 'tx', 'openDB', 'DB', 'uid', 'nowISO', 'stamp']),
  ...[SHIFTS_JS_PATH, LUBRICATION_STATUS_JS_PATH, OPERATIONAL_SCOPE_JS_PATH, GREASE_VALIDATION_JS_PATH, WEEKLY_MATRIX_JS_PATH].map(readSource),
  declarations(APP_JS_PATH, ['$', '$$', 'esc', 'ic', 'todayDateISO', 'STATUS_COLOR', 'GREASE_UNIT', 'NO_EXECUTION_REASON_LABELS',
    'colorLegendHTML', 'validationBadgeHTML', 'computeAllStatuses', 'getSelectedCrewId', 'getCurrentOperationalScope',
    'loadAssignmentContext', 'equipoOccurrenceKey', 'renderLubricadorHome', 'openModal', 'closeModal', 'wireMatrizScrollHint',
    'openLubricadorMatrizModal', 'handleOutOfPlanEquipoSelected', 'startLubricadorGreaseFlow', 'cuadrillasPanelHTML', 'wireCuadrillasPanel']),
].join('\n');
const crew = { id: '76-08', name: '76-08 Camión Lubrico', locationId: 'volcan', isDefault: true, memberUserIds: ['lub'], active: true };
const locations = [{ id: 'volcan', name: 'Volcán' }, { id: 'mojon', name: 'Mojón' }, { id: 'acarreo', name: 'Acarreo' }, { id: 'outside', name: 'Otra' }];
const coverage = locations.slice(0, 3).map(l => ({ id: `cl:${l.id}`, crew_id: crew.id, location_id: l.id, role: l.id === 'acarreo' ? 'APOYO' : 'PRINCIPAL', active: true, updatedAt: '2026-10-10T10:00:00.000Z' }));

async function boot(page, { legacy = false, assignment = false, firstPull = false } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Dedicated local origin: no app boot, authentication or remote requests.
  await page.route('**/__crew_fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="app-content"></main></body></html>' }));
  await page.goto('/__crew_fixture');
  await page.addStyleTag({ path: path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css') });
  await page.addScriptTag({ content: `
    let _db = null;
    window.App = { route: 'turno', currentUser: { id: 'lub', name: 'Lubricador de prueba', role: 'LUBRICADOR' }, generalSettings: { shiftDayStart: 6, shiftNightStart: 18, complianceTarget: 85 } };
    let lastSyncState = { status: 'ok' };
    window.navigate = () => {}; window.openAnomalyForm = () => {}; window.openQrScanner = () => {};
    window.openEquipmentDetail = () => {}; window.openOutOfPlanEquipmentPicker = () => {}; window.openValidationDetailModal = () => {};
    window.updateLubricadorWidgetSnapshot = snapshot => window.__widget = snapshot;
    window.startGreaseFlow = async (id, target, options) => { window.__flow = { id, options }; };
    window.refreshPushTokenCrewScope = async () => {};
    window.Sync = { fullSync: async () => ({ ok: true }) };
    window.logAudit = async () => {}; window.showInAppToast = () => {};
    window.Auth = { manageUsers: async () => ({ users: [] }) };
    ${source}
    window.DB = DB; window.renderLubricadorHome = renderLubricadorHome;
    window.getCurrentOperationalScope = getCurrentOperationalScope;
    window.handleOutOfPlanEquipoSelected = handleOutOfPlanEquipoSelected;
    window.startLubricadorGreaseFlow = startLubricadorGreaseFlow;
    window.openLubricadorMatrizModal = openLubricadorMatrizModal;
    window.openDB = openDB; window.cuadrillasPanelHTML = cuadrillasPanelHTML;
    window.wireCuadrillasPanel = wireCuadrillasPanel;
    window.__setSyncStatus = status => { lastSyncState.status = status; };
  ` });
  await page.evaluate(async ({ crew, locations, coverage, legacy, assignment, firstPull }) => {
    await openDB();
    await DB.setConfig(firstPull ? {} : { lastPull: '2026-10-10T10:00:00.000Z' });
    await DB.put('cuadrillas', crew);
    for (const l of locations) await DB.put('locations', l);
    if (!legacy) await DB.putMany('crew_locations', coverage);
    const day = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][new Date().getDay()];
    for (const l of locations) {
      await DB.put('equipment', { id: `eq:${l.id}`, code: l.id.toUpperCase(), brand: 'CAT', model: 'D8', status: 'Operativo', locationId: l.id, hourmeter: 100, active: true });
      await DB.put('lubrication_plans', { id: `plan:${l.id}`, equipmentId: `eq:${l.id}`, controlType: 'Día y turno de la semana', assignedDays: [day], active: true });
    }
    if (assignment) await DB.put('lubrication_assignments', { id: 'asg', equipmentId: 'eq:acarreo', occurrenceKey: `plan:acarreo:${todayDateISO()}`, assignedCrewId: crew.id, status: 'PENDING', active: true });
    await renderLubricadorHome();
  }, { crew, locations, coverage, legacy, assignment, firstPull });
  return errors;
}
const kpi = page => page.locator('.lub-kpi-card', { hasText: 'Pendientes hoy' }).locator('.lub-kpi-value');

test('Mi Turno consolida principales, filtra localmente, agrupa y mantiene KPI/widget', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.locator('.lub-mt-reg')).toHaveCount(2);
  await expect(kpi(page)).toHaveText('2');
  expect((await page.locator('.lub-section-head:has-text("MI TURNO") + .lub-eq-list .lub-location-group h3').allTextContents()).sort()).toEqual(['Mojón', 'Volcán']);
  await expect(page.getByRole('button', { name: 'Volcán (1)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mojón (1)', exact: true }).click();
  await expect(page.locator('.lub-mt-reg')).toHaveCount(1);
  await expect(page.locator('.lub-eq-btn .lub-eq-code')).toHaveText('MOJON');
  await expect(kpi(page)).toHaveText('2');
  await page.getByRole('button', { name: 'Todas (2)', exact: true }).click();
  await expect(page.locator('.lub-mt-reg')).toHaveCount(2);
  expect(await page.evaluate(() => __widget.locationName)).toBe('Volcán + Mojón');
  expect(await page.evaluate(() => DB.all('equipment').then(rows => rows.map(e => e.locationId).sort()))).toEqual(['acarreo', 'mojon', 'outside', 'volcan']);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  for (const box of await page.locator('.crew-location-filter').all()) expect((await box.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(errors).toEqual([]);
});

test('Matriz alterna tablas por principal y conserva selección local y ambos turnos', async ({ page }) => {
  const errors = await boot(page);
  await page.getByRole('button', { name: 'Matriz semanal', exact: true }).click();
  await expect(page.locator('.matriz-eq.mono')).toHaveText('VOLCAN');
  await expect(page.locator('.lub-mtz-context')).toContainText('Día y Noche');
  await page.locator('.crew-matrix-location[data-location-id="mojon"]').click();
  await expect(page.locator('.matriz-eq.mono')).toHaveText('MOJON');
  await page.locator('#lubmtz-next').click();
  await expect(page.locator('.matriz-eq.mono')).toHaveText('MOJON');
  await page.locator('#modal-close').click();
  await page.getByRole('button', { name: 'Matriz semanal', exact: true }).click();
  await expect(page.locator('.matriz-eq.mono')).toHaveText('MOJON');
  expect(errors).toEqual([]);
});

test('asignación en apoyo se cuenta una vez; sin asignación abre OUT_OF_PLAN', async ({ page }) => {
  const errors = await boot(page, { assignment: true });
  await expect(page.locator('.lub-mt-reg')).toHaveCount(3);
  await expect(kpi(page)).toHaveText('3');
  await page.evaluate(() => startLubricadorGreaseFlow('eq:acarreo'));
  expect(await page.evaluate(() => __flow.options?.outOfPlan || false)).toBe(false);
  await page.evaluate(async () => { const a = await DB.get('lubrication_assignments', 'asg'); await DB.put('lubrication_assignments', { ...a, active: false }); await handleOutOfPlanEquipoSelected('eq:acarreo'); });
  expect(await page.evaluate(() => __flow.options.outOfPlan)).toBe(true);
  expect(await page.evaluate(() => __flow.options.outOfPlanReason)).toBe('SUPPORT_OTHER_LOCATION');
  expect(errors).toEqual([]);
});

test('legacy sin tabla remota conserva una ubicación; cache multiubicación funciona offline', async ({ page, context }) => {
  const errors = await boot(page, { legacy: true });
  await expect(page.locator('.crew-location-filter')).toHaveCount(0);
  await expect(page.locator('.lub-mt-reg')).toHaveCount(1);
  await page.evaluate(async rows => { await DB.putMany('crew_locations', rows); }, coverage);
  await context.setOffline(true);
  await page.evaluate(() => renderLubricadorHome());
  await expect(page.locator('.lub-mt-reg')).toHaveCount(2);
  await page.getByRole('button', { name: 'Mojón (1)', exact: true }).click();
  await expect(page.locator('.lub-mt-reg')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('fresh install espera cobertura durante primer pull antes de decidir el alcance', async ({ page }) => {
  const errors = await boot(page, { legacy: true, firstPull: true });
  await page.evaluate(async rows => { await DB.putMany('crew_locations', [rows[0]]); __setSyncStatus('syncing'); await renderLubricadorHome(); }, coverage);
  await expect(page.getByText('Cargando cobertura de ubicaciones.', { exact: false })).toBeVisible();
  await expect(page.getByText('Sin cuadrilla autorizada', { exact: true })).toHaveCount(0);
  await page.evaluate(async rows => { await DB.putMany('crew_locations', rows); await DB.setConfig({ lastPull: '2026-10-10T10:00:00.000Z' }); __setSyncStatus('ok'); await renderLubricadorHome(); }, coverage);
  await expect(page.locator('.lub-mt-reg')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('editor permite roles y revocación persistente, sin alterar legacy ni equipos', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(async () => { App.currentUser.role = 'PLANIFICADOR'; document.querySelector('#app-content').innerHTML = await cuadrillasPanelHTML(); wireCuadrillasPanel(document.querySelector('#app-content'), () => {}); });
  await page.getByRole('button', { name: 'Cobertura', exact: true }).click();
  await page.locator('.coverage-location[value="mojon"]').uncheck();
  await page.locator('.coverage-role[data-location-id="acarreo"]').selectOption('PRINCIPAL');
  await page.getByRole('button', { name: 'Guardar cobertura', exact: true }).click();
  await expect(page.locator('#crew-coverage-form')).toHaveCount(0);
  const saved = await page.evaluate(async () => ({ rows: await DB.all('crew_locations'), crew: await DB.get('cuadrillas', '76-08') }));
  expect(saved.rows.find(r => r.location_id === 'mojon').active).toBe(false);
  expect(saved.rows.find(r => r.location_id === 'acarreo').role).toBe('PRINCIPAL');
  expect(saved.crew.locationId).toBe('volcan');
  await page.evaluate(async () => { App.currentUser.role = 'SUPERVISOR'; document.querySelector('#app-content').innerHTML = await cuadrillasPanelHTML(); });
  await expect(page.locator('.cq-coverage')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('editor rechaza otra principal de la misma ubicación sin guardar cambios', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(async () => {
    await DB.put('cuadrillas', { id: 'other', name: 'Otra cuadrilla', locationId: 'mojon', active: true, memberUserIds: [] });
    App.currentUser.role = 'PLANIFICADOR';
    document.querySelector('#app-content').innerHTML = await cuadrillasPanelHTML();
    wireCuadrillasPanel(document.querySelector('#app-content'), () => {});
  });
  await page.locator('tr[data-id="other"] .cq-coverage').click();
  await page.getByRole('button', { name: 'Guardar cobertura', exact: true }).click();
  await expect(page.locator('#coverage-error')).toContainText('PRINCIPAL');
  expect(await page.evaluate(async () => (await DB.all('crew_locations')).filter(r => r.crew_id === 'other').length)).toBe(0);
  expect(errors).toEqual([]);
});

test('COMPLETE adelantado en ambas principales no reaparece; PARTIAL y carryover siguen pendientes', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(async () => {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    for (const location of ['volcan', 'mojon']) await DB.put('lubrication_records', {
      id: `early:${location}`, equipmentId: `eq:${location}`, date: yesterday.toISOString(), userName: 'Lubricador',
      operationalSnapshot: { executionCompleteness: 'COMPLETE', executionType: 'PLANNED', crewId: '76-08',
        crewLocationIdAtExecution: 'volcan', executionLocationId: location, satisfiedOccurrenceKey: `plan:${location}:${todayDateISO()}` }, active: true,
    });
    await renderLubricadorHome();
  });
  await expect(page.locator('.lub-adelantado-ver')).toHaveCount(2);
  await expect(page.locator('.lub-mt-reg')).toHaveCount(0);
  await expect(kpi(page)).toHaveText('0');
  await page.evaluate(async () => {
    const early = await DB.get('lubrication_records', 'early:mojon');
    await DB.put('lubrication_records', { ...early, active: false });
    await DB.put('lubrication_records', { id: 'partial:mojon', equipmentId: 'eq:mojon', date: new Date().toISOString(), userName: 'Lubricador', active: true,
      operationalSnapshot: { executionCompleteness: 'PARTIAL', executionType: 'PLANNED', crewId: '76-08', executionLocationId: 'mojon' } });
    await DB.put('lubrication_skips', { id: 'skip:mojon', equipmentId: 'eq:mojon', date: new Date().toISOString(), occurrenceKey: `plan:mojon:${todayDateISO()}`,
      shiftId: currentShiftId() === 'shift_dia' ? 'shift_noche' : 'shift_dia', reason: 'SIN_TIEMPO', userName: 'Lubricador', active: true });
    await renderLubricadorHome();
  });
  await expect(page.locator('.lub-adelantado-ver')).toHaveCount(1);
  await expect(page.locator('.lub-arr-reg, .lub-mt-reg')).toHaveCount(1);
  await expect(page.locator('.lub-real-ver')).toHaveCount(0);
  expect(errors).toEqual([]);
});
