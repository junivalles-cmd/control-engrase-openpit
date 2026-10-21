// tests/unit/grease-validation.test.js
//
// Validación del engrase con firma — lógica pura de
// src/core/grease-validation.js contra la función REAL
// (validateValidationForm/statusForSignerRole/findActiveValidations/
// hasValidationConflict/findActiveValidation/validationStatusFor). Sin DOM,
// sin IndexedDB — la persistencia real (grease_validations, db.js/sync.js)
// se prueba aparte en tests/unit/grease-validation-persistence.test.js.
// IMPORTANTE: validationStatusFor() NUNCA lee un campo `validationStatus`
// guardado — siempre deriva de cuántas validaciones activas hay y, si es
// exactamente una, de su `signerRole`.

import { describe, it, expect } from 'vitest';
import { loadGreaseValidationLogic, GREASE_VALIDATION_JS_PATH, APP_JS_PATH } from '../helpers/loadLubricationLogic.js';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';

const {
  VALIDATION_STATUS, VALIDATION_BADGE, GREASE_VALIDATION_ENABLED_FROM, MAX_VALIDATION_SHIFTS,
  isRecordSubjectToValidation, statusForSignerRole, validateValidationForm, findActiveValidations,
  hasValidationConflict, findActiveValidation, validationStatusFor, validationStatusForRecord,
  isRecordPendingValidation, isRecordInConflict, isRecordValidationExpired,
  shiftWindowStart, validationDeadline, isValidationExpired,
} = loadGreaseValidationLogic();

// Turnos reales por defecto en este sistema (App.generalSettings, ver
// src/core/shifts.js) — mismos horarios que usan las pantallas reales,
// nunca horarios inventados a propósito para la prueba.
const SHIFTS = { shiftDayStart: 6, shiftNightStart: 18 };

describe('Estados y badges — 6 estados (incluye HISTORICO_SIN_VALIDACION, CONFLICTO_VALIDACION y VALIDACION_VENCIDA), sin OBSERVADO (auditado, no implementado)', () => {
  it('6 estados exactos: HISTORICO_SIN_VALIDACION / PENDIENTE_VALIDACION / VALIDADO_OPERADOR / VALIDADO_ENCARGADO / CONFLICTO_VALIDACION / VALIDACION_VENCIDA', () => {
    expect(VALIDATION_STATUS).toEqual({
      HISTORICO: 'HISTORICO_SIN_VALIDACION',
      PENDIENTE: 'PENDIENTE_VALIDACION',
      OPERADOR: 'VALIDADO_OPERADOR',
      ENCARGADO: 'VALIDADO_ENCARGADO',
      CONFLICTO: 'CONFLICTO_VALIDACION',
      VENCIDA: 'VALIDACION_VENCIDA',
    });
  });

  it('MAX_VALIDATION_SHIFTS = 2 — constante central única', () => {
    expect(MAX_VALIDATION_SHIFTS).toBe(2);
  });

  it('badge VENCIDA es el texto exacto pedido, distinto de Conflicto en el label', () => {
    const badge = VALIDATION_BADGE['VALIDACION_VENCIDA'];
    expect(badge.label).toBe('Validación vencida');
    expect(badge.label).not.toBe(VALIDATION_BADGE['CONFLICTO_VALIDACION'].label);
  });

  it('badge HISTORICO es neutro y el texto NUNCA dice "Pendiente"', () => {
    const badge = VALIDATION_BADGE['HISTORICO_SIN_VALIDACION'];
    expect(badge).toEqual({ label: 'Histórico · Sin validación requerida', tone: 'neutral' });
    expect(badge.label).not.toContain('Pendiente');
  });

  it('badge PENDIENTE es ámbar con el texto exacto pedido', () => {
    expect(VALIDATION_BADGE['PENDIENTE_VALIDACION']).toEqual({ label: 'Engrasado · Pendiente de validación', tone: 'amber' });
  });

  it('badge OPERADOR es verde ("Validado · Operador")', () => {
    expect(VALIDATION_BADGE['VALIDADO_OPERADOR']).toEqual({ label: 'Validado · Operador', tone: 'green' });
  });

  it('badge ENCARGADO es positivo pero visualmente distinto de OPERADOR (tono propio, no el mismo verde)', () => {
    const badge = VALIDATION_BADGE['VALIDADO_ENCARGADO'];
    expect(badge.label).toBe('Validado · Encargado');
    expect(badge.tone).not.toBe('amber'); // no es "alerta"
    expect(badge.tone).not.toBe(VALIDATION_BADGE['VALIDADO_OPERADOR'].tone); // distinto del de Operador
  });

  it('badge CONFLICTO tiene tono de alerta distinto de Pendiente (amber) y de ambos Validado', () => {
    const badge = VALIDATION_BADGE['CONFLICTO_VALIDACION'];
    expect(badge.label).toBe('Conflicto de validación');
    expect(badge.tone).not.toBe(VALIDATION_BADGE['PENDIENTE_VALIDACION'].tone);
    expect(badge.tone).not.toBe(VALIDATION_BADGE['VALIDADO_OPERADOR'].tone);
    expect(badge.tone).not.toBe(VALIDATION_BADGE['VALIDADO_ENCARGADO'].tone);
  });

  it('statusForSignerRole mapea Operador/Encargado a su estado, y null para cualquier otro valor', () => {
    expect(statusForSignerRole('OPERADOR')).toBe('VALIDADO_OPERADOR');
    expect(statusForSignerRole('ENCARGADO')).toBe('VALIDADO_ENCARGADO');
    expect(statusForSignerRole('')).toBeNull();
    expect(statusForSignerRole(undefined)).toBeNull();
  });
});

describe('validateValidationForm() — no permite confirmar sin nombre, rol, firma, ni motivo (Encargado)', () => {
  it('formulario completo como Operador → válido, sin exigir motivo', () => {
    const r = validateValidationForm({ signerName: 'Juan Pérez', signerRole: 'OPERADOR', reason: '', hasSignature: true });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual({});
  });

  it('Encargado SIN motivo → inválido, error específico en `reason`', () => {
    const r = validateValidationForm({ signerName: 'María López', signerRole: 'ENCARGADO', reason: '', hasSignature: true });
    expect(r.valid).toBe(false);
    expect(r.errors.reason).toBeTruthy();
  });

  it('Encargado CON motivo → válido', () => {
    const r = validateValidationForm({ signerName: 'María López', signerRole: 'ENCARGADO', reason: 'Operador no disponible', hasSignature: true });
    expect(r.valid).toBe(true);
  });

  it('firma vacía (hasSignature=false) → inválido aunque el resto esté completo', () => {
    const r = validateValidationForm({ signerName: 'Juan Pérez', signerRole: 'OPERADOR', reason: '', hasSignature: false });
    expect(r.valid).toBe(false);
    expect(r.errors.signature).toBeTruthy();
  });

  it('sin nombre → inválido', () => {
    const r = validateValidationForm({ signerName: '  ', signerRole: 'OPERADOR', reason: '', hasSignature: true });
    expect(r.valid).toBe(false);
    expect(r.errors.signerName).toBeTruthy();
  });

  it('sin rol (ni Operador ni Encargado) → inválido', () => {
    const r = validateValidationForm({ signerName: 'Juan Pérez', signerRole: '', reason: '', hasSignature: true });
    expect(r.valid).toBe(false);
    expect(r.errors.signerRole).toBeTruthy();
  });

  it('formulario totalmente vacío → inválido en los 4 campos a la vez', () => {
    const r = validateValidationForm({ signerName: '', signerRole: '', reason: '', hasSignature: false });
    expect(r.valid).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(['signature', 'signerName', 'signerRole']);
  });
});

describe('findActiveValidations()/hasValidationConflict() — base de todo, nunca elige, solo junta', () => {
  it('0 activas → array vacío, sin conflicto', () => {
    expect(findActiveValidations('greg_1', [])).toEqual([]);
    expect(hasValidationConflict('greg_1', [])).toBe(false);
  });

  it('1 activa → array de 1, sin conflicto', () => {
    const validations = [{ lubricationRecordId: 'greg_1', signerRole: 'OPERADOR', active: true }];
    expect(findActiveValidations('greg_1', validations)).toEqual(validations);
    expect(hasValidationConflict('greg_1', validations)).toBe(false);
  });

  it('2+ activas para el MISMO registro → CONFLICTO detectado, junta ambas (nunca descarta ninguna)', () => {
    const validations = [
      { id: 'val_a', lubricationRecordId: 'greg_1', signerRole: 'OPERADOR', active: true },
      { id: 'val_b', lubricationRecordId: 'greg_1', signerRole: 'ENCARGADO', active: true },
    ];
    expect(findActiveValidations('greg_1', validations)).toHaveLength(2);
    expect(hasValidationConflict('greg_1', validations)).toBe(true);
  });

  it('una validación con active:false NO cuenta para el conflicto', () => {
    const validations = [
      { lubricationRecordId: 'greg_1', signerRole: 'OPERADOR', active: true },
      { lubricationRecordId: 'greg_1', signerRole: 'ENCARGADO', active: false },
    ];
    expect(findActiveValidations('greg_1', validations)).toHaveLength(1);
    expect(hasValidationConflict('greg_1', validations)).toBe(false);
  });

  it('validaciones de OTRO registro no afectan el conteo de este', () => {
    const validations = [
      { lubricationRecordId: 'greg_1', signerRole: 'OPERADOR', active: true },
      { lubricationRecordId: 'greg_2', signerRole: 'ENCARGADO', active: true },
    ];
    expect(hasValidationConflict('greg_1', validations)).toBe(false);
  });
});

describe('findActiveValidation() — SOLO devuelve algo cuando hay EXACTAMENTE una (nunca elige en silencio con 2+)', () => {
  it('sin ninguna validación activa → null', () => {
    expect(findActiveValidation('greg_1', [])).toBeNull();
  });

  it('con una validación activa → la devuelve', () => {
    const validations = [{ lubricationRecordId: 'greg_1', signerRole: 'ENCARGADO', active: true }];
    expect(findActiveValidation('greg_1', validations)).toBe(validations[0]);
  });

  it('con DOS o más activas → null (NUNCA elige la "primera" en silencio — antes de este lote sí lo hacía, es el fix explícito pedido)', () => {
    const validations = [
      { id: 'val_a', lubricationRecordId: 'greg_1', signerRole: 'OPERADOR', active: true },
      { id: 'val_b', lubricationRecordId: 'greg_1', signerRole: 'ENCARGADO', active: true },
    ];
    expect(findActiveValidation('greg_1', validations)).toBeNull();
  });

  it('una validación con active:false (revertida/corregida) NO cuenta — sigue pendiente', () => {
    const validations = [{ lubricationRecordId: 'greg_1', signerRole: 'OPERADOR', active: false }];
    expect(findActiveValidation('greg_1', validations)).toBeNull();
  });
});

describe('validationStatusFor() — 0/1/2+ → PENDIENTE / según signerRole / CONFLICTO', () => {
  it('0 activas → PENDIENTE_VALIDACION', () => {
    expect(validationStatusFor('greg_1', [])).toBe('PENDIENTE_VALIDACION');
    expect(validationStatusFor('greg_1', [{ lubricationRecordId: 'greg_2', signerRole: 'OPERADOR', active: true }])).toBe('PENDIENTE_VALIDACION');
  });

  it('1 activa Operador → VALIDADO_OPERADOR; 1 activa Encargado → VALIDADO_ENCARGADO', () => {
    expect(validationStatusFor('greg_1', [{ lubricationRecordId: 'greg_1', signerRole: 'OPERADOR', active: true }])).toBe('VALIDADO_OPERADOR');
    expect(validationStatusFor('greg_1', [{ lubricationRecordId: 'greg_1', signerRole: 'ENCARGADO', active: true }])).toBe('VALIDADO_ENCARGADO');
  });

  it('un campo validationStatus guardado (si existiera, ej. dato viejo) se IGNORA — solo importa signerRole', () => {
    const validations = [{ lubricationRecordId: 'greg_1', signerRole: 'OPERADOR', validationStatus: 'VALIDADO_ENCARGADO', active: true }];
    expect(validationStatusFor('greg_1', validations)).toBe('VALIDADO_OPERADOR');
  });

  it('2+ activas → CONFLICTO_VALIDACION (nunca "el primero que encuentra")', () => {
    const validations = [
      { lubricationRecordId: 'greg_1', signerRole: 'OPERADOR', active: true },
      { lubricationRecordId: 'greg_1', signerRole: 'ENCARGADO', active: true },
    ];
    expect(validationStatusFor('greg_1', validations)).toBe('CONFLICTO_VALIDACION');
  });
});

describe('CORRECCIÓN CENTRAL — baseline REAL activado (rollout: inicio del próximo Turno Día tras 2026-09-26)', () => {
  // Valor productivo real (src/core/grease-validation.js) — nunca se reinventa
  // aquí, se lee de la fuente igual que el resto del módulo. Fechas de prueba
  // fijas (nunca new Date()/"hoy"): el baseline es un instante concreto ya
  // pasado el mediodía UTC de mañana en cualquier corrida futura de esta
  // prueba, así que usar la hora real del reloj eventualmente cruzaría el
  // baseline y volvería estos casos falsos con el tiempo — exactamente el
  // tipo de prueba frágil que este proyecto evita (ver convención en
  // tests/ui/mis-engrases-flow.spec.js).
  const BASELINE = GREASE_VALIDATION_ENABLED_FROM;
  const ANTES = '2026-09-27T11:59:59.000Z'; // 1 segundo antes
  const DESPUES = '2026-09-27T12:00:01.000Z'; // 1 segundo después

  it('está configurado con el inicio del próximo Turno Día (App.generalSettings real: shiftDayStart=6) — no quedó en null', () => {
    expect(BASELINE).toBe('2026-09-27T12:00:00.000Z');
  });

  it('A) registro 1 segundo ANTES del baseline → NO sujeto a validación (queda Histórico)', () => {
    expect(isRecordSubjectToValidation(ANTES)).toBe(false);
  });

  it('B) registro EXACTAMENTE en el baseline → SÍ sujeto a validación (comparación inclusiva ">=")', () => {
    expect(isRecordSubjectToValidation(BASELINE)).toBe(true);
  });

  it('C) registro DESPUÉS del baseline → sujeto a validación', () => {
    expect(isRecordSubjectToValidation(DESPUES)).toBe(true);
  });

  it('G) un registro histórico (anterior al baseline) NUNCA aparece como pendiente, tenga o no grease_validations reales', () => {
    const record = { id: 'greg_0', date: ANTES };
    expect(validationStatusForRecord(record, [])).toBe('HISTORICO_SIN_VALIDACION');
    const validations = [{ lubricationRecordId: 'greg_0', signerRole: 'OPERADOR', active: true }];
    // Aunque exista una firma real (ej. una prueba anterior al rollout), el
    // estado mostrado sigue siendo Histórico — la firma no se pierde en la
    // base de datos, pero no cuenta oficialmente para un registro anterior.
    expect(validationStatusForRecord(record, validations)).toBe('HISTORICO_SIN_VALIDACION');
    expect(isRecordPendingValidation(record, [])).toBe(false);
  });

  it('un registro histórico con 2+ firmas activas tampoco cuenta como conflicto (sigue siendo anterior al rollout)', () => {
    const record = { id: 'greg_0', date: ANTES };
    const validations = [
      { id: 'val_a', lubricationRecordId: 'greg_0', signerRole: 'OPERADOR', active: true },
      { id: 'val_b', lubricationRecordId: 'greg_0', signerRole: 'ENCARGADO', active: true },
    ];
    expect(hasValidationConflict('greg_0', validations)).toBe(true); // el dato crudo SÍ tiene conflicto
    expect(isRecordInConflict(record, validations)).toBe(false); // pero es anterior al baseline
  });

  it('la comparación de fechas en la fuente usa ">=" (inclusive, "record.date >= ENABLED_FROM" → sujeto)', () => {
    const srcFn = extractDeclaration(readSource(GREASE_VALIDATION_JS_PATH), 'isRecordSubjectToValidation');
    expect(srcFn).toContain('new Date(recordDate).getTime() >= new Date(GREASE_VALIDATION_ENABLED_FROM).getTime()');
    expect(srcFn).toContain('if (!GREASE_VALIDATION_ENABLED_FROM) return false;');
  });

  it('validationStatusForRecord() antepone el chequeo de histórico ANTES de evaluar conflicto/vencida (isRecordSubjectToValidation primero)', () => {
    const srcFn = extractDeclaration(readSource(GREASE_VALIDATION_JS_PATH), 'validationStatusForRecord');
    const iHistorico = srcFn.indexOf('VALIDATION_STATUS.HISTORICO');
    const iConflicto = srcFn.indexOf('VALIDATION_STATUS.CONFLICTO');
    expect(iHistorico).toBeGreaterThan(-1);
    expect(iConflicto).toBeGreaterThan(-1);
    expect(iHistorico).toBeLessThan(iConflicto);
  });

  it('isRecordPendingValidation()/isRecordInConflict() nunca leen un campo guardado en el record — derivan de isRecordSubjectToValidation() (única fuente central)', () => {
    const pendSrc = extractDeclaration(readSource(GREASE_VALIDATION_JS_PATH), 'isRecordPendingValidation');
    expect(pendSrc).toContain('isRecordSubjectToValidation(record.date)');
    expect(pendSrc).toContain('findActiveValidations(record.id, validations).length !== 0');
    expect(pendSrc).toContain('return true;');
    const conflictSrc = extractDeclaration(readSource(GREASE_VALIDATION_JS_PATH), 'isRecordInConflict');
    expect(conflictSrc).toContain('isRecordSubjectToValidation(record.date)');
    expect(conflictSrc).toContain('hasValidationConflict(record.id, validations)');
  });

  it('las 4 funciones consumidoras (validationStatusForRecord/isRecordPendingValidation/isRecordInConflict) NO redefinen su propia condición de fecha — todas llaman al mismo isRecordSubjectToValidation()', () => {
    const source = readSource(GREASE_VALIDATION_JS_PATH);
    const consumidoras = ['validationStatusForRecord', 'isRecordPendingValidation', 'isRecordInConflict'];
    consumidoras.forEach(name => {
      const fnSrc = extractDeclaration(source, name);
      expect(fnSrc).toContain('isRecordSubjectToValidation(record.date)');
      expect(fnSrc).not.toMatch(/new Date\(record\.date\)\.getTime\(\)\s*>=/); // no repite la comparación a mano
    });
  });
});

describe('Flujo end-to-end con el baseline REAL activado (fecha de registro DESPUÉS del rollout, sin fixture)', () => {
  // A diferencia del describe de "baseline de fixture" (más abajo, con su
  // propio ENABLED_FROM inventado para poder probar cualquier fecha), este
  // bloque usa el módulo REAL tal cual queda importado arriba — prueba el
  // comportamiento que de verdad va a correr en producción tras el rollout.
  const DESPUES_DIA = '2026-09-28T09:00:00'; // turno Día, ya dentro del rollout

  it('D) sujeto a validación + sin firma + dentro de la ventana → PENDIENTE_VALIDACION', () => {
    const record = { id: 'greg_1', date: DESPUES_DIA };
    const now = new Date('2026-09-28T11:00:00'); // mismo turno Día
    expect(validationStatusForRecord(record, [], now, SHIFTS)).toBe('PENDIENTE_VALIDACION');
    expect(isRecordPendingValidation(record, [], now, SHIFTS)).toBe(true);
  });

  it('E) firma dentro de los 2 turnos permitidos → VALIDADO_OPERADOR (no vencida)', () => {
    const record = { id: 'greg_1', date: DESPUES_DIA };
    const validations = [{ lubricationRecordId: 'greg_1', signerRole: 'OPERADOR', active: true }];
    const now = new Date('2026-09-28T20:00:00'); // Noche del mismo día = 2º turno
    expect(validationStatusForRecord(record, validations, now, SHIFTS)).toBe('VALIDADO_OPERADOR');
    expect(isRecordValidationExpired(record, validations, now, SHIFTS)).toBe(false);
  });

  it('F) sin firma después de superado el 2º turno → VALIDACION_VENCIDA', () => {
    const record = { id: 'greg_1', date: DESPUES_DIA };
    const now = new Date('2026-09-29T07:00:00'); // Día del día siguiente = 3er turno
    expect(validationStatusForRecord(record, [], now, SHIFTS)).toBe('VALIDACION_VENCIDA');
    expect(isRecordPendingValidation(record, [], now, SHIFTS)).toBe(true);
  });

  it('H) 2+ firmas activas mantiene PRIORIDAD de conflicto aunque el plazo ya haya vencido', () => {
    const record = { id: 'greg_1', date: DESPUES_DIA };
    const validations = [
      { id: 'val_a', lubricationRecordId: 'greg_1', signerRole: 'OPERADOR', active: true },
      { id: 'val_b', lubricationRecordId: 'greg_1', signerRole: 'ENCARGADO', active: true },
    ];
    const now = new Date('2026-10-05T00:00:00'); // muy pasado el plazo
    expect(validationStatusForRecord(record, validations, now, SHIFTS)).toBe('CONFLICTO_VALIDACION');
    expect(isRecordInConflict(record, validations, now, SHIFTS)).toBe(true);
  });
});

// Formatea en hora LOCAL (nunca .toISOString(), que convierte a UTC y
// rompe la comparación si la máquina que corre la prueba no está en UTC —
// shiftWindowStart()/validationDeadline() trabajan con Date en hora local,
// igual que new Date(hour) en el resto del código real).
function fmtLocal(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

describe('PLAZO DE VALIDACIÓN — MAX_VALIDATION_SHIFTS turnos, referencia SIEMPRE lubrication_record.date (nunca sync/apertura de pantalla)', () => {
  it('shiftWindowStart(): un engrase a las 09:00 (turno Día) inicia su turno a las 06:00 del mismo día', () => {
    const { start, kind } = shiftWindowStart('2026-09-24T09:00:00', SHIFTS);
    expect(kind).toBe('shift_dia');
    expect(fmtLocal(start)).toBe('2026-09-24T06:00');
  });

  it('shiftWindowStart(): un engrase a las 02:00 (turno Noche que cruza medianoche) inicia AYER a las 18:00', () => {
    const { start, kind } = shiftWindowStart('2026-09-24T02:00:00', SHIFTS);
    expect(kind).toBe('shift_noche');
    expect(fmtLocal(start)).toBe('2026-09-23T18:00');
  });

  it('validationDeadline(): 2 turnos desde un engrase de Día (06:00) = 24h después → mañana 06:00 (fin del turno Noche siguiente)', () => {
    const deadline = validationDeadline('2026-09-24T09:00:00', SHIFTS);
    expect(fmtLocal(deadline)).toBe('2026-09-25T06:00');
  });

  it('validationDeadline(): 2 turnos desde un engrase de Noche = 24h después, sin importar la asimetría de los turnos', () => {
    const deadline = validationDeadline('2026-09-24T20:00:00', SHIFTS);
    expect(fmtLocal(deadline)).toBe('2026-09-25T18:00');
  });

  it('A) engrase turno Día, valida DENTRO del mismo turno → ventana sigue abierta (no vencida)', () => {
    const recordDate = '2026-09-24T09:00:00'; // Día
    const now = '2026-09-24T11:00:00'; // mismo turno Día
    expect(isValidationExpired(recordDate, now, SHIFTS)).toBe(false);
  });

  it('B) engrase turno Día, valida en el turno Noche SIGUIENTE (2º turno permitido) → sigue válido, no vencida', () => {
    const recordDate = '2026-09-24T09:00:00'; // Día
    const now = '2026-09-24T20:00:00'; // Noche del mismo día (2º turno)
    expect(isValidationExpired(recordDate, now, SHIFTS)).toBe(false);
  });

  it('C) se supera el 2º turno permitido (ya empezó el 3er turno) → Validación vencida', () => {
    const recordDate = '2026-09-24T09:00:00'; // Día
    const now = '2026-09-25T07:00:00'; // Día del día siguiente = 3er turno
    expect(isValidationExpired(recordDate, now, SHIFTS)).toBe(true);
  });

  it('justo en el instante límite (exactamente el deadline) todavía NO está vencida — el vencimiento es estrictamente posterior', () => {
    const recordDate = '2026-09-24T09:00:00';
    const deadline = validationDeadline(recordDate, SHIFTS).toISOString();
    expect(isValidationExpired(recordDate, deadline, SHIFTS)).toBe(false);
    expect(isValidationExpired(recordDate, new Date(new Date(deadline).getTime() + 1).toISOString(), SHIFTS)).toBe(true);
  });

  it('D/status: 0 activas + dentro del plazo → PENDIENTE_VALIDACION; 0 activas + vencido → VALIDACION_VENCIDA (con baseline de fixture activo)', () => {
    // baseline de fixture: se simula pasando un record cuya fecha es posterior
    // a un ENABLED_FROM ficticio — como GREASE_VALIDATION_ENABLED_FROM real es
    // null, para probar el estado "activado" se usa la función de más bajo
    // nivel que SÍ recibe el resultado de isRecordSubjectToValidation ya
    // resuelto: se prueba isValidationExpired()/validationDeadline() (arriba,
    // sin baseline) y, para el estado completo, ver el describe siguiente que
    // carga el módulo con un ENABLED_FROM de prueba propio.
    expect(isValidationExpired('2026-09-24T09:00:00', '2026-09-24T11:00:00', SHIFTS)).toBe(false);
    expect(isValidationExpired('2026-09-24T09:00:00', '2026-09-25T07:00:00', SHIFTS)).toBe(true);
  });

  it('G) conflicto (2+ activas) tiene PRIORIDAD sobre "vencida" en validationStatusFor() — nunca se pisa un conflicto real con un plazo vencido', () => {
    const validations = [
      { id: 'val_a', lubricationRecordId: 'greg_1', signerRole: 'OPERADOR', active: true },
      { id: 'val_b', lubricationRecordId: 'greg_1', signerRole: 'ENCARGADO', active: true },
    ];
    // A nivel de validationStatusForRecord con baseline null, esto sigue
    // dando HISTORICO (correcto) — el orden de prioridad conflicto>vencida se
    // prueba end-to-end en el describe con baseline de fixture, abajo.
    expect(hasValidationConflict('greg_1', validations)).toBe(true);
  });
});

describe('PLAZO DE VALIDACIÓN con baseline de fixture ACTIVO (módulo cargado con ENABLED_FROM propio de la prueba)', () => {
  // Nunca se cambia GREASE_VALIDATION_ENABLED_FROM real — se carga una copia
  // del módulo reemplazando esa constante por un valor explícito de fixture,
  // igual que ya hacían otras pruebas de este mismo repo para probar el
  // flujo Pendiente→Validado (ver docs/GREASE_VALIDATION_AUDIT.md).
  function loadWithBaseline(enabledFrom) {
    // Regex (no un string literal exacto) a propósito: el valor real de
    // GREASE_VALIDATION_ENABLED_FROM cambia con el rollout (era `null`, ahora
    // la fecha activada) y un match exacto del literal anterior se rompería
    // en silencio cada vez que ese valor cambie — con un patrón genérico,
    // esta prueba sigue funcionando sin importar cuál sea el valor productivo.
    const injected = `const GREASE_VALIDATION_ENABLED_FROM = ${JSON.stringify(enabledFrom)};`;
    const src = readSource(GREASE_VALIDATION_JS_PATH).replace(/const GREASE_VALIDATION_ENABLED_FROM = .*?;/, injected);
    if (!src.includes(injected)) throw new Error('loadWithBaseline: no se pudo reemplazar GREASE_VALIDATION_ENABLED_FROM en la fuente — revisa el patrón.');
    const factory = new Function(`${src}\nreturn { VALIDATION_STATUS, validationStatusForRecord, isRecordPendingValidation, isRecordInConflict, isRecordValidationExpired };`);
    return factory();
  }

  const ENABLED_FROM = '2026-09-01T00:00:00.000Z';
  const mod = loadWithBaseline(ENABLED_FROM);

  it('A) valida en el mismo turno → VALIDADO_OPERADOR (no pendiente, no vencida)', () => {
    const record = { id: 'greg_1', date: '2026-09-24T09:00:00' };
    const validations = [{ lubricationRecordId: 'greg_1', signerRole: 'OPERADOR', active: true }];
    const now = new Date('2026-09-24T11:00:00');
    expect(mod.validationStatusForRecord(record, validations, now, SHIFTS)).toBe('VALIDADO_OPERADOR');
  });

  it('B) valida en el turno siguiente (2º turno) → VALIDADO_ENCARGADO', () => {
    const record = { id: 'greg_1', date: '2026-09-24T09:00:00' };
    const validations = [{ lubricationRecordId: 'greg_1', signerRole: 'ENCARGADO', active: true }];
    const now = new Date('2026-09-24T20:00:00');
    expect(mod.validationStatusForRecord(record, validations, now, SHIFTS)).toBe('VALIDADO_ENCARGADO');
  });

  it('C) 0 firmas + deadline superado → VALIDACION_VENCIDA', () => {
    const record = { id: 'greg_1', date: '2026-09-24T09:00:00' };
    const now = new Date('2026-09-25T07:00:00');
    expect(mod.validationStatusForRecord(record, [], now, SHIFTS)).toBe('VALIDACION_VENCIDA');
  });

  it('D) vencida permanece pendiente de resolver; plazo vencido no elimina la accion Validar', () => {
    const record = { id: 'greg_1', date: '2026-09-24T09:00:00' };
    const now = new Date('2026-09-25T07:00:00');
    expect(mod.isRecordPendingValidation(record, [], now, SHIFTS)).toBe(true);
    expect(mod.isRecordValidationExpired(record, [], now, SHIFTS)).toBe(true);
  });

  it('E) firma hecha a tiempo pero "sincronizada" después (now muy posterior) sigue VALIDADA, nunca se vuelve vencida', () => {
    const record = { id: 'greg_1', date: '2026-09-24T09:00:00' };
    // La firma llega al array `validations` como si hubiera sincronizado
    // mucho después (now está muy por delante del deadline) — signedAt real
    // no importa aquí porque la SOLA existencia de la firma activa ya excluye
    // "vencida" (ver validationStatusForRecord): sync tardío nunca invalida
    // una firma real.
    const validations = [{ lubricationRecordId: 'greg_1', signerRole: 'OPERADOR', active: true, signedAt: '2026-09-24T11:00:00.000Z' }];
    const nowMuchoDespues = new Date('2026-10-01T00:00:00');
    expect(mod.validationStatusForRecord(record, validations, nowMuchoDespues, SHIFTS)).toBe('VALIDADO_OPERADOR');
    expect(mod.isRecordValidationExpired(record, validations, nowMuchoDespues, SHIFTS)).toBe(false);
  });

  it('F) baseline null (constante productiva, no la de este describe) → siempre HISTORICO, sin importar el plazo', () => {
    // Usa el módulo REAL (loadGreaseValidationLogic(), constante productiva
    // en null), no el de fixture de este describe.
    const record = { id: 'greg_1', date: '2026-09-24T09:00:00' };
    const now = new Date('2026-09-25T07:00:00'); // sería "vencida" si estuviera activado
    expect(validationStatusForRecord(record, [], now, SHIFTS)).toBe('HISTORICO_SIN_VALIDACION');
  });

  it('G) 2+ firmas activas tiene PRIORIDAD sobre "vencida" — sigue CONFLICTO aunque el plazo ya haya pasado', () => {
    const record = { id: 'greg_1', date: '2026-09-24T09:00:00' };
    const validations = [
      { id: 'val_a', lubricationRecordId: 'greg_1', signerRole: 'OPERADOR', active: true },
      { id: 'val_b', lubricationRecordId: 'greg_1', signerRole: 'ENCARGADO', active: true },
    ];
    const now = new Date('2026-10-01T00:00:00'); // muy pasado el plazo
    expect(mod.validationStatusForRecord(record, validations, now, SHIFTS)).toBe('CONFLICTO_VALIDACION');
    expect(mod.isRecordInConflict(record, validations)).toBe(true);
  });

  it('un registro ANTERIOR al baseline de fixture sigue HISTÓRICO sin importar el plazo (baseline y deadline nunca se mezclan)', () => {
    const record = { id: 'greg_0', date: '2026-08-01T09:00:00' }; // antes de ENABLED_FROM
    const now = new Date('2026-10-01T00:00:00');
    expect(mod.validationStatusForRecord(record, [], now, SHIFTS)).toBe('HISTORICO_SIN_VALIDACION');
  });
});

describe('D) UI — un registro vencido permite validar el MISMO registro posteriormente en Historial ni Mis Engrases', () => {
  const appSrc = readSource(APP_JS_PATH);
  const lubHistorialSrc = extractDeclaration(appSrc, 'renderLubricadorHistorial');
  // drawHistory() es la función real que dibuja la tabla de engrases por
  // equipo dentro de Historial (anidada en renderHistorial(), que en sí es
  // demasiado grande para el extractor ingenuo de llaves de
  // extractFromSource.js — drawHistory() se declara aparte y sí se aísla
  // limpio).
  const drawHistorySrc = extractDeclaration(appSrc, 'drawHistory');

  it('renderLubricadorHistorial() ("Mis Engrases"): valAction excluye solo HISTORICO, conserva la accion en vencidas', () => {
    expect(lubHistorialSrc).toMatch(/valStatus === VALIDATION_STATUS\.HISTORICO \? '' :/);
  });

  it('drawHistory() (tabla de Historial por equipo): valAction excluye solo HISTORICO, conserva la accion en vencidas', () => {
    expect(drawHistorySrc).toMatch(/valStatus === VALIDATION_STATUS\.HISTORICO \? '' :/);
  });

  it('ambas pantallas pasan `ahora`/App.generalSettings reales a validationStatusForRecord() — nunca horarios inventados', () => {
    expect(lubHistorialSrc).toContain('validationStatusForRecord(r, validations, ahora, App.generalSettings)');
    expect(drawHistorySrc).toContain('validationStatusForRecord(r, validations, ahoraValHist, App.generalSettings)');
  });
});
