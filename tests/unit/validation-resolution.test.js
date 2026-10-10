import { it, expect } from 'vitest';
import { loadGreaseValidationLogic } from '../helpers/loadLubricationLogic.js';

const { findActiveValidations, validationStatusFor } = loadGreaseValidationLogic();
const signatures = () => [
  { id: 'a', lubricationRecordId: 'r', signerRole: 'OPERADOR', signatureLocal: 'first' },
  { id: 'b', lubricationRecordId: 'r', signerRole: 'ENCARGADO', signatureLocal: 'second' },
];
it('derives the official signature while retaining both original images', () => {
  const rows = signatures();
  rows[0].conflictResolution = { officialValidationId: 'b', signatureIds: ['a', 'b'] };
  expect(findActiveValidations('r', rows).map(v => v.id)).toEqual(['b']);
  expect(validationStatusFor('r', rows)).toBe('VALIDADO_ENCARGADO');
  expect(rows.map(v => v.signatureLocal)).toEqual(['first', 'second']);
});
it('a new offline signature invalidates the previous resolution', () => {
  const rows = signatures();
  rows[0].conflictResolution = { officialValidationId: 'b', signatureIds: ['a', 'b'] };
  rows.push({ id: 'c', lubricationRecordId: 'r', signerRole: 'OPERADOR' });
  expect(validationStatusFor('r', rows)).toBe('CONFLICTO_VALIDACION');
});
it('a rejected CAS cannot silently certify a local choice', () => {
  const rows = signatures();
  rows[0].conflictResolution = { officialValidationId: 'b', signatureIds: ['a', 'b'] };
  rows[0]._validationResolutionConflict = true;
  expect(validationStatusFor('r', rows)).toBe('CONFLICTO_VALIDACION');
});
