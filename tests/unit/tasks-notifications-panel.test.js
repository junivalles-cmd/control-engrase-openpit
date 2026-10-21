// tests/unit/tasks-notifications-panel.test.js
//
// "Cerrar bloque PANEL DE NOTIFICACIONES/TAREAS" (2026-10-18) —
// buildTasksNotificationsPanel()/countPanelBadges() REALES
// (src/core/tasks-notifications-panel.js), extraídas tal cual, nunca
// reimplementadas. Cubre las 15 pruebas pedidas explícitamente.
import { describe, it, expect } from 'vitest';
import { loadTasksNotificationsPanelLogic } from '../helpers/loadLubricationLogic.js';

const { buildTasksNotificationsPanel, countPanelBadges, isRecordPendingValidation, isRecordValidationExpired, parseOccurrenceKeyDate } = loadTasksNotificationsPanelLogic();

const SHIFT_BOUNDARIES = { shiftDayStart: 6, shiftNightStart: 18 };
const EQUIPO_DIA = { id: 'e1', code: '05-0870', shiftId: 'shift_dia' };
const EQUIPO_NOCHE = { id: 'e2', code: '20-5530', shiftId: 'shift_noche' };
const EQUIPMENT = [EQUIPO_DIA, EQUIPO_NOCHE];

function baseArgs(overrides = {}) {
  return {
    anomalies: [], records: [], validations: [], assignments: [], plans: [], equipment: EQUIPMENT,
    visibleEquipmentIds: null, myCrewId: 'cq1', currentShiftId: null, todayISO: '2026-10-18',
    now: new Date('2026-10-18T10:00:00.000Z'), shiftBoundaries: SHIFT_BOUNDARIES,
    isRecordPendingValidationFn: isRecordPendingValidation, isRecordValidationExpiredFn: isRecordValidationExpired,
    parseOccurrenceKeyDateFn: parseOccurrenceKeyDate,
    ...overrides,
  };
}

describe('1/2. Visibilidad por alcance (visibleEquipmentIds) — "le corresponde" lo decide el caller, no este módulo', () => {
  it('1. tarea con equipo Día visible para el usuario Día (dentro de su alcance)', () => {
    const anomalies = [{ id: 'a1', equipmentId: 'e1', status: 'Abierta', criticality: 'Media' }];
    const panel = buildTasksNotificationsPanel(baseArgs({ anomalies, visibleEquipmentIds: ['e1'] }));
    expect(panel.tasks.map(t => t.id)).toContain('anomalia:a1');
  });

  it('2. tarea de equipo Noche NO visible para un alcance que no lo incluye ("no le corresponde")', () => {
    const anomalies = [{ id: 'a2', equipmentId: 'e2', status: 'Abierta', criticality: 'Media' }];
    const panel = buildTasksNotificationsPanel(baseArgs({ anomalies, visibleEquipmentIds: ['e1'] })); // e2 fuera de alcance
    expect(panel.tasks.map(t => t.id)).not.toContain('anomalia:a2');
  });
});

describe('3/4. Persistencia entre turnos — las TAREAS nunca se ocultan por cambio de turno (§2/§3)', () => {
  it('3. asignación pendiente (equivalente a "pendiente arrastrado") sigue apareciendo en el turno siguiente', () => {
    const assignments = [{ id: 'asg1', equipmentId: 'e1', occurrenceKey: 'p1:2026-10-17:shift_noche', assignedCrewId: 'cq1', status: 'PENDING', active: true }];
    const panelNoche = buildTasksNotificationsPanel(baseArgs({ assignments, currentShiftId: 'shift_noche' }));
    const panelDiaSiguiente = buildTasksNotificationsPanel(baseArgs({ assignments, currentShiftId: 'shift_dia' }));
    expect(panelNoche.tasks.map(t => t.id)).toContain('asignacion:asg1');
    expect(panelDiaSiguiente.tasks.map(t => t.id)).toContain('asignacion:asg1');
  });

  it('4. validación pendiente persiste al cambiar turno (nunca se filtra por turno, a diferencia de las notificaciones)', () => {
    const records = [{ id: 'r1', equipmentId: 'e1', date: '2026-10-18T07:00:00.000Z', shiftId: 'shift_dia', active: true }];
    const panelDia = buildTasksNotificationsPanel(baseArgs({ records, currentShiftId: 'shift_dia' }));
    const panelNoche = buildTasksNotificationsPanel(baseArgs({ records, currentShiftId: 'shift_noche' }));
    expect(panelDia.tasks.map(t => t.id)).toContain('validacion:r1');
    expect(panelNoche.tasks.map(t => t.id)).toContain('validacion:r1');
  });
});

describe('5/6. Persistencia pura (reinicio/offline) — mismo input siempre produce el mismo resultado, sin estado oculto', () => {
  it('5. tarea persiste tras "reinicio" (misma entrada, nueva llamada = exactamente el mismo resultado)', () => {
    const anomalies = [{ id: 'a1', equipmentId: 'e1', status: 'Abierta', criticality: 'Alta' }];
    const args = baseArgs({ anomalies });
    const antes = buildTasksNotificationsPanel(args);
    const despuesDeReiniciar = buildTasksNotificationsPanel(baseArgs({ anomalies })); // "reinicio" = nueva llamada, mismos datos ya sincronizados
    expect(despuesDeReiniciar.tasks.map(t => t.id)).toEqual(antes.tasks.map(t => t.id));
  });

  it('6. offline: función 100% pura, sin red/DOM — con los mismos datos YA sincronizados sigue mostrando el panel completo', () => {
    const anomalies = [{ id: 'a1', equipmentId: 'e1', status: 'Abierta', criticality: 'Media' }];
    const records = [{ id: 'r1', equipmentId: 'e1', date: '2026-10-18T07:00:00.000Z', shiftId: 'shift_dia', active: true }];
    const panel = buildTasksNotificationsPanel(baseArgs({ anomalies, records })); // nunca toca navigator.onLine/fetch
    expect(panel.tasks).toHaveLength(2);
  });
});

describe('7/8. Reconexión / sync repetido — nunca duplica (dedupe real por identidad)', () => {
  it('7. reconexión: recalcular el panel tras "volver a sincronizar" con los mismos datos no duplica nada', () => {
    const anomalies = [{ id: 'a1', equipmentId: 'e1', status: 'Abierta', criticality: 'Media' }];
    const assignments = [{ id: 'asg1', equipmentId: 'e1', occurrenceKey: 'p1:2026-10-18:shift_dia', assignedCrewId: 'cq1', status: 'PENDING', active: true }];
    const uno = buildTasksNotificationsPanel(baseArgs({ anomalies, assignments }));
    const dos = buildTasksNotificationsPanel(baseArgs({ anomalies, assignments })); // "reconexión" = vuelve a correr con el mismo snapshot
    expect(dos.tasks).toHaveLength(uno.tasks.length);
    expect(dos.tasks.map(t => t.id).sort()).toEqual(uno.tasks.map(t => t.id).sort());
  });

  it('8. sync repetido 3 veces con los mismos datos no duplica (ni crece, ni encoge)', () => {
    const anomalies = [{ id: 'a1', equipmentId: 'e1', status: 'Abierta', criticality: 'Media' }];
    const counts = [1, 2, 3].map(() => buildTasksNotificationsPanel(baseArgs({ anomalies })).tasks.length);
    expect(counts).toEqual([1, 1, 1]);
  });
});

describe('9. Tarea resuelta desaparece de pendientes', () => {
  it('anomalía cerrada ya no aparece como tarea', () => {
    const abierta = buildTasksNotificationsPanel(baseArgs({ anomalies: [{ id: 'a1', equipmentId: 'e1', status: 'Abierta', criticality: 'Media' }] }));
    const cerrada = buildTasksNotificationsPanel(baseArgs({ anomalies: [{ id: 'a1', equipmentId: 'e1', status: 'Cerrada', criticality: 'Media' }] }));
    expect(abierta.tasks.map(t => t.id)).toContain('anomalia:a1');
    expect(cerrada.tasks.map(t => t.id)).not.toContain('anomalia:a1');
  });

  it('validación firmada ya no aparece como tarea pendiente', () => {
    const records = [{ id: 'r1', equipmentId: 'e1', date: '2026-10-18T07:00:00.000Z', shiftId: 'shift_dia', active: true }];
    const sinFirma = buildTasksNotificationsPanel(baseArgs({ records, validations: [] }));
    const conFirma = buildTasksNotificationsPanel(baseArgs({ records, validations: [{ id: 'v1', lubricationRecordId: 'r1', signerRole: 'OPERADOR', active: true }] }));
    expect(sinFirma.tasks.map(t => t.id)).toContain('validacion:r1');
    expect(conFirma.tasks.map(t => t.id)).not.toContain('validacion:r1');
  });
});

describe('10. Notificación leída no sigue contando (badge)', () => {
  it('countPanelBadges() excluye del contador las notificaciones ya leídas, sin quitarlas de la lista', () => {
    const plans = [{ id: 'p1', equipmentId: 'e1', active: true, reprogramadoHasta: '2026-10-20', reprogramadoMotivo: 'Mantenimiento', shiftId: 'shift_dia' }];
    const panel = buildTasksNotificationsPanel(baseArgs({ plans }));
    const noticeId = panel.notifications[0].id;
    const sinLeer = countPanelBadges(panel);
    const leida = countPanelBadges(panel, { readNoticeIds: new Set([noticeId]) });
    expect(sinLeer.notificationUnreadCount).toBe(1);
    expect(leida.notificationUnreadCount).toBe(0);
    expect(panel.notifications).toHaveLength(1); // sigue en la lista, solo no cuenta
  });
});

describe('11. Reasignación actualiza responsabilidad', () => {
  it('reasignar de cq1 a cq2: cq1 ve una notificación (ya no es suyo), cq2 ve la tarea (ahora es suyo)', () => {
    const assignments = [{ id: 'asg1', equipmentId: 'e1', occurrenceKey: 'p1:2026-10-18:shift_dia', assignedCrewId: 'cq2', previousCrewId: 'cq1', status: 'PENDING', active: true }];
    const panelCq1 = buildTasksNotificationsPanel(baseArgs({ assignments, myCrewId: 'cq1' }));
    const panelCq2 = buildTasksNotificationsPanel(baseArgs({ assignments, myCrewId: 'cq2' }));
    expect(panelCq1.tasks.map(t => t.id)).not.toContain('asignacion:asg1');
    expect(panelCq1.notifications.map(n => n.id)).toContain('asignacion-aviso:asg1:reasignada');
    expect(panelCq2.tasks.map(t => t.id)).toContain('asignacion:asg1');
    expect(panelCq2.notifications).toHaveLength(0);
  });
});

describe('12. Cancelación cierra/actualiza correctamente', () => {
  it('asignación cancelada deja de ser tarea y pasa a notificación informativa', () => {
    const pendiente = [{ id: 'asg1', equipmentId: 'e1', occurrenceKey: 'p1:2026-10-18:shift_dia', assignedCrewId: 'cq1', status: 'PENDING', active: true }];
    const cancelada = [{ id: 'asg1', equipmentId: 'e1', occurrenceKey: 'p1:2026-10-18:shift_dia', assignedCrewId: 'cq1', status: 'CANCELLED', active: true }];
    const antes = buildTasksNotificationsPanel(baseArgs({ assignments: pendiente }));
    const despues = buildTasksNotificationsPanel(baseArgs({ assignments: cancelada }));
    expect(antes.tasks.map(t => t.id)).toContain('asignacion:asg1');
    expect(despues.tasks.map(t => t.id)).not.toContain('asignacion:asg1');
    expect(despues.notifications.map(n => n.id)).toContain('asignacion-aviso:asg1:cancelada');
  });
});

describe('13/14. occurrenceKey — identidad real de la obligación', () => {
  it('13. dos filas PENDING con el MISMO occurrenceKey (dato inconsistente) nunca producen 2 tareas', () => {
    const assignments = [
      { id: 'asg1', equipmentId: 'e1', occurrenceKey: 'p1:2026-10-18:shift_dia', assignedCrewId: 'cq1', status: 'PENDING', active: true },
      { id: 'asg2', equipmentId: 'e1', occurrenceKey: 'p1:2026-10-18:shift_dia', assignedCrewId: 'cq1', status: 'PENDING', active: true },
    ];
    const panel = buildTasksNotificationsPanel(baseArgs({ assignments }));
    expect(panel.tasks.filter(t => t.type === 'ASIGNACION')).toHaveLength(1);
  });

  it('14. Día y Noche del MISMO plan dual son occurrences distintas — ambas aparecen, nunca se mezclan', () => {
    const assignments = [
      { id: 'asgD', equipmentId: 'e1', occurrenceKey: 'p1:2026-10-18:shift_dia', assignedCrewId: 'cq1', status: 'PENDING', active: true },
      { id: 'asgN', equipmentId: 'e1', occurrenceKey: 'p1:2026-10-18:shift_noche', assignedCrewId: 'cq1', status: 'PENDING', active: true },
    ];
    const panel = buildTasksNotificationsPanel(baseArgs({ assignments }));
    const ids = panel.tasks.map(t => t.id);
    expect(ids).toContain('asignacion:asgD');
    expect(ids).toContain('asignacion:asgN');
    expect(panel.tasks.filter(t => t.type === 'ASIGNACION')).toHaveLength(2);
  });
});

describe('15. Anomalías conservan prioridad/criticidad real (nunca inventada)', () => {
  it('criticidad real (Baja/Media/Alta/Crítica) se conserva tal cual en el item; priority es solo una agrupación derivada', () => {
    const anomalies = [
      { id: 'a1', equipmentId: 'e1', status: 'Abierta', criticality: 'Baja' },
      { id: 'a2', equipmentId: 'e1', status: 'Abierta', criticality: 'Media' },
      { id: 'a3', equipmentId: 'e1', status: 'Abierta', criticality: 'Alta' },
      { id: 'a4', equipmentId: 'e1', status: 'Abierta', criticality: 'Crítica' },
    ];
    const panel = buildTasksNotificationsPanel(baseArgs({ anomalies }));
    const byId = Object.fromEntries(panel.tasks.map(t => [t.id, t]));
    expect(byId['anomalia:a1'].criticidad).toBe('Baja');
    expect(byId['anomalia:a2'].criticidad).toBe('Media');
    expect(byId['anomalia:a3'].criticidad).toBe('Alta');
    expect(byId['anomalia:a4'].criticidad).toBe('Crítica');
    // Solo "Crítica" sube a prioridad CRÍTICA — nunca se inventa una cuarta prioridad ni se degrada la real.
    expect(byId['anomalia:a4'].priority).toBe('CRITICA');
    expect(byId['anomalia:a1'].priority).toBe('PENDIENTE');
    expect(byId['anomalia:a2'].priority).toBe('PENDIENTE');
    expect(byId['anomalia:a3'].priority).toBe('PENDIENTE');
  });
});

describe('Clasificación TAREA vs NOTIFICACIÓN (requisito 1 del pedido)', () => {
  it('anomalía/validación/asignación-pendiente son TAREA; reprogramación/cancelación/reasignación-saliente son NOTIFICACIÓN', () => {
    const anomalies = [{ id: 'a1', equipmentId: 'e1', status: 'Abierta', criticality: 'Media' }];
    const records = [{ id: 'r1', equipmentId: 'e1', date: '2026-10-18T07:00:00.000Z', shiftId: 'shift_dia', active: true }];
    const assignments = [
      { id: 'asgTarea', equipmentId: 'e1', occurrenceKey: 'p1:2026-10-18:shift_dia', assignedCrewId: 'cq1', status: 'PENDING', active: true },
      { id: 'asgAviso', equipmentId: 'e2', occurrenceKey: 'p2:2026-10-18:shift_dia', assignedCrewId: 'cq2', previousCrewId: 'cq1', status: 'PENDING', active: true },
    ];
    const plans = [{ id: 'p3', equipmentId: 'e1', active: true, reprogramadoHasta: '2026-10-20', shiftId: 'shift_dia' }];
    const panel = buildTasksNotificationsPanel(baseArgs({ anomalies, records, assignments, plans }));
    expect(panel.tasks.every(t => t.kind === 'TAREA')).toBe(true);
    expect(panel.notifications.every(n => n.kind === 'NOTIFICACION')).toBe(true);
    expect(panel.tasks.map(t => t.type).sort()).toEqual(['ANOMALIA', 'ASIGNACION', 'VALIDACION']);
    expect(panel.notifications.map(n => n.type).sort()).toEqual(['REASIGNACION_SALIENTE', 'REPROGRAMACION']);
  });

  it('cada tarea/notificación trae equipo, tipo, motivo, turno, fecha, estado, prioridad, vencido y acción (requisito 6 del pedido)', () => {
    const anomalies = [{ id: 'a1', equipmentId: 'e1', status: 'Abierta', criticality: 'Crítica', description: 'Fuga de grasa', createdAt: '2026-10-18T05:00:00.000Z' }];
    const panel = buildTasksNotificationsPanel(baseArgs({ anomalies }));
    const item = panel.tasks[0];
    for (const field of ['id', 'kind', 'type', 'priority', 'equipmentId', 'equipmentCode', 'motivo', 'turno', 'fechaHora', 'estado', 'overdue', 'actionLabel', 'actionType', 'actionTarget']) {
      expect(item).toHaveProperty(field);
    }
    expect(item.actionType).toBe('VER_ANOMALIA');
    expect(item.equipmentCode).toBe('05-0870');
  });
});

describe('Regla de turno en notificaciones (§2) — informativas sí respetan turno real', () => {
  it('reprogramación de un plan 100% Noche no le llega a quien está en turno Día', () => {
    const plans = [{ id: 'p1', equipmentId: 'e2', active: true, reprogramadoHasta: '2026-10-20', shiftId: 'shift_noche' }];
    const panelDia = buildTasksNotificationsPanel(baseArgs({ plans, currentShiftId: 'shift_dia' }));
    const panelNoche = buildTasksNotificationsPanel(baseArgs({ plans, currentShiftId: 'shift_noche' }));
    expect(panelDia.notifications).toHaveLength(0);
    expect(panelNoche.notifications).toHaveLength(1);
  });
});
