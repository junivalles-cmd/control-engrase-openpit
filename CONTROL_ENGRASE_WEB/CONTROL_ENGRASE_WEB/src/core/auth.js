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
// repite. 'legacy' = comportamiento actual (PIN, sin Auth, sin cambios).
// 'supabase' = Auth real — NO se activa en este cierre.
const AUTH_MODE = 'legacy';

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

  // Autenticado de verdad = sesión con token Y perfil válido (§6) — una
  // sesión Auth sin perfil usable NUNCA cuenta como autenticado para el
  // resto de la app, aunque el JWT en sí sea válido.
  isAuthenticated() {
    return !!(this._session && this._session.accessToken && isValidProfile(this._profile));
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

    const resp = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
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
    await DB.setAuthState(null);
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
    const state = await DB.getAuthState();
    if (!state || !state.session) return null;
    this._session = state.session;
    this._profile = state.profile || null;

    const stillValid = this._session.expiresAt && Date.now() < this._session.expiresAt;
    if (stillValid) {
      this._notify({ status: 'restored', profile: this._profile });
      return { user: this._profile, session: this._session };
    }

    if (!navigator.onLine) {
      this._notify({ status: 'pending_validation', profile: this._profile });
      return { user: this._profile, session: this._session };
    }

    try {
      await this._refreshSession();
      await this.refreshProfile();
      this._notify({ status: 'restored', profile: this._profile });
      return { user: this._profile, session: this._session };
    } catch (e) {
      // Refresh token inválido/expirado -> ya no hay sesión confiable;
      // se limpia y se exige login real de nuevo (nunca fallback a anon).
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
    const profile = await this._fetchProfile(cfg);
    this._profile = profile; // puede quedar null/inactivo -> isAuthenticated() pasa a false
    await this._persistState();
    return this._profile;
  },

  async _fetchProfile(cfg) {
    if (!this._session || !this._session.accessToken) return null;
    try {
      const resp = await fetch(
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
      return null;
    }
  },

  async _refreshSession() {
    const cfg = await DB.getConfig();
    if (!this._session || !this._session.refreshToken) throw new Error('Sin refresh token.');
    const resp = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey },
      body: JSON.stringify({ refresh_token: this._session.refreshToken })
    });
    if (!resp.ok) throw new Error(`No se pudo refrescar la sesión: ${resp.status}`);
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
  // cabecera del archivo): se guarda en app_config (LOCAL_STORES, NUNCA
  // sincroniza — DB.getAuthState()/setAuthState() son nuevos en db.js,
  // mismo patrón que getSyncConflicts()/recordConflicts() de P0-1).
  // `lastVerifiedAt` es el snapshot mínimo de UX offline pedido: permite
  // mostrar "trabajando como <nombre>" sin red, pero NUNCA es autoridad
  // de servidor por sí solo — isAuthenticated() sigue exigiendo un
  // perfil válido, y sync.js decide aparte si con eso alcanza para
  // escribir (ver Auth.getMode()/isAuthenticated() en sync.js).
  // detectSessionInUrl no aplica: esta app nunca usa magic links, no hay
  // tokens en la URL que detectar.
  async _persistState() {
    await DB.setAuthState({
      session: this._session,
      profile: this._profile,
      lastVerifiedAt: nowISO()
    });
  }
};
