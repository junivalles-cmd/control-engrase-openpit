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
  return {
    async getConfig() { return config; },
    async setConfig(v) { config = v; return v; },
    async getAuthTokens() { return tokens; },
    async setAuthTokens(v) { tokens = v; return v; },
    async getAuthProfileSnapshot() { return profileSnapshot; },
    async setAuthProfileSnapshot(v) { profileSnapshot = v; return v; },
    // Solo para inspección en los tests (nunca lo usa auth.js en sí).
    _dump() { return { config, tokens, profileSnapshot }; },
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

describe('M) AUTH_MODE por defecto', () => {
  it('Auth.getMode() === "legacy" y Auth.isSupabaseMode() === false', () => {
    expect(Auth.getMode()).toBe('legacy');
    expect(Auth.isSupabaseMode()).toBe(false);
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
