// tests/unit/lubricador-matriz-modal.test.js
//
// openLubricadorMatrizModal() real — ejecución de la función REAL extraída
// (mismo método que openSinPlanModal() en dashboard-sin-plan.test.js):
// openModal/esc se reemplazan por stubs mínimos, pero estadoCelda()
// (weekly-matrix.js) y WEEKDAY_NAMES (lubrication-status.js) son las
// funciones REALES — nunca una reimplementación del estado de celda.
//
// Alcance (pedido "MATRIZ LUBRICADOR POR UBICACIÓN COMPLETA", 2026-10-09):
// esta función YA NO decide el scope — solo arma la tabla con los `equipos`
// que recibe. La decisión de QUÉ equipos le corresponden a la ubicación
// activa del Lubricador vive en equiposForLubricadorMatriz()
// (operational-scope.js) y se prueba aparte, en
// tests/unit/lubricador-matriz-scope.test.js (casos A-I del pedido).

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const weeklyMatrixSrc = readSource('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/weekly-matrix.js');
const lubStatusSrc = readSource('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/lubrication-status.js');
// estadoCelda() llama a computeOccurrenceKey() (el "hecho_adelantado") —
// vive en operational-scope.js. Se incluye el archivo completo (no solo esa
// función) para no reimplementar sus propias dependencias internas; las
// demás funciones del archivo no se ejecutan nunca (openLubricadorMatrizModal
// nunca las llama), así que no hace falta mockear DB/IndexedDB para ellas.
const operationalScopeSrc = readSource('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/operational-scope.js');
const modalSrc = extractDeclaration(appSource, 'openLubricadorMatrizModal');

let capturedTitle = '';
let capturedHTML = '';
let capturedExtraClass = '';
// Botones de navegación de semana (‹/Hoy/›, rediseño UI UX Pro Max
// 2026-10-09) wireados con $('#id').addEventListener(...) tras abrir el
// modal — stub mínimo que registra el handler sin DOM real, mismo patrón ya
// usado en tests/unit/dashboard-sin-plan.test.js para openSinPlanModal().
const registeredHandlers = {};
const fakeEl = (id) => ({
  addEventListener: (evt, handler) => { registeredHandlers[id] = handler; },
});
const fakeGlobals = {
  openModal: (title, html, extraClass) => { capturedTitle = title; capturedHTML = html; capturedExtraClass = extraClass; },
  esc: (s) => String(s ?? ''),
  // openLubricadorMatrizModal() wirea la pista de scroll de la Matriz tras
  // abrir el modal (auditoría UI/UX 2026-10-08, hallazgo #3) con
  // $$('.matriz-wrap').forEach(wireMatrizScrollHint) — stub sin DOM real,
  // mismo criterio que openModal/esc: no reimplementa el comportamiento,
  // solo evita el ReferenceError (este test no verifica el wiring del hint).
  $$: () => [],
  wireMatrizScrollHint: () => {},
  $: (sel) => fakeEl(sel),
};

// estadoCelda()/WEEKDAY_NAMES/computeOccurrenceKey (sus dependencias reales,
// sin DOM/IndexedDB) se cargan junto con la función bajo prueba, como un solo
// script — igual que loadLubricationLogic.js hace para el resto del proyecto.
const fn = new Function(
  'openModal', 'esc', '$$', 'wireMatrizScrollHint', '$',
  `${lubStatusSrc}\n${operationalScopeSrc}\n${weeklyMatrixSrc}\n${modalSrc}\nreturn openLubricadorMatrizModal;`
)(fakeGlobals.openModal, fakeGlobals.esc, fakeGlobals.$$, fakeGlobals.wireMatrizScrollHint, fakeGlobals.$);

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

describe('openLubricadorMatrizModal() — matriz semanal de solo lectura (arma la tabla con los equipos que recibe)', () => {
  const hoy = new Date();
  const hoyWeekday = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][hoy.getDay()];

  const equipos = [
    { id: 'e1', code: 'T-06', brand: 'Caterpillar', model: 'D8T' },
    { id: 'e2', code: 'T-07', brand: 'Komatsu', model: 'WA470' },
    { id: 'e3', code: 'T-99', brand: 'Sin plan día/turno', model: 'Horómetro' },
  ];
  const plans = [
    { id: 'p1', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday], shiftId: 'shift_dia' },
    { id: 'p2', equipmentId: 'e2', controlType: 'Día y turno de la semana', assignedDays: [hoyWeekday] },
    { id: 'p3', equipmentId: 'e3', controlType: 'Horas de operación', frequency: 250, lastGreaseHour: 100 },
  ];
  const records = [
    { equipmentId: 'e1', date: isoDaysAgo(0), shiftId: 'shift_dia', userName: 'Juan' },
  ];

  it('solo incluye equipos con plan "Día y turno de la semana" — e3 (horómetro) queda fuera', () => {
    fn({ equipos, plans, records });
    expect(capturedHTML).toContain('T-06');
    expect(capturedHTML).toContain('T-07');
    expect(capturedHTML).not.toContain('T-99');
  });

  it('usa el título "Matriz semanal"', () => {
    fn({ equipos, plans, records });
    expect(capturedTitle).toBe('Matriz semanal');
  });

  it('T-06 (con registro real hoy) muestra REALIZADO vía estadoCelda() real, nunca un texto inventado', () => {
    fn({ equipos, plans, records });
    expect(capturedHTML).toMatch(/class="celda-hecho[" ]/);
    expect(capturedHTML).toContain('>REALIZADO<');
  });

  it('nunca incluye un <select> de Ubicación/Familia (scope-lock — solo los equipos recibidos)', () => {
    fn({ equipos, plans, records });
    expect(capturedHTML).not.toContain('<select');
  });

  it('nunca incluye controles de edición (planner/admin) — solo lectura', () => {
    fn({ equipos, plans, records });
    expect(capturedHTML).not.toMatch(/<(button|a)[^>]*(editar|reasignar|mover|guardar)/i);
  });

  it('incluye la leyenda con los mismos colores reales de la Matriz Semanal (incluye el fix de "Realizado atrasado" #8A5A00)', () => {
    fn({ equipos, plans, records });
    expect(capturedHTML).toContain('#8A5A00');
    expect(capturedHTML).toContain('Realizado atrasado');
  });

  it('sin equipos con plan día/turno: muestra un estado vacío explicativo con la ubicación, nunca una tabla rota', () => {
    fn({ equipos: [equipos[2]], plans, records, locationName: 'Volcán' });
    expect(capturedHTML).toContain('Ningún equipo de Volcán tiene un plan por día y turno configurado.');
  });

  it('abre con el modificador .modal-lub-matriz (modal casi pantalla completa, nunca el genérico de 620px)', () => {
    fn({ equipos, plans, records });
    expect(capturedExtraClass).toBe('modal-lub-matriz');
  });

  // §5 del pedido "MATRIZ LUBRICADOR POR UBICACIÓN COMPLETA": el encabezado
  // ya NO dice "equipos de tu cuadrilla" (eso describía el scope viejo,
  // restrictivo) — ahora refleja el alcance real: toda la ubicación, los 2
  // turnos, nunca hardcodea el nombre de la ubicación.
  it('línea de contexto dinámica: "{Ubicación} · Todos los equipos · Día y Noche · Solo lectura"', () => {
    fn({ equipos, plans, records, locationName: 'Volcán' });
    expect(capturedHTML).toContain('Volcán · Todos los equipos · Día y Noche · Solo lectura');
    expect(capturedHTML).not.toContain('tu cuadrilla');
  });

  it('sin locationName (no provisto), la línea de contexto se arma solo con lo disponible, sin "undefined"', () => {
    fn({ equipos, plans, records });
    expect(capturedHTML).toContain('Todos los equipos · Día y Noche · Solo lectura');
    expect(capturedHTML).not.toContain('undefined');
  });

  it('incluye navegación de semana (‹ rango › ) con "Semana actual" en offset 0, sin botón "Hoy"', () => {
    fn({ equipos, plans, records });
    expect(capturedHTML).toContain('id="lubmtz-prev"');
    expect(capturedHTML).toContain('id="lubmtz-next"');
    expect(capturedHTML).toContain('Semana actual');
    expect(capturedHTML).not.toContain('id="lubmtz-hoy"');
  });

  it('con un offset distinto de 0, muestra el botón "Hoy" y ya no dice "Semana actual"', () => {
    fn({ equipos, plans, records }, 1);
    expect(capturedHTML).toContain('id="lubmtz-hoy"');
    expect(capturedHTML).not.toContain('Semana actual');
  });

  it('el botón "‹ Semana anterior" vuelve a abrir el modal con offset-1 (mismo patrón offset+lunes de renderMatrizSemanal)', () => {
    fn({ equipos, plans, records }, 0);
    capturedHTML = '';
    registeredHandlers['#lubmtz-prev']();
    expect(capturedExtraClass).toBe('modal-lub-matriz');
    expect(capturedHTML).not.toContain('Semana actual'); // offset -1, ya no es la semana actual
  });

  it('el botón "Hoy" vuelve a offset 0 ("Semana actual" reaparece)', () => {
    fn({ equipos, plans, records }, 2);
    registeredHandlers['#lubmtz-hoy']();
    expect(capturedHTML).toContain('Semana actual');
  });
});
