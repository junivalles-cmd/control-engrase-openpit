// src/core/operational-week.js
//
// "Semana operativa" — día de inicio de semana + hora de corte,
// administrados en Configuración → Operación (solo ADMINISTRADOR, ver
// renderConfig() en app.js). Se guardan dentro de settings/general junto
// al resto de App.generalSettings (operationalWeekStartDay,
// operationalWeekStartTime) — NO es un documento separado, usa el mismo
// mecanismo de sincronización global ya existente (ver sync.js, store
// 'settings').
//
// Estos son los ÚNICOS helpers que deciden qué 7 fechas forman "la
// semana" y en qué ORDEN se muestran sus columnas. Ninguna pantalla debe
// reconstruir esta lógica a mano ni asumir que la semana empieza en
// lunes — Plan de Engrase, Matriz Semanal, Dashboard, Reportes,
// Historial e impresión consumen los mismos helpers de aquí.
//
// Cambiar operationalWeekStartDay/Time NUNCA toca: los días reales de un
// plan (plan.assignedDays sigue literal, p.ej. "Lun, Mié, Sáb"), ni
// fechas almacenadas, ni registros, ni historial. Solo cambia
// AGRUPACIÓN + RANGO + ORDEN VISUAL de la semana.
//
// `now`/`fecha` siempre son Date reales (hora local del dispositivo) —
// nunca se usa UTC aquí, mismo criterio que el resto de la app
// (toISODateUTCLocal() en operational-scope.js es para OTRA cosa: la
// fecha operativa de un turno, no la semana).

const OPERATIONAL_WEEK_START_DAY_DEFAULT = 1; // Lunes (Date.getDay(): 0=Domingo..6=Sábado)
const OPERATIONAL_WEEK_START_TIME_DEFAULT = '00:00';

// Orden de la lista desplegable en Configuración → Operación — SIEMPRE
// Lunes..Domingo (orden de calendario, para que sea fácil de leer en el
// formulario); no tiene nada que ver con el orden visual de columnas que
// produce getOperationalWeekDays() una vez guardado.
const OPERATIONAL_WEEK_START_DAY_OPTIONS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' },
];

function normalizeOperationalWeekStartDay(value) {
  // No usar Number(value) directo sin este guard: Number(null) === 0 y
  // Number('') === 0, y 0 (Domingo) es un valor VÁLIDO distinto de "sin
  // configurar" — así que "ausente" se decide explícitamente ANTES de
  // coercionar, nunca confundido con "Domingo".
  if (value === null || value === undefined || value === '') return OPERATIONAL_WEEK_START_DAY_DEFAULT;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : OPERATIONAL_WEEK_START_DAY_DEFAULT;
}

function normalizeOperationalWeekStartTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? value : OPERATIONAL_WEEK_START_TIME_DEFAULT;
}

// Instante exacto (Date completo, con hora) del inicio de la semana
// operativa que contiene `now` — el más reciente "día de inicio a la
// hora de corte" que no sea posterior a `now`. Si `now` cae en el mismo
// día de inicio pero ANTES de la hora de corte (p.ej. jueves 03:00 con
// corte jueves 06:00), todavía pertenece a la semana ANTERIOR.
function operationalWeekBoundaryInstant(now, config, offsetWeeks) {
  const startDay = normalizeOperationalWeekStartDay(config && config.operationalWeekStartDay);
  const [h, m] = normalizeOperationalWeekStartTime(config && config.operationalWeekStartTime).split(':').map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  const diff = (d.getDay() - startDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 7);
  d.setDate(d.getDate() + offsetWeeks * 7);
  return d;
}

// Primer día (medianoche local) de la semana operativa — `offsetWeeks`
// desplaza semanas completas hacia atrás/adelante (mismo patrón que
// App.matrizOffset en Matriz Semanal).
function getOperationalWeekStart(now, config, offsetWeeks = 0) {
  const d = operationalWeekBoundaryInstant(new Date(now), config, offsetWeeks);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Fin EXCLUSIVO del rango — [start, end). `end` es la medianoche del día
// siguiente al último día de la semana (nunca "el mismo día de inicio,
// una semana después, incluido dos veces").
function getOperationalWeekEnd(now, config, offsetWeeks = 0) {
  const end = getOperationalWeekStart(now, config, offsetWeeks);
  end.setDate(end.getDate() + 7);
  return end;
}

// Los 7 Date (medianoche local) de la semana, YA EN EL ORDEN VISUAL
// correcto según operationalWeekStartDay — esta es la función que
// reemplaza cualquier construcción manual de "lunes..domingo" en
// Plan de Engrase/Matriz Semanal/Dashboard/Reportes/Historial/impresión.
function getOperationalWeekDays(now, config, offsetWeeks = 0) {
  const start = getOperationalWeekStart(now, config, offsetWeeks);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

function getOperationalWeekRange(now, config, offsetWeeks = 0) {
  return {
    start: getOperationalWeekStart(now, config, offsetWeeks),
    end: getOperationalWeekEnd(now, config, offsetWeeks),
  };
}

// La semana operativa que ACABA DE CERRAR respecto a `now` — la anterior a
// la que contiene `now`, nunca la actual (que todavía está abierta/vacía).
// Único consumidor por ahora: el "Resumen semanal" de notificaciones (lote
// "CIERRE FINAL SEMANA OPERATIVA", 2026-10-30) — cuando se recalcula al
// reprogramar el aviso, `now` ya cayó dentro de la semana NUEVA, así que
// "la semana anterior a la de `now`" es exactamente la que se quiere
// resumir. offsetWeeks (adicional a ese -1) deja encadenar más atrás si
// algún consumidor futuro lo necesita, sin otro helper paralelo.
function previousOperationalWeekRange(now, config, offsetWeeks = 0) {
  return getOperationalWeekRange(now, config, offsetWeeks - 1);
}

const OPERATIONAL_WEEK_MONTH_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// "29 oct 2026 – 4 nov 2026" — rango [start, end) formateado como fechas
// inclusivas para mostrar (el año solo se repite si start y "hoy" quedan
// en años distintos del último día, para no recargar el texto en el caso
// normal de una semana dentro del mismo año).
function getOperationalWeekLabel(now, config, offsetWeeks = 0) {
  const { start, end } = getOperationalWeekRange(now, config, offsetWeeks);
  const last = new Date(end);
  last.setDate(end.getDate() - 1);
  const sameYear = start.getFullYear() === last.getFullYear();
  const fmtPart = (d, withYear) => `${d.getDate()} ${OPERATIONAL_WEEK_MONTH_ABBR[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`;
  return `${fmtPart(start, !sameYear)} – ${fmtPart(last, true)}`;
}
