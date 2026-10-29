// tests/ui/copy-points-type-filter.spec.js
//
// BUG REAL reportado en vivo (2026-10-29): "Copiar puntos de otro equipo"
// mezclaba categorías — el <select> anterior ponía un <optgroup> por TIPO
// pero los mostraba TODOS juntos (solo el tipo del destino quedaba primero),
// así que un Camión Articulado podía terminar listado junto a Excavadoras/
// Retroexcavadoras y copiar puntos de un tipo que no corresponde.
//
// openCopyPointsForm() se ejecuta de verdad (mismo patrón que
// plan-dual-shift-form.spec.js) contra fixtures sintéticos de equipment/
// equipment_types/lubrication_plans/lubrication_points — sin red, sin
// Supabase. El filtro verificado aquí usa SIEMPRE equipment.typeId (el
// mismo campo maestro que "Categoría" en el formulario de Equipos), nunca
// marca/modelo/prefijo de código/regex.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, DB_JS_PATH, LUBRICATION_STATUS_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

const appSource = readSource(APP_JS_PATH);
const dbSource = readSource(DB_JS_PATH);
const statusSource = readSource(LUBRICATION_STATUS_JS_PATH);

const dbNames = ['uid', 'nowISO', 'stamp'];
const dbSrc = dbNames.map(n => extractDeclaration(dbSource, n)).join('\n\n');
const statusSrc = extractDeclaration(statusSource, 'fmt');
const appNames = ['$', '$$', 'esc', 'ic', 'openModal', 'closeModal', 'openCopyPointsForm'];
const appSrc = appNames.map(n => extractDeclaration(appSource, n)).join('\n\n');

const TYPES = [
  { id: 'ty-art', name: 'Camión Articulado', active: true },
  { id: 'ty-exc', name: 'Excavadora', active: true },
  { id: 'ty-ret', name: 'Retroexcavadora', active: true },
  { id: 'ty-vol', name: 'Camión Volquete', active: true },
];

function eq(id, typeId, code, brand, model) {
  return { id, typeId, code, brand, model, active: true };
}
function plan(id, equipmentId, controlType = 'Horas de operación', extra = {}) {
  return { id, equipmentId, controlType, frequency: 50, alertYellowHours: 10, assignedDays: [], ...extra };
}
function pt(id, planId, point) {
  return { id, planId, point, system: 'General', component: '', greaseType: 'lub1', recommendedQty: 0.5, frequency: 50, notes: '', active: true };
}

async function bootPage(page, { equipos = [], plans = [], points = [] } = {}) {
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
      window.App = { currentUser: { id: 'admin1', name: 'Admin de prueba', role: 'ADMINISTRADOR' } };
      window.__mockData = {
        equipment: ${JSON.stringify(equipos)},
        equipment_types: ${JSON.stringify(TYPES)},
        lubrication_plans: ${JSON.stringify(plans)},
        lubrication_points: ${JSON.stringify(points)},
      };
      window.DB = {
        get: async (store, id) => (window.__mockData[store] || []).find(r => r.id === id) || null,
        allActive: async (store) => window.__mockData[store] || [],
        put: async (store, row) => {
          const list = window.__mockData[store] || (window.__mockData[store] = []);
          const i = list.findIndex(r => r.id === row.id);
          if (i >= 0) list[i] = row; else list.push(row);
          return row;
        },
      };
      window.logAudit = async () => {};
      window.showInAppToast = () => {};
      window.openPlanForm = () => {};
      window.__alerts = [];
      window.alert = (msg) => { window.__alerts.push(msg); };
      ${dbSrc}
      ${statusSrc}
      ${appSrc}
      window.openCopyPointsForm = openCopyPointsForm;
    `,
  });
}

function sourceCodes(page) {
  return page.locator('#copy-source option').allTextContents();
}

test('A/B — destino Camión Articulado: solo articulados (CAT + Komatsu, mismo tipo maestro)', async ({ page }) => {
  const equipos = [
    eq('target', 'ty-art', '45-69', 'Caterpillar', '740B'),
    eq('e2', 'ty-art', '45-70', 'Komatsu', 'HM400'),
    eq('e3', 'ty-exc', '45-71', 'Caterpillar', '374'),
    eq('e4', 'ty-ret', '45-72', 'Caterpillar', '416'),
  ];
  const plans = [plan('p2', 'e2'), plan('p3', 'e3'), plan('p4', 'e4')];
  const points = [pt('pt2', 'p2', 'Pin A'), pt('pt3', 'p3', 'Pin B'), pt('pt4', 'p4', 'Pin C')];
  await bootPage(page, { equipos, plans, points });
  const target = { id: 'target', code: '45-69', brand: 'Caterpillar', model: '740B', typeId: 'ty-art' };
  await page.evaluate((t) => openCopyPointsForm({ id: 'pTarget' }, t, []), target);
  const codes = await sourceCodes(page);
  expect(codes.length).toBe(1);
  expect(codes[0]).toContain('45-70'); // Komatsu HM400, mismo tipo articulado
  expect(codes.join(' ')).not.toContain('45-71'); // excavadora, nunca mezclada
  expect(codes.join(' ')).not.toContain('45-72'); // retroexcavadora, nunca mezclada
});

test('C — destino Excavadora: solo excavadoras', async ({ page }) => {
  const equipos = [
    eq('target', 'ty-exc', '45-71', 'Caterpillar', '374'),
    eq('e2', 'ty-exc', '45-73', 'Caterpillar', '336'),
    eq('e3', 'ty-art', '45-69', 'Caterpillar', '740B'),
  ];
  const plans = [plan('p2', 'e2'), plan('p3', 'e3')];
  const points = [pt('pt2', 'p2', 'Pin A'), pt('pt3', 'p3', 'Pin B')];
  await bootPage(page, { equipos, plans, points });
  const target = { id: 'target', code: '45-71', brand: 'Caterpillar', model: '374', typeId: 'ty-exc' };
  await page.evaluate((t) => openCopyPointsForm({ id: 'pTarget' }, t, []), target);
  const codes = await sourceCodes(page);
  expect(codes.length).toBe(1);
  expect(codes[0]).toContain('45-73');
});

test('D — destino Retroexcavadora: solo retroexcavadoras', async ({ page }) => {
  const equipos = [
    eq('target', 'ty-ret', '45-72', 'Caterpillar', '416'),
    eq('e2', 'ty-ret', '45-74', 'Caterpillar', '420'),
    eq('e3', 'ty-vol', '45-80', 'Komatsu', 'GU813E'),
  ];
  const plans = [plan('p2', 'e2'), plan('p3', 'e3')];
  const points = [pt('pt2', 'p2', 'Pin A'), pt('pt3', 'p3', 'Pin B')];
  await bootPage(page, { equipos, plans, points });
  const target = { id: 'target', code: '45-72', brand: 'Caterpillar', model: '416', typeId: 'ty-ret' };
  await page.evaluate((t) => openCopyPointsForm({ id: 'pTarget' }, t, []), target);
  const codes = await sourceCodes(page);
  expect(codes.length).toBe(1);
  expect(codes[0]).toContain('45-74');
});

test('E — destino Camión Volquete: solo volquetes', async ({ page }) => {
  const equipos = [
    eq('target', 'ty-vol', '45-80', 'Komatsu', 'GU813E'),
    eq('e2', 'ty-vol', '45-81', 'Komatsu', 'GU813E'),
    eq('e3', 'ty-exc', '45-71', 'Caterpillar', '374'),
  ];
  const plans = [plan('p2', 'e2'), plan('p3', 'e3')];
  const points = [pt('pt2', 'p2', 'Pin A'), pt('pt3', 'p3', 'Pin B')];
  await bootPage(page, { equipos, plans, points });
  const target = { id: 'target', code: '45-80', brand: 'Komatsu', model: 'GU813E', typeId: 'ty-vol' };
  await page.evaluate((t) => openCopyPointsForm({ id: 'pTarget' }, t, []), target);
  const codes = await sourceCodes(page);
  expect(codes.length).toBe(1);
  expect(codes[0]).toContain('45-81');
});

test('F — el equipo destino nunca aparece como fuente de sí mismo', async ({ page }) => {
  const equipos = [
    eq('target', 'ty-art', '45-69', 'Caterpillar', '740B'),
    eq('e2', 'ty-art', '45-70', 'Komatsu', 'HM400'),
  ];
  // El propio destino YA tiene puntos configurados (plan p-target/pt-target) —
  // no debe listarse a sí mismo como fuente aunque comparta su propio tipo.
  const plans = [plan('p-target', 'target'), plan('p2', 'e2')];
  const points = [pt('pt-t', 'p-target', 'Pin propio'), pt('pt2', 'p2', 'Pin A')];
  await bootPage(page, { equipos, plans, points });
  const target = { id: 'target', code: '45-69', brand: 'Caterpillar', model: '740B', typeId: 'ty-art' };
  await page.evaluate((t) => openCopyPointsForm({ id: 'p-target' }, t, []), target);
  const codes = await sourceCodes(page);
  expect(codes.length).toBe(1);
  expect(codes[0]).toContain('45-70');
  expect(codes.join(' ')).not.toContain('45-69');
});

test('G — equipos del mismo tipo SIN puntos configurados no aparecen', async ({ page }) => {
  const equipos = [
    eq('target', 'ty-art', '45-69', 'Caterpillar', '740B'),
    eq('e2', 'ty-art', '45-70', 'Komatsu', 'HM400'), // tiene plan pero sin puntos
    eq('e3', 'ty-art', '45-90', 'Caterpillar', '740B'), // ni siquiera tiene plan
  ];
  const plans = [plan('p2', 'e2')];
  const points = [];
  await bootPage(page, { equipos, plans, points });
  const target = { id: 'target', code: '45-69', brand: 'Caterpillar', model: '740B', typeId: 'ty-art' };
  const alerts = await page.evaluate(async (t) => {
    await openCopyPointsForm({ id: 'pTarget' }, t, []);
    return window.__alerts;
  }, target);
  expect(alerts[0]).toBe('No hay equipos del mismo tipo con puntos configurados.');
  await expect(page.locator('#copy-source')).toHaveCount(0);
});

test('H — tipo sin fuentes compatibles: mensaje claro, sin modal', async ({ page }) => {
  const equipos = [
    eq('target', 'ty-ret', '45-72', 'Caterpillar', '416'), // única retroexcavadora
    eq('e2', 'ty-art', '45-69', 'Caterpillar', '740B'),
  ];
  const plans = [plan('p2', 'e2')];
  const points = [pt('pt2', 'p2', 'Pin A')];
  await bootPage(page, { equipos, plans, points });
  const target = { id: 'target', code: '45-72', brand: 'Caterpillar', model: '416', typeId: 'ty-ret' };
  const alerts = await page.evaluate(async (t) => {
    await openCopyPointsForm({ id: 'pTarget' }, t, []);
    return window.__alerts;
  }, target);
  expect(alerts[0]).toBe('No hay equipos del mismo tipo con puntos configurados.');
  await expect(page.locator('.modal-overlay.open')).toHaveCount(0);
});

test('H2 — destino sin typeId (categoría no asignada): nunca adivina, mismo mensaje', async ({ page }) => {
  const equipos = [
    eq('target', null, '45-99', 'Sin', 'Categoría'),
    eq('e2', 'ty-art', '45-69', 'Caterpillar', '740B'),
  ];
  const plans = [plan('p2', 'e2')];
  const points = [pt('pt2', 'p2', 'Pin A')];
  await bootPage(page, { equipos, plans, points });
  const target = { id: 'target', code: '45-99', brand: 'Sin', model: 'Categoría', typeId: null };
  const alerts = await page.evaluate(async (t) => {
    await openCopyPointsForm({ id: 'pTarget' }, t, []);
    return window.__alerts;
  }, target);
  expect(alerts[0]).toBe('No hay equipos del mismo tipo con puntos configurados.');
});

test('I — búsqueda/scroll/select siguen funcionando: cambiar la fuente repinta el preview de puntos', async ({ page }) => {
  const equipos = [
    eq('target', 'ty-art', '45-69', 'Caterpillar', '740B'),
    eq('e2', 'ty-art', '45-70', 'Komatsu', 'HM400'),
    eq('e3', 'ty-art', '45-91', 'Caterpillar', '740B'),
  ];
  const plans = [plan('p2', 'e2'), plan('p3', 'e3')];
  const points = [pt('pt2a', 'p2', 'Pin A'), pt('pt2b', 'p2', 'Pin B'), pt('pt3', 'p3', 'Pin C')];
  await bootPage(page, { equipos, plans, points });
  const target = { id: 'target', code: '45-69', brand: 'Caterpillar', model: '740B', typeId: 'ty-art' };
  await page.evaluate((t) => openCopyPointsForm({ id: 'pTarget' }, t, []), target);
  await expect(page.locator('.copy-point-row')).toHaveCount(2); // p2 por defecto (primera opción)
  await page.locator('#copy-source').selectOption('p3');
  await expect(page.locator('.copy-point-row')).toHaveCount(1);
  await expect(page.locator('.copy-point-row')).toContainText('Pin C');
});

test('20 aperturas/cierres consecutivos: sin fugas de listeners, sin romperse', async ({ page }) => {
  const equipos = [
    eq('target', 'ty-art', '45-69', 'Caterpillar', '740B'),
    eq('e2', 'ty-art', '45-70', 'Komatsu', 'HM400'),
  ];
  const plans = [plan('p2', 'e2')];
  const points = [pt('pt2', 'p2', 'Pin A')];
  await bootPage(page, { equipos, plans, points });
  const target = { id: 'target', code: '45-69', brand: 'Caterpillar', model: '740B', typeId: 'ty-art' };
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  for (let i = 0; i < 20; i++) {
    await page.evaluate((t) => openCopyPointsForm({ id: 'pTarget' }, t, []), target);
    await expect(page.locator('#copy-source option')).toHaveCount(1);
    await page.evaluate(() => closeModal());
  }
  expect(errors).toEqual([]);
});
