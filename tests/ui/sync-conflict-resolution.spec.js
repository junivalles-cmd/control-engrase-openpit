// tests/ui/sync-conflict-resolution.spec.js
//
// "CERRAR FIX PREVENTIVO DE CATEGORÍA EN EQUIPOS" (2026-10-29) — resolución
// explícita y segura de conflictos de sincronización multidispositivo
// (P0-1) desde Configuración → Sincronización → Diagnóstico de
// sincronización. Dos grupos de pruebas:
//
// 1. UI del panel (A-E): syncConflictsDiagnostics()/syncConflictRowHTML()/
//    syncConflictsPanelHTML() reales (app.js) contra fixtures sintéticos —
//    sin red, sin Supabase real.
// 2. Sync.resolveEquipmentConflictUseServer() (F-M): sync.js + db.js REALES
//    cargados completos en el navegador (mismo patrón que
//    tests/ui/evidence-gateway.spec.js), con un `window.fetch` falso que
//    simula SOLO el endpoint /rest/v1/engrase_sync que la función consulta
//    — nunca se reimplementa su lógica a mano.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, DB_JS_PATH, SYNC_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const appSource = readSource(APP_JS_PATH);

/* ============================================================
   GRUPO 1 — UI del panel de conflictos (A-E)
   ============================================================ */

const uiAppNames = ['$', '$$', 'esc', 'ic', 'fmtDate', 'syncConflictsDiagnostics', 'syncConflictRowHTML', 'syncConflictsPanelHTML', 'wireSyncConflictsPanel'];
const uiAppSrc = uiAppNames.map(n => extractDeclaration(appSource, n)).join('\n\n');

async function bootUiPage(page, { equipos = [], conflicts = [] } = {}) {
  await page.route('**/*', (route) => {
    if (route.request().resourceType() === 'document') {
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    } else { route.continue(); }
  });
  await page.goto('/');
  await page.setContent('<div class="app-shell"><main id="app-content"></main></div>');
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.__mockData = { equipment: ${JSON.stringify(equipos)} };
      window.DB = {
        getSyncConflicts: async () => ${JSON.stringify(conflicts)},
        allActive: async (store) => (window.__mockData[store] || []).filter(r => r.active !== false),
        getRaw: async (store, id) => (window.__mockData[store] || []).find(r => r.id === id) || null,
      };
      window.Sync = { resolveEquipmentConflictUseServer: async () => {}, fullSync: async () => ({ ok: true }) };
      window.showInAppToast = () => {};
      window.renderConfig = () => {};
      window.fmtDate = (iso) => iso;
      ${uiAppSrc}
    `,
  });
}

test('A. lista los conflictos reales en Diagnóstico', async ({ page }) => {
  const conflicts = [
    { store: 'equipment', id: 'eq1', localVersion: '2026-10-29T10:00:00.000Z', remoteVersion: '2026-10-29T11:00:00.000Z', detectedAt: '2026-10-29T11:00:01.000Z' },
    { store: 'lubrication_plans', id: 'p1', localVersion: '2026-10-29T09:00:00.000Z', remoteVersion: '2026-10-29T09:30:00.000Z', detectedAt: '2026-10-29T09:30:01.000Z' },
  ];
  const equipos = [{ id: 'eq1', code: '20-102', active: true }];
  await bootUiPage(page, { equipos, conflicts });
  const result = await page.evaluate(async () => {
    const items = await syncConflictsDiagnostics();
    document.querySelector('#app-content').innerHTML = syncConflictsPanelHTML(items, true);
    return items;
  });
  expect(result).toHaveLength(2);
  await expect(page.locator('#sync-conflicts-area tbody tr')).toHaveCount(2);
  await expect(page.locator('[data-conflict-id="eq1"]')).toContainText('20-102');
});

test('B. equipment muestra el botón "Aceptar servidor"', async ({ page }) => {
  const conflicts = [{ store: 'equipment', id: 'eq1', localVersion: 'a', remoteVersion: 'b', detectedAt: 'c' }];
  await bootUiPage(page, { equipos: [{ id: 'eq1', code: '20-102', active: true }], conflicts });
  await page.evaluate(async () => {
    const items = await syncConflictsDiagnostics();
    document.querySelector('#app-content').innerHTML = syncConflictsPanelHTML(items, true);
  });
  await expect(page.locator('[data-conflict-id="eq1"] .btn-accept-server-conflict')).toHaveCount(1);
  await expect(page.locator('[data-conflict-id="eq1"]')).not.toContainText('Revisión manual requerida');
});

test('C. otros stores (no equipment) nunca permiten auto-resolver, aunque el usuario sea admin', async ({ page }) => {
  const conflicts = [{ store: 'lubrication_records', id: 'r1', localVersion: 'a', remoteVersion: 'b', detectedAt: 'c' }];
  await bootUiPage(page, { conflicts });
  await page.evaluate(async () => {
    const items = await syncConflictsDiagnostics();
    document.querySelector('#app-content').innerHTML = syncConflictsPanelHTML(items, true); // canResolveEquipment=true a propósito
  });
  await expect(page.locator('[data-conflict-id="r1"] .btn-accept-server-conflict')).toHaveCount(0);
  await expect(page.locator('[data-conflict-id="r1"]')).toContainText('Revisión manual requerida');
});

test('D. ADMINISTRADOR ve el botón para equipment', async ({ page }) => {
  const conflicts = [{ store: 'equipment', id: 'eq1', localVersion: 'a', remoteVersion: 'b', detectedAt: 'c' }];
  await bootUiPage(page, { equipos: [{ id: 'eq1', code: '20-102', active: true }], conflicts });
  await page.evaluate(async () => {
    const items = await syncConflictsDiagnostics();
    document.querySelector('#app-content').innerHTML = syncConflictsPanelHTML(items, true);
  });
  await expect(page.locator('.btn-accept-server-conflict')).toHaveCount(1);
});

test('E. un rol NO administrador nunca tiene el botón, ni siquiera para equipment', async ({ page }) => {
  const conflicts = [{ store: 'equipment', id: 'eq1', localVersion: 'a', remoteVersion: 'b', detectedAt: 'c' }];
  await bootUiPage(page, { equipos: [{ id: 'eq1', code: '20-102', active: true }], conflicts });
  await page.evaluate(async () => {
    const items = await syncConflictsDiagnostics();
    document.querySelector('#app-content').innerHTML = syncConflictsPanelHTML(items, false); // canResolveEquipment=false
  });
  await expect(page.locator('.btn-accept-server-conflict')).toHaveCount(0);
  await expect(page.locator('[data-conflict-id="eq1"]')).toContainText('Revisión manual requerida');
});

/* ============================================================
   GRUPO 2 — Sync.resolveEquipmentConflictUseServer() real (F-M)
   ============================================================ */

async function bootSyncPage(page) {
  await page.route('**/*', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.goto('/');
  await page.addScriptTag({ content: readSource(DB_JS_PATH) });
  await page.addScriptTag({
    content: `
      window.App = { currentUser: { id: 'admin1', name: 'Admin fixture', role: 'ADMINISTRADOR' } };
      window.__requests = [];
      window.__remoteRow = null; // { id, payload, updated_at, deleted } — controla la respuesta del único equipo consultado
      window.Auth = {
        isSupabaseMode: () => true, isAuthenticated: () => true,
        getProfile: () => ({ appUserId: 'admin1', authorizationFingerprint: 'fp1' }),
        getSession: () => ({ accessToken: 'fixture-jwt' }),
        getSessionEpoch: () => 1,
      };
      window.classifyAuthStatus = s => s === 401 ? 'AUTH_REQUIRED' : s === 403 ? 'AUTH_FORBIDDEN' : null;
      window.fetch = async (url, options) => {
        window.__requests.push({ url: String(url), method: options?.method || 'GET' });
        if (String(url).includes('/rest/v1/engrase_sync') && String(url).includes('store=eq.equipment')) {
          return { ok: true, status: 200, json: async () => (window.__remoteRow ? [window.__remoteRow] : []) };
        }
        return { ok: true, status: 200, json: async () => [] };
      };
    `,
  });
  await page.addScriptTag({ content: readSource(SYNC_JS_PATH) });
  await page.evaluate(async () => {
    await openDB();
    await DB.setConfig({ url: 'https://fixture.test', anonKey: 'public-key' });
    await DB.setAuthorizationContext('admin1', { appUserId: 'admin1', active: true, scopeType: 'GLOBAL', rowScopeEnforced: true, authUserId: 'authAdmin1', authorizationFingerprint: 'fp1' });
  });
}

const BASE_VERSION = '2026-10-29T10:00:00.000Z';
const REMOTE_VERSION = '2026-10-29T11:00:00.000Z';

async function seedConflictedEquipment(page, overrides = {}) {
  return page.evaluate(async ({ BASE_VERSION, overrides }) => {
    const local = {
      id: 'eq1', code: '20-102', shortCode: null, brand: 'Caterpillar', model: '336D2L',
      typeId: 'type_articulado', // valor LOCAL incorrecto (bug real, ya corregido en el servidor)
      locationId: 'loc1', status: 'Operativo', hourmeter: 120, active: true,
      updatedAt: BASE_VERSION, _pushedVersion: '2026-10-28T00:00:00.000Z', // dirty: updatedAt != _pushedVersion
      ...overrides,
    };
    await DB.put('equipment', local, { source: 'server' }); // source:'server' para no pelear con AUTHORIZATION_ACCOUNT_MISMATCH en el fixture
    await DB.recordConflicts([{ store: 'equipment', id: 'eq1', localVersion: local.updatedAt, remoteVersion: '2026-10-29T10:30:00.000Z', detectedAt: '2026-10-29T10:30:01.000Z' }]);
    return local;
  }, { BASE_VERSION, overrides });
}

test('F. una operación pendiente (_executionOperationId/_evidenceOperationId) bloquea la resolución', async ({ page }) => {
  await bootSyncPage(page);
  await seedConflictedEquipment(page, { _executionOperationId: 'op-123' });
  const result = await page.evaluate(async () => {
    try { await Sync.resolveEquipmentConflictUseServer('eq1'); return { threw: null }; }
    catch (e) { return { threw: e.message }; }
  });
  expect(result.threw).toBe('PENDING_OPERATION_REVIEW_REQUIRED');
  const after = await page.evaluate(async () => ({ row: await DB.getRaw('equipment', 'eq1'), conflicts: await DB.getSyncConflicts(), requests: window.__requests }));
  expect(after.row.typeId).toBe('type_articulado'); // nunca se tocó
  expect(after.conflicts).toHaveLength(1); // el conflicto sigue ahí
  expect(after.requests.filter(r => r.url.includes('engrase_sync')).length).toBe(0); // nunca llegó a pedir el remoto
});

test('G/H. remote row reemplaza local y _pushedVersion = remote.updated_at', async ({ page }) => {
  await bootSyncPage(page);
  await seedConflictedEquipment(page);
  await page.evaluate(({ REMOTE_VERSION }) => {
    window.__remoteRow = {
      id: 'eq1',
      payload: { id: 'eq1', code: '20-102', shortCode: 'A-20', brand: 'Caterpillar', model: '336D2L', typeId: 'type_excavadora', locationId: 'loc1', status: 'Operativo', hourmeter: 150, updatedAt: REMOTE_VERSION },
      updated_at: REMOTE_VERSION, deleted: false,
    };
  }, { REMOTE_VERSION });
  const canonical = await page.evaluate(() => Sync.resolveEquipmentConflictUseServer('eq1'));
  expect(canonical.typeId).toBe('type_excavadora'); // la versión del servidor gana
  expect(canonical._pushedVersion).toBe(REMOTE_VERSION);
  const saved = await page.evaluate(() => DB.getRaw('equipment', 'eq1'));
  expect(saved.typeId).toBe('type_excavadora');
  expect(saved.hourmeter).toBe(150);
  expect(saved._pushedVersion).toBe(REMOTE_VERSION);
  expect(saved.updatedAt).toBe(REMOTE_VERSION);
  expect(saved.id).toBe('eq1'); // id preservado
  expect(saved.code).toBe('20-102'); // code preservado
});

test('I/J. clearSyncConflict elimina SOLO el conflicto resuelto; el segundo permanece', async ({ page }) => {
  await bootSyncPage(page);
  await seedConflictedEquipment(page);
  await page.evaluate(async () => {
    await DB.put('equipment', { id: 'eq2', code: '45-69', brand: 'Caterpillar', model: '740B', typeId: 'type_articulado', active: true, updatedAt: '2026-10-29T10:00:00.000Z', _pushedVersion: '2026-10-28T00:00:00.000Z' }, { source: 'server' });
    await DB.recordConflicts([{ store: 'equipment', id: 'eq2', localVersion: 'x', remoteVersion: 'y', detectedAt: 'z' }]);
  });
  await page.evaluate(({ REMOTE_VERSION }) => {
    window.__remoteRow = { id: 'eq1', payload: { id: 'eq1', code: '20-102', brand: 'Caterpillar', model: '336D2L', typeId: 'type_excavadora', updatedAt: REMOTE_VERSION }, updated_at: REMOTE_VERSION, deleted: false };
  }, { REMOTE_VERSION });
  await page.evaluate(() => Sync.resolveEquipmentConflictUseServer('eq1'));
  const afterFirst = await page.evaluate(() => DB.getSyncConflicts());
  expect(afterFirst.map(c => c.id).sort()).toEqual(['eq2']); // eq1 se fue, eq2 sigue (J)

  await page.evaluate(({ REMOTE_VERSION }) => {
    window.__remoteRow = { id: 'eq2', payload: { id: 'eq2', code: '45-69', brand: 'Caterpillar', model: '740B', typeId: 'type_articulado', updatedAt: REMOTE_VERSION }, updated_at: REMOTE_VERSION, deleted: false };
  }, { REMOTE_VERSION });
  await page.evaluate(() => Sync.resolveEquipmentConflictUseServer('eq2'));
  const afterSecond = await page.evaluate(() => DB.getSyncConflicts());
  expect(afterSecond).toHaveLength(0); // K: tras resolver ambos -> conflicts=0
});

test('L. después de resolver, el equipo ya no cuenta como pendiente (próximo fullSync no lo subiría)', async ({ page }) => {
  await bootSyncPage(page);
  await seedConflictedEquipment(page);
  await page.evaluate(({ REMOTE_VERSION }) => {
    window.__remoteRow = { id: 'eq1', payload: { id: 'eq1', code: '20-102', brand: 'Caterpillar', model: '336D2L', typeId: 'type_excavadora', updatedAt: REMOTE_VERSION }, updated_at: REMOTE_VERSION, deleted: false };
  }, { REMOTE_VERSION });
  const before = await page.evaluate(() => Sync.pendingCount());
  expect(before).toBeGreaterThan(0); // dirty antes de resolver
  await page.evaluate(() => Sync.resolveEquipmentConflictUseServer('eq1'));
  const after = await page.evaluate(() => Sync.pendingCount());
  expect(after).toBe(0);
});

test('M. resolver un conflicto de equipment no altera lubrication_plans ni lubrication_points', async ({ page }) => {
  await bootSyncPage(page);
  await seedConflictedEquipment(page);
  const before = await page.evaluate(async () => {
    const plan = { id: 'plan1', equipmentId: 'eq1', controlType: 'Horas de operación', frequency: 50, active: true, updatedAt: '2026-10-20T00:00:00.000Z', _pushedVersion: '2026-10-20T00:00:00.000Z' };
    const point = { id: 'pt1', planId: 'plan1', point: 'Pin de dirección', active: true, updatedAt: '2026-10-20T00:00:00.000Z', _pushedVersion: '2026-10-20T00:00:00.000Z' };
    await DB.put('lubrication_plans', plan, { source: 'server' });
    await DB.put('lubrication_points', point, { source: 'server' });
    return { plan: await DB.getRaw('lubrication_plans', 'plan1'), point: await DB.getRaw('lubrication_points', 'pt1') };
  });
  await page.evaluate(({ REMOTE_VERSION }) => {
    window.__remoteRow = { id: 'eq1', payload: { id: 'eq1', code: '20-102', brand: 'Caterpillar', model: '336D2L', typeId: 'type_excavadora', updatedAt: REMOTE_VERSION }, updated_at: REMOTE_VERSION, deleted: false };
  }, { REMOTE_VERSION });
  await page.evaluate(() => Sync.resolveEquipmentConflictUseServer('eq1'));
  const after = await page.evaluate(async () => ({ plan: await DB.getRaw('lubrication_plans', 'plan1'), point: await DB.getRaw('lubrication_points', 'pt1') }));
  expect(after.plan).toEqual(before.plan);
  expect(after.point).toEqual(before.point);
});
