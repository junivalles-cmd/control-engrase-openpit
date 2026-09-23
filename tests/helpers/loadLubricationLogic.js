// tests/helpers/loadLubricationLogic.js
//
// Carga, DIRECTAMENTE desde CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB\app.js y
// db.js (la fuente canónica), las funciones puras/casi-puras que gobiernan
// turnos, estado de engrase y validación de horómetro — sin modificar esos
// archivos ni reescribir su lógica a mano. Si el código fuente cambia, estas
// pruebas se ejecutan contra el código nuevo automáticamente.
//
// Las funciones que SÍ dependen de la base de datos real (IndexedDB) o de la
// red (fetch a Supabase) no se cargan aquí — ver docs/AUTOMATED_TESTS.md para
// la lista de lo que queda pendiente de extracción durante la modularización.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource, buildModuleBody } from './extractFromSource.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const APP_JS_PATH = path.resolve(__dirname, '../../CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js');
export const DB_JS_PATH = path.resolve(__dirname, '../../CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/db.js');

const APP_JS_NAMES = [
  'WEEKDAY_NAMES',
  'mostRecentAssignedDate',
  'weekdayStatusFor',
  'statusFor',
  'currentShiftId',
  'dentroDeSuTurno',
  'horaAjustadaAlTurno',
  'validateHourmeterChange',
  'esc',
  'fmt',
  'colorPorCumplimiento',
  'CRITICIDAD_POR_MOTIVO',
];

/**
 * Devuelve las funciones/constantes reales de app.js, ligadas a un objeto
 * `App` de prueba (las funciones originales leen `App.currentUser` /
 * `App.generalSettings` como estado global — aquí se pasa como parámetro).
 */
export function loadAppLogic(fakeApp) {
  const source = readSource(APP_JS_PATH);
  const body = buildModuleBody(source, APP_JS_NAMES);
  const factory = new Function('App', body);
  return factory(fakeApp);
}

const DB_JS_NAMES = ['uid', 'nowISO', 'stamp'];

/** Devuelve uid/nowISO/stamp reales de db.js (no requieren IndexedDB). */
export function loadDbLogic() {
  const source = readSource(DB_JS_PATH);
  const body = buildModuleBody(source, DB_JS_NAMES);
  const factory = new Function(body);
  return factory();
}
