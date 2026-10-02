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
// Roles que pueden registrar un engrase FUERA DE PLAN (lote "engrase fuera
// de plan" §2/§28) — VISOR nunca registra nada, igual que en el resto de la app.
const ROLES_CAN_REGISTER_OUT_OF_PLAN = ['ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR', 'LUBRICADOR'];

function canManageAssignments(role) { return ROLES_CAN_MANAGE_ASSIGNMENTS.includes(role); }
function canMoveEquipment(role) { return ROLES_CAN_MOVE_EQUIPMENT.includes(role); }
function canMoveCrew(role) { return ROLES_CAN_MOVE_CREW.includes(role); }
function canConfigureDevice(role) { return ROLES_CAN_CONFIGURE_DEVICE.includes(role); }
function canRegisterOutOfPlan(role) { return ROLES_CAN_REGISTER_OUT_OF_PLAN.includes(role); }

/* ============================================================
   TIPOS DE EJECUCIÓN (lote "engrase fuera de plan")
   ============================================================
   RETROACTIVO/ATRASADO (campo `record.retroactivo`, ya existente) describe
   CUÁNDO se registra un engrase — nada que ver con esto. `executionType`
   describe POR QUÉ/CONTEXTO se ejecutó, y es ortogonal: un engrase puede
   ser retroactivo Y fuera de plan a la vez, o ninguna de las dos.
     - PLANNED: trabajo generado normalmente por el plan (flujo de siempre).
     - ASSIGNED: la ocurrencia pendiente fue asignada manualmente a otra
       cuadrilla (lubrication_assignments) — SIEMPRE gana sobre OUT_OF_PLAN
       si existe una assignment activa para la ocurrencia (§15).
     - OUT_OF_PLAN: el equipo se engrasó fuera de la ocurrencia esperada
       (PM, correctivo, oportunidad operativa, otro motivo) — botón
       "+ Engrase fuera de plan", nunca requiere que Planificador cree una
       assignment artificial primero. */
const EXECUTION_TYPE = { PLANNED: 'PLANNED', ASSIGNED: 'ASSIGNED', OUT_OF_PLAN: 'OUT_OF_PLAN' };
const EXECUTION_COMPLETENESS = { COMPLETE: 'COMPLETE', PARTIAL: 'PARTIAL' };
const OUT_OF_PLAN_REASONS = ['PM', 'CORRECTIVO', 'OPORTUNIDAD', 'OTRO'];

// Se calcula desde los puntos del checklist — nunca un checkbox manual
// "engrase completo" (§8 del pedido). Sin puntos configurados: no hay nada
// requerido que pueda faltar -> COMPLETE.
function computeExecutionCompleteness(details) {
  if (!details || !details.length) return EXECUTION_COMPLETENESS.COMPLETE;
  return details.every(d => d.done) ? EXECUTION_COMPLETENESS.COMPLETE : EXECUTION_COMPLETENESS.PARTIAL;
}

function toISODateUTCLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ============================================================
   OCURRENCIA APLICABLE PARA UN ENGRASE FUERA DE PLAN (§12/§13)
   ============================================================
   Determina si existe UNA sola ocurrencia próxima (sin completar todavía)
   que un engrase fuera de plan COMPLETO puede satisfacer por adelantado.
   Ambiguo (0 o 2+ candidatas en la ventana) -> null, NUNCA se inventa un
   cumplimiento (§13: "para LUBRICADOR, registrar OUT_OF_PLAN sin satisfacer
   occurrence" en ese caso). Usa el global WEEKDAY_NAMES (lubrication-status.js),
   mismo patrón que estadoCelda() en weekly-matrix.js. */
function findNextApplicableOccurrenceForWeekdayPlan({ plan, existingRecords, todayDate }) {
  if (!plan || plan.controlType !== 'Día y turno de la semana') return null;
  const dias = plan.assignedDays || [];
  if (!dias.length) return null;
  const candidatas = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(todayDate);
    d.setDate(d.getDate() + i);
    const nombreDia = WEEKDAY_NAMES[d.getDay()];
    if (!dias.includes(nombreDia)) continue;
    const yaHecho = (existingRecords || []).some(r => new Date(r.date).toDateString() === d.toDateString());
    if (!yaHecho) candidatas.push(toISODateUTCLocal(d));
  }
  if (candidatas.length !== 1) return null;
  return { occurrenceKey: computeOccurrenceKey(plan, { dateISO: candidatas[0] }), dateISO: candidatas[0] };
}

// Punto de entrada único (§12: "no copiar lógica en varias pantallas") —
// despacha por tipo de plan. "Horas de operación" nunca es ambiguo: el
// ciclo vigente siempre es UNO solo (ver computeOccurrenceKey).
function findNextApplicableOccurrence({ plan, existingRecords, todayDate }) {
  if (!plan) return null;
  if (plan.controlType === 'Día y turno de la semana') {
    return findNextApplicableOccurrenceForWeekdayPlan({ plan, existingRecords, todayDate });
  }
  return { occurrenceKey: computeOccurrenceKey(plan, {}), dateISO: null };
}

// ¿Qué ocurrencia satisface (si alguna) un engrase FUERA DE PLAN al
// guardarse? Solo COMPLETE puede satisfacer (§9/§25: PARTIAL nunca reinicia
// ciclo ni cancela un recordatorio pendiente).
function resolveOutOfPlanSatisfaction({ plan, completeness, existingRecords, todayDate }) {
  if (completeness !== EXECUTION_COMPLETENESS.COMPLETE) return null;
  const found = findNextApplicableOccurrence({ plan, existingRecords, todayDate });
  return found ? found.occurrenceKey : null;
}

/* ============================================================
   DETECCIÓN DE TRABAJO EXISTENTE ANTES DE ABRIR "FUERA DE PLAN" (§5)
   ============================================================
   Prioridad ASSIGNED > PLANNED > (ninguno, recién ahí se abre OUT_OF_PLAN).
   `statusCode` (ROJO/AMARILLO/VERDE/GRIS) ya viene resuelto por el caller
   (statusFor(), lubrication-status.js) — este módulo no recalcula el
   semáforo, evita duplicar esa lógica. */
function findExistingWorkForEquipment({ plan, assignments, statusCode, todayDate }) {
  if (!plan) return { kind: 'NONE' };
  const dateISO = toISODateUTCLocal(todayDate);
  const occurrenceKey = computeOccurrenceKey(plan, { dateISO });
  const activeAssignment = findActivePendingAssignment(assignments, occurrenceKey);
  if (activeAssignment) return { kind: 'ASSIGNED', assignment: activeAssignment, occurrenceKey };

  if (plan.controlType === 'Día y turno de la semana') {
    const nombreDia = WEEKDAY_NAMES[todayDate.getDay()];
    if ((plan.assignedDays || []).includes(nombreDia)) return { kind: 'PLANNED', occurrenceKey };
    return { kind: 'NONE' };
  }
  if (statusCode === 'ROJO' || statusCode === 'AMARILLO') return { kind: 'PLANNED', occurrenceKey };
  return { kind: 'NONE' };
}

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
   SNAPSHOT HISTÓRICO (§1 del cierre de lote — lubrication_records)
   ============================================================
   Equipo/cuadrilla ahora pueden moverse de ubicación — un registro
   histórico NUNCA puede depender de `equipment.locationId`/`crew.locationId`
   ACTUALES (eso reescribiría el pasado en cuanto alguien mueva algo).
   `buildExecutionSnapshot()` arma el snapshot para un registro NUEVO, con
   los valores YA resueltos por el caller (app.js, que sí puede leer
   DB/scope) — este módulo sigue sin tocar DB/red. `resolveRecord*()` los
   leen de vuelta con fallback legado EXPLÍCITO (nunca inventa datos para
   registros viejos que no lo tienen). */
function buildExecutionSnapshot({
  equipmentLocationId, crewId, crewLocationId, performedByUserId, shiftId, assignmentId,
  executionType, outOfPlanReason, executionCompleteness, satisfiedOccurrenceKey
}) {
  return {
    equipmentLocationIdAtExecution: equipmentLocationId || null,
    crewId: crewId || null,
    crewLocationIdAtExecution: crewLocationId || null,
    performedByUserId: performedByUserId || null,
    shiftId: shiftId || null,
    assignmentId: assignmentId || null,
    // El caller decide PLANNED/ASSIGNED/OUT_OF_PLAN según por qué flujo entró
    // (Mi Turno normal / assignment activa / botón "+ Engrase fuera de
    // plan") — nunca se infiere solo de assignmentId, salvo el fallback
    // razonable de "si no me dicen nada y hay assignmentId, es ASSIGNED".
    executionType: executionType || (assignmentId ? EXECUTION_TYPE.ASSIGNED : EXECUTION_TYPE.PLANNED),
    outOfPlanReason: outOfPlanReason || null,
    executionCompleteness: executionCompleteness || null,
    satisfiedOccurrenceKey: satisfiedOccurrenceKey || null
  };
}

// Ubicación del EQUIPO al momento de ejecutar ese registro concreto.
// `source` deja explícito si el dato es histórico real (snapshot) o un
// fallback a la ubicación ACTUAL del equipo (registros de antes de este
// lote, que nunca guardaron snapshot) — nunca se presenta uno como el otro.
function resolveRecordEquipmentLocationId(record, equipoActual) {
  const snap = record && record.operationalSnapshot;
  if (snap && snap.equipmentLocationIdAtExecution) {
    return { value: snap.equipmentLocationIdAtExecution, source: 'snapshot' };
  }
  return { value: equipoActual ? (equipoActual.locationId || null) : null, source: 'legacy_fallback' };
}

// Cuadrilla que ejecutó ese registro concreto — sin snapshot, NUNCA se
// adivina (a diferencia de la ubicación del equipo, no hay un "actual"
// razonable al que caer: el registro pudo hacerse antes de que existiera el
// concepto de cuadrilla-por-dispositivo).
function resolveRecordCrewId(record) {
  const snap = record && record.operationalSnapshot;
  if (snap && snap.crewId) return { value: snap.crewId, source: 'snapshot' };
  return { value: null, source: 'legacy_fallback' };
}

// Ubicación de ESA cuadrilla al momento de ejecutar — nunca la ubicación
// ACTUAL de la cuadrilla (que pudo moverse desde entonces, ver CASO
// equivalente de mover cuadrilla en el pedido).
function resolveRecordCrewLocationId(record) {
  const snap = record && record.operationalSnapshot;
  if (snap && snap.crewLocationIdAtExecution) return { value: snap.crewLocationIdAtExecution, source: 'snapshot' };
  return { value: null, source: 'legacy_fallback' };
}

// Tipo de ejecución para Historial/Reportes (§18/§22) — registros de antes
// de este lote nunca guardaron esto: se presentan como PLANNED (el
// comportamiento de siempre era "todo es trabajo normal"), nunca como si
// hubieran sido fuera de plan o asignados sin poder probarlo.
function resolveRecordExecutionType(record) {
  const snap = record && record.operationalSnapshot;
  if (snap && snap.executionType) return { value: snap.executionType, source: 'snapshot' };
  return { value: EXECUTION_TYPE.PLANNED, source: 'legacy_fallback' };
}

function resolveRecordOutOfPlanReason(record) {
  const snap = record && record.operationalSnapshot;
  return snap && snap.outOfPlanReason ? snap.outOfPlanReason : null;
}

function resolveRecordCompleteness(record) {
  const snap = record && record.operationalSnapshot;
  return snap && snap.executionCompleteness ? snap.executionCompleteness : null;
}

/* ============================================================
   NO SE PUDO EJECUTAR (lote occurrences/carryover, §1)
   ============================================================
   Registra que una ocurrencia NO se pudo engrasar en este turno — NUNCA
   crea un lubrication_record (no marca "realizado"). El carryover al
   siguiente turno del MISMO día es automático y gratis: estadoCelda()
   (weekly-matrix.js) decide 'pendiente'/'no_realizado' por FECHA, no por
   turno — mientras la fecha de la ocurrencia siga siendo HOY, la celda
   sigue 'pendiente' sin importar cuántos turnos ya pasaron hoy, así que un
   "no se pudo ejecutar" de Día deja la ocurrencia disponible para Noche sin
   ningún cambio en weekly-matrix.js/plan-compliance.js. Este módulo solo
   valida la entrada y arma el registro — quien llama (app.js) hace el
   DB.put()/logAudit() real, mismo criterio que buildExecutionSnapshot(). */
const NO_EXECUTION_REASONS = ['REPARACION', 'YA_ENGRASADO', 'SIN_TIEMPO', 'NO_DISPONIBLE', 'CONDICION_INSEGURA', 'OTRO'];

// "Otro" exige observación — mismo criterio que outOfPlanReason==='OTRO' en
// el flujo de "+ Fuera de plan" (app.js): nunca depender solo de la
// etiqueta genérica para saber qué pasó de verdad.
function validateNoExecutionInput({ reason, observacion }) {
  if (!NO_EXECUTION_REASONS.includes(reason)) {
    throw new Error('Motivo de "No se pudo ejecutar" no válido.');
  }
  if (reason === 'OTRO' && !(observacion || '').trim()) {
    throw new Error('Escribe una observación describiendo el motivo.');
  }
}

function buildNoExecutionRecord({
  id, equipmentId, planId, occurrenceKey, date, shiftId,
  reason, observacion, userId, userName, now, linkedRecordId
}) {
  validateNoExecutionInput({ reason, observacion });
  return {
    id, equipmentId, planId: planId || null, occurrenceKey: occurrenceKey || null,
    date, shiftId, reason, observacion: (observacion || '').trim() || null,
    userId, userName, createdAt: now, active: true,
    // Solo para YA_ENGRASADO conciliado con un lubrication_record real
    // (ver findMatchingGreaseRecordForOccurrence() más abajo) — null en
    // cualquier otro caso, nunca inventado.
    linkedRecordId: linkedRecordId || null
  };
}

// ¿La ocurrencia de HOY para este equipo ya tiene un "no se pudo ejecutar"
// de OTRO turno anterior del mismo día? Sirve para avisar al turno que
// entra (carryover) — nunca oculta el motivo real. Si hubiera más de uno
// (no debería pasar en un día normal), toma el más reciente sin romperse.
// `skips` ya viene filtrado a activos por el caller (DB.allActive).
function findCarriedOverSkipForToday(skips, { equipmentId, dateISO }) {
  const delDia = (skips || []).filter(s => s.equipmentId === equipmentId &&
    (s.date || '').slice(0, 10) === dateISO);
  if (!delDia.length) return null;
  return delDia.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
}

/* ============================================================
   MATCH DE "YA FUE ENGRASADO RECIENTEMENTE" (cierre histórico, Parte A)
   ============================================================
   Cuando el motivo de "no se pudo ejecutar" es YA_ENGRASADO, busca si
   existe un lubrication_record REAL que satisfaga inequívocamente esta
   ocurrencia — NUNCA cierra/asume cumplimiento solo porque se marcó el
   motivo (§2 del pedido: "no inventar cumplimiento"). Un match, si existe,
   ya era antes suficiente para que weekly-matrix.js/plan-compliance.js
   mostraran la ocurrencia como hecha (esto NUNCA recalcula eso) — esta
   función solo decide si hay una correspondencia clara para poder
   ENLAZAR el motivo YA_ENGRASADO a esa evidencia real en el historial, en
   vez de dejarlo como una afirmación sin respaldo.

   Alcance a propósito LIMITADO a planes "Día y turno de la semana": para
   "Horas de operación" no hay una fecha discreta que "corresponda" a la
   ocurrencia sin proyectar horas->tiempo (prohibido, ver
   docs/PLAN_COMPLIANCE_ANTICIPADO.md) — esos casos SIEMPRE van a
   conciliación manual, nunca se intenta un match automático.

   Prioridad (§8/§9/§10):
     1. Si la ocurrencia ya tiene una assignment COMPLETED con
        completedRecordId — ese vínculo YA es inequívoco por diseño
        (completeGreaseAssignmentForOccurrence()), se reutiliza tal cual,
        nunca se reevalúa por fecha.
     2. Si no, candidatos = records del MISMO equipo, MISMA fecha de
        calendario que la ocurrencia, COMPLETE (nunca PARTIAL — §7: un
        parcial nunca cierra automáticamente algo que se espera COMPLETE),
        que un OUT_OF_PLAN solo cuenta si su propio
        satisfiedOccurrenceKey YA apunta a esta ocurrencia (§9: "no asumir
        que todo OUT_OF_PLAN cuenta"), y que ningún OTRO skip ya haya
        vinculado (linkedRecordId) — un mismo record nunca reconcilia dos
        ocurrencias (§10).
   0 candidatos -> NONE (conciliación manual, sin cerrar nada).
   1 candidato -> MATCH (candidato único, listo para "Vincular al plan").
   2+ candidatos -> AMBIGUOUS (requiere revisión del Planificador, nunca
   se elige uno arbitrariamente). */
const GREASE_MATCH_STATUS = { MATCH: 'MATCH', AMBIGUOUS: 'AMBIGUOUS', NONE: 'NONE' };

function findMatchingGreaseRecordForOccurrence({ plan, occurrenceKey, occurrenceDate, records, assignments, skips }) {
  if (!plan || plan.controlType !== 'Día y turno de la semana') {
    return { status: GREASE_MATCH_STATUS.NONE, records: [] };
  }

  const asgCompletada = (assignments || []).find(a =>
    a.occurrenceKey === occurrenceKey && a.status === ASSIGNMENT_STATUS.COMPLETED && a.completedRecordId);
  if (asgCompletada) {
    const rec = (records || []).find(r => r.id === asgCompletada.completedRecordId);
    if (rec) return { status: GREASE_MATCH_STATUS.MATCH, records: [rec], via: 'ASSIGNMENT' };
  }

  const yaVinculados = new Set((skips || []).filter(s => s.linkedRecordId).map(s => s.linkedRecordId));
  const fechaOcurrenciaStr = occurrenceDate.toDateString();
  // Candidato elegible: mismo equipo, COMPLETE, no vinculado ya a otro
  // skip, y (mismo día de calendario que la ocurrencia) O (OUT_OF_PLAN
  // cuya propia satisfiedOccurrenceKey YA apunta exactamente a esta
  // ocurrencia — §9: nunca "cualquier OUT_OF_PLAN de esa fecha" cuenta
  // solo por coincidir de fecha, tiene que venir certificado por
  // resolveOutOfPlanSatisfaction() en el momento en que se guardó).
  const candidatos = (records || []).filter(r => {
    if (r.equipmentId !== plan.equipmentId) return false;
    if (yaVinculados.has(r.id)) return false;
    if (computeExecutionCompleteness(r.details) !== EXECUTION_COMPLETENESS.COMPLETE) return false;
    const esOutOfPlan = resolveRecordExecutionType(r).value === EXECUTION_TYPE.OUT_OF_PLAN;
    if (esOutOfPlan) {
      return !!(r.operationalSnapshot && r.operationalSnapshot.satisfiedOccurrenceKey === occurrenceKey);
    }
    return new Date(r.date).toDateString() === fechaOcurrenciaStr;
  });

  if (candidatos.length === 1) return { status: GREASE_MATCH_STATUS.MATCH, records: candidatos, via: 'DATE' };
  if (candidatos.length > 1) return { status: GREASE_MATCH_STATUS.AMBIGUOUS, records: candidatos };
  return { status: GREASE_MATCH_STATUS.NONE, records: [] };
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
