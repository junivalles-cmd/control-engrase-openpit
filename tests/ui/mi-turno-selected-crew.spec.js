import { test, expect } from '@playwright/test';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, DB_JS_PATH, SHIFTS_JS_PATH, LUBRICATION_STATUS_JS_PATH,
  OPERATIONAL_SCOPE_JS_PATH, GREASE_VALIDATION_JS_PATH } from '../helpers/loadLubricationLogic.js';
import { LUBRICATION_FOLLOW_UP_APP_NAMES } from '../helpers/lubricationFollowUpFixture.js';

// Real renderer, scope, localStorage and IndexedDB. No production login,
// network or device cache; same row shapes as the existing local fixtures.
const declarations = (file, names) => names.map(n => extractDeclaration(readSource(file), n)).join('\n');
const source = [
  declarations(DB_JS_PATH, ['DB_NAME', 'DB_VERSION', 'STORES', 'LOCAL_STORES', 'tx', 'openDB', 'localAuthorizationState', 'DB', 'uid', 'nowISO', 'stamp']),
  ...[SHIFTS_JS_PATH, LUBRICATION_STATUS_JS_PATH, OPERATIONAL_SCOPE_JS_PATH, GREASE_VALIDATION_JS_PATH].map(readSource),
  declarations(APP_JS_PATH, ['$', '$$', 'esc', 'ic', 'todayDateISO', 'STATUS_COLOR', 'GREASE_UNIT', 'NO_EXECUTION_REASON_LABELS',
    'colorLegendHTML', 'validationBadgeHTML', 'computeAllStatuses', 'getSelectedCrewId', 'setSelectedCrewId',
    'getCurrentOperationalScope', 'loadAssignmentContext', 'equipoOccurrenceKey', 'crewCoveragePresentation',
    ...LUBRICATION_FOLLOW_UP_APP_NAMES, 'renderLubricadorHome']),
].join('\n');

async function boot(page, { hydrate = true, bootstrapComplete = true, singleCrew = false } = {}) {
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main id="app-content"></main>' }));
  await page.goto('/__selected_crew_fixture');
  await page.clock.install({ time: new Date('2026-10-17T09:00:00') });
  await runtime(page, bootstrapComplete);
  if (hydrate) await page.evaluate(async singleCrew => {
    const crews = ['a', 'b', 'c'].slice(0, singleCrew ? 1 : 3).map((key, i) => ({
      id: `cuad_${key}`, name: `Cuadrilla ${key}`, locationId: ['volcan', 'mojon', 'acarreo'][i],
      memberUserIds: ['lub'], active: true, isDefault: true,
    }));
    await DB.putMany('cuadrillas', crews);
    await DB.putMany('locations', ['volcan', 'mojon', 'acarreo'].map(id => ({ id, name: id, active: true })));
    // Cobertura REALISTA: una sola cuadrilla PRINCIPAL por ubicación — lo
    // que de verdad exige validateCrewLocationCoverage() en producción (2+
    // PRINCIPAL de la misma ubicación se rechaza al guardar, ver
    // tests/ui/crew-location-coverage.spec.js "editor rechaza otra
    // principal..."). Una versión anterior daba las 3 ubicaciones como
    // PRINCIPAL a las 3 cuadrillas a la vez — un estado que la propia app
    // nunca permite guardar — y por eso "ganaba" siempre la primera
    // cuadrilla del array sin importar la ubicación real del equipo.
    await DB.putMany('crew_locations', crews.map((c, i) => ({
      id: `${c.id}:${['volcan', 'mojon', 'acarreo'][i]}`, crew_id: c.id, location_id: ['volcan', 'mojon', 'acarreo'][i], role: 'PRINCIPAL', active: true,
    })));
    const equipment = ['volcan', 'mojon', 'acarreo', 'unassigned', 'other-volcan'].map((id, i) => ({
      id, code: ['VOL-01', 'MOJ-02', 'ACR-03', 'VOL-SIN-ASIGNAR', 'VOL-OTRA-CUADRILLA'][i],
      locationId: i > 2 ? 'volcan' : id, status: 'Operativo', hourmeter: 100, active: true,
    }));
    await DB.putMany('equipment', equipment);
    await DB.putMany('lubrication_plans', equipment.map(e => ({ id: `plan:${e.id}`, equipmentId: e.id,
      active: true, controlType: 'Día y turno de la semana', assignedDays: ['Sábado'], shiftId: 'shift_dia' })));
    await DB.putMany('lubrication_points', equipment.map(e => ({ id: `pt:${e.id}`, planId: `plan:${e.id}`, active: true })));
    await DB.putMany('lubrication_assignments', equipment.filter(e => e.id !== 'unassigned').map((e, i) => ({
      id: `asg:${e.id}`, equipmentId: e.id, planId: `plan:${e.id}`, assignedCrewId: crews[i === 3 ? 1 : i]?.id || 'cuad_b',
      occurrenceKey: `plan:${e.id}:2026-10-17`, status: 'PENDING', active: true,
      // VOL-OTRA-CUADRILLA vive en Volcán (PRINCIPAL de cuad_a) pero su
      // PENDING es de cuad_b — cobertura REALISTA (ver arriba) ya no la
      // incluye en authorizedLocationIds de cuad_b por defecto; el grant de
      // apoyo puntual explícito (_supportOperational) es lo que de verdad
      // la hace visible para cuad_b, igual que en producción (ver
      // db.js:decorateSupportRow()/0014 SUPPORT_OTHER_LOCATION).
      ...(e.id === 'other-volcan' ? { _supportOperational: true } : {}),
    })));
    await DB.setConfig({ lastPull: 'fixture' });
  }, singleCrew);
  await page.evaluate(() => renderLubricadorHome());
}

async function runtime(page, ready = true) {
  await page.addScriptTag({ content: `
    let _db = null;
    window.App = { route: 'turno', currentUser: { id: 'lub', name: 'Fixture', role: 'LUBRICADOR' },
      generalSettings: { shiftDayStart: 6, shiftNightStart: 18 } };
    let lastSyncState = { status: 'ok' };
    window.__ready = ${ready};
    window.Sync = { getAccountSyncState: async () => ({ bootstrapComplete: window.__ready }) };
    window.refreshPushTokenCrewScope = () => new Promise(() => {}); // push must never delay selection
    window.updateLubricadorWidgetSnapshot = snapshot => window.__widget = snapshot;
    window.openAnomalyForm = () => {}; window.openQrScanner = () => {};
    ${source}
    window.DB = DB;
    window.renderLubricadorHome = renderLubricadorHome;
    window.getCurrentOperationalScope = getCurrentOperationalScope;
    window.setSelectedCrewId = setSelectedCrewId;
    window.__dbReady = openDB();
  ` });
  await page.evaluate(() => window.__dbReady);
}

const cards = page => page.locator('.lub-eq-btn .lub-eq-code');
test('3 crews: selector, Volcan normal+assigned, no Mojon, immediate switch and real restart persistence', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await boot(page, { hydrate: false, bootstrapComplete: false });
  await expect(page.locator('#app-content')).toContainText('Sincronizando datos');
  // Fresh bootstrap hydrates the real local stores; selection remains absent.
  await boot(page);
  await expect(page.locator('.crew-select-btn')).toHaveCount(3);
  await expect(page.locator('.lub-eq-code')).toHaveCount(0);
  // A different authorized plan for the same equipment must not decide
  // this assignment's status merely because it is first in IndexedDB.
  await page.evaluate(() => DB.put('lubrication_plans', {
    id: '000:other-plan', equipmentId: 'volcan', active: true,
    controlType: 'Día y turno de la semana', assignedDays: ['Domingo'], shiftId: 'shift_dia',
  }));
  await page.locator('[data-crew-id="cuad_a"]').click();
  // VOL-01 (asignación propia) + VOL-SIN-ASIGNAR (sin asignación, pero en
  // Volcán, la ubicación PRINCIPAL de cuad_a — trabajo normal real, NUNCA
  // debe exigir una asignación manual para aparecer en Mi Turno).
  await expect(cards(page)).toHaveText(['VOL-SIN-ASIGNAR', 'VOL-01']);
  await expect(page.locator('#app-content')).not.toContainText('MOJ-02');
  // VOL-OTRA-CUADRILLA vive en Volcán (ubicación de cuad_a) pero su PENDING
  // es de cuad_b — "asignado ajeno", nunca de cuad_a aunque sea su misma ubicación.
  await expect(page.locator('#app-content')).not.toContainText('VOL-OTRA-CUADRILLA');
  expect(await page.evaluate(async () => {
    const s = await getCurrentOperationalScope(); return [s.crewId, s.crewLocationId, s.authorizedCrews.length];
  })).toEqual(['cuad_a', 'volcan', 3]);
  await page.locator('#lub-change-crew').click();
  await expect(page.locator('.lub-eq-code')).toHaveCount(0);
  await page.locator('[data-crew-id="cuad_b"]').click();
  await expect(cards(page)).toHaveText(['MOJ-02', 'VOL-OTRA-CUADRILLA']);
  // Full document reload destroys JS state, retains actual localStorage/IDB.
  await page.reload(); await runtime(page);
  await page.evaluate(() => renderLubricadorHome());
  await expect(cards(page)).toHaveText(['MOJ-02', 'VOL-OTRA-CUADRILLA']);
  expect(await page.evaluate(async () => {
    const s = await getCurrentOperationalScope(); return [s.crewId, s.crewLocationId];
  })).toEqual(['cuad_b', 'mojon']);
  expect((await page.evaluate(() => DB.all('equipment')))).toHaveLength(5);
  expect(errors).toEqual([]);
});

// Con 1 sola cuadrilla autorizada, Mi Turno se auto-selecciona sin pedir
// confirmación (arquitectura documentada en operational-scope.js: "Con 1
// sola cuadrilla autorizada se selecciona sola") — una versión anterior
// exigía confirmar incluso con 1 sola, lo que mostraba el selector en CADA
// apertura de la app para el caso más común (lubricador de una sola
// cuadrilla) y rompía ~15 tests de tests/ui/crew-location-coverage.spec.js
// que asumían la auto-selección original.
test('one authorized crew auto-selects, no selector shown', async ({ page }) => {
  await boot(page, { singleCrew: true });
  await expect(page.locator('.crew-select-btn')).toHaveCount(0);
  await expect(cards(page)).toHaveText(['VOL-SIN-ASIGNAR', 'VOL-01']);
});

// Sin ninguna lubrication_assignment activa, cuad_a NO cae a vista global
// (ver scope.kind !== 'CREW_SCOPED' en classifyEquipmentWork()) — sigue
// viendo exactamente su trabajo NORMAL de Volcán (VOL-01/VOL-SIN-ASIGNAR,
// ninguno exige asignación), nunca el de otra cuadrilla ni los 5 equipos.
test('selected crew with no active assignments still sees its own normal work, never falls back to global coverage', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    for (const a of await DB.all('lubrication_assignments')) await DB.put('lubrication_assignments', { ...a, active: false });
    setSelectedCrewId('lub', 'cuad_a'); await renderLubricadorHome();
  });
  // Sin ninguna asignación activa (ni siquiera la de VOL-OTRA-CUADRILLA —
  // una asignación INACTIVA ya no reclama nada), los 3 equipos de Volcán
  // vuelven a ser trabajo NORMAL de su cuadrilla default (cuad_a) — nunca
  // el de otra cuadrilla real (MOJ-02/ACR-03 siguen fuera).
  await expect(cards(page)).toHaveText(['VOL-OTRA-CUADRILLA', 'VOL-SIN-ASIGNAR', 'VOL-01']);
  await expect(page.locator('.lub-kpi-value').first()).toHaveText('0'); // "Vencidos por horas"
});

// Con 1 sola cuadrilla autorizada (cuad_a), resolveOperationalScope() ni
// siquiera mira selectedCrewId (ver §SCOPE OPERATIVO en
// operational-scope.js) — una selección persistida de una cuadrilla NO
// autorizada ('cuad_b') se ignora en silencio, nunca eleva permisos ni
// bloquea con un selector espurio: auto-selecciona la única autorizada.
test('persisted unauthorized crew is ignored in silence; single authorized crew still auto-selects', async ({ page }) => {
  await boot(page, { singleCrew: true });
  await page.evaluate(async () => { setSelectedCrewId('lub', 'cuad_b'); await renderLubricadorHome(); });
  await expect(page.locator('.crew-select-btn')).toHaveCount(0);
  await expect(cards(page)).toHaveText(['VOL-SIN-ASIGNAR', 'VOL-01']);
});

for (const sample of [
  { locationId: 'mojon', state: 'VALID', label: 'Mojón' },
  { locationId: 'unknown-master', state: 'UNRESOLVED', label: 'Ubicación maestra no disponible' },
  { locationId: '', state: 'MISSING', label: 'Ubicación maestra sin definir' },
  { locationId: 'inactive-master', state: 'INACTIVE', label: 'Ubicación maestra inactiva · Taller' },
]) test(`master location ${sample.state}: no crew fallback, legible at mobile width`, async ({ page }) => {
  await boot(page);
  await page.addStyleTag({ path: 'CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css' });
  await page.evaluate(async sample => {
    await DB.put('locations', { id: 'mojon', name: 'Mojón', active: true });
    await DB.put('locations', { id: 'inactive-master', name: 'Taller', active: false });
    const e = await DB.get('equipment', 'volcan');
    await DB.put('equipment', { ...e, locationId: sample.locationId });
    const a = await DB.get('lubrication_assignments', 'asg:volcan');
    await DB.put('lubrication_assignments', { ...a, _supportOperational: true });
  }, sample);
  await page.locator('[data-crew-id="cuad_a"]').click();
  const card = page.locator('.lub-eq-btn').filter({ hasText: 'VOL-01' });
  const label = card.locator('.lub-eq-location');
  await expect(label).toHaveText(`📍 ${sample.label}`);
  await expect(label).toHaveAttribute('data-master-location-state', sample.state);
  await expect(label).not.toContainText('Volcán');
  const box = await label.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  if (sample.state !== 'VALID') await expect(card).not.toContainText('APOYO ·');
});

test('silent refresh after sync changes master label even when row IDs, statuses, coverage and filter stay identical', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    // Missing masters must remain visible through the existing exact support grant.
    const a = await DB.get('lubrication_assignments', 'asg:volcan');
    await DB.put('lubrication_assignments', { ...a, _supportOperational: true });
    const e = await DB.get('equipment', 'volcan');
    await DB.put('equipment', { ...e, locationId: '' });
  });
  await page.locator('[data-crew-id="cuad_a"]').click();
  const card = page.locator('.lub-eq-btn').filter({ hasText: 'VOL-01' });
  await expect(card.locator('.lub-eq-location')).toContainText('Ubicación maestra sin definir');
  await page.evaluate(async () => {
    const e = await DB.get('equipment', 'volcan');
    await DB.put('equipment', { ...e, locationId: 'mojon' });
    // Existing UI path after local sync hydration; no real sync/backend involved.
    await renderLubricadorHome({ silent: true });
  });
  await expect(card.locator('.lub-eq-location')).toHaveText('📍 mojon');
  await page.evaluate(async () => {
    await DB.put('locations', { id: 'mojon', name: 'Mojón actualizado', active: true });
    await renderLubricadorHome({ silent: true });
  });
  await expect(card.locator('.lub-eq-location')).toHaveText('📍 Mojón actualizado');
  await page.evaluate(async () => {
    await DB.put('locations', { id: 'mojon', name: 'Mojón actualizado', active: false });
    await renderLubricadorHome({ silent: true });
  });
  await expect(card.locator('.lub-eq-location')).toHaveText('📍 Ubicación maestra inactiva · Mojón actualizado');
});

test('real local DB filter resolves granted Mojon master for a Volcan crew without widening base scope', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const e = await DB.get('equipment', 'volcan');
    await DB.put('equipment', { ...e, locationId: 'mojon' });
    await DB.put('locations', { id: 'mojon', name: 'Mojon', active: true });
    for (const store of ['equipment', 'locations', 'cuadrillas', 'lubrication_assignments', 'lubrication_plans', 'lubrication_points']) {
      for (const r of await DB.allRaw(store)) await DB.put(store, { ...r, __authorizationAppUserId: 'lub' });
    }
    const context = { appUserId: 'lub', authUserId: 'fixture-auth', active: true,
      scopeType: 'CREW_SCOPED', authorizedCrewIds: ['cuad_a','cuad_b','cuad_c'],
      authorizedLocationIds: ['volcan'], authorizationFingerprint: 'fixture-scope',
      supportGrants: { appUserId: 'lub', authUserId: 'fixture-auth', authorizationFingerprint: 'fixture-scope',
        operational: [{ assignmentId: 'asg:volcan', equipmentId: 'volcan', planId: 'plan:volcan',
          assignedCrewId: 'cuad_a', occurrenceKey: 'plan:volcan:2026-10-17' }],
        rows: [['locations','mojon'], ['equipment','volcan'], ['lubrication_plans','plan:volcan'], ['lubrication_assignments','asg:volcan']]
          .map(([store,id]) => ({ store,id })) } };
    await DB.setAuthorizationContext('lub', context);
    window.Auth = { isSupabaseMode: () => true, getProfile: () => ({ appUserId: 'lub' }) };
  });
  await page.locator('[data-crew-id="cuad_a"]').click();
  const card = page.locator('.lub-eq-btn').filter({ hasText: 'VOL-01' });
  await expect(card.locator('.lub-eq-location')).toHaveText('📍 Mojon');
  await expect(card).toContainText('APOYO · MOJON');
  expect(await page.evaluate(async () => (await DB.getAuthorizationContext('lub')).authorizedLocationIds)).toEqual(['volcan']);
  expect(await page.evaluate(() => DB.get('equipment', 'mojon'))).toBeNull(); // no grant for other Mojon equipment
});

for (const type of ['Excavadora','Articulado','Volquete','Tractor','Cargador','Motoniveladora','Tipo futuro']) {
  test(`${type}: Day assignment becomes carryover in Night without duplication or a new assignment`, async ({ page }) => {
    await boot(page);
    await page.evaluate(async type => {
      const e = await DB.get('equipment', 'volcan'); await DB.put('equipment', { ...e, typeId: type });
      const p = await DB.get('lubrication_plans', 'plan:volcan');
      await DB.put('lubrication_plans', { ...p, requiredShifts: ['shift_dia','shift_noche'], effectiveDate: '2026-10-01' });
      const a = await DB.get('lubrication_assignments', 'asg:volcan');
      await DB.put('lubrication_assignments', { ...a, occurrenceKey: 'plan:volcan:2026-10-17:shift_dia' });
      window.startLubricadorGreaseFlow = (id, options) => window.__chosenWork = { id, options };
    }, type);
    await page.locator('[data-crew-id="cuad_a"]').click();
    await expect(page.locator('.lub-eq-btn[data-occurrence-key="plan:volcan:2026-10-17:shift_dia"]')).toHaveCount(1);
    await page.clock.setSystemTime(new Date('2026-10-17T20:00:00'));
    await page.evaluate(() => renderLubricadorHome({ silent: true }));
    const carry = page.locator('.lub-pending-card[data-occurrence-key="plan:volcan:2026-10-17:shift_dia"]');
    await expect(carry).toHaveCount(1); await expect(carry).toContainText('PENDIENTE DEL TURNO ANTERIOR');
    // "volcan" se movió entero a arrastre — solo queda el trabajo normal
    // SIN RELACIÓN (VOL-SIN-ASIGNAR, mismo Volcán, sin asignación ni plan
    // dual), nunca una segunda tarjeta de "volcan" ni nada de otra cuadrilla.
    await expect(cards(page)).toHaveText(['VOL-SIN-ASIGNAR']);
    // VOL-SIN-ASIGNAR nunca tuvo un registro — buildCrewLubricationFollowUp()
    // lo clasifica igual por antigüedad (days===null), y puede coexistir con
    // su propia tarjeta formal en Mi Turno (solo arrastradosTotal excluye del
    // seguimiento por antigüedad, ver app.js) — la ÚNICA garantía real aquí
    // es que "volcan" (ya en arrastre) no aparece DOS veces.
    await expect(page.locator('#lub-follow-up .lub-eq-code')).not.toContainText('VOL-01');
    await carry.locator('.lub-arr-reg').click();
    expect(await page.evaluate(() => __chosenWork)).toEqual({ id: 'volcan', options: { assignmentId: 'asg:volcan' } });
    const assignments = await page.evaluate(() => DB.all('lubrication_assignments'));
    expect(assignments).toHaveLength(4);
    expect(assignments.find(a => a.id === 'asg:volcan')).toMatchObject({ occurrenceKey: 'plan:volcan:2026-10-17:shift_dia', status: 'PENDING' });
  });
}

test('Night carryover survives next day, >24h offline, full restart and manual shift changes', async ({ page, context }) => {
  await boot(page);
  await page.evaluate(async () => {
    const p = await DB.get('lubrication_plans', 'plan:volcan');
    await DB.put('lubrication_plans', { ...p, requiredShifts: ['shift_dia','shift_noche'], effectiveDate: '2026-10-01' });
    const a = await DB.get('lubrication_assignments', 'asg:volcan');
    await DB.put('lubrication_assignments', { ...a, occurrenceKey: 'plan:volcan:2026-10-16:shift_noche' });
  });
  await page.locator('[data-crew-id="cuad_a"]').click();
  const carry = page.locator('.lub-pending-card[data-occurrence-key="plan:volcan:2026-10-16:shift_noche"]');
  await expect(carry).toHaveCount(1);
  await context.setOffline(true);
  await page.clock.setSystemTime(new Date('2026-10-20T09:00:00'));
  await page.evaluate(() => renderLubricadorHome({ silent: true }));
  await expect(carry).toHaveCount(1);
  await page.reload(); await runtime(page); await page.evaluate(() => renderLubricadorHome());
  await expect(carry).toHaveCount(1);
  for (const shift of ['shift_dia','shift_noche','shift_dia']) {
    await page.evaluate(shift => { window.currentShiftId = () => shift; return renderLubricadorHome(); }, shift);
    await expect(carry).toHaveCount(1);
  }
  expect((await page.evaluate(() => DB.get('lubrication_assignments', 'asg:volcan'))).occurrenceKey).toBe('plan:volcan:2026-10-16:shift_noche');
});

test('two explicitly scheduled shifts are distinct; completing Day at Night removes only Day, not Night', async ({ page }) => {
  await boot(page);
  await page.clock.setSystemTime(new Date('2026-10-17T20:00:00'));
  await page.evaluate(async () => {
    const p = await DB.get('lubrication_plans', 'plan:volcan');
    await DB.put('lubrication_plans', { ...p, requiredShifts: ['shift_dia','shift_noche'], effectiveDate: '2026-10-01' });
    const a = await DB.get('lubrication_assignments', 'asg:volcan');
    await DB.put('lubrication_assignments', { ...a, occurrenceKey: 'plan:volcan:2026-10-17:shift_dia' });
    await DB.put('lubrication_assignments', { ...a, id: 'asg:night', occurrenceKey: 'plan:volcan:2026-10-17:shift_noche' });
  });
  await page.locator('[data-crew-id="cuad_a"]').click();
  await expect(page.locator('.lub-pending-card[data-occurrence-key$="shift_dia"]')).toHaveCount(1);
  await expect(page.locator('.lub-eq-btn[data-occurrence-key$="shift_noche"]')).toHaveCount(1);
  await page.evaluate(async () => {
    await DB.put('lubrication_records', { id: 'record-day', equipmentId: 'volcan', planId: 'plan:volcan', active: true,
      date: '2026-10-17T19:00:00', shiftId: 'shift_noche', qty: 1, details: [{ done: true }],
      operationalSnapshot: { assignmentId: 'asg:volcan', assignedOccurrenceKey: 'plan:volcan:2026-10-17:shift_dia',
        occurrenceKey: 'plan:volcan:2026-10-17:shift_dia', executionCompleteness: 'COMPLETE' } });
    // Even stale PENDING status cannot resurrect an already completed exact task.
    await renderLubricadorHome({ silent: true });
  });
  await expect(page.locator('.lub-pending-card[data-occurrence-key$="shift_dia"]')).toHaveCount(0);
  await expect(page.locator('.lub-eq-btn[data-occurrence-key$="shift_noche"]')).toHaveCount(1);
  expect(await page.evaluate(() => DB.all('lubrication_records'))).toHaveLength(1);
});

test('executed tractor remains actionable for validation days later using the same record; no new execution', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const a = await DB.get('lubrication_assignments', 'asg:volcan');
    await DB.put('lubrication_assignments', { ...a, status: 'COMPLETED', completedRecordId: 'same-record' });
    await DB.put('lubrication_records', { id: 'same-record', equipmentId: 'volcan', planId: 'plan:volcan', active: true,
      date: '2026-10-14T20:00:00', shiftId: 'shift_noche', qty: 1, details: [{ done: true }],
      operationalSnapshot: { assignedOccurrenceKey: a.occurrenceKey, executionCompleteness: 'COMPLETE' } });
    window.openValidationModal = record => { window.__validationTarget = record.id; };
  });
  await page.locator('[data-crew-id="cuad_a"]').click();
  // "volcan" (COMPLETED) ya no es pendiente — VOL-SIN-ASIGNAR (equipo
  // normal sin relación, mismo Volcán, siempre presente en el fixture
  // compartido) sigue su propio trabajo normal, sin afectar esta garantía.
  await expect(page.locator('.lub-eq-btn, .lub-pending-card').filter({ hasText: 'VOL-01' })).toHaveCount(0);
  await expect(page.locator('#lub-pending-validations')).toContainText('Validación vencida');
  await page.locator('.lub-real-validate').click();
  expect(await page.evaluate(() => __validationTarget)).toBe('same-record');
  await page.evaluate(async () => {
    await DB.put('grease_validations', { id: 'later-validation', lubricationRecordId: 'same-record', equipmentId: 'volcan', active: true,
      signerRole: 'OPERADOR', signedAt: '2026-10-17T09:00:00' });
    await renderLubricadorHome({ silent: true });
  });
  await expect(page.locator('#lub-pending-validations')).toHaveCount(0);
  const records = await page.evaluate(() => DB.all('lubrication_records'));
  expect(records).toHaveLength(1); expect(records[0].id).toBe('same-record'); expect(records[0].shiftId).toBe('shift_noche');
});
