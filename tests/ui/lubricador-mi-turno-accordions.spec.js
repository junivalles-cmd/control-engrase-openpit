// tests/ui/lubricador-mi-turno-accordions.spec.js
//
// UX CAMPO V2 (2026-10-24) — Parte Z del pedido: cobertura dedicada de la
// interacción propia de los 3 acordeones de Mi Turno (Pendientes
// anteriores/Atención prioritaria/Engrases de mi turno). La cobertura de
// CLASIFICACIÓN (qué equipo cae en qué sección) ya vive en
// tests/ui/lubricador-mi-turno-real-execution.spec.js (ese archivo expande
// los 3 acordeones automáticamente tras cada render para no mezclar
// ambas cosas) — este archivo NUNCA expande nada por fuera del click real
// del usuario, justo para probar que nacen colapsados.
//
// Carga renderLubricadorHome() REAL (mismo patrón que
// lubricador-mi-turno-real-execution.spec.js) con DB/Sync reemplazados por
// un store en memoria.

import { LUBRICATION_FOLLOW_UP_APP_NAMES } from '../helpers/lubricationFollowUpFixture.js';
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
  'parseOccurrenceKeyDate', 'toISODateUTCLocal',
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
  'colorLegendHTML', 'validationBadgeHTML', 'computeAllStatuses', 'getSelectedCrewId', 'setSelectedCrewId',
  'getCurrentOperationalScope', 'loadAssignmentContext', 'equipoOccurrenceKey', 'crewCoveragePresentation', ...LUBRICATION_FOLLOW_UP_APP_NAMES, 'renderLubricadorHome',
  'updateLubricadorConnectivitySummary', // BUG-001 (2026-10-25)
];
const appSrc = appNames.map(n => extractDeclaration(appSource, n)).join('\n\n');

const LOCATIONS = [{ id: 'l1', name: 'Rajo Principal' }, { id: 'l2', name: 'Rajo Sur' }];
const CREW = [{ id: 'crew1', name: 'Cuadrilla A', active: true, locationId: 'l1', isDefault: true, memberUserIds: ['lub1'] }];
const CREW2 = { id: 'crew2', name: 'Cuadrilla B', active: true, locationId: 'l2', isDefault: false, memberUserIds: ['lub1'] };
const ASSIGNMENT_COVERAGE = [
  { id: 'cl:crew1:l1', crew_id: 'crew1', location_id: 'l1', role: 'PRINCIPAL', active: true },
];

function weekdayName(d) { return ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][d.getDay()]; }

// bootPage() — a propósito NUNCA expande ningún acordeón (a diferencia del
// fixture compartido de lubricador-mi-turno-real-execution.spec.js): esta
// suite prueba justo que nacen colapsados y que el click real los abre.
async function bootPage(page, { equipos = [], plans = [], records = [], skips = [], assignments = [], validations = [], crewLocations = ASSIGNMENT_COVERAGE, crews = CREW, selectedCrewId = 'crew1' } = {}) {
  await page.route('**/*', (route) => {
    if (route.request().resourceType() === 'document') {
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    } else { route.continue(); }
  });
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto('/');
  await page.setContent('<div class="lub-shell"><div id="app-content" class="lub-content"></div></div>');
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.App = {
        route: 'turno', currentUser: { id: 'lub1', name: 'Lubricador de prueba', role: 'LUBRICADOR' },
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18, complianceTarget: 85 },
      };
      try { localStorage.setItem('engrase_session_crew', JSON.stringify({ userId: 'lub1', crewId: ${JSON.stringify(selectedCrewId)} })); } catch (e) {}
      let lastSyncState = { status: 'ok' };
      window.Sync = { getAccountSyncState: async () => ({ bootstrapComplete: true }), fullSync: async () => {}, syncing: false, pendingCount: async () => 0 };
      window.navigate = () => {};
      window.openModal = () => {}; window.closeModal = () => {};
      window.openAnomalyForm = () => {}; window.openQrScanner = () => {};
      window.openOutOfPlanEquipmentPicker = () => {}; window.openLubricadorMatrizModal = () => {};
      window.openEquipmentDetail = () => {}; window.startLubricadorGreaseFlow = () => {};
      window.openValidationDetailModal = () => {}; window.refreshPushTokenCrewScope = async () => {};
      window.updateLubricadorWidgetSnapshot = () => {};
      window.__mockData = {
        equipment: ${JSON.stringify(equipos)},
        locations: ${JSON.stringify(LOCATIONS)},
        cuadrillas: ${JSON.stringify(crews)},
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
      window.setSelectedCrewId = setSelectedCrewId;
      window.lastSyncState = lastSyncState;
      // BUG-001 (2026-10-25): mismo wiring real de boot() (app.js) — SOLO
      // las 2 líneas nuevas, nunca updateConnBadge() (no aplica, este
      // fixture no monta #conn-badge, fuera de alcance de este bug).
      window.updateLubricadorConnectivitySummary = updateLubricadorConnectivitySummary;
      window.addEventListener('online', updateLubricadorConnectivitySummary);
      window.addEventListener('offline', updateLubricadorConnectivitySummary);
    `,
  });
}

const ACCS = ['pendientes-anteriores', 'atencion-prioritaria', 'mi-turno'];
const btn = (page, key) => page.locator(`#lub-acc-${key}-btn`);
const panel = (page, key) => page.locator(`#lub-acc-${key}-panel`);

test('los 3 acordeones nacen SIEMPRE colapsados en una navegación real (aria-expanded=false, panel con [hidden])', async ({ page }) => {
  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'T-01', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  await bootPage(page, { equipos, plans });
  await page.evaluate(() => window.renderLubricadorHome());

  for (const key of ACCS) {
    await expect(btn(page, key)).toHaveAttribute('aria-expanded', 'false');
    await expect(panel(page, key)).toBeHidden();
  }
});

test('clic en el encabezado expande el acordeón real (aria-expanded, [hidden] y chevron), un segundo clic lo contrae', async ({ page }) => {
  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'T-01', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  await bootPage(page, { equipos, plans });
  await page.evaluate(() => window.renderLubricadorHome());

  const b = btn(page, 'mi-turno'), p = panel(page, 'mi-turno');
  await b.click();
  await expect(b).toHaveAttribute('aria-expanded', 'true');
  await expect(p).toBeVisible();
  await expect(p.locator('.lub-eq-btn .lub-eq-code')).toHaveText('T-01');
  await b.click();
  await expect(b).toHaveAttribute('aria-expanded', 'false');
  await expect(p).toBeHidden();
});

test('expandir un acordeón no afecta el estado de los otros dos (independientes entre sí)', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => window.renderLubricadorHome());
  await btn(page, 'mi-turno').click();
  await expect(btn(page, 'mi-turno')).toHaveAttribute('aria-expanded', 'true');
  await expect(btn(page, 'pendientes-anteriores')).toHaveAttribute('aria-expanded', 'false');
  await expect(btn(page, 'atencion-prioritaria')).toHaveAttribute('aria-expanded', 'false');
});

test('accesibilidad real: cada acordeón es un <button>, con aria-controls apuntando a su panel y aria-label con el conteo ("Pendientes anteriores, N trabajos")', async ({ page }) => {
  const hoyWeekday = weekdayName(new Date());
  const skip = { id: 's1', equipmentId: 'e1', date: new Date().toISOString(), createdAt: new Date().toISOString(), shiftId: await page.evaluate(() => new Date().getHours() >= 18 ? 'shift_noche' : 'shift_dia'), reason: 'SIN_TIEMPO', active: true };
  const equipos = [{ id: 'e1', code: 'T-02', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [weekdayName(new Date(Date.now() - 86400000))] }];
  await bootPage(page, { equipos, plans, skips: [skip] });
  await page.evaluate(() => window.renderLubricadorHome());

  for (const key of ACCS) {
    expect(await btn(page, key).evaluate(el => el.tagName)).toBe('BUTTON');
    await expect(btn(page, key)).toHaveAttribute('aria-controls', `lub-acc-${key}-panel`);
  }
  await expect(btn(page, 'pendientes-anteriores')).toHaveAttribute('aria-label', /Pendientes anteriores, 1 trabajo/);
  await expect(btn(page, 'atencion-prioritaria')).toHaveAttribute('aria-label', /Atención prioritaria, 0 trabajos/);
});

test('contadores (.lub-accordion-count) reflejan exactamente el número de tarjetas reales dentro de cada acordeón', async ({ page }) => {
  const hoyWeekday = weekdayName(new Date());
  const equipos = [
    { id: 'e1', code: 'T-03', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' },
    { id: 'e2', code: 'T-04', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' },
  ];
  const plans = [
    { id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] },
    { id: 'p2', equipmentId: 'e2', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] },
  ];
  await bootPage(page, { equipos, plans });
  await page.evaluate(() => window.renderLubricadorHome());

  await expect(page.locator('#lub-acc-mi-turno-btn .lub-accordion-count')).toHaveText('2');
  await btn(page, 'mi-turno').click();
  await expect(panel(page, 'mi-turno').locator('.lub-eq-btn')).toHaveCount(2);
});

test('estados vacíos: cuando un acordeón tiene 0, su panel muestra el texto vacío real, nunca una tarjeta en 0', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => window.renderLubricadorHome());
  for (const key of ACCS) await btn(page, key).click();

  await expect(panel(page, 'pendientes-anteriores')).toContainText('No hay pendientes de turnos anteriores.');
  await expect(panel(page, 'atencion-prioritaria')).toContainText('No hay equipos que requieran atención prioritaria.');
  await expect(panel(page, 'mi-turno')).toContainText('No hay engrases programados para este turno.');
  await expect(page.locator('.lub-accordion-count')).toHaveText(['0', '0', '0']);
});

test('sin duplicados: un equipo asignado y vencido por horómetro (que también cuenta como Atrasado) aparece en EXACTAMENTE un acordeón', async ({ page }) => {
  const equipos = [{ id: 'e1', code: 'T-05', brand: 'Volvo', model: 'A40', status: 'Operativo', locationId: 'l1', hourmeter: 600 }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Horas de operación', frequency: 250, lastGreaseHour: 100, alertYellowHours: 10 }];
  const assignments = [{ id: 'a1', equipmentId: 'e1', assignedCrewId: 'crew1', status: 'PENDING', active: true }];
  await bootPage(page, { equipos, plans, assignments });
  await page.evaluate(() => window.renderLubricadorHome());
  for (const key of ACCS) await btn(page, key).click();

  const counts = await Promise.all(ACCS.map(key => panel(page, key).locator('.lub-eq-code', { hasText: 'T-05' }).count()));
  expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
});

test('alcance de cuadrilla/ubicación: un equipo de una cuadrilla NO autorizada nunca aparece en ningún acordeón', async ({ page }) => {
  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'T-06', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l2' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  await bootPage(page, { equipos, plans }); // crew1 solo tiene cobertura de l1 (ASSIGNMENT_COVERAGE)
  await page.evaluate(() => window.renderLubricadorHome());
  for (const key of ACCS) await btn(page, key).click();

  await expect(page.locator('.lub-eq-code', { hasText: 'T-06' })).toHaveCount(0);
});

test('cambio de cuadrilla (setSelectedCrewId) recalcula los 3 acordeones, y una navegación real vuelve a nacer con los 3 colapsados', async ({ page }) => {
  const hoyWeekday = weekdayName(new Date());
  const equipos = [
    { id: 'e1', code: 'VOL-1', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' },
    { id: 'e2', code: 'OTRA-1', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l2' },
  ];
  const plans = [
    { id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] },
    { id: 'p2', equipmentId: 'e2', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] },
  ];
  await bootPage(page, {
    equipos, plans, crews: [...CREW, CREW2],
    crewLocations: [...ASSIGNMENT_COVERAGE, { id: 'cl:crew2:l2', crew_id: 'crew2', location_id: 'l2', role: 'PRINCIPAL', active: true }],
  });
  await page.evaluate(() => window.renderLubricadorHome());
  await btn(page, 'mi-turno').click();
  await expect(panel(page, 'mi-turno').locator('.lub-eq-code')).toHaveText(['VOL-1']);

  await page.evaluate(() => { setSelectedCrewId('lub1', 'crew2'); return renderLubricadorHome(); });
  // Navegación real (sin options.silent) -> los 3 vuelven a nacer colapsados.
  for (const key of ACCS) await expect(btn(page, key)).toHaveAttribute('aria-expanded', 'false');
  await btn(page, 'mi-turno').click();
  await expect(panel(page, 'mi-turno').locator('.lub-eq-code')).toHaveText(['OTRA-1']);
});

test('un repintado "silent" (sync incremental) preserva qué acordeón ya estaba abierto, nunca lo vuelve a colapsar de golpe', async ({ page }) => {
  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'T-07', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  await bootPage(page, { equipos, plans });
  await page.evaluate(() => window.renderLubricadorHome());
  await btn(page, 'mi-turno').click();
  await expect(btn(page, 'mi-turno')).toHaveAttribute('aria-expanded', 'true');

  await page.evaluate(() => window.renderLubricadorHome({ silent: true }));
  await expect(btn(page, 'mi-turno')).toHaveAttribute('aria-expanded', 'true');
  await expect(panel(page, 'mi-turno')).toBeVisible();
});

for (const width of [360, 390, 412]) {
  test(`@ ${width}px — los 3 encabezados de acordeón cumplen el objetivo táctil >=44px y no producen overflow horizontal`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await bootPage(page);
    await page.evaluate(() => window.renderLubricadorHome());
    for (const key of ACCS) {
      const box = await btn(page, key).boundingBox();
      expect(box.height, `${key} @ ${width}px`).toBeGreaterThanOrEqual(44);
    }
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
}

// ============================================================
// BUG-001 (2026-10-25, hallazgo en validación Android real) — el texto
// offline del header compacto de Mi Turno no se actualizaba al recibir
// online/offline (solo #conn-badge lo hacía). Fix: updateLubricadorConnectivitySummary()
// (app.js, junto a updateConnBadge()) actualiza SOLO #lub-turno-header-offline
// (textContent/hidden) — nunca un render completo, nunca toca acordeones/
// datos/sync.
// ============================================================
const offlineEl = page => page.locator('#lub-turno-header-offline');
async function setOnline(page, online) {
  await page.evaluate((online) => {
    Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true });
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  }, online);
}

test('BUG-001: el evento "offline" actualiza el header de Mi Turno de inmediato, sin esperar un render completo', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => window.renderLubricadorHome());
  await expect(offlineEl(page)).toBeHidden();

  await setOnline(page, false);
  await expect(offlineEl(page)).toBeVisible();
  await expect(offlineEl(page)).toHaveText('Sin conexión · puedes continuar trabajando');
});

test('BUG-001: con cambios pendientes de sync, el mensaje offline incluye el contador real (Sync.pendingCount())', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => { window.Sync.pendingCount = async () => 3; });
  await page.evaluate(() => window.renderLubricadorHome());

  await setOnline(page, false);
  await expect(offlineEl(page)).toHaveText('Sin conexión · puedes continuar trabajando · 3 cambios pendientes de sincronizar');
});

test('BUG-001: el evento "online" saca al header del estado offline SIN afirmar "Sincronizado" (online != sincronizado)', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => window.renderLubricadorHome());
  await setOnline(page, false);
  await expect(offlineEl(page)).toBeVisible();

  await setOnline(page, true);
  await expect(offlineEl(page)).toBeHidden();
  expect(await offlineEl(page).textContent()).toBe('');
  await expect(page.locator('body')).not.toContainText('Sincronizado');
});

test('BUG-001: el ciclo offline/online NUNCA toca los acordeones (estado abierto/cerrado, contadores intactos)', async ({ page }) => {
  const hoyWeekday = weekdayName(new Date());
  const equipos = [{ id: 'e1', code: 'T-09', brand: 'CAT', model: 'D8T', status: 'Operativo', locationId: 'l1' }];
  const plans = [{ id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }];
  await bootPage(page, { equipos, plans });
  await page.evaluate(() => window.renderLubricadorHome());
  await btn(page, 'mi-turno').click();
  await expect(btn(page, 'mi-turno')).toHaveAttribute('aria-expanded', 'true');
  const countsBefore = await page.locator('.lub-accordion-count').allTextContents();

  await setOnline(page, false);
  await setOnline(page, true);

  await expect(btn(page, 'mi-turno')).toHaveAttribute('aria-expanded', 'true'); // sigue abierto
  await expect(btn(page, 'pendientes-anteriores')).toHaveAttribute('aria-expanded', 'false'); // sigue cerrado
  expect(await page.locator('.lub-accordion-count').allTextContents()).toEqual(countsBefore); // contadores intactos
});

test('BUG-001: el ciclo offline/online nunca dispara Sync.fullSync() ni cambia App.route', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => {
    window.__fullSyncCalls = 0;
    window.Sync.fullSync = async () => { window.__fullSyncCalls++; };
  });
  await page.evaluate(() => window.renderLubricadorHome());

  await setOnline(page, false);
  await setOnline(page, true);

  expect(await page.evaluate(() => window.__fullSyncCalls)).toBe(0);
  expect(await page.evaluate(() => App.route)).toBe('turno');
});

for (const width of [360, 390, 412, 768, 1366]) {
  test(`BUG-001 @ ${width}px — el mensaje offline (con contador) no produce overflow horizontal`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await bootPage(page);
    await page.evaluate(() => { window.Sync.pendingCount = async () => 12; });
    await page.evaluate(() => window.renderLubricadorHome());
    await setOnline(page, false);
    await expect(offlineEl(page)).toBeVisible();
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(scrollWidth, `overflow horizontal @ ${width}px`).toBeLessThanOrEqual(clientWidth);
  });
}
