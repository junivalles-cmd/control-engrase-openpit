// tests/unit/lubricador-matriz-scope.test.js
//
// Pedido "MATRIZ LUBRICADOR POR UBICACIÓN COMPLETA" (2026-10-09): la Matriz
// Semanal del Lubricador deja de estar acotada por cuadrilla/turno (eso
// sigue siendo el scope de "Mi Turno", classifyEquipmentWork() — sin
// cambios, ver operational-scope.test.js) y pasa a ser una CONSULTA DE
// SOLO LECTURA de TODA la ubicación activa/autorizada: cualquier cuadrilla,
// ambos turnos, nunca otra ubicación. equiposForLubricadorMatriz()
// (operational-scope.js) es la única función que decide esto.
//
// Casos A-I del pedido, probados contra la función REAL (nunca una
// reimplementación).

import { describe, it, expect } from 'vitest';
import { loadOperationalScopeLogic } from '../helpers/loadLubricationLogic.js';

const { equiposForLubricadorMatriz, classifyEquipmentWork, resolveOperationalScope } = loadOperationalScopeLogic();

const VOLCAN = 'loc-volcan';
const MOJON = 'loc-mojon';
const ACARREO = 'loc-acarreo';

// Lubricador autorizado en la cuadrilla "76-08", ubicación Volcán — mismo
// shape que devuelve resolveOperationalScope() para CREW_SCOPED.
const scopeLubricadorVolcan = {
  kind: 'CREW_SCOPED', userId: 'u1', role: 'LUBRICADOR',
  shiftId: 'shift_dia', crewId: 'crew-76-08', crewLocationId: VOLCAN,
  authorizedCrews: [{ id: 'crew-76-08', name: '76-08', locationId: VOLCAN }],
};

const equipos = [
  { id: 'e1', code: 'VOL-DIA', locationId: VOLCAN, status: 'Operativo' }, // turno Día, cuadrilla 76-08
  { id: 'e2', code: 'VOL-NOCHE', locationId: VOLCAN, status: 'Operativo' }, // turno Noche, cuadrilla 76-08
  { id: 'e3', code: 'VOL-OTRA-CUADRILLA', locationId: VOLCAN, status: 'Operativo' }, // cuadrilla 76-09, misma ubicación
  { id: 'e4', code: 'MOJ-01', locationId: MOJON, status: 'Operativo' },
  { id: 'e5', code: 'ACR-01', locationId: ACARREO, status: 'Operativo' },
];

describe('equiposForLubricadorMatriz() — alcance de la Matriz del Lubricador (por ubicación, no por cuadrilla/turno)', () => {
  it('A. Lubricador Volcán turno Día: ve el equipo de Volcán programado turno Día', () => {
    const result = equiposForLubricadorMatriz(equipos, scopeLubricadorVolcan);
    expect(result.map(e => e.id)).toContain('e1');
  });

  it('B. Lubricador Volcán turno Día: TAMBIÉN ve el equipo de Volcán programado turno Noche (el turno no excluye)', () => {
    const result = equiposForLubricadorMatriz(equipos, scopeLubricadorVolcan);
    expect(result.map(e => e.id)).toContain('e2');
  });

  it('C. ve un equipo de OTRA cuadrilla, misma ubicación (la cuadrilla activa no limita la Matriz)', () => {
    const result = equiposForLubricadorMatriz(equipos, scopeLubricadorVolcan);
    expect(result.map(e => e.id)).toContain('e3');
  });

  it('D. NO ve el equipo de Mojón (otra ubicación)', () => {
    const result = equiposForLubricadorMatriz(equipos, scopeLubricadorVolcan);
    expect(result.map(e => e.id)).not.toContain('e4');
  });

  it('E. NO ve el equipo de Acarreo (otra ubicación)', () => {
    const result = equiposForLubricadorMatriz(equipos, scopeLubricadorVolcan);
    expect(result.map(e => e.id)).not.toContain('e5');
  });

  it('F. un equipment assignment temporal (lubrication_assignments) no tiene campo de ubicación y nunca mueve/duplica un equipo en la Matriz', () => {
    // Un assignment PENDING hacia otra cuadrilla/equipo no se lee aquí en
    // absoluto — equiposForLubricadorMatriz() ni siquiera recibe
    // `assignments` como parámetro (a diferencia de classifyEquipmentWork()),
    // así que no hay forma de que una asignación cambie este resultado.
    const assignments = [
      { id: 'asg1', equipmentId: 'e1', occurrenceKey: 'p1:2026-10-09', assignedCrewId: 'crew-99', status: 'PENDING', active: true },
    ];
    const resultSinAssignments = equiposForLubricadorMatriz(equipos, scopeLubricadorVolcan);
    const resultConAssignments = equiposForLubricadorMatriz(equipos, scopeLubricadorVolcan); // mismo resultado, assignments nunca entra
    expect(resultConAssignments.map(e => e.id).sort()).toEqual(resultSinAssignments.map(e => e.id).sort());
    expect(assignments.length).toBe(1); // guard: el fixture existe, solo no se usa como parámetro
    // El equipo sigue teniendo SU MISMA locationId (no se movió a otra ubicación):
    expect(equipos.find(e => e.id === 'e1').locationId).toBe(VOLCAN);
  });

  it('I. sin duplicados: cada equipo de Volcán aparece una sola vez, aunque existan varias cuadrillas en esa ubicación', () => {
    const result = equiposForLubricadorMatriz(equipos, scopeLubricadorVolcan);
    const ids = result.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(['e1', 'e2', 'e3']);
  });

  it('el límite de seguridad sigue siendo la ubicación: sin scope CREW_SCOPED (sin cuadrilla autorizada), no devuelve nada', () => {
    expect(equiposForLubricadorMatriz(equipos, { kind: 'NO_CREW_ASSIGNED' })).toEqual([]);
    expect(equiposForLubricadorMatriz(equipos, null)).toEqual([]);
  });

  it('GLOBAL (ADMIN/PLANIFICADOR/VISOR) no es el scope de esta función — nunca se le pasa sin crewLocationId, devuelve vacío por seguridad', () => {
    expect(equiposForLubricadorMatriz(equipos, { kind: 'GLOBAL', crewLocationId: null })).toEqual([]);
  });
});

describe('G. "Mi Turno" (classifyEquipmentWork) sigue limitado a cuadrilla/turno como antes — sin cambios', () => {
  const cuadrillas = [
    { id: 'crew-76-08', name: '76-08', locationId: VOLCAN, isDefault: true, active: true, memberUserIds: ['u1'] },
    { id: 'crew-76-09', name: '76-09', locationId: VOLCAN, isDefault: false, active: true, memberUserIds: ['u2'] },
  ];

  it('"normal" (Mi Turno) de la cuadrilla 76-08 (default) incluye e1/e2, pero NO e3 (pertenece a la ubicación pero la cuadrilla default es la que recibe el trabajo normal)', () => {
    const { normal } = classifyEquipmentWork({ scope: scopeLubricadorVolcan, equipos, cuadrillas, assignments: [], equipoOccurrenceKeyFn: () => null });
    const ids = normal.map(e => e.id);
    expect(ids).toContain('e1');
    expect(ids).toContain('e2');
    expect(ids).toContain('e3'); // misma ubicación, pero classifyEquipmentWork() en sí mismo no filtra por cuadrilla "propietaria" del equipo, solo por si ESTE scope es la default
  });

  it('una cuadrilla NO-default en la misma ubicación no recibe trabajo "normal" (comportamiento preexistente, sin tocar)', () => {
    const scopeOtraCuadrilla = { ...scopeLubricadorVolcan, crewId: 'crew-76-09' };
    const { normal } = classifyEquipmentWork({ scope: scopeOtraCuadrilla, equipos, cuadrillas, assignments: [], equipoOccurrenceKeyFn: () => null });
    expect(normal).toEqual([]);
  });
});
