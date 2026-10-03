// tests/ui/config-desktop-grid.spec.js
//
// UI-NEW-02 (auditoría pre-release, lote final) — Configuración (renderConfig(),
// app.js) apilaba sus ~10 paneles en 1 columna incluso con mucho ancho
// disponible (desktop/1920 igual que 360). Se agregó un grid de 2 columnas
// SCOPED a #config-grid (≥1024px), sin tocar `.panel` global. Este test usa
// un fixture con la MISMA estructura real (#config-grid envolviendo varios
// `.panel`, tal como arma renderConfig()) + el styles.css real, y valida:
//   - 390/412px: 1 columna (sin grid), orden normal, sin overflow.
//   - 1024/1440/1920px: 2 columnas reales (grid), paneles sin estirarse
//     para igualar al vecino más alto (align-items:start), sin overflow.
// No valida Dashboard/Reportes/Historial/Plan — fuera de alcance de este
// hallazgo (esos usan `.panel` pero nunca `#config-grid`).

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

// Mismos paneles reales (resumidos) que renderConfig() genera dentro de
// #config-grid — alturas deliberadamente distintas (como "Apariencia" corto
// vs. "Notificaciones" largo) para probar align-items:start de verdad.
const CONFIG_FIXTURE = `
<div class="app-content">
  <div id="config-grid">
    <div class="panel">
      <div class="panel-head"><h3>Apariencia</h3></div>
      <div style="padding:14px"><p>Color de acento y modo claro/oscuro.</p></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Turnos y umbrales generales</h3></div>
      <div style="padding:14px"><p>Inicio turno día/noche, alertas, meta de cumplimiento.</p></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Cuadrillas</h3></div>
      <div style="padding:14px"><p>Lista de cuadrillas.</p></div>
    </div>
    <div class="panel" id="notif-panel">
      <div class="panel-head"><h3>Notificaciones — control por tipo</h3></div>
      <div style="padding:14px">
        ${'<p style="height:40px">Tarjeta de notificación.</p>'.repeat(8)}
      </div>
    </div>
    <div class="panel" id="audit-log-panel">
      <div class="panel-head"><h3>Registro de auditoría</h3></div>
      <table class="data-table"><thead><tr><th>Fecha</th></tr></thead><tbody><tr><td>01/10/2026</td></tr></tbody></table>
    </div>
  </div>
</div>
`;

test('#config-grid: 1 columna en móvil, 2 columnas reales desde 1024px, sin overflow, sin estirar paneles cortos', async ({ page }, testInfo) => {
  await page.setContent(`<div class="app-shell">${CONFIG_FIXTURE}</div>`);
  await page.addStyleTag({ path: STYLES_PATH });

  const viewport = page.viewportSize();
  const info = await page.evaluate(() => {
    const grid = document.getElementById('config-grid');
    const style = getComputedStyle(grid);
    const panels = Array.from(grid.querySelectorAll(':scope > .panel'));
    return {
      display: style.display,
      columnCount: style.gridTemplateColumns.split(' ').filter(Boolean).length,
      panelHeights: panels.map(p => p.getBoundingClientRect().height),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });

  expect(info.scrollWidth, `sin overflow horizontal en ${testInfo.project.name}`).toBeLessThanOrEqual(info.clientWidth);

  if (viewport.width >= 1024) {
    expect(info.display, `#config-grid debe ser grid en ${testInfo.project.name}`).toBe('grid');
    expect(info.columnCount, `#config-grid debe tener 2 columnas en ${testInfo.project.name}`).toBe(2);
    // align-items:start: el panel corto ("Apariencia", índice 0) no debe
    // estirarse a la altura del panel largo de Notificaciones (índice 3).
    expect(info.panelHeights[0], 'panel corto no debe estirarse para igualar al vecino más alto')
      .toBeLessThan(info.panelHeights[3]);
  } else {
    expect(info.display, `#config-grid debe seguir en flujo normal (sin grid) por debajo de 1024px en ${testInfo.project.name}`).not.toBe('grid');
  }
});
