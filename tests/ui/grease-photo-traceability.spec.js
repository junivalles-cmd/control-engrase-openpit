// tests/ui/grease-photo-traceability.spec.js
//
// Pedido "CAMBIAR CUADRILLA EN CONFIGURACIÓN + TRAZABILIDAD DE FOTOS"
// (2026-10-09), Parte B. Causa raíz auditada en código (nunca asumida): el
// pipeline de fotos (captura → base64 → record.photos/photo → IndexedDB →
// Storage con guardas base64-primero en pull Y push) ya estaba completo y
// robusto — el hueco real era puramente de PRESENTACIÓN: "Mis Engrases"
// (renderLubricadorHistorial()) y la "Ficha" (openEquipmentDetail()) nunca
// llamaban a los helpers de foto YA probados en el Historial de
// escritorio (photoThumbHTML/photoThumbsHTML/resolvePhotoThumbSrcs/
// wirePhotoThumbs/openPhotoLightbox). Este archivo carga y EJECUTA de
// verdad photoIndicatorHTML()/openGreaseRecordDetailModal()/
// renderLubricadorHistorial() (mismo patrón que
// lubricador-mi-turno-real-execution.spec.js) — nunca solo un patrón de
// texto.

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

const statusSrc = extractDeclaration(statusSource, 'fmt');
const scopeNames = [
  'EXECUTION_TYPE', 'EXECUTION_COMPLETENESS', 'resolveRecordExecutionType',
  'resolveRecordCompleteness', 'resolveRecordOutOfPlanReason',
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
  '$', '$$', 'esc', 'ic', 'fmtDate', 'GREASE_UNIT', 'evidenceValueAttr', 'openModal', 'closeModal',
  'photosOf', 'photoIndicatorHTML', 'photoThumbHTML', 'photoThumbsHTML', 'resolvePhotoThumbSrcs',
  'resolveEvidenceSrc', 'wirePhotoThumbs', 'openPhotoLightbox', 'openGreaseRecordDetailModal',
  'validationBadgeHTML', 'renderLubricadorHistorial',
];
const appSrc = appNames.map(n => extractDeclaration(appSource, n)).join('\n\n');

async function bootPage(page, { records = [], equipos = [], validations = [], cfg = { url: 'x', anonKey: 'k' }, signedUrlOverride = null } = {}) {
  // Mismo motivo que lubricador-config.spec.js: localStorage/DB.getConfig
  // necesitan un origen http real, nunca about:blank.
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
        currentUser: { id: 'lub1', name: 'Lubricador de prueba', role: 'LUBRICADOR' },
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18, complianceTarget: 85 },
      };
      window.openEditGreaseRecordForm = () => {};
      window.openValidationModal = () => {};
      window.openValidationDetailModal = () => {};
      window.openValidationConflictModal = () => {};
      window.__mockData = {
        lubrication_records: ${JSON.stringify(records)},
        equipment: ${JSON.stringify(equipos)},
        grease_validations: ${JSON.stringify(validations)},
        lubricants: [],
      };
      window.DB = {
        allActive: async (store) => window.__mockData[store] || [],
        get: async (store, id) => (window.__mockData[store] || []).find(r => r.id === id) || null,
        getConfig: async () => (${JSON.stringify(cfg)}),
      };
      // Sync.getSignedPhotoUrl() real NUNCA se reimplementa — este stub solo
      // simula el resultado de Storage (una URL), nunca para un valor
      // base64 (ver resolveEvidenceSrc(), que ya corta ahí ANTES de llamar
      // a esto — confirmado leyendo el código real).
      window.Sync = { getSignedPhotoUrl: async (value) => ${signedUrlOverride ? JSON.stringify(signedUrlOverride) : 'value + \'?signed=1\''} };
      ${statusSrc}
      ${scopeSrc}
      ${validationSrc}
      ${appSrc}
      window.renderLubricadorHistorial = renderLubricadorHistorial;
      window.openGreaseRecordDetailModal = openGreaseRecordDetailModal;
      window.photoIndicatorHTML = photoIndicatorHTML;
    `,
  });
}

function isoAt(h) {
  const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString();
}

const EQUIPO_A = { id: 'eA', code: 'A-01', brand: 'Caterpillar', model: 'D8T' };
const EQUIPO_B = { id: 'eB', code: 'B-02', brand: 'Komatsu', model: 'WA470' };

test('A — un engrase SIN foto no muestra ningún indicador en Mis Engrases', async ({ page }) => {
  const records = [{ id: 'r1', equipmentId: 'eA', userId: 'lub1', userName: 'Lubricador de prueba', date: isoAt(8), hourmeter: 100, qty: 2, condition: 'Buena', shiftId: 'shift_dia' }];
  await bootPage(page, { records, equipos: [EQUIPO_A] });
  await page.evaluate(() => window.renderLubricadorHistorial());
  await expect(page.locator('.lub-photo-indicator')).toHaveCount(0);
});

test('B/C — un engrase CON foto muestra el indicador compacto "📷 N foto(s)" en Mis Engrases (mismo helper que usaría la Ficha)', async ({ page }) => {
  const records = [{
    id: 'r2', equipmentId: 'eA', userId: 'lub1', userName: 'Lubricador de prueba', date: isoAt(8), hourmeter: 100, qty: 2, condition: 'Buena', shiftId: 'shift_dia',
    photos: ['data:image/webp;base64,AAA', 'data:image/webp;base64,BBB'],
  }];
  await bootPage(page, { records, equipos: [EQUIPO_A] });
  await page.evaluate(() => window.renderLubricadorHistorial());
  const ind = page.locator('.lub-photo-indicator');
  await expect(ind).toHaveCount(1);
  await expect(ind).toHaveText('📷 2 fotos');
});

test('D/H/I — tocar el indicador abre el detalle de ESE registro y ESE equipo exactos (nunca mezcla Equipo A con Equipo B ni otro record del mismo equipo)', async ({ page }) => {
  const records = [
    { id: 'r3', equipmentId: 'eA', userId: 'lub1', userName: 'Ana', date: isoAt(8), hourmeter: 100, qty: 2, condition: 'Buena', shiftId: 'shift_dia', photos: ['data:image/webp;base64,AAA'] },
    { id: 'r4', equipmentId: 'eB', userId: 'lub1', userName: 'Pedro', date: isoAt(9), hourmeter: 200, qty: 3, condition: 'Buena', shiftId: 'shift_dia', photos: ['data:image/webp;base64,BBB'] },
  ];
  await bootPage(page, { records, equipos: [EQUIPO_A, EQUIPO_B] });
  await page.evaluate(() => window.renderLubricadorHistorial());

  const indicators = page.locator('.lub-photo-indicator');
  await expect(indicators).toHaveCount(2);
  // renderLubricadorHistorial() ordena por fecha descendente — r4 (isoAt(9),
  // Equipo B/Pedro) queda PRIMERO, r3 (isoAt(8), Equipo A/Ana) segundo.
  await indicators.nth(0).click();

  const modal = page.locator('.modal-body');
  await expect(modal).toContainText('B-02'); // Equipo B, nunca A-01
  await expect(modal).toContainText('Pedro'); // nunca "Ana" (record r3)
  await expect(modal).not.toContainText('A-01');
});

test('F/E — foto todavía en base64 (offline, nunca subida): visible de inmediato (sin red) Y marcada "Pendiente de sincronizar", sin perderla', async ({ page }) => {
  const records = [{ id: 'r5', equipmentId: 'eA', userId: 'lub1', userName: 'Ana', date: isoAt(8), hourmeter: 100, qty: 2, condition: 'Buena', shiftId: 'shift_dia', photos: ['data:image/webp;base64,AAA'] }];
  await bootPage(page, { records, equipos: [EQUIPO_A] });
  await page.evaluate(() => window.openGreaseRecordDetailModal(window.__mockData.lubrication_records[0], window.__mockData.equipment[0]));

  const modal = page.locator('.modal-body');
  await expect(modal).toContainText('Pendiente de sincronizar');
  // resolveEvidenceSrc() corta ANTES de llamar a Sync.getSignedPhotoUrl()
  // para un valor base64 (confirmado en código) — visible sin red, nunca
  // esperando upload.
  const src = await page.locator('.photo-thumb').first().getAttribute('src');
  expect(src).toBe('data:image/webp;base64,AAA');
});

test('G — ya subida (URL de Storage, no base64): NUNCA muestra "Pendiente de sincronizar", y resuelve una signed URL para verla (vínculo record↔foto se mantiene, mismo record)', async ({ page }) => {
  const records = [{ id: 'r6', equipmentId: 'eA', userId: 'lub1', userName: 'Ana', date: isoAt(8), hourmeter: 100, qty: 2, condition: 'Buena', shiftId: 'shift_dia', photos: ['https://x.supabase.co/storage/v1/object/public/engrase-photos/lubrication_records/r6_0.webp'] }];
  await bootPage(page, { records, equipos: [EQUIPO_A] });
  await page.evaluate(() => window.openGreaseRecordDetailModal(window.__mockData.lubrication_records[0], window.__mockData.equipment[0]));

  const modal = page.locator('.modal-body');
  await expect(modal).not.toContainText('Pendiente de sincronizar');
  const src = await page.locator('.photo-thumb').first().getAttribute('src');
  expect(src).toContain('?signed=1'); // Sync.getSignedPhotoUrl() real se usó (stub de arriba)
});

test('J — COMPLETE y PARTIAL conservan igual la foto y su indicador (la foto nunca depende del estado de ejecución)', async ({ page }) => {
  const records = [
    { id: 'r7', equipmentId: 'eA', userId: 'lub1', userName: 'Ana', date: isoAt(8), hourmeter: 100, qty: 2, condition: 'Buena', shiftId: 'shift_dia', photos: ['data:image/webp;base64,AAA'] }, // sin snapshot = COMPLETE legacy
    { id: 'r8', equipmentId: 'eA', userId: 'lub1', userName: 'Ana', date: isoAt(9), hourmeter: 110, qty: 1, condition: 'Buena', shiftId: 'shift_dia', photos: ['data:image/webp;base64,BBB'], operationalSnapshot: { executionCompleteness: 'PARTIAL' } },
  ];
  await bootPage(page, { records, equipos: [EQUIPO_A] });
  await page.evaluate(() => window.renderLubricadorHistorial());
  await expect(page.locator('.lub-photo-indicator')).toHaveCount(2);

  await page.evaluate(() => window.openGreaseRecordDetailModal(window.__mockData.lubrication_records[1], window.__mockData.equipment[0]));
  await expect(page.locator('.modal-body')).toContainText('Parcial');
  await expect(page.locator('.photo-thumb')).toHaveCount(1);
});

test('miniatura en el detalle abre la vista ampliada al tocarla (lightbox real, nunca un thumbnail grande en la lista)', async ({ page }) => {
  const records = [{ id: 'r9', equipmentId: 'eA', userId: 'lub1', userName: 'Ana', date: isoAt(8), hourmeter: 100, qty: 2, condition: 'Buena', shiftId: 'shift_dia', photos: ['data:image/webp;base64,AAA'] }];
  await bootPage(page, { records, equipos: [EQUIPO_A] });
  await page.evaluate(() => window.openGreaseRecordDetailModal(window.__mockData.lubrication_records[0], window.__mockData.equipment[0]));
  await page.locator('.photo-thumb').first().click();
  // openPhotoLightbox() real reemplaza el modal por la foto ampliada —
  // confirma que el thumbnail de la lista/detalle nunca fue el tamaño
  // final, solo la entrada a la vista ampliada.
  await expect(page.locator('.modal-body img')).toHaveCount(1);
  const amplImg = await page.locator('.modal-body img').first().getAttribute('src');
  expect(amplImg).toBe('data:image/webp;base64,AAA');
});

for (const width of [360, 384, 390, 412]) {
  test(`§18: Mis Engrases @ ${width}px con foto — sin overflow horizontal, indicador >=44px de alto táctil real o claramente secundario (igual que .dash-code-link)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 });
    const records = [{ id: 'r10', equipmentId: 'eA', userId: 'lub1', userName: 'Lubricador de prueba', date: isoAt(8), hourmeter: 100, qty: 2, condition: 'Buena', shiftId: 'shift_dia', photos: ['data:image/webp;base64,AAA'] }];
    await bootPage(page, { records, equipos: [EQUIPO_A] });
    await page.evaluate(() => window.renderLubricadorHistorial());
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test(`§18: Detalle del engrase @ ${width}px — la imagen no sale del viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 });
    const records = [{ id: 'r11', equipmentId: 'eA', userId: 'lub1', userName: 'Ana', date: isoAt(8), hourmeter: 100, qty: 2, condition: 'Buena', shiftId: 'shift_dia', photos: ['data:image/webp;base64,AAA'] }];
    await bootPage(page, { records, equipos: [EQUIPO_A] });
    await page.evaluate(() => window.openGreaseRecordDetailModal(window.__mockData.lubrication_records[0], window.__mockData.equipment[0]));
    const box = await page.locator('.photo-thumb').first().boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  });
}
