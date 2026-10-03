// tests/ui/config-desktop-grid.spec.js
//
// Configuración — tabs/categorías (lote dashboard+config UX, reemplaza el
// #config-grid de 2 columnas fijas: a 1920px dejaba ~65% de la pantalla
// vacío, y los 13 paneles seguían uno debajo de otro en móvil, ~6800px de
// scroll). Carga la función REAL wireConfigCategoryNav() (app.js) sobre un
// fixture con la MISMA estructura/clases que genera renderConfig() —mismo
// método que ya usan table-responsive-p1.spec.js / otros specs de este
// proyecto: código real ejecutado, nunca una reimplementación.
//
// Prueba A-L del plan (lote "Dashboard + Configuración"):
//   A) categorías correctas  B) solo la activa visible  C) tab no pierde
//   handlers  F) Cuadrillas full-width  G) mobile muestra lista  H) volver
//   funciona  I/J) 390/412 sin overflow  K) 1024 tabs usable (scroll
//   horizontal si no caben, sin cortar texto)  L) 1440/1920 usan el espacio
// (D y E — "Usuarios abre pantalla existente" / "Cuadrillas sigue
// operativa" — se prueban en tests/unit/config-categories.test.js por
// patrón de fuente, no aquí: no hay DB/Auth real en este fixture estático).

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const appSource = readSource(APP_JS_PATH);
const WIRE_NAV_SRC = `
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  // _configCategoryApply/_configResizeListenerWired son "let" a nivel de
  // módulo en app.js (se reasignan dentro de wireConfigCategoryNav) —
  // extractDeclaration() solo extrae function/const, así que se declaran
  // aquí igual que en el archivo real; el CUERPO de la función sí es el
  // real, extraído sin reimplementar nada.
  let _configCategoryApply = null;
  let _configResizeListenerWired = false;
  ${extractDeclaration(appSource, 'CONFIG_DEFAULT_CATEGORY')}
  ${extractDeclaration(appSource, 'wireConfigCategoryNav')}
`;

const CATEGORIES = ['general', 'seguridad', 'operacion', 'organizacion', 'usuarios', 'notificaciones', 'sincronizacion', 'administracion'];
const LABELS = { general: 'General', seguridad: 'Seguridad', operacion: 'Operación', organizacion: 'Organización', usuarios: 'Usuarios y acceso', notificaciones: 'Notificaciones', sincronizacion: 'Sincronización', administracion: 'Administración' };

// Mismas clases/ids reales que renderConfig() (app.js) genera — alturas
// deliberadamente distintas para que Cuadrillas/Notificaciones destaquen.
function configFixture() {
  const tabs = CATEGORIES.map(k => `<button type="button" class="config-tab" role="tab" id="config-tab-${k}" aria-controls="config-cat-${k}" aria-selected="false" tabindex="-1" data-category="${k}">${LABELS[k]}</button>`).join('');
  const menu = CATEGORIES.map(k => `<button type="button" class="config-mobile-item" data-category="${k}">${LABELS[k]}<span class="config-mobile-chevron">›</span></button>`).join('');
  return `
  <div class="app-shell"><div class="app-content">
  <div id="config-root">
    <div class="config-tabs" role="tablist" aria-label="Categorías de configuración">${tabs}</div>
    <div class="config-mobile-menu" id="config-mobile-menu">${menu}</div>
    <button type="button" class="config-mobile-back hidden" id="config-mobile-back">← Volver a Configuración</button>

    <div class="config-category hidden" id="config-cat-general" data-category="general" role="tabpanel" aria-labelledby="config-tab-general">
      <div class="panel config-narrow"><div class="panel-head"><h3>Apariencia</h3></div><div style="padding:14px"><button type="button" id="btn-theme-test">Cambiar colores</button></div></div>
    </div>
    <div class="config-category hidden" id="config-cat-seguridad" data-category="seguridad" role="tabpanel" aria-labelledby="config-tab-seguridad">
      <div class="panel config-narrow"><div class="panel-head"><h3>PIN rápido</h3></div></div>
    </div>
    <div class="config-category hidden" id="config-cat-operacion" data-category="operacion" role="tabpanel" aria-labelledby="config-tab-operacion">
      <div class="panel config-narrow"><div class="panel-head"><h3>Turnos y umbrales generales</h3></div></div>
    </div>
    <div class="config-category hidden" id="config-cat-organizacion" data-category="organizacion" role="tabpanel" aria-labelledby="config-tab-organizacion">
      <div class="panel" data-cuadrillas-panel><div class="panel-head"><h3>Cuadrillas de lubricación</h3></div>
        <table class="data-table"><thead><tr><th>Nombre</th><th>Ubicación</th><th>Por defecto</th><th>Miembros</th><th></th></tr></thead>
        <tbody><tr><td>Cuadrilla A</td><td>Rajo Principal</td><td>✓</td><td>4</td><td></td></tr></tbody></table>
      </div>
      <div class="config-grid-2">
        <div class="panel" data-simple-store="locations"><div class="panel-head"><h3>Ubicaciones / Flotas</h3></div></div>
        <div class="panel" data-simple-store="equipment_types"><div class="panel-head"><h3>Categorías de equipo</h3></div></div>
      </div>
    </div>
    <div class="config-category hidden" id="config-cat-usuarios" data-category="usuarios" role="tabpanel" aria-labelledby="config-tab-usuarios">
      <div class="panel config-narrow"><div class="panel-head"><h3>Usuarios</h3></div><div style="padding:14px"><button type="button" id="btn-config-go-usuarios">Ir a Usuarios</button></div></div>
    </div>
    <div class="config-category hidden" id="config-cat-notificaciones" data-category="notificaciones" role="tabpanel" aria-labelledby="config-tab-notificaciones">
      <div class="panel" id="notif-panel"><div class="panel-head"><h3>Notificaciones — control por tipo</h3></div>
        <div style="padding:14px">${'<p style="height:30px">Tarjeta de notificación.</p>'.repeat(10)}</div>
      </div>
      <div class="panel"><div class="panel-head"><h3>Notificaciones push</h3></div></div>
    </div>
    <div class="config-category hidden" id="config-cat-sincronizacion" data-category="sincronizacion" role="tabpanel" aria-labelledby="config-tab-sincronizacion">
      <div class="panel config-narrow"><div class="panel-head"><h3>Sincronización con base de datos remota</h3></div></div>
    </div>
    <div class="config-category hidden" id="config-cat-administracion" data-category="administracion" role="tabpanel" aria-labelledby="config-tab-administracion">
      <div class="config-grid-2">
        <div class="panel"><div class="panel-head"><h3>Papelera — recuperar lo eliminado</h3></div></div>
        <div class="panel"><div class="panel-head"><h3>Liberar espacio — borrado definitivo</h3></div></div>
        <div class="panel"><div class="panel-head"><h3>Respaldo completo de datos</h3></div></div>
      </div>
      <div class="panel" id="audit-log-panel"><div class="panel-head"><h3>Registro de auditoría</h3></div>
        <table class="data-table"><thead><tr><th>Fecha</th></tr></thead><tbody><tr><td>01/10/2026</td></tr></tbody></table>
      </div>
    </div>
  </div>
  </div></div>`;
}

async function setup(page) {
  await page.setContent(configFixture());
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `${WIRE_NAV_SRC}\nwindow.__wireConfigCategoryNav = wireConfigCategoryNav;\nwireConfigCategoryNav(document.getElementById('config-root'), ${JSON.stringify(CATEGORIES)});`,
  });
}

test('A) existen las 8 categorías correctas, en tabs y en la lista móvil', async ({ page }) => {
  await setup(page);
  const tabLabels = await page.locator('.config-tab').allTextContents();
  expect(tabLabels).toEqual(['General', 'Seguridad', 'Operación', 'Organización', 'Usuarios y acceso', 'Notificaciones', 'Sincronización', 'Administración']);
  const menuLabels = (await page.locator('.config-mobile-item').allTextContents()).map(t => t.replace('›', '').trim());
  expect(menuLabels).toEqual(tabLabels);
});

test('B) solo la categoría activa está visible a la vez (desktop)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  // Estado inicial: General activa por defecto en desktop.
  await expect(page.locator('#config-cat-general')).toBeVisible();
  for (const k of CATEGORIES.filter(x => x !== 'general')) {
    await expect(page.locator(`#config-cat-${k}`)).toBeHidden();
  }
  await page.locator('#config-tab-organizacion').click();
  await expect(page.locator('#config-cat-organizacion')).toBeVisible();
  await expect(page.locator('#config-cat-general')).toBeHidden();
  await expect(page.locator('#config-tab-organizacion')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#config-tab-general')).toHaveAttribute('aria-selected', 'false');
});

test('C) cambiar de tab no pierde los event handlers de los paneles (ya wireados antes, nunca se reconstruyen)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  let clicks = 0;
  await page.exposeFunction('__clickCounter', () => { clicks += 1; });
  await page.evaluate(() => document.getElementById('btn-theme-test').addEventListener('click', () => window.__clickCounter()));

  await page.locator('#config-tab-organizacion').click();
  await page.locator('#config-tab-general').click(); // vuelve a General
  await page.locator('#btn-theme-test').click();
  expect(clicks, 'el botón de Apariencia sigue wireado tras cambiar de tab (el DOM nunca se reconstruyó)').toBe(1);
});

test('F) Cuadrillas ocupa el ancho completo de la categoría (nunca dentro de .config-grid-2, a diferencia de Ubicaciones/Categorías)', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await setup(page);
  await page.locator('#config-tab-organizacion').click();
  const cuadrillasBox = await page.locator('[data-cuadrillas-panel]').boundingBox();
  const categoryBox = await page.locator('#config-cat-organizacion').boundingBox();
  expect(cuadrillasBox.width, 'Cuadrillas debe usar ~todo el ancho de su categoría').toBeGreaterThan(categoryBox.width * 0.9);

  const locBox = await page.locator('[data-simple-store="locations"]').boundingBox();
  const catBox = await page.locator('[data-simple-store="equipment_types"]').boundingBox();
  expect(locBox.width, 'Ubicaciones/Categorías sí van en grid de 2 (más angostas que el ancho completo)').toBeLessThan(categoryBox.width * 0.7);
  expect(Math.abs(locBox.y - catBox.y), 'Ubicaciones y Categorías quedan en la misma fila (lado a lado)').toBeLessThan(5);
});

test('G) mobile (390px): arranca mostrando la lista de categorías, ninguna categoría visible todavía', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await expect(page.locator('#config-mobile-menu')).toBeVisible();
  await expect(page.locator('#config-mobile-back')).toBeHidden();
  for (const k of CATEGORIES) await expect(page.locator(`#config-cat-${k}`)).toBeHidden();
});

test('H) mobile: tocar una categoría la abre + muestra "Volver"; "Volver" regresa a la lista', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.locator('.config-mobile-item[data-category="notificaciones"]').click();
  await expect(page.locator('#config-cat-notificaciones')).toBeVisible();
  await expect(page.locator('#config-mobile-menu')).toBeHidden();
  await expect(page.locator('#config-mobile-back')).toBeVisible();

  await page.locator('#config-mobile-back').click();
  await expect(page.locator('#config-cat-notificaciones')).toBeHidden();
  await expect(page.locator('#config-mobile-menu')).toBeVisible();
  await expect(page.locator('#config-mobile-back')).toBeHidden();
});

for (const width of [390, 412]) {
  test(`I/J) ${width}px — lista de categorías y categoría abierta, sin overflow horizontal`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    await page.locator('.config-mobile-item[data-category="organizacion"]').click();
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(scrollWidth, `overflow horizontal en ${testInfo.project.name}`).toBeLessThanOrEqual(clientWidth);
  });
}

test('K) 1024px: tabs usables — scroll horizontal disponible si no caben, nunca 2 filas, texto sin cortar, indicador de activa claro', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await setup(page);
  const tabsEl = page.locator('.config-tabs');
  await expect(tabsEl).toBeVisible();
  const overflowX = await tabsEl.evaluate(el => getComputedStyle(el).overflowX);
  expect(['auto', 'scroll']).toContain(overflowX);
  const flexWrap = await tabsEl.evaluate(el => getComputedStyle(el).flexWrap);
  expect(flexWrap, 'nunca 2 filas de tabs confusas').not.toBe('wrap');
  // Ningún label de tab se corta (ellipsis) — min-content real, no texto cortado.
  const labels = page.locator('.config-tab');
  const count = await labels.count();
  for (let i = 0; i < count; i++) {
    const overflow = await labels.nth(i).evaluate(el => el.scrollWidth > el.clientWidth);
    expect(overflow, `tab "${await labels.nth(i).textContent()}" no debe recortar su texto`).toBe(false);
  }
  await page.locator('#config-tab-administracion').click();
  await expect(page.locator('#config-tab-administracion')).toHaveAttribute('aria-selected', 'true');
  const borderColor = await page.locator('#config-tab-administracion').evaluate(el => getComputedStyle(el).borderBottomColor);
  expect(borderColor, 'indicador visual claro de tab activa (borde de acento)').not.toBe('rgba(0, 0, 0, 0)');
});

for (const width of [1440, 1920]) {
  test(`L) ${width}px — Organización/Administración usan el espacio real (2+ columnas, nunca 1 sola angosta)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    await page.locator('#config-tab-administracion').click();
    const grid = page.locator('#config-cat-administracion .config-grid-2');
    const cols = await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length);
    expect(cols, `.config-grid-2 debe usar más de 1 columna en ${testInfo.project.name}`).toBeGreaterThan(1);

    // Panel de 1 solo ítem (General) nunca se estira a todo el ancho de 1920px.
    await page.locator('#config-tab-general').click();
    const narrowWidth = await page.locator('#config-cat-general .config-narrow').evaluate(el => el.getBoundingClientRect().width);
    expect(narrowWidth, `panel de 1 solo campo no debe estirarse a ${width}px`).toBeLessThanOrEqual(760);
  });
}
