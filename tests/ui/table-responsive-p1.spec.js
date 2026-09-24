// tests/ui/table-responsive-p1.spec.js
//
// UI/Responsive — LOTE P1 (docs/UI_RESPONSIVE_FULL_AUDIT.md). Regresión visual
// para UI-FULL-102 (Actualizar Horómetros) y UI-FULL-305 (Horómetros → preview
// de importación Excel, dentro de un modal). No requiere login: fragmentos
// estáticos con la estructura/clases REALES de renderHorometros()/
// handleHourmeterExcelImport() (app.js) — datos de relleno, nunca registros de
// producción. Carga la función REAL makeTablesResponsive() desde el código
// fuente (misma técnica que tests/helpers/extractFromSource.js) y la ejecuta
// en el navegador, para probar el mecanismo real, no una reimplementación.
//
// UI-FULL-103 (Configuración → Registro de auditoría) usa exactamente el mismo
// mecanismo .data-table + makeTablesResponsive() ya cubierto aquí — no se
// duplica un tercer fixture para la misma clase de bug.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

const appSource = readSource(APP_JS_PATH);
const MAKE_TABLES_RESPONSIVE_SRC = `
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  ${extractDeclaration(appSource, 'makeTablesResponsive')}
`;

const HOROMETROS_FIXTURE = `
<div class="app-content">
  <div class="toolbar">
    <button class="btn" id="hm-import">Importar horómetros desde Excel</button>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Actualización rápida de horómetros</h3></div>
    <table class="data-table">
      <thead><tr><th>Código</th><th>Equipo</th><th>Horómetro anterior</th><th>Horómetro actual</th><th></th></tr></thead>
      <tbody>
        <tr data-id="eq1">
          <td class="mono">T-06</td>
          <td>Caterpillar D8T</td>
          <td class="mono">12400.0 h</td>
          <td><input type="number" class="input input-sm hm-input" value="12480.5"/></td>
          <td><button class="btn btn-sm btn-accent hm-save">Guardar</button></td>
        </tr>
        <tr data-id="eq2">
          <td class="mono">EXC-02</td>
          <td>Komatsu PC200</td>
          <td class="mono">8900.0 h</td>
          <td><input type="number" class="input input-sm hm-input" value="8950.0"/></td>
          <td><button class="btn btn-sm btn-accent hm-save">Guardar</button></td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
`;

const IMPORT_MODAL_FIXTURE = `
<div id="modal-overlay" class="modal-overlay open">
  <div class="modal">
    <div class="modal-head"><h3>Importar horómetros (2 filas)</h3><button class="icon-btn" id="modal-close">✕</button></div>
    <div class="modal-body">
      <div style="max-height:40vh; overflow:auto; border:1px solid var(--border); border-radius:8px">
        <table class="data-table">
          <thead><tr><th>Código</th><th>Anterior</th><th>Nuevo</th><th>Estado</th></tr></thead>
          <tbody>
            <tr><td class="mono">T-06</td><td class="mono">12400.0 h</td><td class="mono">12480.5 h</td><td>OK</td></tr>
            <tr><td class="mono">EXC-02</td><td class="mono">8900.0 h</td><td class="mono">8950.0 h</td><td>OK</td></tr>
          </tbody>
        </table>
      </div>
      <div class="modal-actions"><button class="btn btn-accent" id="btn-confirm-hm">Aplicar actualización</button></div>
    </div>
  </div>
</div>
`;

test.describe('UI-FULL-102 — Actualizar Horómetros: tabla responsive', () => {
  test('labels visibles en móvil, sin scroll horizontal, botón Guardar accesible', async ({ page }, testInfo) => {
    await page.setContent(`<div class="app-shell">${HOROMETROS_FIXTURE}</div>`);
    await page.addStyleTag({ path: STYLES_PATH });
    await page.addScriptTag({ content: `${MAKE_TABLES_RESPONSIVE_SRC}\nmakeTablesResponsive(document.querySelector('.app-content'));` });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `scroll horizontal no deseado en ${testInfo.project.name}`).toBeLessThanOrEqual(clientWidth);

    const labels = await page.locator('tbody td').evaluateAll(tds => tds.map(td => td.getAttribute('data-label')));
    // 5 columnas × 2 filas — la última columna (botón) queda con data-label="" (th vacío en el
    // código real), el resto debe llevar el texto real del encabezado.
    expect(labels).toEqual([
      'Código', 'Equipo', 'Horómetro anterior', 'Horómetro actual', '',
      'Código', 'Equipo', 'Horómetro anterior', 'Horómetro actual', '',
    ]);

    const width = testInfo.project.use.viewport?.width;
    if (width && width <= 412) {
      // makeTablesResponsive() solo pone el atributo — la transformación visual a
      // tarjetas la hace el CSS existente (.data-table en @media max-width:680px),
      // sin tocar en este lote: confirmamos que YA se ve como tarjeta (thead oculto).
      await expect(page.locator('.data-table thead')).toBeHidden();
      const firstLabelVisible = await page.locator('tbody tr').first().locator('td[data-label="Código"]').first().evaluate(td => {
        return getComputedStyle(td, '::before').content;
      });
      expect(firstLabelVisible).toContain('Código');
    }

    await expect(page.locator('.hm-save').first()).toBeVisible();
  });
});

test.describe('UI-FULL-305 — Horómetros → preview de importación Excel (modal)', () => {
  test('modal dentro del viewport, tabla con labels, botón Aplicar accesible', async ({ page }, testInfo) => {
    await page.setContent(IMPORT_MODAL_FIXTURE);
    await page.addStyleTag({ path: STYLES_PATH });
    await page.addScriptTag({ content: `${MAKE_TABLES_RESPONSIVE_SRC}\nmakeTablesResponsive(document.querySelector('.modal-body'));` });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `scroll horizontal no deseado en ${testInfo.project.name}`).toBeLessThanOrEqual(clientWidth);

    const labels = await page.locator('.modal-body tbody td').evaluateAll(tds => tds.map(td => td.getAttribute('data-label')));
    expect(labels).toEqual([
      'Código', 'Anterior', 'Nuevo', 'Estado',
      'Código', 'Anterior', 'Nuevo', 'Estado',
    ]);

    // El modal completo (incluido su botón de acción) debe caber dentro del viewport.
    const modalBox = await page.locator('.modal').boundingBox();
    const viewport = page.viewportSize();
    expect(modalBox.y).toBeGreaterThanOrEqual(0);
    expect(modalBox.y + modalBox.height).toBeLessThanOrEqual(viewport.height + 1);

    await expect(page.locator('#btn-confirm-hm')).toBeVisible();
    await expect(page.locator('#modal-close')).toBeVisible();
  });
});
