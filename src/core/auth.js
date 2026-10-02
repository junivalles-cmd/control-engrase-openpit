/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT — src/core/auth.js
   P0-2 Etapa B1 — capa cliente de Supabase Auth, DETRÁS de un feature
   flag desactivado por defecto (AUTH_MODE = 'legacy'). Mientras el flag
   siga en 'legacy', NADA de este archivo cambia el comportamiento actual
   de la app — el login PIN sigue siendo la única autoridad real (ver
   app.js, renderLogin()). Este módulo es la base para activar
   AUTH_MODE = 'supabase' en una etapa posterior — ver
   docs/AUTH_RLS_MIGRATION_DESIGN.md / docs/AUTH_RLS_IMPLEMENTATION_PLAN.md.

   Diseño: SIN @supabase/supabase-js (mismo criterio que sync.js: fetch
   crudo contra los endpoints REST de Supabase, sin SDK) — llama
   directamente a /auth/v1/token (GoTrue) y a /rest/v1/app_profiles
   (PostgREST), reutilizando el mismo cfg.url/cfg.anonKey que ya usa Sync
   (DB.getConfig()). SOLO ANON/PUBLISHABLE key en cliente — NUNCA
   service_role (la creación de usuarios reales es responsabilidad de una
   Edge Function server-side, ver docs/AUTH_RLS_IMPLEMENTATION_PLAN.md
   §11 — nunca de este archivo ni de app.js).
   ============================================================ */

// Feature flag central — único punto de la app que decide el modo de
// autenticación, mismo patrón que GREASE_VALIDATION_ENABLED_FROM
// (src/core/grease-validation.js): una sola constante, nadie más la
// repite. 'legacy' = comportamiento anterior (PIN, sin Auth).
//
// CUTOVER PREPARADO (docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §26-§27) — este
// commit deja 'supabase' como el default DEFINITIVO del código, pero SIGUE
// SIN DESPLEGARSE: no se ha hecho `npm run build:web` para publicar, no se
// instaló en ningún dispositivo real desde este cambio, no se hizo push, y
// la policy legacy de `engrase_sync` (RLS) SIGUE ABIERTA en producción —
// ver 0003_auth_rls_CUTOVER_PREPARED.sql (NO ejecutado). El código de este
// repositorio y lo que corre hoy en producción son DOS COSAS DISTINTAS
// hasta que alguien ejecute el orden de despliegue documentado en §27.
//
// ADVERTENCIA OPERATIVA REAL (verificada por consulta a producción el
// mismo día de este commit): app_profiles tiene EXACTAMENTE 1 fila real
// (Junior Valles, ADMINISTRADOR). Ningún otro rol (SUPERVISOR/
// PLANIFICADOR/LUBRICADOR/VISOR) tiene todavía una cuenta Auth real. En
// AUTH_MODE='supabase' el login PIN legacy queda INACCESIBLE (ver
// app.js, branch de Auth.isSupabaseMode() en el listener de
// DOMContentLoaded) — publicar/instalar este código TAL CUAL, antes de
// crear cuentas Auth reales para el resto del personal, los dejaría sin
// poder entrar a la app. NO desplegar sin resolver esto primero.
const AUTH_MODE = 'supabase';

const AUTH_VALID_ROLES = ['ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR', 'LUBRICADOR', 'VISOR'];

// Dominio del identificador Auth interno — ver
// docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §3/§5 (Opción B: email sintético
// administrado por la propia operación, nunca un correo real de la
// persona). Único lugar donde se repite este dominio.
const AUTH_IDENTIFIER_DOMAIN = 'engrase.internal';

// username (lo que la persona escribe) -> identificador Auth interno (lo
// que Supabase Auth usa por debajo como "email"). Pura, testeable, sin
// red ni DOM — la UI nunca muestra ni pide el resultado de esta función.
// Rechaza cualquier "@" ya presente (el diseño asume username SIN
// dominio; si alguien escribe uno, es un error de input a corregir, no
// un email real a respetar) y cualquier espacio.
function usernameToAuthIdentifier(username) {
  if (typeof username !== 'string') {
    throw new Error('El nombre de usuario debe ser texto.');
  }
  const clean = username.trim().toLowerCase();
  if (!clean) {
    throw new Error('El nombre de usuario no puede estar vacío.');
  }
  if (clean.includes('@')) {
    throw new Error('El nombre de usuario no debe incluir "@" — se agrega automáticamente.');
  }
  if (/\s/.test(clean)) {
    throw new Error('El nombre de usuario no puede tener espacios.');
  }
  if (!/^[a-z0-9._-]+$/.test(clean)) {
    throw new Error('El nombre de usuario solo puede tener letras, números, punto, guion y guion bajo.');
  }
  return `${clean}@${AUTH_IDENTIFIER_DOMAIN}`;
}

// Clasifica un status de respuesta de Supabase (Auth o PostgREST) que
// indica rechazo de autenticación/autorización — NUNCA el CAS de P0-1
// (que siempre responde 200 con 0 filas ante un conflicto de versión,
// jamás 401/403; ver sync.js pushAll()/pullAll()). Se prepara ahora para
// cuando AUTH_MODE='supabase' esté activo — con la anon key legacy actual
// esto no se dispara en la práctica (la policy vigente acepta cualquier
// request con esa key, ver schema.sql).
function classifyAuthStatus(status) {
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 403) return 'AUTH_FORBIDDEN';
  return null;
}

// Perfil válido = existe, activo, y su role es uno de los 5 reales —
// pura, sin red. Único criterio de "¿esta persona puede usar la app?"
// (ver docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §6): sin fila -> false, activo
// !== true -> false (incluye undefined/otros valores, nunca "permitido
// por omisión"), role fuera de la lista -> false.
function isValidProfile(profile) {
  return !!profile && profile.active === true && AUTH_VALID_ROLES.includes(profile.role);
}

const Auth = {
  _session: null, // { accessToken, refreshToken, expiresAt, authUserId } en memoria
  _profile: null, // { authUserId, appUserId, displayName, role, active } en memoria
  listeners: [],

  getMode() { return AUTH_MODE; },
  isSupabaseMode() { return AUTH_MODE === 'supabase'; },

  onAuthStateChange(fn) { this.listeners.push(fn); },
  _notify(state) { this.listeners.forEach(fn => { try { fn(state); } catch (e) {} }); },

  // Autenticado de verdad = sesión con token VIGENTE (no expirado) Y
  // perfil válido (§6). Dos cosas que a propósito NUNCA se confunden:
  //   - un snapshot de perfil cacheado (getProfile()) es solo UX offline
  //     — nunca alcanza por sí solo para que esto devuelva true.
  //   - un access_token presente pero YA EXPIRADO tampoco alcanza: sin
  //     esta comprobación de `expiresAt`, sync.js podría creer que puede
  //     escribir y solo enterarse del 401 después de gastar una llamada
  //     de red. Con la comprobación, el gate de sync.js corta ANTES de
  //     tocar la red — "captura local permitida, sync bloqueado" (ver
  //     restoreSession()) se cumple exactamente por esto.
  isAuthenticated() {
    return !!(
      this._session && this._session.accessToken &&
      this._session.expiresAt && Date.now() < this._session.expiresAt &&
      isValidProfile(this._profile)
    );
  },

  getSession() { return this._session; },
  getProfile() { return this._profile; },

  // Login real contra Supabase Auth (GoTrue) — solo se llama cuando
  // AUTH_MODE='supabase' (la UI legacy nunca la invoca). Usa la ANON key
  // ya configurada (igual que el resto de la app) — nunca service_role.
  async signIn(username, password) {
    const identifier = usernameToAuthIdentifier(username);
    const cfg = await DB.getConfig();
    if (!cfg || !cfg.url || !cfg.anonKey) throw new Error('Sincronización no configurada.');

    const resp = await fetchWithTimeout(`${cfg.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey },
      body: JSON.stringify({ email: identifier, password })
    });
    if (classifyAuthStatus(resp.status) || !resp.ok) {
      throw new Error('Usuario o contraseña incorrectos.');
    }
    const data = await resp.json();
    this._session = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in || 0) * 1000,
      authUserId: data.user && data.user.id
    };

    const profile = await this._fetchProfile(cfg);
    if (!isValidProfile(profile)) {
      // Sesión Auth válida pero sin perfil usable (§6: sin fila, inactivo,
      // o rol inválido) -> se niega el acceso a la app y se limpia TODO —
      // nunca se deja una sesión Auth "a medias" sin perfil que la respalde.
      await this.signOut();
      throw new Error('Esta cuenta no tiene un perfil activo en la aplicación.');
    }
    this._profile = profile;
    await this._persistState();
    this._notify({ status: 'signed_in', profile: this._profile });
    return { user: this._profile, session: this._session };
  },

  async signOut() {
    this._session = null;
    this._profile = null;
    // Borra los DOS namespaces — nunca alcanza con limpiar uno solo:
    // dejar el snapshot de perfil vivo tras un logout mostraría "sigo
    // siendo Junior Valles" en pantalla sin ninguna sesión real detrás.
    await DB.setAuthTokens(null);
    await DB.setAuthProfileSnapshot(null);
    this._notify({ status: 'signed_out' });
  },

  // Al boot: recupera la sesión guardada localmente (equivalente a
  // persistSession:true sin SDK, ver cabecera del archivo). Si el token
  // cacheado sigue vigente, se restaura tal cual. Si ya expiró:
  //   - con red: refresca sesión + perfil ANTES de devolver nada válido
  //     (nunca se sincroniza con una sesión que no se intentó refrescar
  //     primero — ver docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §12).
  //   - sin red: se permite seguir mostrando el snapshot local
  //     ("trabajando como <nombre>") para UX offline, pero queda en
  //     'pending_validation' — isAuthenticated() sigue dependiendo del
  //     perfil ya cacheado, sync.js decide aparte si permite escribir.
  async restoreSession() {
    const session = await DB.getAuthTokens();
    if (!session) return null;
    this._session = session;
    this._profile = await DB.getAuthProfileSnapshot();

    const stillValid = this._session.expiresAt && Date.now() < this._session.expiresAt;
    if (stillValid) {
      this._notify({ status: 'restored', profile: this._profile });
      return { user: this._profile, session: this._session };
    }

    if (!navigator.onLine) {
      // Token cacheado ya expirado y sin red: isAuthenticated() ya da
      // false por la comprobación de expiresAt (arriba) — esto NO
      // bloquea que la persona siga registrando trabajo localmente
      // (getProfile() sigue devolviendo el snapshot para mostrar "quién
      // es"), solo bloquea que sync.js intente escribir con un token que
      // el servidor va a rechazar.
      this._notify({ status: 'pending_validation', profile: this._profile });
      return { user: this._profile, session: this._session };
    }

    try {
      await this._refreshSession();
      await this.refreshProfile();
      this._notify({ status: 'restored', profile: this._profile });
      return { user: this._profile, session: this._session };
    } catch (e) {
      if (!e.authRejected && isNetworkFailure(e)) {
        // Backend no disponible ahora mismo (navigator.onLine=true no lo
        // garantiza — ver Bloque B, hallazgo real del piloto Android).
        // NUNCA se trata como refresh token inválido: no se cierra sesión,
        // no se borran tokens/snapshot. El snapshot cacheado sigue
        // disponible para UX offline (mismo criterio que la rama "sin red"
        // de arriba); sync.js decide aparte (vía isAuthenticated(), que
        // sigue dando false con el token sin refrescar) si eso alcanza
        // para sincronizar — nunca sincroniza "a medias".
        this._notify({ status: 'pending_validation', profile: this._profile });
        return { user: this._profile, session: this._session };
      }
      // Rechazo REAL del servidor (refresh token inválido/revocado) -> ya
      // no hay sesión confiable; se limpia y se exige login real de nuevo
      // (nunca fallback a anon).
      await this.signOut();
      return null;
    }
  },

  // Vuelve a consultar app_profiles — se llama SIEMPRE al reconectar,
  // ANTES de permitir que sync.js sincronice (ver docs/
  // AUTH_RLS_IMPLEMENTATION_PLAN.md §12), para que un cambio de
  // rol/estado hecho desde OTRO dispositivo tome efecto de inmediato en
  // vez de seguir confiando en el snapshot local viejo.
  async refreshProfile() {
    const cfg = await DB.getConfig();
    try {
      const profile = await this._fetchProfile(cfg);
      this._profile = profile; // puede quedar null/inactivo -> isAuthenticated() pasa a false
      await this._persistState();
      return this._profile;
    } catch (e) {
      // Backend no disponible (ver _fetchProfile() más abajo) — se
      // conserva el perfil YA cacheado tal cual, en memoria y en DB: un
      // problema de red nunca debe leerse como "esta persona perdió su
      // perfil" (Bloque B, pre-cutover).
      if (isNetworkFailure(e)) return this._profile;
      throw e;
    }
  },

  // Administración de usuarios reales (P0-2) — SIEMPRE pasa por la Edge
  // Function server-side (supabase/functions/manage-users), nunca habla
  // directo con auth.admin.* ni con service_role desde el cliente (esa
  // llave NUNCA existe en app.js/Android/IndexedDB). Solo envía el JWT
  // propio de la sesión ya autenticada — la Edge Function es quien vuelve
  // a validar server-side que quien llama es ADMINISTRADOR activo, nunca
  // se confía en el rol local. Requiere red: sin sesión autenticada
  // (offline o sesión no vigente) lanza sin intentar la llamada.
  // FIX formulario "Agregar usuario". Auditoría: el wiring con la Edge
  // Function ya era correcto — el problema real era que esta función
  // lanzaba mensajes ya redactados a medias, mezclados con códigos crudos
  // del servidor, y una falla de red antes de tener respuesta ni se
  // capturaba: el error crudo de fetch llegaba directo a la UI. Ahora
  // SIEMPRE lanza un CÓDIGO estable como `message`, nunca una frase ya
  // traducida. La traducción a texto legible vive en la capa de UI
  // (app.js, función manageUsersErrorMessage), una sola vez, para las 4
  // pantallas que llaman esto en vez de repetir el mapeo en cada una.
  async manageUsers(action, payload = {}) {
    if (!this.isAuthenticated()) {
      throw new Error('AUTH_REQUIRED');
    }
    const cfg = await DB.getConfig();
    if (!cfg || !cfg.url || !cfg.anonKey) throw new Error('SYNC_NOT_CONFIGURED');
    let resp;
    try {
      resp = await fetchWithTimeout(`${cfg.url}/functions/v1/manage-users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: cfg.anonKey,
          Authorization: `Bearer ${this._session.accessToken}`
        },
        body: JSON.stringify({ action, ...payload })
      });
    } catch (e) {
      // Nunca deja la excepción cruda de fetch llegar a la UI — mismo
      // criterio de clasificación ya usado en el resto de este archivo
      // (isNetworkFailure(), db.js). AbortSignal.timeout() dispara
      // AbortError/TimeoutError específicamente por plazo agotado.
      if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) throw new Error('TIMEOUT');
      throw new Error('NETWORK');
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error((data && data.error) || `HTTP_${resp.status}`);
    }
    return data;
  },

  async _fetchProfile(cfg) {
    if (!this._session || !this._session.accessToken) return null;
    try {
      const resp = await fetchWithTimeout(
        `${cfg.url}/rest/v1/app_profiles?select=auth_user_id,app_user_id,display_name,role,active`,
        { headers: { apikey: cfg.anonKey, Authorization: `Bearer ${this._session.accessToken}` } }
      );
      if (classifyAuthStatus(resp.status) || !resp.ok) return null;
      const rows = await resp.json();
      if (!rows.length) return null; // sin perfil -> acceso denegado (§6)
      const p = rows[0];
      return {
        authUserId: p.auth_user_id, appUserId: p.app_user_id,
        displayName: p.display_name, role: p.role, active: p.active === true
      };
    } catch (e) {
      // Backend no disponible ahora mismo (red/timeout, ver Bloque B
      // pre-cutover) — NUNCA se confunde con "no tiene perfil" (§6): se
      // re-lanza para que refreshProfile() conserve el último perfil ya
      // confirmado en vez de reemplazarlo por null. Cualquier otra
      // excepción sí devuelve null (comportamiento de siempre).
      if (isNetworkFailure(e)) throw e;
      return null;
    }
  },

  async _refreshSession() {
    const cfg = await DB.getConfig();
    if (!this._session || !this._session.refreshToken) throw new Error('Sin refresh token.');
    const resp = await fetchWithTimeout(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey },
      body: JSON.stringify({ refresh_token: this._session.refreshToken })
    });
    if (!resp.ok) {
      // Rechazo REAL del servidor (401 típico: refresh token inválido o
      // revocado) — nunca una falla de red, esas nunca llegan a tener
      // `resp` (ver restoreSession(), que distingue por este flag).
      const err = new Error(`No se pudo refrescar la sesión: ${resp.status}`);
      err.authRejected = true;
      throw err;
    }
    const data = await resp.json();
    this._session = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in || 0) * 1000,
      authUserId: (data.user && data.user.id) || this._session.authUserId
    };
    await this._persistState();
  },

  // Persistencia local — equivalente a persistSession:true sin SDK (ver
  // cabecera del archivo): DOS namespaces SEPARADOS en app_config
  // (LOCAL_STORES, NUNCA sincroniza — nunca viaja por pushAll()/
  // pullAll()), nunca mezclados en el mismo blob:
  //   - auth_tokens: SOLO credenciales (access/refresh token, expiry).
  //   - auth_profile_snapshot: SOLO datos de UX offline (nombre/rol/
  //     estado + lastVerifiedAt) — NUNCA es autoridad de servidor por sí
  //     solo, isAuthenticated() exige además un token vigente (arriba).
  // Ninguno de los dos contiene jamás la password (esa nunca sale de
  // signIn(), no se guarda en ningún lado del cliente) ni PIN alguno.
  // detectSessionInUrl no aplica: esta app nunca usa magic links, no hay
  // tokens en la URL que detectar.
  async _persistState() {
    await DB.setAuthTokens(this._session);
    await DB.setAuthProfileSnapshot(
      this._profile ? { ...this._profile, lastVerifiedAt: nowISO() } : null
    );
  }
};
