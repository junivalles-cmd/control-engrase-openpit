// tests/ui/sidebar-compact.spec.js
//
// UI/Composición — sidebar Administrador, modo compacto (evitar scrollbar
// vertical en el menú con las 14 rutas + Cerrar sesión, en alturas normales de
// desktop). No requiere login ni red: fragmento estático con la estructura/
// clases REALES de boot() (app.js) — las 14 rutas de MENU filtradas para
// ADMINISTRADOR (PERMISSIONS.ADMINISTRADOR, app.js:1011), el rol con más ítems.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

const MENU = [
  ['dashboard', 'grid', 'Dashboard'], ['equipos', 'truck', 'Equipos'], ['plan', 'list', 'Plan de Engrase'],
  ['matriz', 'matrix', 'Matriz Semanal'], ['turno', 'clock', 'Engrase del Turno'], ['registrar', 'check', 'Registrar Engrase'],
  ['horometros', 'gauge', 'Actualizar Horómetros'], ['anomalias', 'alert', 'Anomalías'], ['lubricantes', 'drop', 'Lubricantes'],
  ['historial', 'history', 'Historial'], ['reportes', 'report', 'Reportes'], ['usuarios', 'users', 'Usuarios'],
  ['config', 'gear', 'Configuración'], ['ayuda', 'help', 'Ayuda'],
];

function sidebarFixture() {
  return `
  <div class="app-shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand brand-sidebar">
        <div class="brand-mark small"></div>
        <div><div class="brand-title small">ENGRASE</div><div class="brand-sub small">OPEN PIT</div></div>
      </div>
      <nav class="menu">
        ${MENU.map(([id, icon, label]) => `
          <button class="menu-item" data-route="${id}"><span class="menu-icon icon-${icon}"></span><span>${label}</span></button>`).join('')}
      </nav>
      <button class="menu-item logout" id="btn-logout"><span class="menu-icon icon-logout"></span><span>Cerrar sesión</span></button>
    </aside>
    <div class="main"><header class="topbar"><div class="topbar-title">Dashboard</div></header><main class="app-content"></main></div>
  </div>`;
}

const HEIGHTS = [768, 900, 1080];

for (const height of HEIGHTS) {
  test(`sidebar sin scrollbar @ 1366x${height}`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height });
    await page.setContent(sidebarFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const menu = page.locator('.menu');
    const { scrollHeight, clientHeight } = await menu.evaluate(el => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
    expect(scrollHeight, `menú desborda @ ${height}px de alto (scrollHeight=${scrollHeight} > clientHeight=${clientHeight})`).toBeLessThanOrEqual(clientHeight);

    // Todas las 14 rutas visibles dentro del viewport del sidebar.
    for (const [id] of MENU) {
      await expect(page.locator(`.menu-item[data-route="${id}"]`)).toBeInViewport();
    }
    await expect(page.locator('#btn-logout')).toBeInViewport();

    // Ancho del sidebar sin cambios.
    const sidebarBox = await page.locator('.sidebar').boundingBox();
    expect(sidebarBox.width).toBe(240);
  });

  test(`altura de item ~44-46px, ícono ~20px, fuente 15-16px @ alto ${height}`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height });
    await page.setContent(sidebarFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const itemBox = await page.locator('.menu-item[data-route="dashboard"]').boundingBox();
    expect(itemBox.height).toBeGreaterThanOrEqual(43);
    expect(itemBox.height).toBeLessThanOrEqual(48);

    const iconBox = await page.locator('.menu-item[data-route="dashboard"] .menu-icon').boundingBox();
    expect(iconBox.width).toBeGreaterThanOrEqual(18);
    expect(iconBox.width).toBeLessThanOrEqual(22);

    const fontSize = await page.locator('.menu-item[data-route="dashboard"]').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(15);
    expect(fontSize).toBeLessThanOrEqual(16);
  });

  test(`activo usa el acento vigente con contraste AA @ alto ${height}`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height });
    await page.setContent(sidebarFixture());
    await page.addStyleTag({ path: STYLES_PATH });
    await page.locator('.menu-item[data-route="equipos"]').evaluate(el => el.classList.add('active'));
    const colors = await page.locator('.menu-item[data-route="equipos"]').evaluate(el => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d');
      const pixel = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
      const probe = document.createElement('span'); probe.style.color = 'var(--accent-ink)'; el.append(probe);
      const active = pixel(getComputedStyle(el).color), accent = pixel(getComputedStyle(probe).color);
      probe.remove();
      const inactive = pixel(getComputedStyle(document.querySelector('.menu-item:not(.active)')).color);
      let bg = [255, 255, 255]; const parents = [];
      for (let p = el; p; p = p.parentElement) parents.unshift(p);
      parents.forEach(p => { const c = pixel(getComputedStyle(p).backgroundColor), a = c[3] / 255; bg = bg.map((v, i) => c[i] * a + v * (1 - a)); });
      const lum = rgb => rgb.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const a = lum(active), b = lum(bg);
      return { active, accent, inactive, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
    expect(colors.active).toEqual(colors.accent);
    expect(colors.active).not.toEqual(colors.inactive);
    expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
  });
}

test('móvil (390px, sidebar oculto): sin cambios de este lote', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.setContent(sidebarFixture());
  await page.addStyleTag({ path: STYLES_PATH });
  const left = await page.locator('.sidebar').evaluate(el => getComputedStyle(el).left);
  expect(left).toBe('-260px');
});

test('altura muy baja (600px): fallback overflow-y:auto permitido, sin romper layout', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 600 });
  await page.setContent(sidebarFixture());
  await page.addStyleTag({ path: STYLES_PATH });
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  await expect(page.locator('#btn-logout')).toBeInViewport();
});
