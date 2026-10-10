import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadOperationalScopeLogic, loadSyncLogic } from '../helpers/loadLubricationLogic.js';

const { resolveCrewLocationCoverage, resolveOperationalScope, classifyEquipmentWork,
  equiposForLubricadorMatriz, canLubricadorExecuteEquipment, validateCrewLocationCoverage,
  buildExecutionSnapshot, resolveRecordEquipmentLocationId, resolveRecordCrewLocationId } = loadOperationalScopeLogic();
const cuadrillas = [
  { id: '76-08', name: 'Camión Lubrico', locationId: 'volcan', isDefault: true, memberUserIds: ['lub'] },
  { id: 'other', name: 'Otra', locationId: 'acarreo', isDefault: true, memberUserIds: ['other'] },
];
const rows = [
  { id: 'v', crew_id: '76-08', location_id: 'volcan', role: 'PRINCIPAL', active: true },
  { id: 'm', crew_id: '76-08', location_id: 'mojon', role: 'PRINCIPAL', active: true },
  { id: 'a', crew_id: '76-08', location_id: 'acarreo', role: 'APOYO', active: true },
];
const equipos = ['volcan', 'mojon', 'acarreo', 'outside'].map(locationId => ({ id: locationId, locationId }));
const scope = (crewLocations = rows) => resolveOperationalScope({ currentUser: { id: 'lub', role: 'LUBRICADOR' }, cuadrillas, crewLocations, shiftId: 'shift_dia' });
const work = (assignments = [], resolvedScope = scope()) => classifyEquipmentWork({ scope: resolvedScope, equipos, cuadrillas, assignments, equipoOccurrenceKeyFn: e => `${e.id}:today` });

describe('Cobertura multiubicación: fuente única de alcance', () => {
  it('fallback legacy conserva ubicación y recepción por isDefault', () => {
    expect(scope([]).principalLocationIds).toEqual(['volcan']);
    expect(work([], scope([])).normal.map(e => e.id)).toEqual(['volcan']);
  });
  it('varias principales reciben trabajo normal, apoyo no lo recibe', () => {
    expect(scope().principalLocationIds).toEqual(['volcan', 'mojon']);
    expect(scope().supportLocationIds).toEqual(['acarreo']);
    expect(work().normal.map(e => e.id)).toEqual(['volcan', 'mojon']);
  });
  it('una autorización revocada no reaparece por fallback', () => {
    const inactive = rows.map(r => ({ ...r, active: false }));
    expect(resolveCrewLocationCoverage('76-08', cuadrillas, inactive).allAuthorizedLocationIds).toEqual([]);
    expect(work([], scope(inactive)).normal).toEqual([]);
  });
  it('cuadrilla inactiva no conserva autorización por relaciones cacheadas', () => {
    const inactive = cuadrillas.map(c => c.id === '76-08' ? { ...c, active: false } : c);
    expect(resolveCrewLocationCoverage('76-08', inactive, rows).allAuthorizedLocationIds).toEqual([]);
  });
  it('una asignación de cualquier ubicación conserva prioridad y deduplicación', () => {
    const assignments = ['volcan', 'acarreo', 'outside'].map(id => ({ equipmentId: id, occurrenceKey: `${id}:today`, assignedCrewId: '76-08', status: 'PENDING' }));
    expect(work(assignments).normal.map(e => e.id)).toEqual(['mojon']);
    expect(work(assignments).assigned.map(a => a.equipmentId)).toEqual(['volcan', 'acarreo', 'outside']);
    expect(new Set([...work(assignments).normal.map(e => e.id), ...work(assignments).assigned.map(a => a.equipmentId)]).size).toBe(4);
  });
  it('la asignación hacia otra cuadrilla retira el trabajo normal de esa ocurrencia', () => {
    expect(work([{ equipmentId: 'mojon', occurrenceKey: 'mojon:today', assignedCrewId: 'other', status: 'PENDING' }]).normal.map(e => e.id)).toEqual(['volcan']);
  });
  it('matriz cambia de principal sin incluir apoyo ni mover maestros', () => {
    const before = JSON.stringify(equipos);
    expect(equiposForLubricadorMatriz(equipos, scope(), 'mojon').map(e => e.id)).toEqual(['mojon']);
    expect(equiposForLubricadorMatriz(equipos, scope(), 'volcan').map(e => e.id)).toEqual(['volcan']);
    expect(equiposForLubricadorMatriz(equipos, scope(), 'acarreo')).toEqual([]);
    expect(JSON.stringify(equipos)).toBe(before);
  });
  it('apoyo está autorizado; equipo ajeno necesita asignación o advertencia', () => {
    expect(canLubricadorExecuteEquipment({ scope: scope(), equipo: equipos[2], assignments: [] })).toBe(true);
    expect(canLubricadorExecuteEquipment({ scope: scope(), equipo: equipos[3], assignments: [] })).toBe(false);
    expect(canLubricadorExecuteEquipment({ scope: scope(), equipo: equipos[3], assignments: [{ equipmentId: 'outside', assignedCrewId: '76-08', status: 'PENDING' }] })).toBe(true);
  });
  it('rechaza principal duplicada, par repetido y rol inválido', () => {
    expect(() => validateCrewLocationCoverage('76-08', rows, cuadrillas, rows)).not.toThrow();
    expect(() => validateCrewLocationCoverage('other', [{ ...rows[0], crew_id: 'other' }], cuadrillas, rows)).toThrow('PRINCIPAL');
    expect(() => validateCrewLocationCoverage('76-08', [rows[0], rows[0]], cuadrillas, rows)).toThrow('repetida');
    expect(() => validateCrewLocationCoverage('76-08', [{ ...rows[0], role: 'INVALID' }], cuadrillas, rows)).toThrow('válida');
  });
  it.each(['mojon', 'volcan'])('snapshot 76-08 conserva ejecución real en %s y legacy', location => {
    const record = { operationalSnapshot: buildExecutionSnapshot({ equipmentLocationId: location, crewId: '76-08', crewLocationId: 'volcan', performedByUserId: 'lub', shiftId: 'shift_dia', executionType: 'PLANNED' }) };
    expect(record.operationalSnapshot.executionLocationId).toBe(location);
    expect(record.operationalSnapshot.crewLocationIdAtExecution).toBe('volcan');
    expect(resolveRecordEquipmentLocationId(record, { locationId: 'outside' }).value).toBe(location);
  });
  it('histórico sin snapshot no inventa cuadrilla ni ubicación de ejecución', () => {
    expect(resolveRecordCrewLocationId({})).toEqual({ value: null, source: 'legacy_fallback' });
  });
  it('selección local no autoriza una cuadrilla ajena ni cambia memberships', () => {
    const before = JSON.stringify(cuadrillas);
    expect(resolveOperationalScope({ currentUser: { id: 'lub', role: 'LUBRICADOR' }, cuadrillas, crewLocations: rows, selectedCrewId: 'other' }).crewId).toBe('76-08');
    expect(JSON.stringify(cuadrillas)).toBe(before);
  });
});

describe('Transporte real de cobertura: rollout sin tabla REST adicional', () => {
  afterEach(() => vi.unstubAllGlobals());
  function fakeDB() {
    const data = {};
    let config = { url: 'https://coverage.test', anonKey: 'fixture-public-key' };
    return {
      getConfig: async () => config, setConfig: async value => { config = value; },
      all: async store => Object.values(data[store] || {}),
      get: async (store, id) => (data[store] || {})[id] || null,
      put: async (store, value) => { (data[store] ||= {})[value.id] = value; },
      recordConflicts: async () => {},
    };
  }
  it.each([false, true])('pull descarga memberships y cobertura antes de confirmar lastPull (relaciones=%s)', async withCoverage => {
    const db = fakeDB();
    const incoming = [{ store: 'cuadrillas', id: cuadrillas[0].id, payload: cuadrillas[0] }, ...(withCoverage ? rows.map(row => ({ store: 'crew_locations', id: row.id, payload: row })) : [])]
      .map(row => ({ ...row, payload: { ...row.payload, updatedAt: '2026-10-10T10:00:00.000Z' }, updated_at: '2026-10-10T10:00:00.000Z', deleted: false }));
    const requests = [];
    vi.stubGlobal('fetch', vi.fn(async url => { requests.push(url); return { status: 200, ok: true, json: async () => incoming }; }));
    const { Sync } = loadSyncLogic(db, ['cuadrillas', 'crew_locations']);
    expect((await Sync.pullAll()).ok).toBe(true);
    expect((await db.getConfig()).lastPull).toBeTruthy();
    const scope = resolveOperationalScope({ currentUser: { id: 'lub', role: 'LUBRICADOR' }, cuadrillas: await db.all('cuadrillas'), crewLocations: await db.all('crew_locations') });
    expect(scope.principalLocationIds).toEqual(withCoverage ? ['volcan', 'mojon'] : ['volcan']);
    expect(requests.every(url => url.includes('/rest/v1/engrase_sync?'))).toBe(true);
  });
  it('servidor anterior rechaza cobertura con 403 pero conserva dirty y sube otros stores', async () => {
    const db = fakeDB();
    const version = '2026-10-10T10:00:00.000Z';
    await db.put('crew_locations', { ...rows[0], updatedAt: version });
    await db.put('equipment', { id: 'eq', locationId: 'mojon', updatedAt: version });
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      const body = JSON.parse(options.body);
      if (body[0].store === 'crew_locations') return { status: 403, ok: false, json: async () => ({ message: 'fixture forbidden' }) };
      return { status: 200, ok: true, json: async () => [{ id: 'eq' }] };
    }));
    const { Sync } = loadSyncLogic(db, ['crew_locations', 'equipment']);
    const result = await Sync.pushAll();
    expect(result.pushed).toBe(1);
    expect((await db.get('crew_locations', 'v'))._pushedVersion).toBeUndefined();
    expect((await db.get('equipment', 'eq'))._pushedVersion).toBe(version);
    expect(result.authErrorDetails[0].store).toBe('crew_locations');
  });
});
