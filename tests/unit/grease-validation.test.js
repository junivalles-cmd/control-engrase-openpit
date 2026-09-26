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
import { loadGreaseValidationLogic, GREASE_VALIDATION_JS_PATH } from '../helpers/loadLubricationLogic.js';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';

const {
  VALIDATION_STATUS, VALIDATION_BADGE, GREASE_VALIDATION_ENABLED_FROM, isRecordSubjectToValidation,
  statusForSignerRole, validateValidationForm, findActiveValidations, hasValidationConflict,
  findActiveValidation, validationStatusFor, validationStatusForRecord, isRecordPendingValidation,
  isRecordInConflict,
} = loadGreaseValidationLogic();

describe('Estados y badges — 5 estados (incluye HISTORICO_SIN_VALIDACION y CONFLICTO_VALIDACION), sin OBSERVADO (auditado, no implementado)', () => {
  it('5 estados exactos: HISTORICO_SIN_VALIDACION / PENDIENTE_VALIDACION / VALIDADO_OPERADOR / VALIDADO_ENCARGADO / CONFLICTO_VALIDACION', () => {
    expect(VALIDATION_STATUS).toEqual({
      HISTORICO: 'HISTORICO_SIN_VALIDACION',
      PENDIENTE: 'PENDIENTE_VALIDACION',
      OPERADOR: 'VALIDADO_OPERADOR',
      ENCARGADO: 'VALIDADO_ENCARGADO',
      CONFLICTO: 'CONFLICTO_VALIDACION',
    });
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

describe('CORRECCIÓN CENTRAL — baseline null → funcionalidad de validación NO ACTIVADA (nunca "todo sigue sujeto")', () => {
  it('GREASE_VALIDATION_ENABLED_FROM queda en null a propósito (no se inventó una fecha)', () => {
    expect(GREASE_VALIDATION_ENABLED_FROM).toBeNull();
  });

  it('isRecordSubjectToValidation() con baseline null → SIEMPRE false, sin importar qué tan vieja o nueva sea la fecha (única fuente de verdad, sin excepciones)', () => {
    expect(isRecordSubjectToValidation('2020-01-01T00:00:00.000Z')).toBe(false);
    expect(isRecordSubjectToValidation('2099-01-01T00:00:00.000Z')).toBe(false);
    expect(isRecordSubjectToValidation(new Date().toISOString())).toBe(false); // ni siquiera "ahora mismo"
  });

  it('validationStatusForRecord() con baseline null → SIEMPRE HISTORICO_SIN_VALIDACION, tenga o no grease_validations reales', () => {
    const record = { id: 'greg_1', date: new Date().toISOString() }; // recién creado, "hoy"
    expect(validationStatusForRecord(record, [])).toBe('HISTORICO_SIN_VALIDACION');
    const validations = [{ lubricationRecordId: 'greg_1', signerRole: 'OPERADOR', active: true }];
    // Aunque exista una firma real (ej. alguien probó "Validar ahora" en fase de
    // prueba), el estado mostrado sigue siendo Histórico — la firma no se
    // pierde en la base de datos, pero no cuenta oficialmente hasta el rollout.
    expect(validationStatusForRecord(record, validations)).toBe('HISTORICO_SIN_VALIDACION');
  });

  it('isRecordPendingValidation() con baseline null → SIEMPRE false (nunca "pendiente" mientras la funcionalidad no esté activada)', () => {
    const record = { id: 'greg_1', date: new Date().toISOString() };
    expect(isRecordPendingValidation(record, [])).toBe(false);
    expect(isRecordPendingValidation(record, [{ lubricationRecordId: 'greg_1', signerRole: 'OPERADOR', active: true }])).toBe(false);
  });

  it('isRecordInConflict() con baseline null → SIEMPRE false, aunque técnicamente haya 2+ grease_validations activas para el mismo registro', () => {
    const record = { id: 'greg_1', date: new Date().toISOString() };
    const validations = [
      { id: 'val_a', lubricationRecordId: 'greg_1', signerRole: 'OPERADOR', active: true },
      { id: 'val_b', lubricationRecordId: 'greg_1', signerRole: 'ENCARGADO', active: true },
    ];
    expect(hasValidationConflict('greg_1', validations)).toBe(true); // el dato crudo SÍ tiene conflicto
    expect(isRecordInConflict(record, validations)).toBe(false); // pero no "cuenta" mientras no esté activada
  });

  it('la comparación de fechas en la fuente usa ">=" (inclusive, "record.date >= ENABLED_FROM" → sujeto) para cuando SÍ se configure', () => {
    const srcFn = extractDeclaration(readSource(GREASE_VALIDATION_JS_PATH), 'isRecordSubjectToValidation');
    expect(srcFn).toContain('new Date(recordDate).getTime() >= new Date(GREASE_VALIDATION_ENABLED_FROM).getTime()');
    expect(srcFn).toContain('if (!GREASE_VALIDATION_ENABLED_FROM) return false;');
  });

  it('validationStatusForRecord() antepone el chequeo de histórico ANTES de delegar en validationStatusFor()', () => {
    const srcFn = extractDeclaration(readSource(GREASE_VALIDATION_JS_PATH), 'validationStatusForRecord');
    const iHistorico = srcFn.indexOf('VALIDATION_STATUS.HISTORICO');
    const iDelega = srcFn.indexOf('validationStatusFor(record.id');
    expect(iHistorico).toBeGreaterThan(-1);
    expect(iDelega).toBeGreaterThan(-1);
    expect(iHistorico).toBeLessThan(iDelega);
  });

  it('isRecordPendingValidation()/isRecordInConflict() nunca leen un campo guardado en el record — derivan de isRecordSubjectToValidation() (única fuente central)', () => {
    const pendSrc = extractDeclaration(readSource(GREASE_VALIDATION_JS_PATH), 'isRecordPendingValidation');
    expect(pendSrc).toContain('isRecordSubjectToValidation(record.date)');
    expect(pendSrc).toContain('findActiveValidations(record.id, validations).length === 0');
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
