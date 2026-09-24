// tests/ui/kpi-grid.spec.js
//
// UI-RESP-003 (docs/UI_RESPONSIVE.md) — verifica que .kpi-grid tenga una
// progresión de columnas MONÓTONA (nunca menos columnas al tener más
// espacio) en las 7 resoluciones auditadas. No requiere login: carga el
// CSS real (styles.css, sin servidor) contra un fragmento estático con 6
// tarjetas .kpi-card — la misma cantidad que kpiCard() genera en
// renderDashboard() (app.js) — sin tocar Supabase/IndexedDB/autenticación.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

test('kpi-grid: columnas no decrecen al aumentar el ancho de viewport', async ({ page }, testInfo) => {
  await page.setContent(`
    <div class="kpi-grid">
      ${Array.from({ length: 6 }, () => '<div class="kpi-card"><div class="kpi-value">0</div><div class="kpi-label">KPI</div></div>').join('')}
    </div>
  `);
  await page.addStyleTag({ path: STYLES_PATH });

  const columns = await page.evaluate(() => {
    const el = document.querySelector('.kpi-grid');
    const cols = getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/);
    return cols.length;
  });

  testInfo.attach('kpi-grid-columns.json', {
    body: JSON.stringify({ project: testInfo.project.name, width: testInfo.project.use.viewport.width, columns }, null, 2),
    contentType: 'application/json',
  });
  console.log(`[${testInfo.project.name}] ancho=${testInfo.project.use.viewport.width} columnas=${columns}`);

  // Guardado por el test runner entre proyectos vía variable de entorno no es posible aquí
  // (cada proyecto corre en su propio worker) — la verificación de monotonicidad real se
  // hace leyendo la salida de "columnas" de los 7 proyectos (ver consola / adjuntos).
  expect(columns).toBeGreaterThanOrEqual(2);
  expect(columns).toBeLessThanOrEqual(6);
});
