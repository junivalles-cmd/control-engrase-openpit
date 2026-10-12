import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, loadOperationalScopeLogic } from '../helpers/loadLubricationLogic.js';
const source = readSource(APP_JS_PATH);
const build = new Function(`${['getLubricationAgeSeverity', 'buildCrewLubricationFollowUp'].map(n => extractDeclaration(source, n)).join('\n')}; return buildCrewLubricationFollowUp;`)();
const { resolveOperationalScope } = loadOperationalScopeLogic();
const crews = [{ id: 'C1', locationId: 'M', memberUserIds: ['U1'], isDefault: true, active: true }];
const scope = (coverage = []) => resolveOperationalScope({ currentUser: { id: 'U1', role: 'LUBRICADOR' }, cuadrillas: crews, crewLocations: coverage, shiftId: 'shift_dia' });
const coverage = [{ crew_id: 'C1', location_id: 'M', role: 'PRINCIPAL', active: true }, { crew_id: 'C1', location_id: 'V', role: 'APOYO', active: true }];
const equipos = [{ id: 'E1', locationId: 'M' }, { id: 'E2', locationId: 'V' }, { id: 'E3', locationId: 'O' }];
const records = equipos.map((e, i) => ({ equipmentId: e.id, date: `2026-10-0${5 + i}T23:50:00` }));
const input = { equipos, records, scope: scope(coverage), now: new Date('2026-10-10T00:10:00') };
it('A/B legacy: includes principal Mojón and rejects Volcán and outside', () => {
  expect(build({ ...input, scope: scope() }).map(r => [r.e.id, r.days])).toEqual([['E1', 5]]);
});
it('C includes PRINCIPAL and APOYO without assignments', () => {
  expect(build(input).map(r => [r.e.id, r.days, r.severity.key])).toEqual([['E1', 5, 'critical'], ['E2', 4, 'critical']]);
});
it('D previous-turn IDs take precedence and are never duplicated', () => {
  expect(build({ ...input, excludedEquipmentIds: ['E1'] }).map(r => r.e.id)).toEqual(['E2']);
});
it('current/future records do not create time follow-up; no record is explicit', () => {
  const rows = build({ ...input, records: [{ equipmentId: 'E1', date: '2026-10-10T00:00:00' }, { equipmentId: 'E2', date: '2026-10-11T00:00:00' }] });
  expect(rows).toEqual([]);
  expect(build({ ...input, records: [] }).map(r => [r.days, r.severity.key])).toEqual([[null, 'unknown'], [null, 'unknown']]);
});
it('uses latest record including PARTIAL like the Admin age indicator; inactive records/equipment excluded', () => {
  const latest = { equipmentId: 'E1', date: '2026-10-09T23:59:00', operationalSnapshot: { executionCompleteness: 'PARTIAL' } };
  expect(build({ ...input, records: [...records, latest, { ...latest, date: '2026-10-10T00:00:00', active: false }] })[0].e.id).toBe('E2');
  expect(build({ ...input, records: [...records, latest] })[1].days).toBe(1);
  expect(build({ ...input, equipos: equipos.map(e => ({ ...e, active: false })) })).toEqual([]);
});
it('no crew/no authorization returns no data; never grants global coverage', () => {
  expect(build({ ...input, scope: { kind: 'NO_CREW_ASSIGNED' } })).toEqual([]);
  expect(build({ ...input, scope: { kind: 'CREW_SCOPED', allAuthorizedLocationIds: [] } })).toEqual([]);
});
it('F projection never mutates equipment, records or coverage', () => {
  const before = JSON.stringify(input); build(input); expect(JSON.stringify(input)).toBe(before);
});
const baseline = execFileSync('git', ['show', 'fbabc2a:CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js'], { encoding: 'utf8' });
it('all formal-work calculations and partial/carryover/assignment classifications are unchanged', () => {
  const before = extractDeclaration(baseline, 'renderLubricadorHome');
  const after = extractDeclaration(source, 'renderLubricadorHome');
  const normalize = s => s.replace(/\r\n/g, '\n').trim();
  // Visual row/context markup can change; compare the actual classification blocks.
  for (const [start, end] of [
    ['  const records =', '  const arrastradoRowHTML'],
    ['  const realizadosHoyList', '  const realizadoRowHTML'],
  ]) {
    expect(normalize(after.slice(after.indexOf(start), after.indexOf(end)))).toBe(normalize(before.slice(before.indexOf(start), before.indexOf(end))));
  }
});

it('excludes all pending IDs and normalized codes, deduplicates informational rows only', () => {
  const duplicates = [{ ...equipos[0], code: '20-5530' }, { ...equipos[1], code: ' 20-5530 ' }, { ...equipos[2], locationId: 'M', code: '05-0870' }];
  expect(build({ ...input, equipos: duplicates, excludedEquipmentCodes: ['20-5530'] }).map(r => r.e.code)).toEqual(['05-0870']);
  expect(build({ ...input, equipos: [...duplicates, duplicates[2]] }).map(r => r.e.id)).toEqual(['E1', 'E3']);
});
// startGreaseFlow transport is intentionally replaced by Phase 2A; its scheduling
// and execution parity are covered by operational-scope / gateway / real-form tests.
it.each(['openLubricadorMatrizModal', 'getCurrentOperationalScope', 'loadAssignmentContext'])('%s unchanged', name => {
  expect(extractDeclaration(source, name)).toBe(extractDeclaration(baseline, name));
});
it.each(['handleOutOfPlanEquipoSelected', 'startLubricadorGreaseFlow'])('%s denies ambiguous or outside scope before starting execution',async name=>{
  const {canLubricadorExecuteEquipment}=loadOperationalScopeLogic();
  for(const role of ['LUBRICADOR','SUPERVISOR']) for(const deniedScope of [null,{kind:'NO_CREW_ASSIGNED'},scope()]){
    const messages=[];const data={...equipos[2],active:true};
    const fn=new Function('App','DB','getCurrentOperationalScope','loadAssignmentContext','canLubricadorExecuteEquipment',
      'openModal','$','closeModal','showInAppToast',`${extractDeclaration(source,name)};return ${name};`)(
        {currentUser:{id:'U1',role}}, {get:async()=>data},async()=>deniedScope,async()=>({assignments:[]}),canLubricadorExecuteEquipment,
        title=>messages.push(title),()=>({addEventListener:()=>{}}),()=>{},message=>messages.push(message));
    await fn('E3');expect(messages).toHaveLength(1);expect(messages[0]).toMatch(/cobertura autorizada/);expect(data.locationId).toBe('O');
  }
});
