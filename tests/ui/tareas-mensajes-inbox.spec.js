// tests/ui/tareas-mensajes-inbox.spec.js
//
// "Rediseñar TAREAS Y MENSAJES siguiendo patrón Inbox/List + Detail Pane"
// (lote 2026-10-19). Cubre, con el código REAL de app.js
// (renderTareasYMensajes, nunca reimplementado), lo específico del patrón
// de interacción (nunca su branding):
//   - Click en fila abre el panel/pantalla de detalle; la lista SIGUE
//     visible en desktop (>=768px) y se oculta en mobile (<768px).
//   - [X] cierra en desktop, [←] (mismo botón, glifo por CSS) en mobile.
//   - Fila 100% clicable, sin botones dentro, con indicador ●/chevron ›.
//   - Sin overflow horizontal en 390/412/768/1024/1366.
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

async function bootPage(page, { role = 'ADMINISTRADOR', manualTasks = [], broadcasts = [] } = {}) {
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
      window.App = { currentUser: { id: 'actor1', name: 'Actor de prueba', role: '${role}' },
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18 } };
      window.__mockData = {
        manual_tasks: ${JSON.stringify(manualTasks)}, broadcast_messages: ${JSON.stringify(broadcasts)},
        broadcast_message_reads: [], equipment: [], cuadrillas: [], locations: [], users: [],
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
      window.openCompleteManualTaskForm = () => {};
      window.openEquipmentDetail = () => {};
      window.getCurrentOperationalScope = async () => ({ crewId: null });
      window.resolvePhotoThumbSrcs = async () => [];
      window.photoThumbsHTML = () => '';
      window.wirePhotoThumbs = () => {};
      ${dbSrc}
      ${scopeSrc}
      ${appSrc}
      window.renderTareasYMensajes = renderTareasYMensajes;
    `,
  });
}

const listPane = page => page.locator('.tym-list-pane');
const detailPane = page => page.locator('.tym-detail-pane');
const firstRow = page => page.locator('[data-tym-panel="pendientes"] .tym-row').first();

function mkTask(overrides = {}) {
  return { id: 't1', equipmentId: 'e1', crewId: 'cq1', taskType: 'ENGRASE', status: 'PENDING',
    description: 'Revisar fuga', priority: 'ALTA', createdBy: 'actor1', createdAt: '2026-10-19T08:00:00.000Z', ...overrides };
}

test('1/16/17. Desktop (1366px): lista compacta, sin overflow horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await bootPage(page, { manualTasks: [mkTask()] });
  await page.evaluate(() => renderTareasYMensajes());
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
});

test('2/3. Click en fila abre el panel derecho; la lista sigue visible (desktop >=768px)', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await bootPage(page, { manualTasks: [mkTask()] });
  await page.evaluate(() => renderTareasYMensajes());
  await expect(detailPane(page)).toBeEmpty();
  await firstRow(page).click();
  await expect(detailPane(page)).not.toBeEmpty();
  await expect(detailPane(page)).toBeVisible();
  await expect(listPane(page)).toBeVisible(); // nunca se oculta en desktop
  const detailBox = await detailPane(page).boundingBox();
  expect(detailBox.width).toBeGreaterThanOrEqual(400);
  expect(detailBox.width).toBeLessThanOrEqual(560);
});

test('4. Mobile (<768px): abrir detalle oculta la lista (pantalla completa)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await bootPage(page, { manualTasks: [mkTask()] });
  await page.evaluate(() => renderTareasYMensajes());
  await firstRow(page).click();
  await expect(listPane(page)).toBeHidden();
  await expect(detailPane(page)).toBeVisible();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
});

test('Cerrar el panel (botón único, [X]/[←] por CSS) vuelve a mostrar la lista en mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await bootPage(page, { manualTasks: [mkTask()] });
  await page.evaluate(() => renderTareasYMensajes());
  await firstRow(page).click();
  await page.locator('#tym-detail-close').click();
  await expect(listPane(page)).toBeVisible();
  await expect(detailPane(page)).toBeHidden();
});

test('El botón de cerrar/volver es [✕] en desktop y [←] en mobile (mismo elemento, glifo por CSS)', async ({ page }) => {
  await bootPage(page, { manualTasks: [mkTask()] });
  await page.evaluate(() => renderTareasYMensajes());
  await page.setViewportSize({ width: 1366, height: 900 });
  await firstRow(page).click();
  const back = page.locator('#tym-detail-close');
  let glyph = await back.evaluate(el => getComputedStyle(el, '::before').content);
  expect(glyph).toContain('✕');
  await page.setViewportSize({ width: 390, height: 800 });
  glyph = await back.evaluate(el => getComputedStyle(el, '::before').content);
  expect(glyph).toContain('←');
});

test('5. [+ Crear ▾] abre un menú con Nueva tarea / Nuevo mensaje', async ({ page }) => {
  await bootPage(page, {});
  await page.evaluate(() => renderTareasYMensajes());
  await page.locator('.tym-create-menu > summary').click();
  await expect(page.locator('.tym-create-menu .tym-menu-item')).toHaveCount(2);
  await expect(page.locator('.tym-create-menu #tym-new-task')).toHaveText('Nueva tarea');
  await expect(page.locator('.tym-create-menu #tym-new-message')).toHaveText('Nuevo mensaje');
});

test('18/19. Fila sin cards gigantes ni botones full-width: 100% clicable, con ● y ›, sin <button> anidado', async ({ page }) => {
  await bootPage(page, { manualTasks: [mkTask()] }); // priority ALTA -> dot
  await page.evaluate(() => renderTareasYMensajes());
  const row = firstRow(page);
  await expect(row).toHaveJSProperty('tagName', 'BUTTON');
  await expect(row.locator('button')).toHaveCount(0); // nunca botones anidados
  await expect(row.locator('.tym-row-dot')).toBeVisible();
  await expect(row.locator('.tym-row-chevron')).toHaveText('›');
});

for (const width of [390, 412, 768, 1024, 1366]) {
  test(`16/17. ${width}px: sin overflow horizontal con panel de detalle abierto`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await bootPage(page, { manualTasks: [mkTask()] });
    await page.evaluate(() => renderTareasYMensajes());
    await firstRow(page).click();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
}
