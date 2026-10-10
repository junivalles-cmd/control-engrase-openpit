// tests/ui/grease-validation.spec.js
//
// Validación del engrase con firma — flujo REAL de UI: carga las funciones
// REALES openModal()/closeModal()/openValidationModal()/
// openValidationDetailModal()/validationBadgeHTML() (extraídas de app.js) +
// VALIDATION_STATUS/VALIDATION_BADGE/validateValidationForm()/
// statusForSignerRole()/findActiveValidation() (extraídas de
// src/core/grease-validation.js) dentro de una página real de Playwright,
// con DB reemplazado por un store en memoria (sin red, sin IndexedDB real,
// mismas 3 operaciones — allActive/put/get — que usa el código real). La
// persistencia real en grease_validations (db.js/sync.js) se prueba aparte
// en tests/unit/grease-validation-persistence.test.js.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, DB_JS_PATH, LUBRICATION_STATUS_JS_PATH, GREASE_VALIDATION_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const appSource = readSource(APP_JS_PATH);
const dbSource = readSource(DB_JS_PATH);
const statusSource = readSource(LUBRICATION_STATUS_JS_PATH);
const validationSource = readSource(GREASE_VALIDATION_JS_PATH);

const APP_NAMES = ['$', '$$', 'esc', 'fmtDate', 'GREASE_UNIT', 'openModal', 'closeModal', 'validationBadgeHTML', 'openValidationModal', 'openValidationDetailModal', 'openValidationConflictModal', 'resolveEvidenceSrc', 'evidenceValueAttr'];
const appRealSrc = APP_NAMES.map(n => extractDeclaration(appSource, n)).join('\n\n');
const fmtSrc = extractDeclaration(statusSource, 'fmt');
const dbRealSrc = ['uid', 'nowISO', 'stamp'].map(n => extractDeclaration(dbSource, n)).join('\n\n');
const validationRealSrc = ['VALIDATION_STATUS', 'VALIDATION_BADGE', 'statusForSignerRole', 'validateValidationForm', 'findActiveValidations', 'hasValidationConflict', 'findActiveValidation', 'validationStatusFor'].map(n => extractDeclaration(validationSource, n)).join('\n\n');

const EQUIPMENT = { id: 'e1', code: '45-77', brand: 'Caterpillar', model: '740B' };
const RECORD = {
  id: 'greg_1', equipmentId: 'e1', date: '2026-09-24T18:13:00', shiftId: 'shift_dia',
  userName: 'Juan Pérez', hourmeter: 5200, qty: 1.5,
};

async function bootPage(page) {
  await page.setContent('<div id="app-content"></div>');
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.App = { currentUser: { id: 'u1', name: 'Ana Supervisora' } };
      // DB fake en memoria — mismas 3 operaciones (allActive/put/get) que el
      // código real usa contra IndexedDB, sin red ni persistencia real.
      window.__stores = { anomalies: [], grease_validations: [] };
      window.DB = {
        allActive: async (store) => (window.__stores[store] || []).filter(r => r.active !== false),
        put: async (store, obj) => {
          window.__stores[store] = window.__stores[store] || [];
          const i = window.__stores[store].findIndex(r => r.id === obj.id);
          if (i >= 0) window.__stores[store][i] = obj; else window.__stores[store].push(obj);
          return obj;
        },
        get: async (store, id) => (window.__stores[store] || []).find(r => r.id === id) || null,
      };

      ${dbRealSrc}
      ${validationRealSrc}
      ${fmtSrc}
      ${appRealSrc}
      window.uid = uid; window.nowISO = nowISO; window.stamp = stamp;
      window.VALIDATION_STATUS = VALIDATION_STATUS; window.VALIDATION_BADGE = VALIDATION_BADGE;
      window.statusForSignerRole = statusForSignerRole; window.validateValidationForm = validateValidationForm;
      window.findActiveValidations = findActiveValidations; window.hasValidationConflict = hasValidationConflict;
      window.findActiveValidation = findActiveValidation; window.validationStatusFor = validationStatusFor;
      window.$ = $; window.$$ = $$; window.esc = esc; window.fmt = fmt; window.fmtDate = fmtDate;
      window.GREASE_UNIT = GREASE_UNIT;
      window.openModal = openModal; window.closeModal = closeModal;
      window.validationBadgeHTML = validationBadgeHTML;
      window.openValidationModal = openValidationModal;
      window.openValidationDetailModal = openValidationDetailModal;
      window.openValidationConflictModal = openValidationConflictModal;
    `,
  });
}

async function openModalForRecord(page) {
  await page.evaluate(({ record, equipment }) => window.openValidationModal(record, equipment), { record: RECORD, equipment: EQUIPMENT });
}

async function drawSignature(page) {
  const box = await page.locator('#val-signature-canvas').boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 60, { steps: 5 });
  await page.mouse.up();
}

async function storedValidations(page) {
  return page.evaluate(() => window.__stores.grease_validations);
}

for (const reason of ['Operador no disponible', 'Operador se retiró antes de validar', 'Operador no pudo firmar', 'Validación posterior por encargado', 'Falla del dispositivo al momento de validar']) {
  test(`supervisor autenticado: identidad automática y motivo «${reason}» conservado offline`, async ({ page, context }) => {
    await bootPage(page);
    await page.evaluate(() => { App.currentUser.role = 'SUPERVISOR'; });
    await openModalForRecord(page);
    await expect(page.locator('#val-name')).toHaveAttribute('type', 'hidden');
    await expect(page.locator('#val-role')).toHaveValue('ENCARGADO');
    await expect(page.locator('.val-info')).toContainText(['45-77', 'Ana Supervisora']);
    await page.locator('#val-reason-preset').selectOption(reason);
    await expect(page.locator('#val-other-wrap')).toBeHidden();
    await drawSignature(page);
    await context.setOffline(true);
    await page.locator('#val-confirm').click();
    const [validation] = await storedValidations(page);
    expect(validation.signerName).toBe('Ana Supervisora');
    expect(validation.reason).toBe(reason);
    expect(validation.signatureLocal).toMatch(/^data:image\/png/);
    await page.evaluate(({ validation, equipment }) => openValidationDetailModal(validation, equipment), { validation, equipment: EQUIPMENT });
    await expect(page.locator('.val-info')).toContainText(reason);
  });
}

test('Otro exige texto; cambiar a un motivo predefinido no conserva el texto anterior', async ({ page }) => {
  await bootPage(page);
  await openModalForRecord(page);
  await page.locator('#val-name').fill('Encargado externo');
  await page.locator('#val-role').selectOption('ENCARGADO');
  await page.locator('#val-reason-preset').selectOption('Otro');
  await expect(page.locator('#val-reason')).toBeVisible();
  await expect(page.locator('#val-reason')).toHaveAttribute('required', '');
  await drawSignature(page);
  await page.locator('#val-confirm').click();
  expect(await storedValidations(page)).toHaveLength(0);
  await page.locator('#val-reason').fill('Explicación específica');
  await page.locator('#val-reason-preset').selectOption('Operador no pudo firmar');
  await expect(page.locator('#val-reason')).toBeHidden();
  await page.locator('#val-confirm').click();
  expect((await storedValidations(page))[0].reason).toBe('Operador no pudo firmar');
});

test('Otro conserva la explicación libre y operador autenticado no necesita motivo', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => { App.currentUser.role = 'SUPERVISOR'; });
  await openModalForRecord(page);
  await page.locator('#val-reason-preset').selectOption('Otro');
  await page.locator('#val-reason').fill('Explicación específica');
  await drawSignature(page);
  await page.locator('#val-confirm').click();
  expect((await storedValidations(page))[0].reason).toBe('Explicación específica');
  await page.evaluate(() => { __stores.grease_validations = []; App.currentUser.role = 'OPERADOR'; });
  await openModalForRecord(page);
  await expect(page.locator('#val-reason-wrap')).toBeHidden();
  await drawSignature(page);
  await page.locator('#val-confirm').click();
  expect((await storedValidations(page))[0].reason).toBeUndefined();
});

test('muestra la info del engrase (equipo, modelo, fecha, lubricador, turno, horómetro, cantidad) ANTES de firmar', async ({ page }) => {
  await bootPage(page);
  await openModalForRecord(page);

  const info = page.locator('.val-info');
  await expect(info).toContainText('45-77');
  await expect(info).toContainText('Caterpillar 740B');
  await expect(info).toContainText('Juan Pérez');
  await expect(info).toContainText('Día');
  await expect(info).toContainText('5,200 h');
  await expect(info).toContainText('1.5 lb');
});

test('formulario vacío → "Confirmar validación" NO permite continuar (sin nombre/rol/firma)', async ({ page }) => {
  await bootPage(page);
  await openModalForRecord(page);

  await page.locator('#val-confirm').click();
  await expect(page.locator('#val-error')).toBeVisible();
  await expect(page.locator('.modal-body')).toBeVisible(); // el modal NO se cerró
  expect(await storedValidations(page)).toHaveLength(0);
});

test('Rol = Encargado SIN motivo → bloquea; CON motivo (+ nombre + firma) → PERSISTE en grease_validations como ENCARGADO', async ({ page }) => {
  await bootPage(page);
  await openModalForRecord(page);

  await page.locator('#val-name').fill('María López');
  await page.locator('#val-role').selectOption('ENCARGADO');
  await expect(page.locator('#val-reason-wrap')).toBeVisible();
  await drawSignature(page);

  await page.locator('#val-confirm').click();
  await expect(page.locator('#val-error')).toBeVisible(); // sin motivo, sigue bloqueado

  await page.locator('#val-reason-preset').selectOption('Operador no disponible');
  await page.locator('#val-confirm').click();

  const validations = await storedValidations(page);
  expect(validations).toHaveLength(1);
  expect(validations[0].lubricationRecordId).toBe('greg_1');
  expect(validations[0].signerRole).toBe('ENCARGADO'); // el estado se DERIVA de esto, no se guarda aparte
  expect(validations[0].validationStatus).toBeUndefined(); // nunca redundante
  expect(validations[0].reason).toBe('Operador no disponible');
  expect(validations[0].signerUserId).toBe('u1'); // App.currentUser de quien capturó, no el firmante
  expect(validations[0].active).toBe(true);
});

test('Rol = Operador, sin firma → bloquea; con firma → persiste como OPERADOR, sin exigir motivo, firma guardada localmente primero', async ({ page }) => {
  await bootPage(page);
  await openModalForRecord(page);

  await page.locator('#val-name').fill('Juan Pérez (Operador)');
  await page.locator('#val-role').selectOption('OPERADOR');
  await expect(page.locator('#val-reason-wrap')).toBeHidden();

  await page.locator('#val-confirm').click();
  await expect(page.locator('#val-error')).toBeVisible(); // falta la firma

  await drawSignature(page);
  await page.locator('#val-confirm').click();

  const validations = await storedValidations(page);
  expect(validations).toHaveLength(1);
  expect(validations[0].signerRole).toBe('OPERADOR');
  expect(validations[0].reason).toBeUndefined();
  expect(validations[0].signatureLocal).toMatch(/^data:image\/png/); // offline-first: local antes que nada
  expect(validations[0].signatureUrl).toBeNull(); // lo llena sync.js cuando haya señal
});

test('"Borrar firma" limpia el trazo — confirmar después vuelve a bloquear por falta de firma', async ({ page }) => {
  await bootPage(page);
  await openModalForRecord(page);

  await page.locator('#val-name').fill('Juan Pérez');
  await page.locator('#val-role').selectOption('OPERADOR');
  await drawSignature(page);
  await page.locator('#val-clear').click();

  await page.locator('#val-confirm').click();
  await expect(page.locator('#val-error')).toBeVisible();
  expect(await storedValidations(page)).toHaveLength(0);
});

test('máximo UNA validación activa: si ya existe una al confirmar, NO crea otra — muestra el detalle de la que ya existe', async ({ page }) => {
  await bootPage(page);
  // Simula que, mientras el formulario estaba abierto, alguien más ya validó este registro.
  await page.evaluate(() => {
    window.__stores.grease_validations.push({
      id: 'val_existente', lubricationRecordId: 'greg_1', equipmentId: 'e1',
      signerName: 'Otro Operador', signerRole: 'OPERADOR', signedAt: '2026-09-24T18:20:00',
      signatureLocal: 'data:image/png;base64,ZZZZ', active: true,
    });
  });
  await openModalForRecord(page);

  await page.locator('#val-name').fill('Juan Pérez');
  await page.locator('#val-role').selectOption('OPERADOR');
  await drawSignature(page);
  await page.locator('#val-confirm').click();

  const validations = await storedValidations(page);
  expect(validations).toHaveLength(1); // sigue habiendo UNA sola — no se creó una segunda
  expect(validations[0].id).toBe('val_existente');
  await expect(page.locator('.val-info')).toContainText('Otro Operador'); // se cambió a la vista de detalle
});

test('"Ver validación" (detalle) muestra nombre, rol, fecha/hora, motivo (Encargado) y la firma', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(async ({ equipment }) => {
    const validation = {
      id: 'val_1', lubricationRecordId: 'greg_1', equipmentId: equipment.id,
      signerName: 'María López', signerRole: 'ENCARGADO', reason: 'Operador no disponible',
      signedAt: '2026-09-24T18:20:00', signatureLocal: 'data:image/png;base64,ZZZZ', active: true,
    };
    await window.openValidationDetailModal(validation, equipment);
  }, { equipment: EQUIPMENT });

  const info = page.locator('.val-info');
  await expect(info).toContainText('María López');
  await expect(info).toContainText('Encargado');
  await expect(info).toContainText('Operador no disponible');
  await expect(page.locator('.val-signature-wrap img')).toHaveAttribute('src', /^data:image\/png/);
});

test('conflicto: si ya existen DOS validaciones activas al confirmar, NO elige ninguna ni crea una tercera — abre el modal de conflicto con AMBAS firmas', async ({ page }) => {
  await bootPage(page);
  // Simula doble firma offline/multidispositivo: 2 activas ya en la store
  // antes de que este dispositivo intente confirmar la suya.
  await page.evaluate(() => {
    window.__stores.grease_validations.push(
      { id: 'val_a', lubricationRecordId: 'greg_1', equipmentId: 'e1', signerName: 'Operador A', signerRole: 'OPERADOR', signedAt: '2026-09-24T18:20:00', signatureLocal: 'data:image/png;base64,AAAA', active: true },
      { id: 'val_b', lubricationRecordId: 'greg_1', equipmentId: 'e1', signerName: 'Encargado B', signerRole: 'ENCARGADO', reason: 'Operador no disponible', signedAt: '2026-09-24T18:22:00', signatureLocal: 'data:image/png;base64,BBBB', active: true },
    );
  });
  await openModalForRecord(page);

  await page.locator('#val-name').fill('Juan Pérez');
  await page.locator('#val-role').selectOption('OPERADOR');
  await drawSignature(page);
  await page.locator('#val-confirm').click();

  const validations = await storedValidations(page);
  expect(validations).toHaveLength(2); // sigue habiendo SOLO las 2 originales — no se creó una tercera
  await expect(page.locator('.modal-head')).toContainText('Conflicto de validación');
  await expect(page.locator('.modal-body')).toContainText('Operador A');
  await expect(page.locator('.modal-body')).toContainText('Encargado B');
});

test('badges: PENDIENTE ámbar, OPERADOR verde, ENCARGADO tono propio (no confundible con Operador)', async ({ page }) => {
  await bootPage(page);
  const html = await page.evaluate(() => ({
    pendiente: window.validationBadgeHTML('PENDIENTE_VALIDACION'),
    operador: window.validationBadgeHTML('VALIDADO_OPERADOR'),
    encargado: window.validationBadgeHTML('VALIDADO_ENCARGADO'),
  }));
  expect(html.pendiente).toContain('Engrasado · Pendiente de validación');
  expect(html.pendiente).toContain('hist-compliance-early');
  expect(html.operador).toContain('Validado · Operador');
  expect(html.operador).toContain('hist-compliance-ok');
  expect(html.encargado).toContain('Validado · Encargado');
  expect(html.encargado).toContain('hist-compliance-teal');
  expect(html.encargado).not.toContain('hist-compliance-ok');
});
