// tests/unit/notify-edge-functions-eligibility.test.js
//
// Arquitectura de notificaciones (lote 2026-09-30) — §31: "la decisión
// final de push remoto SIEMPRE es server-side". Prueba la función PURA
// isRecipientEligible() REAL de CADA Edge Function (supabase/functions/
// notify-vencidos, notify-push) — deben aplicar la MISMA regla que
// isUserEligibleForNotification() (src/core/notification-routing.js),
// aunque estén reimplementadas por separado (Deno no puede importar el
// bundle del navegador). Solo se prueba esta función pura — el resto de
// cada archivo depende de fetch/Deno.env real y queda fuera de este
// runner (mismo límite ya aceptado para manage-users-logic.test.js).

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { loadNotifyVencidosEligibility, loadNotifyPushEligibility } from '../helpers/loadLubricationLogic.js';

describe('notify-vencidos/index.ts — isRecipientEligible(disp, turnoActual)', () => {
  const { isRecipientEligible } = loadNotifyVencidosEligibility();

  it('A/C. respeta notificationShift: DAY solo en DAY, NIGHT solo en NIGHT', () => {
    expect(isRecipientEligible({ active: true, notificationShift: 'DAY' }, 'DAY')).toBe(true);
    expect(isRecipientEligible({ active: true, notificationShift: 'DAY' }, 'NIGHT')).toBe(false);
    expect(isRecipientEligible({ active: true, notificationShift: 'NIGHT' }, 'NIGHT')).toBe(true);
    expect(isRecipientEligible({ active: true, notificationShift: 'NIGHT' }, 'DAY')).toBe(false);
  });

  it('BOTH (o ausente, filas viejas antes de este lote) coincide con cualquier turno', () => {
    expect(isRecipientEligible({ active: true, notificationShift: 'BOTH' }, 'DAY')).toBe(true);
    expect(isRecipientEligible({ active: true }, 'NIGHT')).toBe(true);
  });

  it('E. RESTING nunca es elegible, sin importar turno', () => {
    expect(isRecipientEligible({ active: true, notificationShift: 'DAY', notificationAvailability: 'RESTING' }, 'DAY')).toBe(false);
  });

  it('F/G. receiveAllShifts ignora el turno; sin él, se respeta igual que cualquiera', () => {
    expect(isRecipientEligible({ active: true, notificationShift: 'DAY', receiveAllShifts: true }, 'NIGHT')).toBe(true);
    expect(isRecipientEligible({ active: true, notificationShift: 'DAY', receiveAllShifts: false }, 'NIGHT')).toBe(false);
  });

  it('active:false nunca es elegible (distinto de RESTING)', () => {
    expect(isRecipientEligible({ active: false, notificationAvailability: 'AVAILABLE' }, 'DAY')).toBe(false);
  });
});

describe('notify-push/index.ts — isRecipientEligible(disp, roles, turnoActual) — también filtra por rol y exige token', () => {
  const { isRecipientEligible } = loadNotifyPushEligibility();

  it('filtra por rol además de turno/disponibilidad', () => {
    const disp = { active: true, token: 'sub1', role: 'SUPERVISOR', notificationShift: 'BOTH' };
    expect(isRecipientEligible(disp, ['SUPERVISOR'], 'DAY')).toBe(true);
    expect(isRecipientEligible(disp, ['ADMINISTRADOR'], 'DAY')).toBe(false);
  });

  it('sin token: nunca elegible (nada que reclamar)', () => {
    const disp = { active: true, token: null, role: 'SUPERVISOR', notificationShift: 'BOTH' };
    expect(isRecipientEligible(disp, ['SUPERVISOR'], 'DAY')).toBe(false);
  });

  it('RESTING excluye igual que en notify-vencidos', () => {
    const disp = { active: true, token: 'sub1', role: 'SUPERVISOR', notificationAvailability: 'RESTING' };
    expect(isRecipientEligible(disp, ['SUPERVISOR'], 'DAY')).toBe(false);
  });

  it('receiveAllShifts ignora el turno igual que en notify-vencidos', () => {
    const disp = { active: true, token: 'sub1', role: 'ADMINISTRADOR', notificationShift: 'DAY', receiveAllShifts: true };
    expect(isRecipientEligible(disp, ['ADMINISTRADOR'], 'NIGHT')).toBe(true);
  });

  it('lista de roles vacía: nunca elegible (nunca se interpreta como "cualquiera")', () => {
    const disp = { active: true, token: 'sub1', role: 'SUPERVISOR', notificationShift: 'BOTH' };
    expect(isRecipientEligible(disp, [], 'DAY')).toBe(false);
  });
});

describe('notify-push/index.ts — el aviso de ejecución conserva la ocurrencia del turno', () => {
  const source = readSource(path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/functions/notify-push/index.ts'));
  const executionContextLabel = new Function(`${extractDeclaration(source, 'executionContextLabel')}; return executionContextLabel;`)();

  it('incluye turno y fecha operativa, incluso si la fecha real UTC cruza medianoche', () => {
    expect(executionContextLabel({ shiftId: 'shift_noche', date: '2026-10-14T02:00:00Z',
      operationalSnapshot: { operationalDate: '2026-10-13' } })).toBe('NOCHE · 2026-10-13');
    expect(executionContextLabel({ shiftId: 'shift_dia', operationalSnapshot: { operationalDate: '2026-10-13' } })).toBe('DÍA · 2026-10-13');
  });

  it('mantiene compatibilidad con registros legacy sin contexto de turno', () => {
    expect(executionContextLabel({})).toBe('');
  });
});

describe('notify-vencidos/index.ts — independencia de ocurrencias DAY/NIGHT', () => {
  const source = readSource(path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/functions/notify-vencidos/index.ts'));
  const findRecord = extractDeclaration(source, 'findRecordForNotificationOccurrence');
  const getOutstandingDualOccurrences = new Function(
    `${findRecord}; ${extractDeclaration(source, 'getOutstandingDualOccurrences')}; return getOutstandingDualOccurrences;`
  )();
  const findRecordForNotificationOccurrence = new Function(
    `${findRecord}; return findRecordForNotificationOccurrence;`
  )();
  const day = { equipmentId: 'E1', shiftId: 'shift_dia', operationalSnapshot: {
    operationalDate: '2026-10-13', shiftId: 'shift_dia', occurrenceKey: 'P1:2026-10-13:shift_dia',
  } };

  it('DAY completo no satisface NIGHT de la misma fecha', () => {
    expect(findRecordForNotificationOccurrence([day], {
      equipmentId: 'E1', operationalDate: '2026-10-13', shiftId: 'shift_noche',
      occurrenceKey: 'P1:2026-10-13:shift_noche',
    })).toBeUndefined();
  });

  it('cada ocurrencia solo encuentra su propio turno y snapshot', () => {
    expect(findRecordForNotificationOccurrence([day], {
      equipmentId: 'E1', operationalDate: '2026-10-13', shiftId: 'shift_dia',
      occurrenceKey: 'P1:2026-10-13:shift_dia',
    })).toBe(day);
  });

  it('rechaza registros sin snapshot de ocurrencia para evitar inferir un turno histórico', () => {
    expect(findRecordForNotificationOccurrence([{ equipmentId: 'E1', shiftId: 'shift_dia', date: '2026-10-13' }], {
      equipmentId: 'E1', operationalDate: '2026-10-13', shiftId: 'shift_dia',
      occurrenceKey: 'P1:2026-10-13:shift_dia',
    })).toBeUndefined();
  });

  it('DAY completo conserva NIGHT como pendiente para esa fecha', () => {
    const outstanding = getOutstandingDualOccurrences({
      plan: { id: 'P1', effectiveDate: '2026-10-01', requiredShifts: ['shift_dia', 'shift_noche'] },
      equipment: { id: 'E1', code: 'EX-1' }, records: [day], operationalDate: '2026-10-13',
    });
    expect(outstanding.map(({ shiftId, occurrenceKey }) => [shiftId, occurrenceKey])).toEqual([
      ['shift_noche', 'P1:2026-10-13:shift_noche'],
    ]);
  });

  it('no genera ocurrencias duales antes de effectiveDate', () => {
    expect(getOutstandingDualOccurrences({
      plan: { id: 'P1', effectiveDate: '2026-10-14', requiredShifts: ['shift_dia', 'shift_noche'] },
      equipment: { id: 'E1' }, records: [day], operationalDate: '2026-10-13',
    })).toEqual([]);
  });
});

describe('Edge Functions — calendario operacional America/Managua', () => {
  const vencidosSource = readSource(path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/functions/notify-vencidos/index.ts'));
  const pushSource = readSource(path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/functions/notify-push/index.ts'));
  const operationalDateParts = new Function(
    `const OPERATIONAL_TIME_ZONE = 'America/Managua'; ${extractDeclaration(vencidosSource, 'operationalDateParts')}; return operationalDateParts;`
  )();
  const operationalHour = new Function(
    `const OPERATIONAL_TIME_ZONE = 'America/Managua'; ${extractDeclaration(pushSource, 'operationalHour')}; return operationalHour;`
  )();

  it('calcula fecha/turno de negocio sin depender de la zona horaria del runtime Edge', () => {
    const afterUtcMidnight = new Date('2026-10-14T02:15:00.000Z'); // 20:15 del 13 en Nicaragua
    expect(operationalDateParts(afterUtcMidnight)).toEqual({ dateISO: '2026-10-13', hour: 20, weekdayIndex: 2 });
    expect(operationalHour(afterUtcMidnight)).toBe(20);
  });

  it('reconoce el inicio del día operacional y conserva fecha del calendario local', () => {
    const dayStart = new Date('2026-10-13T12:00:00.000Z'); // 06:00 en Nicaragua
    expect(operationalDateParts(dayStart)).toEqual({ dateISO: '2026-10-13', hour: 6, weekdayIndex: 2 });
  });
});
