// tests/unit/quick-unlock-history.test.js
//
// Pedido "LOGIN / QUICK UNLOCK / CAMBIO DE USUARIO" (2026-10-09) — checks
// de FUENTE (nunca ejecutados en jsdom: history.pushState()/popstate real
// solo se puede probar contra un navegador real, ver
// tests/ui/quick-unlock-account-switch.spec.js) para congelar:
//   - el manejo de Atrás de Android vía history.pushState()/popstate (sin
//     el plugin @capacitor/app, que NO está instalado);
//   - que "Entrar con otra cuenta" en Quick Unlock Y en Configuración del
//     Lubricador llaman al MISMO confirmChangeUser() — una sola ruta/
//     helper para cambiar cuenta (§8 del pedido), nunca una reimplementación.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);

describe('renderQuickUnlockScreen() — "<-" y "Entrar con otra cuenta"', () => {
  const src = extractDeclaration(appSource, 'renderQuickUnlockScreen');

  it('empuja una entrada de historial propia al mostrarse, para que Atrás de Android tenga a dónde volver', () => {
    expect(src).toContain("history.pushState({ screen: 'quickunlock' }, '', '');");
  });

  it('"<-" consume esa entrada con history.back() (nunca borra nada, nunca cierra la app) — con fallback directo si pushState falló', () => {
    const idx = src.indexOf("$('#quick-unlock-back')");
    const block = src.slice(idx, idx + 250);
    expect(block).toContain('history.back()');
    expect(block).toContain('renderSupabaseLoginForm()');
  });

  it('"Entrar con otra cuenta" limpia la marca de historial (replaceState, nunca back/pushState) y llama a confirmChangeUser() real', () => {
    const idx = src.indexOf("$('#quick-unlock-change-user')");
    const block = src.slice(idx, idx + 250);
    expect(block).toContain('clearQuickUnlockHistoryMarker()');
    expect(block).toContain('confirmChangeUser()');
  });

  it('clearQuickUnlockHistoryMarker() usa replaceState (nunca pushState/back) — no dispara popstate, no navega', () => {
    const idx = src.indexOf('clearQuickUnlockHistoryMarker');
    const block = src.slice(idx, idx + 300);
    expect(block).toContain("history.replaceState(null, '', '')");
  });

  it('un PIN correcto también limpia la marca de historial antes de entrar — un Atrás posterior nunca reabre Quick Unlock', () => {
    expect(src).toContain('if (res.ok) { clearQuickUnlockHistoryMarker(); enterAppAsProfile(snapshot); return; }');
  });

  it('el PIN se valida contra snapshot.appUserId — nunca un id distinto ni hardcodeado (D del pedido: "PIN A nunca desbloquea usuario B")', () => {
    expect(src).toContain('QuickUnlock.attemptUnlock(snapshot.appUserId, pin)');
  });

  it('muestra nombre + rol del snapshot mostrado (mockup del pedido: "Jose Guerrero" / "LUBRICADOR")', () => {
    expect(src).toContain('esc(snapshot.displayName)');
    expect(src).toContain('esc(snapshot.role');
  });
});

describe('popstate global (DOMContentLoaded) — Atrás de Android sin el plugin @capacitor/app', () => {
  it('existe un listener de popstate que, si Quick Unlock está visible, muestra el login normal (nunca renderAuthGateSupabase(), que reabriría Quick Unlock)', () => {
    expect(appSource).toContain("window.addEventListener('popstate', () => {\n    if ($('#quick-unlock-area')) renderSupabaseLoginForm();\n  });");
  });
});

describe('"Entrar con otra cuenta" — UNA sola ruta/helper para cambiar cuenta (§8 del pedido)', () => {
  it('Quick Unlock y Configuración del Lubricador llaman AMBOS a confirmChangeUser() — nunca una reimplementación paralela', () => {
    const quickUnlockSrc = extractDeclaration(appSource, 'renderQuickUnlockScreen');
    const configSrc = extractDeclaration(appSource, 'renderLubricadorConfig');
    expect(quickUnlockSrc).toContain('confirmChangeUser()');
    expect(configSrc).toContain("$('#lub-config-change-user').addEventListener('click', () => confirmChangeUser());");
  });

  it('confirmChangeUser() sigue siendo la única función que llama a logout() desde ese flujo — nunca Auth.signOut()/QuickUnlock.disable() sueltos fuera de logout()', () => {
    const src = extractDeclaration(appSource, 'confirmChangeUser');
    expect(src).toContain('logout()');
    expect(src).not.toContain('Auth.signOut()');
    expect(src).not.toContain('QuickUnlock.disable()');
  });

  it('logout() (real, sin tocar en este lote) sigue documentando que NUNCA toca IndexedDB operativo', () => {
    const src = extractDeclaration(appSource, 'logout');
    expect(src).toContain('NUNCA toca IndexedDB operativo');
  });
});
