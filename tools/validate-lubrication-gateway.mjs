// Local PostgreSQL/PGlite only. Never reads project credentials or opens a network connection.
// Use an already installed PGlite module via PGLITE_MODULE_PATH (no package.json changes).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.PGLITE_MODULE_PATH || path.join(process.env.TEMP || '/tmp',
  'control-engrase-sql-preflight/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const migration = 'CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0009_lubrication_execution_gateway_PREPARED.sql';
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
  $$;
  grant usage on schema auth to anon,authenticated;
  create table public.app_profiles(auth_user_id uuid primary key,app_user_id text,display_name text,role text,active boolean);
  create table public.app_store_permissions(store text,role text,can_read boolean,can_insert boolean,can_update boolean,can_delete boolean);
  create table public.engrase_sync(store text,id text,payload jsonb,updated_at timestamptz,deleted boolean default false,primary key(store,id));
`);
await db.exec(await readFile(migration,'utf8'));
const authId = '11111111-1111-4111-8111-111111111111';
const date = new Date().toISOString();
const version = '2026-01-01T00:00:00.000Z';
const operatingHour = (new Date(date).getUTCHours()+18)%24;
const shift = operatingHour>=6 && operatingHour<18 ? 'shift_dia' : 'shift_noche';
const fields = ['operation_id','action','record_id','equipment_id','plan_id','crew_id','assignment_id','execution_date','client_captured_at','shift_id',
  'execution_type','out_of_plan_reason','performed_by','retroactive','hourmeter','no_hourmeter','no_hourmeter_reason',
  'lubricant_id','quantity','condition','notes','details','photos','expected_record','expected_equipment','expected_plan','expected_assignment'];
const base = { operation_id:'r1',action:'CREATE',record_id:'r1',equipment_id:'e1',plan_id:'p1',crew_id:'c1',assignment_id:null,
  execution_date:date,client_captured_at:date,shift_id:shift,execution_type:'PLANNED',out_of_plan_reason:null,performed_by:'u1',retroactive:false,
  hourmeter:110,no_hourmeter:false,no_hourmeter_reason:null,lubricant_id:'l1',quantity:1,condition:'Normal',notes:'',
  details:[{pointId:'point1',pointName:'Punto',done:true,reason:null}],photos:[],expected_record:null,expected_equipment:version,
  expected_plan:version,expected_assignment:null };
async function put(store,id,payload) {
  await db.query('insert into public.engrase_sync values($1,$2,$3::jsonb,$4,false)',[store,id,JSON.stringify({id,active:true,...payload}),version]);
}
async function reset({role='LUBRICADOR',active=true}={}) {
  await db.exec('reset role; delete from public.engrase_sync; delete from public.app_profiles; delete from public.app_store_permissions; delete from public.lubrication_execution_receipts;');
  await db.query('insert into public.app_profiles values($1,$2,$3,$4,$5)',[authId,'u1','Test User',role,active]);
  await db.query('insert into public.app_store_permissions values($1,$2,true,false,false,false)', ['lubrication_records',role]);
  await db.query('insert into public.app_store_permissions values($1,$2,true,false,false,false)', ['lubrication_assignments',role]);
  await put('equipment','e1',{hourmeter:100,locationId:'loc1',shiftId:shift,code:'E1',model:'M1'});
  await put('locations','loc1',{name:'Test'});
  await put('cuadrillas','c1',{locationId:'loc1',memberUserIds:['u1'],isDefault:true});
  await put('lubrication_plans','p1',{equipmentId:'e1',controlType:'Horas de operación',frequency:10,lastGreaseHour:100});
  await put('lubrication_points','point1',{planId:'p1',point:'Punto'});
  await put('lubricants','l1',{name:'Grasa'});
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[authId]);
}
async function call(overrides={}, asRole='authenticated') {
  await db.exec('set role '+asRole);
  const input={...base,...overrides};
  try {
    const result=await db.query('select public.lubrication_execution('+fields.map((f,i)=>'p_'+f+' => $'+(i+1)).join(',')+') as result',
      fields.map(f=>['details','photos'].includes(f)?JSON.stringify(input[f]):input[f]));
    return result.rows[0].result;
  } finally { await db.exec('reset role'); }
}
async function snapshot() {
  return (await db.query('select * from public.engrase_sync order by store,id')).rows;
}
let passed=0;
async function test(name,fn) { await reset(); await fn(); passed++; console.log('PASS '+name); }
async function denyUnchanged(input,code) {
  const before=await snapshot(); const result=await call(input);
  assert.equal(result.code,code); assert.deepEqual(await snapshot(),before);
}
try {
  await test('ANON EXECUTE denied',async()=>{ await assert.rejects(call({},'anon'),/permission denied/); });
  await test('NULL auth denied',async()=>{await db.query("select set_config('request.jwt.claim.sub','',false)");await denyUnchanged({},'AUTH_REQUIRED');});
  await test('inactive profile denied',async()=>{await db.exec('update public.app_profiles set active=false');await denyUnchanged({},'INACTIVE_PROFILE');});
  await test('wrong role denied',async()=>{await db.exec("update public.app_profiles set role='VISOR'");await denyUnchanged({},'INVALID_ROLE');});
  await test('target matrix has no generic record/assignment writes; typed execution still works',async()=>{
    const flags=await db.query("select bool_or(can_insert or can_update or can_delete) as writable from public.app_store_permissions where store in ('lubrication_records','lubrication_assignments')");
    assert.equal(flags.rows[0].writable,false);assert.equal((await call()).status,'APPLIED');
  });
  await test('outside legacy scope denied',async()=>{await db.exec(`update public.engrase_sync set payload=payload||'{"locationId":"other"}' where store='equipment'`);await denyUnchanged({},'SCOPE_DENIED');});
  await test('without membership denied',async()=>{await db.exec(`update public.engrase_sync set payload=payload||'{"memberUserIds":[]}' where store='cuadrillas'`);await denyUnchanged({},'SCOPE_DENIED');});
  await test('scope ambiguity denied',async()=>{await put('cuadrillas','c2',{locationId:'loc1',memberUserIds:['u1'],isDefault:false});await denyUnchanged({crew_id:null},'CREW_SELECTION_REQUIRED');});
  await test('duplicate default crews require review',async()=>{await put('cuadrillas','c2',{locationId:'loc1',memberUserIds:['u1'],isDefault:true});await denyUnchanged({},'DEFAULT_CREW_REQUIRED');});
  await test('SUPERVISOR valid membership allowed without generic equipment/plan U',async()=>{
    await reset({role:'SUPERVISOR'});assert.equal((await call()).status,'APPLIED');
  });
  await test('ADMIN/PLANIFICADOR global scope without a crew is preserved',async()=>{
    for(const role of ['ADMINISTRADOR','PLANIFICADOR']){await reset({role});await db.exec("delete from public.engrase_sync where store='cuadrillas'");
      assert.equal((await call({crew_id:null})).status,'APPLIED');}
  });
  await test('COMPLETE applies atomic effects and server identity',async()=>{
    const result=await call();assert.equal(result.status,'APPLIED');
    const rows=await snapshot(); assert.equal(rows.find(r=>r.store==='equipment').payload.hourmeter,110);
    assert.equal(rows.find(r=>r.store==='lubrication_plans').payload.lastGreaseHour,110);
    const record=rows.find(r=>r.store==='lubrication_records').payload;
    assert.equal(record.capturedByAuthUserId,authId);assert.equal(record.createdBy,'Test User');
    assert.equal(record.operationalSnapshot.satisfiedOccurrenceKey,'p1:h:100');
    assert.equal(record.operationalSnapshot.executionCompleteness,'COMPLETE');
  });
  await test('PARTIAL does not reset cycle',async()=>{
    assert.equal((await call({quantity:0,details:[{pointId:'point1',done:false,reason:'Equipo trabajando'}]})).status,'APPLIED');
    assert.equal((await snapshot()).find(r=>r.store==='lubrication_plans').payload.lastGreaseHour,100);
  });
  await test('COMPLETE zero quantity denied with rollback',async()=>{await denyUnchanged({quantity:0},'COMPLETE_REQUIRES_GREASE');});
  await test('without configured points COMPLETE zero denied; positive quantity allowed',async()=>{
    await db.exec("delete from public.engrase_sync where store='lubrication_points'");
    await denyUnchanged({details:[],quantity:0},'COMPLETE_REQUIRES_GREASE');
    assert.equal((await call({details:[],quantity:0.1})).status,'APPLIED');
  });
  await test('legacy COMPLETE zero remains historical; future edits require positive quantity',async()=>{
    const original=(await call()).rows.find(r=>r.store==='lubrication_records');
    await db.query("update public.engrase_sync set payload=jsonb_set(payload,'{qty}','0'::jsonb) where store='lubrication_records' and id='r1'");
    const legacy=(await snapshot()).find(r=>r.store==='lubrication_records');
    const rows=await snapshot();const get=store=>rows.find(r=>r.store===store).updated_at;
    await denyUnchanged({action:'EDIT',operation_id:'edit-zero',quantity:0,expected_record:get('lubrication_records'),expected_equipment:get('equipment'),expected_plan:get('lubrication_plans')},'COMPLETE_REQUIRES_GREASE');
    assert.deepEqual((await snapshot()).find(r=>r.store==='lubrication_records'),legacy);assert.equal(legacy.payload.qty,0);
  });
  await test('execution can precede scheduled equipment shift without changing early rules',async()=>{
    await db.query("update public.engrase_sync set payload=jsonb_set(payload,'{shiftId}',to_jsonb($1::text)) where store='equipment'",[shift==='shift_dia'?'shift_noche':'shift_dia']);
    assert.equal((await call()).status,'APPLIED');
  });
  await test('CAS conflict preserves all rows',async()=>{await denyUnchanged({expected_plan:'2025-01-01'},'VERSION_CONFLICT');});
  await test('hourmeter regression denied',async()=>{await denyUnchanged({hourmeter:99},'HOURMETER_REGRESSION');});
  await test('master fields and malformed details rejected',async()=>{await denyUnchanged({details:[{pointId:'point1',done:true,locationId:'other'}]},'INVALID_CHECKLIST');});
  await test('numeric base scale keeps existing occurrence ID',async()=>{
    await db.exec(`update public.engrase_sync set payload=jsonb_set(payload,'{lastGreaseHour}','100.00'::jsonb) where store='lubrication_plans'`);
    const result=await call();assert.equal(result.status,'APPLIED');
    assert.equal(result.rows.find(r=>r.store==='lubrication_records').payload.operationalSnapshot.satisfiedOccurrenceKey,'p1:h:100');
  });
  await test('retry same operation does not duplicate effects',async()=>{
    const first=await call();const rows=await snapshot();assert.deepEqual(await call(),first);assert.deepEqual(await snapshot(),rows);
    assert.equal((await db.query('select count(*)::int as n from public.lubrication_execution_receipts')).rows[0].n,1);
    await denyUnchanged({quantity:2},'IDEMPOTENCY_CONFLICT');
  });
  await test('retry rechecks current membership after revocation',async()=>{
    assert.equal((await call()).status,'APPLIED');
    await db.exec(`update public.engrase_sync set payload=payload||'{"memberUserIds":[]}' where store='cuadrillas'`);
    await denyUnchanged({},'SCOPE_DENIED');
  });
  await test('future legacy version remains monotonic without forging capture time',async()=>{
    const future='2090-01-01T00:00:00Z';await db.query("update public.engrase_sync set updated_at=$1 where store='equipment'",[future]);
    const result=await call({expected_equipment:future});assert.equal(result.status,'APPLIED');
    const record=result.rows.find(r=>r.store==='lubrication_records');
    assert.equal((await db.query('select $1::timestamptz > $2::timestamptz as newer',[record.updated_at,future])).rows[0].newer,true);
    assert.ok(new Date(record.payload.capturedAt)<new Date(future));
  });
  await test('assignment mismatch denied',async()=>{
    await put('lubrication_assignments','a1',{equipmentId:'e1',assignedCrewId:'c1',occurrenceKey:'p1:h:100',status:'PENDING'});
    await denyUnchanged({},'ASSIGNMENT_MISMATCH');
  });
  await test('assignment completion atomic and idempotent',async()=>{
    await put('lubrication_assignments','a1',{equipmentId:'e1',assignedCrewId:'c1',occurrenceKey:'p1:h:100',status:'PENDING'});
    const input={assignment_id:'a1',execution_type:'ASSIGNED',expected_assignment:version};
    const first=await call(input);assert.equal(first.status,'APPLIED');assert.deepEqual(await call(input),first);
    const assignment=(await snapshot()).find(r=>r.store==='lubrication_assignments').payload;
    assert.equal(assignment.status,'COMPLETED');assert.equal(assignment.completedRecordId,'r1');assert.equal(assignment.assignedCrewId,'c1');
  });
  await test('assignment outside legacy location cannot extend authorization',async()=>{
    await put('lubrication_assignments','a1',{equipmentId:'e1',assignedCrewId:'c1',occurrenceKey:'p1:h:100',status:'PENDING'});
    await db.exec(`update public.engrase_sync set payload=payload||'{"locationId":"other"}' where store='equipment'`);
    await denyUnchanged({assignment_id:'a1',execution_type:'ASSIGNED',expected_assignment:version},'SCOPE_DENIED');
  });
  await test('assignment CAS conflict preserves record and all effects',async()=>{
    await put('lubrication_assignments','a1',{equipmentId:'e1',assignedCrewId:'c1',occurrenceKey:'p1:h:100',status:'PENDING'});
    await denyUnchanged({assignment_id:'a1',execution_type:'ASSIGNED',expected_assignment:'2025-01-01'},'ASSIGNMENT_VERSION_CONFLICT');
  });
  await test('already completed assignment controlled conflict',async()=>{
    await put('lubrication_assignments','a1',{equipmentId:'e1',assignedCrewId:'c1',occurrenceKey:'p1:h:100',status:'COMPLETED'});
    await denyUnchanged({assignment_id:'a1',execution_type:'ASSIGNED',expected_assignment:version},'ASSIGNMENT_NOT_PENDING');
  });
  await test('OUT_OF_PLAN reason checked',async()=>{await denyUnchanged({execution_type:'OUT_OF_PLAN'},'OUT_OF_PLAN_REASON_REQUIRED');
    assert.equal((await call({execution_type:'OUT_OF_PLAN',out_of_plan_reason:'PM'})).status,'APPLIED');});
  await test('no hourmeter preserves reading and records reference date',async()=>{
    assert.equal((await call({no_hourmeter:true,no_hourmeter_reason:'Horómetro dañado',hourmeter:100})).status,'APPLIED');
    const rows=await snapshot();assert.equal(rows.find(r=>r.store==='equipment').payload.hourmeter,100);
    assert.equal(new Date(rows.find(r=>r.store==='lubrication_plans').payload.lastGreaseDateNoHm).toISOString(),date);
  });
  await test('master fields impossible by typed contract',async()=>{
    await db.exec('set role authenticated');
    await assert.rejects(db.query("select public.lubrication_execution(p_location_id => 'x',p_frequency => 1)"),/does not exist/);
    await db.exec('reset role');
  });
  async function editInput() {
    const reply=await call();const get=store=>reply.rows.find(r=>r.store===store).updated_at;
    return {action:'EDIT',operation_id:'edit1',hourmeter:115,expected_record:get('lubrication_records'),expected_equipment:get('equipment'),expected_plan:get('lubrication_plans')};
  }
  await test('unsigned own same-day edit allowed',async()=>{assert.equal((await call(await editInput())).status,'APPLIED');});
  await test('signed record DENY and signatures/version intact',async()=>{
    const input=await editInput();await put('grease_validations','v1',{lubricationRecordId:'r1',signatureUrl:'https://fixture.test/signature'});
    await denyUnchanged(input,'SIGNED_RECORD_LOCKED');
    await db.exec("update public.app_profiles set role='ADMINISTRADOR'; update public.app_store_permissions set role='ADMINISTRADOR'");
    await denyUnchanged(input,'SIGNED_RECORD_LOCKED');
  });
  await test('edit identity/date immutable',async()=>{const input=await editInput();await denyUnchanged({...input,execution_date:'2020-01-01'},'IMMUTABLE_RECORD_FIELDS');});
  await test('other owner and previous-day edits denied by server clock',async()=>{
    const input=await editInput();await db.exec(`update public.engrase_sync set payload=payload||'{"userId":"someone-else"}' where store='lubrication_records'`);
    await denyUnchanged({...input,performed_by:'someone-else'},'EDIT_WINDOW_OR_OWNER');
    await db.exec(`update public.engrase_sync set payload=payload||'{"userId":"u1","date":"2020-01-01T12:00:00Z"}' where store='lubrication_records'`);
    await denyUnchanged({...input,execution_date:'2020-01-01T12:00:00Z'},'EDIT_WINDOW_OR_OWNER');
  });
  await test('PARTIAL edit cannot reset hour cycle',async()=>{
    const input=await editInput();assert.equal((await call({...input,quantity:0,details:[{pointId:'point1',done:false,reason:'Falla'}]})).status,'APPLIED');
    assert.equal((await snapshot()).find(r=>r.store==='lubrication_plans').payload.lastGreaseHour,110);
  });
  await test('early today/tomorrow matches existing one-candidate rule',async()=>{
    const localDay=new Date(new Date(date).getTime()-6*3600000);const tomorrow=new Date(localDay.getTime()+86400000);
    const names=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    await db.query("update public.engrase_sync set payload=payload||$1::jsonb where store='lubrication_plans'",[JSON.stringify({controlType:'Día y turno de la semana',assignedDays:[names[tomorrow.getUTCDay()]]})]);
    const result=await call();assert.equal(result.status,'APPLIED');
    assert.equal(result.rows.find(r=>r.store==='lubrication_records').payload.operationalSnapshot.satisfiedOccurrenceKey,'p1:'+tomorrow.toISOString().slice(0,10));
  });
  await test('early +2 days and two candidates do not auto satisfy',async()=>{
    const localDay=new Date(new Date(date).getTime()-6*3600000);const names=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    for(const days of [[names[(localDay.getUTCDay()+2)%7]],[names[localDay.getUTCDay()],names[(localDay.getUTCDay()+1)%7]]]) {
      await reset();await db.query("update public.engrase_sync set payload=payload||$1::jsonb where store='lubrication_plans'",[JSON.stringify({controlType:'Día y turno de la semana',assignedDays:days})]);
      const result=await call();assert.equal(result.status,'APPLIED');assert.equal(result.rows.find(r=>r.store==='lubrication_records').payload.operationalSnapshot.satisfiedOccurrenceKey,null);
    }
  });
  await test('retroactive performer differs from authenticated capturer without regressing current reading',async()=>{
    await reset({role:'PLANIFICADOR'});await put('users','legacy-performer',{name:'Historical performer'});
    const input={retroactive:true,performed_by:'legacy-performer',execution_date:'2026-01-01T12:00:00Z',hourmeter:90};
    const result=await call(input);assert.equal(result.status,'APPLIED');const record=result.rows.find(r=>r.store==='lubrication_records').payload;
    assert.equal(record.userId,'legacy-performer');assert.equal(record.capturedByAppUserId,'u1');
    assert.equal(new Date(record.createdAt).toISOString(),date);assert.equal(new Date(record.date).toISOString(),new Date(input.execution_date).toISOString());
    assert.equal(result.rows.find(r=>r.store==='equipment').payload.hourmeter,100);
  });
  await test('exception rolls back record/equipment/plan/receipt together',async()=>{
    await db.exec(`create function public.reject_gateway_audit() returns trigger language plpgsql as $$begin
      if new.store='audit_log' then raise exception 'fixture audit failure'; end if; return new; end;$$;
      create trigger reject_gateway_audit before insert on public.engrase_sync for each row execute function public.reject_gateway_audit();`);
    const before=await snapshot();await assert.rejects(call(),/fixture audit failure/);assert.deepEqual(await snapshot(),before);
    assert.equal((await db.query('select count(*)::int as n from public.lubrication_execution_receipts')).rows[0].n,0);
    await db.exec('drop trigger reject_gateway_audit on public.engrase_sync; drop function public.reject_gateway_audit();');
  });
  await test('prepared rollback disables endpoint without deleting receipts or data',async()=>{
    await call();const before=await snapshot();
    await db.exec(await readFile(migration.replace('_PREPARED','_ROLLBACK'),'utf8'));
    await assert.rejects(call(),/permission denied/);assert.deepEqual(await snapshot(),before);
    assert.equal((await db.query('select count(*)::int as n from public.lubrication_execution_receipts')).rows[0].n,1);
  });
  console.log(`SQL LOCAL: ${passed} passed. No production connection.`);
} finally { await db.close(); }
