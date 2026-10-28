// @ts-check
/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT — src/core/master-data-import-gate.js
   LOTE A2 ("GATE SEGURO DE DATOS MAESTROS", previo a importar los 107
   equipos reales) — valida cada fila de un archivo de importación de
   equipment/lubrication_points/lubrication_plans ANTES de escribir nada.

   Reemplaza el criterio anterior de los importadores (crear tipo/
   ubicación/lubricante automáticamente, inventar cantidad/turno por
   defecto, aplicar silenciosamente a TODOS los equipos cuando una
   categoría no existía) por un gate explícito: toda referencia a un
   catálogo (tipo, ubicación, lubricante, equipo) debe EXISTIR de
   antemano — nunca se crea sobre la marcha durante una importación.

   Todo puro: recibe los datos ya cargados (equipos/tipos/ubicaciones/
   lubricantes/planes/puntos existentes) como parámetros explícitos,
   nunca toca DB/red/DOM — mismo criterio que operational-scope.js/
   weekly-matrix.js/plan-compliance.js. Quien llama (app.js) decide cómo
   leer el archivo (pickField()/readWorkbookRows(), ya existentes) y qué
   hacer con el resultado (pintar el preview, escribir en DB si no hay
   errores bloqueantes).
   ============================================================ */

/**
 * @typedef {{ severity: 'error'|'warning', code: string, message: string }} ImportIssue
 * @typedef {{ action: 'CREATE'|'UPDATE'|'IGNORE', issues: ImportIssue[], resolved: any }} ImportRowResult
 * @typedef {{ total: number, valid: number, warnings: number, errors: number, toCreate: number, toUpdate: number, toIgnore: number }} ImportSummary
 */

/** @param {'error'|'warning'} severity @param {string} code @param {string} message @returns {ImportIssue} */
function issue(severity, code, message) {
  return { severity, code, message };
}

/** @param {ImportIssue[]} issues @returns {boolean} */
function hasErrors(issues) {
  return issues.some((i) => i.severity === 'error');
}

/**
 * Único vocabulario de turno aceptado en toda importación — nunca un
 * valor libre. Vacío se resuelve a "shift_dia" (comportamiento histórico),
 * pero como WARNING explícito (ver callers) en vez de silencioso.
 * @param {string} raw
 * @returns {{ shiftId: 'shift_dia'|'shift_noche'|null, wasEmpty: boolean }}
 */
function resolveShiftId(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return { shiftId: null, wasEmpty: true };
  if (/^(dia|d[ií]a|day|shift_dia)$/.test(v)) return { shiftId: 'shift_dia', wasEmpty: false };
  if (/^(noche|night|shift_noche)$/.test(v)) return { shiftId: 'shift_noche', wasEmpty: false };
  return { shiftId: null, wasEmpty: false };
}

/** @param {string} s @returns {string} */
function stripAccents(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * EQUIPMENT — valida una fila de importación de equipos.
 *
 * Código operativo (LOTE "código temporal", 2026-10-26): el Ahorrativo ya no
 * es obligatorio para poder importar. Si falta, o viene corrupto (p.ej. el
 * nombre de una ubicación filtrado por error a esa columna en el archivo
 * origen), se usa el "Código" interno (GP/SAP) como código operativo
 * TEMPORAL — nunca se inventa un valor nuevo. `shortCode` queda en `null`
 * como marca de "Ahorrativo pendiente": no se agrega un flag nuevo al
 * modelo, mismo criterio que ya usan "sin plan"/"sin ubicación" en el resto
 * de la app (se detectan por ausencia de dato, nunca con un campo nuevo).
 * `id` (equipmentId) no depende de code/shortCode y no cambia cuando más
 * adelante se complete el Ahorrativo real — solo se actualiza `code`.
 *
 * @param {{ ahorrativo?: string, internalCode?: string, brand?: string, model?: string, serial?: string,
 *   description?: string, typeName?: string, locationName?: string, status?: string,
 *   hourmeterRaw?: string|number, shift?: string }} row
 * @param {{ existingByCode: Map<string, any>, typesByName: Map<string, any>,
 *   locationsByName: Map<string, any>, seenCodes: Set<string> }} ctx
 * @returns {ImportRowResult}
 */
function validateEquipmentImportRow(row, ctx) {
  const issues = [];

  const ahorrativoRaw = String(row.ahorrativo || '').trim();
  const internalCode = String(row.internalCode || '').trim();
  // Ahorrativo "corrupto": coincide con el nombre de una ubicación real (de
  // ctx.locationsByName, nunca una lista fija) -- señal de que el dato se
  // filtró a la columna equivocada en el archivo origen, no un código real.
  const knownLocationNames = new Set([...ctx.locationsByName.keys()].map((n) => stripAccents(n).toLowerCase()));
  const ahorrativoLooksLikeLocation = !!ahorrativoRaw && knownLocationNames.has(stripAccents(ahorrativoRaw).toLowerCase());
  const ahorrativo = ahorrativoLooksLikeLocation ? '' : ahorrativoRaw;

  let code, shortCodePending;
  if (ahorrativo) {
    code = ahorrativo;
    shortCodePending = false;
  } else if (internalCode) {
    code = internalCode;
    shortCodePending = true;
  } else {
    issues.push(issue('error', 'EQUIPMENT_CODE_REQUIRED', 'Falta tanto el "Ahorrativo" como el "Código" interno -- no hay ningún código disponible para esta fila.'));
    return { action: 'IGNORE', issues, resolved: null };
  }

  const codeKey = code.toLowerCase();
  if (ctx.seenCodes.has(codeKey)) {
    issues.push(issue('error', 'EQUIPMENT_CODE_DUPLICATE', `Código duplicado dentro del archivo: "${code}" aparece en más de una fila.`));
  } else {
    ctx.seenCodes.add(codeKey);
  }
  const existing = ctx.existingByCode.get(codeKey) || null;

  if (shortCodePending) {
    if (existing) {
      // El código temporal (interno) coincide con un equipo YA existente en
      // producción -- no se puede asumir que es el mismo equipo, podría
      // mezclar registros distintos. Bloqueante, nunca silencioso.
      issues.push(issue('error', 'EQUIPMENT_TEMP_CODE_COLLISION', `Equipo sin Ahorrativo: el código temporal "${code}" (código interno) ya coincide con un equipo existente en producción ("${existing.code}") -- no se usa como código temporal.`));
    } else {
      const reason = ahorrativoLooksLikeLocation
        ? `el Ahorrativo original ("${ahorrativoRaw}") es el nombre de una ubicación, no un código -- se descartó`
        : 'no tiene Ahorrativo';
      issues.push(issue('warning', 'EQUIPMENT_SHORTCODE_PENDING', `Equipo "${code}": ${reason}. Se usa el código interno "${internalCode}" como código operativo TEMPORAL -- completa el Ahorrativo real más adelante (no cambia el equipo, solo el código).`));
    }
  }

  const typeName = String(row.typeName || '').trim();
  let typeId = null;
  if (!typeName) {
    issues.push(issue('error', 'EQUIPMENT_TYPE_REQUIRED', `Equipo "${code}": falta la Categoría/Tipo.`));
  } else {
    const type = ctx.typesByName.get(typeName.toLowerCase());
    if (!type) {
      issues.push(issue('error', 'EQUIPMENT_TYPE_NOT_FOUND', `Equipo "${code}": la categoría "${typeName}" no existe. No se crea automáticamente — créala primero en Configuración.`));
    } else {
      typeId = type.id;
    }
  }

  const locationName = String(row.locationName || '').trim();
  let locationId = null;
  if (!locationName) {
    issues.push(issue('error', 'EQUIPMENT_LOCATION_REQUIRED', `Equipo "${code}": falta la Ubicación.`));
  } else {
    const location = ctx.locationsByName.get(locationName.toLowerCase());
    if (!location) {
      issues.push(issue('error', 'EQUIPMENT_LOCATION_NOT_FOUND', `Equipo "${code}": la ubicación "${locationName}" no existe. No se crea automáticamente.`));
    } else {
      locationId = location.id;
    }
  }

  const shiftRaw = String(row.shift || '').trim();
  const shiftResolved = resolveShiftId(shiftRaw);
  if (!shiftResolved.wasEmpty && !shiftResolved.shiftId) {
    issues.push(issue('error', 'EQUIPMENT_SHIFT_UNKNOWN', `Equipo "${code}": turno "${shiftRaw}" no es un valor conocido (usa Día o Noche).`));
  } else if (shiftResolved.wasEmpty) {
    issues.push(issue('warning', 'EQUIPMENT_SHIFT_DEFAULTED', `Equipo "${code}": turno no especificado — se asumirá Día.`));
  }

  let hourmeter = null;
  const hmRaw = row.hourmeterRaw;
  if (hmRaw !== undefined && hmRaw !== null && hmRaw !== '') {
    const parsed = parseFloat(String(hmRaw));
    if (isNaN(parsed) || parsed < 0) {
      issues.push(issue('warning', 'EQUIPMENT_HOURMETER_INVALID', `Equipo "${code}": horómetro "${hmRaw}" no es un número válido — se ignora, el equipo queda en 0 h.`));
    } else {
      hourmeter = parsed;
    }
  }

  const blocked = hasErrors(issues);
  const action = blocked ? 'IGNORE' : existing ? 'UPDATE' : 'CREATE';
  return {
    action,
    issues,
    resolved: blocked ? null : {
      code,
      shortCode: ahorrativo || null,
      brand: row.brand || '',
      model: row.model || '',
      serial: row.serial || '',
      description: row.description || 'Equipo',
      typeId,
      locationId,
      shiftId: shiftResolved.shiftId || 'shift_dia',
      status: row.status || 'Operativo',
      hourmeter,
      existingId: existing ? existing.id : null,
    },
  };
}

/**
 * POINTS — valida una fila de importación de puntos de engrase.
 * Ya NO crea planes automáticamente (ver POINT_EQUIPMENT_WITHOUT_PLAN):
 * el equipo objetivo debe tener un plan existente.
 * @param {{ point?: string, freqRaw?: string|number, code?: string, category?: string,
 *   brand?: string, system?: string, component?: string, lubricantName?: string,
 *   qtyRaw?: string|number }} row
 * @param {{ equipmentByCode: Map<string, any>, equipmentList: any[], typesByName: Map<string, any>,
 *   plansByEquipmentId: Map<string, any>, lubricantsByName: Map<string, any>,
 *   existingPointsByPlanId: Map<string, any[]> }} ctx
 * @returns {ImportRowResult}
 */
function validatePointsImportRow(row, ctx) {
  const issues = [];
  const point = String(row.point || '').trim();
  if (!point) {
    issues.push(issue('error', 'POINT_NAME_REQUIRED', 'Falta "Punto de engrase".'));
  }
  const label = point || '(sin nombre)';

  const freq = parseFloat(String(row.freqRaw ?? ''));
  if (isNaN(freq) || freq <= 0) {
    issues.push(issue('error', 'POINT_FREQUENCY_INVALID', `Punto "${label}": frecuencia inválida ("${row.freqRaw}") — debe ser un número mayor a 0.`));
  } else if (freq > 5000) {
    issues.push(issue('warning', 'POINT_FREQUENCY_SUSPICIOUS', `Punto "${label}": frecuencia de ${freq} horas parece un error de digitación.`));
  }

  const code = String(row.code || '').trim();
  const category = String(row.category || '').trim();
  /** @type {any[]} */
  let targets = [];
  if (code) {
    const eq = ctx.equipmentByCode.get(code.toLowerCase());
    if (!eq) issues.push(issue('error', 'POINT_EQUIPMENT_NOT_FOUND', `Punto "${label}": el código de equipo "${code}" no existe.`));
    else targets = [eq];
  } else if (category) {
    const type = ctx.typesByName.get(category.toLowerCase());
    if (!type) {
      issues.push(issue('error', 'POINT_CATEGORY_NOT_FOUND', `Punto "${label}": la categoría "${category}" no existe — no se aplica a ningún equipo (antes se aplicaba por error a TODOS los equipos cuando la categoría no coincidía).`));
    } else {
      const brand = String(row.brand || '').trim();
      targets = ctx.equipmentList.filter((e) => e.typeId === type.id && (!brand || String(e.brand || '').toLowerCase() === brand.toLowerCase()));
      if (!targets.length) {
        issues.push(issue('error', 'POINT_NO_MATCHING_EQUIPMENT', `Punto "${label}": ningún equipo activo coincide con categoría "${category}"${brand ? ` / marca "${brand}"` : ''}.`));
      }
    }
  } else {
    issues.push(issue('error', 'POINT_TARGET_REQUIRED', `Punto "${label}": falta "Código" o "Categoría" para saber a qué equipo(s) aplica.`));
  }

  const lubricantName = String(row.lubricantName || '').trim();
  let lubricantId = null;
  if (!lubricantName) {
    issues.push(issue('error', 'POINT_LUBRICANT_REQUIRED', `Punto "${label}": falta el lubricante — ya no se asume el primero de la lista.`));
  } else {
    const lub = ctx.lubricantsByName.get(lubricantName.toLowerCase());
    if (!lub) issues.push(issue('error', 'POINT_LUBRICANT_NOT_FOUND', `Punto "${label}": el lubricante "${lubricantName}" no existe. No se crea automáticamente.`));
    else lubricantId = lub.id;
  }

  const qty = parseFloat(String(row.qtyRaw ?? ''));
  let recommendedQty = null;
  if (isNaN(qty) || qty <= 0) {
    issues.push(issue('error', 'POINT_QTY_REQUIRED', `Punto "${label}": falta la cantidad recomendada — ya no se asume 0.5 lb por defecto.`));
  } else {
    recommendedQty = qty;
  }

  const plansForTargets = targets.map((eq) => ({ eq, plan: ctx.plansByEquipmentId.get(eq.id) || null }));
  const targetsWithoutPlan = plansForTargets.filter((t) => !t.plan);
  if (targets.length && targetsWithoutPlan.length) {
    issues.push(issue('error', 'POINT_EQUIPMENT_WITHOUT_PLAN',
      `Punto "${label}": ${targetsWithoutPlan.length} equipo(s) sin plan de engrase (${targetsWithoutPlan.map((t) => t.eq.code).join(', ')}) — crea el plan primero; importar puntos ya no crea planes automáticamente.`));
  }

  const blocked = hasErrors(issues);
  /** @type {{ equipmentId: string, planId: string, existingPointId: string|null }[]} */
  const resolvedTargets = [];
  if (!blocked) {
    for (const { eq, plan } of plansForTargets) {
      const existingPoint = (ctx.existingPointsByPlanId.get(plan.id) || []).find((p) => String(p.point || '').toLowerCase() === point.toLowerCase());
      resolvedTargets.push({ equipmentId: eq.id, planId: plan.id, existingPointId: existingPoint ? existingPoint.id : null });
    }
  }
  const action = blocked ? 'IGNORE' : resolvedTargets.length === 0 ? 'IGNORE' : resolvedTargets.some((t) => !t.existingPointId) ? 'CREATE' : 'UPDATE';

  return {
    action,
    issues,
    resolved: blocked ? null : {
      point,
      system: row.system || 'General',
      component: row.component || point,
      frequency: freq,
      lubricantId,
      recommendedQty,
      targets: resolvedTargets,
    },
  };
}

/**
 * PLANS — valida una fila de creación/importación de un plan de engrase.
 * No existe hoy un importador de Excel dedicado para lubrication_plans (el
 * único camino real de creación masiva era el auto-create dentro de
 * handlePointsExcelImport(), ahora removido — ver POINT_EQUIPMENT_WITHOUT_PLAN
 * arriba). Este validador queda listo para ese camino manual/futuro y se usa
 * también para auditar/testear la regla en sí.
 * @param {{ equipmentCode?: string, controlType?: string, frequencyRaw?: string|number,
 *   shiftMode?: string, requiredShifts?: string, effectiveDate?: string, assignedDays?: string,
 *   lastGreaseHourRaw?: string|number, alertYellowHoursRaw?: string|number }} row
 * @param {{ equipmentByCode: Map<string, any>, plansByEquipmentId?: Map<string, any[]>,
 *   locationsById?: Map<string, any>, seenEquipmentCodes?: Set<string>, defaultAlertYellowHours?: number }} ctx
 * @returns {ImportRowResult}
 */
function validatePlanImportRow(row, ctx) {
  const issues = [];
  const code = String(row.equipmentCode || '').trim();
  let equipment = null;
  if (!code) {
    issues.push(issue('error', 'PLAN_EQUIPMENT_REQUIRED', 'Falta el código del equipo.'));
  } else {
    equipment = ctx.equipmentByCode.get(code.toLowerCase()) || null;
    if (!equipment) issues.push(issue('error', 'PLAN_EQUIPMENT_NOT_FOUND', `El equipo "${code}" no existe — un plan no se crea automáticamente para un equipo inexistente.`));
  }

  const controlType = String(row.controlType || '').trim();
  if (!['Horas de operación', 'Día y turno de la semana'].includes(controlType)) {
    issues.push(issue('error', 'PLAN_CONTROL_TYPE_INVALID', `Plan de "${code || '(sin código)'}": tipo de control inválido. Usa "Horas de operación" o "Día y turno de la semana".`));
  }
  const isWeekday = controlType === 'Día y turno de la semana';

  const codeKey = code.toLowerCase();
  if (code && ctx.seenEquipmentCodes) {
    if (ctx.seenEquipmentCodes.has(codeKey)) issues.push(issue('error', 'PLAN_EQUIPMENT_DUPLICATE', `El equipo "${code}" aparece en más de una fila del archivo.`));
    else ctx.seenEquipmentCodes.add(codeKey);
  }

  const existingPlans = equipment ? (ctx.plansByEquipmentId?.get(equipment.id) || []) : [];
  if (existingPlans.length > 1) {
    issues.push(issue('error', 'PLAN_EXISTING_DUPLICATE', `Equipo "${code}": existen ${existingPlans.length} planes activos incompatibles. Resuélvelos antes de importar.`));
  }
  if (equipment && ctx.locationsById && !ctx.locationsById.has(equipment.locationId)) {
    issues.push(issue('error', 'PLAN_EQUIPMENT_LOCATION_INVALID', `Equipo "${code}": su ubicación actual no existe o no está activa. Corrige el equipo antes de importar el plan.`));
  }

  let frequency = null;
  if (!isWeekday) {
    frequency = parseFloat(String(row.frequencyRaw ?? ''));
    if (isNaN(frequency) || frequency <= 0) {
      issues.push(issue('error', 'PLAN_FREQUENCY_INVALID', `Plan de "${code || '(sin código)'}": frecuencia inválida — debe ser mayor a 0 horas.`));
    } else if (frequency > 5000) {
      issues.push(issue('warning', 'PLAN_FREQUENCY_SUSPICIOUS', `Plan de "${code}": frecuencia de ${frequency} horas parece un error de digitación.`));
    }
  }

  const shiftModeRaw = String(row.shiftMode || '').trim().toLowerCase();
  const shiftMode = /^(dia|d[ií]a|day|shift_dia)$/.test(shiftModeRaw) ? 'shift_dia'
    : /^(noche|night|shift_noche)$/.test(shiftModeRaw) ? 'shift_noche'
      : /^(dual|dia\s*\+\s*noche|d[ií]a\s*\+\s*noche|shift_dia\s*[,;+]\s*shift_noche)$/.test(shiftModeRaw) ? 'dual' : null;
  if (!shiftModeRaw) issues.push(issue('error', 'PLAN_SHIFT_MODE_REQUIRED', `Plan de "${code}": falta el modo de turno (Día, Noche o Día + Noche).`));
  else if (!shiftMode) issues.push(issue('error', 'PLAN_SHIFT_MODE_INVALID', `Plan de "${code}": modo de turno "${row.shiftMode}" no es válido.`));

  const requiredRaw = String(row.requiredShifts || '').trim();
  const requiredParts = requiredRaw ? requiredRaw.split(/[,;+|]/).map(v => resolveShiftId(v).shiftId).filter(Boolean) : [];
  if (requiredRaw && requiredParts.length !== requiredRaw.split(/[,;+|]/).length) {
    issues.push(issue('error', 'PLAN_REQUIRED_SHIFTS_INVALID', `Plan de "${code}": requiredShifts contiene un turno desconocido.`));
  }
  const requiredShifts = [...new Set(requiredParts)];
  if (shiftMode === 'dual' && requiredRaw && !(requiredShifts.includes('shift_dia') && requiredShifts.includes('shift_noche'))) {
    issues.push(issue('error', 'PLAN_REQUIRED_SHIFTS_INVALID', `Plan de "${code}": Día + Noche requiere ambos turnos en requiredShifts.`));
  }
  if (shiftMode && shiftMode !== 'dual' && requiredShifts.length) {
    issues.push(issue('error', 'PLAN_REQUIRED_SHIFTS_INVALID', `Plan de "${code}": un turno simple no admite requiredShifts.`));
  }

  const effectiveDate = String(row.effectiveDate || '').trim();
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) && !Number.isNaN(Date.parse(`${effectiveDate}T00:00:00Z`));
  if (shiftMode === 'dual' && !effectiveDate) issues.push(issue('error', 'PLAN_EFFECTIVE_DATE_REQUIRED', `Plan de "${code}": Día + Noche requiere fecha efectiva.`));
  else if (effectiveDate && !validDate) issues.push(issue('error', 'PLAN_EFFECTIVE_DATE_INVALID', `Plan de "${code}": fecha efectiva "${effectiveDate}" no es válida (usa AAAA-MM-DD).`));
  if (equipment && shiftMode && shiftMode !== 'dual' && equipment.shiftId && equipment.shiftId !== shiftMode) {
    issues.push(issue('error', 'PLAN_EQUIPMENT_SHIFT_MISMATCH', `Plan de "${code}": el turno del archivo no coincide con el turno actual del equipo. Actualiza primero el equipo; el importador no cambia equipos.`));
  }

  const assignedDays = String(row.assignedDays || '').split(/[,;+|]/).map(v => v.trim()).filter(Boolean);
  const validDays = new Set(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']);
  if (assignedDays.some(day => !validDays.has(day))) issues.push(issue('error', 'PLAN_ASSIGNED_DAYS_INVALID', `Plan de "${code}": contiene días asignados inválidos.`));

  const existing = existingPlans[0] || null;
  /** @param {string|number|undefined|null} raw @param {string} field @param {number} fallback */
  const parseOptionalNumber = (raw, field, fallback) => {
    if (raw === undefined || raw === null || raw === '') {
      issues.push(issue('warning', 'PLAN_' + field + '_RETAINED', `Plan de "${code}": ${field} no viene en el archivo — se conserva o deriva según la regla actual.`));
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) { issues.push(issue('error', 'PLAN_' + field + '_INVALID', `Plan de "${code}": ${field} debe ser un número válido mayor o igual a 0.`)); return null; }
    return value;
  };
  const lastGreaseHour = equipment ? parseOptionalNumber(row.lastGreaseHourRaw, 'LAST_GREASE_HOUR', existing?.lastGreaseHour ?? equipment.hourmeter) : null;
  const alertYellowHours = equipment ? parseOptionalNumber(row.alertYellowHoursRaw, 'ALERT_YELLOW_HOURS', existing?.alertYellowHours ?? ctx.defaultAlertYellowHours ?? 0) : null;

  // Ubicación/cuadrilla "según modelo actual" (pedido LOTE A2): el plan no
  // guarda su propia ubicación/cuadrilla — las hereda de equipment.locationId
  // ya validado arriba. No se inventa un campo nuevo aquí.
  const blocked = hasErrors(issues);
  return {
    action: blocked ? 'IGNORE' : existing ? 'UPDATE' : 'CREATE',
    issues,
    resolved: blocked ? null : {
      equipmentId: equipment.id,
      controlType,
      frequency: isWeekday ? (existing?.frequency ?? 0) : frequency,
      shiftId: shiftMode === 'dual' ? (existing?.shiftId || equipment.shiftId || 'shift_dia') : shiftMode,
      requiredShifts: shiftMode === 'dual' ? ['shift_dia', 'shift_noche'] : [],
      effectiveDate: shiftMode === 'dual' ? effectiveDate : (existing?.effectiveDate || ''),
      assignedDays: isWeekday ? assignedDays : (existing?.assignedDays || []),
      lastGreaseHour,
      alertYellowHours,
      existingId: existing?.id || null,
    },
  };
}

/**
 * @param {ImportRowResult[]} results
 * @returns {ImportSummary}
 */
function buildImportSummary(results) {
  const summary = { total: results.length, valid: 0, warnings: 0, errors: 0, toCreate: 0, toUpdate: 0, toIgnore: 0 };
  for (const r of results) {
    if (hasErrors(r.issues)) summary.errors++;
    else summary.valid++;
    if (r.issues.some((i) => i.severity === 'warning')) summary.warnings++;
    if (r.action === 'CREATE') summary.toCreate++;
    else if (r.action === 'UPDATE') summary.toUpdate++;
    else summary.toIgnore++;
  }
  return summary;
}

/** @param {ImportRowResult[]} results @returns {boolean} */
function importHasBlockingErrors(results) {
  return results.some((r) => hasErrors(r.issues));
}
