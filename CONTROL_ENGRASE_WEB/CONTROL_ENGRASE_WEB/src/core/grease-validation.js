// src/core/grease-validation.js
//
// Validación del engrase con firma — lógica PURA (estado/badge/validación de
// formulario), sin DOM ni IndexedDB (la persistencia real vive en
// grease_validations, ver db.js/sync.js y docs/GREASE_VALIDATION_AUDIT.md).
// Este módulo nunca guarda `validationStatus` — siempre se DERIVA de
// `signerRole` (statusForSignerRole()), para no duplicar la misma regla en
// dos lugares que podrían desincronizarse.
//
// 5 estados (OBSERVADO auditado pero NO implementado a propósito, ver
// docs/GREASE_VALIDATION_AUDIT.md — no agregar complejidad sin necesidad):
//   HISTORICO_SIN_VALIDACION — record.date es ANTERIOR a
//                           GREASE_VALIDATION_ENABLED_FROM: la funcionalidad
//                           no existía cuando se creó, así que NUNCA se le
//                           exige firma ni cuenta como pendiente, sin
//                           importar cuántas grease_validations tenga.
//   PENDIENTE_VALIDACION  — engrasado, sujeto a validación, sin firma
//                           todavía (0 activas).
//   VALIDADO_OPERADOR     — firmó el Operador del equipo (1 activa).
//   VALIDADO_ENCARGADO    — firmó un Encargado, requiere motivo (1 activa).
//   CONFLICTO_VALIDACION  — 2+ validaciones activas para el mismo registro
//                           (doble firma offline/multidispositivo, ver
//                           docs/GREASE_VALIDATION_AUDIT.md §10) — nunca se
//                           elige una en silencio, se resuelve a mano
//                           (resolución NO implementada todavía, ver §13).
const VALIDATION_STATUS = {
  HISTORICO: 'HISTORICO_SIN_VALIDACION',
  PENDIENTE: 'PENDIENTE_VALIDACION',
  OPERADOR: 'VALIDADO_OPERADOR',
  ENCARGADO: 'VALIDADO_ENCARGADO',
  CONFLICTO: 'CONFLICTO_VALIDACION',
};

const VALIDATION_BADGE = {
  [VALIDATION_STATUS.HISTORICO]: { label: 'Histórico · Sin validación requerida', tone: 'neutral' },
  [VALIDATION_STATUS.PENDIENTE]: { label: 'Engrasado · Pendiente de validación', tone: 'amber' },
  [VALIDATION_STATUS.OPERADOR]: { label: 'Validado · Operador', tone: 'green' },
  [VALIDATION_STATUS.ENCARGADO]: { label: 'Validado · Encargado', tone: 'teal' },
  [VALIDATION_STATUS.CONFLICTO]: { label: 'Conflicto de validación', tone: 'red' },
};

// Punto CENTRAL único de la fecha/hora (ISO) desde la cual un
// lubrication_record queda SUJETO a validación — nunca se repite este valor
// en otro archivo, y NINGÚN consumidor (Dashboard/Historial/Mis Engrases/
// Reportes) implementa su propia excepción: todos pasan por
// isRecordSubjectToValidation() (directo o vía validationStatusForRecord()/
// isRecordPendingValidation()/isRecordInConflict()).
//
// PENDIENTE DE DEFINIR: todavía no existe una fecha de salida a producción
// oficial — se deja en `null` A PROPÓSITO (no se inventa un valor). Mientras
// sea `null`, la funcionalidad de validación NO está activada oficialmente:
// isRecordSubjectToValidation() devuelve `false` para TODO registro (nuevo
// o viejo) — ver esa función. Esto es intencional, no un bug: sin una fecha
// real no existe un "antes/después del rollout" que evaluar, así que
// ninguna pantalla puede mostrar honestamente "pendiente"/"validado" hasta
// que se defina. El flujo de Finalizar Engrase (Validar ahora/después)
// sigue funcionando igual (no se rompe, ver startGreaseFlow() en app.js) —
// solo que, mientras el baseline sea null, el registro se sigue mostrando
// como "Histórico · Sin validación requerida" en Historial/Mis Engrases
// (fase de prueba/preproducción, ver docs/GREASE_VALIDATION_AUDIT.md §14).
// Para probar el flujo Pendiente→Validado en tests automáticos, usar un
// baseline EXPLÍCITO dentro del propio test/fixture (nunca cambiar esta
// constante productiva para eso).
const GREASE_VALIDATION_ENABLED_FROM = null;

// true SOLO si hay un baseline real configurado Y record.date cae en o
// después de esa fecha. Con baseline null, SIEMPRE false — ver comentario
// de arriba (única fuente de verdad, sin excepciones por pantalla).
function isRecordSubjectToValidation(recordDate) {
  if (!GREASE_VALIDATION_ENABLED_FROM) return false;
  return new Date(recordDate).getTime() >= new Date(GREASE_VALIDATION_ENABLED_FROM).getTime();
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

// Estado derivado consciente del baseline: si el record es anterior a
// GREASE_VALIDATION_ENABLED_FROM, SIEMPRE es HISTÓRICO (sin importar
// cuántas grease_validations tenga) — de lo contrario, delega en
// validationStatusFor(). Usar esta función (no validationStatusFor
// directo) en cualquier UI que tenga el `record` completo disponible.
function validationStatusForRecord(record, validations) {
  if (!isRecordSubjectToValidation(record.date)) return VALIDATION_STATUS.HISTORICO;
  return validationStatusFor(record.id, validations);
}

// true solo cuando el record SÍ está sujeto a validación (no es histórico)
// Y tiene 0 activas — la definición exacta de "Pendientes de validación"
// para KPIs/listas (excluye histórico, excluye validado, excluye conflicto:
// un conflicto NO es "pendiente", ver docs/GREASE_VALIDATION_AUDIT.md §10).
function isRecordPendingValidation(record, validations) {
  if (!isRecordSubjectToValidation(record.date)) return false;
  return findActiveValidations(record.id, validations).length === 0;
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
