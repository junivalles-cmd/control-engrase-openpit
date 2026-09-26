// tests/ui/dashboard-operativo.spec.js
//
// Dashboard operativo (ajuste visual final): filtros Ubicación/Familia, 5
// tarjetas destacadas de "Estado de lubricación" (Al día/Próximos/Vencidos/
// Sin plan/Pausados), 4 mini-KPIs de "Actividad" de ancho fijo (NO
// estirados a todo el ancho), panel "Cumplimiento operativo" (Hoy/Semana/
// Turno Día|Noche — el panel duplicado "Equipos al día" con %+barra fue
// ELIMINADO, solo queda la tarjeta destacada), "Mayor tiempo sin engrasar"
// como LISTA COMPACTA de excepciones estilo Fiix/UpKeep/Fracttal (sin
// ranking #1/#2/#3, sin cards, chevron como única acción, toda la fila
// navega a Historial) y "Equipos que requieren atención"
// como cola compacta (sin alturas fijas, sin huecos en móvil). No requiere
// login ni red: fragmento estático con la estructura/clases REALES de
// renderDashboard() (app.js) — datos de relleno, nunca registros de
// producción. La lógica ya está probada contra la función REAL en
// tests/unit/dashboard-operativo.test.js y tests/unit/dashboard-sin-plan.test.js
// — aquí solo se valida la composición visual (jerarquía/acciones/layout),
// sin duplicar esas pruebas.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

function colaRow({ id, badge, tone, code, urgencia, linea2, plan }) {
  // Estructura REAL post-rediseño (fila plana, sin "líneas" de igual
  // flex-grow — ver app.js drawColaAtencion()/styles.css .dash-cola-row):
  // badge, código, meta (marca/modelo·ubicación), programación compacta
  // (progCompactaFor: ya trae "Atraso"/"Restante" o "HOY · Día"/"VENCIDO ·
  // Día"), plan (ya abreviado), acciones.
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
  // Estructura REAL post-rediseño (ver app.js tiempoExcepcionRowHTML()): el
  // bloque de días es un "stat" propio (número + etiqueta), con "Historial"
  // como acción principal visible — ya no chevron + fila-clickable-sin-control.
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
          <h2 class="dash-section-title">Estado de lubricación</h2>
          <div class="dash-hero-grid">
            <div class="dash-hero-card tone-green kpi-clickable" data-kpi-action="al-dia"><div class="dash-hero-value">10</div><div class="dash-hero-label">Al día</div></div>
            <div class="dash-hero-card tone-amber kpi-clickable" data-kpi-action="proximos"><div class="dash-hero-value">3</div><div class="dash-hero-label">Próximos</div></div>
            <div class="dash-hero-card tone-red kpi-clickable" data-kpi-action="vencidos"><div class="dash-hero-value">2</div><div class="dash-hero-label">Vencidos</div></div>
            <div class="dash-hero-card tone-red kpi-clickable" data-kpi-action="sin-plan"><div class="dash-hero-value">2</div><div class="dash-hero-label">Sin plan</div></div>
            <div class="dash-hero-card tone-neutral kpi-clickable" data-kpi-action="pausados"><div class="dash-hero-value">1</div><div class="dash-hero-label">Pausados</div></div>
          </div>
        </section>

        <section class="dash-section dash-section-secondary">
          <h2 class="dash-section-title">Actividad</h2>
          <div class="dash-activity-row">
            <div class="dash-activity-card tone-neutral kpi-clickable" data-kpi-action="total-equipos"><span class="dash-activity-value">18</span><span class="dash-activity-label">Total equipos</span></div>
            <div class="dash-activity-card tone-green kpi-clickable" data-kpi-action="realizados-hoy"><span class="dash-activity-value">4</span><span class="dash-activity-label">Realizados hoy</span></div>
            <div class="dash-activity-card tone-amber kpi-clickable" data-kpi-action="anomalias"><span class="dash-activity-value">1</span><span class="dash-activity-label">Anomalías abiertas</span></div>
            <div class="dash-activity-card tone-neutral" data-kpi-action=""><span class="dash-activity-value">—</span><span class="dash-activity-label">Pendientes de validación</span><span class="dash-activity-subtext">Validación no activada</span></div>
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

        <div class="panel" id="dash-attention-panel">
          <div class="panel-head"><h3>Equipos que requieren atención</h3></div>
          <div class="toolbar">
            <label class="filter-label">Turno<select id="att-turno" class="input input-sm"><option value="">Ambos</option></select></label>
            <label class="filter-label">Día asignado<select id="att-dia" class="input input-sm"><option value="">Todos</option></select></label>
          </div>
          <div class="dash-cola-atencion" id="dash-cola-atencion">
            ${colaRow({ id: 'e1', badge: 'Vencido', tone: 'red', code: '45-77', urgencia: 'Atraso: 43 h', linea2: 'CAT 740B · Volcán', plan: 'Cada 250 h' })}
            ${colaRow({ id: 'e2', badge: 'Próximo', tone: 'amber', code: 'T-06', urgencia: 'Restante: 15 h', linea2: 'Caterpillar D8T · Rajo Principal', plan: 'Cada 250 h' })}
            ${colaRow({ id: 'e3', badge: 'Sin plan', tone: 'red', code: 'CIS-03', urgencia: '—', linea2: 'Cisterna 5000gal · Botadero Norte', plan: '—' })}
          </div>
        </div>
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

  test(`Dashboard @ ${width}px — "Estado de lubricación" tiene 5 tarjetas destacadas, más grandes que "Actividad"`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(dashboardFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const heroCards = page.locator('.dash-hero-card');
    await expect(heroCards).toHaveCount(5);
    const labels = await heroCards.locator('.dash-hero-label').allTextContents();
    expect(labels).toEqual(['Al día', 'Próximos', 'Vencidos', 'Sin plan', 'Pausados']);

    const activityCards = page.locator('.dash-activity-card');
    await expect(activityCards).toHaveCount(4);

    const heroFontSize = await heroCards.first().locator('.dash-hero-value').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    const activityFontSize = await activityCards.first().locator('.dash-activity-value').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(heroFontSize).toBeGreaterThan(activityFontSize);
  });

  test(`Dashboard @ ${width}px — NO existe el panel duplicado "Equipos al día" (solo queda la tarjeta destacada)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(dashboardFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    await expect(page.locator('h3:has-text("Equipos al día")')).toHaveCount(0);
    await expect(page.locator('.dash-al-dia-sub')).toHaveCount(0);
    await expect(page.locator('.dash-hero-label:has-text("Al día")')).toHaveCount(1);
  });

  test(`Dashboard @ ${width}px — "Cumplimiento operativo": 3 tarjetas (Hoy/Semana/Turno Día|Noche), texto explicativo corto`, async ({ page }) => {
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
  });

  test(`Dashboard @ ${width}px — "Mayor tiempo sin engrasar" es una LISTA/RANKING COMPACTO de excepciones (sin ranking #1/#2), con "Historial" como acción principal visible`, async ({ page }) => {
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

    // REDISEÑO: el dato de días es un bloque destacado (número + etiqueta) y
    // "Historial" es un botón visible — ya no chevron + fila-clickable-oculta.
    await expect(rows.first().locator('.dash-exc-days-wrap')).toBeVisible();
    await expect(rows.first().locator('.dash-exc-hist-btn')).toBeVisible();
    await expect(rows.first().locator('.dash-exc-hist-btn')).toHaveText('Historial');

    const verTodos = page.locator('#dash-tiempo-ver-todos');
    await expect(verTodos).toBeVisible();
    await expect(verTodos).toHaveText('Ver todos');

    const resumen = page.locator('.dash-exc-summary');
    await expect(resumen).toContainText('Máximo:');
  });

  test(`Dashboard @ ${width}px — lista de "Mayor tiempo sin engrasar" es vertical (nunca 2 filas lado a lado)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(dashboardFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const row1Box = await page.locator('#dash-tiempo-sin-engrase-panel .dash-exc-row').nth(0).boundingBox();
    const row2Box = await page.locator('#dash-tiempo-sin-engrase-panel .dash-exc-row').nth(1).boundingBox();
    expect(row2Box.y).toBeGreaterThan(row1Box.y); // la fila 2 va DEBAJO de la 1, nunca al lado
  });

  test(`Dashboard @ ${width}px — "Equipos que requieren atención" es una cola compacta (Vencido > Próximo > Sin plan), no una tabla ancha`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(dashboardFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    await expect(page.locator('#dash-attention-panel table')).toHaveCount(0);
    const badges = await page.locator('.dash-cola-badge').allTextContents();
    expect(badges).toEqual(['Vencido', 'Próximo', 'Sin plan']);

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

test('Dashboard @ 1366px — "Actividad" ocupa TODO el ancho de la sección en 4 columnas equilibradas (ya NO deja espacio vacío a la derecha)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.setContent(dashboardFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const row = page.locator('.dash-activity-row');
  const rowBox = await row.boundingBox();
  const lastCardBox = await page.locator('.dash-activity-card').last().boundingBox();
  // La última tarjeta llega hasta el borde derecho de la fila (±1px de
  // redondeo) — antes quedaba espacio de sobra porque las cards tenían un
  // ancho tope fijo (240px) y se agrupaban a la izquierda.
  expect(lastCardBox.x + lastCardBox.width).toBeGreaterThanOrEqual(rowBox.x + rowBox.width - 1);

  const cols = await row.evaluate(el => new Set(Array.from(el.children).map(c => Math.round(c.getBoundingClientRect().left))).size);
  expect(cols).toBe(4);
});

test('Dashboard @ 412px — "Actividad" usa grid de 2 columnas ocupando todo el ancho (no 1 columna angosta con hueco a la derecha)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 });
  await page.setContent(dashboardFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const row = page.locator('.dash-activity-row');
  const cols = await row.evaluate(el => new Set(Array.from(el.children).map(c => Math.round(c.getBoundingClientRect().left))).size);
  expect(cols).toBe(2);

  const rowBox = await row.boundingBox();
  const lastCardBox = await page.locator('.dash-activity-card').nth(1).boundingBox(); // 2da tarjeta = fin de la 1ra fila
  expect(lastCardBox.x + lastCardBox.width).toBeGreaterThanOrEqual(rowBox.x + rowBox.width - 1);
});

test('Dashboard @ 360px — "Actividad" mantiene 2 columnas (sin overflow ni scroll horizontal)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.setContent(dashboardFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const row = page.locator('.dash-activity-row');
  const cols = await row.evaluate(el => new Set(Array.from(el.children).map(c => Math.round(c.getBoundingClientRect().left))).size);
  expect(cols).toBe(2);

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test('Dashboard @ 768px — "Actividad" ya usa 4 columnas (no 2)', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.setContent(dashboardFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const row = page.locator('.dash-activity-row');
  const cols = await row.evaluate(el => new Set(Array.from(el.children).map(c => Math.round(c.getBoundingClientRect().left))).size);
  expect(cols).toBe(4);
});

test('Actividad — el número va ARRIBA y el label ABAJO (no label-izquierda/valor-derecha), touch target >=44px', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 });
  await page.setContent(dashboardFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const card = page.locator('.dash-activity-card').first();
  const valueTop = await card.locator('.dash-activity-value').evaluate(el => el.getBoundingClientRect().top);
  const labelTop = await card.locator('.dash-activity-label').evaluate(el => el.getBoundingClientRect().top);
  expect(valueTop).toBeLessThan(labelTop);

  const box = await card.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
});

test('Pendientes de validación con baseline sin activar: muestra "—" + "Validación no activada", sin acción clicable (nunca fabrica un conteo histórico)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.setContent(dashboardFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const card = page.locator('.dash-activity-card').filter({ hasText: 'Pendientes de validación' });
  await expect(card.locator('.dash-activity-value')).toHaveText('—');
  await expect(card.locator('.dash-activity-subtext')).toHaveText('Validación no activada');
  await expect(card).not.toHaveClass(/kpi-clickable/);
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
  // La meta (marca/modelo·ubicación) cae en una línea propia, debajo del
  // código — ya no hay franjas de columnas angostas con el mismo flex-grow.
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
  // Todo cabe en la misma línea vertical (una sola fila real, no apilado).
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
  // REDISEÑO: 3 líneas de texto + bloque de días destacado + botón Historial
  // (antes solo chevron) — un poco más alto que la versión ultra-mínima
  // anterior, pero sigue siendo una fila compacta, no una card.
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
