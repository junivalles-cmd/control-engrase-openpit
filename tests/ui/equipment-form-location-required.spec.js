// Ubicación maestra de equipos: un alta nueva requiere una selección explícita.
// Esta cobertura es deliberadamente local al formulario; no toca auth, sync,
// planes ni el flujo de copiar puntos.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, DB_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const appSource = readSource(APP_JS_PATH);
const dbSource = readSource(DB_JS_PATH);
const dbSrc = ['uid', 'nowISO', 'stamp'].map(n => extractDeclaration(dbSource, n)).join('\n\n');
const appSrc = ['$', '$$', 'esc', 'ic', 'openModal', 'closeModal', 'openEquipmentForm']
  .map(n => extractDeclaration(appSource, n)).join('\n\n');

const TYPES = [
  { id: 'type_articulado', name: 'Camión Articulado', active: true },
  { id: 'type_excavadora', name: 'Excavadora', active: true },
];
const LOCATIONS = [
  { id: 'loc1', name: 'Volcán', active: true },
  { id: 'loc2', name: 'Mojón', active: true },
];

async function bootPage(page, { equipos = [] } = {}) {
  await page.route('**/*', route => route.request().resourceType() === 'document'
    ? route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' })
    : route.continue());
  await page.goto('/');
  await page.setContent('<div class="app-shell"><main id="app-content"></main></div>');
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({ content: `
    window.App = { currentUser: { id: 'admin1', name: 'Admin de prueba', role: 'ADMINISTRADOR' } };
    window.__mockData = { equipment: ${JSON.stringify(equipos)}, cuadrillas: [] };
    window.DB = {
      allActive: async store => window.__mockData[store] || [],
      all: async store => window.__mockData[store] || [],
      put: async (store, row) => {
        const list = window.__mockData[store] || (window.__mockData[store] = []);
        const i = list.findIndex(item => item.id === row.id);
        if (i >= 0) list[i] = row; else list.push(row);
        return row;
      },
    };
    window.generateNextEquipmentCode = async () => '99-999';
    window.confirmHourmeterChange = () => true;
    window.logAudit = async () => {};
    window.showInAppToast = () => {};
    window.navigate = () => {};
    window.openPlanForm = () => {};
    window.confirm = () => false;
    window.alert = () => {};
    ${dbSrc}
    ${appSrc}
    window.openEquipmentForm = openEquipmentForm;
  ` });
}

async function fillRequiredEquipmentFields(page) {
  await page.locator('#eq-form [name="description"]').fill('Equipo de prueba');
  await page.locator('#eq-form [name="brand"]').fill('Caterpillar');
  await page.locator('#eq-form [name="model"]').fill('336D2L');
}

test('Nuevo equipo: Ubicación inicia vacía y muestra placeholder requerido', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(args => openEquipmentForm(null, ...args), [TYPES, LOCATIONS]);
  const location = page.locator('#eq-form [name="locationId"]');
  await expect(location).toHaveAttribute('required', '');
  await expect(location).toHaveValue('');
  const placeholder = location.locator('option').first();
  await expect(placeholder).toHaveAttribute('value', '');
  await expect(placeholder).toHaveAttribute('disabled', '');
  await expect(placeholder).toHaveText('— Selecciona una ubicación —');
});

test('Nuevo equipo: guardar sin ubicación queda bloqueado por HTML5', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(args => openEquipmentForm(null, ...args), [TYPES, LOCATIONS]);
  await fillRequiredEquipmentFields(page);
  await page.locator('#eq-form [name="typeId"]').selectOption('type_excavadora');
  await page.locator('#eq-form button[type="submit"]').click();
  expect(await page.evaluate(() => window.__mockData.equipment.length)).toBe(0);
  expect(await page.locator('#eq-form [name="locationId"]').evaluate(el => el.validity.valid)).toBe(false);
});

test('Nuevo equipo: elegir ubicación permite guardar ese locationId exacto', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(args => openEquipmentForm(null, ...args), [TYPES, LOCATIONS]);
  await fillRequiredEquipmentFields(page);
  await page.locator('#eq-form [name="typeId"]').selectOption('type_excavadora');
  await page.locator('#eq-form [name="locationId"]').selectOption('loc2');
  await page.locator('#eq-form button[type="submit"]').click();
  expect(await page.evaluate(() => window.__mockData.equipment[0].locationId)).toBe('loc2');
});

test('Editar equipo existente: conserva su locationId real sin placeholder', async ({ page }) => {
  const existing = { id: 'eq1', code: '20-102', shortCode: '', description: 'Excavadora', brand: 'Caterpillar', model: '336D2L', serial: '', typeId: 'type_excavadora', locationId: 'loc2', status: 'Operativo', hourmeter: 10, shiftId: 'shift_dia', cuadrillaId: '', active: true };
  await bootPage(page, { equipos: [existing] });
  await page.evaluate(args => openEquipmentForm(args[0], args[1], args[2]), [existing, TYPES, LOCATIONS]);
  const location = page.locator('#eq-form [name="locationId"]');
  await expect(location).toHaveValue('loc2');
  await expect(location.locator('option[value=""]')).toHaveCount(0);
});

test('Editar equipo: cambiar categoría no altera ubicación', async ({ page }) => {
  const existing = { id: 'eq1', code: '20-102', shortCode: '', description: 'Excavadora', brand: 'Caterpillar', model: '336D2L', serial: '', typeId: 'type_excavadora', locationId: 'loc2', status: 'Operativo', hourmeter: 10, shiftId: 'shift_dia', cuadrillaId: '', active: true };
  await bootPage(page, { equipos: [existing] });
  await page.evaluate(args => openEquipmentForm(args[0], args[1], args[2]), [existing, TYPES, LOCATIONS]);
  await page.locator('#eq-form [name="typeId"]').selectOption('type_articulado');
  await expect(page.locator('#eq-form [name="locationId"]')).toHaveValue('loc2');
});

test('Editar equipo: cambiar turno o tipo no cambia ubicación sola', async ({ page }) => {
  const existing = { id: 'eq1', code: '20-102', shortCode: '', description: 'Excavadora', brand: 'Caterpillar', model: '336D2L', serial: '', typeId: 'type_excavadora', locationId: 'loc2', status: 'Operativo', hourmeter: 10, shiftId: 'shift_dia', cuadrillaId: '', active: true };
  await bootPage(page, { equipos: [existing] });
  await page.evaluate(args => openEquipmentForm(args[0], args[1], args[2]), [existing, TYPES, LOCATIONS]);
  await page.locator('#eq-form [name="shiftId"]').selectOption('shift_noche');
  await page.locator('#eq-form [name="typeId"]').selectOption('type_articulado');
  await expect(page.locator('#eq-form [name="locationId"]')).toHaveValue('loc2');
});
