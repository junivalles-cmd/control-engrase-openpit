import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractDeclaration, readSource } from '../helpers/extractFromSource.js';
import { loadSyncLogic } from '../helpers/loadLubricationLogic.js';

const dbSource = readSource('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/db.js');
const appSource = readSource('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js');
afterEach(() => vi.unstubAllGlobals());

function loadCatalogQueue(DB, App) {
  return new Function('DB', 'App', 'uid', 'nowISO', 'stamp',
    `${extractDeclaration(dbSource, 'queueCatalogOperationIntent')}; return queueCatalogOperationIntent;`)(
    DB, App, () => 'op-1', () => '2026-10-12T12:00:00.000Z', row => { row.updatedAt = '2026-10-12T12:00:00.000Z'; return row; });
}

describe('operational catalog gateway client queue', () => {
  it.each([
    ['MOVE', 'ADMINISTRADOR', 'equipment', 'move_equipment_master_location'],
    ['SHIFT', 'PLANIFICADOR', 'equipment', 'set_equipment_shift'],
    ['PAUSE', 'SUPERVISOR', 'equipment', 'set_equipment_alert_pause'],
    ['HOURMETER', 'PLANIFICADOR', 'equipment', 'update_equipment_hourmeter'],
    ['REPROGRAM', 'SUPERVISOR', 'lubrication_plans', 'reprogram_lubrication_plan'],
  ])('%s queues one typed operation for %s', async (action, role, targetStore, rpc) => {
    const DB = { putEvidenceOperation: vi.fn(async (operation, changes) => ({ operation, changes })) };
    const queue = loadCatalogQueue(DB, { currentUser: { id: 'u1', name: 'Test', role } });
    const before = { id: 'x1', updatedAt: 'v1', _pushedVersion: 'v1', equipmentId: 'e1', locationId: 'loc1',
      shiftId: 'shift_dia', hourmeter: 100 };
    const values = action === 'MOVE' ? { locationId: 'loc2' }
      : action === 'SHIFT' ? { shiftId: 'shift_noche' }
        : action === 'PAUSE' ? { crewId: 'c1', until: '2026-10-15', reason: 'Taller' }
          : action === 'HOURMETER' ? { hourmeter: 120 }
            : { crewId: 'c1', until: '2026-10-15', reason: 'Acceso' };

    await queue(action, before, values);

    const [operation, changes] = DB.putEvidenceOperation.mock.calls[0];
    expect(operation).toMatchObject({ id: 'op-1', actorId: 'u1', rpc, kind: 'CATALOG', targetStore, status: 'PENDING' });
    expect(operation.params).not.toHaveProperty('payload');
    expect(operation.params).not.toHaveProperty('store');
    expect(changes[0]).toMatchObject({ store: targetStore, expected: 'v1', row: { id: 'x1' } });
  });

  it.each([
    ['MOVE', 'SUPERVISOR'], ['SHIFT', 'SUPERVISOR'], ['HOURMETER', 'SUPERVISOR'],
    ['PAUSE', 'LUBRICADOR'], ['REPROGRAM', 'LUBRICADOR'],
  ])('denies %s locally for %s', async (action, role) => {
    const DB = { putEvidenceOperation: vi.fn() };
    const queue = loadCatalogQueue(DB, { currentUser: { id: 'u1', name: 'Test', role } });
    await expect(queue(action, { id: 'x1', updatedAt: 'v1', _pushedVersion: 'v1' }, {})).rejects.toThrow('ROLE_DENIED');
    expect(DB.putEvidenceOperation).not.toHaveBeenCalled();
  });

  it('requires a synced baseline and rejects decreasing or empty hourmeters', async () => {
    const DB = { putEvidenceOperation: vi.fn() };
    const queue = loadCatalogQueue(DB, { currentUser: { id: 'u1', name: 'Test', role: 'PLANIFICADOR' } });
    await expect(queue('MOVE', { id: 'e1', updatedAt: 'local', _pushedVersion: 'v1' }, { locationId: 'loc2' }))
      .rejects.toThrow('CATALOG_SYNC_REQUIRED');
    const before = { id: 'e1', updatedAt: 'v1', _pushedVersion: 'v1', hourmeter: 100 };
    await expect(queue('HOURMETER', before, { hourmeter: 99 })).rejects.toThrow('INVALID_HOURMETER');
    await expect(queue('HOURMETER', before, { hourmeter: Number.NaN })).rejects.toThrow('INVALID_HOURMETER');
    expect(DB.putEvidenceOperation).not.toHaveBeenCalled();
  });

  it('opening Help uses local fallback without settings INSERT', async () => {
    const DB = { get: vi.fn(async () => null), put: vi.fn() };
    const getHelpContent = new Function('DB', 'EQUIPMENT_FAMILIES', 'DEFAULT_FAQ', 'normalizePoint',
      `${extractDeclaration(appSource, 'getHelpContent')}; return getHelpContent;`)(
      DB, [{ id: 'f1', zones: [{ points: ['A'] }] }], [{ question: 'Q' }], point => ({ text: point }));
    const help = await getHelpContent();
    expect(help.id).toBe('help_content');
    expect(help.families[0].zones[0].points).toEqual([{ text: 'A' }]);
    expect(DB.put).not.toHaveBeenCalled();
  });

  it('dispatches queued catalog changes only through the typed authenticated RPC', async () => {
    const operation = { id: 'op-1', actorId: 'u1', rpc: 'move_equipment_master_location', kind: 'CATALOG',
      targetStore: 'equipment', status: 'PENDING', params: { p_operation_id: 'op-1', p_id: 'e1', p_expected: 'v1', p_location_id: 'loc2' } };
    const DB = { getEvidenceOperations: vi.fn(async () => [operation]), updateEvidenceOperation: vi.fn(async next => Object.assign(operation, next)),
      finishEvidenceOperation: vi.fn() };
    const Auth = { isSupabaseMode: () => true, isAuthenticated: () => true,
      getSession: () => ({ accessToken: 'user-jwt' }), getProfile: () => ({ appUserId: 'u1', role: 'PLANIFICADOR' }), getSessionEpoch: () => 1 };
    const { Sync } = loadSyncLogic(DB, ['equipment'], Auth);
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, ok: true, json: async () => ({ status: 'APPLIED', rows: [
      { store: 'equipment', id: 'e1', payload: { id: 'e1', locationId: 'loc2' }, updated_at: '2026-10-12T12:00:00Z' },
    ] }) })));
    const result = await Sync.pushEvidenceOperations({ url: 'https://fixture.test', anonKey: 'anon-fixture', _authEpoch: 1 });
    expect(result.pushed).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain('/rpc/move_equipment_master_location');
    expect(fetch.mock.calls[0][1].method).toBe('POST');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer user-jwt');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('payload');
    expect(DB.finishEvidenceOperation).toHaveBeenCalledWith(operation, expect.any(Array));
  });
});
