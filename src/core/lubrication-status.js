/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT — src/core/lubrication-status.js
   Estado de engrase de un equipo: pendiente / realizado / vencido, tanto
   por frecuencia de horómetro como por plan de día/turno de la semana.
   Extraído de app.js sin cambios de comportamiento (incluye la corrección
   ENGRASE-001 ya aplicada) — ver docs/MODULARIZATION.md.
   `weekdayStatusFor`/`statusFor` pueden usarse de forma pura si se les pasa
   `recordsList`/`plansList`; si no, leen `DB.allActive(...)` (definida en
   db.js), disponible como global cuando estas funciones se LLAMAN.
   Script clásico (sin export/import): queda disponible como global, igual
   que las de app.js/db.js/sync.js.
   ============================================================ */

const fmt = (n, d = 0) => Number(n).toLocaleString('es-NI', { minimumFractionDigits: d, maximumFractionDigits: d });

const WEEKDAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function mostRecentAssignedDate(assignedDays) {
  if (!assignedDays || !assignedDays.length) return null;
  const todayIdx = new Date().getDay();
  const assignedIdx = assignedDays.map(d => WEEKDAY_NAMES.indexOf(d));
  for (let back = 0; back < 7; back++) {
    const idx = (todayIdx - back + 7) % 7;
    if (assignedIdx.includes(idx)) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - back);
      return d;
    }
  }
  return null;
}

async function weekdayStatusFor(equipment, plan, recordsList) {
  // Reprogramación puntual: si a este equipo se le movió el engrase de esta semana a
  // otro día (porque estaba en uso, sin acceso, etc.), ese día manda sobre el plan.
  // No se toca el plan permanente: la semana siguiente vuelve a su día habitual.
  if (plan.reprogramadoHasta && new Date(plan.reprogramadoHasta) >= new Date(new Date().toDateString())) {
    const nuevoDia = new Date(plan.reprogramadoHasta);
    nuevoDia.setHours(0, 0, 0, 0);
    const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
    const records0 = recordsList || await DB.allActive('lubrication_records');
    const hecho = records0.some(r => r.equipmentId === equipment.id &&
      new Date(r.date) >= hoy0 && new Date(r.date).getTime() <= Date.now() + 5 * 60 * 1000);
    if (hecho) return { code: 'VERDE', label: 'AL DÍA', remaining: null, plan, scheduleDate: nuevoDia };
    if (nuevoDia.getTime() === hoy0.getTime()) {
      return { code: 'AMARILLO', label: 'REPROGRAMADO PARA HOY', remaining: null, plan, scheduleDate: nuevoDia, reprogramado: true };
    }
    if (nuevoDia > hoy0) {
      return { code: 'VERDE', label: `REPROGRAMADO AL ${WEEKDAY_NAMES[nuevoDia.getDay()].toUpperCase()}`, remaining: null, plan, scheduleDate: nuevoDia, reprogramado: true };
    }
  }

  const lastDue = mostRecentAssignedDate(plan.assignedDays || []);
  if (!lastDue) return { code: 'GRIS', label: 'SIN DÍAS ASIGNADOS', remaining: null, plan };
  const records = recordsList || await DB.allActive('lubrication_records');
  // Se ignoran los engrases con fecha FUTURA: pueden llegar de un dispositivo con el
  // reloj mal puesto, y darían por cumplido algo que todavía no ocurrió. La validación
  // del formulario no basta, porque estos registros también entran por sincronización.
  const ahora = Date.now() + 5 * 60 * 1000; // 5 min de tolerancia por desfases de reloj
  const done = records.some(r => r.equipmentId === equipment.id &&
    new Date(r.date) >= lastDue && new Date(r.date).getTime() <= ahora);
  const isToday = lastDue.toDateString() === new Date().toDateString();
  if (done) return { code: 'VERDE', label: 'AL DÍA', remaining: null, plan, scheduleDate: lastDue };
  if (isToday) return { code: 'AMARILLO', label: 'PROGRAMADO HOY', remaining: null, plan, scheduleDate: lastDue };
  return { code: 'ROJO', label: 'VENCIDO', remaining: null, plan, scheduleDate: lastDue };
}

// plansList / recordsList son opcionales: si se pasan (precargados una sola vez para
// varios equipos a la vez), evitamos volver a leer toda la tabla en cada llamada.
async function statusFor(equipment, plansList, recordsList) {
  if (equipment.status !== 'Operativo') {
    return { code: 'GRIS', label: 'DETENIDO', remaining: null };
  }
  const plans = plansList || await DB.allActive('lubrication_plans');
  const plan = plans.find(p => p.equipmentId === equipment.id);
  if (!plan) return { code: 'GRIS', label: 'SIN PLAN', remaining: null };

  if (plan.controlType === 'Día y turno de la semana') {
    return await weekdayStatusFor(equipment, plan, recordsList);
  }

  // ── Detección de planes con datos imposibles ─────────────────────────
  // Antes estos casos pasaban desapercibidos y daban un resultado tranquilizador
  // pero falso, que es peor que no mostrar nada.
  if (!plan.frequency || plan.frequency <= 0) {
    // Frecuencia 0 o negativa: el equipo quedaría vencido para siempre sin remedio.
    return { code: 'GRIS', label: 'PLAN MAL CONFIGURADO', remaining: null, plan,
             alerta: 'La frecuencia del plan es 0. Corrígela en Plan de Engrase.' };
  }
  // ENGRASE-001: el horómetro del equipo debe ser un número real. Antes, un
  // valor ausente/no numérico (undefined, texto, NaN) no se detectaba aquí y
  // terminaba mostrando "AL DÍA" (remaining daba NaN, que no es < 0 ni <=
  // alertYellowHours). Se valida explícitamente ANTES de comparar, sin
  // convertir el valor: Number.isFinite() no hace coerción.
  if (!Number.isFinite(equipment.hourmeter)) {
    return { code: 'GRIS', label: 'DATOS INCONSISTENTES', remaining: null, plan,
             alerta: `El horómetro del equipo no es un número válido (valor actual: ${JSON.stringify(equipment.hourmeter)}). Corrígelo en la ficha del equipo.` };
  }
  if (plan.lastGreaseHour > equipment.hourmeter) {
    // La referencia del último engrase es mayor que el horómetro actual: da un margen
    // falso. Pasa al corregir un horómetro hacia abajo o al importar datos mal.
    return { code: 'GRIS', label: 'DATOS INCONSISTENTES', remaining: null, plan,
             alerta: `El plan dice que se engrasó a ${fmt(plan.lastGreaseHour)} h, pero el equipo marca ${fmt(equipment.hourmeter)} h. Revisa el horómetro o la referencia del plan.` };
  }

  const nextHour = plan.lastGreaseHour + plan.frequency;
  const remaining = nextHour - equipment.hourmeter;
  let code, label;
  if (remaining < 0) { code = 'ROJO'; label = 'VENCIDO'; }
  else if (remaining <= (plan.alertYellowHours || 10)) { code = 'AMARILLO'; label = 'PRÓXIMO'; }
  else { code = 'VERDE'; label = 'AL DÍA'; }
  return { code, label, remaining, nextHour, plan };
}
