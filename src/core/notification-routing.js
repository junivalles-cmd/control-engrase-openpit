/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT — src/core/notification-routing.js
   Arquitectura de notificaciones: USUARIO + TURNO + DISPONIBILIDAD + SCOPE
   + ONESIGNAL (lote pedido explícitamente por el usuario, 2026-09-30).

   REGLA CENTRAL (pedida tal cual, nunca reinterpretada):
     ROL define QUÉ tipo de aviso puede recibir.
     TURNO DE NOTIFICACIÓN define CUÁNDO puede recibirlo.
     DISPONIBILIDAD define si debe recibirlo AHORA.
     SCOPE define para qué operación/equipos/ubicación aplica.

   NO se crearon roles nuevos (SUPERVISOR_DIA/NOCHE, etc. — pedido
   explícito §1). Los roles existentes (ADMINISTRADOR/PLANIFICADOR/
   SUPERVISOR/LUBRICADOR/VISOR) siguen intactos; el turno/disponibilidad de
   notificación son atributos NUEVOS y ORTOGONALES del usuario
   (notificationShift/notificationAvailability/receiveAllShifts), nunca
   parte del rol.

   active=false (usuario deshabilitado) ES DISTINTO de RESTING (usuario
   válido, fuera de disponibilidad ahora) — nunca se confunden (§2).

   Todo puro: recibe currentShiftId ya resuelto por currentShiftId()
   (src/core/shifts.js, ÚNICA fuente real del turno operativo, ver
   auditoría previa a este lote) como parámetro — este módulo NUNCA lee el
   reloj ni importa shifts.js, mismo criterio que operational-scope.js/
   weekly-matrix.js (reciben todo ya cargado, sin tocar DB/red/DOM).

   Reutilizado en DOS lugares con la MISMA regla (nunca duplicada):
     - Cliente (app.js): para decidir LocalNotifications/avisos in-app.
     - Servidor (supabase/functions/notify-push,notify-vencidos): la
       decisión final de push remoto SIEMPRE es server-side (§3: "NO
       confiar en valores enviados por el cliente") — los Edge Functions
       reimplementan esta MISMA regla en Deno/TS (no pueden importar este
       archivo), con un comentario que remite aquí para que nunca diverjan
       en silencio.
   ============================================================ */

const NOTIFICATION_SHIFT = { DAY: 'DAY', NIGHT: 'NIGHT', BOTH: 'BOTH' };
const NOTIFICATION_AVAILABILITY = { AVAILABLE: 'AVAILABLE', RESTING: 'RESTING' };

// Traduce el shiftId real ('shift_dia'/'shift_noche', currentShiftId() de
// shifts.js) al vocabulario de notificaciones (DAY/NIGHT) — mapeo hecho UNA
// sola vez, aquí, para que nadie repita el `=== 'shift_dia' ? ... : ...`.
function shiftIdToNotificationShift(shiftId) {
  return shiftId === 'shift_dia' ? NOTIFICATION_SHIFT.DAY : NOTIFICATION_SHIFT.NIGHT;
}

// ¿El turno de notificación de la persona coincide con el turno actual?
// BOTH siempre coincide — no representa "ambos turnos a la vez" como un
// tercer valor comparable, sino "sin restricción de turno".
function notificationShiftMatches(notificationShift, currentNotificationShift) {
  return notificationShift === NOTIFICATION_SHIFT.BOTH || notificationShift === currentNotificationShift;
}

/* ============================================================
   DESTINATARIO ELEGIBLE (§3, §21, §22, §29) — LA función central.
   ============================================================
   `user` = { active, role, notificationShift, notificationAvailability,
   receiveAllShifts } — no importa de dónde vengan esos campos (cliente:
   push_tokens; servidor: la misma fila leída de engrase_sync), la regla es
   idéntica. `rolesPermitidos` ya lo decidió el caller (settings/
   notifications.roles) — este módulo no conoce esa configuración, solo la
   aplica. `ignoreShift` es para tipos de aviso que a propósito no dependen
   de turno (ej. resumen semanal, §20) — nunca se infiere solo, el caller
   lo pide explícitamente. */
function isUserEligibleForNotification({ user, rolesPermitidos, currentShiftId, ignoreShift }) {
  if (!user || user.active === false) return false;
  if (rolesPermitidos && rolesPermitidos.length && !rolesPermitidos.includes(user.role)) return false;
  if ((user.notificationAvailability || NOTIFICATION_AVAILABILITY.AVAILABLE) === NOTIFICATION_AVAILABILITY.RESTING) return false;
  if (ignoreShift) return true;
  // receiveAllShifts SOLO tiene efecto real una vez que ya pasó active/rol/
  // disponibilidad arriba — nunca es un "saltarse todo lo demás" (§3).
  if (user.receiveAllShifts) return true;
  const turnoActual = shiftIdToNotificationShift(currentShiftId);
  return notificationShiftMatches(user.notificationShift || NOTIFICATION_SHIFT.BOTH, turnoActual);
}

function resolveEligibleRecipients(users, opts) {
  return (users || []).filter(u => isUserEligibleForNotification({ user: u, ...opts }));
}

/* ============================================================
   RUTEO DE "NO SE PUDO EJECUTAR" (§26) — src/core/operational-scope.js ya
   define NO_EXECUTION_REASONS; este módulo decide qué hace CADA motivo en
   términos de notificación (nunca el destinatario, eso es
   isUserEligibleForNotification + el rol que corresponda para cada ruta).
     NONE: visible en Dashboard/Mi Turno (carryover ya lo muestra, ver
       findCarriedOverSkipForToday en operational-scope.js) — SIN aviso,
       para no generar spam de un motivo frecuente.
     RECONCILIATION: ambiguo (alguien más ya lo hizo, o es un error) — debe
       llegar a Planificador/Administrador para revisar.
     IMMEDIATE_UNSAFE: condición insegura — NUNCA espera al siguiente turno
       ni a una hora programada. */
const NO_EXECUTION_NOTIFICATION_ROUTE = {
  REPARACION: 'NONE',
  SIN_TIEMPO: 'NONE',
  NO_DISPONIBLE: 'NONE',
  YA_ENGRASADO: 'RECONCILIATION',
  CONDICION_INSEGURA: 'IMMEDIATE_UNSAFE',
  OTRO: 'NONE',
};
function routeNoExecutionEvent(reason) {
  return NO_EXECUTION_NOTIFICATION_ROUTE[reason] || 'NONE';
}

/* ============================================================
   RUTEO DE "FUERA DE PLAN" (§27)
   ============================================================
   Un OUT_OF_PLAN completado NUNCA dispara el push normal de "engrase
   realizado" — sería ruido (es trabajo esperado: PM/correctivo/
   oportunidad). Si ESE mismo engrase generó una anomalía crítica o una
   condición insegura, se notifica por ESA vía (routeAnomalyEvent/
   routeNoExecutionEvent), nunca por esta. */
function shouldNotifyOutOfPlanCompletion() { return false; }

/* ============================================================
   RUTEO DE ANOMALÍAS (§28) — claves en ESPAÑOL a propósito: 'criticality'
   (anomalies, ver app.js:6832) SIEMPRE usa 'Baja'/'Media'/'Alta'/'Crítica'
   en todo el sistema (formulario, Reportes, exportaciones) — nunca se
   tradujo a inglés en ningún otro lugar, así que este módulo usa la MISMA
   palabra real en vez de inventar un vocabulario paralelo que habría que
   traducir en cada caller. */
const ANOMALY_NOTIFICATION_ROUTE = {
  'Crítica': 'IMMEDIATE_ALL_ELIGIBLE_SUPERVISORS',
  'Alta': 'IMMEDIATE_SUPERVISOR_CONFIGURABLE_PLANIFICADOR',
  'Media': 'SUMMARY',
  'Baja': 'SUMMARY',
};
function routeAnomalyEvent(criticality) {
  return ANOMALY_NOTIFICATION_ROUTE[criticality] || 'SUMMARY';
}

/* ============================================================
   CLAVE DE DEDUPLICACIÓN (§30) — una misma notificación NUNCA debe salir
   2 veces por cron retry/reconnect/foreground/worker/duplicación local+
   remota. Clave DURABLE: tipo + ocurrencia + destinatario + ventana de
   envío — nunca un timestamp exacto (dos intentos dentro de la MISMA
   ventana deben producir la MISMA clave, para que el segundo intento la
   encuentre ya registrada y se detenga). `scheduleWindow` para eventos
   PROGRAMADOS es la fecha+hora programada (ej. '2026-09-30T07:00');
   para eventos INMEDIATOS, el caller pasa 'immediate' (el propio
   occurrenceKey/recipientUserId ya evita el duplicado real: 2 intentos de
   notificar la MISMA ocurrencia inmediata a la MISMA persona son, por
   definición, el mismo evento). */
function buildNotificationDedupeKey({ notificationType, occurrenceKey, recipientUserId, scheduleWindow }) {
  if (!notificationType || !recipientUserId) {
    throw new Error('buildNotificationDedupeKey requiere notificationType y recipientUserId.');
  }
  return [notificationType, occurrenceKey || 'none', recipientUserId, scheduleWindow || 'immediate'].join('|');
}
