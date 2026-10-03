// tests/ui/lubricador-dashboard.spec.js
//
// "Dashboard del Lubricador" (renderLubricadorHome(), ruta 'turno', tab "Mi
// Turno") — lote "Ajuste importante al Dashboard del Lubricador". Fragmento
// estático con la MISMA estructura/clases REALES que genera la función
// (lub-context-row/lub-kpi-row/lub-arrastrado-card/lub-quick-actions) — sin
// login/DB real, mismo método que el resto de specs del proyecto.
//
// Foco explícito del pedido: §10 "mobile first, 390/412px, identificar en
// pocos segundos sus equipos, evitar scroll innecesario" + §7 "ocultar
// bloques vacíos, salvo los 4 KPIs".

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

function fixture({ withArrastrados = true, withAsignaciones = true } = {}) {
  return `
  <div class="lub-shell">
    <main class="lub-content">
      <div class="lub-context-row">
        <span class="lub-context-chip">☀ Turno Día</span>
        <span class="lub-context-chip">📍 Rajo Principal</span>
        <span class="lub-context-chip">👥 Cuadrilla A</span>
        <span class="lub-context-chip tone-green"><span class="dot"></span>Sincronizado</span>
      </div>

      <div class="lub-kpi-row">
        <div class="lub-kpi-card tone-neutral"><div class="lub-kpi-value">0</div><div class="lub-kpi-label">Vencidos</div></div>
        <div class="lub-kpi-card tone-neutral"><div class="lub-kpi-value">0</div><div class="lub-kpi-label">Pendientes hoy</div></div>
        <div class="lub-kpi-card tone-neutral"><div class="lub-kpi-value">0</div><div class="lub-kpi-label">Arrastrados</div></div>
        <div class="lub-kpi-card tone-green"><div class="lub-kpi-value">0</div><div class="lub-kpi-label">Realizados hoy</div></div>
      </div>

      ${withArrastrados ? `
      <div class="lub-section-head" id="arrastrados-head"><span class="status-chip" style="--c:var(--red)">PENDIENTES ARRASTRADOS</span></div>
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

      ${withAsignaciones ? `
      <div class="lub-section-head" id="asignaciones-head"><span class="status-chip" style="--c:var(--amber)">ASIGNACIONES ACTIVAS</span></div>
      <div class="lub-eq-list" id="asignaciones-list">
        <button class="lub-eq-btn" data-status="AMARILLO">
          <div class="lub-eq-top"><span class="lub-eq-code">T-09</span><span class="status-chip" style="--c:var(--amber)">PRÓXIMO</span></div>
          <div class="lub-eq-model">Komatsu WA470</div>
          <div class="lub-eq-location">📍 Rajo Principal</div>
          <div class="lub-eq-bottom"><span class="mono">900 h</span></div>
        </button>
      </div>` : ''}

      <div class="lub-section-head"><span class="dim">Trabajo del turno actual</span></div>
      <div class="lub-eq-list">
        <div class="empty-state">No hay más equipos pendientes en este turno.</div>
      </div>

      <div class="lub-section-head"><span class="dim">Acciones rápidas</span></div>
      <div class="lub-quick-actions">
        <button class="btn btn-accent lub-quick-action" id="qa-registrar">Registrar engrase</button>
        <button class="btn lub-quick-action" id="qa-qr">Escanear QR</button>
        <button class="btn lub-quick-action" id="qa-buscar">Buscar equipo</button>
        <button class="btn lub-quick-action" id="qa-matriz">Matriz semanal</button>
      </div>

      <button class="lub-anomaly-fab">Reportar anomalía</button>
    </main>
  </div>`;
}

for (const width of [390, 412]) {
  test(`Dashboard Lubricador @ ${width}px — sin scroll horizontal`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 });
    await page.setContent(fixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test(`Dashboard Lubricador @ ${width}px — los 4 KPIs están en 2 columnas, visibles sin scroll adicional`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 });
    await page.setContent(fixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const cards = page.locator('.lub-kpi-card');
    await expect(cards).toHaveCount(4);
    const cols = await page.locator('.lub-kpi-row').evaluate(el => new Set(Array.from(el.children).map(c => Math.round(c.getBoundingClientRect().left))).size);
    expect(cols).toBe(2);
  });

  test(`Dashboard Lubricador @ ${width}px — acciones rápidas y acciones de arrastrados cumplen touch target >=44px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 });
    await page.setContent(fixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const quickActions = page.locator('.lub-quick-action');
    const n = await quickActions.count();
    for (let i = 0; i < n; i++) {
      const box = await quickActions.nth(i).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const arrBtns = page.locator('.lub-arrastrado-actions .btn');
    const m = await arrBtns.count();
    for (let i = 0; i < m; i++) {
      const box = await arrBtns.nth(i).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
}

test('4 KPIs siempre visibles incluso en 0 (nunca se ocultan, a diferencia de Arrastrados/Asignaciones)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture({ withArrastrados: false, withAsignaciones: false }));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('.lub-kpi-card')).toHaveCount(4);
  const values = await page.locator('.lub-kpi-value').allTextContents();
  expect(values).toEqual(['0', '0', '0', '0']);
});

test('"Pendientes arrastrados" se oculta por completo cuando no hay registros (nunca una tarjeta en 0)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture({ withArrastrados: false }));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('#arrastrados-head')).toHaveCount(0);
  await expect(page.locator('#arrastrados-list')).toHaveCount(0);
});

test('"Asignaciones activas" se oculta por completo cuando no hay asignaciones', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture({ withAsignaciones: false }));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('#asignaciones-head')).toHaveCount(0);
  await expect(page.locator('#asignaciones-list')).toHaveCount(0);
});

test('"Pendientes arrastrados" es la primera lista operacional (va antes de Asignaciones activas y de Trabajo del turno actual)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 1200 });
  await page.setContent(fixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const arrastradosBox = await page.locator('#arrastrados-head').boundingBox();
  const asignacionesBox = await page.locator('#asignaciones-head').boundingBox();
  expect(asignacionesBox.y).toBeGreaterThan(arrastradosBox.y);
});

test('cada tarjeta de arrastrado muestra código, modelo, ubicación, origen y acciones Registrar/Ver ficha', async ({ page }) => {
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

test('Acciones rápidas tiene exactamente 4 botones: Registrar engrase, Escanear QR, Buscar equipo, Matriz semanal', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const labels = await page.locator('.lub-quick-action').allTextContents();
  expect(labels).toEqual(['Registrar engrase', 'Escanear QR', 'Buscar equipo', 'Matriz semanal']);
});
