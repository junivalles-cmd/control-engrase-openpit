// tests/unit/update-own-profile-logic.test.js
//
// Lote "Mi Perfil" — autoservicio de display_name
// (supabase/functions/update-own-profile/index.ts). Todo con fetch
// mockeado — NUNCA contra producción; esta función está PREPARADA pero
// NO DESPLEGADA (ver cabecera del archivo real). La lógica se lee
// DIRECTAMENTE del archivo real (loadUpdateOwnProfileLogic), nunca se
// reimplementa a mano en el test.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { loadUpdateOwnProfileLogic } from '../helpers/loadLubricationLogic.js';

const ENV = { supabaseUrl: 'https://fake.test', serviceRoleKey: 'service-role-fake', anonKey: 'anon-fake' };

let CORS_HEADERS, isValidDisplayName, svHeaders, getCallerProfile, decideCallerAuthorization, handleUpdateOwnProfile;

beforeEach(() => {
  ({ CORS_HEADERS, isValidDisplayName, svHeaders, getCallerProfile, decideCallerAuthorization, handleUpdateOwnProfile } = loadUpdateOwnProfileLogic());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CORS — mismos 3 headers que manage-users (authorization/content-type/apikey)', () => {
  it('incluye exactamente authorization, content-type y apikey', () => {
    const allowed = CORS_HEADERS['Access-Control-Allow-Headers'].split(',').map(h => h.trim().toLowerCase());
    expect(allowed.sort()).toEqual(['apikey', 'authorization', 'content-type']);
  });
});

describe('isValidDisplayName() — validación pura', () => {
  it('nombre normal -> válido', () => expect(isValidDisplayName('Junior Valles')).toBe(true));
  it('vacío -> inválido', () => expect(isValidDisplayName('')).toBe(false));
  it('solo espacios -> inválido', () => expect(isValidDisplayName('   ')).toBe(false));
  it('no-string -> inválido', () => expect(isValidDisplayName(123)).toBe(false));
  it('81 caracteres -> inválido (límite 80)', () => expect(isValidDisplayName('a'.repeat(81))).toBe(false));
  it('80 caracteres exactos -> válido', () => expect(isValidDisplayName('a'.repeat(80))).toBe(true));
});

describe('decideCallerAuthorization() — DISTINTO de manage-users a propósito: nunca exige un rol concreto', () => {
  it('sin auth.uid() (anon) -> 401', () => {
    expect(decideCallerAuthorization(null, null)).toBe(401);
  });
  it('authenticated pero sin fila en app_profiles -> 403', () => {
    expect(decideCallerAuthorization('uid-1', null)).toBe(403);
  });
  it('perfil inactivo -> 403, sin importar el rol', () => {
    expect(decideCallerAuthorization('uid-1', { role: 'ADMINISTRADOR', active: false })).toBe(403);
  });
  it('LUBRICADOR activo -> autorizado (null) — a diferencia de manage-users, cualquier rol activo puede llamar', () => {
    expect(decideCallerAuthorization('uid-1', { role: 'LUBRICADOR', active: true })).toBeNull();
  });
  it('VISOR activo -> autorizado (null)', () => {
    expect(decideCallerAuthorization('uid-1', { role: 'VISOR', active: true })).toBeNull();
  });
  it('ADMINISTRADOR activo -> autorizado (null)', () => {
    expect(decideCallerAuthorization('uid-1', { role: 'ADMINISTRADOR', active: true })).toBeNull();
  });
});

describe('getCallerProfile() — resuelve auth.uid() real vía /auth/v1/user, nunca decodifica el JWT a mano', () => {
  it('JWT válido + fila en app_profiles -> authUserId + profile resueltos', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'uid-1' }) };
      if (String(url).includes('/rest/v1/app_profiles')) return { ok: true, json: async () => ([{ auth_user_id: 'uid-1', app_user_id: 'u_x', role: 'LUBRICADOR', active: true }]) };
      throw new Error('unexpected ' + url);
    }));
    const { authUserId, profile } = await getCallerProfile(ENV, 'jwt-valido');
    expect(authUserId).toBe('uid-1');
    expect(profile.role).toBe('LUBRICADOR');
  });

  it('JWT inválido -> authUserId null, profile null (nunca llega a leer app_profiles)', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('/auth/v1/user')) return { ok: false, status: 401 };
      throw new Error('no debería consultar app_profiles sin JWT válido');
    });
    vi.stubGlobal('fetch', fetchMock);
    const { authUserId, profile } = await getCallerProfile(ENV, 'jwt-malo');
    expect(authUserId).toBeNull();
    expect(profile).toBeNull();
  });
});

describe('handleUpdateOwnProfile() — SOLO la propia fila (auth_user_id ya verificado), SOLO display_name', () => {
  it('display_name válido -> PATCH a app_profiles filtrado por el auth_user_id VERIFICADO (nunca uno del body)', async () => {
    let patchedUrl = null;
    let patchedBody = null;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      patchedUrl = String(url);
      patchedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({}) };
    }));

    const result = await handleUpdateOwnProfile(ENV, 'uid-1', { display_name: '  Nombre Nuevo  ', auth_user_id: 'uid-ATACANTE', app_user_id: 'u_otro' });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, display_name: 'Nombre Nuevo' });
    expect(patchedUrl).toContain('auth_user_id=eq.uid-1'); // el uid verificado, NUNCA el del body
    expect(patchedUrl).not.toContain('uid-ATACANTE');
    expect(patchedBody.display_name).toBe('Nombre Nuevo');
    // Nunca envía role/active/app_user_id — solo display_name + updated_at.
    expect(Object.keys(patchedBody).sort()).toEqual(['display_name', 'updated_at']);
  });

  it('display_name vacío -> 400, nunca llama a fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await handleUpdateOwnProfile(ENV, 'uid-1', { display_name: '   ' });
    expect(result.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('display_name ausente -> 400, nunca llama a fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await handleUpdateOwnProfile(ENV, 'uid-1', {});
    expect(result.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PATCH falla en el servidor -> 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    const result = await handleUpdateOwnProfile(ENV, 'uid-1', { display_name: 'Nombre' });
    expect(result.status).toBe(502);
  });
});

describe('svHeaders() — SOLO service_role, nunca sale de esta función (server-side)', () => {
  it('usa serviceRoleKey tanto en apikey como en Authorization', () => {
    const h = svHeaders(ENV);
    expect(h.apikey).toBe(ENV.serviceRoleKey);
    expect(h.Authorization).toBe(`Bearer ${ENV.serviceRoleKey}`);
  });
});
