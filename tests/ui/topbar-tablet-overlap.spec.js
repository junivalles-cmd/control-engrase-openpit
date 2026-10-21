// tests/ui/topbar-tablet-overlap.spec.js
//
// HALLAZGO (lote "fix: prevent topbar overlap at tablet width"): a
// ~1000-1350px (1024/1280 reportados) .topbar-title no tenía min-width:0 —
// el gotcha clásico de flexbox: un item con texto nunca se encoge por
// debajo del ancho de su palabra más larga sin min-width:0 explícito. En
// ese rango .topbar-right ya no cabe en una sola línea (empieza a envolver
// internamente, su propio flex-wrap:wrap) y .topbar-title, sin poder
// ceder espacio, quedaba superpuesto con el buscador/badge de conexión/
// usuario envuelto. Fragmento estático con la MISMA estructura real que
// boot() genera (app.js) — mismo método que topbar-mobile.spec.js.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

function fixture(title) {
  return `
  <div class="app-shell">
    <aside class="sidebar" id="sidebar"><div class="brand"><div class="brand-mark"></div></div><nav class="menu"></nav></aside>
    <div class="main">
      <header class="topbar">
        <button id="btn-menu-toggle" class="icon-btn only-mobile">☰</button>
        <div class="brand-mark small only-mobile"></div>
        <div class="topbar-title" id="topbar-title">${title}</div>
        <div class="topbar-right">
          <div class="quick-find">
            <button type="button" id="quick-find-toggle" class="icon-btn quick-find-toggle" aria-label="Buscar equipo">🔍</button>
            <input type="search" id="quick-find" placeholder="Buscar equipo (código)…" autocomplete="off" aria-label="Buscar equipo por código"/>
            <div id="quick-find-results" class="quick-find-results hidden"></div>
          </div>
          <button type="button" id="btn-scan-qr-topbar" class="icon-btn" aria-label="Escanear QR de equipo" title="Escanear QR de equipo">▣</button>
          <button type="button" id="conn-badge" class="conn-badge conn-off" aria-label="SIN INTERNET · GUARDANDO LOCAL" title="SIN INTERNET · GUARDANDO LOCAL">SIN INTERNET · GUARDANDO LOCAL</button>
          <span class="topbar-shift" id="topbar-shift">☀ <span class="topbar-shift-label">Turno Día</span></span>
          <span class="topbar-user">Juan Carlos Pérez Gómez · ADMINISTRADOR</span>
        </div>
      </header>
      <main class="app-content"><div class="empty-state">contenido</div></main>
    </div>
  </div>`;
}

function rectsOverlap(a, b) {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

const WIDTHS_TO_VALIDATE = [390, 412, 768, 1024, 1280, 1440, 1920];
// "Liberar espacio" es más largo que "Configuración" — caso más exigente
// para confirmar que el fix aguanta, no solo el título que se vio roto.
const TITLES = ['Configuración', 'Liberar espacio'];

for (const width of WIDTHS_TO_VALIDATE) {
  for (const title of TITLES) {
    test(`Topbar @ ${width}px ("${title}") — título NUNCA se superpone con .topbar-right (buscador/conexión/turno/usuario)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 400 });
      await page.setContent(fixture(title));
      await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });
      await page.evaluate(() => document.fonts.ready);

      const titleBox = await page.locator('#topbar-title').boundingBox();
      const rightBox = await page.locator('.topbar-right').boundingBox();
      expect(rectsOverlap(
        { left: titleBox.x, top: titleBox.y, right: titleBox.x + titleBox.width, bottom: titleBox.y + titleBox.height },
        { left: rightBox.x, top: rightBox.y, right: rightBox.x + rightBox.width, bottom: rightBox.y + rightBox.height },
      ), `título superpuesto con .topbar-right a ${width}px`).toBe(false);
    });

    test(`Topbar @ ${width}px ("${title}") — sin overflow horizontal, título sigue legible (no vacío)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 400 });
      await page.setContent(fixture(title));
      await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

      const titleEl = page.locator('#topbar-title');
      await expect(titleEl).toBeVisible();
      const text = await titleEl.textContent();
      expect(text.trim().length).toBeGreaterThan(0);
    });
  }
}

test('Topbar @ 1024px — buscador, QR y conexión siguen accesibles después del fix', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 400 });
  await page.setContent(fixture('Configuración'));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('#quick-find')).toHaveAttribute('aria-label', 'Buscar equipo por código');
  await expect(page.locator('#btn-scan-qr-topbar')).toHaveAttribute('aria-label', 'Escanear QR de equipo');
  await expect(page.locator('#conn-badge')).toHaveAttribute('aria-label', 'SIN INTERNET · GUARDANDO LOCAL');
  await expect(page.locator('#quick-find')).toBeVisible();
  await expect(page.locator('#btn-scan-qr-topbar')).toBeVisible();
  await expect(page.locator('#conn-badge')).toBeVisible();
});

test('Topbar @ 1280px — buscador, QR y conexión siguen accesibles después del fix', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.setContent(fixture('Configuración'));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('#quick-find')).toHaveAttribute('aria-label', 'Buscar equipo por código');
  await expect(page.locator('#btn-scan-qr-topbar')).toHaveAttribute('aria-label', 'Escanear QR de equipo');
  await expect(page.locator('#conn-badge')).toHaveAttribute('aria-label', 'SIN INTERNET · GUARDANDO LOCAL');
});

test('Topbar @ 1440px/1920px — título muestra el texto COMPLETO, sin recortar (hay espacio de sobra, el fix no degrada desktop)', async ({ page }) => {
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 400 });
    await page.setContent(fixture('Configuración'));
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });
    await expect(page.locator('#topbar-title')).toHaveText('Configuración');
  }
});
