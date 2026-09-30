// src/core/plan-compliance.js
//
// Cumplimiento del plan para un registro de engrase YA GUARDADO — 4 estados,
// nunca Sí/No (docs pedido: "Cumplimiento del plan"):
//   'anticipado'    — SOLO plan por Horas: se hizo con demasiada antelación
//                     respecto al intervalo (ver TOLERANCIA abajo).
//   'cumplido'      — el registro coincide con lo que el plan exigía (Día/
//                     Turno correctos, u Horas dentro de la tolerancia).
//   'fuera_de_plan' — hay plan y es evaluable, pero el registro NO coincide
//                     (día/turno equivocado, o se hizo tarde por horas).
//   'no_evaluable'  — no se puede demostrar con los datos existentes qué
//                     plan aplicaba en ese momento (ver regla de trazabilidad
//                     abajo). Nunca se inventa un resultado en este caso.
//
// TOLERANCIA (Horas de operación, decisión operativa registrada en
// docs/PLAN_COMPLIANCE_ANTICIPADO.md, ±10% del intervalo del plan):
//   ratio = (record.hourmeter - previousRecord.hourmeter) / plan.frequency
//   ratio < 0.90        → 'anticipado'
//   0.90 <= ratio <=1.10 → 'cumplido'
//   ratio > 1.10        → 'fuera_de_plan'
// Sin registro anterior: 'no_evaluable' (nunca se asume ninguno de los 3
// estados evaluables para el primer engrase). Día/Turno NO usa tolerancia —
// sigue siendo binario cumplido/fuera_de_plan, sin estado 'anticipado'.
//
// TRAZABILIDAD (inspección real de lubrication_records, app.js `record =
// stamp({..., planId: plan ? plan.id : null, ...})`): cada registro YA
// guarda `planId` (referencia al plan activo al momento de registrar) y
// `date` (fecha real del engrase). `lubrication_plans` ya guarda
// `updatedAt` (vía stamp() en db.js, se actualiza en cada guardado). No hace
// falta ningún campo nuevo para el caso general: si el plan NO fue tocado
// desde la fecha del registro (`plan.updatedAt <= record.date`), sus reglas
// actuales son un proxy válido de las reglas de entonces. Si el plan SÍ fue
// editado después de esa fecha, no hay forma de saber (con los datos
// actuales) qué regla regía en ese momento → 'no_evaluable'.
//
// LIMITACIÓN CONOCIDA (reportada, no resuelta aquí — ver instrucción "NO
// cambies schema/DB sin reportarlo primero"): `plan.updatedAt` es solo la
// marca del último cambio, no un historial completo. Un plan editado varias
// veces y luego revertido a sus valores originales se sigue marcando como
// "no evaluable" aunque el resultado final coincida — es la opción segura
// (nunca falso "cumplido"), no una limitación que se pueda corregir sin
// guardar un snapshot del plan en cada registro (fuera de alcance de este
// lote: implicaría tocar el schema de lubrication_records).
//
// Plan por horas: usa el HORÓMETRO REAL del registro anterior del MISMO
// equipo (no avgInterval, no fecha proyectada) — vencía a
// `previousRecord.hourmeter + plan.frequency`. Sin un registro anterior no
// hay base de comparación → 'no_evaluable' (nunca se asume "cumplido" para
// el primer registro).

function evaluateRecordCompliance(record, plan, previousRecord) {
  if (!record.planId || !plan || plan.id !== record.planId) {
    return { estado: 'no_evaluable', motivo: 'Este registro no tiene un plan asociado que se pueda verificar.' };
  }

  const recordDate = new Date(record.date);
  const planTouchedAt = new Date(plan.updatedAt || plan.createdAt || 0);
  if (planTouchedAt.getTime() > recordDate.getTime()) {
    return { estado: 'no_evaluable', motivo: 'El plan fue modificado después de esta fecha — no se puede confirmar qué regla aplicaba en ese momento.' };
  }

  if (plan.controlType === 'Día y turno de la semana') {
    const nombreDia = WEEKDAY_NAMES[recordDate.getDay()];
    const diaOk = (plan.assignedDays || []).includes(nombreDia);
    const turnoOk = !plan.shiftId || plan.shiftId === record.shiftId;
    if (diaOk && turnoOk) return { estado: 'cumplido', motivo: `Día y turno según el plan (${nombreDia}).` };
    if (!diaOk) return { estado: 'fuera_de_plan', motivo: `${nombreDia} no es un día asignado en el plan.` };
    // "Realizado atrasado" (lote occurrences/carryover, §6-9 del pedido): el
    // DÍA sí es el correcto — la ocurrencia programada de ESE día sigue
    // siendo la misma, nunca se cerró ni se reprogramó — solo se ejecutó en
    // el otro turno del mismo día (típicamente Noche cerrando lo pendiente
    // de Día). Antes esto se reportaba como 'fuera_de_plan' sin distinguirlo
    // de un día equivocado — engañoso, porque el trabajo SÍ se hizo, solo que
    // tarde dentro del mismo día.
    return { estado: 'realizado_atrasado', motivo: `${nombreDia} es correcto, pero se realizó en el otro turno del mismo día (plan: ${plan.shiftId === 'shift_dia' ? 'Día' : 'Noche'}, registrado: ${record.shiftId === 'shift_dia' ? 'Día' : 'Noche'}).` };
  }

  if (plan.controlType === 'Horas de operación') {
    if (record.hourmeter === undefined || record.hourmeter === null || Number.isNaN(record.hourmeter)) {
      return { estado: 'no_evaluable', motivo: 'Este registro no tiene un horómetro real con el que evaluar.' };
    }
    if (!previousRecord || previousRecord.hourmeter === undefined || previousRecord.hourmeter === null) {
      return { estado: 'no_evaluable', motivo: 'No hay un engrase anterior de este equipo con el que comparar el horómetro.' };
    }
    const frequency = plan.frequency || 0;
    const transcurridas = record.hourmeter - previousRecord.hourmeter;
    const ratio = frequency ? transcurridas / frequency : Infinity;
    if (ratio < 0.90) {
      return { estado: 'anticipado', motivo: `Se realizó a ${transcurridas.toFixed(1)} h del intervalo (${(ratio * 100).toFixed(0)}% de ${frequency} h) — con demasiada antelación.` };
    }
    if (ratio <= 1.10) {
      return { estado: 'cumplido', motivo: `Se realizó a ${transcurridas.toFixed(1)} h del intervalo (${(ratio * 100).toFixed(0)}% de ${frequency} h), dentro de la tolerancia ±10%.` };
    }
    return { estado: 'fuera_de_plan', motivo: `Se realizó a ${transcurridas.toFixed(1)} h del intervalo (${(ratio * 100).toFixed(0)}% de ${frequency} h), fuera de la tolerancia ±10%.` };
  }

  return { estado: 'no_evaluable', motivo: 'Tipo de plan no reconocido.' };
}

// Busca, dentro de TODOS los registros activos de un equipo (sin filtrar por
// fecha visible en pantalla — el vencimiento por horas depende del engrase
// real anterior, no del rango que el usuario esté mirando), el registro
// inmediatamente anterior a `record` por fecha.
function findPreviousRecord(record, allRecordsSameEquipo) {
  const before = allRecordsSameEquipo
    .filter(r => r.id !== record.id && new Date(r.date).getTime() < new Date(record.date).getTime());
  if (!before.length) return null;
  return before.reduce((latest, r) => new Date(r.date) > new Date(latest.date) ? r : latest);
}

// Programados/Realizados para un RANGO de fechas (Reportes) — mismo patrón
// ya usado y aprobado en el Dashboard ("Cumplimiento operativo" Hoy/Semana/
// Turno, ver renderDashboard()): para cada día del rango, cada equipo con
// plan "Día y turno de la semana" cuyo assignedDays incluya ese día de la
// semana cuenta como 1 "programado"; "realizado" si existe un
// lubrication_record de ese equipo en esa fecha (respetando el turno del
// plan, si tiene uno fijo). SOLO planes Día/Turno — los planes por Horas NO
// tienen una cantidad de "programados" fiable en un rango de fechas sin
// inventar una proyección horómetro→fecha (ver cabecera de este archivo),
// así que se excluyen a propósito de este cálculo (nunca se mezclan).
//
// Devuelve:
//   general:  { programados, realizados } — 1 slot por (equipo, día), sin
//             duplicar un plan sin turno fijo aunque aplique a ambos turnos
//             (para la fracción Realizados/Programados principal).
//   porTurno: { shift_dia: {...}, shift_noche: {...} } — un plan sin turno
//             fijo SÍ cuenta en ambos (cada turno es una oportunidad
//             independiente de cumplir, mismo criterio que progTurno en el
//             Dashboard) — por eso porTurno.shift_dia.programados +
//             porTurno.shift_noche.programados puede ser MAYOR que
//             general.programados cuando hay planes flexibles.
//   porEquipo: [{ e, programados, realizados }, ...] — mismo criterio que
//             `general`, desglosado por equipo.
//
// `turnoFiltro` (opcional, 'shift_dia'|'shift_noche'): si viene, todo el
// cálculo (general y porEquipo) se restringe a ESE turno únicamente.
function computeProgramadoRealizadoPeriodo(equiposDT, records, planByEquipoId, dias, turnoFiltro) {
  function turnoOk(plan, shiftId) { return !plan.shiftId || plan.shiftId === shiftId; }
  function hechoEnTurno(equipmentId, fechaStr, turno) {
    return records.some(r => r.equipmentId === equipmentId && r.shiftId === turno && new Date(r.date).toDateString() === fechaStr);
  }

  const porTurno = { shift_dia: { programados: 0, realizados: 0 }, shift_noche: { programados: 0, realizados: 0 } };
  const porEquipoMap = {};
  let generalProgramados = 0, generalRealizados = 0;

  equiposDT.forEach(e => {
    const plan = planByEquipoId[e.id];
    porEquipoMap[e.id] = { e, programados: 0, realizados: 0 };
    dias.forEach(d => {
      if (!(plan.assignedDays || []).includes(WEEKDAY_NAMES[d.getDay()])) return;
      const fechaStr = d.toDateString();
      const turnosDelPlan = plan.shiftId ? [plan.shiftId] : ['shift_dia', 'shift_noche'];
      const turnosAplican = turnoFiltro ? turnosDelPlan.filter(t => t === turnoFiltro) : turnosDelPlan;
      if (!turnosAplican.length) return;

      generalProgramados++;
      porEquipoMap[e.id].programados++;
      if (turnosAplican.some(t => hechoEnTurno(e.id, fechaStr, t))) {
        generalRealizados++;
        porEquipoMap[e.id].realizados++;
      }

      turnosAplican.forEach(t => {
        porTurno[t].programados++;
        if (hechoEnTurno(e.id, fechaStr, t)) porTurno[t].realizados++;
      });
    });
  });

  return {
    general: { programados: generalProgramados, realizados: generalRealizados },
    porTurno,
    porEquipo: Object.values(porEquipoMap),
  };
}

// Cumplimiento de flota a partir de una lista de resultados de
// evaluateRecordCompliance() ya calculados: 'cumplido' cuenta como
// cumplimiento, 'fuera_de_plan' como incumplimiento, 'anticipado' es una
// categoría separada (ni cumplimiento ni incumplimiento — no entra en el
// %), 'no_evaluable' se excluye del denominador por completo (no hay dato
// para juzgarlo en ningún sentido). 'realizado_atrasado' (lote occurrences/
// carryover) cuenta como cumplimiento en el %, igual que 'cumplido' — el
// día correcto SÍ se engrasó, solo en el otro turno del mismo día; se
// mantiene como bucket separado en `counts` para que Reportes pueda
// mostrarlo aparte si quiere, sin que penalice el % como si fuera
// incumplimiento real (mismo criterio que la Matriz Semanal, ver
// estadoCelda()/hecho_atrasado en weekly-matrix.js).
function computeFleetCompliance(evaluations) {
  const counts = { cumplido: 0, fuera_de_plan: 0, anticipado: 0, no_evaluable: 0, realizado_atrasado: 0 };
  evaluations.forEach(ev => { counts[ev.estado] = (counts[ev.estado] || 0) + 1; });
  const cumplidoTotal = counts.cumplido + counts.realizado_atrasado;
  const base = cumplidoTotal + counts.fuera_de_plan;
  const pct = base ? Math.round((cumplidoTotal / base) * 100) : null;
  return { pct, ...counts, total: evaluations.length };
}
