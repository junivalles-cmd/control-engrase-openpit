// tests/unit/sync-single-flight.test.js
//
// Auditoría de sincronización (2026-10-20, §4 "SINGLE-FLIGHT") — bug real
// confirmado leyendo el código: `this.syncing = true` se fijaba DESPUÉS
// de `await this.isConfigured()` (el PRIMER await de fullSync()). El
// guard `if (this.syncing) return;` es síncrono, así que solo protegía
// llamadas en el MISMO tick — dos disparadores casi simultáneos
// (reconnect + timer, foreground + timer, manual + reconnect, ver
// runAutoCycle()/startAuto()) podían pasar AMBOS ese chequeo antes de que
// el primero terminara de resolver isConfigured(), y terminar corriendo
// dos pushAll()/pullAll() completos a la vez — justo lo que §4 pide
// verificar. Fix: `this.syncing = true` ahora es la primera operación
// síncrona de la función, antes de cualquier await.
//
// Ejecuta Sync.fullSync() REAL (loadSyncLogic), nunca una reimplementación.
// pushAll()/pullAll() se espían (nunca se tocan sus cuerpos reales) solo
// para contar cuántas veces arrancan — igual que la red real, ambos
// requieren al menos un await antes de poder completar, así que el
// escenario de carrera (2 llamadas sin esperar entre sí) es representativo.

import { describe, it, expect, vi } from 'vitest';
import { loadSyncLogic } from '../helpers/loadLubricationLogic.js';

function makeFakeDB() {
  let config = { url: 'https://fixture.test', anonKey: 'anon-test' };
  return {
    async getConfig() { return config; },
    async setConfig(v) { config = v; return v; },
    async get() { return null; },
    async put() {},
    async all() { return []; },
    async recordConflicts() {},
  };
}

function fakeAuth() {
  return {
    isSupabaseMode: () => true, isAuthenticated: () => true,
    getSession: () => ({ accessToken: 'user-jwt' }),
    getProfile: () => ({ role: 'ADMINISTRADOR', appUserId: 'u1', authUserId: 'auth-u1', authorizationFingerprint: 'fp1', rowScopeEnforced: true }),
    restoreSession: async () => {},
    getSessionEpoch: () => 1,
    refreshAuthorizationContext: async () => ({ ok: true, changed: false, firstSnapshot: false, context: { rowScopeEnforced: true } }),
  };
}

describe('Sync.fullSync() — single-flight real contra 2 llamadas sin esperar entre sí (§4: reconnect+timer, foreground+timer, manual+reconnect)', () => {
  it('dos fullSync() disparados casi a la vez: pushAll/pullAll corren UNA sola vez cada uno, nunca dos ciclos completos simultáneos', async () => {
    const db = makeFakeDB();
    vi.stubGlobal('navigator', { onLine: true });
    const { Sync } = loadSyncLogic(db, ['equipment'], fakeAuth());
    // El cuerpo real de pushAll/pullAll no importa aquí (eso ya lo cubre
    // sync-multidevice.test.js) — solo cuántas veces arranca cada uno.
    const pushSpy = vi.spyOn(Sync, 'pushAll').mockResolvedValue({ ok: true, pushed: 0, errors: [], conflicts: 0, authErrors: 0, authErrorDetails: [], perf: { ms: 0, rows: 0 } });
    const pullSpy = vi.spyOn(Sync, 'pullAll').mockResolvedValue({ ok: true, pulled: 0, newAnomalies: [], conflicts: 0, perf: { networkMs: 0, parseMs: 0, mergeMs: 0, idbWriteMs: 0, rows: 0, pages: 1, puts: 0, totalMs: 0 } });

    // Sin await entre ambas — el escenario exacto de 2 disparadores casi
    // simultáneos (reconnect justo cuando el timer también dispara, etc.).
    const first = Sync.fullSync();
    const second = Sync.fullSync();
    const [resFirst, resSecond] = await Promise.all([first, second]);

    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pullSpy).toHaveBeenCalledTimes(1);
    // La primera llamada corre el ciclo real; la segunda ve this.syncing ya
    // en true (fijado ANTES de cualquier await) y resuelve a undefined de
    // inmediato — nunca lanza, nunca corre un segundo ciclo.
    expect(resFirst).toBeTruthy();
    expect(resSecond).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('después de que el primer fullSync() termina, un tercer fullSync() SÍ corre un ciclo nuevo (el guard no queda pegado en true)', async () => {
    const db = makeFakeDB();
    vi.stubGlobal('navigator', { onLine: true });
    const { Sync } = loadSyncLogic(db, ['equipment'], fakeAuth());
    const pushSpy = vi.spyOn(Sync, 'pushAll').mockResolvedValue({ ok: true, pushed: 0, errors: [], conflicts: 0, authErrors: 0, authErrorDetails: [], perf: { ms: 0, rows: 0 } });
    const pullSpy = vi.spyOn(Sync, 'pullAll').mockResolvedValue({ ok: true, pulled: 0, newAnomalies: [], conflicts: 0, perf: { networkMs: 0, parseMs: 0, mergeMs: 0, idbWriteMs: 0, rows: 0, pages: 1, puts: 0, totalMs: 0 } });

    await Sync.fullSync();
    await Sync.fullSync();

    expect(pushSpy).toHaveBeenCalledTimes(2);
    expect(pullSpy).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
