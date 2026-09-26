// tests/ui/mis-engrases-flow.spec.js
//
// LOTE "Mis Engrases + baseline de validación" — flujo REAL de UI: carga
// las funciones REALES irAMisEngrasesTrasRegistrar()/renderLubricadorHistorial()/
// validationBadgeHTML() (extraídas de app.js) + VALIDATION_STATUS/
// findActiveValidations/validationStatusForRecord/isRecordSubjectToValidation
// (extraídas de src/core/grease-validation.js) dentro de una página real de
// Playwright, con DB reemplazado por un store en memoria (sin red, sin
// IndexedDB real). Objetivo explícito: confirmar con evidencia que la
// regresión reportada ("después de registrar aparece Plan del turno") queda
// corregida — irAMisEngrasesTrasRegistrar() NUNCA debe llamar a navigate()
// dentro del shell del Lubricador, y SIEMPRE debe aterrizar en
// renderLubricadorHistorial() ("Mis Engrases", vista de tarjetas existente).

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, LUBRICATION_STATUS_JS_PATH, GREASE_VALIDATION_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const appSource = readSource(APP_JS_PATH);
const statusSource = readSource(LUBRICATION_STATUS_JS_PATH);
const validationSource = readSource(GREASE_VALIDATION_JS_PATH);

const APP_NAMES = [
  '$', '$$', 'esc', 'fmtDate', 'GREASE_UNIT', 'openModal', 'closeModal',
  'validationBadgeHTML', 'openValidationDetailModal', 'openValidationConflictModal',
  'renderLubricadorHistorial', 'irAMisEngrasesTrasRegistrar',
];
const appRealSrc = APP_NAMES.map(n => extractDeclaration(appSource, n)).join('\n\n');
const fmtSrc = extractDeclaration(statusSource, 'fmt');
const validationRealSrc = [
  'VALIDATION_STATUS', 'VALIDATION_BADGE', 'GREASE_VALIDATION_ENABLED_FROM', 'MAX_VALIDATION_SHIFTS',
  'isRecordSubjectToValidation', 'statusForSignerRole', 'findActiveValidations', 'hasValidationConflict',
  'findActiveValidation', 'shiftKindAt', 'shiftDurationHours', 'shiftWindowStart', 'validationDeadline',
  'isValidationExpired', 'validationStatusFor', 'validationStatusForRecord', 'isRecordPendingValidation',
  'isRecordValidationExpired',
].map(n => extractDeclaration(validationSource, n)).join('\n\n');

const EQUIPOS = [
  { id: 'e1', code: '45-77', brand: 'Caterpillar', model: '740B' },
  { id: 'e2', code: 'T-06', brand: 'Caterpillar', model: 'D8T' },
  { id: 'e3', code: 'EXC-02', brand: 'Komatsu', model: 'PC200' },
];
// Fechas RELATIVAS al momento de correr la prueba (nunca fijas): greg_1 (0
// activas) debe seguir "Pendiente" (dentro del plazo de MAX_VALIDATION_SHIFTS
// turnos) sin importar cuándo se ejecute la suite — con fechas fijas del
// pasado, el plazo real ya las vencía y greg_1 pasaba a "Validación vencida"
// en vez de "Pendiente". El orden relativo (greg_1 > greg_2 > greg_3) se
// conserva para el test de "más reciente primero".
function hace(horas) { return new Date(Date.now() - horas * 3600000).toISOString().slice(0, 19); }
const GREG3_DATE = hace(2);
const RECORDS = [
  { id: 'greg_1', equipmentId: 'e1', date: hace(1), shiftId: 'shift_dia', userId: 'u1', userName: 'Juan Pérez', hourmeter: 5200, qty: 1.5, condition: 'Normal' },
  { id: 'greg_2', equipmentId: 'e2', date: hace(1.5), shiftId: 'shift_noche', userId: 'u1', userName: 'Juan Pérez', hourmeter: 12000, qty: 1.2, condition: 'Normal' },
  { id: 'greg_3', equipmentId: 'e3', date: GREG3_DATE, shiftId: 'shift_dia', userId: 'u1', userName: 'Juan Pérez', hourmeter: 8900, qty: 2.0, condition: 'Con desgaste' },
];
const VALIDATIONS = [
  { id: 'val_1', lubricationRecordId: 'greg_2', signerName: 'Op A', signerRole: 'OPERADOR', signedAt: hace(1.4), active: true },
  { id: 'val_2', lubricationRecordId: 'greg_3', signerName: 'Op B', signerRole: 'OPERADOR', signedAt: hace(1.9), active: true },
  { id: 'val_3', lubricationRecordId: 'greg_3', signerName: 'Enc C', signerRole: 'ENCARGADO', reason: 'Op no disponible', signedAt: hace(1.8), active: true },
];

async function bootPage(page, { lubShell = true } = {}) {
  await page.setContent(lubShell ? `
    <div class="lub-shell">
      <nav class="lub-bottom-nav">
        <button class="lub-nav-item active" data-route="turno"><span>Mi Turno</span></button>
        <button class="lub-nav-item" data-route="historial"><span>Mis Engrases</span></button>
      </nav>
      <main id="app-content" class="lub-content"></main>
    </div>` : `<div id="app-content"></div>`);
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.App = { route: 'turno', currentUser: { id: 'u1', name: 'Juan Pérez' }, generalSettings: { shiftDayStart: 6, shiftNightStart: 18 } };
      window.__navigateCalls = 0;
      window.navigate = (route) => { window.__navigateCalls++; window.App.route = route; };
      window.DB = {
        allActive: async (store) => ({
          lubrication_records: ${JSON.stringify(RECORDS)},
          equipment: ${JSON.stringify(EQUIPOS)},
          grease_validations: ${JSON.stringify(VALIDATIONS)},
        }[store] || []),
        get: async (store, id) => (store === 'lubrication_records' ? ${JSON.stringify(RECORDS)}.find(r => r.id === id) : null),
      };
      window.openEditGreaseRecordForm = () => {};
      window.openValidationModal = () => { window.__openValidationModalCalled = true; };
      window.showInAppToast = () => {};

      ${fmtSrc}
      ${validationRealSrc}
      window.VALIDATION_STATUS = VALIDATION_STATUS; window.VALIDATION_BADGE = VALIDATION_BADGE;
      window.findActiveValidations = findActiveValidations; window.hasValidationConflict = hasValidationConflict;
      window.findActiveValidation = findActiveValidation; window.validationStatusFor = validationStatusFor;
      window.validationStatusForRecord = validationStatusForRecord; window.isRecordPendingValidation = isRecordPendingValidation;
      window.isRecordSubjectToValidation = isRecordSubjectToValidation;
      ${appRealSrc}
      window.$ = $; window.$$ = $$; window.esc = esc; window.fmt = fmt; window.fmtDate = fmtDate;
      window.GREASE_UNIT = GREASE_UNIT;
      window.openModal = openModal; window.closeModal = closeModal;
      window.validationBadgeHTML = validationBadgeHTML;
      window.openValidationDetailModal = openValidationDetailModal;
      window.openValidationConflictModal = openValidationConflictModal;
      window.renderLubricadorHistorial = renderLubricadorHistorial;
      window.irAMisEngrasesTrasRegistrar = irAMisEngrasesTrasRegistrar;
    `,
  });
}

test('REGRESIÓN corregida: dentro del shell del Lubricador, irAMisEngrasesTrasRegistrar() NUNCA llama a navigate() — aterriza directo en Mis Engrases', async ({ page }) => {
  await bootPage(page, { lubShell: true });
  await page.evaluate(() => window.irAMisEngrasesTrasRegistrar());

  const navigateCalls = await page.evaluate(() => window.__navigateCalls);
  expect(navigateCalls).toBe(0); // NUNCA el router de escritorio dentro del shell del Lubricador

  await expect(page.locator('h2.lub-heading')).toHaveText('Mis últimos engrases');
  await expect(page.locator('.lub-record-card')).toHaveCount(3);

  const route = await page.evaluate(() => window.App.route);
  expect(route).toBe('historial');
  await expect(page.locator('.lub-nav-item[data-route="historial"]')).toHaveClass(/active/);
  await expect(page.locator('.lub-nav-item[data-route="turno"]')).not.toHaveClass(/active/);
});

test('Fuera del shell del Lubricador (escritorio), irAMisEngrasesTrasRegistrar() mantiene el comportamiento previo (navigate)', async ({ page }) => {
  await bootPage(page, { lubShell: false });
  await page.evaluate(() => window.irAMisEngrasesTrasRegistrar());

  const navigateCalls = await page.evaluate(() => window.__navigateCalls);
  expect(navigateCalls).toBe(1); // escritorio: sí usa navigate(), sin cambios
});

test('"Mis Engrases" con baseline ACTIVO (fixture de prueba): cards (no tabla), más reciente primero, Turno/Cantidad/Lubricador visibles, estados Pendiente/Validado/Conflicto correctos', async ({ page }) => {
  await bootPage(page, { lubShell: true });
  // CORRECCIÓN CENTRAL (ver docs/GREASE_VALIDATION_AUDIT.md §14): con la
  // constante productiva real (GREASE_VALIDATION_ENABLED_FROM = null),
  // isRecordSubjectToValidation() devuelve SIEMPRE false — ningún registro
  // es "pendiente"/"validado"/"conflicto" todavía (ver el test de más abajo
  // que confirma exactamente eso). Para probar aquí las transiciones de
  // estado 0/1/2+ activas (que sí necesitan un baseline real para
  // manifestarse), se define un baseline EXPLÍCITO solo en esta página de
  // prueba — NUNCA se toca la constante productiva para esto (instrucción
  // explícita: "usar baseline explícito dentro de fixtures/tests").
  await page.evaluate(() => {
    window.isRecordSubjectToValidation = () => true;
  });
  await page.evaluate(() => window.renderLubricadorHistorial());

  await expect(page.locator('table')).toHaveCount(0); // NO tabla horizontal

  const cards = page.locator('.lub-record-card');
  await expect(cards).toHaveCount(3);
  // Más reciente primero: greg_1 (25/09) > greg_2 (24/09) > greg_3 (23/09)
  await expect(cards.nth(0)).toContainText('45-77');
  await expect(cards.nth(1)).toContainText('T-06');
  await expect(cards.nth(2)).toContainText('EXC-02');

  // greg_1: 0 activas → Pendiente + botón Validar
  await expect(cards.nth(0)).toContainText('Pendiente de validación');
  await expect(cards.nth(0).locator('.lub-validar-btn')).toBeVisible();

  // greg_2: 1 activa Operador → Validado · Operador + Ver validación
  await expect(cards.nth(1)).toContainText('Validado · Operador');
  await expect(cards.nth(1).locator('.lub-ver-validacion-btn')).toBeVisible();
  await expect(cards.nth(1).locator('.lub-validar-btn')).toHaveCount(0);

  // greg_3: 2 activas → Conflicto + Ver conflicto
  await expect(cards.nth(2)).toContainText('Conflicto de validación');
  await expect(cards.nth(2).locator('.lub-ver-conflicto-btn')).toBeVisible();

  // Campos pedidos: Turno, Cantidad de grasa, Lubricador
  await expect(cards.nth(0)).toContainText('Turno Día');
  await expect(cards.nth(0)).toContainText('1.5 lb');
  await expect(cards.nth(0)).toContainText('Juan Pérez');

  // "Ver conflicto" abre el modal real con ambas firmas, sin elegir ninguna
  await cards.nth(2).locator('.lub-ver-conflicto-btn').click();
  await expect(page.locator('.modal-head')).toContainText('Conflicto de validación');
  await expect(page.locator('.modal-body')).toContainText('Op B');
  await expect(page.locator('.modal-body')).toContainText('Enc C');
});

test('"Mis Engrases" con baseline REAL (null, SIN override): TODOS los registros son "Histórico · Sin validación requerida", sin ningún botón de acción — nunca "Pendiente" fabricado', async ({ page }) => {
  await bootPage(page, { lubShell: true });
  // Sin ningún window.isRecordSubjectToValidation de prueba — esta es la
  // constante productiva real (null). Los 3 registros (greg_1 con 0 activas,
  // greg_2 con 1, greg_3 con 2) deben mostrarse TODOS como Histórico, sin
  // excepción por cantidad de firmas — la funcionalidad no está activada.
  await page.evaluate(() => window.renderLubricadorHistorial());

  const cards = page.locator('.lub-record-card');
  await expect(cards).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(cards.nth(i)).toContainText('Histórico · Sin validación requerida');
    await expect(cards.nth(i)).not.toContainText('Pendiente de validación');
    await expect(cards.nth(i)).not.toContainText('Validado ·');
    await expect(cards.nth(i)).not.toContainText('Conflicto de validación');
    await expect(cards.nth(i).locator('.lub-validar-btn')).toHaveCount(0);
    await expect(cards.nth(i).locator('.lub-ver-validacion-btn')).toHaveCount(0);
    await expect(cards.nth(i).locator('.lub-ver-conflicto-btn')).toHaveCount(0);
  }
});

test('Móvil 412px: "Mis Engrases" sigue siendo cards apiladas, sin tabla ni scroll horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 800 });
  await bootPage(page, { lubShell: true });
  await page.evaluate(() => window.renderLubricadorHistorial());

  await expect(page.locator('table')).toHaveCount(0);
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test('Baseline histórico (simulado): un registro anterior al rollout muestra "Histórico · Sin validación requerida" y SIN botón Validar', async ({ page }) => {
  await bootPage(page, { lubShell: true });
  // Simula que GREASE_VALIDATION_ENABLED_FROM YA está configurado, marcando
  // greg_3 como anterior al rollout — sin tocar la constante real (que sigue
  // en null hasta que el usuario defina la fecha, ver
  // docs/GREASE_VALIDATION_AUDIT.md §14). Solo se sustituye la función pura
  // en esta página de prueba, igual que se stubean DB/openModal en el resto
  // de la suite — NO es un cambio de la lógica real.
  await page.evaluate((greg3Date) => {
    window.isRecordSubjectToValidation = (date) => date !== greg3Date;
  }, GREG3_DATE);
  await page.evaluate(() => window.renderLubricadorHistorial());

  const cards = page.locator('.lub-record-card');
  const historico = cards.nth(2); // greg_3
  await expect(historico).toContainText('Histórico · Sin validación requerida');
  await expect(historico).not.toContainText('Pendiente de validación');
  await expect(historico.locator('button:has-text("Validar")')).toHaveCount(0);
  await expect(historico.locator('.lub-ver-conflicto-btn')).toHaveCount(0); // ni conflicto: histórico gana siempre

  // Los demás (sujetos a validación) no se ven afectados
  await expect(cards.nth(0)).toContainText('Pendiente de validación');
});
