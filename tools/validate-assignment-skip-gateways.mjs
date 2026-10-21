// Local, disposable PGlite simulation only. Never opens a network connection.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath=process.env.PGLITE_MODULE_PATH||path.join(process.env.TEMP||'/tmp','control-engrase-sql-preflight/node_modules/@electric-sql/pglite/dist/index.js');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const db=new PGlite();
const migrations='CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/';
const preCutover=process.argv.includes('--precutover');
const authA='11111111-1111-4111-8111-111111111111';
const authB='22222222-2222-4222-8222-222222222222';
await db.exec(`create role anon; create role authenticated; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.app_profiles(auth_user_id uuid primary key,app_user_id text,display_name text,role text,active boolean);
 create table public.app_store_permissions(store text,role text,can_read boolean,can_insert boolean,can_update boolean,can_delete boolean,primary key(store,role));
 create table public.engrase_sync(store text,id text,payload jsonb,updated_at timestamptz default now(),deleted boolean default false,primary key(store,id));
 alter table public.engrase_sync enable row level security;
 insert into public.app_store_permissions select s,r,true,true,true,false from unnest(array['users','shifts','locations','equipment_types','equipment','lubricants','lubrication_plans','lubrication_points','lubrication_records','anomalies','audit_log','settings','cuadrillas','push_tokens','grease_validations','lubrication_assignments','lubrication_skips']) s cross join unnest(array['ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR']) r;
 create function public.current_app_role() returns text language plpgsql stable security definer set search_path=pg_catalog as $$begin if auth.uid() is null then return null; end if; return (select role from public.app_profiles where auth_user_id=auth.uid() limit 1); end$$;
 create function public.current_app_active() returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$begin if auth.uid() is null then return false; end if; return coalesce((select active from public.app_profiles where auth_user_id=auth.uid() limit 1),false); end$$;
 create policy "engrase_sync: leer según matriz" on public.engrase_sync for select using(current_app_active() and exists(select 1 from public.app_store_permissions p where p.store=engrase_sync.store and p.role=current_app_role() and p.can_read));
 create policy "engrase_sync: crear según matriz" on public.engrase_sync for insert with check(current_app_active() and exists(select 1 from public.app_store_permissions p where p.store=engrase_sync.store and p.role=current_app_role() and p.can_insert));
 create policy "engrase_sync: actualizar según matriz" on public.engrase_sync for update using(current_app_active() and exists(select 1 from public.app_store_permissions p where p.store=engrase_sync.store and p.role=current_app_role() and (p.can_update or p.can_delete))) with check(current_app_active() and exists(select 1 from public.app_store_permissions p where p.store=engrase_sync.store and p.role=current_app_role() and p.can_update));
 create policy "acceso interno con anon key" on public.engrase_sync for all to public using(true) with check(true);
 create schema storage; create table storage.buckets(id text,public boolean); create table storage.objects(bucket_id text,name text,owner_id text); alter table storage.objects enable row level security;
 grant select,insert,update,delete on public.engrase_sync to anon,authenticated;
 grant select on public.app_store_permissions to anon,authenticated;
 grant select on public.app_profiles to anon;
 grant execute on function public.current_app_role(),public.current_app_active() to authenticated;`);
await db.exec(await readFile(migrations+'0006_notification_dispatch_log_rls_PREPARED.sql','utf8'));
await db.exec("update public.app_store_permissions set can_read=false where (store='equipment' and role='LUBRICADOR') or (store='settings' and role in ('PLANIFICADOR','SUPERVISOR','LUBRICADOR'))");
 await db.exec(await readFile(migrations+'0009_lubrication_execution_gateway_PREPARED.sql','utf8'));
 await db.exec(await readFile(migrations+'0010_evidence_gateway_PREPARED.sql','utf8'));
 await db.exec(await readFile(migrations+'0012_authorization_scope_bootstrap_PREPARED.sql','utf8'));
await db.exec(await readFile(migrations+'0013_authorization_row_scope_PREPARED.sql','utf8'));
await db.exec(await readFile(migrations+'0011_operational_catalog_gateway_PREPARED.sql','utf8'));
const matrixBefore=(await db.query('select * from app_store_permissions order by role,store')).rows;
const policiesBefore=(await db.query("select * from pg_policies where tablename='engrase_sync' order by policyname")).rows;
if (preCutover) await db.exec(await readFile('docs/0014_PRODUCTION_PREFLIGHT_READ_ONLY.sql','utf8'));
await db.exec(await readFile(migrations+'0014_assignment_skip_gateways_PREPARED.sql','utf8'));
const policiesAfter0014=(await db.query("select * from pg_policies where tablename='engrase_sync' order by policyname")).rows;
assert.deepEqual(policiesAfter0014.filter(p=>p.policyname!=='authorization_scope_select' && !p.policyname.startsWith('assignment_skip_')).map(p=>JSON.parse(JSON.stringify(p).replaceAll('authorization_row_in_scope_baseline_0013','authorization_row_in_scope'))),
 policiesBefore.filter(p=>p.policyname!=='authorization_scope_select'));
if (!preCutover) {
 await db.exec(await readFile(migrations+'0007_push_tokens_ownership_rls_PREPARED.sql','utf8'));
 await db.exec(await readFile(migrations+'0015_store_permission_target_PREPARED.sql','utf8'));
}
if (preCutover) assert.deepEqual((await db.query('select * from app_store_permissions order by role,store')).rows,matrixBefore);
await db.exec('grant select on public.app_profiles to anon');
assert.equal((await db.query("select count(*)::int as n from public.app_store_permissions where role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR') and store in ('anomalies','audit_log','cuadrillas','equipment','equipment_types','grease_validations','locations','lubricants','lubrication_assignments','lubrication_plans','lubrication_points','lubrication_records','lubrication_skips','notification_dispatch_log','push_tokens','settings','shifts','users')")).rows[0].n,72,'target contains exactly the 72 known role/store rows');
assert.equal((await db.query("select can_insert and can_update and not can_delete as allowed from public.app_store_permissions where role='PLANIFICADOR' and store='lubrication_plans'")).rows[0].allowed,true,'Planner planning writes remain available through role-restricted catalog transport');
assert.equal((await db.query("select can_insert and can_update as allowed from public.app_store_permissions where role='ADMINISTRADOR' and store='settings'")).rows[0].allowed,true,'Admin settings maintenance remains available');
if (!preCutover) assert.equal((await db.query("select count(*)::int as n from public.app_store_permissions where store in ('lubrication_assignments','lubrication_skips','lubrication_records','anomalies','grease_validations') and role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR') and (can_insert or can_update or can_delete)")).rows[0].n,0,'typed RPC stores have no generic mutation permissions');
await db.query(`insert into public.app_profiles values
 ($1,'uA','User A','SUPERVISOR',true),($2,'uB','User B','SUPERVISOR',true),
 ('33333333-3333-4333-8333-333333333333','inactive','Inactive','LUBRICADOR',false),
 ('44444444-4444-4444-8444-444444444444','admin','Admin','ADMINISTRADOR',true),
 ('55555555-5555-4555-8555-555555555555','planner','Planner','PLANIFICADOR',true),
 ('66666666-6666-4666-8666-666666666666','uLub','Lubricador','LUBRICADOR',true)`,[authA,authB]);
const put=async(store,id,payload={})=>db.query('insert into public.engrase_sync(store,id,payload) values($1,$2,$3::jsonb)',[store,id,JSON.stringify({id,active:true,...payload})]);
for (const [id,name] of [['locA','A'],['locB','B']]) await put('locations',id,{name});
await put('cuadrillas','crewA',{locationId:'locA',memberUserIds:['uA','uLub'],isDefault:true});
await put('cuadrillas','crewB',{locationId:'locB',memberUserIds:['uB'],isDefault:true});
await put('cuadrillas','crewC',{locationId:'locA',memberUserIds:[],isDefault:false});
await put('equipment','eqA',{locationId:'locA'}); await put('equipment','eqB',{locationId:'locB'});
await put('equipment','eqC',{locationId:'locA'}); await put('equipment','eqLub',{locationId:'locA'});
for (const [id,equipmentId] of [['planA','eqA'],['planB','eqB']]) await put('lubrication_plans',id,{equipmentId,controlType:'Día y turno de la semana',assignedDays:['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']});
await put('lubrication_plans','planC',{equipmentId:'eqC',controlType:'Día y turno de la semana',assignedDays:['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']});
await put('lubrication_plans','planLub',{equipmentId:'eqLub',controlType:'Día y turno de la semana',assignedDays:['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']});
const todayContext=(await db.query("select (clock_timestamp() at time zone 'America/Managua')::date::text as d,case when extract(hour from clock_timestamp() at time zone 'America/Managua')>=6 and extract(hour from clock_timestamp() at time zone 'America/Managua')<18 then 'shift_dia' else 'shift_noche' end as shift_id")).rows[0];
const today=todayContext.d,shiftId=todayContext.shift_id;
await put('lubrication_assignments','assignmentB',{equipmentId:'eqB',planId:'planB',occurrenceKey:`planB:${today}`,assignedCrewId:'crewB',status:'PENDING'});
await put('lubrication_skips','skipB',{equipmentId:'eqB',planId:'planB',occurrenceKey:`planB:${today}`,crewId:'crewB',reason:'SIN_TIEMPO'});
await put('lubrication_assignments','doneAssignment',{equipmentId:'eqC',planId:'planC',occurrenceKey:`planC:${today}`,assignedCrewId:'crewA',status:'COMPLETED',completedRecordId:'recordC'});
await put('settings','general',{shiftDayStart:6,shiftNightStart:18});
await put('notification_dispatch_log','dispatch1',{event:'fixture'});
// Keep the policy-composition fixture independent of Auth-profile grants:
// authenticated reads get a simple matrix stand-in; anon is admitted only by
// the legacy ALL/true policy under test.
await db.exec(`drop policy "engrase_sync: leer según matriz" on public.engrase_sync;
 create policy simulation_authenticated_read on public.engrase_sync for select to authenticated using(auth.uid() is not null);`);
async function as(auth,sql,args=[]){
  await db.exec('reset role'); await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',auth]); await db.exec('set role authenticated');
  try{return await db.query(sql,args);}finally{await db.exec('reset role');}
}
const anonIds=async()=>{await db.exec('reset role');await db.exec("set role anon");try{return (await db.query("select id from public.engrase_sync where store='equipment' order by id")).rows.map(x=>x.id);}finally{await db.exec('reset role');}};
assert.deepEqual(await anonIds(),['eqA','eqB','eqC','eqLub'],'legacy permissive policy is effective for anon before cutover');
const policy=(await db.query("select policyname,permissive,roles,cmd from pg_catalog.pg_policies where schemaname='public' and tablename='engrase_sync' and policyname like 'authorization_scope_%' order by policyname")).rows;
assert.equal(policy.length,4); assert.ok(policy.every(p=>p.permissive==='RESTRICTIVE'));
await db.exec('reset role');await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',authA]);await db.exec('set role authenticated');
try{
  const visible=(await db.query("select id from public.engrase_sync where store='equipment' order by id")).rows.map(x=>x.id);
  assert.deepEqual(visible,['eqA','eqC','eqLub'],'supervisor first pull is limited to its location');
  const generic=await db.query("update public.engrase_sync set payload=payload||'{\"bad\":true}'::jsonb where store='lubrication_assignments' returning id");
  assert.equal(generic.rows.length,0,'generic assignment mutation is denied by restrictive guard');
  const created=await db.query(`select public.manage_lubrication_assignment($1,'CREATE','assignmentA',null,'eqA','planA',$2,'crewA','fixture') as r`,['op-create',`planA:${today}`]);
  assert.equal(created.rows[0].r.status,'APPLIED');
  const denied=await db.query(`select public.manage_lubrication_assignment($1,'CREATE','assignmentLeak',null,'eqB','planB',$2,'crewB','fixture') as r`,['op-leak',`planB:${today}`]);
  assert.equal(denied.rows[0].r.code,'SCOPE_DENIED');
  const duplicate=await db.query(`select public.manage_lubrication_assignment($1,'CREATE','assignmentDup',null,'eqA','planA',$2,'crewA','fixture') as r`,['op-dup',`planA:${today}`]);
  assert.equal(duplicate.rows[0].r.code,'ASSIGNMENT_ALREADY_PENDING');
  // put() bypasses RLS only as the superuser session role — briefly drop
  // back to it to seed this fixture, then re-establish authA's authenticated
  // session exactly as it was before (same pattern used just above this try{}).
  await db.exec('reset role');
  await put('equipment','eqNotes',{locationId:'locA'});
  await put('lubrication_plans','planNotes',{equipmentId:'eqNotes',controlType:'Día y turno de la semana',assignedDays:['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']});
  await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',authA]);
  await db.exec('set role authenticated');
  const notes1000='x'.repeat(1000),notes1001='x'.repeat(1001);
  const notesPass=await db.query(`select public.manage_lubrication_assignment($1,'CREATE','assignmentNotesPass',null,'eqNotes','planNotes',$2,'crewA',$3) as r`,['op-notes-pass',`planNotes:${today}`,notes1000]);
  assert.equal(notesPass.rows[0].r.status,'APPLIED','exactly 1000 chars of notes is accepted on CREATE');
  assert.equal(notesPass.rows[0].r.rows.find(row=>row.store==='lubrication_assignments').payload.notes,notes1000);
  const notesDenied=await db.query(`select public.manage_lubrication_assignment($1,'CREATE','assignmentNotesDenied',null,'eqNotes','planNotes',$2,'crewA',$3) as r`,['op-notes-denied',`planNotes:${today}`,notes1001]);
  assert.equal(notesDenied.rows[0].r.code,'INVALID_INPUT','1001 chars of notes is denied on CREATE (previously unreachable dead code let this through)');
  assert.equal((await db.query("select count(*)::int as n from engrase_sync where store='lubrication_assignments' and id='assignmentNotesDenied'")).rows[0].n,0,'denied CREATE writes nothing');
  const skip=await db.query(`select public.record_lubrication_skip($1,'skipA',null,'eqA','planA',$2,'crewA',now(),$3,'SIN_TIEMPO',null,null) as r`,['op-skip',`planA:${today}`,shiftId]);
  assert.equal(skip.rows[0].r.status,'APPLIED');
  const duplicateSkip=await db.query(`select public.record_lubrication_skip($1,'skipDup',null,'eqA','planA',$2,'crewA',now(),$3,'SIN_TIEMPO',null,null) as r`,['op-skip-dup',`planA:${today}`,shiftId]);
  assert.equal(duplicateSkip.rows[0].r.code,'SKIP_ALREADY_RECORDED');
  const mutation=await db.query("update public.engrase_sync set payload=payload||'{\"changed\":true}'::jsonb where store='lubrication_skips' and id='skipA' returning id");
  assert.equal(mutation.rows.length,0,'skip is immutable through direct transport');
}finally{await db.exec('reset role');}
const adminAuth='44444444-4444-4444-8444-444444444444';
const adminCreate=(await as(adminAuth,`select public.manage_lubrication_assignment($1,'CREATE','assignmentAdmin',null,'eqC','planC',$2,'crewA','fixture') as r`,['op-admin-create',`planC:${today}`])).rows[0].r;
assert.equal(adminCreate.status,'APPLIED','Admin can create a global assignment');
const adminVersion=adminCreate.rows[0].updated_at;
const reassigned=(await as(adminAuth,`select public.manage_lubrication_assignment($1,'REASSIGN','assignmentAdmin',$2,'eqC','planC',$3,'crewC','fixture') as r`,['op-admin-reassign',adminVersion,`planC:${today}`])).rows[0].r;
assert.equal(reassigned.status,'APPLIED','Admin can reassign pending work');
const cancelled=(await as(adminAuth,`select public.manage_lubrication_assignment($1,'CANCEL','assignmentAdmin',$2,'eqC','planC',$3,null,'fixture') as r`,['op-admin-cancel',reassigned.rows[0].updated_at,`planC:${today}`])).rows[0].r;
assert.equal(cancelled.status,'APPLIED','Admin can cancel pending work');
const plannerCreate=(await as('55555555-5555-4555-8555-555555555555',`select public.manage_lubrication_assignment($1,'CREATE','assignmentPlanner',null,'eqC','planC',$2,'crewA','fixture') as r`,['op-planner-create',`planC:${today}`])).rows[0].r;
assert.equal(plannerCreate.status,'APPLIED','Planner can create a global operational assignment');
const completedVersion=(await db.query("select updated_at from public.engrase_sync where store='lubrication_assignments' and id='doneAssignment'")).rows[0].updated_at;
const completedEdit=(await as(adminAuth,`select public.manage_lubrication_assignment($1,'CANCEL','doneAssignment',$2,'eqC','planC',$3,null,'fixture') as r`,['op-completed-edit',completedVersion,`planC:${today}`])).rows[0].r;
assert.equal(completedEdit.code,'INVALID_TRANSITION','completed assignments cannot be changed through normal gateway');
const lubSkip=(await as('66666666-6666-4666-8666-666666666666',`select public.record_lubrication_skip($1,'skipLub',null,'eqLub','planLub',$2,'crewA',now(),$3,'SIN_TIEMPO',null,null) as r`,['op-lub-skip',`planLub:${today}`,shiftId])).rows[0].r;
assert.equal(lubSkip.status,'APPLIED','Lubricator can record an in-scope immutable skip');
if (preCutover) {
 const after=(await db.query("select * from pg_policies where tablename='engrase_sync' order by policyname")).rows;
 assert.equal(after.filter(p=>p.policyname.startsWith('authorization_')).length,8);
 const equipmentBefore=(await db.query("select id,payload,updated_at from engrase_sync where store='equipment' order by id")).rows;
 await db.query("update engrase_sync set payload=jsonb_set(payload,'{memberUserIds}','[\"uA\"]') where store='cuadrillas' and id='crewC'");
 await put('cuadrillas','crewExtra',{locationId:'locA',memberUserIds:['uA'],isDefault:false});
 assert.equal((await as(authA,'select get_authorization_context() as c')).rows[0].c.context.authorizedCrewIds.length,3);
 const deniedNull=(await as(authA,`select public.record_lubrication_skip('null-reason','invalidSkip',null,'eqC','planC',$1,'crewA',now(),$2,null,null,null) as r`,[`planC:${today}`,shiftId])).rows[0].r;
 assert.equal(deniedNull.code,'INVALID_SKIP');
 const multi=(await as(authA,`select public.record_lubrication_skip('missing-crew','missingCrewSkip',null,'eqC','planC',$1,null,now(),$2,'SIN_TIEMPO',null,null) as r`,[`planC:${today}`,shiftId])).rows[0].r;
 assert.equal(multi.code,'CREW_REQUIRED');
 await db.exec(`create function public.fixture_collision() returns trigger language plpgsql as $$
 begin if NEW.id in ('raceAssignment','raceSkip') and pg_trigger_depth()=1 then
  insert into public.engrase_sync(store,id,payload,updated_at,deleted) values(NEW.store,NEW.id,jsonb_build_object('id',NEW.id,'sentinel',true),NEW.updated_at,false);
 end if; return NEW; end $$;
 create trigger fixture_collision before insert on engrase_sync for each row execute function public.fixture_collision();`);
 const raceAssign=(await as(adminAuth,`select public.manage_lubrication_assignment('race-assign','CREATE','raceAssignment',null,'eqLub','planLub',$1,'crewA','fixture') as r`,[`planLub:${today}`])).rows[0].r;
 assert.equal(raceAssign.code,'ID_CONFLICT');
 const raceSkip=(await as(authA,`select public.record_lubrication_skip('race-skip','raceSkip',null,'eqC','planC',$1,'crewA',now(),$2,'SIN_TIEMPO',null,null) as r`,[`planC:${today}`,shiftId])).rows[0].r;
 assert.equal(raceSkip.code,'ID_CONFLICT');
 assert.equal((await db.query("select count(*)::int as n from engrase_sync where id in ('raceAssignment','raceSkip') and payload->>'sentinel'='true'")).rows[0].n,2);
 assert.equal((await db.query("select count(*)::int as n from assignment_skip_operation_receipts where operation_id in ('race-assign','race-skip','null-reason')")).rows[0].n,0);
 await db.exec('drop trigger fixture_collision on engrase_sync; drop function public.fixture_collision()');
 assert.deepEqual((await db.query("select id,payload,updated_at from engrase_sync where store='equipment' order by id")).rows,equipmentBefore);
 const replay=(await as(authA,`select public.manage_lubrication_assignment('op-create','CREATE','assignmentA',null,'eqA','planA',$1,'crewA','fixture') as r`,[`planA:${today}`])).rows[0].r;
 assert.equal(replay.status,'APPLIED');
 const stale=(await as(adminAuth,`select public.manage_lubrication_assignment('stale-cas','CANCEL','assignmentPlanner','2000-01-01', 'eqC','planC',$1,null,'fixture') as r`,[`planC:${today}`])).rows[0].r;
 assert.equal(stale.code,'VERSION_CONFLICT');
 const forbidden=(await as('66666666-6666-4666-8666-666666666666',`select public.manage_lubrication_assignment('lub-create','CREATE','lubAssignment',null,'eqLub','planLub',$1,'crewA','fixture') as r`,[`planLub:${today}`])).rows[0].r;
 assert.equal(forbidden.code,'ROLE_DENIED');
 await db.exec("update app_store_permissions set can_read=false where role='SUPERVISOR' and store='lubrication_assignments'");
 assert.equal((await as(authA,`select manage_lubrication_assignment('read-denied','CREATE','readDenied',null,'eqA','planA',$1,'crewA','fixture') as r`,[`planA:${today}`])).rows[0].r.code,'PERMISSION_DENIED');
 await db.exec("update app_store_permissions set can_read=true where role='SUPERVISOR' and store='lubrication_assignments'");
 assert.equal((await as(adminAuth,`select record_lubrication_skip('admin-skip','skipAdmin',null,'eqC','planC',$1,null,now(),$2,'SIN_TIEMPO',null,null) as r`,[`planC:${today}`,shiftId])).rows[0].r.status,'APPLIED');
 await put('equipment','eqPlannerSkip',{locationId:'locB'});
 await put('lubrication_plans','planPlannerSkip',{equipmentId:'eqPlannerSkip',controlType:'Horas de operación',lastGreaseHour:0});
 assert.equal((await as('55555555-5555-4555-8555-555555555555',`select record_lubrication_skip('planner-skip','skipPlanner',null,'eqPlannerSkip','planPlannerSkip','planPlannerSkip:h:0',null,now(),$1,'SIN_TIEMPO',null,null) as r`,[shiftId])).rows[0].r.status,'APPLIED');
 await db.exec("update app_store_permissions set can_read=false where role='SUPERVISOR' and store='settings'");
 assert.deepEqual((await as(authA,"select id from engrase_sync where store='settings'")).rows,[]);
 await db.exec("update app_store_permissions set can_read=true where role='SUPERVISOR' and store='settings'; set role anon");
 assert.equal((await db.query("select id from engrase_sync where store='lubrication_skips'")).rows.length>0,true);
 await assert.rejects(db.query("insert into engrase_sync(store,id,payload) values('lubrication_skips','anonSkip','{}')"),/row-level security/);
 await assert.rejects(db.query('select * from assignment_skip_operation_receipts'),/permission denied/);
 await db.exec('reset role');
 const signatures=['public.manage_lubrication_assignment(text,text,text,timestamptz,text,text,text,text,text)',
  'public.record_lubrication_skip(text,text,timestamptz,text,text,text,text,timestamptz,text,text,text,text)'];
 for(const s of [...signatures,'public.assignment_skip_operation(text,text,text,timestamptz,text,text,text,text,text,timestamptz,text,text,text,text)']) {
  const acl=(await db.query(`select prosecdef,proconfig,pg_get_userbyid(proowner) as owner,
  has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('authenticated',oid,'execute') as authenticated
  from pg_proc where oid=to_regprocedure($1)`,[s])).rows[0];
  assert.deepEqual(acl,{prosecdef:true,proconfig:['search_path=pg_catalog'],owner:'postgres',anon:false,authenticated:signatures.includes(s)});
 }
 const table=(await db.query("select relrowsecurity,has_table_privilege('authenticated',oid,'SELECT') as direct from pg_class where oid='assignment_skip_operation_receipts'::regclass")).rows[0];
 assert.deepEqual(table,{relrowsecurity:true,direct:false});
 const receipts=(await db.query('select * from assignment_skip_operation_receipts order by auth_user_id,operation_id')).rows;
 const allPolicies=(await db.query("select * from pg_policies where tablename='engrase_sync' order by policyname")).rows;
 await db.exec(await readFile(migrations+'0014_assignment_skip_gateways_ROLLBACK_PREPARED.sql','utf8'));
 await db.exec(await readFile(migrations+'0014_assignment_skip_gateways_ROLLBACK_PREPARED.sql','utf8'));
 assert.deepEqual((await db.query('select * from assignment_skip_operation_receipts order by auth_user_id,operation_id')).rows,receipts);
 assert.deepEqual((await db.query("select * from pg_policies where tablename='engrase_sync' order by policyname")).rows,allPolicies);
 assert.equal((await as(authA,'select get_authorization_context() as c')).rows[0].c.context.rowScopeEnforced,true);
 for(const s of signatures) assert.equal((await db.query("select has_function_privilege('authenticated',to_regprocedure($1),'execute') as ok",[s])).rows[0].ok,false);
 console.log('PASS 0014 pre-cutover: roles, PRE-0008 scope, persistence/CAS/idempotency, ID collisions, null validation, matrix, anon narrowing, ACL/receipts and safe-stop rollback');
 await db.close();process.exit(0);
}
await db.exec(`drop policy simulation_authenticated_read on public.engrase_sync;
 create policy "engrase_sync: leer según matriz" on public.engrase_sync for select
 using(current_app_active() and exists(select 1 from public.app_store_permissions p where p.store=engrase_sync.store and p.role=current_app_role() and p.can_read));`);
await db.exec(await readFile(migrations+'AUTH_RLS_FINAL_CUTOVER_PREPARED.sql','utf8'));
assert.equal((await db.query("select count(*)::int as n from pg_catalog.pg_policies where schemaname='public' and tablename='engrase_sync' and policyname='acceso interno con anon key'")).rows[0].n,0,'cutover removes legacy policy');
assert.equal((await db.query("select has_table_privilege('anon','public.engrase_sync','SELECT') as allowed")).rows[0].allowed,false,'cutover revokes anon table privileges');
assert.equal((await db.query("select has_table_privilege('authenticated','public.engrase_sync','DELETE') as allowed")).rows[0].allowed,false,'cutover denies generic hard-delete privilege');
let anonDenied=false;try{await anonIds();}catch{anonDenied=true;await db.exec('reset role');}
assert.equal(anonDenied,true,'anon cannot query the operational table after cutover');
const visibleIds=async(auth,store)=>(await as(auth,"select id from public.engrase_sync where store=$1 order by id",[store])).rows.map(row=>row.id);
const globalEquipment=['eqA','eqB','eqC','eqLub'];
const scopedEquipment=['eqA','eqC','eqLub'];
assert.deepEqual(await visibleIds(adminAuth,'equipment'),globalEquipment,'Admin first pull is global after cutover');
assert.deepEqual(await visibleIds('55555555-5555-4555-8555-555555555555','equipment'),globalEquipment,'Planner first pull is global after cutover');
assert.deepEqual(await visibleIds(authA,'equipment'),scopedEquipment,'Supervisor first pull is location-scoped after cutover');
assert.deepEqual(await visibleIds('66666666-6666-4666-8666-666666666666','equipment'),scopedEquipment,'Lubricator first pull is location-scoped after cutover');
for(const auth of [adminAuth,'55555555-5555-4555-8555-555555555555',authA,'66666666-6666-4666-8666-666666666666']){
  assert.deepEqual(await visibleIds(auth,'settings'),['general'],'operational roles retain settings read');
  assert.deepEqual(await visibleIds(auth,'notification_dispatch_log'),[],'dispatch remains server-only');
  assert.deepEqual(await visibleIds(auth,'users'),[],'legacy users store is not an Auth directory');
}
const noProfile=(await as('77777777-7777-4777-8777-777777777777','select public.get_authorization_context() as c')).rows[0].c;
assert.equal(noProfile.status,'DENIED','authenticated account without app_profile is denied after cutover');
const plannerPending=(await db.query("select updated_at from public.engrase_sync where store='lubrication_assignments' and id='assignmentPlanner'")).rows[0].updated_at;
const postCutoverCancel=(await as(adminAuth,
 `select public.manage_lubrication_assignment($1,'CANCEL','assignmentPlanner',$2,'eqC','planC',$3,null,'fixture') as r`,
 ['op-post-cutover-cancel',plannerPending,`planC:${today}`])).rows[0].r;
assert.equal(postCutoverCancel.status,'APPLIED','Admin assignment management remains available after legacy policy removal');
const postCutoverCreate=(await as('55555555-5555-4555-8555-555555555555',
 `select public.manage_lubrication_assignment($1,'CREATE','assignmentPlannerAfter',null,'eqC','planC',$2,'crewA','fixture') as r`,
 ['op-post-cutover-planner',`planC:${today}`])).rows[0].r;
assert.equal(postCutoverCreate.status,'APPLIED','Planner can create a global assignment after legacy policy removal');
const postCutoverScopeDeny=(await as(authA,
 `select public.manage_lubrication_assignment($1,'CREATE','assignmentLeakAfter',null,'eqB','planB',$2,'crewB','fixture') as r`,
 ['op-post-cutover-scope',`planB:${today}`])).rows[0].r;
assert.equal(postCutoverScopeDeny.code,'SCOPE_DENIED','Supervisor remains unable to assign outside scope after cutover');
const postCutoverLubAssignment=(await as('66666666-6666-4666-8666-666666666666',
 `select public.manage_lubrication_assignment($1,'CREATE','lubAssignmentAfter',null,'eqLub','planLub',$2,'crewA','fixture') as r`,
 ['op-post-cutover-lub-assignment',`planLub:${today}`])).rows[0].r;
assert.equal(postCutoverLubAssignment.code,'ROLE_DENIED','Lubricador cannot manage assignments after cutover');
const postCutoverSkip=(await as('66666666-6666-4666-8666-666666666666',
 `select public.record_lubrication_skip($1,'skipAfterCutover',null,'eqC','planC',$2,'crewA',now(),$3,'SIN_TIEMPO',null,null) as r`,
 ['op-post-cutover-skip',`planC:${today}`,shiftId])).rows[0].r;
assert.equal(postCutoverSkip.status,'APPLIED','Lubricador can add an immutable in-scope skip after cutover');
const inactive=(await as('33333333-3333-4333-8333-333333333333','select public.get_authorization_context() as c')).rows[0].c;
assert.equal(inactive.status,'DENIED','inactive identity receives no authorized bootstrap');
await db.exec(await readFile(migrations+'AUTH_RLS_FINAL_CUTOVER_ROLLBACK_PREPARED.sql','utf8'));
assert.equal((await db.query("select count(*)::int as n from pg_catalog.pg_policies where schemaname='public' and tablename='engrase_sync' and policyname='acceso interno con anon key'")).rows[0].n,0,'safe rollback never restores anonymous access');
assert.equal((await db.query("select relrowsecurity from pg_catalog.pg_class where oid='public.engrase_sync'::regclass")).rows[0].relrowsecurity,true,'safe rollback leaves RLS enabled');
console.log('PASS 40 local PostgreSQL assertions: legacy OR/restrictive behavior, anonymous denial post-0003, global/scoped assignments, no-profile denial and immutable skips');
await db.close();
