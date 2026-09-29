// tests/unit/no-manual-sync-gate.test.js
//
// Bloque B (pre-cutover, ver docs/SESSION_HANDOFF.md) — auditoría confirmó
// que esta versión del código NUNCA tuvo una pantalla manual de "Descargar
// datos"/"Actualizar datos"/"Continuar" bloqueando el login (boot() ya
// llamaba Sync.fullSync() de forma incondicional y silenciosa). Prueba a
// nivel de fuente (mismo criterio que otros regresiones de este tipo en el
// repo, ej. showEquipmentQrInfo()): si alguna vez se reintroduce un gate
// manual de sincronización, este test lo detecta sin necesitar ejecutar la
// app completa.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const bootSrc = extractDeclaration(appSource, 'boot');

describe('A/B) login/PIN -> nunca una pantalla manual de "Descargar datos" bloqueando la entrada', () => {
  it('boot() dispara la sincronización (Sync.runAutoCycle()) de forma incondicional, sin esperar ningún click/confirmación previa', () => {
    const iSync = bootSrc.indexOf('Sync.runAutoCycle()');
    expect(iSync).toBeGreaterThan(-1);
    // No debe haber ningún condicional/confirm/modal ENTRE el inicio de
    // boot() y la llamada de sync — se dispara como la primera acción real.
    const before = bootSrc.slice(0, iSync);
    expect(before).not.toMatch(/confirm\(|openModal\(|await\s/);
  });

  it('no existe ningún texto de UI tipo "Descargar datos"/"Actualizar datos" gateando el arranque', () => {
    expect(appSource).not.toMatch(/Descargar datos/i);
    expect(appSource).not.toMatch(/Actualizar datos/i);
  });
});
