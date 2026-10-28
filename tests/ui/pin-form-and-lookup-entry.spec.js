// tests/ui/pin-form-and-lookup-entry.spec.js
//
// Lote "consulta universal + formularios" — V/W del plan de pruebas:
// los botones de "Escanear QR" (topbar desktop + shell del Lubricador).
// (El bloque T/U, formulario de Configurar PIN rápido, se retiró en UX
// CAMPO V2 2026-10-24 junto con todo Quick Unlock — ver
// lubricador-session-safety.test.js.) Fixtures con la MISMA
// estructura/clases reales que boot()/bootLubricador() (app.js) — mismo
// método que table-responsive-p1.spec.js / config-desktop-grid.spec.js: no
// hay credenciales de prueba seguras para automatizar un login real
// (ver docs/UI_RESPONSIVE.md), así que se valida el marcado real tal cual
// lo genera el código fuente, con el styles.css real.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

// Topbar desktop: buscador (quick-find, ya existente) + nuevo botón de QR,
// misma fila que conn-badge/turno/usuario — mismo marcado real de boot().
const DESKTOP_TOPBAR_FIXTURE = `
<div class="app-shell">
  <header class="topbar">
    <button id="btn-menu-toggle" class="icon-btn only-mobile">☰</button>
    <div class="topbar-title" id="topbar-title">Dashboard</div>
    <div class="topbar-right">
      <div class="quick-find">
        <button type="button" id="quick-find-toggle" class="icon-btn quick-find-toggle" aria-label="Buscar equipo">🔍</button>
        <input type="search" id="quick-find" placeholder="Buscar equipo (código)…" autocomplete="off" aria-label="Buscar equipo por código"/>
        <div id="quick-find-results" class="quick-find-results hidden"></div>
      </div>
      <button type="button" id="btn-scan-qr-topbar" class="icon-btn" aria-label="Escanear QR de equipo" title="Escanear QR de equipo">▭</button>
      <button type="button" id="conn-badge" class="conn-badge" title="Tocar para sincronizar ahora"></button>
      <span class="topbar-shift" id="topbar-shift"></span>
      <span class="topbar-user">Ana Ruiz · ADMINISTRADOR</span>
    </div>
  </header>
</div>
`;

// Shell del Lubricador: mismo buscador + botón de QR en su topbar
// persistente — mismo marcado real de bootLubricador().
const LUB_TOPBAR_FIXTURE = `
<div class="lub-shell">
  <header class="lub-topbar">
    <div class="brand brand-sidebar">
      <div class="brand-mark small"></div>
      <div><div class="brand-title small">ENGRASE</div><div class="brand-sub small">OPEN PIT</div></div>
    </div>
    <div class="lub-topbar-right">
      <div class="quick-find">
        <button type="button" id="quick-find-toggle" class="icon-btn quick-find-toggle" aria-label="Buscar equipo">🔍</button>
        <input type="search" id="quick-find" placeholder="Buscar equipo (código)…" autocomplete="off" aria-label="Buscar equipo por código"/>
        <div id="quick-find-results" class="quick-find-results hidden"></div>
      </div>
      <button type="button" id="btn-scan-qr-topbar" class="icon-btn" aria-label="Escanear QR de equipo" title="Escanear QR de equipo">▭</button>
      <button type="button" id="conn-badge" class="conn-badge" title="Tocar para sincronizar ahora"></button>
      <!-- Fix 2026-10-09 ("CONFIGURACIÓN FINAL", §6): sin #btn-logout — ya
           no vive en el header, ver lubricador-mi-cuenta.spec.js. -->
      <button type="button" class="icon-btn" id="btn-lub-account-menu" aria-label="Mi cuenta" title="Mi cuenta">⚙</button>
    </div>
  </header>
</div>
`;

async function withStyles(page, html) {
  await page.setContent(`<div>${html}</div>`);
  await page.addStyleTag({ path: STYLES_PATH });
}

test.describe('Consulta universal — entrada de búsqueda/QR en topbar (desktop) y shell del Lubricador', () => {
  for (const [nombre, fixture] of [['desktop', DESKTOP_TOPBAR_FIXTURE], ['Lubricador', LUB_TOPBAR_FIXTURE]]) {
    test(`${nombre}: botón de QR con aria-label, tamaño táctil ≥44px, junto al buscador existente`, async ({ page }, testInfo) => {
      await withStyles(page, fixture);

      const qrBtn = page.locator('#btn-scan-qr-topbar');
      await expect(qrBtn).toBeVisible();
      await expect(qrBtn).toHaveAttribute('aria-label', 'Escanear QR de equipo');

      const box = await qrBtn.boundingBox();
      expect(box.width, `ancho táctil del botón QR en ${testInfo.project.name}`).toBeGreaterThanOrEqual(44);
      expect(box.height, `alto táctil del botón QR en ${testInfo.project.name}`).toBeGreaterThanOrEqual(44);

      await expect(page.locator('#quick-find')).toHaveAttribute('aria-label', 'Buscar equipo por código');

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, `overflow horizontal en ${testInfo.project.name}`).toBeLessThanOrEqual(clientWidth);
    });
  }
});
