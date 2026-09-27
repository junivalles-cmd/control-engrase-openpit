// tests/unit/sync-auto-interval.test.js
//
// Mejora — intervalo de auto-sync configurable por el Administrador. Cubre
// las letras A-I del pedido de cierre (reglas puras del valor + cadencia
// real del timer, sin duplicados). J (permiso no-admin), K (Registrar
// Engrase estable) y M (reconnect dispara sync) son de app.js/UI/Playwright
// — ver docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §26 y
// tests/ui/registro-sync-guard.spec.js. O/P (CAS de P0-1 / JWT de sync)
// están cubiertas por tests/unit/sync-auth-gate.test.js, sin cambios aquí.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadSyncLogic, loadAppLogic } from '../helpers/loadLubricationLogic.js';

function makeFakeDB() {
  let config = null;
  return {
    async getConfig() { return config; },
    async setConfig(v) { config = v; return v; },
  };
}

describe('normalizeSyncInterval()/SYNC_INTERVAL_OPTIONS — reglas puras (A, G)', () => {
  let normalizeSyncInterval, SYNC_INTERVAL_OPTIONS, SYNC_INTERVAL_DEFAULT, syncIntervalLabel;

  beforeEach(() => {
    ({ normalizeSyncInterval, SYNC_INTERVAL_OPTIONS, SYNC_INTERVAL_DEFAULT, syncIntervalLabel } = loadAppLogic({}));
  });

  it('A) sin setting (undefined) -> 120 (el default)', () => {
    expect(normalizeSyncInterval(undefined)).toBe(120);
    expect(SYNC_INTERVAL_DEFAULT).toBe(120);
  });

  it('G) valor inválido (fuera de las 5 opciones, texto libre, menor a 30s, negativo) -> fallback 120', () => {
    expect(normalizeSyncInterval(45)).toBe(120);
    expect(normalizeSyncInterval(15)).toBe(120); // menor a 30s, nunca permitido
    expect(normalizeSyncInterval('120')).toBe(120); // string ("texto libre") -> nunca se acepta tal cual
    expect(normalizeSyncInterval(-1)).toBe(120);
    expect(normalizeSyncInterval(null)).toBe(120);
    expect(normalizeSyncInterval(undefined)).toBe(120);
  });

  it('las 5 opciones válidas (30/60/120/300/600) se devuelven tal cual, nunca alteradas', () => {
    expect(SYNC_INTERVAL_OPTIONS).toEqual([30, 60, 120, 300, 600]);
    for (const s of SYNC_INTERVAL_OPTIONS) expect(normalizeSyncInterval(s)).toBe(s);
  });

  it('syncIntervalLabel() da el texto compacto pedido ("Cada N minutos/segundos")', () => {
    expect(syncIntervalLabel(30)).toBe('Cada 30 segundos');
    expect(syncIntervalLabel(60)).toBe('Cada 1 minuto');
    expect(syncIntervalLabel(120)).toBe('Cada 2 minutos');
    expect(syncIntervalLabel(300)).toBe('Cada 5 minutos');
    expect(syncIntervalLabel(600)).toBe('Cada 10 minutos');
  });
});

describe('Sync auto-timer — cadencia real y unicidad (B-F, H, I)', () => {
  let db;

  beforeEach(async () => {
    vi.useFakeTimers();
    db = makeFakeDB();
    await db.setConfig({ url: 'https://fake.test', anonKey: 'anon-test' });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('window', { addEventListener: () => {} });
    vi.stubGlobal('document', { addEventListener: () => {}, hidden: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const casos = [
    ['B', 30],
    ['C', 60],
    ['D', 120],
    ['E', 300],
    ['F', 600],
  ];
  for (const [letra, seconds] of casos) {
    it(`${letra}) intervalo de ${seconds}s -> el timer dispara cada ${seconds * 1000}ms exactos, ni antes ni después`, async () => {
      const { Sync } = loadSyncLogic(db, ['equipment']);
      let calls = 0;
      Sync.fullSync = async () => { calls++; }; // aísla la cadencia del timer del contenido real de fullSync (ya probado aparte)
      Sync.startAuto(seconds);
      await vi.advanceTimersByTimeAsync(0); // flush de la llamada inicial (navigator.onLine true) de startAuto()
      expect(calls).toBe(1);

      await vi.advanceTimersByTimeAsync(seconds * 1000 - 1);
      expect(calls).toBe(1); // todavía no cumple el ciclo

      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toBe(2); // primer ciclo del timer, exactamente en el segundo pedido

      await vi.advanceTimersByTimeAsync(seconds * 1000);
      expect(calls).toBe(3); // segundo ciclo, misma cadencia sostenida
    });
  }

  it('H) cambiar el intervalo SIEMPRE apaga el timer anterior antes de crear el nuevo (clearInterval real)', () => {
    const { Sync } = loadSyncLogic(db, ['equipment']);
    const clearSpy = vi.spyOn(global, 'clearInterval');
    Sync.startAuto(120);
    expect(clearSpy).not.toHaveBeenCalled(); // primera vez, nada que apagar todavía
    Sync.setAutoInterval(30);
    expect(clearSpy).toHaveBeenCalledTimes(1);
    Sync.setAutoInterval(600);
    expect(clearSpy).toHaveBeenCalledTimes(2);
  });

  it('I) nunca existen 2 timers de auto-sync simultáneos, sin importar cuántas veces cambie el intervalo', () => {
    const { Sync } = loadSyncLogic(db, ['equipment']);
    Sync.startAuto(120);
    Sync.setAutoInterval(30);
    Sync.setAutoInterval(600);
    Sync.setAutoInterval(60);
    // Único timer periódico registrado en el runtime — los listeners de
    // window/document están stubeados y no crean ningún timer.
    expect(vi.getTimerCount()).toBe(1);
  });

  it('setAutoInterval() puede llamarse repetidas veces sin que ninguna llamada vieja "sobreviva" al cambio', async () => {
    const { Sync } = loadSyncLogic(db, ['equipment']);
    let calls = 0;
    Sync.fullSync = async () => { calls++; };
    Sync.startAuto(600); // intervalo largo
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);

    Sync.setAutoInterval(30); // el Administrador lo acorta antes de que el primer ciclo largo llegue
    await vi.advanceTimersByTimeAsync(30000);
    expect(calls).toBe(2); // el ciclo de 30s corrió; el de 600s original nunca debió sobrevivir
    await vi.advanceTimersByTimeAsync(600000); // si el timer viejo (600s) siguiera vivo, aquí duplicaría llamadas
    expect(calls).toBe(2 + Math.floor(600000 / 30000)); // solo el timer de 30s activo
  });
});
