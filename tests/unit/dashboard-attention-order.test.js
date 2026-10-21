// tests/unit/dashboard-attention-order.test.js
//
// Rediseño estructural del Dashboard (cierre Parte D) — "Requieren atención"
// (D): orden fijo Vencido > Turno anterior > Pendiente hoy > Próximo > Sin
// plan > Pausado, y auditoría explícita de no-double-count (§15 del pedido):
// una occurrence no debe contar simultáneamente en dos estados incompatibles
// de la cola. Prueba a nivel de FUENTE, mismo criterio que el resto.

import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const src = extractDeclaration(appSource, 'renderDashboard');
const LUBRICATION_STATUS_PATH = path.join(path.dirname(APP_JS_PATH), 'src/core/lubrication-status.js');

describe('colaAtencion — orden fijo por prioridad', () => {
  it('Vencido > Turno anterior > Pendiente hoy > Próximo > Sin plan > Pausado', () => {
    const iCola = src.indexOf('const colaAtencion = [');
    const orden = [
      "vencidos.map(x =>",
      "pendientesTurnoAnterior.map(e =>",
      "pendientesHoyList.map(e =>",
      "proximosSinHoy.map(x =>",
      "sinPlan].sort",
      "pausados.map(e =>",
    ];
    let cursor = iCola;
    orden.forEach(fragmento => {
      const pos = src.indexOf(fragmento, cursor);
      expect(pos, `falta "${fragmento}" después de la posición ${cursor}`).toBeGreaterThan(-1);
      cursor = pos + 1;
    });
  });
});

describe('§15 — no double count: "Pendientes hoy" y "Próximos" son mutuamente excluyentes', () => {
  it('"Pendientes hoy" deriva de las ocurrencias todavía abiertas del mismo universo usado por Cumplimiento Hoy', () => {
    expect(src).toContain('const pendientesHoyOcurrencias = ocurrenciasHoy.filter(occurrence => !occurrenceIsComplete(occurrence));');
    expect(src).toContain('const pendientesHoyIds = new Set(pendientesHoyOcurrencias.map(o => o.e.id));');
    expect(src).toContain('const pendientesHoyList = progHoy.filter(e => pendientesHoyIds.has(e.id));');
  });

  it('"Próximos" excluye explícitamente lo que weekdayStatusFor() etiquetó "PROGRAMADO HOY" (mismo campo que ya usa el semáforo, no un criterio inventado)', () => {
    expect(src).toContain("proximos.filter(x => x.s.label !== 'PROGRAMADO HOY')");
  });

  it('"Próximos" también incluye equipos Día/turno "al día" (VERDE) cuyo próximo día asignado es MAÑANA — sin mutar `x.s` original (alDia/counts no cambian)', () => {
    expect(src).toContain("const proximosDiaTurnoManana = alDia");
    expect(src).toContain("plan.controlType !== 'Día y turno de la semana'");
    expect(src).toContain("return (plan.assignedDays || []).includes(mananaWeekday);");
    expect(src).toContain("s: { ...x.s, code: 'AMARILLO', label: 'PROGRAMADO MAÑANA', scheduleDate: mananaDate }");
    expect(src).toContain("const proximosSinHoy = [...proximos.filter(x => x.s.label !== 'PROGRAMADO HOY'), ...proximosDiaTurnoManana];");
  });

  it('respeta reprogramadoHasta — si el equipo ya fue reprogramado a OTRA fecha (no mañana), no avisa un día que ya no aplica esta semana', () => {
    expect(src).toContain('if (x.s.reprogramado) return x.s.scheduleDate && x.s.scheduleDate.getTime() === mananaDate.getTime();');
  });

  it('el KPI y la cola de atención usan proximosSinHoy (nunca `proximos` crudo) — así el número mostrado y la lista siempre coinciden', () => {
    expect(src).toContain("dashHeroCard('Próximos', proximosSinHoy.length");
    expect(src).toContain('proximosSinHoy.map(x =>');
    // El modal de detalle también usa la lista sin duplicado (mismo número que el KPI).
    expect(src).toContain("openDashStatusModal('Próximos a engrase', `${proximosSinHoy.length}");
  });
});

describe('§15 — no double count: "Vencidos" (semáforo ROJO) y "Pendientes hoy" (plan día/turno de hoy) son mutuamente excluyentes por construcción', () => {
  it('weekdayStatusFor() (lubrication-status.js) solo devuelve ROJO cuando el día MÁS RECIENTE asignado no es hoy — si hoy es día asignado, lastDue siempre es hoy (isToday=true), nunca ROJO', () => {
    const statusSrc = readSource(LUBRICATION_STATUS_PATH);
    expect(statusSrc).toContain('const isToday = lastDue.toDateString() === new Date().toDateString();');
    expect(statusSrc).toContain("if (isToday) return { code: 'AMARILLO', label: 'PROGRAMADO HOY'");
    expect(statusSrc).toContain("return { code: 'ROJO', label: 'VENCIDO'");
    // mostRecentAssignedDate() busca hacia atrás EMPEZANDO por hoy (back=0) — si
    // hoy está en assignedDays, siempre gana antes de llegar a un día anterior.
    expect(statusSrc).toContain('for (let back = 0; back < 7; back++) {');
  });
});

describe('§15 — no double count: "Pendiente turno anterior" excluye lo ya realizado hoy (BUG REAL corregido en este lote)', () => {
  it('pendientesTurnoAnterior descarta cualquier equipo con un lubrication_record real de HOY, sin importar el turno del registro', () => {
    expect(src).toContain('const yaEngrasadoHoy = records.some(r => r.equipmentId === e.id && new Date(r.date).toDateString() === today);');
    expect(src).toContain('return !yaEngrasadoHoy;');
  });
});

describe('§15 — no double count: G (Assignments/Fuera de plan/No ejecutados) usa conjuntos con fuentes distintas de D/E, nunca sumados a los KPI de arriba', () => {
  it('assignmentsActivas filtra SOLO status PENDING (vida de la asignación) — distinto del estado de equipo (vencido/próximo) y de recordsOutOfPlanHoy (registros ya completados)', () => {
    expect(src).toContain('a.active !== false && a.status === ASSIGNMENT_STATUS.PENDING && equipoIdsFiltrados.has(a.equipmentId)');
  });

  it('recordsOutOfPlanHoy son lubrication_records reales de HOY con EXECUTION_TYPE.OUT_OF_PLAN — nunca se suma a doneToday ni a ningún KPI de "Requieren atención"', () => {
    expect(src).toContain('const recordsOutOfPlanHoy = recordsHoy.filter(r => resolveRecordExecutionType(r).value === EXECUTION_TYPE.OUT_OF_PLAN);');
    // La sección G se renderiza en su propio bloque (dash-panel-operativo),
    // nunca dentro de dash-hero-grid (B) ni de colaAtencion (D).
    const iG = src.indexOf('dash-panel-operativo');
    const iHero = src.indexOf('dash-hero-grid');
    const iCola = src.indexOf('const colaAtencion = [');
    expect(iG).toBeGreaterThan(iHero);
    const seccionG = src.slice(iG, iG + 900);
    expect(seccionG).not.toContain('colaAtencion');
    expect(iCola).toBeLessThan(iG);
  });
});
