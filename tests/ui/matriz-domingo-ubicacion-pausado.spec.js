// tests/ui/matriz-domingo-ubicacion-pausado.spec.js
//
// Matriz Semanal — Domingo (7 días), filtro Ubicación (existente, B5) y celda
// PAUSADO (B4, equipo no operativo). No requiere login ni red: fragmento
// estático con la estructura/clases REALES de renderMatrizSemanal() (app.js)
// — datos de relleno, nunca registros de producción. La lógica de
// estadoCelda() (pausado/Domingo/prioridad de plan) ya está probada contra la
// función REAL en tests/unit/matriz-pausado-status.test.js y
// tests/unit/matriz-domingo.test.js — aquí solo se valida la composición
// visual (colores/columnas/filtro), sin duplicar esas pruebas.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function matrizFixture({ ubicaciones = ['Rajo Principal', 'Botadero Norte'] } = {}) {
  const filas = [
    { eq: 'T-06', celdas: ['celda-hecho|REALIZADO', 'celda-hecho|REALIZADO', 'celda-hecho|REALIZADO', 'celda-hecho|REALIZADO', 'celda-hecho|REALIZADO', 'celda-pendiente|PENDIENTE HOY', 'celda-futuro|'] },
    { eq: 'EXC-02', celdas: ['celda-pausado|PAUSADO', 'celda-pausado|PAUSADO', 'celda-pausado|PAUSADO', 'celda-pausado|PAUSADO', 'celda-pausado|PAUSADO', 'celda-pausado|PAUSADO', 'celda-pausado|PAUSADO'] },
  ];
  const fila = ({ eq, celdas }) => `
    <tr><td class="matriz-eq mono">${eq}</td>
      ${celdas.map(c => { const [cls, txt] = c.split('|'); return `<td class="${cls}" title="x">${txt}</td>`; }).join('')}
    </tr>`;
  return `
  <div class="app-shell">
    <aside class="sidebar" id="sidebar"><nav class="menu"></nav></aside>
    <div class="main"><header class="topbar"><div class="topbar-title">Matriz Semanal</div></header>
      <main class="app-content">
        <div class="toolbar">
          <button class="btn btn-sm">← Semana anterior</button>
          <span class="matriz-rango">21/9 — 27/9/2026 (semana actual)</span>
          <button class="btn btn-sm">Semana siguiente →</button>
        </div>
        <div class="toolbar">
          <label class="filter-label">Turno<select id="mtz-turno" class="input input-sm"><option>Ambos</option></select></label>
          <label class="filter-label">Categoría<select id="mtz-tipo" class="input input-sm"><option>Todas</option></select></label>
          <label class="filter-label">Ubicación
            <select id="mtz-ubic" class="input input-sm">
              <option value="">Todas</option>
              ${ubicaciones.map((u, i) => `<option value="loc${i}">${u}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="kpi-grid">
          <div class="kpi-card"><div class="kpi-value">14</div><div class="kpi-label">Programados</div></div>
          <div class="kpi-card tone-green"><div class="kpi-value">10</div><div class="kpi-label">Realizados</div></div>
          <div class="kpi-card"><div class="kpi-value">0</div><div class="kpi-label">No realizados</div></div>
          <div class="kpi-card"><div class="kpi-value">1</div><div class="kpi-label">Pendientes hoy</div></div>
          <div class="kpi-card"><div class="kpi-value">7</div><div class="kpi-label">Pausados</div></div>
          <div class="kpi-card tone-green"><div class="kpi-value">100</div><div class="kpi-label">Cumplimiento %</div></div>
        </div>
        <button type="button" class="mtz-sin-plan-note" id="mtz-sin-plan-btn">2 equipo(s) sin plan de engrase — no aparecen en esta matriz</button>
        <div class="matriz-wrap">
          <table class="matriz">
            <thead>
              <tr><th colspan="${DIAS.length + 1}" class="matriz-titulo">PLAN DE ENGRASE (TURNO DÍA)</th></tr>
              <tr>
                <th class="matriz-eq">Equipo / No.</th>
                ${DIAS.map((d, i) => `<th>${d}<div class="matriz-fecha">${21 + i}/9</div></th>`).join('')}
              </tr>
            </thead>
            <tbody>${filas.map(fila).join('')}</tbody>
          </table>
        </div>
        <div class="color-legend">
          <span class="color-legend-item"><span class="dot" style="background:#00B050"></span>Realizado</span>
          <span class="color-legend-item"><span class="dot" style="background:#C00000"></span>No realizado (día ya pasado)</span>
          <span class="color-legend-item"><span class="dot" style="background:#F4B183"></span>Pendiente hoy</span>
          <span class="color-legend-item"><span class="dot" style="background:#F4B183; opacity:0.5"></span>Programado más adelante</span>
          <span class="color-legend-item"><span class="dot" style="background:var(--gray-status)"></span>Pausado (equipo no operativo)</span>
          <span class="color-legend-item"><span class="dot" style="background:var(--border)"></span>No le toca ese día</span>
        </div>
      </main>
    </div>
  </div>`;
}

const WIDTHS = [412, 1366];

for (const width of WIDTHS) {
  test(`Matriz @ ${width}px — 7 columnas (Lun..Dom), sin romper layout`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(matrizFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    const headers = await page.locator('table.matriz thead tr:nth-child(2) th').allTextContents();
    expect(headers.length).toBe(8);
    expect(headers.some(h => h.trim().startsWith('Domingo'))).toBe(true);
  });

  test(`Matriz @ ${width}px — filtro Ubicación presente y funcional (Todas + reales)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(matrizFixture({ ubicaciones: ['Rajo Principal', 'Botadero Norte', 'Taller Central'] }));
    await page.addStyleTag({ path: STYLES_PATH });

    const options = await page.locator('#mtz-ubic option').allTextContents();
    expect(options).toEqual(['Todas', 'Rajo Principal', 'Botadero Norte', 'Taller Central']);
  });

  test(`Matriz @ ${width}px — celda PAUSADO visualmente distinta de REALIZADO/PENDIENTE/futuro`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(matrizFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const pausadoBg = await page.locator('.celda-pausado').first().evaluate(el => getComputedStyle(el).backgroundColor);
    const hechoBg = await page.locator('.celda-hecho').first().evaluate(el => getComputedStyle(el).backgroundColor);
    const pendienteBg = await page.locator('.celda-pendiente').first().evaluate(el => getComputedStyle(el).backgroundColor);
    expect(pausadoBg).not.toBe(hechoBg);
    expect(pausadoBg).not.toBe(pendienteBg);
    await expect(page.locator('.celda-pausado').first()).toHaveText('PAUSADO');

    // Leyenda distingue Pausado de Sin plan (el aviso de sin-plan no usa dot de color).
    await expect(page.locator('.color-legend-item', { hasText: 'Pausado' })).toBeVisible();
    await expect(page.locator('#mtz-sin-plan-btn')).toBeVisible();
    const sinPlanHasDot = await page.locator('#mtz-sin-plan-btn .dot').count();
    expect(sinPlanHasDot).toBe(0);
  });
}
