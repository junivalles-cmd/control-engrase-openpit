// tests/helpers/loadLubricationLogic.js
//
// Carga, DIRECTAMENTE desde la fuente canónica
// (CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB), las funciones puras/casi-puras
// que gobiernan turnos, estado de engrase, horómetro y anomalías — sin
// modificar esos archivos ni reescribir su lógica a mano. Si el código
// fuente cambia, estas pruebas se ejecutan contra el código nuevo
// automáticamente.
//
// Desde la modularización (ver docs/MODULARIZATION.md), parte de esta
// lógica vive en src/core/*.js en vez de app.js/db.js — este loader lee de
// varios archivos y los combina en un solo scope, tal como el navegador
// los comparte al cargarlos con <script> por separado.
//
// Las funciones que SÍ dependen de la base de datos real (IndexedDB) o de la
// red (fetch a Supabase) no se cargan aquí — ver docs/AUTOMATED_TESTS.md para
// la lista de lo que queda pendiente de extracción.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource, extractDeclaration } from './extractFromSource.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(__dirname, '../../CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB');

export const APP_JS_PATH = path.join(SRC_ROOT, 'app.js');
export const DB_JS_PATH = path.join(SRC_ROOT, 'db.js');
export const SHIFTS_JS_PATH = path.join(SRC_ROOT, 'src/core/shifts.js');
export const HOURMETER_JS_PATH = path.join(SRC_ROOT, 'src/core/hourmeter.js');
export const LUBRICATION_STATUS_JS_PATH = path.join(SRC_ROOT, 'src/core/lubrication-status.js');
export const ANOMALIES_JS_PATH = path.join(SRC_ROOT, 'src/core/anomalies.js');
export const WEEKLY_MATRIX_JS_PATH = path.join(SRC_ROOT, 'src/core/weekly-matrix.js');
export const ANOMALY_ACTIONS_JS_PATH = path.join(SRC_ROOT, 'src/core/anomaly-actions.js');
export const PLAN_COMPLIANCE_JS_PATH = path.join(SRC_ROOT, 'src/core/plan-compliance.js');

// Cada entrada: [archivo, [nombres a extraer de ese archivo]]
const APP_LOGIC_SOURCES = [
  [SHIFTS_JS_PATH, ['currentShiftId', 'dentroDeSuTurno']],
  [HOURMETER_JS_PATH, ['validateHourmeterChange']],
  [LUBRICATION_STATUS_JS_PATH, [
    'fmt',
    'WEEKDAY_NAMES',
    'mostRecentAssignedDate',
    'weekdayStatusFor',
    'statusFor',
  ]],
  [ANOMALIES_JS_PATH, ['CRITICIDAD_POR_MOTIVO']],
  [APP_JS_PATH, [
    'horaAjustadaAlTurno',
    'esc',
    'colorPorCumplimiento',
  ]],
];

function buildBodyFromSources(sources) {
  const chunks = [];
  const allNames = [];
  for (const [filePath, names] of sources) {
    const fileSource = readSource(filePath);
    for (const name of names) {
      chunks.push(extractDeclaration(fileSource, name));
      allNames.push(name);
    }
  }
  return `${chunks.join('\n\n')}\n\nreturn { ${allNames.join(', ')} };`;
}

/**
 * Devuelve las funciones/constantes reales de la fuente canónica, ligadas a
 * un objeto `App` de prueba (las funciones originales leen
 * `App.currentUser` / `App.generalSettings` como estado global — aquí se
 * pasa como parámetro, igual que antes de la modularización).
 */
export function loadAppLogic(fakeApp) {
  const body = buildBodyFromSources(APP_LOGIC_SOURCES);
  const factory = new Function('App', body);
  return factory(fakeApp);
}

const DB_JS_NAMES = ['uid', 'nowISO', 'stamp'];

/** Devuelve uid/nowISO/stamp reales de db.js (no requieren IndexedDB). */
export function loadDbLogic() {
  const body = buildBodyFromSources([[DB_JS_PATH, DB_JS_NAMES]]);
  const factory = new Function(body);
  return factory();
}

const DB_SEED_SOURCES = [
  [DB_JS_PATH, [
    'uid', 'nowISO', 'stamp', 'logAudit', 'isSupabaseAuthMode',
    'seedSoloUsuarioInicial', 'seedIfEmpty',
    'seedCuadrillasIfMissing', 'seedCuadrillasSoloSiNuncaSeSembraron',
    'seedSoloSiElSistemaEstaVacio',
  ]],
];

/**
 * Devuelve la lógica REAL de seed/bootstrap de db.js
 * (seedSoloSiElSistemaEstaVacio/seedIfEmpty/seedSoloUsuarioInicial/
 * isSupabaseAuthMode/etc.), ligada a un `DB` y un `Auth` de prueba. Estas
 * funciones solo llaman a `DB.*` (nunca a indexedDB/openDB/tx
 * directamente), así que un `DB` fake alcanza — igual que loadSyncLogic().
 * `localStorage`/`navigator`/`fetch` se resuelven como globales normales
 * dentro del cuerpo (mismo mecanismo que ya usan los tests de sync.js) —
 * el test los stubea con `vi.stubGlobal()` antes de llamar.
 */
export function loadDbSeedLogic(fakeDB, fakeAuth) {
  const body = buildBodyFromSources(DB_SEED_SOURCES);
  const factory = new Function('DB', 'Auth', body);
  return factory(fakeDB, fakeAuth);
}

// estadoCelda() (weekly-matrix.js) usa el global WEEKDAY_NAMES, exactamente
// como en el navegador (scripts clásicos, scope compartido) — por eso se
// extrae junto con él en el mismo cuerpo, igual que hace APP_LOGIC_SOURCES
// con statusFor()/WEEKDAY_NAMES.
const WEEKLY_MATRIX_SOURCES = [
  [LUBRICATION_STATUS_JS_PATH, ['WEEKDAY_NAMES']],
  [WEEKLY_MATRIX_JS_PATH, ['estadoCelda']],
];

/** Devuelve la función real estadoCelda() de src/core/weekly-matrix.js. */
export function loadWeeklyMatrixLogic() {
  const body = buildBodyFromSources(WEEKLY_MATRIX_SOURCES);
  const factory = new Function(body);
  return factory();
}

// evaluateAnomalyActions() (anomaly-actions.js) usa los globales fmtDate
// (app.js) y CRITICIDAD_POR_MOTIVO (anomalies.js), exactamente como en el
// navegador — se extraen juntos en el mismo cuerpo.
const ANOMALY_ACTIONS_SOURCES = [
  [APP_JS_PATH, ['fmtDate']],
  [ANOMALIES_JS_PATH, ['CRITICIDAD_POR_MOTIVO']],
  [ANOMALY_ACTIONS_JS_PATH, ['hayPuntosOAnomaliaHorometro', 'evaluateAnomalyActions']],
];

/** Devuelve las funciones reales de src/core/anomaly-actions.js. */
export function loadAnomalyActionsLogic() {
  const body = buildBodyFromSources(ANOMALY_ACTIONS_SOURCES);
  const factory = new Function(body);
  return factory();
}

// evaluateRecordCompliance() (plan-compliance.js) usa el global WEEKDAY_NAMES,
// igual que estadoCelda() en weekly-matrix.js.
const PLAN_COMPLIANCE_SOURCES = [
  [LUBRICATION_STATUS_JS_PATH, ['WEEKDAY_NAMES']],
  [PLAN_COMPLIANCE_JS_PATH, ['evaluateRecordCompliance', 'findPreviousRecord', 'computeFleetCompliance', 'computeProgramadoRealizadoPeriodo']],
];

/** Devuelve las funciones reales de src/core/plan-compliance.js. */
export function loadPlanComplianceLogic() {
  const body = buildBodyFromSources(PLAN_COMPLIANCE_SOURCES);
  const factory = new Function(body);
  return factory();
}

export const SYNC_JS_PATH = path.join(SRC_ROOT, 'sync.js');
export const AUTH_JS_PATH = path.join(SRC_ROOT, 'src/core/auth.js');
const SYNC_SOURCES = [
  [DB_JS_PATH, ['nowISO']],
  [AUTH_JS_PATH, ['classifyAuthStatus']],
  [SYNC_JS_PATH, ['PHOTO_BUCKET', 'dataURLtoBlob', 'isRowDirty', 'decidePullAction', 'Sync']],
];

/**
 * Devuelve el objeto Sync REAL de sync.js (pushAll/pullAll/
 * uploadPhotoIfNeeded/uploadSignatureIfNeeded/fetchRemoteUpdatedAt/etc.,
 * incluyendo el CAS atómico de pushAll: INSERT ignore-duplicates para
 * filas nuevas, PATCH condicionado a `_pushedVersion` para el resto, y el
 * gate de Auth de P0-2 Etapa B1), ligado a un `DB`/`STORES` de prueba y,
 * opcionalmente, un `Auth` de prueba (Sync los lee como globales, igual
 * que en el navegador — aquí se pasan como parámetros de la función que
 * ejecuta el código real). Si se omite `fakeAuth`, `Auth` queda
 * `undefined` dentro del cuerpo — exactamente como en cualquier test que
 * no lo necesite, el gate de Auth nunca se activa (mismo comportamiento
 * que hoy). `nowISO`/`classifyAuthStatus` se extraen de db.js/auth.js
 * porque sync.js los usa como globales compartidos (mismo scope de
 * <script> en el navegador — ver index.html).
 */
export function loadSyncLogic(fakeDB, fakeStores, fakeAuth) {
  const body = buildBodyFromSources(SYNC_SOURCES);
  const factory = new Function('DB', 'STORES', 'Auth', body);
  return factory(fakeDB, fakeStores, fakeAuth);
}

const AUTH_SOURCES = [
  [DB_JS_PATH, ['nowISO']],
  [AUTH_JS_PATH, [
    'AUTH_MODE', 'AUTH_VALID_ROLES', 'AUTH_IDENTIFIER_DOMAIN',
    'usernameToAuthIdentifier', 'classifyAuthStatus', 'isValidProfile', 'Auth',
  ]],
];

/**
 * Devuelve las funciones/objeto reales de src/core/auth.js
 * (usernameToAuthIdentifier/classifyAuthStatus/isValidProfile/Auth),
 * ligado a un `DB` de prueba (Auth lee `DB`/`fetch`/`navigator`/`nowISO`
 * como globales, igual que en el navegador).
 */
export function loadAuthLogic(fakeDB) {
  const body = buildBodyFromSources(AUTH_SOURCES);
  const factory = new Function('DB', body);
  return factory(fakeDB);
}

export const GREASE_VALIDATION_JS_PATH = path.join(SRC_ROOT, 'src/core/grease-validation.js');
const GREASE_VALIDATION_SOURCES = [
  [GREASE_VALIDATION_JS_PATH, ['VALIDATION_STATUS', 'VALIDATION_BADGE', 'GREASE_VALIDATION_ENABLED_FROM', 'MAX_VALIDATION_SHIFTS', 'isRecordSubjectToValidation', 'statusForSignerRole', 'validateValidationForm', 'findActiveValidations', 'hasValidationConflict', 'findActiveValidation', 'validationStatusFor', 'validationStatusForRecord', 'isRecordPendingValidation', 'isRecordInConflict', 'isRecordValidationExpired', 'shiftKindAt', 'shiftDurationHours', 'shiftWindowStart', 'validationDeadline', 'isValidationExpired']],
];

/** Devuelve las funciones/constantes reales de src/core/grease-validation.js. */
export function loadGreaseValidationLogic() {
  const body = buildBodyFromSources(GREASE_VALIDATION_SOURCES);
  const factory = new Function(body);
  return factory();
}
