// tests/unit/sync-indexeddb-failure-modes.test.js
//
// Auditoría de sincronización (2026-10-20, §12 "INDEXEDDB FAILURE AUDIT
// PENDIENTE") — confirma que los wrappers de db.js (tx()/DB.getRaw/DB.put/
// DB.delete/DB.allRaw) NUNCA dejan una promesa colgada para siempre cuando
// IndexedDB falla con TransactionInactiveError, AbortError o NotFoundError
// — los 3 casos pedidos explícitamente. No se fuerza IndexedDB real (no
// hace falta, dice el pedido): se simula con un `_db` falso mínimo que
// imita exactamente lo que la spec de IndexedDB hace en cada caso:
//
//   - TransactionInactiveError: `objectStore.get()/.put()/...` LANZA DE
//     FORMA SÍNCRONA cuando la transacción ya terminó (ej. se llamó
//     después de un `await` sin pedido pendiente). Como cada wrapper
//     envuelve la llamada dentro de `new Promise((res,rej) => { ... })`,
//     el motor de promesas atrapa ese throw síncrono automáticamente y
//     rechaza — no se necesita ningún try/catch adicional, pero si algún
//     wrapper llamara a `tx()` FUERA del executor (antes del `new
//     Promise`), el throw escaparía sin convertirse en un reject. Este
//     test prueba el comportamiento real, no supone que esté bien.
//   - AbortError: la request se crea con éxito pero, si la transacción se
//     aborta después, IndexedDB dispara `onerror` (nunca onsuccess) en
//     cualquier request pendiente con ese error — simulado con un
//     `onerror` asíncrono (microtask).
//   - NotFoundError: mismo mecanismo que AbortError (falla asíncrona vía
//     onerror), nombre de error distinto.
//
// Extrae `tx` y el objeto `DB` REALES de db.js (nunca una reimplementación)
// y los liga a un `_db` falso mediante `new Function('_db', 'STORES',
// 'Auth', ...)` — `STORES=[]` y `Auth=undefined` hacen que DB.put() tome
// su rama simple (sin el camino de autorización multi-cuenta, irrelevante
// para esta prueba de bajo nivel).
import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { DB_JS_PATH } from '../helpers/loadLubricationLogic.js';

const dbSource = readSource(DB_JS_PATH);
const txSrc = extractDeclaration(dbSource, 'tx');
const dbObjectSrc = extractDeclaration(dbSource, 'DB');

function loadDbWrappers(fakeIdb) {
  const factory = new Function(
    '_db', 'STORES', 'Auth',
    `${txSrc}\n${dbObjectSrc}\nreturn DB;`
  );
  return factory(fakeIdb, [], undefined);
}

function idbError(name) {
  const err = new Error(name);
  err.name = name;
  return err;
}

// TransactionInactiveError: el motor nativo lanza SÍNCRONAMENTE al pedir
// get/put/delete/getAll sobre una transacción ya inactiva.
function fakeDbThrowsSync(errorName) {
  const throwing = () => { throw idbError(errorName); };
  return { transaction: () => ({ objectStore: () => ({ get: throwing, put: throwing, delete: throwing, getAll: throwing }) }) };
}

// AbortError/NotFoundError: la request se crea bien: onerror dispara
// asíncrono (microtask), como la notificación real de IndexedDB.
function fakeDbFiresOnerrorAsync(errorName) {
  function fakeRequest() {
    const req = {};
    queueMicrotask(() => { if (req.onerror) req.onerror({ target: { error: idbError(errorName) } }); });
    return req;
  }
  return { transaction: () => ({ objectStore: () => ({ get: fakeRequest, put: fakeRequest, delete: fakeRequest, getAll: fakeRequest }) }) };
}

describe('wrappers de IndexedDB (db.js) — nunca dejan fullSync()/una lectura/escritura colgada para siempre', () => {
  it('TransactionInactiveError (throw síncrono): getRaw/put/delete/allRaw rechazan, nunca quedan pendientes', async () => {
    const DB = loadDbWrappers(fakeDbThrowsSync('TransactionInactiveError'));
    await expect(DB.getRaw('equipment', 'e1')).rejects.toMatchObject({ name: 'TransactionInactiveError' });
    await expect(DB.put('equipment', { id: 'e1' })).rejects.toMatchObject({ name: 'TransactionInactiveError' });
    await expect(DB.delete('equipment', 'e1')).rejects.toMatchObject({ name: 'TransactionInactiveError' });
    await expect(DB.allRaw('equipment')).rejects.toMatchObject({ name: 'TransactionInactiveError' });
  });

  it('AbortError (falla asíncrona de la transacción): getRaw/put/delete/allRaw rechazan, nunca quedan pendientes', async () => {
    const DB = loadDbWrappers(fakeDbFiresOnerrorAsync('AbortError'));
    await expect(DB.getRaw('equipment', 'e1')).rejects.toMatchObject({ name: 'AbortError' });
    await expect(DB.put('equipment', { id: 'e1' })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(DB.delete('equipment', 'e1')).rejects.toMatchObject({ name: 'AbortError' });
    await expect(DB.allRaw('equipment')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('NotFoundError (ej. object store inexistente tras una migración a medias): getRaw/put/delete/allRaw rechazan, nunca quedan pendientes', async () => {
    const DB = loadDbWrappers(fakeDbFiresOnerrorAsync('NotFoundError'));
    await expect(DB.getRaw('equipment', 'e1')).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(DB.put('equipment', { id: 'e1' })).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(DB.delete('equipment', 'e1')).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(DB.allRaw('equipment')).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});
