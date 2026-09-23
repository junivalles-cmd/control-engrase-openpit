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
