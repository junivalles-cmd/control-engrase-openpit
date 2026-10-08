// tests/unit/shift-timer-guard.test.js
//
// Hardening pre-release 2026-10-08, hallazgo real de la auditoría: boot()
// se llama desde 3 sitios reales (logout→login o cambio de usuario sin
// recargar la pestaña) y cada llamada armaba su propio setInterval(60000)
// para el indicador de turno sin limpiar el anterior — timers huérfanos
// acumulados para siempre. Además, el callback del Lubricador (shiftLabel)
// no tenía guard null: si el DOM ya había cambiado de rol (boot() de
// escritorio reemplazó #lub-shell) antes de que corriera un tick viejo,
// reventaba con TypeError. wireShiftTimer() centraliza el fix: limpia
// cualquier timer anterior (App._shiftTimerId) antes de armar uno nuevo.

import { describe, it, expect, vi } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const wireShiftTimerSrc = extractDeclaration(appSource, 'wireShiftTimer');
const bootLubricadorSrc = extractDeclaration(appSource, 'bootLubricador');
const bootSrc = extractDeclaration(appSource, 'boot');

describe('wireShiftTimer() — ejecución real, sin DOM (clearInterval/setInterval puros)', () => {
  it('la 2da llamada limpia el interval de la 1ra antes de armar uno nuevo (boot() re-entrante)', () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(global, 'clearInterval');
    const App = { _shiftTimerId: null };
    const fn = new Function('App', `${wireShiftTimerSrc}\nreturn wireShiftTimer;`)(App);

    const calls = [];
    fn(() => calls.push('tick'));
    const firstId = App._shiftTimerId;
    expect(calls).toEqual(['tick']); // corre inmediatamente, no solo tras 60s
    expect(clearSpy).not.toHaveBeenCalled(); // nada que limpiar la 1ra vez

    fn(() => calls.push('tick2'));
    expect(clearSpy).toHaveBeenCalledWith(firstId); // limpia el timer viejo real
    expect(App._shiftTimerId).not.toBe(firstId); // quedó uno nuevo, no el mismo

    vi.useRealTimers();
  });

  it('solo 1 timer queda vivo tras varias llamadas sucesivas — nunca se acumulan', () => {
    vi.useFakeTimers();
    const App = { _shiftTimerId: null };
    const fn = new Function('App', `${wireShiftTimerSrc}\nreturn wireShiftTimer;`)(App);

    let ticks = 0;
    fn(() => { ticks++; });
    fn(() => { ticks++; });
    fn(() => { ticks++; }); // 3 "boot()" sucesivos, como logout→login repetido

    ticks = 0; // solo interesa lo que corre DESPUÉS de los 3 armados
    vi.advanceTimersByTime(60000);
    expect(ticks).toBe(1); // si hubiera 3 intervals huérfanos, sería 3

    vi.useRealTimers();
  });
});

describe('Null-guard contra DOM de otro rol (sin TypeError si #lub-shift ya no existe)', () => {
  it('bootLubricador() usa wireShiftTimer() (no un setInterval/const shiftLabel suelto)', () => {
    expect(bootLubricadorSrc).toContain('wireShiftTimer(');
    expect(bootLubricadorSrc).not.toMatch(/setInterval\(\s*shiftLabel/);
  });

  it('el callback de turno del Lubricador comprueba el elemento antes de tocar .textContent', () => {
    expect(bootLubricadorSrc).toMatch(/const el = \$\('#lub-shift'\);\s*\n\s*if \(el\) el\.textContent/);
  });

  it('boot() (escritorio) también usa wireShiftTimer()', () => {
    expect(bootSrc).toContain('wireShiftTimer(updateShiftBadge)');
    expect(bootSrc).not.toMatch(/setInterval\(\s*updateShiftBadge/);
  });

  it('updateShiftBadge() (ya existía) conserva su propio guard null', () => {
    const updateShiftBadgeSrc = extractDeclaration(appSource, 'updateShiftBadge');
    expect(updateShiftBadgeSrc).toMatch(/if \(!el\) return/);
  });
});
