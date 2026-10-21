// tests/ui/config-desktop-grid.spec.js
//
// Configuración — navegación VERTICAL + contenido (lote "fix: refine
// settings layout and matrix status styling"). Reemplaza los tabs
// horizontales del lote anterior: a 1024-1920px mostraban scroll horizontal
// propio y dejaban el panel activo angosto y pegado a la izquierda con
// ~60-70% de la pantalla vacía a la derecha — ver HALLAZGO 1 del pedido.
// Carga la función REAL wireConfigCategoryNav() (app.js) sobre un fixture
// con la MISMA estructura/clases que genera renderConfig() — mismo método
// que ya usan table-responsive-p1.spec.js / otros specs de este proyecto:
// código real ejecutado, nunca una reimplementación.
//
// Pruebas A-J pedidas explícitamente:
//   A) Desktop usa navegación vertical de categorías.
//   B) No hay scroll horizontal de navegación en >=1024.
//   C) Categoría activa visible (múltiples señales, no solo color).
//   D) Solo contenido de la categoría activa visible.
//   E) Cuadrillas usa ancho amplio/full-width.
//   F) 1440 aprovecha el espacio.
//   G) 1920 aprovecha el espacio.
//   H) 390 usa lista móvil.
//   I) 412 usa lista móvil.
//   J) handlers (Guardar/Agregar/etc.) siguen funcionando tras navegar.
// (Las pruebas de fuente "Usuarios abre pantalla existente" / "Cuadrillas
// sigue usando las funciones reales" viven en tests/unit/config-categories.test.js
// — no hay DB/Auth real en este fixture estático.)

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const appSource = readSource(APP_JS_PATH);
const WIRE_NAV_SRC = `
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  // _configCategoryApply/_configResizeListenerWired/_activeConfigCategory
  // son "let" a nivel de módulo en app.js (se reasignan dentro de
  // wireConfigCategoryNav) — extractDeclaration() solo extrae
  // function/const, así que se declaran aquí igual que en el archivo real;
  // el CUERPO de la función sí es el real, extraído sin reimplementar nada.
  // _activeConfigCategory persiste la categoría elegida ENTRE llamadas
  // (renderConfig() se reconstruye tras cada Guardar) — si viviera dentro
  // de wireConfigCategoryNav(), cada llamada la resetearía a null y
  // Guardar expulsaría al usuario de la categoría activa.
  let _configCategoryApply = null;
  let _configResizeListenerWired = false;
  let _activeConfigCategory = null;
  ${extractDeclaration(appSource, 'CONFIG_DEFAULT_CATEGORY')}
  ${extractDeclaration(appSource, 'wireConfigCategoryNav')}
`;

const CATEGORIES = ['general', 'seguridad', 'operacion', 'organizacion', 'usuarios', 'notificaciones', 'sincronizacion', 'administracion'];
const LABELS = { general: 'General', seguridad: 'Seguridad', operacion: 'Operación', organizacion: 'Organización', usuarios: 'Usuarios y accesos', notificaciones: 'Notificaciones', sincronizacion: 'Sincronización', administracion: 'Administración' };

// Mismas clases/ids/estructura reales que renderConfig() (app.js) genera —
// incluye el wrapper .config-desktop-grid > (.config-tabs + .config-content)
// introducido en este lote. Alturas deliberadamente distintas para que
// Cuadrillas/Notificaciones destaquen.
function configFixture() {
  const tabs = CATEGORIES.map(k => `<button type="button" class="config-tab" role="tab" id="config-tab-${k}" aria-controls="config-cat-${k}" aria-selected="false" tabindex="-1" data-category="${k}">${LABELS[k]}</button>`).join('');
  const menu = CATEGORIES.map(k => `<button type="button" class="config-mobile-item" data-category="${k}">${LABELS[k]}<span class="config-mobile-chevron">›</span></button>`).join('');
  return `
  <div class="app-shell"><div class="app-content">
  <div id="config-root">
    <div class="config-mobile-menu" id="config-mobile-menu">${menu}</div>
    <button type="button" class="config-mobile-back hidden" id="config-mobile-back">← Volver a Configuración</button>

    <div class="config-desktop-grid">
    <nav class="config-tabs" role="tablist" aria-label="Categorías de configuración" aria-orientation="vertical">${tabs}</nav>
    <div class="config-content">

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
        <tbody><tr><td>Cuadrilla A</td><td>Rajo Principal</td><td>✓</td><td>4</td><td><button type="button" id="btn-agregar-cuadrilla-test">Agregar</button></td></tr></tbody></table>
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
        <div style="padding:14px">${'<p style="height:30px">Tarjeta de notificación.</p>'.repeat(10)}<form id="notif-form-test"><button type="submit" id="btn-guardar-notif-test">Guardar notificaciones</button></form></div>
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

test('existen las 8 categorías correctas, en nav vertical y en la lista móvil', async ({ page }) => {
  await setup(page);
  const tabLabels = await page.locator('.config-tab').allTextContents();
  expect(tabLabels).toEqual(['General', 'Seguridad', 'Operación', 'Organización', 'Usuarios y accesos', 'Notificaciones', 'Sincronización', 'Administración']);
  const menuLabels = (await page.locator('.config-mobile-item').allTextContents()).map(t => t.replace('›', '').trim());
  expect(menuLabels).toEqual(tabLabels);
});

for (const width of [1024, 1440, 1920]) {
  test(`A) ${width}px — Desktop usa navegación VERTICAL de categorías (columna, nunca fila)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    const tabsEl = page.locator('.config-tabs');
    await expect(tabsEl).toBeVisible();
    const flexDirection = await tabsEl.evaluate(el => getComputedStyle(el).flexDirection);
    expect(flexDirection).toBe('column');

    // Navegación a la izquierda, contenido a la derecha (misma fila, lado a lado).
    const tabsBox = await tabsEl.boundingBox();
    const contentBox = await page.locator('.config-content').boundingBox();
    expect(tabsBox.x).toBeLessThan(contentBox.x);
    expect(Math.abs(tabsBox.y - contentBox.y)).toBeLessThan(5);

    // Sidebar compacta (200-240px pedido), nunca angosta al punto de cortar
    // "Usuarios y acceso" ni tan ancha que compita con el contenido.
    expect(tabsBox.width).toBeGreaterThanOrEqual(190);
    expect(tabsBox.width).toBeLessThanOrEqual(260);
  });

  test(`B) ${width}px — NO existe scroll horizontal de navegación (la vertical lo elimina)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    const tabsEl = page.locator('.config-tabs');
    const { scrollWidth, clientWidth } = await tabsEl.evaluate(el => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    const overflowX = await tabsEl.evaluate(el => getComputedStyle(el).overflowX);
    expect(['visible', 'hidden', 'clip']).toContain(overflowX);

    // Ningún label se corta (ellipsis/overflow) pese al ancho compacto.
    const labels = page.locator('.config-tab');
    const count = await labels.count();
    for (let i = 0; i < count; i++) {
      const overflow = await labels.nth(i).evaluate(el => el.scrollWidth > el.clientWidth + 1);
      expect(overflow, `tab "${await labels.nth(i).textContent()}" no debe recortar su texto`).toBe(false);
    }
  });

  test(`C) ${width}px — categoría activa visible mediante fondo + borde + texto (no solo color)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    await page.locator('#config-tab-organizacion').click();
    const active = page.locator('#config-tab-organizacion');
    await expect(active).toHaveAttribute('aria-selected', 'true');
    await expect(active).toHaveClass(/active/);

    const styles = await active.evaluate(el => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, borderLeft: cs.borderLeftColor, fontWeight: cs.fontWeight };
    });
    expect(styles.borderLeft, 'borde de acento visible en la categoría activa').not.toBe('rgba(0, 0, 0, 0)');
    expect(Number(styles.fontWeight)).toBeGreaterThanOrEqual(700);

    const inactive = page.locator('#config-tab-general');
    const inactiveStyles = await inactive.evaluate(el => getComputedStyle(el).borderLeftColor);
    expect(inactiveStyles).not.toBe(styles.borderLeft);
  });

  test(`D) ${width}px — solo el contenido de la categoría activa está visible a la vez`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    await expect(page.locator('#config-cat-general')).toBeVisible();
    for (const k of CATEGORIES.filter(x => x !== 'general')) {
      await expect(page.locator(`#config-cat-${k}`)).toBeHidden();
    }
    await page.locator('#config-tab-organizacion').click();
    await expect(page.locator('#config-cat-organizacion')).toBeVisible();
    await expect(page.locator('#config-cat-general')).toBeHidden();
  });
}

test('E) Cuadrillas ocupa el ancho amplio/completo del área de contenido (nunca dentro de .config-grid-2, a diferencia de Ubicaciones/Categorías)', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await setup(page);
  await page.locator('#config-tab-organizacion').click();
  const cuadrillasBox = await page.locator('[data-cuadrillas-panel]').boundingBox();
  const contentBox = await page.locator('.config-content').boundingBox();
  expect(cuadrillasBox.width, 'Cuadrillas debe usar ~todo el ancho del área de contenido').toBeGreaterThan(contentBox.width * 0.9);

  const locBox = await page.locator('[data-simple-store="locations"]').boundingBox();
  const catBox = await page.locator('[data-simple-store="equipment_types"]').boundingBox();
  expect(locBox.width, 'Ubicaciones/Categorías sí van en grid de 2 (más angostas que el ancho completo)').toBeLessThan(contentBox.width * 0.7);
  expect(Math.abs(locBox.y - catBox.y), 'Ubicaciones y Categorías quedan en la misma fila (lado a lado)').toBeLessThan(5);
});

for (const width of [1440, 1920]) {
  test(`F/G) ${width}px — el área de contenido aprovecha el espacio real (nunca un panel angosto flotando con hueco vacío)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);

    // Organización/Administración: 2+ columnas reales, usan el ancho del
    // contenido (no de toda la pantalla — la sidebar sigue ocupando lo suyo).
    await page.locator('#config-tab-administracion').click();
    const grid = page.locator('#config-cat-administracion .config-grid-2');
    const cols = await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length);
    expect(cols, `.config-grid-2 debe usar más de 1 columna en ${testInfo.project.name}`).toBeGreaterThan(1);
    const contentBox = await page.locator('.config-content').boundingBox();
    const gridBox = await grid.boundingBox();
    expect(gridBox.width, 'el grid debe usar ~todo el ancho del área de contenido, no quedarse angosto').toBeGreaterThan(contentBox.width * 0.9);

    // Panel de 1 solo campo (General) nunca se estira a todo el ancho del
    // contenido — eso es un formulario corto, no una tabla.
    await page.locator('#config-tab-general').click();
    const narrowWidth = await page.locator('#config-cat-general .config-narrow').evaluate(el => el.getBoundingClientRect().width);
    expect(narrowWidth, `panel de 1 solo campo no debe estirarse a ${width}px`).toBeLessThanOrEqual(900);

    // La sidebar + el contenido juntos no dejan un hueco vacío enorme a la
    // derecha: el contenido real (grid de Administración) llega cerca del
    // borde derecho de .config-desktop-grid.
    await page.locator('#config-tab-administracion').click();
    const layoutBox = await page.locator('.config-desktop-grid').boundingBox();
    const grid2Box = await page.locator('#config-cat-administracion .config-grid-2').boundingBox();
    const huecoDerecha = (layoutBox.x + layoutBox.width) - (grid2Box.x + grid2Box.width);
    expect(huecoDerecha, 'no debe quedar un hueco vacío grande a la derecha del contenido real').toBeLessThan(layoutBox.width * 0.15);
  });
}

test('H) mobile 390px — arranca mostrando la lista de categorías, nunca la sidebar ni tabs comprimidas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await expect(page.locator('#config-mobile-menu')).toBeVisible();
  await expect(page.locator('.config-tabs')).toBeHidden();
  await expect(page.locator('#config-mobile-back')).toBeHidden();
  for (const k of CATEGORIES) await expect(page.locator(`#config-cat-${k}`)).toBeHidden();

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test('I) mobile 412px — misma lista móvil, tocar una categoría la abre + "Volver" regresa a la lista', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 844 });
  await setup(page);
  await expect(page.locator('#config-mobile-menu')).toBeVisible();
  await expect(page.locator('.config-tabs')).toBeHidden();

  await page.locator('.config-mobile-item[data-category="notificaciones"]').click();
  await expect(page.locator('#config-cat-notificaciones')).toBeVisible();
  await expect(page.locator('#config-mobile-menu')).toBeHidden();
  await expect(page.locator('#config-mobile-back')).toBeVisible();

  await page.locator('#config-mobile-back').click();
  await expect(page.locator('#config-cat-notificaciones')).toBeHidden();
  await expect(page.locator('#config-mobile-menu')).toBeVisible();
  await expect(page.locator('#config-mobile-back')).toBeHidden();

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test('J) handlers (Guardar/Agregar/etc.) siguen funcionando después de navegar entre categorías — el DOM nunca se reconstruye', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  let clicks = 0;
  await page.exposeFunction('__clickCounter', () => { clicks += 1; });
  await page.evaluate(() => {
    document.getElementById('btn-theme-test').addEventListener('click', () => window.__clickCounter());
    document.getElementById('btn-agregar-cuadrilla-test').addEventListener('click', () => window.__clickCounter());
    document.getElementById('btn-guardar-notif-test').addEventListener('click', (e) => { e.preventDefault(); window.__clickCounter(); });
  });

  await page.locator('#config-tab-organizacion').click();
  await page.locator('#btn-agregar-cuadrilla-test').click();
  await page.locator('#config-tab-notificaciones').click();
  await page.locator('#btn-guardar-notif-test').click();
  await page.locator('#config-tab-general').click(); // vuelve a General
  await page.locator('#btn-theme-test').click();

  expect(clicks, 'los 3 handlers siguen wireados tras varios cambios de categoría').toBe(3);
});

// K) Simplificar Configuración > Organización (auditoría 2026-10-18) —
// ROOT CAUSE NAVEGACIÓN: `active` vivía DENTRO de wireConfigCategoryNav(),
// así que cada vez que renderConfig() reconstruía #config-root (Guardar
// cuadrilla, cobertura, ubicaciones, notificaciones, etc. — ver
// wireCuadrillasPanel(c, () => renderConfig()) en app.js) la variable
// volvía a `null` y la pantalla caía a General (desktop) o a la lista de
// categorías (móvil). Simula exactamente eso: reconstruye el fixture
// (como hace renderConfig()) y vuelve a llamar wireConfigCategoryNav()
// sobre el DOM nuevo — la categoría activa debe sobrevivir, en desktop Y
// en móvil, para CUALQUIER categoría (no solo Organización).
async function rerenderLikeRenderConfig(page) {
  await page.evaluate((html) => { document.getElementById('config-root').outerHTML = html; }, configFixture());
  await page.evaluate((categories) => { window.__wireConfigCategoryNav(document.getElementById('config-root'), categories); }, CATEGORIES);
}

test('K) 1440px — Guardar (reconstrucción de #config-root) NO expulsa de Organización a General', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  await page.locator('#config-tab-organizacion').click();
  await expect(page.locator('#config-cat-organizacion')).toBeVisible();

  await rerenderLikeRenderConfig(page); // == lo que hace renderConfig() tras Guardar

  await expect(page.locator('#config-cat-organizacion')).toBeVisible();
  await expect(page.locator('#config-cat-general')).toBeHidden();
  await expect(page.locator('#config-tab-organizacion')).toHaveAttribute('aria-selected', 'true');
});

test('K) la sección activa se conserva para CUALQUIER categoría tras reconstruir (solución general, no un caso especial de Organización)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  for (const k of ['notificaciones', 'sincronizacion', 'administracion']) {
    await page.locator(`#config-tab-${k}`).click();
    await rerenderLikeRenderConfig(page);
    await expect(page.locator(`#config-cat-${k}`), `"${k}" debe seguir visible tras reconstruir`).toBeVisible();
  }
});

test('K) mobile 390px — Guardar NO regresa a la lista de categorías; la categoría abierta sigue abierta', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.locator('.config-mobile-item[data-category="organizacion"]').click();
  await expect(page.locator('#config-cat-organizacion')).toBeVisible();

  await rerenderLikeRenderConfig(page);

  await expect(page.locator('#config-cat-organizacion')).toBeVisible();
  await expect(page.locator('#config-mobile-menu')).toBeHidden();
  await expect(page.locator('#config-mobile-back')).toBeVisible();
});
