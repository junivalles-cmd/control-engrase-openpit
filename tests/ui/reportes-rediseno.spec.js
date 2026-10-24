// tests/ui/reportes-rediseno.spec.js
//
// UI/Composición — Reportes rediseñado (análisis por período, no un segundo
// Dashboard) + PULIDO VISUAL FINAL (filtros compactos, resumen 5 KPIs,
// Tendencia+Turno lado a lado en desktop, turno con % primario+barra,
// tabla de equipo legible). No requiere login ni red: fragmento estático
// con las clases REALES que arma renderReportes() (app.js) — datos de
// relleno, nunca registros de producción. La lógica ya se prueba contra la
// función REAL en tests/unit/reportes-rediseno.test.js y
// tests/unit/reportes-programado-realizado.test.js — aquí solo se valida
// composición/responsive. (tests/ui/reportes-charts-grid.spec.js se retiró
// en TECH-10/TECH-11, auditoría 2026-10-24: probaba `.charts-grid`, una
// clase ya confirmada sin uso real — renderReportes() usa hoy
// `.rep-tendencia-turno-grid`/`.chart-box`, cubierto en este archivo.)

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

function reportesFixture() {
  return `
  <div class="app-shell">
    <aside class="sidebar" id="sidebar"><nav class="menu"></nav></aside>
    <div class="main"><header class="topbar"><div class="topbar-title">Reportes</div></header>
      <main class="app-content"><div class="rep-page layout-wide">
        <div class="panel">
          <div class="panel-head"><h3>Filtros del informe</h3></div>
          <div class="toolbar rep-filters-row" id="rep-filters-probe" style="padding:0 14px 14px">
            <label class="filter-label rep-filter-narrow">Desde <input type="date" id="f-from" class="input input-sm"/></label>
            <label class="filter-label rep-filter-narrow">Hasta <input type="date" id="f-to" class="input input-sm"/></label>
            <label class="filter-label rep-filter-wide">Equipo<select id="f-equipo" class="input input-sm"><option>Todos</option></select></label>
            <label class="filter-label rep-filter-wide">Familia<select id="f-familia" class="input input-sm"><option>Todas</option></select></label>
            <label class="filter-label rep-filter-wide">Ubicación<select id="f-ubic" class="input input-sm"><option>Todas</option></select></label>
            <label class="filter-label rep-filter-mid">Turno<select id="f-turno" class="input input-sm"><option>Ambos</option></select></label>
            <label class="filter-label rep-filter-mid">Responsable<select id="f-resp" class="input input-sm"><option>Todos</option></select></label>
            <button class="btn btn-accent rep-filter-apply" id="f-apply">Aplicar filtros</button>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Resumen del período</h3></div>
          <div class="dim rep-periodo-line">Período: 01/09/2026 – 25/09/2026</div>
          <div class="rep-resumen-grid" id="rep-resumen-probe">
            <div class="kpi-card tone-green"><div class="kpi-value">85%</div><div class="kpi-label">Cumplimiento del período</div></div>
            <div class="kpi-card tone-neutral"><div class="kpi-value">40</div><div class="kpi-label">Programados</div></div>
            <div class="kpi-card tone-green"><div class="kpi-value">34</div><div class="kpi-label">Realizados</div></div>
            <div class="kpi-card tone-amber"><div class="kpi-value">6</div><div class="kpi-label">No realizados</div></div>
            <div class="kpi-card tone-neutral"><div class="kpi-value">120.5</div><div class="kpi-label">Consumo total (lb)</div></div>
          </div>
          <div class="dim rep-resumen-note">Cumplimiento basado en planes Día/Turno evaluables.</div>
        </div>

        <div class="rep-tendencia-turno-grid" id="rep-tendencia-turno-probe">
          <div class="panel">
            <div class="panel-head"><h3>Tendencia de cumplimiento</h3></div>
            <div class="chart-box rep-chart-tendencia-box" id="chart-tendencia-probe"><canvas></canvas></div>
          </div>

          <div class="panel">
            <div class="panel-head"><h3>Cumplimiento por turno</h3></div>
            <div id="rep-turno-probe" class="rep-turno-grid">
              <div class="rep-turno-card tone-green">
                <div class="rep-turno-label">Día</div>
                <div class="rep-turno-pct">93%</div>
                <div class="rep-turno-frac">28 de 30</div>
                <div class="progress-track rep-turno-bar"><div class="progress-fill" style="width:93%"></div></div>
              </div>
              <div class="rep-turno-card tone-amber">
                <div class="rep-turno-label">Noche</div>
                <div class="rep-turno-pct">60%</div>
                <div class="rep-turno-frac">6 de 10</div>
                <div class="progress-track rep-turno-bar"><div class="progress-fill" style="width:60%"></div></div>
              </div>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Cumplimiento por equipo</h3></div>
          <table class="data-table rep-equipo-table" id="rep-equipo-table">
            <thead><tr><th>Código</th><th>Modelo</th><th>Realizados/Programados</th><th>Cumplimiento</th></tr></thead>
            <tbody>
              <tr><td class="mono">T-06</td><td>Caterpillar D8T</td><td>9/12</td><td><span class="hist-compliance-badge hist-compliance-alert">75%</span></td></tr>
              <tr><td class="mono">45-77</td><td>Caterpillar 740B</td><td>17/20</td><td><span class="hist-compliance-badge hist-compliance-ok">85%</span></td></tr>
            </tbody>
          </table>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Consumo de grasa</h3></div>
          <div id="rep-consumo-stats"></div>
          <div class="rep-tabs" id="rep-consumo-tabs" role="tablist">
            <button type="button" class="rep-tab active" data-tab="equipo" role="tab" aria-selected="true">Por equipo</button>
            <button type="button" class="rep-tab" data-tab="familia" role="tab" aria-selected="false">Por familia</button>
            <button type="button" class="rep-tab" data-tab="lubricante" role="tab" aria-selected="false">Por lubricante</button>
          </div>
          <div class="chart-box rep-chart-consumo-box" id="chart-consumo-box"><canvas></canvas></div>
        </div>

        <div class="rep-pareto-anomalias-grid" id="rep-pareto-anomalias-probe">
          <div class="panel">
            <div class="panel-head"><h3>Puntos no engrasados</h3></div>
            <div id="rep-motivos-pareto"><div class="rep-consumo-row"><span>Falta de acceso</span><span class="mono">4</span></div></div>
          </div>
          <div class="panel">
            <div class="panel-head"><h3>Anomalías de lubricación</h3></div>
            <div id="rep-anomalias-area"><div class="rep-consumo-row"><span>Fuga detectada</span><span class="mono">2</span></div></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Detalle de puntos no engrasados</h3></div>
          <div id="skipped-points-area">
            <table class="data-table"><tbody><tr><td>T-06</td><td>Falta de acceso</td></tr></tbody></table>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Actividad por responsable</h3></div>
          <div id="rep-actividad-resp-area">
            <div class="rep-actividad-sub">
              <span>Responsables activos: <span class="mono">2</span></span>
              <span>Mayor actividad: <span class="mono">Juan Pérez</span></span>
            </div>
            <div class="rep-actividad-table">
              <div class="rep-actividad-row rep-actividad-head"><span>Responsable</span><span>Engrases</span><span>%</span><span>Carga</span></div>
              <div class="rep-actividad-row"><span class="rep-actividad-nombre">Juan Pérez</span><span class="rep-actividad-count mono">12</span><span class="rep-actividad-pct mono">57%</span><span class="rep-actividad-bar-track"><span class="rep-actividad-bar-fill" style="width:100%"></span></span></div>
              <div class="rep-actividad-row"><span class="rep-actividad-nombre">Ana Gómez</span><span class="rep-actividad-count mono">9</span><span class="rep-actividad-pct mono">43%</span><span class="rep-actividad-bar-track"><span class="rep-actividad-bar-fill" style="width:75%"></span></span></div>
            </div>
            <div class="dim rep-actividad-nota">Carga de trabajo registrada — no es una medición de cumplimiento ni de desempeño laboral.</div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Evidencia fotográfica</h3></div>
          <div class="rep-photo-toggle-row">
            <span id="rep-photo-count" class="dim">9 evidencia(s)</span>
            <button type="button" class="btn btn-sm" id="rep-photo-toggle">Ver fotos</button>
          </div>
          <div id="photo-report-grid" class="photo-report-grid hidden"></div>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Generar informe</h3></div>
          <div class="toolbar" style="padding:0 14px 10px">
            <button class="btn btn-accent" id="exp-pdf">Informe ejecutivo (PDF)</button>
            <button class="btn btn-accent" id="exp-excel">Informe completo (Excel)</button>
          </div>
          <details class="rep-more-exports" style="padding:0 14px 14px">
            <summary class="btn btn-sm">Más exportaciones ▾</summary>
            <div class="toolbar" style="padding-top:10px">
              <button class="btn btn-sm" id="exp-cumplimiento">Cumplimiento (CSV)</button>
              <button class="btn btn-sm" id="exp-historico">Histórico de engrases (CSV)</button>
              <button class="btn btn-sm" id="exp-anomalias">Anomalías (CSV)</button>
              <button class="btn btn-sm" id="exp-puntos">Puntos no engrasados (CSV)</button>
              <button class="btn btn-sm" id="exp-no-ejecutados">No ejecutados (CSV)</button>
            </div>
          </details>
        </div>
      </div></main>
    </div>
  </div>`;
}

async function bootFixture(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.setContent(reportesFixture());
  await page.route('https://**/*', route => route.fulfill({ body: '', contentType: 'text/css' }));
  await page.addStyleTag({ path: STYLES_PATH });
  await page.evaluate(() => document.querySelectorAll('table').forEach(table => {
    const labels = [...table.querySelectorAll('thead th')].map(el => el.textContent);
    table.querySelectorAll('tbody tr').forEach(row => [...row.children].forEach((cell, i) => cell.dataset.label = labels[i] || ''));
  }));
  await page.addScriptTag({
    content: `
      document.getElementById('rep-photo-toggle').addEventListener('click', () => {
        const grid = document.getElementById('photo-report-grid');
        const oculto = grid.classList.toggle('hidden');
        document.getElementById('rep-photo-toggle').textContent = oculto ? 'Ver fotos' : 'Ocultar fotos';
      });
    `,
  });
}

const WIDTHS = [360, 390, 412, 768, 1366, 1920];

for (const width of WIDTHS) {
  test(`Reportes @ ${width}px — sin scroll horizontal de página`, async ({ page }) => {
    await bootFixture(page, width);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test(`Reportes @ ${width}px — filtros incluyen Familia y Ubicación (antes faltaban), sin scroll horizontal propio`, async ({ page }) => {
    await bootFixture(page, width);
    await expect(page.locator('#f-familia')).toBeVisible();
    await expect(page.locator('#f-ubic')).toBeVisible();
    const row = page.locator('#rep-filters-probe');
    const { scrollWidth, clientWidth } = await row.evaluate(el => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // wrap natural, nunca overflow horizontal
  });

  test(`Reportes @ ${width}px — "Cumplimiento por equipo" es tabla de detalle real, no cards`, async ({ page }) => {
    await bootFixture(page, width);
    await expect(page.locator('#rep-equipo-table')).toBeVisible();
    await expect(page.locator('#rep-equipo-table .kpi-card')).toHaveCount(0);
  });
}

for (const width of [360, 390, 412]) {
  test(`FIX responsive @ ${width}px — filtros se apilan en 1 columna y cada control ocupa el ancho completo (sin hueco lateral)`, async ({ page }) => {
    await bootFixture(page, width);
    const row = page.locator('#rep-filters-probe');
    const cols = await row.evaluate(el => new Set(Array.from(el.children).map(c => Math.round(c.getBoundingClientRect().left))).size);
    expect(cols).toBe(1); // 1 columna real: todos los hijos arrancan en el mismo left

    const availableWidth = await row.evaluate(el => {
      const cs = getComputedStyle(el);
      return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    });
    const anchoDesde = await page.locator('#f-from').locator('..').evaluate(el => el.getBoundingClientRect().width);
    const anchoEquipo = await page.locator('#f-equipo').locator('..').evaluate(el => el.getBoundingClientRect().width);
    expect(availableWidth - anchoDesde).toBeLessThanOrEqual(2);
    expect(availableWidth - anchoEquipo).toBeLessThanOrEqual(2);
  });
}

test('Filtros desktop (1366px): Equipo/Familia/Ubicación (anchos) son visualmente más anchos que Desde/Hasta (angostos)', async ({ page }) => {
  await bootFixture(page, 1366);
  const anchoDesde = await page.locator('#f-from').evaluate(el => el.getBoundingClientRect().width);
  const anchoEquipo = await page.locator('#f-equipo').evaluate(el => el.getBoundingClientRect().width);
  expect(anchoEquipo).toBeGreaterThan(anchoDesde);
});

test('Filtros desktop (1366px): controles y botón "Aplicar" tienen altura compacta (~38-42px) y quedan alineados', async ({ page }) => {
  await bootFixture(page, 1366);
  const alturaInput = await page.locator('#f-from').evaluate(el => el.getBoundingClientRect().height);
  expect(alturaInput).toBeGreaterThanOrEqual(30);
  expect(alturaInput).toBeLessThanOrEqual(46);
  const alturaBoton = await page.locator('#f-apply').evaluate(el => el.getBoundingClientRect().height);
  expect(Math.abs(alturaBoton - alturaInput)).toBeLessThanOrEqual(12);
});

test('Resumen del período: 2 columnas @412px, 3 @768px, 5 @1366px (siempre ocupando el ancho, sin columna vacía)', async ({ page }) => {
  const casos = [[412, 2], [768, 3], [1366, 5]];
  for (const [width, esperado] of casos) {
    await bootFixture(page, width);
    const cols = await page.locator('#rep-resumen-probe').evaluate(el => new Set(Array.from(el.children).map(c => Math.round(c.getBoundingClientRect().left))).size);
    expect(cols, `en ${width}px`).toBe(esperado);
  }
});

test('Tendencia + Cumplimiento por turno: apilados (1 columna) en móvil/tablet angosto, lado a lado (2 columnas) desde 1000px', async ({ page }) => {
  await bootFixture(page, 768);
  const colsAngosto = await page.locator('#rep-tendencia-turno-probe').evaluate(el => new Set(Array.from(el.children).map(c => Math.round(c.getBoundingClientRect().left))).size);
  expect(colsAngosto).toBe(1);

  await page.setViewportSize({ width: 1366, height: 900 });
  const colsAncho = await page.locator('#rep-tendencia-turno-probe').evaluate(el => new Set(Array.from(el.children).map(c => Math.round(c.getBoundingClientRect().left))).size);
  expect(colsAncho).toBe(2);

  // Tendencia (~70%) más ancha que Cumplimiento por turno (~30%) en desktop
  const panels = page.locator('#rep-tendencia-turno-probe > .panel');
  const anchoTendencia = await panels.nth(0).evaluate(el => el.getBoundingClientRect().width);
  const anchoTurno = await panels.nth(1).evaluate(el => el.getBoundingClientRect().width);
  expect(anchoTendencia).toBeGreaterThan(anchoTurno);
});

test('Gráfico de Tendencia: altura compacta (~230-250px), no ocupa media pantalla', async ({ page }) => {
  await bootFixture(page, 1366);
  const alto = await page.locator('#chart-tendencia-probe').evaluate(el => el.getBoundingClientRect().height);
  expect(alto).toBeGreaterThanOrEqual(220);
  expect(alto).toBeLessThanOrEqual(260);
});

test('Tendencia y Cumplimiento por turno alinean arriba sin estirar el panel compacto de turno', async ({ page }) => {
  await bootFixture(page, 1366);
  const panels = page.locator('#rep-tendencia-turno-probe > .panel');
  const altoTendencia = await panels.nth(0).evaluate(el => el.getBoundingClientRect().height);
  const altoTurno = await panels.nth(1).evaluate(el => el.getBoundingClientRect().height);
  expect(altoTurno).toBeLessThan(altoTendencia);
  const tops = await panels.evaluateAll(els => els.map(el => el.getBoundingClientRect().top));
  expect(Math.abs(tops[0] - tops[1])).toBeLessThanOrEqual(1);
});

test('Cumplimiento por turno: % es la cifra PRINCIPAL (más grande) y trae barra de progreso', async ({ page }) => {
  await bootFixture(page, 1366);
  const card = page.locator('.rep-turno-card').first();
  const pctSize = await card.locator('.rep-turno-pct').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  const fracSize = await card.locator('.rep-turno-frac').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  expect(pctSize).toBeGreaterThan(fracSize);
  await expect(card.locator('.progress-track')).toBeVisible();
});

test('Reportes @ 412px — Cumplimiento por turno se apila en 1 columna', async ({ page }) => {
  await bootFixture(page, 412);
  const cols = await page.locator('#rep-turno-probe').evaluate(el => new Set(Array.from(el.children).map(c => Math.round(c.getBoundingClientRect().left))).size);
  expect(cols).toBe(1);
});

test('Reportes @ 768px — Cumplimiento por turno usa 2 columnas (Día | Noche lado a lado)', async ({ page }) => {
  await bootFixture(page, 768);
  const cols = await page.locator('#rep-turno-probe').evaluate(el => new Set(Array.from(el.children).map(c => Math.round(c.getBoundingClientRect().left))).size);
  expect(cols).toBe(2);
});

test('Consumo de grasa: un solo panel con tabs [Por equipo] [Por familia] [Por lubricante], un solo chart-box (nunca 3 gráficos simultáneos)', async ({ page }) => {
  await bootFixture(page, 1366);
  await expect(page.locator('#rep-consumo-tabs .rep-tab')).toHaveCount(3);
  await expect(page.locator('#chart-consumo-box')).toHaveCount(1);
  await expect(page.locator('#rep-consumo-tabs .rep-tab.active')).toHaveText('Por equipo');
});

for (const width of [412, 768, 1366, 1920]) {
  test(`Reportes @ ${width}px — tabs de Consumo visibles sin overflow horizontal propio`, async ({ page }) => {
    await bootFixture(page, width);
    const tabs = page.locator('#rep-consumo-tabs');
    const { scrollWidth, clientWidth } = await tabs.evaluate(el => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
}

test('Puntos no engrasados (Pareto) + Anomalías: lado a lado (2 columnas) desde 900px, apilados debajo', async ({ page }) => {
  await bootFixture(page, 768);
  const colsAngosto = await page.locator('#rep-pareto-anomalias-probe').evaluate(el => new Set(Array.from(el.children).map(c => Math.round(c.getBoundingClientRect().left))).size);
  expect(colsAngosto).toBe(1);

  await page.setViewportSize({ width: 1366, height: 900 });
  const colsAncho = await page.locator('#rep-pareto-anomalias-probe').evaluate(el => new Set(Array.from(el.children).map(c => Math.round(c.getBoundingClientRect().left))).size);
  expect(colsAncho).toBe(2);
});

test('Detalle de puntos no engrasados: panel propio separado del resumen Pareto', async ({ page }) => {
  await bootFixture(page, 1366);
  await expect(page.locator('#skipped-points-area')).toBeVisible();
  await expect(page.locator('#rep-motivos-pareto')).toBeVisible();
});

test('Actividad por responsable: ranking compacto (tabla), sin chart-box, sin scroll horizontal en 390/1366', async ({ page }) => {
  await bootFixture(page, 1366);
  await expect(page.locator('#rep-actividad-resp-area .rep-actividad-row')).toHaveCount(3); // 1 encabezado + 2 filas
  await expect(page.locator('#rep-actividad-resp-area .chart-box')).toHaveCount(0);
  const noScroll1366 = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(noScroll1366).toBe(true);

  await bootFixture(page, 390);
  const noScroll390 = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(noScroll390).toBe(true);
  await expect(page.locator('#rep-actividad-resp-area .rep-actividad-nombre').first()).toBeVisible();
  await expect(page.locator('#rep-actividad-resp-area .rep-actividad-pct').first()).toBeVisible();
});

test('Actividad por responsable: en desktop ancho (1920px) NO se estira a todo el panel (max-width propio, no full-width artificial)', async ({ page }) => {
  await bootFixture(page, 1920);
  const tableBox = await page.locator('#rep-actividad-resp-area .rep-actividad-table').boundingBox();
  const panelBox = await page.locator('#rep-actividad-resp-area').evaluate(el => el.closest('.panel').getBoundingClientRect());
  expect(tableBox.width).toBeLessThan(panelBox.width * 0.8);
});

test('Actividad por responsable: mini-resumen arriba (Responsables activos/Mayor actividad), barra visual propia y nota con menor peso visual', async ({ page }) => {
  await bootFixture(page, 1366);
  const sub = page.locator('#rep-actividad-resp-area .rep-actividad-sub');
  await expect(sub).toBeVisible();
  await expect(sub).toContainText('Responsables activos:');
  await expect(sub).toContainText('Mayor actividad:');

  const fill = page.locator('#rep-actividad-resp-area .rep-actividad-bar-fill').first();
  await expect(fill).toBeVisible();
  const trackBox = await page.locator('#rep-actividad-resp-area .rep-actividad-bar-track').first().boundingBox();
  expect(trackBox.width).toBeGreaterThan(40); // ancho útil, no una línea decorativa

  const nota = page.locator('#rep-actividad-resp-area .rep-actividad-nota');
  await expect(nota).toContainText('no es una medición de cumplimiento');
  const notaSize = await nota.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  const nombreSize = await page.locator('.rep-actividad-nombre').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  expect(notaSize).toBeLessThan(nombreSize); // menor peso visual que el resto de la sección
});

test('Actividad por responsable @ 390px: fila apilada legible (nombre+cifras arriba, barra completa debajo), sin encabezado de tabla angosto, sin scroll horizontal', async ({ page }) => {
  await bootFixture(page, 390);
  await expect(page.locator('#rep-actividad-resp-area .rep-actividad-head')).not.toBeVisible();
  const track = page.locator('#rep-actividad-resp-area .rep-actividad-bar-track').first();
  const trackBox = await track.boundingBox();
  // .rep-actividad-head sigue en el DOM (display:none) — se excluye para no
  // tomar su boundingBox (null, por estar oculta) como si fuera una fila real.
  const rowBox = await page.locator('#rep-actividad-resp-area .rep-actividad-row:not(.rep-actividad-head)').first().boundingBox();
  expect(trackBox.width).toBeGreaterThan(rowBox.width * 0.5); // barra con ancho útil, no comprimida
  const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(noScroll).toBe(true);
});

test('Evidencia fotográfica: arranca colapsada (hidden) — "Ver fotos" la despliega, "Ocultar fotos" la vuelve a colapsar', async ({ page }) => {
  await bootFixture(page, 1366);
  const grid = page.locator('#photo-report-grid');
  await expect(grid).toHaveClass(/hidden/);

  await page.locator('#rep-photo-toggle').click();
  await expect(grid).not.toHaveClass(/hidden/);
  await expect(page.locator('#rep-photo-toggle')).toHaveText('Ocultar fotos');

  await page.locator('#rep-photo-toggle').click();
  await expect(grid).toHaveClass(/hidden/);
  await expect(page.locator('#rep-photo-toggle')).toHaveText('Ver fotos');
});

test('Generar informe: PDF/Excel visibles siempre, CSV quedan dentro de "Más exportaciones" (colapsado por defecto)', async ({ page }) => {
  await bootFixture(page, 1366);
  await expect(page.locator('#exp-pdf')).toBeVisible();
  await expect(page.locator('#exp-excel')).toBeVisible();

  const details = page.locator('.rep-more-exports');
  await expect(details).not.toHaveJSProperty('open', true);
  await expect(page.locator('#exp-cumplimiento')).not.toBeVisible();

  await details.locator('summary').click();
  await expect(details).toHaveJSProperty('open', true);
  await expect(page.locator('#exp-cumplimiento')).toBeVisible();
  await expect(page.locator('#exp-puntos')).toBeVisible();
  await expect(page.locator('#exp-no-ejecutados')).toBeVisible();
});

// Lote "exportación de No ejecutados" (§12 del pedido): el botón nuevo no
// debe romper el layout en móvil angosto (390/412) ni tapar los filtros de
// arriba — reusa el mismo toolbar con flex-wrap que ya usan los otros CSV.
for (const width of [390, 412]) {
  test(`Generar informe @ ${width}px — botón "No ejecutados (CSV)" accesible sin overflow horizontal, filtros no tapados`, async ({ page }) => {
    await bootFixture(page, width);
    await page.locator('.rep-more-exports summary').click();

    const boton = page.locator('#exp-no-ejecutados');
    await expect(boton).toBeVisible();
    const box = await boton.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(30); // btn-sm, mismo target táctil que sus hermanos

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    // Los filtros (arriba de "Generar informe") siguen visibles y no quedan
    // tapados por el panel de exportación recién desplegado.
    await expect(page.locator('#f-from')).toBeVisible();
    await expect(page.locator('#f-ubic')).toBeVisible();
  });
}
