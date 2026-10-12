// Local in-memory PostgreSQL/PGlite only. No network or project credentials.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.PGLITE_MODULE_PATH || path.join(process.env.TEMP || '/tmp',
  'control-engrase-sql-preflight/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const migration = 'CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0007_push_tokens_ownership_rls_PREPARED.sql';
const adminId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';

await db.exec(`create role anon; create role authenticated; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.app_profiles(auth_user_id uuid primary key,app_user_id text,role text,active boolean);
 create table public.app_store_permissions(store text,role text,can_read boolean,can_insert boolean,can_update boolean,can_delete boolean);
 create table public.engrase_sync(store text,id text,payload jsonb,updated_at timestamptz default now(),deleted boolean default false,primary key(store,id));
 alter table public.engrase_sync enable row level security;
 create function public.current_app_role() returns text language sql stable security definer set search_path=pg_catalog as $$select role from public.app_profiles where auth_user_id=auth.uid() and active=true$$;
 create function public.current_app_active() returns boolean language sql stable security definer set search_path=pg_catalog as $$select coalesce((select active from public.app_profiles where auth_user_id=auth.uid()),false)$$;
 grant execute on function public.current_app_role(),public.current_app_active(),auth.uid() to authenticated,anon;
 grant select on public.app_profiles,public.app_store_permissions to authenticated;
 grant select,insert,update,delete on public.engrase_sync to authenticated,anon;
 create policy matrix_read on public.engrase_sync for select to authenticated using(current_app_active() and exists(select 1 from public.app_store_permissions p where p.store=store and p.role=current_app_role() and p.can_read));
 create policy matrix_insert on public.engrase_sync for insert to authenticated with check(current_app_active() and exists(select 1 from public.app_store_permissions p where p.store=store and p.role=current_app_role() and p.can_insert));
 create policy matrix_update on public.engrase_sync for update to authenticated using(current_app_active() and exists(select 1 from public.app_store_permissions p where p.store=store and p.role=current_app_role() and (p.can_update or p.can_delete))) with check(current_app_active() and exists(select 1 from public.app_store_permissions p where p.store=store and p.role=current_app_role() and ((deleted and p.can_delete) or (not deleted and p.can_update))));
 create policy matrix_delete on public.engrase_sync for delete to authenticated using(current_app_active() and exists(select 1 from public.app_store_permissions p where p.store=store and p.role=current_app_role() and p.can_delete));`);
await db.exec(await readFile(migration, 'utf8'));
await db.exec(`insert into public.app_profiles values
 ('${adminId}','u_admin','ADMINISTRADOR',true),('${otherId}','u_other','LUBRICADOR',true);
 insert into public.app_store_permissions values
 ('push_tokens','ADMINISTRADOR',true,true,true,true),('push_tokens','LUBRICADOR',true,true,true,false);
 insert into public.engrase_sync(store,id,payload,deleted) values
 ('push_tokens','tok_u_admin_web','{"id":"tok_u_admin_web","userId":"u_admin","token":"SECRET-A","active":true}',false),
 ('push_tokens','tok_u_other_web','{"id":"tok_u_other_web","userId":"u_other","token":"SECRET-B","active":true}',false),
 ('push_tokens','legacy-no-owner','{"id":"legacy-no-owner","token":"SECRET-LEGACY"}',false);`);

let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
async function as(userId, role, fn) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  await db.exec('set role ' + role);
  try { return await fn(); } finally { await db.exec('reset role'); }
}

try {
  await test('user reads only own token; historical ownerless token stays hidden', async () => {
    await as(otherId, 'authenticated', async () => {
      const rows = await db.query("select id from public.engrase_sync where store='push_tokens'");
      assert.deepEqual(rows.rows.map(row => row.id), ['tok_u_other_web']);
    });
  });
  await test('owner can change own preferences and deactivate own token', async () => {
    await as(otherId, 'authenticated', async () => {
      const result = await db.query("update public.engrase_sync set payload=payload||'{\"active\":false,\"notificationShift\":\"DAY\"}' where store='push_tokens' and id='tok_u_other_web' returning id");
      assert.equal(result.rows.length, 1);
    });
  });
  await test('Admin cannot read or modify another user token despite matrix override', async () => {
    await as(adminId, 'authenticated', async () => {
      const rows = await db.query("select id from public.engrase_sync where store='push_tokens'");
      assert.deepEqual(rows.rows.map(row => row.id), ['tok_u_admin_web']);
      const updated = await db.query("update public.engrase_sync set payload=payload||'{\"active\":false}' where store='push_tokens' and id='tok_u_other_web' returning id");
      assert.equal(updated.rows.length, 0);
    });
  });
  await test('owner cannot transfer a row or forge payload id', async () => {
    await as(otherId, 'authenticated', async () => {
      await assert.rejects(db.query("update public.engrase_sync set payload=payload||'{\"userId\":\"u_admin\"}' where store='push_tokens' and id='tok_u_other_web'"), /row-level security/);
      await assert.rejects(db.query("insert into public.engrase_sync(store,id,payload,deleted) values('push_tokens','x','{\"id\":\"x\",\"userId\":\"u_admin\"}',false)"), /row-level security/);
      await assert.rejects(db.query("insert into public.engrase_sync(store,id,payload,deleted) values('push_tokens','x','{\"id\":\"x\"}',false)"), /row-level security/);
    });
  });
  await test('hard delete is denied even for Admin and anon has no access post-cutover', async () => {
    await as(adminId, 'authenticated', async () => {
      const deleted = await db.query("delete from public.engrase_sync where store='push_tokens' and id='tok_u_admin_web' returning id");
      assert.equal(deleted.rows.length, 0);
    });
    await db.exec('set role anon');
    try {
      const rows = await db.query("select id from public.engrase_sync where store='push_tokens'");
      assert.deepEqual(rows.rows, []);
      await assert.rejects(db.query("insert into public.engrase_sync(store,id,payload) values('push_tokens','anon','{}')"));
    } finally { await db.exec('reset role'); }
  });
  await test('inactive profile cannot read or write tokens', async () => {
    await db.exec(`update public.app_profiles set active=false where auth_user_id='${otherId}'`);
    await as(otherId, 'authenticated', async () => {
      const rows = await db.query("select id from public.engrase_sync where store='push_tokens'");
      assert.deepEqual(rows.rows, []);
      const update = await db.query("update public.engrase_sync set payload=payload||'{\"active\":true}' where store='push_tokens' and id='tok_u_other_web' returning id");
      assert.equal(update.rows.length, 0);
    });
  });
  console.log(`PASS ${checks} push token ownership SQL checks (PGlite local only)`);
} finally { await db.close(); }
