// tests/unit/quick-unlock-4h-policy.test.js
//
// "Quick Unlock para uso en campo" (2026-10-20) — ANTES, renderAuthGateSupabase()
// mostraba la pantalla de PIN en CUALQUIER reapertura fría de la app
// (reinstalación de proceso en Android por presión de memoria, F5 en Web),
// sin importar cuán reciente fuera el último uso real. Ahora solo exige
// PIN tras QUICK_UNLOCK_INACTIVITY_MS (4h) de inactividad REAL o al
// bloquear manualmente — nunca por eventos técnicos. Ejecuta el código
// REAL de quick-unlock.js/app.js (nunca una reimplementación), con fakes
// solo para DB/Auth/render-targets/reloj.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadQuickUnlockLogic } from '../helpers/loadLubricationLogic.js';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

function makeFakeDB() {
  let quickUnlock = null;
  return {
    async getQuickUnlock() { return quickUnlock; },
    async setQuickUnlock(v) { quickUnlock = v; return v; },
    _dump() { return quickUnlock; },
  };
}

const appSource = readSource(APP_JS_PATH);

describe('QuickUnlock.recordActivity()/isWithinInactivityGrace() — ventana de gracia real (§8: tests 1-4, 15)', () => {
  let db, QuickUnlock, QUICK_UNLOCK_INACTIVITY_MS;
  beforeEach(() => {
    db = makeFakeDB();
    ({ QuickUnlock, QUICK_UNLOCK_INACTIVITY_MS } = loadQuickUnlockLogic(db));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T10:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('QUICK_UNLOCK_INACTIVITY_MS es exactamente 4 horas', () => {
    expect(QUICK_UNLOCK_INACTIVITY_MS).toBe(4 * 60 * 60 * 1000);
  });

  it('sin PIN configurado todavía: isWithinInactivityGrace nunca inventa una ventana', async () => {
    expect(await QuickUnlock.isWithinInactivityGrace('u1')).toBe(false);
  });

  it('con PIN configurado pero SIN actividad registrada nunca (rec sin lastActivityAt): nunca inventa gracia', async () => {
    await QuickUnlock.configure('u1', '135790');
    expect(await QuickUnlock.isWithinInactivityGrace('u1')).toBe(false);
  });

  it('#1 reopen a 5 minutos -> dentro de la ventana (no PIN)', async () => {
    await QuickUnlock.configure('u1', '135790');
    await QuickUnlock.recordActivity('u1');
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(await QuickUnlock.isWithinInactivityGrace('u1')).toBe(true);
  });

  it('#2 reopen a 30 minutos -> dentro de la ventana (no PIN)', async () => {
    await QuickUnlock.configure('u1', '135790');
    await QuickUnlock.recordActivity('u1');
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(await QuickUnlock.isWithinInactivityGrace('u1')).toBe(true);
  });

  it('#3 reopen a 3h59 -> todavía dentro de la ventana (no PIN)', async () => {
    await QuickUnlock.configure('u1', '135790');
    await QuickUnlock.recordActivity('u1');
    vi.advanceTimersByTime(3 * 60 * 60 * 1000 + 59 * 60 * 1000);
    expect(await QuickUnlock.isWithinInactivityGrace('u1')).toBe(true);
  });

  it('#4 reopen a 4h01 -> fuera de la ventana (pide PIN)', async () => {
    await QuickUnlock.configure('u1', '135790');
    await QuickUnlock.recordActivity('u1');
    vi.advanceTimersByTime(4 * 60 * 60 * 1000 + 60 * 1000);
    expect(await QuickUnlock.isWithinInactivityGrace('u1')).toBe(false);
  });

  it('#15 lastActivityAt persiste en el MISMO registro IndexedDB (auth_quick_unlock) — sobrevive un "reopen" simulado (DB fresca, nunca estado en memoria)', async () => {
    await QuickUnlock.configure('u1', '135790');
    await QuickUnlock.recordActivity('u1');
    const persisted = db._dump();
    expect(typeof persisted.lastActivityAt).toBe('string');
    // "Reopen": una instancia de QuickUnlock COMPLETAMENTE nueva, contra la
    // MISMA DB (nunca el mismo objeto JS en memoria) — simula perder todo
    // el estado de ejecución (reload/reopen/WebView restart) y volver a
    // leer solo lo que quedó en IndexedDB.
    const { QuickUnlock: QuickUnlockReopened } = loadQuickUnlockLogic(db);
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(await QuickUnlockReopened.isWithinInactivityGrace('u1')).toBe(true);
  });

  it('nunca filtra la ventana de gracia de una identidad a otra (appUserId distinto)', async () => {
    await QuickUnlock.configure('u1', '135790');
    await QuickUnlock.recordActivity('u1');
    expect(await QuickUnlock.isWithinInactivityGrace('u2')).toBe(false);
  });
});

// renderAuthGateSupabase() real, extraído de app.js — fakes SOLO para sus
// dependencias (Auth/DB/QuickUnlock/las 3 pantallas destino), igual
// patrón que loadSyncWatchdog() (tests/unit/sync-watchdog.test.js).
function loadAuthGate({ configured, withinGrace, snapshot = { appUserId: 'u1', displayName: 'Jose Guerrero', role: 'LUBRICADOR' } }) {
  const src = extractDeclaration(appSource, 'renderAuthGateSupabase');
  const enterAppAsProfile = vi.fn();
  const renderQuickUnlockScreen = vi.fn();
  const renderSupabaseLoginForm = vi.fn();
  const Auth = { restoreSession: async () => {} };
  const DB = { getAuthProfileSnapshot: async () => snapshot };
  const isValidProfile = () => true;
  const QuickUnlock = {
    isConfigured: async () => configured,
    isWithinInactivityGrace: async () => withinGrace,
  };
  const factory = new Function(
    'Auth', 'DB', 'isValidProfile', 'QuickUnlock', 'enterAppAsProfile', 'renderQuickUnlockScreen', 'renderSupabaseLoginForm',
    `${src}\nreturn renderAuthGateSupabase;`
  );
  const renderAuthGateSupabase = factory(Auth, DB, isValidProfile, QuickUnlock, enterAppAsProfile, renderQuickUnlockScreen, renderSupabaseLoginForm);
  return { renderAuthGateSupabase, enterAppAsProfile, renderQuickUnlockScreen, renderSupabaseLoginForm };
}

describe('renderAuthGateSupabase() — decide PIN sí/no al reabrir/recargar (§4 refresh web, §5 Android resume, §6 bloqueo manual)', () => {
  it('#5/#7/#8 configurado + actividad <4h + sin forzar PIN -> entra directo (enterAppAsProfile), nunca Quick Unlock', async () => {
    const { renderAuthGateSupabase, enterAppAsProfile, renderQuickUnlockScreen } = loadAuthGate({ configured: true, withinGrace: true });
    await renderAuthGateSupabase();
    expect(enterAppAsProfile).toHaveBeenCalledTimes(1);
    expect(renderQuickUnlockScreen).not.toHaveBeenCalled();
  });

  it('#6 configurado + actividad >=4h -> muestra Quick Unlock, nunca entra directo', async () => {
    const { renderAuthGateSupabase, enterAppAsProfile, renderQuickUnlockScreen } = loadAuthGate({ configured: true, withinGrace: false });
    await renderAuthGateSupabase();
    expect(renderQuickUnlockScreen).toHaveBeenCalledTimes(1);
    expect(enterAppAsProfile).not.toHaveBeenCalled();
  });

  it('#11 forcePin:true (lockApp(), bloqueo manual/por inactividad/fin de turno) SIEMPRE pide PIN, aunque la actividad sea reciente', async () => {
    const { renderAuthGateSupabase, enterAppAsProfile, renderQuickUnlockScreen } = loadAuthGate({ configured: true, withinGrace: true });
    await renderAuthGateSupabase({ forcePin: true });
    expect(renderQuickUnlockScreen).toHaveBeenCalledTimes(1);
    expect(enterAppAsProfile).not.toHaveBeenCalled();
  });

  it('sin PIN configurado: va al login normal, sin mirar la ventana de gracia (comportamiento preexistente, no cambiado)', async () => {
    const { renderAuthGateSupabase, renderSupabaseLoginForm, renderQuickUnlockScreen, enterAppAsProfile } = loadAuthGate({ configured: false, withinGrace: true });
    await renderAuthGateSupabase();
    expect(renderSupabaseLoginForm).toHaveBeenCalledTimes(1);
    expect(renderQuickUnlockScreen).not.toHaveBeenCalled();
    expect(enterAppAsProfile).not.toHaveBeenCalled();
  });
});

// isSafeToAutoLock()/fireInactivityLock() reales — §3/#14 "no interrumpir
// trabajo activo".
function loadInactivityLock({ lubricadorGreaseFlowActive = false, hasModalOpen = false, hasGreaseForm = false, hasValidateChoice = false } = {}) {
  const src = [extractDeclaration(appSource, 'isSafeToAutoLock'), extractDeclaration(appSource, 'fireInactivityLock')].join('\n\n');
  const App = { currentUser: { id: 'u1' }, lubricadorGreaseFlowActive };
  const selectors = new Set();
  if (hasModalOpen) selectors.add('#modal-overlay.open');
  if (hasGreaseForm) selectors.add('#grease-form');
  if (hasValidateChoice) selectors.add('.grease-validate-choice');
  const document = { querySelector: (sel) => (selectors.has(sel) ? {} : null) };
  const lockApp = vi.fn();
  const alertFn = vi.fn();
  const factory = new Function(
    'App', 'document', 'lockApp', 'alert', 'AUTO_LOCK_SAFE_RETRY_MS', 'setTimeout',
    `let inactivityTimer;\n${src}\nreturn { isSafeToAutoLock, fireInactivityLock, get inactivityTimer() { return inactivityTimer; } };`
  );
  const fakeSetTimeout = vi.fn((fn, ms) => { fakeSetTimeout.lastFn = fn; fakeSetTimeout.lastMs = ms; return 1; });
  const mod = factory(App, document, lockApp, alertFn, 30000, fakeSetTimeout);
  return { ...mod, App, lockApp, alertFn, fakeSetTimeout };
}

describe('isSafeToAutoLock()/fireInactivityLock() — #14 nunca interrumpe un formulario/flujo activo', () => {
  it('sin ningún formulario/flujo abierto: bloquea de inmediato', () => {
    const { fireInactivityLock, lockApp } = loadInactivityLock();
    fireInactivityLock();
    expect(lockApp).toHaveBeenCalledTimes(1);
  });

  it('con App.lubricadorGreaseFlowActive=true: NO bloquea, reintenta pronto (nunca pierde el flujo de engrase en curso)', () => {
    const { fireInactivityLock, lockApp, fakeSetTimeout } = loadInactivityLock({ lubricadorGreaseFlowActive: true });
    fireInactivityLock();
    expect(lockApp).not.toHaveBeenCalled();
    expect(fakeSetTimeout).toHaveBeenCalledWith(expect.any(Function), 30000);
  });

  it('con #grease-form abierto: NO bloquea (formulario de registro de engrase)', () => {
    const { fireInactivityLock, lockApp } = loadInactivityLock({ hasGreaseForm: true });
    fireInactivityLock();
    expect(lockApp).not.toHaveBeenCalled();
  });

  it('con un modal abierto (#modal-overlay.open): NO bloquea', () => {
    const { fireInactivityLock, lockApp } = loadInactivityLock({ hasModalOpen: true });
    fireInactivityLock();
    expect(lockApp).not.toHaveBeenCalled();
  });

  it('sin App.currentUser (ya sin sesión activa): no hace nada, nunca llama lockApp() de más', () => {
    const { fireInactivityLock, lockApp, App } = loadInactivityLock();
    App.currentUser = null;
    fireInactivityLock();
    expect(lockApp).not.toHaveBeenCalled();
  });
});

// Cadena real completa: renderAuthGateSupabase() + enterAppAsProfile() +
// replayPendingDeeplink() + currentUserFromAuthProfile() (todas REALES,
// nunca reimplementadas) — prueba end-to-end §7 "DEEPLINK" (#9/#10).
function loadAuthGateWithDeeplink({ configured, withinGrace, pendingDeeplink = null }) {
  const names = ['renderAuthGateSupabase', 'enterAppAsProfile', 'replayPendingDeeplink', 'currentUserFromAuthProfile'];
  const src = names.map((n) => extractDeclaration(appSource, n)).join('\n\n');
  const snapshot = { appUserId: 'u1', displayName: 'Jose Guerrero', role: 'LUBRICADOR' };
  const App = { currentUser: null, _pendingDeeplink: pendingDeeplink };
  const Auth = { restoreSession: async () => {}, isAuthenticated: () => true };
  const DB = { getAuthProfileSnapshot: async () => snapshot };
  const isValidProfile = () => true;
  const QuickUnlock = { isConfigured: async () => configured, isWithinInactivityGrace: async () => withinGrace };
  const Sync = { getAccountSyncState: async () => ({ bootstrapComplete: true }) }; // ya bootstrapeado -> enterAppAsProfile no intenta fullSync()
  const navigator = { onLine: true };
  const boot = vi.fn();
  const bindOneSignalIdentity = vi.fn();
  const abrirDesdeNotificacion = vi.fn();
  const renderQuickUnlockScreen = vi.fn();
  const renderSupabaseLoginForm = vi.fn();
  const factory = new Function(
    'App', 'Auth', 'DB', 'isValidProfile', 'QuickUnlock', 'Sync', 'navigator', 'boot', 'bindOneSignalIdentity', 'abrirDesdeNotificacion',
    'renderQuickUnlockScreen', 'renderSupabaseLoginForm',
    `${src}\nreturn { renderAuthGateSupabase, enterAppAsProfile };`
  );
  const mod = factory(App, Auth, DB, isValidProfile, QuickUnlock, Sync, navigator, boot, bindOneSignalIdentity, abrirDesdeNotificacion, renderQuickUnlockScreen, renderSupabaseLoginForm);
  return { ...mod, App, boot, abrirDesdeNotificacion, renderQuickUnlockScreen, snapshot };
}

describe('§7 DEEPLINK — reproduce el deep-link pendiente en el momento correcto (#9/#10)', () => {
  it('#9 push/deeplink con actividad <4h: entra directo Y reproduce el deeplink pendiente de inmediato', async () => {
    const { renderAuthGateSupabase, App, boot, abrirDesdeNotificacion } = loadAuthGateWithDeeplink({
      configured: true, withinGrace: true, pendingDeeplink: { tipo: 'anomaly', id: 'anom_1' },
    });
    await renderAuthGateSupabase();
    expect(boot).toHaveBeenCalledTimes(1);
    expect(abrirDesdeNotificacion).toHaveBeenCalledWith({ tipo: 'anomaly', id: 'anom_1' });
    expect(App._pendingDeeplink).toBeNull(); // consumido una sola vez
  });

  it('#10 push/deeplink con actividad >=4h: NO reproduce el deeplink todavía (muestra PIN primero); tras desbloquear SÍ se reproduce', async () => {
    const { renderAuthGateSupabase, enterAppAsProfile, App, boot, abrirDesdeNotificacion, renderQuickUnlockScreen, snapshot } = loadAuthGateWithDeeplink({
      configured: true, withinGrace: false, pendingDeeplink: { tipo: 'anomaly', id: 'anom_1' },
    });
    await renderAuthGateSupabase();
    expect(renderQuickUnlockScreen).toHaveBeenCalledTimes(1);
    expect(boot).not.toHaveBeenCalled();
    expect(abrirDesdeNotificacion).not.toHaveBeenCalled();
    expect(App._pendingDeeplink).toEqual({ tipo: 'anomaly', id: 'anom_1' }); // sigue esperando el desbloqueo real

    // Tras el desbloqueo exitoso (mismo camino que doUnlock() en la pantalla
    // real de Quick Unlock: enterAppAsProfile(snapshot)) SÍ se reproduce.
    await enterAppAsProfile(snapshot);
    expect(boot).toHaveBeenCalledTimes(1);
    expect(abrirDesdeNotificacion).toHaveBeenCalledWith({ tipo: 'anomaly', id: 'anom_1' });
    expect(App._pendingDeeplink).toBeNull();
  });
});

// #13 offline: QuickUnlock.recordActivity()/isWithinInactivityGrace() SOLO
// tocan IndexedDB (nunca red) — demostrado por construcción: ninguna de
// las pruebas de arriba stubea fetch/red y todas pasan igual.
describe('#13 offline — la ventana de gracia funciona sin red (ya demostrado: ningún test de arriba usó fetch)', () => {
  it('isWithinInactivityGrace()/recordActivity() no referencian fetch/red en su código fuente', () => {
    const quickUnlockSrc = readSource('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/quick-unlock.js');
    const recordActivitySrc = extractDeclaration(quickUnlockSrc, 'QuickUnlock'); // objeto completo, incluye ambos métodos
    const bodyOnly = recordActivitySrc.slice(recordActivitySrc.indexOf('recordActivity'), recordActivitySrc.indexOf('isLockedOut'));
    expect(bodyOnly).not.toContain('fetch(');
  });
});
