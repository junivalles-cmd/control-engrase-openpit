import {describe,it,expect,vi,afterEach} from 'vitest';
import path from 'node:path';
import {readSource,extractDeclaration} from '../helpers/extractFromSource.js';
import {loadOperationalScopeLogic,loadDbLogic,loadSyncLogic,loadWeeklyMatrixLogic,loadPlanComplianceLogic,loadAppLogic} from '../helpers/loadLubricationLogic.js';
const core=loadOperationalScopeLogic();
const {localAuthorizationState}=loadDbLogic();
const OLD='2026-01-01T00:00:00.000Z',CURSOR='2026-10-15T00:00:00.000Z';
const profile={authUserId:'auth-a',appUserId:'u',role:'LUBRICADOR',active:true,scopeType:'CREW_SCOPED',authorizedCrewIds:['cuad_a'],authorizedLocationIds:['Volcan'],authorizationFingerprint:'member-v1',rowScopeEnforced:true};
const assignment={id:'asg',equipmentId:'05-0870',planId:'plan',assignedCrewId:'cuad_a',occurrenceKey:'plan:2026-09-30',status:'PENDING',active:true,_supportOperational:true};
const crew={id:'cuad_a',locationId:'Volcan',memberUserIds:['u'],active:true,isDefault:true};
const equipment={id:'05-0870',locationId:'Mojon',active:true};
const scope=core.resolveOperationalScope({currentUser:{id:'u',role:'LUBRICADOR'},cuadrillas:[crew],shiftId:'shift_dia'});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('point grants and late assignments',()=>{
 it('remote notification matching also preserves the assigned obligation',()=>{
  const source=readSource(path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/functions/notify-vencidos/index.ts'));
  const find=new Function(extractDeclaration(source,'findRecordForNotificationOccurrence')+';return findRecordForNotificationOccurrence;')();
  const record={equipmentId:'e',shiftId:'shift_dia',qty:2,details:[],operationalSnapshot:{assignedOccurrenceKey:'p:2026-09-30',satisfiedOccurrenceKey:'p:2026-09-30',operationalDate:'2026-10-16',shiftId:'shift_dia'}};
  expect(find([record],{equipmentId:'e',operationalDate:'2026-10-16',shiftId:'shift_dia',occurrenceKey:'p:2026-10-16:shift_dia'})).toBeUndefined();
 });
 it('Mi Turno admits only the exact verified assignment, without normal Mojon coverage',()=>{
  const work=core.classifyEquipmentWork({scope,equipos:[equipment,{id:'other',locationId:'Mojon'}],cuadrillas:[crew],assignments:[assignment],equipoOccurrenceKeyFn:()=> 'plan:2026-10-16:shift_dia'});
  expect(work.normal).toEqual([]);expect(work.assigned).toEqual([assignment]);
  expect(core.canLubricadorExecuteEquipment({scope,equipo:equipment,assignments:[assignment]})).toBe(true);
  expect(core.canLubricadorExecuteEquipment({scope,equipo:{id:'other',locationId:'Mojon'},assignments:[assignment]})).toBe(false);
  expect(core.canLubricadorExecuteEquipment({scope:{...scope,crewId:'other'},equipo:equipment,assignments:[assignment]})).toBe(false);
  expect(core.canLubricadorExecuteEquipment({scope,equipo:equipment,assignments:[{...assignment,_supportOperational:false}]})).toBe(false);
  expect(scope.allAuthorizedLocationIds).toEqual(['Volcan']);
 });
 it('PARTIAL retains pending work, COMPLETE terminates it',()=>{
  expect(core.completeAssignmentIfPending([assignment],{occurrenceKey:assignment.occurrenceKey,recordId:'r',completeness:'PARTIAL'})).toBeNull();
  expect(core.completeAssignmentIfPending([assignment],{occurrenceKey:assignment.occurrenceKey,recordId:'r',completeness:'COMPLETE'}).status).toBe('COMPLETED');
 });
 it.each(['2026-09-30','2026-10-10'])('late legacy %s never satisfies capture-day DAY/NIGHT',date=>{
  const plan={id:'plan',equipmentId:equipment.id,controlType:'Día y turno de la semana',assignedDays:['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'],requiredShifts:['shift_dia','shift_noche'],effectiveDate:'2026-10-12'};
  const key='plan:'+date;
  const record={id:'late',equipmentId:equipment.id,planId:'plan',shiftId:'shift_dia',date:'2026-10-16T12:00:00',qty:2,details:[{done:true}],operationalSnapshot:{assignedOccurrenceKey:key,occurrenceKey:key,satisfiedOccurrenceKey:key,operationalDate:'2026-10-16'}};
  for(const shiftId of ['shift_dia','shift_noche']) expect(core.resolveOccurrenceState({plan,operationalDate:'2026-10-16',shiftId,records:[record]}).state).toBe('PENDING');
  const {estadoCelda}=loadWeeklyMatrixLogic();
  expect(estadoCelda(equipment,new Date(date+'T12:00:00'),[plan],[record],new Date('2026-10-16T12:00:00')).tipo).toBe('hecho_atrasado');
  const totals=loadPlanComplianceLogic().computeProgramadoRealizadoPeriodo([equipment],[record],{[equipment.id]:plan},[new Date('2026-10-16T12:00:00')]);
  expect(totals.general.realizados).toBe(0);
 });
 it('PARTIAL then COMPLETE resolves exact DAY, not NIGHT',()=>{
  const plan={id:'p',equipmentId:'e',controlType:'Día y turno de la semana',assignedDays:['Viernes'],requiredShifts:['shift_dia','shift_noche'],effectiveDate:'2026-10-12'};
  const partial={equipmentId:'e',shiftId:'shift_noche',qty:0,details:[{done:false}],operationalSnapshot:{assignedOccurrenceKey:'p:2026-10-16:shift_dia',occurrenceKey:'p:2026-10-16:shift_dia',operationalDate:'2026-10-17'}};
  const complete={...partial,qty:1,details:[{done:true}],operationalSnapshot:{...partial.operationalSnapshot,satisfiedOccurrenceKey:'p:2026-10-16:shift_dia'}};
  expect(core.resolveOccurrenceState({plan,operationalDate:'2026-10-16',shiftId:'shift_dia',records:[partial,complete]}).state).toBe('COMPLETE');
  expect(core.resolveOccurrenceState({plan,operationalDate:'2026-10-16',shiftId:'shift_noche',records:[partial,complete]}).state).toBe('PENDING');
 });
});

describe('account-scoped grant hydration',()=>{
 it('fetches old dependencies past cursor; revocation hides cached rows without deleting local work',async()=>{
  let current={...profile},context={...profile};
  const rows=new Map();
  for(const [store,row] of [['cuadrillas',crew],['locations',{id:'Volcan',active:true}]])rows.set(store+':'+row.id,{...row,__authorizationAppUserId:'u'});
  const key=encodeURIComponent(profile.authUserId)+':'+encodeURIComponent(profile.authorizationFingerprint);
  let cfg={url:'https://fixture.invalid',anonKey:'test',activeAccountSyncKey:key,accountSyncStates:{[key]:{bootstrapComplete:true,lastPull:CURSOR}}};
  const deps=[['equipment',equipment],['lubrication_plans',{id:'plan',equipmentId:equipment.id}],['lubrication_points',{id:'point',planId:'plan'}],['lubrication_assignments',assignment]].map(([store,payload])=>({store,id:payload.id,payload:{...payload,updatedAt:OLD},updated_at:OLD,deleted:false}));
  let manifest={status:'AUTHORIZED',authUserId:'auth-a',appUserId:'u',revision:'r1',operational:[{...assignment,assignmentId:assignment.id}],rows:deps.map(r=>({store:r.store,id:r.id}))};
  const db={getConfig:async()=>cfg,setConfig:async v=>{cfg=v;},getAuthorizationContext:async()=>context,setAuthorizationContext:async(id,v)=>{context=v;},
   all:async store=>[...rows.values()].filter(r=>rows.get(store+':'+r.id)===r),getRaw:async(s,id)=>rows.get(s+':'+id),put:async(s,r)=>rows.set(s+':'+r.id,r),recordConflicts:async()=>{}};
  const auth={getProfile:()=>current,getSession:()=>({accessToken:'fixture'}),isAuthenticated:()=>true,isSupabaseMode:()=>true,getSessionEpoch:()=>1};
  const {Sync}=loadSyncLogic(db,['cuadrillas','locations','equipment','lubrication_plans','lubrication_points','lubrication_assignments'],auth);
  const fetch=vi.fn(async url=>({ok:true,status:200,json:async()=>url.includes('/rpc/')?structuredClone(manifest):url.includes('id=in.')?structuredClone(deps.filter(r=>r.store===new URL(url).searchParams.get('store').slice(3))):[]}));
  vi.stubGlobal('fetch',fetch);
  expect((await Sync.pullAll()).ok).toBe(true);
  expect(fetch.mock.calls.some(([url])=>new URL(url).searchParams.get('updated_at')==='gt.'+CURSOR)).toBe(true);
  for(const store of ['equipment','lubrication_plans','lubrication_points']) {
    const row=deps.find(r=>r.store===store).payload;
    expect(localAuthorizationState(store,{...row,__authorizationAppUserId:'u',_pushedVersion:OLD},context,'u')).toBe('AUTHORIZED');
  }
  rows.set('lubrication_records:pending',{id:'pending',_executionOperationId:'local-intent',__authorizationAppUserId:'u'});
  manifest={...manifest,revision:'r2',rows:[],operational:[]};
  expect((await Sync.pullAll()).ok).toBe(true);
  expect(rows.has('equipment:'+equipment.id)).toBe(true);
  expect(rows.has('lubrication_records:pending')).toBe(true);
  expect(localAuthorizationState('equipment',rows.get('equipment:'+equipment.id),context,'u')).toBe('OUT_OF_SCOPE');
  current={...profile,authUserId:'auth-b',appUserId:'b'};
  expect(localAuthorizationState('equipment',rows.get('equipment:'+equipment.id),{...context,...current},'b')).toBe('OUT_OF_SCOPE');
 });
 it('signed URL cache is isolated by account and grant revision',async()=>{
  let current={...profile};let revision='r1';
  const db={getAuthorizationContext:async()=>({supportGrants:{revision}})};
  const auth={getProfile:()=>current,isSupabaseMode:()=>true,isAuthenticated:()=>true,getSession:()=>({accessToken:'jwt'}),getSessionEpoch:()=>1};
  const {Sync}=loadSyncLogic(db,[],auth);
  const fetch=vi.fn(async()=>({ok:true,status:200,json:async()=>({signedURL:'/object/sign/x?token='+fetch.mock.calls.length})}));vi.stubGlobal('fetch',fetch);
  const cfg={url:'https://fixture.invalid',anonKey:'test'};const path='https://fixture.invalid/storage/v1/object/public/engrase-photos/lubrication_records/a.jpg';
  const first=await Sync.getSignedPhotoUrl(path,cfg);
  expect(await Sync.getSignedPhotoUrl(path,cfg)).toBe(first);expect(fetch).toHaveBeenCalledTimes(1);
  current={...current,authUserId:'auth-b'};expect(await Sync.getSignedPhotoUrl(path,cfg)).not.toBe(first);
  revision='r2';await Sync.getSignedPhotoUrl(path,cfg);expect(fetch).toHaveBeenCalledTimes(3);
 });
});
