// src/core/weekly-matrix.js
//
// Lógica pura de la Matriz Semanal de engrase: decide qué estado le
// corresponde a una celda (equipo x día) sin tocar el DOM ni IndexedDB.
// Extraída de app.js -> renderMatrizSemanal() (antes anidada ahí como
// estadoCelda()) — ver docs/MODULARIZATION.md.
//
// Reglas conservadas EXACTAMENTE como estaban en app.js (no se agregó ni se
// quitó ningún caso):
//   - Si el equipo no tiene plan, o el plan no tiene asignado ese día de la
//     semana (assignedDays), la celda es 'vacio' (no le corresponde ese día).
//   - Si ya existe un registro de engrase (lubrication_records) para ese
//     equipo en esa fecha exacta, es 'hecho'.
//   - Si la fecha es futura respecto a "hoy", es 'futuro' (todavía no le toca).
//   - Si la fecha ya pasó sin registro, es 'no_realizado'.
//   - Si la fecha es hoy y no hay registro, es 'pendiente'.
//
// NOTA importante: a diferencia del Dashboard (ver statusFor() en
// lubrication-status.js), esta vista NO considera
// plan.reprogramadoHasta/reprogramadoMotivo — así se comportaba ya el
// código original (la reprogramación puntual solo afecta las tarjetas de
// estado del Dashboard, no la Matriz Semanal). No se inventó ni se quitó
// este comportamiento en la extracción.
//
// `plans` y `records` deben venir ya filtrados a solo activos (como hace
// DB.allActive() en app.js) — esta función no vuelve a filtrar por
// `active`, igual que la versión original no lo hacía.

function estadoCelda(eq, fecha, plans, records, hoy) {
  const plan = plans.find(p => p.equipmentId === eq.id);
  if (!plan) return { tipo: 'vacio' };
  const nombreDia = WEEKDAY_NAMES[fecha.getDay()];
  if (!(plan.assignedDays || []).includes(nombreDia)) return { tipo: 'vacio' };

  const hecho = records.find(r => r.equipmentId === eq.id &&
    new Date(r.date).toDateString() === fecha.toDateString());
  if (hecho) return { tipo: 'hecho', por: hecho.userName, fecha: hecho.date };

  if (fecha.getTime() > hoy.getTime()) return { tipo: 'futuro' };
  if (fecha.getTime() < hoy.getTime()) {
    const dias = Math.round((hoy.getTime() - fecha.getTime()) / 86400000);
    return { tipo: 'no_realizado', diasAtras: dias };
  }
  return { tipo: 'pendiente' };
}
