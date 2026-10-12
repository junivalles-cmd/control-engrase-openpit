// Local in-memory PostgreSQL/PGlite tests only. Never connects to Supabase.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath=process.env.PGLITE_MODULE_PATH||path.join(process.env.TEMP||'/tmp','control-engrase-sql-preflight/node_modules/@electric-sql/pglite/dist/index.js');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const db=new PGlite();
const migration='CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0012_authorization_scope_bootstrap_PREPARED.sql';
const authId='11111111-1111-4111-8111-111111111111';
await db.exec(`create role anon; create role authenticated; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.app_profiles(auth_user_id uuid primary key,app_user_id text,display_name text,role text,active boolean);
 create table public.engrase_sync(store text,id text,payload jsonb,updated_at timestamptz default now(),deleted boolean default false,primary key(store,id));`);
await db.exec(await readFile(migration,'utf8'));
const pass=label=>console.log('PASS '+label);
const profile=async(role='LUBRICADOR',active=true,appUserId='u1')=>db.query('insert into public.app_profiles values($1,$2,$3,$4,$5) on conflict(auth_user_id) do update set app_user_id=$2,display_name=$3,role=$4,active=$5',[authId,appUserId,'Fixture',role,active]);
const row=async(store,id,payload,deleted=false)=>db.query('insert into public.engrase_sync(store,id,payload,deleted) values($1,$2,$3::jsonb,$4) on conflict(store,id) do update set payload=$3::jsonb,deleted=$4',[store,id,JSON.stringify({id,active:true,...payload}),deleted]);
const context=async(role='authenticated')=>{
 await db.exec('reset role');
 await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',authId]);
 await db.exec('set role '+role);
 try { return (await db.query('select public.get_authorization_context() as value')).rows[0].value; }
 finally { await db.exec('reset role'); }
};
const authProfile=async(role='LUBRICADOR',active=true)=>{await db.exec('delete from public.app_profiles; delete from public.engrase_sync');await profile(role,active);};

await authProfile();
const noMembership=await context();
assert.equal(noMembership.status,'DENIED');assert.equal(noMembership.code,'NO_VALID_CREW_MEMBERSHIP');pass('crew-scoped user without membership is denied');
await row('locations','loc1',{name:'Location'});await row('cuadrillas','crew1',{locationId:'loc1',memberUserIds:['u1']});
const crew=await context();assert.equal(crew.context.scopeType,'CREW_SCOPED');assert.deepEqual(crew.context.authorizedCrewIds,['crew1']);assert.deepEqual(crew.context.authorizedLocationIds,['loc1']);pass('valid membership resolves only legacy crew/location ids');
await authProfile('ADMINISTRADOR');
const admin=await context();assert.equal(admin.context.scopeType,'GLOBAL');pass('ADMINISTRADOR resolves GLOBAL');
await authProfile('PLANIFICADOR');
assert.equal((await context()).context.scopeType,'GLOBAL');pass('PLANIFICADOR resolves GLOBAL');
await authProfile('VISOR');assert.equal((await context()).status,'DENIED');pass('invalid operational role is denied');
await db.exec("update public.app_profiles set role=null");assert.equal((await context()).code,'ROLE_DENIED');pass('null role is denied');
await authProfile('SUPERVISOR');assert.equal((await context()).status,'DENIED');pass('profile with no membership is denied');
await authProfile('SUPERVISOR');await row('locations','loc1',{name:'Location'});await row('cuadrillas','crew1',{locationId:'loc1',memberUserIds:['u1']});
assert.equal((await context()).context.scopeType,'CREW_SCOPED');pass('SUPERVISOR with valid membership resolves CREW_SCOPED');
await authProfile('LUBRICADOR');await row('locations','loc1',{name:'Location'});await row('cuadrillas','crew1',{locationId:'loc1',memberUserIds:['u1']});
assert.equal((await context()).context.scopeType,'CREW_SCOPED');pass('LUBRICADOR with valid membership resolves CREW_SCOPED');
await authProfile('LUBRICADOR',false);assert.equal((await context()).code,'INACTIVE_PROFILE');pass('inactive profile is denied');
await db.exec('delete from public.app_profiles');assert.equal((await context()).code,'PROFILE_NOT_FOUND');pass('missing profile is denied');
await authProfile('LUBRICADOR');await row('locations','loc1',{name:'Location'});await row('cuadrillas','crew1',{locationId:'loc1',memberUserIds:['u1']});
const stable1=(await context()).context.authorizationFingerprint;const stable2=(await context()).context.authorizationFingerprint;
assert.equal(stable1,stable2);pass('unchanged context has a stable fingerprint');
await row('cuadrillas','crew2',{locationId:'loc1',memberUserIds:['u1']});const crewChanged=(await context()).context.authorizationFingerprint;
assert.notEqual(crewChanged,stable1);pass('membership/crew change changes fingerprint');
const twoCrewFingerprint=crewChanged;
await db.exec("delete from public.engrase_sync where store='cuadrillas'");
await row('cuadrillas','crew2',{locationId:'loc1',memberUserIds:['u1']});await row('cuadrillas','crew1',{locationId:'loc1',memberUserIds:['u1']});
assert.equal((await context()).context.authorizationFingerprint,twoCrewFingerprint);pass('crew insertion order does not change fingerprint');
await row('cuadrillas','crew2',{locationId:'loc2',memberUserIds:['u1']});await row('locations','loc2',{name:'Second'});
const locationChanged=(await context()).context.authorizationFingerprint;assert.notEqual(locationChanged,crewChanged);pass('crew legacy location change changes fingerprint');
await db.exec("update public.app_profiles set role='SUPERVISOR'");const roleChanged=(await context()).context.authorizationFingerprint;
assert.notEqual(roleChanged,locationChanged);pass('role change changes fingerprint');
await db.exec('reset role');await db.exec("select set_config('request.jwt.claim.sub','',false)");
let anonDenied=false;await db.exec('set role anon');try{await db.query('select public.get_authorization_context()')}catch(error){anonDenied=/permission denied/i.test(error.message)}finally{await db.exec('reset role')}
assert.equal(anonDenied,true);pass('anon cannot execute bootstrap RPC');
await db.close();
console.log('PASS 15 authorization scope bootstrap checks (local PGlite only)');
