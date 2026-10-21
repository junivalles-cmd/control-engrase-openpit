// Local in-memory PostgreSQL/PGlite tests only. Never connects to Supabase.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath=process.env.PGLITE_MODULE_PATH||path.join(process.env.TEMP||'/tmp','control-engrase-sql-preflight/node_modules/@electric-sql/pglite/dist/index.js');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const db=new PGlite();
const migrationRoot='CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/';
const authA='11111111-1111-4111-8111-111111111111';
const authB='22222222-2222-4222-8222-222222222222';
await db.exec(`create role anon; create role authenticated; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.app_profiles(auth_user_id uuid primary key,app_user_id text,display_name text,role text,active boolean);
 create table public.app_store_permissions(store text,role text,can_read boolean,can_insert boolean,can_update boolean,can_delete boolean,primary key(store,role));
 create table public.engrase_sync(store text,id text,payload jsonb,updated_at timestamptz default now(),deleted boolean default false,primary key(store,id));
 alter table public.engrase_sync enable row level security;
 create policy "acceso interno con anon key" on public.engrase_sync for all using(true) with check(true);
 insert into public.app_store_permissions select s,r,true,true,true,false from unnest(array['users','shifts','locations','equipment_types','equipment','lubricants','lubrication_plans','lubrication_points','lubrication_records','anomalies','audit_log','settings','cuadrillas','push_tokens','grease_validations','lubrication_assignments','lubrication_skips']) s cross join unnest(array['ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR']) r;
 update public.app_store_permissions set can_read=false where store='settings' and role<>'ADMINISTRADOR';
 update public.app_store_permissions set can_read=false where store='audit_log' and role<>'ADMINISTRADOR';
 update public.app_store_permissions set can_read=false where store='anomalies' and role='PLANIFICADOR';
 update public.app_store_permissions set can_read=false where store='equipment' and role='LUBRICADOR';
 create function public.current_app_role() returns text language sql stable security definer set search_path=pg_catalog as $$select role from public.app_profiles where auth_user_id=auth.uid() limit 1$$;
 create function public.current_app_active() returns boolean language sql stable security definer set search_path=pg_catalog as $$select coalesce((select active from public.app_profiles where auth_user_id=auth.uid() limit 1),false)$$;
 create policy \"engrase_sync: leer según matriz\" on public.engrase_sync for select using(current_app_active() and exists(select 1 from public.app_store_permissions p where p.store=engrase_sync.store and p.role=current_app_role() and p.can_read));
 create policy \"engrase_sync: crear según matriz\" on public.engrase_sync for insert with check(current_app_active() and exists(select 1 from public.app_store_permissions p where p.store=engrase_sync.store and p.role=current_app_role() and p.can_insert));
 create policy \"engrase_sync: actualizar según matriz\" on public.engrase_sync for update using(current_app_active() and exists(select 1 from public.app_store_permissions p where p.store=engrase_sync.store and p.role=current_app_role() and (p.can_update or p.can_delete))) with check(current_app_active() and exists(select 1 from public.app_store_permissions p where p.store=engrase_sync.store and p.role=current_app_role() and p.can_update));
 grant select,insert,update,delete on public.engrase_sync to authenticated;
 grant select on public.app_store_permissions to authenticated;
 grant execute on function public.current_app_role(),public.current_app_active() to authenticated;`);
await db.exec(await readFile(migrationRoot+'0012_authorization_scope_bootstrap_PREPARED.sql','utf8'));
const install=await readFile(migrationRoot+'0013_authorization_row_scope_PREPARED.sql','utf8');
const bootstrapBefore=(await db.query("select pg_get_functiondef('public.get_authorization_context()'::regprocedure) as def")).rows[0].def;
await assert.rejects(db.exec(install.replace(/commit;\s*$/i,'select no_such_audit_function(); commit;')),/no_such_audit_function/);
await db.exec('rollback');
assert.equal((await db.query("select pg_get_functiondef('public.get_authorization_context()'::regprocedure) as def")).rows[0].def,bootstrapBefore);
assert.equal((await db.query("select to_regprocedure('authorization_private.authorization_store_action_allowed(text,text,boolean)') as f")).rows[0].f,null);
assert.equal((await db.query("select count(*)::int as n from app_store_permissions where ((store='equipment' and role='LUBRICADOR') or (store='settings' and role in ('PLANIFICADOR','SUPERVISOR','LUBRICADOR'))) and can_read")).rows[0].n,0);
await db.exec(install);
await db.query(`insert into public.app_profiles values
 ($1,'uA','User A','LUBRICADOR',true),($2,'uB','User B','LUBRICADOR',true),
 ('33333333-3333-4333-8333-333333333333','superA','Supervisor A','SUPERVISOR',true),
 ('44444444-4444-4444-8444-444444444444','planner','Planner','PLANIFICADOR',true),
 ('55555555-5555-4555-8555-555555555555','admin','Admin','ADMINISTRADOR',true)`,[authA,authB]);
const put=async(store,id,payload={})=>db.query('insert into public.engrase_sync(store,id,payload) values($1,$2,$3::jsonb)',[store,id,JSON.stringify({id,active:true,...payload})]);
await put('locations','locA',{name:'A'});await put('locations','locB',{name:'B'});
await put('cuadrillas','crewA',{locationId:'locA',memberUserIds:['uA','superA']});
await put('cuadrillas','crewB',{locationId:'locB',memberUserIds:['uB']});
await put('equipment','eA',{locationId:'locA'});await put('equipment','eB',{locationId:'locB'});
await put('lubrication_plans','planA',{equipmentId:'eA'});await put('lubrication_plans','planB',{equipmentId:'eB'});
await put('lubrication_points','pointA',{planId:'planA'});await put('lubrication_points','pointB',{planId:'planB'});
await put('lubrication_records','recordA',{equipmentId:'eA',operationalSnapshot:{crewId:'crewA',equipmentLocationIdAtExecution:'locA'}});
await put('lubrication_records','recordB',{equipmentId:'eB',operationalSnapshot:{crewId:'crewB',equipmentLocationIdAtExecution:'locB'}});
await put('lubrication_assignments','assignmentA',{equipmentId:'eA',assignedCrewId:'crewA'});
await put('lubrication_assignments','assignmentB',{equipmentId:'eB',assignedCrewId:'crewB'});
await put('lubrication_skips','skipA',{equipmentId:'eA',crewId:'crewA'});await put('lubrication_skips','skipB',{equipmentId:'eB',crewId:'crewB'});
await put('anomalies','anomalyA',{equipmentId:'eA',crewId:'crewA'});await put('anomalies','anomalyB',{equipmentId:'eB',crewId:'crewB'});
await put('grease_validations','validationA',{lubricationRecordId:'recordA'});await put('grease_validations','validationB',{lubricationRecordId:'recordB'});
await put('push_tokens','tokenA',{userId:'uA'});await put('push_tokens','tokenB',{userId:'uB'});
await put('users','uA',{appUserId:'uA'});await put('users','uB',{appUserId:'uB'});
await put('users','superA',{appUserId:'superA'});
await put('audit_log','auditA',{authUserId:authA,appUserId:'uA'});await put('audit_log','auditB',{authUserId:authB,appUserId:'uB'});
await put('lubricants','grease1',{name:'Shared'});await put('settings','general',{name:'Setting'});

async function queryAs(authId,role,sql,args=[]){
  await db.exec('reset role');await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',authId]);await db.exec('set role authenticated');
  try{return (await db.query(sql,args)).rows;}finally{await db.exec('reset role');}
}
const ids=async(authId,role,store)=>(await queryAs(authId,role,'select id from public.engrase_sync where store=$1 order by id',[store])).map(row=>row.id);
const pass=label=>console.log('PASS '+label);

for (const [auth,role,crew,location] of [[authA,'LUBRICADOR','crewA','locA'],[authB,'LUBRICADOR','crewB','locB'],['33333333-3333-4333-8333-333333333333','SUPERVISOR','crewA','locA']]) {
  const bootstrap=(await queryAs(auth,role,'select public.get_authorization_context() as c'))[0].c;
  assert.equal(bootstrap.context.rowScopeEnforced,true);
  assert.deepEqual(await ids(auth,role,'equipment'),[location==='locA'?'eA':'eB']);
  assert.deepEqual(await ids(auth,role,'cuadrillas'),[crew]);
  assert.deepEqual(await ids(auth,role,'locations'),[location]);
  assert.deepEqual(await ids(auth,role,'lubrication_plans'),[location==='locA'?'planA':'planB']);
  assert.deepEqual(await ids(auth,role,'lubrication_points'),[location==='locA'?'pointA':'pointB']);
  assert.deepEqual(await ids(auth,role,'lubrication_records'),[location==='locA'?'recordA':'recordB']);
  assert.deepEqual(await ids(auth,role,'lubrication_assignments'),[location==='locA'?'assignmentA':'assignmentB']);
  assert.deepEqual(await ids(auth,role,'lubrication_skips'),[location==='locA'?'skipA':'skipB']);
  assert.deepEqual(await ids(auth,role,'anomalies'),[location==='locA'?'anomalyA':'anomalyB']);
  assert.deepEqual(await ids(auth,role,'grease_validations'),[location==='locA'?'validationA':'validationB']);
  assert.deepEqual(await ids(auth,role,'push_tokens'),auth===authA?['tokenA']:auth===authB?['tokenB']:[]);
  assert.deepEqual(await ids(auth,role,'users'),[auth===authA?'uA':auth===authB?'uB':'superA']);
  assert.deepEqual(await ids(auth,role,'audit_log'),[],'crew-scoped roles cannot read audit rows under the store matrix');
  pass(`${role} ${auth===authA?'User A':auth===authB?'User B':'fixture'} sees only own crew/location and personal rows`);
}
for (const [auth,role] of [['44444444-4444-4444-8444-444444444444','PLANIFICADOR'],['55555555-5555-4555-8555-555555555555','ADMINISTRADOR']]) {
  assert.equal((await queryAs(auth,role,'select public.get_authorization_context() as c'))[0].c.context.rowScopeEnforced,true);
  assert.deepEqual(await ids(auth,role,'equipment'),['eA','eB']);
  assert.deepEqual(await ids(auth,role,'lubrication_records'),['recordA','recordB']);
  assert.deepEqual(await ids(auth,role,'settings'),['general']);
  assert.deepEqual(await ids(auth,role,'push_tokens'),[],'push tokens remain owner-only even for global roles');
  assert.deepEqual(await ids(auth,role,'users'),[],'legacy user rows remain owner-only even for global roles');
  assert.deepEqual(await ids(auth,role,'audit_log'),role==='ADMINISTRADOR'?['auditA','auditB']:[]);
  assert.deepEqual(await ids(auth,role,'anomalies'),role==='ADMINISTRADOR'?['anomalyA','anomalyB']:[]);
  pass(`${role} receives global operational rows but remains bounded by matrix and personal ownership`);
}
assert.deepEqual(await ids(authA,'LUBRICADOR','lubricants'),['grease1']);pass('shared read catalog remains available under the store matrix');
const updated=await queryAs(authA,'LUBRICADOR',"update public.engrase_sync set payload=payload||'{\"note\":\"attempt\"}'::jsonb where store='equipment' and id='eB' returning id");
assert.deepEqual(updated,[],'out-of-scope update is filtered by RLS');
const inserted=await queryAs(authA,'LUBRICADOR',"insert into public.engrase_sync(store,id,payload) values('anomalies','anomalyA2','{\"id\":\"anomalyA2\",\"equipmentId\":\"eA\",\"crewId\":\"crewA\"}') returning id");
assert.deepEqual(inserted.map(r=>r.id),['anomalyA2']);
let outsideInsertDenied=false;
try{await queryAs(authA,'LUBRICADOR',"insert into public.engrase_sync(store,id,payload) values('anomalies','anomalyB2','{\"id\":\"anomalyB2\",\"equipmentId\":\"eB\",\"crewId\":\"crewB\"}') returning id");}catch{outsideInsertDenied=true;await db.exec('reset role');}
assert.equal(outsideInsertDenied,true,'out-of-scope insert is denied');
pass('scoped mutation checks reject out-of-scope writes and permit in-scope operations');

// Mandatory production regressions: legacy PUBLIC ALL/true is present.
await db.exec('grant select,insert,update,delete on public.engrase_sync to anon');
const planner = '44444444-4444-4444-8444-444444444444';
const adminAuth = '55555555-5555-4555-8555-555555555555';
await db.exec("update app_store_permissions set can_read=false where store='equipment' and role='ADMINISTRADOR'");
assert.deepEqual(await ids(adminAuth,'ADMINISTRADOR','equipment'),[]);
await db.exec("update app_store_permissions set can_read=true where store='equipment' and role='ADMINISTRADOR'");
assert.deepEqual(await ids(adminAuth,'ADMINISTRADOR','equipment'),['eA','eB']);
assert.deepEqual(await ids(planner,'PLANIFICADOR','anomalies'),[]);
assert.deepEqual(await ids(planner,'PLANIFICADOR','audit_log'),[]);
await db.exec("update public.app_store_permissions set can_read=false,can_insert=false,can_update=false,can_delete=false where store='equipment' and role='LUBRICADOR'");
assert.deepEqual(await ids(authA,'LUBRICADOR','equipment'),[]);
await assert.rejects(queryAs(authA,'LUBRICADOR',`insert into public.engrase_sync(store,id,payload)
 values('equipment','matrixBypass','{"id":"matrixBypass","locationId":"locA"}')`),/row-level security/);
await db.exec("update public.app_store_permissions set can_read=true where store='equipment' and role='LUBRICADOR'");
assert.equal((await queryAs(authA,'LUBRICADOR',"update public.engrase_sync set payload=payload||'{\"note\":\"matrix bypass\"}'::jsonb where store='equipment' and id='eA' returning id")).length,0);
assert.equal((await queryAs(authA,'LUBRICADOR',"delete from public.engrase_sync where store='equipment' and id='eA' returning id")).length,0);
await db.exec("update public.app_store_permissions set can_delete=true where store='equipment' and role='LUBRICADOR'");
await assert.rejects(queryAs(authA,'LUBRICADOR',"update engrase_sync set payload=payload||'{\"note\":\"normal update\"}' where store='equipment' and id='eA'"),/row-level security/);
assert.equal((await queryAs(authA,'LUBRICADOR',"update engrase_sync set deleted=true where store='equipment' and id='eA' returning id")).length,1);
await db.exec("update engrase_sync set deleted=false where store='equipment' and id='eA'; update app_store_permissions set can_delete=false where store='equipment' and role='LUBRICADOR'");
pass('A-E: legacy cannot bypass matrix SELECT/INSERT/UPDATE/DELETE; soft-delete checks preserve current semantics');
assert.deepEqual(await ids(authA,'LUBRICADOR','settings'),['general']);
await db.exec("update app_store_permissions set can_read=false where store='settings' and role='LUBRICADOR'");
assert.deepEqual(await ids(authA,'LUBRICADOR','settings'),[]);
await db.exec("update app_store_permissions set can_read=true where store='settings' and role='LUBRICADOR'");
assert.deepEqual(await ids(authA,'LUBRICADOR','audit_log'),[]);
assert.deepEqual(await ids(authA,'LUBRICADOR','users'),['uA']);
await put('crew_locations','forbidden',{crewId:'crewA',locationId:'locA'});
await put('future_unknown','unknown',{});
await db.exec("insert into app_store_permissions values('crew_locations','ADMINISTRADOR',true,true,true,true),('future_unknown','LUBRICADOR',true,true,true,true)");
assert.deepEqual(await ids('55555555-5555-4555-8555-555555555555','ADMINISTRADOR','crew_locations'),[]);
assert.deepEqual(await ids(planner,'PLANIFICADOR','crew_locations'),[]);
assert.deepEqual(await ids(authA,'LUBRICADOR','future_unknown'),[]);
pass('I-K: foreign tokens denied even Admin, crew_locations denied globally, unknown scoped denied, settings matrix-controlled');
await put('equipment','orphanEquipment',{});
await put('lubrication_plans','orphanPlan',{equipmentId:'missing'});
await put('lubrication_points','orphanPoint',{planId:'missing'});
await put('lubrication_records','orphanRecord',{});
await put('lubrication_skips','orphanSkip',{});
await put('anomalies','orphanAnomaly',{});
await put('lubrication_assignments','orphanAssignment',{equipmentId:'missing',assignedCrewId:'crewA'});
await put('grease_validations','orphanValidation',{recordId:'missing'});
await put('lubrication_assignments','noCrewAssignment',{equipmentId:'eA'});
assert.ok((await ids(authA,'LUBRICADOR','lubrication_assignments')).includes('noCrewAssignment'));
for (const [store,id] of [['equipment','orphanEquipment'],['lubrication_plans','orphanPlan'],['lubrication_points','orphanPoint'],['lubrication_records','orphanRecord'],['lubrication_skips','orphanSkip'],['anomalies','orphanAnomaly'],['lubrication_assignments','orphanAssignment'],['grease_validations','orphanValidation']]) {
 assert.ok(!(await ids(authA,'LUBRICADOR',store)).includes(id));
}
await put('lubrication_records','snapshotOnly',{equipmentId:'missing',operationalSnapshot:{crewId:'crewA'}});
assert.ok((await ids(authA,'LUBRICADOR','lubrication_records')).includes('snapshotOnly'));
const projectedPoints=(await db.exec(await readFile('docs/0013_PRODUCTION_PREFLIGHT_READ_ONLY.sql','utf8')))
 .flatMap(r=>r.rows||[]).find(r=>r.role==='SUPERVISOR' && r.store==='lubrication_points' && r.tombstone===false && 'estimated_authenticated_visible_after_0013' in r);
assert.equal(Number(projectedPoints.estimated_authenticated_visible_after_0013),1);
assert.equal(Number(projectedPoints.matrix_readable_but_hidden),2);
await db.exec("update public.engrase_sync set deleted=true where store='equipment' and id='eA'");
assert.ok((await ids(authA,'LUBRICADOR','equipment')).includes('eA'),'equipment tombstone with retained location remains visible');
assert.deepEqual(await ids(authA,'LUBRICADOR','lubrication_plans'),[]);
assert.ok((await ids(authA,'LUBRICADOR','lubrication_records')).includes('recordA'),'snapshot preserves record scope after equipment deletion');
await db.exec("update public.engrase_sync set deleted=true where store='lubrication_records' and id='recordA'");
assert.deepEqual(await ids(authA,'LUBRICADOR','grease_validations'),[]);
pass('legacy orphans are filtered without SQL error; valid snapshots survive; deleted parents hide linked children/tombstones');
assert.ok((await ids('55555555-5555-4555-8555-555555555555','ADMINISTRADOR','lubrication_records')).includes('orphanRecord'));
pass('F-H: points use planId, missing parents fail closed; unlinked history scoped denied and permitted GLOBAL retained');
const policiesBefore=(await db.query("select policyname,permissive,roles,cmd,qual,with_check from pg_policies where tablename='engrase_sync' order by policyname")).rows;
assert.equal(policiesBefore.filter(p=>p.policyname.startsWith('authorization_')).length,8);
for (const p of policiesBefore.filter(p=>p.policyname.startsWith('authorization_'))) {
 assert.equal(p.permissive,'RESTRICTIVE'); assert.deepEqual(p.roles,['authenticated']);
}
const helperAcl=(await db.query(`select prosecdef,proconfig,pg_get_userbyid(proowner) as owner,
 has_function_privilege('anon',oid,'execute') as anon,
 has_function_privilege('authenticated',oid,'execute') as authenticated
 from pg_proc where oid='authorization_private.authorization_store_action_allowed(text,text,boolean)'::regprocedure`)).rows[0];
assert.deepEqual(helperAcl,{prosecdef:true,proconfig:['search_path=pg_catalog'],owner:'postgres',anon:false,authenticated:true});
await db.exec("update app_store_permissions set can_read=false where store='settings' and role='SUPERVISOR'");
await assert.rejects(db.exec(await readFile(migrationRoot+'0013_authorization_row_scope_ROLLBACK_PREPARED.sql','utf8')),/READ bits drifted/);
await db.exec("rollback; update app_store_permissions set can_read=true where store='settings' and role='SUPERVISOR'");
const matrixBefore=(await db.query('select * from app_store_permissions order by store,role')).rows;
await db.exec(await readFile(migrationRoot+'0013_authorization_row_scope_ROLLBACK_PREPARED.sql','utf8'));
assert.equal((await queryAs(authB,'LUBRICADOR','select public.get_authorization_context() as c'))[0].c.context.rowScopeEnforced,false);
assert.deepEqual((await db.query("select policyname,permissive,roles,cmd,qual,with_check from pg_policies where tablename='engrase_sync' order by policyname")).rows,policiesBefore);
assert.deepEqual((await db.query('select * from app_store_permissions order by store,role')).rows,matrixBefore.map(r=>
 ((r.store==='equipment' && r.role==='LUBRICADOR') || (r.store==='settings' && ['PLANIFICADOR','SUPERVISOR','LUBRICADOR'].includes(r.role)))?{...r,can_read:false}:r));
await assert.rejects(db.exec(install),/already exists/);
await db.exec('rollback');
await db.exec(await readFile(migrationRoot+'0013_authorization_row_scope_ROLLBACK_PREPARED.sql','utf8'));
assert.equal((await db.query("select can_read from app_store_permissions where store='equipment' and role='LUBRICADOR'")).rows[0].can_read,false);
await db.exec('set role anon');
assert.ok((await db.query("select id from engrase_sync where store='equipment' and id='eB'")).rows.length);
await db.exec('reset role');
pass('L: injected failure atomic; rollback keeps eight restrictive policies, restores four reads, is repeatable; anonymous exposure persists');
const preflightResults=await db.exec(await readFile('docs/0013_PRODUCTION_PREFLIGHT_READ_ONLY.sql','utf8'));
assert.ok(preflightResults.length>5);
pass('exact read-only production preflight executes locally');
// 0014 targets a LIVE repaired 0013 over installed 0009/0010/0011, so its
// exact-body baseline must fail closed on the safe-stopped 0013 left above
// (that rollback replaces get_authorization_context). The settings OR exception
// and the later-rollout refusal run in tools/validate-support-other-location.mjs,
// whose environment matches the real installed target.
await assert.rejects(db.exec(await readFile(migrationRoot+'0014_assignment_skip_gateways_PREPARED.sql','utf8')),/baseline\/ownership drift/);
await db.exec('rollback');
assert.equal((await db.query("select to_regclass('authorization_private.support_control') as t")).rows[0].t,null);
assert.equal((await db.query("select count(*)::int as n from pg_policies where tablename='engrase_sync' and policyname like 'authorization_%' and permissive='RESTRICTIVE'")).rows[0].n,8);
pass('0014 refuses to install over a safe-stopped 0013 baseline and leaves the eight gates untouched');
await db.close();
console.log('PASS authorization row-scope matrix scenarios (local PGlite only)');
