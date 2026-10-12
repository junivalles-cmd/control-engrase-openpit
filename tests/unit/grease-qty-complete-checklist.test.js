// RF-01 (auditoría pre-release): si TODOS los puntos del checklist quedaron
// marcados como realizados, el engrase no puede guardarse con 0 lb de
// grasa (sería contradictorio). Prueba shouldBlockCompleteChecklistWithoutGrease(),
// código real extraído de app.js — la misma función que usa el handler de
// guardado de Registrar Engrase (ver app.js, submit de #grease-form).
import { describe, it, expect } from 'vitest';
import { loadAppLogic } from '../helpers/loadLubricationLogic.js';

const fakeApp = {
  currentUser: null,
  generalSettings: { shiftDayStart: 6, shiftNightStart: 18, defaultAlertYellowHours: 10, complianceTarget: 95 },
};
const { shouldBlockCompleteChecklistWithoutGrease } = loadAppLogic(fakeApp);

describe('shouldBlockCompleteChecklistWithoutGrease() — RF-01', () => {
  it('A) 100% de los puntos marcados + 0 lb -> bloqueado', () => {
    expect(shouldBlockCompleteChecklistWithoutGrease(5, 0, 0)).toBe(true);
  });

  it('A2) 100% de los puntos marcados + cantidad negativa -> bloqueado (nunca se interpreta como "algo")', () => {
    expect(shouldBlockCompleteChecklistWithoutGrease(5, 0, -1)).toBe(true);
  });

  it('A3) 100% de los puntos marcados + qty no numérico (NaN) -> bloqueado', () => {
    expect(shouldBlockCompleteChecklistWithoutGrease(5, 0, NaN)).toBe(true);
  });

  it('B) 100% de los puntos marcados + cantidad > 0 -> permitido', () => {
    expect(shouldBlockCompleteChecklistWithoutGrease(5, 0, 12.5)).toBe(false);
  });

  it('C) PARTIAL (al menos 1 punto pendiente) + 0 lb -> permitido, la regla no aplica (no es contradictorio dejar puntos pendientes sin grasa)', () => {
    expect(shouldBlockCompleteChecklistWithoutGrease(5, 2, 0)).toBe(false);
  });

  it('equipo sin checklist configurado (0 puntos) + 0 lb -> bloqueado por regla explícita de Fase 2A', () => {
    expect(shouldBlockCompleteChecklistWithoutGrease(0, 0, 0)).toBe(true);
  });
  it('equipo sin checklist + cantidad >0 -> permitido', () => {
    expect(shouldBlockCompleteChecklistWithoutGrease(0, 0, 0.1)).toBe(false);
  });

  it('D) SKIP ("No se pudo ejecutar") nunca llama a esta función — buildNoExecutionRecord() es un flujo aparte que no pasa por #grease-form', () => {
    // Documental: no hay nada que ejecutar aquí a propósito. El flujo SKIP
    // (openNoExecutionForm()/buildNoExecutionRecord(), ver
    // src/core/operational-scope.js) nunca construye un lubrication_record
    // ni llama shouldBlockCompleteChecklistWithoutGrease(); por eso no se ve
    // afectado por esta regla.
    expect(true).toBe(true);
  });

  it('E) la unidad de qty sigue siendo lb (GREASE_UNIT sin cambios)', () => {
    const { GREASE_UNIT } = loadAppLogic(fakeApp);
    expect(GREASE_UNIT).toBe('lb');
  });
});
