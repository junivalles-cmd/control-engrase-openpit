// supabase/functions/manage-users/index.ts
//
// Administración segura de usuarios reales (P0-2). service_role SOLO vive
// aquí — NUNCA en app.js, Android, IndexedDB, Git ni logs (ver
// docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §11). DESPLEGADA en producción
// (ACTIVE, ver docs/SESSION_HANDOFF.md) — este archivo es la fuente real
// que corre ahí, no una preparación pendiente de revisión.
//
// Invocación (desde src/core/auth.js, Auth.manageUsers()):
//   POST /functions/v1/manage-users
//   Authorization: Bearer <JWT del usuario que llama> (NUNCA la anon key
//     sola, NUNCA un service_role — el cliente jamás tiene esa llave)
//   body: { action: 'LIST_USERS'|'CREATE_USER'|'UPDATE_ROLE'|'SET_ACTIVE'
//           |'RESET_PASSWORD', ...datos de la acción }
//
// Flujo de autorización — SIEMPRE, para TODAS las acciones, sin excepción:
//   1. Extrae el JWT del header Authorization.
//   2. GET /auth/v1/user con ese JWT -> valida contra el propio servidor
//      de Auth y obtiene auth.uid() real (nunca decodifica el JWT a mano,
//      nunca confía en nada que venga en el body).
//   3. Lee app_profiles WHERE auth_user_id = <ese uid>, con service_role
//      (única fuente de autoridad — NUNCA payload.role, NUNCA
//      localStorage, NUNCA users.role, NUNCA App.currentUser.role).
//   4. decideCallerAuthorization() decide 401/403/autorizado — misma
//      regla para las 5 acciones, sin excepción.
//
// Variables de entorno requeridas (Supabase -> Edge Functions -> Secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (las da Supabase solo),
//   SUPABASE_ANON_KEY (para validar el JWT contra /auth/v1/user).
//
// Diseño: sin anotaciones de TypeScript reales a propósito — este archivo
// se guarda como .ts (misma convención que notify-push/notify-vencidos),
// pero su código es JavaScript válido para poder extraerse y probarse
// directamente (tests/unit/manage-users-logic.test.js, mismo mecanismo
// extractDeclaration ya usado para sync.js/auth.js/db.js) sin necesitar el
// runtime de Deno ni un transpilador — los tipos quedan documentados en
// JSDoc, no en sintaxis TS. Toda la lógica de negocio recibe el entorno
// (`env`) como parámetro explícito en vez de leer `Deno.env` directamente
// — solo `serve()` al final conoce `Deno.env`/`Deno.serve`.
//
// Rate-limiting: NO implementado — Deno Edge Functions no tienen un KV/
// contador persistente confiable entre invocaciones sin infraestructura
// adicional (Redis/Deno KV) que este proyecto no tiene configurada.
// Señalado como pendiente, no resuelto en este cierre (ver respuesta
// final de esta tarea).

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

/* ============================================================
   CONSTANTES PURAS
   ============================================================ */

const VALID_ROLES = ["ADMINISTRADOR", "PLANIFICADOR", "SUPERVISOR", "LUBRICADOR", "VISOR"];
const AUTH_IDENTIFIER_DOMAIN = "engrase.internal"; // mismo dominio que src/core/auth.js — único lugar que se repite del lado server

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // mismo criterio que el resto del proyecto (la anon key ya es pública; esta función exige un JWT real de todos modos, no depende de origen)
  // FIX CORS (diagnóstico confirmado con curl real contra producción, sin
  // tocar datos): Auth.manageUsers() (src/core/auth.js) SIEMPRE envía
  // apikey además de authorization/content-type — faltaba en esta lista,
  // así que el navegador bloqueaba el preflight OPTIONS antes de mandar el
  // POST real con el JWT. /rest/v1/* (PostgREST) no tiene este problema
  // porque su gateway hace echo automático de los headers pedidos; una
  // Edge Function propia tiene que declarar la lista completa a mano.
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/* ============================================================
   LÓGICA PURA — sin Deno, sin fetch. Extraída y probada directamente en
   tests/unit/manage-users-logic.test.js.
   ============================================================ */

function isValidRoleValue(role) {
  return typeof role === "string" && VALID_ROLES.includes(role);
}

// Mismas reglas que usernameToAuthIdentifier() en src/core/auth.js —
// deliberadamente duplicada aquí (server-side, Deno) en vez de importada,
// porque cliente y Edge Function corren en runtimes distintos sin módulo
// compartido — mismo criterio ya usado para AUTH_IDENTIFIER_DOMAIN.
function usernameToAuthIdentifier(username) {
  if (typeof username !== "string") throw new Error("El nombre de usuario debe ser texto.");
  const clean = username.trim().toLowerCase();
  if (!clean) throw new Error("El nombre de usuario no puede estar vacío.");
  if (clean.includes("@")) throw new Error('El nombre de usuario no debe incluir "@".');
  if (/\s/.test(clean)) throw new Error("El nombre de usuario no puede tener espacios.");
  if (!/^[a-z0-9._-]+$/.test(clean)) {
    throw new Error("El nombre de usuario solo puede tener letras, números, punto, guion y guion bajo.");
  }
  return `${clean}@${AUTH_IDENTIFIER_DOMAIN}`;
}

function appUserIdFromUsername(username) {
  return `u_${username.trim().toLowerCase()}`;
}

function isValidTempPassword(pw) {
  return typeof pw === "string" && pw.length >= 8;
}

// Decide qué código HTTP corresponde para un caller — SIEMPRE la MISMA
// regla para las 5 acciones (nunca varía por acción, nunca lee el body):
// sin auth.uid() real -> 401; con perfil pero sin ser ADMINISTRADOR
// activo -> 403; admin activo -> null ("seguir", autorizado).
// `profile`: { auth_user_id, app_user_id, role, active } | null.
function decideCallerAuthorization(authUserId, profile) {
  if (!authUserId) return 401;
  if (!profile || profile.active !== true || profile.role !== "ADMINISTRADOR") return 403;
  return null;
}

// true si esta operación (cambiar rol lejos de ADMINISTRADOR, o
// desactivar) dejaría el sistema sin NINGÚN administrador activo. Pura —
// el caller ya calculó otherActiveAdminsCount (activos, EXCLUYENDO al
// target) contra app_profiles real. Reutilizada por UPDATE_ROLE y
// SET_ACTIVE — una sola regla, nunca duplicada entre las dos acciones.
function wouldLeaveZeroActiveAdmins(targetWasActiveAdmin, targetWillStayActiveAdmin, otherActiveAdminsCount) {
  if (!targetWasActiveAdmin) return false; // no era admin activo -> sin riesgo
  if (targetWillStayActiveAdmin) return false; // sigue siendo admin activo -> sin riesgo
  return otherActiveAdminsCount === 0;
}

/* ============================================================
   OPERACIONES — reciben `env` explícito ({supabaseUrl, serviceRoleKey,
   anonKey}, nunca Deno.env ni consts de módulo directamente) y usan el
   `fetch` global — testeables con vi.stubGlobal('fetch', ...) exactamente
   igual que sync.js/auth.js.
   ============================================================ */

function svHeaders(env) {
  return { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` };
}

// Valida el JWT contra el propio Auth de Supabase (nunca lo decodifica a
// mano) y lee el app_profile real del caller — única fuente de autoridad.
// Devuelve { authUserId, profile }.
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

async function countOtherActiveAdmins(env, excludeAuthUserId) {
  const resp = await fetch(
    `${env.supabaseUrl}/rest/v1/app_profiles?select=auth_user_id&role=eq.ADMINISTRADOR&active=eq.true`,
    { headers: svHeaders(env) },
  );
  if (!resp.ok) throw new Error(`count_admins_failed_${resp.status}`);
  const rows = await resp.json();
  return rows.filter((r) => r.auth_user_id !== excludeAuthUserId).length;
}

async function getProfileByAppUserId(env, appUserId) {
  const resp = await fetch(
    `${env.supabaseUrl}/rest/v1/app_profiles?select=auth_user_id,app_user_id,display_name,role,active&app_user_id=eq.${encodeURIComponent(appUserId)}`,
    { headers: svHeaders(env) },
  );
  if (!resp.ok) throw new Error(`lookup_failed_${resp.status}`);
  const rows = await resp.json();
  return rows[0] ?? null;
}

// Devuelve solo campos no sensibles — NUNCA password/hash/tokens/provider internals.
async function handleListUsers(env) {
  const resp = await fetch(
    `${env.supabaseUrl}/rest/v1/app_profiles?select=app_user_id,display_name,role,active,created_at&order=display_name.asc`,
    { headers: svHeaders(env) },
  );
  if (!resp.ok) return { status: 502, body: { error: `list_failed_${resp.status}` } };
  const rows = await resp.json();
  return { status: 200, body: { users: rows } };
}

// Auth primero, app_profile después; si el segundo paso falla, ROLLBACK
// del Auth user recién creado (nunca queda huérfano sin su app_profile).
// La password temporal viaja HTTPS directo del cliente a esta función —
// nunca la elige ni la ve Claude, nunca se guarda en app_profiles.
async function handleCreateUser(env, body) {
  const displayName = body.display_name;
  const username = body.username;
  const role = body.role;
  const tempPassword = body.temp_password;

  if (typeof displayName !== "string" || !displayName.trim()) {
    return { status: 400, body: { error: "display_name_required" } };
  }
  if (!isValidRoleValue(role)) return { status: 400, body: { error: "invalid_role" } };
  if (!isValidTempPassword(tempPassword)) return { status: 400, body: { error: "temp_password_required_min_8" } };

  let identifier;
  try {
    identifier = usernameToAuthIdentifier(username);
  } catch (e) {
    return { status: 400, body: { error: e instanceof Error ? e.message : String(e) } };
  }
  const appUserId = appUserIdFromUsername(username);

  const existing = await getProfileByAppUserId(env, appUserId);
  if (existing) return { status: 409, body: { error: "username_taken" } };

  const createResp = await fetch(`${env.supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: { ...svHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ email: identifier, password: tempPassword, email_confirm: true }),
  });
  if (!createResp.ok) return { status: 502, body: { error: "auth_create_failed" } };
  const created = await createResp.json();
  const newAuthUserId = created?.id;
  if (!newAuthUserId) return { status: 502, body: { error: "auth_create_no_id" } };

  const profResp = await fetch(`${env.supabaseUrl}/rest/v1/app_profiles`, {
    method: "POST",
    headers: { ...svHeaders(env), "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify([{ auth_user_id: newAuthUserId, app_user_id: appUserId, display_name: displayName, role, active: true }]),
  });
  if (!profResp.ok) {
    // ROLLBACK: el Auth user recién creado nunca debe quedar huérfano.
    await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${newAuthUserId}`, {
      method: "DELETE",
      headers: svHeaders(env),
    }).catch(() => {});
    return { status: 502, body: { error: "profile_create_failed_rolled_back" } };
  }
  return { status: 200, body: { ok: true, app_user_id: appUserId, auth_user_id: newAuthUserId } };
}

async function handleUpdateRole(env, body) {
  const appUserId = body.app_user_id;
  const newRole = body.role;
  if (typeof appUserId !== "string" || !appUserId) return { status: 400, body: { error: "app_user_id_required" } };
  if (!isValidRoleValue(newRole)) return { status: 400, body: { error: "invalid_role" } };

  const target = await getProfileByAppUserId(env, appUserId);
  if (!target) return { status: 404, body: { error: "not_found" } };

  const wasActiveAdmin = target.role === "ADMINISTRADOR" && target.active === true;
  const willStayActiveAdmin = newRole === "ADMINISTRADOR" && target.active === true;
  if (wasActiveAdmin && !willStayActiveAdmin) {
    const others = await countOtherActiveAdmins(env, target.auth_user_id);
    if (wouldLeaveZeroActiveAdmins(wasActiveAdmin, willStayActiveAdmin, others)) {
      return { status: 409, body: { error: "cannot_remove_last_admin" } };
    }
  }

  const upd = await fetch(`${env.supabaseUrl}/rest/v1/app_profiles?app_user_id=eq.${encodeURIComponent(appUserId)}`, {
    method: "PATCH",
    headers: { ...svHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ role: newRole, updated_at: new Date().toISOString() }),
  });
  if (!upd.ok) return { status: 502, body: { error: "update_failed" } };
  return { status: 200, body: { ok: true } };
}

async function handleSetActive(env, body) {
  const appUserId = body.app_user_id;
  const newActive = body.active;
  if (typeof appUserId !== "string" || !appUserId || typeof newActive !== "boolean") {
    return { status: 400, body: { error: "invalid_input" } };
  }

  const target = await getProfileByAppUserId(env, appUserId);
  if (!target) return { status: 404, body: { error: "not_found" } };

  const wasActiveAdmin = target.role === "ADMINISTRADOR" && target.active === true;
  const willStayActiveAdmin = target.role === "ADMINISTRADOR" && newActive === true;
  if (wasActiveAdmin && !willStayActiveAdmin) {
    const others = await countOtherActiveAdmins(env, target.auth_user_id);
    if (wouldLeaveZeroActiveAdmins(wasActiveAdmin, willStayActiveAdmin, others)) {
      return { status: 409, body: { error: "cannot_deactivate_last_admin" } };
    }
  }

  const upd = await fetch(`${env.supabaseUrl}/rest/v1/app_profiles?app_user_id=eq.${encodeURIComponent(appUserId)}`, {
    method: "PATCH",
    headers: { ...svHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ active: newActive, updated_at: new Date().toISOString() }),
  });
  if (!upd.ok) return { status: 502, body: { error: "update_failed" } };
  // Nunca se borra el histórico: solo cambia `active`, la fila y todo lo
  // que referencia ese auth_user_id/app_user_id sigue intacto.
  return { status: 200, body: { ok: true } };
}

async function handleResetPassword(env, body) {
  const appUserId = body.app_user_id;
  const newPassword = body.new_password;
  if (typeof appUserId !== "string" || !appUserId) return { status: 400, body: { error: "app_user_id_required" } };
  if (!isValidTempPassword(newPassword)) return { status: 400, body: { error: "new_password_required_min_8" } };

  const target = await getProfileByAppUserId(env, appUserId);
  if (!target) return { status: 404, body: { error: "not_found" } };

  const upd = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${target.auth_user_id}`, {
    method: "PUT",
    headers: { ...svHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ password: newPassword }),
  });
  if (!upd.ok) return { status: 502, body: { error: "reset_failed" } };
  // Nunca se devuelve ni se loguea la contraseña — solo confirmación.
  return { status: 200, body: { ok: true } };
}

async function dispatchAction(env, action, body) {
  switch (action) {
    case "LIST_USERS": return handleListUsers(env);
    case "CREATE_USER": return handleCreateUser(env, body);
    case "UPDATE_ROLE": return handleUpdateRole(env, body);
    case "SET_ACTIVE": return handleSetActive(env, body);
    case "RESET_PASSWORD": return handleResetPassword(env, body);
    default: return { status: 400, body: { error: "unknown_action" } };
  }
}

/* ============================================================
   GLUE — Deno.env / Deno `serve`. NO se prueba con Vitest (requiere el
   runtime de Deno) — se revisa a mano; delega TODA la lógica a las
   funciones de arriba, así que lo único que hace distinto a lo ya
   probado es leer las variables de entorno reales.
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
    const result = await dispatchAction(env, body?.action, body);
    return jsonResponse(result.body, result.status);
  } catch (err) {
    // NUNCA loguear `body` completo (podría traer temp_password/new_password)
    // — solo la acción y el mensaje de error.
    console.error("manage-users error", body?.action, err instanceof Error ? err.message : String(err));
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
