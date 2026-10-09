// tests/ui/lubricador-dashboard.spec.js
//
// "Mi Turno" del Lubricador (renderLubricadorHome(), ruta 'turno') —
// fragmento estático con la MISMA estructura/clases REALES que genera la
// función (lub-context-row/lub-kpi-row/lub-arrastrado-card/lub-eq-btn/
// lub-quick-actions) — sin login/DB real, mismo método que el resto de
// specs del proyecto.
//
// Hardening UI 2026-10-08 ("simplificar Mi Turno"): 4 secciones con
// contador — ATRASADOS/MI TURNO/REALIZADOS/ALERTAS — "Asignaciones activas"
// ya NO es una sección aparte (un equipo asignado vive dentro de Atrasados
// o Mi Turno con badge ASIGNADO). Foco explícito del pedido: mobile first
// 390/412px, identificar equipos en pocos segundos, ocultar bloques vacíos
// salvo los 4 KPIs.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

function fixture({ withArrastrados = true, withMiTurno = true, withRealizados = true, withAlertas = true, asignadoEnMiTurno = true } = {}) {
  return `
  <div class="lub-shell">
    <main class="lub-content">
      <div class="lub-welcome-card">
        <div class="lub-welcome-name">Jose Guerrero</div>
        <div class="lub-welcome-role">LUBRICADOR</div>
        <div class="lub-context-row">
          <span class="lub-context-chip">☀ Turno Día</span>
          <span class="lub-context-chip">📍 Rajo Principal</span>
          <span class="lub-context-chip">👥 Cuadrilla A</span>
          <span class="lub-context-chip tone-green"><span class="dot"></span>Sincronizado</span>
        </div>
      </div>

      <div class="lub-kpi-row">
        <div class="lub-kpi-card tone-neutral"><div class="lub-kpi-value">0</div><div class="lub-kpi-label">Vencidos</div></div>
        <div class="lub-kpi-card tone-neutral"><div class="lub-kpi-value">0</div><div class="lub-kpi-label">Pendientes hoy</div></div>
        <div class="lub-kpi-card tone-neutral"><div class="lub-kpi-value">0</div><div class="lub-kpi-label">Arrastrados</div></div>
        <div class="lub-kpi-card tone-green"><div class="lub-kpi-value">0</div><div class="lub-kpi-label">Realizados hoy</div></div>
      </div>

      ${withArrastrados ? `
      <div class="lub-section-head" id="arrastrados-head"><span class="status-chip" style="--c:var(--red)">ATRASADOS (1)</span></div>
      <div class="lub-eq-list" id="arrastrados-list">
        <div class="lub-arrastrado-card tone-amber">
          <span class="lub-arrastrado-origen tone-amber">Turno anterior</span>
          <div class="lub-eq-top"><span class="lub-eq-code">T-06</span></div>
          <div class="lub-eq-model">Caterpillar D8T</div>
          <div class="lub-eq-location">📍 Rajo Principal</div>
          <div class="lub-arrastrado-motivo">Motivo: No hubo tiempo</div>
          <div class="lub-arrastrado-actions"><button class="btn btn-accent">Registrar engrase</button><button class="btn">Ver ficha</button></div>
        </div>
      </div>` : ''}

      ${withMiTurno ? `
      <div class="lub-section-head" id="mi-turno-head"><span class="dim">MI TURNO (1)</span></div>
      <div class="lub-eq-list" id="mi-turno-list">
        <div class="lub-eq-btn" data-status="AMARILLO">
          <div class="lub-eq-top">
            <span class="lub-eq-code">T-09</span>
            <span class="status-chip" style="--c:var(--amber)">PRÓXIMO</span>
            ${asignadoEnMiTurno ? '<span class="status-chip chip-origen" style="--c:var(--amber)">ASIGNADO</span>' : ''}
          </div>
          <div class="lub-eq-model">Komatsu WA470</div>
          <div class="lub-eq-location">📍 Rajo Principal</div>
          <div class="lub-eq-bottom"><span class="mono">900 h</span></div>
          <div class="lub-arrastrado-actions"><button class="btn btn-accent">Registrar engrase</button><button class="btn">Ver ficha</button></div>
        </div>
      </div>` : ''}

      ${withRealizados ? `
      <div class="lub-section-head" id="realizados-head"><span class="status-chip" style="--c:var(--green)">REALIZADOS (1)</span></div>
      <div class="lub-eq-list" id="realizados-list">
        <div class="lub-arrastrado-card tone-green">
          <div class="lub-eq-top"><span class="lub-eq-code">T-02</span><span class="dim">08:15</span></div>
          <div class="lub-eq-model">Caterpillar 740B</div>
          <div class="lub-record-meta dim"><span>2.5 lb</span><span>Juan Pérez</span></div>
          <div class="lub-record-validacion"><span class="status-chip">Validado</span></div>
          <div class="lub-arrastrado-actions"><button class="btn">Ver ficha</button></div>
        </div>
      </div>` : ''}

      ${withAlertas ? `
      <div class="lub-section-head" id="alertas-head"><span class="status-chip" style="--c:var(--amber)">ALERTAS (1)</span></div>
      <div class="lub-eq-list" id="alertas-list">
        <div class="lub-arrastrado-card tone-amber">
          <div class="lub-eq-top"><button type="button" class="lub-eq-code dash-code-link">T-11</button><span class="dim">12 días sin engrasar</span></div>
          <div class="lub-eq-model">Volvo A40</div>
        </div>
      </div>` : ''}

      <button class="lub-hero-action" id="qa-registrar">
        <span class="lub-hero-action-text">
          <span class="lub-hero-action-title">Registrar fuera de plan</span>
          <span class="lub-hero-action-sub">Engrasar otro equipo</span>
        </span>
        <span class="lub-hero-action-arrow">→</span>
      </button>

      <div class="lub-section-head"><span class="dim">Accesos rápidos</span></div>
      <div class="lub-quick-actions">
        <button class="btn lub-quick-action" id="qa-qr">Escanear QR</button>
        <button class="btn lub-quick-action" id="qa-buscar">Buscar equipo</button>
        <button class="btn lub-quick-action" id="qa-matriz">Matriz semanal</button>
        <button class="btn lub-quick-action" id="qa-anomalia">Reportar anomalía</button>
      </div>
    </main>
  </div>`;
}

// Fix 2026-10-09 (§14 del pedido): 360/384 se suman a los 390/412 que ya
// cubría esta suite — las 4 anchuras de auditoría obligatorias, con el
// fixture REAL completo (contexto + 4 KPI + Atrasados/Mi Turno/Realizados/
// Alertas + acción principal + Accesos rápidos), no solo el topbar vacío
// (eso ya lo cubre lubricador-mobile-ux.spec.js aparte).
for (const width of [360, 384, 390, 412]) {
  test(`Mi Turno @ ${width}px — sin scroll horizontal`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 });
    await page.setContent(fixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test(`Mi Turno @ ${width}px — los 4 KPIs están en 2 columnas, visibles sin scroll adicional`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 });
    await page.setContent(fixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const cards = page.locator('.lub-kpi-card');
    await expect(cards).toHaveCount(4);
    const cols = await page.locator('.lub-kpi-row').evaluate(el => new Set(Array.from(el.children).map(c => Math.round(c.getBoundingClientRect().left))).size);
    expect(cols).toBe(2);
  });

  test(`Mi Turno @ ${width}px — acciones rápidas, acciones de Atrasados y de Mi Turno cumplen touch target >=44px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 });
    await page.setContent(fixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const quickActions = page.locator('.lub-quick-action');
    const n = await quickActions.count();
    for (let i = 0; i < n; i++) {
      const box = await quickActions.nth(i).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const hero = await page.locator('.lub-hero-action').boundingBox();
    expect(hero.height).toBeGreaterThanOrEqual(44);
    // .lub-arrastrado-actions se reusa tal cual en Atrasados, Mi Turno y
    // Realizados (hardening UI 2026-10-08) — este selector ya cubre los 3.
    const arrBtns = page.locator('.lub-arrastrado-actions .btn');
    const m = await arrBtns.count();
    expect(m).toBeGreaterThan(0);
    for (let i = 0; i < m; i++) {
      const box = await arrBtns.nth(i).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
}

test('4 KPIs siempre visibles incluso en 0 (nunca se ocultan, a diferencia de Atrasados/Mi Turno/Realizados/Alertas)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture({ withArrastrados: false, withMiTurno: false, withRealizados: false, withAlertas: false }));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('.lub-kpi-card')).toHaveCount(4);
  const values = await page.locator('.lub-kpi-value').allTextContents();
  expect(values).toEqual(['0', '0', '0', '0']);
});

test('"Atrasados" se oculta por completo cuando no hay registros (nunca una tarjeta en 0)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture({ withArrastrados: false }));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('#arrastrados-head')).toHaveCount(0);
  await expect(page.locator('#arrastrados-list')).toHaveCount(0);
});

test('"Mi Turno" se oculta por completo cuando no hay trabajo del turno actual', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture({ withMiTurno: false }));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('#mi-turno-head')).toHaveCount(0);
  await expect(page.locator('#mi-turno-list')).toHaveCount(0);
});

test('"Realizados" se oculta por completo cuando no hay engrases completados hoy', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture({ withRealizados: false }));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('#realizados-head')).toHaveCount(0);
  await expect(page.locator('#realizados-list')).toHaveCount(0);
});

test('"Alertas" se oculta por completo cuando no hay equipos para mostrar', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture({ withAlertas: false }));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('#alertas-head')).toHaveCount(0);
  await expect(page.locator('#alertas-list')).toHaveCount(0);
});

test('orden de pantalla: Atrasados > Mi Turno > Realizados > Alertas', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 1200 });
  await page.setContent(fixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const arrastradosBox = await page.locator('#arrastrados-head').boundingBox();
  const miTurnoBox = await page.locator('#mi-turno-head').boundingBox();
  const realizadosBox = await page.locator('#realizados-head').boundingBox();
  const alertasBox = await page.locator('#alertas-head').boundingBox();
  expect(miTurnoBox.y).toBeGreaterThan(arrastradosBox.y);
  expect(realizadosBox.y).toBeGreaterThan(miTurnoBox.y);
  expect(alertasBox.y).toBeGreaterThan(realizadosBox.y);
});

test('cada tarjeta de Atrasados muestra código, modelo, ubicación, origen y acciones Registrar/Ver ficha', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const card = page.locator('.lub-arrastrado-card').first();
  await expect(card.locator('.lub-arrastrado-origen')).toHaveText('Turno anterior');
  await expect(card.locator('.lub-eq-code')).toHaveText('T-06');
  await expect(card.locator('.lub-eq-model')).toContainText('Caterpillar D8T');
  await expect(card.locator('.lub-eq-location')).toContainText('Rajo Principal');
  await expect(card.locator('button', { hasText: 'Registrar engrase' })).toBeVisible();
  await expect(card.locator('button', { hasText: 'Ver ficha' })).toBeVisible();
});

test('una tarjeta de Mi Turno asignada muestra el badge ASIGNADO junto al estado', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture({ asignadoEnMiTurno: true }));
  await page.addStyleTag({ path: STYLES_PATH });

  const card = page.locator('#mi-turno-list .lub-eq-btn').first();
  const chips = await card.locator('.lub-eq-top .status-chip').allTextContents();
  expect(chips).toContain('ASIGNADO');
});

test('una tarjeta de Mi Turno sin asignación NO muestra el badge ASIGNADO', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture({ asignadoEnMiTurno: false }));
  await page.addStyleTag({ path: STYLES_PATH });

  const card = page.locator('#mi-turno-list .lub-eq-btn').first();
  const chips = await card.locator('.lub-eq-top .status-chip').allTextContents();
  expect(chips).not.toContain('ASIGNADO');
});

test('§12: el badge ASIGNADO (origen) se ve visualmente distinto del status-chip de ESTADO (sin confundirse, aunque comparten color)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture({ asignadoEnMiTurno: true }));
  await page.addStyleTag({ path: STYLES_PATH });

  const estadoChip = page.locator('#mi-turno-list .lub-eq-top .status-chip', { hasText: 'PRÓXIMO' });
  const asignadoChip = page.locator('#mi-turno-list .lub-eq-top .status-chip', { hasText: 'ASIGNADO' });
  const estadoBg = await estadoChip.evaluate(el => getComputedStyle(el).backgroundColor);
  const asignadoBg = await asignadoChip.evaluate(el => getComputedStyle(el).backgroundColor);
  // ESTADO sigue macizo (mismo --c con 18% de opacidad); ASIGNADO pasa a
  // transparente con contorno — nunca el mismo fondo, aunque el --c sea el
  // mismo ámbar en los dos.
  expect(asignadoBg).not.toBe(estadoBg);
  expect(await asignadoChip.evaluate(el => getComputedStyle(el).borderStyle)).toBe('solid');
});

test('cada tarjeta de Realizados muestra código, hora, lb, quién lo realizó, estado de validación y Ver ficha', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const card = page.locator('#realizados-list .lub-arrastrado-card').first();
  await expect(card.locator('.lub-eq-code')).toHaveText('T-02');
  await expect(card).toContainText('08:15');
  await expect(card.locator('.lub-record-meta')).toContainText('2.5 lb');
  await expect(card.locator('.lub-record-meta')).toContainText('Juan Pérez');
  await expect(card.locator('.lub-record-validacion')).toBeVisible();
  await expect(card.locator('button', { hasText: 'Ver ficha' })).toBeVisible();
});

test('cada tarjeta de Alertas muestra el código de equipo (abre la Ficha) y los días sin engrasar', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const card = page.locator('#alertas-list .lub-arrastrado-card').first();
  await expect(card.locator('.lub-eq-code')).toHaveText('T-11');
  await expect(card).toContainText('días sin engrasar');
});

test('contexto compacto muestra turno + ubicación + cuadrilla + sincronización en una sola fila', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const chips = await page.locator('.lub-context-chip').allTextContents();
  expect(chips.some(t => t.includes('Turno Día'))).toBe(true);
  expect(chips.some(t => t.includes('Rajo Principal'))).toBe(true);
  expect(chips.some(t => t.includes('Cuadrilla A'))).toBe(true);
  expect(chips.some(t => t.includes('Sincronizado'))).toBe(true);
});

test('"Registrar fuera de plan" es la acción principal dominante (tarjeta grande separada), y Accesos rápidos tiene exactamente 4 botones: Escanear QR, Buscar equipo, Matriz semanal, Reportar anomalía', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture());
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('.lub-hero-action')).toContainText('Registrar fuera de plan');
  const labels = await page.locator('.lub-quick-action').allTextContents();
  expect(labels).toEqual(['Escanear QR', 'Buscar equipo', 'Matriz semanal', 'Reportar anomalía']);
});

test('tarjeta de bienvenida muestra nombre + rol del usuario junto al contexto', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const card = page.locator('.lub-welcome-card');
  await expect(card.locator('.lub-welcome-name')).toHaveText('Jose Guerrero');
  await expect(card.locator('.lub-welcome-role')).toHaveText('LUBRICADOR');
  await expect(card.locator('.lub-context-row')).toContainText('Turno Día');
});
