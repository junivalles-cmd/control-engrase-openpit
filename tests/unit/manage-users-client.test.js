// tests/unit/manage-users-client.test.js
//
// FIX — formulario "Agregar usuario" / integración real con manage-users.
// Auditoría previa (ver respuesta final de este lote): el wiring con la
// Edge Function YA era correcto (Auth.manageUsers() -> manage-users ->
// auth.admin.* + app_profiles, nunca service_role en cliente) — lo que
// estaba roto era la capa de UI: errores del servidor mostrados como
// código crudo, sin guardia de doble-click, sin confirmación de
// contraseña, y fallas de red sin traducir. Este archivo prueba
// EXACTAMENTE ese fix:
//   - Auth.manageUsers() (EJECUCIÓN real, mismo arnés que auth.test.js):
//     códigos estables (AUTH_REQUIRED/NETWORK/TIMEOUT/HTTP_xxx/código del
//     servidor), nunca una frase ya traducida ni la excepción cruda de fetch.
//   - manageUsersErrorMessage()/MANAGE_USERS_ERROR_LABELS (app.js,
//     EJECUCIÓN real): traduce esos códigos a texto legible, sin stack/
//     service_role/JWT.
//   - Estructura de userFormSupabase()/roleFormSupabase()/
//     resetPasswordFormSupabase() (fuente, mismo criterio que el resto de
//     dashboard-*.test.js: demasiadas dependencias de DOM real para
//     ejecutarlas aquí — ver tests/ui para el comportamiento visual).
//
// Lo que YA estaba cubierto y no se duplica aquí: autorización server-side
// (401/403/rol inválido/username duplicado/rollback de profile/protección
// de último admin) — ver tests/unit/manage-users-logic.test.js, letras A-N.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadAuthLogic } from '../helpers/loadLubricationLogic.js';
import { readSource, extractDeclaration, buildModuleBody } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

function makeFakeDB() {
  let config = null, tokens = null, profileSnapshot = null;
  return {
    async getConfig() { return config; },
    async setConfig(v) { config = v; return v; },
    async getAuthTokens() { return tokens; },
    async setAuthTokens(v) { tokens = v; return v; },
    async getAuthProfileSnapshot() { return profileSnapshot; },
    async setAuthProfileSnapshot(v) { profileSnapshot = v; return v; },
  };
}

const CFG = { url: 'https://fake.test', anonKey: 'anon-test' };
const SESSION_VIGENTE = { accessToken: 'jwt-real', refreshToken: 'r1', expiresAt: Date.now() + 3600_000, authUserId: 'u1' };
const PERFIL_ADMIN = { displayName: 'Junior', role: 'ADMINISTRADOR', active: true, lastVerifiedAt: Date.now() };

let db, Auth;

beforeEach(async () => {
  db = makeFakeDB();
  await db.setConfig(CFG);
  ({ Auth } = loadAuthLogic(db));
});

afterEach(() => { vi.unstubAllGlobals(); });

async function authenticate() {
  await db.setAuthTokens(SESSION_VIGENTE);
  await db.setAuthProfileSnapshot(PERFIL_ADMIN);
  await Auth.restoreSession();
}

describe('B) sin sesión -> AUTH_REQUIRED, 0 llamadas a fetch (nunca la frase vieja ya traducida)', () => {
  it('rechaza con el código estable "AUTH_REQUIRED", no con una oración', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(Auth.manageUsers('CREATE_USER', {})).rejects.toThrow('AUTH_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('C) 403 (no ADMIN) -> el código del servidor pasa intacto como message', () => {
  it('AUTH_FORBIDDEN', async () => {
    await authenticate();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'AUTH_FORBIDDEN' }) })));
    await expect(Auth.manageUsers('CREATE_USER', {})).rejects.toThrow('AUTH_FORBIDDEN');
  });
});

describe('D) username duplicado -> código "username_taken" intacto', () => {
  it('409 con username_taken', async () => {
    await authenticate();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: 'username_taken' }) })));
    await expect(Auth.manageUsers('CREATE_USER', {})).rejects.toThrow('username_taken');
  });
});

describe('E) rol inválido -> código "invalid_role" intacto', () => {
  it('400 con invalid_role', async () => {
    await authenticate();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_role' }) })));
    await expect(Auth.manageUsers('CREATE_USER', {})).rejects.toThrow('invalid_role');
  });
});

describe('F) password inválida -> código "temp_password_required_min_8" intacto', () => {
  it('400 con temp_password_required_min_8', async () => {
    await authenticate();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'temp_password_required_min_8' }) })));
    await expect(Auth.manageUsers('CREATE_USER', {})).rejects.toThrow('temp_password_required_min_8');
  });

  it('sin body de error (JSON roto) -> cae a HTTP_<status>, nunca revienta', async () => {
    await authenticate();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => { throw new Error('bad json'); } })));
    await expect(Auth.manageUsers('CREATE_USER', {})).rejects.toThrow('HTTP_500');
  });
});

describe('G) timeout / Edge Function no disponible -> NUNCA la excepción cruda de fetch llega a la UI', () => {
  it('AbortError (AbortSignal.timeout) -> código "TIMEOUT"', async () => {
    await authenticate();
    const abortErr = new Error('signal timed out');
    abortErr.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn(async () => { throw abortErr; }));
    await expect(Auth.manageUsers('CREATE_USER', {})).rejects.toThrow('TIMEOUT');
  });

  it('TypeError de red (DNS/sin conexión) -> código "NETWORK", nunca "Failed to fetch" crudo', async () => {
    await authenticate();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(Auth.manageUsers('CREATE_USER', {})).rejects.toThrow('NETWORK');
  });
});

describe('A/J) CREATE_USER éxito -> devuelve la respuesta real del servidor, JWT propio reenviado (nunca service_role)', () => {
  it('200 ok -> resuelve con el body, Authorization = Bearer <JWT del usuario>', async () => {
    await authenticate();
    let sentAuth = null, sentApikey = null;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      sentAuth = opts.headers.Authorization; sentApikey = opts.headers.apikey;
      return { ok: true, status: 200, json: async () => ({ ok: true, app_user_id: 'u_test' }) };
    }));
    const res = await Auth.manageUsers('CREATE_USER', { display_name: 'Test', username: 'test', role: 'LUBRICADOR', temp_password: 'abcdefgh' });
    expect(res.ok).toBe(true);
    expect(sentAuth).toBe(`Bearer ${SESSION_VIGENTE.accessToken}`);
    expect(sentAuth).not.toContain('service_role');
    expect(sentApikey).toBe(CFG.anonKey);
  });
});

/* ============================================================
   manageUsersErrorMessage() / MANAGE_USERS_ERROR_LABELS (app.js) —
   EJECUCIÓN real, función pura sin DOM.
   ============================================================ */
const appSource = readSource(APP_JS_PATH);
const { manageUsersErrorMessage } = new Function(
  buildModuleBody(appSource, ['MANAGE_USERS_ERROR_LABELS', 'manageUsersErrorMessage'])
)();

describe('Traducción de errores — nunca el código crudo, nunca stack/service_role/JWT', () => {
  it('cada código real del servidor tiene una traducción legible', () => {
    ['AUTH_REQUIRED', 'AUTH_FORBIDDEN', 'NETWORK', 'TIMEOUT', 'username_taken', 'invalid_role',
      'temp_password_required_min_8', 'new_password_required_min_8', 'not_found',
      'cannot_remove_last_admin', 'cannot_deactivate_last_admin', 'auth_create_failed',
      'profile_create_failed_rolled_back'].forEach(code => {
      const msg = manageUsersErrorMessage(new Error(code));
      expect(msg).not.toBe(code); // siempre traducido, nunca el código crudo
      expect(msg.length).toBeGreaterThan(5);
    });
  });

  it('código desconocido (ej. list_failed_502) -> mensaje genérico, nunca undefined ni el código crudo', () => {
    expect(manageUsersErrorMessage(new Error('list_failed_502'))).toMatch(/no se pudo/i);
    expect(manageUsersErrorMessage(new Error('algo_nunca_visto'))).toMatch(/no se pudo/i);
  });

  it('nunca expone stack trace, service_role, JWT ni "Bearer" en ningún mensaje traducido', () => {
    Object.values(new Function(buildModuleBody(appSource, ['MANAGE_USERS_ERROR_LABELS']))()['MANAGE_USERS_ERROR_LABELS']).forEach(msg => {
      expect(msg).not.toMatch(/service_role|Bearer|stack|at Object\.|\.js:\d/i);
    });
  });

  it('error sin .message (undefined) no revienta la UI — cae al mensaje genérico', () => {
    expect(() => manageUsersErrorMessage(undefined)).not.toThrow();
    expect(manageUsersErrorMessage(undefined)).toMatch(/no se pudo/i);
  });
});

/* ============================================================
   Estructura de las pantallas (fuente) — igual criterio que
   dashboard-*.test.js/reportes-*.test.js: demasiadas dependencias de DOM
   real (modal/FormData/addEventListener) para ejecutarlas aquí.
   ============================================================ */
describe('H) Doble submit — withSubmitGuard() deshabilita el botón mientras la llamada está en vuelo', () => {
  const guardSrc = extractDeclaration(appSource, 'withSubmitGuard');
  it('deshabilita el submit ANTES del await y lo restaura siempre (finally), en las 3 pantallas', () => {
    expect(guardSrc).toContain('btn.disabled = true; btn.textContent = busyLabel;');
    expect(guardSrc).toContain('} finally {');
    expect(guardSrc).toContain('btn.disabled = false; btn.textContent = original;');
  });
  it('userFormSupabase/roleFormSupabase/resetPasswordFormSupabase usan withSubmitGuard (nunca llaman a manageUsers sin la guardia)', () => {
    const userSrc = extractDeclaration(appSource, 'userFormSupabase');
    const roleSrc = extractDeclaration(appSource, 'roleFormSupabase');
    const resetSrc = extractDeclaration(appSource, 'resetPasswordFormSupabase');
    [userSrc, roleSrc, resetSrc].forEach(src => {
      expect(src).toContain('withSubmitGuard(form,');
    });
  });
});

describe('F) Confirmación de contraseña — coincide antes de llamar al servidor, nunca sustituye la validación real', () => {
  it('userFormSupabase: compara temp_password vs temp_password_confirm, corta ANTES de llamar a Auth.manageUsers, y nunca envía el campo de confirmación al servidor', () => {
    const src = extractDeclaration(appSource, 'userFormSupabase');
    expect(src).toContain('if (fd.temp_password !== fd.temp_password_confirm)');
    expect(src).toContain("delete fd.temp_password_confirm;");
    const iCheck = src.indexOf('if (fd.temp_password !== fd.temp_password_confirm)');
    const iCall = src.indexOf("Auth.manageUsers('CREATE_USER'");
    expect(iCheck).toBeLessThan(iCall);
  });
  it('resetPasswordFormSupabase: misma comparación para new_password/new_password_confirm', () => {
    const src = extractDeclaration(appSource, 'resetPasswordFormSupabase');
    expect(src).toContain('if (fd.new_password !== fd.new_password_confirm)');
  });
  it('el campo "Activo" NO existe en el formulario de creación (handleCreateUser siempre fuerza active=true server-side, un checkbox aquí no tendría efecto real)', () => {
    const src = extractDeclaration(appSource, 'userFormSupabase');
    expect(src).not.toMatch(/name="active"/);
  });
  it('no se agregan roles de turno inventados (SUPERVISOR_DIA/NOCHE, etc.) — el selector de rol sigue usando los 5 roles reales de PERMISSIONS', () => {
    const src = extractDeclaration(appSource, 'userFormSupabase');
    expect(src).toContain('Object.keys(PERMISSIONS)');
    expect(src).not.toMatch(/SUPERVISOR_DIA|SUPERVISOR_NOCHE|PLANIFICADOR_DIA|PLANIFICADOR_NOCHE/);
  });
});

describe('J) La lista se actualiza sin recarga completa de pantalla', () => {
  it('CREATE_USER/UPDATE_ROLE exitosos llaman renderUsuariosSupabase(c) directamente — nunca navigate(\'usuarios\') (eso reconstruye toda la pantalla desde cero)', () => {
    const userSrc = extractDeclaration(appSource, 'userFormSupabase');
    const roleSrc = extractDeclaration(appSource, 'roleFormSupabase');
    expect(userSrc).toContain('renderUsuariosSupabase(c)');
    expect(roleSrc).toContain('renderUsuariosSupabase(c)');
    expect(userSrc).not.toContain("navigate('usuarios')");
    expect(roleSrc).not.toContain("navigate('usuarios')");
  });
  it('renderUsuariosSupabase() pasa `c` (el contenedor real) al abrir los formularios, para que puedan refrescarse a sí mismos después', () => {
    const listSrc = extractDeclaration(appSource, 'renderUsuariosSupabase');
    expect(listSrc).toContain('userFormSupabase(c)');
    expect(listSrc).toContain('roleFormSupabase(u, c)');
  });
});

describe('Errores mostrados al usuario siempre pasan por manageUsersErrorMessage() — nunca el código crudo ni e.message directo', () => {
  it('las 4 pantallas (crear/rol/activar/resetear/listar) usan manageUsersErrorMessage(e), ninguna muestra e.message a secas', () => {
    [extractDeclaration(appSource, 'userFormSupabase'),
     extractDeclaration(appSource, 'roleFormSupabase'),
     extractDeclaration(appSource, 'resetPasswordFormSupabase'),
     extractDeclaration(appSource, 'renderUsuariosSupabase')].forEach(src => {
      expect(src).not.toMatch(/showInAppToast\('✗ ' \+ e\.message\)/);
      expect(src).toMatch(/manageUsersErrorMessage\(e\)/);
    });
  });
});
