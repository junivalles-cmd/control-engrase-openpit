// src/core/grease-validation.js
//
// Validación del engrase con firma — lógica PURA (estado/badge/validación de
// formulario), sin DOM ni IndexedDB (la persistencia real vive en
// grease_validations, ver db.js/sync.js y docs/GREASE_VALIDATION_AUDIT.md).
// Este módulo nunca guarda `validationStatus` — siempre se DERIVA de
// `signerRole` (statusForSignerRole()), para no duplicar la misma regla en
// dos lugares que podrían desincronizarse.
//
// 6 estados (OBSERVADO auditado pero NO implementado a propósito, ver
// docs/GREASE_VALIDATION_AUDIT.md — no agregar complejidad sin necesidad):
//   HISTORICO_SIN_VALIDACION — record.date es ANTERIOR a
//                           GREASE_VALIDATION_ENABLED_FROM: la funcionalidad
//                           no existía cuando se creó, así que NUNCA se le
//                           exige firma ni cuenta como pendiente, sin
//                           importar cuántas grease_validations tenga. Esto
//                           es el BASELINE (¿existía la función?) — no se
//                           mezcla con el DEADLINE (¿ya se venció el plazo?)
//                           de abajo, son dos preguntas independientes.
//   PENDIENTE_VALIDACION  — engrasado, sujeto a validación, sin firma
//                           todavía (0 activas) Y todavía dentro del plazo
//                           (ver MAX_VALIDATION_SHIFTS).
//   VALIDADO_OPERADOR     — firmó el Operador del equipo (1 activa).
//   VALIDADO_ENCARGADO    — firmó un Encargado, requiere motivo (1 activa).
//   CONFLICTO_VALIDACION  — 2+ validaciones activas para el mismo registro
//                           (doble firma offline/multidispositivo, ver
//                           docs/GREASE_VALIDATION_AUDIT.md §10) — nunca se
//                           elige una en silencio, se resuelve a mano
//                           (resolución NO implementada todavía, ver §13).
//                           Tiene PRIORIDAD sobre "vencida": si ya hay 2+
//                           firmas activas, el registro nunca se muestra
//                           como vencido, sin importar el plazo.
//   VALIDACION_VENCIDA    — sujeto a validación, 0 activas, y ya pasó el
//                           plazo (MAX_VALIDATION_SHIFTS turnos desde el
//                           turno en que se hizo el engrase). Una vez que
//                           SÍ existe una firma activa, el registro deja de
//                           poder volverse "vencido" nunca más — ver
//                           validationStatusForRecord().
const VALIDATION_STATUS = {
  HISTORICO: 'HISTORICO_SIN_VALIDACION',
  PENDIENTE: 'PENDIENTE_VALIDACION',
  OPERADOR: 'VALIDADO_OPERADOR',
  ENCARGADO: 'VALIDADO_ENCARGADO',
  CONFLICTO: 'CONFLICTO_VALIDACION',
  VENCIDA: 'VALIDACION_VENCIDA',
};

const VALIDATION_BADGE = {
  [VALIDATION_STATUS.HISTORICO]: { label: 'Histórico · Sin validación requerida', tone: 'neutral' },
  [VALIDATION_STATUS.PENDIENTE]: { label: 'Engrasado · Pendiente de validación', tone: 'amber' },
  [VALIDATION_STATUS.OPERADOR]: { label: 'Validado · Operador', tone: 'green' },
  [VALIDATION_STATUS.ENCARGADO]: { label: 'Validado · Encargado', tone: 'teal' },
  [VALIDATION_STATUS.CONFLICTO]: { label: 'Conflicto de validación', tone: 'red' },
  [VALIDATION_STATUS.VENCIDA]: { label: 'Validación vencida', tone: 'red' },
};

// Plazo máximo para validar un engrase: el turno en que se hizo Y como
// máximo el turno siguiente — nunca queda pendiente indefinidamente. Único
// punto central de este número; no repartir "2" por pantallas.
const MAX_VALIDATION_SHIFTS = 2;

// Punto CENTRAL único de la fecha/hora (ISO) desde la cual un
// lubrication_record queda SUJETO a validación — nunca se repite este valor
// en otro archivo, y NINGÚN consumidor (Dashboard/Historial/Mis Engrases/
// Reportes) implementa su propia excepción: todos pasan por
// isRecordSubjectToValidation() (directo o vía validationStatusForRecord()/
// isRecordPendingValidation()/isRecordInConflict()).
//
// ROLLOUT ACTIVADO (2026-09-26): la validación queda sujeta a partir del
// inicio del PRÓXIMO Turno Día — 2026-09-27T06:00:00 hora local (App.
// generalSettings real: shiftDayStart=6, shiftNightStart=18; no había
// `settings/general` configurado en producción, así que rige el default de
// la app), expresado en UTC porque así se guardan `record.date`/`updatedAt`
// en todo el proyecto (nowISO() = new Date().toISOString(), ver db.js) —
// mismo formato, comparación directa sin ambigüedad de huso horario.
// Cualquier lubrication_record con `date` ANTERIOR a este instante queda
// HISTÓRICO para siempre (isRecordSubjectToValidation() abajo) — el rollout
// nunca convierte engrases previos en pendientes. Para probar el flujo
// Pendiente→Validado con OTRAS fechas en tests automáticos, usar un
// baseline EXPLÍCITO dentro del propio test/fixture (nunca cambiar esta
// constante productiva para eso).
const GREASE_VALIDATION_ENABLED_FROM = '2026-09-27T12:00:00.000Z';

// true SOLO si hay un baseline real configurado Y record.date cae en o
// después de esa fecha. Con baseline null, SIEMPRE false — ver comentario
// de arriba (única fuente de verdad, sin excepciones por pantalla).
function isRecordSubjectToValidation(recordDate) {
  if (!GREASE_VALIDATION_ENABLED_FROM) return false;
  return new Date(recordDate).getTime() >= new Date(GREASE_VALIDATION_ENABLED_FROM).getTime();
}

/* ============================================================
   PLAZO DE VALIDACIÓN (MAX_VALIDATION_SHIFTS turnos) — funciones PURAS,
   funcionan offline: solo dependen de `date`/`now` (Date/ISO) y de los
   límites de turno YA configurados (shiftBoundaries = { shiftDayStart,
   shiftNightStart }, las mismas horas que usa currentShiftId() en
   src/core/shifts.js vía App.generalSettings — nunca se inventan horarios
   aquí, el llamador siempre debe pasar la configuración real). La
   referencia de tiempo es SIEMPRE `date` (lubrication_record.date, la hora
   REAL del engrase) — nunca fecha de sync/subida/apertura de pantalla.
   ============================================================ */

// 'shift_dia' o 'shift_noche' según la hora, con el mismo criterio que
// currentShiftId() (src/core/shifts.js) — no se duplica esa regla, se
// reimplementa aquí en forma pura porque ese archivo depende del global App.
function shiftKindAt(hour, shiftBoundaries) {
  return (hour >= shiftBoundaries.shiftDayStart && hour < shiftBoundaries.shiftNightStart) ? 'shift_dia' : 'shift_noche';
}

// Duración en horas de un turno dado — Día+Noche SIEMPRE suman 24h exactas
// (son los únicos 2 turnos del ciclo diario), aunque sus horarios
// individuales sean asimétricos (ej. Día 8h/Noche 16h).
function shiftDurationHours(kind, shiftBoundaries) {
  const diaHoras = ((shiftBoundaries.shiftNightStart - shiftBoundaries.shiftDayStart) + 24) % 24;
  return kind === 'shift_dia' ? diaHoras : (24 - diaHoras);
}

// Instante exacto (Date) en que EMPIEZA el turno al que pertenece `date`,
// junto con qué turno es — base para calcular el plazo.
function shiftWindowStart(date, shiftBoundaries) {
  const d = new Date(date);
  const h = d.getHours();
  const kind = shiftKindAt(h, shiftBoundaries);
  const start = new Date(d);
  start.setMinutes(0, 0, 0);
  if (kind === 'shift_dia') {
    start.setHours(shiftBoundaries.shiftDayStart);
  } else if (h >= shiftBoundaries.shiftNightStart) {
    start.setHours(shiftBoundaries.shiftNightStart);
  } else {
    // Pasada la medianoche: el turno noche en curso empezó AYER.
    start.setDate(start.getDate() - 1);
    start.setHours(shiftBoundaries.shiftNightStart);
  }
  return { start, kind };
}

// Fin del plazo de validación: el turno en que se hizo el engrase +
// (MAX_VALIDATION_SHIFTS - 1) turnos más — "2 turnos" = el propio + el
// siguiente. Avanza turno por turno (nunca asume 12h fijas) para que
// funcione igual con horarios de turno asimétricos.
function validationDeadline(recordDate, shiftBoundaries) {
  let { start, kind } = shiftWindowStart(recordDate, shiftBoundaries);
  let t = start.getTime();
  for (let i = 0; i < MAX_VALIDATION_SHIFTS; i++) {
    t += shiftDurationHours(kind, shiftBoundaries) * 3600000;
    kind = kind === 'shift_dia' ? 'shift_noche' : 'shift_dia';
  }
  return new Date(t);
}

// true si `now` ya superó el plazo de `recordDate`. `now` se recibe como
// parámetro (nunca Date.now() interno) para que sea 100% determinista en
// pruebas y para dejar claro que NUNCA se usa una fecha de sincronización.
function isValidationExpired(recordDate, now, shiftBoundaries) {
  return new Date(now).getTime() > validationDeadline(recordDate, shiftBoundaries).getTime();
}

// signerRole tal como lo elige el formulario ('OPERADOR' | 'ENCARGADO') →
// el validationStatus que le corresponde. Única fuente de esta regla.
function statusForSignerRole(signerRole) {
  if (signerRole === 'OPERADOR') return VALIDATION_STATUS.OPERADOR;
  if (signerRole === 'ENCARGADO') return VALIDATION_STATUS.ENCARGADO;
  return null;
}

// Validación del formulario de firma — pura, sin tocar el DOM. `form`:
// { signerName, signerRole, reason, hasSignature }. Nunca permite confirmar
// sin nombre, rol, firma, y motivo cuando el rol es Encargado.
function validateValidationForm(form) {
  const errors = {};
  const signerName = (form.signerName || '').trim();
  const signerRole = form.signerRole || '';
  const reason = (form.reason || '').trim();

  if (!signerName) errors.signerName = 'El nombre es obligatorio.';
  if (signerRole !== 'OPERADOR' && signerRole !== 'ENCARGADO') errors.signerRole = 'Selecciona quién valida.';
  if (signerRole === 'ENCARGADO' && !reason) errors.reason = 'Indica el motivo (por ejemplo, "Operador no disponible").';
  if (!form.hasSignature) errors.signature = 'Falta la firma.';

  return { valid: Object.keys(errors).length === 0, errors };
}

// TODAS las validaciones activas de un lubricationRecordId (0, 1 o 2+ —
// nunca elige, solo junta). Única fuente de verdad para saber si hay
// conflicto; `findActiveValidation()`/`validationStatusFor()` se apoyan en
// esta función, nunca leen `validations` directo por su cuenta.
function findActiveValidations(lubricationRecordId, validations) {
  return (validations || []).filter(v => v.lubricationRecordId === lubricationRecordId && v.active !== false);
}

// true si hay 2 o más validaciones activas para el mismo registro (doble
// firma offline/multidispositivo, ver docs/GREASE_VALIDATION_AUDIT.md §10).
function hasValidationConflict(lubricationRecordId, validations) {
  return findActiveValidations(lubricationRecordId, validations).length > 1;
}

// La validación activa, SOLO cuando hay exactamente UNA — con 0 o con 2+
// devuelve null a propósito: nunca elige una en silencio cuando hay
// conflicto (usar findActiveValidations()/hasValidationConflict() para esos
// casos, nunca asumir que este helper "resuelve" el conflicto por ti).
function findActiveValidation(lubricationRecordId, validations) {
  const activas = findActiveValidations(lubricationRecordId, validations);
  return activas.length === 1 ? activas[0] : null;
}

// Estado derivado (NUNCA persistido — se calcula cada vez a partir de
// cuántas validaciones activas hay y, si hay exactamente una, su signerRole):
// 0 → PENDIENTE, 1 → según signerRole, 2+ → CONFLICTO. NO conoce
// record.date — para eso usar validationStatusForRecord(), que primero
// descarta el caso HISTÓRICO antes de llegar aquí.
function validationStatusFor(lubricationRecordId, validations) {
  const activas = findActiveValidations(lubricationRecordId, validations);
  if (activas.length === 0) return VALIDATION_STATUS.PENDIENTE;
  if (activas.length === 1) return statusForSignerRole(activas[0].signerRole);
  return VALIDATION_STATUS.CONFLICTO;
}

// Estado derivado consciente del baseline (¿existía la función?) Y del
// plazo (¿ya se venció?) — dos preguntas independientes, nunca mezcladas:
//   1) anterior a GREASE_VALIDATION_ENABLED_FROM → SIEMPRE HISTÓRICO, sin
//      importar cuántas grease_validations tenga ni cuánto tiempo pasó.
//   2) 2+ activas → CONFLICTO (prioridad sobre "vencida": una vez que hay
//      conflicto, NUNCA se muestra como vencido).
//   3) 1 activa → validado (OPERADOR/ENCARGADO) — una firma ya registrada
//      dentro del plazo NUNCA se vuelve "vencida" después, sin importar
//      cuándo se sincronizó (signedAt manda, no uploadedAt/syncedAt).
//   4) 0 activas → PENDIENTE si `now` todavía está dentro del plazo
//      (MAX_VALIDATION_SHIFTS turnos desde record.date), VENCIDA si ya lo
//      superó.
// `now`/`shiftBoundaries` son obligatorios a propósito (nunca un default
// oculto): el llamador SIEMPRE debe pasar la hora real y los turnos
// REALMENTE configurados (App.generalSettings), nunca inventados aquí.
function validationStatusForRecord(record, validations, now, shiftBoundaries) {
  if (!isRecordSubjectToValidation(record.date)) return VALIDATION_STATUS.HISTORICO;
  const activas = findActiveValidations(record.id, validations);
  if (activas.length > 1) return VALIDATION_STATUS.CONFLICTO;
  if (activas.length === 1) return statusForSignerRole(activas[0].signerRole);
  return isValidationExpired(record.date, now, shiftBoundaries) ? VALIDATION_STATUS.VENCIDA : VALIDATION_STATUS.PENDIENTE;
}

// true solo cuando el record SÍ está sujeto a validación (no es histórico),
// tiene 0 activas Y todavía está DENTRO del plazo — la definición exacta de
// "Pendientes de validación" para KPIs/listas (excluye histórico, excluye
// validado, excluye conflicto Y excluye vencido: ver
// docs/GREASE_VALIDATION_AUDIT.md §10).
function isRecordPendingValidation(record, validations, now, shiftBoundaries) {
  if (!isRecordSubjectToValidation(record.date)) return false;
  if (findActiveValidations(record.id, validations).length !== 0) return false;
  return !isValidationExpired(record.date, now, shiftBoundaries);
}

// true solo cuando el record SÍ está sujeto a validación, tiene 0 activas Y
// ya superó el plazo — usar esta función (no isValidationExpired directo)
// en cualquier UI que tenga el `record` completo, para ocultar el botón
// "Validar" y mostrar el badge "Validación vencida" en vez de "Pendiente".
// Una vez que existe 1+ firma activa, esto SIEMPRE devuelve false (ver
// comentario de validationStatusForRecord — nunca se "revierte" a vencida).
function isRecordValidationExpired(record, validations, now, shiftBoundaries) {
  if (!isRecordSubjectToValidation(record.date)) return false;
  if (findActiveValidations(record.id, validations).length !== 0) return false;
  return isValidationExpired(record.date, now, shiftBoundaries);
}

// true solo cuando el record SÍ está sujeto a validación Y tiene 2+
// activas — un registro histórico (no sujeto) NUNCA es "conflicto" para
// efectos de UI/KPIs, aunque técnicamente tenga 2+ grease_validations (ver
// validationStatusForRecord(), que también antepone HISTÓRICO al
// conflicto). Usar esta función en vez de hasValidationConflict() directo
// en cualquier lugar que tenga el `record` completo — evita que un
// KPI/lista (ej. "Conflictos de validación" del Dashboard) cuente algo que
// Historial ya muestra como Histórico, que sería inconsistente entre
// pantallas.
function isRecordInConflict(record, validations) {
  if (!isRecordSubjectToValidation(record.date)) return false;
  return hasValidationConflict(record.id, validations);
}
