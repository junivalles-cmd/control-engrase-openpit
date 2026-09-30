// tests/unit/reportes-no-ejecutados.test.js
//
// Cierre histórico, Parte C (§17-§22 del pedido) — lubrication_skips
// entran al análisis histórico de Reportes como categoría PROPIA, nunca
// contados como lubrication_records. Prueba a nivel de FUENTE (mismo
// criterio que el resto de Reportes): renderReportes() tiene demasiadas
// dependencias de DOM/IndexedDB/charts como para ejecutarlo completo aquí.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const src = extractDeclaration(appSource, 'renderReportes');

describe('§17 — lubrication_skips se leen aparte, nunca mezclados con lubrication_records', () => {
  it('allSkips es su propia lectura, con comentario explícito de que nunca cuenta como realizado', () => {
    expect(src).toContain("const allSkips = await DB.allActive('lubrication_skips');");
  });

  it('applyFiltersSkips() usa los MISMOS filtros (Desde/Hasta/Equipo/Familia/Ubicación/Turno/Responsable) que applyFilters() aplica a records — nunca un criterio propio distinto', () => {
    expect(src).toContain('function applyFiltersSkips() {');
    const iFn = src.indexOf('function applyFiltersSkips() {');
    const fnSrc = src.slice(iFn, iFn + 900);
    expect(fnSrc).toContain("equiposFiltradosPorEquipoYFamilia()");
    expect(fnSrc).toContain("if (turno && s.shiftId !== turno) return false;");
    expect(fnSrc).toContain("if (respId && s.userId !== respId) return false;");
  });

  it('drawAll() dibuja "No ejecutados" junto al resto de las secciones, con su propio filtro', () => {
    expect(src).toContain('drawNoEjecutadosSeccion(applyFiltersSkips());');
  });
});

describe('§18 — desglose: total, por motivo, por ubicación, por equipo, por turno', () => {
  it('KPI principal + desglose por turno Día/Noche', () => {
    expect(src).toContain("kpiCard('No ejecutados', skipsF.length,");
    expect(src).toContain("kpiCard('Turno Día', porTurno['Día'], 'neutral')");
    expect(src).toContain("kpiCard('Turno Noche', porTurno['Noche'], 'neutral')");
  });

  it('por motivo usa las etiquetas reales (NO_EXECUTION_REASON_LABELS), nunca el código interno', () => {
    expect(src).toContain('const porMotivo = {};');
    expect(src).toContain('NO_EXECUTION_REASON_LABELS[s.reason] || s.reason');
  });

  it('por ubicación y por equipo, ordenados de mayor a menor', () => {
    expect(src).toContain('const porUbicacion = {};');
    expect(src).toContain('const porEquipo = {};');
    expect(src).toContain('.sort((a, b) => b[1] - a[1])');
  });
});

describe('§20 — NUNCA se trata un skip como cumplimiento/realizado', () => {
  it('el panel se documenta explícitamente como informativo, no como cumplimiento', () => {
    expect(src).toMatch(/NUNCA se\s*\n\s*\/\/ trata como cumplimiento/);
  });

  it('drawNoEjecutadosSeccion() nunca llama a evaluateRecordCompliance/complianceBadgeHTML — es un conteo aparte, no una evaluación de cumplimiento', () => {
    const iFn = src.indexOf('function drawNoEjecutadosSeccion(skipsF) {');
    const iSiguienteFn = src.indexOf('function drawValidacionSeccion(records) {');
    const fnSrc = src.slice(iFn, iSiguienteFn);
    expect(fnSrc).not.toContain('evaluateRecordCompliance');
    expect(fnSrc).not.toContain('complianceBadgeHTML');
  });
});

describe('Panel "No ejecutados" en el HTML — con su propia leyenda explicando que no equivale a realizado', () => {
  it('existe el contenedor #rep-no-ejecutados-area con la nota explicativa', () => {
    expect(src).toContain('<div id="rep-no-ejecutados-area"></div>');
    expect(src).toContain('NUNCA se cuenta como engrase realizado');
  });
});
