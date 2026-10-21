// Directed local PGlite audit: no network, Supabase or production SQL.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.PGLITE_MODULE_PATH || path.join(process.env.TEMP || '/tmp', 'control-engrase-sql-preflight/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const root = 'CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/';
const bootstrap = await readFile(root + '0012_authorization_scope_bootstrap_PREPARED.sql', 'utf8');
const rollback = await readFile(root + '0012_authorization_scope_bootstrap_ROLLBACK_PREPARED.sql', 'utf8');
const authA = '11111111-1111-4111-8111-111111111111';
const authB = '22222222-2222-4222-8222-222222222222';
const pass = label => console.log('PASS ' + label);
await db.exec(`create role anon; create role authenticated; create role unrelated_api;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.app_profiles(auth_user_id uuid primary key,app_user_id text not null unique,display_name text,role text,active boolean);
 create table public.app_store_permissions(store text,role text,can_read boolean,can_insert boolean default false,can_update boolean default false,can_delete boolean default false,primary key(store,role));
 create table public.engrase_sync(store text,id text,payload jsonb,deleted boolean default false,primary key(store,id));
 alter table public.app_profiles enable row level security;
 alter table public.engrase_sync enable row level security;
 create policy "acceso interno con anon key" on public.engrase_sync for all using(true) with check(true);
 create policy "engrase_sync: leer según matriz" on public.engrase_sync for select to authenticated using(true);
 grant select,insert,update,delete on public.engrase_sync to anon,authenticated;
 insert into public.app_store_permissions(store,role,can_read) values('equipment','LUBRICADOR',false),
 ('settings','PLANIFICADOR',false),('settings','SUPERVISOR',false),('settings','LUBRICADOR',false);`);
await db.query(`insert into public.app_profiles values
 ($1,'uA','A','LUBRICADOR',true),($2,'uB','B','SUPERVISOR',true)`, [authA, authB]);
await db.exec(`insert into public.engrase_sync(store,id,payload) values
 ('locations','locA','{"active":true}'),('locations','locB','{}'),
 ('cuadrillas','crewA','{"memberUserIds":["uA"],"locationId":"locA"}'),
 ('cuadrillas','crewB','{"memberUserIds":["uB"],"locationId":"locB"}');`);
const snapshot = async () => (await db.query(`select
 (select jsonb_agg(to_jsonb(s) order by store,id) from public.engrase_sync s) as data,
 (select jsonb_agg(to_jsonb(p) order by auth_user_id) from public.app_profiles p) as profiles,
 (select jsonb_agg(to_jsonb(p) order by store,role) from public.app_store_permissions p) as matrix,
 (select jsonb_agg(to_jsonb(p) order by policyname) from pg_catalog.pg_policies p where schemaname='public') as policies,
 (select jsonb_agg(jsonb_build_object('name',relname,'owner',relowner,'acl',relacl,'rls',relrowsecurity,'force',relforcerowsecurity) order by relname)
  from pg_catalog.pg_class where oid in ('public.app_profiles'::regclass,'public.engrase_sync'::regclass,'public.app_store_permissions'::regclass)) as tables`)).rows[0];
const before = await snapshot();
async function rejectsSql(sql, pattern) {
  await assert.rejects(db.exec(sql), pattern);
  await db.exec('rollback; reset role;');
}
await db.exec('alter table public.app_profiles force row level security');
await rejectsSql(bootstrap, /FORCE ROW LEVEL SECURITY/);
assert.equal((await db.query("select to_regprocedure('public.get_authorization_context()') as f")).rows[0].f, null);
await db.exec('alter table public.app_profiles no force row level security; alter table public.engrase_sync force row level security');
await rejectsSql(bootstrap, /FORCE ROW LEVEL SECURITY/);
await db.exec('alter table public.engrase_sync no force row level security; set role authenticated');
await rejectsSql(bootstrap, /Installer must own engrase_sync/);
pass('FORCE RLS and wrong installer abort without partial bootstrap');
await db.exec(bootstrap);
assert.deepEqual(await snapshot(), before);
pass('0012 preserves data, profiles, matrix, policies, table grants and RLS');
const functions = (await db.query(`select proname,prosecdef,proconfig,
 pg_catalog.pg_get_userbyid(proowner) as owner from pg_catalog.pg_proc
 where oid in ('public.resolve_authorization_scope(uuid)'::regprocedure,'public.get_authorization_context()'::regprocedure)`)).rows;
assert.equal(functions.length, 2);
for (const f of functions) {
  assert.equal(f.prosecdef, true);
  assert.deepEqual(f.proconfig, ['search_path=pg_catalog']);
  assert.equal(f.owner, 'postgres');
}
for (const role of ['anon', 'authenticated', 'unrelated_api']) {
  const acl = (await db.query(`select has_function_privilege($1,'public.resolve_authorization_scope(uuid)','execute') as resolver,
   has_function_privilege($1,'public.get_authorization_context()','execute') as bootstrap`, [role])).rows[0];
  assert.equal(acl.resolver, false);
  assert.equal(acl.bootstrap, role === 'authenticated');
}
pass('definer owner/search_path and effective API/PUBLIC execution privileges');
async function context(authId) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [authId]);
  await db.exec('set role authenticated');
  try { return (await db.query('select public.get_authorization_context() as c')).rows[0].c; }
  finally { await db.exec('reset role'); }
}
assert.equal((await context('')).code, 'AUTH_REQUIRED');
const a = await context(authA);
const b = await context(authB);
assert.deepEqual(a.context.authorizedCrewIds, ['crewA']);
assert.deepEqual(b.context.authorizedCrewIds, ['crewB']);
assert.equal(a.context.authUserId, authA);
assert.equal(a.context.rowScopeEnforced, false);
await db.exec('set role authenticated');
await rejectsSql(`select public.resolve_authorization_scope('${authB}')`, /permission denied/);
await db.exec('set role anon');
await rejectsSql('select public.get_authorization_context()', /permission denied/);
pass('JWT self identity, no arbitrary-user resolver and no anonymous bootstrap');
await db.exec(`insert into public.engrase_sync(store,id,payload) values
 ('cuadrillas','badCrew','{"memberUserIds":["uA"],"locationId":"missing"}')`);
assert.equal((await context(authA)).code, 'AMBIGUOUS_CREW_SCOPE');
await db.exec("update public.engrase_sync set deleted=true where id='badCrew'");
assert.equal((await context(authA)).context.authorizationFingerprint, a.context.authorizationFingerprint);
await db.exec("update public.engrase_sync set payload='{}' where store='cuadrillas' and id='crewA'");
assert.equal((await context(authA)).code, 'NO_VALID_CREW_MEMBERSHIP');
pass('ambiguous location fails closed; tombstones excluded; malformed membership denied');
const beforeRollback = await snapshot();
await db.exec(rollback);
assert.deepEqual(await snapshot(), beforeRollback);
assert.equal((await db.query("select to_regprocedure('public.get_authorization_context()') as f, to_regprocedure('public.resolve_authorization_scope(uuid)') as r")).rows[0].f, null);
assert.equal((await db.query("select to_regprocedure('public.resolve_authorization_scope(uuid)') as r")).rows[0].r, null);
await db.exec(rollback);
pass('pre-0013 rollback removes only helpers and is repeatable');
await db.exec(bootstrap);
await db.exec(await readFile(root + '0013_authorization_row_scope_PREPARED.sql', 'utf8'));
assert.equal((await context(authB)).context.rowScopeEnforced, true);
await rejectsSql(rollback, /depend/);
assert.equal((await context(authB)).context.rowScopeEnforced, true);
await db.exec(await readFile(root + '0013_authorization_row_scope_ROLLBACK_PREPARED.sql', 'utf8'));
assert.equal((await context(authB)).context.rowScopeEnforced, false);
const after0013Rollback = await snapshot();
await rejectsSql(rollback, /depend/);
assert.deepEqual(await snapshot(), after0013Rollback);
assert.equal((await context(authB)).context.rowScopeEnforced, false);
pass('0013 compatible; 0012 rollback fails atomically after 0013 and its safe-stop rollback');
await db.exec('set role anon');
assert.equal((await db.query('select count(*)::int as n from public.engrase_sync')).rows[0].n, 5);
await db.exec('reset role');
pass('legacy anonymous table exposure persists even after 0013');
await db.close();
