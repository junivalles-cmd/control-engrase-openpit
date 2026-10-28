// tests/unit/master-data-import-gate.test.js
//
// LOTE A2 "GATE SEGURO DE DATOS MAESTROS" (previo a importar los 107
// equipos reales) — src/core/master-data-import-gate.js es puro (sin DOM/
// DB), se carga directamente desde la fuente real (mismo patrón que
// operational-scope.js/weekly-matrix.js: buildModuleBody + new Function)
// y se ejercita con datos de prueba, nunca con una reimplementación propia
// de las reglas.

import { describe, it, expect } from 'vitest';
import { readSource, buildModuleBody } from '../helpers/extractFromSource.js';
import { MASTER_DATA_IMPORT_GATE_JS_PATH } from '../helpers/loadLubricationLogic.js';

const gateSource = readSource(MASTER_DATA_IMPORT_GATE_JS_PATH);
const NAMES = ['issue', 'hasErrors', 'resolveShiftId', 'stripAccents', 'validateEquipmentImportRow', 'validatePointsImportRow', 'validatePlanImportRow', 'buildImportSummary', 'importHasBlockingErrors'];
const {
  validateEquipmentImportRow, validatePointsImportRow, validatePlanImportRow, buildImportSummary, importHasBlockingErrors,
} = new Function(buildModuleBody(gateSource, NAMES))();

function codeOf(issues, code) {
  return issues.find((i) => i.code === code);
}

// ---------- EQUIPMENT ----------

const TYPE_EXCAVADORA = { id: 'type1', name: 'Excavadora' };
const LOC_NORTE = { id: 'loc1', name: 'Botadero Norte' };
const EQ_EXISTENTE = { id: 'eq1', code: 'A-01', shortCode: '45-01', typeId: 'type1', locationId: 'loc1' };

function equipmentCtx(overrides = {}) {
  return {
    existingByCode: new Map([[EQ_EXISTENTE.code.toLowerCase(), EQ_EXISTENTE]]),
    typesByName: new Map([[TYPE_EXCAVADORA.name.toLowerCase(), TYPE_EXCAVADORA]]),
    locationsByName: new Map([[LOC_NORTE.name.toLowerCase(), LOC_NORTE]]),
    seenCodes: new Set(),
    ...overrides,
  };
}

function validRow(fields = {}) {
  return { ahorrativo: 'A-02', typeName: 'Excavadora', locationName: 'Botadero Norte', shift: 'Día', ...fields };
}

describe('EQUIPMENT — archivo 100% válido', () => {
  it('fila nueva (código no existente) -> CREATE, sin errores ni warnings', () => {
    const r = validateEquipmentImportRow(validRow(), equipmentCtx());
    expect(r.action).toBe('CREATE');
    expect(r.issues).toEqual([]);
    expect(r.resolved).toMatchObject({ code: 'A-02', shortCode: 'A-02', typeId: 'type1', locationId: 'loc1', shiftId: 'shift_dia' });
  });

  it('fila con código existente -> UPDATE, conserva el id real', () => {
    const r = validateEquipmentImportRow(validRow({ ahorrativo: 'A-01' }), equipmentCtx());
    expect(r.action).toBe('UPDATE');
    expect(r.resolved.existingId).toBe('eq1');
  });
});

describe('EQUIPMENT — código duplicado dentro del archivo', () => {
  it('la segunda fila con el mismo código bloquea (ERROR), la primera no', () => {
    const ctx = equipmentCtx();
    const r1 = validateEquipmentImportRow(validRow({ ahorrativo: 'A-09' }), ctx);
    const r2 = validateEquipmentImportRow(validRow({ ahorrativo: 'A-09' }), ctx);
    expect(importHasBlockingErrors([r1])).toBe(false);
    expect(codeOf(r2.issues, 'EQUIPMENT_CODE_DUPLICATE')).toBeTruthy();
    expect(r2.action).toBe('IGNORE');
  });

  it('código temporal (interno) duplicado entre dos filas sin Ahorrativo también bloquea', () => {
    const ctx = equipmentCtx();
    const r1 = validateEquipmentImportRow(validRow({ ahorrativo: '', internalCode: '9001' }), ctx);
    const r2 = validateEquipmentImportRow(validRow({ ahorrativo: '', internalCode: '9001' }), ctx);
    expect(importHasBlockingErrors([r1])).toBe(false);
    expect(codeOf(r2.issues, 'EQUIPMENT_CODE_DUPLICATE')).toBeTruthy();
  });

  it('Ahorrativo y Código interno vacíos -> ERROR (sin ningún código disponible)', () => {
    const r = validateEquipmentImportRow(validRow({ ahorrativo: '', internalCode: '' }), equipmentCtx());
    expect(codeOf(r.issues, 'EQUIPMENT_CODE_REQUIRED')).toBeTruthy();
    expect(r.action).toBe('IGNORE');
    expect(r.resolved).toBeNull();
  });
});

describe('EQUIPMENT — código temporal (Ahorrativo faltante/corrupto, LOTE 2026-10-26)', () => {
  it('Ahorrativo vacío + Código interno presente -> CREATE con WARNING, usa el interno como code, shortCode queda null', () => {
    const r = validateEquipmentImportRow(validRow({ ahorrativo: '', internalCode: '12345' }), equipmentCtx());
    expect(r.action).toBe('CREATE');
    expect(codeOf(r.issues, 'EQUIPMENT_SHORTCODE_PENDING')?.severity).toBe('warning');
    expect(r.resolved).toMatchObject({ code: '12345', shortCode: null });
  });

  it('Ahorrativo corrupto (coincide con el nombre de una ubicación real) se descarta y cae al código interno', () => {
    const r = validateEquipmentImportRow(validRow({ ahorrativo: 'Botadero Norte', internalCode: '77001' }), equipmentCtx());
    expect(r.action).toBe('CREATE');
    expect(codeOf(r.issues, 'EQUIPMENT_SHORTCODE_PENDING')).toBeTruthy();
    expect(r.resolved).toMatchObject({ code: '77001', shortCode: null });
  });

  it('código temporal que coincide con un equipo YA existente en producción -> ERROR, no se usa', () => {
    const r = validateEquipmentImportRow(validRow({ ahorrativo: '', internalCode: 'A-01' }), equipmentCtx());
    expect(codeOf(r.issues, 'EQUIPMENT_TEMP_CODE_COLLISION')).toBeTruthy();
    expect(r.action).toBe('IGNORE');
    expect(r.resolved).toBeNull();
  });
});

describe('EQUIPMENT — ubicación inexistente', () => {
  it('bloquea con ERROR, nunca crea la ubicación', () => {
    const r = validateEquipmentImportRow(validRow({ locationName: 'Ubicación Fantasma' }), equipmentCtx());
    expect(codeOf(r.issues, 'EQUIPMENT_LOCATION_NOT_FOUND')).toBeTruthy();
    expect(r.action).toBe('IGNORE');
    expect(r.resolved).toBeNull();
  });
});

describe('EQUIPMENT — tipo inexistente', () => {
  it('bloquea con ERROR, nunca crea el tipo', () => {
    const r = validateEquipmentImportRow(validRow({ typeName: 'Categoría Inventada' }), equipmentCtx());
    expect(codeOf(r.issues, 'EQUIPMENT_TYPE_NOT_FOUND')).toBeTruthy();
    expect(r.action).toBe('IGNORE');
  });
});

describe('EQUIPMENT — turno inválido', () => {
  it('un valor de turno desconocido bloquea con ERROR', () => {
    const r = validateEquipmentImportRow(validRow({ shift: 'Rotativo' }), equipmentCtx());
    expect(codeOf(r.issues, 'EQUIPMENT_SHIFT_UNKNOWN')).toBeTruthy();
    expect(r.action).toBe('IGNORE');
  });

  it('turno vacío es solo WARNING (se asume Día), no bloquea', () => {
    const r = validateEquipmentImportRow(validRow({ shift: '' }), equipmentCtx());
    expect(codeOf(r.issues, 'EQUIPMENT_SHIFT_DEFAULTED')?.severity).toBe('warning');
    expect(r.action).toBe('CREATE');
    expect(r.resolved.shiftId).toBe('shift_dia');
  });

  it('"Noche"/"noche"/"night" se resuelven a shift_noche sin warning', () => {
    for (const shift of ['Noche', 'noche', 'night']) {
      const r = validateEquipmentImportRow(validRow({ shift }), equipmentCtx());
      expect(r.resolved.shiftId).toBe('shift_noche');
      expect(r.issues).toEqual([]);
    }
  });
});

// ---------- POINTS ----------

const LUB_MOLY = { id: 'lub1', name: 'Grasa Moly' };
const PLAN_EQ2 = { id: 'plan1', equipmentId: 'eq2' };
const EQ_CON_PLAN = { id: 'eq2', code: 'B-02', typeId: 'type1', brand: 'Caterpillar' };
const EQ_SIN_PLAN = { id: 'eq3', code: 'B-03', typeId: 'type1', brand: 'Caterpillar' };

function pointsCtx(overrides = {}) {
  return {
    equipmentByCode: new Map([[EQ_CON_PLAN.code.toLowerCase(), EQ_CON_PLAN], [EQ_SIN_PLAN.code.toLowerCase(), EQ_SIN_PLAN]]),
    equipmentList: [EQ_CON_PLAN, EQ_SIN_PLAN],
    typesByName: new Map([[TYPE_EXCAVADORA.name.toLowerCase(), TYPE_EXCAVADORA]]),
    plansByEquipmentId: new Map([[EQ_CON_PLAN.id, PLAN_EQ2]]),
    lubricantsByName: new Map([[LUB_MOLY.name.toLowerCase(), LUB_MOLY]]),
    existingPointsByPlanId: new Map(),
    ...overrides,
  };
}

function validPointRow(fields = {}) {
  return { point: 'Cilindro izquierdo', freqRaw: '250', code: 'B-02', lubricantName: 'Grasa Moly', qtyRaw: '0.5', ...fields };
}

describe('POINTS — archivo 100% válido', () => {
  it('punto nuevo para un equipo con plan -> CREATE', () => {
    const r = validatePointsImportRow(validPointRow(), pointsCtx());
    expect(r.action).toBe('CREATE');
    expect(r.issues).toEqual([]);
    expect(r.resolved.targets).toEqual([{ equipmentId: 'eq2', planId: 'plan1', existingPointId: null }]);
  });

  it('punto ya existente en el plan -> UPDATE (no duplica)', () => {
    const ctx = pointsCtx({ existingPointsByPlanId: new Map([['plan1', [{ id: 'pt1', point: 'Cilindro izquierdo' }]]]) });
    const r = validatePointsImportRow(validPointRow(), ctx);
    expect(r.action).toBe('UPDATE');
    expect(r.resolved.targets[0].existingPointId).toBe('pt1');
  });
});

describe('POINTS — punto sin equipo/familia', () => {
  it('sin "Código" ni "Categoría" -> ERROR, bloquea', () => {
    const r = validatePointsImportRow(validPointRow({ code: '', category: '' }), pointsCtx());
    expect(codeOf(r.issues, 'POINT_TARGET_REQUIRED')).toBeTruthy();
    expect(r.action).toBe('IGNORE');
  });

  it('código de equipo inexistente -> ERROR', () => {
    const r = validatePointsImportRow(validPointRow({ code: 'B-99' }), pointsCtx());
    expect(codeOf(r.issues, 'POINT_EQUIPMENT_NOT_FOUND')).toBeTruthy();
  });

  it('categoría inexistente -> ERROR y NUNCA aplica a todos los equipos (bug real corregido)', () => {
    const r = validatePointsImportRow(validPointRow({ code: '', category: 'Categoría Fantasma' }), pointsCtx());
    expect(codeOf(r.issues, 'POINT_CATEGORY_NOT_FOUND')).toBeTruthy();
    expect(r.resolved).toBeNull();
  });

  it('equipo objetivo SIN plan existente -> ERROR, ya no crea el plan automáticamente', () => {
    const r = validatePointsImportRow(validPointRow({ code: 'B-03' }), pointsCtx());
    expect(codeOf(r.issues, 'POINT_EQUIPMENT_WITHOUT_PLAN')).toBeTruthy();
    expect(r.action).toBe('IGNORE');
  });
});

describe('POINTS — lubricante inexistente', () => {
  it('bloquea con ERROR, nunca crea el lubricante ni asume el primero de la lista', () => {
    const r = validatePointsImportRow(validPointRow({ lubricantName: 'Grasa Inventada' }), pointsCtx());
    expect(codeOf(r.issues, 'POINT_LUBRICANT_NOT_FOUND')).toBeTruthy();
    expect(r.action).toBe('IGNORE');
  });

  it('lubricante vacío también bloquea (ya no hay default implícito)', () => {
    const r = validatePointsImportRow(validPointRow({ lubricantName: '' }), pointsCtx());
    expect(codeOf(r.issues, 'POINT_LUBRICANT_REQUIRED')).toBeTruthy();
  });
});

describe('POINTS — otras reglas mínimas', () => {
  it('cantidad faltante o inválida -> ERROR, nunca asume 0.5 lb', () => {
    const r = validatePointsImportRow(validPointRow({ qtyRaw: '' }), pointsCtx());
    expect(codeOf(r.issues, 'POINT_QTY_REQUIRED')).toBeTruthy();
  });

  it('punto sin nombre -> ERROR', () => {
    const r = validatePointsImportRow(validPointRow({ point: '' }), pointsCtx());
    expect(codeOf(r.issues, 'POINT_NAME_REQUIRED')).toBeTruthy();
  });

  it('frecuencia inválida -> ERROR; frecuencia sospechosa (>5000h) -> solo WARNING', () => {
    const invalid = validatePointsImportRow(validPointRow({ freqRaw: '0' }), pointsCtx());
    expect(codeOf(invalid.issues, 'POINT_FREQUENCY_INVALID')).toBeTruthy();
    const suspicious = validatePointsImportRow(validPointRow({ freqRaw: '9000' }), pointsCtx());
    expect(codeOf(suspicious.issues, 'POINT_FREQUENCY_SUSPICIOUS')?.severity).toBe('warning');
    expect(suspicious.action).toBe('CREATE');
  });
});

// ---------- PLANS ----------

const EQ_PARA_PLAN = { id: 'eq4', code: 'C-01', shiftId: 'shift_dia', locationId: 'loc1', hourmeter: 100 };
function planCtx(overrides = {}) {
  return { equipmentByCode: new Map([[EQ_PARA_PLAN.code.toLowerCase(), EQ_PARA_PLAN]]), plansByEquipmentId: new Map(), locationsById: new Map([['loc1', LOC_NORTE]]), seenEquipmentCodes: new Set(), defaultAlertYellowHours: 10, ...overrides };
}
function validPlanRow(fields = {}) {
  return { equipmentCode: 'C-01', controlType: 'Horas de operación', frequencyRaw: '250', shiftMode: 'Día', lastGreaseHourRaw: '100', alertYellowHoursRaw: '10', ...fields };
}

describe('PLANS — plan inválido', () => {
  it('equipo inexistente -> ERROR, nunca crea el plan sin equipo real', () => {
    const r = validatePlanImportRow(validPlanRow({ equipmentCode: 'C-99' }), planCtx());
    expect(codeOf(r.issues, 'PLAN_EQUIPMENT_NOT_FOUND')).toBeTruthy();
    expect(r.action).toBe('IGNORE');
  });

  it('frecuencia inválida (<=0) -> ERROR para un plan "Horas de operación"', () => {
    const r = validatePlanImportRow(validPlanRow({ frequencyRaw: '0' }), planCtx());
    expect(codeOf(r.issues, 'PLAN_FREQUENCY_INVALID')).toBeTruthy();
  });

  it('turno desconocido -> ERROR', () => {
    const r = validatePlanImportRow(validPlanRow({ shiftMode: 'Mixto' }), planCtx());
    expect(codeOf(r.issues, 'PLAN_SHIFT_MODE_INVALID')).toBeTruthy();
  });

  it('plan válido ("Día y turno de la semana" no exige frecuencia) -> CREATE', () => {
    const r = validatePlanImportRow(validPlanRow({ controlType: 'Día y turno de la semana', frequencyRaw: '', assignedDays: 'Lunes, Miércoles' }), planCtx());
    expect(r.action).toBe('CREATE');
    expect(r.issues).toEqual([]);
    expect(r.resolved.equipmentId).toBe('eq4');
  });

  it('Día + Noche exige effectiveDate y admite requiredShifts válidos', () => {
    const invalid = validatePlanImportRow(validPlanRow({ shiftMode: 'Día + Noche', requiredShifts: 'Día,Noche', effectiveDate: '' }), planCtx());
    expect(codeOf(invalid.issues, 'PLAN_EFFECTIVE_DATE_REQUIRED')).toBeTruthy();
    const valid = validatePlanImportRow(validPlanRow({ shiftMode: 'Día + Noche', requiredShifts: 'Día,Noche', effectiveDate: '2026-11-01' }), planCtx());
    expect(valid.action).toBe('CREATE');
    expect(valid.resolved.requiredShifts).toEqual(['shift_dia', 'shift_noche']);
  });

  it('detecta duplicado dentro del archivo y plan existente incompatible', () => {
    const ctx = planCtx();
    expect(validatePlanImportRow(validPlanRow(), ctx).action).toBe('CREATE');
    expect(codeOf(validatePlanImportRow(validPlanRow(), ctx).issues, 'PLAN_EQUIPMENT_DUPLICATE')).toBeTruthy();
    const incompatible = validatePlanImportRow(validPlanRow(), planCtx({ plansByEquipmentId: new Map([['eq4', [{ id: 'p1' }, { id: 'p2' }]]]) }));
    expect(codeOf(incompatible.issues, 'PLAN_EXISTING_DUPLICATE')).toBeTruthy();
  });

  it('plan existente único se actualiza y conserva la regla de ubicación del equipo', () => {
    const existing = { id: 'p1', equipmentId: 'eq4', frequency: 100 };
    const update = validatePlanImportRow(validPlanRow({ frequencyRaw: '300' }), planCtx({ plansByEquipmentId: new Map([['eq4', [existing]]]) }));
    expect(update.action).toBe('UPDATE');
    expect(update.resolved.existingId).toBe('p1');
    const badLocation = validatePlanImportRow(validPlanRow(), planCtx({ locationsById: new Map() }));
    expect(codeOf(badLocation.issues, 'PLAN_EQUIPMENT_LOCATION_INVALID')).toBeTruthy();
  });

  it('un ERROR de plan bloquea el archivo completo; el preview puro no escribe', () => {
    const ctx = planCtx();
    const results = [
      validatePlanImportRow(validPlanRow(), ctx),
      validatePlanImportRow(validPlanRow({ equipmentCode: 'C-99' }), ctx),
    ];
    expect(importHasBlockingErrors(results)).toBe(true);
    expect(buildImportSummary(results)).toMatchObject({ total: 2, errors: 1, toCreate: 1, toIgnore: 1 });
    expect(gateSource).not.toMatch(/\bDB\.(put|delete)\s*\(/);
  });
});

// ---------- GATE A NIVEL DE ARCHIVO ----------

describe('Gate atómico: 1 error bloquea toda la escritura; el preview nunca modifica DB por sí mismo', () => {
  it('un archivo con 2 filas válidas y 1 con error -> importHasBlockingErrors() es true para el lote completo', () => {
    const ctx = equipmentCtx();
    const results = [
      validateEquipmentImportRow(validRow({ ahorrativo: 'Z-01' }), ctx),
      validateEquipmentImportRow(validRow({ ahorrativo: 'Z-02' }), ctx),
      validateEquipmentImportRow(validRow({ ahorrativo: 'Z-03', locationName: 'No existe' }), ctx),
    ];
    expect(importHasBlockingErrors(results)).toBe(true);
    const summary = buildImportSummary(results);
    expect(summary).toMatchObject({ total: 3, valid: 2, errors: 1, toCreate: 2, toIgnore: 1 });
  });

  it('un archivo 100% válido -> importHasBlockingErrors() es false', () => {
    const ctx = equipmentCtx();
    const results = [
      validateEquipmentImportRow(validRow({ ahorrativo: 'Z-10' }), ctx),
      validateEquipmentImportRow(validRow({ ahorrativo: 'Z-11' }), ctx),
    ];
    expect(importHasBlockingErrors(results)).toBe(false);
    expect(buildImportSummary(results)).toMatchObject({ total: 2, valid: 2, errors: 0, toCreate: 2 });
  });

  it('validateEquipmentImportRow()/validatePointsImportRow()/validatePlanImportRow() son funciones puras: nunca referencian DB/fetch/IndexedDB — confirma que el preview no puede escribir nada por sí mismo', () => {
    expect(gateSource).not.toMatch(/\bDB\.(put|delete)\s*\(/);
    expect(gateSource).not.toMatch(/\bindexedDB\b/);
    expect(gateSource).not.toMatch(/\bfetch\s*\(/);
  });
});
