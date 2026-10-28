import { describe, expect, it } from 'vitest';
import { extractDeclaration, readSource } from '../helpers/extractFromSource.js';
import { loadSyncLogic } from '../helpers/loadLubricationLogic.js';

const dbSource = readSource('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/db.js');

function keyFor(store, row) {
  return store === 'app_config' ? row.key : row.id;
}

function makeIndexedDb(seed) {
  const data = new Map(Object.entries(seed).map(([store, rows]) => [
    store,
    new Map(rows.map(row => [keyFor(store, row), structuredClone(row)])),
  ]));
  const table = store => data.get(store) || new Map();

  return {
    snapshot(store, id) { return structuredClone(table(store).get(id) || null); },
    transaction(stores) {
      const transaction = { error: null, oncomplete: null, onabort: null };
      transaction.objectStore = store => ({
        put(row) { table(store).set(keyFor(store, row), structuredClone(row)); },
        delete(id) { table(store).delete(id); },
        get(id) {
          let success;
          const request = { result: structuredClone(table(store).get(id) || null) };
          Object.defineProperty(request, 'onsuccess', {
            set(handler) { success = handler; queueMicrotask(() => success?.()); },
          });
          return request;
        },
      });
      setTimeout(() => transaction.oncomplete?.(), 0);
      return transaction;
    },
  };
}

function loadBlockEvidenceOperation(indexedDb) {
  return new Function('_db', `${extractDeclaration(dbSource, 'DB')}; return DB.blockEvidenceOperation;`)(indexedDb);
}

function loadCatalogQueue(DB) {
  return new Function('DB', 'App', 'uid', 'nowISO', 'stamp',
    `${extractDeclaration(dbSource, 'queueCatalogOperationIntent')}; return queueCatalogOperationIntent;`)(
    DB, { currentUser: { id: 'u1', name: 'Test', role: 'PLANIFICADOR' } },
    () => 'catalog-queue', () => '2026-10-25T12:00:00.000Z', row => {
      row.updatedAt = '2026-10-25T12:00:00.000Z'; return row;
    });
}

function catalogOperation(overrides = {}) {
  const originalRow = { id: 'eq-1', code: 'EX-01', locationId: 'yard', hourmeter: 100, updatedAt: 'v1', _pushedVersion: 'v1' };
  const localRow = { ...originalRow, locationId: 'pit', hourmeter: 125, updatedAt: 'local-v2', _evidenceOperationId: 'catalog-1' };
  return {
    id: 'catalog-1', kind: 'CATALOG', targetStore: 'equipment', status: 'BLOCKED',
    createdAt: '2026-10-25T12:00:00.000Z', localRow, originalRow,
    ...overrides,
  };
}

describe('CATALOG BLOCKED rollback', () => {
  it('restores exactly originalRow for a blocked equipment MOVE', async () => {
    const operation = catalogOperation();
    const indexedDb = makeIndexedDb({
      app_config: [],
      equipment: [operation.localRow],
      lubrication_plans: [],
    });

    await loadBlockEvidenceOperation(indexedDb)(operation);

    expect(indexedDb.snapshot('equipment', 'eq-1')).toEqual(operation.originalRow);
    expect(indexedDb.snapshot('app_config', 'evidence:catalog-1').value).toMatchObject({ status: 'BLOCKED' });
  });

  it('keeps the projected row when a historical blocked CATALOG has no originalRow', async () => {
    const operation = catalogOperation({ originalRow: null });
    const indexedDb = makeIndexedDb({
      app_config: [],
      equipment: [operation.localRow],
      lubrication_plans: [],
    });

    await loadBlockEvidenceOperation(indexedDb)(operation);

    expect(indexedDb.snapshot('equipment', 'eq-1')).toEqual(operation.localRow);
    expect(indexedDb.snapshot('app_config', 'evidence:catalog-1').value).toMatchObject({ status: 'BLOCKED' });
  });

  it.each([
    ['equipment MOVE', 'MOVE', { locationId: 'pit' }],
    ['equipment HOURMETER', 'HOURMETER', { hourmeter: 125 }],
    ['equipment SHIFT', 'SHIFT', { shiftId: 'shift_noche' }],
    ['equipment PAUSE', 'PAUSE', { crewId: 'crew-1', until: '2026-10-30', reason: 'Taller' }],
    ['lubrication_plan REPROGRAM', 'REPROGRAM', { crewId: 'crew-1', until: '2026-10-30', reason: 'Acceso' }],
  ])('restores the captured baseline when %s is blocked', async (_label, action, values) => {
    const before = { id: action === 'REPROGRAM' ? 'plan-1' : 'eq-1', code: 'EX-01', locationId: 'yard',
      shiftId: 'shift_dia', hourmeter: 100, updatedAt: 'v1', _pushedVersion: 'v1' };
    let operation;
    const queue = loadCatalogQueue({ putEvidenceOperation: async op => { operation = op; } });
    await queue(action, before, values);
    operation.status = 'BLOCKED';
    const projectedRow = { ...operation.localRow, _evidenceOperationId: operation.id };
    const indexedDb = makeIndexedDb({
      app_config: [], equipment: operation.targetStore === 'equipment' ? [projectedRow] : [],
      lubrication_plans: operation.targetStore === 'lubrication_plans' ? [projectedRow] : [],
    });

    await loadBlockEvidenceOperation(indexedDb)(operation);

    expect(indexedDb.snapshot(operation.targetStore, before.id)).toEqual(before);
  });

  it('counts either restored or preserved CATALOG BLOCKED work exactly once', async () => {
    const restored = catalogOperation();
    const preserved = catalogOperation({ id: 'catalog-2', originalRow: null,
      localRow: { ...catalogOperation().localRow, id: 'eq-2', _evidenceOperationId: 'catalog-2' } });
    const DB = {
      async getConfig() { return { url: 'https://fixture.test', anonKey: 'anon' }; },
      async all(store) { return store === 'equipment' ? [restored.originalRow, preserved.localRow] : []; },
      async getEvidenceOperations() { return [restored, preserved]; },
    };
    const { Sync } = loadSyncLogic(DB, ['equipment'], { getSessionEpoch: () => 1 });

    expect(await Sync.pendingCount()).toBe(2);
  });
});
