// tests/ui/lubricador-matriz-row-height.spec.js
//
// Fix "filas gigantes" en la Matriz del Lubricador (2026-10-09). Causa raíz
// real (confirmada con getComputedStyle()/boundingBox() ANTES de tocar CSS,
// ver historial de commits): `.matriz-wrap` es un CSS grid sin
// `align-content` propio — por default eso resuelve a `stretch`, así que
// cuando `.modal-lub-matriz .matriz-wrap` recibe una altura EXTERNA
// (`flex:1`, para aprovechar el modal casi pantalla completa) el único
// renglón implícito del grid (y la <table> dentro de él) se estiraba a esa
// altura completa — y el algoritmo de layout de tablas reparte ese
// sobrante entre las <tr>. Con 3 equipos en 390px esto medía ~176px por
// fila. Fix real: `align-content: start` en `.matriz-wrap` (el renglón ya
// no se estira) + `height` mínimo explícito en las celdas, SOLO dentro de
// `.modal-lub-matriz` (header ~46px, fila ~58px — nunca afecta a
// renderMatrizSemanal(), la Matriz de escritorio).
//
// Corre la función REAL openLubricadorMatrizModal() (mismo mecanismo que
// lubricador-matriz-modal-responsive.spec.js) dentro de una página real de
// Playwright, con el CSS real — la altura de fila solo se puede medir de
// verdad contra un DOM real, nunca con un mock.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const appSource = readSource(APP_JS_PATH);
const weeklyMatrixSrc = readSource('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/weekly-matrix.js');
const lubStatusSrc = readSource('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/lubrication-status.js');
const operationalScopeSrc = readSource('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/operational-scope.js');

const APP_NAMES = ['$', '$$', 'esc', 'openModal', 'closeModal', 'wireMatrixOccurrenceDetails', 'wireMatrizScrollHint', 'openLubricadorMatrizModal'];
const appRealSrc = APP_NAMES.map((n) => extractDeclaration(appSource, n)).join('\n\n');

const hoyWeekday = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][new Date().getDay()];

function equiposPlans(codes) {
  const equipos = codes.map((code, i) => ({ id: `e${i}`, code, brand: 'Caterpillar', model: 'D8T', status: 'Operativo' }));
  const plans = equipos.map((e, i) => ({ id: `p${i}`, equipmentId: e.id, controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] }));
  return { equipos, plans };
}

async function bootModal(page, { equipos, plans }) {
  await page.setContent('<div id="app-content"></div>');
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      ${lubStatusSrc}
      ${operationalScopeSrc}
      ${weeklyMatrixSrc}
      ${appRealSrc}
      window.$ = $; window.$$ = $$; window.esc = esc;
      window.openModal = openModal; window.closeModal = closeModal;
      window.wireMatrizScrollHint = wireMatrizScrollHint;
      window.openLubricadorMatrizModal = openLubricadorMatrizModal;
    `,
  });
  await page.evaluate(
    ({ equipos, plans }) => {
      window.openLubricadorMatrizModal({ equipos, plans, records: [], locationName: 'Volcán' });
    },
    { equipos, plans }
  );
}

const MOBILE_VIEWPORTS = [360, 384, 390, 412];

for (const width of MOBILE_VIEWPORTS) {
  test(`3 equipos @ ${width}px: filas compactas (<=72px), NO rellenan verticalmente la matriz, tabla con alto natural`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const { equipos, plans } = equiposPlans(['25-46', '45-77', 'A11']);
    await bootModal(page, { equipos, plans });

    const info = await page.evaluate(() => {
      const wrap = document.querySelector('.matriz-wrap');
      const table = document.querySelector('table.matriz');
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      return {
        wrapHeight: wrap.getBoundingClientRect().height,
        tableHeight: table.getBoundingClientRect().height,
        rowHeights: rows.map((r) => r.getBoundingClientRect().height),
      };
    });

    // Cada fila compacta, dentro del objetivo pedido (56-64px nominal, tope
    // 72px por excepciones de wrap de texto en columnas angostas).
    for (const h of info.rowHeights) {
      expect(h).toBeLessThanOrEqual(72);
      expect(h).toBeGreaterThanOrEqual(40); // nunca colapsa por debajo de lo legible
    }
    // Las 3 filas juntas NO deben acercarse a rellenar el alto de
    // .matriz-wrap (que es ~88vh del modal casi pantalla completa) — la
    // tabla debe quedar MUY por debajo de esa altura, con espacio vacío.
    expect(info.tableHeight).toBeLessThan(info.wrapHeight * 0.6);
    expect(info.wrapHeight - info.tableHeight).toBeGreaterThan(100); // espacio vacío real debajo
  });
}

test('muchos equipos (20): filas mantienen la misma altura compacta, aparece scroll vertical, último equipo alcanzable, sticky header funciona', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const codes = Array.from({ length: 20 }, (_, i) => `EQ-${i}`);
  const { equipos, plans } = equiposPlans(codes);
  await bootModal(page, { equipos, plans });

  const before = await page.evaluate(() => {
    const wrap = document.querySelector('.matriz-wrap');
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    return {
      canScrollVertically: wrap.scrollHeight > wrap.clientHeight,
      rowHeights: rows.map((r) => r.getBoundingClientRect().height),
    };
  });
  expect(before.canScrollVertically).toBe(true);
  const distinctHeights = new Set(before.rowHeights.map((h) => Math.round(h)));
  expect(distinctHeights.size).toBe(1); // TODAS las filas, misma altura compacta — ninguna se estira para llenar espacio

  await page.evaluate(() => { document.querySelector('.matriz-wrap').scrollTop = 999999; });
  const after = await page.evaluate(() => {
    const wrap = document.querySelector('.matriz-wrap');
    const lastRow = document.querySelector('tbody tr:last-child');
    const theadTh = document.querySelector('thead th:not(.matriz-eq)');
    const wrapRect = wrap.getBoundingClientRect();
    const lastRowRect = lastRow.getBoundingClientRect();
    const theadRect = theadTh.getBoundingClientRect();
    return {
      lastRowVisible: lastRowRect.top >= wrapRect.top - 1 && lastRowRect.bottom <= wrapRect.bottom + 1,
      theadPosition: getComputedStyle(theadTh).position,
      theadStillAtWrapTop: Math.abs(theadRect.top - wrapRect.top) < 5,
    };
  });
  expect(after.lastRowVisible).toBe(true);
  expect(after.theadPosition).toBe('sticky');
  expect(after.theadStillAtWrapTop).toBe(true);
});

test('header de día: altura compacta (~44-48px), centrado, visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const { equipos, plans } = equiposPlans(['25-46', '45-77', 'A11']);
  await bootModal(page, { equipos, plans });

  const h = await page.locator('thead th:not(.matriz-eq)').first().evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(40);
  expect(h).toBeLessThanOrEqual(52);
});

test('columna Equipo: compacta, sticky, misma altura que las celdas de estado, código visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const { equipos, plans } = equiposPlans(['25-46', '45-77', 'A11']);
  await bootModal(page, { equipos, plans });

  const info = await page.evaluate(() => {
    const row = document.querySelector('tbody tr');
    const eqCell = row.querySelector('.matriz-eq');
    const statusCell = row.querySelector('td:not(.matriz-eq)');
    return {
      eqHeight: eqCell.getBoundingClientRect().height,
      statusHeight: statusCell.getBoundingClientRect().height,
      eqPosition: getComputedStyle(eqCell).position,
      eqText: eqCell.textContent.trim(),
    };
  });
  expect(info.eqPosition).toBe('sticky');
  expect(info.eqText).toBe('25-46');
  expect(Math.abs(info.eqHeight - info.statusHeight)).toBeLessThanOrEqual(1);
});

test('horizontal: los 7 días siguen accesibles por scroll, sticky Equipo y header de días intactos (sin regresión del fix anterior)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const { equipos, plans } = equiposPlans(['25-46', '45-77', 'A11']);
  await bootModal(page, { equipos, plans });

  await expect(page.locator('table.matriz thead th:not(.matriz-eq)')).toHaveCount(7);
  const eqColPos = await page.locator('.matriz-eq').first().evaluate((el) => getComputedStyle(el).position);
  expect(eqColPos).toBe('sticky');
  const theadPos = await page.locator('table.matriz thead th').first().evaluate((el) => getComputedStyle(el).position);
  expect(theadPos).toBe('sticky');

  const wrap = page.locator('.matriz-wrap');
  await wrap.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  const lastDay = page.locator('table.matriz thead th:not(.matriz-eq)').last();
  const lastDayBox = await lastDay.boundingBox();
  const wrapBox = await wrap.boundingBox();
  expect(lastDayBox.x + lastDayBox.width).toBeLessThanOrEqual(wrapBox.x + wrapBox.width + 1);
});

test('desktop (1366px): sin regresión — la tabla también mantiene alto natural, nunca se estira al alto del modal', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const { equipos, plans } = equiposPlans(['25-46', '45-77', 'A11']);
  await bootModal(page, { equipos, plans });

  const info = await page.evaluate(() => {
    const wrap = document.querySelector('.matriz-wrap');
    const table = document.querySelector('table.matriz');
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    return {
      wrapHeight: wrap.getBoundingClientRect().height,
      tableHeight: table.getBoundingClientRect().height,
      rowHeights: rows.map((r) => r.getBoundingClientRect().height),
    };
  });
  for (const h of info.rowHeights) {
    expect(h).toBeLessThanOrEqual(72);
  }
  expect(info.tableHeight).toBeLessThan(info.wrapHeight * 0.6);
});
