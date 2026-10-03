// tests/ui/pin-form-and-lookup-entry.spec.js
//
// Lote "consulta universal + formularios" — T/U/V/W del plan de pruebas:
// formulario de Configurar/Cambiar PIN rápido (ahora con confirmación de
// PIN) y los nuevos botones de "Escanear QR" (topbar desktop + shell del
// Lubricador). Fixtures con la MISMA estructura/clases reales que
// offerQuickUnlockSetup()/quickUnlockConfigureModal() (app.js) — mismo
// método que table-responsive-p1.spec.js / config-desktop-grid.spec.js: no
// hay credenciales de prueba seguras para automatizar un login real
// (ver docs/UI_RESPONSIVE.md), así que se valida el marcado real tal cual
// lo genera el código fuente, con el styles.css real.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

// Misma estructura que offerQuickUnlockSetup() (app.js) tras el lote: PIN +
// Confirmar PIN lado a lado (form-grid), botón principal span-2, "Ahora no"
// secundario.
const PIN_SETUP_FIXTURE = `
<div class="login-screen">
  <div class="login-card">
    <div class="brand brand-login">
      <div class="brand-mark"></div>
      <div><div class="brand-title">CONTROL DE ENGRASE</div><div class="brand-sub">OPEN PIT · GESTIÓN DE LUBRICACIÓN</div></div>
    </div>
    <p class="login-hint">¿Configurar un PIN rápido (4 o 6 dígitos) para entrar sin escribir tu contraseña cada vez, incluso sin Internet?</p>
    <form id="quick-unlock-setup-form" class="form-grid">
      <label>PIN<input required name="pin" inputmode="numeric" pattern="\\d{4}|\\d{6}" autocomplete="off" maxlength="6"/></label>
      <label>Confirmar PIN<input required name="pinConfirm" inputmode="numeric" pattern="\\d{4}|\\d{6}" autocomplete="off" maxlength="6"/></label>
      <div id="quick-unlock-setup-error" class="login-error span-2"></div>
      <button type="submit" class="btn btn-accent span-2">Configurar PIN</button>
    </form>
    <button type="button" id="quick-unlock-setup-skip" class="btn">Ahora no</button>
  </div>
</div>
`;

// Misma estructura que quickUnlockConfigureModal() (app.js) tras el lote.
const PIN_MODAL_FIXTURE = `
<div id="modal-overlay" class="modal-overlay open">
  <div class="modal">
    <div class="modal-head"><h3>Configurar PIN rápido</h3><button class="icon-btn" id="modal-close" aria-label="Cerrar">✕</button></div>
    <div class="modal-body">
      <p class="dim" style="margin-top:-4px">PIN de 4 o 6 dígitos para desbloquear este dispositivo sin escribir tu contraseña. Nunca reemplaza tu rol ni tus permisos.</p>
      <form id="quick-unlock-modal-form" class="form-grid">
        <label>PIN<input required name="pin" inputmode="numeric" pattern="\\d{4}|\\d{6}" autocomplete="off" maxlength="6"/></label>
        <label>Confirmar PIN<input required name="pinConfirm" inputmode="numeric" pattern="\\d{4}|\\d{6}" autocomplete="off" maxlength="6"/></label>
        <div id="quick-unlock-modal-error" class="login-error span-2"></div>
        <div class="modal-actions span-2"><button type="submit" class="btn btn-accent">Guardar</button></div>
      </form>
    </div>
  </div>
</div>
`;

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
      <button class="icon-btn lub-logout-btn" id="btn-logout" title="Cerrar sesión">⎋<span class="lub-logout-text">Cerrar sesión</span></button>
    </div>
  </header>
</div>
`;

async function withStyles(page, html) {
  await page.setContent(`<div>${html}</div>`);
  await page.addStyleTag({ path: STYLES_PATH });
}

test.describe('T/U) Formulario "Configurar PIN rápido" — responsive + jerarquía de botones', () => {
  for (const [nombre, fixture] of [['pantalla completa (login)', PIN_SETUP_FIXTURE], ['modal (desde Configuración)', PIN_MODAL_FIXTURE]]) {
    test(`${nombre}: labels visibles, confirmación de PIN presente, sin overflow, botón principal destacado`, async ({ page }, testInfo) => {
      await withStyles(page, fixture);

      // W) labels accesibles — nunca solo placeholder.
      const labels = await page.locator('label').allTextContents();
      expect(labels.some(l => l.includes('PIN') && !l.includes('Confirmar'))).toBe(true);
      expect(labels.some(l => l.includes('Confirmar PIN'))).toBe(true);

      // V) botón principal (.btn-accent) visualmente dominante vs. secundario (.btn simple).
      const principal = page.locator('.btn-accent');
      await expect(principal).toBeVisible();
      const principalBg = await principal.evaluate(el => getComputedStyle(el).backgroundColor);
      expect(principalBg).not.toBe('rgba(0, 0, 0, 0)'); // tiene fondo propio, no transparente como un .btn plano

      // U) sin overflow horizontal en ningún ancho configurado.
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, `overflow horizontal en ${testInfo.project.name}`).toBeLessThanOrEqual(clientWidth);

      // Ambos campos de PIN presentes (confirmación agregada en este lote).
      await expect(page.locator('input[name="pin"]')).toHaveCount(1);
      await expect(page.locator('input[name="pinConfirm"]')).toHaveCount(1);
    });
  }
});

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
