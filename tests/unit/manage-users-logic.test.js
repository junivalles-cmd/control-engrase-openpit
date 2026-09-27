// tests/unit/manage-users-logic.test.js
//
// P0-2 — administración segura de usuarios reales
// (supabase/functions/manage-users/index.ts). Todo con fetch mockeado —
// NUNCA contra producción, NUNCA se despliega la función en este cierre.
// La lógica se lee DIRECTAMENTE del archivo real (loadManageUsersLogic),
// nunca se reimplementa a mano en el test.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadManageUsersLogic } from '../helpers/loadLubricationLogic.js';

const ENV = { supabaseUrl: 'https://fake.test', serviceRoleKey: 'service-role-fake', anonKey: 'anon-fake' };

let decideCallerAuthorization, wouldLeaveZeroActiveAdmins, isValidRoleValue, usernameToAuthIdentifier,
  handleCreateUser, handleUpdateRole, handleSetActive, handleResetPassword, handleListUsers;

beforeEach(() => {
  ({
    decideCallerAuthorization, wouldLeaveZeroActiveAdmins, isValidRoleValue, usernameToAuthIdentifier,
    handleCreateUser, handleUpdateRole, handleSetActive, handleResetPassword, handleListUsers,
  } = loadManageUsersLogic());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('A-F) decideCallerAuthorization() — la MISMA regla para las 5 acciones', () => {
  it('A) anon (sin auth.uid()) -> 401', () => {
    expect(decideCallerAuthorization(null, null)).toBe(401);
  });
  it('B) authenticated pero SIN fila en app_profiles -> 403', () => {
    expect(decideCallerAuthorization('uid-1', null)).toBe(403);
  });
  it('C) perfil existe pero inactive -> 403', () => {
    expect(decideCallerAuthorization('uid-1', { role: 'ADMINISTRADOR', active: false })).toBe(403);
  });
  it('D) LUBRICADOR activo -> 403', () => {
    expect(decideCallerAuthorization('uid-1', { role: 'LUBRICADOR', active: true })).toBe(403);
  });
  it('E) VISOR activo -> 403', () => {
    expect(decideCallerAuthorization('uid-1', { role: 'VISOR', active: true })).toBe(403);
  });
  it('F) ADMINISTRADOR activo -> null (permitido)', () => {
    expect(decideCallerAuthorization('uid-1', { role: 'ADMINISTRADOR', active: true })).toBeNull();
  });
});

function mockFetchSequence(handlers) {
  let call = 0;
  return vi.fn(async (url, opts) => {
    const h = handlers[call];
    call++;
    if (!h) throw new Error(`fetch inesperado (llamada #${call}): ${(opts && opts.method) || 'GET'} ${url}`);
    return h(url, opts);
  });
}

describe('G) CREATE_USER correcto', () => {
  it('crea Auth user + app_profile, devuelve 200 ok', async () => {
    const calls = [];
    vi.stubGlobal('fetch', mockFetchSequence([
      // 1) getProfileByAppUserId (chequeo de duplicado) -> no existe
      async (url) => { calls.push(['lookup', url]); return { ok: true, json: async () => [] }; },
      // 2) crear en Auth
      async (url, opts) => { calls.push(['auth_create', url]); return { ok: true, json: async () => ({ id: 'new-auth-uid' }) }; },
      // 3) crear app_profile
      async (url, opts) => { calls.push(['profile_create', url]); return { ok: true, json: async () => [{}] }; },
    ]));

    const res = await handleCreateUser(ENV, { display_name: 'Junior Valles', username: 'jvalles', role: 'ADMINISTRADOR', temp_password: 'abcd1234' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.app_user_id).toBe('u_jvalles');
    expect(res.body.auth_user_id).toBe('new-auth-uid');
    expect(calls.map(c => c[0])).toEqual(['lookup', 'auth_create', 'profile_create']);
  });
});

describe('H) username duplicado -> error limpio, sin tocar Auth', () => {
  it('devuelve 409 username_taken, nunca llama a auth/v1/admin/users', async () => {
    const authCreateMock = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/rest/v1/app_profiles')) return { ok: true, json: async () => [{ app_user_id: 'u_jvalles' }] };
      authCreateMock();
      throw new Error('no debería llegar acá: ' + url);
    }));

    const res = await handleCreateUser(ENV, { display_name: 'Otro', username: 'jvalles', role: 'LUBRICADOR', temp_password: 'abcd1234' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('username_taken');
    expect(authCreateMock).not.toHaveBeenCalled();
  });
});

describe('I) rol inválido -> rechazo, sin tocar red', () => {
  it('CREATE_USER con role inválido -> 400, 0 llamadas a fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await handleCreateUser(ENV, { display_name: 'X', username: 'x', role: 'SUPERADMIN', temp_password: 'abcd1234' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_role');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('UPDATE_ROLE con role inválido -> 400', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const res = await handleUpdateRole(ENV, { app_user_id: 'u_x', role: 'SUPERADMIN' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_role');
  });

  it('isValidRoleValue() — los 5 roles reales true, cualquier otro string false', () => {
    for (const r of ['ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR', 'LUBRICADOR', 'VISOR']) {
      expect(isValidRoleValue(r)).toBe(true);
    }
    expect(isValidRoleValue('SUPERADMIN')).toBe(false);
    expect(isValidRoleValue('')).toBe(false);
    expect(isValidRoleValue(null)).toBe(false);
  });
});

describe('J) fallo de app_profile tras crear en Auth -> ROLLBACK del Auth user', () => {
  it('borra el Auth user recién creado y devuelve 502 con el motivo', async () => {
    const calls = [];
    vi.stubGlobal('fetch', mockFetchSequence([
      async () => { calls.push('lookup'); return { ok: true, json: async () => [] }; },
      async () => { calls.push('auth_create'); return { ok: true, json: async () => ({ id: 'new-auth-uid' }) }; },
      async () => { calls.push('profile_create_fails'); return { ok: false, status: 500, json: async () => ({}) }; },
      async (url, opts) => { calls.push('rollback_delete'); expect(opts.method).toBe('DELETE'); expect(url).toContain('new-auth-uid'); return { ok: true, json: async () => ({}) }; },
    ]));

    const res = await handleCreateUser(ENV, { display_name: 'Junior Valles', username: 'jvalles', role: 'ADMINISTRADOR', temp_password: 'abcd1234' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('profile_create_failed_rolled_back');
    expect(calls).toEqual(['lookup', 'auth_create', 'profile_create_fails', 'rollback_delete']);
  });
});

describe('K) UPDATE_ROLE correcto (no es el último admin activo)', () => {
  it('cambia el rol, 200 ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      if (method === 'GET' && String(url).includes('app_user_id=eq.')) {
        return { ok: true, json: async () => [{ auth_user_id: 'u1', app_user_id: 'u_x', role: 'LUBRICADOR', active: true }] };
      }
      if (method === 'PATCH') return { ok: true, json: async () => [{}] };
      throw new Error('unexpected ' + method + ' ' + url);
    }));
    const res = await handleUpdateRole(ENV, { app_user_id: 'u_x', role: 'SUPERVISOR' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('objetivo no existe -> 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
    const res = await handleUpdateRole(ENV, { app_user_id: 'no_existe', role: 'SUPERVISOR' });
    expect(res.status).toBe(404);
  });
});

describe('L) NO dejar el sistema sin ningún ADMINISTRADOR activo', () => {
  it('wouldLeaveZeroActiveAdmins() — regla pura', () => {
    expect(wouldLeaveZeroActiveAdmins(true, false, 0)).toBe(true); // último admin, se le quita -> riesgo
    expect(wouldLeaveZeroActiveAdmins(true, false, 1)).toBe(false); // hay otro admin -> sin riesgo
    expect(wouldLeaveZeroActiveAdmins(true, true, 0)).toBe(false); // sigue siendo admin activo -> sin riesgo
    expect(wouldLeaveZeroActiveAdmins(false, false, 0)).toBe(false); // no era admin activo -> sin riesgo
  });

  it('UPDATE_ROLE sobre el único admin activo, quitándole el rol -> 409, no se aplica', async () => {
    let patchCalled = false;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      if (method === 'GET' && String(url).includes('app_user_id=eq.')) {
        return { ok: true, json: async () => [{ auth_user_id: 'u1', app_user_id: 'u_admin1', role: 'ADMINISTRADOR', active: true }] };
      }
      if (method === 'GET' && String(url).includes('role=eq.ADMINISTRADOR')) {
        return { ok: true, json: async () => [{ auth_user_id: 'u1' }] }; // solo él mismo -> 0 OTROS
      }
      if (method === 'PATCH') { patchCalled = true; return { ok: true, json: async () => [{}] }; }
      throw new Error('unexpected ' + method + ' ' + url);
    }));
    const res = await handleUpdateRole(ENV, { app_user_id: 'u_admin1', role: 'LUBRICADOR' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('cannot_remove_last_admin');
    expect(patchCalled).toBe(false); // NUNCA se llegó a aplicar el cambio
  });

  it('SET_ACTIVE desactivando al único admin activo -> 409, no se aplica', async () => {
    let patchCalled = false;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      if (method === 'GET' && String(url).includes('app_user_id=eq.')) {
        return { ok: true, json: async () => [{ auth_user_id: 'u1', app_user_id: 'u_admin1', role: 'ADMINISTRADOR', active: true }] };
      }
      if (method === 'GET' && String(url).includes('role=eq.ADMINISTRADOR')) {
        return { ok: true, json: async () => [{ auth_user_id: 'u1' }] };
      }
      if (method === 'PATCH') { patchCalled = true; return { ok: true, json: async () => [{}] }; }
      throw new Error('unexpected ' + method + ' ' + url);
    }));
    const res = await handleSetActive(ENV, { app_user_id: 'u_admin1', active: false });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('cannot_deactivate_last_admin');
    expect(patchCalled).toBe(false);
  });

  it('con OTRO admin activo presente, SÍ se puede desactivar/quitar rol al primero', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      if (method === 'GET' && String(url).includes('app_user_id=eq.')) {
        return { ok: true, json: async () => [{ auth_user_id: 'u1', app_user_id: 'u_admin1', role: 'ADMINISTRADOR', active: true }] };
      }
      if (method === 'GET' && String(url).includes('role=eq.ADMINISTRADOR')) {
        return { ok: true, json: async () => [{ auth_user_id: 'u1' }, { auth_user_id: 'u2' }] }; // hay otro admin (u2)
      }
      if (method === 'PATCH') return { ok: true, json: async () => [{}] };
      throw new Error('unexpected ' + method + ' ' + url);
    }));
    const res = await handleSetActive(ENV, { app_user_id: 'u_admin1', active: false });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('M) desactivar un usuario no-admin — sin protección especial', () => {
  it('LUBRICADOR desactivado -> 200 ok, sin ninguna consulta de conteo de admins', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      calls.push(`${method} ${url}`);
      if (method === 'GET' && String(url).includes('app_user_id=eq.')) {
        return { ok: true, json: async () => [{ auth_user_id: 'u9', app_user_id: 'u_lub1', role: 'LUBRICADOR', active: true }] };
      }
      if (method === 'PATCH') return { ok: true, json: async () => [{}] };
      throw new Error('unexpected ' + method + ' ' + url);
    }));
    const res = await handleSetActive(ENV, { app_user_id: 'u_lub1', active: false });
    expect(res.status).toBe(200);
    expect(calls.some(c => c.includes('role=eq.ADMINISTRADOR'))).toBe(false); // nunca cuenta admins para un no-admin
  });
});

describe('N) RESET_PASSWORD nunca persiste ni devuelve la contraseña', () => {
  it('la respuesta no contiene la password en ningún campo', async () => {
    let sentBody = null;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      if (method === 'GET') return { ok: true, json: async () => [{ auth_user_id: 'u1', app_user_id: 'u_x' }] };
      if (method === 'PUT') { sentBody = JSON.parse(opts.body); return { ok: true, json: async () => ({}) }; }
      throw new Error('unexpected ' + method + ' ' + url);
    }));
    const SECRETA = 'nueva-password-super-secreta';
    const res = await handleResetPassword(ENV, { app_user_id: 'u_x', new_password: SECRETA });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRETA); // nunca en la respuesta
    expect(sentBody.password).toBe(SECRETA); // SÍ va, una sola vez, directo a Auth Admin API
  });

  it('password corta (<8) -> 400, ni siquiera consulta el perfil', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await handleResetPassword(ENV, { app_user_id: 'u_x', new_password: 'corta' });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('LIST_USERS — solo campos no sensibles', () => {
  it('devuelve exactamente lo que trae app_profiles (sin password/hash/tokens, porque esa tabla nunca los tiene)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => [{ app_user_id: 'u_jvalles', display_name: 'Junior Valles', role: 'ADMINISTRADOR', active: true, created_at: '2026-01-01T00:00:00Z' }],
    })));
    const res = await handleListUsers(ENV);
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(Object.keys(res.body.users[0]).sort()).toEqual(['active', 'app_user_id', 'created_at', 'display_name', 'role']);
  });
});

describe('usernameToAuthIdentifier() (server-side) — mismas reglas que src/core/auth.js', () => {
  it('mapea igual que el cliente', () => {
    expect(usernameToAuthIdentifier('jvalles')).toBe('jvalles@engrase.internal');
  });
  it('rechaza "@" ya presente', () => {
    expect(() => usernameToAuthIdentifier('x@y.com')).toThrow();
  });
});
