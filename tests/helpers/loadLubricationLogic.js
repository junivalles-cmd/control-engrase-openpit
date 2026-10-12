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
export const OPERATIONAL_SCOPE_JS_PATH = path.join(SRC_ROOT, 'src/core/operational-scope.js');
export const NOTIFICATION_ROUTING_JS_PATH = path.join(SRC_ROOT, 'src/core/notification-routing.js');

// Cada entrada: [archivo, [nombres a extraer de ese archivo]]
const APP_LOGIC_SOURCES = [
  [SHIFTS_JS_PATH, ['currentShiftId', 'dentroDeSuTurno']],
  [HOURMETER_JS_PATH, ['validateHourmeterChange']],
  // Fix 2026-10-09 ("REALIZADO ADELANTADO"): weekdayStatusFor() ahora usa
  // computeOccurrenceKey()/toISODateUTCLocal() (operational-scope.js) para
  // detectar un COMPLETE que satisfizo esta ocurrencia por adelantado —
  // mismo patrón ya establecido por WEEKLY_MATRIX_SOURCES más abajo con
  // estadoCelda().
  [OPERATIONAL_SCOPE_JS_PATH, ['computeOccurrenceKey', 'toISODateUTCLocal']],
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
    'SYNC_INTERVAL_OPTIONS',
    'SYNC_INTERVAL_DEFAULT',
    'normalizeSyncInterval',
    'syncIntervalLabel',
    'currentUserFromAuthProfile',
    'shouldBlockCompleteChecklistWithoutGrease',
    'GREASE_UNIT',
    'PERMISSIONS',
    'qrValueForEquipment',
    'parseEquipmentIdFromScan',
    'resolveEquipmentFromScan',
    'equipoMatchesQuery',
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
  // estadoCelda() usa computeOccurrenceKey() (operational-scope.js) para
  // detectar "REALIZADO ADELANTADO" (engrase fuera de plan que satisfizo
  // esta celda por adelantado, ver lote "engrase fuera de plan" §19).
  [OPERATIONAL_SCOPE_JS_PATH, ['computeOccurrenceKey']],
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
  [DB_JS_PATH, ['nowISO', 'NETWORK_TIMEOUT_MS', 'fetchWithTimeout', 'isNetworkFailure']],
  [AUTH_JS_PATH, ['classifyAuthStatus']],
  [SYNC_JS_PATH, ['PHOTO_BUCKET', 'FULL_REFRESH_WINDOWS', 'localDateISO', 'dueFullRefreshWindows', 'resolvePhotoStoragePath', 'dataURLtoBlob', 'isRowDirty', 'decidePullAction', 'syncAuthHeaders', 'syncSessionEpoch', 'syncConfig', 'authenticatedSyncFetch', 'readAuthErrorMessage', 'buildAuthErrorDetail', 'Sync']],
];

/**
 * Devuelve el objeto Sync REAL de sync.js (pushAll/pullAll/
 * uploadPhotoIfNeeded/uploadSignatureIfNeeded/fetchRemoteUpdatedAt/etc.,
 * incluyendo el CAS atómico de pushAll: INSERT ignore-duplicates para
 * filas nuevas, PATCH condicionado a `_pushedVersion` para el resto, y el
 * gate de Auth de P0-2 Etapa B1), ligado a un `DB`/`STORES` de prueba y,
 * opcionalmente, un `Auth` de prueba (Sync los lee como globales, igual
 * que en el navegador — aquí se pasan como parámetros de la función que
 * ejecuta el código real). Por defecto usa una sesión Auth ficticia explícita
 * para probar transporte/CAS. Pasar null simula Auth ausente y verifica
 * el rechazo antes de la red. `nowISO`/`classifyAuthStatus` se extraen de db.js/auth.js
 * porque sync.js los usa como globales compartidos (mismo scope de
 * <script> en el navegador — ver index.html).
 */
export function loadSyncLogic(fakeDB, fakeStores, fakeAuth = {
  isSupabaseMode: () => true,
  isAuthenticated: () => true,
  getSession: () => ({ accessToken: 'fixture-user-jwt' }),
  getProfile: () => ({ role: 'ADMINISTRADOR' }),
  restoreSession: async () => {},
}) {
  const body = buildBodyFromSources(SYNC_SOURCES);
  const factory = new Function('DB', 'STORES', 'Auth', body);
  return factory(fakeDB, fakeStores, fakeAuth || undefined);
}

const AUTH_SOURCES = [
  [DB_JS_PATH, ['nowISO', 'NETWORK_TIMEOUT_MS', 'fetchWithTimeout', 'isNetworkFailure']],
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

// Rediseño operativo (dispositivos + cuadrillas + ubicaciones + asignación
// manual) — 100% puro, sin DB/App/Auth, mismo patrón que grease-validation.js.
const OPERATIONAL_SCOPE_SOURCES = [
  // findNextApplicableOccurrenceForWeekdayPlan() usa el global WEEKDAY_NAMES,
  // mismo patrón que estadoCelda() en weekly-matrix.js.
  [LUBRICATION_STATUS_JS_PATH, ['WEEKDAY_NAMES']],
  [OPERATIONAL_SCOPE_JS_PATH, [
    'ASSIGNMENT_STATUS', 'ROLES_CAN_MANAGE_ASSIGNMENTS', 'ROLES_CAN_MOVE_EQUIPMENT',
    'ROLES_CAN_MOVE_CREW', 'ROLES_CAN_MANAGE_CREW_MEMBERSHIP', 'ROLES_CAN_REGISTER_OUT_OF_PLAN',
    'ROLES_CREW_SCOPED',
    'canManageAssignments', 'canMoveEquipment', 'canMoveCrew', 'canManageCrewMembership',
    'canRegisterOutOfPlan', 'getAuthorizedCrews',
    'computeOccurrenceKey', 'resolveDefaultCrewForLocation', 'resolveCrewLocationCoverage', 'validateCrewLocationCoverage', 'resolveOperationalScope',
    'classifyEquipmentWork', 'equiposForLubricadorMatriz', 'findActivePendingAssignment', 'createAssignment',
    'reassignAssignment', 'cancelAssignment', 'completeAssignmentIfPending',
    'canLubricadorExecuteEquipment',
    'buildExecutionSnapshot', 'resolveRecordEquipmentLocationId',
    'resolveRecordCrewId', 'resolveRecordCrewLocationId',
    'EXECUTION_TYPE', 'EXECUTION_COMPLETENESS', 'OUT_OF_PLAN_REASONS',
    'toISODateUTCLocal',
    'computeExecutionCompleteness', 'findNextApplicableOccurrenceForWeekdayPlan',
    'findNextApplicableOccurrence', 'resolveEarlyOccurrenceSatisfaction', 'canAdvanceHourCycle', 'findExistingWorkForEquipment',
    'resolveRecordExecutionType', 'resolveRecordOutOfPlanReason', 'resolveRecordCompleteness',
    'NO_EXECUTION_REASONS', 'validateNoExecutionInput', 'buildNoExecutionRecord', 'findCarriedOverSkipForToday',
    'GREASE_MATCH_STATUS', 'findMatchingGreaseRecordForOccurrence',
  ]],
];

/** Devuelve las funciones/constantes reales de src/core/operational-scope.js. */
export function loadOperationalScopeLogic() {
  const body = buildBodyFromSources(OPERATIONAL_SCOPE_SOURCES);
  const factory = new Function(body);
  return factory();
}

// Arquitectura de notificaciones (usuario+turno+disponibilidad+scope, lote
// 2026-09-30) — 100% puro, sin DB/App/OneSignal, mismo patrón que
// operational-scope.js.
const NOTIFICATION_ROUTING_SOURCES = [
  [NOTIFICATION_ROUTING_JS_PATH, [
    'NOTIFICATION_SHIFT', 'NOTIFICATION_AVAILABILITY',
    'shiftIdToNotificationShift', 'notificationShiftMatches',
    'isUserEligibleForNotification', 'resolveEligibleRecipients',
    'NO_EXECUTION_NOTIFICATION_ROUTE', 'routeNoExecutionEvent',
    'shouldNotifyOutOfPlanCompletion',
    'ANOMALY_NOTIFICATION_ROUTE', 'routeAnomalyEvent',
    'buildNotificationDedupeKey',
  ]],
];

/** Devuelve las funciones/constantes reales de src/core/notification-routing.js. */
export function loadNotificationRoutingLogic() {
  const body = buildBodyFromSources(NOTIFICATION_ROUTING_SOURCES);
  const factory = new Function(body);
  return factory();
}

// Selección de cuadrilla de sesión (corrección arquitectónica 2026-10-02,
// reemplaza la vieja "identidad del dispositivo" — ver
// docs/OPERATIONAL_SCOPE.md §3). getSelectedCrewId()/setSelectedCrewId()/
// getCurrentOperationalScope() leen `localStorage`/`DB`/`App`/`Sync`/
// `window` como globales, igual que en el navegador — el test los stubea
// con vi.stubGlobal() antes de llamar (mismo patrón que loadDbSeedLogic
// con localStorage/navigator/fetch).
const DEVICE_IDENTITY_SOURCES = [
  [DB_JS_PATH, ['nowISO', 'stamp']],
  [SHIFTS_JS_PATH, ['currentShiftId']],
  [OPERATIONAL_SCOPE_JS_PATH, ['ROLES_CREW_SCOPED', 'getAuthorizedCrews', 'resolveCrewLocationCoverage', 'resolveOperationalScope']],
  [APP_JS_PATH, [
    'getSelectedCrewId', 'setSelectedCrewId', 'getCurrentOperationalScope',
    // getCurrentOperationalScope() ahora también alimenta el scope de push
    // de la persona conectada (lote arquitectura de notificaciones, §6/§7)
    // — se incluyen sus dependencias para que la extracción siga
    // ejecutando sin ReferenceError.
    'refreshPushTokenCrewScope', 'currentUserCrewScopeSnapshotForPush',
    // saveOneSignalId()/saveNotificationPreferences() comparten el mismo
    // patrón de prueba (DB/App/window/Sync fakes, ver
    // tests/unit/push-token-scope.test.js).
    'saveOneSignalId', 'saveNotificationPreferences',
    'applyNotificationPreferencesToRows',
  ]],
];

/**
 * Devuelve las funciones REALES de selección de cuadrilla de sesión de
 * app.js, ligadas a un `DB`/`App` de prueba. `localStorage`/`window`/`Sync`
 * deben quedar stubeados globalmente por el test ANTES de invocar la
 * función devuelta (ver tests/unit/device-assignment-isolation.test.js).
 */
export function loadDeviceIdentityLogic(fakeDB, fakeApp) {
  const body = buildBodyFromSources(DEVICE_IDENTITY_SOURCES);
  const factory = new Function('DB', 'App', body);
  return factory(fakeDB, fakeApp);
}

// P0-2 — administración de usuarios. El archivo se guarda como .ts (misma
// convención que notify-push/notify-vencidos) pero su código es JS válido
// a propósito (sin anotaciones de tipo reales) — así se puede extraer y
// probar sin el runtime de Deno, igual que sync.js/auth.js/db.js. El
// `import { serve } ...` de la cabecera nunca se extrae (extractDeclaration
// solo saca las declaraciones nombradas de abajo).
export const MANAGE_USERS_TS_PATH = path.join(SRC_ROOT, 'supabase/functions/manage-users/index.ts');
const MANAGE_USERS_SOURCES = [
  [MANAGE_USERS_TS_PATH, [
    'CORS_HEADERS',
    'VALID_ROLES', 'AUTH_IDENTIFIER_DOMAIN',
    'isValidRoleValue', 'usernameToAuthIdentifier', 'appUserIdFromUsername',
    'isValidTempPassword', 'decideCallerAuthorization', 'wouldLeaveZeroActiveAdmins',
    'svHeaders', 'getCallerProfile', 'countOtherActiveAdmins', 'getProfileByAppUserId',
    'handleListUsers', 'handleCreateUser', 'handleUpdateRole', 'handleSetActive',
    'handleResetPassword', 'dispatchAction',
  ]],
];

/**
 * Devuelve la lógica REAL de supabase/functions/manage-users/index.ts
 * (validaciones puras + las 5 operaciones completas, cada una recibiendo
 * `env` explícito en vez de leer Deno.env). Usa el `fetch` global — el
 * test lo stubea con vi.stubGlobal('fetch', ...), igual que sync.js/auth.js.
 */
export function loadManageUsersLogic() {
  const body = buildBodyFromSources(MANAGE_USERS_SOURCES);
  const factory = new Function(body);
  return factory();
}

// Lote "Mi Perfil" — autoservicio de display_name, acotado a la PROPIA
// fila del caller (nunca requiere ADMINISTRADOR, a diferencia de
// manage-users). Mismo criterio de extracción .ts-pero-JS-puro que
// manage-users — PREPARADA, NO DESPLEGADA (ver cabecera del archivo real).
export const UPDATE_OWN_PROFILE_TS_PATH = path.join(SRC_ROOT, 'supabase/functions/update-own-profile/index.ts');
const UPDATE_OWN_PROFILE_SOURCES = [
  [UPDATE_OWN_PROFILE_TS_PATH, [
    'CORS_HEADERS', 'MAX_DISPLAY_NAME_LENGTH', 'isValidDisplayName', 'svHeaders', 'getCallerProfile',
    'decideCallerAuthorization', 'handleUpdateOwnProfile',
  ]],
];

/**
 * Devuelve la lógica REAL de supabase/functions/update-own-profile/index.ts
 * (validación pura + la operación completa, recibiendo `env` explícito en
 * vez de leer Deno.env). Usa el `fetch` global — el test lo stubea con
 * vi.stubGlobal('fetch', ...), igual que manage-users/sync.js/auth.js.
 */
export function loadUpdateOwnProfileLogic() {
  const body = buildBodyFromSources(UPDATE_OWN_PROFILE_SOURCES);
  const factory = new Function(body);
  return factory();
}

// Lote arquitectura de notificaciones (2026-09-30) — la función PURA de
// elegibilidad de cada Edge Function (isRecipientEligible), que debe
// reflejar la MISMA regla que isUserEligibleForNotification()
// (notification-routing.js). No se extraen getCurrentNotificationShift()/
// claimDedupeKey()/sendPush() (dependen de fetch/Deno.env real) — mismo
// límite ya aceptado para manage-users (solo se prueban las decisiones
// puras, nunca la plumbing HTTP/Deno sin un runtime real).
export const NOTIFY_VENCIDOS_TS_PATH = path.join(SRC_ROOT, 'supabase/functions/notify-vencidos/index.ts');
export const NOTIFY_PUSH_TS_PATH = path.join(SRC_ROOT, 'supabase/functions/notify-push/index.ts');

export function loadNotifyVencidosEligibility() {
  const body = buildBodyFromSources([[NOTIFY_VENCIDOS_TS_PATH, ['isRecipientEligible']]]);
  const factory = new Function(body);
  return factory();
}
export function loadNotifyPushEligibility() {
  const body = buildBodyFromSources([[NOTIFY_PUSH_TS_PATH, ['isRecipientEligible']]]);
  const factory = new Function(body);
  return factory();
}

// P0-2 — PIN rápido offline. Usa `DB` (global, igual que auth.js/sync.js) y
// `nowISO` (de db.js) como globales compartidos; `crypto`/`TextEncoder` son
// globales nativos de Node/navegador, no hace falta inyectarlos.
export const QUICK_UNLOCK_JS_PATH = path.join(SRC_ROOT, 'src/core/quick-unlock.js');
const QUICK_UNLOCK_SOURCES = [
  [DB_JS_PATH, ['nowISO']],
  [QUICK_UNLOCK_JS_PATH, [
    'QUICK_UNLOCK_SALT_BYTES', 'QUICK_UNLOCK_ITERATIONS', 'QUICK_UNLOCK_MAX_ATTEMPTS', 'QUICK_UNLOCK_LOCKOUT_MS',
    'isValidPinFormat', 'isTrivialPin', 'bytesToHex', 'hexToBytes', 'randomSaltHex', 'pbkdf2HashHex', 'QuickUnlock',
  ]],
];

/**
 * Devuelve las funciones/constantes reales de src/core/quick-unlock.js
 * (isValidPinFormat/isTrivialPin/pbkdf2HashHex/QuickUnlock, etc.), ligadas
 * a un `DB` de prueba (QuickUnlock lee `DB`/`crypto`/`nowISO` como
 * globales, igual que en el navegador).
 */
export function loadQuickUnlockLogic(fakeDB) {
  const body = buildBodyFromSources(QUICK_UNLOCK_SOURCES);
  const factory = new Function('DB', body);
  return factory(fakeDB);
}
