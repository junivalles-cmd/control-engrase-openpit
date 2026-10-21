// tests/ui/tareas-mensajes-push-deeplink.spec.js
//
// "Push real para Tareas y Mensajes" (lote 2026-10-19) — §7/§9/§12 del
// pedido: al tocar la notificación, abrirDesdeNotificacion() debe
// sincronizar, buscar el item por ID y enfocar la fila/card exacta SIN
// abrir ningún modal. Si el sync no trae el dato todavía, avisa sin
// inventar nada local. Cubre, con el código REAL de app.js
// (abrirDesdeNotificacion/focusTareasYMensajesItem/renderTareasYMensajes,
// nunca reimplementados).
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
  'focusTareasYMensajesItem', 'abrirDesdeNotificacion', 'replayPendingDeeplink',
];
const appSrc = appNames.map(n => extractDeclaration(appSource, n)).join('\n\n');

async function bootPage(page, { role = 'LUBRICADOR', manualTasks = [], broadcasts = [], syncFails = false, locked = false } = {}) {
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
      window.App = { currentUser: ${locked ? 'null' : `{ id: 'lub1', name: 'Lubricador', role: '${role}' }`},
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18 }, route: null };
      window.__mockData = {
        manual_tasks: ${JSON.stringify(manualTasks)}, broadcast_messages: ${JSON.stringify(broadcasts)},
        broadcast_message_reads: [], equipment: [], cuadrillas: [], locations: [], users: [],
      };
      window.__syncCalls = 0;
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
      window.Sync = { fullSync: async () => {
        window.__syncCalls++;
        if (${syncFails}) throw new Error('offline');
        // Simula: el push llegó antes del dato, el dato "aparece" justo en este sync.
        if (window.__pendingSyncArrival) { window.__mockData.manual_tasks.push(window.__pendingSyncArrival); window.__pendingSyncArrival = null; }
      } };
      window.PERMISSIONS = { LUBRICADOR: [], ADMINISTRADOR: ['tareas-mensajes'] };
      // navigate() real depende de MENU/renderers de TODA la app (fuera
      // de alcance de este spec, que solo prueba abrirDesdeNotificacion()/
      // focusTareasYMensajesItem()) — stub mínimo fiel: deja App.route
      // correcto, nunca abre otra pantalla. El render CON foco real sale
      // de focusTareasYMensajesItem() -> renderTareasYMensajes(), no de aquí.
      window.navigate = (route) => { App.route = route; };
      window.logAudit = async () => {};
      window.showInAppToast = (msg) => { window.__lastToast = msg; };
      window.openCompleteManualTaskForm = () => { window.__completeOpened = true; };
      window.openEquipmentDetail = () => {};
      window.getCurrentOperationalScope = async () => ({ crewId: null });
      window.resolvePhotoThumbSrcs = async () => [];
      window.photoThumbsHTML = () => '';
      window.wirePhotoThumbs = () => {};
      window.startLubricadorGreaseFlow = () => {};
      window.showEquipmentQrInfo = () => {};
      ${dbSrc}
      ${scopeSrc}
      ${appSrc}
      window.renderTareasYMensajes = renderTareasYMensajes;
      window.abrirDesdeNotificacion = abrirDesdeNotificacion;
      window.replayPendingDeeplink = replayPendingDeeplink;
    `,
  });
}

function mkTask(overrides = {}) {
  return { id: 't1', equipmentId: 'e1', crewId: 'cq1', taskType: 'ENGRASE', status: 'PENDING',
    description: 'Revisar fuga', priority: 'MEDIA', createdBy: 'admin1', createdAt: '2026-10-19T08:00:00.000Z', ...overrides };
}
function mkMsg(overrides = {}) {
  return { id: 'b1', title: 'Aviso', message: 'Cuidado', priority: 'INFORMATIVA',
    targetType: 'ALL_LUBRICATORS', createdBy: 'admin1', createdAt: '2026-10-19T08:00:00.000Z',
    validFrom: null, validUntil: null, ...overrides };
}

test('12. Tocar push de TAREA: sincroniza, navega a Pendientes y enfoca la card (sin modal)', async ({ page }) => {
  await bootPage(page, { manualTasks: [mkTask()] });
  await page.evaluate(() => abrirDesdeNotificacion({ taskId: 't1' }));
  const syncCalls = await page.evaluate(() => window.__syncCalls);
  expect(syncCalls).toBe(1);
  const card = page.locator('[data-tym-id="t1"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/tym-focus-flash/);
  await expect(page.locator('#modal-overlay.open')).toHaveCount(0);
  const completeOpened = await page.evaluate(() => window.__completeOpened);
  expect(completeOpened).toBeFalsy(); // enfocar nunca dispara Completar solo
  await expect(card.locator('.tym-lub-complete')).toBeVisible(); // pero sigue visible para que la persona lo toque
});

test('13. Tocar push de MENSAJE: enfoca la card correspondiente', async ({ page }) => {
  await bootPage(page, { broadcasts: [mkMsg()] });
  await page.evaluate(() => abrirDesdeNotificacion({ messageId: 'b1' }));
  const card = page.locator('[data-tym-id="b1"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/tym-focus-flash/);
});

test('9a. Push llega ANTES que el dato exista: tras sync aparece y se enfoca (nunca se inventa localmente)', async ({ page }) => {
  await bootPage(page, { manualTasks: [] });
  await page.evaluate(() => { window.__pendingSyncArrival = {
    id: 't2', equipmentId: 'e1', crewId: 'cq1', taskType: 'ENGRASE', status: 'PENDING',
    description: 'Llegó tarde', priority: 'MEDIA', createdBy: 'admin1', createdAt: '2026-10-19T08:00:00.000Z',
  }; });
  await page.evaluate(() => abrirDesdeNotificacion({ taskId: 't2' }));
  await expect(page.locator('[data-tym-id="t2"]')).toBeVisible();
});

test('9b. Push llega y el dato SIGUE sin aparecer tras sync: mensaje seguro, nunca un item falso', async ({ page }) => {
  await bootPage(page, { manualTasks: [] });
  await page.evaluate(() => abrirDesdeNotificacion({ taskId: 'nunca-existe' }));
  const toast = await page.evaluate(() => window.__lastToast);
  expect(toast).toContain('todavía se está sincronizando');
  await expect(page.locator('[data-tym-id="nunca-existe"]')).toHaveCount(0);
  const tasksCount = await page.evaluate(() => window.__mockData.manual_tasks.length);
  expect(tasksCount).toBe(0); // nunca se crea nada local
});

test('Sin red: el fallo de sync no rompe el enfoque (usa lo que ya hay localmente)', async ({ page }) => {
  await bootPage(page, { manualTasks: [mkTask()], syncFails: true });
  await page.evaluate(() => abrirDesdeNotificacion({ taskId: 't1' }));
  await expect(page.locator('[data-tym-id="t1"]')).toBeVisible();
});

// Hallazgo real (E2E push/deeplink, 2026-10-20): wirePushListeners() se
// engancha ANTES del gate de Quick Unlock — un tap en la notificación
// mientras la pantalla de PIN sigue mostrándose (App.currentUser todavía
// null) perdía el deep-link en silencio, sin ningún reintento después de
// desbloquear. Fix: abrirDesdeNotificacion() lo guarda en
// App._pendingDeeplink; replayPendingDeeplink() (llamada por
// enterAppAsProfile()/el restore de sesión legacy/doLogin() legacy, los 3
// únicos puntos donde App.currentUser pasa de null a un valor real) lo
// reproduce una sola vez.
test('14. Tap con la app bloqueada (sin currentUser): el deep-link se guarda y se reproduce recién al desbloquear', async ({ page }) => {
  await bootPage(page, { manualTasks: [mkTask()], locked: true });
  await page.evaluate(() => abrirDesdeNotificacion({ taskId: 't1' }));
  // Bloqueada: nunca navega ni sincroniza todavía.
  expect(await page.evaluate(() => App.route)).toBeNull();
  expect(await page.evaluate(() => window.__syncCalls)).toBe(0);
  expect(await page.evaluate(() => App._pendingDeeplink)).toEqual({ taskId: 't1' });

  // Simula el desbloqueo real (mismo orden que enterAppAsProfile(): primero
  // currentUser, después boot(), después el replay).
  await page.evaluate(() => { App.currentUser = { id: 'lub1', name: 'Lubricador', role: 'LUBRICADOR' }; });
  await page.evaluate(() => replayPendingDeeplink());

  expect(await page.evaluate(() => App._pendingDeeplink)).toBeNull();
  expect(await page.evaluate(() => window.__syncCalls)).toBe(1);
  const card = page.locator('[data-tym-id="t1"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/tym-focus-flash/);
});

test('15. Reproducir sin ningún deep-link pendiente no hace nada (nunca sincroniza/navega de más)', async ({ page }) => {
  await bootPage(page, { manualTasks: [mkTask()] });
  await page.evaluate(() => replayPendingDeeplink());
  expect(await page.evaluate(() => window.__syncCalls)).toBe(0);
  expect(await page.evaluate(() => App.route)).toBeNull();
});
