import { describe, expect, it } from 'vitest';
import { loadDbLogic } from '../helpers/loadLubricationLogic.js';
const { localAuthorizationState } = loadDbLogic();
const row = { id: 'mojon', name: 'Mojon', active: true, __authorizationAppUserId: 'lub', updatedAt: 'v1', _pushedVersion: 'v1' };
const context = { appUserId: 'lub', authUserId: 'auth', active: true, scopeType: 'CREW_SCOPED',
  authorizedCrewIds: ['cuad_a'], authorizedLocationIds: ['volcan'], authorizationFingerprint: 'fp',
  supportGrants: { appUserId: 'lub', authUserId: 'auth', authorizationFingerprint: 'fp', rows: [{ store: 'locations', id: 'mojon' }] } };

describe('Ubicación maestra con grant puntual ya autorizado', () => {
  it('reconoce el grant exacto de locations sin ampliar el alcance base', () => {
    expect(localAuthorizationState('locations', row, context, 'lub')).toBe('AUTHORIZED');
    expect(context.authorizedLocationIds).toEqual(['volcan']);
  });
  it('el nombre de ubicacion no concede los demas equipos de Mojon', () => {
    expect(localAuthorizationState('equipment', { ...row, id: 'another-equipment', locationId: 'mojon' }, context, 'lub')).toBe('OUT_OF_SCOPE');
  });
  it('no concede otra ubicacion ni un ID igual bajo otro store', () => {
    expect(localAuthorizationState('locations', { ...row, id: 'taller' }, context, 'lub')).toBe('OUT_OF_SCOPE');
    const c = { ...context, supportGrants: { ...context.supportGrants, rows: [{ store: 'equipment', id: 'mojon' }] } };
    expect(localAuthorizationState('locations', row, c, 'lub')).toBe('OUT_OF_SCOPE');
  });
  it.each(['appUserId', 'authUserId', 'authorizationFingerprint'])('rechaza un grant con %s de otra identidad/revision', key => {
    expect(localAuthorizationState('locations', row, { ...context, supportGrants: { ...context.supportGrants, [key]: 'other' } }, 'lub')).toBe('OUT_OF_SCOPE');
  });
  it('revocacion oculta el nombre sin borrar datos locales', () => {
    expect(localAuthorizationState('locations', row, { ...context, supportGrants: { ...context.supportGrants, rows: [] } }, 'lub')).toBe('OUT_OF_SCOPE');
    expect(row.name).toBe('Mojon');
  });
  it('conserva ownership y estado activo del usuario como requisitos previos', () => {
    expect(localAuthorizationState('locations', { ...row, __authorizationAppUserId: 'other' }, context, 'lub')).toBe('OUT_OF_SCOPE');
    expect(localAuthorizationState('locations', row, { ...context, active: false }, 'lub')).toBe('OUT_OF_SCOPE');
  });
});
