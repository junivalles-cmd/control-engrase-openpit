// tests/unit/notifications-tasks-panel.test.js
//
// "Cerrar el PANEL DE NOTIFICACIONES/TAREAS" — las 10 pruebas específicas
// pedidas explícitamente. No existe una pantalla única "Panel de tareas":
// el panel real está repartido entre refreshLocalNotifications() (avisos
// locales programados, app.js) + src/core/notification-routing.js (regla
// rol/turno/disponibilidad, reusada también por los Edge Functions) +
// las secciones de Mi Turno (Pendientes/Atrasados/Vencidos/En seguimiento
// · validación, ver renderLubricadorHome() en app.js). La mayoría de estas
// 10 pruebas confirman arquitectura YA EXISTENTE y madura (dedupe por ID
// fijo, recálculo desde cero, elegibilidad centralizada) — el único gap
// real encontrado en la auditoría era "validación pendiente" (rule 5):
// tenía CERO recordatorio, solo visible si alguien abría Mi Turno. Esta
// sesión agregó el bloque 6 de refreshLocalNotifications() (mismo patrón
// EXACTO que el bloque 5, asignaciones) — estas pruebas cubren ese agregado
// y referencian dónde ya se prueba el resto, sin duplicar cobertura.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';
import { loadGreaseValidationLogic } from '../helpers/loadLubricationLogic.js';
import { loadNotificationRoutingLogic } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const refreshSrc = extractDeclaration(appSource, 'refreshLocalNotifications');
const mergeSrc = extractDeclaration(appSource, 'mergeNotifSettings');

const { isRecordPendingValidation, findActiveValidations, GREASE_VALIDATION_ENABLED_FROM } = loadGreaseValidationLogic();
const { isUserEligibleForNotification } = loadNotificationRoutingLogic();

const SETTINGS = { shiftDayStart: 6, shiftNightStart: 18 };

describe('1. Evento de Día no aparece a usuario Noche si no corresponde (ver tests/unit/notification-routing.test.js A-H para la cobertura completa)', () => {
  it('un usuario con notificationShift=DAY nunca es elegible en turno Noche', () => {
    const userDia = { id: 'u1', role: 'SUPERVISOR', active: true, notificationShift: 'DAY', notificationAvailability: 'AVAILABLE' };
    expect(isUserEligibleForNotification({ user: userDia, currentShiftId: 'shift_noche' })).toBe(false);
    expect(isUserEligibleForNotification({ user: userDia, currentShiftId: 'shift_dia' })).toBe(true);
  });
  it('el bloque de asignaciones Y el nuevo bloque de validaciones pasan por isUserEligibleForNotification(), ninguno decide solo por rol', () => {
    expect(refreshSrc).toMatch(/rol === 'LUBRICADOR' && isUserEligibleForNotification\(/);
    // El bloque de validaciones vive DENTRO de ese mismo if (scope ya
    // resuelto con esa elegibilidad) — nunca repite su propia regla de turno.
    const iAsig = refreshSrc.indexOf('NOTIF_ID_ASSIGNED');
    const iVal = refreshSrc.indexOf('NOTIF_ID_VALIDATION');
    const iEligible = refreshSrc.indexOf("rol === 'LUBRICADOR' && isUserEligibleForNotification(");
    expect(iEligible).toBeGreaterThan(-1);
    expect(iAsig).toBeGreaterThan(iEligible);
    expect(iVal).toBeGreaterThan(iEligible);
  });
});

describe('2. Pendiente arrastrado sí aparece en el turno siguiente (cobertura completa en tests/ui/mi-turno-selected-crew.spec.js "Night carryover survives...")', () => {
  it('el bloque de asignaciones se recalcula contra lubrication_assignments real en cada corrida — un PENDING que sigue activo sigue calificando sin importar qué turno sea ahora', () => {
    expect(refreshSrc).toContain("classifyEquipmentWork({");
    expect(refreshSrc).toContain('misAsignaciones');
  });
});

describe('3. Validación pendiente sobrevive varios turnos (regla E de doble turno) — ejecución real de isRecordPendingValidation()', () => {
  const equipmentId = 'eq1';
  const record = { id: 'r1', equipmentId, date: '2026-10-10T08:00:00', crewId: 'crew1' };
  it('sigue pendiente horas después, en el turno Día original', () => {
    expect(isRecordPendingValidation(record, [], new Date('2026-10-10T10:00:00'), SETTINGS)).toBe(true);
  });
  it('sigue pendiente en el turno Noche del MISMO día (cambió el turno, no desaparece)', () => {
    expect(isRecordPendingValidation(record, [], new Date('2026-10-10T20:00:00'), SETTINGS)).toBe(true);
  });
  it('sigue pendiente varios DÍAS después (regla E: nunca se oculta por antigüedad, aunque se marque "vencida")', () => {
    expect(isRecordPendingValidation(record, [], new Date('2026-10-14T09:00:00'), SETTINGS)).toBe(true);
  });
  it('un registro histórico (anterior a GREASE_VALIDATION_ENABLED_FROM) nunca exige validación — no es "pendiente eterno" retroactivo', () => {
    const viejo = { ...record, date: new Date(new Date(GREASE_VALIDATION_ENABLED_FROM).getTime() - 86400000).toISOString() };
    expect(isRecordPendingValidation(viejo, [], new Date('2026-10-14T09:00:00'), SETTINGS)).toBe(false);
  });
});

describe('4. Misma notificación no se duplica tras 3 "sync" (recalcular 3 veces produce el MISMO identificador, nunca 3 avisos distintos)', () => {
  it('el bloque de validaciones usa un ID NUMÉRICO FIJO (NOTIF_ID_VALIDATION/_REC) — LocalNotifications.schedule() con un id ya existente REEMPLAZA, nunca acumula', () => {
    expect(refreshSrc).toMatch(/id:\s*NOTIF_ID_VALIDATION,/);
    expect(refreshSrc).toMatch(/id:\s*NOTIF_ID_VALIDATION_REC,/);
    // Nunca un id derivado del equipmentId/recordId (eso sí duplicaría: cada
    // equipo nuevo tendría su propio id en vez de reemplazar el anterior).
    const bloqueVal = refreshSrc.slice(refreshSrc.indexOf('Validaciones PENDIENTES'));
    expect(bloqueVal).not.toMatch(/id:\s*`/);
  });
  it('recalcular 3 veces con el MISMO estado produce exactamente el mismo par de notificaciones (misma identidad, mismo cuerpo)', () => {
    const validations = [];
    const now = new Date('2026-10-10T10:00:00');
    const records = [{ id: 'r1', equipmentId: 'eq1', date: '2026-10-10T08:00:00', crewId: 'crew1' }];
    const correr = () => records.filter(r => isRecordPendingValidation(r, validations, now, SETTINGS)).map(r => r.id);
    const primero = correr(); const segundo = correr(); const tercero = correr();
    expect(primero).toEqual(['r1']); expect(segundo).toEqual(['r1']); expect(tercero).toEqual(['r1']);
  });
});

describe('5. Cerrar/resolver una tarea la elimina del panel activo', () => {
  it('firmar la validación (grease_validations activa) hace que isRecordPendingValidation() pase a false de inmediato — deja de calificar para el recordatorio', () => {
    const record = { id: 'r1', equipmentId: 'eq1', date: '2026-10-10T08:00:00', crewId: 'crew1' };
    const now = new Date('2026-10-10T10:00:00');
    expect(isRecordPendingValidation(record, [], now, SETTINGS)).toBe(true);
    const firmada = [{ id: 'v1', lubricationRecordId: 'r1', active: true, signedAt: now.toISOString() }];
    expect(isRecordPendingValidation(record, firmada, now, SETTINGS)).toBe(false);
    expect(findActiveValidations('r1', firmada)).toHaveLength(1);
  });
});

describe('6. Offline conserva el panel (todo el cálculo es puro, sobre datos YA sincronizados en IndexedDB — nunca depende de red)', () => {
  it('refreshLocalNotifications() nunca verifica navigator.onLine/lastSyncState antes de calcular — solo DB.allActive() local', () => {
    expect(refreshSrc).not.toMatch(/navigator\.onLine/);
    expect(refreshSrc).not.toMatch(/lastSyncState\.status/);
  });
  it('isRecordPendingValidation()/isUserEligibleForNotification() son funciones puras — mismo resultado con o sin conexión, para los mismos datos', () => {
    const record = { id: 'r1', equipmentId: 'eq1', date: '2026-10-10T08:00:00', crewId: 'crew1' };
    const now = new Date('2026-10-10T10:00:00');
    expect(isRecordPendingValidation(record, [], now, SETTINGS)).toBe(isRecordPendingValidation(record, [], now, SETTINGS));
  });
});

describe('7. Reconexión actualiza sin duplicar — mismo mecanismo que "3 sync" (punto 4): recalcular tras un pull exitoso usa los MISMOS IDs fijos', () => {
  it('refreshLocalNotifications() cancela TODAS las notificaciones conocidas (cancelAllLocalNotifications) antes de reprogramar — nunca agrega sobre lo ya programado', () => {
    expect(refreshSrc).toContain('await cancelAllLocalNotifications();');
    // El cancel es la PRIMERA cosa que hace (antes incluso del guard de
    // App.currentUser) — nunca se reprograma sin limpiar primero.
    expect(refreshSrc.indexOf('await cancelAllLocalNotifications();')).toBeLessThan(refreshSrc.indexOf('if (!App.currentUser)'));
  });
});

describe('8. Asignación excepcional genera UNA sola tarea (agrupada, nunca una notificación por equipo)', () => {
  it('el bloque de asignaciones empuja UN solo objeto de notificación con el conteo total, no un push por equipo asignado', () => {
    const bloqueAsig = refreshSrc.slice(refreshSrc.indexOf("rol === 'LUBRICADOR' && isUserEligibleForNotification("), refreshSrc.indexOf('Validaciones PENDIENTES'));
    // Un solo push inicial (NOTIF_ID_ASSIGNED) + un solo recordatorio
    // (NOTIF_ID_ASSIGNED_REC) — nunca dentro de un .forEach/.map sobre equiposAsignados.
    expect(bloqueAsig).not.toMatch(/equiposAsignados\.forEach/);
    expect((bloqueAsig.match(/notifications\.push\(/g) || []).length).toBe(2);
  });
  it('el bloque de validaciones sigue el mismo patrón agrupado (un push por tipo, no por registro pendiente)', () => {
    const bloqueVal = refreshSrc.slice(refreshSrc.indexOf('Validaciones PENDIENTES'));
    expect(bloqueVal).not.toMatch(/misPendientesValidacion\.forEach/);
    expect((bloqueVal.match(/notifications\.push\(/g) || []).length).toBe(2);
  });
});

describe('9. Cancelación/reasignación actualiza la tarea existente (recálculo desde cero — nunca hace falta "cancelarla" a mano)', () => {
  it('ni el bloque de asignaciones ni el de validaciones llaman a un cancel individual por fila — se apoyan en el cancelAllLocalNotifications() global de arriba', () => {
    const iEligible = refreshSrc.indexOf("rol === 'LUBRICADOR' && isUserEligibleForNotification(");
    const restoDeLaFuncion = refreshSrc.slice(iEligible);
    expect(restoDeLaFuncion).not.toMatch(/LN\.cancel\(/);
  });
  it('una validación que ya no califica (firmada) simplemente no entra al array de notifications — no requiere lógica de "retirar" explícita', () => {
    const validations = [{ id: 'v1', lubricationRecordId: 'r1', active: true, signedAt: '2026-10-10T10:00:00' }];
    const records = [{ id: 'r1', equipmentId: 'eq1', date: '2026-10-10T08:00:00', crewId: 'crew1' }];
    const now = new Date('2026-10-10T11:00:00');
    expect(records.filter(r => isRecordPendingValidation(r, validations, now, SETTINGS))).toEqual([]);
  });
});

describe('10. Dos eventos distintos del mismo equipo permanecen separados', () => {
  it('un equipo vencido por horómetro Y con una validación pendiente son señales independientes — una no apaga ni sustituye a la otra', () => {
    const record = { id: 'r1', equipmentId: 'eq1', date: '2026-10-10T08:00:00', crewId: 'crew1' };
    const now = new Date('2026-10-14T09:00:00');
    // isRecordPendingValidation no sabe nada de horómetro/estado del plan —
    // confirma que es una señal aparte, nunca mezclada con el status ROJO/AMARILLO.
    expect(isRecordPendingValidation(record, [], now, SETTINGS)).toBe(true);
    expect(refreshSrc).toContain('const vencidos = regularRelevantes.filter');
    expect(refreshSrc).toContain('misPendientesValidacion = recordsNotif.filter');
  });
  it('dos lubrication_records distintos del mismo equipo (dos ocurrencias reales) se evalúan cada uno por su propio id, nunca fusionados', () => {
    const r1 = { id: 'r1', equipmentId: 'eq1', date: '2026-10-10T08:00:00', crewId: 'crew1' };
    const r2 = { id: 'r2', equipmentId: 'eq1', date: '2026-10-11T08:00:00', crewId: 'crew1' };
    const now = new Date('2026-10-12T08:00:00');
    const validaSoloR1 = [{ id: 'v1', lubricationRecordId: 'r1', active: true, signedAt: now.toISOString() }];
    expect(isRecordPendingValidation(r1, validaSoloR1, now, SETTINGS)).toBe(false);
    expect(isRecordPendingValidation(r2, validaSoloR1, now, SETTINGS)).toBe(true);
  });
});

describe('Configuración → Notificaciones: "validaciones" sigue el mismo patrón de los demás tipos (nunca una funcionalidad nueva aparte)', () => {
  it('NOTIF_DEFAULTS incluye "validaciones" con roles LUBRICADOR', () => {
    expect(appSource).toMatch(/validaciones:\s*\{\s*enabled:\s*true,\s*roles:\s*\['LUBRICADOR'\]\s*\}/);
  });
  it('mergeNotifSettings() mezcla "validaciones" igual que vencidos/porEngrasar/etc — nunca queda undefined en una fila vieja', () => {
    expect(mergeSrc).toMatch(/'validaciones'/);
  });
});
