/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT — src/core/operational-scope.js
   Rediseño operativo (cuadrillas + ubicaciones + asignación manual de
   engrases) — ver docs/OPERATIONAL_SCOPE.md.

   CORRECCIÓN ARQUITECTÓNICA 2026-10-02 (pedido explícito del usuario):
   el scope operativo YA NO depende de ningún identificador físico de
   dispositivo (IMEI/serial/modelo/Android ID/"dispositivo vinculado a
   cuadrilla"). La app (mismo APK/misma Web en cualquier teléfono/tablet/PC
   compatible) resuelve el scope SIEMPRE a partir de:

     USUARIO AUTENTICADO -> ROL/PERMISOS -> CUADRILLA(S) AUTORIZADA(S) ->
     UBICACIÓN OPERATIVA -> TURNO ACTUAL

   AUTORIDAD ÚNICA — nadie más repite esta lógica:
     - ADMINISTRADOR/PLANIFICADOR: vista GLOBAL (alcance según permisos
       existentes, sin scope de cuadrilla).
     - SUPERVISOR/LUBRICADOR: la cuadrilla (o cuadrillas) para las que el
       USUARIO está autorizado (`cuadrillas[].memberUserIds`, ver
       getAuthorizedCrews()) decide qué trabajo es visible/ejecutable —
       nunca el dispositivo. Con 1 sola cuadrilla autorizada se selecciona
       sola; con 2+ hace falta `selectedCrewId` (la selección de ESTA
       sesión, que el caller guarda localmente solo como comodidad — ver
       getSelectedCrewId()/setSelectedCrewId() en app.js — NUNCA como
       fuente de autorización: si `selectedCrewId` no está en la lista
       autorizada del usuario, se ignora).
     - El turno (Día/Noche) se resuelve SIEMPRE por hora real
       (currentShiftId(), inyectado como parámetro — este módulo no lee el
       reloj directamente para poder probarse con una hora fija), NUNCA por
       un campo guardado en ningún lado.
     - App.currentUser (identidad Auth) aporta SOLO id/rol — nunca
       location/cuadrilla fijos, ver §AC del pedido de cierre original;
       la cuadrilla de un usuario SIEMPRE se resuelve en vivo contra
       `cuadrillas[].memberUserIds`, nunca se guarda en el perfil.
     - VISOR se mantiene GLOBAL (rol de solo-lectura/supervisión general,
       el pedido de corrección no lo menciona entre los roles a
       restringir por cuadrilla).

   Un usuario autorizado puede iniciar sesión en CUALQUIER dispositivo
   nuevo y trabajar normalmente: la autorización vive en `cuadrillas`
   (sincronizado), nunca en `localStorage` de un teléfono en particular.

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
// Roles que pueden editar qué usuarios están autorizados en una cuadrilla
// (reemplaza al viejo ROLES_CAN_CONFIGURE_DEVICE — ya no se configura un
// dispositivo, se autorizan personas).
const ROLES_CAN_MANAGE_CREW_MEMBERSHIP = ['ADMINISTRADOR', 'PLANIFICADOR'];
// Roles que pueden registrar un engrase FUERA DE PLAN (lote "engrase fuera
// de plan" §2/§28) — VISOR nunca registra nada, igual que en el resto de la app.
const ROLES_CAN_REGISTER_OUT_OF_PLAN = ['ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR', 'LUBRICADOR'];
// Roles cuyo scope operativo depende de la(s) cuadrilla(s) autorizada(s)
// del usuario — el resto (ADMINISTRADOR/PLANIFICADOR/VISOR) es GLOBAL.
const ROLES_CREW_SCOPED = ['LUBRICADOR', 'SUPERVISOR'];

// manual_tasks (0017, ACTIVE en producción) — crean/reasignan/cancelan los
// MISMOS 3 roles que ya administran asignaciones (reusa
// ROLES_CAN_MANAGE_ASSIGNMENTS, nunca un segundo gate paralelo).
// `taskType`/`priority` son texto libre del lado del servidor (sin enum,
// ver 0017) — estos catálogos son SOLO la lista inicial que ofrece el
// formulario de creación, nunca una restricción real: "OTRO" + `title`
// cubre cualquier caso no listado.
const MANUAL_TASK_TYPES = [
  { id: 'ENGRASE', label: 'Engrasar equipo' },
  { id: 'REVISAR_NIVEL_LUBRICANTE', label: 'Revisar nivel de lubricante' },
  { id: 'REVISAR_PUNTO_ENGRASE', label: 'Revisar punto de engrase' },
  { id: 'OTRO', label: 'Otro' },
];
const MANUAL_TASK_PRIORITIES = [
  { id: 'ALTA', label: 'Alta' },
  { id: 'MEDIA', label: 'Media' },
  { id: 'BAJA', label: 'Baja' },
];

// broadcast_messages — ADMINISTRADOR/PLANIFICADOR/SUPERVISOR publican
// (módulo unificado "Tareas y mensajes", 2026-10-18: reversión explícita
// del criterio original de 0017 — "SUPERVISOR crea manual_tasks, nunca un
// broadcast general" — ahora también puede enviar mensajes operativos).
// DEPENDENCIA: el RLS actualmente ACTIVE es 0017, que todavía EXCLUYE a
// SUPERVISOR de broadcast_messages por completo. 0018_supervisor_
// broadcast_permissions_PREPARED.sql (preparada, NO aplicada) es la que
// habilita esto en el servidor. Mientras 0018 no se aplique, un SUPERVISOR
// que use este botón va a ver su mensaje creado LOCALMENTE pero el push al
// servidor será denegado (AUTH_FORBIDDEN, igual que cualquier otro rechazo
// de RLS ya documentado) — la fila queda dirty hasta que 0018 se aplique,
// nunca se pierde. `priority`/`targetType` son vocabulario del CLIENTE
// (broadcast_row_in_scope no valida `priority`; `targetType` SÍ lo valida
// el servidor pero como texto plano, estos 4 valores son exactamente los
// que esa función reconoce — no agregar un 5to sin tocar 0017/0018).
const ROLES_CAN_CREATE_BROADCAST = ['ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR'];
const BROADCAST_PRIORITIES = [
  { id: 'INFORMATIVA', label: 'Informativa' },
  { id: 'IMPORTANTE', label: 'Importante' },
  { id: 'CRITICA', label: 'Crítica' },
];
const BROADCAST_TARGET_TYPES = [
  { id: 'ALL_LUBRICATORS', label: 'Todos los lubricadores' },
  { id: 'CREW', label: 'Cuadrilla' },
  { id: 'LOCATION', label: 'Ubicación' },
  { id: 'USER', label: 'Usuario' },
];

// Envío rápido de mensajes (lote UX 2026-10-19): título deja de ser
// obligatorio al crear un broadcast. En vez de inventar un título
// artificial cuando falta, toda tarjeta/notificación que muestre un
// broadcast usa este ÚNICO punto de verdad — las primeras palabras del
// mensaje — nunca su propio recorte. Mensajes antiguos con `title` real
// siguen mostrándolo exactamente igual (nunca se reemplaza un título
// existente).
function broadcastDisplayTitle(m, { maxWords = 8 } = {}) {
  if (m && m.title) return m.title;
  const words = String((m && m.message) || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'Mensaje operativo';
  const snippet = words.slice(0, maxWords).join(' ');
  return words.length > maxWords ? `${snippet}…` : snippet;
}

function canManageAssignments(role) { return ROLES_CAN_MANAGE_ASSIGNMENTS.includes(role); }
function canCreateBroadcast(role) { return ROLES_CAN_CREATE_BROADCAST.includes(role); }
function canMoveEquipment(role) { return ROLES_CAN_MOVE_EQUIPMENT.includes(role); }
function canMoveCrew(role) { return ROLES_CAN_MOVE_CREW.includes(role); }
function canManageCrewMembership(role) { return ROLES_CAN_MANAGE_CREW_MEMBERSHIP.includes(role); }
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
const REQUIRED_SHIFT_IDS = ['shift_dia', 'shift_noche'];

// Central policy resolver for shift-scoped calendar occurrences. Plans may
// declare requiredShifts and an effectiveDate; before that date their legacy
// shiftId semantics remain in force. Equipment classification is descriptive
// only; it never decides shift obligations or pending-task persistence.
function isExcavatorEquipment(equipment, equipmentTypes = []) {
  const type = (equipmentTypes || []).find(t => t.id === equipment?.typeId);
  return /excavadora/i.test(String(type?.name || type?.label || type?.description || ''));
}

function requiredShiftsForPlan(plan, operationalDateISO) {
  if (!plan || !Array.isArray(plan.requiredShifts) || !plan.requiredShifts.length) {
    return plan?.shiftId ? [plan.shiftId] : [null];
  }
  if (plan.requiredShifts.length > 1 && (!plan.effectiveDate || !operationalDateISO || operationalDateISO < plan.effectiveDate)) {
    return plan.shiftId ? [plan.shiftId] : [null];
  }
  return [...new Set(plan.requiredShifts.filter(id => REQUIRED_SHIFT_IDS.includes(id)))];
}

function requiredShiftsForEquipmentPlan({ equipment, equipmentTypes = [], plan, operationalDateISO }) {
  // Solo la configuracion del plan define las obligaciones. La familia,
  // codigo o tipo del equipo nunca activa ni limita la persistencia.
  return requiredShiftsForPlan(plan, operationalDateISO);
}

function operationalDateForShift(date, shiftId, settings = {}) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) throw new Error('Fecha/hora operacional no válida.');
  const dayStart = Number(settings.shiftDayStart ?? 6);
  const nightStart = Number(settings.shiftNightStart ?? 18);
  if (!Number.isFinite(dayStart) || !Number.isFinite(nightStart) || dayStart < 0 || dayStart > 23 || nightStart < 0 || nightStart > 23 || dayStart === nightStart) {
    throw new Error('Configuración de turnos no válida.');
  }
  const hour = value.getHours() + value.getMinutes() / 60;
  // Night duty starts on the calendar date on which the configured night
  // shift begins; its after-midnight portion belongs to that same operation.
  if (shiftId === 'shift_noche' && hour < dayStart) value.setDate(value.getDate() - 1);
  return toISODateUTCLocal(value);
}

function generateOccurrences({ plan, startDateISO, endDateISO }) {
  if (!plan || !startDateISO || !endDateISO) return [];
  const start = new Date(`${startDateISO}T12:00:00`);
  const end = new Date(`${endDateISO}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const occurrences = [];
  const weeklyPlan = plan.controlType === 'Día y turno de la semana' || (!plan.controlType && Array.isArray(plan.assignedDays));
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    const dateISO = toISODateUTCLocal(date);
    const effectiveDual = Array.isArray(plan.requiredShifts) && REQUIRED_SHIFT_IDS.every(id => plan.requiredShifts.includes(id))
      && !!plan.effectiveDate && dateISO >= plan.effectiveDate;
    if (weeklyPlan
      && !(plan.assignedDays || []).includes(WEEKDAY_NAMES[date.getDay()])) continue;
    if (!effectiveDual && !weeklyPlan) continue;
    for (const shiftId of requiredShiftsForPlan(plan, dateISO)) {
      occurrences.push({ planId: plan.id, equipmentId: plan.equipmentId, operationalDate: dateISO, shiftId,
        occurrenceKey: computeOccurrenceKey(plan, { dateISO, shiftId }) });
    }
  }
  return occurrences;
}

function resolveOccurrenceState({ plan, operationalDate, shiftId, records = [], assignments = [], skips = [], asOfDateISO = operationalDate }) {
  if (!plan || !operationalDate || !REQUIRED_SHIFT_IDS.includes(shiftId)) return { state: 'INVALID' };
  const shifts = requiredShiftsForPlan(plan, operationalDate);
  const dualDaily = Array.isArray(plan.requiredShifts) && REQUIRED_SHIFT_IDS.every(id => plan.requiredShifts.includes(id))
    && !!plan.effectiveDate && operationalDate >= plan.effectiveDate;
  if (!dualDaily && !shifts.includes(shiftId)) return { state: 'NOT_SCHEDULED' };
  if ((plan.controlType === 'Día y turno de la semana' || !plan.controlType)
      && !(plan.assignedDays || []).includes(WEEKDAY_NAMES[new Date(`${operationalDate}T12:00:00`).getDay()])) return { state: 'NOT_SCHEDULED' };
  const occurrenceKey = computeOccurrenceKey(plan, { dateISO: operationalDate, shiftId });
  const matchingRecords = (records || []).filter(row => {
    if (row.active === false || row.equipmentId !== plan.equipmentId || (row.planId && row.planId !== plan.id)) return false;
    const snap = row.operationalSnapshot || {};
    // La identidad programada manda sobre el turno REAL de captura.
    const key = snap.assignedOccurrenceKey || snap.satisfiedOccurrenceKey || snap.occurrenceKey;
    return key ? key === occurrenceKey : snap.operationalDate === operationalDate && row.shiftId === shiftId;
  });
  const completeRecord = matchingRecords.find(row => row.operationalSnapshot?.executionCompleteness !== EXECUTION_COMPLETENESS.PARTIAL
    && computeExecutionCompleteness(row.details) === EXECUTION_COMPLETENESS.COMPLETE && Number(row.qty) > 0);
  if (completeRecord) return {state:'COMPLETE',occurrenceKey,record:completeRecord,operationalDate,shiftId};
  const record = matchingRecords[0];
  if (record) {
    return { state: 'PARTIAL', occurrenceKey, record, operationalDate, shiftId };
  }
  const skip = (skips || []).find(row => row.equipmentId === plan.equipmentId && row.occurrenceKey === occurrenceKey);
  if (skip) return { state: 'SKIPPED', occurrenceKey, skip, operationalDate, shiftId };
  const assignment = findActivePendingAssignment(assignments, occurrenceKey);
  if (assignment) return { state: 'ASSIGNED', occurrenceKey, assignment, operationalDate, shiftId };
  const state = operationalDate < asOfDateISO ? 'MISSED' : operationalDate > asOfDateISO ? 'FUTURE' : 'PENDING';
  return { state, occurrenceKey, operationalDate, shiftId };
}

function previousShiftOccurrence({ operationalDate, shiftId }) {
  if (!operationalDate || !REQUIRED_SHIFT_IDS.includes(shiftId)) return null;
  if (shiftId === 'shift_noche') return { operationalDate, shiftId: 'shift_dia' };
  const previous = new Date(`${operationalDate}T12:00:00`);
  previous.setDate(previous.getDate() - 1);
  return { operationalDate: toISODateUTCLocal(previous), shiftId: 'shift_noche' };
}
// Fix 2026-10-09 ("CROSS-LOCATION", §18 del pedido): "SUPPORT_OTHER_LOCATION"
// agregado a la lista de motivos — valor de aplicación, nunca requiere
// migración de schema (engrase_sync.payload es jsonb genérico, ver
// schema.sql; confirmado antes de agregar esto). Mismo arreglo plano,
// ninguna infraestructura nueva.
const OUT_OF_PLAN_REASONS = ['PM', 'CORRECTIVO', 'OPORTUNIDAD', 'SUPPORT_OTHER_LOCATION', 'OTRO'];

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
   mismo patrón que estadoCelda() en weekly-matrix.js.

   Fix 2026-10-09 ("REALIZADO ADELANTADO", Parte F/§21-23 del pedido,
   cambio DELIBERADO de comportamiento — nunca colateral): la ventana era
   de 7 días (documentado en docs/OPERATIONAL_SCOPE.md, probado en CASO N)
   — el pedido nuevo exige un máximo de 1 día calendario de adelanto
   ("PROGRAMADO MAÑANA + COMPLETE HOY = satisface mañana"; "+2 días NUNCA
   satisface automáticamente, queda como OUT_OF_PLAN"). `i < 2` cubre hoy
   (i=0, mismo día programado) y mañana (i=1, el único caso de "adelanto"
   real) — nunca más lejos. CASO N (tests/unit/operational-scope.test.js)
   y docs/OPERATIONAL_SCOPE.md se actualizaron a propósito junto con este
   cambio, no quedaron rotos por accidente. */
function findNextApplicableOccurrenceForWeekdayPlan({ plan, existingRecords, todayDate, shiftId }) {
  if (!plan || plan.controlType !== 'Día y turno de la semana') return null;
  const dias = plan.assignedDays || [];
  if (!dias.length) return null;
  const candidatas = [];
  for (let i = 0; i < 2; i++) {
    const d = new Date(todayDate);
    d.setDate(d.getDate() + i);
    const nombreDia = WEEKDAY_NAMES[d.getDay()];
    if (!dias.includes(nombreDia)) continue;
    const dateISO = toISODateUTCLocal(d);
    const dual = requiredShiftsForPlan(plan, dateISO).length > 1;
    const yaHecho = (existingRecords || []).some(r => {
      if (dual && shiftId && r.shiftId !== shiftId) return false;
      return r.operationalSnapshot?.operationalDate === dateISO || new Date(r.date).toDateString() === d.toDateString();
    });
    if (!yaHecho) candidatas.push(dateISO);
  }
  if (candidatas.length !== 1) return null;
  return { occurrenceKey: computeOccurrenceKey(plan, { dateISO: candidatas[0], shiftId }), dateISO: candidatas[0], shiftId: shiftId || null };
}

// Punto de entrada único (§12: "no copiar lógica en varias pantallas") —
// despacha por tipo de plan. "Horas de operación" nunca es ambiguo: el
// ciclo vigente siempre es UNO solo (ver computeOccurrenceKey).
function findNextApplicableOccurrence({ plan, existingRecords, todayDate, shiftId }) {
  if (!plan) return null;
  existingRecords=(existingRecords || []).filter(r=>!r.operationalSnapshot?.assignedOccurrenceKey);
  if (plan.controlType === 'Día y turno de la semana') {
    return findNextApplicableOccurrenceForWeekdayPlan({ plan, existingRecords, todayDate, shiftId });
  }
  return { occurrenceKey: computeOccurrenceKey(plan, {}), dateISO: null };
}

// Fix 2026-10-09 ("FIX REALIZADO ADELANTADO + QR INTERNO", §1 del pedido)
// — renombrada de resolveOutOfPlanSatisfaction(): el nombre viejo ya no
// describía su función real. executionType (PLANNED/ASSIGNED/OUT_OF_PLAN)
// describe CÓMO se ejecutó un engrase — nunca debe decidir si TÉCNICAMENTE
// satisface una ocurrencia futura por adelantado; eso lo decide solo:
// mismo equipo, COMPLETE, matching de fecha sin ambigüedad (ver
// findNextApplicableOccurrence(), sin cambios). Por eso el caller (app.js,
// guardado del formulario) ya NO filtra por executionType === 'OUT_OF_PLAN'
// antes de llamar a esto — se intenta SIEMPRE. Solo COMPLETE puede
// satisfacer (§9/§25: PARTIAL nunca reinicia ciclo ni cancela un
// recordatorio pendiente) — sin cambios de comportamiento para SKIP
// (nunca llega aquí, no es un record) ni para +2 días/AMBIGUOUS/NONE (ya
// cubiertos por findNextApplicableOccurrence, sin cambios). Planes "Horas
// de operación": su propio resultado no-ambiguo de
// findNextApplicableOccurrence() es inerte en la práctica — ni
// weekdayStatusFor() ni estadoCelda() (Matriz) ni
// findMatchingGreaseRecordForOccurrence() leen satisfiedOccurrenceKey para
// ese controlType (los 3 descartan el plan ANTES de llegar a leerlo) —
// confirmado leyendo esos 3 call sites, nunca asumido.
function resolveEarlyOccurrenceSatisfaction({ plan, completeness, existingRecords, todayDate, shiftId }) {
  if (completeness !== EXECUTION_COMPLETENESS.COMPLETE) return null;
  const found = findNextApplicableOccurrence({ plan, existingRecords, todayDate, shiftId });
  return found ? found.occurrenceKey : null;
}

// F-01 (auditoría pre-release): ¿puede esta ejecución avanzar plan.lastGreaseHour
// de un plan "Horas de operación"? Esa fecha/hora es la base de
// computeOccurrenceKey() para ese controlType (ver comentario arriba) —
// avanzarla equivale a "reiniciar el ciclo". Un PARTIAL (puntos pendientes)
// NUNCA debe reiniciarlo, igual que resolveEarlyOccurrenceSatisfaction() ya
// exige COMPLETE para satisfacer una ocurrencia por adelantado. "Día y turno de la
// semana" (o cualquier otro controlType) no usa lastGreaseHour para su
// ciclo — esos casos siempre pueden avanzarlo, sin cambio de comportamiento.
function canAdvanceHourCycle({ controlType, completeness }) {
  if (controlType !== 'Horas de operación') return true;
  return completeness === EXECUTION_COMPLETENESS.COMPLETE;
}

/* ============================================================
   DETECCIÓN DE TRABAJO EXISTENTE ANTES DE ABRIR "FUERA DE PLAN" (§5)
   ============================================================
   Prioridad ASSIGNED > PLANNED > (ninguno, recién ahí se abre OUT_OF_PLAN).
   `statusCode` (ROJO/AMARILLO/VERDE/GRIS) ya viene resuelto por el caller
   (statusFor(), lubrication-status.js) — este módulo no recalcula el
   semáforo, evita duplicar esa lógica. */
function findExistingWorkForEquipment({ plan, assignments, statusCode, todayDate, shiftId }) {
  if (!plan) return { kind: 'NONE' };
  const dateISO = shiftId ? operationalDateForShift(todayDate, shiftId) : toISODateUTCLocal(todayDate);
  const occurrenceKey = computeOccurrenceKey(plan, { dateISO, shiftId });
  const activeAssignment = findActivePendingAssignment(assignments, occurrenceKey);
  const carriedAssignment = activeAssignment || (assignments || []).find(a => a.active !== false && a.status === 'PENDING'
    && a.equipmentId === plan.equipmentId && (a.planId === plan.id || String(a.occurrenceKey || '').startsWith(plan.id + ':')));
  if (carriedAssignment) return { kind: 'ASSIGNED', assignment: carriedAssignment, occurrenceKey: carriedAssignment.occurrenceKey };

  const dualDaily = Array.isArray(plan.requiredShifts) && REQUIRED_SHIFT_IDS.every(id => plan.requiredShifts.includes(id))
    && !!plan.effectiveDate && dateISO >= plan.effectiveDate;
  if (dualDaily || plan.controlType === 'Día y turno de la semana') {
    if (dualDaily) return { kind: 'PLANNED', occurrenceKey, shiftId: shiftId || null, dateISO };
    const nombreDia = WEEKDAY_NAMES[new Date(`${dateISO}T12:00:00`).getDay()];
    const shiftMatches = !plan.shiftId || !shiftId || plan.shiftId === shiftId;
    if ((plan.assignedDays || []).includes(nombreDia) && shiftMatches) return { kind: 'PLANNED', occurrenceKey, shiftId: shiftId || plan.shiftId || null, dateISO };
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
function computeOccurrenceKey(plan, { dateISO, shiftId } = {}) {
  if (!plan || !plan.id) throw new Error('computeOccurrenceKey requiere un plan con id.');
  const isShiftScoped = Array.isArray(plan.requiredShifts) && plan.requiredShifts.length > 1
    && !!plan.effectiveDate && !!dateISO && dateISO >= plan.effectiveDate;
  if (isShiftScoped) {
    if (!shiftId || !REQUIRED_SHIFT_IDS.includes(shiftId)) throw new Error('computeOccurrenceKey: falta un turno válido para la ocurrencia dual.');
    return `${plan.id}:${dateISO}:${shiftId}`;
  }
  if (plan.controlType === 'Día y turno de la semana') {
    if (!dateISO) throw new Error('computeOccurrenceKey: falta dateISO para un plan por día/turno.');
    return `${plan.id}:${dateISO}`;
  }
  // 'Horas de operación' (o cualquier otro controlType futuro que no sea por día): por ciclo de horómetro.
  const base = plan.lastGreaseHour ?? 0;
  return `${plan.id}:h:${base}`;
}

/* ============================================================
   FECHA/TURNO DE UNA OCURRENCIA YA IDENTIFICADA (fix 2026-10-17,
   "FECHA VISUAL DE ASIGNACIÓN ATRASADA")
   ============================================================
   Lee fecha/turno de un occurrenceKey YA EXISTENTE — nunca recalcula
   "cuál es la ocurrencia vigente hoy" (eso es mostRecentAssignedDate()/
   weekdayStatusFor(), en lubrication-status.js, y solo aplica cuando NO
   hay una lubrication_assignment persistida para ese equipo). Una
   assignment fija su ocurrencia al crearse (computeOccurrenceKey(), ver
   arriba) — esa identidad NUNCA cambia aunque pasen semanas; la UI debe
   LEER esa fecha desde la propia clave, nunca reconstruirla contra "hoy".
   Formatos soportados (los únicos que computeOccurrenceKey() genera con
   fecha discreta):
     - legacy / "Día y turno de la semana" sin turno dual: `${planId}:${YYYY-MM-DD}`
     - dual DÍA/NOCHE: `${planId}:${YYYY-MM-DD}:shift_dia` o `:shift_noche`
   `${planId}:h:${lastGreaseHour}` ("Horas de operación", sin fecha
   discreta) devuelve null a propósito — ahí no hay nada que mostrar como
   "Pendiente desde", sin cambio de comportamiento. */
function parseOccurrenceKeyDate(occurrenceKey) {
  const match = String(occurrenceKey || '').match(/:(\d{4}-\d{2}-\d{2})(?::(shift_dia|shift_noche))?$/);
  if (!match) return null;
  return { dateISO: match[1], shiftId: match[2] || null, date: new Date(`${match[1]}T12:00:00`) };
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
// Single source for location coverage; membership remains the authority
// for selecting a crew. Legacy location is used only before relation rows exist.
function resolveCrewLocationCoverage(crewId, cuadrillas = [], crewLocations = []) {
  const crew = cuadrillas.find(c => c.id === crewId && c.active !== false);
  const rows = crewLocations.filter(r => r.crew_id === crewId);
  if (!crew) return { principalLocationIds: [], supportLocationIds: [], allAuthorizedLocationIds: [], legacyFallback: !rows.length };
  // Tombstones are intentional revocations: never restore legacy access.
  const active = rows.filter(r => r.active !== false);
  const principalLocationIds = [...new Set(active.filter(r => r.role === 'PRINCIPAL').map(r => r.location_id))];
  const supportLocationIds = [...new Set(active.filter(r => r.role === 'APOYO').map(r => r.location_id))];
  if (!rows.length && crew && crew.locationId) {
    principalLocationIds.push(crew.locationId);
  }
  principalLocationIds.sort((a, b) => a === (crew && crew.locationId) ? -1 : b === (crew && crew.locationId) ? 1 : a.localeCompare(b));
  return { principalLocationIds, supportLocationIds,
    allAuthorizedLocationIds: [...new Set([...principalLocationIds, ...supportLocationIds])],
    legacyFallback: !rows.length };
}

function resolveDefaultCrewForLocation(cuadrillas, locationId, crewLocations = []) {
  if (!locationId) return null;
  const explicit = (crewLocations || []).find(r => r.location_id === locationId && r.role === 'PRINCIPAL' && r.active !== false
    && (cuadrillas || []).some(c => c.id === r.crew_id && c.active !== false));
  if (explicit) return cuadrillas.find(c => c.id === explicit.crew_id);
  const candidatas = (cuadrillas || [])
    .filter(c => c.active !== false && c.locationId === locationId && c.isDefault === true
      && !crewLocations.some(r => r.crew_id === c.id))
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  return candidatas[0] || null;
}

function validateCrewLocationCoverage(crewId, rows, cuadrillas, existing) {
  const locations = new Set();
  for (const row of rows) {
    if (!row.location_id || !['PRINCIPAL', 'APOYO'].includes(row.role) || row.crew_id !== crewId) {
      throw new Error('Cobertura de cuadrilla no válida.');
    }
    if (locations.has(row.location_id)) throw new Error('Ubicación repetida en la cobertura.');
    locations.add(row.location_id);
    if (row.active !== false && row.role === 'PRINCIPAL') {
      const other = resolveDefaultCrewForLocation(cuadrillas, row.location_id, existing);
      if (other && other.id !== crewId) throw new Error(`La ubicación ya tiene una cuadrilla PRINCIPAL: ${other.name}. Cambia primero su cobertura.`);
    }
  }
}

/* ============================================================
   CUADRILLAS AUTORIZADAS DE UN USUARIO (corrección arquitectónica
   2026-10-02) — reemplaza la asignación cuadrilla<->dispositivo.
   ============================================================
   `cuadrillas[].memberUserIds` (array de app_user_id, opcional — filas
   viejas sin este campo se tratan como `[]`, nunca como "todos
   autorizados") es la ÚNICA fuente de autorización. Un usuario puede
   estar en 0, 1 o varias cuadrillas a la vez; cuáles exactamente lo
   decide quien administra Cuadrillas (ADMIN/PLANIFICADOR), nunca el
   dispositivo desde el que se conecta. */
function getAuthorizedCrews(cuadrillas, userId) {
  if (!userId) return [];
  return (cuadrillas || []).filter(c => c.active !== false && (c.memberUserIds || []).includes(userId));
}

/* ============================================================
   SCOPE OPERATIVO (§I) — AUTORIDAD CENTRAL, se llama UNA vez por pantalla
   ============================================================
   `currentShiftId` se recibe ya calculado (currentShiftId() de
   src/core/shifts.js) — nunca se guarda ni se lee de ningún identificador
   de dispositivo (el turno NUNCA es una propiedad fija del hardware).
   `selectedCrewId` es la selección de ESTA sesión (comodidad local del
   caller, ver getSelectedCrewId() en app.js) — SOLO se usa si de verdad
   está en la lista de cuadrillas autorizadas del usuario; si no, se
   ignora en silencio (nunca eleva permisos que el usuario no tiene). */
function resolveOperationalScope({ currentUser, cuadrillas, selectedCrewId, shiftId, crewLocations = [] }) {
  if (!currentUser) return { kind: 'NONE' };
  if (!ROLES_CREW_SCOPED.includes(currentUser.role)) {
    return {
      kind: 'GLOBAL', userId: currentUser.id, role: currentUser.role,
      shiftId: shiftId || null, crewId: null, crewLocationId: null, authorizedCrews: []
    };
  }
  const authorizedCrews = getAuthorizedCrews(cuadrillas, currentUser.id);
  if (!authorizedCrews.length) {
    return { kind: 'NO_CREW_ASSIGNED', userId: currentUser.id, role: currentUser.role, shiftId, crewId: null, crewLocationId: null, authorizedCrews };
  }
  if (authorizedCrews.length === 1) {
    const crew = authorizedCrews[0];
    return { kind: 'CREW_SCOPED', userId: currentUser.id, role: currentUser.role, shiftId, crewId: crew.id, crewLocationId: crew.locationId || null, authorizedCrews,
      ...resolveCrewLocationCoverage(crew.id, cuadrillas, crewLocations), crewLocations };
  }
  // 2+ cuadrillas autorizadas: hace falta una selección de sesión válida
  // (una de las YA autorizadas) — nunca se adivina ni se toma la primera.
  const selected = selectedCrewId ? authorizedCrews.find(c => c.id === selectedCrewId) : null;
  if (!selected) {
    return { kind: 'NEEDS_CREW_SELECTION', userId: currentUser.id, role: currentUser.role, shiftId, crewId: null, crewLocationId: null, authorizedCrews };
  }
  return { kind: 'CREW_SCOPED', userId: currentUser.id, role: currentUser.role, shiftId, crewId: selected.id, crewLocationId: selected.locationId || null, authorizedCrews,
    ...resolveCrewLocationCoverage(selected.id, cuadrillas, crewLocations), crewLocations };
}

/* ============================================================
   CLASIFICACIÓN DE TRABAJO VISIBLE/EJECUTABLE (§J, §K, §L, §AH)
   ============================================================
   Para un scope CREW_SCOPED (Lubricador/Supervisor con cuadrilla de
   sesión resuelta):
     - "normal": equipos cuya locationId coincide con crewLocationId, Y
       cuya cuadrilla-por-defecto de esa ubicación es la de este scope
       (así, con 2+ cuadrillas en la misma ubicación, el trabajo normal
       SOLO lo ve la default — §K, nunca doble conteo/doble ejecución) Y
       que NO tengan una assignment PENDING activa hacia OTRA cuadrilla
       (si la tienen, ese trabajo pasó a ser responsabilidad de esa otra
       cuadrilla, ver §L: "NO debe seguir como trabajo ejecutable
       simultáneo para la cuadrilla original").
     - "assigned": occurrences con una lubrication_assignments PENDING cuyo
       assignedCrewId === scope.crewId y equipo maestro en una ubicación
       PRINCIPAL o APOYO autorizada. No amplía cobertura por sí sola.
   `equipoOccurrenceKeyFn(equipo)` la provee el caller (depende del plan
   vigente de ese equipo, ya resuelto aparte — este módulo no conoce
   lubrication_plans/estadoCelda en detalle, para no duplicar esa lógica). */
function classifyEquipmentWork({ scope, equipos, cuadrillas, assignments, equipoOccurrenceKeyFn, selectedCrewOnly = false }) {
  // `selectedCrewOnly` (histórico): una versión forzaba "normal" a [] para
  // cualquier scope CREW_SCOPED, exigiendo una lubrication_assignment para
  // CUALQUIER equipo — eso rompía los ~19 tests de
  // tests/ui/crew-location-coverage.spec.js (cobertura multiubicación real,
  // PRINCIPAL+APOYO, editor de cobertura, Matriz por ubicación) y el trabajo
  // normal diario de cualquier cuadrilla sin asignación manual (la inmensa
  // mayoría — las asignaciones son solo para reasignar manualmente a OTRA
  // cuadrilla). La coherencia ubicación/cuadrilla real YA la resuelven, para
  // CUALQUIER cantidad de ubicaciones por cuadrilla (nunca una sola
  // `crewLocationId`): `normal` más abajo vía `scope.principalLocationIds`
  // + `resolveDefaultCrewForLocation()`; `assignedAquí` vía
  // `scope.allAuthorizedLocationIds` (unión PRINCIPAL+APOYO, ver
  // resolveCrewLocationCoverage()) — ambos ya multiubicación desde antes de
  // esta sesión. `selectedCrewOnly` solo conserva este guard: la pantalla
  // de Mi Turno (Lubricador) nunca cae a la vista global de jefaturas
  // (scope.kind !== 'CREW_SCOPED' más abajo) solo porque todavía no hay
  // cuadrilla elegida.
  if (selectedCrewOnly && scope?.kind !== 'CREW_SCOPED') return { normal: [], assigned: [] };
  const pendientes = (assignments || []).filter(a => a.active !== false && a.status === ASSIGNMENT_STATUS.PENDING);
  const porOccurrence = new Map(pendientes.map(a => [a.occurrenceKey, a]));

  if (!scope || scope.kind === 'NONE') return { normal: [], assigned: [] };
  if (scope.kind !== 'CREW_SCOPED') {
    // Jefaturas: vista global — devuelve todo, sin filtrar (la pantalla
    // decide qué mostrar; este módulo solo evita doble conteo para
    // Lubricador, que es donde "ejecutar" importa de verdad).
    return { normal: equipos || [], assigned: pendientes };
  }

  const normal = (equipos || []).filter(e => {
    if (!(scope.principalLocationIds || [scope.crewLocationId]).includes(e.locationId)) return false;
    const defaultCrew = resolveDefaultCrewForLocation(cuadrillas, e.locationId, scope.crewLocations || []);
    if (!defaultCrew || defaultCrew.id !== scope.crewId) return false;
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

  const authorizedLocations = scope.allAuthorizedLocationIds || [scope.crewLocationId].filter(Boolean);
  const equipmentById = new Map((equipos || []).map(e => [e.id, e]));
  const assignedAquí = pendientes.filter(a => {
    const equipment = equipmentById.get(a.equipmentId);
    if (a.assignedCrewId !== scope.crewId || !equipment || (!authorizedLocations.includes(equipment.locationId) && a._supportOperational!==true)) return false;
    // PENDING conserva SU occurrenceKey, aunque cambie el turno o la fecha.
    // La clasificacion visual decide actual/arrastre; nunca filtra por la
    // clave recalculada del turno actual ni crea otra asignacion.
    return true;
  });
  const idsAsignados = new Set(assignedAquí.map(a => a.equipmentId));
  // El equipo puede aparecer en "normal" (misma cuadrilla, asignación
  // redundante) — se excluye de "normal" para no duplicarlo, queda solo en
  // "assigned" con el badge correspondiente.
  const normalSinDuplicar = normal.filter(e => !idsAsignados.has(e.id) || !assignedAquí.some(a => a.equipmentId === e.id));

  return { normal: normalSinDuplicar, assigned: assignedAquí };
}

/* ============================================================
   MATRIZ SEMANAL DEL LUBRICADOR — alcance de CONSULTA (pedido "MATRIZ
   LUBRICADOR POR UBICACIÓN COMPLETA", 2026-10-09)
   ============================================================
   A diferencia de classifyEquipmentWork() (arriba) — que decide el
   trabajo EJECUTABLE de "Mi Turno": cuadrilla DEFAULT de la ubicación +
   excepciones por assignment — la Matriz es una vista de SOLO LECTURA de
   TODA la ubicación activa/autorizada del usuario. Nunca filtra por:
     - cuadrilla (incluye equipos de CUALQUIER cuadrilla de esa ubicación,
       no solo la default);
     - turno (incluye equipos programados Día Y Noche — el turno es dato
       contextual, nunca un filtro de exclusión aquí).
   El único límite de seguridad sigue siendo la ubicación: solo
   `scope.crewLocationId` (la ubicación autorizada de la cuadrilla
   resuelta de ESTE usuario, ver resolveOperationalScope() — nunca se
   amplía a otra ubicación ni se vuelve GLOBAL para LUBRICADOR).
   Usa `equipo.locationId` — la ubicación MAESTRA/actual del equipo (la
   misma que ya usa canLubricadorExecuteEquipment()). Una
   `lubrication_assignments` temporal no tiene campo de ubicación y nunca
   cambia `equipo.locationId`, así que no puede mover ni duplicar un
   equipo entre ubicaciones aquí — cada equipo de `equipos` (ya sin
   duplicados, viene de DB.allActive('equipment')) aparece como mucho una
   vez en el resultado. */
function equiposForLubricadorMatriz(equipos, scope, locationId) {
  if (!scope || scope.kind !== 'CREW_SCOPED') return [];
  const authorized = scope.legacyFallback === false ? scope.principalLocationIds : [scope.crewLocationId];
  const selected = locationId || authorized[0];
  if (!selected || !authorized.includes(selected)) return [];
  return (equipos || []).filter(e => e.locationId === selected);
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
function completeAssignmentIfPending(existing, { occurrenceKey, recordId, now, completeness = 'COMPLETE' }) {
  if (completeness !== 'COMPLETE') return null;
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
  executionType, outOfPlanReason, executionCompleteness, satisfiedOccurrenceKey, occurrenceKey, operationalDate
}) {
  return {
    equipmentLocationIdAtExecution: equipmentLocationId || null,
    executionLocationId: equipmentLocationId || null,
    crewId: crewId || null,
    crewLocationIdAtExecution: crewLocationId || null,
    performedByUserId: performedByUserId || null,
    shiftId: shiftId || null,
    occurrenceKey: occurrenceKey || null,
    operationalDate: operationalDate || null,
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
// ACTUAL de la cuadrilla. New records prefer their actual execution
// location; older records keep the original crew-location snapshot.
function resolveRecordCrewLocationId(record) {
  const snap = record && record.operationalSnapshot;
  if (snap && snap.executionLocationId) return { value: snap.executionLocationId, source: 'snapshot' };
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
  reason, observacion, userId, userName, now, linkedRecordId, crewId, locationId
}) {
  validateNoExecutionInput({ reason, observacion });
  return {
    id, equipmentId, planId: planId || null, occurrenceKey: occurrenceKey || null,
    ...(crewId ? { crewId } : {}), ...(locationId ? { locationId } : {}),
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
function findCarriedOverSkipForToday(skips, { equipmentId, dateISO, occurrenceKey }) {
  const delDia = (skips || []).filter(s => s.equipmentId === equipmentId &&
    (occurrenceKey ? s.occurrenceKey === occurrenceKey : (s.date || '').slice(0, 10) === dateISO));
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
  const identity = String(occurrenceKey || '').match(/:(\d{4}-\d{2}-\d{2}):(shift_dia|shift_noche)$/);
  const expectedDateISO = identity?.[1] || null;
  const expectedShiftId = identity?.[2] || null;
  // Candidato elegible: mismo equipo, COMPLETE, no vinculado ya a otro
  // skip, y (mismo día de calendario que la ocurrencia) O (OUT_OF_PLAN
  // cuya propia satisfiedOccurrenceKey YA apunta exactamente a esta
  // ocurrencia — §9: nunca "cualquier OUT_OF_PLAN de esa fecha" cuenta
  // solo por coincidir de fecha, tiene que venir certificado por
  // resolveEarlyOccurrenceSatisfaction() en el momento en que se guardó).
  const candidatos = (records || []).filter(r => {
    if (r.equipmentId !== plan.equipmentId) return false;
    if (yaVinculados.has(r.id)) return false;
    if (computeExecutionCompleteness(r.details) !== EXECUTION_COMPLETENESS.COMPLETE) return false;
    if (expectedShiftId && r.shiftId !== expectedShiftId) return false;
    const esOutOfPlan = resolveRecordExecutionType(r).value === EXECUTION_TYPE.OUT_OF_PLAN;
    if (esOutOfPlan) {
      return !!(r.operationalSnapshot && r.operationalSnapshot.satisfiedOccurrenceKey === occurrenceKey);
    }
    if (expectedDateISO) {
      return r.operationalSnapshot?.operationalDate === expectedDateISO
        || new Date(r.date).toDateString() === occurrenceDate.toDateString();
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
function canLubricadorExecuteEquipment({ scope, equipo, assignments = [] }) {
  if (!scope || !equipo) return false;
  if (scope.kind === 'GLOBAL') return ['ADMINISTRADOR', 'PLANIFICADOR'].includes(scope.role);
  if (scope.kind !== 'CREW_SCOPED' || !scope.crewId) return false;
  if (assignments.some(a=>a._supportOperational===true && a.active!==false && a.status==='PENDING'
      && a.equipmentId===equipo.id && a.assignedCrewId===scope.crewId)) return true;
  return !!equipo.locationId && (scope.allAuthorizedLocationIds || [scope.crewLocationId]).includes(equipo.locationId);
}
