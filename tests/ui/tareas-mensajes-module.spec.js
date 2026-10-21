// tests/ui/tareas-mensajes-module.spec.js
//
// "Tareas y Mensajes" — estructura general (lote "patrón Inbox",
// 2026-10-19): header con un único [+ Crear ▾], pestañas Pendientes/
// Enviados (manager) o Pendientes/Historial (LUBRICADOR), y las reglas de
// qué ve cada rol. Cubre, con el código REAL de app.js
// (renderTareasYMensajes/openManualTaskForm/openBroadcastForm, nunca
// reimplementados). El patrón lista+detalle (click en fila, panel lateral/
// pantalla completa) tiene su propia cobertura en
// tests/ui/tareas-mensajes-inbox.spec.js; las acciones del panel de
// detalle (cancelar/eliminar/retirar) en tests/ui/tareas-mensajes-compact.spec.js.

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

async function bootPage(page, { role = 'ADMINISTRADOR', manualTasks = [], broadcasts = [], reads = [], equipos = [], cuadrillas = [], locations = [] } = {}) {
  await page.route('**/*', (route) => {
    if (route.request().resourceType() === 'document') {
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    } else {
      route.continue();
    }
  });
  await page.goto('/');
  await page.setContent('<div id="app-content"></div>');
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.App = { currentUser: { id: 'actor1', name: 'Actor de prueba', role: '${role}' },
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
      window.openManualTaskDetailModal = () => {};
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
      window.openManualTaskForm = openManualTaskForm;
      window.openBroadcastForm = openBroadcastForm;
    `,
  });
}

const createMenu = page => page.locator('.tym-create-menu');
const pendientesTab = page => page.locator('.tym-tab[data-tab="pendientes"]');
const secondTab = page => page.locator('.tym-tab').nth(1);
const pendientesPanel = page => page.locator('[data-tym-panel="pendientes"]');
const rows = (page, panel) => panel.locator('.tym-row');
// LUBRICADOR nunca usa la fila clicable + panel de detalle del manager
// (lote "eliminar clicks innecesarios", 2026-10-19) — su propia card
// autosuficiente reusa .lub-arrastrado-card (ver tests/ui/tareas-mensajes-lubricador-inline.spec.js
// para la cobertura completa de ese flujo).
const lubCards = (page, panel) => panel.locator('.lub-arrastrado-card');

function mkTask(overrides = {}) {
  return { id: 't1', equipmentId: 'e1', crewId: 'cq1', taskType: 'ENGRASE', status: 'PENDING',
    description: 'Revisar fuga', priority: 'MEDIA', createdBy: 'actor1', createdAt: '2026-10-19T08:00:00.000Z', ...overrides };
}
function mkMsg(overrides = {}) {
  return { id: 'b1', title: 'Aviso', message: 'Cuidado con la pendiente', priority: 'INFORMATIVA',
    targetType: 'ALL_LUBRICATORS', createdBy: 'other-admin', createdAt: '2026-10-19T08:00:00.000Z',
    validFrom: null, validUntil: null, ...overrides };
}

for (const role of ['ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR']) {
  test(`1-3. ${role} ve Pendientes/Enviados + [+ Crear ▾] con Nueva tarea/Nuevo mensaje`, async ({ page }) => {
    await bootPage(page, { role });
    await page.evaluate(() => renderTareasYMensajes());
    await expect(createMenu(page)).toBeVisible();
    await expect(createMenu(page).locator('#tym-new-task')).toHaveCount(1);
    await expect(createMenu(page).locator('#tym-new-message')).toHaveCount(1);
    await expect(pendientesTab(page)).toBeVisible();
    await expect(secondTab(page)).toHaveText('Enviados');
  });
}

test('4. LUBRICADOR ve Pendientes/Historial', async ({ page }) => {
  await bootPage(page, { role: 'LUBRICADOR' });
  await page.evaluate(() => renderTareasYMensajes());
  await expect(pendientesTab(page)).toBeVisible();
  await expect(secondTab(page)).toHaveText('Historial');
});

test('5. LUBRICADOR no ve el botón Crear', async ({ page }) => {
  await bootPage(page, { role: 'LUBRICADOR' });
  await page.evaluate(() => renderTareasYMensajes());
  await expect(createMenu(page)).toHaveCount(0);
});

test('6. Tarea pendiente aparece una sola vez en Pendientes', async ({ page }) => {
  await bootPage(page, { role: 'ADMINISTRADOR', manualTasks: [mkTask()] });
  await page.evaluate(() => renderTareasYMensajes());
  await expect(rows(page, pendientesPanel(page))).toHaveCount(1);
  await expect(pendientesPanel(page)).toContainText('TAREA');
});

test('7. Mensaje no leído aparece una sola vez en Pendientes (LUBRICADOR)', async ({ page }) => {
  await bootPage(page, { role: 'LUBRICADOR', broadcasts: [mkMsg()] });
  await page.evaluate(() => renderTareasYMensajes());
  await expect(lubCards(page, pendientesPanel(page))).toHaveCount(1);
  await expect(pendientesPanel(page)).toContainText('MENSAJE');
});

test('8. Completar mueve la tarea fuera de Pendientes, aparece en Historial', async ({ page }) => {
  await bootPage(page, { role: 'LUBRICADOR', manualTasks: [mkTask()] });
  await page.evaluate(() => renderTareasYMensajes());
  await expect(lubCards(page, pendientesPanel(page))).toHaveCount(1);
  // Simula lo que openCompleteManualTaskForm() persiste (status->COMPLETED);
  // el pipeline de cierre en sí ya está cubierto en manual-tasks.test.js.
  await page.evaluate(async () => {
    const t = window.__mockData.manual_tasks[0];
    await DB.put('manual_tasks', { ...t, status: 'COMPLETED', completedBy: 'actor1', completedAt: nowISO() });
    await renderTareasYMensajes();
  });
  await expect(lubCards(page, pendientesPanel(page))).toHaveCount(0);
  await secondTab(page).click();
  const historial = page.locator('[data-tym-panel="historial"]');
  await expect(historial).toBeVisible();
  await expect(lubCards(page, historial)).toHaveCount(1);
  await expect(historial).toContainText('Completada');
});

test('9. Marcar leído (botón directo en la card, real markBroadcastAsRead) mueve el mensaje fuera de Pendientes', async ({ page }) => {
  await bootPage(page, { role: 'LUBRICADOR', broadcasts: [mkMsg()] });
  await page.evaluate(() => renderTareasYMensajes());
  await pendientesPanel(page).locator('.tym-lub-markread').click();
  await expect(lubCards(page, pendientesPanel(page))).toHaveCount(0);
  await secondTab(page).click();
  const historial = page.locator('[data-tym-panel="historial"]');
  await expect(lubCards(page, historial)).toHaveCount(1);
  await expect(historial).toContainText('LEÍDO');
});

test('10. Historial (LUBRICADOR) muestra tareas completadas y mensajes leídos/vencidos', async ({ page }) => {
  await bootPage(page, {
    role: 'LUBRICADOR',
    manualTasks: [mkTask({ id: 't1', status: 'COMPLETED' }), mkTask({ id: 't2', status: 'CANCELLED' })],
    broadcasts: [mkMsg({ id: 'b1' }), mkMsg({ id: 'b2', validUntil: '2020-01-01T00:00:00.000Z' })],
    reads: [{ id: 'b1:actor1', messageId: 'b1', userId: 'actor1', readAt: '2026-10-19T09:00:00.000Z' }],
  });
  await page.evaluate(() => renderTareasYMensajes());
  await expect(lubCards(page, pendientesPanel(page))).toHaveCount(0); // t1/t2 cerradas, b1 leído, b2 vencido
  await secondTab(page).click();
  const historial = page.locator('[data-tym-panel="historial"]');
  await expect(lubCards(page, historial)).toHaveCount(4);
});

test('11. Enviados (manager) muestra tareas y mensajes creados por el actor en una sola lista, con filtros', async ({ page }) => {
  await bootPage(page, {
    role: 'ADMINISTRADOR',
    manualTasks: [mkTask({ id: 't1', createdBy: 'actor1' }), mkTask({ id: 't2', createdBy: 'otro' })],
    broadcasts: [mkMsg({ id: 'b1', createdBy: 'actor1' }), mkMsg({ id: 'b2', createdBy: 'otro' })],
  });
  await page.evaluate(() => renderTareasYMensajes());
  await secondTab(page).click();
  const enviados = page.locator('[data-tym-panel="enviados"]');
  await expect(rows(page, enviados)).toHaveCount(2); // t1 + b1, nunca subsecciones
  await expect(enviados.locator('.tym-filter-chip')).toHaveCount(3);
  await enviados.locator('[data-enviados-filter="tareas"]').click();
  await expect(enviados.locator('.tym-row:visible')).toHaveCount(1);
});
