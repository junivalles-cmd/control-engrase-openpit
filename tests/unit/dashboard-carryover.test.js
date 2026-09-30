// tests/unit/dashboard-carryover.test.js
//
// Rediseño estructural del Dashboard (cierre Parte D) — sección E,
// "Pendientes del turno anterior": lista real de equipos (nunca un KPI),
// propia sección visible, y el BUG REAL de double-count corregido en este
// lote (un equipo con carryover que YA se engrasó más tarde el mismo día no
// debe seguir contando como "pendiente"). Prueba a nivel de FUENTE.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const src = extractDeclaration(appSource, 'renderDashboard');

describe('E — sección propia "Pendientes del turno anterior", nunca convertida en tarjeta KPI', () => {
  it('panel dedicado con su propio id/h3', () => {
    expect(src).toContain('id="dash-pendientes-anterior-panel"');
    expect(src).toContain('<h3>Pendientes del turno anterior</h3>');
  });

  it('cuando hay pendientes, lista los CÓDIGOS reales (mismo array pendientesTurnoAnterior, sin recalcular ni envolver en dashHeroCard/dashActivityCard)', () => {
    const iPanel = src.indexOf('id="dash-pendientes-anterior-panel"');
    const panelSrc = src.slice(iPanel, iPanel + 700);
    expect(panelSrc).toContain('${pendientesTurnoAnterior.map(e => `<span class="dash-motivo-chip mono">${esc(e.code)}</span>`).join(\'\')}');
    expect(panelSrc).not.toContain('dashHeroCard(');
    expect(panelSrc).not.toContain('dashActivityCard(');
  });

  it('cuando NO hay pendientes, no ocupa espacio excesivo (empty-state corto, sin tabla)', () => {
    const iPanel = src.indexOf('id="dash-pendientes-anterior-panel"');
    const panelSrc = src.slice(iPanel, iPanel + 700);
    expect(panelSrc).toContain('Ninguno — nada heredado del turno anterior.');
  });
});

describe('BUG REAL corregido en este lote — pendientesTurnoAnterior excluye equipos ya engrasados hoy (Realizado atrasado)', () => {
  it('antes de este lote, un equipo con carryover que se engrasó MÁS TARDE el mismo día seguía contando como "pendiente turno anterior" Y como "realizado" a la vez', () => {
    const iFn = src.indexOf('const pendientesTurnoAnterior = equipos.filter(e => {');
    const fnSrc = src.slice(iFn, iFn + 500);
    expect(fnSrc).toContain("if (!carry || carry.shiftId === turnoActual) return false;");
    expect(fnSrc).toContain("const yaEngrasadoHoy = records.some(r => r.equipmentId === e.id && new Date(r.date).toDateString() === today);");
    expect(fnSrc).toContain('return !yaEngrasadoHoy;');
  });

  it('usa findCarriedOverSkipForToday() (operational-scope.js), nunca reimplementado inline', () => {
    expect(src).toContain('findCarriedOverSkipForToday(skipsHoy, { equipmentId: e.id, dateISO: todayISODash })');
  });
});

describe('BUG REAL ya corregido en un lote anterior (regresión) — turnoActual declarado ANTES de su primer uso', () => {
  it('const turnoActual = currentShiftId() aparece UNA SOLA VEZ y antes de pendientesTurnoAnterior', () => {
    const ocurrencias = src.match(/const turnoActual = currentShiftId\(\);/g) || [];
    expect(ocurrencias).toHaveLength(1);
    const iDecl = src.indexOf('const turnoActual = currentShiftId();');
    const iUso = src.indexOf('const pendientesTurnoAnterior = equipos.filter(e => {');
    expect(iDecl).toBeGreaterThan(-1);
    expect(iDecl).toBeLessThan(iUso);
  });
});

describe('colaAtencion incluye "Turno anterior" como su propio bucket, entre Vencido y Pendiente hoy', () => {
  it('usa la MISMA lista pendientesTurnoAnterior (sin recalcular) con estado/tono propios', () => {
    expect(src).toContain("...pendientesTurnoAnterior.map(e => ({ estado: 'Turno anterior', tone: 'amber'");
  });
});
