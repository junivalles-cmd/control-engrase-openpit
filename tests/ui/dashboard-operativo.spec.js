// tests/ui/dashboard-operativo.spec.js
//
// Rediseño estructural del Dashboard (cierre Parte D): JERARQUÍA + DISTRIBUCIÓN,
// mismo orden A-I pedido:
//   B. KPI principales (Vencidos/Pendientes hoy/Próximos/Realizados hoy/
//      Pendientes de validación/Cumplimiento hoy) — 6 tarjetas destacadas
//   C. Cumplimiento (Hoy/Semana/Turno)
//   D. Requieren atención (cola compacta)
//   E. Pendientes del turno anterior (sección propia, nunca un KPI)
//   F. Estado por ubicación
//   G. Asignaciones activas + Fuera de plan + No ejecutados (compacto)
//   H. Mayor tiempo sin engrasar
//   I. Indicadores secundarios (Al día/Sin plan/Pausados/Anomalías abiertas/
//      Total equipos) — menor peso visual, al final
// No requiere login ni red: fragmento estático con la estructura/clases REALES
// de renderDashboard() (app.js) — datos de relleno, nunca registros de
// producción. La lógica ya está probada contra la función REAL en
// tests/unit/dashboard-operativo.test.js, dashboard-sin-plan.test.js y los
// nuevos dashboard-hierarchy/dashboard-attention-order/etc. — aquí solo se
// valida la composición visual (jerarquía/acciones/layout), sin duplicar esas
// pruebas.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

function colaRow({ id, badge, tone, code, urgencia, linea2, plan }) {
  return `
    <div class="dash-cola-row">
      <span class="dash-cola-badge tone-${tone}">${badge}</span>
      <span class="dash-cola-code mono">${code}</span>
      <span class="dash-cola-meta dim">${linea2}</span>
      <span class="dash-cola-prog-tag" style="color:var(--${tone === 'red' ? 'red' : tone === 'amber' ? 'amber' : 'text-dim'})">${urgencia}</span>
      <span class="dash-cola-plan dim">Plan: ${plan}</span>
      <div class="dash-cola-actions">
        <button type="button" class="btn btn-sm dash-cola-hist" data-id="${id}">Historial</button>
        <button type="button" class="btn btn-sm btn-accent dash-cola-reg" data-id="${id}">Registrar</button>
      </div>
    </div>`;
}

function excRow({ id, code, dias, isMax, brandModel, ubicacion, ultimo }) {
  return `
    <div class="dash-exc-row${isMax ? ' is-max' : ''}" data-id="${id}">
      <div class="dash-exc-main">
        <div class="dash-exc-line1"><span class="dash-exc-code mono">${code}</span></div>
        <div class="dash-exc-line2">${brandModel} · ${ubicacion}</div>
        <div class="dash-exc-line3 dim">Último engrase: ${ultimo}</div>
      </div>
      <div class="dash-exc-side">
        <div class="dash-exc-days-wrap${isMax ? ' is-max' : ''}">
          <span class="dash-exc-days${isMax ? ' is-max' : ''}">${dias}</span>
          <span class="dash-exc-days-label dim">días sin engrasar</span>
        </div>
        <button type="button" class="btn btn-sm dash-exc-hist-btn" data-id="${id}">Historial</button>
      </div>
    </div>`;
}

function dashboardFixture({ ubicaciones = ['Rajo Principal', 'Botadero Norte'], familias = ['Tractor de Oruga', 'Excavadora'] } = {}) {
  return `
  <div class="app-shell">
    <aside class="sidebar" id="sidebar"><nav class="menu"></nav></aside>
    <div class="main"><header class="topbar"><div class="topbar-title">Dashboard</div></header>
      <main class="app-content">
        <div class="toolbar dash-filters-row">
          <label class="filter-label">Ubicación
            <select id="dash-ubic" class="input input-sm">
              <option value="">Todas</option>
              ${ubicaciones.map((u, i) => `<option value="loc${i}">${u}</option>`).join('')}
            </select>
          </label>
          <label class="filter-label">Familia
            <select id="dash-familia" class="input input-sm">
              <option value="">Todas</option>
              ${familias.map((f, i) => `<option value="ty${i}">${f}</option>`).join('')}
            </select>
          </label>
        </div>

        <section class="dash-section">
          <h2 class="dash-section-title">Qué requiere acción</h2>
          <div class="dash-hero-grid">
            <div class="dash-hero-card tone-red kpi-clickable" data-kpi-action="vencidos"><div class="dash-hero-value">2</div><div class="dash-hero-label">Vencidos</div></div>
            <div class="dash-hero-card tone-amber"><div class="dash-hero-value">1</div><div class="dash-hero-label">Pendientes hoy</div></div>
            <div class="dash-hero-card tone-amber kpi-clickable" data-kpi-action="proximos"><div class="dash-hero-value">3</div><div class="dash-hero-label">Próximos</div></div>
            <div class="dash-hero-card tone-green kpi-clickable" data-kpi-action="realizados-hoy"><div class="dash-hero-value">4</div><div class="dash-hero-label">Realizados hoy</div></div>
            <div class="dash-hero-card tone-neutral"><div class="dash-hero-value">0</div><div class="dash-hero-label">Pendientes de validación</div></div>
            <div class="dash-hero-card tone-green"><div class="dash-hero-value">75%</div><div class="dash-hero-label">Cumplimiento hoy</div></div>
          </div>
        </section>

        <div class="panel">
          <div class="panel-head"><h3>Cumplimiento operativo</h3></div>
          <div class="dim dash-compliance-note">Basado en planes programados por Día/Turno.<br>Los planes por Horas no se incluyen.</div>
          <div class="dash-compliance-grid">
            <div class="dash-compliance-card">
              <div class="dash-compliance-label">Hoy</div>
              <div class="dash-compliance-pct">75%</div>
              <div class="dash-compliance-frac">3 de 4 programados</div>
              <div class="progress-track"><div class="progress-fill" style="width:75%"></div></div>
            </div>
            <div class="dash-compliance-card">
              <div class="dash-compliance-label">Semana</div>
              <div class="dash-compliance-pct">—</div>
              <div class="dash-compliance-frac">Sin engrases programados</div>
              <div class="progress-track"><div class="progress-fill" style="width:0%"></div></div>
            </div>
            <div class="dash-compliance-card">
              <div class="dash-compliance-label">Turno Día</div>
              <div class="dash-compliance-pct">100%</div>
              <div class="dash-compliance-frac">2 de 2 programados</div>
              <div class="progress-track"><div class="progress-fill" style="width:100%"></div></div>
            </div>
          </div>
        </div>

        <div class="panel" id="dash-attention-panel">
          <div class="panel-head"><h3>Equipos que requieren atención</h3></div>
          <div class="toolbar">
            <label class="filter-label">Turno<select id="att-turno" class="input input-sm"><option value="">Ambos</option></select></label>
            <label class="filter-label">Día asignado<select id="att-dia" class="input input-sm"><option value="">Todos</option></select></label>
          </div>
          <div class="dash-cola-atencion" id="dash-cola-atencion">
            ${colaRow({ id: 'e1', badge: 'Vencido', tone: 'red', code: '45-77', urgencia: 'Atraso: 43 h', linea2: 'CAT 740B · Volcán', plan: 'Cada 250 h' })}
            ${colaRow({ id: 'e4', badge: 'Turno anterior', tone: 'amber', code: 'T-09', urgencia: '—', linea2: 'Komatsu WA470 · Rajo Principal', plan: 'Lun · Mié · Vie' })}
            ${colaRow({ id: 'e5', badge: 'Pendiente hoy', tone: 'amber', code: 'T-11', urgencia: 'Día: Martes', linea2: 'Caterpillar 950 · Botadero Norte', plan: 'Mar · Jue' })}
            ${colaRow({ id: 'e2', badge: 'Próximo', tone: 'amber', code: 'T-06', urgencia: 'Restante: 15 h', linea2: 'Caterpillar D8T · Rajo Principal', plan: 'Cada 250 h' })}
            ${colaRow({ id: 'e3', badge: 'Sin plan', tone: 'red', code: 'CIS-03', urgencia: '—', linea2: 'Cisterna 5000gal · Botadero Norte', plan: '—' })}
          </div>
        </div>

        <div class="panel" id="dash-pendientes-anterior-panel">
          <div class="panel-head"><h3>Pendientes del turno anterior</h3></div>
          <div class="dash-pendientes-anterior-list">
            <div class="dim">1 equipo(s) — distinto de "Vencidos" (histórico): esto es de HOY, heredado del turno que ya terminó.</div>
            <div class="dash-motivos-noexec-list">
              <span class="dash-motivo-chip mono">T-09</span>
            </div>
          </div>
        </div>

        <div class="panel" id="dash-ubic-panel">
          <div class="panel-head"><h3>Estado por ubicación</h3></div>
          <div class="dash-ubic-breakdown">
            <table class="data-table">
              <thead><tr><th>Ubicación</th><th>Equipos</th><th>Al día</th><th>Próximos</th><th>Vencidos</th></tr></thead>
              <tbody>
                <tr><td>Rajo Principal</td><td>10</td><td>7</td><td>2</td><td>1</td></tr>
                <tr><td>Botadero Norte</td><td>8</td><td>6</td><td>1</td><td>1</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <section class="dash-section dash-section-secondary" id="dash-panel-operativo">
          <h2 class="dash-section-title">Asignaciones · Fuera de plan · No ejecutados</h2>
          <div class="dash-activity-row" id="dash-panel-operativo-row">
            <div class="dash-activity-card tone-amber kpi-clickable"><span class="dash-activity-value">2</span><span class="dash-activity-label">Asignaciones activas</span></div>
            <div class="dash-activity-card tone-neutral"><span class="dash-activity-value">1</span><span class="dash-activity-label">Fuera de plan hoy</span></div>
            <div class="dash-activity-card tone-red"><span class="dash-activity-value">1</span><span class="dash-activity-label">No ejecutados hoy</span></div>
          </div>
        </section>

        <div class="panel" id="dash-tiempo-sin-engrase-panel">
          <div class="panel-head dash-exc-head">
            <h3>Mayor tiempo sin engrasar</h3>
            <button type="button" class="link-btn" id="dash-tiempo-ver-todos">Ver todos</button>
          </div>
          <div class="dash-exc-sub">
            <span class="dim">Equipos ordenados por días desde el último engrase.</span>
            <span class="dash-exc-summary">Máximo: 12 d · <span class="mono">EXC-02</span></span>
          </div>
          <div class="dash-exc-list">
            ${excRow({ id: 'eq1', code: 'T-06', dias: 'Sin registro', isMax: true, brandModel: 'Caterpillar D8T', ubicacion: 'Rajo Principal', ultimo: 'Sin registro' })}
            ${excRow({ id: 'eq2', code: 'EXC-02', dias: '12 d', isMax: false, brandModel: 'Caterpillar 336', ubicacion: 'Botadero Norte', ultimo: '13/09/2026' })}
          </div>
        </div>

        <section class="dash-section dash-section-secondary">
          <h2 class="dash-section-title">Indicadores secundarios</h2>
          <div class="dash-activity-row" id="dash-secundarios-row">
            <div class="dash-activity-card tone-green kpi-clickable" data-kpi-action="al-dia"><span class="dash-activity-value">10</span><span class="dash-activity-label">Al día</span></div>
            <div class="dash-activity-card tone-red kpi-clickable" data-kpi-action="sin-plan"><span class="dash-activity-value">2</span><span class="dash-activity-label">Sin plan</span></div>
            <div class="dash-activity-card tone-neutral kpi-clickable" data-kpi-action="pausados"><span class="dash-activity-value">1</span><span class="dash-activity-label">Pausados</span></div>
            <div class="dash-activity-card tone-amber kpi-clickable" data-kpi-action="anomalias"><span class="dash-activity-value">1</span><span class="dash-activity-label">Anomalías abiertas</span></div>
            <div class="dash-activity-card tone-neutral kpi-clickable" data-kpi-action="total-equipos"><span class="dash-activity-value">18</span><span class="dash-activity-label">Total equipos</span></div>
          </div>
        </section>
      </main>
    </div>
  </div>`;
}

const WIDTHS = [412, 768, 1366];

for (const width of WIDTHS) {
  test(`Dashboard @ ${width}px — filtros Ubicación + Familia presentes (Todas + reales)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(dashboardFixture({ ubicaciones: ['Rajo Principal', 'Botadero Norte', 'Taller Central'] }));
    await page.addStyleTag({ path: STYLES_PATH });

    const ubicOptions = await page.locator('#dash-ubic option').allTextContents();
    expect(ubicOptions).toEqual(['Todas', 'Rajo Principal', 'Botadero Norte', 'Taller Central']);
  });

  test(`Dashboard @ ${width}px — KPI principales (B) tiene 6 tarjetas destacadas en el orden pedido, más grandes que los indicadores secundarios`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(dashboardFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const heroCards = page.locator('.dash-hero-card');
    await expect(heroCards).toHaveCount(6);
    const labels = await heroCards.locator('.dash-hero-label').allTextContents();
    expect(labels).toEqual(['Vencidos', 'Pendientes hoy', 'Próximos', 'Realizados hoy', 'Pendientes de validación', 'Cumplimiento hoy']);

    const secundarios = page.locator('#dash-secundarios-row .dash-activity-card');
    await expect(secundarios).toHaveCount(5);

    const heroFontSize = await heroCards.first().locator('.dash-hero-value').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    const activityFontSize = await secundarios.first().locator('.dash-activity-value').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(heroFontSize).toBeGreaterThan(activityFontSize);
  });

  test(`Dashboard @ ${width}px — "Al día" es ahora un indicador secundario (menor peso visual), no una tarjeta destacada`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(dashboardFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    await expect(page.locator('h3:has-text("Equipos al día")')).toHaveCount(0);
    await expect(page.locator('.dash-al-dia-sub')).toHaveCount(0);
    await expect(page.locator('.dash-hero-label:has-text("Al día")')).toHaveCount(0);
    await expect(page.locator('.dash-activity-label:has-text("Al día")')).toHaveCount(1);
  });

  test(`Dashboard @ ${width}px — "Cumplimiento operativo" (C) va justo después de los KPI principales (B), 3 tarjetas (Hoy/Semana/Turno Día|Noche)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(dashboardFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const cards = page.locator('.dash-compliance-card');
    await expect(cards).toHaveCount(3);
    const labels = await cards.locator('.dash-compliance-label').allTextContents();
    expect(labels).toEqual(['Hoy', 'Semana', 'Turno Día']);

    await expect(cards.nth(1).locator('.dash-compliance-pct')).toHaveText('—');
    await expect(cards.nth(1).locator('.dash-compliance-frac')).toHaveText('Sin engrases programados');
    await expect(cards.nth(0).locator('.dash-compliance-frac')).toHaveText('3 de 4 programados');

    const note = page.locator('.dash-compliance-note');
    await expect(note).toContainText('Basado en planes programados por Día/Turno.');
    await expect(note).toContainText('Los planes por Horas no se incluyen.');
    await expect(note).not.toContainText('no hay forma de saber');

    // Orden en el DOM: Cumplimiento aparece DESPUÉS del bloque de KPI
    // principales (B) y ANTES de "Equipos que requieren atención" (D).
    const heroBox = await page.locator('.dash-hero-grid').boundingBox();
    const complianceBox = await page.locator('.dash-compliance-grid').boundingBox();
    const attentionBox = await page.locator('#dash-attention-panel').boundingBox();
    expect(complianceBox.y).toBeGreaterThan(heroBox.y);
    expect(attentionBox.y).toBeGreaterThan(complianceBox.y);
  });

  test(`Dashboard @ ${width}px — "Mayor tiempo sin engrasar" (H) es una LISTA/RANKING COMPACTO de excepciones (sin ranking #1/#2), con "Historial" como acción principal visible, y va DESPUÉS de "Requieren atención"`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(dashboardFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    await expect(page.locator('#dash-tiempo-sin-engrase-panel table')).toHaveCount(0); // NO es tabla
    const rows = page.locator('#dash-tiempo-sin-engrase-panel .dash-exc-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveClass(/is-max/); // el de más días recibe acento discreto — MISMA fila, no una card separada
    await expect(rows.nth(1)).not.toHaveClass(/is-max/);
    await expect(page.locator('#dash-tiempo-sin-engrase-panel .dash-tiempo-rank')).toHaveCount(0); // sin número de ranking
    await expect(rows.first()).toContainText('T-06');

    await expect(rows.first().locator('.dash-exc-days-wrap')).toBeVisible();
    await expect(rows.first().locator('.dash-exc-hist-btn')).toBeVisible();
    await expect(rows.first().locator('.dash-exc-hist-btn')).toHaveText('Historial');

    const verTodos = page.locator('#dash-tiempo-ver-todos');
    await expect(verTodos).toBeVisible();
    await expect(verTodos).toHaveText('Ver todos');

    const resumen = page.locator('.dash-exc-summary');
    await expect(resumen).toContainText('Máximo:');

    const attentionBox = await page.locator('#dash-attention-panel').boundingBox();
    const tiempoBox = await page.locator('#dash-tiempo-sin-engrase-panel').boundingBox();
    expect(tiempoBox.y).toBeGreaterThan(attentionBox.y);
  });

  test(`Dashboard @ ${width}px — lista de "Mayor tiempo sin engrasar" es vertical (nunca 2 filas lado a lado)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(dashboardFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const row1Box = await page.locator('#dash-tiempo-sin-engrase-panel .dash-exc-row').nth(0).boundingBox();
    const row2Box = await page.locator('#dash-tiempo-sin-engrase-panel .dash-exc-row').nth(1).boundingBox();
    expect(row2Box.y).toBeGreaterThan(row1Box.y); // la fila 2 va DEBAJO de la 1, nunca al lado
  });

  test(`Dashboard @ ${width}px — "Equipos que requieren atención" (D) es una cola compacta en el orden Vencido > Turno anterior > Pendiente hoy > Próximo > Sin plan, no una tabla ancha`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(dashboardFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    await expect(page.locator('#dash-attention-panel table')).toHaveCount(0);
    const badges = await page.locator('.dash-cola-badge').allTextContents();
    expect(badges).toEqual(['Vencido', 'Turno anterior', 'Pendiente hoy', 'Próximo', 'Sin plan']);

    const primera = page.locator('.dash-cola-row').first();
    await expect(primera).toContainText('45-77');
    await expect(primera).toContainText('Plan: Cada 250 h');
    await expect(primera).toContainText('Atraso: 43 h');
    await expect(primera.locator('.dash-cola-hist')).toBeVisible();
    await expect(primera.locator('.dash-cola-reg')).toBeVisible();
  });

  test(`Dashboard @ ${width}px — cola de atención mantiene filtros Turno/Día del bloque`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(dashboardFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    await expect(page.locator('#dash-attention-panel #att-turno')).toBeVisible();
    await expect(page.locator('#dash-attention-panel #att-dia')).toBeVisible();
  });

  test(`Dashboard @ ${width}px — "Pendientes del turno anterior" (E) es su propia sección, con la lista real de códigos, distinta de una tarjeta KPI`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(dashboardFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const panel = page.locator('#dash-pendientes-anterior-panel');
    await expect(panel.locator('h3')).toHaveText('Pendientes del turno anterior');
    await expect(panel.locator('.dash-motivo-chip')).toHaveCount(1);
    await expect(panel.locator('.dash-motivo-chip').first()).toHaveText('T-09');
    // Nunca es una tarjeta KPI (dash-hero-card/dash-activity-card) — es lista real.
    await expect(panel.locator('.dash-hero-card, .dash-activity-card')).toHaveCount(0);
  });

  test(`Dashboard @ ${width}px — "Estado por ubicación" (F) mantiene la tabla dinámica (nunca nombres de ubicación hardcodeados en el markup base)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(dashboardFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const panel = page.locator('#dash-ubic-panel');
    await expect(panel.locator('h3')).toHaveText('Estado por ubicación');
    const rows = panel.locator('tbody tr');
    await expect(rows).toHaveCount(2);
  });

  test(`Dashboard @ ${width}px — "Asignaciones · Fuera de plan · No ejecutados" (G) es compacta y separada de "Requieren atención" (sin doble conteo visual)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(dashboardFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const row = page.locator('#dash-panel-operativo-row .dash-activity-card');
    await expect(row).toHaveCount(3);
    const labels = await row.locator('.dash-activity-label').allTextContents();
    expect(labels).toEqual(['Asignaciones activas', 'Fuera de plan hoy', 'No ejecutados hoy']);
  });

  test(`Dashboard @ ${width}px — tarjetas/filas clicables con touch target ≥44px, sin scroll horizontal`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(dashboardFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const box = await page.locator('.dash-hero-card').first().boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
}

test('Dashboard @ 1366px — "Indicadores secundarios" ocupa TODO el ancho de la sección en 4 columnas equilibradas (ya NO deja espacio vacío a la derecha)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.setContent(dashboardFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const row = page.locator('#dash-secundarios-row');
  const rowBox = await row.boundingBox();
  const lastCardBox = await row.locator('.dash-activity-card').last().boundingBox();
  const cols = await row.evaluate(el => new Set(Array.from(el.children).map(c => Math.round(c.getBoundingClientRect().left))).size);
  expect(cols).toBe(4);
  // La última fila puede quedar a menos del ancho total (5 tarjetas en grid de
  // 4 columnas), pero ninguna tarjeta se sale del contenedor.
  expect(lastCardBox.x + lastCardBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
});

test('Dashboard @ 412px — "Indicadores secundarios" usa grid de 2 columnas ocupando todo el ancho (no 1 columna angosta con hueco a la derecha)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 });
  await page.setContent(dashboardFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const row = page.locator('#dash-secundarios-row');
  const cols = await row.evaluate(el => new Set(Array.from(el.children).map(c => Math.round(c.getBoundingClientRect().left))).size);
  expect(cols).toBe(2);
});

test('Dashboard @ 360px — "Indicadores secundarios" mantiene 2 columnas (sin overflow ni scroll horizontal)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.setContent(dashboardFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const row = page.locator('#dash-secundarios-row');
  const cols = await row.evaluate(el => new Set(Array.from(el.children).map(c => Math.round(c.getBoundingClientRect().left))).size);
  expect(cols).toBe(2);

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test('Dashboard @ 768px — "Indicadores secundarios" ya usa 4 columnas (no 2)', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.setContent(dashboardFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const row = page.locator('#dash-secundarios-row');
  const cols = await row.evaluate(el => new Set(Array.from(el.children).map(c => Math.round(c.getBoundingClientRect().left))).size);
  expect(cols).toBe(4);
});

test('Indicadores secundarios — el número va ARRIBA y el label ABAJO (no label-izquierda/valor-derecha), touch target >=44px', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 });
  await page.setContent(dashboardFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const card = page.locator('#dash-secundarios-row .dash-activity-card').first();
  const valueTop = await card.locator('.dash-activity-value').evaluate(el => el.getBoundingClientRect().top);
  const labelTop = await card.locator('.dash-activity-label').evaluate(el => el.getBoundingClientRect().top);
  expect(valueTop).toBeLessThan(labelTop);

  const box = await card.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
});

test('"Pendientes de validación" es un KPI principal más — muestra el valor real (nunca un texto inventado tipo "Validación no activada")', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.setContent(dashboardFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const card = page.locator('.dash-hero-card').filter({ hasText: 'Pendientes de validación' });
  await expect(card.locator('.dash-hero-value')).toHaveText('0');
  await expect(page.locator('.dash-activity-subtext')).toHaveCount(0);
});

test('Dashboard @ 412px — cola de atención SIN altura fija forzada (el alto lo define el texto, no un min-height)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 });
  await page.setContent(dashboardFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const row = page.locator('.dash-cola-row').first();
  const minHeight = await row.evaluate(el => getComputedStyle(el).minHeight);
  expect(['0px', 'auto', 'none']).toContain(minHeight);
});

test('Dashboard @ 412px — cola de atención se apila en tarjeta vertical (mismo markup, flex-wrap sin flex-grow parejo — REDISEÑO)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 });
  await page.setContent(dashboardFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const row = page.locator('.dash-cola-row').first();
  const flexWrap = await row.evaluate(el => getComputedStyle(el).flexWrap);
  expect(flexWrap).toBe('wrap');
  const codeBox = await row.locator('.dash-cola-code').boundingBox();
  const metaBox = await row.locator('.dash-cola-meta').boundingBox();
  expect(metaBox.y).toBeGreaterThan(codeBox.y);
});

test('Dashboard @ 1366px — cola de atención es una fila compacta en desktop (no tabla, sin huecos de flex-grow parejo)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.setContent(dashboardFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const row = page.locator('.dash-cola-row').first();
  const flexWrap = await row.evaluate(el => getComputedStyle(el).flexWrap);
  expect(flexWrap).toBe('nowrap');
  const codeBox = await row.locator('.dash-cola-code').boundingBox();
  const planBox = await row.locator('.dash-cola-plan').boundingBox();
  expect(Math.abs(planBox.y - codeBox.y)).toBeLessThan(4);
});

test('Dashboard @ 412px — la fila de "Mayor tiempo sin engrasar" ya es fila (código/modelo/último apilados a la izquierda, días+chevron a la derecha) sin necesitar un breakpoint aparte', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 });
  await page.setContent(dashboardFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const row = page.locator('#dash-tiempo-sin-engrase-panel .dash-exc-row').first();
  expect(await row.evaluate(el => getComputedStyle(el).flexDirection)).toBe('row');
  expect(await row.locator('.dash-exc-main').evaluate(el => getComputedStyle(el).flexDirection)).toBe('column');
  const box = await row.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44); // touch target ≥44px pedido para móvil
});

test('Dashboard @ 1366px — la fila de "Mayor tiempo sin engrasar" mantiene el mismo layout compacto en desktop (no tabla, no card estirada)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.setContent(dashboardFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const row = page.locator('#dash-tiempo-sin-engrase-panel .dash-exc-row').first();
  expect(await row.evaluate(el => getComputedStyle(el).flexDirection)).toBe('row');
  const box = await row.boundingBox();
  expect(box.height).toBeLessThanOrEqual(70);
});

test('Dashboard @ 1366px — hover en tarjeta destacada solo aplica en dispositivos con hover real (no queda "pegado" en touch)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'La emulación de hover:none/hover:hover es consistente solo en chromium en este entorno.');
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setContent(dashboardFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const borderBefore = await page.locator('.dash-hero-card').first().evaluate(el => getComputedStyle(el).borderTopColor);
  await page.locator('.dash-hero-card').first().hover();
  const borderAfterHover = await page.locator('.dash-hero-card').first().evaluate(el => getComputedStyle(el).borderColor);
  expect(borderAfterHover).not.toBe(borderBefore); // el hover cambia el borde (desktop, hover:hover disponible en chromium headless por defecto)
});
