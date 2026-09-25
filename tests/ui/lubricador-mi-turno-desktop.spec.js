// tests/ui/lubricador-mi-turno-desktop.spec.js
//
// UI/Composición visual — Lubricador → Mi Turno (docs/UI_VISUAL_COMPOSITION_AUDIT.md,
// UI-VIS-302). Único cambio de este lote: .lub-content:has(.lub-eq-list) (exclusivo
// de renderLubricadorHome), el botón de salir (.lub-logout-btn) y .lub-bottom-nav en
// desktop. No se tocó Ayuda/Anomalías/Mis Engrases/Registrar Engrase (Lubricador).
//
// No requiere login ni red: fragmento estático con la estructura/clases REALES de
// bootLubricador()/renderLubricadorHome() (app.js) — datos de relleno, nunca
// registros de producción.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

function miTurnoFixture(nEquipos = 4) {
  const cards = Array.from({ length: nEquipos }, (_, i) => `
    <button class="lub-eq-btn" data-status="VERDE" data-id="eq${i}">
      <div class="lub-eq-top"><span class="lub-eq-code">EQ-0${i}</span><span class="status-chip" style="--c:green">AL DÍA</span></div>
      <div class="lub-eq-model">Marca Modelo</div>
      <div class="lub-eq-location">📍 Rajo Principal</div>
      <div class="lub-eq-bottom"><span class="mono">1200.0 h</span><span class="mono">120 h restante</span></div>
    </button>`).join('');
  return `
  <div class="lub-shell">
    <header class="lub-topbar">
      <div class="brand brand-sidebar"><div class="brand-mark small"></div>
        <div><div class="brand-title small">ENGRASE</div><div class="brand-sub small">OPEN PIT</div></div></div>
      <div class="lub-topbar-right">
        <button type="button" id="conn-badge" class="conn-badge">EN LÍNEA</button>
        <button class="icon-btn lub-logout-btn" id="btn-logout" title="Cerrar sesión">🚪<span class="lub-logout-text">Cerrar sesión</span></button>
      </div>
    </header>
    <div class="lub-user-strip">Juan Pérez · ☀ Turno Día</div>
    <main id="app-content" class="lub-content">
      <div class="lub-header-row">
        <div><h2 class="lub-heading">Equipos asignados</h2><p class="lub-sub">Toca un equipo para registrar el engrase.</p></div>
        <button class="btn btn-accent lub-scan-btn" id="lub-scan-qr">Escanear QR</button>
      </div>
      <div class="lub-eq-list">${cards}</div>
      <button class="lub-anomaly-fab" id="lub-fab-anomaly">Reportar anomalía</button>
      <div class="color-legend">
        <span class="color-legend-item"><span class="dot"></span>Verde — al día</span>
        <span class="color-legend-item"><span class="dot"></span>Rojo — vencido</span>
      </div>
    </main>
    <nav class="lub-bottom-nav">
      <button class="lub-nav-item active" data-route="turno"><span>Mi Turno</span></button>
      <button class="lub-nav-item" data-route="anomalias"><span>Anomalías</span></button>
      <button class="lub-nav-item" data-route="historial"><span>Mis Engrases</span></button>
      <button class="lub-nav-item" data-route="ayuda"><span>Ayuda</span></button>
    </nav>
  </div>`;
}

// Referencia de NO-regresión: Ayuda (Lubricador) comparte .lub-content pero NO
// tiene .lub-eq-list — debe seguir topada en 560px, sin cambios de este lote.
const AYUDA_FIXTURE = `
<div class="lub-shell">
  <header class="lub-topbar"><div class="lub-topbar-right"><button class="icon-btn lub-logout-btn" id="btn-logout" title="Cerrar sesión">🚪<span class="lub-logout-text">Cerrar sesión</span></button></div></header>
  <main class="lub-content"><div class="panel"><div class="panel-head"><h3>Preguntas frecuentes</h3></div></div></main>
  <nav class="lub-bottom-nav">
    <button class="lub-nav-item"><span>Mi Turno</span></button>
    <button class="lub-nav-item active"><span>Ayuda</span></button>
  </nav>
</div>`;

const WIDTHS = [412, 768, 1366];

for (const width of WIDTHS) {
  test.describe(`Mi Turno @ ${width}px`, () => {
    test('sin scroll horizontal', async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(miTurnoFixture());
      await page.addStyleTag({ path: STYLES_PATH });
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });

    test('botón de salir cumple el mínimo táctil de 44px', async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(miTurnoFixture());
      await page.addStyleTag({ path: STYLES_PATH });
      const box = await page.locator('#btn-logout').boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    });

    test('texto "Cerrar sesión" visible solo desde 768px', async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(miTurnoFixture());
      await page.addStyleTag({ path: STYLES_PATH });
      const visible = await page.locator('.lub-logout-text').isVisible();
      expect(visible).toBe(width >= 768);
    });
  });
}

test('412px: 1 sola columna de equipos, igual que antes del fix', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 });
  await page.setContent(miTurnoFixture());
  await page.addStyleTag({ path: STYLES_PATH });
  const boxes = await page.locator('.lub-eq-btn').evaluateAll(els => els.slice(0, 2).map(el => el.getBoundingClientRect()));
  expect(Math.abs(boxes[1].x - boxes[0].x)).toBeLessThan(2);
  expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
});

test('768px: el grid decide columnas según el espacio real (auto-fill, sin límite de 560px)', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.setContent(miTurnoFixture());
  await page.addStyleTag({ path: STYLES_PATH });
  const contentBox = await page.locator('.lub-content').boundingBox();
  expect(contentBox.width).toBeGreaterThan(560);
  const boxes = await page.locator('.lub-eq-btn').evaluateAll(els => els.slice(0, 2).map(el => el.getBoundingClientRect()));
  // Con auto-fill/minmax(300px) y ~744px disponibles, deben quedar 2 columnas.
  expect(Math.abs(boxes[1].y - boxes[0].y)).toBeLessThan(2);
  expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
});

test('1366px: contenedor entre 1100-1200px, grid fijo de 2 columnas', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.setContent(miTurnoFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const contentBox = await page.locator('.lub-content').boundingBox();
  expect(contentBox.width).toBeGreaterThanOrEqual(1100);
  expect(contentBox.width).toBeLessThanOrEqual(1200);

  const cols = await page.locator('.lub-eq-list').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(cols).toBe(2);

  // Título+descripción a la izquierda, Escanear QR a la derecha, en la misma fila.
  const headingBox = await page.locator('.lub-heading').boundingBox();
  const scanBox = await page.locator('#lub-scan-qr').boundingBox();
  expect(Math.abs(headingBox.y - scanBox.y)).toBeLessThan(20);
  expect(scanBox.x).toBeGreaterThan(headingBox.x);

  // Reportar anomalía y la leyenda comparten el ancho del grid: mismo contenedor,
  // por eso su ancho es el de .lub-content menos su padding lateral (--sp-3 × 2).
  const fabBox = await page.locator('.lub-anomaly-fab').boundingBox();
  const listBox = await page.locator('.lub-eq-list').boundingBox();
  expect(Math.abs(fabBox.width - listBox.width)).toBeLessThan(4);

  // Bottom-nav: la barra sigue completa (fondo full-width) pero cada ítem ya no
  // se estira a lo ancho del monitor.
  const navBox = await page.locator('.lub-bottom-nav').boundingBox();
  expect(navBox.width).toBe(1366);
  const itemBox = await page.locator('.lub-nav-item').first().boundingBox();
  expect(itemBox.width).toBeLessThanOrEqual(170);
});

test('Ayuda (Lubricador) NO cambia: sigue topada en 560px a 1366px (sin .lub-eq-list)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.setContent(AYUDA_FIXTURE);
  await page.addStyleTag({ path: STYLES_PATH });
  const contentBox = await page.locator('.lub-content').boundingBox();
  expect(contentBox.width).toBe(560);
});
