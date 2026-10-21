// tests/ui/broadcast-quick-send.spec.js
//
// "Simplificar ENVÍO de mensajes operativos" (lote 2026-10-19) — un
// mensaje debe poder enviarse en pocos segundos. Cubre, con el código
// REAL de app.js (openBroadcastForm(), nunca reimplementado):
//   - Formulario mínimo: solo Enviar a + Mensaje visibles.
//   - Defaults automáticos: priority=INFORMATIVA, validFrom=ahora,
//     validUntil=null, createdBy/createdAt/status siempre automáticos
//     (nunca pedidos al usuario — no hay campo para ellos).
//   - Título opcional: nunca se inventa uno artificial (title=null si se
//     deja vacío; broadcastDisplayTitle() decide el texto de la card).
//   - "Más opciones" cerrado por defecto, con título/prioridad/vigencia.
//   - Targeting ALL_LUBRICATORS/CREW/LOCATION/USER sin cambios.
//   - Mensajes antiguos (con title/priority/validFrom/validUntil reales)
//     siguen mostrándose y editándose normalmente.
// 0017/0018/RLS/targeting/sync/read-state/badge/navegación NO se tocan —
// este archivo nunca reimplementa esa lógica, solo ejecuta el código real.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, DB_JS_PATH, OPERATIONAL_SCOPE_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

const appSource = readSource(APP_JS_PATH);
const dbSource = readSource(DB_JS_PATH);
const scopeSource = readSource(OPERATIONAL_SCOPE_JS_PATH);

const dbNames = ['uid', 'nowISO', 'stamp'];
const dbSrc = dbNames.map(n => extractDeclaration(dbSource, n)).join('\n\n');
const scopeNames = ['BROADCAST_PRIORITIES', 'BROADCAST_TARGET_TYPES', 'broadcastDisplayTitle', 'ROLES_CAN_CREATE_BROADCAST', 'canCreateBroadcast'];
const scopeSrc = scopeNames.map(n => extractDeclaration(scopeSource, n)).join('\n\n');
const appNames = [
  '$', '$$', 'esc', 'ic', 'openModal', 'closeModal', 'manageUsersErrorMessage', 'openBroadcastForm',
  'canManageThisBroadcast', 'retireBroadcast', 'deleteBroadcast',
  'todayDateISO', 'computeTasksMensajesBadgeCount', 'updateTareasMensajesNavBadge',
];
const appSrc = appNames.map(n => extractDeclaration(appSource, n)).join('\n\n');

async function bootPage(page, { role = 'ADMINISTRADOR', cuadrillas = [], locations = [], broadcasts = [] } = {}) {
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
      window.App = { currentUser: { id: 'actor1', name: 'Actor de prueba', role: '${role}' } };
      window.__mockData = {
        broadcast_messages: ${JSON.stringify(broadcasts)},
        cuadrillas: ${JSON.stringify(cuadrillas)},
        locations: ${JSON.stringify(locations)},
      };
      window.DB = {
        get: async (store, id) => (window.__mockData[store] || []).find(r => r.id === id) || null,
        all: async (store) => window.__mockData[store] || [],
        allActive: async (store) => (window.__mockData[store] || []).filter(r => r.active !== false),
        put: async (store, row) => {
          const list = window.__mockData[store] || (window.__mockData[store] = []);
          const i = list.findIndex(r => r.id === row.id);
          if (i >= 0) list[i] = row; else list.push(row);
          return row;
        },
      };
      window.Sync = { fullSync: async () => {} };
      window.Auth = { manageUsers: async () => ({ users: [{ app_user_id: 'lub1', display_name: 'Lubricador Uno', role: 'LUBRICADOR', active: true }] }) };
      window.showInAppToast = () => {};
      window.logAudit = async () => {};
      window.confirm = () => true;
      ${dbSrc}
      ${scopeSrc}
      ${appSrc}
      window.openBroadcastForm = openBroadcastForm;
    `,
  });
}

const form = page => page.locator('#broadcast-form');
const details = page => form(page).locator('details.reg-advanced');

async function send(page) {
  await page.locator('#broadcast-form button[type="submit"]').click();
}
async function lastMessage(page) {
  return page.evaluate(() => window.__mockData.broadcast_messages[window.__mockData.broadcast_messages.length - 1]);
}

test('1. Enviar con solo destino (ALL, default) + mensaje crea el broadcast', async ({ page }) => {
  let changed = false;
  await bootPage(page);
  await page.evaluate(() => { window.__onChange = () => { window.__changed = true; }; openBroadcastForm(null, window.__onChange); });
  await form(page).locator('[name="message"]').fill('Cuidado con la pendiente del sector norte.');
  await send(page);
  const msg = await lastMessage(page);
  expect(msg.message).toBe('Cuidado con la pendiente del sector norte.');
  expect(msg.targetType).toBe('ALL_LUBRICATORS');
  expect(msg.targetId).toBeNull();
  expect(msg.createdBy).toBe('actor1');
  expect(typeof msg.createdAt).toBe('string'); // automático (stamp())
  changed = await page.evaluate(() => window.__changed === true);
  expect(changed).toBe(true);
});

test('2. Default de prioridad = INFORMATIVA sin tocar "Más opciones"', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => openBroadcastForm(null, () => {}));
  await form(page).locator('[name="message"]').fill('Aviso corto.');
  await send(page);
  const msg = await lastMessage(page);
  expect(msg.priority).toBe('INFORMATIVA');
});

test('3. validFrom automático ("ahora") al crear sin tocar "Más opciones"', async ({ page }) => {
  await bootPage(page);
  const before = Date.now();
  await page.evaluate(() => openBroadcastForm(null, () => {}));
  await form(page).locator('[name="message"]').fill('Aviso con vigencia automática.');
  await send(page);
  const msg = await lastMessage(page);
  expect(msg.validFrom).toBeTruthy();
  const delta = Math.abs(new Date(msg.validFrom).getTime() - before);
  expect(delta).toBeLessThan(15000); // "ahora", no una fecha inventada lejana
});

test('4. Sin validUntil funciona (null / sin vencimiento)', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => openBroadcastForm(null, () => {}));
  await form(page).locator('[name="message"]').fill('Sin fecha de vencimiento.');
  await send(page);
  const msg = await lastMessage(page);
  expect(msg.validUntil).toBeNull();
});

test('5. Título opcional funciona: vacío guarda title=null, nunca uno inventado', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => openBroadcastForm(null, () => {}));
  await form(page).locator('[name="message"]').fill('Mensaje sin título personalizado.');
  await send(page);
  const msg = await lastMessage(page);
  expect(msg.title).toBeNull();
});

test('6. "Más opciones" permite elegir prioridad explícita', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => openBroadcastForm(null, () => {}));
  await details(page).locator('summary').click();
  await details(page).locator('[name="priority"]').selectOption('CRITICA');
  await form(page).locator('[name="message"]').fill('Mensaje crítico.');
  await send(page);
  const msg = await lastMessage(page);
  expect(msg.priority).toBe('CRITICA');
});

test('7. "Más opciones" permite fijar vigencia desde/hasta explícitas', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => openBroadcastForm(null, () => {}));
  await details(page).locator('summary').click();
  await details(page).locator('[name="validFrom"]').fill('2026-11-01');
  await details(page).locator('[name="validUntil"]').fill('2026-11-05');
  await form(page).locator('[name="message"]').fill('Mensaje con vigencia fija.');
  await send(page);
  const msg = await lastMessage(page);
  // Compara en fecha LOCAL (igual que fmtDateOnly() al mostrarlo) — slice()
  // sobre el ISO en UTC corre el día cuando la zona local está detrás de UTC.
  const localDate = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  expect(localDate(msg.validFrom)).toBe('2026-11-01');
  expect(localDate(msg.validUntil)).toBe('2026-11-05');
});

test('8. ALL_LUBRICATORS funciona (default, sin selector adicional)', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => openBroadcastForm(null, () => {}));
  await expect(form(page).locator('#bc-target-selector')).toBeEmpty();
  await form(page).locator('[name="message"]').fill('Para todos.');
  await send(page);
  const msg = await lastMessage(page);
  expect(msg.targetType).toBe('ALL_LUBRICATORS');
});

test('9. CREW funciona: muestra únicamente el selector de cuadrilla', async ({ page }) => {
  await bootPage(page, { cuadrillas: [{ id: 'cq1', name: 'Cuadrilla Volcán' }] });
  await page.evaluate(() => openBroadcastForm(null, () => {}));
  await form(page).locator('[name="targetType"]').selectOption('CREW');
  const selector = form(page).locator('#bc-target-selector');
  await expect(selector.locator('[name="targetId"]')).toBeVisible();
  await selector.locator('[name="targetId"]').selectOption('cq1');
  await form(page).locator('[name="message"]').fill('Para la cuadrilla.');
  await send(page);
  const msg = await lastMessage(page);
  expect(msg.targetType).toBe('CREW');
  expect(msg.targetId).toBe('cq1');
});

test('10. LOCATION funciona: muestra únicamente el selector de ubicación', async ({ page }) => {
  await bootPage(page, { locations: [{ id: 'loc1', name: 'Volcán' }] });
  await page.evaluate(() => openBroadcastForm(null, () => {}));
  await form(page).locator('[name="targetType"]').selectOption('LOCATION');
  const selector = form(page).locator('#bc-target-selector');
  await expect(selector.locator('[name="targetId"]')).toBeVisible();
  await selector.locator('[name="targetId"]').selectOption('loc1');
  await form(page).locator('[name="message"]').fill('Para la ubicación.');
  await send(page);
  const msg = await lastMessage(page);
  expect(msg.targetType).toBe('LOCATION');
  expect(msg.targetId).toBe('loc1');
});

test('11. USER funciona: muestra únicamente el selector de usuario exacto', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => openBroadcastForm(null, () => {}));
  await form(page).locator('[name="targetType"]').selectOption('USER');
  const selector = form(page).locator('#bc-target-selector');
  await expect(selector.locator('[name="targetId"]')).toBeVisible();
  await selector.locator('[name="targetId"]').selectOption('lub1');
  await form(page).locator('[name="message"]').fill('Para ese lubricador.');
  await send(page);
  const msg = await lastMessage(page);
  expect(msg.targetType).toBe('USER');
  expect(msg.targetId).toBe('lub1');
});

test('12. SUPERVISOR puede enviar (abre y envía el mismo formulario reutilizable)', async ({ page }) => {
  await bootPage(page, { role: 'SUPERVISOR' });
  await page.evaluate(() => openBroadcastForm(null, () => {}));
  await form(page).locator('[name="message"]').fill('Aviso de supervisor.');
  await send(page);
  const msg = await lastMessage(page);
  expect(msg.createdBy).toBe('actor1');
  expect(msg.message).toBe('Aviso de supervisor.');
});

test('14. Mensaje antiguo con title/priority/validFrom/validUntil reales sigue mostrándose y editándose igual', async ({ page }) => {
  const old = { id: 'bOld', title: 'Corte de agua', message: 'No habrá agua de 10 a 12.', priority: 'IMPORTANTE',
    targetType: 'ALL_LUBRICATORS', targetId: null, createdBy: 'actor1', createdAt: '2026-09-01T08:00:00.000Z',
    validFrom: '2026-09-01T00:00:00.000Z', validUntil: '2026-09-05T23:59:59.000Z' };
  await bootPage(page, { broadcasts: [old] });
  await page.evaluate((m) => openBroadcastForm(m, () => {}), old);
  // Editar conserva TODO lo existente sin pedirlo de nuevo visiblemente.
  await expect(page.locator('.modal-head, .modal-title, h2').first()).toContainText('Corte de agua');
  await expect(form(page).locator('[name="message"]')).toHaveValue('No habrá agua de 10 a 12.');
  await details(page).locator('summary').click();
  await expect(details(page).locator('[name="title"]')).toHaveValue('Corte de agua');
  await expect(details(page).locator('[name="priority"]')).toHaveValue('IMPORTANTE');
  await expect(details(page).locator('[name="validFrom"]')).toHaveValue('2026-09-01');
  await expect(details(page).locator('[name="validUntil"]')).toHaveValue('2026-09-05');
  await send(page);
  const msg = await page.evaluate(() => window.__mockData.broadcast_messages.find(m => m.id === 'bOld'));
  expect(msg.title).toBe('Corte de agua');
  expect(msg.priority).toBe('IMPORTANTE');
});
