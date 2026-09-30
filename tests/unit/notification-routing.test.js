// tests/unit/notification-routing.test.js
//
// Arquitectura de notificaciones (usuario+turno+disponibilidad+scope, lote
// 2026-09-30, pedido explícito del usuario) contra la función REAL de
// src/core/notification-routing.js. ROL ≠ TURNO: el rol decide QUÉ tipo de
// aviso; el turno de notificación decide CUÁNDO; la disponibilidad decide
// si AHORA; el scope (fuera de este módulo, ver operational-scope.js) para
// qué operación/equipos/ubicación. NO se crean roles de turno nuevos.
//
// Cubre los escenarios obligatorios A-H, N-Q, S del pedido (I/J/K/L/M/R/T
// se cubren en tests/unit/onesignal-identity.test.js y en las specs de
// Edge Functions correspondientes, no aquí — este archivo es 100% lógica
// pura, sin DB/OneSignal/red).

import { describe, it, expect } from 'vitest';
import { loadNotificationRoutingLogic } from '../helpers/loadLubricationLogic.js';

const {
  NOTIFICATION_SHIFT, NOTIFICATION_AVAILABILITY,
  shiftIdToNotificationShift, notificationShiftMatches,
  isUserEligibleForNotification, resolveEligibleRecipients,
  NO_EXECUTION_NOTIFICATION_ROUTE, routeNoExecutionEvent,
  shouldNotifyOutOfPlanCompletion,
  ANOMALY_NOTIFICATION_ROUTE, routeAnomalyEvent,
  buildNotificationDedupeKey,
} = loadNotificationRoutingLogic();

// Ejemplo literal del pedido (§5): Carlos (SUPERVISOR, DAY) y Pedro
// (SUPERVISOR, NIGHT), evento a las 22:00 en Volcán.
const carlos = { id: 'u_carlos', role: 'SUPERVISOR', active: true, notificationShift: 'DAY', notificationAvailability: 'AVAILABLE' };
const pedro = { id: 'u_pedro', role: 'SUPERVISOR', active: true, notificationShift: 'NIGHT', notificationAvailability: 'AVAILABLE' };

describe('shiftIdToNotificationShift()/notificationShiftMatches() — mapeo DAY/NIGHT', () => {
  it('shift_dia -> DAY, shift_noche -> NIGHT', () => {
    expect(shiftIdToNotificationShift('shift_dia')).toBe('DAY');
    expect(shiftIdToNotificationShift('shift_noche')).toBe('NIGHT');
  });
  it('BOTH siempre coincide, DAY/NIGHT solo coinciden con ellos mismos', () => {
    expect(notificationShiftMatches('BOTH', 'DAY')).toBe(true);
    expect(notificationShiftMatches('BOTH', 'NIGHT')).toBe(true);
    expect(notificationShiftMatches('DAY', 'DAY')).toBe(true);
    expect(notificationShiftMatches('DAY', 'NIGHT')).toBe(false);
    expect(notificationShiftMatches('NIGHT', 'DAY')).toBe(false);
  });
});

describe('isUserEligibleForNotification() — escenarios obligatorios A-H del pedido', () => {
  it('A. Supervisor Día (Carlos) recibe un evento en turno Día', () => {
    expect(isUserEligibleForNotification({ user: carlos, currentShiftId: 'shift_dia' })).toBe(true);
  });

  it('B. Supervisor Día (Carlos) NO recibe un evento en turno Noche', () => {
    expect(isUserEligibleForNotification({ user: carlos, currentShiftId: 'shift_noche' })).toBe(false);
  });

  it('C. Supervisor Noche (Pedro) recibe un evento en turno Noche', () => {
    expect(isUserEligibleForNotification({ user: pedro, currentShiftId: 'shift_noche' })).toBe(true);
  });

  it('D. Supervisor Noche (Pedro) NO recibe un evento en turno Día', () => {
    expect(isUserEligibleForNotification({ user: pedro, currentShiftId: 'shift_dia' })).toBe(false);
  });

  it('E. RESTING no recibe, aunque rol y turno sean correctos (Pedro de descanso en su propio turno Noche)', () => {
    const pedroDescansando = { ...pedro, notificationAvailability: 'RESTING' };
    expect(isUserEligibleForNotification({ user: pedroDescansando, currentShiftId: 'shift_noche' })).toBe(false);
  });

  it('F. ADMIN con receiveAllShifts=true recibe en ambos turnos', () => {
    const admin = { id: 'u_admin', role: 'ADMINISTRADOR', active: true, notificationShift: 'DAY', receiveAllShifts: true };
    expect(isUserEligibleForNotification({ user: admin, currentShiftId: 'shift_dia' })).toBe(true);
    expect(isUserEligibleForNotification({ user: admin, currentShiftId: 'shift_noche' })).toBe(true);
  });

  it('G. ADMIN SIN receiveAllShifts respeta su turno igual que cualquiera', () => {
    const admin = { id: 'u_admin2', role: 'ADMINISTRADOR', active: true, notificationShift: 'DAY', receiveAllShifts: false };
    expect(isUserEligibleForNotification({ user: admin, currentShiftId: 'shift_dia' })).toBe(true);
    expect(isUserEligibleForNotification({ user: admin, currentShiftId: 'shift_noche' })).toBe(false);
  });

  it('H. (scope de Lubricador lo impone operational-scope.js/classifyEquipmentWork, no este módulo) — aquí solo se confirma que un LUBRICADOR pasa por la MISMA regla rol/turno/disponibilidad que cualquier otro rol, sin acceso global por turno', () => {
    const lub = { id: 'u_lub', role: 'LUBRICADOR', active: true, notificationShift: 'BOTH', notificationAvailability: 'AVAILABLE' };
    expect(isUserEligibleForNotification({ user: lub, currentShiftId: 'shift_dia' })).toBe(true);
    const lubRestringido = { ...lub, notificationShift: 'NIGHT' };
    expect(isUserEligibleForNotification({ user: lubRestringido, currentShiftId: 'shift_dia' })).toBe(false);
  });

  it('usuario inactivo (active:false) nunca es elegible, sin importar turno/disponibilidad — active=false NUNCA se confunde con RESTING', () => {
    const inactivo = { ...carlos, active: false, notificationAvailability: 'AVAILABLE' };
    expect(isUserEligibleForNotification({ user: inactivo, currentShiftId: 'shift_dia' })).toBe(false);
  });

  it('rolesPermitidos filtra por rol: un rol fuera de la lista nunca es elegible aunque todo lo demás encaje', () => {
    expect(isUserEligibleForNotification({ user: carlos, currentShiftId: 'shift_dia', rolesPermitidos: ['ADMINISTRADOR'] })).toBe(false);
    expect(isUserEligibleForNotification({ user: carlos, currentShiftId: 'shift_dia', rolesPermitidos: ['SUPERVISOR'] })).toBe(true);
  });

  it('sin notificationShift/notificationAvailability definidos (usuario viejo, antes de este lote): default BOTH/AVAILABLE, nunca excluido por un campo que no tiene', () => {
    const viejo = { id: 'u_viejo', role: 'SUPERVISOR', active: true };
    expect(isUserEligibleForNotification({ user: viejo, currentShiftId: 'shift_dia' })).toBe(true);
    expect(isUserEligibleForNotification({ user: viejo, currentShiftId: 'shift_noche' })).toBe(true);
  });

  it('ignoreShift=true (ej. resumen semanal, §20) ignora el turno pero SIGUE respetando active/rol/disponibilidad', () => {
    expect(isUserEligibleForNotification({ user: pedro, currentShiftId: 'shift_dia', ignoreShift: true })).toBe(true);
    const pedroRestingIgnoreShift = { ...pedro, notificationAvailability: 'RESTING' };
    expect(isUserEligibleForNotification({ user: pedroRestingIgnoreShift, currentShiftId: 'shift_dia', ignoreShift: true })).toBe(false);
  });

  it('resolveEligibleRecipients(): del ejemplo del pedido, un evento a las 22:00 (turno Noche) en Volcán solo llega a Pedro, nunca a Carlos', () => {
    const elegibles = resolveEligibleRecipients([carlos, pedro], { currentShiftId: 'shift_noche' });
    expect(elegibles.map(u => u.id)).toEqual(['u_pedro']);
  });

  it('Q. resolveEligibleRecipients() con 0 elegibles devuelve lista vacía — el caller nunca debe armar un resumen vacío a partir de esto', () => {
    const todosRestando = [{ ...carlos, notificationAvailability: 'RESTING' }, { ...pedro, notificationAvailability: 'RESTING' }];
    expect(resolveEligibleRecipients(todosRestando, { currentShiftId: 'shift_dia' })).toEqual([]);
  });
});

describe('routeNoExecutionEvent() — §26, motivos de "no se pudo ejecutar"', () => {
  it('REPARACION/SIN_TIEMPO/NO_DISPONIBLE/OTRO -> NONE (visible en el siguiente turno via carryover, sin spam)', () => {
    expect(routeNoExecutionEvent('REPARACION')).toBe('NONE');
    expect(routeNoExecutionEvent('SIN_TIEMPO')).toBe('NONE');
    expect(routeNoExecutionEvent('NO_DISPONIBLE')).toBe('NONE');
    expect(routeNoExecutionEvent('OTRO')).toBe('NONE');
  });

  it('YA_ENGRASADO (ambiguo) -> RECONCILIATION (Planificador/Admin deben revisar)', () => {
    expect(routeNoExecutionEvent('YA_ENGRASADO')).toBe('RECONCILIATION');
  });

  it('N. CONDICION_INSEGURA -> IMMEDIATE_UNSAFE, nunca espera al siguiente turno', () => {
    expect(routeNoExecutionEvent('CONDICION_INSEGURA')).toBe('IMMEDIATE_UNSAFE');
  });

  it('motivo desconocido/futuro -> NONE por defecto, nunca lanza ni inventa una alerta', () => {
    expect(routeNoExecutionEvent('MOTIVO_QUE_NO_EXISTE_TODAVIA')).toBe('NONE');
  });
});

describe('shouldNotifyOutOfPlanCompletion() — §27', () => {
  it('O. un OUT_OF_PLAN completado NUNCA dispara el push normal de "engrase realizado"', () => {
    expect(shouldNotifyOutOfPlanCompletion()).toBe(false);
  });
});

describe('routeAnomalyEvent() — §28, severidad de anomalías (claves en español: mismo vocabulario real que anomaly.criticality en toda la app)', () => {
  it('Crítica -> inmediata a todos los supervisores elegibles', () => {
    expect(routeAnomalyEvent('Crítica')).toBe('IMMEDIATE_ALL_ELIGIBLE_SUPERVISORS');
  });
  it('Alta -> inmediata a Supervisor, Planificador configurable', () => {
    expect(routeAnomalyEvent('Alta')).toBe('IMMEDIATE_SUPERVISOR_CONFIGURABLE_PLANIFICADOR');
  });
  it('Media/Baja -> solo resumen, nunca push inmediato (evita spam)', () => {
    expect(routeAnomalyEvent('Media')).toBe('SUMMARY');
    expect(routeAnomalyEvent('Baja')).toBe('SUMMARY');
  });
  it('valor desconocido -> SUMMARY por defecto, nunca lanza', () => {
    expect(routeAnomalyEvent('lo-que-sea')).toBe('SUMMARY');
  });
});

describe('buildNotificationDedupeKey() — §30, deduplicación', () => {
  it('S. la MISMA combinación tipo+ocurrencia+destinatario+ventana produce SIEMPRE la misma clave (dos intentos del mismo evento deben coincidir)', () => {
    const k1 = buildNotificationDedupeKey({ notificationType: 'vencidos', occurrenceKey: 'plan_1:2026-09-30', recipientUserId: 'u_carlos', scheduleWindow: '2026-09-30T07:00' });
    const k2 = buildNotificationDedupeKey({ notificationType: 'vencidos', occurrenceKey: 'plan_1:2026-09-30', recipientUserId: 'u_carlos', scheduleWindow: '2026-09-30T07:00' });
    expect(k1).toBe(k2);
  });

  it('cambia si cambia el tipo, la ocurrencia, el destinatario o la ventana (nunca colisiona entre eventos distintos)', () => {
    const base = { notificationType: 'vencidos', occurrenceKey: 'plan_1:2026-09-30', recipientUserId: 'u_carlos', scheduleWindow: '2026-09-30T07:00' };
    const k0 = buildNotificationDedupeKey(base);
    expect(buildNotificationDedupeKey({ ...base, notificationType: 'porEngrasar' })).not.toBe(k0);
    expect(buildNotificationDedupeKey({ ...base, occurrenceKey: 'plan_2:2026-09-30' })).not.toBe(k0);
    expect(buildNotificationDedupeKey({ ...base, recipientUserId: 'u_pedro' })).not.toBe(k0);
    expect(buildNotificationDedupeKey({ ...base, scheduleWindow: '2026-10-01T07:00' })).not.toBe(k0);
  });

  it('sin notificationType o recipientUserId -> lanza, nunca arma una clave incompleta que rompería el dedupe en silencio', () => {
    expect(() => buildNotificationDedupeKey({ recipientUserId: 'u_carlos' })).toThrow();
    expect(() => buildNotificationDedupeKey({ notificationType: 'vencidos' })).toThrow();
  });

  it('occurrenceKey/scheduleWindow ausentes (evento inmediato, sin ocurrencia de plan) caen a defaults propios, nunca undefined en la clave', () => {
    const k = buildNotificationDedupeKey({ notificationType: 'unsafe', recipientUserId: 'u_carlos' });
    expect(k).toBe('unsafe|none|u_carlos|immediate');
  });
});
