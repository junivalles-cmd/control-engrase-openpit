// tests/unit/cutover-security.test.js
//
// Cutover Auth/RLS preparado (docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §26-27)
// — AUTH_MODE es ahora 'supabase' de verdad en el código committeado
// (AÚN SIN DESPLEGAR: sin build publicado, sin instalar, sin push, policy
// legacy de producción SIGUE ABIERTA). Cubre las letras A y E del pedido
// de cierre — el resto (B/C/D/F/G/H/I/J/K) ya está cubierto por archivos
// existentes sin cambios de comportamiento:
//   B, G   -> tests/unit/sync-auth-gate.test.js, backend-connectivity.test.js
//   D, F   -> tests/unit/auth.test.js, manage-users-logic.test.js
//   H      -> tests/unit/sync-multidevice.test.js, sync-auth-gate.test.js (L)
//   I      -> tests/unit/sync-auth-gate.test.js (N.B), backend-connectivity.test.js
//   J      -> backend-connectivity.test.js (el PIN local/Quick Unlock que
//             también cubría esta letra se retiró en UX CAMPO V2, 2026-10-24)
//   K      -> tests/ui/registro-sync-guard.spec.js (Playwright, sin cambios)
//   C      -> requiere el cutover SQL real ejecutado contra producción para
//             observarse directamente (DENIED de verdad); no puede probarse
//             con mocks — verificado por revisión del migration file
//             0003_auth_rls_CUTOVER_PREPARED.sql (auth.uid() nulo para anon
//             -> current_app_role()/current_app_active() resuelven a
//             null/false -> las 3 policies nuevas de 0002 evalúan a false).

import { describe, it, expect, beforeAll } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, loadAppLogic } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);

describe('A) AUTH_MODE=\'supabase\' -> el login PIN legacy (renderLogin/doLogin) queda INACCESIBLE desde el arranque', () => {
  it('el listener de DOMContentLoaded solo llama a renderLogin() DENTRO del else de Auth.isSupabaseMode() — nunca en paralelo', () => {
    // Ancla justo antes del branch real (ver app.js) — evita depender de
    // números de línea, que cambian con cada sesión.
    const anchor = 'Sync.startAuto(App.generalSettings.syncIntervalSeconds);';
    const i = appSource.indexOf(anchor);
    expect(i).toBeGreaterThan(-1);
    const region = appSource.slice(i, i + 700);

    // 1. La rama supabase decide PRIMERO, con un `if` explícito.
    expect(region).toMatch(/Auth\.isSupabaseMode\(\)\)\s*\{\s*renderAuthGateSupabase\(\);\s*\}\s*else\s*\{/);

    // 2. renderLogin() (legacy) solo aparece DESPUÉS de ese `else {` —
    // nunca antes, nunca fuera de él.
    const elseIdx = region.search(/\}\s*else\s*\{/);
    const renderLoginIdx = region.indexOf('renderLogin();');
    expect(elseIdx).toBeGreaterThan(-1);
    expect(renderLoginIdx).toBeGreaterThan(elseIdx);
  });

  it('logout() real (CERRAR SESIÓN) también corta ANTES de llegar a renderLogin() cuando es supabase mode', () => {
    const body = extractDeclaration(appSource, 'logout');
    const supabaseIdx = body.search(/Auth\.isSupabaseMode\(\)\)\s*\{/);
    const returnIdx = body.indexOf('return;', supabaseIdx);
    const renderLoginIdx = body.indexOf('renderLogin();');
    expect(supabaseIdx).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(supabaseIdx);
    expect(renderLoginIdx).toBeGreaterThan(returnIdx); // el `return` ya cortó antes de llegar ahí
  });

  it('doLogin() (comparación PIN en texto plano, legacy) sigue existiendo sin borrarse — pero nunca se ejecuta al no invocarse renderLogin()', () => {
    // "no borrar código histórico de golpe" — se confirma que sigue ahí
    // (nadie lo eliminó por error), no que se ejecute.
    expect(appSource).toContain('pin === selected.pin');
  });
});

describe('E) modificar users.role localmente NUNCA afecta el rol/permiso efectivo en modo supabase', () => {
  let currentUserFromAuthProfile;
  beforeAll(() => {
    ({ currentUserFromAuthProfile } = loadAppLogic({}));
  });

  it('currentUserFromAuthProfile() construye el rol SOLO desde el perfil de Auth (app_profiles), nunca desde IndexedDB', () => {
    const profile = { appUserId: 'u_jvalles', displayName: 'Junior Valles', role: 'ADMINISTRADOR', active: true };
    const currentUser = currentUserFromAuthProfile(profile);
    expect(currentUser.role).toBe('ADMINISTRADOR');
    expect(currentUser.id).toBe('u_jvalles');
    // Nunca lee/consulta el store "users" legacy — la función es pura,
    // recibe el perfil y no toca DB en absoluto (ninguna referencia a DB.*
    // en su cuerpo real, ver test de fuente abajo).
  });

  it('el cuerpo real de currentUserFromAuthProfile() nunca referencia el store "users" ni DB.get/DB.all', () => {
    const body = extractDeclaration(appSource, 'currentUserFromAuthProfile');
    expect(body).not.toMatch(/DB\.(get|all|allActive|put)\(/);
    expect(body).not.toContain("'users'");
  });

  it('un rol distinto "inyectado" en el objeto profile (simulando manipulación) nunca puede subir de rol porque el profile en sí viene siempre de una fuente server-verificada (Auth.getProfile()) — aquí solo se confirma que la función respeta EXACTAMENTE el campo role recibido, sin normalizarlo hacia arriba', () => {
    const profileBajo = { appUserId: 'u_test', displayName: 'Test', role: 'LUBRICADOR', active: true };
    expect(currentUserFromAuthProfile(profileBajo).role).toBe('LUBRICADOR');
  });
});
