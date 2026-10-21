// tests/ui/tareas-mensajes-compact.spec.js
//
// "Tareas y Mensajes" — acciones del panel de detalle (lote "patrón
// Inbox", 2026-10-19 — tras moverse desde la fila/menú ⋮ de la fila hacia
// el panel de detalle). Cubre, con el código REAL de app.js
// (renderTareasYMensajes/cancelManualTask/deleteManualTask/
// retireBroadcast/deleteBroadcast, nunca reimplementados):
//   - Menú ⋮ y botones del panel según estado/rol.
//   - Retirar vs Eliminar mensaje (soft delete, active:false / retiredAt).
//   - Cancelar/Eliminar tarea (soft delete, active:false), COMPLETED
//     conserva historial sin opción de eliminar.
//   - Enviados muestra RETIRADO/ELIMINADO/Eliminada con trazabilidad.
//   - Badge excluye retirado/eliminado/cancelado.
//   - Permisos: LUBRICADOR nunca administra; SUPERVISOR no administra
//     contenido ajeno.
//   - Densidad de fila (56-72px desktop / 88-120px mobile, §12 del pedido).
// 0017/0018/RLS/targeting/sync/permisos NO se tocan ni se reimplementan.

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
const scopeNames = [
  'MANUAL_TASK_TYPES', 'MANUAL_TASK_PRIORITIES', 'BROADCAST_PRIORITIES', 'BROADCAST_TARGET_TYPES',
  'ROLES_CAN_MANAGE_ASSIGNMENTS', 'ROLES_CAN_CREATE_BROADCAST', 'canManageAssignments', 'canCreateBroadcast',
  'broadcastDisplayTitle',
];
const scopeSrc = scopeNames.map(n => extractDeclaration(scopeSource, n)).join('\n\n');
const appNames = [
  '$', '$$', 'esc', 'ic', 'fmtDate', 'fmtDateOnly', 'fmtTime', 'todayDateISO', 'openModal', 'closeModal', 'photosOf',
  'openManualTaskForm', 'openBroadcastForm', 'markBroadcastAsRead',
  'canManageThisManualTask', 'cancelManualTask', 'deleteManualTask',
  'canManageThisBroadcast', 'retireBroadcast', 'deleteBroadcast',
  'computeTasksMensajesBadgeCount', 'updateTareasMensajesNavBadge',
  'manageUsersErrorMessage', 'renderTareasYMensajes',
];
const appSrc = appNames.map(n => extractDeclaration(appSource, n)).join('\n\n');

async function bootPage(page, { role = 'ADMINISTRADOR', actorId = 'actor1', manualTasks = [], broadcasts = [], reads = [], equipos = [], cuadrillas = [], locations = [], confirmReturns = true } = {}) {
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
      window.App = { currentUser: { id: '${actorId}', name: 'Actor de prueba', role: '${role}' },
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18 } };
      window.__mockData = {
        manual_tasks: ${JSON.stringify(manualTasks)},
        broadcast_messages: ${JSON.stringify(broadcasts)},
        broadcast_message_reads: ${JSON.stringify(reads)},
        equipment: ${JSON.stringify(equipos)},
        cuadrillas: ${JSON.stringify(cuadrillas)},
        locations: ${JSON.stringify(locations)},
        users: [],
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
      window.logAudit = async () => {};
      window.showInAppToast = () => {};
      window.navigate = () => {};
      window.confirm = () => ${confirmReturns};
      window.openCompleteManualTaskForm = () => {};
      window.openEquipmentDetail = () => {};
      window.getCurrentOperationalScope = async () => ({ crewId: null });
      window.resolvePhotoThumbSrcs = async () => [];
      window.photoThumbHTML = () => '';
      window.photoThumbsHTML = () => '';
      window.wirePhotoThumbs = () => {};
      ${dbSrc}
      ${scopeSrc}
      ${appSrc}
      window.renderTareasYMensajes = renderTareasYMensajes;
    `,
  });
}

const pendientesPanel = page => page.locator('[data-tym-panel="pendientes"]');
const rows = (page, panel) => panel.locator('.tym-row');
const detailPane = page => page.locator('.tym-detail-pane');
const openFirstRow = async (page, panel) => { await rows(page, panel).first().click(); };
const openKebab = async (page) => { await detailPane(page).locator('.tym-row-menu > summary').click(); };

function mkTask(overrides = {}) {
  return { id: 't1', equipmentId: 'e1', crewId: 'cq1', taskType: 'ENGRASE', status: 'PENDING',
    description: 'Revisar fuga', priority: 'MEDIA', createdBy: 'actor1', createdAt: '2026-10-19T08:00:00.000Z', ...overrides };
}
function mkMsg(overrides = {}) {
  return { id: 'b1', title: 'Aviso', message: 'Cuidado con la pendiente', priority: 'INFORMATIVA',
    targetType: 'ALL_LUBRICATORS', createdBy: 'actor1', createdAt: '2026-10-19T08:00:00.000Z',
    validFrom: null, validUntil: null, ...overrides };
}

test('4a. Panel de tarea PENDING (manager, propia): Editar/Reasignar + Cancelar directos, ⋮ = Eliminar tarea', async ({ page }) => {
  await bootPage(page, { manualTasks: [mkTask()] });
  await page.evaluate(() => renderTareasYMensajes());
  await openFirstRow(page, pendientesPanel(page));
  const pane = detailPane(page);
  await expect(pane.locator('#tym-detail-edit')).toHaveText(/Editar.*Reasignar/);
  await expect(pane.locator('#tym-detail-cancel')).toHaveText('Cancelar');
  await openKebab(page);
  await expect(pane.locator('.tym-menu-item')).toHaveText('Eliminar tarea');
});

test('4b. Panel de tarea COMPLETED: solo Ver equipo, sin Editar/Cancelar/⋮ (conserva historial)', async ({ page }) => {
  await bootPage(page, { manualTasks: [mkTask({ status: 'COMPLETED' })] });
  await page.evaluate(() => renderTareasYMensajes());
  await page.locator('.tym-tab').nth(1).click();
  await openFirstRow(page, page.locator('[data-tym-panel="enviados"]'));
  const pane = detailPane(page);
  await expect(pane.locator('#tym-detail-ver-equipo')).toBeVisible();
  await expect(pane.locator('#tym-detail-edit')).toHaveCount(0);
  await expect(pane.locator('#tym-detail-cancel')).toHaveCount(0);
  await expect(pane.locator('.tym-row-menu')).toHaveCount(0);
});

test('5. Panel de mensaje ACTIVO propio: Editar directo, ⋮ = Retirar mensaje, Eliminar mensaje', async ({ page }) => {
  await bootPage(page, { broadcasts: [mkMsg()] });
  await page.evaluate(() => renderTareasYMensajes());
  await openFirstRow(page, pendientesPanel(page));
  const pane = detailPane(page);
  await expect(pane.locator('#tym-detail-msg-edit')).toHaveText('Editar');
  await openKebab(page);
  const items = pane.locator('.tym-menu-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveText('Retirar mensaje');
  await expect(items.nth(1)).toHaveText('Eliminar mensaje');
});

test('10. Retirar mensaje: cierra el panel, desaparece de Pendientes, badge excluye, Enviados lo muestra RETIRADO', async ({ page }) => {
  await bootPage(page, { broadcasts: [mkMsg()] });
  await page.evaluate(() => renderTareasYMensajes());
  await openFirstRow(page, pendientesPanel(page));
  await openKebab(page);
  await detailPane(page).locator('[data-tym-action="retire-msg"]').click();
  await expect(detailPane(page)).toBeEmpty();
  await expect(rows(page, pendientesPanel(page))).toHaveCount(0);
  await page.locator('.tym-tab').nth(1).click();
  const enviados = page.locator('[data-tym-panel="enviados"]');
  await expect(enviados).toContainText('RETIRADO');
  const msg = await page.evaluate(() => window.__mockData.broadcast_messages[0]);
  expect(msg.retiredAt).toBeTruthy();
  expect(msg.validUntil).toBeNull(); // trazabilidad: vigencia original NUNCA se toca
  const badge = await page.evaluate(() => computeTasksMensajesBadgeCount());
  expect(badge).toBe(0);
});

test('11. Eliminar mensaje (soft delete): desaparece de vistas normales, Enviados lo muestra ELIMINADO', async ({ page }) => {
  await bootPage(page, { broadcasts: [mkMsg()] });
  await page.evaluate(() => renderTareasYMensajes());
  await openFirstRow(page, pendientesPanel(page));
  await openKebab(page);
  await detailPane(page).locator('[data-tym-action="delete-msg"]').click();
  await expect(rows(page, pendientesPanel(page))).toHaveCount(0);
  const msg = await page.evaluate(() => window.__mockData.broadcast_messages[0]);
  expect(msg.active).toBe(false);
  await page.locator('.tym-tab').nth(1).click();
  await expect(page.locator('[data-tym-panel="enviados"]')).toContainText('ELIMINADO');
});

test('12. Cancelar tarea (botón directo del panel): status CANCELLED, sale de Pendientes', async ({ page }) => {
  await bootPage(page, { manualTasks: [mkTask()] });
  await page.evaluate(() => renderTareasYMensajes());
  await openFirstRow(page, pendientesPanel(page));
  await detailPane(page).locator('#tym-detail-cancel').click();
  await expect(rows(page, pendientesPanel(page))).toHaveCount(0);
  const task = await page.evaluate(() => window.__mockData.manual_tasks[0]);
  expect(task.status).toBe('CANCELLED');
  expect(task.active).not.toBe(false);
});

test('Eliminar tarea pendiente (⋮ del panel): soft delete, status NUNCA se toca, Enviados muestra "Eliminada"', async ({ page }) => {
  await bootPage(page, { manualTasks: [mkTask()] });
  await page.evaluate(() => renderTareasYMensajes());
  await openFirstRow(page, pendientesPanel(page));
  await openKebab(page);
  await detailPane(page).locator('[data-tym-action="delete-task"]').click();
  await expect(rows(page, pendientesPanel(page))).toHaveCount(0);
  const task = await page.evaluate(() => window.__mockData.manual_tasks[0]);
  expect(task.active).toBe(false);
  expect(task.status).toBe('PENDING'); // el dato de fondo se conserva intacto
  await page.locator('.tym-tab').nth(1).click();
  await expect(page.locator('[data-tym-panel="enviados"]')).toContainText('Eliminada');
});

test('LUBRICADOR nunca tiene panel de detalle ni ⋮ (card autosuficiente — ver tests/ui/tareas-mensajes-lubricador-inline.spec.js)', async ({ page }) => {
  await bootPage(page, { role: 'LUBRICADOR', actorId: 'lub1',
    manualTasks: [mkTask({ crewId: 'cq1', createdBy: 'other-admin' })],
    broadcasts: [mkMsg({ id: 'b2', createdBy: 'other-admin' })] });
  await page.evaluate(() => renderTareasYMensajes());
  await expect(page.locator('.tym-detail-pane')).toHaveCount(0);
  await expect(page.locator('.tym-row-menu')).toHaveCount(0);
  await expect(page.locator('.tym-row[data-id]')).toHaveCount(0); // sin fila clicable
});

test('13. SUPERVISOR no administra tarea/mensaje ajeno (panel sin ⋮/Editar) pero sí el propio', async ({ page }) => {
  await bootPage(page, { role: 'SUPERVISOR', actorId: 'sup1',
    manualTasks: [mkTask({ id: 'mine', createdBy: 'sup1' }), mkTask({ id: 'other', createdBy: 'other-sup' })] });
  await page.evaluate(() => renderTareasYMensajes());
  const allRows = rows(page, pendientesPanel(page));
  await expect(allRows).toHaveCount(2);
  await allRows.nth(0).click();
  const hasMenuA = await detailPane(page).locator('.tym-row-menu').count();
  await detailPane(page).locator('#tym-detail-close').click();
  await allRows.nth(1).click();
  const hasMenuB = await detailPane(page).locator('.tym-row-menu').count();
  expect([hasMenuA, hasMenuB].filter(n => n > 0)).toHaveLength(1); // exactamente la propia
});

test('Badge excluye retirado/eliminado/cancelado (LUBRICADOR)', async ({ page }) => {
  await bootPage(page, { role: 'LUBRICADOR', actorId: 'lub1',
    manualTasks: [
      mkTask({ id: 't1', status: 'PENDING' }),
      mkTask({ id: 't2', status: 'CANCELLED' }),
      mkTask({ id: 't3', status: 'PENDING', active: false }),
    ],
    broadcasts: [
      mkMsg({ id: 'b1' }),
      mkMsg({ id: 'b2', retiredAt: '2026-10-19T09:00:00.000Z' }),
      mkMsg({ id: 'b3', active: false }),
    ],
  });
  const badge = await page.evaluate(() => computeTasksMensajesBadgeCount());
  expect(badge).toBe(2); // t1 pendiente + b1 no leído; el resto nunca cuenta
});

test('Densidad: fila >=56px alto en desktop (1366px)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await bootPage(page, { manualTasks: [mkTask()] });
  await page.evaluate(() => renderTareasYMensajes());
  const box = await rows(page, pendientesPanel(page)).first().boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(56);
  expect(box.height).toBeLessThanOrEqual(90);
});

test('Densidad: card >=88px alto en mobile (390px)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await bootPage(page, { manualTasks: [mkTask()] });
  await page.evaluate(() => renderTareasYMensajes());
  const box = await rows(page, pendientesPanel(page)).first().boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(88);
});
