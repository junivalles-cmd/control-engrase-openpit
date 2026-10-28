import { LUBRICATION_FOLLOW_UP_APP_NAMES } from '../helpers/lubricationFollowUpFixture.js';
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
    'colorLegendHTML', 'validationBadgeHTML', 'computeAllStatuses', 'getSelectedCrewId', 'setSelectedCrewId', 'getCurrentOperationalScope',
    'loadAssignmentContext', 'equipoOccurrenceKey', 'crewCoveragePresentation', ...LUBRICATION_FOLLOW_UP_APP_NAMES, 'renderLubricadorHome', 'openModal', 'closeModal', 'wireMatrixOccurrenceDetails', 'wireMatrizScrollHint',
    'openLubricadorMatrizModal', 'handleOutOfPlanEquipoSelected', 'startLubricadorGreaseFlow', 'cuadrillasPanelHTML', 'wireCuadrillasPanel']),
].join('\n');
const crew = { id: '76-08', name: '76-08 Camión Lubrico', locationId: 'volcan', isDefault: true, memberUserIds: ['lub'], active: true };
const locations = [{ id: 'volcan', name: 'Volcán' }, { id: 'mojon', name: 'Mojón' }, { id: 'acarreo', name: 'Acarreo' }, { id: 'outside', name: 'Otra' }];
const coverage = locations.slice(0, 3).map(l => ({ id: `cl:${l.id}`, crew_id: crew.id, location_id: l.id, role: l.id === 'acarreo' ? 'APOYO' : 'PRINCIPAL', active: true, updatedAt: '2026-10-10T10:00:00.000Z' }));

async function boot(page, { legacy = false, assignment = false, firstPull = false,
  fixtureCrew = crew, fixtureLocations = locations, fixtureCoverage = coverage,
  equipmentRows = null, assignmentRows = null } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Dedicated local origin: no app boot, authentication or remote requests.
  await page.route('**/__crew_fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="app-content"></main></body></html>' }));
  await page.goto('/__crew_fixture');
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
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
    window.Sync = {
      fullSync: async () => ({ ok: true }),
      // Explicit account-readiness fixture; real cursor identity is unit-tested.
      getAccountSyncState: async () => ({bootstrapComplete:typeof window.__bootstrapOverride==='boolean'
        ? window.__bootstrapOverride : !!(await DB.getConfig())?.lastPull})
    };
    window.logAudit = async () => {}; window.showInAppToast = () => {};
    window.Auth = { manageUsers: async () => ({ users: [] }) };
    ${source}
    window.DB = DB;
    // UX CAMPO V2 (2026-10-24): los 3 acordeones de Mi Turno nacen
    // colapsados — se expanden automáticamente tras cada render
    // (idempotente) para no romper la cobertura de cobertura/scope de
    // este archivo, ajena a la interacción propia del acordeón.
    renderLubricadorHome = (() => {
      const real = renderLubricadorHome;
      return async (...args) => {
        const result = await real(...args);
        document.querySelectorAll('.lub-accordion-panel').forEach(p => { p.hidden = false; });
        document.querySelectorAll('.lub-accordion-head').forEach(b => b.setAttribute('aria-expanded', 'true'));
        return result;
      };
    })();
    window.renderLubricadorHome = renderLubricadorHome;
    window.getCurrentOperationalScope = getCurrentOperationalScope;
    window.handleOutOfPlanEquipoSelected = handleOutOfPlanEquipoSelected;
    window.startLubricadorGreaseFlow = startLubricadorGreaseFlow;
    window.openLubricadorMatrizModal = openLubricadorMatrizModal;
    window.openDB = openDB; window.cuadrillasPanelHTML = cuadrillasPanelHTML;
    window.wireCuadrillasPanel = wireCuadrillasPanel;
    window.__setSyncStatus = status => { lastSyncState.status = status; };
  ` });
  await page.evaluate(async ({ crew, locations, coverage, legacy, assignment, firstPull, equipmentRows, assignmentRows }) => {
    await openDB();
    await DB.setConfig(firstPull ? {} : { lastPull: '2026-10-10T10:00:00.000Z' });
    await DB.put('cuadrillas', crew);
    for (const l of locations) await DB.put('locations', l);
    if (!legacy) await DB.putMany('crew_locations', coverage);
    const day = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][new Date().getDay()];
    const equipment = equipmentRows || locations.map(l => ({ id: `eq:${l.id}`, code: l.id.toUpperCase(), locationId: l.id }));
    for (const e of equipment) {
      await DB.put('equipment', { brand: 'CAT', model: 'D8', status: 'Operativo', hourmeter: 100, active: true, ...e });
      await DB.put('lubrication_plans', { id: `plan:${equipmentRows ? e.id : e.locationId}`, equipmentId: e.id, controlType: 'Día y turno de la semana', assignedDays: [day], active: true });
    }
    for (const a of assignmentRows || []) await DB.put('lubrication_assignments', {
      active: true, status: 'PENDING', assignedCrewId: crew.id,
      occurrenceKey: `plan:${a.equipmentId}:${todayDateISO()}`, ...a,
    });
    if (assignment) await DB.put('lubrication_assignments', { id: 'asg', equipmentId: 'eq:acarreo', occurrenceKey: `plan:acarreo:${todayDateISO()}`, assignedCrewId: crew.id, status: 'PENDING', active: true });
    await renderLubricadorHome();
  }, { crew: fixtureCrew, locations: fixtureLocations, coverage: fixtureCoverage, legacy, assignment, firstPull, equipmentRows, assignmentRows });
  return errors;
}
// UX CAMPO V2 (2026-10-24): la fila de 4 .lub-kpi-card se retiró —
// "Vencidos por horas"/"Pendientes hoy"/"Pendientes del turno anterior"
// ahora son el contador propio (.lub-accordion-count) de su acordeón;
// "Realizados hoy" sigue siendo el único contador fuera de los 3
// acordeones (span dedicado dentro del status-chip "REALIZADOS (N)").
const kpi = page => page.locator('#lub-acc-mi-turno-btn .lub-accordion-count');
function kpiByLabel(page, label) {
  const map = {
    'Vencidos por horas': '#lub-acc-atencion-prioritaria-btn .lub-accordion-count',
    'Pendientes hoy': '#lub-acc-mi-turno-btn .lub-accordion-count',
    'Pendientes del turno anterior': '#lub-acc-pendientes-anteriores-btn .lub-accordion-count',
    'Realizados hoy': '.lub-realizados-count',
  };
  if (!map[label]) throw new Error(`kpiByLabel(): etiqueta desconocida "${label}"`);
  return page.locator(map[label]);
}

for (const supportIds of [[], ['mojon'], ['mojon', 'acarreo']]) {
  test(`cobertura independiente del trabajo normal: PRINCIPAL Volcán + APOYO ${supportIds.join(',') || 'ninguno'}`, async ({ page }) => {
    const fixtureCoverage = ['volcan', ...supportIds].map(id => ({
      id: `coverage:${id}`, crew_id: crew.id, location_id: id,
      role: id === 'volcan' ? 'PRINCIPAL' : 'APOYO', active: true,
    }));
    // Legacy apunta deliberadamente a una ubicación ajena a la cobertura.
    const errors = await boot(page, { fixtureCrew: { ...crew, locationId: 'outside' }, fixtureCoverage });
    const state = await page.evaluate(async () => ({ scope: await getCurrentOperationalScope(), render: JSON.parse(App._lubTurnoSignature) }));
    expect(state.scope.principalLocationIds).toEqual(['volcan']);
    expect([...state.scope.supportLocationIds].sort()).toEqual([...supportIds].sort());
    expect(state.scope.legacyFallback).toBe(false);
    expect([...state.render.filterLocations].sort()).toEqual(['volcan', ...supportIds].sort());
    expect(state.render.filterLocations[0]).toBe('volcan');
    await expect(page.locator('.lub-eq-btn .lub-eq-code')).toHaveText('VOLCAN');
    await expect(kpi(page)).toHaveText('1');
    await expect(page.locator('.crew-location-filter')).toHaveCount(supportIds.length ? supportIds.length + 2 : 0);
    const followUp = page.locator('#lub-follow-up .lub-follow-up-row');
    await expect(followUp).toHaveCount(supportIds.length + 1);
    const ids = await followUp.evaluateAll(rows => rows.map(r => r.dataset.equipmentId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(['volcan', ...supportIds].map(id => `eq:${id}`).sort());
    for (const id of supportIds) {
      await page.locator(`.crew-location-filter[data-location-id="${id}"]`).click();
      await expect(kpi(page)).toHaveText('0');
      await expect(page.locator('.lub-mt-reg, .lub-arr-reg')).toHaveCount(0);
      await expect(page.locator('#lub-follow-up .lub-eq-code')).toHaveText(id.toUpperCase());
    }
    if (supportIds.length) await page.locator('.crew-location-filter[data-location-id=""]').click();
    await expect(page.locator('.lub-mt-reg')).toHaveCount(1);
    expect(await page.evaluate(async () => (await DB.all('equipment')).map(e => [e.id, e.locationId]).sort()))
      .toEqual(locations.map(l => [`eq:${l.id}`, l.id]).sort());
    expect(errors).toEqual([]);
  });
}

test('APOYO sin equipos o con seguimiento ya excluido sigue visible como filtro', async ({ page }) => {
  const fixtureCoverage = ['volcan', 'mojon', 'acarreo'].map(id => ({
    id, crew_id: crew.id, location_id: id, role: id === 'volcan' ? 'PRINCIPAL' : 'APOYO', active: true,
  }));
  const errors = await boot(page, { fixtureCoverage, equipmentRows: [
    {id:'V',code:'V',locationId:'volcan'}, {id:'M',code:'M',locationId:'mojon'},
  ] });
  await page.evaluate(async () => {
    await DB.put('lubrication_records', { id:'today:M',equipmentId:'M',active:true,date:new Date().toISOString(),
      operationalSnapshot:{executionCompleteness:'COMPLETE',crewId:'another-crew'} });
    await renderLubricadorHome();
  });
  expect(await page.evaluate(() => JSON.parse(App._lubTurnoSignature).filterLocations.sort())).toEqual(['acarreo','mojon','volcan']);
  for (const id of ['mojon','acarreo']) {
    await page.locator(`.crew-location-filter[data-location-id="${id}"]`).click();
    await expect(page.locator('#lub-follow-up .lub-follow-up-row')).toHaveCount(0);
    await expect(page.locator('.lub-mt-reg')).toHaveCount(0);
    await expect(kpi(page)).toHaveText('0');
  }
  expect(errors).toEqual([]);
});

for (const inactive of [false, true]) test(`fallback legacy únicamente sin filas propias (inactivas=${inactive})`, async ({ page }) => {
  const fixtureCoverage = inactive ? coverage.map(r => ({...r,active:false})) : [];
  const errors = await boot(page, { fixtureCoverage });
  const state = await page.evaluate(async () => ({ scope:await getCurrentOperationalScope(), render:JSON.parse(App._lubTurnoSignature) }));
  expect(state.scope.legacyFallback).toBe(!inactive);
  expect(state.render.filterLocations).toEqual(inactive ? [] : ['volcan']);
  await expect(page.locator('.crew-location-filter')).toHaveCount(0);
  await expect(page.locator('.lub-mt-reg')).toHaveCount(inactive ? 0 : 1);
  await expect(page.locator('#lub-follow-up .lub-follow-up-row')).toHaveCount(inactive ? 0 : 1);
  expect(errors).toEqual([]);
});

test('assignment manual con grant cross-location fuera de cobertura conserva una única obligación', async ({ page }) => {
  const fixtureCoverage = [{id:'principal',crew_id:crew.id,location_id:'volcan',role:'PRINCIPAL',active:true}];
  const errors = await boot(page, { fixtureCoverage, equipmentRows: [
    {id:'V',code:'V',locationId:'volcan'}, {id:'X',code:'X',locationId:'outside'},
  ], assignmentRows:[{id:'cross',equipmentId:'X',planId:'plan:X',_supportOperational:true}] });
  await expect(kpi(page)).toHaveText('2');
  await expect(page.locator('.lub-mt-reg[data-id="X"]')).toHaveCount(1);
  await expect(page.locator('.lub-eq-btn', {hasText:'X'}).getByText('ASIGNADO', {exact:true})).toHaveCount(1);
  await expect(page.locator('#lub-follow-up .lub-follow-up-row[data-equipment-id="X"]')).toHaveCount(0);
  await page.evaluate(() => renderLubricadorHome());
  await expect(page.locator('.lub-mt-reg')).toHaveCount(2);
  expect(await page.evaluate(async () => (await DB.all('lubrication_assignments')).map(a=>[a.id,a.status,a.equipmentId]))).toEqual([['cross','PENDING','X']]);
  expect(errors).toEqual([]);
});

// Controlled C1/E1/E2/E3 scenarios. No real IDs/cache from 80-177 are inferred.
const scenarioLocations = [
  { id: 'fixture-troja', name: 'Troja' },
  { id: 'fixture-volcan', name: 'Volcán' },
  { id: 'fixture-mojon', name: 'Mojón' },
];
const scenarioCrew = { id: 'C1', name: 'Cuadrilla ficticia C1', locationId: 'fixture-troja', isDefault: true, memberUserIds: ['lub'], active: true };
const scenarioEquipment = [
  { id: 'E1', code: 'E1', locationId: 'fixture-volcan' },
  { id: 'E2', code: 'E2', locationId: 'fixture-mojon' },
  { id: 'E3', code: 'E3', locationId: 'fixture-troja' },
];
const scenarioCoverage = scenarioLocations.map(l => ({ id: `fixture:${l.id}`, crew_id: 'C1', location_id: l.id, role: l.id === 'fixture-mojon' ? 'APOYO' : 'PRINCIPAL', active: true }));
const scenarioOptions = { fixtureCrew: scenarioCrew, fixtureLocations: scenarioLocations, fixtureCoverage: scenarioCoverage, equipmentRows: scenarioEquipment };

for (const legacy of [false, true]) test(`Scenario A: solo Troja muestra E3; assignments externos intactos (legacy=${legacy})`, async ({ page }) => {
  const errors = await boot(page, { ...scenarioOptions, legacy,
    fixtureCoverage: [scenarioCoverage[0]], assignmentRows: scenarioEquipment.map(e => ({ id: `asg:${e.id}`, equipmentId: e.id })),
  });
  await expect(page.locator('.lub-eq-btn .lub-eq-code')).toHaveText('E3');
  await expect(kpi(page)).toHaveText('1');
  await expect(page.locator('.crew-location-filter')).toHaveCount(0);
  const saved = await page.evaluate(async () => ({ equipment: await DB.all('equipment'), assignments: await DB.all('lubrication_assignments') }));
  expect(saved.assignments).toHaveLength(3);
  expect(saved.assignments.every(a => a.status === 'PENDING' && a.active)).toBe(true);
  expect(saved.equipment.map(e => [e.id, e.locationId]).sort()).toEqual(scenarioEquipment.map(e => [e.id, e.locationId]).sort());
  expect(errors).toEqual([]);
});

test('Scenario B: principales reciben planes, APOYO solo assignment y no genera Matrix tab', async ({ page }) => {
  const errors = await boot(page, scenarioOptions);
  await expect(page.locator('.lub-eq-btn .lub-eq-code')).toHaveText(['E1', 'E3']);
  await expect(kpi(page)).toHaveText('2');
  await expect(page.locator('.crew-location-filter[data-location-id="fixture-mojon"]')).toHaveCount(1); // APOYO is visible for informational follow-up, without normal programming
  await page.evaluate(async () => {
    await DB.put('lubrication_assignments', { id: 'asg:E2', equipmentId: 'E2', assignedCrewId: 'C1', occurrenceKey: `plan:E2:${todayDateISO()}`, status: 'PENDING', active: true });
    await renderLubricadorHome();
  });
  await expect(page.locator('.lub-mt-reg')).toHaveCount(3);
  await expect(page.locator('.lub-eq-btn', { hasText: 'E2' }).locator('.chip-origen')).toHaveText('ASIGNADO');
  await page.locator('.crew-location-filter[data-location-id="fixture-mojon"]').click();
  await expect(kpi(page)).toHaveText('1');
  await expect(page.locator('.lub-eq-btn .lub-eq-code')).toHaveText('E2');
  await page.getByRole('button', { name: 'Matriz semanal', exact: true }).click();
  await expect(page.locator('.crew-matrix-location')).toHaveCount(2);
  await expect(page.locator('.crew-matrix-location[data-location-id="fixture-mojon"]')).toHaveCount(0);
  await expect(page.locator('.matriz-eq.mono')).toHaveText('E3');
  await page.locator('.crew-matrix-location[data-location-id="fixture-volcan"]').click();
  await expect(page.locator('.matriz-eq.mono')).toHaveText('E1');
  expect(errors).toEqual([]);
});

test('Scenario C: Todas 3, Volcán 2, Mojón 1 coinciden en KPI, tarjetas y encabezados', async ({ page }) => {
  const equipmentRows = [
    { id: 'V1', code: 'V1', locationId: 'volcan' },
    { id: 'V2', code: 'V2', locationId: 'volcan' },
    { id: 'M1', code: 'M1', locationId: 'mojon' },
  ];
  const errors = await boot(page, { equipmentRows });
  for (const [location, count] of [['', 3], ['volcan', 2], ['mojon', 1], ['', 3]]) {
    await page.locator(`.crew-location-filter[data-location-id="${location}"]`).click();
    await expect(kpi(page)).toHaveText(String(count));
    await expect(page.locator('.lub-mt-reg')).toHaveCount(count);
    await expect(kpi(page)).toHaveText(String(count));
  }
  expect(errors).toEqual([]);
});

test('los cuatro KPI y secciones usan filas del filtro, conservando clasificación y deduplicación', async ({ page }) => {
  const equipmentRows = [
    ...['V1', 'V2'].map(id => ({ id, code: id, locationId: 'volcan' })),
    { id: 'M1', code: 'M1', locationId: 'mojon' },
    ...['hours', 'late', 'done'].flatMap(kind => ['volcan', 'mojon'].map(locationId => ({ id: `${kind}:${locationId}`, code: `${kind}:${locationId}`, locationId }))),
  ];
  const errors = await boot(page, { equipmentRows });
  await page.evaluate(async () => {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const day = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][yesterday.getDay()];
    for (const location of ['volcan', 'mojon']) {
      const equipment = await DB.get('equipment', `hours:${location}`);
      await DB.put('equipment', { ...equipment, hourmeter: 200 });
      await DB.put('lubrication_plans', { id: `plan:hours:${location}`, equipmentId: equipment.id, controlType: 'Horas de operación', frequency: 100, lastGreaseHour: 0, active: true });
      const plan = await DB.get('lubrication_plans', `plan:late:${location}`);
      await DB.put('lubrication_plans', { ...plan, assignedDays: [day] });
      await DB.put('lubrication_records', { id: `complete:${location}`, equipmentId: `done:${location}`, date: new Date().toISOString(), userName: 'Fixture', active: true,
        operationalSnapshot: { executionCompleteness: 'COMPLETE', crewId: '76-08', executionLocationId: location } });
    }
    await renderLubricadorHome();
  });
  const labels = ['Vencidos por horas', 'Pendientes hoy', 'Pendientes del turno anterior', 'Realizados hoy'];
  for (const [location, counts] of [['', [2, 3, 2, 2]], ['volcan', [1, 2, 1, 1]], ['mojon', [1, 1, 1, 1]]]) {
    await page.locator(`.crew-location-filter[data-location-id="${location}"]`).click();
    for (const [i, label] of labels.entries()) await expect(kpiByLabel(page, label)).toHaveText(String(counts[i]));
    await expect(page.locator('.lub-mt-reg')).toHaveCount(counts[1]);
    await expect(page.locator('.lub-arr-reg')).toHaveCount(counts[2]);
    await expect(page.locator('.lub-real-ver')).toHaveCount(counts[3]);
  }
  expect(errors).toEqual([]);
});

test('Mi Turno consolida principales, filtra listas y KPI por ubicación y mantiene widget consolidado', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.locator('.lub-mt-reg')).toHaveCount(2);
  await expect(kpi(page)).toHaveText('2');
  expect((await page.locator('#lub-acc-mi-turno-panel .lub-location-group h3').allTextContents()).sort()).toEqual(['Mojón', 'Volcán']);
  await expect(page.getByRole('button', { name: 'Volcán (1)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mojón (1)', exact: true }).click();
  await expect(page.locator('.lub-mt-reg')).toHaveCount(1);
  await expect(page.locator('.lub-eq-btn .lub-eq-code')).toHaveText('MOJON');
  await expect(kpi(page)).toHaveText('1');
  await page.getByRole('button', { name: 'Volcán (1)', exact: true }).click();
  await expect(page.locator('.lub-eq-btn .lub-eq-code')).toHaveText('VOLCAN');
  await expect(kpi(page)).toHaveText('1');
  await page.getByRole('button', { name: 'Todas (2)', exact: true }).click();
  await expect(page.locator('.lub-mt-reg')).toHaveCount(2);
  await expect(kpi(page)).toHaveText('2');
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
  await expect.poll(() => page.evaluate(() => __flow?.options?.outOfPlan)).toBe(true);
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
  // Fix 2026-10-17 ("RACE BOOTSTRAP/SCOPE"): el gate de bootstrap ya NUNCA
  // depende de scope.kind/lastSyncState.status — es el ÚNICO chequeo de
  // `Sync.getAccountSyncState()` de toda la función, antes de calcular
  // ningún scope. El mensaje mientras bootstrapComplete es false es ahora
  // siempre el mismo (Estado A, "Cargando tu asignación de trabajo.") —
  // antes había un segundo mensaje aparte ("Cargando cobertura de
  // ubicaciones.") que dependía de scope.kind==='CREW_SCOPED' ya resuelto,
  // exactamente el tipo de combinación que causaba el bug real (una
  // instalación nueva con 2+ cuadrillas podía no mostrar NUNCA el selector).
  const errors = await boot(page, { legacy: true, firstPull: true });
  await page.evaluate(async rows => { await DB.putMany('crew_locations', [rows[0]]); __setSyncStatus('syncing'); await renderLubricadorHome(); }, coverage);
  await expect(page.getByText('Cargando tu asignación de trabajo.', { exact: false })).toBeVisible();
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

// Simplificar Configuración > Organización (auditoría 2026-10-18) —
// ROOT CAUSE DUPLICACIÓN: "Editar cuadrilla" y "Cobertura" administraban
// las MISMAS ubicaciones/PRINCIPAL-APOYO desde dos pantallas distintas
// (locationId/isDefault legacy vs. crew_locations). Modelo definitivo:
// "Editar cuadrilla" administra SOLO nombre + miembros; "Cobertura" es la
// ÚNICA fuente visual para ubicación(es)/rol. Los campos legacy se
// conservan en el documento (nunca se borran del modelo/migraciones),
// solo dejan de EDITARSE desde esta ventana.
test('"Editar cuadrilla" ya no muestra Ubicación ni "Cuadrilla principal de esta ubicación" — solo nombre y miembros', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(async () => { App.currentUser.role = 'PLANIFICADOR'; document.querySelector('#app-content').innerHTML = await cuadrillasPanelHTML(); wireCuadrillasPanel(document.querySelector('#app-content'), () => {}); });
  await page.locator('.cq-edit').click();
  await expect(page.locator('#cq-form')).toHaveCount(1);
  await expect(page.locator('#cq-form [name="name"]')).toHaveCount(1);
  await expect(page.locator('#cq-form [name="locationId"]')).toHaveCount(0);
  await expect(page.locator('#cq-form [name="isDefault"]')).toHaveCount(0);
  await expect(page.getByText('Cuadrilla principal de esta ubicación')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Guardar en "Editar cuadrilla" cambia solo el nombre — locationId/isDefault legacy quedan intactos (Cobertura sigue siendo la única fuente para eso)', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(async () => { App.currentUser.role = 'PLANIFICADOR'; document.querySelector('#app-content').innerHTML = await cuadrillasPanelHTML(); wireCuadrillasPanel(document.querySelector('#app-content'), () => {}); });
  await page.locator('.cq-edit').click();
  await page.locator('#cq-form [name="name"]').fill('76-08 Camión Lubrico (renombrado)');
  await page.locator('#cq-form button[type="submit"]').click();
  await expect(page.locator('#cq-form')).toHaveCount(0);
  const saved = await page.evaluate(async () => DB.get('cuadrillas', '76-08'));
  expect(saved.name).toBe('76-08 Camión Lubrico (renombrado)');
  expect(saved.locationId).toBe('volcan');
  expect(saved.isDefault).toBe(true);
  // La cobertura real (crew_locations) tampoco se tocó al guardar desde "Editar".
  const rows = await page.evaluate(async () => (await DB.all('crew_locations')).filter(r => r.crew_id === '76-08' && r.active !== false));
  expect(rows.map(r => r.location_id).sort()).toEqual(['acarreo', 'mojon', 'volcan']);
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
  // .lub-real-ver se comparte con validaciones de registros anteriores.
  // El COMPLETE de Volcán sigue pendiente de firma; PARTIAL de Mojón no
  // entra en Realizados hoy ni en ese seguimiento de validación anterior.
  await expect(page.locator('.lub-real-ver:not(#lub-pending-validations .lub-real-ver)')).toHaveCount(0);
  await expect(page.locator('#lub-pending-validations .lub-real-ver')).toHaveCount(1);
  await expect(page.locator('#lub-pending-validations')).toContainText('VOLCAN');
  await expect(page.locator('#lub-pending-validations')).not.toContainText('MOJON');
  // "Realizados hoy" en 0 oculta su sección por completo (sin cambios,
  // no es uno de los 3 acordeones) — el contador literalmente no existe.
  await expect(page.locator('.lub-realizados-count')).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const count of [1, 2, 3, 5]) {
  test('UX header coverage ' + count + ' locations, including support and long names', async ({ page }, testInfo) => {
    const locs = Array.from({ length: count }, (_, i) => ({ id: 'fixture-ux-' + i, name: count >= 5 ? 'Ubicación operacional ficticia con nombre muy largo ' + i : 'Zona ' + i }));
    const cq = { ...crew, locationId: locs[0].id };
    const rows = locs.map((l, i) => ({ id: 'coverage-' + i, crew_id: cq.id, location_id: l.id, role: i ? 'APOYO' : 'PRINCIPAL', active: true }));
    expect(await boot(page, { fixtureCrew: cq, fixtureLocations: locs, fixtureCoverage: rows })).toEqual([]);
    const chip = page.locator('.lub-coverage-chip');
    await expect(chip).toContainText(count >= 3 ? count + ' ubicaciones' : locs.map(l => l.name).join(' + '));
    await expect(chip).toHaveAttribute('title', locs.map(l => l.name).join(' + '));
    await expect(chip).toHaveAttribute('aria-label', 'Cobertura: ' + locs.map(l => l.name).join(' + '));
    await expect(page.locator('.lub-turno-header')).not.toContainText('APOYO');
    await expect(page.locator('#lub-change-crew')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (count === 5) await page.screenshot({ path: testInfo.outputPath('header-long-coverage.png'), fullPage: true });
  });
}
test('UX change crew belongs to welcome context and invokes existing selection flow', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    await DB.put('cuadrillas', { id: 'fixture-second', name: 'Segunda cuadrilla ficticia', locationId: 'volcan', memberUserIds: ['lub'], active: true });
    setSelectedCrewId('lub', '76-08');
    await renderLubricadorHome();
  });
  const btn = page.locator('.lub-turno-header button#lub-change-crew');
  await expect(btn).toBeVisible();
  await expect(btn).not.toHaveClass(/link-btn/);
  expect((await btn.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await btn.click();
  expect(await page.evaluate(() => getSelectedCrewId('lub'))).toBe('');
  await expect(page.locator('#lub-change-crew')).toHaveCount(0);
});

test('account bootstrap UI ignores legacy cursor and selects three crews after hydration', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    window.__bootstrapOverride=false;
    for(const id of ['fixture-c2','fixture-c3']) await DB.put('cuadrillas',{id,name:id,locationId:'volcan',memberUserIds:['lub'],active:true});
    await renderLubricadorHome();
  });
  await expect(page.getByText('Sin cuadrilla autorizada',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Sincronizando datos…',{exact:true})).toBeVisible();
  await page.evaluate(async()=>{window.__bootstrapOverride=true;await renderLubricadorHome();});
  await expect(page.locator('.crew-select-btn')).toHaveCount(3);
  await expect(page.getByText('Sin cuadrilla autorizada',{exact:true})).toHaveCount(0);
});
