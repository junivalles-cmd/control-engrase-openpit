// supabase/functions/update-own-profile/index.ts
//
// Autoservicio de perfil (lote "Mi Perfil") — CUALQUIER usuario autenticado
// y activo puede actualizar SU PROPIO display_name. NUNCA su rol, su
// estado activo, su app_user_id, ni la fila de otra persona.
//
// PREPARADA, NO DESPLEGADA — a diferencia de manage-users (ACTIVE en
// producción), este archivo todavía no se publicó con `supabase functions
// deploy`. Ver la respuesta final del lote "Mi Perfil" para el motivo: se
// escribió porque display_name no se puede autoeditar con la arquitectura
// YA DESPLEGADA (ver abajo), pero desplegarla es una acción de producción
// que requiere autorización explícita por separado.
//
// Por qué existe (en vez de reusar lo que ya hay):
//   - app_profiles bloquea CUALQUIER auto-UPDATE directo vía PostgREST,
//     incluso para un admin sobre su propia fila (ver
//     supabase/migrations/0002_auth_profiles_rls_PREPARED.sql, policy
//     "app_profiles: admin edita otros": `auth.uid() <> auth_user_id` —
//     evita auto-ascenso/auto-sabotaje a propósito).
//   - manage-users (ya desplegada) exige ADMINISTRADOR activo para TODAS
//     sus acciones (decideCallerAuthorization()) — nunca se debilita ese
//     gate para colar autoservicio ahí; esta función es nueva y acotada
//     en vez de ampliar el alcance de la existente.
//
// Invocación (desde src/core/auth.js, Auth.updateOwnDisplayName()):
//   POST /functions/v1/update-own-profile
//   Authorization: Bearer <JWT propio> (nunca la anon key sola, nunca
//     service_role — el cliente jamás tiene esa llave)
//   body: { display_name: string }
//
// Flujo de autorización (DISTINTO de manage-users a propósito — aquí
// CUALQUIER usuario activo puede llamar, nunca solo ADMINISTRADOR; la
// única restricción real es que SOLO puede tocar su PROPIA fila, nunca la
// de nadie más, y SOLO el campo display_name):
//   1. Extrae el JWT del header Authorization.
//   2. GET /auth/v1/user con ese JWT -> valida contra el propio servidor
//      de Auth y obtiene auth.uid() real (nunca decodifica el JWT a mano,
//      nunca confía en nada que venga en el body).
//   3. Lee app_profiles WHERE auth_user_id = <ese uid>, con service_role —
//      confirma que existe y está activo (inactivo no puede ni editar su
//      propio nombre).
//   4. Valida display_name (string no vacío, longitud razonable).
//   5. PATCH app_profiles SET display_name=... WHERE auth_user_id=<uid YA
//      VERIFICADO server-side en el paso 2> — nunca un app_user_id/
//      auth_user_id que venga del body, siempre el uid resuelto ahí
//      (estructuralmente imposible editar la fila de otra persona).
//
// Variables de entorno requeridas (Supabase -> Edge Functions -> Secrets),
// mismas que manage-users: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// SUPABASE_ANON_KEY.
//
// Diseño: sin anotaciones de TypeScript reales a propósito, misma
// convención que manage-users/notify-push/notify-vencidos — este archivo
// se guarda como .ts pero su código es JavaScript válido para poder
// extraerse y probarse directamente (tests/unit/update-own-profile-logic.
// test.js, mismo mecanismo extractDeclaration ya usado para los demás)
// sin necesitar el runtime de Deno. Toda la lógica de negocio recibe el
// entorno (`env`) como parámetro explícito — solo `serve()` al final
// conoce `Deno.env`.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

/* ============================================================
   CONSTANTES PURAS
   ============================================================ */

const MAX_DISPLAY_NAME_LENGTH = 80;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // mismo criterio que manage-users (anon key ya pública, esta función exige JWT real de todos modos)
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/* ============================================================
   LÓGICA PURA — sin Deno, sin fetch. Extraída y probada directamente en
   tests/unit/update-own-profile-logic.test.js.
   ============================================================ */

function isValidDisplayName(name) {
  return typeof name === "string" && name.trim().length > 0 && name.trim().length <= MAX_DISPLAY_NAME_LENGTH;
}

/* ============================================================
   OPERACIONES — reciben `env` explícito ({supabaseUrl, serviceRoleKey,
   anonKey}, nunca Deno.env ni consts de módulo directamente) y usan el
   `fetch` global — testeables con vi.stubGlobal('fetch', ...) exactamente
   igual que manage-users/sync.js/auth.js.
   ============================================================ */

function svHeaders(env) {
  return { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` };
}

// Valida el JWT contra el propio Auth de Supabase (nunca lo decodifica a
// mano) y lee el app_profile real del caller — única fuente de autoridad
// sobre QUIÉN es, igual que getCallerProfile() en manage-users. Devuelve
// { authUserId, profile }.
async function getCallerProfile(env, jwt) {
  const userResp = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: env.anonKey, Authorization: `Bearer ${jwt}` },
  });
  if (!userResp.ok) return { authUserId: null, profile: null };
  const authUser = await userResp.json();
  const authUserId = authUser?.id ?? null;
  if (!authUserId) return { authUserId: null, profile: null };

  const profResp = await fetch(
    `${env.supabaseUrl}/rest/v1/app_profiles?select=auth_user_id,app_user_id,role,active&auth_user_id=eq.${authUserId}`,
    { headers: svHeaders(env) },
  );
  if (!profResp.ok) return { authUserId, profile: null };
  const rows = await profResp.json();
  return { authUserId, profile: rows[0] ?? null };
}

// Decide 401/403/autorizado — a propósito NO exige ningún rol concreto
// (DISTINTO de decideCallerAuthorization() en manage-users): cualquier
// persona con perfil activo puede llamar, la restricción real es de
// ALCANCE (solo su propia fila), no de rol.
function decideCallerAuthorization(authUserId, profile) {
  if (!authUserId) return 401;
  if (!profile || profile.active !== true) return 403;
  return null;
}

async function handleUpdateOwnProfile(env, authUserId, body) {
  const displayName = body && body.display_name;
  if (!isValidDisplayName(displayName)) {
    return { status: 400, body: { error: "invalid_display_name" } };
  }
  const upd = await fetch(`${env.supabaseUrl}/rest/v1/app_profiles?auth_user_id=eq.${authUserId}`, {
    method: "PATCH",
    headers: { ...svHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: displayName.trim(), updated_at: new Date().toISOString() }),
  });
  if (!upd.ok) return { status: 502, body: { error: "update_failed" } };
  return { status: 200, body: { ok: true, display_name: displayName.trim() } };
}

/* ============================================================
   GLUE — Deno.env / Deno `serve`. NO se prueba con Vitest (requiere el
   runtime de Deno) — se revisa a mano; delega TODA la lógica a las
   funciones de arriba, mismo criterio que manage-users.
   ============================================================ */

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const env = {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  };

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return jsonResponse({ error: "AUTH_REQUIRED" }, 401);

  const { authUserId, profile } = await getCallerProfile(env, jwt);
  const authDecision = decideCallerAuthorization(authUserId, profile);
  if (authDecision === 401) return jsonResponse({ error: "AUTH_REQUIRED" }, 401);
  if (authDecision === 403) return jsonResponse({ error: "AUTH_FORBIDDEN" }, 403);

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  try {
    const result = await handleUpdateOwnProfile(env, authUserId, body);
    return jsonResponse(result.body, result.status);
  } catch (err) {
    console.error("update-own-profile error", err instanceof Error ? err.message : String(err));
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
