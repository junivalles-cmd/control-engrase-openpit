// tests/unit/plan-compliance.test.js
//
// Cumplimiento del plan (src/core/plan-compliance.js) contra la función REAL
// evaluateRecordCompliance()/findPreviousRecord()/computeFleetCompliance().
// 5 estados obligatorios (nunca Sí/No):
// 'anticipado' | 'cumplido' | 'realizado_atrasado' | 'fuera_de_plan' | 'no_evaluable'.
// 'realizado_atrasado' (lote occurrences/carryover): SOLO en Día y turno,
// cuando el día es el correcto pero el registro real quedó en el OTRO turno
// del mismo día — cuenta como cumplimiento en el %, ver computeFleetCompliance().
//
// Trazabilidad: record.planId (ya lo guarda app.js al crear el registro) +
// plan.updatedAt (ya lo guarda stamp() en db.js) — sin campos nuevos. Si el
// plan fue tocado DESPUÉS de la fecha del registro, o no hay planId, o no hay
// registro anterior (plan por horas): 'no_evaluable', nunca se inventa un
// resultado.
//
// TOLERANCIA (Horas de operación, decisión operativa ±10% del intervalo,
// ver docs/PLAN_COMPLIANCE_ANTICIPADO.md): ratio = transcurridas/frequency.
// ratio<0.90 anticipado, 0.90-1.10 cumplido, >1.10 fuera_de_plan. Día/Turno
// NO usa tolerancia — sigue binario, aprobado tal cual.

import { describe, it, expect } from 'vitest';
import { loadPlanComplianceLogic } from '../helpers/loadLubricationLogic.js';

const { evaluateRecordCompliance, findPreviousRecord, computeFleetCompliance } = loadPlanComplianceLogic();

describe('Plan Día/Turno — cumplimiento', () => {
  // 2026-09-24 es jueves.
  const planDiaTurno = {
    id: 'p1', controlType: 'Día y turno de la semana',
    assignedDays: ['Jueves'], shiftId: 'shift_dia',
    updatedAt: '2026-09-01T00:00:00',
  };

  it('día asignado + turno correcto → cumplido', () => {
    const r = { planId: 'p1', date: '2026-09-24T08:00:00', shiftId: 'shift_dia' };
    expect(evaluateRecordCompliance(r, planDiaTurno, null).estado).toBe('cumplido');
  });

  it('día NO asignado → fuera_de_plan', () => {
    const r = { planId: 'p1', date: '2026-09-23T08:00:00', shiftId: 'shift_dia' }; // miércoles
    expect(evaluateRecordCompliance(r, planDiaTurno, null).estado).toBe('fuera_de_plan');
  });

  it('día correcto pero turno equivocado → realizado_atrasado', () => {
    const r = { planId: 'p1', date: '2026-09-24T20:00:00', shiftId: 'shift_noche' };
    expect(evaluateRecordCompliance(r, planDiaTurno, null).estado).toBe('realizado_atrasado');
  });
});

describe('Plan por Horas — cumplimiento (horómetro REAL, nunca fecha proyectada ni avgInterval)', () => {
  const planHoras = { id: 'p2', controlType: 'Horas de operación', frequency: 250, updatedAt: '2026-09-01T00:00:00' };

  it('se realizó dentro de la tolerancia ±10% (ratio 0.92) → cumplido', () => {
    const previo = { hourmeter: 5000, date: '2026-09-10T00:00:00' };
    const r = { planId: 'p2', date: '2026-09-20T00:00:00', hourmeter: 5230 }; // 230/250 = 0.92
    expect(evaluateRecordCompliance(r, planHoras, previo).estado).toBe('cumplido');
  });

  it('se realizó DESPUÉS de vencer (ratio 1.2, fuera de la tolerancia) → fuera_de_plan', () => {
    const previo = { hourmeter: 5000, date: '2026-09-10T00:00:00' };
    const r = { planId: 'p2', date: '2026-09-25T00:00:00', hourmeter: 5300 }; // 300/250 = 1.2
    expect(evaluateRecordCompliance(r, planHoras, previo).estado).toBe('fuera_de_plan');
  });

  it('se realizó demasiado antes (ratio 0.72, por debajo de la tolerancia) → anticipado', () => {
    const previo = { hourmeter: 5000, date: '2026-09-10T00:00:00' };
    const r = { planId: 'p2', date: '2026-09-15T00:00:00', hourmeter: 5180 }; // 180/250 = 0.72
    expect(evaluateRecordCompliance(r, planHoras, previo).estado).toBe('anticipado');
  });

  it('sin registro anterior (primer engrase) → no_evaluable, nunca "cumplido"/"anticipado" por defecto', () => {
    const r = { planId: 'p2', date: '2026-09-10T00:00:00', hourmeter: 5000 };
    expect(evaluateRecordCompliance(r, planHoras, null).estado).toBe('no_evaluable');
  });

  it('registro sin horómetro real (sinHorometro) → no_evaluable', () => {
    const previo = { hourmeter: 5000, date: '2026-09-10T00:00:00' };
    const r = { planId: 'p2', date: '2026-09-20T00:00:00', hourmeter: null };
    expect(evaluateRecordCompliance(r, planHoras, previo).estado).toBe('no_evaluable');
  });
});

describe('Plan por Horas — tolerancia ±10% sobre intervalo de 250h (pedido exacto)', () => {
  const planHoras250 = { id: 'p2', controlType: 'Horas de operación', frequency: 250, updatedAt: '2026-09-01T00:00:00' };
  const previo = { hourmeter: 10000, date: '2026-09-01T00:00:00' };

  const casos = [
    [180, 'anticipado'],
    [224, 'anticipado'],
    [225, 'cumplido'],
    [250, 'cumplido'],
    [275, 'cumplido'],
    [276, 'fuera_de_plan'],
    [350, 'fuera_de_plan'],
  ];

  it.each(casos)('delta %ih (ratio %s) → %s', (delta, esperado) => {
    const r = { planId: 'p2', date: '2026-09-15T00:00:00', hourmeter: previo.hourmeter + delta };
    expect(evaluateRecordCompliance(r, planHoras250, previo).estado).toBe(esperado);
  });
});

describe('computeFleetCompliance() — % de flota a partir de evaluaciones ya calculadas', () => {
  it('cumplido cuenta como cumplimiento, fuera_de_plan como incumplimiento (base = cumplido+fuera_de_plan)', () => {
    const evals = [{ estado: 'cumplido' }, { estado: 'cumplido' }, { estado: 'fuera_de_plan' }];
    const r = computeFleetCompliance(evals);
    expect(r.pct).toBe(67); // 2/3 redondeado
    expect(r.cumplido).toBe(2);
    expect(r.fuera_de_plan).toBe(1);
  });

  it('anticipado es categoría separada — no suma al cumplimiento ni al incumplimiento', () => {
    const evals = [{ estado: 'cumplido' }, { estado: 'fuera_de_plan' }, { estado: 'anticipado' }, { estado: 'anticipado' }];
    const r = computeFleetCompliance(evals);
    expect(r.pct).toBe(50); // 1/(1+1), los 2 anticipados no entran en la base
    expect(r.anticipado).toBe(2);
  });

  it('no_evaluable se excluye del denominador por completo', () => {
    const evals = [{ estado: 'cumplido' }, { estado: 'no_evaluable' }, { estado: 'no_evaluable' }];
    const r = computeFleetCompliance(evals);
    expect(r.pct).toBe(100); // base = 1 (solo el cumplido), no 3
    expect(r.no_evaluable).toBe(2);
  });

  it('sin evaluaciones cumplido/fuera_de_plan (todo no_evaluable o anticipado) → pct null, no se inventa un número', () => {
    const evals = [{ estado: 'no_evaluable' }, { estado: 'anticipado' }];
    const r = computeFleetCompliance(evals);
    expect(r.pct).toBeNull();
  });

  it('realizado_atrasado cuenta como cumplimiento en el %, pero se reporta aparte en counts', () => {
    const evals = [{ estado: 'cumplido' }, { estado: 'realizado_atrasado' }, { estado: 'fuera_de_plan' }];
    const r = computeFleetCompliance(evals);
    expect(r.pct).toBe(67); // (1 cumplido + 1 realizado_atrasado) / 3
    expect(r.realizado_atrasado).toBe(1);
    expect(r.cumplido).toBe(1);
  });
});

describe('No evaluable — histórico sin información suficiente para demostrar qué plan aplicaba', () => {
  it('sin planId en el registro (no se sabe qué plan regía) → no_evaluable', () => {
    const r = { planId: null, date: '2026-09-24T08:00:00', shiftId: 'shift_dia' };
    const plan = { id: 'p1', controlType: 'Día y turno de la semana', assignedDays: ['Jueves'], updatedAt: '2026-01-01' };
    expect(evaluateRecordCompliance(r, plan, null).estado).toBe('no_evaluable');
  });

  it('el plan fue editado DESPUÉS de la fecha del registro → no_evaluable (no se asume el plan actual)', () => {
    const plan = { id: 'p1', controlType: 'Día y turno de la semana', assignedDays: ['Jueves'], shiftId: 'shift_dia', updatedAt: '2026-10-01T00:00:00' };
    const r = { planId: 'p1', date: '2026-09-24T08:00:00', shiftId: 'shift_dia' }; // antes de la edición
    const result = evaluateRecordCompliance(r, plan, null);
    expect(result.estado).toBe('no_evaluable');
    expect(result.motivo).toMatch(/modificado después/i);
  });

  it('plan ya no existe (fue eliminado o su id cambió) → no_evaluable', () => {
    const r = { planId: 'p-viejo', date: '2026-09-24T08:00:00', shiftId: 'shift_dia' };
    expect(evaluateRecordCompliance(r, null, null).estado).toBe('no_evaluable');
  });

  it('el plan NO fue tocado desde la fecha del registro → SÍ es evaluable (no cae en no_evaluable de más)', () => {
    const plan = { id: 'p1', controlType: 'Día y turno de la semana', assignedDays: ['Jueves'], shiftId: 'shift_dia', updatedAt: '2026-09-01T00:00:00' };
    const r = { planId: 'p1', date: '2026-09-24T08:00:00', shiftId: 'shift_dia' };
    expect(evaluateRecordCompliance(r, plan, null).estado).toBe('cumplido');
  });
});

describe('findPreviousRecord() — registro anterior REAL del mismo equipo, por fecha', () => {
  it('encuentra el más reciente ANTERIOR a la fecha del registro dado', () => {
    const records = [
      { id: 'r1', date: '2026-09-01T00:00:00', hourmeter: 100 },
      { id: 'r2', date: '2026-09-10T00:00:00', hourmeter: 150 },
      { id: 'r3', date: '2026-09-20T00:00:00', hourmeter: 200 },
    ];
    const prev = findPreviousRecord(records[2], records);
    expect(prev.id).toBe('r2');
  });

  it('sin registros anteriores devuelve null', () => {
    const records = [{ id: 'r1', date: '2026-09-01T00:00:00', hourmeter: 100 }];
    expect(findPreviousRecord(records[0], records)).toBeNull();
  });
});
