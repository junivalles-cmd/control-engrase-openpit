import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { loadOperationalScopeLogic } from '../helpers/loadLubricationLogic.js';

const source = readSource(path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js'));
const nextDualShiftReminderTime = new Function(
  `${extractDeclaration(source, 'nextDualShiftReminderTime')}; return nextDualShiftReminderTime;`
)();
const occurrenceEngine = loadOperationalScopeLogic();
const buildDualShiftNotificationGroups = new Function(
  'generateOccurrences', 'resolveOccurrenceState',
  `${extractDeclaration(source, 'localDateISO')};
   ${extractDeclaration(source, 'nextDualShiftReminderTime')};
   ${extractDeclaration(source, 'avisosPausados')};
   ${extractDeclaration(source, 'buildDualShiftNotificationGroups')};
   return buildDualShiftNotificationGroups;`
)(occurrenceEngine.generateOccurrences, occurrenceEngine.resolveOccurrenceState);

describe('recordatorio local por ocurrencia dual', () => {
  const settings = { shiftDayStart: 6, shiftNightStart: 18 };

  it('usa la hora configurada cuando cae dentro del turno Día', () => {
    const result = nextDualShiftReminderTime({
      operationalDate: '2026-10-14', shiftId: 'shift_dia', cfg: { hour: 7, minute: 15 },
      settings, now: new Date(2026, 9, 14, 5, 0),
    });
    expect(result.getTime()).toBe(new Date(2026, 9, 14, 7, 15).getTime());
  });

  it('mueve una hora diurna al inicio configurado del turno Noche', () => {
    const result = nextDualShiftReminderTime({
      operationalDate: '2026-10-14', shiftId: 'shift_noche', cfg: { hour: 7, minute: 0 },
      settings, now: new Date(2026, 9, 14, 12, 0),
    });
    expect(result.getTime()).toBe(new Date(2026, 9, 14, 18, 0).getTime());
  });

  it('mantiene la hora nocturna posterior a medianoche dentro de la ocurrencia que comenzó el día anterior', () => {
    const result = nextDualShiftReminderTime({
      operationalDate: '2026-10-14', shiftId: 'shift_noche', cfg: { hour: 5, minute: 30 },
      settings, now: new Date(2026, 9, 14, 18, 0),
    });
    expect(result.getTime()).toBe(new Date(2026, 9, 15, 5, 30).getTime());
  });

  it('no programa para hoy cuando la hora de la ocurrencia ya pasó', () => {
    const result = nextDualShiftReminderTime({
      operationalDate: '2026-10-14', shiftId: 'shift_dia', cfg: { hour: 7, minute: 0 },
      settings, now: new Date(2026, 9, 14, 8, 0),
    });
    expect(result).toBeNull();
  });

  it('si DAY está completo, deja únicamente el recordatorio pendiente de NIGHT', () => {
    const plan = { id: 'P1', equipmentId: 'E1', controlType: 'Día y turno de la semana',
      assignedDays: ['Martes'], requiredShifts: ['shift_dia', 'shift_noche'], effectiveDate: '2026-10-01' };
    const equipment = { id: 'E1', code: 'EX-1', status: 'Operativo' };
    const dayRecord = { id: 'R1', equipmentId: 'E1', shiftId: 'shift_dia', qty: 1, details: [],
      operationalSnapshot: { shiftId: 'shift_dia', operationalDate: '2026-10-13', occurrenceKey: 'P1:2026-10-13:shift_dia' } };
    const groups = buildDualShiftNotificationGroups({
      plans: [plan], equipos: [equipment], records: [dayRecord], assignments: [], skips: [],
      settings, cfg: { hour: 6, minute: 0 }, now: new Date(2026, 9, 13, 5, 0),
      canReceiveShift: () => true, canReceiveEquipment: () => true,
    });
    expect(groups.map(({ operationalDate, shiftId, items }) => [operationalDate, shiftId, items.length])).toEqual([
      ['2026-10-13', 'shift_noche', 1],
    ]);
  });

  it('sin ejecución prepara recordatorios separados para DAY y NIGHT', () => {
    const plan = { id: 'P1', equipmentId: 'E1', controlType: 'Día y turno de la semana',
      assignedDays: ['Martes'], requiredShifts: ['shift_dia', 'shift_noche'], effectiveDate: '2026-10-01' };
    const groups = buildDualShiftNotificationGroups({
      plans: [plan], equipos: [{ id: 'E1', code: 'EX-1', status: 'Operativo' }],
      records: [], assignments: [], skips: [], settings,
      cfg: { hour: 6, minute: 0 }, now: new Date(2026, 9, 13, 5, 0),
      canReceiveShift: () => true, canReceiveEquipment: () => true,
    });
    expect(groups.map(({ shiftId }) => shiftId)).toEqual(['shift_dia', 'shift_noche']);
  });
});
