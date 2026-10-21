// tests/ui/historial-redesign.spec.js
//
// LOTE COMBINADO — Historial, rediseño final (A1-A9): Historial por equipo
// ARRIBA (buscador grande sin botón, resultados compactos código·marca
// modelo·ubicación, encabezado compacto con familia/ubicación/estado, 4 KPI
// responsive) y Historial global ABAJO (solo Desde/Hasta/Turno/Estado, sin
// Familia, sin buscador propio, sin botón Buscar). No requiere login ni red:
// fragmentos estáticos con la estructura/clases REALES de renderHistorial()/
// drawHistory() (app.js) — datos de relleno, nunca registros de producción.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

function pageFixture(hasEquipoSelected) {
  const eqSearchArea = hasEquipoSelected ? `
    <div class="hist-eq-header">
      <div class="hist-eq-header-main">
        <span class="hist-eq-header-code">T-06</span>
        <span class="hist-eq-header-model">Caterpillar D8T</span>
      </div>
      <div class="hist-eq-header-meta">
        <span>Tractor de Oruga</span>
        <span>Rajo Principal</span>
        <span class="hist-eq-header-status">Operativo</span>
      </div>
      <button type="button" class="btn btn-sm" id="hist-eq-change">Cambiar equipo</button>
    </div>` : `
    <div class="hist-eq-search-wrap">
      <input type="search" id="hist-eq-search" class="input hist-eq-search" placeholder="Buscar equipo: código, familia, marca, modelo, ubicación…" autocomplete="off"/>
      <div id="hist-eq-results" class="hist-eq-results hidden"></div>
    </div>`;

  const histArea = hasEquipoSelected ? `
    <div class="kpi-grid hist-kpi-grid">
      <div class="kpi-card"><div class="kpi-value mono">12480.5 h</div><div class="kpi-label">Horómetro actual</div></div>
      <div class="kpi-card"><div class="kpi-value">42</div><div class="kpi-label">Engrases registrados</div></div>
      <div class="kpi-card"><div class="kpi-value">48.2 h</div><div class="kpi-label">Intervalo promedio real</div></div>
      <div class="kpi-card tone-amber"><div class="kpi-value">3</div><div class="kpi-label">Anomalías registradas</div></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Engrases</h3></div>
      <table class="data-table hist-table">
        <thead><tr><th>Fecha</th><th>Turno</th><th>Horómetro</th><th>Responsable</th><th>Grasa</th><th>Cantidad (lb)</th><th>Condición</th><th>Foto</th><th></th></tr></thead>
        <tbody>
          <tr data-rec="r1">
            <td>24/09/2026</td><td>Día</td><td class="mono">12480.5 h</td><td>Juan Pérez</td><td>Grasa EP-2</td><td class="mono">1.5 lb</td>
            <td><span class="hist-cond-badge">Normal</span></td>
            <td><span class="dim">—</span></td>
            <td><button type="button" class="icon-btn hist-del-btn btn-del-record" data-id="r1" title="Eliminar registro">🗑</button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Anomalías</h3></div>
      <table class="data-table"><thead><tr><th>Fecha</th><th>Componente</th><th>Descripción</th><th>Criticidad</th><th>Estado</th><th>Foto</th></tr></thead><tbody></tbody></table>
    </div>` : '';

  return `
  <div class="app-shell">
    <aside class="sidebar" id="sidebar"><nav class="menu"></nav></aside>
    <div class="main"><header class="topbar"><div class="topbar-title">Historial</div></header>
      <main class="app-content">
        <div class="panel" id="hist-eq-panel">
          <div class="panel-head"><h3>Historial por equipo</h3></div>
          <div id="hist-eq-search-area">${eqSearchArea}</div>
        </div>
        <div id="hist-area">${histArea}</div>

        <div class="panel hist-global-panel">
          <div class="panel-head"><h3>Historial global</h3></div>
          <div class="hist-global-body">
            <input type="search" id="gh-search" class="input hist-global-search" placeholder="Buscar: código, familia, marca, modelo, ubicación…" autocomplete="off"/>
            <div class="hist-global-filters-row">
              <label class="filter-label hist-global-filter">Desde <input type="date" id="gh-from" class="input input-sm"/></label>
              <label class="filter-label hist-global-filter">Hasta <input type="date" id="gh-to" class="input input-sm"/></label>
              <label class="filter-label hist-global-filter">Turno<select id="gh-turno" class="input input-sm"><option>Ambos</option></select></label>
              <label class="filter-label hist-global-filter">Estado del equipo<select id="gh-estado" class="input input-sm"><option>Todos</option></select></label>
              <div class="hist-global-summary" id="gh-summary">
                <span class="hist-global-count">128 resultados</span>
                <button type="button" class="btn hist-export-btn" id="gh-export">⬇Exportar CSV</button>
              </div>
            </div>
            <div id="gh-results">
              <div class="hist-global-table-wrap">
                <table class="data-table hist-global-table">
                  <thead><tr><th>Fecha</th><th>Código</th><th>Equipo</th><th>Turno</th><th>Responsable</th><th>Horómetro</th><th>Grasa</th><th>Condición</th><th>Foto</th></tr></thead>
                  <tbody><tr><td>24/09/2026</td><td class="mono">T-06</td><td>Caterpillar D8T</td><td>Día</td><td>Juan Pérez</td><td class="mono">12480.5 h</td><td>Grasa EP-2</td><td>Normal</td><td>—</td></tr></tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>`;
}

const WIDTHS = [412, 768, 1366];

for (const width of WIDTHS) {
  test(`Historial (sin equipo) @ ${width}px — orden, sin botón Buscar, filtros sin Familia`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.setContent(pageFixture(false));
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    // A1: "Historial por equipo" arriba de "Historial global" en el DOM.
    const eqPanelY = await page.locator('#hist-eq-panel').boundingBox().then(b => b.y);
    const globalPanelY = await page.locator('.hist-global-panel').boundingBox().then(b => b.y);
    expect(eqPanelY).toBeLessThan(globalPanelY);

    // A2: buscador grande, sin botón Buscar en ningún lado de la pantalla.
    await expect(page.locator('#hist-eq-search')).toBeVisible();
    await expect(page.locator('button:has-text("Buscar")')).toHaveCount(0);
    await expect(page.locator('#gh-apply')).toHaveCount(0);

    // Historial global: textbox full-width (fila 1) + Desde/Hasta/Turno/Estado
    // compactos (fila 2), sin Familia, sin botón.
    await expect(page.locator('#gh-search')).toBeVisible();
    await expect(page.locator('#gh-from')).toBeVisible();
    await expect(page.locator('#gh-to')).toBeVisible();
    await expect(page.locator('#gh-turno')).toBeVisible();
    await expect(page.locator('#gh-estado')).toBeVisible();
    await expect(page.locator('#gh-familia')).toHaveCount(0);

    // El textbox (fila 1) queda ARRIBA de los filtros (fila 2).
    const searchY = await page.locator('#gh-search').boundingBox().then(b => b.y);
    const filtersY = await page.locator('.hist-global-filters-row').boundingBox().then(b => b.y);
    expect(searchY).toBeLessThan(filtersY);

    // El textbox es full-width (ocupa (casi) todo el panel).
    const searchBox = await page.locator('#gh-search').boundingBox();
    const panelBox = await page.locator('.hist-global-panel').boundingBox();
    expect(searchBox.width).toBeGreaterThan(panelBox.width * 0.85);
  });

  test(`Historial (equipo seleccionado) @ ${width}px — encabezado compacto, 4 KPI, tabla`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 });
    await page.setContent(pageFixture(true));
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    // A4: encabezado compacto (no card gigante) con familia/ubicación/estado.
    const headerBox = await page.locator('.hist-eq-header').boundingBox();
    // En móvil el flex-wrap puede envolver a 3 líneas (código+modelo / meta / botón)
    // — sigue siendo compacto frente a la vieja card con detail-grid (~200px+).
    expect(headerBox.height).toBeLessThan(width <= 412 ? 140 : 110);
    await expect(page.locator('.hist-eq-header-meta')).toContainText('Tractor de Oruga');
    await expect(page.locator('.hist-eq-header-meta')).toContainText('Rajo Principal');
    await expect(page.locator('.hist-eq-header-status')).toHaveText('Operativo');

    // A5: 4 KPI cards, sin duplicados.
    await expect(page.locator('.hist-kpi-grid .kpi-card')).toHaveCount(4);
    const cols = await page.locator('.hist-kpi-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    if (width >= 901) expect(cols).toBe(4);
    else if (width > 400) expect(cols).toBe(2);

    // A6: Engrases antes que Anomalías, condición resumida, eliminar discreto.
    const panels = await page.locator('#hist-area .panel .panel-head h3').allTextContents();
    expect(panels[0]).toBe('Engrases');
    expect(panels[1]).toBe('Anomalías');
    await expect(page.locator('.hist-del-btn')).not.toHaveClass(/btn-danger/);
  });
}

test('Historial global @ 1366px — filtros + contador/CSV en la misma fila 2', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 1000 });
  await page.setContent(pageFixture(false));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

  const turnoY = await page.locator('#gh-turno').boundingBox().then(b => b.y);
  const summaryY = await page.locator('#gh-summary').boundingBox().then(b => b.y);
  expect(Math.abs(turnoY - summaryY)).toBeLessThan(10);

  const summaryX = await page.locator('#gh-summary').boundingBox().then(b => b.x);
  const turnoX = await page.locator('#gh-turno').boundingBox().then(b => b.x);
  expect(summaryX).toBeGreaterThan(turnoX); // empujado a la derecha
});

for (const width of [412, 1366]) {
  test(`Historial — pulido visual @ ${width}px: padding, alturas ~44px, botón CSV, contador`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.setContent(pageFixture(false));
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

    // Padding lateral real (antes 0 — el buscador tocaba el borde del panel).
    const panelBox = await page.locator('#hist-eq-panel').boundingBox();
    const eqSearchBox = await page.locator('#hist-eq-search').boundingBox();
    expect(eqSearchBox.x - panelBox.x).toBeGreaterThanOrEqual(14);

    const globalPanelBox = await page.locator('.hist-global-panel').boundingBox();
    const ghSearchBox = await page.locator('#gh-search').boundingBox();
    expect(ghSearchBox.x - globalPanelBox.x).toBeGreaterThanOrEqual(14);

    // Alturas ~44px (textbox global y selects de filtros).
    expect(ghSearchBox.height).toBeGreaterThanOrEqual(40);
    expect(ghSearchBox.height).toBeLessThanOrEqual(48);
    const turnoBox = await page.locator('#gh-turno').boundingBox();
    expect(turnoBox.height).toBeGreaterThanOrEqual(40);
    expect(turnoBox.height).toBeLessThanOrEqual(48);

    // Contador: texto plano "N resultados" (sin "(s)", sin badge/pill).
    await expect(page.locator('.hist-global-count')).toHaveText('128 resultados');
    const countBg = await page.locator('.hist-global-count').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(countBg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

    // CSV: botón secundario real (.btn), no link subrayado, altura 40-44px.
    const csvBtn = page.locator('#gh-export');
    await expect(csvBtn).toHaveClass(/\bbtn\b/);
    await expect(csvBtn).not.toHaveClass(/hist-export-link/);
    const csvDecoration = await csvBtn.evaluate(el => getComputedStyle(el).textDecorationLine);
    expect(csvDecoration).toBe('none');
    const csvBox = await csvBtn.boundingBox();
    expect(csvBox.height).toBeGreaterThanOrEqual(38);
    expect(csvBox.height).toBeLessThanOrEqual(46);

    // Buscador de equipo: full-width pero topado a 900px en desktop.
    if (width >= 1366) {
      expect(eqSearchBox.width).toBeLessThanOrEqual(900);
    }

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
}
