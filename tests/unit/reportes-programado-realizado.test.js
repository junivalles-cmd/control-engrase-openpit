// tests/unit/reportes-programado-realizado.test.js
//
// computeProgramadoRealizadoPeriodo() (src/core/plan-compliance.js) — base
// del nuevo reporte principal de Reportes: REALIZADOS/PROGRAMADOS por rango
// de fechas, SOLO planes "Día y turno de la semana" (planes por Horas
// excluidos a propósito, ver cabecera del archivo — no se inventa una
// proyección horómetro→fecha). Mismo patrón ya aprobado en el Dashboard
// ("Cumplimiento operativo"), generalizado a un rango arbitrario de días en
// vez de Hoy/Semana.

import { describe, it, expect } from 'vitest';
import { loadPlanComplianceLogic } from '../helpers/loadLubricationLogic.js';

const { computeProgramadoRealizadoPeriodo } = loadPlanComplianceLogic();

function dias(desdeISO, hastaISO) {
  const out = [];
  for (let d = new Date(desdeISO); d <= new Date(hastaISO); d.setDate(d.getDate() + 1)) out.push(new Date(d));
  return out;
}

// Lunes 2026-09-21 a Domingo 2026-09-27 (semana completa conocida)
const SEMANA = dias('2026-09-21T00:00:00', '2026-09-27T00:00:00');

describe('Plan Día/Turno con turno FIJO (Día) — cada día asignado es 1 programado, solo cuenta ESE turno', () => {
  const equipo = { id: 'e1', code: 'T-06' };
  const plan = { equipmentId: 'e1', assignedDays: ['Lunes', 'Miércoles', 'Viernes'], shiftId: 'shift_dia' };
  const planByEquipoId = { e1: plan };

  it('3 días asignados en la semana → 3 programados; sin registros → 0 realizados', () => {
    const r = computeProgramadoRealizadoPeriodo([equipo], [], planByEquipoId, SEMANA);
    expect(r.general).toEqual({ programados: 3, realizados: 0 });
    expect(r.porEquipo).toEqual([{ e: equipo, programados: 3, realizados: 0 }]);
  });

  it('un registro en Lunes turno Día cuenta como realizado; en Lunes turno Noche NO (turno fijo del plan)', () => {
    const records = [{ equipmentId: 'e1', date: '2026-09-21T08:00:00', shiftId: 'shift_dia' }];
    const r1 = computeProgramadoRealizadoPeriodo([equipo], records, planByEquipoId, SEMANA);
    expect(r1.general.realizados).toBe(1);

    const recordsNoche = [{ equipmentId: 'e1', date: '2026-09-21T20:00:00', shiftId: 'shift_noche' }];
    const r2 = computeProgramadoRealizadoPeriodo([equipo], recordsNoche, planByEquipoId, SEMANA);
    expect(r2.general.realizados).toBe(0); // el plan exige turno Día, no cuenta
  });

  it('porTurno: todo el programado cae en shift_dia, shift_noche queda en 0/0', () => {
    const r = computeProgramadoRealizadoPeriodo([equipo], [], planByEquipoId, SEMANA);
    expect(r.porTurno.shift_dia.programados).toBe(3);
    expect(r.porTurno.shift_noche).toEqual({ programados: 0, realizados: 0 });
  });

  it('un día NO asignado (ej. Martes) nunca cuenta como programado aunque se registre un engrase', () => {
    const records = [{ equipmentId: 'e1', date: '2026-09-22T08:00:00', shiftId: 'shift_dia' }]; // Martes
    const r = computeProgramadoRealizadoPeriodo([equipo], records, planByEquipoId, SEMANA);
    expect(r.general).toEqual({ programados: 3, realizados: 0 });
  });
});

describe('Plan SIN turno fijo (aplica a ambos) — cuenta 1 vez en "general" pero en AMBOS turnos en "porTurno"', () => {
  const equipo = { id: 'e2', code: 'EXC-02' };
  const plan = { equipmentId: 'e2', assignedDays: ['Lunes'], shiftId: null };
  const planByEquipoId = { e2: plan };

  it('1 día asignado en la semana → general.programados = 1 (no 2, aunque el plan sea flexible)', () => {
    const r = computeProgramadoRealizadoPeriodo([equipo], [], planByEquipoId, SEMANA);
    expect(r.general.programados).toBe(1);
  });

  it('porTurno: el mismo día programado cuenta 1 vez en CADA turno (oportunidad independiente)', () => {
    const r = computeProgramadoRealizadoPeriodo([equipo], [], planByEquipoId, SEMANA);
    expect(r.porTurno.shift_dia.programados).toBe(1);
    expect(r.porTurno.shift_noche.programados).toBe(1);
  });

  it('un registro en CUALQUIER turno ese día cuenta como realizado en "general"', () => {
    const records = [{ equipmentId: 'e2', date: '2026-09-21T20:00:00', shiftId: 'shift_noche' }];
    const r = computeProgramadoRealizadoPeriodo([equipo], records, planByEquipoId, SEMANA);
    expect(r.general.realizados).toBe(1);
    expect(r.porTurno.shift_noche.realizados).toBe(1);
    expect(r.porTurno.shift_dia.realizados).toBe(0); // no hubo registro en turno Día ese día
  });
});

describe('turnoFiltro — restringe TODO el cálculo (general y porEquipo) a un solo turno', () => {
  const equipo = { id: 'e2', code: 'EXC-02' };
  const plan = { equipmentId: 'e2', assignedDays: ['Lunes'], shiftId: null };
  const planByEquipoId = { e2: plan };

  it('con turnoFiltro="shift_noche", un plan flexible solo cuenta programado para ese turno', () => {
    const r = computeProgramadoRealizadoPeriodo([equipo], [], planByEquipoId, SEMANA, 'shift_noche');
    expect(r.general.programados).toBe(1);
    expect(r.porTurno.shift_dia.programados).toBe(0);
    expect(r.porTurno.shift_noche.programados).toBe(1);
  });

  it('con turnoFiltro="shift_dia" sobre un plan de turno fijo Noche, no programa nada', () => {
    const planNoche = { equipmentId: 'e3', assignedDays: ['Lunes'], shiftId: 'shift_noche' };
    const eq3 = { id: 'e3', code: 'CIS-03' };
    const r = computeProgramadoRealizadoPeriodo([eq3], [], { e3: planNoche }, SEMANA, 'shift_dia');
    expect(r.general).toEqual({ programados: 0, realizados: 0 });
  });
});

describe('Varios equipos — porEquipo desglosa correctamente, orden de entrada preservado (el orden final lo decide quien llama)', () => {
  it('2 equipos con distinto cumplimiento', () => {
    const equipos = [{ id: 'e1', code: 'A' }, { id: 'e2', code: 'B' }];
    const planByEquipoId = {
      e1: { equipmentId: 'e1', assignedDays: ['Lunes', 'Martes'], shiftId: null },
      e2: { equipmentId: 'e2', assignedDays: ['Lunes'], shiftId: null },
    };
    const records = [
      { equipmentId: 'e1', date: '2026-09-21T08:00:00', shiftId: 'shift_dia' }, // Lunes de e1: realizado
      // Martes de e1: NO realizado
      // Lunes de e2: NO realizado
    ];
    const r = computeProgramadoRealizadoPeriodo(equipos, records, planByEquipoId, SEMANA);
    expect(r.porEquipo).toEqual([
      { e: equipos[0], programados: 2, realizados: 1 },
      { e: equipos[1], programados: 1, realizados: 0 },
    ]);
    expect(r.general).toEqual({ programados: 3, realizados: 1 });
  });
});

describe('Sin equipos con plan Día/Turno en el conjunto filtrado → 0/0, nunca NaN/Infinity', () => {
  it('lista vacía de equiposDT', () => {
    const r = computeProgramadoRealizadoPeriodo([], [], {}, SEMANA);
    expect(r.general).toEqual({ programados: 0, realizados: 0 });
    expect(r.porEquipo).toEqual([]);
  });
});
