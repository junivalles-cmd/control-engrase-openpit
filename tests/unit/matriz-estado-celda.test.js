// NOTIF-ANDROID-001 no aplica aquí — esta suite cubre estadoCelda(),
// extraída durante la Modularización JS Fase 2 desde
// app.js -> renderMatrizSemanal() (antes anidada, ver comentario histórico
// en matriz-semanal.test.js) hacia src/core/weekly-matrix.js.
//
// estadoCelda() es la función pura que decide el estado de UNA celda
// (equipo x día) de la Matriz Semanal: 'vacio' | 'hecho' | 'futuro' |
// 'pendiente' | 'no_realizado'. No toca DOM ni IndexedDB — recibe
// plans/records/hoy ya cargados, igual que el código original.
import { describe, it, expect } from 'vitest';
import { loadWeeklyMatrixLogic } from '../helpers/loadLubricationLogic.js';

const { estadoCelda } = loadWeeklyMatrixLogic();

// Miércoles 2026-01-14 — mismo día de referencia que matriz-semanal.test.js,
// para mantener consistencia entre ambas suites.
const HOY = new Date(2026, 0, 14); HOY.setHours(0, 0, 0, 0);
const equipo = { id: 'e1' };

function fecha(y, m, d) { const f = new Date(y, m, d); f.setHours(0, 0, 0, 0); return f; }

describe('estadoCelda() — Matriz Semanal, celda equipo x día', () => {
  it('1. no corresponde ese día (no está en assignedDays) -> vacio', () => {
    const plans = [{ equipmentId: 'e1', assignedDays: ['Jueves'] }]; // hoy es Miércoles
    const r = estadoCelda(equipo, HOY, plans, [], HOY);
    expect(r).toEqual({ tipo: 'vacio' });
  });

  it('sin plan en absoluto -> vacio', () => {
    const r = estadoCelda(equipo, HOY, [], [], HOY);
    expect(r).toEqual({ tipo: 'vacio' });
  });

  it('2. pendiente hoy: día asignado es hoy, sin registro -> pendiente', () => {
    const plans = [{ equipmentId: 'e1', assignedDays: ['Miércoles'] }];
    const r = estadoCelda(equipo, HOY, plans, [], HOY);
    expect(r).toEqual({ tipo: 'pendiente' });
  });

  it('3. realizado hoy: día asignado es hoy, con registro de hoy -> hecho', () => {
    const plans = [{ equipmentId: 'e1', assignedDays: ['Miércoles'] }];
    const records = [{ equipmentId: 'e1', date: HOY.toISOString(), userName: 'Ana' }];
    const r = estadoCelda(equipo, HOY, plans, records, HOY);
    expect(r).toMatchObject({ tipo: 'hecho', por: 'Ana' });
  });

  it('3b. hecho_atrasado: plan exige turno Día, registro real de hoy quedó en turno Noche -> hecho_atrasado', () => {
    const plans = [{ equipmentId: 'e1', assignedDays: ['Miércoles'], shiftId: 'shift_dia' }];
    const records = [{ equipmentId: 'e1', date: HOY.toISOString(), userName: 'Ana', shiftId: 'shift_noche' }];
    const r = estadoCelda(equipo, HOY, plans, records, HOY);
    expect(r).toEqual({ tipo: 'hecho_atrasado', por: 'Ana', fecha: records[0].date });
  });

  it('3c. hecho_atrasado no aplica si el plan no exige turno (shiftId ausente) -> hecho normal', () => {
    const plans = [{ equipmentId: 'e1', assignedDays: ['Miércoles'] }];
    const records = [{ equipmentId: 'e1', date: HOY.toISOString(), userName: 'Ana', shiftId: 'shift_noche' }];
    const r = estadoCelda(equipo, HOY, plans, records, HOY);
    expect(r).toEqual({ tipo: 'hecho', por: 'Ana', fecha: records[0].date });
  });

  it('4. día pasado sin realizar -> no_realizado, con diasAtras correcto', () => {
    const ayer = fecha(2026, 0, 13); // Martes
    const plans = [{ equipmentId: 'e1', assignedDays: ['Martes'] }];
    const r = estadoCelda(equipo, ayer, plans, [], HOY);
    expect(r).toEqual({ tipo: 'no_realizado', diasAtras: 1 });
  });

  it('día futuro dentro de la semana -> futuro', () => {
    const manana = fecha(2026, 0, 15); // Jueves
    const plans = [{ equipmentId: 'e1', assignedDays: ['Jueves'] }];
    const r = estadoCelda(equipo, manana, plans, [], HOY);
    expect(r).toEqual({ tipo: 'futuro' });
  });

  it('5/6. reprogramación (reprogramadoHasta): estadoCelda() la IGNORA por diseño actual — comportamiento real de app.js, no inventado. La reprogramación solo afecta el Dashboard (statusFor), no la Matriz.', () => {
    // Plan reprogramado hacia OTRO día (viernes), pero hoy es miércoles y no es su
    // día asignado -> igual da 'vacio', el campo reprogramadoHasta no se consulta.
    const plans = [{
      equipmentId: 'e1',
      assignedDays: ['Jueves'],
      reprogramadoHasta: fecha(2026, 0, 16).toISOString(), // Viernes
      reprogramadoMotivo: 'Equipo en mantenimiento',
    }];
    const r = estadoCelda(equipo, HOY, plans, [], HOY);
    expect(r).toEqual({ tipo: 'vacio' });
  });

  it('7. active:false ignorado: estadoCelda() no filtra por active — asume que plans/records ya vienen filtrados por DB.allActive() (como en app.js). Un plan inactivo que igual se le pase SÍ se evalúa.', () => {
    const plans = [{ equipmentId: 'e1', assignedDays: ['Miércoles'], active: false }];
    const r = estadoCelda(equipo, HOY, plans, [], HOY);
    // No hay guard de `active` dentro de estadoCelda: el filtrado ocurre antes,
    // en DB.allActive(). Esta prueba documenta ese límite de responsabilidad.
    expect(r).toEqual({ tipo: 'pendiente' });
  });

  it('8. cambio Domingo -> Lunes: Lunes asignado, hoy es Lunes, sin registro -> pendiente', () => {
    const lunes = fecha(2026, 0, 19); // Lunes 2026-01-19
    const plans = [{ equipmentId: 'e1', assignedDays: ['Lunes'] }];
    const r = estadoCelda(equipo, lunes, plans, [], lunes);
    expect(r).toEqual({ tipo: 'pendiente' });
  });

  it('8b. Domingo no asignado no cuenta como pendiente de Lunes (celdas independientes)', () => {
    const domingo = fecha(2026, 0, 18); // Domingo 2026-01-18
    const lunes = fecha(2026, 0, 19);
    const plans = [{ equipmentId: 'e1', assignedDays: ['Lunes'] }];
    const r = estadoCelda(equipo, domingo, plans, [], lunes);
    expect(r).toEqual({ tipo: 'vacio' });
  });

  it('9. cambio de mes: 31 de enero (pasado) sin registrar, hoy 1 de febrero -> no_realizado, 1 día de atraso', () => {
    const finDeEnero = fecha(2026, 0, 31); // Sábado
    const hoyFeb = fecha(2026, 1, 1); // Domingo
    const plans = [{ equipmentId: 'e1', assignedDays: ['Sábado'] }];
    const r = estadoCelda(equipo, finDeEnero, plans, [], hoyFeb);
    expect(r).toEqual({ tipo: 'no_realizado', diasAtras: 1 });
  });

  it('10. cambio de año: 31 de diciembre 2025 (pasado) sin registrar, hoy 1 de enero 2026 -> no_realizado', () => {
    const finDeAno = fecha(2025, 11, 31); // Miércoles
    const hoyEnero = fecha(2026, 0, 1); // Jueves
    const plans = [{ equipmentId: 'e1', assignedDays: ['Miércoles'] }];
    const r = estadoCelda(equipo, finDeAno, plans, [], hoyEnero);
    expect(r).toEqual({ tipo: 'no_realizado', diasAtras: 1 });
  });

  it('11. sin registros en absoluto -> no revienta, sigue evaluando fecha normalmente', () => {
    const plans = [{ equipmentId: 'e1', assignedDays: ['Miércoles'] }];
    const r = estadoCelda(equipo, HOY, plans, [], HOY);
    expect(r.tipo).toBe('pendiente');
  });

  it('12. más de un registro: toma el primero que matchea equipo+fecha -> hecho', () => {
    const plans = [{ equipmentId: 'e1', assignedDays: ['Miércoles'] }];
    const records = [
      { equipmentId: 'otro', date: HOY.toISOString(), userName: 'X' },
      { equipmentId: 'e1', date: HOY.toISOString(), userName: 'Primero' },
      { equipmentId: 'e1', date: HOY.toISOString(), userName: 'Segundo' },
    ];
    const r = estadoCelda(equipo, HOY, plans, records, HOY);
    expect(r).toMatchObject({ tipo: 'hecho', por: 'Primero' });
  });

  it('13. registro atrasado válido: se registra HOY para un día asignado pasado -> esa celda pasada sigue siendo no_realizado (el registro no tiene la fecha de esa celda)', () => {
    const ayer = fecha(2026, 0, 13); // Martes, día asignado
    const plans = [{ equipmentId: 'e1', assignedDays: ['Martes'] }];
    // El lubricador registra HOY (miércoles) pero el registro guarda la fecha de HOY,
    // no la del martes -> la celda del martes sigue marcando no_realizado.
    const records = [{ equipmentId: 'e1', date: HOY.toISOString(), userName: 'Ana' }];
    const r = estadoCelda(equipo, ayer, plans, records, HOY);
    expect(r).toEqual({ tipo: 'no_realizado', diasAtras: 1 });
  });

  // 14-16: lote "engrase fuera de plan" §19 — REALIZADO ADELANTADO cuando un
  // registro OUT_OF_PLAN (fecha distinta, otro día) certificó via
  // satisfiedOccurrenceKey que ESTA celda concreta ya quedó cubierta.
  it('14. hecho_adelantado: PM el martes (registro con esa fecha) satisface la celda del miércoles siguiente', () => {
    const miercoles = fecha(2026, 0, 14); // HOY
    const plan = { id: 'plan_x', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: ['Miércoles'] };
    const registroMartes = {
      equipmentId: 'e1', date: fecha(2026, 0, 13).toISOString(), userName: 'Ana',
      operationalSnapshot: { satisfiedOccurrenceKey: 'plan_x:2026-01-14' }
    };
    const r = estadoCelda(equipo, miercoles, [plan], [registroMartes], HOY);
    expect(r).toEqual({ tipo: 'hecho_adelantado', por: 'Ana', fecha: registroMartes.date });
  });

  it('15. sin satisfiedOccurrenceKey coincidente -> sigue el flujo normal (pendiente), nunca se inventa un adelantado', () => {
    const miercoles = fecha(2026, 0, 14);
    const plan = { id: 'plan_x', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: ['Miércoles'] };
    const registroOtraSemana = {
      equipmentId: 'e1', date: fecha(2026, 0, 6).toISOString(), userName: 'Ana',
      operationalSnapshot: { satisfiedOccurrenceKey: 'plan_x:2026-01-07' } // otra ocurrencia
    };
    const r = estadoCelda(equipo, miercoles, [plan], [registroOtraSemana], HOY);
    expect(r).toEqual({ tipo: 'pendiente' });
  });

  it('16. plan sin id (fixtures legacy) -> nunca lanza, se comporta igual que antes de este lote', () => {
    const plans = [{ equipmentId: 'e1', assignedDays: ['Miércoles'] }]; // sin id
    expect(() => estadoCelda(equipo, HOY, plans, [], HOY)).not.toThrow();
    expect(estadoCelda(equipo, HOY, plans, [], HOY)).toEqual({ tipo: 'pendiente' });
  });

  // 17-18: Fix 2026-10-09 ("FIX REALIZADO ADELANTADO + QR INTERNO", §5 del
  // pedido) — estadoCelda() NUNCA filtró por executionType (solo lee
  // satisfiedOccurrenceKey), confirmado explícitamente con PLANNED/ASSIGNED
  // — mismo resultado que OUT_OF_PLAN (test 14, arriba).
  for (const tipo of ['PLANNED', 'ASSIGNED']) {
    it(`17/18. hecho_adelantado con executionType=${tipo}: Matrix no distingue cómo se ejecutó, solo si satisfiedOccurrenceKey coincide`, () => {
      const miercoles = fecha(2026, 0, 14);
      const plan = { id: 'plan_tipo', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: ['Miércoles'] };
      const registroMartes = {
        equipmentId: 'e1', date: fecha(2026, 0, 13).toISOString(), userName: 'Ana',
        operationalSnapshot: { executionType: tipo, satisfiedOccurrenceKey: 'plan_tipo:2026-01-14' },
      };
      const r = estadoCelda(equipo, miercoles, [plan], [registroMartes], HOY);
      expect(r).toEqual({ tipo: 'hecho_adelantado', por: 'Ana', fecha: registroMartes.date });
    });
  }
});
