// tests/unit/weekday-status-adelantado.test.js
//
// Pedido "...REALIZADO ADELANTADO" (2026-10-09), Parte F/H/I. Causa raíz
// confirmada en código ANTES de cambiar nada: la Matriz (estadoCelda())
// YA detectaba "REALIZADO ADELANTADO" vía
// record.operationalSnapshot.satisfiedOccurrenceKey — pero
// weekdayStatusFor() (lubrication-status.js), la fuente real que alimenta
// Dashboard/Mi Turno/KPIs (vía statusFor()/computeAllStatuses()), nunca
// consultaba esa misma señal: un equipo con su ocurrencia de HOY/MAÑANA ya
// satisfecha por adelantado seguía mostrándose como pendiente ahí. Este
// archivo prueba el fix contra la función REAL (loadAppLogic()), nunca una
// reimplementación.

import { describe, it, expect } from 'vitest';
import { loadAppLogic } from '../helpers/loadLubricationLogic.js';
import { loadOperationalScopeLogic } from '../helpers/loadLubricationLogic.js';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const fakeApp = { currentUser: null, generalSettings: {} };
const { weekdayStatusFor } = loadAppLogic(fakeApp);
const { computeOccurrenceKey, buildExecutionSnapshot } = loadOperationalScopeLogic();

function diasDesdeHoy(n) {
  const d = new Date(); d.setHours(10, 0, 0, 0); d.setDate(d.getDate() + n); return d;
}
function weekdayNameOf(d) {
  return ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][d.getDay()];
}

// weekdayStatusFor() se consulta el día de LA OCURRENCIA (ej. el viernes
// real, cuando Dashboard/Mi Turno preguntan "¿viernes está satisfecho?")
// — mostRecentAssignedDate() con el plan programado HOY devuelve HOY
// mismo como `lastDue`. El engrase adelantado real ocurrió AYER (1 día
// antes de `lastDue`), con `satisfiedOccurrenceKey` = la clave de HOY —
// exactamente lo que resolveEarlyOccurrenceSatisfaction() real calcula y
// guarda al registrar un COMPLETE un día antes (fix 2026-10-09 "FIX
// REALIZADO ADELANTADO + QR INTERNO": ya no solo para OUT_OF_PLAN, para
// CUALQUIER executionType — weekdayStatusFor() en sí nunca filtró por
// executionType, solo lee satisfiedOccurrenceKey, confirmado abajo con
// PLANNED/ASSIGNED).
function hoyISO() {
  const d = diasDesdeHoy(0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('A/§21/§24 — plan programado HOY + COMPLETE fuera de plan AYER que satisfizo esta ocurrencia -> REALIZADO ADELANTADO (VERDE + adelantado:true), nunca pendiente', () => {
  it('weekdayStatusFor() lee satisfiedOccurrenceKey — mismo criterio que ya usa la Matriz (estadoCelda())', async () => {
    const hoy = diasDesdeHoy(0);
    const plan = { id: 'plan_a1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [weekdayNameOf(hoy)] };
    const key = computeOccurrenceKey(plan, { dateISO: hoyISO() });
    const records = [{
      id: 'r1', equipmentId: 'e1', date: diasDesdeHoy(-1).toISOString(), userName: 'Juan',
      operationalSnapshot: buildExecutionSnapshot({ executionType: 'OUT_OF_PLAN', outOfPlanReason: 'PM', executionCompleteness: 'COMPLETE', satisfiedOccurrenceKey: key }),
    }];
    const r = await weekdayStatusFor({ id: 'e1', status: 'Operativo' }, plan, records);
    expect(r.code).toBe('VERDE');
    expect(r.label).toBe('REALIZADO ADELANTADO');
    expect(r.adelantado).toBe(true);
    expect(r.satisfactorio.id).toBe('r1');
  });
});

describe('A2/§FIX-ADELANTADO — PLANNED/ASSIGNED COMPLETE AYER satisfacen igual que OUT_OF_PLAN (weekdayStatusFor() nunca filtró por executionType, solo por satisfiedOccurrenceKey)', () => {
  for (const tipo of ['PLANNED', 'ASSIGNED']) {
    it(`executionType=${tipo} con satisfiedOccurrenceKey resuelto -> REALIZADO ADELANTADO, idéntico a OUT_OF_PLAN`, async () => {
      const hoy = diasDesdeHoy(0);
      const plan = { id: 'plan_tipo_' + tipo, equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [weekdayNameOf(hoy)] };
      const key = computeOccurrenceKey(plan, { dateISO: hoyISO() });
      const records = [{
        id: 'r_tipo_' + tipo, equipmentId: 'e1', date: diasDesdeHoy(-1).toISOString(), userName: 'Juan',
        operationalSnapshot: buildExecutionSnapshot({ executionType: tipo, executionCompleteness: 'COMPLETE', satisfiedOccurrenceKey: key, assignmentId: tipo === 'ASSIGNED' ? 'asg1' : null }),
      }];
      const r = await weekdayStatusFor({ id: 'e1', status: 'Operativo' }, plan, records);
      expect(r.code).toBe('VERDE');
      expect(r.label).toBe('REALIZADO ADELANTADO');
      expect(r.adelantado).toBe(true);
      expect(r.satisfactorio.id).toBe('r_tipo_' + tipo);
    });
  }

  it('H — turno de ejecución DIFERENTE del turno programado del plan igual satisface (el matching es por fecha, nunca por turno)', async () => {
    const hoy = diasDesdeHoy(0);
    const plan = { id: 'plan_turno', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [weekdayNameOf(hoy)], shiftId: 'shift_dia' };
    const key = computeOccurrenceKey(plan, { dateISO: hoyISO() });
    const records = [{
      id: 'r_turno', equipmentId: 'e1', date: diasDesdeHoy(-1).toISOString(), userName: 'Juan', shiftId: 'shift_noche',
      operationalSnapshot: buildExecutionSnapshot({ executionType: 'PLANNED', executionCompleteness: 'COMPLETE', satisfiedOccurrenceKey: key }),
    }];
    const r = await weekdayStatusFor({ id: 'e1', status: 'Operativo' }, plan, records);
    expect(r.adelantado).toBe(true);
    expect(r.label).toBe('REALIZADO ADELANTADO');
  });

  it('K — el plan (assignedDays/shiftId) NUNCA se muta al resolver el adelanto — solo lectura', async () => {
    const hoy = diasDesdeHoy(0);
    const plan = { id: 'plan_intacto', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [weekdayNameOf(hoy)], shiftId: 'shift_dia' };
    const planAntes = JSON.parse(JSON.stringify(plan));
    const key = computeOccurrenceKey(plan, { dateISO: hoyISO() });
    const records = [{
      id: 'r_intacto', equipmentId: 'e1', date: diasDesdeHoy(-1).toISOString(), userName: 'Juan',
      operationalSnapshot: buildExecutionSnapshot({ executionType: 'ASSIGNED', executionCompleteness: 'COMPLETE', satisfiedOccurrenceKey: key }),
    }];
    await weekdayStatusFor({ id: 'e1', status: 'Operativo' }, plan, records);
    expect(plan).toEqual(planAntes);
  });
});

describe('B/§25 — PARTIAL ayer NUNCA satisface hoy (resolveEarlyOccurrenceSatisfaction ya rechaza PARTIAL al guardar, sin satisfiedOccurrenceKey en el snapshot)', () => {
  it('sin satisfiedOccurrenceKey (PARTIAL nunca lo recibe) -> hoy sigue pendiente (AMARILLO/ROJO real), nunca VERDE adelantado', async () => {
    const hoy = diasDesdeHoy(0);
    const plan = { id: 'plan_b1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [weekdayNameOf(hoy)] };
    const records = [{
      id: 'r2', equipmentId: 'e1', date: diasDesdeHoy(-1).toISOString(), userName: 'Juan',
      operationalSnapshot: buildExecutionSnapshot({ executionType: 'OUT_OF_PLAN', outOfPlanReason: 'PM', executionCompleteness: 'PARTIAL', satisfiedOccurrenceKey: null }),
    }];
    const r = await weekdayStatusFor({ id: 'e1', status: 'Operativo' }, plan, records);
    expect(r.adelantado).toBeUndefined();
    expect(r.label).not.toBe('REALIZADO ADELANTADO');
    expect(r.code).toBe('AMARILLO'); // PROGRAMADO HOY — sigue pendiente de verdad
  });
});

describe('C/§26 — un SKIP (sin record real) nunca satisface nada, mantiene las reglas actuales', () => {
  it('sin ningún lubrication_record -> hoy sigue pendiente, nunca VERDE adelantado', async () => {
    const hoy = diasDesdeHoy(0);
    const plan = { id: 'plan_c1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [weekdayNameOf(hoy)] };
    const r = await weekdayStatusFor({ id: 'e1', status: 'Operativo' }, plan, []); // ningún record — un skip nunca crea uno
    expect(r.adelantado).toBeUndefined();
    expect(r.code).toBe('AMARILLO');
  });
});

describe('D/§23 — COMPLETE a +2/+3 días (fuera de la ventana de 1 día) nunca queda marcado como adelantado — el matching ya no le asigna satisfiedOccurrenceKey (ver operational-scope.test.js, CASO N actualizado)', () => {
  it('un record viejo (3 días antes) sin satisfiedOccurrenceKey coincidente no marca la ocurrencia de hoy como adelantada', async () => {
    const hoy = diasDesdeHoy(0);
    const plan = { id: 'plan_d1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [weekdayNameOf(hoy)] };
    const records = [{
      id: 'r3', equipmentId: 'e1', date: diasDesdeHoy(-3).toISOString(), userName: 'Juan',
      // Fuera de la ventana real de 1 día -> resolveEarlyOccurrenceSatisfaction()
      // real ya habría devuelto null al guardar esto; se simula ese
      // resultado real (nunca una ocurrencia inventada a mano).
      operationalSnapshot: buildExecutionSnapshot({ executionType: 'OUT_OF_PLAN', outOfPlanReason: 'OTRO', executionCompleteness: 'COMPLETE', satisfiedOccurrenceKey: null }),
    }];
    const r = await weekdayStatusFor({ id: 'e1', status: 'Operativo' }, plan, records);
    expect(r.adelantado).toBeUndefined();
    expect(r.code).toBe('AMARILLO');
  });
});

describe('§1 del pedido "FIX REALIZADO ADELANTADO + QR INTERNO" — app.js llama resolveEarlyOccurrenceSatisfaction() SIEMPRE al guardar, nunca gateado por executionType', () => {
  const startGreaseFlowSrc = extractDeclaration(readSource(APP_JS_PATH), 'startGreaseFlow');

  it('la llamada real NUNCA está condicionada a executionType === \'OUT_OF_PLAN\' (el bug real: antes PLANNED/ASSIGNED quedaban sin satisfiedOccurrenceKey)', () => {
    expect(startGreaseFlowSrc).toContain('resolveEarlyOccurrenceSatisfaction({');
    expect(startGreaseFlowSrc).not.toMatch(/executionTypeDeEsteEngrase === 'OUT_OF_PLAN'\s*\n\s*\?\s*resolveEarlyOccurrenceSatisfaction/);
    expect(startGreaseFlowSrc).not.toContain('resolveOutOfPlanSatisfaction');
  });

  it('completeGreaseAssignmentForOccurrence()/el avance de plan.lastGreaseHour (ocurrencia de HOY) siguen intactos — esto solo agrega la resolución de la ocurrencia de MAÑANA, nunca la reemplaza', () => {
    expect(startGreaseFlowSrc).toContain('completeAssignmentIfPending([asignacionActivaDeEsteEngrase]');
    expect(startGreaseFlowSrc).toContain('occurrenceKey: occurrenceKeyDeEsteEngrase, recordId: record.id');
    expect(startGreaseFlowSrc).toContain('canAdvanceHourCycle({ controlType: plan.controlType, completeness: completenessDeEsteEngrase })');
  });
});
