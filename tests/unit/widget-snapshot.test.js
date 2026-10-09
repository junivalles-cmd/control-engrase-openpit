// tests/unit/widget-snapshot.test.js
//
// Pedido "WIDGET ANDROID + PALETA CORPORATIVA FINAL + MODO SOL"
// (2026-10-09), Parte A — buildWidgetSnapshot() (src/core/widget-snapshot.js)
// es la ÚNICA función que decide la forma exacta del snapshot que se
// envía al plugin nativo (WidgetBridgePlugin). Pura, sin DOM/DB — los
// NÚMEROS reales (Atrasados/Mi Turno/Realizados) ya se calculan en
// renderLubricadorHome() (nunca aquí, §4: "NO duplicar lógica en
// Android") — ver tests/ui/lubricador-mi-turno-real-execution.spec.js
// para la integración real end-to-end.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';

const src = readSource('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/widget-snapshot.js');
const fnSrc = extractDeclaration(src, 'buildWidgetSnapshot');
const buildWidgetSnapshot = new Function(`${fnSrc}\nreturn buildWidgetSnapshot;`)();

describe('buildWidgetSnapshot() — forma mínima exacta (§4/§20.A del pedido)', () => {
  it('A. arma el snapshot del turno con los 6 campos pedidos, nada más', () => {
    const now = new Date('2026-10-09T14:05:00.000Z');
    const snap = buildWidgetSnapshot({
      locationName: 'Volcán', turnoLabel: 'Día', overdueCount: 2, pendingCount: 4, completedCount: 3,
      equipmentCodes: ['45-77', 'A11', '25-46'], now,
    });
    expect(snap).toEqual({
      location: 'Volcán', shift: 'Día', overdue: 2, pending: 4, completed: 3,
      equipment: ['45-77', 'A11', '25-46'], updatedAt: '2026-10-09T14:05:00.000Z',
    });
  });

  it('recorta equipment a 3 aunque el caller pase más (nunca confía en que ya viene recortado)', () => {
    const snap = buildWidgetSnapshot({ equipmentCodes: ['T-01', 'T-02', 'T-03', 'T-04', 'T-05'] });
    expect(snap.equipment).toEqual(['T-01', 'T-02', 'T-03']);
  });

  it('nunca incluye JWT/contraseña/PIN/refresh token/apikey ni más campos que los 6 pedidos', () => {
    const snap = buildWidgetSnapshot({ locationName: 'Volcán', turnoLabel: 'Día', overdueCount: 1, pendingCount: 1, completedCount: 1, equipmentCodes: ['T-01'] });
    expect(Object.keys(snap).sort()).toEqual(['completed', 'equipment', 'location', 'overdue', 'pending', 'shift', 'updatedAt'].sort());
  });

  it('sin equipos pendientes, equipment queda como arreglo vacío (nunca null/undefined)', () => {
    const snap = buildWidgetSnapshot({ equipmentCodes: [] });
    expect(snap.equipment).toEqual([]);
  });

  it('sin ubicación/cuadrilla (NO_CREW_ASSIGNED), location/shift quedan null, nunca "undefined" como texto', () => {
    const snap = buildWidgetSnapshot({ locationName: undefined, turnoLabel: undefined, equipmentCodes: [] });
    expect(snap.location).toBeNull();
    expect(snap.shift).toBeNull();
  });

  it('contadores no finitos (undefined/NaN) caen a 0, nunca NaN/undefined en el snapshot', () => {
    const snap = buildWidgetSnapshot({ overdueCount: undefined, pendingCount: NaN, completedCount: undefined, equipmentCodes: [] });
    expect(snap.overdue).toBe(0);
    expect(snap.pending).toBe(0);
    expect(snap.completed).toBe(0);
  });

  it('updatedAt es un ISO real (Date.toISOString()), no un timestamp numérico ni un formato propio', () => {
    const snap = buildWidgetSnapshot({ equipmentCodes: [], now: new Date('2026-01-01T00:00:00.000Z') });
    expect(snap.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
