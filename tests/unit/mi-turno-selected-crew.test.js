import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadOperationalScopeLogic, loadDeviceIdentityLogic } from '../helpers/loadLubricationLogic.js';

const { resolveOperationalScope, classifyEquipmentWork } = loadOperationalScopeLogic();
const crews = ['a', 'b', 'c'].map((key, i) => ({ id: `cuad_${key}`, locationId: ['volcan', 'mojon', 'acarreo'][i], active: true, isDefault: true, memberUserIds: ['lub'] }));
const equipos = [
  { id: 'vol', locationId: 'volcan' }, { id: 'moj', locationId: 'mojon' },
  { id: 'acr', locationId: 'acarreo' }, { id: 'unassigned', locationId: 'volcan' },
  { id: 'other-in-volcan', locationId: 'volcan' },
];
const assignments = ['vol', 'moj', 'acr', 'other-in-volcan'].map((id, i) => ({
  id: `asg:${id}`, equipmentId: id, planId: `plan:${id}`, occurrenceKey: `plan:${id}:2026-10-17`,
  assignedCrewId: crews[i === 3 ? 1 : i].id, active: true, status: 'PENDING', _supportOperational: true,
}));
const currentUser = { id: 'lub', role: 'LUBRICADOR' };
// Cobertura REALISTA: una sola cuadrilla PRINCIPAL por ubicación (lo que de
// verdad exige validateCrewLocationCoverage() en producción — 2+ PRINCIPAL
// de la misma ubicación se rechaza al guardar). Una versión anterior daba
// las 3 ubicaciones como PRINCIPAL a las 3 cuadrillas a la vez — un estado
// que la propia app nunca permite guardar — y por eso "ganaba" siempre la
// primera cuadrilla del array, ocultando el bug real de abajo.
const scopeFor = selectedCrewId => resolveOperationalScope({ currentUser, cuadrillas: crews, selectedCrewId, shiftId: 'shift_dia',
  crewLocations: crews.map((c, i) => ({ crew_id: c.id, location_id: ['volcan', 'mojon', 'acarreo'][i], role: 'PRINCIPAL', active: true })) });
// equipoOccurrenceKeyFn real (mismo formato que usa app.js vía
// equipoOccurrenceKey()): sin esto, "asignado ajeno" solo se detecta por
// ubicación/cuadrilla-default — insuficiente para 'other-in-volcan' (vive
// en la ubicación de cuad_a pero su PENDING es de cuad_b).
const keyFor = e => `plan:${e.id}:2026-10-17`;
const workFor = scope => classifyEquipmentWork({ scope, equipos, cuadrillas: crews, assignments, selectedCrewOnly: true, equipoOccurrenceKeyFn: keyFor });
const equipmentIds = work => [...work.normal.map(e => e.id), ...work.assigned.map(a => a.equipmentId)];

afterEach(() => vi.unstubAllGlobals());
describe('Mi Turno: autorizacion multiple no equivale a seleccion operativa', () => {
  it('tres cuadrillas y ubicaciones autorizadas, selecciona solo cuad_a; SÍ admite normal sin asignación (trabajo de siempre, nunca exige asignación manual) pero NO asignados ajenos', () => {
    const scope = scopeFor('cuad_a');
    expect(scope.authorizedCrews).toHaveLength(3);
    expect(scope.allAuthorizedLocationIds).toEqual(['volcan']);
    // 'vol' (asignación propia) + 'unassigned' (sin asignación, pero en la
    // ubicación/cuadrilla-default de cuad_a — trabajo normal real, NUNCA
    // debe exigir una lubrication_assignment para aparecer en Mi Turno).
    expect(equipmentIds(workFor(scope))).toEqual(['unassigned', 'vol']);
  });
  it('Mojon de otra cuadrilla autorizada no aparece aunque tenga support operacional', () => {
    expect(equipmentIds(workFor(scopeFor('cuad_a')))).not.toContain('moj');
  });
  it('Volcan de la cuadrilla elegida aparece', () => {
    expect(equipmentIds(workFor(scopeFor('cuad_a')))).toContain('vol');
  });
  it('other-in-volcan (ubicación/default de cuad_a, pero PENDING asignado a cuad_b) nunca aparece como normal de cuad_a — "asignado ajeno" real', () => {
    expect(equipmentIds(workFor(scopeFor('cuad_a')))).not.toContain('other-in-volcan');
  });
  it('cambiar cuad_a a cuad_b recalcula sin modificar datos', () => {
    expect(equipmentIds(workFor(scopeFor('cuad_a')))).toEqual(['unassigned', 'vol']);
    expect(equipmentIds(workFor(scopeFor('cuad_b')))).toEqual(['moj', 'other-in-volcan']);
    expect(assignments[0].assignedCrewId).toBe('cuad_a');
  });
  it('recreando el runtime conserva crewId y vuelve a derivar locationId desde la cuadrilla vigente', async () => {
    const storage = new Map();
    vi.stubGlobal('localStorage', { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) });
    const db = { allActive: async () => crews, all: async () => [] };
    const app = { currentUser, generalSettings: { shiftDayStart: 6, shiftNightStart: 18 } };
    loadDeviceIdentityLogic(db, app).setSelectedCrewId('lub', 'cuad_a');
    const restarted = loadDeviceIdentityLogic(db, app);
    const scope = await restarted.getCurrentOperationalScope();
    expect(scope.crewId).toBe('cuad_a');
    expect(scope.crewLocationId).toBe('volcan');
    expect(equipmentIds(workFor(scope))).toEqual(['unassigned', 'vol']);
  });
  it('sin seleccion no hay trabajo global', () => {
    const scope = scopeFor('');
    expect(scope.kind).toBe('NEEDS_CREW_SELECTION');
    expect(equipmentIds(workFor(scope))).toEqual([]);
  });
});
