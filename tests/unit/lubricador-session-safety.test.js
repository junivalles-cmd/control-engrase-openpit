// tests/unit/lubricador-session-safety.test.js
//
// Pedido "CONFIGURACIÓN FINAL + SESIÓN OFFLINE + CROSS-LOCATION +
// REALIZADO ADELANTADO" (2026-10-09), Parte C/D. Causa raíz trazada en
// código ANTES de cambiar nada (nunca asumida): resetInactivityTimer()
// (30 min, TODOS los roles) y programarCierrePorFinDeTurno() (fin de
// turno, solo LUBRICADOR) llamaban logout() de verdad — en campo/mina sin
// conexión eso dejaba al Lubricador sin poder volver a entrar
// (Auth.signIn() necesita red; solo Quick Unlock funciona offline).
// Prueba por patrón de fuente que ahora ambas usan lockApp() (YA existente,
// conserva sesión Auth + IndexedDB + cola de sync + fotos + PIN) — NUNCA
// logout() — y que logout() en sí sigue sin tocar IndexedDB.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);

describe('D — NO existe logout automático cada 30 minutos de inactividad (resetInactivityTimer())', () => {
  const src = extractDeclaration(appSource, 'resetInactivityTimer');

  it('el timer de inactividad llama lockApp(), nunca logout()', () => {
    expect(src).toContain('lockApp();');
    expect(src).not.toContain('logout();');
  });
});

describe('E — NO existe logout automático por fin de turno (programarCierrePorFinDeTurno())', () => {
  const src = extractDeclaration(appSource, 'programarCierrePorFinDeTurno');

  it('el cierre de fin de turno llama lockApp(), nunca logout()', () => {
    expect(src).toContain('lockApp();');
    expect(src).not.toContain('logout();');
  });
});

describe('K/L — logout() sigue sin tocar IndexedDB/fotos/cola de sync (comportamiento preexistente, confirmado, no cambiado por este lote)', () => {
  const src = extractDeclaration(appSource, 'logout');

  it('nunca llama DB.clear/DB.delete/indexedDB.deleteDatabase', () => {
    expect(src).not.toMatch(/DB\.(clear|delete)\(/);
    expect(src).not.toContain('deleteDatabase');
  });

  it('solo limpia estado de presentación (badge/push/widget/notificaciones) + Auth.signOut()/QuickUnlock.disable() — nunca un store operativo', () => {
    expect(src).toContain('clearAppBadge();');
    expect(src).toContain('clearLubricadorWidgetSnapshot();');
    expect(src).toContain('Auth.signOut()');
    expect(src).toContain('QuickUnlock.disable()');
  });
});

describe('F/G — lockApp() (Bloquear) nunca llama Auth.signOut()/QuickUnlock.disable() — conserva sesión/PIN (comportamiento preexistente, confirmado)', () => {
  const src = extractDeclaration(appSource, 'lockApp');

  it('nunca cierra sesión Auth ni deshabilita Quick Unlock', () => {
    expect(src).not.toContain('Auth.signOut()');
    expect(src).not.toContain('QuickUnlock.disable()');
  });

  it('vuelve al mismo gate real (renderAuthGateSupabase()) que ofrece Quick Unlock al arrancar', () => {
    expect(src).toContain('renderAuthGateSupabase();');
  });
});

describe('§11-13 del pedido — confirmLubricadorLogout() distingue online/offline/pendientes reusando señales YA existentes', () => {
  const src = extractDeclaration(appSource, 'confirmLubricadorLogout');

  it('usa navigator.onLine y Sync.pendingCount() — nunca un contador nuevo', () => {
    expect(src).toContain('navigator.onLine');
    expect(src).toContain('Sync.pendingCount');
  });

  it('offline + pendientes ofrece "Bloquear en su lugar" (lockApp()) antes que cerrar sesión', () => {
    expect(src).toContain('offline && pendientes > 0');
    expect(src).toContain('Bloquear en su lugar');
    expect(src).toContain("$('#lub-logout-lock')?.addEventListener('click', () => { closeModal(); lockApp(); });");
  });

  it('online sin pendientes: confirmación simple, nunca bloquea el cierre', () => {
    expect(src).toContain('Se cerrará la sesión de');
  });
});
