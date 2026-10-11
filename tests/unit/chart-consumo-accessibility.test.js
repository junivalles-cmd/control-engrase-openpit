// tests/unit/chart-consumo-accessibility.test.js
//
// Hardening pre-release 2026-10-08: el gráfico "Consumo de grasa" (Reportes)
// no tenía alternativa textual para lectores de pantalla, a diferencia del
// de Tendencia (ya corregido en una sesión anterior). Mismo patrón exacto:
// role="img" + aria-label + aria-describedby apuntando a un <p class="sr-only">
// relleno con los MISMOS `entries` que alimentan el chart — nunca duplica
// visualmente nada, nunca toca Chart.js ni el cálculo.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

// dibujarConsumoTab() vive ANIDADA dentro de renderReportes() (no es una
// declaración top-level), así que extractDeclaration() (pensada para
// funciones a nivel de módulo) no la encuentra — se recorta un bloque de
// texto alrededor del ancla real en vez de aislar la función completa; esto
// es una prueba de CONTENIDO de fuente, no de ejecución aislada.
const appSource = readSource(APP_JS_PATH);
const anchorIdx = appSource.indexOf('function dibujarConsumoTab(tab)');
if (anchorIdx === -1) throw new Error('dibujarConsumoTab(tab) no se encontró en app.js — ¿se renombró?');
const src = extractDeclaration(appSource.replace(/^  /gm, ''), 'dibujarConsumoTab');

describe('dibujarConsumoTab() — alternativa textual accesible (mismo patrón que Tendencia)', () => {
  it('el <canvas> declara role="img" + aria-label + aria-describedby', () => {
    expect(src).toContain('role="img"');
    expect(src).toContain('aria-label="Gráfico de consumo de grasa"');
    expect(src).toContain('aria-describedby="chart-consumo-summary"');
  });

  it('existe el <p class="sr-only"> con el mismo id referenciado', () => {
    expect(src).toContain('id="chart-consumo-summary" class="sr-only"');
  });

  it('el resumen se genera de los MISMOS `entries` que alimentan el chart (sin cálculo nuevo)', () => {
    expect(src).toMatch(/entries\.map\(\(\[k, v\]\)/);
  });

  it('conserva el tipo de barras horizontales con sus opciones visuales', () => {
    expect(src).toContain("type: 'bar'");
    expect(src).toContain("indexAxis: 'y'");
  });
});
