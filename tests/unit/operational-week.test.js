// tests/unit/operational-week.test.js
//
// "CONFIGURACIÓN ADMINISTRADOR PARA CAMBIAR LOS DÍAS DE LA SEMANA
// OPERATIVA" — prueba la lógica PURA de src/core/operational-week.js
// (getOperationalWeekDays/Start/End/Range/Label, normalizadores), cargada
// directamente desde la fuente real (mismo patrón que
// tests/unit/weekday-status-adelantado.test.js para weekly-matrix.js).
//
// No depende de ninguna fecha de calendario memorizada: cada prueba de
// orden construye su propia fecha de referencia buscando el día de la
// semana que necesita (dateForWeekday()), así que sigue siendo válida en
// cualquier año.

import { describe, it, expect } from 'vitest';
import { loadOperationalWeekLogic } from '../helpers/loadLubricationLogic.js';

const {
  OPERATIONAL_WEEK_START_DAY_DEFAULT, OPERATIONAL_WEEK_START_TIME_DEFAULT, OPERATIONAL_WEEK_START_DAY_OPTIONS,
  normalizeOperationalWeekStartDay, normalizeOperationalWeekStartTime,
  getOperationalWeekStart, getOperationalWeekEnd, getOperationalWeekDays, getOperationalWeekRange, getOperationalWeekLabel,
} = loadOperationalWeekLogic();

// Avanza desde una fecha fija y conocida hasta encontrar el día de la
// semana pedido (0=Domingo..6=Sábado) — nunca depende de qué día cae hoy.
function dateForWeekday(targetDay, hour = 12, minute = 0) {
  const d = new Date(2026, 0, 1, hour, minute, 0, 0);
  while (d.getDay() !== targetDay) d.setDate(d.getDate() + 1);
  return d;
}

describe('OPERATIONAL_WEEK_START_DAY_OPTIONS — orden Lunes..Domingo para el <select> de Configuración → Operación', () => {
  it('declara las 7 opciones, en orden de calendario (no el orden visual de columnas)', () => {
    expect(OPERATIONAL_WEEK_START_DAY_OPTIONS.map(o => o.label)).toEqual(
      ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
    );
    expect(OPERATIONAL_WEEK_START_DAY_OPTIONS.map(o => o.value)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe('normalizeOperationalWeekStartDay() / normalizeOperationalWeekStartTime() — defaults Lunes/00:00, nunca una config incompleta', () => {
  it('acepta cualquier entero 0-6 tal cual', () => {
    for (let n = 0; n <= 6; n++) expect(normalizeOperationalWeekStartDay(n)).toBe(n);
  });

  it('cae a Lunes (1) ante un valor inválido/fuera de rango/ausente', () => {
    expect(normalizeOperationalWeekStartDay(7)).toBe(OPERATIONAL_WEEK_START_DAY_DEFAULT);
    expect(normalizeOperationalWeekStartDay(-1)).toBe(OPERATIONAL_WEEK_START_DAY_DEFAULT);
    expect(normalizeOperationalWeekStartDay('jueves')).toBe(OPERATIONAL_WEEK_START_DAY_DEFAULT);
    expect(normalizeOperationalWeekStartDay(undefined)).toBe(OPERATIONAL_WEEK_START_DAY_DEFAULT);
    expect(normalizeOperationalWeekStartDay(null)).toBe(OPERATIONAL_WEEK_START_DAY_DEFAULT);
    expect(OPERATIONAL_WEEK_START_DAY_DEFAULT).toBe(1);
  });

  it('acepta una hora HH:mm válida tal cual', () => {
    expect(normalizeOperationalWeekStartTime('06:00')).toBe('06:00');
    expect(normalizeOperationalWeekStartTime('23:59')).toBe('23:59');
    expect(normalizeOperationalWeekStartTime('00:00')).toBe('00:00');
  });

  it('cae a 00:00 ante una hora inválida/ausente', () => {
    expect(normalizeOperationalWeekStartTime('25:00')).toBe(OPERATIONAL_WEEK_START_TIME_DEFAULT);
    expect(normalizeOperationalWeekStartTime('6:00')).toBe(OPERATIONAL_WEEK_START_TIME_DEFAULT);
    expect(normalizeOperationalWeekStartTime('06:60')).toBe(OPERATIONAL_WEEK_START_TIME_DEFAULT);
    expect(normalizeOperationalWeekStartTime(undefined)).toBe(OPERATIONAL_WEEK_START_TIME_DEFAULT);
    expect(normalizeOperationalWeekStartTime(123)).toBe(OPERATIONAL_WEEK_START_TIME_DEFAULT);
    expect(OPERATIONAL_WEEK_START_TIME_DEFAULT).toBe('00:00');
  });
});

describe('getOperationalWeekDays() — exactamente 7 días, en el ORDEN configurado (nunca lunes-fijo)', () => {
  it('default (Lunes, 00:00): Lun..Dom, igual que el comportamiento histórico de la app', () => {
    const now = dateForWeekday(3); // cualquier día de la semana sirve de referencia
    const dias = getOperationalWeekDays(now, { operationalWeekStartDay: 1, operationalWeekStartTime: '00:00' });
    expect(dias).toHaveLength(7);
    expect(dias.map(d => d.getDay())).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('Jueves: Jue · Vie · Sáb · Dom · Lun · Mar · Mié (ejemplo exacto del pedido)', () => {
    const now = dateForWeekday(4);
    const dias = getOperationalWeekDays(now, { operationalWeekStartDay: 4, operationalWeekStartTime: '00:00' });
    expect(dias.map(d => d.getDay())).toEqual([4, 5, 6, 0, 1, 2, 3]);
  });

  it('Viernes: Vie · Sáb · Dom · Lun · Mar · Mié · Jue (ejemplo exacto del pedido)', () => {
    const now = dateForWeekday(5);
    const dias = getOperationalWeekDays(now, { operationalWeekStartDay: 5, operationalWeekStartTime: '00:00' });
    expect(dias.map(d => d.getDay())).toEqual([5, 6, 0, 1, 2, 3, 4]);
  });

  it('Domingo: Dom · Lun · Mar · Mié · Jue · Vie · Sáb', () => {
    const now = dateForWeekday(0);
    const dias = getOperationalWeekDays(now, { operationalWeekStartDay: 0, operationalWeekStartTime: '00:00' });
    expect(dias.map(d => d.getDay())).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('cada día devuelto está normalizado a medianoche local (00:00:00.000)', () => {
    const now = dateForWeekday(2, 17, 45);
    const dias = getOperationalWeekDays(now, { operationalWeekStartDay: 1, operationalWeekStartTime: '00:00' });
    dias.forEach(d => expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([0, 0, 0, 0]));
  });

  it('offsetWeeks retrocede/avanza exactamente semanas completas, sin cambiar el orden', () => {
    const now = dateForWeekday(4);
    const config = { operationalWeekStartDay: 4, operationalWeekStartTime: '00:00' };
    const actual = getOperationalWeekDays(now, config, 0);
    const anterior = getOperationalWeekDays(now, config, -1);
    const siguiente = getOperationalWeekDays(now, config, 1);
    expect(anterior.map(d => d.getDay())).toEqual(actual.map(d => d.getDay()));
    expect(actual[0].getTime() - anterior[0].getTime()).toBe(7 * 86400000);
    expect(siguiente[0].getTime() - actual[0].getTime()).toBe(7 * 86400000);
  });
});

describe('getOperationalWeekStart()/getOperationalWeekEnd() — rango [start, end) EXCLUSIVO', () => {
  it('end es exactamente start + 7 días (nunca el mismo día de inicio incluido dos veces)', () => {
    const now = dateForWeekday(4);
    const config = { operationalWeekStartDay: 4, operationalWeekStartTime: '00:00' };
    const start = getOperationalWeekStart(now, config);
    const end = getOperationalWeekEnd(now, config);
    expect(end.getTime() - start.getTime()).toBe(7 * 86400000);
  });

  it('getOperationalWeekRange() expone el mismo start/end', () => {
    const now = dateForWeekday(1);
    const config = { operationalWeekStartDay: 1, operationalWeekStartTime: '00:00' };
    const { start, end } = getOperationalWeekRange(now, config);
    expect(start.getTime()).toBe(getOperationalWeekStart(now, config).getTime());
    expect(end.getTime()).toBe(getOperationalWeekEnd(now, config).getTime());
  });

  it('el último día de getOperationalWeekDays() es el día calendario anterior a `end`', () => {
    const now = dateForWeekday(5);
    const config = { operationalWeekStartDay: 5, operationalWeekStartTime: '00:00' };
    const dias = getOperationalWeekDays(now, config);
    const end = getOperationalWeekEnd(now, config);
    const diaAntesDeEnd = new Date(end); diaAntesDeEnd.setDate(end.getDate() - 1);
    expect(dias[6].getTime()).toBe(diaAntesDeEnd.getTime());
  });
});

describe('Hora de corte — "Jueves 06:00" decide a qué semana pertenece `now`, no solo la fecha', () => {
  const config = { operationalWeekStartDay: 4, operationalWeekStartTime: '06:00' };

  it('jueves 03:00 (ANTES del corte) todavía pertenece a la semana ANTERIOR', () => {
    const now = dateForWeekday(4, 3, 0);
    const start = getOperationalWeekStart(now, config);
    const esteJueves = new Date(now); esteJueves.setHours(0, 0, 0, 0);
    expect(start.getDay()).toBe(4);
    // El corte de ESTE jueves todavía no llegó (son las 03:00, el corte es
    // a las 06:00) — la semana vigente es la de HACE 7 días, no esta.
    expect(start.getTime()).toBe(esteJueves.getTime() - 7 * 86400000);
  });

  it('jueves 08:00 (DESPUÉS del corte) ya pertenece a la semana que empieza ESE jueves', () => {
    const now = dateForWeekday(4, 8, 0);
    const start = getOperationalWeekStart(now, config);
    const esteJueves = new Date(now); esteJueves.setHours(0, 0, 0, 0);
    expect(start.getTime()).toBe(esteJueves.getTime());
  });

  it('con hora de corte 00:00 (default), el día calendario decide solo (comportamiento histórico)', () => {
    const configMidnight = { operationalWeekStartDay: 4, operationalWeekStartTime: '00:00' };
    const now = dateForWeekday(4, 0, 1); // un minuto después de medianoche
    const start = getOperationalWeekStart(now, configMidnight);
    const esteJueves = new Date(now); esteJueves.setHours(0, 0, 0, 0);
    expect(start.getTime()).toBe(esteJueves.getTime());
  });
});

describe('getOperationalWeekLabel() — rango inclusivo para mostrar ("29 oct 2026 – 4 nov 2026")', () => {
  it('tiene la forma "D mes[ aaaa] – D mes aaaa"', () => {
    const now = dateForWeekday(4);
    const label = getOperationalWeekLabel(now, { operationalWeekStartDay: 4, operationalWeekStartTime: '00:00' });
    expect(label).toMatch(/^\d{1,2} [a-zé]{3}( \d{4})? – \d{1,2} [a-zé]{3} \d{4}$/);
  });
});

describe('Regresión — cambiar el día de inicio NUNCA toca los días reales de un plan', () => {
  it('getOperationalWeekDays() es puramente de agrupación/orden visual: no recibe ni modifica assignedDays/plan alguno', () => {
    // getOperationalWeekDays() solo recibe (fecha, config, offset) — no un
    // plan ni assignedDays, así que es estructuralmente imposible que
    // mute los días reales de un plan (los consumidores de app.js le pasan
    // el resultado a estadoCelda()/plan.assignedDays, nunca al revés).
    expect(getOperationalWeekDays.length).toBe(2); // offsetWeeks tiene default, no cuenta en .length
  });
});
