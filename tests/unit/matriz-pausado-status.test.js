// tests/unit/matriz-pausado-status.test.js
//
// Matriz Semanal — LOTE COMBINADO (Historial + Plan/Matriz):
//  B.1/B.2 prioridad día/turno > horas > sin plan (día/turno nunca consulta
//    horómetro/frecuencia — son campos exclusivos del plan por horas).
//  B.5 filtro Ubicación ya existente (regresión, no se reinventó).
//  B.7/B.8 equipo no operativo (Detenido/En mantenimiento/Fuera de servicio)
//    con plan día/turno → celda PAUSADA (gris), nunca NO REALIZADO/PENDIENTE/
//    futuro inventado; un registro real ya existente NUNCA se oculta; equipo
//    Operativo sigue con el comportamiento normal, sin cambios.
//
// Ejecuta la función REAL estadoCelda() (src/core/weekly-matrix.js) — no
// reimplementa la lógica a mano.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, loadWeeklyMatrixLogic, WEEKLY_MATRIX_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const weeklyMatrixSource = readSource(WEEKLY_MATRIX_JS_PATH);

describe('B.1/B.2 — prioridad día/turno > horas: día/turno nunca consulta horas', () => {
  it('estadoCelda() no referencia hourmeter/frequency (campos exclusivos del plan por horas)', () => {
    expect(weeklyMatrixSource).not.toMatch(/hourmeter/);
    expect(weeklyMatrixSource).not.toMatch(/frequency/);
  });
  it('solo usa assignedDays del plan (día/turno) — un plan por horas sin assignedDays queda "vacio"', () => {
    const { estadoCelda } = loadWeeklyMatrixLogic();
    const hoy = new Date('2026-09-24T00:00:00');
    const planPorHoras = [{ equipmentId: 'eq1', controlType: 'Horas de operación', frequency: 250, lastGreaseHour: 100 }];
    const r = estadoCelda({ id: 'eq1', status: 'Operativo' }, hoy, planPorHoras, [], hoy);
    expect(r.tipo).toBe('vacio'); // sin assignedDays, no participa en la Matriz
  });
});

describe('B.5 — filtro Ubicación (regresión, ya existente)', () => {
  const src = extractDeclaration(appSource, 'renderMatrizSemanal');
  it('sigue presente el <select> de Ubicación con "Todas" + ubicaciones reales', () => {
    expect(src).toContain('id="mtz-ubic"');
    expect(src).toContain('>Todas</option>');
    expect(src).toContain('locations.map(l =>');
  });
  it('el filtro se aplica sobre `visibles` por locationId', () => {
    expect(src).toMatch(/filtroUbic && e\.locationId !== filtroUbic/);
  });
});

describe('B.7/B.8 — PAUSADO para equipo no operativo, normal para Operativo', () => {
  const { estadoCelda } = loadWeeklyMatrixLogic();
  const hoy = new Date('2026-09-24T00:00:00'); // jueves
  const plans = [{ equipmentId: 'eq1', assignedDays: ['Jueves'] }];

  it.each(['Detenido', 'En mantenimiento', 'Fuera de servicio'])(
    'status "%s" + día asignado + sin registro → pausado (no NO REALIZADO)',
    (status) => {
      const r = estadoCelda({ id: 'eq1', status }, hoy, plans, [], hoy);
      expect(r.tipo).toBe('pausado');
      expect(r.status).toBe(status);
    }
  );

  it('pausado también en días PASADOS (no se inventa historial retroactivo de "no realizado")', () => {
    const pasado = new Date('2026-09-17T00:00:00');
    const r = estadoCelda({ id: 'eq1', status: 'Detenido' }, pasado, [{ equipmentId: 'eq1', assignedDays: ['Jueves'] }], [], hoy);
    expect(r.tipo).toBe('pausado');
  });

  it('pausado también en días FUTUROS (no acumula proyección mientras está detenido)', () => {
    const futuro = new Date('2026-10-01T00:00:00');
    const r = estadoCelda({ id: 'eq1', status: 'Detenido' }, futuro, [{ equipmentId: 'eq1', assignedDays: ['Jueves'] }], [], hoy);
    expect(r.tipo).toBe('pausado');
  });

  it('un registro REAL ya existente nunca se oculta, aunque el equipo esté detenido', () => {
    const records = [{ equipmentId: 'eq1', date: '2026-09-24T09:00:00', userName: 'Juan' }];
    const r = estadoCelda({ id: 'eq1', status: 'Detenido' }, hoy, plans, records, hoy);
    expect(r.tipo).toBe('hecho');
  });

  it('equipo Operativo: comportamiento normal sin cambios (pendiente/no_realizado/futuro)', () => {
    const rHoy = estadoCelda({ id: 'eq1', status: 'Operativo' }, hoy, plans, [], hoy);
    expect(rHoy.tipo).toBe('pendiente');
    const pasado = new Date('2026-09-17T00:00:00');
    const rPasado = estadoCelda({ id: 'eq1', status: 'Operativo' }, pasado, [{ equipmentId: 'eq1', assignedDays: ['Jueves'] }], [], hoy);
    expect(rPasado.tipo).toBe('no_realizado');
  });

  it('sin campo status (compatibilidad hacia atrás): comportamiento normal, no rompe', () => {
    const r = estadoCelda({ id: 'eq1' }, hoy, plans, [], hoy);
    expect(r.tipo).toBe('pendiente');
  });

  it('Domingo + pausado combinados: mismo comportamiento que cualquier otro día', () => {
    const domingo = new Date('2026-09-27T00:00:00');
    const planDomingo = [{ equipmentId: 'eq1', assignedDays: ['Domingo'] }];
    const r = estadoCelda({ id: 'eq1', status: 'En mantenimiento' }, domingo, planDomingo, [], hoy);
    expect(r.tipo).toBe('pausado');
  });
});

describe('renderMatrizSemanal() — renderiza la celda PAUSADO y su KPI', () => {
  const src = extractDeclaration(appSource, 'renderMatrizSemanal');
  it('mapea tipo "pausado" a la clase .celda-pausado con texto PAUSADO', () => {
    expect(src).toContain("s.tipo === 'pausado'");
    expect(src).toContain('celda-pausado');
    expect(src).toContain('PAUSADO');
  });
  it('agrega el KPI de pausados al grid', () => {
    expect(src).toContain("const pausadas = contar('pausado');");
    expect(src).toContain("kpiCard('PAUSADOS', pausadas");
  });
});
