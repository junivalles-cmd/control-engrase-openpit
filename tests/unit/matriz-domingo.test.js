// tests/unit/matriz-domingo.test.js
//
// Matriz Semanal — Domingo como 7° día, con el mismo comportamiento que
// Lun-Sáb. Dos niveles de prueba:
//  1) Fuente: SCHEDULE_WEEKDAYS ahora incluye 'Domingo' (afecta el picker de
//     días asignados Y el filtro "Día asignado" del Dashboard, una sola
//     fuente para los 3 usos — ver app.js:1056) y renderMatrizSemanal() genera
//     7 días (no 6) usando dias[6] como último día, no dias[5].
//  2) Ejecución real: estadoCelda()/WEEKDAY_NAMES (src/core/weekly-matrix.js,
//     src/core/lubrication-status.js) YA eran genéricos por día de semana —
//     esta prueba confirma con la función REAL que un equipo asignado a
//     Domingo se comporta exactamente igual (hecho/no_realizado/pendiente/
//     futuro) que uno asignado a cualquier otro día, sin reimplementar la
//     lógica a mano.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, loadWeeklyMatrixLogic } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);

describe('SCHEDULE_WEEKDAYS — fuente única para picker de días y filtro', () => {
  const src = extractDeclaration(appSource, 'SCHEDULE_WEEKDAYS');

  it('incluye Domingo', () => {
    expect(src).toContain("'Domingo'");
  });

  it('tiene los 7 días, Lunes primero y Domingo al final (mismo orden pedido para la matriz)', () => {
    const days = JSON.parse(src.replace(/^const SCHEDULE_WEEKDAYS = /, '').replace(/;\s*$/, '').replace(/'/g, '"'));
    expect(days).toEqual(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']);
  });
});

describe('renderMatrizSemanal() — genera 7 días, no 6', () => {
  const src = extractDeclaration(appSource, 'renderMatrizSemanal');

  it('el bucle de días llega hasta 7 (antes 6)', () => {
    expect(src).toContain('for (let i = 0; i < 7; i++)');
    expect(src).not.toContain('for (let i = 0; i < 6; i++)');
  });

  it('ya no queda ninguna referencia a dias[5] como último día (debe ser dias[6])', () => {
    expect(src).not.toContain('dias[5]');
  });

  it('usa dias[6] consistentemente (rango mostrado, título de impresión, Excel)', () => {
    const count = (src.match(/dias\[6\]/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(4); // finSemana + rango + título impresión + título Excel + nombre archivo
  });
});

describe('estadoCelda() real — Domingo se comporta igual que cualquier otro día', () => {
  const { estadoCelda } = loadWeeklyMatrixLogic();
  const hoy = new Date('2026-09-27T00:00:00'); // 2026-09-27 es domingo
  const eq = { id: 'eq1' };

  it('domingo con registro de engrase → hecho (igual que un día entre semana)', () => {
    const plans = [{ equipmentId: 'eq1', assignedDays: ['Domingo'] }];
    const records = [{ equipmentId: 'eq1', date: '2026-09-27T08:00:00', userName: 'Juan' }];
    const r = estadoCelda(eq, hoy, plans, records, hoy);
    expect(r.tipo).toBe('hecho');
  });

  it('domingo sin registro y es HOY → pendiente', () => {
    const plans = [{ equipmentId: 'eq1', assignedDays: ['Domingo'] }];
    const r = estadoCelda(eq, hoy, plans, [], hoy);
    expect(r.tipo).toBe('pendiente');
  });

  it('domingo pasado sin registro → no_realizado, con días de atraso calculados', () => {
    const plans = [{ equipmentId: 'eq1', assignedDays: ['Domingo'] }];
    const domingoPasado = new Date('2026-09-20T00:00:00');
    const r = estadoCelda(eq, domingoPasado, plans, [], hoy);
    expect(r.tipo).toBe('no_realizado');
    expect(r.diasAtras).toBe(7);
  });

  it('domingo futuro → futuro', () => {
    const plans = [{ equipmentId: 'eq1', assignedDays: ['Domingo'] }];
    const domingoFuturo = new Date('2026-10-04T00:00:00');
    const r = estadoCelda(eq, domingoFuturo, plans, [], hoy);
    expect(r.tipo).toBe('futuro');
  });

  it('equipo NO asignado a domingo → vacío ese día (igual que cualquier día no asignado)', () => {
    const plans = [{ equipmentId: 'eq1', assignedDays: ['Lunes'] }];
    const r = estadoCelda(eq, hoy, plans, [], hoy);
    expect(r.tipo).toBe('vacio');
  });
});
