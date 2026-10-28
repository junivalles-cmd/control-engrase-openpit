// tests/unit/auth.test.js
//
// P0-2 Etapa B1 — capa cliente de Supabase Auth, detrás de AUTH_MODE
// ('legacy' por defecto). Todo con mocks (DB/fetch/navigator en memoria) —
// NUNCA llamadas reales a Supabase, ver docs/AUTH_RLS_IMPLEMENTATION_PLAN.md.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadAuthLogic } from '../helpers/loadLubricationLogic.js';

function makeFakeDB() {
  let config = null;
  let tokens = null;
  let profileSnapshot = null;
  const authorizationContexts = new Map();
  return {
    async getConfig() { return config; },
    async setConfig(v) { config = v; return v; },
    async getAuthTokens() { return tokens; },
    async setAuthTokens(v) { tokens = v; return v; },
    async getAuthProfileSnapshot() { return profileSnapshot; },
    async setAuthProfileSnapshot(v) { profileSnapshot = v; return v; },
    async getAuthorizationContext(appUserId) { return authorizationContexts.get(appUserId) || null; },
    async setAuthorizationContext(appUserId, v) { if (v == null) authorizationContexts.delete(appUserId); else authorizationContexts.set(appUserId, v); return v; },
    // Solo para inspección en los tests (nunca lo usa auth.js en sí).
    _dump() { return { config, tokens, profileSnapshot, authorizationContexts: [...authorizationContexts] }; },
  };
}

const CFG = { url: 'https://fake.test', anonKey: 'anon-test' };

let db, Auth, usernameToAuthIdentifier, classifyAuthStatus, isValidProfile;

beforeEach(async () => {
  db = makeFakeDB();
  await db.setConfig(CFG);
  ({ Auth, usernameToAuthIdentifier, classifyAuthStatus, isValidProfile } = loadAuthLogic(db));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('A/B) usernameToAuthIdentifier() — mapeo puro username -> identificador Auth', () => {
  it('A) username simple -> identificador correcto', () => {
    expect(usernameToAuthIdentifier('jvalles')).toBe('jvalles@engrase.internal');
  });
  it('A) normaliza mayúsculas y espacios alrededor', () => {
    expect(usernameToAuthIdentifier('  JVALLES  ')).toBe('jvalles@engrase.internal');
  });
  it('B) rechaza vacío/solo espacios', () => {
    expect(() => usernameToAuthIdentifier('   ')).toThrow();
  });
  it('B) rechaza "@" ya presente (no es un email real a respetar)', () => {
    expect(() => usernameToAuthIdentifier('jvalles@gmail.com')).toThrow();
  });
  it('B) rechaza espacios internos', () => {
    expect(() => usernameToAuthIdentifier('j valles')).toThrow();
  });
  it('B) rechaza caracteres no permitidos', () => {
    expect(() => usernameToAuthIdentifier('jvalles!')).toThrow();
  });
  it('B) rechaza valores no-string', () => {
    expect(() => usernameToAuthIdentifier(1234)).toThrow();
  });
});

describe('classifyAuthStatus() — nunca se confunde con el CAS de P0-1', () => {
  it('401 -> AUTH_REQUIRED', () => { expect(classifyAuthStatus(401)).toBe('AUTH_REQUIRED'); });
  it('403 -> AUTH_FORBIDDEN', () => { expect(classifyAuthStatus(403)).toBe('AUTH_FORBIDDEN'); });
  it('200 (éxito o 0 filas CAS) -> null', () => { expect(classifyAuthStatus(200)).toBeNull(); });
});

describe('D/E/F) isValidProfile() — único criterio de "puede usar la app"', () => {
  it('perfil activo con rol válido -> true', () => {
    expect(isValidProfile({ active: true, role: 'ADMINISTRADOR' })).toBe(true);
  });
  it('D) sin perfil (null, ninguna fila en app_profiles) -> false', () => {
    expect(isValidProfile(null)).toBe(false);
  });
  it('E) perfil inactivo -> false', () => {
    expect(isValidProfile({ active: false, role: 'ADMINISTRADOR' })).toBe(false);
  });
  it('F) rol fuera de los 5 válidos -> false', () => {
    expect(isValidProfile({ active: true, role: 'SUPERUSUARIO' })).toBe(false);
  });
});

describe('M) AUTH_MODE por defecto — cutover preparado (docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §26)', () => {
  it('Auth.getMode() === "supabase" y Auth.isSupabaseMode() === true — default definitivo, AÚN NO desplegado', () => {
    expect(Auth.getMode()).toBe('supabase');
    expect(Auth.isSupabaseMode()).toBe(true);
  });
  it('sin sesión restaurada, isAuthenticated() es false', () => {
    expect(Auth.isAuthenticated()).toBe(false);
  });
});

describe('C/D/E) signIn()', () => {
  it('C) Auth ok + perfil activo con rol válido -> acceso concedido', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/auth/v1/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, user: { id: 'auth-uid-1' } }) };
      }
      if (String(url).includes('/rest/v1/app_profiles')) {
        return { ok: true, status: 200, json: async () => ([{ auth_user_id: 'auth-uid-1', app_user_id: 'u_jvalles', display_name: 'Junior Valles', role: 'ADMINISTRADOR', active: true }]) };
      }
      throw new Error('unexpected fetch ' + url);
    }));

    const result = await Auth.signIn('jvalles', 'whatever');
    expect(result.user.role).toBe('ADMINISTRADOR');
    expect(result.user.displayName).toBe('Junior Valles');
    expect(Auth.isAuthenticated()).toBe(true);
  });

  it('D) Auth ok pero SIN fila en app_profiles -> acceso denegado, sesión limpiada', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/auth/v1/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, user: { id: 'x' } }) };
      if (String(url).includes('/rest/v1/app_profiles')) return { ok: true, status: 200, json: async () => ([]) };
      throw new Error('unexpected fetch ' + url);
    }));

    await expect(Auth.signIn('nadie', 'x')).rejects.toThrow();
    expect(Auth.isAuthenticated()).toBe(false);
    expect(Auth.getSession()).toBeNull();
  });

  it('E) perfil inactivo -> acceso denegado, sesión limpiada', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/auth/v1/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, user: { id: 'x' } }) };
      if (String(url).includes('/rest/v1/app_profiles')) return { ok: true, status: 200, json: async () => ([{ auth_user_id: 'x', app_user_id: 'u_x', display_name: 'X', role: 'LUBRICADOR', active: false }]) };
      throw new Error('unexpected fetch ' + url);
    }));

    await expect(Auth.signIn('x', 'y')).rejects.toThrow();
    expect(Auth.isAuthenticated()).toBe(false);
  });

  it('username inválido: signIn ni siquiera llama a fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(Auth.signIn('con espacio', 'x')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const SESSION_VIGENTE = { accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 100000, authUserId: 'u1' };
const SESSION_EXPIRADA = { accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() - 1000, authUserId: 'u1' };
const PERFIL_ADMIN = { authUserId: 'u1', appUserId: 'u_jvalles', displayName: 'Junior Valles', role: 'ADMINISTRADOR', active: true };

describe('restoreSession() — sesión vigente vs. expirada', () => {
  it('sesión vigente cacheada -> se restaura sin ninguna llamada de red', async () => {
    await db.setAuthTokens(SESSION_VIGENTE);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no debería llamar a fetch'); }));

    const result = await Auth.restoreSession();
    expect(result.user.role).toBe('ADMINISTRADOR');
    expect(Auth.isAuthenticated()).toBe(true);
  });

  it('sin sesión guardada -> null, sin llamar a fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no debería llamar a fetch'); }));
    expect(await Auth.restoreSession()).toBeNull();
  });
});

describe('A) login online -> cerrar app -> abrir offline -> identidad recuperada', () => {
  it('una instancia NUEVA de Auth (simula reabrir la app) recupera el perfil desde DB, sin red', async () => {
    // 1) Login online en la "sesión anterior" de la app.
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/auth/v1/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, user: { id: 'u1' } }) };
      if (String(url).includes('/rest/v1/app_profiles')) return { ok: true, status: 200, json: async () => ([{ auth_user_id: 'u1', app_user_id: 'u_jvalles', display_name: 'Junior Valles', role: 'ADMINISTRADOR', active: true }]) };
      throw new Error('unexpected fetch ' + url);
    }));
    await Auth.signIn('jvalles', 'lo-que-sea');

    // 2) "Cerrar la app": una instancia de Auth completamente nueva, sin
    // nada en memoria — solo lo que quedó en `db` (IndexedDB real en
    // producción) sobrevive. loadAuthLogic() vuelve a ejecutar el módulo
    // desde cero, igual que recargar la página/reabrir la app.
    const fresh = loadAuthLogic(db).Auth;

    // 3) "Abrir offline": sin red, sin tiempo transcurrido (token sigue
    // vigente) -> debe recuperar identidad sin ningún fetch.
    vi.stubGlobal('navigator', { onLine: false });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no debería llamar a fetch'); }));

    const result = await fresh.restoreSession();
    expect(result.user.displayName).toBe('Junior Valles');
    expect(fresh.isAuthenticated()).toBe(true);
  });
});

describe('B) la password NUNCA aparece en ningún storage local', () => {
  it('tras signIn(), ningún valor guardado en DB contiene la password', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/auth/v1/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, user: { id: 'u1' } }) };
      if (String(url).includes('/rest/v1/app_profiles')) return { ok: true, status: 200, json: async () => ([{ auth_user_id: 'u1', app_user_id: 'u_jvalles', display_name: 'Junior Valles', role: 'ADMINISTRADOR', active: true }]) };
      throw new Error('unexpected fetch ' + url);
    }));

    const PASSWORD_SECRETA = 'un-password-muy-secreto-123';
    await Auth.signIn('jvalles', PASSWORD_SECRETA);

    const dump = JSON.stringify(db._dump());
    expect(dump).not.toContain(PASSWORD_SECRETA);
    expect(dump.toLowerCase()).not.toContain('password');
  });
});

describe('C) refresh_token permanece SOLO en el namespace de tokens, nunca en el snapshot de perfil', () => {
  it('auth_tokens tiene refreshToken; auth_profile_snapshot NUNCA tiene esa clave', async () => {
    await db.setAuthTokens(SESSION_VIGENTE);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    await Auth.restoreSession();

    const tokens = await db.getAuthTokens();
    const snapshot = await db.getAuthProfileSnapshot();
    expect(tokens.refreshToken).toBe('RT');
    expect(snapshot).not.toHaveProperty('refreshToken');
    expect(snapshot).not.toHaveProperty('accessToken');
  });
});

describe('D) signOut() borra tokens Y snapshot de perfil — los dos namespaces', () => {
  it('después de signOut, ambos quedan en null', async () => {
    await db.setAuthTokens(SESSION_VIGENTE);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    await Auth.restoreSession();
    expect(Auth.isAuthenticated()).toBe(true);

    await Auth.signOut();

    expect(await db.getAuthTokens()).toBeNull();
    expect(await db.getAuthProfileSnapshot()).toBeNull();
    expect(Auth.isAuthenticated()).toBe(false);
    expect(Auth.getProfile()).toBeNull();
  });
});

describe('E) access token expirado + offline -> captura local permitida, sync bloqueado', () => {
  it('isAuthenticated() es false (bloquea sync), pero getProfile() sigue disponible (permite mostrar identidad/capturar local)', async () => {
    await db.setAuthTokens(SESSION_EXPIRADA);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    vi.stubGlobal('navigator', { onLine: false });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no debería llamar a fetch estando offline'); }));

    const result = await Auth.restoreSession();
    expect(result.user.displayName).toBe('Junior Valles'); // snapshot de UX, visible sin red
    expect(Auth.getProfile().displayName).toBe('Junior Valles'); // "trabajando como..." sigue mostrable
    expect(Auth.isAuthenticated()).toBe(false); // pero NO autoriza sync — token expirado
  });
});

describe('F) reconnect + refresh correcto -> sync vuelve a habilitarse', () => {
  it('llama refresh_token y luego app_profiles, en ese orden, y queda autenticado de nuevo', async () => {
    await db.setAuthTokens(SESSION_EXPIRADA);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    vi.stubGlobal('navigator', { onLine: true });
    const callOrder = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('grant_type=refresh_token')) {
        callOrder.push('refresh');
        return { ok: true, status: 200, json: async () => ({ access_token: 'NEW', refresh_token: 'RT2', expires_in: 3600, user: { id: 'u1' } }) };
      }
      if (String(url).includes('/rest/v1/app_profiles')) {
        callOrder.push('profile');
        return { ok: true, status: 200, json: async () => ([{ auth_user_id: 'u1', app_user_id: 'u_jvalles', display_name: 'Junior Valles', role: 'ADMINISTRADOR', active: true }]) };
      }
      throw new Error('unexpected fetch ' + url);
    }));

    const result = await Auth.restoreSession();
    expect(callOrder).toEqual(['refresh', 'profile']); // NUNCA sync antes de esto (ver sync.js)
    expect(result.session.accessToken).toBe('NEW');
    expect(Auth.isAuthenticated()).toBe(true); // sync queda habilitado de nuevo
  });
});

describe('G) refresh inválido -> se limpia la sesión, exige login real (nunca fallback a anon)', () => {
  it('restoreSession() devuelve null, isAuthenticated() queda false, tokens borrados', async () => {
    await db.setAuthTokens({ ...SESSION_EXPIRADA, refreshToken: 'RT-MALO' });
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('grant_type=refresh_token')) return { ok: false, status: 401, json: async () => ({}) };
      throw new Error('unexpected fetch ' + url);
    }));

    expect(await Auth.restoreSession()).toBeNull();
    expect(Auth.isAuthenticated()).toBe(false);
    expect(await db.getAuthTokens()).toBeNull();
    expect(await db.getAuthProfileSnapshot()).toBeNull();
    // La contraparte "dirty intacto en sync.js" se prueba en
    // tests/unit/sync-auth-gate.test.js (este módulo no conoce STORES).
  });
});

describe('refreshProfile() — rol/estado cambiado en otro dispositivo toma efecto de inmediato', () => {
  it('perfil ahora inactivo -> isAuthenticated() pasa a false sin necesidad de signOut manual', async () => {
    await db.setAuthTokens(SESSION_VIGENTE);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    await Auth.restoreSession();
    expect(Auth.isAuthenticated()).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/rest/v1/app_profiles')) {
        return { ok: true, status: 200, json: async () => ([{ auth_user_id: 'u1', app_user_id: 'u_jvalles', display_name: 'Junior Valles', role: 'ADMINISTRADOR', active: false }]) };
      }
      throw new Error('unexpected fetch ' + url);
    }));

    await Auth.refreshProfile();
    expect(Auth.isAuthenticated()).toBe(false);
  });
});

describe('authorization bootstrap — scope is account-namespaced and server-issued', () => {
  const context = fingerprint => ({
    status:'AUTHORIZED',context:{authUserId:'u1',appUserId:'u_jvalles',displayName:'Junior Valles',
      role:'ADMINISTRADOR',active:true,scopeType:'GLOBAL',authorizedCrewIds:['c1'],
      authorizedLocationIds:['l1'],authorizationFingerprint:fingerprint,rowScopeEnforced:false}
  });
  it('stores the first authenticated snapshot under its app user and reports firstSnapshot', async () => {
    await db.setAuthTokens(SESSION_VIGENTE);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    await Auth.restoreSession();
    vi.stubGlobal('fetch',vi.fn(async (url,options)=>{
      expect(String(url)).toContain('/rpc/get_authorization_context');
      expect(options.headers.Authorization).toBe('Bearer AT');
      return {ok:true,status:200,json:async()=>context('fp-a')};
    }));
    const result=await Auth.refreshAuthorizationContext();
    expect(result).toMatchObject({ok:true,firstSnapshot:true,changed:false});
    expect(await db.getAuthorizationContext('u_jvalles')).toMatchObject({authorizationFingerprint:'fp-a',rowScopeEnforced:false});
    expect(Auth.getProfile().authorizationFingerprint).toBe('fp-a');
  });
  it('returns stable and changed fingerprints without mixing another account', async () => {
    await db.setAuthTokens(SESSION_VIGENTE);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    await db.setAuthorizationContext('u_jvalles',context('fp-a').context);
    await db.setAuthorizationContext('u_other',{appUserId:'u_other',authorizationFingerprint:'other'});
    await Auth.restoreSession();
    let fp='fp-a';
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,json:async()=>context(fp)})));
    expect(await Auth.refreshAuthorizationContext()).toMatchObject({ok:true,changed:false,firstSnapshot:false});
    fp='fp-b';
    expect(await Auth.refreshAuthorizationContext()).toMatchObject({ok:true,changed:true,firstSnapshot:false});
    expect(await db.getAuthorizationContext('u_other')).toEqual({appUserId:'u_other',authorizationFingerprint:'other'});
  });
  it('blocks a structurally mismatched context and signs out', async () => {
    await db.setAuthTokens(SESSION_VIGENTE);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    await Auth.restoreSession();
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,json:async()=>({status:'AUTHORIZED',context:{authUserId:'other',appUserId:'u_jvalles',role:'ADMINISTRADOR',active:true,authorizationFingerprint:'x'}})})));
    expect(await Auth.refreshAuthorizationContext()).toMatchObject({ok:false,reason:'AUTHORIZATION_CONTEXT_MISMATCH'});
    expect(Auth.isAuthenticated()).toBe(false);
  });
});

describe('O) Auth.manageUsers() — offline/sin sesión bloquea la administración, sin intentar red', () => {
  it('sin sesión autenticada, rechaza antes de llamar a fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(Auth.manageUsers('LIST_USERS')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con sesión autenticada, reenvía el JWT propio a la Edge Function (nunca service_role, nunca la anon key sola)', async () => {
    await db.setAuthTokens(SESSION_VIGENTE);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    await Auth.restoreSession();
    expect(Auth.isAuthenticated()).toBe(true);

    let sentAuthHeader = null;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      sentAuthHeader = opts.headers.Authorization;
      return { ok: true, status: 200, json: async () => ({ users: [] }) };
    }));
    await Auth.manageUsers('LIST_USERS');
    expect(sentAuthHeader).toBe(`Bearer ${SESSION_VIGENTE.accessToken}`);
  });
});

describe('BUG-AUTH-001 (causa raíz real) — _fetchProfile() debe traer SIEMPRE el propio perfil, nunca "la primera fila visible por RLS"', () => {
  // Fila en forma "servidor" (snake_case, igual que PostgREST) — un
  // ADMINISTRADOR puede leer, por RLS, CUALQUIERA de estas filas, no solo
  // la propia. El mock honra el filtro auth_user_id=eq.<uid> cuando está
  // presente en la URL; SIN ese filtro devuelve TODAS las filas (así se
  // reproduce exactamente el bug viejo si algo regresa a omitir el filtro).
  const ROW_A = { auth_user_id: 'uid-A', app_user_id: 'u_adminA', display_name: 'Admin A', role: 'ADMINISTRADOR', active: true };
  const ROW_B = { auth_user_id: 'uid-B', app_user_id: 'u_adminB', display_name: 'Admin B', role: 'ADMINISTRADOR', active: true };
  function makeFetch(rows, { signInUid } = {}) {
    return vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('/auth/v1/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'AT-' + signInUid, refresh_token: 'RT-' + signInUid, expires_in: 3600, user: { id: signInUid } }) };
      }
      if (u.includes('/rest/v1/app_profiles')) {
        const m = u.match(/auth_user_id=eq\.([^&]+)/);
        const visible = m ? rows.filter(r => r.auth_user_id === decodeURIComponent(m[1])) : rows;
        return { ok: true, status: 200, json: async () => visible };
      }
      throw new Error('unexpected fetch ' + url);
    });
  }

  it('A) Admin A inicia sesión (único en el sistema) -> perfil A, PROFILE_AUTH_USER_ID_MATCH=true', async () => {
    vi.stubGlobal('fetch', makeFetch([ROW_A], { signInUid: 'uid-A' }));
    const res = await Auth.signIn('admina', 'x');
    expect(res.user.displayName).toBe('Admin A');
    expect(res.user.authUserId).toBe('uid-A');
    expect(Auth.getSession().authUserId).toBe('uid-A');
    expect(Auth.isAuthenticated()).toBe(true);
  });

  it('B) con AMBOS admins ya en el sistema, B inicia sesión -> trae el perfil de B, NUNCA el de A por ser rows[0] (reproduce y cierra BUG-AUTH-001)', async () => {
    // ROW_A primero en el arreglo a propósito: el bug viejo tomaba
    // rows[0] de una respuesta SIN filtrar -> habría devuelto A.
    vi.stubGlobal('fetch', makeFetch([ROW_A, ROW_B], { signInUid: 'uid-B' }));
    const res = await Auth.signIn('adminb', 'x');
    expect(res.user.displayName).toBe('Admin B'); // NUNCA 'Admin A'
    expect(res.user.authUserId).toBe('uid-B');
    expect(Auth.getProfile().authUserId).toBe(Auth.getSession().authUserId); // match real
  });

  it('C) A -> logout -> B -> "reload" (instancia nueva de Auth, mismo db) -> sigue siendo B, sin red', async () => {
    vi.stubGlobal('fetch', makeFetch([ROW_A, ROW_B], { signInUid: 'uid-A' }));
    await Auth.signIn('admina', 'x');
    await Auth.signOut();
    vi.stubGlobal('fetch', makeFetch([ROW_A, ROW_B], { signInUid: 'uid-B' }));
    await Auth.signIn('adminb', 'x');

    const fresh = loadAuthLogic(db).Auth; // simula reabrir la app
    vi.stubGlobal('navigator', { onLine: false });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no debería llamar a fetch'); }));
    const result = await fresh.restoreSession();
    expect(result.user.displayName).toBe('Admin B');
    expect(fresh.isAuthenticated()).toBe(true);
  });

  it('D) B -> logout -> A -> perfil A correcto (no quedó contaminado por el login anterior de B)', async () => {
    vi.stubGlobal('fetch', makeFetch([ROW_A, ROW_B], { signInUid: 'uid-B' }));
    await Auth.signIn('adminb', 'x');
    await Auth.signOut();
    vi.stubGlobal('fetch', makeFetch([ROW_A, ROW_B], { signInUid: 'uid-A' }));
    const res = await Auth.signIn('admina', 'x');
    expect(res.user.displayName).toBe('Admin A');
    expect(Auth.getProfile().authUserId).toBe('uid-A');
  });

  it('E) sesión válida de B + snapshot cacheado stale de A, online -> restoreSession() recupera el perfil REAL de B desde el servidor, NUNCA cierra sesión', async () => {
    await db.setAuthTokens({ accessToken: 'AT-B', refreshToken: 'RT-B', expiresAt: Date.now() + 3600000, authUserId: 'uid-B' });
    await db.setAuthProfileSnapshot({ authUserId: 'uid-A', appUserId: 'u_adminA', displayName: 'Admin A', role: 'ADMINISTRADOR', active: true }); // snapshot VIEJO, de otra cuenta
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', makeFetch([ROW_A, ROW_B]));

    const result = await Auth.restoreSession();
    expect(result.user.displayName).toBe('Admin B'); // reconciliado con el servidor, nunca con el snapshot viejo
    expect(Auth.isAuthenticated()).toBe(true); // NUNCA cerró sesión — pudo confirmar contra el backend
    const persisted = await db.getAuthProfileSnapshot();
    expect(persisted.authUserId).toBe('uid-B'); // el snapshot stale queda corregido, no solo ignorado en memoria
  });

  it('F) sesión válida pero el auth.uid no tiene ninguna fila en app_profiles -> rechazo controlado (signOut), nunca un acceso a medias', async () => {
    await db.setAuthTokens({ accessToken: 'AT-X', refreshToken: 'RT-X', expiresAt: Date.now() + 3600000, authUserId: 'uid-X' });
    await db.setAuthProfileSnapshot({ authUserId: 'uid-A', appUserId: 'u_adminA', displayName: 'Admin A', role: 'ADMINISTRADOR', active: true });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', makeFetch([ROW_A])); // uid-X no tiene fila

    const result = await Auth.restoreSession();
    expect(result).toBeNull();
    expect(Auth.isAuthenticated()).toBe(false);
    expect(await db.getAuthTokens()).toBeNull(); // signOut() real, limpia todo
  });

  it('G) el auth.uid SÍ tiene fila pero está inactive -> rechazo controlado (signOut), nunca se adopta un perfil inactivo', async () => {
    await db.setAuthTokens({ accessToken: 'AT-B', refreshToken: 'RT-B', expiresAt: Date.now() + 3600000, authUserId: 'uid-B' });
    await db.setAuthProfileSnapshot({ authUserId: 'uid-A', appUserId: 'u_adminA', displayName: 'Admin A', role: 'ADMINISTRADOR', active: true });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', makeFetch([ROW_A, { ...ROW_B, active: false }]));

    const result = await Auth.restoreSession();
    expect(result).toBeNull();
    expect(Auth.isAuthenticated()).toBe(false);
  });

  it('mismatch offline (sin red para reconciliar) -> sigue siendo conservador: cierra sesión, nunca atribuye el perfil de A a la sesión de B', async () => {
    await db.setAuthTokens({ accessToken: 'AT-B', refreshToken: 'RT-B', expiresAt: Date.now() + 3600000, authUserId: 'uid-B' });
    await db.setAuthProfileSnapshot({ authUserId: 'uid-A', appUserId: 'u_adminA', displayName: 'Admin A', role: 'ADMINISTRADOR', active: true });
    vi.stubGlobal('navigator', { onLine: false });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no debería llamar a fetch offline'); }));

    const result = await Auth.restoreSession();
    expect(result).toBeNull();
    expect(Auth.isAuthenticated()).toBe(false);
  });
});

describe('BUG-AUTH-001 (session-epoch race) — Auth.signIn() single-flight: un doble submit del login nunca debe pisar _sessionEpoch', () => {
  const fetchOkFor = (username, authUid) => vi.fn(async (url) => {
    if (String(url).includes('/auth/v1/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'AT-' + username, refresh_token: 'RT-' + username, expires_in: 3600, user: { id: authUid } }) };
    if (String(url).includes('/rest/v1/app_profiles')) return { ok: true, status: 200, json: async () => ([{ auth_user_id: authUid, app_user_id: 'u_' + username, display_name: username, role: 'ADMINISTRADOR', active: true }]) };
    throw new Error('unexpected fetch ' + url);
  });

  it('A) login normal: signIn=1 exitoso, epoch avanza exactamente una vez', async () => {
    vi.stubGlobal('fetch', fetchOkFor('jvalles', 'u1'));
    const epochBefore = Auth.getSessionEpoch();
    const res = await Auth.signIn('jvalles', 'x');
    expect(res.user.role).toBe('ADMINISTRADOR');
    expect(Auth.getSessionEpoch()).toBe(epochBefore + 1);
    expect(Auth.isAuthenticated()).toBe(true);
  });

  it('B/C) doble clic o Enter+clic (dos Auth.signIn() disparados casi a la vez) -> solo UNO corre de verdad; el otro se rechaza ANTES de tocar la red ni el epoch', async () => {
    const fetchMock = fetchOkFor('jvalles', 'u1');
    vi.stubGlobal('fetch', fetchMock);
    const epochBefore = Auth.getSessionEpoch();

    const [a, b] = await Promise.allSettled([
      Auth.signIn('jvalles', 'x'),
      Auth.signIn('jvalles', 'x'),
    ]);
    const fulfilled = [a, b].filter(r => r.status === 'fulfilled');
    const rejected = [a, b].filter(r => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toBe('SIGN_IN_IN_PROGRESS');
    expect(Auth.getSessionEpoch()).toBe(epochBefore + 1); // UNA sola vez, no dos
    expect(fetchMock).toHaveBeenCalledTimes(2); // token+profile del único signIn que corrió — el segundo nunca llegó a la red
    expect(Auth.isAuthenticated()).toBe(true);
  });

  it('tras el primero resolver, un signIn() posterior (ya no concurrente) vuelve a funcionar con normalidad', async () => {
    vi.stubGlobal('fetch', fetchOkFor('jvalles', 'u1'));
    await Auth.signIn('jvalles', 'x');
    await Auth.signOut();
    vi.stubGlobal('fetch', fetchOkFor('jvalles', 'u1'));
    const epochBefore = Auth.getSessionEpoch();
    await Auth.signIn('jvalles', 'x');
    expect(Auth.getSessionEpoch()).toBe(epochBefore + 1);
    expect(Auth.isAuthenticated()).toBe(true);
  });
});

describe('BUG-AUTH-001 — ensureFreshSession(): un token expirado a mitad de una acción privilegiada no debe fingirse "sin permiso"', () => {
  it('sesión con token vigente -> manageUsers llega directo a la red, sin ningún intento de refresh', async () => {
    await db.setAuthTokens(SESSION_VIGENTE);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    await Auth.restoreSession();

    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; }));
    const res = await Auth.manageUsers('CREATE_USER', { display_name: 'X', username: 'x', role: 'ADMINISTRADOR', temp_password: 'abcd1234' });
    expect(res).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/functions/v1/manage-users');
  });

  it('token ya expirado a mitad del formulario (refresh token todavía vigente, online) -> refresca sesión+perfil y LUEGO llega a manage-users, en ese orden', async () => {
    await db.setAuthTokens(SESSION_VIGENTE);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    await Auth.restoreSession();
    expect(Auth.isAuthenticated()).toBe(true);
    // Simula el paso del tiempo mientras la persona llena "Nuevo usuario"
    // (BUG-AUTH-001 real): el access token expira, el refresh token sigue
    // vigente — exactamente el estado que antes producía AUTH_REQUIRED
    // sin tocar la red.
    Auth._session = { ...Auth._session, expiresAt: Date.now() - 1000 };
    expect(Auth.isAuthenticated()).toBe(false);

    const order = [];
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('grant_type=refresh_token')) {
        order.push('refresh');
        return { ok: true, status: 200, json: async () => ({ access_token: 'NEW-AT', refresh_token: 'NEW-RT', expires_in: 3600, user: { id: 'u1' } }) };
      }
      if (String(url).includes('/rest/v1/app_profiles')) {
        order.push('profile');
        return { ok: true, status: 200, json: async () => ([{ auth_user_id: 'u1', app_user_id: 'u_jvalles', display_name: 'Junior Valles', role: 'ADMINISTRADOR', active: true }]) };
      }
      if (String(url).includes('/functions/v1/manage-users')) {
        order.push('manage-users');
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      throw new Error('unexpected fetch ' + url);
    }));

    const res = await Auth.manageUsers('CREATE_USER', { display_name: 'X', username: 'x', role: 'ADMINISTRADOR', temp_password: 'abcd1234' });
    expect(order).toEqual(['refresh', 'profile', 'manage-users']);
    expect(res).toEqual({ ok: true });
    expect(Auth.isAuthenticated()).toBe(true); // sesión queda realmente renovada, no solo "esta llamada coló"
  });

  it('token expirado + SIN refresh token (o ya revocado por el servidor) -> nunca llega a manage-users, AUTH_REQUIRED, "sesión expirada" nunca se confunde con falta de rol', async () => {
    await db.setAuthTokens({ ...SESSION_EXPIRADA, refreshToken: 'RT-REVOCADO' });
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    // Restaura offline primero (sin red real) para dejar en memoria la
    // sesión expirada + el perfil cacheado tal cual, igual que el resto
    // del archivo (ver "E) access token expirado + offline") — luego
    // vuelve a estar online para intentar la acción privilegiada.
    vi.stubGlobal('navigator', { onLine: false });
    await Auth.restoreSession();
    expect(Auth.isAuthenticated()).toBe(false);

    vi.stubGlobal('navigator', { onLine: true });
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('grant_type=refresh_token')) return { ok: false, status: 401, json: async () => ({}) };
      throw new Error('no debería llegar a manage-users: ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(Auth.manageUsers('CREATE_USER', { display_name: 'X', username: 'x', role: 'ADMINISTRADOR', temp_password: 'abcd1234' }))
      .rejects.toThrow('AUTH_REQUIRED');
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('manage-users'))).toBe(false);
    expect(Auth.isAuthenticated()).toBe(false);
  });

  it('token expirado + offline -> AUTH_REQUIRED sin red, sesión/perfil cacheados NUNCA se borran (nada de signOut por timeout/fallo de red — no debe romper trabajo offline)', async () => {
    await db.setAuthTokens(SESSION_EXPIRADA);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    vi.stubGlobal('navigator', { onLine: false });
    await Auth.restoreSession();
    expect(Auth.isAuthenticated()).toBe(false);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(Auth.manageUsers('CREATE_USER', {})).rejects.toThrow('AUTH_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
    // Nunca se cerró sesión: el snapshot sigue intacto para seguir
    // mostrando identidad/trabajo local (mismo criterio que restoreSession()).
    expect(await db.getAuthTokens()).not.toBeNull();
    expect(await db.getAuthProfileSnapshot()).not.toBeNull();
    expect(Auth.getProfile().displayName).toBe('Junior Valles');
  });

  it('sesión ADMIN válida -> el servidor decide 200 (ADMIN_VALID), nunca una validación de rol duplicada en el cliente', async () => {
    await db.setAuthTokens(SESSION_VIGENTE);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    await Auth.restoreSession();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, app_user_id: 'u_nuevo', auth_user_id: 'auth-nuevo' }) })));
    const res = await Auth.manageUsers('CREATE_USER', { display_name: 'Nuevo Admin', username: 'nuevoadmin', role: 'ADMINISTRADOR', temp_password: 'abcd1234' });
    expect(res.ok).toBe(true);
  });

  it('sesión válida pero el servidor rechaza por rol (no-admin real) -> la llamada SÍ llega a la red y el 403/AUTH_FORBIDDEN se propaga tal cual, nunca se reinterpreta como AUTH_REQUIRED', async () => {
    const PERFIL_SUPERVISOR = { authUserId: 'u2', appUserId: 'u_sup', displayName: 'Supervisor X', role: 'SUPERVISOR', active: true };
    await db.setAuthTokens({ ...SESSION_VIGENTE, authUserId: 'u2' });
    await db.setAuthProfileSnapshot(PERFIL_SUPERVISOR);
    await Auth.restoreSession();
    expect(Auth.isAuthenticated()).toBe(true); // sesión real y válida — solo el ROL no alcanza, decide el servidor

    const fetchMock = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'AUTH_FORBIDDEN' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(Auth.manageUsers('CREATE_USER', { display_name: 'X', username: 'x', role: 'LUBRICADOR', temp_password: 'abcd1234' }))
      .rejects.toThrow('AUTH_FORBIDDEN');
    expect(fetchMock).toHaveBeenCalledTimes(1); // SÍ llegó a la red — nunca un gate de rol local
  });
});

describe('P) Auth.changeOwnPassword() — lote "Mi Perfil"', () => {
  it('sin sesión autenticada, rechaza antes de llamar a fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(Auth.changeOwnPassword('actual', 'nueva12345')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('contraseña nueva débil (<8) rechaza sin llamar a fetch', async () => {
    await db.setAuthTokens(SESSION_VIGENTE);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    await Auth.restoreSession();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(Auth.changeOwnPassword('actual', 'corta')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-verifica la contraseña ACTUAL con grant_type=password usando el username derivado de appUserId, ANTES de aplicar la nueva con PUT /auth/v1/user', async () => {
    await db.setAuthTokens(SESSION_VIGENTE);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN); // appUserId: 'u_jvalles' -> username 'jvalles'
    await Auth.restoreSession();

    const callOrder = [];
    let verifyBody = null;
    let updateHeaders = null;
    let updateBody = null;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (String(url).includes('grant_type=password')) {
        callOrder.push('verify');
        verifyBody = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ access_token: 'VERIFY-ONLY', refresh_token: 'VERIFY-ONLY', expires_in: 3600, user: { id: 'u1' } }) };
      }
      if (String(url).endsWith('/auth/v1/user') && opts.method === 'PUT') {
        callOrder.push('update');
        updateHeaders = opts.headers;
        updateBody = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({}) };
      }
      throw new Error('unexpected fetch ' + url);
    }));

    const ok = await Auth.changeOwnPassword('la-actual', 'la-nueva-123');
    expect(ok).toBe(true);
    expect(callOrder).toEqual(['verify', 'update']);
    expect(verifyBody).toEqual({ email: 'jvalles@engrase.internal', password: 'la-actual' });
    expect(updateBody).toEqual({ password: 'la-nueva-123' });
    expect(updateHeaders.Authorization).toBe(`Bearer ${SESSION_VIGENTE.accessToken}`);
    // La verificación NUNCA reemplaza la sesión real ya autenticada.
    expect(Auth.getSession().accessToken).toBe(SESSION_VIGENTE.accessToken);
  });

  it('contraseña actual incorrecta -> rechaza, nunca llega a llamar PUT /auth/v1/user', async () => {
    await db.setAuthTokens(SESSION_VIGENTE);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    await Auth.restoreSession();

    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('grant_type=password')) return { ok: false, status: 400, json: async () => ({}) };
      throw new Error('no debería llegar a esta llamada');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(Auth.changeOwnPassword('mala', 'la-nueva-123')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('la contraseña (actual o nueva) nunca queda guardada en ningún storage local', async () => {
    await db.setAuthTokens(SESSION_VIGENTE);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    await Auth.restoreSession();
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('grant_type=password')) return { ok: true, status: 200, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({}) };
    }));

    const NUEVA_SECRETA = 'nueva-password-secreta-456';
    await Auth.changeOwnPassword('actual-secreta-789', NUEVA_SECRETA);

    const dump = JSON.stringify(db._dump());
    expect(dump).not.toContain(NUEVA_SECRETA);
    expect(dump).not.toContain('actual-secreta-789');
  });
});

describe('Q) Auth.updateOwnDisplayName() — lote "Mi Perfil"', () => {
  it('sin sesión autenticada, rechaza antes de llamar a fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(Auth.updateOwnDisplayName('Nuevo Nombre')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('nombre vacío rechaza sin llamar a fetch', async () => {
    await db.setAuthTokens(SESSION_VIGENTE);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    await Auth.restoreSession();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(Auth.updateOwnDisplayName('   ')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('llama a update-own-profile (nunca manage-users) con el JWT propio, y refleja el nombre nuevo de inmediato en el perfil cacheado', async () => {
    await db.setAuthTokens(SESSION_VIGENTE);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    await Auth.restoreSession();

    let calledUrl = null;
    let sentAuthHeader = null;
    let sentBody = null;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      calledUrl = String(url);
      sentAuthHeader = opts.headers.Authorization;
      sentBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ ok: true, display_name: 'Nombre Nuevo' }) };
    }));

    const ok = await Auth.updateOwnDisplayName('  Nombre Nuevo  ');
    expect(ok).toBe(true);
    expect(calledUrl).toContain('/functions/v1/update-own-profile');
    expect(calledUrl).not.toContain('manage-users');
    expect(sentAuthHeader).toBe(`Bearer ${SESSION_VIGENTE.accessToken}`);
    expect(sentBody).toEqual({ display_name: 'Nombre Nuevo' });
    expect(Auth.getProfile().displayName).toBe('Nombre Nuevo');

    const snapshot = await db.getAuthProfileSnapshot();
    expect(snapshot.displayName).toBe('Nombre Nuevo');
  });

  it('error del servidor -> rechaza con el código crudo, nunca cambia el perfil cacheado', async () => {
    await db.setAuthTokens(SESSION_VIGENTE);
    await db.setAuthProfileSnapshot(PERFIL_ADMIN);
    await Auth.restoreSession();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'AUTH_FORBIDDEN' }) })));

    await expect(Auth.updateOwnDisplayName('Otro Nombre')).rejects.toThrow('AUTH_FORBIDDEN');
    expect(Auth.getProfile().displayName).toBe('Junior Valles');
  });
});
