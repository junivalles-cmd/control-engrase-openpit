// Prioridad Paso 7 #18 (parcial): estado del plan por "Día y turno de la
// semana", que alimenta la Matriz Semanal. Prueba weekdayStatusFor(), código
// real extraído de app.js. Fecha fija: miércoles 2026-01-14.
//
// IMPORTANTE — límite de esta cobertura: la función que pinta cada CELDA
// exacta de la grilla (REALIZADO / NO REALIZADO / PENDIENTE HOY / vacío) es
// estadoCelda(), extraída durante la Modularización JS Fase 2 a
// src/core/weekly-matrix.js — ver tests/unit/matriz-estado-celda.test.js
// para su cobertura dedicada. weekdayStatusFor() (probada aquí) cubre la
// misma decisión de negocio (¿le tocaba, se hizo, está vencido?) pero para
// la ficha del equipo y el plan de engrase (Dashboard), no para la Matriz.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadAppLogic } from '../helpers/loadLubricationLogic.js';

const MIERCOLES = new Date(2026, 0, 14, 10, 0, 0);

const fakeApp = {
  currentUser: null,
  generalSettings: { shiftDayStart: 6, shiftNightStart: 18, defaultAlertYellowHours: 10, complianceTarget: 95 },
};
const { weekdayStatusFor, WEEKDAY_NAMES } = loadAppLogic(fakeApp);
const equipo = { id: 'e1' };

describe('weekdayStatusFor() — plan por día/turno de la semana', () => {
  afterEach(() => vi.useRealTimers());

  it('sin días asignados -> SIN DÍAS ASIGNADOS', async () => {
    vi.useFakeTimers(); vi.setSystemTime(MIERCOLES);
    const plan = { id: 'plan-e1', equipmentId: 'e1', assignedDays: [] };
    const r = await weekdayStatusFor(equipo, plan, []);
    expect(r).toMatchObject({ code: 'GRIS', label: 'SIN DÍAS ASIGNADOS' });
  });

  it('hoy es su día asignado y todavía no se registró -> AMARILLO / PROGRAMADO HOY', async () => {
    vi.useFakeTimers(); vi.setSystemTime(MIERCOLES);
    const plan = { id: 'plan-e1', equipmentId: 'e1', assignedDays: [WEEKDAY_NAMES[3]] }; // Miércoles
    const r = await weekdayStatusFor(equipo, plan, []);
    expect(r).toMatchObject({ code: 'AMARILLO', label: 'PROGRAMADO HOY' });
  });

  it('hoy es su día asignado y YA se registró un engrase hoy -> VERDE / AL DÍA (realizado)', async () => {
    vi.useFakeTimers(); vi.setSystemTime(MIERCOLES);
    const plan = { id: 'plan-e1', equipmentId: 'e1', assignedDays: [WEEKDAY_NAMES[3]] };
    const records = [{ equipmentId: 'e1', date: MIERCOLES.toISOString() }];
    const r = await weekdayStatusFor(equipo, plan, records);
    expect(r).toMatchObject({ code: 'VERDE', label: 'AL DÍA' });
  });

  it('su día asignado más reciente fue ayer (Martes) y no se registró -> ROJO / VENCIDO (no realizado)', async () => {
    vi.useFakeTimers(); vi.setSystemTime(MIERCOLES);
    const plan = { id: 'plan-e1', equipmentId: 'e1', assignedDays: [WEEKDAY_NAMES[2]] }; // Martes
    const r = await weekdayStatusFor(equipo, plan, []);
    expect(r).toMatchObject({ code: 'ROJO', label: 'VENCIDO' });
  });

  it('el registro de OTRO equipo no cuenta como realizado', async () => {
    vi.useFakeTimers(); vi.setSystemTime(MIERCOLES);
    const plan = { id: 'plan-e1', equipmentId: 'e1', assignedDays: [WEEKDAY_NAMES[3]] };
    const records = [{ equipmentId: 'otro-equipo', date: MIERCOLES.toISOString() }];
    const r = await weekdayStatusFor(equipo, plan, records);
    expect(r).toMatchObject({ code: 'AMARILLO', label: 'PROGRAMADO HOY' });
  });

  it('reprogramado para HOY, sin registrar todavía -> AMARILLO / REPROGRAMADO PARA HOY', async () => {
    vi.useFakeTimers(); vi.setSystemTime(MIERCOLES);
    const plan = { id: 'plan-e1', equipmentId: 'e1', assignedDays: [], reprogramadoHasta: MIERCOLES.toISOString() };
    const r = await weekdayStatusFor(equipo, plan, []);
    expect(r).toMatchObject({ code: 'AMARILLO', reprogramado: true });
  });

  it('reprogramado para HOY y YA registrado -> VERDE / AL DÍA', async () => {
    vi.useFakeTimers(); vi.setSystemTime(MIERCOLES);
    const plan = { id: 'plan-e1', equipmentId: 'e1', assignedDays: [], reprogramadoHasta: MIERCOLES.toISOString() };
    const records = [{ equipmentId: 'e1', date: MIERCOLES.toISOString() }];
    const r = await weekdayStatusFor(equipo, plan, records);
    expect(r).toMatchObject({ code: 'VERDE', label: 'AL DÍA' });
  });
});
