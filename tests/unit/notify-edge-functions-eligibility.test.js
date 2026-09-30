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
