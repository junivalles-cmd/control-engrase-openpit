// Encabezados de tabla: cobertura de la infraestructura real reutilizada por
// Plan de Engrase. No carga datos ni lógica operativa del plan.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const source = readSource(APP_JS_PATH);
const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const helpers = ['$', '$$', 'esc', 'TABLE_EMPTY_FILTER_VALUE', 'tableFilterOptionValue', 'tableFilterSelection', 'tableFilterIsActive', 'tableFilterMatches', 'tableFilterMatchesAny', 'tableFilterOptions', 'renderTableColumnHeader', 'createTableColumnController', 'tableColumnKey', 'tableComparableValue', 'standardizeDataTable']
  .map(name => extractDeclaration(source, name)).join('\n\n');

async function boot(page) {
  await page.setContent('<main id="host"></main>');
  await page.addScriptTag({ content: `
    const sessionValues = new Map();
    Object.defineProperty(window, 'sessionStorage', { value: {
      getItem: key => sessionValues.has(key) ? sessionValues.get(key) : null,
      setItem: (key, value) => sessionValues.set(key, String(value)),
      removeItem: key => sessionValues.delete(key),
      clear: () => sessionValues.clear(),
    }});
    let activeTableColumnPopover = null;
    ${helpers}
    const state = { sort: { field: 'code', dir: 'asc' }, filters: { code: [], control: [] } };
    const columns = [
      { key: 'code', label: 'Código interno', filterType: 'text', options: () => [{ value: '20-10', label: '20-10' }, { value: '45-69', label: '45-69' }, { value: '50-1', label: '50-1' }] },
      { key: 'control', label: 'Control', filterType: 'select', options: () => [{ value: 'horas', label: 'Por horas' }, { value: 'dias', label: 'Por días' }] },
      { key: 'actions', label: 'Configurar', sortable: false }
    ];
    window.changes = 0;
    window.controller = createTableColumnController({ tableId: 'plan-test', columns, state, onChange: () => window.changes++ });
    window.controller.restore();
    document.querySelector('#host').innerHTML = '<table><thead><tr>' + columns.map(c => window.controller.headerHTML(c)).join('') + '</tr></thead></table>';
    window.controller.bind(document.querySelector('table'));
    window.state = state;
  ` });
}

test('orden alterna ASC/DESC, expone aria-sort y persiste por tabla', async ({ page }) => {
  await boot(page);
  const code = page.locator('[data-table-sort="code"]');
  await code.click();
  await expect(page.locator('th[data-column-key="code"]')).toHaveAttribute('aria-sort', 'descending');
  await code.click();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('engrase_table_state:plan-test')).sortDirection)).toBe('asc');
  expect(await page.evaluate(() => window.changes)).toBe(2);
});

test('filtro multiselección se aplica, muestra contador y se puede limpiar', async ({ page }) => {
  await boot(page);
  await page.locator('[data-table-filter="code"]').click();
  await page.locator('[data-table-filter-all]').uncheck();
  await page.locator('.table-column-filter-option input[value="20-10"]').check();
  await page.locator('.table-column-filter-option input[value="45-69"]').check();
  await page.locator('[data-table-filter-apply]').click();
  expect(await page.evaluate(() => window.state.filters.code)).toEqual(['20-10', '45-69']);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('engrase_table_state:plan-test')).columnFilters.code)).toEqual(['20-10', '45-69']);
  await expect(page.locator('[data-table-filter="code"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-table-filter="code"] .table-column-filter-count')).toHaveText('2');
  await expect(page.locator('[data-table-filter="code"] svg')).toHaveCount(1);
  await page.locator('[data-table-filter="code"]').click();
  await page.locator('[data-table-filter-clear]').click();
  expect(await page.evaluate(() => window.state.filters.code)).toEqual([]);
});

test('filtro ofrece valores reales y la búsqueda limita la selección visible', async ({ page }) => {
  await boot(page);
  await page.locator('[data-table-filter="code"]').click();
  await expect(page.locator('.table-column-filter-option span')).toHaveText(['20-10', '45-69', '50-1']);
  await page.locator('[data-table-filter-all]').uncheck();
  await page.locator('.table-column-filter-input').fill('45');
  await expect(page.locator('.table-column-filter-option:not([hidden]) span')).toHaveText(['45-69']);
  await page.locator('[data-table-filter-select-all]').click();
  await page.locator('[data-table-filter-apply]').click();
  expect(await page.evaluate(() => window.state.filters.code)).toEqual(['45-69']);
});

test('Todos y Seleccionar todo restauran el conjunto completo sin filtro activo', async ({ page }) => {
  await boot(page);
  await page.locator('[data-table-filter="code"]').click();
  await page.locator('[data-table-filter-all]').uncheck();
  await page.locator('.table-column-filter-input').fill('20');
  await page.locator('[data-table-filter-select-all]').click();
  await page.locator('.table-column-filter-input').fill('');
  await page.locator('[data-table-filter-select-all]').click();
  await page.locator('[data-table-filter-apply]').click();
  expect(await page.evaluate(() => window.state.filters.code)).toEqual([]);
  await expect(page.locator('[data-table-filter="code"]')).not.toHaveClass(/is-active/);
});

test('valores vacíos y guion se normalizan como opción Sin dato', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => tableFilterOptions(['A', '', null, '—']))).toEqual([
    { value: 'A', label: 'A' },
    { value: '__table_empty__', label: 'Sin dato' },
  ]);
  expect(await page.evaluate(() => tableFilterMatches(['__table_empty__'], null))).toBe(true);
});

test('popover se cierra con Escape y clic fuera', async ({ page }) => {
  await boot(page);
  await page.locator('[data-table-filter="code"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.table-column-popover')).toHaveCount(0);
  await page.locator('[data-table-filter="code"]').click();
  await page.locator('#host').click({ position: { x: 1, y: 1 } });
  await expect(page.locator('.table-column-popover')).toHaveCount(0);
});

test('filtro select y acción no ordenable tienen semántica correcta', async ({ page }) => {
  await boot(page);
  await page.locator('[data-table-filter="control"]').click();
  await page.locator('[data-table-filter-all]').uncheck();
  await page.locator('.table-column-filter-option input[value="horas"]').check();
  await page.locator('[data-table-filter-apply]').click();
  expect(await page.evaluate(() => window.state.filters.control)).toEqual(['horas']);
  await expect(page.locator('th[data-column-key="actions"] [data-table-sort]')).toHaveCount(0);
  await expect(page.locator('th[data-column-key="actions"] [data-table-filter]')).toHaveCount(0);
});

test('restablecer limpia filtros sin mutar las filas fuente', async ({ page }) => {
  await boot(page);
  const sourceRows = [{ code: '20-1' }, { code: '20-2' }];
  await page.evaluate(rows => { window.sourceRows = rows; window.state.filters.code = ['20-1']; window.controller.reset(); }, sourceRows);
  expect(await page.evaluate(() => window.state.filters.code)).toEqual([]);
  expect(await page.evaluate(() => window.sourceRows)).toEqual(sourceRows);
});

test('Equipos limita Tipo y Ubicación al dataset autorizado', async () => {
  expect(source).toContain('const authorizedTypeIds = new Set(equipos.map(e => e.typeId).filter(Boolean))');
  expect(source).toContain('const authorizedLocationIds = new Set(equipos.map(e => e.locationId).filter(Boolean))');
  expect(source).toContain('types.filter(type => authorizedTypeIds.has(type.id))');
  expect(source).toContain('locations.filter(location => authorizedLocationIds.has(location.id))');
  expect(source).not.toContain('id="eq-sort-filter-btn"');
});

test('tabla genérica combina texto + select, orden numérico y limpiar todos', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    window.App = { route: 'historial' };
    const rows = [
      ['EQ-10', 'Abierto', '20'], ['EQ-11', 'Cerrado', '5'],
      ['EQ-12', 'Abierto', '100'], ['MX-01', 'Abierto', '40'],
    ];
    document.querySelector('#host').innerHTML = `<div><table class="data-table"><thead><tr><th>Código</th><th>Estado</th><th>Consumo</th><th>Acciones</th></tr></thead><tbody>${rows.map(row => `<tr><td>${row[0]}</td><td>${row[1]}</td><td>${row[2]}</td><td><button>Ver</button></td></tr>`).join('')}</tbody></table></div>`;
    window.sourceSnapshot = JSON.stringify(rows);
    standardizeDataTable(document.querySelector('table'));
  });
  await page.locator('[data-table-filter="codigo"]').click();
  await page.locator('[data-table-filter-all]').uncheck();
  await page.locator('.table-column-filter-option input[value="EQ-10"]').check();
  await page.locator('.table-column-filter-option input[value="EQ-12"]').check();
  await page.locator('[data-table-filter-apply]').click();
  await page.locator('[data-table-filter="estado"]').click();
  await page.locator('[data-table-filter-all]').uncheck();
  await page.locator('.table-column-filter-option input[value="Abierto"]').check();
  await page.locator('[data-table-filter-apply]').click();
  await expect(page.locator('tbody tr:not([hidden])')).toHaveCount(2);
  await page.locator('[data-table-sort="consumo"]').click();
  await expect(page.locator('tbody tr:not([hidden]) td:first-child')).toHaveText(['EQ-10', 'EQ-12']);
  await page.locator('.table-reset-button').click();
  await expect(page.locator('tbody tr:not([hidden])')).toHaveCount(4);
  expect(await page.evaluate(() => window.sourceSnapshot)).toBe(JSON.stringify([
    ['EQ-10', 'Abierto', '20'], ['EQ-11', 'Cerrado', '5'],
    ['EQ-12', 'Abierto', '100'], ['MX-01', 'Abierto', '40'],
  ]));
  await expect(page.locator('th:last-child [data-table-sort], th:last-child [data-table-filter]')).toHaveCount(0);
});

test('captura visual común de las seis tablas principales', async ({ page }, testInfo) => {
  await boot(page);
  await page.addStyleTag({ path: STYLES_PATH });
  await page.evaluate(() => {
    const definitions = [
      ['PLAN DE ENGRASE', ['Código', 'Equipo / Modelo', 'Control', 'Turnos', 'Puntos', 'Configurar']],
      ['EQUIPOS', ['Código', 'Equipo / Modelo', 'Tipo', 'Ubicación', 'Estado', 'Acciones']],
      ['HISTORIAL', ['Fecha', 'Equipo', 'Lubricador', 'Turno', 'Consumo', 'Acciones']],
      ['ANOMALÍAS', ['Fecha', 'Equipo', 'Componente', 'Criticidad', 'Estado', 'Acciones']],
      ['LUBRICANTES', ['Código', 'Nombre', 'Marca', 'Tipo', 'Unidad', 'Acciones']],
      ['USUARIOS', ['Nombre', 'Usuario', 'Rol', 'Cuadrilla', 'Estado', 'Acciones']],
    ];
    window.App = { route: 'history' };
    document.body.innerHTML = '<main id="visual-host"></main>';
    const host = document.querySelector('#visual-host');
    definitions.forEach(([title, headers], tableIndex) => {
      const section = document.createElement('section');
      section.className = 'panel';
      section.innerHTML = `<div class="panel-head table-section-title"><h3>${title}</h3></div><table class="data-table"><thead><tr>${headers.map(header => `<th>${header}</th>`).join('')}</tr></thead><tbody>${Array.from({ length: 6 }, (_, row) => `<tr>${headers.map((header, column) => `<td>${/Acciones|Configurar/.test(header) ? '<button class="btn btn-sm">Ver</button>' : /Fecha/.test(header) ? `${row + 1}/10/2026` : /Puntos|Consumo/.test(header) ? String((row + 1) * 10) : `${header} ${row + 1}`}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      host.appendChild(section);
      standardizeDataTable(section.querySelector('table'), tableIndex);
    });
  });
  await page.screenshot({ path: testInfo.outputPath('system-tables.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(testInfo.project.name.startsWith('phone') ? 1 : 16);
});
