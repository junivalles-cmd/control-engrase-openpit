// Local, in-memory PostgreSQL/PGlite only. No project secrets and no network.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.PGLITE_MODULE_PATH || path.join(process.env.TEMP || '/tmp',
  'control-engrase-sql-preflight/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const root = 'CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/';
const authId = '11111111-1111-4111-8111-111111111111';
const version = '2026-01-01T00:00:00.000Z';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Managua' }).format(new Date());
const addDays = (date, days) => { const value = new Date(date + 'T00:00:00Z'); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const validReprogramDate = addDays(today, 2);
const invalidReprogramDate = addDays(today, 8);

await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to anon,authenticated;
 create table public.app_profiles(auth_user_id uuid primary key,app_user_id text,display_name text,role text,active boolean);
 create table public.app_store_permissions(store text,role text,can_read boolean,can_insert boolean,can_update boolean,can_delete boolean);
 grant select on public.app_profiles,public.app_store_permissions to authenticated;
 create table public.engrase_sync(store text,id text,payload jsonb,updated_at timestamptz,deleted boolean default false,primary key(store,id));
 alter table public.engrase_sync enable row level security;
 create policy legacy_all on public.engrase_sync for all to public using(true) with check(true);
 grant select,insert,update,delete on public.engrase_sync to anon,authenticated;
 create table storage.objects(id text primary key,bucket_id text,name text,owner_id text);
 alter table storage.objects enable row level security;
 create policy legacy_storage on storage.objects for all to public using(true) with check(true);
 grant select,insert,update,delete on storage.objects to anon,authenticated;`);
await db.exec(await readFile(root + '0009_lubrication_execution_gateway_PREPARED.sql', 'utf8'));
await db.exec(await readFile(root + '0010_evidence_gateway_PREPARED.sql', 'utf8'));
await db.exec(await readFile(root + '0011_operational_catalog_gateway_PREPARED.sql', 'utf8'));
// Model post-0003 authenticated matrix policies; 0011 must not rely on the
// legacy public ALL/true policy used only to compile the earlier gateways.
await db.exec(`drop policy legacy_all on public.engrase_sync;
 create policy matrix_read on public.engrase_sync for select to authenticated using(exists(
   select 1 from public.app_profiles a join public.app_store_permissions p on p.role=a.role
   where a.auth_user_id=auth.uid() and a.active and p.store=engrase_sync.store and p.can_read));
 create policy matrix_insert on public.engrase_sync for insert to authenticated with check(exists(
   select 1 from public.app_profiles a join public.app_store_permissions p on p.role=a.role
   where a.auth_user_id=auth.uid() and a.active and p.store=engrase_sync.store and p.can_insert));
 create policy matrix_update on public.engrase_sync for update to authenticated using(exists(
   select 1 from public.app_profiles a join public.app_store_permissions p on p.role=a.role
   where a.auth_user_id=auth.uid() and a.active and p.store=engrase_sync.store and p.can_update)) with check(exists(
   select 1 from public.app_profiles a join public.app_store_permissions p on p.role=a.role
   where a.auth_user_id=auth.uid() and a.active and p.store=engrase_sync.store and p.can_update));
 create policy matrix_delete on public.engrase_sync for delete to authenticated using(exists(
   select 1 from public.app_profiles a join public.app_store_permissions p on p.role=a.role
   where a.auth_user_id=auth.uid() and a.active and p.store=engrase_sync.store and p.can_delete));`);

async function put(store, id, payload, updatedAt = version) {
  await db.query('insert into public.engrase_sync values($1,$2,$3::jsonb,$4,false)',
    [store, id, JSON.stringify({ id, active: true, ...payload }), updatedAt]);
}
async function reset(role = 'PLANIFICADOR', { active = true, equipmentLocation = 'loc1' } = {}) {
  await db.exec('reset role; delete from public.engrase_sync; delete from public.app_profiles; delete from public.app_store_permissions; delete from public.operational_catalog_receipts; delete from public.evidence_operation_receipts; delete from public.lubrication_execution_receipts;');
  await db.query('insert into public.app_profiles values($1,$2,$3,$4,$5)', [authId, 'u1', 'Test Operator', role, active]);
  for (const store of ['equipment', 'lubrication_plans', 'lubrication_points', 'settings']) {
    const canWrite = role === 'ADMINISTRADOR' || (role === 'PLANIFICADOR' && ['lubrication_plans','lubrication_points'].includes(store));
    const canRead = store !== 'settings' || role === 'ADMINISTRADOR';
    await db.query('insert into public.app_store_permissions values($1,$2,$3,$4,$4,false)', [store, role, canRead, canWrite]);
  }
  await put('locations', 'loc1', { name: 'Volcan' });
  await put('locations', 'loc2', { name: 'Mojon' });
  await put('equipment', 'e1', { code: 'E1', model: 'M1', locationId: equipmentLocation, shiftId: 'shift_dia', hourmeter: 100 });
  await put('lubrication_plans', 'p1', { equipmentId: 'e1', controlType: 'Día y turno de la semana', frequency: 50, assignedDays: ['Lunes'], shiftId: 'shift_dia' });
  await put('lubrication_points', 'pt1', { planId: 'p1', point: 'A' });
  await put('settings', 'help_content', { faq: [] });
  await put('cuadrillas', 'c1', { locationId: 'loc1', memberUserIds: ['u1'], active: true });
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [authId]);
}
async function call(name, params, role = 'authenticated') {
  await db.exec('set role ' + role);
  try {
    const names = name === 'operational_catalog_operation'
      ? ['p_operation_id','p_action','p_id','p_crew_id','p_expected','p_location_id','p_shift_id','p_until','p_reason','p_hourmeter','p_confirm_large_jump']
      : name === 'move_equipment_master_location' ? ['p_operation_id','p_id','p_expected','p_location_id']
        : name === 'set_equipment_shift' ? ['p_operation_id','p_id','p_expected','p_shift_id']
          : name === 'set_equipment_alert_pause' ? ['p_operation_id','p_id','p_crew_id','p_expected','p_until','p_reason']
            : name === 'update_equipment_hourmeter' ? ['p_operation_id','p_id','p_expected','p_hourmeter','p_confirm_large_jump']
              : ['p_operation_id','p_id','p_crew_id','p_expected','p_until','p_reason'];
    return (await db.query(`select public.${name}(${names.map((key, i) => key + ' => $' + (i + 1)).join(',')}) as result`,
      names.map(key => params[key] ?? null))).rows[0].result;
  } finally { await db.exec('reset role'); }
}
function args(overrides = {}) {
  return { p_operation_id: 'op-1', p_action: 'MOVE', p_id: 'e1', p_expected: version, p_location_id: null, p_shift_id: null,
    p_crew_id: null, p_until: null, p_reason: null, p_hourmeter: null, p_confirm_large_jump: false, ...overrides };
}
async function snapshot() { return (await db.query('select store,id,payload,updated_at from public.engrase_sync order by store,id')).rows; }
let passed = 0;
async function test(name, fn) { await reset(); await fn(); passed++; console.log('PASS ' + name); }
async function deniedUnchanged(fn, code) {
  const before = await snapshot(); assert.equal((await fn()).code, code); assert.deepEqual(await snapshot(), before);
}

try {
  await test('anonymous and private dispatcher cannot invoke catalog writes', async () => {
    const p = args({ p_location_id: 'loc2' });
    await assert.rejects(call('move_equipment_master_location', p, 'anon'), /permission denied/);
    await assert.rejects(call('operational_catalog_operation', { ...p, p_action: 'MOVE', p_shift_id: null }, 'authenticated'), /permission denied/);
    assert.equal((await db.query("select has_function_privilege('authenticated','public.operational_catalog_operation(text,text,text,text,timestamptz,text,text,date,text,numeric,boolean)','execute') allowed")).rows[0].allowed, false);
  });
  await test('null and inactive profiles denied without mutation', async () => {
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await deniedUnchanged(() => call('move_equipment_master_location', args({ p_location_id: 'loc2' })), 'AUTH_REQUIRED');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [authId]);
    await db.exec('update public.app_profiles set active=false');
    await deniedUnchanged(() => call('move_equipment_master_location', args({ p_location_id: 'loc2' })), 'INACTIVE_PROFILE');
  });
  await test('Admin and Planner may move master location; server audit is authoritative', async () => {
    for (const role of ['ADMINISTRADOR', 'PLANIFICADOR']) {
      await reset(role);
      const result = await call('move_equipment_master_location', args({ p_location_id: 'loc2' }));
      assert.equal(result.status, 'APPLIED');
      assert.equal(result.rows[0].payload.locationId, 'loc2');
      const audit = await db.query("select payload from public.engrase_sync where store='audit_log'");
      assert.equal(audit.rows.length, 1);
      assert.equal(audit.rows[0].payload.actorAuthUserId, authId);
      assert.equal(audit.rows[0].payload.action, 'CATALOG_MOVE');
    }
  });
  await test('Supervisor and Lubricador cannot move equipment or mutate code/model', async () => {
    for (const role of ['SUPERVISOR', 'LUBRICADOR']) {
      await reset(role);
      await deniedUnchanged(() => call('move_equipment_master_location', args({ p_location_id: 'loc2', p_crew_id: 'c1' })), 'ROLE_DENIED');
    }
    const names = (await db.query("select pg_get_function_arguments(p.oid) args from pg_proc p where p.proname='move_equipment_master_location' and p.pronamespace='public'::regnamespace")).rows;
    assert.equal(names.length, 1);
    assert.doesNotMatch(names[0].args, /code|model|payload/i);
  });
  await test('missing locations and stale CAS fail without writes', async () => {
    await deniedUnchanged(() => call('move_equipment_master_location', args({ p_location_id: 'missing' })), 'LOCATION_NOT_FOUND');
    await deniedUnchanged(() => call('move_equipment_master_location', args({ p_expected: '2025-01-01T00:00:00Z', p_location_id: 'loc2' })), 'VERSION_CONFLICT');
  });
  await test('Supervisor may pause only equipment in legacy crew scope', async () => {
    await reset('SUPERVISOR');
    const result = await call('set_equipment_alert_pause', args({ p_crew_id: 'c1', p_until: validReprogramDate, p_reason: 'Taller' }));
    assert.equal(result.status, 'APPLIED');
    assert.ok(result.rows[0].payload.avisosPausadosHasta);
    assert.equal(result.rows[0].payload.avisosPausaMotivo, 'Taller');
    await reset('SUPERVISOR', { equipmentLocation: 'loc2' });
    await deniedUnchanged(() => call('set_equipment_alert_pause', args({ p_crew_id: 'c1', p_until: validReprogramDate, p_reason: 'Taller' })), 'SCOPE_DENIED');
  });
  await test('Supervisor cannot shift or independently change hourmeter', async () => {
    await reset('SUPERVISOR');
    await deniedUnchanged(() => call('set_equipment_shift', args({ p_shift_id: 'shift_noche' })), 'ROLE_DENIED');
    await deniedUnchanged(() => call('update_equipment_hourmeter', args({ p_hourmeter: 120 })), 'ROLE_DENIED');
  });
  await test('Admin and Planner may change shift; hourmeter rejects regression and requires jump confirmation', async () => {
    for (const role of ['ADMINISTRADOR', 'PLANIFICADOR']) {
      await reset(role);
      assert.equal((await call('set_equipment_shift', args({ p_shift_id: 'shift_noche' }))).status, 'APPLIED');
      await reset(role);
      await deniedUnchanged(() => call('update_equipment_hourmeter', args({ p_hourmeter: 99 })), 'INVALID_HOURMETER');
      await deniedUnchanged(() => call('update_equipment_hourmeter', args({ p_hourmeter: 701 })), 'HOURMETER_CONFIRMATION_REQUIRED');
      assert.equal((await call('update_equipment_hourmeter', args({ p_hourmeter: 701, p_confirm_large_jump: true }))).status, 'APPLIED');
    }
  });
  await test('Supervisor reprogram is scoped and only changes temporary date/reason', async () => {
    await reset('SUPERVISOR');
    const result = await call('reprogram_lubrication_plan', args({ p_id: 'p1', p_crew_id: 'c1', p_until: validReprogramDate, p_reason: 'Acceso' }));
    assert.equal(result.status, 'APPLIED');
    assert.equal(result.rows[0].payload.frequency, 50);
    assert.deepEqual(result.rows[0].payload.assignedDays, ['Lunes']);
    assert.equal(result.rows[0].payload.reprogramadoMotivo, 'Acceso');
    await reset('SUPERVISOR', { equipmentLocation: 'loc2' });
    await deniedUnchanged(() => call('reprogram_lubrication_plan', args({ p_id: 'p1', p_crew_id: 'c1', p_until: validReprogramDate, p_reason: 'Acceso' })), 'SCOPE_DENIED');
  });
  await test('reprogram rejects out of range date, invalid plan type, and bad reason', async () => {
    await deniedUnchanged(() => call('reprogram_lubrication_plan', args({ p_id: 'p1', p_until: invalidReprogramDate, p_reason: 'Acceso' })), 'INVALID_REPROGRAM');
    await db.exec("update public.engrase_sync set payload=payload||'{\"controlType\":\"Horas de operación\"}' where store='lubrication_plans'");
    await deniedUnchanged(() => call('reprogram_lubrication_plan', args({ p_id: 'p1', p_until: validReprogramDate, p_reason: 'Acceso' })), 'INVALID_PLAN_TYPE');
  });
  await test('idempotent retry returns same canonical reply; nonce conflict denied', async () => {
    const p = args({ p_location_id: 'loc2' });
    const first = await call('move_equipment_master_location', p);
    assert.deepEqual(await call('move_equipment_master_location', p), first);
    await deniedUnchanged(() => call('move_equipment_master_location', { ...p, p_location_id: 'loc1' }), 'IDEMPOTENCY_CONFLICT');
  });
  await test('all operational roles can read settings but only Admin can write them', async () => {
    for (const role of ['ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR']) {
      await reset(role);
      await db.exec('set role authenticated');
      const rows = await db.query("select id from public.engrase_sync where store='settings'");
      assert.equal(rows.rows.length, 1, role + ' can read settings');
      if (role !== 'ADMINISTRADOR') {
        await assert.rejects(db.query("insert into public.engrase_sync(store,id,payload,updated_at,deleted) values('settings','x','{}',now(),false)"), /row-level security/);
        const deniedUpdate = await db.query("update public.engrase_sync set payload='{}' where store='settings' and id='help_content' returning id");
        assert.equal(deniedUpdate.rows.length, 0);
      } else {
        await db.query("update public.engrase_sync set payload=payload||'{\"updated\":true}' where store='settings' and id='help_content'");
      }
      await db.exec('reset role');
    }
  });
  await test('restrictive policies block direct generic writes beyond allowed roles', async () => {
    await db.exec("insert into public.app_profiles values('22222222-2222-4222-8222-222222222222','u2','Planner','PLANIFICADOR',true); select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false); set role authenticated");
    const eq = await db.query("update public.engrase_sync set payload=payload||'{\"code\":\"FORGED\"}' where store='equipment' and id='e1' returning id");
    assert.equal(eq.rows.length, 0);
    await assert.rejects(db.query("insert into public.engrase_sync(store,id,payload,updated_at,deleted) values('equipment','e2','{}',now(),false)"), /row-level security/);
    const plan = await db.query("update public.engrase_sync set payload=payload||'{\"frequency\":60}' where store='lubrication_plans' and id='p1' returning id");
    assert.equal(plan.rows.length, 1);
    const pointInsert = await db.query("insert into public.engrase_sync(store,id,payload,updated_at,deleted) values('lubrication_points','pt2','{}',now(),false) returning id");
    assert.equal(pointInsert.rows.length, 1);
    await assert.rejects(db.query("insert into public.engrase_sync(store,id,payload,updated_at,deleted) values('settings','s1','{}',now(),false)"), /row-level security/);
    await db.exec('reset role; delete from public.engrase_sync where store=\'audit_log\'; update public.app_profiles set role=\'SUPERVISOR\' where auth_user_id=\'22222222-2222-4222-8222-222222222222\'; set role authenticated');
    const denied = await db.query("update public.engrase_sync set payload=payload||'{\"avisosPausaMotivo\":\"client write\"}' where store='equipment' and id='e1' returning id");
    assert.equal(denied.rows.length, 0);
    const points = await db.query("update public.engrase_sync set payload=payload||'{\"point\":\"forged\"}' where store='lubrication_points' and id='pt1' returning id");
    assert.equal(points.rows.length, 0);
    await assert.rejects(db.query("insert into public.engrase_sync(store,id,payload,updated_at,deleted) values('lubrication_points','pt3','{}',now(),false)"), /row-level security/);
    const genericHardDelete = await db.query("delete from public.engrase_sync where store='lubrication_points' and id='pt1' returning id");
    assert.equal(genericHardDelete.rows.length, 0);
    await db.exec('reset role');
  });
  console.log(`PASS ${passed} operational catalog gateway SQL checks (PGlite local only)`);
} finally { await db.close(); }
