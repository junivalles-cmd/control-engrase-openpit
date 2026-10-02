// tools/verify-rls-matrix.mjs
//
// Guión preparado para el gate de cutover "Cada rol probado contra la
// matriz completa de §7" + "Usuario inactivo bloqueado" + "anon DENIED"
// (docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §15) — PREPARADO, NO EJECUTADO
// todavía por Claude.
//
// POR QUÉ ESTO TODAVÍA NO SIRVE DE NADA: mientras la policy legacy
// "acceso interno con anon key" (schema.sql) siga activa en producción
// (0003 sin aplicar), Postgres combina policies PERMISIVAS por OR — esa
// policy acepta cualquier cosa, así que CUALQUIER rol/anon "pasaría"
// cualquier prueba de este script sin que eso signifique nada real.
// Ejecutarlo ANTES de 0003 da falsos positivos. Ejecutarlo DESPUÉS de
// 0003 (autorizado explícitamente, por separado) es cuando este script
// cobra sentido.
//
// Qué hace (fuente única de la matriz, nunca duplicada a mano): parsea
// el INSERT real de app_store_permissions directo de
// CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/
// 0002_auth_profiles_rls_PREPARED.sql (lo que YA está aplicado en
// producción), y para cada (store, role) prueba:
//   - SELECT: compara contra un store con datos reales conocidos
//     (conteos de docs/PROD_PRECUTOVER_AUTH_2026-09-26.md) — si
//     can_read=true se espera ≥1 fila, si false se espera 0 (RLS filtra
//     SELECT en silencio, nunca da error — por eso se compara contra un
//     store que SÍ tiene filas).
//   - INSERT/UPDATE (solo con --write): inserta una fila de prueba
//     inconfundible (id "rls_verify_<role>_<store>_<timestamp>") y, si
//     tuvo éxito, la marca `deleted:true` DE INMEDIATO en el mismo
//     intento (mismo patrón soft-delete que ya usa el resto de la app —
//     nunca un DELETE real, no hay policy de DELETE). Sin --write, SOLO
//     corre las pruebas de lectura (0 riesgo de escritura).
//
// Qué necesita (variables de entorno, NUNCA hardcodeadas ni committeadas):
//   SUPABASE_URL                — igual que cfg.url de la app (no es secreto)
//   SUPABASE_ANON_KEY            — igual que cfg.anonKey (pública, pensada para el cliente)
//   RLS_JWT_ADMINISTRADOR        — access_token de una sesión real con ese rol
//   RLS_JWT_PLANIFICADOR         — (opcional — hoy no existe cuenta real, se salta con aviso)
//   RLS_JWT_SUPERVISOR
//   RLS_JWT_LUBRICADOR
//   RLS_JWT_VISOR                — (opcional, mismo caso que PLANIFICADOR)
//   RLS_JWT_INACTIVE              — access_token de una cuenta con app_profiles.active=false
//                                    (opcional — hoy no existe ninguna cuenta real inactiva,
//                                    ver docs/SESSION_HANDOFF.md; sin esto se salta ese gate)
//
// Ningún JWT/anon key se pide por parámetro de línea de comandos ni se
// imprime en el reporte — solo se leen de env y se usan para el header
// Authorization. Uso:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... RLS_JWT_ADMINISTRADOR=... \
//     node tools/verify-rls-matrix.mjs            # solo lectura
//   ... node tools/verify-rls-matrix.mjs --write   # + insert/update (escribe y limpia en el acto)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MATRIX_SQL_PATH = path.join(
  ROOT, 'CONTROL_ENGRASE_WEB', 'CONTROL_ENGRASE_WEB', 'supabase', 'migrations',
  '0002_auth_profiles_rls_PREPARED.sql'
);
const WRITE_MODE = process.argv.includes('--write');

const ROLES = ['ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR', 'LUBRICADOR', 'VISOR'];

// Conteos reales conocidos (docs/PROD_PRECUTOVER_AUTH_2026-09-26.md,
// última auditoría de solo-lectura) — stores con 0 filas no sirven para
// distinguir "denegado" de "vacío" en la prueba de SELECT, se omiten ahí.
const KNOWN_NONZERO_STORES = new Set([
  'anomalies', 'audit_log', 'cuadrillas', 'equipment', 'equipment_types',
  'grease_validations', 'locations', 'lubricants', 'lubrication_plans',
  'lubrication_points', 'lubrication_records', 'push_tokens', 'settings',
  'shifts', 'users',
]);

function parseMatrix(sqlText) {
  const matrix = [];
  const re = /\('([a-z_]+)',\s*'([A-Z]+)',\s*(true|false),\s*(true|false),\s*(true|false),\s*(true|false)\)/g;
  let m;
  while ((m = re.exec(sqlText))) {
    matrix.push({
      store: m[1], role: m[2],
      can_read: m[3] === 'true', can_insert: m[4] === 'true',
      can_update: m[5] === 'true', can_delete: m[6] === 'true',
    });
  }
  return matrix;
}

async function restRequest(url, anonKey, jwt, method, path_, body) {
  const res = await fetch(`${url}${path_}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      ...(method !== 'GET' ? { Prefer: 'return=representation' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* sin body */ }
  return { status: res.status, ok: res.ok, json };
}

async function testRead(ctx, store, expectedCanRead) {
  if (!KNOWN_NONZERO_STORES.has(store)) return { skipped: 'store sin conteo conocido >0' };
  const { ok, json } = await restRequest(
    ctx.url, ctx.anonKey, ctx.jwt, 'GET',
    `/rest/v1/engrase_sync?store=eq.${store}&select=id&limit=1`
  );
  const sawRows = ok && Array.isArray(json) && json.length > 0;
  const pass = sawRows === expectedCanRead;
  return { pass, detail: `esperado can_read=${expectedCanRead}, filas vistas=${sawRows}` };
}

async function testWrite(ctx, store, expectedCanInsert) {
  const testId = `rls_verify_${ctx.role}_${store}_${Date.now()}`;
  const ins = await restRequest(
    ctx.url, ctx.anonKey, ctx.jwt, 'POST', '/rest/v1/engrase_sync',
    { store, id: testId, payload: { _rls_verify: true, note: 'borrar si queda huérfana — tools/verify-rls-matrix.mjs' } }
  );
  const inserted = ins.ok;
  if (inserted) {
    // Limpieza INMEDIATA — soft-delete, mismo patrón que el resto de la
    // app (nunca hay policy de DELETE real sobre engrase_sync).
    await restRequest(
      ctx.url, ctx.anonKey, ctx.jwt, 'PATCH', `/rest/v1/engrase_sync?store=eq.${store}&id=eq.${testId}`,
      { deleted: true }
    );
  }
  const pass = inserted === expectedCanInsert;
  return { pass, detail: `esperado can_insert=${expectedCanInsert}, insert ${inserted ? 'tuvo éxito (limpiado)' : 'fue denegado'} (HTTP ${ins.status})` };
}

async function testAnon(url, anonKey) {
  console.log('\n=== anon (sin JWT de usuario, solo anon key) ===');
  const read = await restRequest(url, anonKey, anonKey, 'GET', '/rest/v1/engrase_sync?store=eq.settings&select=id&limit=1');
  const readDenied = read.ok && Array.isArray(read.json) && read.json.length === 0;
  console.log(`  SELECT settings → ${readDenied ? 'PASS (0 filas, denegado)' : `FALLO (vio ${read.json?.length ?? '?'} filas — anon NO debería ver nada)`}`);

  if (WRITE_MODE) {
    const testId = `rls_verify_anon_${Date.now()}`;
    const ins = await restRequest(url, anonKey, anonKey, 'POST', '/rest/v1/engrase_sync', { store: 'settings', id: testId, payload: { _rls_verify: true } });
    if (ins.ok) await restRequest(url, anonKey, anonKey, 'PATCH', `/rest/v1/engrase_sync?store=eq.settings&id=eq.${testId}`, { deleted: true });
    console.log(`  INSERT settings → ${!ins.ok ? 'PASS (denegado)' : 'FALLO (anon pudo insertar — limpiado, pero es un fallo real)'}`);
  } else {
    console.log('  INSERT settings → omitido (correr con --write para probarlo)');
  }
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error('Faltan SUPABASE_URL / SUPABASE_ANON_KEY en el entorno. Ver el encabezado de este archivo.');
    process.exit(1);
  }

  const sqlText = fs.readFileSync(MATRIX_SQL_PATH, 'utf8');
  const matrix = parseMatrix(sqlText);
  console.log(`Matriz real cargada desde 0002_auth_profiles_rls_PREPARED.sql: ${matrix.length} filas (store × rol).`);
  console.log(WRITE_MODE ? 'Modo: LECTURA + ESCRITURA (inserta y limpia filas de prueba)' : 'Modo: SOLO LECTURA (correr con --write para probar insert/update)');

  let totalPass = 0, totalFail = 0, totalSkip = 0;

  for (const role of ROLES) {
    const jwt = process.env[`RLS_JWT_${role}`];
    console.log(`\n=== ${role} ===`);
    if (!jwt) { console.log('  (sin RLS_JWT_' + role + ' en el entorno — sin cuenta Auth real todavía, se omite)'); totalSkip++; continue; }
    const ctx = { url, anonKey, jwt, role };
    for (const row of matrix.filter(r => r.role === role)) {
      const r = await testRead(ctx, row.store, row.can_read);
      if (r.skipped) { totalSkip++; continue; }
      console.log(`  SELECT ${row.store} → ${r.pass ? 'PASS' : 'FALLO'} (${r.detail})`);
      r.pass ? totalPass++ : totalFail++;

      if (WRITE_MODE) {
        const w = await testWrite(ctx, row.store, row.can_insert);
        console.log(`  INSERT ${row.store} → ${w.pass ? 'PASS' : 'FALLO'} (${w.detail})`);
        w.pass ? totalPass++ : totalFail++;
      }
    }
  }

  const inactiveJwt = process.env.RLS_JWT_INACTIVE;
  if (inactiveJwt) {
    console.log('\n=== Usuario INACTIVO (app_profiles.active=false) ===');
    const r = await testRead({ url, anonKey, jwt: inactiveJwt, role: 'inactive' }, 'settings', false);
    console.log(`  SELECT settings → ${r.pass ? 'PASS (bloqueado)' : 'FALLO (un inactivo vio datos)'}`);
    r.pass ? totalPass++ : totalFail++;
  } else {
    console.log('\n=== Usuario INACTIVO === (sin RLS_JWT_INACTIVE — no existe ninguna cuenta real inactiva todavía, se omite)');
    totalSkip++;
  }

  await testAnon(url, anonKey);

  console.log(`\n=== Resumen: ${totalPass} PASS, ${totalFail} FALLO, ${totalSkip} omitidos ===`);
  process.exit(totalFail > 0 ? 1 : 0);
}

main();
