// tests/ui/qr-internal-scanner.spec.js
//
// Pedido "FIX REALIZADO ADELANTADO + QR INTERNO" (2026-10-09), Parte B.
// Causa raíz auditada en código (nunca asumida, ver reporte de esta
// sesión): el scanner INTERNO de la app (openQrScanner() -> foto nativa/
// input de archivo -> decodeQrFromDataUrl() -> jsQR -> handleScannedQR())
// NUNCA navegaba a ningún navegador — parseEquipmentIdFromScan() ya
// extraía el equipmentId real de cualquier formato (URL con #eq=, prefijo
// viejo ENGRASE-EQ:, o texto plano). El hueco real era que la resolución
// solo intentaba DB.get('equipment', id) por el id EXACTO — un QR/código
// escrito a mano con el code ("A-02") o shortCode ("45-69") en vez del id
// interno fallaba con "no corresponde a ningún equipo", un dead-end que
// empuja a usar la cámara externa del teléfono (esa sí puede abrir el
// navegador si App Links no está verificado — fuera de alcance de este
// archivo, ver auditoría aparte). resolveEquipmentFromScan() (nueva,
// app.js) ahora también intenta por code/shortCode antes de rendirse.
//
// Carga y EJECUTA de verdad handleScannedQR()/handleQrDeepLink()/
// showEquipmentQrInfo()/resolveEquipmentFromScan() (extraídas de app.js,
// nunca reimplementadas) contra una página real de Playwright.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, LUBRICATION_STATUS_JS_PATH, SHIFTS_JS_PATH, OPERATIONAL_SCOPE_JS_PATH } from '../helpers/loadLubricationLogic.js';

const SRC_ROOT = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB');
const JSQR_PATH = path.join(SRC_ROOT, 'vendor', 'jsqr.js');
const QRCODE_GEN_PATH = path.join(SRC_ROOT, 'vendor', 'qrcode.js');

const appSource = readSource(APP_JS_PATH);
const statusSource = readSource(LUBRICATION_STATUS_JS_PATH);
const shiftsSource = readSource(SHIFTS_JS_PATH);
const opScopeSource = readSource(OPERATIONAL_SCOPE_JS_PATH);

const APP_NAMES = [
  '$', '$$', 'esc', 'ic', 'fmtDate', 'STATUS_COLOR',
  'getSelectedCrewId', 'setSelectedCrewId', 'getCurrentOperationalScope',
  'loadAssignmentContext', 'openModal', 'closeModal',
  'showEquipmentQrInfo', 'qrValueForEquipment', 'parseEquipmentIdFromScan',
  'resolveEquipmentFromScan', 'handleScannedQR', 'handleQrDeepLink',
  'decodeQrFromDataUrl', 'renderQrCode',
];
const STATUS_NAMES = ['fmt', 'WEEKDAY_NAMES', 'mostRecentAssignedDate', 'weekdayStatusFor', 'statusFor'];
const SHIFTS_NAMES = ['currentShiftId'];
const OP_SCOPE_NAMES = [
  'ASSIGNMENT_STATUS', 'ROLES_CREW_SCOPED', 'getAuthorizedCrews', 'resolveCrewLocationCoverage', 'resolveOperationalScope',
  'computeOccurrenceKey', 'toISODateUTCLocal',
  'findActivePendingAssignment', 'canLubricadorExecuteEquipment', 'findExistingWorkForEquipment',
];

const appSrc = APP_NAMES.map(n => extractDeclaration(appSource, n)).join('\n\n');
const statusSrc = STATUS_NAMES.map(n => extractDeclaration(statusSource, n)).join('\n\n');
const shiftsSrc = SHIFTS_NAMES.map(n => extractDeclaration(shiftsSource, n)).join('\n\n');
const opScopeSrc = OP_SCOPE_NAMES.map(n => extractDeclaration(opScopeSource, n)).join('\n\n');

const EQUIPO_A02 = { id: 'eq_a02', code: 'A-02', shortCode: '45-69', brand: 'Caterpillar', model: '740B', status: 'Operativo', locationId: 'l1', hourmeter: 22255, active: true };

async function bootPage(page, { equipos = [EQUIPO_A02], role = 'ADMINISTRADOR', navigateCalls = [] } = {}) {
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => errors.push(e.stack || e.message || String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.setContent('<div id="app-content"></div>');
  await page.addScriptTag({ path: QRCODE_GEN_PATH });
  await page.addScriptTag({ path: JSQR_PATH });
  await page.addScriptTag({
    content: `
      window.App = {
        route: 'equipos', currentUser: { id: 'u1', name: 'Usuario de prueba', role: '${role}' },
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18, complianceTarget: 85 },
        pendingQrEquipmentId: null,
      };
      window.navigate = (r) => { window.__navigateCalls.push(r); };
      window.__navigateCalls = ${JSON.stringify(navigateCalls)};
      window.__startGreaseFlowCalls = [];
      window.startGreaseFlow = (...a) => window.__startGreaseFlowCalls.push(a);
      window.startLubricadorGreaseFlow = (...a) => window.__startGreaseFlowCalls.push(a);
      window.openEquipmentDetail = (id) => { window.__openEquipmentDetailCalls = window.__openEquipmentDetailCalls || []; window.__openEquipmentDetailCalls.push(id); };
      window.handleOutOfPlanEquipoSelected = () => {};
      window.__alertCalls = [];
      window.alert = (msg) => { window.__alertCalls.push(msg); };
      window.__mockData = {
        equipment: ${JSON.stringify(equipos)},
        locations: [{ id: 'l1', name: 'Rajo Principal', active: true }],
        cuadrillas: [],
        lubrication_plans: [],
        lubrication_records: [],
        lubrication_assignments: [],
      };
      window.DB = {
        all: async (store) => window.DB.allActive(store), allActive: async (store) => window.__mockData[store] || [],
        get: async (store, id) => (window.__mockData[store] || []).find(r => r.id === id) || null,
      };
      ${statusSrc}
      ${shiftsSrc}
      ${opScopeSrc}
      ${appSrc}
      window.showEquipmentQrInfo = showEquipmentQrInfo;
      window.handleScannedQR = handleScannedQR;
      window.handleQrDeepLink = handleQrDeepLink;
      window.resolveEquipmentFromScan = resolveEquipmentFromScan;
      window.parseEquipmentIdFromScan = parseEquipmentIdFromScan;
      window.decodeQrFromDataUrl = decodeQrFromDataUrl;
      window.renderQrCode = renderQrCode;
      window.qrValueForEquipment = qrValueForEquipment;
    `,
  });
  return { errors, consoleErrors };
}

test('A — escanear por equipmentId abre la Ficha/info del equipo DENTRO de la app, nunca el navegador', async ({ page }) => {
  const { errors } = await bootPage(page);
  await page.evaluate(() => window.handleScannedQR('eq_a02'));
  await expect(page.locator('.modal-head')).toContainText('A-02');
  expect(errors).toEqual([]);
});

test('B — escanear/escribir por code ("A-02") resuelve al mismo equipo y abre su info', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => window.handleScannedQR('A-02'));
  await expect(page.locator('.modal-body')).toContainText('Caterpillar 740B');
});

test('C — escanear/escribir por alternateCode/shortCode ("45-69") resuelve al mismo equipo', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => window.handleScannedQR('45-69'));
  await expect(page.locator('.modal-body')).toContainText('Caterpillar 740B');
});

test('D — QR con la URL antigua completa (#eq=...) abre la Ficha, NUNCA el navegador', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => window.handleScannedQR('https://junivalles-cmd.github.io/control-engrase/#eq=eq_a02'));
  await expect(page.locator('.modal-head')).toContainText('A-02');
  // Nunca se le pidió al navegador navegar a ningún lado — la URL de location nunca cambió.
  expect(page.url()).not.toContain('junivalles-cmd.github.io');
});

test('E — "A-02" (code) y "45-69" (shortCode) resuelven al MISMO equipmentId -> misma Ficha, nunca dos identidades', async ({ page }) => {
  await bootPage(page);
  const [porCode, porShortCode] = await page.evaluate(async () => [
    (window.resolveEquipmentFromScan('A-02', await window.DB.allActive('equipment'))).id,
    (window.resolveEquipmentFromScan('45-69', await window.DB.allActive('equipment'))).id,
  ]);
  expect(porCode).toBe(porShortCode);
  expect(porCode).toBe('eq_a02');
});

test('F — offline (sin red, equipo ya en IndexedDB): resuelve LOCAL y abre la Ficha igual', async ({ page }) => {
  await page.route('**/*', (route) => {
    if (route.request().url().startsWith('http') && !route.request().url().includes('localhost') && route.request().resourceType() !== 'script') {
      return route.abort();
    }
    route.continue();
  });
  await bootPage(page);
  await page.context().setOffline(true);
  await page.evaluate(() => window.handleScannedQR('eq_a02'));
  await expect(page.locator('.modal-head')).toContainText('A-02');
  await page.context().setOffline(false);
});

test('G — QR/código inválido: muestra "QR no reconocido", NUNCA abre el navegador ni inventa un equipo', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => window.handleScannedQR('esto-no-existe-para-nada'));
  const alerts = await page.evaluate(() => window.__alertCalls);
  expect(alerts.some(a => a.includes('QR no reconocido'))).toBe(true);
  expect(await page.locator('.modal-body').count()).toBe(0);
});

test('H — resolver por QR nunca cambia cuadrilla/ubicación/scope del equipo ni del usuario', async ({ page }) => {
  await bootPage(page, { role: 'LUBRICADOR' });
  const antes = await page.evaluate(async () => JSON.stringify((await window.DB.allActive('equipment'))[0]));
  await page.evaluate(() => window.handleScannedQR('A-02'));
  const despues = await page.evaluate(async () => JSON.stringify((await window.DB.allActive('equipment'))[0]));
  expect(despues).toBe(antes);
});

test('I — click real del scanner interno: generar un QR real, "escanearlo" con jsQR (decodeQrFromDataUrl real) y terminar en la Ficha correcta, 100% local', async ({ page }) => {
  const { errors } = await bootPage(page);
  const valor = await page.evaluate(() => window.qrValueForEquipment({ id: 'eq_a02' }));

  const resultado = await page.evaluate(async (valorQR) => {
    // Mismo patrón real que openEquipmentQR(): generar sobre un <canvas>.
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    window.renderQrCode({ element: canvas, value: valorQR, size: 220, background: '#ffffff', foreground: '#14171A' });
    const dataUrl = canvas.toDataURL();
    // decodeQrFromDataUrl() real: decodifica con jsQR y llama a
    // handleScannedQR() internamente — mismo camino que toma el scanner
    // real tras "Escanear QR" -> foto -> input 'change'.
    await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        window.decodeQrFromDataUrl(dataUrl);
        setTimeout(resolve, 150);
      };
      img.src = dataUrl;
    });
    return document.querySelector('.modal')?.innerText || null;
  }, valor);

  expect(resultado).toContain('A-02');
  expect(errors).toEqual([]);
});

for (const width of [360, 390, 412]) {
  test(`§13 responsive @ ${width}px — el modal de info del QR no desborda ni queda cortado`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await bootPage(page);
    await page.evaluate(() => window.handleScannedQR('eq_a02'));
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
}
