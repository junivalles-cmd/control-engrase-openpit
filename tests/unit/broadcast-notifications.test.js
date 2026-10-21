// tests/unit/broadcast-notifications.test.js
//
// BROADCAST_NOTIFICATIONS (2026-10-18) — broadcast_messages/
// broadcast_message_reads (0017, ACTIVE en producción) integrados al
// panel unificado. Cubre SOLO lógica pura, extraída tal cual de
// src/core/tasks-notifications-panel.js (nunca reimplementada): vigencia,
// leído/no-leído, dedupe, badge agregado y no-regresión del panel
// existente (manual_tasks/anomalías/validaciones/asignaciones).
import { describe, it, expect } from 'vitest';
import { loadTasksNotificationsPanelLogic } from '../helpers/loadLubricationLogic.js';

const { buildTasksNotificationsPanel, countPanelBadges } = loadTasksNotificationsPanelLogic();

const EQUIPMENT = [{ id: 'e1', code: '05-0870' }];

function baseArgs(overrides = {}) {
  return {
    anomalies: [], records: [], validations: [], assignments: [], plans: [], equipment: EQUIPMENT,
    manualTasks: [], visibleCrewIds: null, broadcasts: [], readMessageIds: null,
    visibleEquipmentIds: null, myCrewId: 'cq1', currentShiftId: null, todayISO: '2026-10-18',
    now: new Date('2026-10-18T10:00:00.000Z'),
    isRecordPendingValidationFn: () => false, isRecordValidationExpiredFn: () => false,
    parseOccurrenceKeyDateFn: () => null,
    ...overrides,
  };
}

function broadcast(overrides = {}) {
  return {
    id: 'bcast1', title: 'Corte de agua', message: 'No habrá agua en el campamento de 10 a 12.',
    priority: 'IMPORTANTE', targetType: 'ALL_LUBRICATORS', targetId: null,
    createdBy: 'u-admin', createdAt: '2026-10-18T08:00:00.000Z', validFrom: null, validUntil: null,
    ...overrides,
  };
}

describe('buildBroadcastNotices (vía buildTasksNotificationsPanel) — broadcast_messages 0017', () => {
  it('1. mensaje vigente (sin vigencia definida) aparece en notifications, kind=NOTIFICACION', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({ broadcasts: [broadcast()] }));
    const item = panel.notifications.find(n => n.id === 'broadcast:bcast1');
    expect(item).toBeTruthy();
    expect(item.kind).toBe('NOTIFICACION');
    expect(item.type).toBe('BROADCAST');
  });

  it('2. nunca aparece en tasks (nunca TAREA, §3 del pedido)', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({ broadcasts: [broadcast()] }));
    expect(panel.tasks.find(t => t.id === 'broadcast:bcast1')).toBeUndefined();
  });

  it('3. vigente (validFrom <= hoy <= validUntil) se muestra', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({
      broadcasts: [broadcast({ validFrom: '2026-10-10', validUntil: '2026-10-20' })],
    }));
    expect(panel.notifications.find(n => n.id === 'broadcast:bcast1')).toBeTruthy();
  });

  it('4. vencido (validUntil < hoy) NO se muestra en el panel activo', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({
      broadcasts: [broadcast({ validUntil: '2026-10-01' })],
    }));
    expect(panel.notifications.find(n => n.id === 'broadcast:bcast1')).toBeUndefined();
  });

  it('5. programado a futuro (validFrom > hoy) tampoco se muestra todavía', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({
      broadcasts: [broadcast({ validFrom: '2026-11-01' })],
    }));
    expect(panel.notifications.find(n => n.id === 'broadcast:bcast1')).toBeUndefined();
  });

  it('6. no leído: actionType=MARCAR_LEIDA, read=false', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({ broadcasts: [broadcast()], readMessageIds: null }));
    const item = panel.notifications.find(n => n.id === 'broadcast:bcast1');
    expect(item.read).toBe(false);
    expect(item.actionType).toBe('MARCAR_LEIDA');
  });

  it('7. leído (messageId en readMessageIds): read=true, deja de pedir acción', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({ broadcasts: [broadcast()], readMessageIds: new Set(['bcast1']) }));
    const item = panel.notifications.find(n => n.id === 'broadcast:bcast1');
    expect(item.read).toBe(true);
    expect(item.actionType).toBe('BROADCAST_LEIDA_NOOP');
  });

  it('8. prioridad CRITICA/IMPORTANTE/INFORMATIVA se traduce al vocabulario del panel', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({
      broadcasts: [broadcast({ id: 'b-crit', priority: 'CRITICA' }), broadcast({ id: 'b-imp', priority: 'IMPORTANTE' }), broadcast({ id: 'b-info', priority: 'INFORMATIVA' })],
    }));
    const byId = Object.fromEntries(panel.notifications.filter(n => n.type === 'BROADCAST').map(n => [n.id, n.priority]));
    expect(byId['broadcast:b-crit']).toBe('CRITICA');
    expect(byId['broadcast:b-imp']).toBe('PENDIENTE');
    expect(byId['broadcast:b-info']).toBe('INFORMATIVA');
  });

  it('9. identidad estable broadcast:<id> — recalcular nunca duplica', () => {
    const args = baseArgs({ broadcasts: [broadcast()] });
    const ids1 = buildTasksNotificationsPanel(args).notifications.map(n => n.id);
    const ids2 = buildTasksNotificationsPanel(args).notifications.map(n => n.id);
    expect(ids1).toEqual(ids2);
    expect(ids1).toEqual(['broadcast:bcast1']);
  });

  it('10. turno=null siempre — nunca se filtra por currentShiftId', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({ broadcasts: [broadcast()], currentShiftId: 'shift_noche' }));
    expect(panel.notifications.find(n => n.id === 'broadcast:bcast1')).toBeTruthy();
  });

  it('11. no rompe notificaciones existentes (reprogramación sigue igual) — additive', () => {
    const plans = [{ id: 'p1', equipmentId: 'e1', active: true, reprogramadoHasta: '2026-10-20T00:00:00.000Z' }];
    const panel = buildTasksNotificationsPanel(baseArgs({ plans, broadcasts: [broadcast()] }));
    expect(panel.notifications.some(n => n.type === 'REPROGRAMACION')).toBe(true);
    expect(panel.notifications.some(n => n.type === 'BROADCAST')).toBe(true);
  });

  it('12. trae título/mensaje/prioridad/autor/fecha/vigencia (§3 del pedido)', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({ broadcasts: [broadcast({ validUntil: '2026-12-01' })] }));
    const item = panel.notifications.find(n => n.id === 'broadcast:bcast1');
    expect(item).toMatchObject({
      title: 'Corte de agua', mensaje: 'No habrá agua en el campamento de 10 a 12.',
      createdBy: 'u-admin', fechaHora: '2026-10-18T08:00:00.000Z', validUntil: '2026-12-01',
    });
  });
});

describe('Badge agregado (§5 del pedido) — countPanelBadges() real, nunca duplicado/inflado', () => {
  it('13. broadcast no leído cuenta en notificationUnreadCount', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({ broadcasts: [broadcast()] }));
    const counts = countPanelBadges({ tasks: [], notifications: panel.notifications }, { readNoticeIds: new Set() });
    expect(counts.notificationUnreadCount).toBe(1);
  });

  it('14. broadcast leído deja de contar (readNoticeIds con el prefijo broadcast:)', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({ broadcasts: [broadcast()], readMessageIds: new Set(['bcast1']) }));
    const counts = countPanelBadges({ tasks: [], notifications: panel.notifications },
      { readNoticeIds: new Set(['broadcast:bcast1']) });
    expect(counts.notificationUnreadCount).toBe(0);
  });

  it('15. recalcular 3 veces con los mismos datos nunca infla el badge (no suma, siempre el mismo set)', () => {
    const args = baseArgs({ broadcasts: [broadcast()] });
    const counts = [1, 2, 3].map(() => {
      const panel = buildTasksNotificationsPanel(args);
      return countPanelBadges({ tasks: [], notifications: panel.notifications }, { readNoticeIds: new Set() }).notificationUnreadCount;
    });
    expect(counts).toEqual([1, 1, 1]);
  });

  it('16. manual_task PENDING sigue contando en taskCount hasta completarse (no se duplica con broadcasts)', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({
      manualTasks: [{ id: 'mt1', equipmentId: 'e1', crewId: 'cq1', status: 'PENDING', description: 'x', priority: 'ALTA', createdBy: 'u1', createdAt: '2026-10-18T08:00:00.000Z' }],
      visibleCrewIds: ['cq1'], broadcasts: [broadcast()],
    }));
    const counts = countPanelBadges({ tasks: [...panel.manualTasks], notifications: panel.notifications }, { readNoticeIds: new Set() });
    expect(counts.taskCount).toBe(1);
    expect(counts.notificationUnreadCount).toBe(1);
  });

  it('17. manual_task COMPLETED deja de contar de inmediato (test 18 del pedido)', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({
      manualTasks: [{ id: 'mt1', equipmentId: 'e1', crewId: 'cq1', status: 'COMPLETED', completedBy: 'u1', completedAt: '2026-10-18T09:00:00.000Z', description: 'x', priority: 'ALTA', createdBy: 'u1', createdAt: '2026-10-18T08:00:00.000Z' }],
      visibleCrewIds: ['cq1'],
    }));
    const counts = countPanelBadges({ tasks: [...panel.manualTasks], notifications: panel.notifications }, { readNoticeIds: new Set() });
    expect(counts.taskCount).toBe(0);
  });
});
