// tests/unit/lubricador-session-safety.test.js
//
// UX CAMPO V2 (2026-10-24): Quick Unlock/PIN y el bloqueo automático por
// inactividad (resetInactivityTimer()/fireInactivityLock()/lockApp()/
// programarCierrePorFinDeTurno()) se eliminaron por completo del runtime —
// ya NO existe ningún timeout de sesión automático (requisito explícito:
// "NO automatic session timeout"). Este archivo reemplaza las pruebas
// previas de esa política (retiradas) por pruebas de la política vigente:
// logout() sigue sin tocar IndexedDB/fotos/cola de sync, y
// confirmLubricadorLogout() sigue distinguiendo online/offline/pendientes
// SIN ofrecer ya ninguna alternativa de "bloquear en su lugar".

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);

describe('No existe ningún timer de bloqueo/logout automático por inactividad o fin de turno', () => {
  it('no quedan funciones ni referencias de la política retirada', () => {
    expect(appSource).not.toContain('function lockApp(');
    expect(appSource).not.toContain('function fireInactivityLock(');
    expect(appSource).not.toContain('function isSafeToAutoLock(');
    expect(appSource).not.toContain('function programarCierrePorFinDeTurno(');
    expect(appSource).not.toContain('function resetInactivityTimer(');
    expect(appSource).not.toContain('function startInactivityTracking(');
    expect(appSource).not.toContain('QUICK_UNLOCK_INACTIVITY_MS');
  });
});

describe('logout() sigue sin tocar IndexedDB/fotos/cola de sync (comportamiento preexistente, confirmado, no cambiado por este lote)', () => {
  const src = extractDeclaration(appSource, 'logout');

  it('nunca llama DB.clear/DB.delete/indexedDB.deleteDatabase', () => {
    expect(src).not.toMatch(/DB\.(clear|delete)\(/);
    expect(src).not.toContain('deleteDatabase');
  });

  it('solo limpia estado de presentación (badge/push/widget/notificaciones) + Auth.signOut() real — ya sin QuickUnlock.disable() (retirado)', () => {
    expect(src).toContain('clearAppBadge();');
    expect(src).toContain('clearLubricadorWidgetSnapshot();');
    expect(src).toContain('Auth.signOut()');
    expect(src).not.toContain('QuickUnlock');
  });
});

describe('§11-13 del pedido original — confirmLubricadorLogout() distingue online/offline/pendientes reusando señales YA existentes', () => {
  const src = extractDeclaration(appSource, 'confirmLubricadorLogout');

  it('usa navigator.onLine y Sync.pendingCount() — nunca un contador nuevo', () => {
    expect(src).toContain('navigator.onLine');
    expect(src).toContain('Sync.pendingCount');
  });

  it('offline + pendientes advierte pero ya no ofrece "Bloquear en su lugar" (retirado con Quick Unlock)', () => {
    expect(src).toContain('offline && pendientes > 0');
    expect(src).not.toContain('Bloquear en su lugar');
    expect(src).not.toContain('lockApp()');
  });

  it('online sin pendientes: confirmación simple, nunca bloquea el cierre', () => {
    expect(src).toContain('Se cerrará la sesión de');
  });
});
