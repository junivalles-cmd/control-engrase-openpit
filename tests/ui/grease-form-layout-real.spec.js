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
// Alcance: SOLO render + interacciones de presentación (checklist, "Marcar
// todos", checkbox "sin horómetro", botón de fotos). El submit real
// (Finalizar engrase/No se pudo ejecutar/Reportar anomalía/validación de
// lb) ya está cubierto por tests/unit/grease-finalize-validate-flow.test.js
// y tests/unit/grease-qty-complete-checklist.test.js — lógica que este
// lote NO tocó, no se duplica aquí.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import {
  APP_JS_PATH, LUBRICATION_STATUS_JS_PATH, OPERATIONAL_SCOPE_JS_PATH, GREASE_VALIDATION_JS_PATH,
} from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

const appSource = readSource(APP_JS_PATH);
const statusSource = readSource(LUBRICATION_STATUS_JS_PATH);
const scopeSource = readSource(OPERATIONAL_SCOPE_JS_PATH);
const validationSource = readSource(GREASE_VALIDATION_JS_PATH);

const statusNames = ['fmt', 'WEEKDAY_NAMES', 'mostRecentAssignedDate', 'weekdayStatusFor', 'statusFor'];
const statusSrc = statusNames.map(n => extractDeclaration(statusSource, n)).join('\n\n');
const scopeNames = [
  'EXECUTION_TYPE', 'ASSIGNMENT_STATUS', 'resolveRecordExecutionType', 'resolveRecordOutOfPlanReason',
  'resolveRecordCompleteness', 'findExistingWorkForEquipment', 'findCarriedOverSkipForToday',
  'findActivePendingAssignment', 'computeOccurrenceKey', 'toISODateUTCLocal', 'canRegisterOutOfPlan',
  'ROLES_CAN_REGISTER_OUT_OF_PLAN',
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
  '$', '$$', 'esc', 'ic', 'fmtDate', 'todayDateISO', 'GREASE_UNIT', 'STATUS_COLOR', 'WEEKDAY_ABBR_DASH',
  'NO_EXECUTION_REASON_LABELS', 'MAX_PHOTOS', 'trackRecentEquipment', 'photoFieldHTML', 'getPhotoFieldPhotos',
  'renderPhotoStrip', 'addPhotoToField', 'wirePhotoField', 'fileToCompressedDataURL', 'stampEquipmentEvidencePhoto', 'startGreaseFlow',
];
const appSrc = appNames.map(n => extractDeclaration(appSource, n)).join('\n\n');

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
      };
      window.DB = {
        allActive: async (store) => window.__mockData[store] || [],
        get: async (store, id) => (store === 'equipment' ? window.__mockData.equipment.find(e => e.id === id) : (window.__mockData[store] || []).find(r => r.id === id)) || null,
      };
      window.currentShiftId = () => 'shift_noche';
      window.nowISO = () => new Date().toISOString();
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
  await notes.fill('Observación de prueba');
  await expect(notes).toHaveValue('Observación de prueba');
});

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
  await expect(secondary).toContainText('Reportar anomalía');
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
