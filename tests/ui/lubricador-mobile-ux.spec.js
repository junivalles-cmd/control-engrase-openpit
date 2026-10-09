// tests/ui/lubricador-mobile-ux.spec.js
//
// Lote "mobile UX real Android" — pruebas en teléfono Android real
// mostraron que el responsive del Lubricador seguía mal aunque Playwright
// 390/412 ya pasara en specs anteriores: esos specs medían fragmentos más
// simples que el shell real. Este spec reconstruye el shell COMPLETO
// (topbar con TODOS los controles reales que boot() genera hoy, no una
// versión reducida) para cada pantalla afectada, con la MISMA estructura/
// clases/texto reales de app.js — mismo método ya usado en
// lubricador-dashboard.spec.js. Ancho real de auditoría: 360/384/390/412.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const WIDTHS = [360, 384, 390, 412];

function topbar({ connText = 'SINCRONIZADO', connClass = 'conn-ok' } = {}) {
  return `
    <header class="lub-topbar">
      <div class="brand brand-sidebar">
        <div class="brand-mark small"></div>
        <div>
          <div class="brand-title small">ENGRASE</div>
          <div class="brand-sub small">OPEN PIT</div>
        </div>
      </div>
      <div class="lub-topbar-right">
        <div class="quick-find">
          <button type="button" id="quick-find-toggle" class="icon-btn quick-find-toggle" aria-label="Buscar equipo"><span class="btn-icon icon-search"></span></button>
          <input type="search" id="quick-find" placeholder="Buscar equipo (código)…" autocomplete="off"/>
        </div>
        <button type="button" id="btn-scan-qr-topbar" class="icon-btn" aria-label="Escanear QR de equipo"><span class="btn-icon icon-qr"></span></button>
        <button type="button" id="conn-badge" class="conn-badge ${connClass}" aria-label="${connText}" title="${connText}">${connText}</button>
        <button type="button" id="conn-badge-detail" class="icon-btn hidden" aria-label="Ver detalle del error de sincronización">ⓘ</button>
        <button type="button" class="icon-btn" id="btn-lub-account-menu" aria-label="Mi cuenta" title="Mi cuenta"><span class="btn-icon icon-gear"></span></button>
        <button class="icon-btn lub-logout-btn" id="btn-logout" title="Cerrar sesión"><span class="btn-icon icon-logout"></span><span class="lub-logout-text">Cerrar sesión</span></button>
      </div>
    </header>
    <div class="lub-user-strip">👤 Jose Guerrero · <span id="lub-shift">☀ Turno Día</span></div>`;
}

const bottomNav = `
    <nav class="lub-bottom-nav">
      <button class="lub-nav-item active" data-route="turno" aria-current="page"><span class="menu-icon icon-clock"></span><span>Mi Turno</span></button>
      <button class="lub-nav-item" data-route="anomalias"><span class="menu-icon icon-alert"></span><span>Anomalías</span></button>
      <button class="lub-nav-item" data-route="historial"><span class="menu-icon icon-history"></span><span>Mis Engrases</span></button>
      <button class="lub-nav-item" data-route="ayuda"><span class="menu-icon icon-help"></span><span>Ayuda</span></button>
    </nav>`;

function shell(contentHTML, topbarOpts) {
  return `<div class="lub-shell">${topbar(topbarOpts)}<main id="app-content" class="lub-content">${contentHTML}</main>${bottomNav}</div>`;
}

const MI_TURNO_CONTENT = `
      <div class="lub-context-row">
        <span class="lub-context-chip">☀ Turno Día</span>
        <span class="lub-context-chip">📍 Rajo Principal</span>
        <span class="lub-context-chip">👥 Cuadrilla A</span>
        <span class="lub-context-chip tone-green"><span class="dot"></span>Sincronizado</span>
      </div>
      <div class="lub-kpi-row">
        <div class="lub-kpi-card tone-neutral"><div class="lub-kpi-value">0</div><div class="lub-kpi-label">Vencidos por horas</div></div>
        <div class="lub-kpi-card tone-neutral"><div class="lub-kpi-value">3</div><div class="lub-kpi-label">Pendientes hoy</div></div>
        <div class="lub-kpi-card tone-neutral"><div class="lub-kpi-value">0</div><div class="lub-kpi-label">Arrastrados</div></div>
        <div class="lub-kpi-card tone-green"><div class="lub-kpi-value">2</div><div class="lub-kpi-label">Realizados hoy</div></div>
      </div>
      <div class="lub-section-head"><span class="dim">Trabajo del turno actual</span></div>
      <div class="lub-eq-list">
        <button class="lub-eq-btn" data-status="AMARILLO">
          <div class="lub-eq-top"><span class="lub-eq-code">T-09</span><span class="status-chip" style="--c:var(--amber)">PRÓXIMO</span></div>
          <div class="lub-eq-model">Komatsu WA470</div>
          <div class="lub-eq-location">📍 Rajo Principal</div>
          <div class="lub-eq-bottom"><span class="mono">900 h</span></div>
        </button>
      </div>`;

const SIN_CUADRILLA_CONTENT = `
      <div class="lub-empty-crew">
        <span class="btn-icon icon-users"></span>
        <h2>Sin cuadrilla autorizada</h2>
        <p>No tienes una cuadrilla asignada. Solicita autorización a un Administrador o Planificador.</p>
        <button class="lub-anomaly-fab" id="lub-fab-anomaly"><span class="btn-icon icon-alert"></span>Reportar anomalía</button>
      </div>`;

const MIS_ENGRASES_CONTENT = `
    <h2 class="lub-heading">Mis últimos engrases</h2>
    <div class="lub-record-list">
      <div class="lub-record-card">
        <div class="lub-eq-top"><span class="lub-eq-code">T-09</span><span class="dim">05/10/2026</span></div>
        <div class="lub-eq-model">Komatsu WA470</div>
        <div class="lub-eq-bottom"><span class="mono">905.0 h</span><span>Normal</span></div>
        <div class="lub-record-meta dim">
          <span>Turno Día</span>
          <span>2.5 lb</span>
          <span>Jose Guerrero</span>
        </div>
        <div class="lub-record-validacion">
          <span class="validation-badge">Pendiente</span>
          <button type="button" class="btn btn-sm lub-validar-btn">Validar</button>
        </div>
        <button class="btn btn-sm lub-edit-record" style="margin-top:8px; width:100%">✏ Editar este engrase</button>
      </div>
      <div class="lub-record-card">
        <div class="lub-eq-top"><span class="lub-eq-code">T-06</span><span class="dim">04/10/2026</span></div>
        <div class="lub-eq-model">Caterpillar D8T</div>
        <div class="lub-eq-bottom"><span class="mono">1200.0 h</span><span>Normal</span></div>
        <div class="lub-record-meta dim">
          <span>Turno Noche</span>
          <span>3.0 lb</span>
          <span>Jose Guerrero</span>
        </div>
        <div class="lub-record-validacion">
          <span class="validation-badge">Validado</span>
          <button type="button" class="btn btn-sm lub-ver-validacion-btn">Ver validación</button>
        </div>
        <div class="dim" style="margin-top:6px; font-size:11px">Solo se puede editar el mismo día que se registró.</div>
      </div>
    </div>`;

const AYUDA_CONTENT = `
    <div class="ayuda-page">
      <div class="panel">
        <div class="panel-head"><h3>Ayuda y soporte</h3></div>
        <div class="dim" style="padding:0 14px 14px">Consulta rápidamente cómo interpretar estados, registrar incidencias y trabajar sin conexión.</div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Guía de puntos de engrase por familia de equipo</h3></div>
        <div class="dim ayuda-guia-sub">Referencia visual por categoría de equipo.</div>
        <div class="ayuda-family-chips">
          <button type="button" class="ayuda-family-chip">Excavadoras</button>
          <button type="button" class="ayuda-family-chip">Camiones articulados</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Preguntas frecuentes</h3></div>
        <div class="ayuda-faq-list">
          <details class="faq-item"><summary>¿Qué significa el color rojo en un equipo?<span class="faq-chevron">›</span></summary><p>Indica que el engrase está vencido.</p></details>
          <details class="faq-item"><summary>¿Cómo reporto una anomalía?<span class="faq-chevron">›</span></summary><p>Desde el botón "Reportar anomalía".</p></details>
        </div>
      </div>
    </div>`;

async function setup(page, width, contentHTML, topbarOpts) {
  await page.setViewportSize({ width, height: 800 });
  await page.setContent(shell(contentHTML, topbarOpts));
  await page.addStyleTag({ path: STYLES_PATH });
}

async function noHorizontalOverflow(page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth, `scrollWidth (${scrollWidth}) no debe superar clientWidth (${clientWidth})`).toBeLessThanOrEqual(clientWidth);
}

for (const width of WIDTHS) {
  test.describe(`@ ${width}px`, () => {
    test('A) Mi Turno — topbar compacta, sin overflow horizontal real', async ({ page }) => {
      await setup(page, width, MI_TURNO_CONTENT);
      await noHorizontalOverflow(page);
      const topbarBox = await page.locator('.lub-topbar').boundingBox();
      // "Topbar compacta de una sola franja útil": menos de 72px de alto
      // (antes de este lote medía 82-83px reales a 390px).
      expect(topbarBox.height).toBeLessThan(72);
      await expect(page.locator('#btn-scan-qr-topbar')).toBeVisible();
      await expect(page.locator('#conn-badge')).toBeVisible();
      await expect(page.locator('#btn-logout')).toBeVisible();
    });

    test('B) Sin cuadrilla autorizada — título completo dentro del viewport, nunca cortado', async ({ page }) => {
      await setup(page, width, SIN_CUADRILLA_CONTENT);
      await noHorizontalOverflow(page);
      const box = await page.locator('.lub-empty-crew h2').boundingBox();
      expect(box.x, 'el título no debe arrancar antes del borde izquierdo del viewport').toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, 'el título no debe salirse por la derecha').toBeLessThanOrEqual(width);
      await expect(page.locator('.lub-empty-crew h2')).toHaveText('Sin cuadrilla autorizada');
      await expect(page.locator('.lub-empty-crew p')).toContainText('Solicita autorización a un Administrador o Planificador');
      // No debe ocupar casi toda la pantalla.
      const crewBox = await page.locator('.lub-empty-crew').boundingBox();
      expect(crewBox.height).toBeLessThan(400);
    });

    test('C) Mis Engrases — tarjetas compactas, caben dentro del viewport', async ({ page }) => {
      await setup(page, width, MIS_ENGRASES_CONTENT);
      await noHorizontalOverflow(page);
      const card = await page.locator('.lub-record-card').first().boundingBox();
      expect(card.x).toBeGreaterThanOrEqual(0);
      expect(card.x + card.width).toBeLessThanOrEqual(width);
      // Mantiene todos los datos requeridos.
      await expect(page.locator('.lub-record-card').first()).toContainText('T-09');
      await expect(page.locator('.lub-record-card').first()).toContainText('Komatsu WA470');
      await expect(page.locator('.lub-record-card').first()).toContainText('905.0 h');
      await expect(page.locator('.lub-record-card').first()).toContainText('Turno Día');
      await expect(page.locator('.lub-record-card').first()).toContainText('2.5 lb');
      await expect(page.locator('.lub-record-card').first()).toContainText('Validar');
      await expect(page.locator('.lub-record-card').first()).toContainText('Editar');
    });

    test('D) Ayuda — paneles compactos, sin overflow, títulos visibles', async ({ page }) => {
      await setup(page, width, AYUDA_CONTENT);
      await noHorizontalOverflow(page);
      const h3 = await page.locator('.panel-head h3').first().boundingBox();
      expect(h3.x + h3.width, 'el título del panel debe caber en el viewport').toBeLessThanOrEqual(width);
      await expect(page.locator('.panel-head h3').first()).toHaveText('Ayuda y soporte');
    });

    test('E) bottom nav — 4 opciones, cada una con objetivo táctil >=44px', async ({ page }) => {
      await setup(page, width, MI_TURNO_CONTENT);
      await noHorizontalOverflow(page);
      const items = page.locator('.lub-nav-item');
      await expect(items).toHaveCount(4);
      for (let i = 0; i < 4; i++) {
        const box = await items.nth(i).boundingBox();
        expect(box.height, `ítem ${i} de la barra inferior debe medir >=44px de alto`).toBeGreaterThanOrEqual(44);
      }
    });
  });
}
