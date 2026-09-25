// tests/ui/container-width-app-content.spec.js
//
// UI/Composición visual — corrección de causa raíz #1 (docs/UI_VISUAL_COMPOSITION_AUDIT.md):
// .app-content no tenía width:100% en @media(min-width:1400px), lo que le impedía
// llenar su max-width (era hijo de .main, flex-direction:column, y margin:auto en
// el eje transversal desactiva el stretch por defecto → shrink-to-fit). Afecta a
// UI-VIS-001/002/004/101/102/104/107/201/202/203/205.
//
// No requiere login ni red: fragmento estático con la estructura/clases REALES del
// shell admin (boot(), app.js) — un panel simple de contenido, representativo de
// cualquiera de las pantallas afectadas (todas comparten el mismo .app-content).
//
// Verifica: (a) en desktop ancho (1366/1920) .app-content ahora llena su
// max-width en vez de encogerse; (b) el sidebar NO cambia de ancho en ningún
// breakpoint; (c) móvil (412) queda exactamente igual que antes del fix.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

function shell(bodyHTML) {
  return `
  <div class="app-shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand brand-sidebar"><div class="brand-mark small"></div>
        <div><div class="brand-title small">ENGRASE</div><div class="brand-sub small">OPEN PIT</div></div></div>
      <nav class="menu">
        <button class="menu-item active"><span>Dashboard</span></button>
        <button class="menu-item"><span>Equipos</span></button>
      </nav>
    </aside>
    <div class="main">
      <header class="topbar"><div class="topbar-title">Dashboard</div></header>
      <main class="app-content">${bodyHTML}</main>
    </div>
  </div>`;
}

const PANEL_BODY = `
  <div class="panel">
    <div class="panel-head"><h3>Panel de ejemplo</h3></div>
    <div style="padding:14px">Contenido representativo</div>
  </div>`;

test.describe('Causa raíz #1 — .app-content width:100% en desktop ancho', () => {
  test('412px: sin cambios respecto al comportamiento móvil previo', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 900 });
    await page.setContent(shell(PANEL_BODY));
    await page.addStyleTag({ path: STYLES_PATH });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    const appContentBox = await page.locator('.app-content').boundingBox();
    // En móvil el sidebar está oculto (position:fixed, left:-260px) — .app-content
    // debe seguir ocupando el ancho completo del viewport, igual que antes del fix.
    expect(appContentBox.width).toBe(412);

    const sidebarVisible = await page.locator('.sidebar').evaluate(
      el => getComputedStyle(el).left !== '-260px'
    );
    expect(sidebarVisible).toBe(false);
  });

  test('768px: sidebar visible, ancho fijo de 240px, sin cambios por el fix', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.setContent(shell(PANEL_BODY));
    await page.addStyleTag({ path: STYLES_PATH });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    const sidebarBox = await page.locator('.sidebar').boundingBox();
    expect(sidebarBox.width).toBe(240);
  });

  test('1366px: .app-content llena el ancho disponible (sin max-width todavía, <1400px)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.setContent(shell(PANEL_BODY));
    await page.addStyleTag({ path: STYLES_PATH });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    const sidebarBox = await page.locator('.sidebar').boundingBox();
    expect(sidebarBox.width).toBe(240);

    const appContentBox = await page.locator('.app-content').boundingBox();
    // 1366 - 240 (sidebar) = 1126px disponibles. Antes del fix ya llenaba este
    // rango (el bug solo aparece desde 1400px) — se confirma que sigue así.
    expect(appContentBox.width).toBeGreaterThanOrEqual(1120);
  });

  test('1920px: .app-content ahora llena max-width:1500px en vez de encogerse', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.setContent(shell(PANEL_BODY));
    await page.addStyleTag({ path: STYLES_PATH });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    const sidebarBox = await page.locator('.sidebar').boundingBox();
    expect(sidebarBox.width).toBe(240);

    const appContentBox = await page.locator('.app-content').boundingBox();
    // Antes del fix: ~1097px (shrink-to-fit, por debajo del ancho disponible de
    // 1680px). Después del fix: debe llenar hasta max-width:1500px real.
    expect(appContentBox.width).toBeGreaterThan(1480);
    expect(appContentBox.width).toBeLessThanOrEqual(1500);
  });
});
