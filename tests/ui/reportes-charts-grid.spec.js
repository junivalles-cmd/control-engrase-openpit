// tests/ui/reportes-charts-grid.spec.js
//
// UI/Composición — Reportes, .charts-grid/.chart-box (docs/UI_VISUAL_COMPOSITION_AUDIT.md,
// UI-VIS-203/204). Antes: grid fijo en 2 columnas en TODOS los anchos (incluso
// 1920px, ya con .app-content corregido) y height:240px fijo → aspect-ratio
// errático según el ancho de columna. No requiere login ni red: fragmento
// estático con la estructura/clases REALES de renderReportes() (app.js) — 5
// chart-box de relleno, nunca datos de producción.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

function reportesFixture() {
  const charts = ['daily', 'shift', 'equipo', 'resp', 'fleet'].map(id => `
    <div class="panel"><div class="panel-head"><h3>Gráfico ${id}</h3></div>
      <div class="chart-box" data-chart="${id}"><div style="width:100%;height:100%;background:var(--surface-2)"></div></div>
    </div>`).join('');
  return `
  <div class="app-shell">
    <aside class="sidebar" id="sidebar"><nav class="menu"></nav></aside>
    <div class="main"><header class="topbar"><div class="topbar-title">Reportes</div></header>
      <main class="app-content">
        <div class="charts-grid" id="charts-grid-probe">${charts}</div>
      </main>
    </div>
  </div>`;
}

const CASES = [
  { width: 412, label: '412px: 1 columna' },
  { width: 768, label: '768px: 1-2 según espacio real' },
  { width: 1366, label: '1366px: grid adaptable' },
  { width: 1920, label: '1920px: grid adaptable, ya no topado en 2' },
];

for (const { width, label } of CASES) {
  test(`${label} — sin scroll horizontal`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(reportesFixture());
    await page.addStyleTag({ path: STYLES_PATH });
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test(`${label} — columnas según ancho real, sin tope fijo de 2`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(reportesFixture());
    await page.addStyleTag({ path: STYLES_PATH });
    const cols = await page.locator('#charts-grid-probe').evaluate(el =>
      new Set(Array.from(el.children).map(c => Math.round(c.getBoundingClientRect().left))).size
    );
    if (width === 412) expect(cols).toBe(1);
    if (width === 768) expect(cols).toBeGreaterThanOrEqual(1);
    if (width === 1366) expect(cols).toBeGreaterThanOrEqual(2);
    if (width === 1920) expect(cols).toBeGreaterThan(2); // antes SIEMPRE quedaba en 2, incluso aquí
  });

  test(`${label} — chart-box con proporción consistente (ni muy alto ni muy bajo)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(reportesFixture());
    await page.addStyleTag({ path: STYLES_PATH });
    const box = await page.locator('.chart-box').first().boundingBox();
    const ratio = box.width / box.height;
    expect(ratio).toBeGreaterThan(1.2); // nunca más alto que ancho
    expect(ratio).toBeLessThan(2.4);    // nunca aplastado como el 3.09 medido antes en 768px
    expect(box.height).toBeGreaterThanOrEqual(180);
  });
}
