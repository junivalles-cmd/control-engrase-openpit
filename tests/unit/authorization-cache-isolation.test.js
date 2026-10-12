import { describe, it, expect } from 'vitest';
import { loadDbLogic } from '../helpers/loadLubricationLogic.js';

const { localAuthorizationState } = loadDbLogic();
const supervisor = {
  appUserId:'u1',active:true,scopeType:'CREW_SCOPED',
  authorizedCrewIds:['c1'],authorizedLocationIds:['l1']
};

describe('local authorization cache classification', () => {
  it('denies cache rows owned by a different account', () => {
    expect(localAuthorizationState('equipment',{id:'e1',locationId:'l1',__authorizationAppUserId:'uA'},supervisor,'u1')).toBe('OUT_OF_SCOPE');
  });
  it('hides equipment and crews outside the current scope', () => {
    expect(localAuthorizationState('equipment',{id:'e2',locationId:'l2',__authorizationAppUserId:'u1'},supervisor,'u1')).toBe('OUT_OF_SCOPE');
    expect(localAuthorizationState('cuadrillas',{id:'c2',__authorizationAppUserId:'u1'},supervisor,'u1')).toBe('OUT_OF_SCOPE');
  });
  it('hides assignments directed to an unauthorized crew', () => {
    expect(localAuthorizationState('lubrication_assignments',{id:'a1',assignedCrewId:'c2',__authorizationAppUserId:'u1'},supervisor,'u1')).toBe('OUT_OF_SCOPE');
    expect(localAuthorizationState('lubrication_assignments',{id:'a1',assignedCrewId:'c1',__authorizationAppUserId:'u1'},supervisor,'u1')).toBe('AUTHORIZED');
  });
  it('retains own dirty work as pending-local only while its row remains in scope', () => {
    const row={id:'e1',locationId:'l1',updatedAt:'v2',_pushedVersion:'v1',__authorizationAppUserId:'u1'};
    expect(localAuthorizationState('equipment',row,supervisor,'u1')).toBe('PENDING_LOCAL');
    expect(localAuthorizationState('equipment',{...row,locationId:'l2'},supervisor,'u1')).toBe('OUT_OF_SCOPE');
  });
  it('never exposes legacy users or audit rows to crew-scoped accounts', () => {
    expect(localAuthorizationState('users',{id:'legacy-u',__authorizationAppUserId:'u1'},supervisor,'u1')).toBe('OUT_OF_SCOPE');
    expect(localAuthorizationState('audit_log',{id:'audit',crewId:'c1',__authorizationAppUserId:'u1'},supervisor,'u1')).toBe('OUT_OF_SCOPE');
  });
});
