// tests/unit/operational-scope.test.js
//
// Rediseño operativo — dispositivos compartidos + cuadrillas + ubicaciones +
// asignación manual de engrases (src/core/operational-scope.js). Todo puro,
// con fixtures locales — NUNCA contra producción, NUNCA usuarios Auth
// reales (solo existe u_jvalles en producción; los roles de campo se
// prueban aquí con mocks, ver docs/OPERATIONAL_SCOPE.md).

import { describe, it, expect } from 'vitest';
import { loadOperationalScopeLogic } from '../helpers/loadLubricationLogic.js';

const {
  ASSIGNMENT_STATUS,
  canManageAssignments, canMoveEquipment, canMoveCrew, canManageCrewMembership, canRegisterOutOfPlan,
  getAuthorizedCrews,
  computeOccurrenceKey, resolveDefaultCrewForLocation, resolveOperationalScope,
  classifyEquipmentWork, findActivePendingAssignment, createAssignment,
  reassignAssignment, cancelAssignment, completeAssignmentIfPending,
  canLubricadorExecuteEquipment,
  buildExecutionSnapshot, resolveRecordEquipmentLocationId,
  resolveRecordCrewId, resolveRecordCrewLocationId,
  EXECUTION_TYPE, EXECUTION_COMPLETENESS, OUT_OF_PLAN_REASONS,
  computeExecutionCompleteness, findNextApplicableOccurrenceForWeekdayPlan,
  findNextApplicableOccurrence, resolveOutOfPlanSatisfaction, canAdvanceHourCycle, findExistingWorkForEquipment,
  resolveRecordExecutionType, resolveRecordOutOfPlanReason, resolveRecordCompleteness,
  NO_EXECUTION_REASONS, validateNoExecutionInput, buildNoExecutionRecord, findCarriedOverSkipForToday,
  GREASE_MATCH_STATUS, findMatchingGreaseRecordForOccurrence,
} = loadOperationalScopeLogic();

let uidSeq = 0;
const uid = (p) => `${p}_test${uidSeq++}`;
const NOW = '2026-09-28T10:00:00.000Z';

describe('Permisos por rol (§AB)', () => {
  it('canManageAssignments: ADMIN/PLANIFICADOR/SUPERVISOR sí, LUBRICADOR/VISOR no', () => {
    expect(canManageAssignments('ADMINISTRADOR')).toBe(true);
    expect(canManageAssignments('PLANIFICADOR')).toBe(true);
    expect(canManageAssignments('SUPERVISOR')).toBe(true);
    expect(canManageAssignments('LUBRICADOR')).toBe(false);
    expect(canManageAssignments('VISOR')).toBe(false);
  });
  it('canMoveEquipment/canMoveCrew: solo ADMIN/PLANIFICADOR (§W/§Z)', () => {
    for (const fn of [canMoveEquipment, canMoveCrew]) {
      expect(fn('ADMINISTRADOR')).toBe(true);
      expect(fn('PLANIFICADOR')).toBe(true);
      expect(fn('SUPERVISOR')).toBe(false);
      expect(fn('LUBRICADOR')).toBe(false);
      expect(fn('VISOR')).toBe(false);
    }
  });
  it('canManageCrewMembership: ADMIN/PLANIFICADOR autorizan miembros de una cuadrilla, el resto no (reemplaza al viejo canConfigureDevice)', () => {
    expect(canManageCrewMembership('ADMINISTRADOR')).toBe(true);
    expect(canManageCrewMembership('PLANIFICADOR')).toBe(true);
    expect(canManageCrewMembership('SUPERVISOR')).toBe(false);
    expect(canManageCrewMembership('LUBRICADOR')).toBe(false);
  });
});

describe('computeOccurrenceKey() — identidad de ocurrencia (§O)', () => {
  it('plan por día/turno: clave = planId:fecha, estable', () => {
    const plan = { id: 'plan1', controlType: 'Día y turno de la semana' };
    expect(computeOccurrenceKey(plan, { dateISO: '2026-09-28' })).toBe('plan1:2026-09-28');
    expect(computeOccurrenceKey(plan, { dateISO: '2026-09-28' })).toBe(computeOccurrenceKey(plan, { dateISO: '2026-09-28' }));
    expect(computeOccurrenceKey(plan, { dateISO: '2026-09-29' })).not.toBe(computeOccurrenceKey(plan, { dateISO: '2026-09-28' }));
  });
  it('plan por horas: clave = planId:h:lastGreaseHour — avanza sola cuando el plan se actualiza, sin colisionar con la ya completada', () => {
    const planAntes = { id: 'plan2', controlType: 'Horas de operación', lastGreaseHour: 5000 };
    const planDespues = { id: 'plan2', controlType: 'Horas de operación', lastGreaseHour: 5250 };
    const keyAntes = computeOccurrenceKey(planAntes);
    const keyDespues = computeOccurrenceKey(planDespues);
    expect(keyAntes).not.toBe(keyDespues);
    expect(keyAntes).toBe('plan2:h:5000');
  });
  it('plan por horas sin lastGreaseHour todavía (equipo nuevo) -> base 0, nunca lanza', () => {
    expect(computeOccurrenceKey({ id: 'plan3', controlType: 'Horas de operación' })).toBe('plan3:h:0');
  });
  it('sin plan o sin id -> lanza (nunca genera una clave ambigua)', () => {
    expect(() => computeOccurrenceKey(null)).toThrow();
    expect(() => computeOccurrenceKey({ controlType: 'Horas de operación' })).toThrow();
  });
});

describe('resolveDefaultCrewForLocation() — máximo una cuadrilla default por ubicación (§K)', () => {
  const cuadrillas = [
    { id: 'c1', name: 'Cuadrilla Volcán', locationId: 'loc_volcan', isDefault: true, active: true, createdAt: '2026-01-01' },
    { id: 'c2', name: 'Cuadrilla Volcán Auxiliar', locationId: 'loc_volcan', isDefault: false, active: true, createdAt: '2026-02-01' },
    { id: 'c3', name: 'Cuadrilla Mojón', locationId: 'loc_mojon', isDefault: true, active: true, createdAt: '2026-01-01' },
  ];
  it('devuelve la cuadrilla marcada isDefault de esa ubicación', () => {
    expect(resolveDefaultCrewForLocation(cuadrillas, 'loc_volcan').id).toBe('c1');
    expect(resolveDefaultCrewForLocation(cuadrillas, 'loc_mojon').id).toBe('c3');
  });
  it('sin locationId -> null; ubicación sin ninguna default -> null', () => {
    expect(resolveDefaultCrewForLocation(cuadrillas, null)).toBeNull();
    expect(resolveDefaultCrewForLocation(cuadrillas, 'loc_acarreo')).toBeNull();
  });
  it('dato mal cargado (2 defaults en la misma ubicación) -> gana la más antigua, nunca lanza', () => {
    const conDuplicado = [
      { id: 'x1', locationId: 'loc_taller', isDefault: true, active: true, createdAt: '2026-03-01' },
      { id: 'x2', locationId: 'loc_taller', isDefault: true, active: true, createdAt: '2026-01-01' },
    ];
    expect(resolveDefaultCrewForLocation(conDuplicado, 'loc_taller').id).toBe('x2');
  });
});

describe('getAuthorizedCrews() — única fuente de autorización (corrección arquitectónica 2026-10-02, reemplaza deviceAssignment)', () => {
  const cuadrillas = [
    { id: 'crew_mojon', active: true, memberUserIds: ['u1', 'u2'] },
    { id: 'crew_volcan', active: true, memberUserIds: ['u1'] },
    { id: 'crew_borrada', active: false, memberUserIds: ['u1'] },
    { id: 'crew_sin_nadie', active: true, memberUserIds: [] },
  ];

  it('devuelve TODAS las cuadrillas activas donde el userId está en memberUserIds, ninguna más', () => {
    expect(getAuthorizedCrews(cuadrillas, 'u1').map(c => c.id).sort()).toEqual(['crew_mojon', 'crew_volcan']);
    expect(getAuthorizedCrews(cuadrillas, 'u2').map(c => c.id)).toEqual(['crew_mojon']);
  });

  it('cuadrilla inactiva nunca cuenta, aunque el userId esté en memberUserIds', () => {
    expect(getAuthorizedCrews(cuadrillas, 'u1').find(c => c.id === 'crew_borrada')).toBeUndefined();
  });

  it('fila vieja sin memberUserIds (undefined) se trata como [] — nunca "todos autorizados"', () => {
    const vieja = [{ id: 'crew_vieja', active: true }];
    expect(getAuthorizedCrews(vieja, 'cualquier_usuario')).toEqual([]);
  });

  it('sin userId -> [] siempre, nunca lanza', () => {
    expect(getAuthorizedCrews(cuadrillas, null)).toEqual([]);
    expect(getAuthorizedCrews(cuadrillas, undefined)).toEqual([]);
  });
});

describe('resolveOperationalScope() (§I) — reescrito 2026-10-02: autorización por USUARIO (cuadrillas[].memberUserIds), nunca por dispositivo', () => {
  const cuadrillas = [{ id: 'crew_mojon', locationId: 'loc_mojon', active: true, isDefault: true, createdAt: '2026-01-01', memberUserIds: ['u_lub1', 'u_lub3', 'u_lub4'] }];

  it('jefaturas (ADMIN/PLANIFICADOR/VISOR) -> GLOBAL, sin scope de cuadrilla', () => {
    for (const role of ['ADMINISTRADOR', 'PLANIFICADOR', 'VISOR']) {
      const scope = resolveOperationalScope({ currentUser: { id: 'u1', role }, cuadrillas, shiftId: 'shift_dia' });
      expect(scope.kind).toBe('GLOBAL');
      expect(scope.crewId).toBeNull();
    }
  });

  it('CORRECCIÓN: SUPERVISOR ya NO es GLOBAL — ahora es crew-scoped igual que LUBRICADOR (pedido explícito: "SUPERVISOR y LUBRICADOR: cargar las cuadrillas autorizadas")', () => {
    const scope = resolveOperationalScope({
      currentUser: { id: 'u_sup1', role: 'SUPERVISOR' },
      cuadrillas: [{ id: 'crew_mojon', locationId: 'loc_mojon', active: true, memberUserIds: ['u_sup1'] }],
      shiftId: 'shift_dia'
    });
    expect(scope.kind).toBe('CREW_SCOPED');
    expect(scope.crewId).toBe('crew_mojon');
  });

  it('CASO 1 — LUBRICADOR autorizado en 1 sola cuadrilla real -> CREW_SCOPED, se autoselecciona SOLA, crewLocationId=Mojón', () => {
    const scope = resolveOperationalScope({
      currentUser: { id: 'u_lub1', role: 'LUBRICADOR' },
      cuadrillas, shiftId: 'shift_dia'
    });
    expect(scope.kind).toBe('CREW_SCOPED');
    expect(scope.crewId).toBe('crew_mojon');
    expect(scope.crewLocationId).toBe('loc_mojon');
    expect(scope.shiftId).toBe('shift_dia');
  });

  it('CASO 8 — LUBRICADOR sin ninguna cuadrilla que lo autorice -> NO_CREW_ASSIGNED, nunca fallback global', () => {
    const scope = resolveOperationalScope({
      currentUser: { id: 'u_lub2', role: 'LUBRICADOR' },
      cuadrillas, shiftId: 'shift_dia'
    });
    expect(scope.kind).toBe('NO_CREW_ASSIGNED');
    expect(scope.crewId).toBeNull();
  });

  it('la ÚNICA cuadrilla que lo autorizaba ya no existe/está inactiva -> mismo tratamiento que sin autorización (NO_CREW_ASSIGNED)', () => {
    const cuadrillasConBorrada = [{ id: 'crew_borrada', locationId: 'loc_x', active: false, memberUserIds: ['u_lub_x'] }];
    const scope = resolveOperationalScope({
      currentUser: { id: 'u_lub_x', role: 'LUBRICADOR' },
      cuadrillas: cuadrillasConBorrada, shiftId: 'shift_noche'
    });
    expect(scope.kind).toBe('NO_CREW_ASSIGNED');
  });

  it('CASO 13 — el turno viene SIEMPRE del parámetro shiftId (hora real), nunca de ningún dato guardado', () => {
    const scope = resolveOperationalScope({
      currentUser: { id: 'u_lub1', role: 'LUBRICADOR' },
      cuadrillas, shiftId: 'shift_dia' // la hora real dice Día
    });
    expect(scope.shiftId).toBe('shift_dia');
  });

  it('2+ cuadrillas autorizadas, SIN selectedCrewId -> NEEDS_CREW_SELECTION, nunca se adivina ni se toma la primera (punto D del pedido)', () => {
    const cuadrillas2 = [
      { id: 'crew_mojon', locationId: 'loc_mojon', active: true, memberUserIds: ['u_lub3'] },
      { id: 'crew_volcan', locationId: 'loc_volcan', active: true, memberUserIds: ['u_lub3'] },
    ];
    const scope = resolveOperationalScope({ currentUser: { id: 'u_lub3', role: 'LUBRICADOR' }, cuadrillas: cuadrillas2, shiftId: 'shift_dia' });
    expect(scope.kind).toBe('NEEDS_CREW_SELECTION');
    expect(scope.crewId).toBeNull();
    expect(scope.authorizedCrews.map(c => c.id).sort()).toEqual(['crew_mojon', 'crew_volcan']);
  });

  it('2+ cuadrillas autorizadas, CON selectedCrewId válido (una de las autorizadas) -> CREW_SCOPED con esa', () => {
    const cuadrillas2 = [
      { id: 'crew_mojon', locationId: 'loc_mojon', active: true, memberUserIds: ['u_lub3'] },
      { id: 'crew_volcan', locationId: 'loc_volcan', active: true, memberUserIds: ['u_lub3'] },
    ];
    const scope = resolveOperationalScope({ currentUser: { id: 'u_lub3', role: 'LUBRICADOR' }, cuadrillas: cuadrillas2, selectedCrewId: 'crew_volcan', shiftId: 'shift_dia' });
    expect(scope.kind).toBe('CREW_SCOPED');
    expect(scope.crewId).toBe('crew_volcan');
    expect(scope.crewLocationId).toBe('loc_volcan');
  });

  it('CASO E del pedido — selectedCrewId apuntando a una cuadrilla NO autorizada (ni siquiera autorizada para otra cosa) -> se ignora, NEEDS_CREW_SELECTION', () => {
    const cuadrillas2 = [
      { id: 'crew_mojon', locationId: 'loc_mojon', active: true, memberUserIds: ['u_lub4'] },
      { id: 'crew_volcan', locationId: 'loc_volcan', active: true, memberUserIds: ['u_lub4'] },
      { id: 'crew_ajena', locationId: 'loc_z', active: true, memberUserIds: ['otro_usuario'] },
    ];
    const scope = resolveOperationalScope({ currentUser: { id: 'u_lub4', role: 'LUBRICADOR' }, cuadrillas: cuadrillas2, selectedCrewId: 'crew_ajena', shiftId: 'shift_dia' });
    expect(scope.kind).toBe('NEEDS_CREW_SELECTION');
    expect(scope.crewId).toBeNull();
  });

  it('CASO C del pedido — usuario con 1 sola cuadrilla autorizada entra DIRECTO (CREW_SCOPED), sin pantalla de selección', () => {
    const scope = resolveOperationalScope({ currentUser: { id: 'u_lub1', role: 'LUBRICADOR' }, cuadrillas, shiftId: 'shift_dia' });
    expect(scope.kind).toBe('CREW_SCOPED'); // nunca NEEDS_CREW_SELECTION con una sola autorizada
  });

  it('CASO F del pedido — cambiar de dispositivo (mismo usuario, mismas cuadrillas en el servidor) conserva EXACTAMENTE los mismos permisos remotos', () => {
    // "Cambiar de dispositivo" = resolver el scope de nuevo sin ningún
    // dato local previo (selectedCrewId vacío, como un localStorage
    // nuevo) — el resultado depende SOLO de cuadrillas[].memberUserIds.
    const scopeDispositivoViejo = resolveOperationalScope({ currentUser: { id: 'u_lub1', role: 'LUBRICADOR' }, cuadrillas, shiftId: 'shift_dia' });
    const scopeDispositivoNuevo = resolveOperationalScope({ currentUser: { id: 'u_lub1', role: 'LUBRICADOR' }, cuadrillas, selectedCrewId: '', shiftId: 'shift_dia' });
    expect(scopeDispositivoNuevo).toEqual(scopeDispositivoViejo);
  });
});

describe('classifyEquipmentWork() (§J, §K, §L) — CASO 3/7 del pedido', () => {
  const cuadrillas = [
    { id: 'crew_volcan', locationId: 'loc_volcan', active: true, isDefault: true, createdAt: '2026-01-01', memberUserIds: ['u1'] },
    { id: 'crew_volcan_aux', locationId: 'loc_volcan', active: true, isDefault: false, createdAt: '2026-02-01', memberUserIds: ['u3'] },
    { id: 'crew_taller', locationId: 'loc_taller', active: true, isDefault: true, createdAt: '2026-01-01', memberUserIds: ['u2'] },
  ];
  const equipos = [
    { id: 'eq_0568', locationId: 'loc_volcan' },
    { id: 'eq_otro', locationId: 'loc_volcan' },
  ];
  const occFn = (e) => `plan_${e.id}:2026-09-28`;

  it('CASO 3 — equipo de Volcán asignado manualmente a Taller: sigue en Volcán, pero el trabajo aparece en Taller, no en Volcán (sin doble ejecución)', () => {
    const assignments = [
      { id: 'a1', occurrenceKey: occFn(equipos[0]), equipmentId: 'eq_0568', assignedCrewId: 'crew_taller', status: ASSIGNMENT_STATUS.PENDING, active: true }
    ];
    const scopeVolcan = resolveOperationalScope({ currentUser: { id: 'u1', role: 'LUBRICADOR' }, cuadrillas, shiftId: 'shift_dia' });
    const scopeTaller = resolveOperationalScope({ currentUser: { id: 'u2', role: 'LUBRICADOR' }, cuadrillas, shiftId: 'shift_dia' });

    const volcanWork = classifyEquipmentWork({ scope: scopeVolcan, equipos, cuadrillas, assignments, equipoOccurrenceKeyFn: occFn });
    expect(volcanWork.normal.find(e => e.id === 'eq_0568')).toBeUndefined(); // ya no es normal-ejecutable en Volcán
    expect(volcanWork.normal.find(e => e.id === 'eq_otro')).toBeDefined(); // el resto de Volcán sigue normal

    const tallerWork = classifyEquipmentWork({ scope: scopeTaller, equipos: [], cuadrillas, assignments, equipoOccurrenceKeyFn: occFn });
    expect(tallerWork.assigned).toHaveLength(1);
    expect(tallerWork.assigned[0].equipmentId).toBe('eq_0568');
  });

  it('equipo sigue con locationId=Volcán (nunca se reescribe por la asignación manual)', () => {
    expect(equipos[0].locationId).toBe('loc_volcan');
  });

  it('CASO 7 — dos cuadrillas en Volcán: solo la default recibe trabajo NORMAL, la auxiliar no ve nada normal sin asignación', () => {
    const scopeAux = resolveOperationalScope({ currentUser: { id: 'u3', role: 'LUBRICADOR' }, cuadrillas, shiftId: 'shift_dia' });
    const work = classifyEquipmentWork({ scope: scopeAux, equipos, cuadrillas, assignments: [], equipoOccurrenceKeyFn: occFn });
    expect(work.normal).toHaveLength(0); // nunca ve el trabajo normal de Volcán (esa es la default)
    expect(work.assigned).toHaveLength(0);
  });

  it('scope GLOBAL (jefaturas) -> ve todo, sin filtrar por cuadrilla default', () => {
    const scopeGlobal = resolveOperationalScope({ currentUser: { id: 'admin1', role: 'ADMINISTRADOR' }, cuadrillas, shiftId: 'shift_dia' });
    const work = classifyEquipmentWork({ scope: scopeGlobal, equipos, cuadrillas, assignments: [], equipoOccurrenceKeyFn: occFn });
    expect(work.normal).toHaveLength(2);
  });
});

describe('Motor de asignaciones (§L, §O, §P, §Q, §R) — CASO 3/11 del pedido', () => {
  it('createAssignment() crea una PENDING nueva; nunca duplica si ya hay una activa para la misma occurrence', () => {
    const a1 = createAssignment({ existing: [], occurrenceKey: 'plan1:2026-09-28', equipmentId: 'eq1', planId: 'plan1', assignedCrewId: 'crew_taller', assignedByUserId: 'u_jvalles', assignedByUserName: 'Junior Valles', now: NOW, uid });
    expect(a1.status).toBe(ASSIGNMENT_STATUS.PENDING);
    expect(a1.assignedCrewId).toBe('crew_taller');
    expect(() => createAssignment({ existing: [a1], occurrenceKey: 'plan1:2026-09-28', equipmentId: 'eq1', assignedCrewId: 'crew_mojon', assignedByUserId: 'u_jvalles', assignedByUserName: 'Junior Valles', now: NOW, uid })).toThrow();
  });

  it('findActivePendingAssignment() ignora CANCELLED/COMPLETED — permite crear una nueva después', () => {
    const cancelada = { id: 'a0', occurrenceKey: 'plan1:2026-09-28', status: ASSIGNMENT_STATUS.CANCELLED, active: true };
    expect(findActivePendingAssignment([cancelada], 'plan1:2026-09-28')).toBeNull();
    const nueva = createAssignment({ existing: [cancelada], occurrenceKey: 'plan1:2026-09-28', equipmentId: 'eq1', assignedCrewId: 'crew_mojon', assignedByUserId: 'u_jvalles', assignedByUserName: 'Junior Valles', now: NOW, uid });
    expect(nueva.status).toBe(ASSIGNMENT_STATUS.PENDING);
  });

  it('CASO 11 — reassignAssignment(): Mojón -> Taller, conserva previousCrewId, nunca crea una segunda activa', () => {
    const original = createAssignment({ existing: [], occurrenceKey: 'plan2:2026-09-28', equipmentId: 'eq2', assignedCrewId: 'crew_mojon', assignedByUserId: 'u_jvalles', assignedByUserName: 'Junior Valles', now: NOW, uid });
    const reasignada = reassignAssignment(original, { newCrewId: 'crew_taller', now: NOW });
    expect(reasignada.assignedCrewId).toBe('crew_taller');
    expect(reasignada.previousCrewId).toBe('crew_mojon');
    expect(reasignada.id).toBe(original.id); // MISMA fila, no una nueva
  });

  it('reassignAssignment() rechaza reasignar una que ya no está PENDING', () => {
    const completada = { id: 'a3', occurrenceKey: 'k', assignedCrewId: 'crew_mojon', status: ASSIGNMENT_STATUS.COMPLETED };
    expect(() => reassignAssignment(completada, { newCrewId: 'crew_taller', now: NOW })).toThrow();
  });

  it('cancelAssignment() marca CANCELLED, no borra nada, permite que classifyEquipmentWork() vuelva a mostrarla como normal', () => {
    const asg = createAssignment({ existing: [], occurrenceKey: 'plan3:2026-09-28', equipmentId: 'eq3', assignedCrewId: 'crew_taller', assignedByUserId: 'u_jvalles', assignedByUserName: 'Junior Valles', now: NOW, uid });
    const cancelada = cancelAssignment(asg, { now: NOW });
    expect(cancelada.status).toBe(ASSIGNMENT_STATUS.CANCELLED);

    const cuadrillas = [{ id: 'crew_volcan', locationId: 'loc_volcan', active: true, isDefault: true, createdAt: '2026-01-01', memberUserIds: ['u1'] }];
    const equipos = [{ id: 'eq3', locationId: 'loc_volcan' }];
    const scope = resolveOperationalScope({ currentUser: { id: 'u1', role: 'LUBRICADOR' }, cuadrillas, shiftId: 'shift_dia' });
    const work = classifyEquipmentWork({ scope, equipos, cuadrillas, assignments: [cancelada], equipoOccurrenceKeyFn: () => 'plan3:2026-09-28' });
    expect(work.normal.find(e => e.id === 'eq3')).toBeDefined(); // vuelve al flujo normal (preferencia documentada en §Q)
  });

  it('completeAssignmentIfPending(): con assignment activa la completa; sin assignment (trabajo normal) no hace nada', () => {
    const asg = createAssignment({ existing: [], occurrenceKey: 'plan4:2026-09-28', equipmentId: 'eq4', assignedCrewId: 'crew_taller', assignedByUserId: 'u_jvalles', assignedByUserName: 'Junior Valles', now: NOW, uid });
    const completada = completeAssignmentIfPending([asg], { occurrenceKey: 'plan4:2026-09-28', recordId: 'rec_1', now: NOW });
    expect(completada.status).toBe(ASSIGNMENT_STATUS.COMPLETED);
    expect(completada.completedRecordId).toBe('rec_1');

    expect(completeAssignmentIfPending([asg], { occurrenceKey: 'nunca-existio', recordId: 'rec_2', now: NOW })).toBeNull();
  });
});

describe('canLubricadorExecuteEquipment() (§AO) — CASO 12 del pedido', () => {
  const cuadrillas = [{ id: 'crew_mojon', locationId: 'loc_mojon', active: true, isDefault: true, createdAt: '2026-01-01', memberUserIds: ['u1'] }];
  const scope = resolveOperationalScope({ currentUser: { id: 'u1', role: 'LUBRICADOR' }, cuadrillas, shiftId: 'shift_dia' });

  it('equipo dentro de su ubicación normal -> siempre ejecutable', () => {
    expect(canLubricadorExecuteEquipment({ scope, equipo: { id: 'e1', locationId: 'loc_mojon' }, assignments: [] })).toBe(true);
  });
  it('equipo fuera de su ubicación, SIN assignment a su cuadrilla -> NO ejecutable', () => {
    expect(canLubricadorExecuteEquipment({ scope, equipo: { id: 'e2', locationId: 'loc_volcan' }, assignments: [] })).toBe(false);
  });
  it('equipo fuera de su ubicación, CON assignment PENDING a su cuadrilla -> sí ejecutable', () => {
    const assignments = [{ equipmentId: 'e2', assignedCrewId: 'crew_mojon', status: ASSIGNMENT_STATUS.PENDING, active: true }];
    expect(canLubricadorExecuteEquipment({ scope, equipo: { id: 'e2', locationId: 'loc_volcan' }, assignments })).toBe(true);
  });
  it('jefaturas (scope GLOBAL) -> siempre pueden (esta función no restringe scope global)', () => {
    const scopeAdmin = resolveOperationalScope({ currentUser: { id: 'a1', role: 'ADMINISTRADOR' }, cuadrillas, shiftId: 'shift_dia' });
    expect(canLubricadorExecuteEquipment({ scope: scopeAdmin, equipo: { id: 'e3', locationId: 'loc_volcan' }, assignments: [] })).toBe(true);
  });
});

describe('Snapshot histórico (§1 del cierre de lote) — CASO A/B/C del pedido', () => {
  it('buildExecutionSnapshot(): sin assignment -> PLANNED (fallback); con assignment -> ASSIGNED (fallback)', () => {
    const normal = buildExecutionSnapshot({ equipmentLocationId: 'loc_volcan', crewId: 'crew_volcan', crewLocationId: 'loc_volcan', performedByUserId: 'u1', shiftId: 'shift_dia', assignmentId: null });
    expect(normal.executionType).toBe('PLANNED');
    expect(normal.assignmentId).toBeNull();

    const manual = buildExecutionSnapshot({ equipmentLocationId: 'loc_volcan', crewId: 'crew_taller', crewLocationId: 'loc_taller', performedByUserId: 'u1', shiftId: 'shift_dia', assignmentId: 'asg_1' });
    expect(manual.executionType).toBe('ASSIGNED');
    expect(manual.assignmentId).toBe('asg_1');
  });

  it('buildExecutionSnapshot(): executionType explícito siempre gana sobre el fallback por assignmentId', () => {
    const outOfPlan = buildExecutionSnapshot({ equipmentLocationId: 'loc_volcan', executionType: 'OUT_OF_PLAN', outOfPlanReason: 'PM', executionCompleteness: 'COMPLETE' });
    expect(outOfPlan.executionType).toBe('OUT_OF_PLAN');
    expect(outOfPlan.outOfPlanReason).toBe('PM');
    expect(outOfPlan.executionCompleteness).toBe('COMPLETE');
  });

  it('buildExecutionSnapshot(): valores ausentes -> null, nunca undefined ni inventados', () => {
    const snap = buildExecutionSnapshot({});
    expect(snap).toEqual({
      equipmentLocationIdAtExecution: null, crewId: null, crewLocationIdAtExecution: null,
      performedByUserId: null, shiftId: null, assignmentId: null, executionType: 'PLANNED',
      outOfPlanReason: null, executionCompleteness: null, satisfiedOccurrenceKey: null
    });
  });

  it('CASO A/B/C — registro con snapshot conserva la ubicación de ejecución aunque el equipo se mueva después', () => {
    // A) se registra el engrase con el equipo en Volcán
    const record = {
      id: 'greg_1',
      operationalSnapshot: buildExecutionSnapshot({ equipmentLocationId: 'loc_volcan', crewId: 'crew_volcan', crewLocationId: 'loc_volcan', performedByUserId: 'u_lub1', shiftId: 'shift_dia' })
    };
    // B) el equipo se mueve a Mojón DESPUÉS (equipoActual ya no es Volcán)
    const equipoActual = { id: 'e1', locationId: 'loc_mojon' };
    // C) el histórico del registro anterior sigue mostrando Volcán, no Mojón
    const resuelto = resolveRecordEquipmentLocationId(record, equipoActual);
    expect(resuelto.value).toBe('loc_volcan');
    expect(resuelto.source).toBe('snapshot');
  });

  it('equivalente con cambio de ubicación de CUADRILLA: el registro conserva la ubicación de la cuadrilla al momento, no la actual', () => {
    // La cuadrilla estaba en Volcán cuando se ejecutó el engrase
    const record = {
      id: 'greg_2',
      operationalSnapshot: buildExecutionSnapshot({ equipmentLocationId: 'loc_volcan', crewId: 'crew_x', crewLocationId: 'loc_volcan', performedByUserId: 'u_lub1', shiftId: 'shift_dia' })
    };
    // La cuadrilla luego se movió a Taller (irrelevante para este registro ya guardado)
    const resuelto = resolveRecordCrewLocationId(record);
    expect(resuelto.value).toBe('loc_volcan');
    expect(resuelto.source).toBe('snapshot');
    expect(resolveRecordCrewId(record)).toEqual({ value: 'crew_x', source: 'snapshot' });
  });

  it('registro VIEJO sin operationalSnapshot -> fallback legado explícito a la ubicación ACTUAL del equipo, crew siempre null (nunca se inventa)', () => {
    const recordViejo = { id: 'greg_old' };
    const equipoActual = { id: 'e1', locationId: 'loc_taller' };
    expect(resolveRecordEquipmentLocationId(recordViejo, equipoActual)).toEqual({ value: 'loc_taller', source: 'legacy_fallback' });
    expect(resolveRecordCrewId(recordViejo)).toEqual({ value: null, source: 'legacy_fallback' });
    expect(resolveRecordCrewLocationId(recordViejo)).toEqual({ value: null, source: 'legacy_fallback' });
  });

  it('registro viejo sin equipo actual disponible (equipo eliminado) -> value null, nunca lanza', () => {
    expect(resolveRecordEquipmentLocationId({ id: 'greg_old2' }, null)).toEqual({ value: null, source: 'legacy_fallback' });
  });
});

describe('Engrase fuera de plan — computeExecutionCompleteness() (§8)', () => {
  it('sin puntos configurados -> COMPLETE (nada requerido que pueda faltar)', () => {
    expect(computeExecutionCompleteness([])).toBe('COMPLETE');
    expect(computeExecutionCompleteness(undefined)).toBe('COMPLETE');
  });
  it('todos los puntos hechos -> COMPLETE', () => {
    expect(computeExecutionCompleteness([{ done: true }, { done: true }])).toBe('COMPLETE');
  });
  it('al menos un punto sin hacer -> PARTIAL', () => {
    expect(computeExecutionCompleteness([{ done: true }, { done: false, reason: 'Punto inaccesible' }])).toBe('PARTIAL');
  });
});

describe('Engrase fuera de plan — CASO A-N del pedido', () => {
  const HOY = new Date('2026-09-28T10:00:00'); // lunes

  it('CASO A — OUT_OF_PLAN + PM + COMPLETE, plan por horas: satisface el ciclo vigente (nunca ambiguo)', () => {
    const plan = { id: 'plan_horas', controlType: 'Horas de operación', frequency: 250, lastGreaseHour: 4800 };
    const key = resolveOutOfPlanSatisfaction({ plan, completeness: 'COMPLETE', existingRecords: [], todayDate: HOY });
    expect(key).toBe(computeOccurrenceKey(plan, {}));
    expect(key).toBe('plan_horas:h:4800');
    // El avance real (4800 -> 5000, próximo 5250) lo hace app.js igual que
    // con cualquier registro más reciente (plan.lastGreaseHour = newHourmeter)
    // — este módulo solo certifica QUÉ ocurrencia queda satisfecha.
  });

  it('CASO B — OUT_OF_PLAN + PM + PARTIAL, plan por horas: NO satisface nada (nunca reinicia el ciclo a medias)', () => {
    const plan = { id: 'plan_horas', controlType: 'Horas de operación', frequency: 250, lastGreaseHour: 4800 };
    const key = resolveOutOfPlanSatisfaction({ plan, completeness: 'PARTIAL', existingRecords: [], todayDate: HOY });
    expect(key).toBeNull();
  });

  it('CASO C — OUT_OF_PLAN día/turno: PM el martes satisface por adelantado el miércoles (única ocurrencia pendiente en la ventana)', () => {
    const plan = { id: 'plan_dt', controlType: 'Día y turno de la semana', assignedDays: ['Miércoles'] };
    const martes = new Date('2026-09-29T09:00:00'); // martes de esa semana
    const key = resolveOutOfPlanSatisfaction({ plan, completeness: 'COMPLETE', existingRecords: [], todayDate: martes });
    expect(key).toBe('plan_dt:2026-09-30'); // miércoles siguiente
  });

  it('CASO D — OUT_OF_PLAN sin ocurrencia aplicable (plan sin días asignados): no satisface nada, nunca lanza', () => {
    const plan = { id: 'plan_sin_dias', controlType: 'Día y turno de la semana', assignedDays: [] };
    expect(resolveOutOfPlanSatisfaction({ plan, completeness: 'COMPLETE', existingRecords: [], todayDate: HOY })).toBeNull();
  });

  // Fix 2026-10-09 ("REALIZADO ADELANTADO"): assignedDays actualizado a
  // propósito ['Lunes','Martes'] — con la ventana ya acotada a 1 día de
  // adelanto (§21-23 del pedido), 'Miércoles' (a 2 días) quedaría FUERA de
  // la ventana y dejaría de ser ambiguo por sí solo (ver CASO N, cambio
  // deliberado). 'Martes' sigue siendo mañana (dentro de la ventana), así
  // que la ambigüedad real (hoy Y mañana, ambos candidatos) se preserva.
  it('CASO D2 — ambiguo (2+ días programados pendientes dentro de la ventana de 1 día: hoy Y mañana): NUNCA se inventa cuál satisface, null', () => {
    const plan = { id: 'plan_multi', controlType: 'Día y turno de la semana', assignedDays: ['Lunes', 'Martes'] };
    // Hoy es lunes: el propio lunes (hoy) y el martes (mañana) son ambos candidatos sin completar
    const key = findNextApplicableOccurrenceForWeekdayPlan({ plan, existingRecords: [], todayDate: HOY });
    expect(key).toBeNull();
  });

  it('CASO E — con assignment activa, findExistingWorkForEquipment() devuelve ASSIGNED (gana sobre OUT_OF_PLAN, §15)', () => {
    const plan = { id: 'plan_dt2', controlType: 'Día y turno de la semana', assignedDays: ['Lunes'] };
    const occurrenceKey = computeOccurrenceKey(plan, { dateISO: '2026-09-28' });
    const assignments = [{ id: 'asg1', occurrenceKey, assignedCrewId: 'crew_taller', status: 'PENDING', active: true }];
    const result = findExistingWorkForEquipment({ plan, assignments, statusCode: 'ROJO', todayDate: HOY });
    expect(result.kind).toBe('ASSIGNED');
    expect(result.assignment.id).toBe('asg1');
  });

  it('CASO F — mismo día: OUT_OF_PLAN completo el día programado satisface ESA misma ocurrencia (nunca queda PLANNED pendiente + OUT_OF_PLAN aparte)', () => {
    const plan = { id: 'plan_dt3', controlType: 'Día y turno de la semana', assignedDays: ['Lunes'] };
    const existing = findExistingWorkForEquipment({ plan, assignments: [], statusCode: 'AMARILLO', todayDate: HOY });
    const satisfecha = resolveOutOfPlanSatisfaction({ plan, completeness: 'COMPLETE', existingRecords: [], todayDate: HOY });
    expect(existing.kind).toBe('PLANNED');
    expect(satisfecha).toBe(existing.occurrenceKey); // misma clave -> una sola ocurrencia, no dos
  });

  it('CASO G — canRegisterOutOfPlan(): LUBRICADOR puede registrar fuera de plan (no necesita que Planificador le cree una assignment)', () => {
    expect(canRegisterOutOfPlan('LUBRICADOR')).toBe(true);
    expect(canRegisterOutOfPlan('ADMINISTRADOR')).toBe(true);
    expect(canRegisterOutOfPlan('PLANIFICADOR')).toBe(true);
    expect(canRegisterOutOfPlan('SUPERVISOR')).toBe(true);
    expect(canRegisterOutOfPlan('VISOR')).toBe(false);
  });

  it('CASO H — Lubricador fuera de scope sigue bloqueado (OUT_OF_PLAN NO permite saltarse permisos, §2/§21D)', () => {
    const cuadrillas = [{ id: 'crew_mojon', locationId: 'loc_mojon', active: true, isDefault: true, createdAt: '2026-01-01', memberUserIds: ['u1'] }];
    const scope = resolveOperationalScope({ currentUser: { id: 'u1', role: 'LUBRICADOR' }, cuadrillas, shiftId: 'shift_dia' });
    const equipoFuera = { id: 'e_fuera', locationId: 'loc_volcan' };
    expect(canLubricadorExecuteEquipment({ scope, equipo: equipoFuera, assignments: [] })).toBe(false);
  });

  it('CASO I — QR: equipo con assignment a mi cuadrilla -> ASSIGNED; sin nada -> puede abrir "fuera de plan" si está en mi scope', () => {
    const plan = { id: 'plan_qr', controlType: 'Horas de operación', frequency: 250, lastGreaseHour: 100 };
    const occurrenceKey = computeOccurrenceKey(plan, {});
    const conAssignment = findExistingWorkForEquipment({
      plan, assignments: [{ id: 'a1', occurrenceKey, assignedCrewId: 'crew_x', status: 'PENDING', active: true }],
      statusCode: 'ROJO', todayDate: HOY
    });
    expect(conAssignment.kind).toBe('ASSIGNED');

    const sinNada = findExistingWorkForEquipment({ plan, assignments: [], statusCode: 'VERDE', todayDate: HOY });
    expect(sinNada.kind).toBe('NONE'); // no vencido/próximo y sin assignment -> el botón "fuera de plan" es la única vía
  });

  it('CASO M — PARTIAL nunca satisface (no cancela un recordatorio de ocurrencia pendiente válida)', () => {
    const plan = { id: 'plan_m', controlType: 'Día y turno de la semana', assignedDays: ['Martes'] };
    expect(resolveOutOfPlanSatisfaction({ plan, completeness: 'PARTIAL', existingRecords: [], todayDate: HOY })).toBeNull();
  });

  // Fix 2026-10-09 ("REALIZADO ADELANTADO", Parte F del pedido): CASO N
  // actualizado A PROPÓSITO — la ventana bajó de 7 a 1 día de adelanto
  // (ver findNextApplicableOccurrenceForWeekdayPlan()). HOY es lunes
  // 2026-09-28; el jueves de esa semana (2026-10-01) queda a 3 días, fuera
  // de la nueva ventana — por eso YA NO satisface (antes sí, con la
  // ventana vieja de 7 días). §23 del pedido, literal: "+2 días NUNCA
  // satisface automáticamente".
  it('CASO N — COMPLETE a +3 días (fuera de la ventana de 1 día) NO satisface automáticamente — queda OUT_OF_PLAN, la ocurrencia futura permanece', () => {
    const plan = { id: 'plan_n', controlType: 'Día y turno de la semana', assignedDays: ['Jueves'] };
    const key = resolveOutOfPlanSatisfaction({ plan, completeness: 'COMPLETE', existingRecords: [], todayDate: HOY });
    expect(key).toBeNull();
  });

  // §21/§24 del pedido: "PROGRAMADO MAÑANA + COMPLETE HOY = satisface la
  // ocurrencia de mañana" — el ÚNICO caso real de "adelantado". HOY aquí
  // es miércoles 2026-09-30; jueves 2026-10-01 es exactamente 1 día
  // después (mañana).
  it('§21 — COMPLETE a 1 día de adelanto (programado MAÑANA) SÍ satisface esa ocurrencia — único caso válido de "realizado adelantado"', () => {
    const HOY_MIERCOLES = new Date('2026-09-30T10:00:00');
    const plan = { id: 'plan_n2', controlType: 'Día y turno de la semana', assignedDays: ['Jueves'] };
    const key = resolveOutOfPlanSatisfaction({ plan, completeness: 'COMPLETE', existingRecords: [], todayDate: HOY_MIERCOLES });
    expect(key).toBe('plan_n2:2026-10-01'); // jueves, exactamente mañana
  });

  // §27 del pedido: la ventana de adelanto NUNCA aplica a planes por horas
  // — siguen dependiendo solo de hourmeter/lastGreaseHour/COMPLETE, sin
  // cambios (findNextApplicableOccurrence() despacha por controlType desde
  // antes de este lote; esto solo confirma que sigue siendo así).
  it('§27 — un plan "Horas de operación" nunca usa la ventana de días (findNextApplicableOccurrence despacha por controlType, sin cambios)', () => {
    const plan = { id: 'plan_horas', controlType: 'Horas de operación', frequency: 250, lastGreaseHour: 100 };
    const key = resolveOutOfPlanSatisfaction({ plan, completeness: 'COMPLETE', existingRecords: [], todayDate: HOY });
    expect(key).toBe(computeOccurrenceKey(plan, {})); // por ciclo de horómetro, nunca por fecha
  });

  it('resolveRecordExecutionType()/resolveRecordOutOfPlanReason()/resolveRecordCompleteness(): con snapshot devuelven el dato real; sin snapshot, PLANNED por defecto (nunca se presenta como fuera de plan sin poder probarlo)', () => {
    const conSnapshot = { operationalSnapshot: buildExecutionSnapshot({ executionType: 'OUT_OF_PLAN', outOfPlanReason: 'CORRECTIVO', executionCompleteness: 'PARTIAL' }) };
    expect(resolveRecordExecutionType(conSnapshot)).toEqual({ value: 'OUT_OF_PLAN', source: 'snapshot' });
    expect(resolveRecordOutOfPlanReason(conSnapshot)).toBe('CORRECTIVO');
    expect(resolveRecordCompleteness(conSnapshot)).toBe('PARTIAL');

    const viejo = { id: 'greg_old3' };
    expect(resolveRecordExecutionType(viejo)).toEqual({ value: 'PLANNED', source: 'legacy_fallback' });
    expect(resolveRecordOutOfPlanReason(viejo)).toBeNull();
    expect(resolveRecordCompleteness(viejo)).toBeNull();
  });
});

describe('canAdvanceHourCycle() — F-01 (auditoría pre-release): PARTIAL no reinicia el ciclo de un plan por horas', () => {
  it('A) plan por horas + COMPLETE: puede avanzar (actualiza lastGreaseHour/reinicia el ciclo)', () => {
    expect(canAdvanceHourCycle({ controlType: 'Horas de operación', completeness: 'COMPLETE' })).toBe(true);
  });

  it('B) plan por horas + PARTIAL: NO puede avanzar (el ciclo sigue abierto, igual que resolveOutOfPlanSatisfaction exige COMPLETE)', () => {
    expect(canAdvanceHourCycle({ controlType: 'Horas de operación', completeness: 'PARTIAL' })).toBe(false);
  });

  it('E) PARTIAL fuera de plan (OUT_OF_PLAN) en plan por horas: tampoco reinicia un ciclo completo — la función no distingue por executionType, solo por completeness', () => {
    // El caller (app.js) pasa el mismo completenessDeEsteEngrase sin importar
    // si executionTypeDeEsteEngrase es PLANNED/ASSIGNED/OUT_OF_PLAN — un
    // PARTIAL siempre deja el ciclo abierto, consistente con CASO B de
    // resolveOutOfPlanSatisfaction() arriba (OUT_OF_PLAN + PARTIAL -> null).
    expect(canAdvanceHourCycle({ controlType: 'Horas de operación', completeness: EXECUTION_COMPLETENESS.PARTIAL })).toBe(false);
  });

  it('plan "Día y turno de la semana" (no usa lastGreaseHour para su ciclo): siempre puede avanzar, incluso con PARTIAL', () => {
    expect(canAdvanceHourCycle({ controlType: 'Día y turno de la semana', completeness: 'PARTIAL' })).toBe(true);
    expect(canAdvanceHourCycle({ controlType: 'Día y turno de la semana', completeness: 'COMPLETE' })).toBe(true);
  });

  it('D) composición con computeOccurrenceKey(): tras un PARTIAL, lastGreaseHour no avanza -> la "próxima ocurrencia" sigue siendo la MISMA (desde el último COMPLETE real), nunca una nueva', () => {
    const plan = { id: 'plan_f01', controlType: 'Horas de operación', frequency: 250, lastGreaseHour: 4800 };
    const claveAntes = computeOccurrenceKey(plan, {});

    // app.js solo escribe plan.lastGreaseHour = newHourmeter cuando
    // canAdvanceHourCycle() devuelve true — con PARTIAL, nunca se llega a
    // escribir, así que el plan (y su clave de ocurrencia) no cambian.
    if (canAdvanceHourCycle({ controlType: plan.controlType, completeness: 'PARTIAL' })) {
      plan.lastGreaseHour = 5000; // no debería ejecutarse
    }
    expect(computeOccurrenceKey(plan, {})).toBe(claveAntes);
    expect(plan.lastGreaseHour).toBe(4800);

    // Con un COMPLETE real, sí avanza y nace una ocurrencia nueva distinta.
    if (canAdvanceHourCycle({ controlType: plan.controlType, completeness: 'COMPLETE' })) {
      plan.lastGreaseHour = 5000;
    }
    expect(computeOccurrenceKey(plan, {})).not.toBe(claveAntes);
    expect(plan.lastGreaseHour).toBe(5000);
  });
});

describe('"No se pudo ejecutar" (lote occurrences/carryover, §1) — NUNCA crea un lubrication_record', () => {
  it('NO_EXECUTION_REASONS trae exactamente los 6 motivos del pedido', () => {
    expect(NO_EXECUTION_REASONS).toEqual(['REPARACION', 'YA_ENGRASADO', 'SIN_TIEMPO', 'NO_DISPONIBLE', 'CONDICION_INSEGURA', 'OTRO']);
  });

  it('validateNoExecutionInput(): motivo no reconocido -> lanza', () => {
    expect(() => validateNoExecutionInput({ reason: 'INVENTADO', observacion: '' })).toThrow(/no válido/);
  });

  it('validateNoExecutionInput(): OTRO sin observación -> lanza (mismo criterio que outOfPlanReason)', () => {
    expect(() => validateNoExecutionInput({ reason: 'OTRO', observacion: '  ' })).toThrow(/observación/);
  });

  it('validateNoExecutionInput(): OTRO con observación -> no lanza', () => {
    expect(() => validateNoExecutionInput({ reason: 'OTRO', observacion: 'Cuadrilla desviada a emergencia' })).not.toThrow();
  });

  it('validateNoExecutionInput(): un motivo de la lista distinto de OTRO nunca exige observación', () => {
    expect(() => validateNoExecutionInput({ reason: 'CONDICION_INSEGURA', observacion: '' })).not.toThrow();
  });

  it('buildNoExecutionRecord(): arma el registro completo, observación recortada, sin inventar campos', () => {
    const r = buildNoExecutionRecord({
      id: 'skip_1', equipmentId: 'e1', planId: 'p1', occurrenceKey: 'p1:2026-09-30',
      date: '2026-09-30T20:00:00.000Z', shiftId: 'shift_noche',
      reason: 'CONDICION_INSEGURA', observacion: '  Zona con derrumbe activo  ',
      userId: 'u1', userName: 'Ana G.', now: NOW
    });
    expect(r).toEqual({
      id: 'skip_1', equipmentId: 'e1', planId: 'p1', occurrenceKey: 'p1:2026-09-30',
      date: '2026-09-30T20:00:00.000Z', shiftId: 'shift_noche',
      reason: 'CONDICION_INSEGURA', observacion: 'Zona con derrumbe activo',
      userId: 'u1', userName: 'Ana G.', createdAt: NOW, active: true, linkedRecordId: null
    });
  });

  it('buildNoExecutionRecord(): linkedRecordId se guarda cuando se pasa (cierre histórico Parte A, YA_ENGRASADO conciliado con un match real)', () => {
    const r = buildNoExecutionRecord({
      id: 'skip_2b', equipmentId: 'e1', planId: 'p1', occurrenceKey: 'p1:2026-09-30',
      date: NOW, shiftId: 'shift_dia', reason: 'YA_ENGRASADO', observacion: '',
      userId: 'u1', userName: 'Ana G.', now: NOW, linkedRecordId: 'greg_real_123'
    });
    expect(r.linkedRecordId).toBe('greg_real_123');
  });

  it('buildNoExecutionRecord(): observación vacía cuando el motivo no es OTRO -> null, nunca cadena vacía', () => {
    const r = buildNoExecutionRecord({
      id: 'skip_2', equipmentId: 'e1', planId: 'p1', occurrenceKey: 'p1:2026-09-30',
      date: '2026-09-30T08:00:00.000Z', shiftId: 'shift_dia',
      reason: 'SIN_TIEMPO', observacion: '',
      userId: 'u1', userName: 'Ana G.', now: NOW
    });
    expect(r.observacion).toBeNull();
  });

  it('buildNoExecutionRecord(): valida ANTES de armar el registro — OTRO sin observación nunca llega a construirse', () => {
    expect(() => buildNoExecutionRecord({
      id: 'skip_3', equipmentId: 'e1', planId: 'p1', occurrenceKey: 'p1:2026-09-30',
      date: NOW, shiftId: 'shift_dia', reason: 'OTRO', observacion: '',
      userId: 'u1', userName: 'Ana G.', now: NOW
    })).toThrow(/observación/);
  });

  it('findCarriedOverSkipForToday(): un skip de Día del mismo día se ve como carryover en Noche', () => {
    const skips = [{ id: 'skip_1', equipmentId: 'e1', date: '2026-09-30T08:00:00.000Z', shiftId: 'shift_dia', reason: 'CONDICION_INSEGURA', createdAt: '2026-09-30T08:05:00.000Z' }];
    const r = findCarriedOverSkipForToday(skips, { equipmentId: 'e1', dateISO: '2026-09-30' });
    expect(r).toMatchObject({ id: 'skip_1', reason: 'CONDICION_INSEGURA' });
  });

  it('findCarriedOverSkipForToday(): un skip de OTRO equipo o de OTRO día nunca contamina el resultado', () => {
    const skips = [
      { id: 'skip_x', equipmentId: 'otro', date: '2026-09-30T08:00:00.000Z', shiftId: 'shift_dia', createdAt: '2026-09-30T08:05:00.000Z' },
      { id: 'skip_y', equipmentId: 'e1', date: '2026-09-29T08:00:00.000Z', shiftId: 'shift_dia', createdAt: '2026-09-29T08:05:00.000Z' },
    ];
    expect(findCarriedOverSkipForToday(skips, { equipmentId: 'e1', dateISO: '2026-09-30' })).toBeNull();
  });

  it('findCarriedOverSkipForToday(): sin ningún skip -> null (nunca inventa una advertencia)', () => {
    expect(findCarriedOverSkipForToday([], { equipmentId: 'e1', dateISO: '2026-09-30' })).toBeNull();
  });

  it('findCarriedOverSkipForToday(): 2+ skips del mismo día -> toma el más reciente por createdAt', () => {
    const skips = [
      { id: 'skip_temprano', equipmentId: 'e1', date: '2026-09-30T08:00:00.000Z', shiftId: 'shift_dia', reason: 'SIN_TIEMPO', createdAt: '2026-09-30T08:05:00.000Z' },
      { id: 'skip_tarde', equipmentId: 'e1', date: '2026-09-30T20:00:00.000Z', shiftId: 'shift_noche', reason: 'CONDICION_INSEGURA', createdAt: '2026-09-30T20:05:00.000Z' },
    ];
    const r = findCarriedOverSkipForToday(skips, { equipmentId: 'e1', dateISO: '2026-09-30' });
    expect(r.id).toBe('skip_tarde');
  });
});

describe('findMatchingGreaseRecordForOccurrence() — cierre histórico Parte A, match de "ya fue engrasado" (§40 A-G del pedido)', () => {
  const planDT = { id: 'plan_1', equipmentId: 'e1', controlType: 'Día y turno de la semana', shiftId: 'shift_dia' };
  const occurrenceKey = 'plan_1:2026-09-28';
  const occurrenceDate = new Date(2026, 8, 28); // 28 de septiembre de 2026
  const completo = (over) => ({ equipmentId: 'e1', details: [{ pointId: 'p1', done: true }], operationalSnapshot: {}, ...over });
  const parcial = (over) => ({ equipmentId: 'e1', details: [{ pointId: 'p1', done: false }], operationalSnapshot: {}, ...over });

  it('A. único record COMPLETE ese día -> MATCH', () => {
    const rec = completo({ id: 'greg_1', date: '2026-09-28T14:00:00.000Z' });
    const r = findMatchingGreaseRecordForOccurrence({ plan: planDT, occurrenceKey, occurrenceDate, records: [rec], assignments: [], skips: [] });
    expect(r.status).toBe('MATCH');
    expect(r.records).toEqual([rec]);
  });

  it('B. 2+ records COMPLETE plausibles ese día -> AMBIGUOUS, nunca elige uno arbitrariamente', () => {
    const rec1 = completo({ id: 'greg_1', date: '2026-09-28T08:00:00.000Z', userName: 'Ana' });
    const rec2 = completo({ id: 'greg_2', date: '2026-09-28T20:00:00.000Z', userName: 'Luis' });
    const r = findMatchingGreaseRecordForOccurrence({ plan: planDT, occurrenceKey, occurrenceDate, records: [rec1, rec2], assignments: [], skips: [] });
    expect(r.status).toBe('AMBIGUOUS');
    expect(r.records).toHaveLength(2);
  });

  it('C. sin ningún record ese día -> NONE, nunca vincula nada', () => {
    const recOtroDia = completo({ id: 'greg_1', date: '2026-09-20T08:00:00.000Z' });
    const r = findMatchingGreaseRecordForOccurrence({ plan: planDT, occurrenceKey, occurrenceDate, records: [recOtroDia], assignments: [], skips: [] });
    expect(r.status).toBe('NONE');
    expect(r.records).toEqual([]);
  });

  it('D. record PARTIAL ese día -> NUNCA satisface (excluido del todo, no solo "downgradeado")', () => {
    const rec = parcial({ id: 'greg_1', date: '2026-09-28T08:00:00.000Z' });
    const r = findMatchingGreaseRecordForOccurrence({ plan: planDT, occurrenceKey, occurrenceDate, records: [rec], assignments: [], skips: [] });
    expect(r.status).toBe('NONE');
  });

  it('E. un record ya vinculado a OTRO skip (linkedRecordId) nunca vuelve a calificar — un record no cierra dos ocurrencias', () => {
    const rec = completo({ id: 'greg_1', date: '2026-09-28T08:00:00.000Z' });
    const otroSkipYaVinculado = { id: 'skip_previo', linkedRecordId: 'greg_1' };
    const r = findMatchingGreaseRecordForOccurrence({ plan: planDT, occurrenceKey, occurrenceDate, records: [rec], assignments: [], skips: [otroSkipYaVinculado] });
    expect(r.status).toBe('NONE');
  });

  it('F1. OUT_OF_PLAN cuya satisfiedOccurrenceKey YA apunta a esta ocurrencia -> MATCH (certificado por la regla existente, no por fecha)', () => {
    const rec = completo({
      id: 'greg_1', date: '2026-09-15T08:00:00.000Z', // fecha DISTINTA a propósito
      operationalSnapshot: { executionType: 'OUT_OF_PLAN', satisfiedOccurrenceKey: occurrenceKey }
    });
    const r = findMatchingGreaseRecordForOccurrence({ plan: planDT, occurrenceKey, occurrenceDate, records: [rec], assignments: [], skips: [] });
    expect(r.status).toBe('MATCH');
  });

  it('F2. OUT_OF_PLAN de la fecha correcta pero SIN satisfiedOccurrenceKey (o apuntando a otra) -> nunca cuenta solo por la fecha', () => {
    const rec = completo({
      id: 'greg_1', date: '2026-09-28T08:00:00.000Z',
      operationalSnapshot: { executionType: 'OUT_OF_PLAN', satisfiedOccurrenceKey: 'plan_1:2026-09-21' }
    });
    const r = findMatchingGreaseRecordForOccurrence({ plan: planDT, occurrenceKey, occurrenceDate, records: [rec], assignments: [], skips: [] });
    expect(r.status).toBe('NONE');
  });

  it('G. assignment COMPLETED de esta ocurrencia -> MATCH vía ASSIGNMENT, con prioridad sobre el match por fecha', () => {
    const recAsignado = completo({ id: 'greg_asignado', date: '2026-09-01T08:00:00.000Z' }); // fecha distinta, no importa
    const recOtroDelDia = completo({ id: 'greg_otro', date: '2026-09-28T08:00:00.000Z' }); // este SÍ calificaría por fecha
    const asg = { occurrenceKey, status: 'COMPLETED', completedRecordId: 'greg_asignado' };
    const r = findMatchingGreaseRecordForOccurrence({ plan: planDT, occurrenceKey, occurrenceDate, records: [recAsignado, recOtroDelDia], assignments: [asg], skips: [] });
    expect(r.status).toBe('MATCH');
    expect(r.via).toBe('ASSIGNMENT');
    expect(r.records).toEqual([recAsignado]);
  });

  it('planes "Horas de operación" SIEMPRE van a conciliación manual — nunca se intenta un match automático (sin fecha discreta que proyectar)', () => {
    const planHoras = { id: 'plan_2', equipmentId: 'e1', controlType: 'Horas de operación', frequency: 250 };
    const rec = completo({ id: 'greg_1', date: '2026-09-28T08:00:00.000Z' });
    const r = findMatchingGreaseRecordForOccurrence({ plan: planHoras, occurrenceKey: 'plan_2:h:0', occurrenceDate, records: [rec], assignments: [], skips: [] });
    expect(r.status).toBe('NONE');
  });

  it('GREASE_MATCH_STATUS expone las 3 claves reales usadas', () => {
    expect(GREASE_MATCH_STATUS).toEqual({ MATCH: 'MATCH', AMBIGUOUS: 'AMBIGUOUS', NONE: 'NONE' });
  });
});
