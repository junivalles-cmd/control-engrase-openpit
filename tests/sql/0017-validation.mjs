// Local, disposable PGlite simulation only. Never opens a network connection.
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
process.on('uncaughtException',e=>{console.error(e.message,e.code,e.where);process.exit(1);});

const modulePath=process.env.PGLITE_MODULE_PATH||[
 path.join(os.tmpdir(),'control-engrase-sql-preflight/node_modules/@electric-sql/pglite/dist/index.js'),
 path.join(os.homedir(),'AppData/Local/Temp/control-engrase-sql-preflight/node_modules/@electric-sql/pglite/dist/index.js')
].find(existsSync);
if(!modulePath)throw new Error('Set PGLITE_MODULE_PATH to an existing PGlite dist/index.js. No project dependency is installed.');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const notices=[];
const db=new PGlite();
const noticeOptions={onNotice:n=>notices.push(n.message)};
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

await db.exec(await readFile(migrations+'0014_assignment_skip_gateways_PREPARED.sql','utf8'));
await db.exec(await readFile(migrations+'0007_push_tokens_ownership_rls_PREPARED.sql','utf8'));
// Reproduce the installed 0015 matrix only. Its current textual pg_policies
// guard rejects this PG catalog's deparser; do not change 0015 or hide that limit.
const m15=await readFile(migrations+'0015_store_permission_target_PREPARED.sql','utf8');
await db.exec(m15.slice(m15.indexOf('with target(store,role'),m15.indexOf('do $assertions$')));
await db.exec(await readFile(migrations+'0016_fix_support_rls_performance_PREPARED.sql','utf8'));
await db.exec('grant select on public.app_profiles to authenticated');
const { randomUUID } = await import('node:crypto');
for (const role of ['ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR','VISOR']) {
 await db.query('insert into app_profiles values($1,$2,$2,$3,true)',[randomUUID(),role.toLowerCase(),role]);
}
await db.query("insert into app_profiles values($1,'other-lub','Other','LUBRICADOR',true)",[randomUUID()]);
for (const [store,id,payload] of [
 ['locations','loc-a',{active:true}],['locations','loc-b',{active:true}],
 ['cuadrillas','crew-a',{active:true,locationId:'loc-a',memberUserIds:['lubricador','supervisor']}],
 ['cuadrillas','crew-b',{active:true,locationId:'loc-b',memberUserIds:['other-lub']}],
 ['equipment','eq-a',{locationId:'loc-a'}],['settings','general',{}]
]) await db.query('insert into engrase_sync(store,id,payload) values($1,$2,$3)',[store,id,{id,...payload}]);
// Cover every existing transport store, including rows carrying no scope.
const stores=(await db.query('select distinct store from app_store_permissions order by store')).rows.map(r=>r.store);
for(const store of stores)await db.query('insert into engrase_sync(store,id,payload) values($1,$2,$3)',[store,'sample:'+store,{id:'sample:'+store,crewId:'crew-a',assignedCrewId:'crew-a',equipmentId:'eq-a',locationId:'loc-a',memberUserIds:['lubricador'],userId:'lubricador'}]);
const profiles=(await db.query('select auth_user_id,role from app_profiles order by role,auth_user_id')).rows;
const matrixBefore=(await db.query('select * from app_store_permissions order by store,role')).rows;
const policies=()=>db.query("select policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename='engrase_sync' order by policyname").then(r=>r.rows);
const policiesBefore=await policies();
// Evaluate actual catalog USING/CHECK expressions for every existing row,
// role and action. Includes permissive OR and restrictive AND composition.
async function effectiveSnapshot(){
 const catalog=await policies();const result=[];
 for(const profile of profiles){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[profile.auth_user_id]);
  for(const action of ['SELECT','INSERT','UPDATE','DELETE'])for(const phase of action==='UPDATE'?['USING','CHECK']:[action==='INSERT'?'CHECK':'USING']){
   const relevant=catalog.filter(p=>(p.cmd==='ALL'||p.cmd===action)&&p.roles.some(r=>r==='public'||r==='authenticated'));
   const expr=p=>`coalesce((${phase==='CHECK'?(p.with_check||p.qual||'true'):(p.qual||'true')}),false)`;
   const permit=relevant.filter(p=>p.permissive==='PERMISSIVE').map(expr).join(' OR ')||'false';
   const restrict=relevant.filter(p=>p.permissive==='RESTRICTIVE').map(expr).join(' AND ')||'true';
   const rows=(await db.query(`select store,id,((${permit}) AND (${restrict})) allowed from public.engrase_sync where store=any($1) order by store,id`,[stores])).rows;
   result.push(...rows.map(r=>({actor:profile.auth_user_id,role:profile.role,action,phase,...r})));
  }
 }
 return result;
}
const before=await effectiveSnapshot();
await db.exec(await readFile(migrations+'0017_broadcast_messages_scope_PREPARED.sql','utf8'));
const after=await effectiveSnapshot();
assert.equal(before.length,after.length);
const oldNotNew=before.filter((r,i)=>r.allowed&&!after[i].allowed);
const newNotOld=after.filter((r,i)=>r.allowed&&!before[i].allowed);
console.log('EXISTING STORE EQUIVALENCE',JSON.stringify({OLD_NOT_NEW:oldNotNew.length,NEW_NOT_OLD:newNotOld.length,checked:before.length,stores:stores.length}));
assert.deepEqual(oldNotNew,[],'STOP: old access removed');assert.deepEqual(newNotOld,[],'STOP: new access granted');
assert.deepEqual((await db.query('select * from app_store_permissions where store=any($1) order by store,role',[stores])).rows,matrixBefore);
await db.exec(await readFile('docs/0017_BROADCAST_MESSAGES_EQUIVALENCE_TESTS_READ_ONLY.sql','utf8'),noticeOptions);
const rowsBefore=(await db.query('select * from engrase_sync order by store,id')).rows;
await db.exec(await readFile('tests/sql/0017-security.sql','utf8'),noticeOptions);
assert.deepEqual((await db.query('select * from engrase_sync order by store,id')).rows,rowsBefore,'security fixtures rolled back');
console.log('SECURITY TESTS',notices.filter(n=>n.startsWith('PASS:')).length,'PASS');
// End-to-end contract: persist the exact payload emitted by REAL sync.js
// (only HTTP/IndexedDB mocked), under authenticated RLS in real local PG.
const {mockedPipelinePayload,DUMMY_IMAGE}=await import('../staging0017/photo-payload-fixture.mjs');
const photoActor=profiles.find(r=>r.role==='LUBRICADOR').auth_user_id;
const photoCtx=(await db.query('select resolve_authorization_scope($1) c',[photoActor])).rows[0].c.context;
await db.exec('begin');
const photoPending={id:'TEST0017_PIPELINE_TASK',crewId:photoCtx.authorizedCrewIds[0],equipmentId:'eq-a',createdBy:'supervisor',title:'Pipeline RLS contract',status:'PENDING'};
await db.query("insert into engrase_sync(store,id,payload) values('manual_tasks',$1,$2)",[photoPending.id,photoPending]);
const pipeline=await mockedPipelinePayload('manual_tasks',{...photoPending,status:'COMPLETED',completedBy:photoCtx.appUserId,completedAt:'2026-10-18T12:00:00Z',completionComment:'Dummy evidence',photos:[DUMMY_IMAGE]});
await db.query("select set_config('request.jwt.claim.sub',$1,true)",[photoActor]);await db.exec('set local role authenticated');
const persisted=(await db.query("update engrase_sync set payload=$1 where store='manual_tasks' and id=$2 returning payload",[pipeline.payload,photoPending.id])).rows;
assert.equal(persisted.length,1,'Actual pipeline completion must affect a row');assert.deepEqual(persisted[0].payload,pipeline.payload);
await db.exec('reset role');await db.exec('rollback');
await writeFile('docs/evidence/0017_PHOTO_SQL_CONTRACT_2026-10-18.json',JSON.stringify({type:'LOCAL_POSTGRES_RLS_REAL_SYNC_CODE_MOCKED_STORAGE',result:'PASS',finalPersistedPayload:persisted[0].payload,localPhotoPreserved:pipeline.localAfter.photos[0]===DUMMY_IMAGE},null,2)+'\n');
console.log('REAL PIPELINE PAYLOAD -> LOCAL SQL RLS PASS');
// Small, rollback-safe EXPLAIN probes. No ANALYZE, timeout change, or load.
const perfActor=profiles.find(r=>r.role==='LUBRICADOR').auth_user_id;
const perfContext=(await db.query('select resolve_authorization_scope($1) c',[perfActor])).rows[0].c;
const perfUser=perfContext.context.appUserId;
const perfCrew=perfContext.context.authorizedCrewIds[0];
await db.exec('begin');
await db.query("insert into engrase_sync(store,id,payload) values('broadcast_messages','__0017_perf_broadcast',$1),('manual_tasks','__0017_perf_task',$2)",[
 {id:'__0017_perf_broadcast',targetType:'LOCATION',targetId:'loc-a',createdBy:'administrador'},
 {id:'__0017_perf_task',crewId:perfCrew,equipmentId:'eq-a',createdBy:'supervisor',status:'PENDING',title:'Performance probe'}
]);
await db.query("select set_config('request.jwt.claim.sub',$1,true)",[perfActor]);
await db.exec('set local role authenticated');
const locationPlan=(await db.query("explain (format json) select * from engrase_sync where store='broadcast_messages'")).rows;
const completionPlan=(await db.query("explain (format json) update engrase_sync set payload=payload||jsonb_build_object('status','COMPLETED','completedBy',$1::text,'completedAt',now()) where store='manual_tasks' and id='__0017_perf_task'",[perfUser])).rows;
await db.exec('reset role');
// The outer policy plan hides SECURITY DEFINER internals; explain the
// LOCATION coverage expression as well, with exactly the same predicates.
const forward=await readFile(migrations+'0017_broadcast_messages_scope_PREPARED.sql','utf8');
const coverage=forward.slice(forward.indexOf('select 1 from jsonb_array_elements_text(crews)'),forward.indexOf('\n      );',forward.indexOf('select 1 from jsonb_array_elements_text(crews)')));
const coveragePlan=(await db.query('explain (format json) '+coverage.replace('jsonb_array_elements_text(crews)','jsonb_array_elements_text($1::jsonb)').replaceAll('=target_id','= $2::text'),[perfContext.context.authorizedCrewIds,'loc-a'])).rows;
await db.exec('rollback');
// Rollback must keep new-store data while removing every effective grant.
await db.query("insert into engrase_sync(store,id,payload) values('manual_tasks','__rollback_task',$1),('broadcast_messages','__rollback_message',$2),('broadcast_message_reads','__rollback_read',$3)",[
 {id:'__rollback_task',crewId:perfCrew,status:'PENDING'},
 {id:'__rollback_message',targetType:'ALL_LUBRICATORS'},
 {id:'__rollback_read',messageId:'__rollback_message',userId:perfUser}
]);
await db.exec(await readFile(migrations+'0017_broadcast_messages_scope_ROLLBACK_PREPARED.sql','utf8'));
assert.deepEqual(await policies(),policiesBefore,'rollback restores all policy expressions');
assert.deepEqual((await db.query('select * from app_store_permissions order by store,role')).rows,matrixBefore,'rollback removes only new grants');
assert.deepEqual(await effectiveSnapshot(),before,'rollback preserves existing-store access');
for(const profile of profiles){
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[profile.auth_user_id]);
 await db.exec('set role authenticated');
 assert.equal((await db.query("select count(*)::int n from engrase_sync where store in ('broadcast_messages','broadcast_message_reads','manual_tasks')")).rows[0].n,0,'rollback hides retained data for every role');
 await db.exec('reset role');
}
assert.equal((await db.query("select count(*)::int n from engrase_sync where id like '__rollback_%'")).rows[0].n,3,'rollback preserves new-store rows');
console.log('ROLLBACK PASS');
const report={environment:'Disposable local PGlite/PostgreSQL (not Supabase staging)',postgres:(await db.query('select version() v')).rows[0].v,
 matrixSetupLimitation:'0015 catalog-text guard rejects this local PG deparser. Only its unchanged target matrix statement was loaded; 0015 itself was not validated.',
 existingStoreEquivalence:{OLD_NOT_NEW:oldNotNew.length,NEW_NOT_OLD:newNotOld.length,checked:before.length,stores},notices,
 performance:{locationPlan,completionPlan,coveragePlan,limit:'EXPLAIN only on tiny local fixtures; not production latency evidence'},
 rollback:'PASS',persistedFixtures:0,readyToApply0017:false};
await writeFile('docs/evidence/0017_LOCAL_VALIDATION_2026-10-18.json',JSON.stringify(report,null,2)+'\n');
await db.close();


