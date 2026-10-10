// Disposable PostgreSQL only. Install PGlite outside the project; no remote URLs.
// npm install --prefix <temporary-directory> --ignore-scripts @electric-sql/pglite@0.3.15
// node tools/preflight-crew-locations.mjs <temporary-directory>/node_modules/@electric-sql/pglite/dist/index.js
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const root = new URL('../CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const migration = read('supabase/migrations/0008_crew_locations_PREPARED.sql');
const preflight = readFileSync(new URL('../docs/CREW_LOCATION_PREFLIGHT_READ_ONLY.sql', import.meta.url), 'utf8');
const auth = read('supabase/migrations/0002_auth_profiles_rls_PREPARED.sql');
const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, result: 'PASS' }); }
  catch (e) { results.push({ name, result: 'FAIL', error: e.message }); }
}
async function rejects(db, sql, code) {
  let error;
  try { await db.exec(sql); } catch (e) { error = e; }
  assert.ok(error, 'Expected PostgreSQL rejection');
  if (code) assert.equal(error.code, code);
  return error;
}
async function base(legacy = false) {
  const db = new PGlite();
  await db.exec(`create role authenticated nologin; create role anon nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to authenticated, anon;`);
  await db.exec(read('schema.sql').split('-- ALMACENAMIENTO DE FOTOS')[0]);
  if (!legacy) await db.exec('drop policy "acceso interno con anon key" on engrase_sync');
  // Existing installation already has these functions; bootstrap their actual SQL first.
  await db.exec(auth.match(/create table if not exists app_profiles \([\s\S]*?\n\);/)[0]);
  await db.exec(auth.slice(auth.indexOf('create or replace function current_app_role()'), auth.indexOf('-- 3) app_store_permissions')));
  await db.exec(auth);
  await db.exec('grant select, insert, update, delete on engrase_sync, app_profiles, app_store_permissions to authenticated, anon');
  for (const [i, role] of ['ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR', 'LUBRICADOR', 'VISOR'].entries()) {
    const uid = `00000000-0000-0000-0000-00000000000${i + 1}`;
    await db.query('insert into auth.users values ($1)', [uid]);
    await db.query('insert into app_profiles(auth_user_id, app_user_id, display_name, role) values ($1,$2,$2,$2)', [uid, role]);
  }
  return db;
}
function master(store, id, extra = {}) {
  const payload = JSON.stringify({ id, active: true, ...extra }).replaceAll("'", "''");
  return `insert into engrase_sync(store,id,payload) values('${store}','${id}','${payload}')`;
}
function coverage(id, crew, location, role = 'PRINCIPAL', active = true) {
  return master('crew_locations', id, { crew_id: crew, location_id: location, role, active });
}
async function identity(db, i, fn) {
  await db.exec(`set role ${i ? 'authenticated' : 'anon'}; set request.jwt.claim.sub = '${i ? `00000000-0000-0000-0000-00000000000${i}` : ''}'`);
  try { return await fn(); } finally { await db.exec('reset role; reset request.jwt.claim.sub'); }
}
const db = await base();
console.log((await db.query('select version()')).rows[0]);
await db.exec(`${master('locations', 'volcan')}; ${master('locations', 'mojon')}; ${master('locations', 'acarreo')};
  ${master('cuadrillas', 'crew1', { locationId: 'volcan', isDefault: true, memberUserIds: ['fixture-user'] })};
  ${master('cuadrillas', 'crew2', { locationId: 'mojon', isDefault: true })};
  ${master('cuadrillas', 'crew3')}; ${master('cuadrillas', 'crew4')};
  ${master('equipment', 'equipment1', { locationId: 'mojon' })};
  ${master('lubrication_records', 'history1', { equipmentId: 'equipment1' })}`);
const before = (await db.query("select * from engrase_sync where store <> 'crew_locations' order by store,id")).rows;
await check('Read-only preflight / crews without location', async () => {
  const report = (await db.exec(preflight))[1].rows[0].crew_location_preflight;
  assert.equal(report.active_crews.length, 4);
  assert.deepEqual(report.active_crews_without_location, ['crew3', 'crew4']);
  assert.deepEqual(report.multiple_principals_after_backfill, []);
  assert.deepEqual(report.orphan_legacy_locations, []);
});
await db.exec(migration);
await check('Backfill/additive', async () => {
  assert.deepEqual((await db.query('select crew_id,location_id,role from crew_locations order by crew_id')).rows,
    [{ crew_id: 'crew1', location_id: 'volcan', role: 'PRINCIPAL' }, { crew_id: 'crew2', location_id: 'mojon', role: 'PRINCIPAL' }]);
  assert.deepEqual((await db.query("select * from engrase_sync where store <> 'crew_locations' order by store,id")).rows, before);
});
await check('Idempotence', async () => {
  const before = (await db.query('select * from crew_locations order by id')).rows;
  await db.exec(migration);
  assert.deepEqual((await db.query('select * from crew_locations order by id')).rows, before);
});
await check('A', async () => assert.equal((await db.query("select count(*)::int n from crew_locations where crew_id='crew1' and active")).rows[0].n, 1));
await check('B', () => db.exec(coverage('second', 'crew1', 'acarreo')));
await check('C', () => rejects(db, coverage('duplicate-principal', 'crew3', 'volcan'), '23505'));
await check('D', () => db.exec(coverage('support3', 'crew3', 'volcan', 'APOYO')));
await check('E', () => db.exec(coverage('support4', 'crew4', 'volcan', 'APOYO')));
await check('F', () => rejects(db, coverage('duplicate-pair', 'crew3', 'volcan', 'APOYO'), '23505'));
await check('G', () => rejects(db, coverage('invalid-role', 'crew3', 'mojon', 'INVALID'), '23514'));
await check('H active', () => rejects(db, coverage('missing-crew', 'missing', 'volcan', 'APOYO')));
await check('I active', () => rejects(db, coverage('missing-location', 'crew3', 'missing', 'APOYO')));
await check('H inactive FK', () => rejects(db, coverage('inactive-missing-crew', 'missing', 'volcan', 'APOYO', false), '23503'));
await check('I inactive FK', () => rejects(db, coverage('inactive-missing-location', 'crew3', 'missing', 'APOYO', false), '23503'));
await check('Declared FKs', async () => assert.equal((await db.query("select count(*)::int n from pg_constraint where conrelid='crew_locations'::regclass and contype='f'")).rows[0].n, 2));
await check('J', async () => {
  await db.exec("update engrase_sync set payload=payload||'{\"active\":false}'::jsonb where store='crew_locations' and id='second'");
  await db.exec(coverage('new-principal', 'crew3', 'acarreo'));
});
// Exercise real PostgreSQL RLS as non-owner roles, with auth.uid() claims.
for (const [i, role] of ['ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR', 'LUBRICADOR', 'VISOR'].entries()) {
  await check(`RLS ${role} read`, () => identity(db, i + 1, async () => {
    assert.ok((await db.query('select * from crew_locations')).rows.length);
    assert.ok((await db.query("select * from engrase_sync where store='crew_locations'")).rows.length);
    assert.equal((await db.query('select current_user, rolbypassrls, rolsuper from pg_roles where rolname=current_user')).rows[0].rolbypassrls, false);
  }));
  await check(`RLS ${role} direct write denied`, () => identity(db, i + 1, () => rejects(db, "update crew_locations set active=false", '42501')));
  await check(`RLS ${role} transport write`, () => identity(db, i + 1, async () => {
    const sql = coverage(`rls-${i}`, 'crew4', 'acarreo', 'APOYO');
    if (i < 2) {
      await db.exec(sql);
      assert.equal((await db.query(`update engrase_sync set payload=payload||'{"role":"APOYO"}'::jsonb where store='crew_locations' and id='rls-${i}' returning id`)).rows.length, 1);
      assert.equal((await db.query(`update engrase_sync set deleted=true where store='crew_locations' and id='rls-${i}' returning id`)).rows.length, 1);
      await db.exec('reset role');
      assert.equal((await db.query(`select active from crew_locations where id='rls-${i}'`)).rows[0].active, false);
      // Same crew/location is unique even when inactive: next role reuses the row.
      await db.exec(`delete from crew_locations where id='rls-${i}'; delete from engrase_sync where store='crew_locations' and id='rls-${i}'`);
      await db.exec('set role authenticated');
    } else {
      await rejects(db, sql, '42501');
      assert.equal((await db.query("update engrase_sync set deleted=true where store='crew_locations' returning id")).rows.length, 0);
    }
  }));
}
await db.exec('grant select on crew_locations to anon'); // Default Supabase read grant still cannot bypass RLS.
await check('Anon deny', () => identity(db, 0, async () => {
  assert.equal((await db.query('select * from crew_locations')).rows.length, 0);
  assert.equal((await db.query("select * from engrase_sync where store='crew_locations'")).rows.length, 0);
  await rejects(db, coverage('anon', 'crew4', 'mojon', 'APOYO'), '42501');
}));
await check('Soft crew removal cascades without deleting history', async () => {
  await db.exec("update engrase_sync set deleted=true where store='cuadrillas' and id='crew3'");
  assert.equal((await db.query("select count(*)::int n from crew_locations where crew_id='crew3' and active")).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from engrase_sync where store='lubrication_records'")).rows[0].n, 1);
});
console.log('Constraints', (await db.query("select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='crew_locations'::regclass order by conname")).rows);
console.log('Indexes', (await db.query("select indexdef from pg_indexes where tablename='crew_locations'")).rows);
await db.close();
await check('Legacy conflict abort/rollback', async () => {
  const conflict = await base();
  try {
    await conflict.exec(`${master('locations', 'volcan')}; ${master('cuadrillas', 'a', { locationId: 'volcan' })}; ${master('cuadrillas', 'b', { locationId: 'volcan' })}`);
    const report = (await conflict.exec(preflight))[1].rows[0].crew_location_preflight;
    assert.equal(report.multiple_principals_after_backfill[0].principal_count, 2);
    assert.deepEqual(report.duplicate_legacy_locations[0].crew_ids, ['a', 'b']);
    const error = await rejects(conflict, migration);
    assert.match(error.message, /Preflight: varias cuadrillas/);
    await conflict.exec('rollback');
    assert.equal((await conflict.query("select to_regclass('public.crew_locations') name")).rows[0].name, null);
    assert.equal((await conflict.query("select count(*)::int n from engrase_sync where store='crew_locations'")).rows[0].n, 0);
  } finally { await conflict.close(); }
});
await check('Pre-existing orphan relation abort/rollback', async () => {
  const orphan = await base();
  try {
    await orphan.exec(`${master('locations', 'volcan')}; ${coverage('orphan', 'missing', 'volcan', 'APOYO', false)}`);
    const report = (await orphan.exec(preflight))[1].rows[0].crew_location_preflight;
    assert.equal(report.orphan_relation_references.length, 1);
    await rejects(orphan, migration, '23503');
    await orphan.exec('rollback');
    assert.equal((await orphan.query("select to_regclass('public.crew_locations') name")).rows[0].name, null);
  } finally { await orphan.close(); }
});
await check('Open legacy policy must block migration', async () => {
  const open = await base(true);
  try {
    const error = await rejects(open, migration);
    assert.match(error.message, /policy legacy/);
    await open.exec('rollback');
    assert.equal((await open.query("select to_regclass('public.crew_locations') name")).rows[0].name, null);
  } finally { await open.close(); }
});
console.log(JSON.stringify(results, null, 2));
if (results.some(r => r.result === 'FAIL')) process.exitCode = 1;
