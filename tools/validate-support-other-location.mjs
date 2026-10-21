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

// Synthetic copies of the two reported relations; no production connection/data.
const ids={lub:'66666666-6666-4666-8666-666666666666',other:'22222222-2222-4222-8222-222222222222',
 admin:'44444444-4444-4444-8444-444444444444',planner:'55555555-5555-4555-8555-555555555555',supervisor:authA};
await db.query(`insert into app_profiles values ($1,'lub','Lub','LUBRICADOR',true),($2,'other','Other','LUBRICADOR',true),
 ($3,'admin','Admin','ADMINISTRADOR',true),($4,'planner','Planner','PLANIFICADOR',true),($5,'sup','Supervisor','SUPERVISOR',true)`,Object.values(ids));
const onlyA='77777777-7777-4777-8777-777777777777',onlyC='88888888-8888-4888-8888-888888888888';
await db.query("insert into app_profiles values($1,'only-a','Only A','LUBRICADOR',true),($2,'only-c','Only C','LUBRICADOR',true)",[onlyA,onlyC]);
const version='2026-01-01T00:00:00Z';
const put=(store,id,payload)=>db.query('insert into engrase_sync(store,id,payload,updated_at) values($1,$2,$3,$4)',[store,id,{id,active:true,...payload},version]);
for(const id of ['Volcan','Acarreo','Mojon'])await put('locations',id,{name:id});
await put('cuadrillas','cuad_a',{locationId:'Volcan',memberUserIds:['lub','sup','only-a'],isDefault:true});
await put('cuadrillas','cuad_c',{locationId:'Acarreo',memberUserIds:['lub','sup','only-c'],isDefault:true});
await put('cuadrillas','other',{locationId:'Mojon',memberUserIds:['other'],isDefault:true});
await put('settings','general',{shiftDayStart:6,shiftNightStart:18});
const fixtures=[['asg_muoqddz6p24k34','05-0870','plan_mskx6bbstrbbsz','cuad_a','2026-09-30'],['asg_mv2rgm9nomrcsa','20-5530','plan_mskx6baww0rm5t','cuad_c','2026-10-10']];
for(const [a,e,p,c,d] of fixtures){
 await put('equipment',e,{locationId:'Mojon',hourmeter:100,status:'Operativo'});
 await put('lubrication_plans',p,{equipmentId:e,controlType:'Día y turno de la semana',assignedDays:['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'],requiredShifts:['shift_dia','shift_noche'],effectiveDate:'2026-10-12'});
 await put('lubrication_points','point:'+p,{planId:p,point:'Rodamiento'});
 await put('lubrication_assignments',a,{equipmentId:e,planId:p,assignedCrewId:c,occurrenceKey:p+':'+d,status:'PENDING',executionType:null,assignmentType:null,reason:null,operationalDate:null,shift:null});
}
await put('equipment','unrelated',{locationId:'Mojon'});
await put('lubrication_plans','unrelated-plan',{equipmentId:'unrelated'});
await put('lubrication_records','forged-legacy',{equipmentId:'unrelated',operationalSnapshot:{crewId:'cuad_a',assignmentId:fixtures[0][0],executionType:'ASSIGNED'}});
await put('anomalies','foreign-anomaly',{equipmentId:fixtures[0][1],crewId:'other',autoPointId:'point:'+fixtures[0][2],status:'Abierta',repeticiones:9});
const before=(await db.query("select id,payload,updated_at from engrase_sync where store='lubrication_assignments' order by id")).rows;
await db.exec(await readFile(migrations+'0014_assignment_skip_gateways_PREPARED.sql','utf8'));
assert.deepEqual((await db.query("select id,payload,updated_at from engrase_sync where store='lubrication_assignments' order by id")).rows,before,'installation leaves legacy rows byte-identical');
async function as(auth,sql,args=[]){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[auth]);await db.exec('set role authenticated');try{return (await db.query(sql,args)).rows;}finally{await db.exec('reset role');}}
const visible=async(auth,store)=>(await as(auth,'select id from engrase_sync where store=$1 order by id',[store])).map(r=>r.id);
// 0014 replaces only the row SELECT policy, adding a settings OR. The
// INDEPENDENT restrictive store gate must still enforce the real read matrix.
await db.exec("update public.app_store_permissions set can_read=false where store='settings' and role='LUBRICADOR'");
assert.deepEqual(await visible(ids.lub,'settings'),[],'settings OR cannot bypass the independent restrictive matrix');
await db.exec("update public.app_store_permissions set can_read=true where store='settings' and role='LUBRICADOR'");
assert.deepEqual(await visible(ids.lub,'settings'),['general']);
// The isolated 0013 safe-stop must refuse once 0014 is installed.
await assert.rejects(db.exec(await readFile(migrations+'0013_authorization_row_scope_ROLLBACK_PREPARED.sql','utf8')),/Later rollout detected/);
await db.exec('rollback');
assert.deepEqual(await visible(ids.lub,'equipment'),['05-0870','20-5530']);
assert.deepEqual(await visible(onlyA,'equipment'),['05-0870']);
assert.deepEqual(await visible(onlyC,'equipment'),['20-5530']);
assert.equal((await visible(ids.lub,'lubrication_plans')).includes('unrelated-plan'),false);
assert.equal((await visible(ids.other,'lubrication_assignments')).length,0);
assert.equal((await visible(ids.lub,'lubrication_points')).length,2);
const bootstrap=(await as(ids.lub,'select get_authorization_context() c'))[0].c;
assert.deepEqual(bootstrap.context.authorizedLocationIds,['Acarreo','Volcan']);
const manifest=(await as(ids.lub,'select get_assignment_support_context() c'))[0].c;
assert.equal(manifest.operational.length,2);
assert.equal(manifest.rows.some(r=>r.id==='unrelated'),false);
assert.equal((await visible(ids.lub,'lubrication_records')).includes('forged-legacy'),false,'unproven snapshot cannot mint history');
const reported=(await as(ids.lub,"select report_assignment_anomaly('report','reported',$1,'cuad_a','Rodamiento','Ruido','Media','[]',$2) r",[fixtures[0][1],fixtures[0][0]]))[0].r;
assert.equal(reported.status,'APPLIED',JSON.stringify(reported));
assert.equal((await as(ids.other,"select report_assignment_anomaly('report-other','report-other',$1,'other','Rodamiento','Ruido','Media','[]',$2) r",[fixtures[0][1],fixtures[0][0]]))[0].r.status,'DENIED');
const now=(await db.query("select clock_timestamp() at time zone 'America/Managua' as t,clock_timestamp() as d,case when extract(hour from clock_timestamp() at time zone 'America/Managua')>=6 and extract(hour from clock_timestamp() at time zone 'America/Managua')<18 then 'shift_dia' else 'shift_noche' end s")).rows[0];
async function execAssignment(f,index,done){
 const [a,e,p,c]=f;
 const vals=(await db.query('select store,updated_at from engrase_sync where (store=$1 and id=$2) or (store=$3 and id=$4) or (store=$5 and id=$6)',['equipment',e,'lubrication_plans',p,'lubrication_assignments',a])).rows;
 const v=s=>vals.find(r=>r.store===s).updated_at;
 const args=['op'+index,'CREATE','record'+index,e,p,c,a,now.d,now.d,now.s,'ASSIGNED',null,'lub',false,101,false,null,null,done?2:0,'Normal','',JSON.stringify([{pointId:'point:'+p,done,reason:done?null:'Falla mecánica'}]),'[]',null,v('equipment'),v('lubrication_plans'),v('lubrication_assignments')];
 const sql='select lubrication_execution('+args.map((_,i)=>'$'+(i+1)).join(',')+') r';
 const result=(await as(ids.lub,sql,args))[0].r;
 assert.equal(result.status,'APPLIED',JSON.stringify(result));
 assert.deepEqual((await as(ids.lub,sql,args))[0].r,result,'lost-response replay remains idempotent');
 return result;
}
const partial=await execAssignment(fixtures[0],1,false);
assert.equal(partial.rows.find(r=>r.store==='lubrication_assignments').payload.status,'PENDING');
assert.equal((await as(ids.lub,'select get_assignment_support_context() c'))[0].c.operational.length,2);
// Hallazgo 1: PARTIAL late execution of a 2026-09-30 legacy occurrence (today
// is far ahead) never claims COMPLETED and never satisfies DAY/NIGHT today.
const partialRecord=partial.rows.find(r=>r.store==='lubrication_records').payload;
assert.equal(partialRecord.operationalSnapshot.executionCompleteness,'PARTIAL');
assert.equal(partialRecord.operationalSnapshot.assignedOccurrenceKey,fixtures[0][2]+':2026-09-30','original legacy occurrence identity is preserved, never shifted to today');
assert.equal(partialRecord.operationalSnapshot.satisfiedOccurrenceKey,null,'PARTIAL never satisfies the obligation it attended');
const partialAudit=(await db.query("select payload from engrase_sync where store='audit_log' and id like 'execution-effect:%:op1'")).rows[0].payload;
assert.equal(partialAudit.action,'GREASE_ASSIGNMENT_PARTIAL','PARTIAL audit action must never claim COMPLETED');
const partialDetail=JSON.parse(partialAudit.detail);
assert.equal(partialDetail.assignmentId,fixtures[0][0]);
assert.equal(partialDetail.recordId,'record1');
assert.equal(partialDetail.completeness,'PARTIAL');
assert.equal(partialDetail.satisfiedOccurrenceKey,null);
const automatic=(await as(ids.lub,"select repeat_anomaly_from_execution('auto:record1','record1','cuad_a',(select updated_at from engrase_sync where store='lubrication_records' and id='record1')) r"))[0].r;
assert.equal(automatic.status,'APPLIED',JSON.stringify(automatic));
assert.equal((await db.query("select payload->>'repeticiones' as n from engrase_sync where id='foreign-anomaly'")).rows[0].n,'9','automatic anomaly cannot touch another operation');
assert.equal(automatic.rows.some(r=>r.id==='foreign-anomaly'),false);
const completed=await execAssignment(fixtures[0],2,true);
const record=completed.rows.find(r=>r.store==='lubrication_records').payload;
assert.equal(record.operationalSnapshot.occurrenceKey,fixtures[0][2]+':2026-09-30');
assert.equal(record.operationalSnapshot.satisfiedOccurrenceKey,record.operationalSnapshot.occurrenceKey);
assert.equal(record.operationalSnapshot.equipmentLocationIdAtExecution,'Mojon');
assert.equal(record.operationalSnapshot.crewLocationIdAtExecution,'Volcan');
assert.equal(completed.rows.find(r=>r.store==='lubrication_assignments').payload.status,'COMPLETED');
// Hallazgo 1: the late COMPLETE that follows the PARTIAL above closes the
// SAME 2026-09-30 occurrence (never today's DAY/NIGHT) and the audit now
// correctly says COMPLETED.
const completedAudit=(await db.query("select payload from engrase_sync where store='audit_log' and id like 'execution-effect:%:op2'")).rows[0].payload;
assert.equal(completedAudit.action,'GREASE_ASSIGNMENT_COMPLETED');
const completedDetail=JSON.parse(completedAudit.detail);
assert.equal(completedDetail.assignmentId,fixtures[0][0]);
assert.equal(completedDetail.recordId,'record2');
assert.equal(completedDetail.completeness,'COMPLETE');
assert.equal(completedDetail.satisfiedOccurrenceKey,fixtures[0][2]+':2026-09-30');
assert.equal((await as(ids.lub,'select get_assignment_support_context() c'))[0].c.operational.length,1);
assert.equal((await visible(ids.lub,'lubrication_records')).length,2,'accepted history survives COMPLETE');
const closed=(await as(ids.lub,"select close_anomaly('close','reported','cuad_a',$1,'Resuelto') r",[reported.rows[0].updated_at]))[0].r;
assert.equal(closed.status,'APPLIED',JSON.stringify(closed));
const reportReplay=(await as(ids.lub,"select report_assignment_anomaly('report','reported',$1,'cuad_a','Rodamiento','Ruido','Media','[]',$2) r",[fixtures[0][1],fixtures[0][0]]))[0].r;
assert.equal(reportReplay.status,'APPLIED','support evidence receipt survives COMPLETE');
await db.query("insert into storage.objects values('engrase-photos','grease_validations/signature.png',$1)",[ids.lub]);
const cap=(await as(ids.lub,"select capture_grease_validation('cap','signature','record2','cuad_a',(select updated_at from engrase_sync where store='lubrication_records' and id='record2'),'Operator','OPERADOR',null,'https://fixture.test/grease_validations/signature.png') r"))[0].r;
assert.equal(cap.status,'APPLIED',JSON.stringify(cap));
assert.deepEqual(await visible(ids.lub,'grease_validations'),['signature']);
// SKIP refers to legacy obligation but captures the real clock/shift.
const f=fixtures[1];
const skip=(await as(ids.lub,'select record_lubrication_skip($1,$2,null,$3,$4,$5,$6,$7,$8,$9,null,null) r',['skipop','skip',f[1],f[2],f[2]+':'+f[4],f[3],now.d,now.s,'SIN_TIEMPO']))[0].r;
assert.equal(skip.status,'APPLIED',JSON.stringify(skip));
await execAssignment(f,3,true);
assert.equal((await as(ids.lub,'select get_assignment_support_context() c'))[0].c.operational.length,0);
// Generic snapshots cannot mint accepted provenance, even while a support grant exists.
await assert.rejects(as(ids.lub,"insert into engrase_sync(store,id,payload) values('lubrication_records','fake','{\"equipmentId\":\"unrelated\",\"operationalSnapshot\":{\"crewId\":\"cuad_a\"}}')"));
assert.equal((await as(ids.lub,"select get_assignment_support_context() c"))[0].c.rows.some(r=>r.id==='fake'),false);
await assert.rejects(as(ids.lub,"select authorization_private.link_support_entity('equipment','unrelated','asg_muoqddz6p24k34',null)"));
const today=(await db.query("select (clock_timestamp() at time zone 'America/Managua')::date::text d")).rows[0].d;
await put('equipment','new-support',{locationId:'Mojon',hourmeter:0});
await put('lubrication_plans','new-plan',{equipmentId:'new-support',controlType:'Día y turno de la semana',assignedDays:['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']});
const createSql="select manage_lubrication_assignment($1,'CREATE',$2,null,'new-support','new-plan',$3,'cuad_a','') r";
assert.equal((await as(ids.supervisor,createSql,['sup-create','sup-created','new-plan:'+today]))[0].r.status,'DENIED');
const created=(await as(ids.planner,createSql,['plan-create','new-created','new-plan:'+today]))[0].r;
assert.equal(created.status,'APPLIED',JSON.stringify(created));
assert.equal(created.rows[0].payload.assignmentType,'SUPPORT_OTHER_LOCATION');
const reassign=(await as(ids.supervisor,"select manage_lubrication_assignment('reassign','REASSIGN','new-created',$1,'new-support','new-plan',$2,'cuad_c','') r",[created.rows[0].updated_at,'new-plan:'+today]))[0].r;
assert.equal(reassign.status,'APPLIED',JSON.stringify(reassign));
const cancel=(await as(ids.supervisor,"select manage_lubrication_assignment('cancel','CANCEL','new-created',$1,'new-support','new-plan',$2,null,'') r",[reassign.rows[0].updated_at,'new-plan:'+today]))[0].r;
assert.equal(cancel.status,'APPLIED',JSON.stringify(cancel));
assert.equal((await visible(ids.lub,'equipment')).includes('new-support'),false);
assert.equal((await as(ids.supervisor,"select manage_lubrication_assignment('late-race','REASSIGN','new-created',$1,'new-support','new-plan',$2,'cuad_a','') r",[reassign.rows[0].updated_at,'new-plan:'+today]))[0].r.status,'CONFLICT');
assert.equal((await visible(ids.admin,'equipment')).includes('unrelated'),true);
assert.equal((await visible(ids.planner,'equipment')).includes('unrelated'),true);
await db.exec(await readFile(migrations+'0014_assignment_skip_gateways_ROLLBACK_PREPARED.sql','utf8'));
assert.equal((await db.query("select enabled from authorization_private.support_control")).rows[0].enabled,false);
assert.equal((await db.query("select has_function_privilege('authenticated','public.get_assignment_support_context()','EXECUTE') as allowed")).rows[0].allowed,false);
assert.equal((await db.query("select count(*)::int n from pg_policies where tablename='engrase_sync' and policyname like 'authorization_%' and permissive='RESTRICTIVE'")).rows[0].n,8);
assert.equal((await visible(ids.lub,'lubrication_records')).includes('record2'),true,'safe-stop preserves accepted history');
console.log('PASS SUPPORT_OTHER_LOCATION: real-shaped legacy fixtures, exact RLS dependencies, PARTIAL continuation, late COMPLETE, history/signature, SKIP, GLOBAL creation, Supervisor management, generic denial, replay and transition CAS.');
await db.close();

