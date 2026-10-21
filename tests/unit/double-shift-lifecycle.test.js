import { describe, expect, it } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, loadOperationalScopeLogic, loadGreaseValidationLogic, loadAppLogic } from '../helpers/loadLubricationLogic.js';
const core = loadOperationalScopeLogic(), validation = loadGreaseValidationLogic();
const render = extractDeclaration(readSource(APP_JS_PATH), 'renderLubricadorHome');
const projectSrc = extractDeclaration(render.replace(/^  /gm, ''), 'projectAssignedShiftWork');
const project = new Function('parseOccurrenceKeyDate', 'computeExecutionCompleteness', 'operationalDateForShift', `${projectSrc};return projectAssignedShiftWork;`)(core.parseOccurrenceKeyDate, core.computeExecutionCompleteness, core.operationalDateForShift);
const settings = { shiftDayStart: 6, shiftNightStart: 18 };
const types = ['Excavadora', 'Articulado', 'Volquete', 'Tractor', 'Cargador', 'Motoniveladora', 'Tipo futuro sin registrar'];
const plan = { id: 'p', equipmentId: 'e', controlType: 'Día y turno de la semana', assignedDays: ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'],
  shiftId: 'shift_dia', requiredShifts: ['shift_dia','shift_noche'], effectiveDate: '2026-10-01' };
const assignment = { id: 'a', equipmentId: 'e', planId: 'p', assignedCrewId: 'c', occurrenceKey: 'p:2026-10-16:shift_dia', active: true, status: 'PENDING' };
const row = { id: 'e', status: 'Operativo', locationId: 'volcan' };
const run = ({ assignments = [assignment], records = [], date = '2026-10-16', shift = 'shift_noche', equipment = row } = {}) => project({
  assignedRows: assignments, equipmentRows: [equipment], planRows: [plan], recordRows: records,
  operationalDate: date, shiftId: shift, now: `${date}T20:00:00`,
});
const complete = { id: 'r', equipmentId: 'e', planId: 'p', date: '2026-10-16T20:00:00', shiftId: 'shift_noche', qty: 2, details: [{ done: true }],
  operationalSnapshot: { assignmentId: 'a', assignedOccurrenceKey: assignment.occurrenceKey, occurrenceKey: assignment.occurrenceKey,
    satisfiedOccurrenceKey: assignment.occurrenceKey, executionCompleteness: 'COMPLETE', operationalDate: '2026-10-16' } };

describe('Persistencia generica de la misma obligacion entre turnos', () => {
  it.each(types)('%s: Dia -> Noche mantiene assignment y occurrence originales una sola vez', type => {
    const work = run({ equipment: { ...row, typeId: type } });
    expect(work).toHaveLength(1);
    expect(work[0]).toMatchObject({ assignmentId: 'a', occurrenceKey: assignment.occurrenceKey, kind: 'CARRYOVER' });
    expect(work[0].assignment).toBe(assignment);
    expect(core.requiredShiftsForEquipmentPlan({ equipment: { typeId: type }, plan, operationalDateISO: '2026-10-16' })).toEqual(plan.requiredShifts);
  });
  it('Noche -> Dia siguiente conserva la fecha operacional anterior', () => {
    const a = { ...assignment, occurrenceKey: 'p:2026-10-16:shift_noche' };
    expect(run({ assignments: [a], date: '2026-10-17', shift: 'shift_dia' })[0]).toMatchObject({ assignmentId: 'a', occurrenceKey: a.occurrenceKey, kind: 'CARRYOVER' });
  });
  it('pendiente por mas de 24h y reinicio no cambian la identidad', () => {
    const persisted = JSON.parse(JSON.stringify(assignment));
    expect(run({ assignments: [persisted], date: '2026-10-20', shift: 'shift_dia' })[0]).toMatchObject({ assignmentId: 'a', occurrenceKey: assignment.occurrenceKey, kind: 'CARRYOVER' });
  });
  it('plan por horometro sin fecha en la clave conserva el arrastre usando la fecha real de asignacion', () => {
    const a = { ...assignment, occurrenceKey: 'p:h:100', createdAt: '2026-10-16T08:00:00' };
    expect(run({ assignments: [a], date: '2026-10-19', shift: 'shift_dia' })[0]).toMatchObject({ occurrenceKey: 'p:h:100', kind: 'CARRYOVER' });
  });
  it('cambio manual solo reclasifica, sin mutar ni crear asignaciones', () => {
    const original = JSON.stringify(assignment);
    expect(run({ shift: 'shift_dia' })[0].kind).toBe('CURRENT');
    expect(run({ shift: 'shift_noche' })[0].kind).toBe('CARRYOVER');
    expect(run({ shift: 'shift_dia' })[0].kind).toBe('CURRENT');
    expect(JSON.stringify(assignment)).toBe(original);
  });
  it('duplicados de la misma occurrence no duplican trabajo; Dia y Noche configurados son obligaciones distintas', () => {
    expect(run({ assignments: [assignment, { ...assignment, id: 'duplicate' }] })).toHaveLength(1);
    const night = { ...assignment, id: 'night', occurrenceKey: 'p:2026-10-16:shift_noche' };
    expect(run({ assignments: [assignment, night] }).map(r => [r.assignmentId,r.kind])).toEqual([['a','CARRYOVER'],['night','CURRENT']]);
  });
  it('ejecutado en turno distinto cierra solo la occurrence programada y no reaparece pendiente de firma', () => {
    expect(run({ records: [complete] })).toEqual([]);
    expect(core.resolveOccurrenceState({ plan, operationalDate: '2026-10-16', shiftId: 'shift_dia', records: [complete] })).toMatchObject({ state: 'COMPLETE', record: { id: 'r' } });
    expect(core.resolveOccurrenceState({ plan, operationalDate: '2026-10-16', shiftId: 'shift_noche', records: [complete] }).state).toBe('PENDING');
    const state = loadAppLogic().dualShiftStatusFor(row, plan, [complete], { shiftId: 'shift_dia', now: '2026-10-16T10:00:00', settings });
    expect(state.code).toBe('VERDE');
  });
  it('partial seguido de complete no mantiene la representacion vieja pendiente', () => {
    const partial = { ...complete, id: 'partial', details: [{ done: false }], operationalSnapshot: { ...complete.operationalSnapshot, executionCompleteness: 'PARTIAL', satisfiedOccurrenceKey: null } };
    expect(run({ records: [partial] })).toHaveLength(1);
    expect(run({ records: [partial,complete] })).toEqual([]);
    expect(core.resolveOccurrenceState({ plan, operationalDate: '2026-10-16', shiftId: 'shift_dia', records: [partial, complete] }).state).toBe('COMPLETE');
  });
  it('tractor ejecutado mantiene el mismo record.id pendiente de validacion multiples dias, y firma posterior lo resuelve', () => {
    const record = JSON.parse(JSON.stringify(complete));
    expect(validation.isRecordPendingValidation(record, [], new Date('2026-10-20T09:00:00'), settings)).toBe(true);
    expect(validation.validationStatusForRecord(record, [], new Date('2026-10-20T09:00:00'), settings)).toBe(validation.VALIDATION_STATUS.VENCIDA);
    const signed = [{ id: 'v', lubricationRecordId: record.id, signerRole: 'OPERADOR', active: true, signedAt: '2026-10-20T09:00:00' }];
    expect(validation.isRecordPendingValidation(record, signed, new Date('2026-10-21'), settings)).toBe(false);
    expect(validation.validationStatusForRecord(record, signed, new Date('2026-10-21'), settings)).toBe(validation.VALIDATION_STATUS.OPERADOR);
    expect(record.id).toBe('r'); expect(record.shiftId).toBe('shift_noche');
  });
  it('COMPLETED y CANCELLED no generan tareas nuevas a partir del equipo', () => {
    for (const status of ['COMPLETED','CANCELLED']) expect(run({ assignments: [{ ...assignment, status }] })).toEqual([]);
  });
  it('ninguna condicion de tipo/codigo puede decidir turnos o persistencia', () => {
    for (const body of [projectSrc, extractDeclaration(readSource(APP_JS_PATH), 'openPlanForm'), extractDeclaration(readSource(APP_JS_PATH), 'openBulkPlanForm'),
      core.requiredShiftsForEquipmentPlan.toString(), core.classifyEquipmentWork.toString()]) {
      expect(body).not.toMatch(/isExcavatorEquipment|equipmentType\s*===|\.typeId|excavatorPlan|containsExcavator/);
    }
  });
});
