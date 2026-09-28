/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT — src/core/operational-scope.js
   Rediseño operativo (dispositivos compartidos + cuadrillas + ubicaciones +
   asignación manual de engrases) — ver docs/OPERATIONAL_SCOPE.md.

   AUTORIDAD ÚNICA — nadie más repite esta lógica:
     - Para roles de jefatura (ADMINISTRADOR/PLANIFICADOR/SUPERVISOR/VISOR):
       vista GLOBAL, sin scope de dispositivo/cuadrilla.
     - Para LUBRICADOR: DISPOSITIVO -> CUADRILLA -> UBICACIÓN decide qué
       trabajo es visible/ejecutable. El turno (Día/Noche) se resuelve
       SIEMPRE por hora real (currentShiftId(), inyectado como parámetro —
       este módulo no lee el reloj directamente para poder probarse con
       una hora fija), NUNCA por un campo guardado en el dispositivo.
       App.currentUser (identidad Auth) aporta SOLO id/rol — nunca
       location/cuadrilla, ver §AC del pedido de cierre.

   Todo puro: recibe los datos ya cargados (equipos, planes, cuadrillas,
   assignments, etc.) como parámetros explícitos, nunca toca DB/red/DOM —
   mismo criterio que src/core/weekly-matrix.js / plan-compliance.js.
   ============================================================ */

const ASSIGNMENT_STATUS = { PENDING: 'PENDING', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED' };

// Roles que pueden asignar/reasignar/cancelar un engrase manualmente (§L).
const ROLES_CAN_MANAGE_ASSIGNMENTS = ['ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR'];
// Roles que pueden mover un EQUIPO de ubicación permanentemente (§W) — acción DISTINTA de asignar.
const ROLES_CAN_MOVE_EQUIPMENT = ['ADMINISTRADOR', 'PLANIFICADOR'];
// Roles que pueden mover una CUADRILLA de ubicación (§Z).
const ROLES_CAN_MOVE_CREW = ['ADMINISTRADOR', 'PLANIFICADOR'];
// Roles que pueden cambiar la cuadrilla asignada a UN DISPOSITIVO (§F).
const ROLES_CAN_CONFIGURE_DEVICE = ['ADMINISTRADOR', 'PLANIFICADOR'];

function canManageAssignments(role) { return ROLES_CAN_MANAGE_ASSIGNMENTS.includes(role); }
function canMoveEquipment(role) { return ROLES_CAN_MOVE_EQUIPMENT.includes(role); }
function canMoveCrew(role) { return ROLES_CAN_MOVE_CREW.includes(role); }
function canConfigureDevice(role) { return ROLES_CAN_CONFIGURE_DEVICE.includes(role); }

/* ============================================================
   IDENTIDAD DE OCURRENCIA (§O) — CRÍTICO
   ============================================================
   Nunca "equipmentId + assignedCrewId" (eso volvería la asignación
   permanente). Debe identificar la ocurrencia CONCRETA, sin inventar
   ningún campo nuevo en lubrication_plans — se deriva de lo que YA existe:
     - Plan "Día y turno de la semana": una ocurrencia = un DÍA calendario
       concreto en el que el plan aplica (assignedDays). Clave estable:
       `${planId}:${YYYY-MM-DD}`.
     - Plan "Horas de operación": no hay días discretos — la ocurrencia
       "actual" es LA PRÓXIMA pendiente desde la última base confirmada
       (plan.lastGreaseHour). Cuando se registra un engrase, lastGreaseHour
       avanza -> nace una ocurrencia NUEVA (clave distinta) de forma
       automática, sin colisionar con la ya completada. Clave estable:
       `${planId}:h:${lastGreaseHour ?? 0}`.
   Determinista y estable: mismos insumos -> misma clave, siempre. */
function computeOccurrenceKey(plan, { dateISO } = {}) {
  if (!plan || !plan.id) throw new Error('computeOccurrenceKey requiere un plan con id.');
  if (plan.controlType === 'Día y turno de la semana') {
    if (!dateISO) throw new Error('computeOccurrenceKey: falta dateISO para un plan por día/turno.');
    return `${plan.id}:${dateISO}`;
  }
  // 'Horas de operación' (o cualquier otro controlType futuro que no sea por día): por ciclo de horómetro.
  const base = plan.lastGreaseHour ?? 0;
  return `${plan.id}:h:${base}`;
}

/* ============================================================
   CUADRILLA POR DEFECTO DE UNA UBICACIÓN (§K)
   ============================================================
   Máximo UNA cuadrilla `isDefault:true` activa por locationId — la que
   recibe el trabajo NORMAL de esa ubicación. Cuadrillas adicionales en la
   misma ubicación solo reciben trabajo por asignación manual explícita.
   Pura: si hay más de una marcada default por error de datos, gana la de
   creación más antigua (createdAt) — nunca ambigüedad silenciosa, y nunca
   lanza (un dato mal cargado no debe tumbar toda la pantalla). */
function resolveDefaultCrewForLocation(cuadrillas, locationId) {
  if (!locationId) return null;
  const candidatas = (cuadrillas || [])
    .filter(c => c.active !== false && c.locationId === locationId && c.isDefault === true)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  return candidatas[0] || null;
}

/* ============================================================
   SCOPE OPERATIVO (§I) — AUTORIDAD CENTRAL, se llama UNA vez por pantalla
   ============================================================
   `currentShiftId` se recibe ya calculado (currentShiftId() de
   src/core/shifts.js) — nunca se guarda ni se lee de deviceAssignment
   (§H: el turno NUNCA es una propiedad fija del dispositivo). */
function resolveOperationalScope({ currentUser, deviceAssignment, cuadrillas, shiftId }) {
  if (!currentUser) return { kind: 'NONE' };
  if (currentUser.role !== 'LUBRICADOR') {
    return {
      kind: 'GLOBAL', userId: currentUser.id, role: currentUser.role,
      shiftId: shiftId || null, deviceId: null, crewId: null, crewLocationId: null
    };
  }
  const deviceId = deviceAssignment ? deviceAssignment.deviceId : null;
  const crewId = deviceAssignment && deviceAssignment.cuadrillaId ? deviceAssignment.cuadrillaId : null;
  if (!crewId) {
    return { kind: 'DEVICE_UNASSIGNED', userId: currentUser.id, role: currentUser.role, shiftId, deviceId, crewId: null, crewLocationId: null };
  }
  const crew = (cuadrillas || []).find(c => c.id === crewId && c.active !== false);
  if (!crew) {
    // La cuadrilla asignada a este dispositivo ya no existe/está inactiva
    // — mismo tratamiento que "sin cuadrilla" (§G), nunca un fallback global.
    return { kind: 'DEVICE_UNASSIGNED', userId: currentUser.id, role: currentUser.role, shiftId, deviceId, crewId: null, crewLocationId: null };
  }
  return {
    kind: 'DEVICE_SCOPED', userId: currentUser.id, role: currentUser.role, shiftId, deviceId,
    crewId: crew.id, crewLocationId: crew.locationId || null
  };
}

/* ============================================================
   CLASIFICACIÓN DE TRABAJO VISIBLE/EJECUTABLE (§J, §K, §L, §AH)
   ============================================================
   Para un scope DEVICE_SCOPED (Lubricador con dispositivo configurado):
     - "normal": equipos cuya locationId coincide con crewLocationId, Y
       cuya cuadrilla-por-defecto de esa ubicación es la de este scope
       (así, con 2+ cuadrillas en la misma ubicación, el trabajo normal
       SOLO lo ve la default — §K, nunca doble conteo/doble ejecución) Y
       que NO tengan una assignment PENDING activa hacia OTRA cuadrilla
       (si la tienen, ese trabajo pasó a ser responsabilidad de esa otra
       cuadrilla, ver §L: "NO debe seguir como trabajo ejecutable
       simultáneo para la cuadrilla original").
     - "assigned": occurrences con una lubrication_assignments PENDING cuyo
       assignedCrewId === scope.crewId, sin importar dónde esté el equipo.
   `equipoOccurrenceKeyFn(equipo)` la provee el caller (depende del plan
   vigente de ese equipo, ya resuelto aparte — este módulo no conoce
   lubrication_plans/estadoCelda en detalle, para no duplicar esa lógica). */
function classifyEquipmentWork({ scope, equipos, cuadrillas, assignments, equipoOccurrenceKeyFn }) {
  const pendientes = (assignments || []).filter(a => a.active !== false && a.status === ASSIGNMENT_STATUS.PENDING);
  const porOccurrence = new Map(pendientes.map(a => [a.occurrenceKey, a]));

  if (!scope || scope.kind === 'NONE') return { normal: [], assigned: [] };
  if (scope.kind !== 'DEVICE_SCOPED') {
    // Jefaturas: vista global — devuelve todo, sin filtrar (la pantalla
    // decide qué mostrar; este módulo solo evita doble conteo para
    // Lubricador, que es donde "ejecutar" importa de verdad).
    return { normal: equipos || [], assigned: pendientes };
  }

  const defaultCrew = resolveDefaultCrewForLocation(cuadrillas, scope.crewLocationId);
  const esCuadrillaDefault = !!defaultCrew && defaultCrew.id === scope.crewId;

  const normal = (equipos || []).filter(e => {
    if (e.locationId !== scope.crewLocationId) return false;
    if (!esCuadrillaDefault) return false; // solo la cuadrilla default recibe trabajo "normal" de la ubicación
    const key = equipoOccurrenceKeyFn ? equipoOccurrenceKeyFn(e) : null;
    if (key) {
      const asg = porOccurrence.get(key);
      // Si ESTA ocurrencia concreta ya está asignada a OTRA cuadrilla,
      // deja de ser trabajo normal ejecutable aquí (§L) — pero si está
      // asignada a la MISMA cuadrilla (raro, pero válido), sigue contando
      // una sola vez (se deduplica más abajo).
      if (asg && asg.assignedCrewId !== scope.crewId) return false;
    }
    return true;
  });

  const assignedAquí = pendientes.filter(a => a.assignedCrewId === scope.crewId);
  const idsAsignados = new Set(assignedAquí.map(a => a.equipmentId));
  // El equipo puede aparecer en "normal" (misma cuadrilla, asignación
  // redundante) — se excluye de "normal" para no duplicarlo, queda solo en
  // "assigned" con el badge correspondiente.
  const normalSinDuplicar = normal.filter(e => !idsAsignados.has(e.id) || !assignedAquí.some(a => a.equipmentId === e.id));

  return { normal: normalSinDuplicar, assigned: assignedAquí };
}

/* ============================================================
   MOTOR DE ASIGNACIONES (§L, §O, §P, §Q, §R) — funciones puras de
   DECISIÓN: reciben el estado actual y devuelven qué escribir, o lanzan un
   Error con mensaje de negocio si la operación no es válida. Quien llama
   (app.js) hace el DB.put/stamp()/logAudit real — nunca al revés.
   ============================================================ */

// Máximo UNA assignment PENDING activa por occurrenceKey (§O) — se llama
// ANTES de crear una nueva, para no duplicar. `existing` = todas las
// assignments ya cargadas (activas o no).
function findActivePendingAssignment(existing, occurrenceKey) {
  return (existing || []).find(a => a.active !== false && a.status === ASSIGNMENT_STATUS.PENDING && a.occurrenceKey === occurrenceKey) || null;
}

function createAssignment({ existing, occurrenceKey, equipmentId, planId, assignedCrewId, assignedByUserId, assignedByUserName, notes, now, uid }) {
  if (findActivePendingAssignment(existing, occurrenceKey)) {
    throw new Error('Ya existe una asignación pendiente para este engrase — reasígnala en vez de crear otra.');
  }
  return {
    id: uid('asg'), occurrenceKey, equipmentId, planId: planId || null,
    assignedCrewId, assignedByUserId, assignedByUserName,
    assignedAt: now, status: ASSIGNMENT_STATUS.PENDING,
    completedAt: null, completedRecordId: null, previousCrewId: null,
    notes: notes || '', active: true
  };
}

// Reasignación: mientras siga PENDING, cambia la cuadrilla destino — nunca
// crea una segunda assignment activa para la misma occurrence (§P).
function reassignAssignment(assignment, { newCrewId, now }) {
  if (!assignment) throw new Error('Asignación no encontrada.');
  if (assignment.status !== ASSIGNMENT_STATUS.PENDING) {
    throw new Error('Solo se puede reasignar una asignación pendiente.');
  }
  if (newCrewId === assignment.assignedCrewId) {
    throw new Error('Ya está asignada a esa cuadrilla.');
  }
  return { ...assignment, previousCrewId: assignment.assignedCrewId, assignedCrewId: newCrewId, updatedAtDecision: now };
}

// Cancelar: el engrase pendiente vuelve al flujo normal de su ubicación si
// sigue correspondiendo (preferencia documentada en §Q) — esto lo decide
// classifyEquipmentWork() automáticamente en cuanto la assignment deja de
// estar PENDING (ya no aparece en `porOccurrence`), sin ninguna acción
// adicional aquí.
function cancelAssignment(assignment, { now }) {
  if (!assignment) throw new Error('Asignación no encontrada.');
  if (assignment.status !== ASSIGNMENT_STATUS.PENDING) {
    throw new Error('Solo se puede cancelar una asignación pendiente.');
  }
  return { ...assignment, status: ASSIGNMENT_STATUS.CANCELLED, completedAt: null, updatedAtDecision: now };
}

// Se llama SIEMPRE que se guarda un lubrication_record — completa la
// assignment activa de esa occurrence si existe (§R). Si no hay ninguna
// (trabajo normal, sin asignación manual), no hace nada — devuelve null.
function completeAssignmentIfPending(existing, { occurrenceKey, recordId, now }) {
  const asg = findActivePendingAssignment(existing, occurrenceKey);
  if (!asg) return null;
  return { ...asg, status: ASSIGNMENT_STATUS.COMPLETED, completedAt: now, completedRecordId: recordId };
}

/* ============================================================
   QR — permiso de ejecución fuera de scope (§AO)
   ============================================================ */
function canLubricadorExecuteEquipment({ scope, equipo, assignments }) {
  if (!scope || scope.kind !== 'DEVICE_SCOPED') return true; // jefaturas: sin restricción aquí
  if (equipo.locationId === scope.crewLocationId) return true; // dentro de su ubicación normal
  const pendientes = (assignments || []).filter(a => a.active !== false && a.status === ASSIGNMENT_STATUS.PENDING);
  return pendientes.some(a => a.equipmentId === equipo.id && a.assignedCrewId === scope.crewId);
}
