// tests/unit/sync-watchdog.test.js
//
// Auditoría de sincronización (2026-10-20, §13 "WATCHDOG UX") — hallazgo
// real: el header podía quedar diciendo "SINCRONIZANDO…" indefinidamente
// si fullSync() tardaba de verdad más de lo razonable (muchas páginas de
// pull, red muy lenta — cada fetch individual ya tiene su propio timeout
// de 10s, pero la SUMA de varios no tiene techo). armSyncWatchdog() nunca
// cancela fullSync() ni cambia su resultado — es una red de seguridad de
// UX por encima: si pasan 45s sin que llegue un notify() posterior al de
// 'syncing', el header deja de fingir que está a punto de terminar.
//
// Ejecuta el código REAL de app.js (armSyncWatchdog/onSyncStateChange/
// updateConnBadge), con fake timers reales (vi.useFakeTimers), nunca una
// reimplementación.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, DB_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const dbSource = readSource(DB_JS_PATH);
const nowISOSrc = extractDeclaration(dbSource, 'nowISO');
// lastSyncState/_syncWatchdogTimer son `let` top-level (no `function`/`const`,
// extractDeclaration() solo soporta esos dos) — se declaran aquí con el
// MISMO valor inicial real (app.js: `let lastSyncState = { status: 'idle' };`),
// nunca reimplementados; armSyncWatchdog/onSyncStateChange/updateConnBadge
// SÍ son el código real, extraído tal cual.
const names = ['armSyncWatchdog', 'onSyncStateChange', 'updateConnBadge'];
const body = names.map(n => extractDeclaration(appSource, n)).join('\n\n');

function loadSyncWatchdog({ route = 'dashboard', bootstrapComplete = true } = {}) {
  const factory = new Function(
    '$', 'App', 'Sync', 'navigator', 'document', 'redibujarPantallaActual',
    'notifyNewAnomalies', 'refreshLocalNotifications', 'updateTareasMensajesNavBadge',
    `${nowISOSrc}\nlet lastSyncState = { status: 'idle' };\nlet _syncWatchdogTimer = null;\n${body}\nreturn { onSyncStateChange, armSyncWatchdog, updateConnBadge, get lastSyncState() { return lastSyncState; } };`
  );
  const badge = { className: '', textContent: '', title: '', setAttribute: vi.fn() };
  const $ = (sel) => (sel === '#conn-badge' ? badge : sel === '#conn-badge-detail' ? { classList: { toggle: vi.fn() } } : null);
  const App = { route, lubricadorGreaseFlowActive: false, _lubBootstrapRetrying: false };
  const Sync = { getAccountSyncState: async () => ({ bootstrapComplete }) };
  const navigator = { onLine: true };
  // querySelector: null en todos los "guard" de modal/formulario abierto (ver
  // app.js onSyncStateChange() ~2466-2468) — así el gate de re-render de
  // bootstrap (relevante solo con App.route==='turno') puede evaluarse.
  const document = { querySelector: () => null };
  const redibujarPantallaActual = vi.fn();
  const mod = factory($, App, Sync, navigator, document, redibujarPantallaActual, vi.fn(), vi.fn(), vi.fn());
  return { mod, badge, redibujarPantallaActual };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('armSyncWatchdog() — "SINCRONIZANDO…" nunca queda mudo para siempre', () => {
  it('status sigue "syncing" tras 45s sin un notify posterior -> pasa a "stalled" y el header deja de decir SINCRONIZANDO', async () => {
    const { mod, badge } = loadSyncWatchdog();
    await mod.onSyncStateChange({ status: 'syncing', at: 'T0' });
    expect(mod.lastSyncState.status).toBe('syncing');
    expect(badge.textContent).toBe('SINCRONIZANDO…');

    await vi.advanceTimersByTimeAsync(45000);

    expect(mod.lastSyncState.status).toBe('stalled');
    expect(badge.textContent).toBe('SINCRONIZACIÓN DEMORADA');
    expect(badge.className).toBe('conn-badge conn-off');
  });

  it('si fullSync() SÍ termina antes de 45s (ok/error/lo que sea), el watchdog se desarma y "stalled" nunca llega a dispararse', async () => {
    const { mod, badge } = loadSyncWatchdog();
    await mod.onSyncStateChange({ status: 'syncing', at: 'T0' });
    await mod.onSyncStateChange({ status: 'ok', pulled: 0, at: 'T1' });
    expect(badge.textContent).toBe('SINCRONIZADO');

    await vi.advanceTimersByTimeAsync(60000); // bastante más que los 45s del watchdog

    // El timer anterior fue cancelado por clearTimeout() en el 'else' de
    // onSyncStateChange() — 'stalled' nunca pisa el 'ok' ya resuelto.
    expect(mod.lastSyncState.status).toBe('ok');
    expect(badge.textContent).toBe('SINCRONIZADO');
  });

  it('dos ciclos "syncing" seguidos (ej. timer + reconnect casi a la vez) no arman dos watchdogs — el segundo reinicia el timer, nunca corre dos', async () => {
    const { mod, badge } = loadSyncWatchdog();
    await mod.onSyncStateChange({ status: 'syncing', at: 'T0' });
    await vi.advanceTimersByTimeAsync(30000); // 30s, todavía no dispara (faltan 15s)
    await mod.onSyncStateChange({ status: 'syncing', at: 'T1' }); // reinicia el reloj del watchdog
    await vi.advanceTimersByTimeAsync(30000); // otros 30s (60s totales desde T0, pero solo 30s desde T1)
    expect(mod.lastSyncState.status).toBe('syncing'); // el watchdog reiniciado aún no cumplió sus 45s
    expect(badge.textContent).toBe('SINCRONIZANDO…');
  });
});

describe('onSyncStateChange() — "stalled" con caché válida nunca fuerza la pantalla de bootstrap en Mi Turno (cierre de ROOT CAUSE #2, §11 "WATCHDOG")', () => {
  it('con bootstrapComplete=true (caché propia válida), "stalled" SOLO cambia el header — redibujarPantallaActual() nunca se llama', async () => {
    const { mod, redibujarPantallaActual } = loadSyncWatchdog({ route: 'turno', bootstrapComplete: true });
    await mod.onSyncStateChange({ status: 'syncing', at: 'T0' });
    await vi.advanceTimersByTimeAsync(45000); // dispara el watchdog -> 'stalled'
    expect(mod.lastSyncState.status).toBe('stalled');
    expect(redibujarPantallaActual).not.toHaveBeenCalled();
  });

  it('con bootstrapComplete=false (sin caché propia válida todavía), "stalled" SÍ vuelve a mostrar la pantalla de bootstrap/retry', async () => {
    const { mod, redibujarPantallaActual } = loadSyncWatchdog({ route: 'turno', bootstrapComplete: false });
    await mod.onSyncStateChange({ status: 'syncing', at: 'T0' });
    redibujarPantallaActual.mockClear(); // solo interesa lo que dispara 'stalled' en sí, no el 'syncing' inicial
    await vi.advanceTimersByTimeAsync(45000);
    expect(mod.lastSyncState.status).toBe('stalled');
    expect(redibujarPantallaActual).toHaveBeenCalledTimes(1);
  });
});
