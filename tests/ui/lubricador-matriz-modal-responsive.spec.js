// tests/ui/lubricador-matriz-modal-responsive.spec.js
//
// Rediseño de ventana — Matriz semanal del Lubricador (auditoría UI UX Pro
// Max 2026-10-09: modal demasiado angosto/comprimido, día cortado, scroll
// horizontal demasiado pronto). Corre la función REAL openLubricadorMatrizModal()
// (extraída de app.js, mismo mecanismo que modal-accessibility.spec.js) dentro
// de una página real de Playwright, con el CSS real cargado — el layout/
// sticky/overflow solo se puede verificar de verdad contra un DOM real.
//
// Se ejecuta en los 7 proyectos ya configurados en playwright.config.js
// (360/390/412/768/1024/1366/1920) — cubre los anchos móviles pedidos
// (390/412) y el resto del rango; 384px y 1440px (los otros 2 anchos
// pedidos, que no son un proyecto de Playwright) se verifican aparte con
// page.setViewportSize() dentro del mismo test, sin lanzar un browser nuevo.
//
// NO se toca estadoCelda()/WEEKDAY_NAMES/cálculo de la matriz — solo se
// verifica presentación (ancho, sticky, scroll, leyenda, temas).

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const appSource = readSource(APP_JS_PATH);
const weeklyMatrixSrc = readSource('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/weekly-matrix.js');
const lubStatusSrc = readSource('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/lubrication-status.js');
const operationalScopeSrc = readSource('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/operational-scope.js');

const APP_NAMES = ['$', '$$', 'esc', 'openModal', 'closeModal', 'wireMatrizScrollHint', 'openLubricadorMatrizModal'];
const appRealSrc = APP_NAMES.map((n) => extractDeclaration(appSource, n)).join('\n\n');

const hoyWeekday = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][new Date().getDay()];

// 7 equipos con plan día/turno (todos asignados a "hoy") — suficientes
// columnas (Equipo + 7 días) para que el ancho real importe, y suficientes
// filas para ejercitar el sticky vertical del encabezado.
const equipos = Array.from({ length: 7 }, (_, i) => ({
  id: `e${i}`, code: `T-${String(i).padStart(2, '0')}`, brand: 'Caterpillar', model: 'D8T', status: 'Operativo',
}));
const plans = equipos.map((e, i) => ({
  id: `p${i}`, equipmentId: e.id, controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday],
}));
const records = [];

async function bootPage(page) {
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
    ({ equipos, plans, records }) => {
      window.openLubricadorMatrizModal({
        equipos, plans, records, myCrew: { name: '76-08' },
        locationName: 'Volcán', turnoLabel: 'Turno Día',
      });
    },
    { equipos, plans, records }
  );
}

test('el modal usa .modal-lub-matriz y nunca desborda la página (sin overflow horizontal externo)', async ({ page }) => {
  await bootPage(page);
  const modal = page.locator('.modal-lub-matriz');
  await expect(modal).toBeVisible();
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow).toBeLessThanOrEqual(1); // 1px de tolerancia de redondeo
});

test('ancho del modal: móvil casi pantalla completa, desktop aprovecha 92-95vw hasta ~1200px', async ({ page }) => {
  await bootPage(page);
  const box = await page.locator('.modal-lub-matriz').boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  if (viewport.width <= 640) {
    expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1);
    const heightRatio = box.height / viewport.height;
    expect(heightRatio).toBeGreaterThan(0.95); // "casi pantalla completa"
  } else {
    // 94vw hasta un tope de 1200px — en pantallas muy anchas (p. ej. 1920px)
    // el tope manda y el ratio vs. el viewport baja a propósito (spec: "max-width
    // aproximado 1100–1250px"), así que se compara contra min(94vw, 1200), no
    // contra un % fijo del viewport.
    const expectedWidth = Math.min(viewport.width * 0.94, 1200);
    expect(box.width).toBeGreaterThanOrEqual(expectedWidth - 20);
    expect(box.width).toBeLessThanOrEqual(1210); // tope ~1200px + tolerancia
  }
});

test('header: título "MATRIZ SEMANAL" (uppercase por CSS), línea de contexto y botón cerrar visibles', async ({ page }) => {
  await bootPage(page);
  await expect(page.locator('#modal-title-text')).toHaveText('Matriz semanal');
  await expect(page.locator('#modal-title-text')).toHaveCSS('text-transform', 'uppercase');
  await expect(page.locator('.lub-mtz-context')).toContainText('Volcán · 76-08 · Turno Día');
  await expect(page.locator('#modal-close')).toBeVisible();
});

test('navegación de semana: ‹ Semana actual › visibles, sin texto cortado (sin overflow en el rango)', async ({ page }) => {
  await bootPage(page);
  await expect(page.locator('#lubmtz-prev')).toBeVisible();
  await expect(page.locator('#lubmtz-next')).toBeVisible();
  await expect(page.locator('.matriz-rango')).toContainText('Semana actual');
  const overflow = await page.locator('.matriz-rango').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('sticky: encabezado de días y columna Equipo quedan "position: sticky" dentro de .matriz-wrap', async ({ page }) => {
  await bootPage(page);
  const theadPos = await page.locator('table.matriz thead tr:nth-child(1) th').first().evaluate((el) => getComputedStyle(el).position);
  expect(theadPos).toBe('sticky');
  const eqColPos = await page.locator('.matriz-eq').first().evaluate((el) => getComputedStyle(el).position);
  expect(eqColPos).toBe('sticky');
});

test('todos los días son accesibles vía scroll horizontal (7 columnas de día presentes, incluido el último)', async ({ page }) => {
  await bootPage(page);
  const dayHeaders = page.locator('table.matriz thead th:not(.matriz-eq)');
  await expect(dayHeaders).toHaveCount(7);
  // El wrap debe poder desplazarse si la tabla no entra — y el último día debe
  // quedar alcanzable moviendo el scroll al máximo.
  const wrap = page.locator('.matriz-wrap');
  await wrap.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  const lastDayBox = await dayHeaders.last().boundingBox();
  const wrapBox = await wrap.boundingBox();
  expect(lastDayBox.x + lastDayBox.width).toBeLessThanOrEqual(wrapBox.x + wrapBox.width + 1);
});

test('día actual: columna "HOY" con fondo/borde de acento, visualmente distinto de un día normal', async ({ page }) => {
  await bootPage(page);
  const todayTh = page.locator('table.matriz thead th.is-today');
  const otherTh = page.locator('table.matriz thead th:not(.is-today):not(.matriz-eq)').first();
  await expect(todayTh).toHaveCount(1);
  const todayBg = await todayTh.evaluate((el) => getComputedStyle(el).backgroundColor);
  const otherBg = await otherTh.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(todayBg).not.toBe(otherBg);
});

test('leyenda: 5 estados presentes, nunca una card — sigue siendo tabla', async ({ page }) => {
  await bootPage(page);
  await expect(page.locator('.color-legend .color-legend-item')).toHaveCount(5);
  await expect(page.locator('table.matriz')).toBeVisible();
  await expect(page.locator('.eq-card')).toHaveCount(0); // sin tarjetas nuevas de equipo — sigue siendo tabla
});

test('Modo Sol: el modal sigue legible y sin overflow externo (fondo blanco, bordes definidos, día actual identificable)', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => document.documentElement.setAttribute('data-mode', 'sun'));
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow).toBeLessThanOrEqual(1);
  const borderWidth = await page.locator('.modal-lub-matriz').evaluate((el) => getComputedStyle(el).borderWidth);
  expect(parseFloat(borderWidth)).toBeGreaterThanOrEqual(1);
  await expect(page.locator('table.matriz thead th.is-today')).toBeVisible();
});

test('Modo oscuro: el modal sigue visible y sin overflow externo', async ({ page }) => {
  await bootPage(page);
  await page.evaluate(() => document.documentElement.setAttribute('data-mode', 'dark'));
  await expect(page.locator('.modal-lub-matriz')).toBeVisible();
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow).toBeLessThanOrEqual(1);
});

test('384px y 1440px (anchos pedidos fuera de los 7 proyectos configurados): sin overflow externo, modal visible', async ({ page }) => {
  await page.setViewportSize({ width: 384, height: 800 });
  await bootPage(page);
  await expect(page.locator('.modal-lub-matriz')).toBeVisible();
  let pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(50);
  await expect(page.locator('.modal-lub-matriz')).toBeVisible();
  pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow).toBeLessThanOrEqual(1);
  const box = await page.locator('.modal-lub-matriz').boundingBox();
  expect(box.width).toBeLessThanOrEqual(1210);
});
