// tests/unit/quick-unlock.test.js
//
// P0-2 — "PIN rápido" offline (src/core/quick-unlock.js). Módulo separado
// del login PIN legacy: mientras AUTH_MODE sea 'legacy' (default), nada de
// esto se ejecuta nunca (ver app.js, branch del listener de
// DOMContentLoaded). Todo con mocks (DB en memoria, sin IndexedDB real,
// sin red) — nunca contra producción. Cubre las letras A-N del pedido de
// cierre; H/M/N están cubiertas por archivos ya existentes (ver notas
// junto a cada bloque).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadQuickUnlockLogic, loadAuthLogic } from '../helpers/loadLubricationLogic.js';

function makeFakeDB() {
  let config = null;
  let quickUnlock = null;
  let authTokens = null;
  let authProfileSnapshot = null;
  return {
    async getConfig() { return config; },
    async setConfig(v) { config = v; return v; },
    async getQuickUnlock() { return quickUnlock; },
    async setQuickUnlock(v) { quickUnlock = v; return v; },
    async getAuthTokens() { return authTokens; },
    async setAuthTokens(v) { authTokens = v; return v; },
    async getAuthProfileSnapshot() { return authProfileSnapshot; },
    async setAuthProfileSnapshot(v) { authProfileSnapshot = v; return v; },
    _dump() { return { quickUnlock, authTokens, authProfileSnapshot }; },
  };
}

const APP_USER_ID = 'u_jvalles';

let db, QuickUnlock, isValidPinFormat, isTrivialPin;

beforeEach(() => {
  db = makeFakeDB();
  ({ QuickUnlock, isValidPinFormat, isTrivialPin } = loadQuickUnlockLogic(db));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('A) el PIN nunca se guarda en texto plano', () => {
  it('el registro persistido no tiene ningún campo con el PIN literal, solo salt+hash', async () => {
    await QuickUnlock.configure(APP_USER_ID, '7391');
    const rec = await db.getQuickUnlock();
    expect(rec.hash).toBeDefined();
    expect(rec.salt).toBeDefined();
    expect(JSON.stringify(rec)).not.toContain('7391');
    expect(rec.pin).toBeUndefined();
    expect(rec.password).toBeUndefined();
  });

  it('formato inválido y PIN trivial se rechazan ANTES de tocar DB (nunca se guarda nada)', async () => {
    await expect(QuickUnlock.configure(APP_USER_ID, '12')).rejects.toThrow();
    expect(await db.getQuickUnlock()).toBeNull();
    await expect(QuickUnlock.configure(APP_USER_ID, '1234')).rejects.toThrow();
    expect(await db.getQuickUnlock()).toBeNull();
    await expect(QuickUnlock.configure(APP_USER_ID, '0000')).rejects.toThrow();
    await expect(QuickUnlock.configure(APP_USER_ID, '4321')).rejects.toThrow();
    await expect(QuickUnlock.configure(APP_USER_ID, '654321')).rejects.toThrow();
  });
});

describe('B) hash diferente con salts diferentes', () => {
  it('el MISMO PIN configurado dos veces produce hashes distintos (salt aleatorio por dispositivo)', async () => {
    await QuickUnlock.configure(APP_USER_ID, '739184');
    const rec1 = await db.getQuickUnlock();
    await QuickUnlock.configure(APP_USER_ID, '739184');
    const rec2 = await db.getQuickUnlock();
    expect(rec1.salt).not.toBe(rec2.salt);
    expect(rec1.hash).not.toBe(rec2.hash);
  });
});

describe('C) PIN correcto desbloquea', () => {
  it('attemptUnlock() devuelve ok:true con el PIN configurado', async () => {
    await QuickUnlock.configure(APP_USER_ID, '739184');
    const res = await QuickUnlock.attemptUnlock(APP_USER_ID, '739184');
    expect(res.ok).toBe(true);
  });
});

describe('D) PIN incorrecto no desbloquea', () => {
  it('attemptUnlock() devuelve ok:false, reason WRONG_PIN, con intentos restantes', async () => {
    await QuickUnlock.configure(APP_USER_ID, '739184');
    const res = await QuickUnlock.attemptUnlock(APP_USER_ID, '000000');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('WRONG_PIN');
    expect(res.attemptsLeft).toBe(4);
  });
});

describe('E) 5 fallos consecutivos -> lockout', () => {
  it('el 5º intento fallido bloquea por 5 minutos', async () => {
    await QuickUnlock.configure(APP_USER_ID, '739184');
    for (let i = 0; i < 4; i++) {
      const res = await QuickUnlock.attemptUnlock(APP_USER_ID, '000000');
      expect(res.reason).toBe('WRONG_PIN');
    }
    const res5 = await QuickUnlock.attemptUnlock(APP_USER_ID, '000000');
    expect(res5.ok).toBe(false);
    expect(res5.reason).toBe('LOCKED');
    expect(res5.remainingMs).toBeGreaterThan(0);
    expect(await QuickUnlock.isLockedOut(APP_USER_ID)).toBe(true);
  });

  it('mientras está bloqueado, ni siquiera el PIN CORRECTO desbloquea', async () => {
    await QuickUnlock.configure(APP_USER_ID, '739184');
    for (let i = 0; i < 5; i++) await QuickUnlock.attemptUnlock(APP_USER_ID, '000000');
    const res = await QuickUnlock.attemptUnlock(APP_USER_ID, '739184'); // PIN correcto
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('LOCKED');
  });

  it('el bloqueo NUNCA borra el PIN configurado ni ningún dato — solo cuenta intentos', async () => {
    await QuickUnlock.configure(APP_USER_ID, '739184');
    for (let i = 0; i < 5; i++) await QuickUnlock.attemptUnlock(APP_USER_ID, '000000');
    const rec = await db.getQuickUnlock();
    expect(rec.appUserId).toBe(APP_USER_ID);
    expect(rec.hash).toBeDefined();
    expect(rec.salt).toBeDefined();
  });

  it('un PIN correcto reinicia el contador de intentos fallidos a 0', async () => {
    await QuickUnlock.configure(APP_USER_ID, '739184');
    await QuickUnlock.attemptUnlock(APP_USER_ID, '000000');
    await QuickUnlock.attemptUnlock(APP_USER_ID, '000000');
    await QuickUnlock.attemptUnlock(APP_USER_ID, '739184'); // correcto
    const rec = await db.getQuickUnlock();
    expect(rec.failedAttempts).toBe(0);
    expect(rec.lockedUntil).toBeNull();
  });
});

describe('F) el bloqueo persiste tras cerrar y volver a abrir la app (reload)', () => {
  it('una instancia NUEVA de QuickUnlock, sobre el mismo DB persistido, sigue viendo el bloqueo', async () => {
    await QuickUnlock.configure(APP_USER_ID, '739184');
    for (let i = 0; i < 5; i++) await QuickUnlock.attemptUnlock(APP_USER_ID, '000000');
    expect(await QuickUnlock.isLockedOut(APP_USER_ID)).toBe(true);

    // Simula "cerrar y reabrir la app": nueva carga del módulo, MISMO `db`
    // (el contador vive en DB, nunca en memoria — ver quick-unlock.js).
    const { QuickUnlock: QuickUnlock2 } = loadQuickUnlockLogic(db);
    expect(await QuickUnlock2.isLockedOut(APP_USER_ID)).toBe(true);
    const res = await QuickUnlock2.attemptUnlock(APP_USER_ID, '739184');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('LOCKED');
  });
});

describe('G) el PIN NUNCA habilita sync — desacoplado por completo de Auth.isAuthenticated()', () => {
  it('un desbloqueo exitoso no cambia en nada el estado de Auth (isAuthenticated sigue dependiendo solo de la sesión real)', async () => {
    await QuickUnlock.configure(APP_USER_ID, '739184');
    const { Auth } = loadAuthLogic(db); // sin sesión ni perfil cargados
    expect(Auth.isAuthenticated()).toBe(false);
    const res = await QuickUnlock.attemptUnlock(APP_USER_ID, '739184');
    expect(res.ok).toBe(true);
    expect(Auth.isAuthenticated()).toBe(false); // el PIN no la tocó en absoluto
    // El gate real de sync (0 requests sin Auth.isAuthenticated()) ya está
    // probado en tests/unit/sync-auth-gate.test.js — este test solo prueba
    // que QuickUnlock jamás participa en esa decisión.
  });
});

describe('N) el PIN NUNCA cambia ni eleva el rol — el rol siempre viene del snapshot de Auth, nunca de QuickUnlock', () => {
  it('un desbloqueo exitoso no devuelve ni toca ningún campo de rol', async () => {
    await db.setAuthProfileSnapshot({ authUserId: 'u1', appUserId: APP_USER_ID, displayName: 'Junior Valles', role: 'LUBRICADOR', active: true });
    await QuickUnlock.configure(APP_USER_ID, '739184');
    const res = await QuickUnlock.attemptUnlock(APP_USER_ID, '739184');
    expect(res).toEqual({ ok: true }); // ninguna propiedad de rol en el resultado
    // El snapshot (única fuente real del rol, ver app.js currentUserFromAuthProfile())
    // queda exactamente igual — QuickUnlock no lo leyó ni lo escribió.
    const snapshot = await db.getAuthProfileSnapshot();
    expect(snapshot.role).toBe('LUBRICADOR');
  });

  it('el registro persistido de QuickUnlock (auth_quick_unlock) nunca guarda un campo "role"', async () => {
    await QuickUnlock.configure(APP_USER_ID, '739184');
    await QuickUnlock.attemptUnlock(APP_USER_ID, '000000'); // un intento fallido de más, para forzar otra escritura
    const rec = await db.getQuickUnlock();
    expect(Object.keys(rec)).not.toContain('role');
    expect(JSON.stringify(rec)).not.toContain('ADMINISTRADOR');
  });
});

describe('I) reconnect + refresh inválido -> el snapshot desaparece, así que la app debe pedir contraseña (nunca el PIN)', () => {
  it('tras un refresh fallido, DB.getAuthProfileSnapshot() queda null aunque el PIN siga configurado', async () => {
    await db.setConfig({ url: 'https://fake.test', anonKey: 'anon-test' });
    await QuickUnlock.configure(APP_USER_ID, '739184'); // el PIN sigue existiendo en DB
    await db.setAuthTokens({ accessToken: 'OLD', refreshToken: 'RT-MALO', expiresAt: Date.now() - 1000, authUserId: 'u1' });
    await db.setAuthProfileSnapshot({ authUserId: 'u1', appUserId: APP_USER_ID, displayName: 'Junior Valles', role: 'ADMINISTRADOR', active: true });

    const { Auth } = loadAuthLogic(db);
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('grant_type=refresh_token')) return { ok: false, status: 401, json: async () => ({}) };
      throw new Error('unexpected fetch ' + url);
    }));
    expect(await Auth.restoreSession()).toBeNull(); // refresh inválido -> signOut() interno

    const snapshot = await db.getAuthProfileSnapshot();
    expect(snapshot).toBeNull(); // la pantalla de PIN (que exige un snapshot) queda sin identidad -> cae a Usuario+Contraseña
    expect(await QuickUnlock.isConfigured(APP_USER_ID)).toBe(true); // el PIN en sí NO se borró (solo logout()/disable() lo hacen)
  });
});

describe('J) perfil inactivo no puede saltarse el bloqueo con el PIN', () => {
  it('un snapshot con active:false nunca debe ofrecer la pantalla de PIN, aunque esté configurado', async () => {
    await QuickUnlock.configure(APP_USER_ID, '739184');
    const { isValidProfile } = loadAuthLogic(db);
    const snapshotInactivo = { authUserId: 'u1', appUserId: APP_USER_ID, displayName: 'Junior Valles', role: 'ADMINISTRADOR', active: false };
    // Misma condición exacta que usa app.js renderAuthGateSupabase() para
    // decidir si muestra el PIN: snapshot && isValidProfile(snapshot).
    const mostrariaPin = !!(snapshotInactivo && isValidProfile(snapshotInactivo)) && await QuickUnlock.isConfigured(APP_USER_ID);
    expect(mostrariaPin).toBe(false);
  });
});

describe('K) CERRAR SESIÓN borra el PIN rápido (junto con auth_tokens y el snapshot)', () => {
  it('logout real: signOut() + QuickUnlock.disable() dejan los 3 namespaces en null', async () => {
    await QuickUnlock.configure(APP_USER_ID, '739184');
    await db.setAuthTokens({ accessToken: 'X', refreshToken: 'Y', expiresAt: Date.now() + 3600000, authUserId: 'u1' });
    await db.setAuthProfileSnapshot({ authUserId: 'u1', appUserId: APP_USER_ID, displayName: 'Junior Valles', role: 'ADMINISTRADOR', active: true });

    const { Auth } = loadAuthLogic(db);
    await Auth.signOut();
    await QuickUnlock.disable();

    expect(await db.getAuthTokens()).toBeNull();
    expect(await db.getAuthProfileSnapshot()).toBeNull();
    expect(await db.getQuickUnlock()).toBeNull();
  });

  it('logout NUNCA toca datos operativos (fuera del alcance de este módulo, pero confirma que disable() es quirúrgico: solo su propia key)', async () => {
    await QuickUnlock.configure(APP_USER_ID, '739184');
    await db.setConfig({ url: 'https://fake.test', anonKey: 'anon-test' }); // config de sync, no debe tocarse
    await QuickUnlock.disable();
    expect(await db.getConfig()).toEqual({ url: 'https://fake.test', anonKey: 'anon-test' });
  });
});

describe('L) BLOQUEAR (distinto de cerrar sesión) NUNCA borra el PIN configurado ni la sesión', () => {
  it('un desbloqueo exitoso (equivalente a "volver de bloquear") conserva el registro intacto, nunca llama a disable()', async () => {
    await QuickUnlock.configure(APP_USER_ID, '739184');
    await db.setAuthTokens({ accessToken: 'X', refreshToken: 'Y', expiresAt: Date.now() + 3600000, authUserId: 'u1' });
    await db.setAuthProfileSnapshot({ authUserId: 'u1', appUserId: APP_USER_ID, displayName: 'Junior Valles', role: 'ADMINISTRADOR', active: true });

    const res = await QuickUnlock.attemptUnlock(APP_USER_ID, '739184');
    expect(res.ok).toBe(true);

    // "Bloquear" en app.js (lockApp()) nunca llama Auth.signOut() ni
    // QuickUnlock.disable() — a diferencia de K), aquí los 3 namespaces
    // deben seguir EXACTAMENTE como estaban.
    expect(await QuickUnlock.isConfigured(APP_USER_ID)).toBe(true);
    expect(await db.getAuthTokens()).not.toBeNull();
    expect(await db.getAuthProfileSnapshot()).not.toBeNull();
  });
});

// M) "legacy login intacto" — no aplica un test aquí: este módulo entero
// es nuevo (src/core/quick-unlock.js) y app.js solo lo invoca DETRÁS de
// `Auth.isSupabaseMode()`, nunca dentro de renderLogin()/doLogin() (login
// PIN legacy, sin tocar). La regresión se confirma corriendo la suite
// completa (renderLogin/doLogin no tienen tests unitarios propios — están
// cubiertos por tests/ui/login-responsive.spec.js, Playwright) y
// verificando que ningún test existente cambió de resultado.

// N) "JWT sync de 4645e31 sigue PASS" — cubierto por
// tests/unit/sync-auth-gate.test.js (bloque P, sin cambios en este
// cierre) — se re-ejecuta como parte de la suite completa.

describe('Formato de PIN — límites exactos', () => {
  it('acepta 4 y 6 dígitos, rechaza cualquier otra longitud o caracteres no numéricos', () => {
    expect(isValidPinFormat('7391')).toBe(true);
    expect(isValidPinFormat('739184')).toBe(true);
    expect(isValidPinFormat('12')).toBe(false);
    expect(isValidPinFormat('12345')).toBe(false);
    expect(isValidPinFormat('12a4')).toBe(false);
    expect(isValidPinFormat('')).toBe(false);
    expect(isValidPinFormat(null)).toBe(false);
  });

  it('isTrivialPin() rechaza los patrones más obvios pedidos explícitamente', () => {
    expect(isTrivialPin('0000')).toBe(true);
    expect(isTrivialPin('1111')).toBe(true);
    expect(isTrivialPin('1234')).toBe(true);
    expect(isTrivialPin('4321')).toBe(true);
    expect(isTrivialPin('123456')).toBe(true);
    expect(isTrivialPin('654321')).toBe(true);
    expect(isTrivialPin('7391')).toBe(false);
    expect(isTrivialPin('739184')).toBe(false);
  });
});
