import { describe, it, expect } from 'vitest';
import { loadAppLogic } from '../helpers/loadLubricationLogic.js';

const settings = { shiftDayStart: 6, shiftNightStart: 18 };
const { statusFor } = loadAppLogic({ currentUser: { role: 'PLANIFICADOR' }, generalSettings: settings });
const equipment = { id: 'e-ex', status: 'Operativo', hourmeter: 1200 };
const plan = { id: 'p-ex', equipmentId: 'e-ex', controlType: 'Horas de operación', frequency: 250,
  lastGreaseHour: 1000, requiredShifts: ['shift_dia','shift_noche'], effectiveDate: '2026-10-13' };
const now = new Date(2026, 9, 13, 20, 0);

describe('estado de ocurrencia de excavadora DAY/NIGHT', () => {
  it('DAY complete deja NIGHT pendiente como una obligación independiente', async () => {
    const records = [{ id: 'r-day', equipmentId: equipment.id, shiftId: 'shift_dia', date: '2026-10-13T08:00:00', qty: 2,
      details: [], operationalSnapshot: { operationalDate: '2026-10-13', occurrenceKey: 'p-ex:2026-10-13:shift_dia' } }];
    const night = await statusFor(equipment, [plan], records, { shiftId: 'shift_noche', now, settings });
    expect(night).toMatchObject({ code: 'AMARILLO', label: 'PENDIENTE TURNO NOCHE', occurrenceKey: 'p-ex:2026-10-13:shift_noche' });
    const day = await statusFor(equipment, [plan], records, { shiftId: 'shift_dia', now, settings });
    expect(day).toMatchObject({ code: 'VERDE', label: 'REALIZADO TURNO DÍA' });
  });

  it('un registro con turno distinto no satisface la ocurrencia actual', async () => {
    const records = [{ id: 'r-day', equipmentId: equipment.id, shiftId: 'shift_dia', date: '2026-10-13T08:00:00', qty: 2,
      details: [], operationalSnapshot: { operationalDate: '2026-10-13', occurrenceKey: 'p-ex:2026-10-13:shift_dia' } }];
    expect(await statusFor(equipment, [plan], records, { shiftId: 'shift_noche', now, settings })).toMatchObject({ code: 'AMARILLO', shiftId: 'shift_noche' });
  });

  it('PARTIAL no completa ninguna ocurrencia y la fecha anterior a effectiveDate conserva el plan legacy', async () => {
    const partial = [{ id: 'r-partial', equipmentId: equipment.id, shiftId: 'shift_noche', date: '2026-10-13T20:00:00', qty: 2,
      details: [{ pointId: 'pt1', done: false, reason: 'Pendiente' }], operationalSnapshot: { operationalDate: '2026-10-13', occurrenceKey: 'p-ex:2026-10-13:shift_noche' } }];
    expect(await statusFor(equipment, [plan], partial, { shiftId: 'shift_noche', now, settings })).toMatchObject({ code: 'AMARILLO', partial: partial[0] });
    const before = await statusFor(equipment, [plan], [], { shiftId: 'shift_dia', now: new Date(2026, 9, 12, 8), settings });
    expect(before.plan).toBe(plan);
  });
});
