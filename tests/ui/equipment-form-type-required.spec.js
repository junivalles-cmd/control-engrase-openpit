// tests/ui/equipment-form-type-required.spec.js
//
// PASO 6 de la auditoría "equipment.typeId" (2026-10-29): openEquipmentForm()
// pre-seleccionaba `typeId: types[0]?.id` para un equipo NUEVO — el primer
// tipo de la lista, sin que el operador lo eligiera a propósito. Si ese
// primer tipo era "Camión Articulado", cualquier equipo nuevo guardado sin
// tocar el selector de Categoría quedaba silenciosamente como Articulado,
// aunque fuera una excavadora/retroexcavadora/etc. — causa UI más probable
// de los typeId incorrectos encontrados en producción (ver
// tools/diagnose-equipment-types-readonly.js). Esta suite verifica que:
// - un equipo NUEVO nunca trae categoría preseleccionada (placeholder,
//   required, el formulario no se puede enviar sin elegir una)
// - editar un equipo EXISTENTE sigue preseleccionando su typeId real sin
//   cambios (nunca se "resetea" a otro tipo por accidente)

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, DB_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

const appSource = readSource(APP_JS_PATH);
const dbSource = readSource(DB_JS_PATH);

const dbNames = ['uid', 'nowISO', 'stamp'];
const dbSrc = dbNames.map(n => extractDeclaration(dbSource, n)).join('\n\n');
const appNames = ['$', '$$', 'esc', 'ic', 'openModal', 'closeModal', 'openEquipmentForm'];
const appSrc = appNames.map(n => extractDeclaration(appSource, n)).join('\n\n');

const TYPES = [
  { id: 'type_articulado', name: 'Camión Articulado', active: true },
  { id: 'type_excavadora', name: 'Excavadora', active: true },
  { id: 'type_retro', name: 'Retroexcavadora (Back Hoe)', active: true },
];
const LOCATIONS = [{ id: 'loc1', name: 'Volcán', active: true }];

async function bootPage(page, { equipos = [] } = {}) {
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
      window.__mockData = { equipment: ${JSON.stringify(equipos)}, cuadrillas: [] };
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
      window.generateNextEquipmentCode = async () => '99-999';
      window.confirmHourmeterChange = () => true;
      window.logAudit = async () => {};
      window.showInAppToast = () => {};
      window.navigate = () => {};
      window.openPlanForm = () => {};
      window.confirm = () => false;
      window.alert = (msg) => { window.__alerts = (window.__alerts || []).concat([msg]); };
      ${dbSrc}
      ${appSrc}
      window.openEquipmentForm = openEquipmentForm;
    `,
  });
}

test('Nuevo equipo: Categoría no trae ningún tipo preseleccionado (placeholder + required)', async ({ page }) => {
  await bootPage(page);
  await page.evaluate((args) => openEquipmentForm(null, ...args), [TYPES, LOCATIONS]);
  const select = page.locator('#eq-form [name="typeId"]');
  await expect(select).toHaveAttribute('required', '');
  // La opción seleccionada por defecto es el placeholder vacío, nunca el primer tipo real.
  expect(await select.inputValue()).toBe('');
  const firstOption = select.locator('option').first();
  await expect(firstOption).toHaveAttribute('value', '');
  await expect(firstOption).toHaveAttribute('disabled', '');
});

test('Nuevo equipo: el formulario no se puede enviar sin elegir Categoría (bloqueo nativo HTML5)', async ({ page }) => {
  await bootPage(page);
  await page.evaluate((args) => openEquipmentForm(null, ...args), [TYPES, LOCATIONS]);
  await page.locator('#eq-form [name="description"]').fill('Equipo de prueba');
  await page.locator('#eq-form [name="brand"]').fill('Caterpillar');
  await page.locator('#eq-form [name="model"]').fill('336D2L');
  await page.locator('#eq-form button[type="submit"]').click();
  // Sin categoría elegida, el navegador bloquea el submit: nunca llega a DB.put.
  const created = await page.evaluate(() => (window.__mockData.equipment || []).length);
  expect(created).toBe(0);
  const validity = await page.locator('#eq-form [name="typeId"]').evaluate(el => el.validity.valid);
  expect(validity).toBe(false);
});

test('Nuevo equipo: eligiendo explícitamente una categoría SÍ guarda ese typeId exacto', async ({ page }) => {
  await bootPage(page);
  await page.evaluate((args) => openEquipmentForm(null, ...args), [TYPES, LOCATIONS]);
  await page.locator('#eq-form [name="description"]').fill('Equipo de prueba');
  await page.locator('#eq-form [name="brand"]').fill('Caterpillar');
  await page.locator('#eq-form [name="model"]').fill('336D2L');
  await page.locator('#eq-form [name="typeId"]').selectOption('type_excavadora');
  // Ubicación también es obligatoria para un alta nueva; la prueba aísla la
  // persistencia de Categoría cumpliendo el otro requisito explícitamente.
  await page.locator('#eq-form [name="locationId"]').selectOption('loc1');
  await page.locator('#eq-form button[type="submit"]').click();
  const saved = await page.evaluate(() => window.__mockData.equipment[0]);
  expect(saved.typeId).toBe('type_excavadora');
});

test('Editar equipo existente: preselecciona su typeId real, nunca el primero de la lista', async ({ page }) => {
  const existing = { id: 'eq1', code: '20-102', shortCode: null, description: 'Excavadora', brand: 'Caterpillar', model: '336D2L', serial: '', typeId: 'type_retro', locationId: 'loc1', status: 'Operativo', hourmeter: 10, shiftId: 'shift_dia', cuadrillaId: '', active: true };
  await bootPage(page, { equipos: [existing] });
  await page.evaluate((args) => openEquipmentForm(args[0], args[1], args[2]), [existing, TYPES, LOCATIONS]);
  const select = page.locator('#eq-form [name="typeId"]');
  // type_retro no es el primero de TYPES (type_articulado lo es) — confirma que NUNCA cae al primero.
  expect(await select.inputValue()).toBe('type_retro');
  await expect(select.locator('option[value=""]')).toHaveCount(0); // sin placeholder al editar
});
