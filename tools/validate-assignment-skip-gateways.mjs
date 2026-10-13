// Local, disposable PGlite simulation only. Never opens a network connection.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath=process.env.PGLITE_MODULE_PATH||path.join(process.env.TEMP||'/tmp','control-engrase-sql-preflight/node_modules/@electric-sql/pglite/dist/index.js');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const db=new PGlite();
const migrations='CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/';
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
 create schema storage; create table storage.objects(bucket_id text,name text,owner_id text); alter table storage.objects enable row level security;
 grant select,insert,update,delete on public.engrase_sync to anon,authenticated;
 grant select on public.app_store_permissions to anon,authenticated;
 grant select on public.app_profiles to anon;
 grant execute on function public.current_app_role(),public.current_app_active() to authenticated;`);
await db.exec(await readFile(migrations+'0006_notification_dispatch_log_rls_PREPARED.sql','utf8'));
 await db.exec(await readFile(migrations+'0009_lubrication_execution_gateway_PREPARED.sql','utf8'));
 await db.exec(await readFile(migrations+'0010_evidence_gateway_PREPARED.sql','utf8'));
await db.exec(await readFile(migrations+'0011_operational_catalog_gateway_PREPARED.sql','utf8'));
 await db.exec(await readFile(migrations+'0012_authorization_scope_bootstrap_PREPARED.sql','utf8'));
await db.exec(await readFile(migrations+'0013_authorization_row_scope_PREPARED.sql','utf8'));
await db.exec(await readFile(migrations+'0014_assignment_skip_gateways_PREPARED.sql','utf8'));
 await db.exec(await readFile(migrations+'0015_store_permission_target_PREPARED.sql','utf8'));
await db.exec('grant select on public.app_profiles to anon');
assert.equal((await db.query("select count(*)::int as n from public.app_store_permissions where role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR') and store in ('anomalies','audit_log','cuadrillas','equipment','equipment_types','grease_validations','locations','lubricants','lubrication_assignments','lubrication_plans','lubrication_points','lubrication_records','lubrication_skips','notification_dispatch_log','push_tokens','settings','shifts','users')")).rows[0].n,72,'target contains exactly the 72 known role/store rows');
assert.equal((await db.query("select can_insert and can_update and not can_delete as allowed from public.app_store_permissions where role='PLANIFICADOR' and store='lubrication_plans'")).rows[0].allowed,true,'Planner planning writes remain available through role-restricted catalog transport');
assert.equal((await db.query("select can_insert and can_update as allowed from public.app_store_permissions where role='ADMINISTRADOR' and store='settings'")).rows[0].allowed,true,'Admin settings maintenance remains available');
assert.equal((await db.query("select count(*)::int as n from public.app_store_permissions where store in ('lubrication_assignments','lubrication_skips','lubrication_records','anomalies','grease_validations') and role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR') and (can_insert or can_update or can_delete)")).rows[0].n,0,'typed RPC stores have no generic mutation permissions');
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
  const skip=await db.query(`select public.record_lubrication_skip($1,'skipA',null,'eqA','planA',$2,'crewA',now(),$3,'SIN_TIEMPO',null,null) as r`,['op-skip',`planA:${today}`,shiftId]);
  assert.equal(skip.rows[0].r.status,'APPLIED');
  const duplicateSkip=await db.query(`select public.record_lubrication_skip($1,'skipDup',null,'eqA','planA',$2,'crewA',now(),'shift_dia','SIN_TIEMPO',null,null) as r`,['op-skip-dup',`planA:${today}`]);
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
