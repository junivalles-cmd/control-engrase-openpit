import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const source = readSource(APP_JS_PATH);
const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const helpers = [
  '$', '$$', 'esc', 'TABLE_EMPTY_FILTER_VALUE', 'tableFilterOptionValue',
  'tableFilterSelection', 'tableFilterIsActive', 'tableFilterMatches',
  'tableFilterMatchesAny', 'tableFilterOptions', 'tableSortIndicatorMark',
  'tableSortButtonInnerHTML', 'renderTableColumnHeader', 'createTableColumnController',
].map(name => extractDeclaration(source, name)).join('\n\n');

async function boot(page) {
  await page.setContent(`
    <main id="host">
      <div class="toolbar plan-toolbar">
        <input class="input input-search" placeholder="Buscar equipos…">
        <button class="btn btn-accent" id="plan-matrix">Ver matriz semanal</button>
        <details class="plan-more-actions" open><summary class="btn">Más acciones <span>⋮</span></summary>
          <div class="plan-more-actions-menu"><button class="btn">Imprimir plan de la semana</button><button class="btn">Imprimir plan del mes</button><button class="btn">Configurar plan en lote</button></div>
        </details>
      </div>
      <div class="panel plan-table-panel" id="plan-table-wrap">
        <div class="panel-head table-section-title"><h3>Planes de engrase por equipo</h3></div>
        <table class="data-table mobile-operational-cards" id="plan-table"><thead><tr id="headers"></tr></thead><tbody>
          <tr><td class="mono mobile-card-code mobile-card-code-primary">T-01</td><td class="mono mobile-card-code mobile-card-code-secondary">05-18</td><td class="mobile-card-title">CATERPILLAR D9R</td><td>Día y turno de la semana</td><td>Mar, Jue, Sáb</td><td>Día</td><td>—</td><td>8</td><td class="mobile-card-actions"><button class="btn btn-sm">Configurar</button></td></tr>
        </tbody></table>
      </div>
      <div id="eq-mobile-shot"><div class="panel eq-table-panel" id="eq-table-wrap">
        <div class="panel-head table-section-title"><h3>Equipos</h3></div>
        <table class="data-table mobile-operational-cards" id="eq-table"><thead><tr id="eq-headers"></tr></thead><tbody>
          <tr><td class="mono mobile-card-code mobile-card-code-primary" data-label="Código ahorrativo">T-01</td><td class="mono mobile-card-code mobile-card-code-secondary" data-label="Código interno">05-18</td><td class="mobile-card-title" data-label="Equipo / Modelo">CATERPILLAR D9R</td><td data-label="Tipo">Tractor de Oruga</td><td data-label="Ubicación">Volcán</td><td data-label="Estado"><span class="status-chip">Programado hoy</span></td><td data-label="Horómetro">0 h</td><td data-label="Plan">Día y turno</td><td class="row-actions mobile-card-actions" data-label="Acciones"><button class="btn btn-sm">Ver</button><button class="btn btn-sm">Editar</button></td></tr>
        </tbody></table>
      </div></div>
    </main>`);
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({ content: `
    const sessionValues = new Map();
    Object.defineProperty(window, 'sessionStorage', { value: {
      getItem: key => sessionValues.has(key) ? sessionValues.get(key) : null,
      setItem: (key, value) => sessionValues.set(key, String(value)),
      removeItem: key => sessionValues.delete(key), clear: () => sessionValues.clear(),
    }});
    let activeTableColumnPopover = null;
    window.showInAppToast = () => {};
    ${helpers}
    const columns = [
      { key: 'shortCode', label: 'Código ahorrativo', filterType: 'text', options: () => ['T-01', 'T-02'] },
      { key: 'code', label: 'Código interno', filterType: 'text', options: () => ['05-18', '45-69'] },
      { key: 'model', label: 'Equipo / Modelo', filterType: 'text', options: () => ['CATERPILLAR D9R', 'KOMATSU PC200'] },
      { key: 'control', label: 'Control', filterType: 'select', options: () => ['Día y turno de la semana', 'Horómetro'] },
      { key: 'frequency', label: 'Frecuencia / Días', filterType: 'text', options: () => ['Mar, Jue, Sáb'] },
      { key: 'shift', label: 'Turnos', filterType: 'select', options: () => ['Día', 'Noche'] },
      { key: 'reference', label: 'Referencia', filterType: 'select', sortable: false, options: () => ['—'] },
      { key: 'points', label: 'Puntos', filterType: 'text', options: () => ['8'] },
      { key: 'actions', label: 'Configurar', sortable: false },
    ];
    const state = { sort: { field: 'code', dir: 'asc' }, filters: Object.fromEntries(columns.map(c => [c.key, []])) };
    const controller = createTableColumnController({ tableId: 'mobile-plan-test', columns, state, onChange: () => window.changes++ });
    document.querySelector('#headers').innerHTML = columns.map(c => controller.headerHTML(c)).join('');
    document.querySelectorAll('#plan-table tbody td').forEach((td, index) => td.dataset.label = columns[index]?.label || '');
    window.changes = 0; window.state = state; window.controller = controller;
    controller.bind(document.querySelector('#plan-table'));
    const eqColumns = [
      { key: 'shortCode', label: 'Código ahorrativo', filterType: 'text', options: () => ['T-01'] },
      { key: 'code', label: 'Código interno', filterType: 'text', options: () => ['05-18'] },
      { key: 'model', label: 'Equipo / Modelo', filterType: 'text', options: () => ['CATERPILLAR D9R'] },
      { key: 'type', label: 'Tipo', filterType: 'select', options: () => ['Tractor de Oruga'] },
      { key: 'location', label: 'Ubicación', filterType: 'select', options: () => ['Volcán'] },
      { key: 'status', label: 'Estado', filterType: 'select', options: () => ['Programado hoy'] },
      { key: 'hourmeter', label: 'Horómetro', filterType: 'text', options: () => ['0'] },
      { key: 'plan', label: 'Plan', filterType: 'select', options: () => ['Día y turno'] },
      { key: 'actions', label: 'Acciones', sortable: false },
    ];
    const eqState = { sort: { field: 'code', dir: 'asc' }, filters: Object.fromEntries(eqColumns.map(c => [c.key, []])) };
    const eqController = createTableColumnController({ tableId: 'mobile-equipment-test', columns: eqColumns, state: eqState, onChange: () => {} });
    document.querySelector('#eq-headers').innerHTML = eqColumns.map(c => eqController.headerHTML(c)).join('');
    eqController.bind(document.querySelector('#eq-table'));
    if (window.innerWidth <= 600) document.querySelector('.plan-more-actions').removeAttribute('open');
  ` });
}

test('móvil usa cards y un único panel con multiselección, orden, persistencia y reset', async ({ page }, testInfo) => {
  test.skip((testInfo.project.use.viewport?.width || 9999) > 600, 'Contrato móvil');
  await boot(page);
  await expect(page.locator('#plan-table thead')).toBeHidden();
  await expect(page.locator('.table-mobile-column-group')).toHaveCount(0);
  await expect(page.locator('#plan-table-wrap [data-table-mobile-open]')).toBeVisible();
  await expect(page.locator('#plan-table .mobile-card-title')).toHaveCSS('white-space', 'normal');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await page.locator('#plan-table-wrap [data-table-mobile-open]').click();
  await expect(page.locator('.table-mobile-sheet')).toBeVisible();
  await page.locator('[data-mobile-filter-section="code"] summary').click();
  const codeSection = page.locator('[data-mobile-filter-section="code"]');
  await codeSection.locator('[data-mobile-filter-all]').uncheck();
  await codeSection.locator('input[value="05-18"]').check();
  await page.locator('[data-table-mobile-sort]').selectOption('model');
  await page.locator('input[value="desc"]').check();
  await page.locator('[data-table-mobile-apply]').click();
  expect(await page.evaluate(() => window.state.filters.code)).toEqual(['05-18']);
  expect(await page.evaluate(() => window.state.sort)).toEqual({ field: 'model', dir: 'desc' });
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('engrase_table_state:mobile-plan-test')).columnFilters.code)).toEqual(['05-18']);
  await expect(page.locator('.table-mobile-filter-count')).toHaveText('1');

  await page.locator('#plan-table-wrap [data-table-mobile-open]').click();
  await page.locator('[data-table-mobile-reset]').click();
  expect(await page.evaluate(() => window.state.filters.code)).toEqual([]);
  expect(await page.evaluate(() => window.state.sort)).toEqual({ field: 'code', dir: 'asc' });
});

test('toolbar móvil compacta acciones y el sheet respeta el viewport', async ({ page }, testInfo) => {
  test.skip((testInfo.project.use.viewport?.width || 9999) > 600, 'Contrato móvil');
  await boot(page);
  await expect(page.locator('.plan-more-actions > summary')).toBeVisible();
  await page.locator('.plan-more-actions > summary').click();
  await expect(page.getByRole('button', { name: 'Configurar plan en lote' })).toBeVisible();
  await page.locator('.plan-more-actions > summary').click();
  await page.locator('#plan-table-wrap [data-table-mobile-open]').click();
  const sheet = await page.locator('.table-mobile-sheet').boundingBox();
  expect(sheet.height).toBeLessThanOrEqual((page.viewportSize()?.height || 0) * .86);
  await page.locator('[data-table-mobile-close]').click();
  await page.locator('#plan-table-wrap').screenshot({ path: testInfo.outputPath('plan-mobile.png') });
  await page.locator('#eq-mobile-shot').screenshot({ path: testInfo.outputPath('equipment-mobile.png') });
});

test('tablet y desktop conservan tabla, headers y funnels', async ({ page }, testInfo) => {
  test.skip((testInfo.project.use.viewport?.width || 0) <= 600, 'Contrato tablet/desktop');
  await boot(page);
  await expect(page.locator('#plan-table thead')).toBeVisible();
  await expect(page.locator('#plan-table [data-table-filter="code"]')).toBeVisible();
  await expect(page.locator('#plan-table-wrap [data-table-mobile-open]')).toBeHidden();
  await expect(page.locator('.plan-more-actions > summary')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Imprimir plan de la semana' })).toBeVisible();
  await page.locator('#plan-table-wrap').screenshot({ path: testInfo.outputPath('plan-table.png') });
  await page.locator('#eq-mobile-shot').screenshot({ path: testInfo.outputPath('equipment-table.png') });
});

test('código mantiene scope autorizado y no altera semana operativa', async () => {
  expect(source).toContain('locations.filter(location => authorizedLocationIds.has(location.id))');
  expect(source).toContain('getOperationalWeekDays');
  expect(source).not.toContain('productFlavors');
});
