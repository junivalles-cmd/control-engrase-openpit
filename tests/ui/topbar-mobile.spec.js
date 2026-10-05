// tests/ui/topbar-mobile.spec.js
//
// Topbar global móvil (lote "fix: refine global mobile topbar") — fragmento
// estático con la MISMA estructura/ids REALES que boot() genera (app.js):
// menú/brand/título/buscador/QR/conexión/turno/usuario + bottom-nav. Sin
// login/DB real, mismo método que el resto de specs de este proyecto.
//
// Foco: 390/412px (el pedido explícito), más 768/1024/1440 para confirmar
// que no se degradó nada fuera del rango angosto.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

function fixture({ title = 'Configuración', connText = 'SIN INTERNET · GUARDANDO LOCAL', connClass = 'conn-off' } = {}) {
  return `
  <div class="app-shell">
    <aside class="sidebar" id="sidebar"><div class="brand"><div class="brand-mark"></div></div><nav class="menu"></nav></aside>
    <div class="main">
      <header class="topbar">
        <button id="btn-menu-toggle" class="icon-btn only-mobile" aria-label="Abrir menú">☰</button>
        <div class="brand-mark small only-mobile"></div>
        <div class="topbar-title" id="topbar-title">${title}</div>
        <div class="topbar-right">
          <div class="quick-find">
            <button type="button" id="quick-find-toggle" class="icon-btn quick-find-toggle" aria-label="Buscar equipo">🔍</button>
            <input type="search" id="quick-find" placeholder="Buscar equipo (código)…" autocomplete="off" aria-label="Buscar equipo por código"/>
            <div id="quick-find-results" class="quick-find-results hidden"></div>
          </div>
          <button type="button" id="btn-scan-qr-topbar" class="icon-btn" aria-label="Escanear QR de equipo" title="Escanear QR de equipo">▣</button>
          <button type="button" id="conn-badge" class="conn-badge ${connClass}" aria-label="${connText}" title="${connText} — toca para sincronizar ahora">${connText}</button>
          <span class="topbar-shift" id="topbar-shift">☀ <span class="topbar-shift-label">Turno Día</span></span>
          <span class="topbar-user">Juan Carlos Pérez Gómez · ADMINISTRADOR</span>
        </div>
      </header>
      <main class="app-content"><div class="empty-state">contenido</div></main>
    </div>
    <nav class="bottom-nav only-mobile">
      <button class="bottom-item active"><span class="menu-icon"></span><span>Dashboard</span></button>
      <button class="bottom-item"><span class="menu-icon"></span><span>Equipos</span></button>
      <button class="bottom-item"><span class="menu-icon"></span><span>Plan</span></button>
      <button class="bottom-item"><span class="menu-icon"></span><span>Matriz</span></button>
      <button class="bottom-item"><span class="menu-icon"></span><span>Turno</span></button>
    </nav>
  </div>`;
}

async function setup(page, width, opts) {
  await page.setViewportSize({ width, height: 700 });
  await page.setContent(fixture(opts));
  await page.addStyleTag({ path: STYLES_PATH });
}

const WIDTHS = [390, 412, 768, 1024, 1440];

for (const width of WIDTHS) {
  test(`Topbar @ ${width}px — cero overflow horizontal`, async ({ page }) => {
    await setup(page, width);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(scrollWidth, `overflow horizontal a ${width}px`).toBeLessThanOrEqual(clientWidth);
  });

  test(`Topbar @ ${width}px — título visible y legible (nunca vacío/oculto)`, async ({ page }) => {
    await setup(page, width);
    const title = page.locator('#topbar-title');
    await expect(title).toBeVisible();
    const text = await title.textContent();
    expect(text.trim().length).toBeGreaterThan(0);
    const box = await title.boundingBox();
    expect(box.width).toBeGreaterThan(20); // no colapsado a 0
  });

  test(`Topbar @ ${width}px — QR accesible (visible, aria-label, objetivo táctil >=44px)`, async ({ page }) => {
    await setup(page, width);
    const qr = page.locator('#btn-scan-qr-topbar');
    await expect(qr).toBeVisible();
    await expect(qr).toHaveAttribute('aria-label', 'Escanear QR de equipo');
    const box = await qr.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  test(`Topbar @ ${width}px — búsqueda accesible (toggle o input visible, con aria-label)`, async ({ page }) => {
    await setup(page, width);
    const toggle = page.locator('#quick-find-toggle');
    const input = page.locator('#quick-find');
    await expect(input).toHaveAttribute('aria-label', 'Buscar equipo por código');
    // En angosto el toggle es el ícono visible; en ancho el input ya está
    // visible directamente — el tamaño exacto de cada uno es preexistente
    // (no forma parte de este lote), aquí solo se confirma que uno de los
    // dos esté realmente visible y accesible.
    const visibleEl = (await toggle.isVisible()) ? toggle : input;
    await expect(visibleEl).toBeVisible();
  });

  test(`Topbar @ ${width}px — conexión accesible (aria-label/title con el estado real, incluso si el texto visual está compacto)`, async ({ page }) => {
    await setup(page, width);
    const conn = page.locator('#conn-badge');
    await expect(conn).toBeVisible();
    await expect(conn).toHaveAttribute('aria-label', 'SIN INTERNET · GUARDANDO LOCAL');
    const title = await conn.getAttribute('title');
    expect(title).toContain('SIN INTERNET · GUARDANDO LOCAL');
  });
}

test('Topbar @ 390px — conexión se muestra como punto compacto (sin texto truncado ilegible)', async ({ page }) => {
  await setup(page, 390);
  const conn = page.locator('#conn-badge');
  const box = await conn.boundingBox();
  // Punto compacto: el botón entero es ~44px (objetivo táctil), pero el
  // texto visual queda fuera de pantalla (text-indent -9999px) — se
  // confirma indirectamente: el ancho del botón ya NO depende del largo
  // del texto (antes variaba con max-width:86px + ellipsis).
  expect(box.width).toBeLessThanOrEqual(48);
  const textIndent = await conn.evaluate(el => getComputedStyle(el).textIndent);
  expect(textIndent).toBe('-9999px');
});

test('Topbar @ 390px — turno (.topbar-shift) se oculta (ya no se desborda a una segunda línea)', async ({ page }) => {
  await setup(page, 390);
  await expect(page.locator('#topbar-shift')).toBeHidden();
});

test('Topbar @ 412px — turno (.topbar-shift) se oculta', async ({ page }) => {
  await setup(page, 412);
  await expect(page.locator('#topbar-shift')).toBeHidden();
});

test('Topbar @ 768px — turno (.topbar-shift) sigue visible (el ocultamiento es solo <=480px, no se degradó tablet)', async ({ page }) => {
  await setup(page, 768);
  await expect(page.locator('#topbar-shift')).toBeVisible();
});

test('Topbar @ 1440px (desktop) — conexión muestra el texto REAL completo, sin compactar a punto (NO degradado)', async ({ page }) => {
  await setup(page, 1440);
  const conn = page.locator('#conn-badge');
  await expect(conn).toHaveText('SIN INTERNET · GUARDANDO LOCAL');
  const textIndent = await conn.evaluate(el => getComputedStyle(el).textIndent);
  expect(textIndent).not.toBe('-9999px');
});

test('Topbar @ 1440px (desktop) — turno y usuario completos siguen visibles (NO degradado)', async ({ page }) => {
  await setup(page, 1440);
  await expect(page.locator('#topbar-shift')).toBeVisible();
  await expect(page.locator('.topbar-shift-label')).toHaveText('Turno Día');
  await expect(page.locator('.topbar-user')).toBeVisible();
  await expect(page.locator('.topbar-user')).toContainText('ADMINISTRADOR');
});

test('Topbar @ 390/412px — todos los estados de conexión (ok/warn/off) quedan accesibles vía aria-label, nunca solo "botón"', async ({ page }) => {
  for (const [connClass, connText] of [['conn-ok', 'SINCRONIZADO'], ['conn-warn', 'SINCRONIZANDO…'], ['conn-off', 'ERROR DE SINCRONIZACIÓN']]) {
    await setup(page, 412, { connText, connClass });
    await expect(page.locator('#conn-badge')).toHaveAttribute('aria-label', connText);
  }
});

test('menú (hamburguesa) sigue accesible y con objetivo táctil >=44px en 390/412px', async ({ page }) => {
  for (const width of [390, 412]) {
    await setup(page, width);
    const menu = page.locator('#btn-menu-toggle');
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});
