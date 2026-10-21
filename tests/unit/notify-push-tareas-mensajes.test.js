// tests/unit/notify-push-tareas-mensajes.test.js
//
// "Push real para Tareas y Mensajes" (lote 2026-10-19). Prueba las
// funciones PURAS nuevas de supabase/functions/notify-push/index.ts
// (pushUrgency/crewIdsCoveringLocation) — el resto del archivo (fetch a
// Supabase/OneSignal real) queda fuera de este runner, mismo límite ya
// aceptado para isRecipientEligible() en notify-edge-functions-eligibility.test.js.
// crewIdsCoveringLocation() debe coincidir EXACTAMENTE con la semántica
// LOCATION ya validada en 0017/0018 (broadcast_row_in_scope) — PRINCIPAL/
// APOYO no importan, fallback legacy SOLO sin ninguna fila crew_locations,
// nunca authorizedLocationIds.
import { describe, it, expect } from 'vitest';
import { loadNotifyPushTargeting } from '../helpers/loadLubricationLogic.js';

const { pushUrgency, crewIdsCoveringLocation } = loadNotifyPushTargeting();

describe('pushUrgency() — §4 del pedido: una sola escala 0-10, nunca una 2da paralela', () => {
  it('ALTA (manual_tasks) y CRITICA (broadcast) son prioritarias (10)', () => {
    expect(pushUrgency('ALTA')).toBe(10);
    expect(pushUrgency('CRITICA')).toBe(10);
  });
  it('IMPORTANTE es destacada (7)', () => {
    expect(pushUrgency('IMPORTANTE')).toBe(7);
  });
  it('MEDIA/BAJA/INFORMATIVA/ausente son normales (5)', () => {
    expect(pushUrgency('MEDIA')).toBe(5);
    expect(pushUrgency('BAJA')).toBe(5);
    expect(pushUrgency('INFORMATIVA')).toBe(5);
    expect(pushUrgency(undefined)).toBe(5);
    expect(pushUrgency(null)).toBe(5);
  });
});

describe('crewIdsCoveringLocation() — §3 del pedido: misma semántica validada en 0017/0018', () => {
  it('cuadrilla con fila crew_locations activa para esa ubicación: cubre', () => {
    const cl = [{ crew_id: 'cq1', location_id: 'loc1', active: true }];
    const cq = [{ id: 'cq1', locationId: 'otra-loc' }]; // el legacy, a propósito, NO coincide — no debe importar
    expect(crewIdsCoveringLocation('loc1', cl, cq)).toEqual(new Set(['cq1']));
  });

  it('PRINCIPAL/APOYO no existen como distinción — cualquier fila activa de esa ubicación cubre', () => {
    const cl = [
      { crew_id: 'cq1', location_id: 'loc1', active: true, type: 'PRINCIPAL' },
      { crew_id: 'cq2', location_id: 'loc1', active: true, type: 'APOYO' },
    ];
    expect(crewIdsCoveringLocation('loc1', cl, [])).toEqual(new Set(['cq1', 'cq2']));
  });

  it('fila crew_locations inactiva no cubre', () => {
    const cl = [{ crew_id: 'cq1', location_id: 'loc1', active: false }];
    expect(crewIdsCoveringLocation('loc1', cl, [])).toEqual(new Set());
  });

  it('fallback legacy (cuadrillas.locationId) SOLO si la cuadrilla no tiene NINGUNA fila crew_locations', () => {
    const cl = []; // ninguna fila en absoluto
    const cq = [{ id: 'cq1', locationId: 'loc1', active: true }];
    expect(crewIdsCoveringLocation('loc1', cl, cq)).toEqual(new Set(['cq1']));
  });

  it('una cuadrilla CON filas crew_locations (aunque sean de otra ubicación) NUNCA cae al fallback legacy', () => {
    const cl = [{ crew_id: 'cq1', location_id: 'loc2', active: true }]; // tiene filas, pero de OTRA ubicación
    const cq = [{ id: 'cq1', locationId: 'loc1', active: true }]; // el legacy SÍ apuntaría a loc1
    expect(crewIdsCoveringLocation('loc1', cl, cq)).toEqual(new Set()); // nunca activa el fallback
  });

  it('cuadrilla legacy inactiva no cubre por fallback', () => {
    const cq = [{ id: 'cq1', locationId: 'loc1', active: false }];
    expect(crewIdsCoveringLocation('loc1', [], cq)).toEqual(new Set());
  });

  it('nunca usa un campo authorizedLocationIds como sustituto (aunque exista en la fila, se ignora)', () => {
    const cq = [{ id: 'cq1', locationId: 'otra', authorizedLocationIds: ['loc1'], active: true }];
    expect(crewIdsCoveringLocation('loc1', [], cq)).toEqual(new Set());
  });
});
