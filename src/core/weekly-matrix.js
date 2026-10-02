// src/core/weekly-matrix.js
//
// Lógica pura de la Matriz Semanal de engrase: decide qué estado le
// corresponde a una celda (equipo x día) sin tocar el DOM ni IndexedDB.
// Extraída de app.js -> renderMatrizSemanal() (antes anidada ahí como
// estadoCelda()) — ver docs/MODULARIZATION.md.
//
// Reglas:
//   - Si el equipo no tiene plan, o el plan no tiene asignado ese día de la
//     semana (assignedDays), la celda es 'vacio' (no le corresponde ese día).
//   - Si ya existe un registro de engrase (lubrication_records) para ese
//     equipo en esa fecha exacta, es 'hecho' — un registro real NUNCA se
//     oculta, sin importar el status actual del equipo (no se reescribe
//     historial).
//   - Si el equipo NO está 'Operativo' (Detenido/En mantenimiento/Fuera de
//     servicio) y ese día no tiene un registro real, es 'pausado' — no se
//     inventa un "NO REALIZADO"/"PENDIENTE"/"futuro" mientras el equipo no
//     puede operar. Usa el status ACTUAL de `eq` (snapshot de hoy) para
//     todo el rango visible; no se reconstruye qué status tenía el equipo
//     en el pasado (no existe ese historial).
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
  if (hecho) {
    // "Realizado atrasado" (lote occurrences/carryover): el plan exige un
    // turno concreto (plan.shiftId) y el registro real se hizo en el OTRO
    // turno del mismo día — típicamente Noche cerrando lo pendiente de Día.
    // Nunca oculta el registro real (sigue siendo 'hecho' de fondo, solo
    // cambia el tipo de celda) ni inventa un registro nuevo.
    if (plan.shiftId && hecho.shiftId && hecho.shiftId !== plan.shiftId) {
      return { tipo: 'hecho_atrasado', por: hecho.userName, fecha: hecho.date };
    }
    return { tipo: 'hecho', por: hecho.userName, fecha: hecho.date };
  }

  // Engrase FUERA DE PLAN que satisfizo ESTA ocurrencia por adelantado (lote
  // "engrase fuera de plan" §10/§19): el registro real quedó en OTRO día
  // (antes), pero operational-scope.js ya certificó que esta celda concreta
  // quedó cubierta — ver resolveOutOfPlanSatisfaction()/satisfiedOccurrenceKey
  // en operationalSnapshot. El plan maestro NUNCA se toca (sigue siendo el
  // mismo día la semana siguiente, ver §11) — esto es solo una lectura.
  if (plan.id) {
    const cellKey = computeOccurrenceKey(plan, { dateISO: `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}` });
    const adelantado = records.find(r => r.equipmentId === eq.id &&
      r.operationalSnapshot && r.operationalSnapshot.satisfiedOccurrenceKey === cellKey);
    if (adelantado) return { tipo: 'hecho_adelantado', por: adelantado.userName, fecha: adelantado.date };
  }

  if (eq.status && eq.status !== 'Operativo') return { tipo: 'pausado', status: eq.status };

  if (fecha.getTime() > hoy.getTime()) return { tipo: 'futuro' };
  if (fecha.getTime() < hoy.getTime()) {
    const dias = Math.round((hoy.getTime() - fecha.getTime()) / 86400000);
    return { tipo: 'no_realizado', diasAtras: dias };
  }
  return { tipo: 'pendiente' };
}
