// tests/ui/storage-privacy-evidence.spec.js
//
// P0-3 — preparación de Storage privado/autenticado (ver
// docs/STORAGE_PRIVACY_DESIGN.md). El bucket `engrase-photos` SIGUE público
// en producción — este archivo prueba que la resolución de evidencia
// (resolveEvidenceSrc() + openValidationDetailModal()/
// openValidationConflictModal(), funciones REALES extraídas de app.js) usa
// un signed URL en vez de la URL cruda del bucket cuando el dispositivo no
// tiene la copia local (base64), con Sync.getSignedPhotoUrl() reemplazado
// por un espía — nunca contra Supabase real. La firma es el caso más
// sensible (contenido identificable, ver §8 del pedido de Storage privado);
// el mismo mecanismo (resolveEvidenceSrc) es el que usa el galería de
// Reportes (drawPhotoReport → pintarTanda) para fotos de engrase/anomalías,
// probado aparte a nivel de unidad (no se re-extrae aquí: demasiadas
// dependencias de DOM/Chart.js/filtros ajenas a esta prueba puntual, ver
// tests/unit/storage-privacy.test.js para Sync.getSignedPhotoUrl() en sí).

import { test, expect } from '@playwright/test';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, GREASE_VALIDATION_JS_PATH, LUBRICATION_STATUS_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const validationSource = readSource(GREASE_VALIDATION_JS_PATH);
const statusSource = readSource(LUBRICATION_STATUS_JS_PATH);

const APP_NAMES = ['$', '$$', 'esc', 'fmtDate', 'openModal', 'closeModal', 'validationBadgeHTML', 'resolveEvidenceSrc', 'openValidationDetailModal', 'openValidationConflictModal'];
const appRealSrc = APP_NAMES.map(n => extractDeclaration(appSource, n)).join('\n\n');
const fmtSrc = extractDeclaration(statusSource, 'fmt');
const validationRealSrc = ['VALIDATION_STATUS', 'VALIDATION_BADGE', 'statusForSignerRole'].map(n => extractDeclaration(validationSource, n)).join('\n\n');

const EQUIPMENT = { id: 'e1', code: '45-77', brand: 'Caterpillar', model: '740B' };
const CFG = { url: 'https://fake.supabase.co', anonKey: 'anon-test' };
const LEGACY_URL = `${CFG.url}/storage/v1/object/public/engrase-photos/grease_validations/val_1.png`;
const SIGNED_URL = `${CFG.url}/storage/v1/object/sign/engrase-photos/grease_validations/val_1.png?token=abc123`;

async function bootPage(page, { signedUrlResult = SIGNED_URL } = {}) {
  await page.setContent('<div id="app-content"></div>');
  await page.addScriptTag({
    content: `
      window.App = { currentUser: { id: 'u1', name: 'Ana Supervisora' } };
      window.DB = { getConfig: async () => (${JSON.stringify(CFG)}) };
      window.__signedUrlCalls = [];
      window.Sync = {
        getSignedPhotoUrl: async (value, cfg) => {
          window.__signedUrlCalls.push({ value, cfg });
          return ${JSON.stringify(signedUrlResult)};
        },
      };

      ${fmtSrc}
      ${validationRealSrc}
      ${appRealSrc}
      window.resolveEvidenceSrc = resolveEvidenceSrc;
      window.openModal = openModal; window.closeModal = closeModal;
      window.openValidationDetailModal = openValidationDetailModal;
      window.openValidationConflictModal = openValidationConflictModal;
    `,
  });
}

test.describe('resolveEvidenceSrc() — base64 local nunca pide signed URL (E: offline, cero red)', () => {
  test('base64: devuelve el valor directo, sin llamar a Sync.getSignedPhotoUrl', async ({ page }) => {
    await bootPage(page);
    const result = await page.evaluate(() => window.resolveEvidenceSrc('data:image/png;base64,AAAA'));
    const calls = await page.evaluate(() => window.__signedUrlCalls);
    expect(result).toBe('data:image/png;base64,AAAA');
    expect(calls).toHaveLength(0);
  });

  test('null/vacío: devuelve null, sin llamar a Sync.getSignedPhotoUrl', async ({ page }) => {
    await bootPage(page);
    const result = await page.evaluate(() => window.resolveEvidenceSrc(null));
    const calls = await page.evaluate(() => window.__signedUrlCalls);
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

test.describe('resolveEvidenceSrc() — URL/path de Storage pide un signed URL (H: mismo mecanismo que usa Reportes)', () => {
  test('URL pública (legacy, I: sigue soportada): pide un signed URL con la config real y lo devuelve', async ({ page }) => {
    await bootPage(page);
    const result = await page.evaluate((url) => window.resolveEvidenceSrc(url), LEGACY_URL);
    const calls = await page.evaluate(() => window.__signedUrlCalls);
    expect(result).toBe(SIGNED_URL);
    expect(calls).toHaveLength(1);
    expect(calls[0].value).toBe(LEGACY_URL);
    expect(calls[0].cfg).toEqual(CFG);
  });

  test('si Sync.getSignedPhotoUrl devuelve null (sin sesión, sin red, etc.): cae de vuelta a la URL original, nunca deja de mostrar algo', async ({ page }) => {
    await bootPage(page, { signedUrlResult: null });
    const result = await page.evaluate((url) => window.resolveEvidenceSrc(url), LEGACY_URL);
    expect(result).toBe(LEGACY_URL);
  });
});

test.describe('G) Firma privada — openValidationDetailModal()/openValidationConflictModal() usan signed URL cuando no hay copia local', () => {
  test('con signatureLocal (base64, este dispositivo la creó): se muestra directo, SIN pedir signed URL', async ({ page }) => {
    await bootPage(page);
    await page.evaluate(async (equipment) => {
      const validation = {
        id: 'val_1', signerName: 'María López', signerRole: 'OPERADOR',
        signedAt: '2026-09-24T18:20:00', signatureLocal: 'data:image/png;base64,ZZZZ', active: true,
      };
      await window.openValidationDetailModal(validation, equipment);
    }, EQUIPMENT);

    await expect(page.locator('.val-signature-wrap img')).toHaveAttribute('src', 'data:image/png;base64,ZZZZ');
    const calls = await page.evaluate(() => window.__signedUrlCalls);
    expect(calls).toHaveLength(0);
  });

  test('SIN signatureLocal, solo signatureUrl (otro dispositivo la subió): se muestra el SIGNED URL, nunca la URL cruda del bucket', async ({ page }) => {
    await bootPage(page);
    await page.evaluate(async ({ equipment, url }) => {
      const validation = {
        id: 'val_1', signerName: 'María López', signerRole: 'OPERADOR',
        signedAt: '2026-09-24T18:20:00', signatureLocal: null, signatureUrl: url, active: true,
      };
      await window.openValidationDetailModal(validation, equipment);
    }, { equipment: EQUIPMENT, url: LEGACY_URL });

    await expect(page.locator('.val-signature-wrap img')).toHaveAttribute('src', SIGNED_URL);
  });

  test('conflicto (2 firmas activas): cada una resuelve su propio signed URL en paralelo, sin mezclarse entre sí', async ({ page }) => {
    await bootPage(page);
    await page.evaluate(async (equipment) => {
      const validations = [
        { id: 'val_a', signerName: 'Operador A', signerRole: 'OPERADOR', signedAt: '2026-09-24T18:20:00', signatureLocal: 'data:image/png;base64,LOCAL_A', active: true },
        { id: 'val_b', signerName: 'Encargado B', signerRole: 'ENCARGADO', reason: 'x', signedAt: '2026-09-24T18:22:00', signatureLocal: null, signatureUrl: 'https://fake.supabase.co/storage/v1/object/public/engrase-photos/grease_validations/val_b.png', active: true },
      ];
      await window.openValidationConflictModal(validations, equipment);
    }, EQUIPMENT);

    const imgs = page.locator('.val-conflict-item img');
    await expect(imgs).toHaveCount(2);
    await expect(imgs.nth(0)).toHaveAttribute('src', 'data:image/png;base64,LOCAL_A'); // base64 local, directo
    await expect(imgs.nth(1)).toHaveAttribute('src', SIGNED_URL); // sin copia local -> signed URL
  });
});
