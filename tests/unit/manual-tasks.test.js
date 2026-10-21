// tests/unit/manual-tasks.test.js
//
// MANUAL_TASKS_UI (2026-10-18) — manual_tasks (0017, ACTIVE en producción)
// integrado al cliente. Cubre SOLO lógica pura, extraída tal cual de
// src/core/tasks-notifications-panel.js / db.js / sync.js (nunca
// reimplementada): visibilidad por cuadrilla, dedupe/identidad del panel,
// y el fix de compatibilidad con el RLS de cierre de 0017
// (manual_task_row_in_scope compara el payload completo menos un allowlist
// que NO incluye `_pushedVersion`/`updatedAt` — ver comentarios en
// sync.js/db.js). La UI en sí (app.js) se verifica manualmente/vía Playwright,
// no acá.
import { describe, it, expect } from 'vitest';
import { loadTasksNotificationsPanelLogic, loadDbLogic, loadSyncLogic } from '../helpers/loadLubricationLogic.js';

const { buildTasksNotificationsPanel } = loadTasksNotificationsPanelLogic();
const { buildManualTaskCompletionRow } = loadDbLogic();

const EQUIPMENT = [{ id: 'e1', code: '05-0870' }, { id: 'e2', code: '20-5530' }];

function baseArgs(overrides = {}) {
  return {
    anomalies: [], records: [], validations: [], assignments: [], plans: [], equipment: EQUIPMENT,
    manualTasks: [], visibleCrewIds: null, visibleEquipmentIds: null,
    myCrewId: 'cq1', currentShiftId: null, todayISO: '2026-10-18',
    now: new Date('2026-10-18T10:00:00.000Z'),
    isRecordPendingValidationFn: () => false, isRecordValidationExpiredFn: () => false,
    parseOccurrenceKeyDateFn: () => null,
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    id: 'mtask1', equipmentId: 'e1', crewId: 'cq1', taskType: 'ENGRASE', title: null,
    description: 'Revisar punto trasero', priority: 'ALTA', status: 'PENDING',
    createdBy: 'u-admin', createdAt: '2026-10-18T08:00:00.000Z', dueAt: null,
    ...overrides,
  };
}

describe('buildManualTaskItems (vía buildTasksNotificationsPanel) — manual_tasks 0017', () => {
  it('1. tarea PENDING de la cuadrilla del usuario aparece en panel.manualTasks', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({ manualTasks: [task()], visibleCrewIds: ['cq1'] }));
    expect(panel.manualTasks.map(t => t.id)).toEqual(['manual-task:mtask1']);
  });

  it('2. tarea de OTRA cuadrilla no aparece (nunca se filtra por equipo, solo por crewId)', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({
      manualTasks: [task({ crewId: 'cq2' })], visibleCrewIds: ['cq1'],
    }));
    expect(panel.manualTasks).toHaveLength(0);
  });

  it('3. tarea COMPLETED deja de ser "pendiente" de inmediato (nunca aparece en manualTasks)', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({
      manualTasks: [task({ status: 'COMPLETED', completedBy: 'u1', completedAt: '2026-10-18T09:00:00.000Z' })],
      visibleCrewIds: ['cq1'],
    }));
    expect(panel.manualTasks).toHaveLength(0);
  });

  it('4. tarea CANCELLED tampoco aparece como pendiente', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({
      manualTasks: [task({ status: 'CANCELLED' })], visibleCrewIds: ['cq1'],
    }));
    expect(panel.manualTasks).toHaveLength(0);
  });

  it('5. visibleCrewIds=null (ADMIN/PLANIFICADOR, alcance GLOBAL) ve cualquier cuadrilla', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({
      manualTasks: [task({ crewId: 'cq9' })], visibleCrewIds: null,
    }));
    expect(panel.manualTasks).toHaveLength(1);
  });

  it('6. identidad estable manual-task:<id> — recalcular con los mismos datos nunca duplica', () => {
    const args = baseArgs({ manualTasks: [task()], visibleCrewIds: ['cq1'] });
    const uno = buildTasksNotificationsPanel(args).manualTasks.map(t => t.id);
    const dos = buildTasksNotificationsPanel(args).manualTasks.map(t => t.id);
    expect(uno).toEqual(dos);
    expect(uno).toEqual(['manual-task:mtask1']);
  });

  it('7. prioridad ALTA se traduce a CRITICA del panel; MEDIA/BAJA a PENDIENTE (sin inventar un 4to nivel)', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({
      manualTasks: [task({ id: 't-alta', priority: 'ALTA' }), task({ id: 't-media', priority: 'MEDIA' }), task({ id: 't-baja', priority: 'BAJA' })],
      visibleCrewIds: ['cq1'],
    }));
    const byId = Object.fromEntries(panel.manualTasks.map(t => [t.id, t.priority]));
    expect(byId['manual-task:t-alta']).toBe('CRITICA');
    expect(byId['manual-task:t-media']).toBe('PENDIENTE');
    expect(byId['manual-task:t-baja']).toBe('PENDIENTE');
  });

  it('8. dueAt vencido (anterior a todayISO) marca overdue:true', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({
      manualTasks: [task({ dueAt: '2026-10-01T00:00:00.000Z' })], visibleCrewIds: ['cq1'],
    }));
    expect(panel.manualTasks[0].overdue).toBe(true);
  });

  it('9. dueAt futuro NO marca overdue', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({
      manualTasks: [task({ dueAt: '2026-12-01T00:00:00.000Z' })], visibleCrewIds: ['cq1'],
    }));
    expect(panel.manualTasks[0].overdue).toBe(false);
  });

  it('10. trae equipo/taskType/título/descripción/prioridad/cuadrilla(crewId)/creador/fecha/estado (§4 del pedido)', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({ manualTasks: [task()], visibleCrewIds: ['cq1'] }));
    const item = panel.manualTasks[0];
    expect(item).toMatchObject({
      equipmentId: 'e1', equipmentCode: '05-0870', taskType: 'ENGRASE', description: 'Revisar punto trasero',
      crewId: 'cq1', createdBy: 'u-admin', fechaHora: '2026-10-18T08:00:00.000Z', estado: 'PENDING',
      actionLabel: 'Completar tarea', actionType: 'COMPLETAR_TAREA', actionTarget: 'mtask1',
    });
  });

  it('11. no rompe tasks/notifications existentes (anomalías siguen igual) — additive', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({
      anomalies: [{ id: 'a1', equipmentId: 'e1', status: 'Abierta', criticality: 'Media' }],
      manualTasks: [task()], visibleCrewIds: ['cq1'],
    }));
    expect(panel.tasks.map(t => t.id)).toEqual(['anomalia:a1']);
    expect(panel.manualTasks.map(t => t.id)).toEqual(['manual-task:mtask1']);
  });

  it('12. manualTasks nunca se oculta por cambio de turno (currentShiftId distinto, persiste como TAREA)', () => {
    const panel = buildTasksNotificationsPanel(baseArgs({
      manualTasks: [task()], visibleCrewIds: ['cq1'], currentShiftId: 'shift_noche',
    }));
    expect(panel.manualTasks).toHaveLength(1);
  });
});

describe('buildManualTaskCompletionRow (db.js) — cierre LUBRICADOR compatible con el RLS de 0017', () => {
  const current = {
    id: 'mtask1', equipmentId: 'e1', crewId: 'cq1', taskType: 'ENGRASE', title: null,
    description: 'Revisar punto trasero', priority: 'ALTA', status: 'PENDING',
    createdBy: 'u-admin', createdAt: '2026-10-18T08:00:00.000Z', dueAt: null,
    updatedAt: '2026-10-18T08:00:00.000Z', _pushedVersion: '2026-10-18T08:00:00.000Z',
  };

  it('13. setea status/completedBy/completedAt/completionComment/photos/photo, nunca toca campos protegidos', () => {
    const row = buildManualTaskCompletionRow(current, { completedBy: 'u-lub1', completionComment: 'Listo', photos: ['data:image/png;base64,AA=='] });
    expect(row.status).toBe('COMPLETED');
    expect(row.completedBy).toBe('u-lub1');
    expect(row.completionComment).toBe('Listo');
    expect(row.photos).toEqual(['data:image/png;base64,AA==']);
    expect(row.photo).toBe('data:image/png;base64,AA==');
    expect(typeof row.completedAt).toBe('string');
    // Protegidos: byte-idénticos al original (0017, manual_task_row_in_scope).
    for (const field of ['equipmentId', 'crewId', 'createdBy', 'title', 'description', 'taskType', 'priority', 'dueAt']) {
      expect(row[field]).toEqual(current[field]);
    }
  });

  it('14. congela __freezeEmbeddedUpdatedAt al updatedAt actual (ANTES de bumpear) — la clave que el RLS de cierre exige', () => {
    const row = buildManualTaskCompletionRow(current, { completedBy: 'u-lub1', completionComment: '', photos: [] });
    expect(row.__freezeEmbeddedUpdatedAt).toBe('2026-10-18T08:00:00.000Z');
    // El `updatedAt` LOCAL sí avanza (lo necesita pushAll() para detectar la fila dirty).
    expect(row.updatedAt).not.toBe(current.updatedAt);
  });

  it('15. sin fotos -> photos:[] y photo:null (nunca undefined, nunca el string "null")', () => {
    const row = buildManualTaskCompletionRow(current, { completedBy: 'u-lub1', completionComment: '', photos: [] });
    expect(row.photos).toEqual([]);
    expect(row.photo).toBeNull();
  });
});

describe('Sync.stripLocalAuthorizationMetadata — el payload real que viaja a engrase_sync', () => {
  const { Sync } = loadSyncLogic({}, ['manual_tasks']);

  it('16. quita _pushedVersion (bookkeeping local) — nunca viaja al servidor', () => {
    const payload = Sync.stripLocalAuthorizationMetadata({ id: 'mtask1', status: 'PENDING', _pushedVersion: '2026-10-18T08:00:00.000Z' });
    expect(payload._pushedVersion).toBeUndefined();
    expect(payload.id).toBe('mtask1');
  });

  it('17. quita __authorizationAppUserId/__authorizationState/_supportOperational (ya documentado, sin regresión)', () => {
    const payload = Sync.stripLocalAuthorizationMetadata({
      id: 'mtask1', __authorizationAppUserId: 'u1', __authorizationState: 'AUTHORIZED', _supportOperational: true,
    });
    expect(payload).toEqual({ id: 'mtask1' });
  });

  it('18. __freezeEmbeddedUpdatedAt congela payload.updatedAt al valor pedido y se quita a sí mismo del payload enviado', () => {
    const payload = Sync.stripLocalAuthorizationMetadata({
      id: 'mtask1', status: 'COMPLETED', updatedAt: '2026-10-18T09:00:00.000Z',
      __freezeEmbeddedUpdatedAt: '2026-10-18T08:00:00.000Z',
    });
    expect(payload.updatedAt).toBe('2026-10-18T08:00:00.000Z');
    expect(payload.__freezeEmbeddedUpdatedAt).toBeUndefined();
  });

  it('19. sin __freezeEmbeddedUpdatedAt, updatedAt viaja tal cual (comportamiento normal de cualquier otro store, sin regresión)', () => {
    const payload = Sync.stripLocalAuthorizationMetadata({ id: 'c1', updatedAt: '2026-10-18T09:00:00.000Z' });
    expect(payload.updatedAt).toBe('2026-10-18T09:00:00.000Z');
  });

  it('20. simula el round-trip completo de cierre: new_payload coincide con old_payload fuera del allowlist de cierre', () => {
    const oldPayload = { id: 'mtask1', equipmentId: 'e1', crewId: 'cq1', createdBy: 'u-admin', title: null,
      description: 'Revisar', taskType: 'ENGRASE', priority: 'ALTA', dueAt: null, status: 'PENDING',
      updatedAt: '2026-10-18T08:00:00.000Z' };
    const completionRow = buildManualTaskCompletionRow({ ...oldPayload, _pushedVersion: oldPayload.updatedAt },
      { completedBy: 'u-lub1', completionComment: 'Listo', photos: [] });
    const newPayload = Sync.stripLocalAuthorizationMetadata(completionRow);
    const allowlist = ['status', 'completedBy', 'completedAt', 'completionComment', 'photos', 'photo', 'photoUploaded'];
    const stripKeys = (obj) => Object.fromEntries(Object.entries(obj).filter(([k]) => !allowlist.includes(k)));
    expect(stripKeys(newPayload)).toEqual(stripKeys(oldPayload));
  });
});
