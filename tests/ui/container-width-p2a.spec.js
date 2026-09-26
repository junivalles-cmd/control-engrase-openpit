// tests/ui/container-width-p2a.spec.js
//
// UI/Responsive — LOTE P2-A (docs/UI_RESPONSIVE_FULL_AUDIT.md): UI-FULL-105
// (Anomalías, vista Lubricador), UI-FULL-109 (Mis Engrases, Lubricador) y
// UI-FULL-304 (Configuración — paneles apilados en desktop). No requiere
// login: fragmentos estáticos con la estructura/clases REALES de
// renderAnomalias()/renderLubricadorHistorial()/renderConfig() (app.js) —
// datos de relleno, nunca registros de producción.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

const ANOMALIAS_LUB_FIXTURE = `
<div class="lub-shell">
  <main class="lub-content">
    <div class="toolbar">
      <select class="input"><option>Todos los estados</option></select>
      <button class="btn btn-accent">Nueva anomalía</button>
    </div>
    <div class="panel">
      <table class="data-table" id="anom-table">
        <thead><tr><th>Criticidad</th><th>Equipo</th><th>Componente</th><th>Descripción</th><th>Fecha</th><th>Responsable</th><th>Estado</th><th>Foto</th><th></th></tr></thead>
        <tbody>
          <tr><td>Alta</td><td>T-06</td><td>Motor</td><td>Fuga de aceite</td><td>24/09/2026</td><td>Juan</td><td>Abierta</td><td>—</td><td><button class="btn btn-sm">Editar</button></td></tr>
        </tbody>
      </table>
    </div>
  </main>
</div>
`;

const MIS_ENGRASES_FIXTURE = `
<div class="lub-shell">
  <main class="lub-content">
    <h2 class="lub-heading">Mis últimos engrases</h2>
    <div class="lub-record-list">
      ${Array.from({ length: 4 }, (_, i) => `
        <div class="lub-record-card">
          <div class="lub-eq-top"><span class="lub-eq-code">EQ-000${i}</span><span class="dim">24/09/2026</span></div>
          <div class="lub-eq-model">Marca Modelo</div>
          <div class="lub-eq-bottom"><span class="mono">1200.0 h</span><span>Normal</span></div>
        </div>`).join('')}
    </div>
  </main>
</div>
`;

const CONFIG_FIXTURE = `
<div class="app-shell">
  <main class="app-content">
    <div class="panel"><div class="panel-head"><h3>Apariencia</h3></div><div style="padding:14px">Corto</div></div>
    <div class="panel"><div class="panel-head"><h3>Turnos y umbrales generales</h3></div><div style="padding:14px">Formulario corto</div></div>
    <div class="panel" data-simple-store="cuadrillas"><div class="panel-head"><h3>Cuadrillas</h3></div><div style="padding:14px">Lista corta</div></div>
    <div class="panel" data-simple-store="locations"><div class="panel-head"><h3>Ubicaciones</h3></div><div style="padding:14px">Lista corta</div></div>
    <div class="panel" id="notif-panel"><div class="panel-head"><h3>Notificaciones — control por tipo</h3></div><div style="padding:14px; min-height:200px">6 tarjetas de aviso</div></div>
    <div class="panel"><div class="panel-head"><h3>Sincronización</h3></div><div style="padding:14px">2 campos</div></div>
    <div class="panel" id="audit-log-panel">
      <div class="panel-head"><h3>Registro de auditoría</h3></div>
      <table class="data-table"><thead><tr><th>Fecha</th><th>Acción</th><th>Detalle</th><th>Usuario</th></tr></thead>
        <tbody><tr><td>24/09/2026</td><td>LOGIN</td><td>Detalle</td><td>admin</td></tr></tbody>
      </table>
    </div>
  </main>
</div>
`;

test.describe('UI-FULL-105 — Anomalías (Lubricador): ancho de contenedor', () => {
  test('sin límite de 560px, sin scroll horizontal, en todos los anchos', async ({ page }, testInfo) => {
    await page.setContent(ANOMALIAS_LUB_FIXTURE);
    await page.addStyleTag({ path: STYLES_PATH });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `scroll horizontal no deseado en ${testInfo.project.name}`).toBeLessThanOrEqual(clientWidth);

    const width = testInfo.project.use.viewport?.width;
    const panelBox = await page.locator('.lub-content').boundingBox();
    if (width && width >= 768 && width < 1400) {
      // Ya no debe estar pegado al viejo límite de 560px.
      expect(panelBox.width).toBeGreaterThan(560);
    }
    if (width && width >= 1400) {
      expect(panelBox.width).toBeLessThanOrEqual(1500);
    }
  });
});

test.describe('UI-FULL-109 — Mis Engrases (Lubricador): grid de tarjetas', () => {
  test('1 columna en móvil, 2+ desde 768px, sin scroll horizontal', async ({ page }, testInfo) => {
    await page.setContent(MIS_ENGRASES_FIXTURE);
    await page.addStyleTag({ path: STYLES_PATH });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `scroll horizontal no deseado en ${testInfo.project.name}`).toBeLessThanOrEqual(clientWidth);

    const cards = await page.locator('.lub-record-card').all();
    const box0 = await cards[0].boundingBox();
    const box1 = await cards[1].boundingBox();
    const width = testInfo.project.use.viewport?.width;

    if (width && width <= 412) {
      // Apiladas: la segunda tarjeta empieza más abajo, en el mismo borde izquierdo.
      expect(box1.y).toBeGreaterThan(box0.y);
      expect(Math.abs(box1.x - box0.x)).toBeLessThan(2);
    } else if (width && width >= 768) {
      // En grid: la segunda tarjeta queda a la derecha de la primera, misma fila.
      expect(Math.abs(box1.y - box0.y)).toBeLessThan(2);
      expect(box1.x).toBeGreaterThan(box0.x);
    }
  });
});

test.describe('UI-FULL-304 — Configuración: paneles en desktop', () => {
  test('1 columna hasta 1023px, grid de 2 columnas desde 1024px, paneles grandes a todo el ancho', async ({ page }, testInfo) => {
    await page.setContent(CONFIG_FIXTURE);
    await page.addStyleTag({ path: STYLES_PATH });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `scroll horizontal no deseado en ${testInfo.project.name}`).toBeLessThanOrEqual(clientWidth);

    const width = testInfo.project.use.viewport?.width;
    const panels = await page.locator('.app-content > .panel').all();
    const p0 = await panels[0].boundingBox(); // Apariencia
    const p1 = await panels[1].boundingBox(); // Turnos y umbrales
    const notifPanel = await page.locator('#notif-panel').boundingBox();
    const auditPanel = await page.locator('#audit-log-panel').boundingBox();
    const appContentBox = await page.locator('.app-content').boundingBox();

    if (width && width <= 1023) {
      // 1 columna: cada panel ocupa el ancho completo, apilados verticalmente.
      expect(p1.y).toBeGreaterThan(p0.y);
      expect(Math.abs(p1.width - p0.width)).toBeLessThan(2);
    } else {
      // Desktop (≥1024): Apariencia y Turnos comparten fila (2 columnas)...
      expect(Math.abs(p0.y - p1.y)).toBeLessThan(2);
      expect(p1.x).toBeGreaterThan(p0.x);
      // ...pero Notificaciones y Auditoría ocupan TODO el ancho del contenedor.
      expect(notifPanel.width).toBeGreaterThan(p0.width * 1.8);
      expect(auditPanel.width).toBeGreaterThan(p0.width * 1.8);
    }
  });
});
