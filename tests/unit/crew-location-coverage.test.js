import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadOperationalScopeLogic, loadSyncLogic, loadDbLogic } from '../helpers/loadLubricationLogic.js';

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

// Synthetic IDs: these fixtures do not claim to be the user's IndexedDB cache.
describe('C1: trabajo automático limitado a cobertura por IDs ficticios', () => {
  const crew = { id: 'C1', name: 'Cuadrilla ficticia C1', locationId: 'fixture-troja', isDefault: true, memberUserIds: ['lub'] };
  const equipment = [
    { id: 'E1', code: 'E1', locationId: 'fixture-volcan' },
    { id: 'E2', code: 'E2', locationId: 'fixture-mojon' },
    { id: 'E3', code: 'E3', locationId: 'fixture-troja' },
  ];
  const assignments = equipment.map(e => ({ id: `assignment:${e.id}`, equipmentId: e.id, occurrenceKey: `${e.id}:today`, assignedCrewId: crew.id, status: 'PENDING', active: true }));
  const coverage = [
    { crew_id: crew.id, location_id: 'fixture-troja', role: 'PRINCIPAL' },
    { crew_id: crew.id, location_id: 'fixture-volcan', role: 'PRINCIPAL' },
    { crew_id: crew.id, location_id: 'fixture-mojon', role: 'APOYO' },
  ];
  const classify = (relations, assigned) => classifyEquipmentWork({
    scope: resolveOperationalScope({ currentUser: { id: 'lub', role: 'LUBRICADOR' }, cuadrillas: [crew], crewLocations: relations }),
    equipos: equipment, cuadrillas: [crew], assignments: assigned, equipoOccurrenceKeyFn: e => `${e.id}:today`,
  });
  it.each([{ relations: [] }, { relations: [coverage[0]] }])('Troja única: no muestra assignments de Volcán/Mojón ni los modifica (coverage=$relations)', ({ relations }) => {
    const before = JSON.stringify({ assignments, equipment });
    const result = classify(relations, assignments);
    expect(result.normal).toEqual([]);
    expect(result.assigned.map(a => a.equipmentId)).toEqual(['E3']);
    expect(JSON.stringify({ assignments, equipment })).toBe(before);
  });
  it('dos PRINCIPALES muestran programación; APOYO solo aparece con assignment explícito', () => {
    expect(classify(coverage, []).normal.map(e => e.code)).toEqual(['E1', 'E3']);
    const result = classify(coverage, [assignments[1]]);
    expect(result.normal.map(e => e.code)).toEqual(['E1', 'E3']);
    expect(result.assigned.map(a => a.equipmentId)).toEqual(['E2']);
  });
  it('assignment sin equipo maestro no puede ampliar el scope', () => {
    expect(classify(coverage, [{ ...assignments[0], equipmentId: 'missing' }]).assigned).toEqual([]);
  });
});

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
  it('rollout gradual conserva fallback para crew sin filas aunque otra ya tenga cobertura', () => {
    const otherRows = [{ id: 'other-a', crew_id: 'other', location_id: 'acarreo', role: 'PRINCIPAL', active: true }];
    expect(scope(otherRows).principalLocationIds).toEqual(['volcan']);
    expect(work([], scope(otherRows)).normal.map(e => e.id)).toEqual(['volcan']);
    expect(resolveCrewLocationCoverage('76-08', cuadrillas, otherRows).legacyFallback).toBe(true);
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
  it('una asignación autorizada conserva prioridad y deduplicación; externa no entra', () => {
    const assignments = ['volcan', 'acarreo', 'outside'].map(id => ({ equipmentId: id, occurrenceKey: `${id}:today`, assignedCrewId: '76-08', status: 'PENDING' }));
    expect(work(assignments).normal.map(e => e.id)).toEqual(['mojon']);
    expect(work(assignments).assigned.map(a => a.equipmentId)).toEqual(['volcan', 'acarreo']);
    expect(new Set([...work(assignments).normal.map(e => e.id), ...work(assignments).assigned.map(a => a.equipmentId)]).size).toBe(3);
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
    expect(canLubricadorExecuteEquipment({ scope: scope(), equipo: equipos[3], assignments: [{ equipmentId: 'outside', assignedCrewId: '76-08', status: 'PENDING' }] })).toBe(false);
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

// Caso #8 pedido explícitamente: authorizedLocationIds del USUARIO
// (context de autorización de db.js — decide qué fila sincroniza/cachea
// este dispositivo) NUNCA sustituye a crewAllowedLocationIds (cobertura
// de la CUADRILLA — crew_locations, decide qué ve Mi Turno). Son dos
// capas independientes: aquí se arma un caso donde DIVERGEN a propósito
// y se confirma que cada una respeta SU PROPIO alcance, sin que una
// contamine a la otra.
describe('authorizedLocationIds del usuario (db.js) nunca sustituye a crewAllowedLocationIds (operational-scope.js)', () => {
  const { localAuthorizationState } = loadDbLogic();
  // Cuenta real de campo: el dispositivo YA sincronizó equipos de 'mojon'
  // (p. ej. porque este usuario también es SUPERVISOR en otra pantalla, o
  // por una cobertura histórica de sync) — context.authorizedLocationIds
  // incluye 'mojon'. Pero la cuadrilla 76-08 (operativa, Mi Turno) SOLO
  // tiene 'volcan' como PRINCIPAL (sin fila de 'mojon' en crew_locations).
  const userContext = {
    appUserId: 'lub', active: true, scopeType: 'CREW_SCOPED',
    authorizedCrewIds: ['76-08'], authorizedLocationIds: ['volcan', 'mojon'],
  };
  const crewOnlyVolcan = [{ id: 'v', crew_id: '76-08', location_id: 'volcan', role: 'PRINCIPAL', active: true }];

  it('el contexto de sync (usuario) SÍ autoriza el equipo de mojon a llegar al dispositivo', () => {
    expect(localAuthorizationState('equipment', { id: 'eq-mojon', locationId: 'mojon', __authorizationAppUserId: 'lub' }, userContext, 'lub')).toBe('AUTHORIZED');
  });
  it('pero Mi Turno (cuadrilla) NO lo admite como trabajo normal — la cuadrilla no tiene mojon, el contexto del usuario no cuenta aquí', () => {
    const scopeCrewOnly = resolveOperationalScope({ currentUser: { id: 'lub', role: 'LUBRICADOR' }, cuadrillas, crewLocations: crewOnlyVolcan, shiftId: 'shift_dia' });
    expect(scopeCrewOnly.allAuthorizedLocationIds).toEqual(['volcan']);
    expect(scopeCrewOnly.allAuthorizedLocationIds).not.toContain('mojon'); // a pesar de que el usuario SÍ sincroniza mojon
    const equipoMojon = { id: 'eq-mojon', locationId: 'mojon' };
    const result = classifyEquipmentWork({ scope: scopeCrewOnly, equipos: [equipoMojon], cuadrillas, assignments: [], equipoOccurrenceKeyFn: e => `${e.id}:today` });
    expect(result.normal).toEqual([]);
    expect(result.assigned).toEqual([]);
  });
  it('simétrico: la cuadrilla SÍ tiene volcan+mojon pero el contexto de sync del usuario solo trae volcan — equipment de mojon ni siquiera llega al dispositivo', () => {
    const narrowContext = { ...userContext, authorizedLocationIds: ['volcan'] };
    expect(localAuthorizationState('equipment', { id: 'eq-mojon', locationId: 'mojon', __authorizationAppUserId: 'lub' }, narrowContext, 'lub')).toBe('OUT_OF_SCOPE');
    // classifyEquipmentWork() nunca ve esa fila: no está en su IndexedDB
    // local — la cuadrilla (rows multiubicación reales) sí la admitiría si
    // existiera, confirmando que cada capa decide SOLO su propio alcance.
    const scopeCrewBoth = resolveOperationalScope({ currentUser: { id: 'lub', role: 'LUBRICADOR' }, cuadrillas, crewLocations: rows, shiftId: 'shift_dia' });
    expect(scopeCrewBoth.allAuthorizedLocationIds).toContain('mojon');
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
    // El cursor confirmado es account-scoped (cuenta + fingerprint), no cfg.lastPull.
    const cfg = await db.getConfig();
    expect(cfg.activeAccountSyncKey).toBe('fixture-auth:fixture-fp');
    expect(cfg.accountSyncStates['fixture-auth:fixture-fp'].bootstrapComplete).toBe(true);
    expect(cfg.accountSyncStates['fixture-auth:fixture-fp'].lastPull).toBeTruthy();
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

// ============================================================
// Pedido "simplificar la asignación operativa" — TRABAJO NORMAL por
// equipment.locationId + crew_locations (PRINCIPAL), SIN exigir
// lubrication_assignment manual por equipo. Las 6 pruebas específicas
// pedidas explícitamente (la de doble turno ya vive en
// tests/unit/double-shift-lifecycle.test.js / excavator-dual-shift-*,
// sigue PASS sin cambios — esta sesión no tocó esa lógica).
// ============================================================
describe('NORMAL_WORK_BY_LOCATION — trabajo normal por ubicación, sin assignment manual requerido', () => {
  it('equipo en ubicación con una sola cuadrilla PRINCIPAL aparece UNA vez, sin assignment', () => {
    // 'volcan' (equipos[0]): PRINCIPAL única es 76-08, sin ninguna
    // lubrication_assignment — classifyEquipmentWork() lo resuelve solo
    // con equipment.locationId + crew_locations.
    const result = work([], scope());
    const equipmentIds = [...result.normal.map(e => e.id), ...result.assigned.map(a => a.equipmentId)];
    expect(equipmentIds.filter(id => id === 'volcan')).toHaveLength(1);
    expect(result.normal.map(e => e.id)).toContain('volcan');
  });
  it('equipo en ubicación con PRINCIPAL (otra cuadrilla, legacy) + APOYO (76-08) no se duplica entre cuadrillas', () => {
    // 'acarreo': APOYO explícito de 76-08 (rows[2]) + PRINCIPAL real de
    // 'other' (fallback legacy, su propio locationId). APOYO nunca genera
    // trabajo normal automático — solo el PRINCIPAL lo recibe.
    const scope76 = scope();
    const scopeOther = resolveOperationalScope({ currentUser: { id: 'other', role: 'LUBRICADOR' }, cuadrillas, crewLocations: rows, shiftId: 'shift_dia' });
    const equiposIncluyendoAcarreo = equipos; // ya incluye 'acarreo'
    const workOther = classifyEquipmentWork({ scope: scopeOther, equipos: equiposIncluyendoAcarreo, cuadrillas, assignments: [], equipoOccurrenceKeyFn: e => `${e.id}:today` });
    const workCrew76 = classifyEquipmentWork({ scope: scope76, equipos: equiposIncluyendoAcarreo, cuadrillas, assignments: [], equipoOccurrenceKeyFn: e => `${e.id}:today` });
    const idsFor = r => [...r.normal.map(e => e.id), ...r.assigned.map(a => a.equipmentId)];
    expect(idsFor(workOther)).toContain('acarreo'); // PRINCIPAL (legacy) sí lo recibe
    expect(idsFor(workCrew76)).not.toContain('acarreo'); // APOYO no lo recibe sin assignment explícito
    // Entre AMBAS cuadrillas, 'acarreo' aparece una sola vez en total.
    expect([...idsFor(workOther), ...idsFor(workCrew76)].filter(id => id === 'acarreo')).toHaveLength(1);
  });
  it('equipo SIN lubrication_assignment manual sigue apareciendo normalmente (nunca lo requiere)', () => {
    expect(work([]).normal.map(e => e.id)).toEqual(['volcan', 'mojon']);
  });
  it('un assignment excepcional permite atender una ubicación FUERA de la cobertura normal de la cuadrilla', () => {
    // 'outside' no es PRINCIPAL ni APOYO de 76-08 — sin assignment, nunca
    // aparece (ni normal ni asignado). Con un assignment excepcional
    // (apoyo extraordinario/reemplazo temporal/emergencia,
    // _supportOperational:true, mismo mecanismo ya validado en 0014), sí.
    const sinAssignment = work([]);
    expect([...sinAssignment.normal.map(e => e.id), ...sinAssignment.assigned.map(a => a.equipmentId)]).not.toContain('outside');
    const assignmentExcepcional = [{ equipmentId: 'outside', occurrenceKey: 'outside:today', assignedCrewId: '76-08', status: 'PENDING', active: true, _supportOperational: true }];
    const conAssignment = work(assignmentExcepcional);
    expect(conAssignment.assigned.map(a => a.equipmentId)).toContain('outside');
    expect(conAssignment.normal.map(e => e.id)).not.toContain('outside'); // sigue sin ser trabajo "normal", es la excepción
  });
  it('cambiar equipment.locationId cambia la cobertura de inmediato (sin estado cacheado) — mismo efecto que tras un sync', () => {
    // classifyEquipmentWork() es pura: lee equipment.locationId en cada
    // llamada, nunca memoriza la ubicación anterior — el "después de sync"
    // real es, para esta función, la siguiente vez que se llama con el
    // equipment ya actualizado en IndexedDB (ningún caché que invalidar).
    const equipoMovido = { id: 'movido', locationId: 'volcan' };
    const antes = classifyEquipmentWork({ scope: scope(), equipos: [equipoMovido], cuadrillas, assignments: [], equipoOccurrenceKeyFn: e => `${e.id}:today` });
    expect(antes.normal.map(e => e.id)).toEqual(['movido']); // volcan es PRINCIPAL de 76-08
    const equipoTrasMoverlo = { ...equipoMovido, locationId: 'acarreo' }; // acarreo: PRINCIPAL es 'other', no 76-08
    const despues = classifyEquipmentWork({ scope: scope(), equipos: [equipoTrasMoverlo], cuadrillas, assignments: [], equipoOccurrenceKeyFn: e => `${e.id}:today` });
    expect(despues.normal.map(e => e.id)).toEqual([]);
  });
});
