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
  for (const name of ['drawResumen', 'drawCumplimientoTurno', 'drawCumplimientoEquipo', 'drawConsumo', 'drawAnomaliasSeccion', 'drawNoEjecutadosSeccion', 'drawValidacionSeccion', 'drawActividadResponsable']) {
    it(`${name}: misma preparación de métricas`, () => {
      const prefix = src => { const fn = nested(src, name); return fn.slice(0, fn.lastIndexOf('area.innerHTML =') >= 0 ? fn.lastIndexOf('area.innerHTML =') : fn.indexOf("$('#rep-consumo-stats').innerHTML")); };
      expect(prefix(current)).toBe(prefix(previous));
    });
  }
});
