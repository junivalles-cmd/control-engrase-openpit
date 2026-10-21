// tests/ui/tareas-mensajes-lubricador-inline.spec.js
//
// "Simplificar Tareas y Mensajes para LUBRICADOR eliminando clicks
// innecesarios" (lote 2026-10-19). Cubre, con el código REAL de app.js
// (renderTareasYMensajes, nunca reimplementado): las cards de LUBRICADOR
// en Pendientes/Historial son autosuficientes — sin "Ver", sin panel de
// detalle, sin fila clicable. Manager sigue usando el patrón Inbox (fila +
// panel de detalle) sin cambios — ver tareas-mensajes-inbox.spec.js/
// tareas-mensajes-compact.spec.js.
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

async function bootPage(page, { manualTasks = [], broadcasts = [], reads = [], equipos = [], cuadrillas = [] } = {}) {
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
      window.App = { currentUser: { id: 'lub1', name: 'Lubricador de prueba', role: 'LUBRICADOR' },
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18 } };
      window.__mockData = {
        manual_tasks: ${JSON.stringify(manualTasks)}, broadcast_messages: ${JSON.stringify(broadcasts)},
        broadcast_message_reads: ${JSON.stringify(reads)}, equipment: ${JSON.stringify(equipos)},
        cuadrillas: ${JSON.stringify(cuadrillas)}, locations: [], users: [],
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
      window.openCompleteManualTaskForm = (task, equipo, onDone) => { window.__completeFormOpenedFor = task.id; onDone?.(); };
      window.openEquipmentDetail = () => {};
      window.getCurrentOperationalScope = async () => ({ crewId: null });
      window.resolvePhotoThumbSrcs = async (t) => (t.photos || []).map(p => p);
      window.photoThumbsHTML = (t, label, srcs) => '<div class="mock-photos">' + (srcs || []).length + ' photos</div>';
      window.wirePhotoThumbs = () => {};
      ${dbSrc}
      ${scopeSrc}
      ${appSrc}
      window.renderTareasYMensajes = renderTareasYMensajes;
    `,
  });
}

const pendientesPanel = page => page.locator('[data-tym-panel="pendientes"]');
const historialPanel = page => page.locator('[data-tym-panel="historial"]');
const cards = (page, panel) => panel.locator('.lub-arrastrado-card');

function mkTask(overrides = {}) {
  return { id: 't1', equipmentId: 'e1', crewId: 'cq1', taskType: 'ENGRASE', status: 'PENDING',
    description: 'Revisar fuga de aceite', priority: 'MEDIA', createdBy: 'admin1', createdAt: '2026-10-19T08:00:00.000Z', ...overrides };
}
function mkMsg(overrides = {}) {
  return { id: 'b1', title: 'Aviso', message: 'Cuidado con la pendiente', priority: 'INFORMATIVA',
    targetType: 'ALL_LUBRICATORS', createdBy: 'admin1', createdAt: '2026-10-19T08:00:00.000Z',
    validFrom: null, validUntil: null, ...overrides };
}

test('1. Tarea COMPLETED no tiene botón Ver', async ({ page }) => {
  await bootPage(page, { manualTasks: [mkTask({ status: 'COMPLETED', completedBy: 'lub1', completedAt: '2026-10-19T12:00:00.000Z' })] });
  await page.evaluate(() => renderTareasYMensajes());
  await page.locator('.tym-tab').nth(1).click();
  const card = cards(page, historialPanel(page)).first();
  await expect(card.getByText('Ver', { exact: true })).toHaveCount(0);
});

test('2/3. Datos de cierre visibles inline: completedBy y completedAt sin abrir nada', async ({ page }) => {
  await bootPage(page, { manualTasks: [mkTask({
    status: 'COMPLETED', completedBy: 'lub1', completedAt: '2026-10-19T12:00:00.000Z', completionComment: 'Quedó listo, nivel correcto.',
  })] });
  await page.evaluate(() => renderTareasYMensajes());
  await page.locator('.tym-tab').nth(1).click();
  const card = cards(page, historialPanel(page)).first();
  await expect(card).toContainText('Completada');
  await expect(card).toContainText('Atendida por');
  await expect(card).toContainText('Quedó listo, nivel correcto.');
});

test('6. Foto muestra indicador 📷 N evidencia(s)', async ({ page }) => {
  await bootPage(page, { manualTasks: [mkTask({
    status: 'COMPLETED', completedBy: 'lub1', completedAt: '2026-10-19T12:00:00.000Z', photos: ['p1', 'p2'],
  })] });
  await page.evaluate(() => renderTareasYMensajes());
  await page.locator('.tym-tab').nth(1).click();
  const card = cards(page, historialPanel(page)).first();
  await expect(card.locator('summary')).toContainText('📷 2 evidencias — Ver evidencia');
});

test('7. "Ver evidencia" solo aparece si existe evidencia (tarea sin fotos no la muestra)', async ({ page }) => {
  await bootPage(page, { manualTasks: [mkTask({ status: 'COMPLETED', completedBy: 'lub1', completedAt: '2026-10-19T12:00:00.000Z' })] });
  await page.evaluate(() => renderTareasYMensajes());
  await page.locator('.tym-tab').nth(1).click();
  const card = cards(page, historialPanel(page)).first();
  await expect(card.locator('summary')).toHaveCount(0);
});

test('Evidencia: "Ver evidencia" expande la propia card (details, sin modal)', async ({ page }) => {
  await bootPage(page, { manualTasks: [mkTask({
    status: 'COMPLETED', completedBy: 'lub1', completedAt: '2026-10-19T12:00:00.000Z', photos: ['p1'],
  })] });
  await page.evaluate(() => renderTareasYMensajes());
  await page.locator('.tym-tab').nth(1).click();
  const card = cards(page, historialPanel(page)).first();
  await expect(card.locator('.mock-photos')).toBeHidden();
  await card.locator('summary').click();
  await expect(card.locator('.mock-photos')).toBeVisible();
  // Nunca se abrió #modal-overlay — todo pasa dentro de la misma card.
  await expect(page.locator('#modal-overlay.open')).toHaveCount(0);
});

test('8. Tarea PENDING: equipo/descripción/cuadrilla/prioridad/fecha visibles, acción [Completar], sin [Ver]', async ({ page }) => {
  await bootPage(page, {
    manualTasks: [mkTask({ dueAt: '2026-10-20T18:00:00.000Z' })],
    equipos: [{ id: 'e1', code: '05-0870', brand: 'CAT', model: '320' }],
    cuadrillas: [{ id: 'cq1', name: 'Cuadrilla A' }],
  });
  await page.evaluate(() => renderTareasYMensajes());
  const card = cards(page, pendientesPanel(page)).first();
  await expect(card).toContainText('05-0870');
  await expect(card).toContainText('Revisar fuga de aceite');
  await expect(card).toContainText('Cuadrilla A');
  await expect(card).toContainText('Media');
  await expect(card).toContainText('Vence');
  await expect(card.getByText('Ver', { exact: true })).toHaveCount(0);
  const completeBtn = card.locator('.tym-lub-complete');
  await expect(completeBtn).toHaveText(/Completar/);
  await completeBtn.click();
  const opened = await page.evaluate(() => window.__completeFormOpenedFor);
  expect(opened).toBe('t1');
});

test('9. Mensaje no leído: título/mensaje/prioridad/destino/fecha visibles, acción [Marcar leído]', async ({ page }) => {
  await bootPage(page, { broadcasts: [mkMsg({ priority: 'CRITICA' })] });
  await page.evaluate(() => renderTareasYMensajes());
  const card = cards(page, pendientesPanel(page)).first();
  await expect(card).toContainText('Aviso');
  await expect(card).toContainText('Cuidado con la pendiente');
  await expect(card).toContainText('Crítica');
  await expect(card).toContainText('Todos los lubricadores');
  await expect(card.locator('.tym-lub-markread')).toHaveText(/Marcar leído/);
});

test('10. Mensaje leído no tiene botón Ver (ni ningún botón)', async ({ page }) => {
  await bootPage(page, {
    broadcasts: [mkMsg()],
    reads: [{ id: 'b1:lub1', messageId: 'b1', userId: 'lub1', readAt: '2026-10-19T09:00:00.000Z' }],
  });
  await page.evaluate(() => renderTareasYMensajes());
  await page.locator('.tym-tab').nth(1).click();
  const card = cards(page, historialPanel(page)).first();
  await expect(card).toContainText('LEÍDO');
  await expect(card.locator('button')).toHaveCount(0);
});

test('11. No duplicar información: cada campo aparece una sola vez en la card', async ({ page }) => {
  await bootPage(page, { manualTasks: [mkTask({
    status: 'COMPLETED', completedBy: 'lub1', completedAt: '2026-10-19T12:00:00.000Z', completionComment: 'Listo',
  })] });
  await page.evaluate(() => renderTareasYMensajes());
  await page.locator('.tym-tab').nth(1).click();
  const card = cards(page, historialPanel(page)).first();
  const html = await card.innerHTML();
  expect(html.match(/Revisar fuga de aceite/g)?.length || 0).toBe(1);
  expect(html.match(/Listo/g)?.length || 0).toBe(1);
});

test('Cancelada: también sin botón Ver, estado visible inline', async ({ page }) => {
  await bootPage(page, { manualTasks: [mkTask({ status: 'CANCELLED' })] });
  await page.evaluate(() => renderTareasYMensajes());
  await page.locator('.tym-tab').nth(1).click();
  const card = cards(page, historialPanel(page)).first();
  await expect(card).toContainText('Cancelada');
  await expect(card.getByText('Ver', { exact: true })).toHaveCount(0);
});

test('13. Badge sin regresión (misma fuente única, no se tocó)', async ({ page }) => {
  await bootPage(page, { manualTasks: [mkTask()], broadcasts: [mkMsg({ id: 'b2' })] });
  const badge = await page.evaluate(() => computeTasksMensajesBadgeCount());
  expect(badge).toBe(2);
});

for (const width of [390, 412, 768, 1366]) {
  test(`12. ${width}px: usable, sin overflow horizontal`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await bootPage(page, { manualTasks: [mkTask({ status: 'COMPLETED', completedBy: 'lub1', completedAt: '2026-10-19T12:00:00.000Z', photos: ['p1'] })] });
    await page.evaluate(() => renderTareasYMensajes());
    await page.locator('.tym-tab').nth(1).click();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
}
