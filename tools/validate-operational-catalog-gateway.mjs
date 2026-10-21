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
const preCutover = process.argv.includes('--precutover-0013');

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
if (preCutover) {
  await db.exec(`create policy "engrase_sync: leer según matriz" on public.engrase_sync for select to authenticated using(exists(
    select 1 from public.app_profiles a join public.app_store_permissions p on p.role=a.role
    where a.auth_user_id=auth.uid() and a.active and p.store=engrase_sync.store and p.can_read));
    insert into public.app_store_permissions values('equipment','LUBRICADOR',false,false,false,false),
    ('settings','PLANIFICADOR',false,false,false,false),('settings','SUPERVISOR',false,false,false,false),('settings','LUBRICADOR',false,false,false,false);`);
  await db.exec(await readFile(root + '0012_authorization_scope_bootstrap_PREPARED.sql','utf8'));
  await db.exec(await readFile(root + '0013_authorization_row_scope_PREPARED.sql','utf8'));
}
const before0011 = preCutover ? (await db.query("select policyname,permissive,roles,cmd,qual,with_check from pg_policies where tablename='engrase_sync' order by policyname")).rows : null;
const matrixBefore0011 = (await db.query('select * from app_store_permissions order by store,role')).rows;
if (preCutover) await db.exec(await readFile('docs/0011_PRODUCTION_PREFLIGHT_READ_ONLY.sql','utf8'));
await db.exec(await readFile(root + '0011_operational_catalog_gateway_PREPARED.sql', 'utf8'));
assert.deepEqual((await db.query('select * from app_store_permissions order by store,role')).rows,matrixBefore0011);
if (preCutover) {
  const after = (await db.query("select policyname,permissive,roles,cmd,qual,with_check from pg_policies where tablename='engrase_sync' order by policyname")).rows;
  assert.deepEqual(after.filter(p=>!p.policyname.startsWith('catalog_')),before0011);
  assert.equal(after.filter(p=>p.policyname.startsWith('authorization_')).length,8);
}
// Model post-0003 authenticated matrix policies; 0011 must not rely on the
// legacy public ALL/true policy used only to compile the earlier gateways.
if (!preCutover) await db.exec(`drop policy legacy_all on public.engrase_sync;
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
    const canRead = preCutover || store !== 'settings' || role === 'ADMINISTRADOR';
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
      if (role==='LUBRICADOR') for (const name of ['set_equipment_shift','set_equipment_alert_pause','update_equipment_hourmeter','reprogram_lubrication_plan']) {
        await deniedUnchanged(()=>call(name,args({p_id:name==='reprogram_lubrication_plan'?'p1':'e1',p_crew_id:'c1',p_shift_id:'shift_noche',p_until:validReprogramDate,p_reason:'Test',p_hourmeter:120})),'ROLE_DENIED');
      }
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
      assert.equal((await call('update_equipment_hourmeter', args({ p_hourmeter:100 }))).status,'APPLIED');
      await reset(role);
      assert.equal((await call('update_equipment_hourmeter', args({ p_hourmeter:600 }))).status,'APPLIED');
      await reset(role);
      assert.equal((await call('set_equipment_shift', args({ p_shift_id: 'shift_noche' }))).status, 'APPLIED');
      await reset(role);
      await deniedUnchanged(() => call('update_equipment_hourmeter', args({ p_hourmeter: 99 })), 'INVALID_HOURMETER');
      for (const bad of ['NaN','Infinity','-Infinity',-1,null]) await deniedUnchanged(()=>call('update_equipment_hourmeter',args({p_hourmeter:bad})),'INVALID_HOURMETER');
      await deniedUnchanged(() => call('update_equipment_hourmeter', args({ p_hourmeter: 701 })), 'HOURMETER_CONFIRMATION_REQUIRED');
      assert.equal((await call('update_equipment_hourmeter', args({ p_hourmeter: 701, p_confirm_large_jump: true }))).status, 'APPLIED');
    }
  });
  if (preCutover) await test('0013 matrix and scope remain authoritative with legacy and settings permissive policy', async () => {
    await db.exec("update app_store_permissions set can_read=false where store='settings'; set role authenticated");
    assert.equal((await db.query("select id from engrase_sync where store='settings'")).rows.length,0);
    await db.exec("reset role; update app_store_permissions set can_read=false where store='equipment'");
    await deniedUnchanged(()=>call('set_equipment_shift',args({p_shift_id:'shift_noche'})),'PERMISSION_DENIED');
    await db.exec('set role authenticated');
    assert.equal((await db.query("select id from engrase_sync where store='equipment'")).rows.length,0);
    await db.exec('reset role');
    await reset('SUPERVISOR');
    await put('equipment','outside',{locationId:'loc2',hourmeter:10});
    await db.exec('set role authenticated');
    assert.deepEqual((await db.query("select id from engrase_sync where store='equipment' order by id")).rows.map(r=>r.id),['e1']);
    await db.exec('reset role');
    await put('cuadrillas','c2',{locationId:'loc2',memberUserIds:['u1']});
    await put('cuadrillas','c3',{locationId:'loc1',memberUserIds:['u1']});
    await deniedUnchanged(()=>call('set_equipment_alert_pause',args({p_until:validReprogramDate,p_reason:'Taller'})),'CREW_SELECTION_REQUIRED');
    assert.equal((await call('set_equipment_alert_pause',args({p_crew_id:'c1',p_until:validReprogramDate,p_reason:'Taller'}))).status,'APPLIED');
  });
  if (preCutover) await test('ACLs, receipts and safe-stop rollback do not reopen access; anon legacy risk persists',async()=>{
    const signatures=['move_equipment_master_location(text,text,timestamptz,text)','set_equipment_shift(text,text,timestamptz,text)',
      'set_equipment_alert_pause(text,text,text,timestamptz,date,text)','update_equipment_hourmeter(text,text,timestamptz,numeric,boolean)',
      'reprogram_lubrication_plan(text,text,text,timestamptz,date,text)'];
    for(const signature of signatures) {
      const r=(await db.query(`select prosecdef,proconfig,pg_get_userbyid(proowner) as owner,
       has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('authenticated',oid,'execute') as authenticated
       from pg_proc where oid=to_regprocedure($1)`,['public.'+signature])).rows[0];
      assert.deepEqual(r,{prosecdef:true,proconfig:['search_path=pg_catalog'],owner:'postgres',anon:false,authenticated:true});
    }
    await db.exec('set role anon');
    assert.equal((await db.query("select id from engrase_sync where store='equipment'")).rows.length,1);
    await assert.rejects(db.query('select * from operational_catalog_receipts'),/permission denied/);
    await db.exec('reset role; set role authenticated');
    await assert.rejects(db.query('select * from operational_catalog_receipts'),/permission denied/);
    await db.exec('reset role');
    await call('move_equipment_master_location',args({p_location_id:'loc2'}));
    const dataBefore=await snapshot();
    const receipts=(await db.query('select * from operational_catalog_receipts')).rows;
    const policies=(await db.query("select * from pg_policies where tablename='engrase_sync' order by policyname")).rows;
    await db.exec(await readFile(root+'0011_operational_catalog_gateway_ROLLBACK.sql','utf8'));
    assert.deepEqual(await snapshot(),dataBefore);
    assert.deepEqual((await db.query('select * from operational_catalog_receipts')).rows,receipts);
    assert.deepEqual((await db.query("select * from pg_policies where tablename='engrase_sync' order by policyname")).rows,policies);
    for(const signature of signatures) assert.equal((await db.query("select has_function_privilege('authenticated',to_regprocedure($1),'execute') as allowed",['public.'+signature])).rows[0].allowed,false);
    await assert.rejects(call('move_equipment_master_location',args({p_location_id:'loc1'})),/permission denied/);
    await db.exec('set role authenticated');
    assert.equal((await db.query("select public.get_authorization_context() as c")).rows[0].c.context.rowScopeEnforced,true);
    await db.exec('reset role');
    // Restore only this disposable fixture for subsequent independent cases.
    await db.exec('grant execute on function '+signatures.map(s=>'public.'+s).join(',')+' to authenticated');
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
  console.log(`PASS ${passed} operational catalog gateway SQL checks (${preCutover?'legacy + repaired 0013':'post-cutover matrix'}, PGlite local only)`);
} finally { await db.close(); }
