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

function estadoCelda(eq, fecha, plans, records, hoy, shiftId, assignments = [], skips = []) {
  const plan = plans.find(p => p.equipmentId === eq.id);
  if (!plan) return { tipo: 'vacio' };
  const dateISO = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
  const dualDaily = Array.isArray(plan.requiredShifts) && ['shift_dia', 'shift_noche'].every(id => plan.requiredShifts.includes(id))
    && !!plan.effectiveDate && dateISO >= plan.effectiveDate;
  if (!dualDaily && plan.controlType && plan.controlType !== 'Día y turno de la semana') return { tipo: 'vacio' };
  if (dualDaily && !shiftId) return { tipo: 'vacio' };
  const nombreDia = WEEKDAY_NAMES[fecha.getDay()];
  if ((!plan.controlType || plan.controlType === 'Día y turno de la semana') && !(plan.assignedDays || []).includes(nombreDia)) return { tipo: 'vacio' };
  if (shiftId && !requiredShiftsForPlan(plan, dateISO).includes(shiftId)) return { tipo: 'vacio' };

  if (dualDaily) {
    const resolved = resolveOccurrenceState({ plan, operationalDate: dateISO, shiftId, records, assignments, skips,
      asOfDateISO: `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}` });
    if (resolved.state === 'COMPLETE') return { tipo: 'hecho', por: resolved.record.userName, fecha: resolved.record.date, record: resolved.record };
    if (resolved.state === 'PARTIAL') return { tipo: 'parcial', por: resolved.record.userName, fecha: resolved.record.date, record: resolved.record };
    if (resolved.state === 'SKIPPED') return { tipo: 'skip', skip: resolved.skip };
    if (resolved.state === 'ASSIGNED') return { tipo: 'asignado', assignment: resolved.assignment };
    if (resolved.state === 'FUTURE') return { tipo: 'futuro' };
    if (resolved.state === 'MISSED') return { tipo: 'no_realizado' };
    return { tipo: 'pendiente' };
  }

  const assignedKey=plan.id ? computeOccurrenceKey(plan,{dateISO,shiftId}) : null;
  const assignedDone=records.find(r=>r.equipmentId===eq.id && r.operationalSnapshot?.assignedOccurrenceKey===assignedKey && r.operationalSnapshot?.satisfiedOccurrenceKey===assignedKey && Number(r.qty)>0 && (r.details || []).every(d=>d.done));
  if (assignedDone) return {tipo:'hecho_atrasado',por:assignedDone.userName,fecha:assignedDone.date};
  const hecho = records.find(r => !r.operationalSnapshot?.assignedOccurrenceKey && r.equipmentId === eq.id &&
    (!shiftId || r.shiftId === shiftId) &&
    (r.operationalSnapshot?.operationalDate === dateISO || new Date(r.date).toDateString() === fecha.toDateString()));
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

  // Engrase que satisfizo ESTA ocurrencia por adelantado (lote "engrase
  // fuera de plan" §10/§19, generalizado 2026-10-09 "FIX REALIZADO
  // ADELANTADO + QR INTERNO" a CUALQUIER executionType — PLANNED/ASSIGNED/
  // OUT_OF_PLAN, da igual cómo se ejecutó): el registro real quedó en OTRO
  // día (antes), pero operational-scope.js ya certificó que esta celda
  // concreta quedó cubierta — ver resolveEarlyOccurrenceSatisfaction()/
  // satisfiedOccurrenceKey en operationalSnapshot. El plan maestro NUNCA se
  // toca (sigue siendo el mismo día la semana siguiente, ver §11) — esto
  // es solo una lectura.
  if (plan.id) {
    const cellKey = computeOccurrenceKey(plan, { dateISO, shiftId });
    const adelantado = records.find(r => r.equipmentId === eq.id &&
      (!shiftId || r.shiftId === shiftId) && r.operationalSnapshot && r.operationalSnapshot.satisfiedOccurrenceKey === cellKey);
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

function estadosCeldaPorTurno(eq, fecha, plans, records, hoy, assignments = [], skips = []) {
  const plan = plans.find(p => p.equipmentId === eq.id);
  if (!plan) return [];
  const dateISO = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
  const shifts = requiredShiftsForPlan(plan, dateISO);
  if (shifts.length < 2 || (plan.effectiveDate && dateISO < plan.effectiveDate)) return [];
  return shifts.map(shiftId => ({ shiftId, state: estadoCelda(eq, fecha, plans, records, hoy, shiftId, assignments, skips) }));
}

/* ============================================================
   MATRIZ SEMANAL — una fila/una matriz por turno, NUNCA mini-celdas
   Día/Noche dentro de una misma celda (corrección 2026-10-18).
   ============================================================
   La Matriz Semanal (renderMatrizSemanal(), app.js) ya está separada en
   dos tablas — "PLAN DE ENGRASE (TURNO DÍA)" y "(TURNO NOCHE)" — así que
   cada ocurrencia Día vive SOLO en la tabla Día y cada ocurrencia Noche
   SOLO en la tabla Noche. Un equipo con doble turno activo aparece como
   fila en AMBAS tablas (dos ocurrencias independientes); un equipo de un
   solo turno aparece SOLO en su tabla. `estadoCeldaPorFila()` es la
   función que decide, para UNA fila/tabla concreta (`rowShiftId` = el
   turno de ESA tabla, nunca el turno global del equipo), qué estado le
   corresponde a esa celda — reusa estadosCeldaPorTurno()/estadoCelda()
   sin reimplementar nada:
     - Si el día ya es de doble turno real (effectiveDate alcanzada), usa
       el subestado de estadosCeldaPorTurno() que corresponde a
       `rowShiftId` — la fila del OTRO turno da 'vacio' ese día (nunca
       se combinan ambos en una sola celda).
     - Si el día todavía es de un solo turno (doble turno no configurado,
       o effectiveDate futura/sin alcanzar), solo la fila cuyo turno
       coincide con el turno único vigente ese día
       (requiredShiftsForPlan()[0], YA incluye el fallback a
       plan.shiftId) tiene la obligación real — se llama a estadoCelda()
       con shiftId=null para conservar la detección de "realizado
       atrasado" (que depende de NO filtrar por turno en la búsqueda del
       registro, ver estadoCelda() arriba). La fila del otro turno da
       'vacio' ese día — nunca aplica el doble turno retroactivamente.
*/
function estadoCeldaPorFila(eq, fecha, plans, records, hoy, rowShiftId, assignments = [], skips = []) {
  const plan = plans.find(p => p.equipmentId === eq.id);
  if (!plan) return { tipo: 'vacio' };
  const dual = estadosCeldaPorTurno(eq, fecha, plans, records, hoy, assignments, skips);
  if (dual.length) {
    const match = dual.find(d => d.shiftId === rowShiftId);
    return match ? match.state : { tipo: 'vacio' };
  }
  const dateISO = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
  const singleShiftId = requiredShiftsForPlan(plan, dateISO)[0];
  if (rowShiftId !== singleShiftId) return { tipo: 'vacio' };
  return estadoCelda(eq, fecha, plans, records, hoy, null, assignments, skips);
}

// Determina si un plan debe generar una FILA en la tabla del turno
// `rowShiftId`, para la SEMANA visible completa (`semanaInicioISO`..
// `semanaFinISO`) — no por día: la fila existe toda la semana, cada celda
// decide por su cuenta (estadoCeldaPorFila()) si ese día en particular le
// corresponde o no. Si el doble turno se activa en algún punto dentro de
// esa semana (`effectiveDate <= semanaFinISO`), el equipo necesita fila en
// AMBAS tablas aunque antes de effectiveDate solo una tuviera obligación
// real — la otra simplemente muestra 'vacio' en los días previos. Fuera
// de eso, la fila pertenece ÚNICAMENTE al turno único vigente
// (requiredShiftsForPlan()[0] al inicio de la semana, YA incluye el
// fallback a plan.shiftId) — NUNCA a `equipment.shiftId` (puede divergir
// de plan.shiftId, ver caso real 05-0870).
function planAppliesToShiftInWeek(plan, rowShiftId, semanaInicioISO, semanaFinISO) {
  if (!plan) return false;
  const dualActiveInWeek = Array.isArray(plan.requiredShifts) && ['shift_dia', 'shift_noche'].every(id => plan.requiredShifts.includes(id))
    && !!plan.effectiveDate && plan.effectiveDate <= semanaFinISO;
  if (dualActiveInWeek) return true;
  return rowShiftId === requiredShiftsForPlan(plan, semanaInicioISO)[0];
}
