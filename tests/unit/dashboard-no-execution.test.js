// tests/unit/dashboard-no-execution.test.js
//
// Rediseño estructural del Dashboard (cierre Parte D) — bloque compacto "No
// ejecutados hoy" dentro de la sección G, usando lubrication_skips ya
// existente (§13 del pedido): informativo únicamente, NUNCA contado como
// realizado/cumplimiento, y su click reutiliza la navegación ya existente
// (nunca una segunda lógica de consulta). Prueba a nivel de FUENTE.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const src = extractDeclaration(appSource, 'renderDashboard');

describe('G — "No ejecutados hoy" reusa skipsHoy/motivosNoEjecucionHoy ya calculados, sin segunda lógica de consulta', () => {
  it('skipsHoy lee lubrication_skips activos de HOY, respetando el filtro Ubicación/Familia (equipoIdsFiltrados)', () => {
    expect(src).toContain("const skipsHoy = skips.filter(s =>");
    expect(src).toContain("s.active !== false && (s.date || '').slice(0, 10) === todayISODash && equipoIdsFiltrados.has(s.equipmentId));");
  });

  it('el bloque compacto muestra el conteo (dashActivityCard) y el desglose por motivo (motivosNoEjecucionHoy), sin recalcular skipsHoy', () => {
    expect(src).toContain("dashActivityCard('No ejecutados hoy', skipsHoy.length, skipsHoy.length ? 'red' : 'neutral', null)");
    expect(src).toContain('const motivosNoEjecucionHoy = {};');
    expect(src).toContain('NO_EXECUTION_REASON_LABELS[reason] || reason');
  });

  it('nunca se suma a doneToday/hechoHoy/cumplHoy — es un conteo aparte, informativo', () => {
    const iG = src.indexOf('dash-panel-operativo');
    const iFinG = src.indexOf('</section>', iG);
    const seccionG = src.slice(iG, iFinG);
    expect(seccionG).not.toContain('doneToday');
    expect(seccionG).not.toContain('hechoHoy');
    expect(seccionG).not.toContain('cumplHoy');
  });
});

describe('§13 — no se inventa una segunda lógica de consulta: Historial/Reportes ya muestran el detalle de lubrication_skips (Parte B/C, lote anterior)', () => {
  it('drawHistory() ya mezcla lubrication_skips en la línea temporal del equipo (no se duplica aquí)', () => {
    const histSrc = extractDeclaration(appSource, 'drawHistory');
    expect(histSrc).toContain("const allSkips = (await DB.allActive('lubrication_skips')).filter(s => s.equipmentId === equipmentId)");
  });

  it('renderReportes() ya tiene su propio panel "No ejecutados" con desglose completo (no se duplica aquí)', () => {
    const repSrc = extractDeclaration(appSource, 'renderReportes');
    expect(repSrc).toContain('drawNoEjecutadosSeccion(applyFiltersSkips());');
  });

  it('el Dashboard NO define su propia función de detalle/click para skips — el bloque es puramente informativo (conteo + motivos), sin botón de detalle propio', () => {
    const iG = src.indexOf('dash-panel-operativo');
    const iFinG = src.indexOf('</section>', iG);
    const seccionG = src.slice(iG, iFinG);
    expect(seccionG).not.toContain('openModal(');
    expect(seccionG).not.toContain('hist-skip-detail');
  });
});
