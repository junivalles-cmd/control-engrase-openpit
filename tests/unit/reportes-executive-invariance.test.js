import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const current = extractDeclaration(readSource(APP_JS_PATH), 'renderReportes');
const previous = extractDeclaration(execFileSync('git', ['show', 'c6e9372:CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js'], { encoding:'utf8' }).replace(/\r\n?/g, '\n'), 'renderReportes');
const nested = (src, name) => extractDeclaration(src.replace(/^  /gm, ''), name);

describe('Reportes: presentación sin modificar contratos operativos', () => {
  for (const name of ['equiposFiltrados', 'equiposFiltradosPorEquipoYFamilia', 'applyFilters', 'applyFiltersAnomalias', 'applyFiltersSkips', 'filtrosActivosTexto', 'noEjecutadosFilasDetalle', 'diasDelPeriodo', 'puntosNoEngrasadosDe', 'consumoDe', 'drawAll', 'drawPhotoReport']) {
    it(`${name}: misma implementación que HEAD inicial`, () => expect(nested(current, name)).toBe(nested(previous, name)));
  }
  it('conserva todas las consultas y mapas originales', () => {
    expect(current.slice(0, current.indexOf('  c.innerHTML'))).toBe(previous.slice(0, previous.indexOf('  c.innerHTML')));
  });
  it('conserva handlers, exportaciones PDF/Excel/CSV y navegación sin cambios', () => {
    const marker = "  $('#rep-photo-toggle').addEventListener";
    expect(current.slice(current.indexOf(marker))).toBe(previous.slice(previous.indexOf(marker)));
  });
  for (const name of ['drawResumen', 'drawCumplimientoTurno', 'drawCumplimientoEquipo', 'drawConsumo', 'drawAnomaliasSeccion', 'drawNoEjecutadosSeccion', 'drawActividadResponsable']) {
    it(`${name}: misma preparación de métricas`, () => {
      const prefix = src => { const fn = nested(src, name); return fn.slice(0, fn.lastIndexOf('area.innerHTML =') >= 0 ? fn.lastIndexOf('area.innerHTML =') : fn.indexOf("$('#rep-consumo-stats').innerHTML")); };
      expect(prefix(current)).toBe(prefix(previous));
    });
  }
  // drawValidacionSeccion: el texto del estado "sin validación activada
  // todavía" cambió a propósito (hallazgo LUB-10, auditoría pre-release
  // 2026-10-21) — exponía el nombre de GREASE_VALIDATION_ENABLED_FROM y una
  // ruta de doc interna al usuario final. Esto congela el CÁLCULO real
  // (desde la declaración de `ahoraVal` hasta antes del innerHTML final:
  // conteo de validados/pendientes/vencidos/conflictos vía
  // findActiveValidations()/isRecordValidationExpired()), nunca el texto
  // del estado inicial, que es presentación.
  it('drawValidacionSeccion: mismo cálculo de métricas (el texto del estado inicial cambió a propósito, ver LUB-10)', () => {
    const anchor = 'const ahoraVal = new Date();';
    const prefix = src => { const fn = nested(src, 'drawValidacionSeccion'); return fn.slice(fn.indexOf(anchor), fn.lastIndexOf('area.innerHTML =')); };
    expect(prefix(current)).toBe(prefix(previous));
  });
});
