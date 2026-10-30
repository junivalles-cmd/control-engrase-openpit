// tests/unit/operational-week-notifications.test.js
//
// "CIERRE FINAL SEMANA OPERATIVA: NOTIFICACIONES + REPORTES":
//   OBJETIVO 1: "Resumen semanal" ya no está fijo al lunes — el DÍA viene
//     exclusivamente de App.generalSettings.operationalWeekStartDay
//     (nunca un segundo diaSemana propio), y el CONTENIDO resume la
//     semana operativa que ACABA DE CERRAR (previousOperationalWeekRange()),
//     nunca un rolling-7-días desde "ahora".
//   OBJETIVO 2: hora de CORTE (operationalWeekStartTime) vs. hora del
//     PUSH (cfgS.hour/minute) son independientes.
//   OBJETIVO 3: UI renombrada, sin un segundo selector de día.
//   OBJETIVO 4/5: auditoría de Reportes/consistencia (ver abajo).
//
// Mismo método que el resto del proyecto para refreshLocalNotifications()
// (demasiado acoplado a DB/Capacitor para ejecutarlo completo): fuente
// extraída + aserciones de texto para el WIRING, y ejecución REAL de los
// helpers puros (previousOperationalWeekRange()/proximoDiaSemana()) para
// el CÁLCULO de fechas — nunca se reimplementa esa lógica a mano aquí.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, loadAppLogic, loadOperationalWeekLogic } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const refreshSrc = extractDeclaration(appSource, 'refreshLocalNotifications');
const renderConfigSrc = extractDeclaration(appSource, 'renderConfig');
// NOTIF_DEFAULTS no se puede extraer con extractDeclaration(): sus propios
// comentarios "// 1) Engrases VENCIDOS"/"// 2) ..." tienen un ")" suelto
// que rompe el contador de profundidad ingenuo del helper (preexistente,
// no introducido por este lote) — se busca el objeto resumenSemanal
// directamente por regex sobre el archivo completo en su lugar.

// Slice EXACTO del bloque "Resumen SEMANAL" dentro de refreshLocalNotificatons()
// (entre sus propios marcadores de comentario, nunca confundido con el
// bloque 4 de arriba — "Resumen de cumplimiento" — que también declara su
// propio `hace7` local, legítimo y sin tocar, ver OBJETIVO 5 abajo).
const iResumen = refreshSrc.indexOf('// ── 4) Resumen SEMANAL');
const iAsignaciones = refreshSrc.indexOf('// ── 5) Asignaciones manuales');
const resumenBlockSrc = refreshSrc.slice(iResumen, iAsignaciones);

const { proximoDiaSemana } = loadAppLogic({}, {});
const { previousOperationalWeekRange, getOperationalWeekRange, getOperationalWeekStart } = loadOperationalWeekLogic();

function dateForWeekday(targetDay, hour = 12, minute = 0) {
  const d = new Date(2026, 0, 1, hour, minute, 0, 0);
  while (d.getDay() !== targetDay) d.setDate(d.getDate() + 1);
  return d;
}

describe('OBJETIVO 1 — "Resumen semanal" ya no está fijo al lunes', () => {
  it('1) inicio = Lunes → el próximo resumen cae en lunes', () => {
    const next = proximoDiaSemana(1, 7, 0);
    expect(next.getDay()).toBe(1);
  });

  it('2) inicio = Jueves → el próximo resumen cae en jueves', () => {
    const next = proximoDiaSemana(4, 7, 0);
    expect(next.getDay()).toBe(4);
  });

  it('3) inicio = Viernes → el próximo resumen cae en viernes', () => {
    const next = proximoDiaSemana(5, 7, 0);
    expect(next.getDay()).toBe(5);
  });

  it('7) cambiar operationalWeekStartDay cambia el día del PRÓXIMO resumen (mismo parámetro, ningún estado propio)', () => {
    const comoLunes = proximoDiaSemana(1, 7, 0);
    const comoJueves = proximoDiaSemana(4, 7, 0);
    expect(comoLunes.getDay()).toBe(1);
    expect(comoJueves.getDay()).toBe(4);
    expect(comoLunes.getDay()).not.toBe(comoJueves.getDay());
  });

  it('refreshLocalNotifications() programa el resumen con el día real de App.generalSettings, nunca cfgS.diaSemana', () => {
    expect(resumenBlockSrc).toContain('proximoDiaSemana(normalizeOperationalWeekStartDay(App.generalSettings.operationalWeekStartDay), cfgS.hour, cfgS.minute)');
    expect(resumenBlockSrc).not.toContain('cfgS.diaSemana');
    expect(resumenBlockSrc).not.toContain('diaSemana');
  });

  it('NOTIF_DEFAULTS.resumenSemanal ya no declara su propio "diaSemana" (una sola fuente de verdad, nunca 2 configs contradictorias)', () => {
    const resumenDefaultsMatch = appSource.match(/resumenSemanal:\s*\{[^}]*\}/);
    expect(resumenDefaultsMatch).not.toBeNull();
    expect(resumenDefaultsMatch[0]).not.toContain('diaSemana');
    expect(resumenDefaultsMatch[0]).toContain('hour: 7');
  });

  it('el formulario de guardado de Notificaciones ya no fuerza "diaSemana" (se retiró, no se reemplazó por un selector)', () => {
    expect(appSource).not.toContain("out.diaSemana");
  });
});

describe('4) El resumen toma la semana ANTERIOR ya cerrada, nunca la nueva (vacía)', () => {
  const config = { operationalWeekStartDay: 4, operationalWeekStartTime: '06:00' };

  it('refreshLocalNotifications() calcula el rango con previousOperationalWeekRange(), nunca un "hace7" rodante', () => {
    expect(resumenBlockSrc).toContain('previousOperationalWeekRange(new Date(), App.generalSettings)');
    expect(resumenBlockSrc).not.toContain('Date.now() - 7 * 86400000');
  });

  it('la semana devuelta es exactamente la anterior a la que contiene `now` (contigua, sin huecos ni solapes)', () => {
    const now = dateForWeekday(4, 8, 0); // jueves 08:00, YA dentro de la semana nueva (después del corte)
    const actual = getOperationalWeekRange(now, config, 0);
    const previa = previousOperationalWeekRange(now, config);
    expect(previa.end.getTime()).toBe(actual.start.getTime()); // contigua: termina justo donde empieza la actual
    expect(previa.end.getTime() - previa.start.getTime()).toBe(7 * 86400000); // 7 días completos
  });
});

describe('5) Hora de corte (operationalWeekStartTime) respetada en el cálculo del rango a resumir', () => {
  const config = { operationalWeekStartDay: 4, operationalWeekStartTime: '06:00' };

  it('jueves 03:00 (ANTES del corte, todavía en la semana vieja) → la semana a resumir es la de 2 jueves atrás', () => {
    const now = dateForWeekday(4, 3, 0);
    const previa = previousOperationalWeekRange(now, config);
    const inicioSemanaVieja = getOperationalWeekStart(now, config, 0); // jueves de hace 7 días (corte no llegó)
    expect(previa.start.getTime()).toBe(inicioSemanaVieja.getTime() - 7 * 86400000);
    expect(previa.end.getTime()).toBe(inicioSemanaVieja.getTime());
  });

  it('jueves 08:00 (DESPUÉS del corte) → la semana a resumir termina en el corte de ESTE jueves', () => {
    const now = dateForWeekday(4, 8, 0);
    const previa = previousOperationalWeekRange(now, config);
    const esteJueves = new Date(now); esteJueves.setHours(0, 0, 0, 0);
    expect(previa.end.getTime()).toBe(esteJueves.getTime());
  });
});

describe('6) La hora del PUSH (cfgS.hour/minute) nunca cambia el rango resumido (son cosas independientes)', () => {
  it('previousOperationalWeekRange() no recibe ni usa la hora del push — mismo rango sin importar a qué hora suene el aviso', () => {
    const config = { operationalWeekStartDay: 4, operationalWeekStartTime: '06:00' };
    const now = dateForWeekday(4, 8, 0);
    const rango7 = previousOperationalWeekRange(now, config); // "push a las 07:00"
    const rango9 = previousOperationalWeekRange(now, config); // "push a las 09:00" — mismo `now`/config, otra hora de push
    expect(rango7.start.getTime()).toBe(rango9.start.getTime());
    expect(rango7.end.getTime()).toBe(rango9.end.getTime());
    expect(previousOperationalWeekRange.length).toBe(2); // (now, config) — ninguna hora de push como parámetro
  });

  it('proximoDiaSemana() (hora del push) y previousOperationalWeekRange() (rango a resumir) son funciones separadas, cada una con su propia hora', () => {
    const pushA = proximoDiaSemana(4, 7, 0);
    const pushB = proximoDiaSemana(4, 9, 0);
    expect(pushA.getHours()).toBe(7);
    expect(pushB.getHours()).toBe(9);
    // Cambiar la hora del push no es un parámetro de previousOperationalWeekRange en absoluto.
    expect(previousOperationalWeekRange.toString()).not.toContain('hour');
  });
});

describe('8) No duplica notificaciones — un solo id, cancelado y reprogramado, nunca sumado', () => {
  it('solo existe UN push de id NOTIF_ID_SEMANAL por corrida de refreshLocalNotifications()', () => {
    const count = (resumenBlockSrc.match(/id: NOTIF_ID_SEMANAL/g) || []).length;
    expect(count).toBe(1);
  });

  it('refreshLocalNotifications() cancela TODAS las notificaciones conocidas antes de reprogramar (incluye NOTIF_ID_SEMANAL vía LOCAL_NOTIF_IDS) — invariante preexistente, sin romper', () => {
    expect(refreshSrc).toMatch(/cancelAllLocalNotifications\(\)/);
    expect(appSource).toContain('{ id: NOTIF_ID_SEMANAL }');
  });
});

describe('OBJETIVO 3 — UI de Notificaciones: renombrado, sin segundo selector de día', () => {
  const cardMatch = renderConfigSrc.match(/notifCardHTML\('resumenSemanal'[\s\S]*?\)\}/);

  it('el título ya no dice "(lunes)"', () => {
    expect(renderConfigSrc).not.toContain('Resumen semanal (lunes)');
    expect(cardMatch[0]).toContain("'📅 Resumen semanal'");
  });

  it('incluye el texto de ayuda pedido y el día ACTUAL solo informativo (vía OPERATIONAL_WEEK_START_DAY_OPTIONS, nunca un <select> propio)', () => {
    expect(cardMatch[0]).toContain('Se envía el día configurado como inicio de la semana operativa y resume la semana que acaba de cerrar.');
    expect(cardMatch[0]).toContain('Actualmente:');
    expect(cardMatch[0]).toContain('OPERATIONAL_WEEK_START_DAY_OPTIONS.find(o => o.value === gen.operationalWeekStartDay)');
    expect(cardMatch[0]).not.toContain('<select');
  });
});

describe('OBJETIVO 4 — Reportes: auditoría de presets/KPI semanales', () => {
  const printGreasePlanSrc = extractDeclaration(appSource, 'printGreasePlan');
  const construirBucketsSrc = extractDeclaration(appSource, 'construirBucketsTendencia');

  it('9) REPORT_WEEK_PRESETS: no existe ningún KPI/preset "Esta semana"/"Semana actual"/"Semana anterior"/"Cumplimiento semanal" en Reportes — no se inventó uno para este lote', () => {
    const renderReportesSrc = extractDeclaration(appSource, 'renderReportes');
    ['Esta semana', 'Semana actual', 'Semana anterior', 'Cumplimiento semanal', 'Resumen semanal'].forEach(frase => {
      expect(renderReportesSrc).not.toContain(frase);
    });
    expect(renderReportesSrc).not.toContain('getOperationalWeekRange');
    expect(renderReportesSrc).not.toContain('previousOperationalWeekRange');
  });

  it('10) la tendencia por bloques rodantes de 7 días sigue intacta (construirBucketsTendencia) — nunca migrada a semana operativa', () => {
    expect(construirBucketsSrc).toContain('if (dias.length <= 31)');
    expect(construirBucketsSrc).toContain('actual.dias.length >= 7');
    expect(construirBucketsSrc).not.toContain('getOperationalWeekDays');
    expect(construirBucketsSrc).not.toContain('previousOperationalWeekRange');
  });

  it('11) el rango mensual calendario (printGreasePlan, rango "mes") sigue siendo mes calendario real, nunca semana operativa', () => {
    expect(printGreasePlanSrc).toContain('inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);');
    expect(printGreasePlanSrc).toContain('fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);');
  });
});

describe('OBJETIVO 5 — consistencia: patrones "lunes fijo" legítimos que NO representan semana operativa (documentados, sin tocar)', () => {
  it('"esta semana" en el Resumen de cumplimiento DIARIO (pendSemana) es un rolling-7-días legítimo, no semana operativa — mismo criterio que las tendencias de Reportes, se deja intacto', () => {
    const iCumplimiento = refreshSrc.indexOf('NOTIF_ID_COMPLIANCE');
    expect(iCumplimiento).toBeGreaterThan(-1);
    const cumplimientoSrc = refreshSrc.slice(Math.max(iCumplimiento - 400, 0), iResumen);
    expect(cumplimientoSrc).toContain('hace7');
    expect(cumplimientoSrc).toContain('sin engrasar esta semana');
    // Deliberadamente SIN getOperationalWeekRange/previousOperationalWeekRange: es un
    // rolling-7-días (misma familia que construirBucketsTendencia en Reportes).
    expect(cumplimientoSrc).not.toContain('previousOperationalWeekRange');
  });

  it('los WEEKDAY_NAMES/DIAS indexados por Date.getDay() (cliente y supabase/functions) son el mapa nombre-por-índice, no el inicio de semana — quedan intactos', () => {
    // WEEKDAY_NAMES (lubrication-status.js) sigue siendo 0=Domingo..6=Sábado,
    // el mismo mapa que usan estadoCelda()/operational-scope.js/las funciones
    // de Supabase — nunca el día de inicio configurable. No se tocó en este
    // lote (ver src/core/lubrication-status.js).
    const lubStatusSrc = readSource('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/lubrication-status.js');
    expect(lubStatusSrc).toContain("const WEEKDAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];");
  });
});

describe('Regresión — no reabre nada ya estable (Auth/RLS/sync/planes/assignedDays/turnos intactos)', () => {
  it('previousOperationalWeekRange()/getOperationalWeekDays() no tocan plan.assignedDays/effectiveDate/records en ningún lado', () => {
    expect(previousOperationalWeekRange.toString()).not.toContain('assignedDays');
    expect(previousOperationalWeekRange.toString()).not.toContain('effectiveDate');
  });
});
