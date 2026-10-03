// tests/ui/anomalias-historial-col-secondary.spec.js
//
// UI-NEW-01 (auditoría pre-release, lote final) — Anomalías e Historial
// (Búsqueda General y por equipo) generaban tarjetas móviles excesivamente
// largas en 390/412px porque ninguna fila usaba el mecanismo .col-secondary
// ya existente en styles.css (ver docs/UI_RESPONSIVE_FULL_AUDIT.md
// UI-FULL-104/201/202). Se marcaron 2-3 columnas realmente secundarias por
// tabla (Responsable/Grasa/Foto, nunca Equipo/Fecha/Estado/Tipo/Condición/
// Cumplimiento) con class="col-secondary" en app.js — este test fija, con
// los fixtures REALES (mismo <thead>/clases que renderAnomalias()/
// runGeneralSearch()/drawHistory()), que:
//   - en móvil (≤680px, breakpoint real de styles.css) las columnas
//     secundarias se ocultan y las críticas siguen visibles con su label;
//   - en desktop NINGUNA columna se oculta (nunca se pierde información).
// Mismo mecanismo, mismo método (fixture estático + makeTablesResponsive()
// real + styles.css real) que tests/ui/table-responsive-p1.spec.js.

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

// Mismo <thead> + misma fila (con las class="col-secondary" reales) que
// renderAnomalias() (app.js) — Responsable y Foto son las 2 secundarias;
// Criticidad/Equipo/Componente/Descripción/Fecha/Estado nunca se ocultan.
const ANOMALIAS_FIXTURE = `
<div class="app-content">
  <div class="panel">
    <table class="data-table" id="anom-table">
      <thead><tr><th>Criticidad</th><th>Equipo</th><th>Componente</th><th>Descripción</th><th>Fecha</th><th>Responsable</th><th>Estado</th><th>Foto</th><th></th></tr></thead>
      <tbody>
        <tr>
          <td><span class="dot"></span> Alta</td>
          <td class="mono">EXC-02</td>
          <td>Mando final</td>
          <td>Fuga de aceite visible</td>
          <td>01/10/2026</td>
          <td class="col-secondary">Juan Pérez</td>
          <td>Abierta</td>
          <td class="col-secondary"><span class="photo-thumb-wrap"></span></td>
          <td class="row-actions"><button class="btn btn-sm">Editar</button></td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
`;

// Mismo <thead> + misma fila que runGeneralSearch() (Historial → Búsqueda
// General) — Equipo(marca/modelo), Responsable y Foto son las 3
// secundarias; Fecha/Código/Turno/Condición/Cumplimiento nunca se ocultan.
const HISTORIAL_GENERAL_FIXTURE = `
<div class="hist-global-table-wrap">
  <table class="data-table hist-global-table">
    <thead><tr><th>Fecha</th><th>Código</th><th>Equipo</th><th>Turno</th><th>Responsable</th><th>Horómetro</th><th>Grasa</th><th>Condición</th><th>Cumplimiento</th><th>Foto</th></tr></thead>
    <tbody>
      <tr>
        <td>01/10/2026</td>
        <td class="mono">T-06</td>
        <td class="col-secondary">Caterpillar D8T</td>
        <td>Día</td>
        <td class="col-secondary">Ana Ruiz</td>
        <td class="mono">12480.5 h</td>
        <td>Grasa litio EP2</td>
        <td>Buena</td>
        <td><span class="hist-cond-badge">Cumple</span></td>
        <td class="col-secondary"><span class="photo-thumb-wrap"></span></td>
      </tr>
    </tbody>
  </table>
</div>
`;

// Mismo <thead> + misma fila que drawHistory() (Historial por equipo,
// tabla "Engrases") — Responsable, Grasa y Foto son las 3 secundarias;
// Fecha/Turno/Ubicación/Tipo/Horómetro/Cantidad/Condición/Cumplimiento/
// Validación nunca se ocultan (Validación incluye un botón de acción real).
const HISTORIAL_EQUIPO_FIXTURE = `
<div class="app-content">
  <table class="data-table">
    <thead><tr><th>Fecha</th><th>Turno</th><th>Ubicación</th><th>Tipo</th><th>Horómetro</th><th>Responsable</th><th>Grasa</th><th>Cantidad (lb)</th><th>Condición</th><th>Cumplimiento</th><th>Validación</th><th>Foto</th></tr></thead>
    <tbody>
      <tr>
        <td>01/10/2026</td>
        <td>Noche</td>
        <td>Volcán</td>
        <td><span class="status-chip" style="--c:var(--gray-status)">Planificado</span></td>
        <td class="mono">12480.5 h</td>
        <td class="col-secondary">Ana Ruiz</td>
        <td class="col-secondary">Grasa litio EP2</td>
        <td class="mono">3.5 lb</td>
        <td><span class="hist-cond-badge">Buena</span></td>
        <td><span class="compliance-badge">Cumple</span></td>
        <td><button type="button" class="btn btn-sm">Validar</button></td>
        <td class="col-secondary"><span class="photo-thumb-wrap"></span></td>
      </tr>
    </tbody>
  </table>
</div>
`;

const FIXTURES = [
  {
    nombre: 'Anomalías',
    html: ANOMALIAS_FIXTURE,
    criticas: ['Criticidad', 'Equipo', 'Componente', 'Descripción', 'Fecha', 'Estado'],
    secundarias: ['Responsable', 'Foto'],
  },
  {
    nombre: 'Historial — Búsqueda General',
    html: HISTORIAL_GENERAL_FIXTURE,
    criticas: ['Fecha', 'Código', 'Turno', 'Condición', 'Cumplimiento'],
    secundarias: ['Equipo', 'Responsable', 'Foto'],
  },
  {
    nombre: 'Historial — por equipo (Engrases)',
    html: HISTORIAL_EQUIPO_FIXTURE,
    criticas: ['Fecha', 'Turno', 'Ubicación', 'Tipo', 'Horómetro', 'Cantidad (lb)', 'Condición', 'Cumplimiento', 'Validación'],
    secundarias: ['Responsable', 'Grasa', 'Foto'],
  },
];

for (const fx of FIXTURES) {
  test.describe(`UI-NEW-01 — ${fx.nombre}`, () => {
    test(`columnas secundarias vs. críticas según el ancho real (390/412 ocultan, desktop conserva todo)`, async ({ page }, testInfo) => {
      await page.setContent(`<div class="app-shell">${fx.html}</div>`);
      await page.addStyleTag({ path: STYLES_PATH });
      await page.addScriptTag({ content: `${MAKE_TABLES_RESPONSIVE_SRC}\nmakeTablesResponsive(document.querySelector('.app-content, .hist-global-table-wrap'));` });

      const viewport = page.viewportSize();
      const esMovilApilado = viewport.width <= 680; // mismo breakpoint real de styles.css (§ "Tablas como tarjetas apiladas")

      const estadoColumnas = await page.evaluate(() => {
        const celdas = Array.from(document.querySelectorAll('td'));
        return celdas.map(td => ({
          label: td.getAttribute('data-label'),
          secundaria: td.classList.contains('col-secondary'),
          visible: td.offsetParent !== null && getComputedStyle(td).display !== 'none',
        }));
      });

      for (const nombreCritico of fx.criticas) {
        const celda = estadoColumnas.find(c => c.label === nombreCritico);
        expect(celda, `columna crítica "${nombreCritico}" debe tener data-label en ${testInfo.project.name}`).toBeTruthy();
        expect(celda.visible, `columna crítica "${nombreCritico}" debe seguir visible en ${testInfo.project.name} (nunca se oculta)`).toBe(true);
      }

      for (const nombreSecundario of fx.secundarias) {
        const celda = estadoColumnas.find(c => c.label === nombreSecundario);
        expect(celda, `columna secundaria "${nombreSecundario}" debe existir en ${testInfo.project.name}`).toBeTruthy();
        expect(celda.secundaria, `"${nombreSecundario}" debe tener class="col-secondary"`).toBe(true);
        if (esMovilApilado) {
          expect(celda.visible, `"${nombreSecundario}" debe ocultarse en móvil apilado (${testInfo.project.name})`).toBe(false);
        } else {
          expect(celda.visible, `"${nombreSecundario}" NUNCA debe ocultarse en desktop (${testInfo.project.name}) — toda la información se conserva`).toBe(true);
        }
      }

      // Alcance de validación pedido para este hallazgo: 390/412/desktop
      // (nunca tablet 768/1024) — la tabla "Engrases" de Historial por
      // equipo tiene 12 columnas reales y, como Matriz Semanal, puede
      // necesitar scroll horizontal en anchos intermedios; eso es una
      // característica previa de la tabla (no algo que este lote introduce
      // ni algo que se pidió corregir aquí) y queda fuera de este check.
      if (!testInfo.project.name.startsWith('tablet')) {
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth, `sin overflow horizontal en ${testInfo.project.name}`).toBeLessThanOrEqual(clientWidth);
      }
    });
  });
}
