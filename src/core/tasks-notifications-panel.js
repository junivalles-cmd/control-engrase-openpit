// src/core/tasks-notifications-panel.js
//
// "Cerrar bloque PANEL DE NOTIFICACIONES/TAREAS" (2026-10-18) — modelo puro
// que arma el panel operativo unificado. Auditoría previa confirmó que NO
// existía una pantalla única: lo que había estaba repartido entre
// refreshLocalNotifications() (app.js, avisos push del sistema operativo,
// sin ninguna lista en pantalla), Mi Turno (solo trabajo de ENGRASE:
// pendiente/arrastrado/validación-como-lista-de-firmas) y Anomalías (ruta
// separada, nunca mezclada). Ese reparto para engrase YA está validado y
// probado — este módulo NUNCA lo reimplementa ni lo toca. Su trabajo es
// exclusivamente lo que de verdad faltaba: anomalías, asignaciones
// pendientes/reasignadas/canceladas y reprogramaciones, clasificadas como
// TAREA ACCIONABLE vs NOTIFICACIÓN INFORMATIVA, con prioridad, identidad
// estable (dedupe) y, para las notificaciones, el filtro de turno real.
//
// Puro: recibe todo ya cargado (anomalies/records/validations/assignments/
// plans/equipment), nunca toca DB/red/DOM — mismo criterio que
// weekly-matrix.js/operational-scope.js/notification-routing.js. Reusa
// SIEMPRE la lógica/los datos ya validados (isRecordPendingValidation(),
// isRecordValidationExpired() de grease-validation.js; ASSIGNMENT_STATUS de
// operational-scope.js; criticality real de la anomalía) — nunca inventa
// un vocabulario ni una regla paralela.
//
// SCOPE (a propósito, NUNCA recalculado aquí): `visibleEquipmentIds` lo
// arma el caller con la lógica de alcance YA existente y validada
// (classifyEquipmentWork()/resolveCrewLocationCoverage() en
// operational-scope.js, o el alcance GLOBAL de jefaturas) — este módulo
// jamás decide qué cuadrilla/ubicación corresponde a quién, solo filtra la
// lista de eventos contra el conjunto de equipos que el caller ya resolvió
// como "le corresponde a este usuario".
//
// REGLA DE TURNO (§2 del pedido, aplicada deliberadamente distinto por
// kind): una TAREA ACCIONABLE (anomalía abierta, validación pendiente,
// asignación pendiente) NUNCA se oculta por cambio de turno/día — eso es
// exactamente la "persistencia" exigida (§3) y la excepción de arrastrado
// (§2: "no ocultar una tarea importante solo porque cambió el turno"). El
// filtro de turno real solo aplica a las NOTIFICACIONES informativas
// (reprogramación/cancelación/reasignación-saliente) que sí son "avisos" en
// el sentido de la regla — un lubricador de Día no necesita que le llegue
// el aviso de que se reprogramó un plan 100% Noche.

const PANEL_PRIORITY = { CRITICA: 'CRITICA', PENDIENTE: 'PENDIENTE', INFORMATIVA: 'INFORMATIVA' };
const PANEL_ANOMALY_OPEN_STATUSES = ['Abierta', 'En atención'];

function panelEquipmentLookup(equipment) {
  const byId = new Map((equipment || []).map(e => [e.id, e]));
  return (id) => byId.get(id) || null;
}

// parseOccurrenceKeyDate() YA existe (operational-scope.js) — se reusa tal
// cual (nunca se reimplementa aquí). Se recibe como parámetro, igual que
// isRecordPendingValidationFn/isRecordValidationExpiredFn: este módulo
// nunca asume cómo el caller cargó los demás módulos puros del proyecto.

function isPastDateISO(dateISO, todayISO) {
  return !!dateISO && !!todayISO && dateISO < todayISO;
}

// Única identidad estable por item — dedupe real (§4 del pedido): nunca un
// índice de arreglo ni un timestamp de render, siempre la fila/ocurrencia
// de origen (anomaly.id, lubrication_record.id, assignment.id, plan.id +
// su reprogramadoHasta). Recalcular el panel 1, 10 o 1000 veces produce
// EXACTAMENTE el mismo set de ids — por diseño, nunca una lista que crece.
function anomalyTaskId(a) { return `anomalia:${a.id}`; }
function validationTaskId(r) { return `validacion:${r.id}`; }
function assignmentTaskId(a) { return `asignacion:${a.id}`; }
function assignmentNoticeId(a, kind) { return `asignacion-aviso:${a.id}:${kind}`; }
function reprogramacionNoticeId(plan) { return `reprogramacion:${plan.id}:${plan.reprogramadoHasta}`; }
function manualTaskId(t) { return `manual-task:${t.id}`; }

// manual_tasks (0017, ACTIVE en producción) — anticipado por el propio
// comentario de esa migración ("PANEL INTEGRATION design note"). `priority`
// es texto libre del lado del servidor (sin enum) — el vocabulario real que
// usa el formulario de creación (ALTA/MEDIA/BAJA, ver operational-scope.js)
// se traduce acá al vocabulario YA existente del panel (CRITICA/PENDIENTE),
// nunca uno nuevo. `visibleCrewIds` (una o más cuadrillas autorizadas del
// que mira el panel) decide visibilidad — SOLO PENDING entra como tarea
// (COMPLETED/CANCELLED dejan de ser "pendiente" de inmediato, §9 del
// pedido); igual que una anomalía, nunca se oculta por cambio de turno
// (persiste hasta resolverse, mismo criterio que el resto de este módulo).
const MANUAL_TASK_PRIORITY_TO_PANEL = { ALTA: PANEL_PRIORITY.CRITICA, MEDIA: PANEL_PRIORITY.PENDIENTE, BAJA: PANEL_PRIORITY.PENDIENTE };

function buildManualTaskItems({ manualTasks, equipment, visibleCrewIds, todayISO }) {
  const lookup = panelEquipmentLookup(equipment);
  const visible = visibleCrewIds ? new Set(visibleCrewIds) : null;
  const items = (manualTasks || [])
    .filter(t => t.status === 'PENDING')
    .filter(t => !visible || visible.has(t.crewId))
    .map(t => {
      const eq = lookup(t.equipmentId);
      const overdue = isPastDateISO(t.dueAt ? String(t.dueAt).slice(0, 10) : null, todayISO);
      return {
        id: manualTaskId(t), kind: 'TAREA', type: 'MANUAL',
        priority: MANUAL_TASK_PRIORITY_TO_PANEL[t.priority] || PANEL_PRIORITY.PENDIENTE,
        equipmentId: t.equipmentId, equipmentCode: eq?.code || null,
        crewId: t.crewId, taskType: t.taskType || null, title: t.title || null,
        description: t.description || '', createdBy: t.createdBy || null, dueAt: t.dueAt || null,
        motivo: t.title || t.description || 'Tarea operativa',
        turno: null, fechaHora: t.createdAt || null, estado: t.status, overdue,
        actionLabel: 'Completar tarea', actionType: 'COMPLETAR_TAREA', actionTarget: t.id,
      };
    });
  // Dedupe por identidad (mismo criterio que el resto del módulo): recalcular
  // con los mismos datos de entrada siempre produce el mismo set.
  return sortPanelItems([...new Map(items.map(i => [i.id, i])).values()]);
}

// broadcast_messages (0017, ACTIVE en producción) — mensajes operativos
// informativos, SIEMPRE kind='NOTIFICACION' (nunca TAREA: no son
// accionables, §3 del pedido "no mezclar con manual_tasks/anomalías/
// validaciones"). Visibilidad REAL (quién recibe qué CREW/LOCATION/USER/
// ALL_LUBRICATORS) la decide el servidor (RLS) + el filtro local de
// db.js (localAuthorizationState) ANTES de que la fila llegue acá — este
// módulo nunca re-decide targeting, solo filtra por VIGENCIA (§6: fuera de
// vigencia no se muestra en el panel activo ni cuenta en badge, pero
// nunca se borra físicamente — sigue en `broadcasts`, solo no entra aquí).
function broadcastNoticeId(m) { return `broadcast:${m.id}`; }

function isBroadcastVigente(msg, todayISO) {
  // retiredAt (lote "compactar + eliminación", 2026-10-19): campo
  // informativo nuevo, nunca validado por 0017/0018 RLS (igual que
  // title/priority ya son vocabulario del cliente) — un mensaje retirado
  // deja de ser vigente de inmediato, sin tocar validFrom/validUntil
  // (se conservan intactos para trazabilidad). active:false (eliminar)
  // ya lo filtra DB.allActive() antes de llegar aquí, no se repite acá.
  if (msg.retiredAt) return false;
  if (!todayISO) return true;
  if (msg.validFrom && todayISO < String(msg.validFrom).slice(0, 10)) return false;
  if (msg.validUntil && todayISO > String(msg.validUntil).slice(0, 10)) return false;
  return true;
}

// `priority` es texto libre del cliente (INFORMATIVA/IMPORTANTE/CRITICA,
// ver operational-scope.js) — se traduce al vocabulario YA existente del
// panel, nunca uno nuevo. IMPORTANTE/CRITICA se agrupan igual que el resto
// del módulo (solo 3 buckets: CRITICA/PENDIENTE/INFORMATIVA).
const BROADCAST_PRIORITY_TO_PANEL = { CRITICA: PANEL_PRIORITY.CRITICA, IMPORTANTE: PANEL_PRIORITY.PENDIENTE, INFORMATIVA: PANEL_PRIORITY.INFORMATIVA };

// `readMessageIds` (Set de messageId YA leídos por ESTE usuario, armado por
// el caller desde sus propias filas reales de broadcast_message_reads —
// NUNCA localStorage, para que "leído" sea durable entre reinicio/offline/
// reconexión/dispositivo, §4 del pedido) decide `read`/el label de acción.
function buildBroadcastNotices({ broadcasts, readMessageIds, todayISO }) {
  const read = readMessageIds ? new Set(readMessageIds) : new Set();
  const items = (broadcasts || [])
    .filter(m => isBroadcastVigente(m, todayISO))
    .map(m => {
      const isRead = read.has(m.id);
      return {
        id: broadcastNoticeId(m), kind: 'NOTIFICACION', type: 'BROADCAST',
        priority: BROADCAST_PRIORITY_TO_PANEL[m.priority] || PANEL_PRIORITY.INFORMATIVA,
        equipmentId: null, equipmentCode: null,
        // broadcastDisplayTitle() (operational-scope.js, carga ANTES de
        // este archivo — ver index.html): título opcional desde el lote
        // "envío rápido" 2026-10-19, nunca un título artificial inventado.
        title: broadcastDisplayTitle(m), mensaje: m.message || '', motivo: broadcastDisplayTitle(m),
        createdBy: m.createdBy || null, turno: null, fechaHora: m.createdAt || null,
        validFrom: m.validFrom || null, validUntil: m.validUntil || null,
        estado: isRead ? 'LEÍDA' : 'NO LEÍDA', overdue: false, read: isRead,
        actionLabel: isRead ? 'Leída' : 'Marcar como leída',
        actionType: isRead ? 'BROADCAST_LEIDA_NOOP' : 'MARCAR_LEIDA', actionTarget: m.id,
      };
    });
  return sortPanelItems([...new Map(items.map(i => [i.id, i])).values()]);
}

function buildAnomalyTasks({ anomalies, equipment, visibleEquipmentIds }) {
  const lookup = panelEquipmentLookup(equipment);
  const visible = visibleEquipmentIds ? new Set(visibleEquipmentIds) : null;
  return (anomalies || [])
    .filter(a => a.active !== false && PANEL_ANOMALY_OPEN_STATUSES.includes(a.status))
    .filter(a => !visible || visible.has(a.equipmentId))
    .map(a => {
      const eq = lookup(a.equipmentId);
      const criticality = a.criticality || 'Media';
      return {
        id: anomalyTaskId(a),
        kind: 'TAREA', type: 'ANOMALIA',
        priority: criticality === 'Crítica' ? PANEL_PRIORITY.CRITICA : PANEL_PRIORITY.PENDIENTE,
        equipmentId: a.equipmentId, equipmentCode: eq?.code || null,
        motivo: a.description || a.component || 'Anomalía reportada',
        turno: null, // una anomalía es del EQUIPO, nunca de un turno — nunca se oculta por cambio de turno.
        fechaHora: a.createdAt || a.date || null,
        estado: a.status, // texto REAL de la fuente, nunca inventado.
        criticidad: criticality,
        overdue: criticality === 'Crítica',
        actionLabel: 'Ver anomalía', actionType: 'VER_ANOMALIA', actionTarget: a.id,
      };
    });
}

function buildValidationTasks({ records, validations, equipment, visibleEquipmentIds, now, shiftBoundaries,
  isRecordPendingValidationFn, isRecordValidationExpiredFn }) {
  const lookup = panelEquipmentLookup(equipment);
  const visible = visibleEquipmentIds ? new Set(visibleEquipmentIds) : null;
  return (records || [])
    .filter(r => r.active !== false)
    .filter(r => !visible || visible.has(r.equipmentId))
    .filter(r => isRecordPendingValidationFn(r, validations, now, shiftBoundaries))
    .map(r => {
      const eq = lookup(r.equipmentId);
      const overdue = isRecordValidationExpiredFn(r, validations, now, shiftBoundaries);
      return {
        id: validationTaskId(r),
        kind: 'TAREA', type: 'VALIDACION',
        priority: overdue ? PANEL_PRIORITY.CRITICA : PANEL_PRIORITY.PENDIENTE,
        equipmentId: r.equipmentId, equipmentCode: eq?.code || null,
        motivo: 'Engrase realizado pendiente de validación (firma Operador/Encargado)',
        turno: r.shiftId || null, // informativo (qué turno lo ejecutó) — NUNCA se usa para ocultarla (persiste entre turnos, §3/test 4).
        fechaHora: r.date || null,
        estado: overdue ? 'VENCIDA' : 'PENDIENTE',
        overdue,
        actionLabel: 'Validar', actionType: 'VALIDAR', actionTarget: r.id,
      };
    });
}

function buildAssignmentTasksAndNotices({ assignments, equipment, myCrewId, todayISO, parseOccurrenceKeyDateFn }) {
  const lookup = panelEquipmentLookup(equipment);
  const tasks = [];
  const notifications = [];
  // `visibleEquipmentIds` (alcance de equipo) NUNCA se aplica aquí a
  // propósito: para una asignación, la autorización real es
  // `assignedCrewId === myCrewId` / `previousCrewId === myCrewId` — el
  // caso de "reasignación saliente" es EXACTAMENTE un equipo que YA SALIÓ
  // del alcance normal/asignado de esta cuadrilla (classifyEquipmentWork()
  // ya lo excluye de "normal"/"asignado" en cuanto se reasigna a otra
  // cuadrilla) — filtrar también por alcance aquí ocultaría la notificación
  // precisamente en el único caso en que existe para avisar eso.
  //
  // Una obligación (occurrenceKey) nunca debe producir 2 tareas — la capa
  // de datos ya lo garantiza (createAssignment() rechaza una 2da PENDING
  // para la misma occurrenceKey, ver operational-scope.js), pero este set
  // es una defensa explícita, pedida tal cual (§4/prueba 13): "occurrenceKey
  // evita duplicados de la misma obligación". Día y Noche de un mismo plan
  // dual SON occurrenceKeys distintos (:shift_dia/:shift_noche) — nunca se
  // mezclan (prueba 14), cada uno pasa su propio filtro.
  const seenOccurrenceKeys = new Set();
  for (const a of (assignments || [])) {
    if (a.active === false) continue;
    const eq = lookup(a.equipmentId);
    const parsed = parseOccurrenceKeyDateFn(a.occurrenceKey); // null para "plan:h:horómetro" (sin fecha discreta)
    const dateISO = parsed?.dateISO || null;
    const shiftId = parsed?.shiftId || null;
    if (a.status === 'PENDING' && a.assignedCrewId === myCrewId) {
      if (a.occurrenceKey && seenOccurrenceKeys.has(a.occurrenceKey)) continue;
      if (a.occurrenceKey) seenOccurrenceKeys.add(a.occurrenceKey);
      // Reasignación recibida / trabajo excepcional asignado — TAREA
      // ACCIONABLE mientras siga PENDING, sin importar el turno real
      // actual (nunca expira por sí sola, ver ASSIGNMENT_STATUS).
      tasks.push({
        id: assignmentTaskId(a),
        kind: 'TAREA', type: 'ASIGNACION',
        priority: PANEL_PRIORITY.PENDIENTE,
        equipmentId: a.equipmentId, equipmentCode: eq?.code || null,
        motivo: a.previousCrewId ? 'Reasignación recibida' : 'Trabajo excepcional asignado',
        turno: shiftId, fechaHora: a.assignedAt || null,
        estado: a.status, overdue: isPastDateISO(dateISO, todayISO),
        actionLabel: 'Ver asignación', actionType: 'VER_ASIGNACION', actionTarget: a.id,
      });
    } else if (a.status === 'PENDING' && a.previousCrewId === myCrewId && a.assignedCrewId !== myCrewId) {
      // Me la quitaron: ya no es mi responsabilidad — solo informativo.
      notifications.push({
        id: assignmentNoticeId(a, 'reasignada'),
        kind: 'NOTIFICACION', type: 'REASIGNACION_SALIENTE',
        priority: PANEL_PRIORITY.INFORMATIVA,
        equipmentId: a.equipmentId, equipmentCode: eq?.code || null,
        motivo: 'Cambio de asignación: este engrase ya no es tu responsabilidad',
        turno: shiftId, fechaHora: a.assignedAt || null,
        estado: a.status, overdue: false,
        actionLabel: 'Ver equipo', actionType: 'VER_EQUIPO', actionTarget: a.equipmentId,
      });
    } else if (a.status === 'CANCELLED' && (a.assignedCrewId === myCrewId || a.previousCrewId === myCrewId)) {
      notifications.push({
        id: assignmentNoticeId(a, 'cancelada'),
        kind: 'NOTIFICACION', type: 'CANCELACION',
        priority: PANEL_PRIORITY.INFORMATIVA,
        equipmentId: a.equipmentId, equipmentCode: eq?.code || null,
        motivo: 'Tarea cancelada',
        turno: shiftId, fechaHora: a.assignedAt || null,
        estado: a.status, overdue: false,
        actionLabel: 'Ver equipo', actionType: 'VER_EQUIPO', actionTarget: a.equipmentId,
      });
    }
  }
  return { tasks, notifications };
}

function buildReprogramacionNotices({ plans, equipment, visibleEquipmentIds }) {
  const lookup = panelEquipmentLookup(equipment);
  const visible = visibleEquipmentIds ? new Set(visibleEquipmentIds) : null;
  return (plans || [])
    .filter(p => p.active !== false && p.reprogramadoHasta)
    .filter(p => !visible || visible.has(p.equipmentId))
    .map(p => {
      const eq = lookup(p.equipmentId);
      return {
        id: reprogramacionNoticeId(p),
        kind: 'NOTIFICACION', type: 'REPROGRAMACION',
        priority: PANEL_PRIORITY.INFORMATIVA,
        equipmentId: p.equipmentId, equipmentCode: eq?.code || null,
        motivo: p.reprogramadoMotivo || 'Trabajo reprogramado',
        turno: p.shiftId || null, // §2: un aviso de reprogramación de un plan 100% del OTRO turno no debe llegar a quien no le corresponde.
        fechaHora: p.reprogramadoHasta,
        estado: 'REPROGRAMADO', overdue: false,
        actionLabel: 'Ver equipo', actionType: 'VER_EQUIPO', actionTarget: p.equipmentId,
      };
    });
}

const PRIORITY_RANK = { CRITICA: 0, PENDIENTE: 1, INFORMATIVA: 2 };

function sortPanelItems(items) {
  return [...items].sort((x, y) => {
    const byPriority = PRIORITY_RANK[x.priority] - PRIORITY_RANK[y.priority];
    if (byPriority !== 0) return byPriority;
    if (x.overdue !== y.overdue) return x.overdue ? -1 : 1;
    return String(y.fechaHora || '').localeCompare(String(x.fechaHora || ''));
  });
}

// Punto de entrada único. `isRecordPendingValidationFn`/
// `isRecordValidationExpiredFn` se reciben como parámetro (nunca
// importados aquí): el caller real (app.js) ya los tiene cargados desde
// grease-validation.js — este módulo nunca asume cómo se cargan los demás
// módulos puros del proyecto (mismo patrón que anomaly-actions.js recibe
// fmtDate/CRITICIDAD_POR_MOTIVO).
function buildTasksNotificationsPanel({
  anomalies = [], records = [], validations = [], assignments = [], plans = [], equipment = [],
  manualTasks = [], visibleCrewIds = null, broadcasts = [], readMessageIds = null, includeBroadcasts = true,
  visibleEquipmentIds = null, myCrewId = null, currentShiftId = null, todayISO = null,
  now = new Date(), shiftBoundaries = {},
  isRecordPendingValidationFn, isRecordValidationExpiredFn, parseOccurrenceKeyDateFn,
}) {
  const anomalyTasks = buildAnomalyTasks({ anomalies, equipment, visibleEquipmentIds });
  const validationTasks = buildValidationTasks({
    records, validations, equipment, visibleEquipmentIds, now, shiftBoundaries,
    isRecordPendingValidationFn, isRecordValidationExpiredFn,
  });
  const { tasks: assignmentTasks, notifications: assignmentNotices } =
    buildAssignmentTasksAndNotices({ assignments, equipment, myCrewId, todayISO, parseOccurrenceKeyDateFn });
  const reprogramacionNotices = buildReprogramacionNotices({ plans, equipment, visibleEquipmentIds });
  // manual_tasks: lista APARTE (nunca mezclada en `tasks`) — sus tarjetas
  // necesitan más campos (cuadrilla/creador/tipo/vencimiento) que el render
  // genérico de anomalías/validaciones/asignaciones, ver app.js. No afecta
  // `tasks`/`notifications` existentes (additive, mismos defaults de siempre).
  const manualTaskItems = buildManualTaskItems({ manualTasks, equipment, visibleCrewIds, todayISO });
  // broadcast_messages: SÍ entra en `notifications` (§3 del pedido: "dentro
  // de NOTIFICACIONES", nunca una lista aparte como manual_tasks) — kind
  // SIEMPRE 'NOTIFICACION', nunca se mezcla con TAREA.
  const broadcastNotices = includeBroadcasts ? buildBroadcastNotices({ broadcasts, readMessageIds, todayISO }) : [];

  // Dedupe real por identidad (§4): un Map por id absorbe cualquier
  // duplicado que pudiera llegar de fuentes solapadas — recalcular con los
  // MISMOS datos de entrada siempre produce el MISMO set, nunca crece.
  const tasks = [...new Map([...anomalyTasks, ...validationTasks, ...assignmentTasks].map(t => [t.id, t])).values()];

  // Las NOTIFICACIONES sí respetan el turno real (§2) — las TAREAS nunca
  // (persisten hasta resolverse, §3, confirmado explícitamente por la
  // prueba "validación pendiente persiste al cambiar turno"). broadcasts
  // tienen turno=null siempre (nunca se targetean por turno, solo por
  // cuadrilla/ubicación/usuario/todos) — nunca se filtran por esta regla.
  const allNotices = [...new Map([...assignmentNotices, ...reprogramacionNotices, ...broadcastNotices].map(n => [n.id, n])).values()];
  const notifications = currentShiftId
    ? allNotices.filter(n => !n.turno || n.turno === currentShiftId)
    : allNotices;

  return { tasks: sortPanelItems(tasks), notifications: sortPanelItems(notifications), manualTasks: manualTaskItems };
}

// Contadores del badge (§10): SOLO pendientes reales — nunca cuenta una
// notificación ya leída, nunca duplica por volver a renderizar (cuenta el
// arreglo YA deduplicado que devuelve buildTasksNotificationsPanel(),
// nunca re-cuenta desde una fuente distinta). `readNoticeIds` es estado
// de "leído" que el caller persiste (p.ej. localStorage) — este módulo no
// decide DÓNDE se guarda, solo lo aplica si se le pasa.
function countPanelBadges({ tasks, notifications }, { readNoticeIds = null } = {}) {
  const unreadNotifications = readNoticeIds
    ? notifications.filter(n => !readNoticeIds.has(n.id))
    : notifications;
  return {
    taskCount: tasks.length,
    criticalTaskCount: tasks.filter(t => t.priority === PANEL_PRIORITY.CRITICA).length,
    notificationUnreadCount: unreadNotifications.length,
  };
}
