// tests/ui/grease-form-layout-real.spec.js
//
// Pedido "REDISEÑO UX FORMULARIO REGISTRAR ENGRASE" (2026-10-10). A
// diferencia de lubricador-grease-form.spec.js (fixture estático que imita
// la estructura), este archivo EJECUTA startGreaseFlow() de verdad (mismo
// patrón real de dashboard-real-execution.spec.js/ficha-programacion-
// semana.spec.js) contra datos reales en memoria, para confirmar que el
// fix del layout, los chips, el botón de fotos y la jerarquía de acciones
// funcionan con la función real — no solo con un HTML de ejemplo.
//
// Incluye render, interacciones y submit real con DB en memoria: motivos,
// snapshot automático, COMPLETE/PARTIAL y prioridad de assignment.
// Las reglas se extraen de producción; no se reimplementan en la fixture.

import { test, expect } from '@playwright/test';
const pageErrors = new WeakMap();
test.beforeEach(({page}) => {
  const errors = []; pageErrors.set(page, errors);
  page.on('pageerror', e => errors.push(e.stack || e.message));
});
test.afterEach(({page}) => expect(pageErrors.get(page)).toEqual([]));
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import {
  APP_JS_PATH, DB_JS_PATH, HOURMETER_JS_PATH, ANOMALIES_JS_PATH, ANOMALY_ACTIONS_JS_PATH, LUBRICATION_STATUS_JS_PATH, OPERATIONAL_SCOPE_JS_PATH, GREASE_VALIDATION_JS_PATH,
} from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

const appSource = readSource(APP_JS_PATH);
const statusSource = readSource(LUBRICATION_STATUS_JS_PATH);
const scopeSource = readSource(OPERATIONAL_SCOPE_JS_PATH);
const validationSource = readSource(GREASE_VALIDATION_JS_PATH);

const statusNames = ['fmt', 'WEEKDAY_NAMES', 'mostRecentAssignedDate', 'weekdayStatusFor', 'statusFor'];
const statusSrc = statusNames.map(n => extractDeclaration(statusSource, n)).join('\n\n');
const scopeNames = [
  'operationalDateForShift', 'EXECUTION_TYPE', 'ASSIGNMENT_STATUS', 'resolveRecordExecutionType', 'resolveRecordOutOfPlanReason',
  'resolveRecordCompleteness', 'findExistingWorkForEquipment', 'findCarriedOverSkipForToday',
  'findActivePendingAssignment', 'computeOccurrenceKey', 'toISODateUTCLocal', 'canRegisterOutOfPlan',
  'ROLES_CAN_REGISTER_OUT_OF_PLAN', 'OUT_OF_PLAN_REASONS',
  'EXECUTION_COMPLETENESS', 'computeExecutionCompleteness', 'findNextApplicableOccurrenceForWeekdayPlan',
  'findNextApplicableOccurrence', 'resolveEarlyOccurrenceSatisfaction', 'buildExecutionSnapshot', 'canAdvanceHourCycle',
  'ROLES_CREW_SCOPED', 'getAuthorizedCrews', 'resolveCrewLocationCoverage', 'resolveOperationalScope', 'completeAssignmentIfPending',
];
const scopeSrc = scopeSource;
const validationNames = [
  'VALIDATION_STATUS', 'VALIDATION_BADGE', 'GREASE_VALIDATION_ENABLED_FROM', 'MAX_VALIDATION_SHIFTS',
  'isRecordSubjectToValidation', 'statusForSignerRole', 'findActiveValidations', 'hasValidationConflict',
  'findActiveValidation', 'shiftKindAt', 'shiftDurationHours', 'shiftWindowStart', 'validationDeadline',
  'isValidationExpired', 'validationStatusFor', 'validationStatusForRecord', 'isRecordPendingValidation',
  'isRecordValidationExpired', 'isRecordInConflict',
];
const validationSrc = validationNames.map(n => extractDeclaration(validationSource, n)).join('\n\n');
const appNames = [
  '$', '$$', 'esc', 'ic', 'fmtDate', 'todayDateISO', 'GREASE_UNIT', 'STATUS_COLOR', 'WEEKDAY_ABBR_DASH',
  'NO_EXECUTION_REASON_LABELS', 'MAX_PHOTOS', 'trackRecentEquipment', 'photoFieldHTML', 'getPhotoFieldPhotos',
  'renderPhotoStrip', 'addPhotoToField', 'wirePhotoField', 'fileToCompressedDataURL', 'stampEquipmentEvidencePhoto', 'startGreaseFlow',
  'getSelectedPhotos', 'getSelectedCrewId', 'getCurrentOperationalScope', 'shouldBlockCompleteChecklistWithoutGrease',
  'confirmHourmeterChange', 'createAutoAnomalies', 'equipoOccurrenceKey',
];
const appSrc = appNames.map(n => extractDeclaration(appSource, n)).join('\n\n');
const persistenceSrc = ['uid', 'nowISO', 'stamp', 'queueLubricationExecution'].map(n => extractDeclaration(readSource(DB_JS_PATH), n)).join('\n');
const hourmeterSrc = extractDeclaration(readSource(HOURMETER_JS_PATH), 'validateHourmeterChange');
const anomaliesSrc = extractDeclaration(readSource(ANOMALIES_JS_PATH), 'CRITICIDAD_POR_MOTIVO') + '\n' +
  ['hayPuntosOAnomaliaHorometro', 'evaluateAnomalyActions'].map(n => extractDeclaration(readSource(ANOMALY_ACTIONS_JS_PATH), n)).join('\n');

const EQUIPO = { id: 'e1', code: 'A-02', shortCode: '45-69', brand: 'Caterpillar', model: '740B', status: 'Operativo', hourmeter: 1234, locationId: 'l1' };
const PLAN = { id: 'plan1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: ['Lunes', 'Miércoles', 'Viernes'], shiftId: 'shift_noche' };
const POINTS = [
  { id: 'p1', planId: 'plan1', point: 'Cilindro izquierdo' },
  { id: 'p2', planId: 'plan1', point: 'Cilindro derecho' },
  { id: 'p3', planId: 'plan1', point: 'Pin de giro' },
];
const LUBRICANTS = [{ id: 'lub1', name: 'Grasa Moly' }];
const LOCATION = { id: 'l1', name: 'Botadero Norte' };

async function bootPage(page, { equipos = [EQUIPO], plans = [PLAN], points = POINTS } = {}) {
  await page.route('**/*', (route) => {
    if (route.request().resourceType() === 'document') {
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    } else {
      route.continue();
    }
  });
  await page.goto('/');
  await page.setContent('<div id="app-content"></div><div class="lub-shell"><main class="lub-content"><div id="reg-flow-area"></div></main><nav class="lub-bottom-nav"></nav></div>');
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.App = {
        currentUser: { id: 'lub1', name: 'Lubricador de prueba', role: 'LUBRICADOR' },
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18, complianceTarget: 85 },
      };
      window.confirm = () => true;
      window.alert = () => {};
      window.__mockData = {
        equipment: ${JSON.stringify(equipos)},
        lubrication_plans: ${JSON.stringify(plans)},
        lubrication_points: ${JSON.stringify(points)},
        lubrication_records: [],
        lubrication_assignments: [],
        lubrication_skips: [],
        lubricants: ${JSON.stringify(LUBRICANTS)},
        locations: ${JSON.stringify([LOCATION])},
        users: [],
        grease_drafts: [],
        anomalies: [],
        cuadrillas: [{ id: 'crew-fixture', name: 'Cuadrilla de prueba', locationId: 'l1', memberUserIds: ['lub1'], active: true }],
        crew_locations: [],
      };
      window.DB = {
        allActive: async (store) => window.__mockData[store] || [],
        all: async (store) => window.__mockData[store] || [],
        get: async (store, id) => (store === 'equipment' ? window.__mockData.equipment.find(e => e.id === id) : (window.__mockData[store] || []).find(r => r.id === id)) || null,
        put: async (store, row) => {
          const rows = window.__mockData[store] ||= [];
          const index = rows.findIndex(item => item.id === row.id);
          if (index < 0) rows.push(row); else rows[index] = row;
        },
        delete: async (store, id) => { window.__mockData[store] = (window.__mockData[store] || []).filter(row => row.id !== id); },
      };
      window.currentShiftId = () => 'shift_noche';
      // Persistence boundary mock; the real IDB transaction is tested in execution-gateway.spec.js.
      window.__executionOperations = [];
      window.__evidenceOperations = [];
      DB.getEvidenceOperations = async () => __evidenceOperations;
      DB.projectEvidenceOperation = async (operation, changes) => {
        for (const change of changes) await DB.put('anomalies', { ...change.row, _evidenceOperationId: operation.id });
        operation.projected = true;
      };
      DB.putExecutionOperation = async (operation, changes) => {
        for (const change of changes) await DB.put(change.store, { ...change.row, _executionOperationId: operation.id });
        __executionOperations.push(operation);
        if (operation.automaticAnomaly) __evidenceOperations.push(operation.automaticAnomaly);
      };
      ${persistenceSrc}
      ${hourmeterSrc}
      ${anomaliesSrc}
      window.notificarEngraseRealizado = async () => {};
      window.refreshLocalNotifications = async () => {};
      window.refreshAppBadge = async () => {};
      window.showInAppToast = () => {};
      window.logAudit = async () => {};
      window.irAMisEngrasesTrasRegistrar = () => {};
      window.Sync = { fullSync: () => {} };
      ${statusSrc}
      ${scopeSrc}
      ${validationSrc}
      ${appSrc}
      window.startGreaseFlow = startGreaseFlow;
    `,
  });
}

test('A/B — Horómetro NO se estira a la altura de Puntos; sin espacio muerto grande (desktop, ejecución real)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await bootPage(page);
  await page.evaluate(() => window.startGreaseFlow('e1', document.getElementById('reg-flow-area')));
  expect(errors).toEqual([]);

  const hm = await page.locator('.grease-flow-card-horometro').boundingBox();
  const puntos = await page.locator('.grease-flow-card-puntos').boundingBox();
  expect(hm.height, 'Horómetro mantiene su propia altura, mucho menor que Puntos').toBeLessThan(puntos.height * 0.7);
  expect(Math.abs(hm.y - puntos.y), 'comparten la fila 1').toBeLessThan(2);
});

for (const reason of ['PM', 'CORRECTIVO', 'OPORTUNIDAD', 'SUPPORT_OTHER_LOCATION', 'OTRO']) {
  test(`submit real offline: conserva motivo ${reason} y todo el snapshot automático`, async ({ page, context }) => {
    await bootPage(page);
    await page.evaluate(() => window.startGreaseFlow('e1', document.getElementById('reg-flow-area'), { outOfPlan: true }));
    await page.locator('#oop-reason-select').selectOption(reason);
    if (reason === 'OTRO') await page.locator('textarea[name="notes"]').fill('Motivo específico');
    await page.locator('input[name="qty"]').fill('1.5');
    await context.setOffline(true);
    await page.locator('.btn-grease-submit').click();
    await expect(page.locator('#grease-validate-now-btn')).toBeVisible();
    const [record] = await page.evaluate(() => __mockData.lubrication_records);
    expect(record).toMatchObject({ equipmentId: 'e1', planId: 'plan1', userId: 'lub1', userName: 'Lubricador de prueba', shiftId: 'shift_noche', qty: 1.5,
      operationalSnapshot: { executionType: 'OUT_OF_PLAN', outOfPlanReason: reason, crewId: 'crew-fixture', equipmentLocationIdAtExecution: 'l1', executionCompleteness: 'COMPLETE' } });
    expect(record.date).toBeTruthy();
    expect((await page.evaluate(() => __mockData.equipment[0])).locationId).toBe('l1');
  });
}

test('submit real: COMPLETE con cantidad cero bloquea; PARTIAL conserva punto pendiente y anomalía', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => window.startGreaseFlow('e1', document.getElementById('reg-flow-area')));
  await page.locator('.btn-grease-submit').click();
  expect(await page.evaluate(() => __mockData.lubrication_records)).toHaveLength(0);
  await page.locator('.check-row').first().click();
  await page.locator('.chk-reason').first().selectOption({ label: 'Grasera dañada' });
  await page.locator('.btn-grease-submit').click();
  await expect(page.locator('#grease-validate-now-btn')).toBeVisible();
  const record = await page.evaluate(() => __mockData.lubrication_records[0]);
  expect(record.operationalSnapshot.executionCompleteness).toBe('PARTIAL');
  expect(record.details[0]).toMatchObject({ done: false, reason: 'Grasera dañada' });
  expect(await page.evaluate(() => __mockData.anomalies)).toHaveLength(1);
});
test('sin puntos: COMPLETE 0 lb bloquea con mensaje; cantidad positiva guarda', async ({ page }) => {
  await bootPage(page, { points: [] });
  await page.evaluate(() => { window.__alerts = []; window.alert = message => __alerts.push(message); return startGreaseFlow('e1', document.getElementById('reg-flow-area')); });
  await page.locator('.btn-grease-submit').click();
  expect(await page.evaluate(() => __mockData.lubrication_records)).toHaveLength(0);
  expect(await page.evaluate(() => __alerts)).toContain('Un engrase completo debe registrar una cantidad de grasa mayor a 0 lb.');
  await page.locator('input[name="qty"]').fill('0.1');
  await page.locator('.btn-grease-submit').click();
  await expect(page.locator('#grease-validate-now-btn')).toBeVisible();
  expect(await page.evaluate(() => __mockData.lubrication_records[0].qty)).toBe(0.1);
});

test('submit real: assignment mantiene prioridad sobre Fuera de plan y no cambia ubicación', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => {
    __mockData.lubrication_assignments.push({ id: 'assignment-fixture', occurrenceKey: computeOccurrenceKey(__mockData.lubrication_plans[0], { dateISO: todayDateISO() }), equipmentId: 'e1', assignedCrewId: 'crew-fixture', status: 'PENDING', active: true });
    return window.startGreaseFlow('e1', document.getElementById('reg-flow-area'), { outOfPlan: true });
  });
  await page.locator('input[name="qty"]').fill('1.5');
  await page.locator('.btn-grease-submit').click();
  await expect(page.locator('#grease-validate-now-btn')).toBeVisible();
  const snapshot = await page.evaluate(() => __mockData.lubrication_records[0].operationalSnapshot);
  expect(snapshot).toMatchObject({ executionType: 'ASSIGNED', assignmentId: 'assignment-fixture', outOfPlanReason: null });
  expect(await page.evaluate(() => __mockData.lubrication_assignments[0].status)).toBe('COMPLETED');
  expect(await page.evaluate(() => __mockData.equipment[0].locationId)).toBe('l1');
});

test('C/D — los puntos siguen funcionando: desmarcar exige motivo, "Marcar todos" vuelve a marcar todo', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => window.startGreaseFlow('e1', document.getElementById('reg-flow-area')));

  // .chk-done es un checkbox nativo oculto (pointer-events:none, patrón de
  // checkbox custom) — se interactúa por su <label class="check-row">,
  // igual que lo haría un usuario real tocando la fila.
  await page.locator('.checklist-item').first().locator('.check-row').click();
  await expect(page.locator('.checklist-item').first().locator('.chk-reason')).toBeVisible();
  await expect(page.locator('#checklist-progress-text')).toHaveText('2 de 3 puntos marcados');

  await page.locator('#btn-check-all').click();
  await expect(page.locator('.chk-done:checked')).toHaveCount(3);
  await expect(page.locator('#checklist-progress-text')).toHaveText('3 de 3 puntos marcados');
});

test('horómetro: checkbox "sin horómetro" deshabilita el input (lógica intacta) y el sufijo "h" es solo visual (nunca entra al value)', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => window.startGreaseFlow('e1', document.getElementById('reg-flow-area')));

  const input = page.locator('#hourmeter-input');
  await expect(input).toHaveValue('1234');
  await page.locator('#nohm-check').check();
  await expect(input).toBeDisabled();
  // El sufijo "h" vive en un <span> hermano, nunca dentro del valor numérico.
  expect(await input.inputValue()).not.toContain('h');
  await expect(page.locator('.input-suffix-group').first().locator('.input-suffix')).toHaveText('h');
});

test('G — fotos: el botón "+ Agregar fotografías" sigue agregando fotos reales al strip (mismo pipeline de compresión/IndexedDB, solo cambia la presentación)', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => window.startGreaseFlow('e1', document.getElementById('reg-flow-area')));

  // El <input type="file"> real sigue ahí (solo .sr-only) — se simula la
  // selección disparando su 'change' con un archivo real, sin pasar por el
  // picker nativo del SO (no automatizable), igual que el resto de la app.
  const fileInput = page.locator('#grease-form input[name="photo"]');
  await expect(fileInput).toHaveCount(1);
  await expect(page.locator('.photo-pick-web-btn')).toBeVisible();
  // PNG 1x1 real y válido (no solo la firma) — fileToCompressedDataURL()
  // decodifica con Image()/canvas real, un buffer truncado nunca carga.
  const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await fileInput.setInputFiles({ name: 'foto1.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await page.waitForTimeout(300); // fileToCompressedDataURL usa Image/canvas async
  await expect(page.locator('.photo-slot')).toHaveCount(1);
  // Permanent pixels are present before any later persistence operation.
  const dimensions = await page.locator('.photo-slot').evaluate(async slot => {
    const image = new Image(); image.src = slot.dataset.photo; await image.decode();
    return { width: image.width, height: image.height };
  });
  expect(dimensions).toEqual({ width: 640, height: 37 });
});

test('H — observaciones: el campo de texto sigue siendo un textarea editable normal', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => window.startGreaseFlow('e1', document.getElementById('reg-flow-area')));
  const notes = page.locator('textarea[name="notes"]');
  await expect(notes).toBeHidden();
  await page.locator('#grease-notes summary').click();
  await notes.fill('Observación de prueba');
  await expect(notes).toHaveValue('Observación de prueba');
});

test('fuera de plan: cada motivo llega a FormData y al borrador; Otro revela el texto obligatorio', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => window.startGreaseFlow('e1', document.getElementById('reg-flow-area'), { outOfPlan: true, outOfPlanReason: 'SUPPORT_OTHER_LOCATION' }));
  await expect(page.locator('#oop-reason-select')).toHaveValue('SUPPORT_OTHER_LOCATION');
  for (const reason of ['PM', 'CORRECTIVO', 'OPORTUNIDAD', 'SUPPORT_OTHER_LOCATION', 'OTRO']) {
    await page.locator('#oop-reason-select').selectOption(reason);
    expect(await page.locator('#grease-form').evaluate(form => new FormData(form).get('outOfPlanReason'))).toBe(reason);
    await expect.poll(() => page.evaluate(() => __mockData.grease_drafts[0]?.fields.outOfPlanReason)).toBe(reason);
  }
  await expect(page.locator('textarea[name="notes"]')).toBeVisible();
  await expect(page.locator('textarea[name="notes"]')).toHaveAttribute('required', '');
  expect(await page.locator('#grease-form').evaluate(form => form.checkValidity())).toBe(false);
  await page.locator('textarea[name="notes"]').fill('Motivo específico de prueba');
  expect(await page.locator('#grease-form').evaluate(form => form.checkValidity())).toBe(true);
  await page.locator('#oop-reason-select').selectOption('PM');
  await expect(page.locator('textarea[name="notes"]')).not.toHaveAttribute('required', '');
});

test('borrador fuera de plan restaura motivo y observaciones, sin volver a escribirlos', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => {
    __mockData.grease_drafts.push({ id: 'draft_e1_lub1', savedAt: new Date().toISOString(), fields: { outOfPlanReason: 'OTRO', notes: 'Texto recuperado', qty: '1.5' } });
    return window.startGreaseFlow('e1', document.getElementById('reg-flow-area'), { outOfPlan: true });
  });
  await page.locator('#btn-restore-draft').click();
  await expect(page.locator('#oop-reason-select')).toHaveValue('OTRO');
  await expect(page.locator('textarea[name="notes"]')).toBeVisible();
  await expect(page.locator('textarea[name="notes"]')).toHaveValue('Texto recuperado');
});

test('lubricante único de los puntos se preselecciona y sigue siendo modificable', async ({ page }) => {
  await bootPage(page, { points: POINTS.map(point => ({ ...point, greaseType: 'lub2' })) });
  await page.evaluate(() => {
    __mockData.lubricants.push({ id: 'lub2', name: 'Lubricante del plan' });
    return window.startGreaseFlow('e1', document.getElementById('reg-flow-area'));
  });
  await expect(page.locator('select[name="greaseType"]')).toHaveValue('lub2');
  await page.locator('select[name="greaseType"]').selectOption('lub1');
  await expect(page.locator('select[name="greaseType"]')).toHaveValue('lub1');
});

for (const width of [360, 390, 412]) {
  test(`${width}px: solo dos números manuales, controles táctiles y acciones accesibles con viewport reducido`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await bootPage(page);
    await page.evaluate(() => window.startGreaseFlow('e1', document.getElementById('reg-flow-area')));
    await expect(page.locator('#grease-form input[type="number"]')).toHaveCount(2);
    await expect(page.locator('#grease-form input[inputmode="decimal"]')).toHaveCount(2);
    await expect(page.locator('#grease-form input[type="text"]')).toHaveCount(0);
    await expect(page.locator('.grease-flow-equipo-meta')).toContainText('Lubricador de prueba');
    const small = await page.locator('#grease-form select:visible, #grease-form input[type="number"]:visible, #grease-form button:visible, #grease-notes summary').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().height < 44).map(node => node.outerHTML));
    expect(small).toEqual([]);
    await page.setViewportSize({ width, height: 360 });
    await page.locator('input[name="qty"]').focus();
    await page.locator('.btn-grease-submit').scrollIntoViewIfNeeded();
    const box = await page.locator('.btn-grease-submit').boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(360);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('Programación/Turno se muestran como chips compactos (no texto largo) con el dato real del plan', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => window.startGreaseFlow('e1', document.getElementById('reg-flow-area')));
  const chips = await page.locator('.grease-flow-chip-row .grease-flow-daychip').allTextContents();
  expect(chips).toEqual(['Lun', 'Mié', 'Vie']);
});

test('K/I/J — jerarquía de acciones: Finalizar engrase es la primaria (btn-accent), las otras 2 quedan agrupadas aparte', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => window.startGreaseFlow('e1', document.getElementById('reg-flow-area')));
  await expect(page.locator('.btn-grease-submit')).toHaveText(/Finalizar engrase/);
  await expect(page.locator('.btn-grease-submit')).toHaveClass(/btn-accent/);
  // "No se pudo ejecutar" solo aparece si hay una ocurrencia real hoy
  // (lógica de negocio sin tocar, depende del día real de la corrida) — se
  // valida la jerarquía (≥1 secundaria, ninguna btn-accent), nunca un
  // conteo fijo que dependa de qué día cae la ejecución del test.
  const secondary = page.locator('.grease-flow-actions-secondary .btn');
  await expect(page.locator('.grease-flow-actions-secondary #btn-report-anomaly')).toContainText('Reportar anomalía');
  const count = await secondary.count();
  expect(count).toBeGreaterThanOrEqual(1);
  for (const cls of await secondary.evaluateAll(els => els.map(el => el.className))) {
    expect(cls).not.toContain('btn-accent');
  }
});

test('M — 360px: ejecución real sin overflow horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await bootPage(page);
  await page.evaluate(() => window.startGreaseFlow('e1', document.getElementById('reg-flow-area')));
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test('M — temas (Claro/Oscuro/Modo Sol/Alto Contraste): sin errores de página, los chips/sufijos resuelven a un color real', async ({ page }) => {
  await bootPage(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  for (const modo of ['dark', 'light', 'sun', 'contrast']) {
    await page.evaluate((m) => document.documentElement.setAttribute('data-mode', m), modo);
    await page.evaluate(() => window.startGreaseFlow('e1', document.getElementById('reg-flow-area')));
    const chip = page.locator('.grease-flow-daychip').first();
    await expect(chip).toBeVisible();
    const bg = await chip.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('');
  }
  expect(errors).toEqual([]);
});

test('plan por horas (ejecución real): nunca muestra una semana de chips falsa', async ({ page }) => {
  const planHoras = { id: 'planH', equipmentId: 'e1', controlType: 'Horas de operación', frequency: 250, lastGreaseHour: 900, shiftId: null };
  await bootPage(page, { plans: [planHoras], points: [] });
  await page.evaluate(() => window.startGreaseFlow('e1', document.getElementById('reg-flow-area')));
  await expect(page.locator('.grease-flow-chip-row')).toHaveCount(0);
  await expect(page.locator('#reg-flow-area')).toContainText('Cada 250 h');
});
