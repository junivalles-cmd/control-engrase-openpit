// Local, in-memory PostgreSQL/PGlite. No project secrets and no network.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const modulePath=process.env.PGLITE_MODULE_PATH || path.join(process.env.TEMP || '/tmp',
  'control-engrase-sql-preflight/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite }=await import(pathToFileURL(modulePath).href);
const db=new PGlite();
const root='CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/';
const authId='11111111-1111-4111-8111-111111111111';
const version='2026-01-01T00:00:00.000Z';
await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to anon,authenticated;
 create table public.app_profiles(auth_user_id uuid primary key,app_user_id text,display_name text,role text,active boolean);
 create table public.app_store_permissions(store text,role text,can_read boolean,can_insert boolean,can_update boolean,can_delete boolean);
 create table public.engrase_sync(store text,id text,payload jsonb,updated_at timestamptz,deleted boolean default false,primary key(store,id));
 alter table public.engrase_sync enable row level security;
 create policy legacy on public.engrase_sync for all to public using(true) with check(true);
 grant select,insert,update,delete on public.engrase_sync to anon,authenticated;
 create table storage.objects(id text primary key,bucket_id text,name text,owner_id text);
 alter table storage.objects enable row level security;
 create policy legacy on storage.objects for all to public using(true) with check(true);
 grant select,insert,update,delete on storage.objects to anon,authenticated;`);
await db.exec(await readFile(root+'0009_lubrication_execution_gateway_PREPARED.sql','utf8'));
await db.exec(await readFile(root+'0010_evidence_gateway_PREPARED.sql','utf8'));
async function put(store,id,payload) {await db.query('insert into public.engrase_sync values($1,$2,$3::jsonb,$4,false)',
 [store,id,JSON.stringify({id,active:true,...payload}),version]);}
async function reset(role='LUBRICADOR') {
 await db.exec('reset role; delete from public.engrase_sync; delete from public.app_profiles; delete from public.app_store_permissions; delete from public.evidence_operation_receipts;delete from public.lubrication_execution_receipts;delete from storage.objects;');
 await db.query('insert into public.app_profiles values($1,$2,$3,$4,true)',[authId,'u1','Test User',role]);
 for(const store of ['anomalies','grease_validations','lubrication_records']) await db.query(
  'insert into public.app_store_permissions values($1,$2,true,$3,$4,$5)',[store,role,!(store==='anomalies'&&role==='PLANIFICADOR'),
    role!=='LUBRICADOR'||store!=='anomalies',role==='ADMINISTRADOR']);
 await put('equipment','e1',{locationId:'loc1'});
 await put('locations','loc1',{name:'Synthetic location'});
 await put('cuadrillas','c1',{locationId:'loc1',memberUserIds:['u1']});
 await put('lubrication_records','r1',{equipmentId:'e1',capturedByAuthUserId:authId,details:[{pointId:'point1',pointName:'Punto',done:false,reason:'Grasera dañada'}],photos:[]});
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[authId]);
 for(const id of ['v1','v2'])await db.query('insert into storage.objects values($1,$2,$3,$4)',[id,'engrase-photos','grease_validations/'+id+'.png',authId]);
 await acceptExecutionFixture();
}
async function acceptExecutionFixture() {
 const record=(await db.query("select * from public.engrase_sync where store='lubrication_records' and id='r1'")).rows[0];
 await db.query('insert into public.lubrication_execution_receipts(auth_user_id,operation_id,request,result) values($1,$2,$3::jsonb,$4::jsonb) on conflict(auth_user_id,operation_id) do update set result=excluded.result',
  [authId,'r1',JSON.stringify(['CREATE','r1']),JSON.stringify({status:'APPLIED',rows:[record]})]);
}
async function call(name,params,role='authenticated') {
 await db.exec('set role '+role);
 try {return (await db.query('select public.'+name+'('+Object.keys(params).map((key,i)=>key+' => $'+(i+1)).join(',')+') as result',
   Object.values(params).map(value=>typeof value==='object'&&value!==null?JSON.stringify(value):value))).rows[0].result;
 } finally {await db.exec('reset role');}
}
const report={p_operation_id:'o1',p_id:'a1',p_equipment_id:'e1',p_crew_id:'c1',p_component:'Otro',p_description:'Descripción',p_criticality:'Media',p_photos:[]};
const capture={p_operation_id:'v1',p_id:'v1',p_record_id:'r1',p_crew_id:'c1',p_expected:version,
 p_signer_name:'External operator',p_signer_role:'OPERADOR',p_note:null,p_signature_url:'https://local.invalid/storage/v1/object/public/engrase-photos/grease_validations/v1.png'};
async function seededAnomaly(own=true) {await put('anomalies','a1',{equipmentId:'e1',capturedByAuthUserId:own?authId:'other',status:'Abierta'});}
const edit={p_operation_id:'edit1',p_id:'a1',p_crew_id:'c1',p_expected:version,p_component:'Otro',p_description:'Editada',p_criticality:'Alta',p_status:'En atención',p_photos:[]};
const close={p_operation_id:'close1',p_id:'a1',p_crew_id:'c1',p_expected:version,p_note:'Resuelta'};
const automatic={p_operation_id:'auto:r1',p_record_id:'r1',p_crew_id:'c1',p_expected:version};
let passed=0;
async function test(name,fn) {await reset();await fn();passed++;console.log('PASS '+name);}
async function unchanged(name,params,code) {const before=(await db.query('select * from public.engrase_sync order by store,id')).rows;
 assert.equal((await call(name,params)).code,code);assert.deepEqual((await db.query('select * from public.engrase_sync order by store,id')).rows,before);}
try {
 await test('RPC anon and private dispatcher denied',async()=>{
  for(const [name,p] of [['report_anomaly',report],['capture_grease_validation',capture],['repeat_anomaly_from_execution',automatic]])
   await assert.rejects(call(name,p,'anon'),/permission denied/);
  assert.equal((await db.query("select has_function_privilege('authenticated','public.evidence_operation(text,text,text,text,text,timestamptz,text,text,text,text,jsonb,text,text,text,text,text,jsonb)','execute') as allowed")).rows[0].allowed,false);
 });
 await test('null auth denied',async()=>{await db.query("select set_config('request.jwt.claim.sub','',false)");await unchanged('report_anomaly',report,'AUTH_REQUIRED');});
 await test('inactive profile denied anomalies and signatures',async()=>{await db.exec('update public.app_profiles set active=false');for(const [name,p] of [['report_anomaly',report],['capture_grease_validation',capture]])await unchanged(name,p,'INACTIVE_PROFILE');});
 await test('wrong scope denied anomalies and signatures',async()=>{await db.exec(`update public.engrase_sync set payload=payload||'{"locationId":"other"}' where store='equipment'`);for(const [name,p] of [['report_anomaly',report],['capture_grease_validation',capture]])await unchanged(name,p,'SCOPE_DENIED');});
 await test('no membership denied',async()=>{await db.exec("delete from public.engrase_sync where store='cuadrillas'");await unchanged('report_anomaly',report,'SCOPE_DENIED');});
 await test('Lubricador create + server identity + retry',async()=>{const a=await call('report_anomaly',report);assert.equal(a.status,'APPLIED');assert.equal(a.rows[0].payload.capturedByAuthUserId,authId);assert.deepEqual(await call('report_anomaly',report),a);assert.equal((await db.query("select count(*)::int n from public.engrase_sync where store='anomalies'")).rows[0].n,1);});
 await test('Lubricador own edit allowed without generic U',async()=>{await seededAnomaly();assert.equal((await call('edit_anomaly',edit)).status,'APPLIED');});
 await test('Lubricador other edit and close denied',async()=>{await seededAnomaly(false);for(const [name,p] of [['edit_anomaly',edit],['close_anomaly',close]])await unchanged(name,p,'ANOMALY_OWNER_DENIED');});
 await test('legacy display name does not prove ownership',async()=>{await put('anomalies','a1',{equipmentId:'e1',createdBy:'Test User',status:'Abierta'});await unchanged('edit_anomaly',edit,'ANOMALY_OWNER_DENIED');});
 await test('Supervisor scoped edit + close allowed',async()=>{await reset('SUPERVISOR');await seededAnomaly(false);const e=await call('edit_anomaly',edit);assert.equal(e.status,'APPLIED');assert.equal((await call('close_anomaly',{...close,p_expected:e.rows[0].updated_at})).status,'APPLIED');});
 await test('Supervisor outside scope denied',async()=>{await reset('SUPERVISOR');await seededAnomaly();await db.exec(`update public.engrase_sync set payload=payload||'{"locationId":"other"}' where store='equipment'`);await unchanged('close_anomaly',close,'SCOPE_DENIED');});
 await test('invalid transition + stale CAS denied',async()=>{await seededAnomaly();await unchanged('edit_anomaly',{...edit,p_status:'UNKNOWN'},'INVALID_TRANSITION');await unchanged('edit_anomaly',{...edit,p_expected:'2025-01-01Z'},'VERSION_CONFLICT');});
 await test('existing editor reopen transition retained',async()=>{await put('anomalies','a1',{equipmentId:'e1',capturedByAuthUserId:authId,status:'Cerrada'});assert.equal((await call('edit_anomaly',{...edit,p_status:'Abierta'})).status,'APPLIED');});
 await test('Planificador automatic only + retry no repetition inflation',async()=>{await reset('PLANIFICADOR');await unchanged('report_anomaly',report,'ROLE_DENIED');const a=await call('repeat_anomaly_from_execution',automatic);assert.equal(a.status,'APPLIED');assert.equal(a.rows[0].payload.criticality,'Alta');assert.deepEqual(await call('repeat_anomaly_from_execution',automatic),a);assert.equal((await db.query("select count(*)::int n from public.engrase_sync where store='lubrication_records'")).rows[0].n,1);});
 await test('automatic repetition derives current state',async()=>{await seededAnomaly();await db.exec(`update public.engrase_sync set payload=payload||'{"autoPointId":"point1","repeticiones":2}' where store='anomalies'`);const a=await call('repeat_anomaly_from_execution',automatic);assert.equal(a.rows[0].id,'a1');assert.equal(a.rows[0].payload.repeticiones,3);});
 await test('automatic cannot mutate through another actor execution',async()=>{await db.exec(`update public.engrase_sync set payload=payload||'{"capturedByAuthUserId":"other"}' where store='lubrication_records'`);await unchanged('repeat_anomaly_from_execution',automatic,'EXECUTION_ACTOR_DENIED');});
 await test('automatic cannot repeat same execution with a new nonce or forged receipt-free record',async()=>{
  await unchanged('repeat_anomaly_from_execution',{...automatic,p_operation_id:'new-nonce'},'INVALID_OPERATION');
  await db.exec(`update public.engrase_sync set payload=payload||'{"notes":"forged"}' where store='lubrication_records'`);
  await unchanged('repeat_anomaly_from_execution',automatic,'EXECUTION_NOT_ACCEPTED');
  await db.exec('delete from public.lubrication_execution_receipts');await unchanged('repeat_anomaly_from_execution',automatic,'EXECUTION_NOT_ACCEPTED');
 });
 await test('capture fixes exact record version + snapshot + authenticated capturer',async()=>{const a=await call('capture_grease_validation',capture);assert.equal(a.status,'APPLIED');assert.equal(Date.parse(a.rows[0].payload.recordVersion),Date.parse(version));assert.equal(a.rows[0].payload.recordSnapshot.id,'r1');assert.equal(a.rows[0].payload.signerName,'External operator');assert.equal(a.rows[0].payload.capturedByAuthUserId,authId);assert.deepEqual(await call('capture_grease_validation',capture),a);});
 await test('0009 signed-record lock still denies LUBRICADOR and ADMIN after new capture',async()=>{
  const date=new Date().toISOString();
  await db.query("update public.engrase_sync set payload=payload||$1::jsonb where store='lubrication_records'",[JSON.stringify({date,createdAt:date,userId:'u1',shiftId:'shift_dia',sinHorometro:false})]);
  await call('capture_grease_validation',capture);
  const input={p_operation_id:'signed-edit',p_action:'EDIT',p_record_id:'r1',p_equipment_id:'e1',p_plan_id:null,p_crew_id:'c1',p_assignment_id:null,
   p_execution_date:date,p_client_captured_at:date,p_shift_id:'shift_dia',p_execution_type:'PLANNED',p_out_of_plan_reason:null,p_performed_by:'u1',p_retroactive:false,
   p_hourmeter:110,p_no_hourmeter:false,p_no_hourmeter_reason:null,p_lubricant_id:null,p_quantity:1,p_condition:'Normal',p_notes:'',p_details:[],p_photos:[],
   p_expected_record:version,p_expected_equipment:version,p_expected_plan:null,p_expected_assignment:null};
  await unchanged('lubrication_execution',input,'SIGNED_RECORD_LOCKED');
  await db.exec("update public.app_profiles set role='ADMINISTRADOR';insert into public.app_store_permissions values('lubrication_records','ADMINISTRADOR',true,true,true,true)");
  await unchanged('lubrication_execution',input,'SIGNED_RECORD_LOCKED');
 });
 await test('wrong record and version denied',async()=>{await unchanged('capture_grease_validation',{...capture,p_record_id:'missing'},'RECORD_NOT_FOUND');await unchanged('capture_grease_validation',{...capture,p_expected:'2025-01-01Z'},'RECORD_VERSION_CONFLICT');});
 await test('signature invalid URL + supervisor declared identity denied',async()=>{await unchanged('capture_grease_validation',{...capture,p_signature_url:null},'INVALID_SIGNATURE');await reset('SUPERVISOR');await unchanged('capture_grease_validation',capture,'INVALID_SIGNER_ROLE');});
 await test('signature duplicate different operation conflicts',async()=>{await call('capture_grease_validation',capture);await unchanged('capture_grease_validation',{...capture,p_operation_id:'different'},'SIGNATURE_EXISTS');});
 await test('signature object missing or owned by another Auth user denied',async()=>{
  await db.exec("delete from storage.objects where id='v1'");await unchanged('capture_grease_validation',capture,'SIGNATURE_OBJECT_DENIED');
  await db.exec("insert into storage.objects values('v1','engrase-photos','grease_validations/v1.png','other')");await unchanged('capture_grease_validation',capture,'SIGNATURE_OBJECT_DENIED');
 });
 await test('automatic ambiguity rolls back every earlier point',async()=>{
  await seededAnomaly();await db.exec(`update public.engrase_sync set payload=payload||'{"autoPointId":"point1"}' where store='anomalies'`);
  await put('anomalies','a2',{equipmentId:'e1',autoPointId:'point1',status:'Abierta'});
  await db.exec(`update public.engrase_sync set payload=payload||'{"details":[{"pointId":"first","done":false,"reason":"Otro"},{"pointId":"point1","done":false,"reason":"Otro"}]}' where store='lubrication_records'`);
  await acceptExecutionFixture();
  await unchanged('repeat_anomaly_from_execution',automatic,'AUTOMATIC_ANOMALY_AMBIGUOUS');
 });
 await test('admin retirement retry is idempotent and preserves original payload',async()=>{
  await reset('ADMINISTRADOR');await seededAnomaly();const params={p_operation_id:'retire1',p_id:'a1',p_expected:version};
  const r=await call('retire_anomaly',params);assert.equal(r.status,'APPLIED');assert.equal(r.rows[0].payload.active,false);
  assert.equal(r.rows[0].payload.equipmentId,'e1');assert.deepEqual(await call('retire_anomaly',params),r);
 });
 await test('normal UPDATE/DELETE and direct inserts fail even legacy ALL true',async()=>{
  await call('capture_grease_validation',capture);await db.exec('set role authenticated');
  assert.equal((await db.query("update public.engrase_sync set payload='{}' where store='grease_validations' returning id")).rows.length,0);
  assert.equal((await db.query("delete from public.engrase_sync where store='grease_validations' returning id")).rows.length,0);
  await assert.rejects(db.exec("insert into public.engrase_sync values('anomalies','b','{}',now(),false)"),/row-level security/);await db.exec('reset role');
 });
 await test('ADMIN conflict CAS resolution preserves originals and alternatives',async()=>{
  const a=await call('capture_grease_validation',capture);const b=await call('capture_grease_validation',{...capture,p_operation_id:'v2',p_id:'v2',p_signature_url:capture.p_signature_url.replace('v1.png','v2.png')});
  const input={p_operation_id:'res1',p_record_id:'r1',p_id:'v2',p_note:'Revisión',p_expected_signatures:[{id:'v1',updatedAt:a.rows[0].updated_at},{id:'v2',updatedAt:b.rows[0].updated_at}]};
  await unchanged('resolve_grease_validation_conflict',input,'ADMIN_REQUIRED');await db.exec("update public.app_profiles set role='ADMINISTRADOR';insert into public.app_store_permissions values('grease_validations','ADMINISTRADOR',true,true,true,true)");
  await unchanged('resolve_grease_validation_conflict',{...input,p_expected_signatures:[]},'SIGNATURES_VERSION_CONFLICT');
  const r=await call('resolve_grease_validation_conflict',input);assert.equal(r.status,'APPLIED');assert.equal(r.rows[0].payload.conflictResolution.officialValidationId,'v2');
  assert.equal(r.rows[0].payload.signatureUrl,a.rows[0].payload.signatureUrl);assert.deepEqual(r.rows[0].payload.recordSnapshot,a.rows[0].payload.recordSnapshot);
  assert.equal((await db.query("select count(*)::int n from public.engrase_sync where store='grease_validations'")).rows[0].n,2);assert.deepEqual(await call('resolve_grease_validation_conflict',input),r);
  await unchanged('resolve_grease_validation_conflict',{...input,p_operation_id:'res2'},'SIGNATURES_VERSION_CONFLICT');
  const next={...input,p_operation_id:'res2',p_id:'v1',p_expected_signatures:[{id:'v1',updatedAt:r.rows[0].updated_at},{id:'v2',updatedAt:b.rows[0].updated_at}]};
  const changed=await call('resolve_grease_validation_conflict',next);assert.equal(changed.status,'APPLIED');assert.equal(changed.rows[0].payload.conflictResolution.history.length,1);
 });
 await test('signature binary cannot overwrite or unlink',async()=>{await db.exec('set role authenticated');
  assert.equal((await db.query("update storage.objects set name='changed' returning id")).rows.length,0);
  assert.equal((await db.query('delete from storage.objects returning id')).rows.length,0);await db.exec('reset role');});
 await db.exec(await readFile(root+'0010_evidence_gateway_ROLLBACK.sql','utf8'));
 await assert.rejects(call('report_anomaly',report),/permission denied/);passed++;console.log('PASS rollback revokes endpoint without reopening evidence writes');
 console.log(`SQL EVIDENCE GATEWAY: ${passed} passed`);
} finally {await db.close();}
