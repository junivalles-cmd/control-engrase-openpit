// tests/ui/dashboard-table-density.spec.js
//
// UI-ANDROID-005 / UI-RESP-001 (docs/UI_RESPONSIVE.md) — verifica que las
// columnas marcadas .col-secondary del panel "Equipos que requieren
// atención" (renderDashboard(), app.js) se oculten SOLO en la tarjeta
// móvil (≤680px) y sigan visibles en escritorio. No requiere login: usa
// un fragmento estático con la MISMA estructura real de #att-table (9
// columnas, mismas clases) contra el styles.css real — texto de relleno,
// nunca datos reales de equipos/producción.

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const SCREENSHOT_DIR = path.resolve('tests/ui/screenshots-audit');

// Misma estructura que genera drawAttentionTable() en app.js — 9 columnas,
// 4 mantenidas (Estado/Código/Equipo/Restante) + 5 con class="col-secondary".
const FIXTURE_HTML = `
  <div class="panel" id="dash-attention-panel">
    <div class="panel-head"><h3>Equipos que requieren atención</h3></div>
    <table class="data-table" id="att-table">
      <thead><tr>
        <th>Estado</th><th>Código</th><th>Equipo</th>
        <th class="col-secondary">Turno</th><th class="col-secondary">Control</th>
        <th class="col-secondary">Horómetro</th><th class="col-secondary">Próximo / Día asignado</th>
        <th>Restante / Atraso</th><th class="col-secondary">Días sin engrase</th>
      </tr></thead>
      <tbody>
        <tr>
          <td data-label="Estado"><span class="dot"></span> VENCIDO</td>
          <td class="mono" data-label="Código">EQ-0001</td>
          <td data-label="Equipo">Marca Modelo</td>
          <td class="col-secondary" data-label="Turno">Día</td>
          <td class="col-secondary" data-label="Control">Por horas</td>
          <td class="mono col-secondary" data-label="Horómetro">1234 h</td>
          <td class="mono col-secondary" data-label="Próximo / Día asignado">1500 h</td>
          <td class="mono" data-label="Restante / Atraso">+50 h atraso</td>
          <td class="mono col-secondary" data-label="Días sin engrase">12 día(s)</td>
        </tr>
      </tbody>
    </table>
  </div>
`;

test('panel de atención: columnas secundarias ocultas solo en móvil, visibles en escritorio', async ({ page }, testInfo) => {
  await page.setContent(FIXTURE_HTML);
  await page.addStyleTag({ path: STYLES_PATH });

  const width = testInfo.project.use.viewport.width;
  const isMobileCard = width <= 680;

  const secondaryDisplay = await page.evaluate(() => {
    const td = document.querySelector('#att-table td.col-secondary');
    return getComputedStyle(td).display;
  });
  const keptDisplay = await page.evaluate(() => {
    const td = document.querySelector('#att-table td[data-label="Restante / Atraso"]');
    return getComputedStyle(td).display;
  });

  if (isMobileCard) {
    expect(secondaryDisplay, `col-secondary debe estar oculto en ${width}px (tarjeta móvil)`).toBe('none');
  } else {
    expect(secondaryDisplay, `col-secondary debe seguir visible en ${width}px (tabla desktop)`).not.toBe('none');
  }
  expect(keptDisplay, 'la columna Restante/Atraso nunca debe ocultarse').not.toBe('none');

  // Confirma que la última celda VISIBLE (Restante/Atraso en móvil) no arrastra el
  // borde inferior "huérfano" que dejaría :last-child al quedar detrás de celdas
  // ocultas por .col-secondary (ver comentario en styles.css).
  if (isMobileCard) {
    const keptBorderWidth = await page.evaluate(() => {
      const td = document.querySelector('#att-table td[data-label="Restante / Atraso"]');
      return getComputedStyle(td).borderBottomWidth;
    });
    expect(keptBorderWidth, 'Restante/Atraso no debería tener borde inferior al ser la última celda visible').toBe('0px');
  }

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `scroll horizontal no deseado en ${width}px`).toBeLessThanOrEqual(clientWidth);

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${testInfo.project.name}-dashboard-table-fixture.png`), fullPage: true });
});
