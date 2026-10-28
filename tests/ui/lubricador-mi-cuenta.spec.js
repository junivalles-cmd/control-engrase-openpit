// tests/ui/lubricador-mi-cuenta.spec.js
//
// Pedido "CONFIGURACIÓN FINAL + SESIÓN OFFLINE..." (2026-10-09), Parte B/C.
// Carga y EJECUTA de verdad openLubAccountMenu()/confirmLubricadorLogout()/
// confirmChangeUser() (mismo patrón real-execution que el resto de este
// proyecto) — logout() en sí se reemplaza por un espía que SÍ pasa por
// Auth.signOut() (igual que el real), mismo método ya usado en
// tests/ui/lubricador-config.spec.js, para poder comprobar "nunca toca
// IndexedDB" sin extraer la función real completa (enorme: OneSignal/
// notificaciones/widget, sin cambios en este lote).
// (UX CAMPO V2, 2026-10-24: "Bloquear"/lockApp()/Quick Unlock se
// retiraron por completo — "Cerrar sesión" y "Entrar con otra cuenta"
// quedan como únicas acciones de sesión en este menú.)

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const appSource = readSource(APP_JS_PATH);
const APP_NAMES = [
  '$', '$$', 'esc', 'ic', 'openModal', 'closeModal',
  'confirmChangeUser', 'crewCoveragePresentation', 'openLubAccountMenu', 'confirmLubricadorLogout',
];
const appRealSrc = APP_NAMES.map((n) => extractDeclaration(appSource, n)).join('\n\n');

async function bootMenu(page, { online = true, pendingCount = 0 } = {}) {
  await page.route('**/*', (route) => {
    if (route.request().resourceType() === 'document') {
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    } else {
      route.continue();
    }
  });
  await page.goto('/');
  await page.setContent('<div id="app-content"></div>');
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      Object.defineProperty(window.navigator, 'onLine', { value: ${online}, configurable: true });
      window.App = { currentUser: { id: 'u2', name: 'Jose Guerrero', role: 'LUBRICADOR' }, lubricadorGreaseFlowActive: false };
      window.__navigateCalls = [];
      window.__dbWriteCalls = [];
      window.__renderAuthGateCalls = 0;
      window.navigate = (route) => { window.__navigateCalls.push(route); };
      window.Auth = {
        isSupabaseMode: () => true,
        isAuthenticated: () => true,
        signOut: async () => { window.__dbWriteCalls.push('Auth.signOut'); return true; },
      };
      window.DB = {
        allActive: async () => [],
        put: async (...a) => { window.__dbWriteCalls.push(['put', ...a]); },
        delete: async (...a) => { window.__dbWriteCalls.push(['delete', ...a]); },
        clear: async (...a) => { window.__dbWriteCalls.push(['clear', ...a]); },
      };
      window.Sync = { pendingCount: async () => ${pendingCount} };
      window.getCurrentOperationalScope = async () => ({ kind: 'NO_CREW_ASSIGNED', authorizedCrews: [] });
      window.clearAppBadge = () => {};
      window.renderAuthGateSupabase = () => { window.__renderAuthGateCalls++; };
      // logout() real es enorme (OneSignal/widget/notificaciones, sin
      // cambios en este lote) — espía que SÍ pasa por Auth.signOut()
      // (igual que el real), mismo método que
      // tests/ui/lubricador-config.spec.js.
      window.logout = async () => { await window.Auth.signOut(); };
      ${appRealSrc}
      window.openLubAccountMenu = openLubAccountMenu;
      window.confirmLubricadorLogout = confirmLubricadorLogout;
      window.confirmChangeUser = confirmChangeUser;
    `,
  });
}

test('C — "Cerrar sesión" está en Mi Cuenta, separado visualmente (divider) del resto de acciones', async ({ page }) => {
  await bootMenu(page);
  await page.evaluate(() => window.openLubAccountMenu());
  const menu = page.locator('.lub-account-menu');
  await expect(menu.locator('#lub-menu-mi-perfil')).toBeVisible();
  await expect(menu.locator('#lub-menu-config')).toBeVisible();
  await expect(menu.locator('#lub-menu-lock')).toHaveCount(0); // retirado con Quick Unlock (UX CAMPO V2)
  await expect(menu.locator('#lub-menu-change-user')).toBeVisible();
  await expect(menu.locator('.lub-account-menu-divider')).toHaveCount(1);
  await expect(menu.locator('#lub-menu-logout')).toContainText('Cerrar sesión');
});

test('E — "Entrar con otra cuenta" (ahora en Mi Cuenta): abre confirmChangeUser() real y, al confirmar, pasa por Auth.signOut() sin ninguna escritura a IndexedDB', async ({ page }) => {
  await bootMenu(page);
  await page.evaluate(() => window.openLubAccountMenu());
  await page.locator('#lub-menu-change-user').click();
  await expect(page.locator('.modal-body')).toContainText('Vas a salir de la sesión');
  await page.locator('#confirm-change-user-confirm').click();
  await expect.poll(() => page.evaluate(() => window.__dbWriteCalls)).toEqual(['Auth.signOut']);
  const dbCalls = await page.evaluate(() => window.__dbWriteCalls.filter((c) => Array.isArray(c)));
  expect(dbCalls).toEqual([]); // K/L: ninguna escritura a IndexedDB
});

test('H — Cerrar sesión OFFLINE (sin pendientes) muestra la advertencia real, sin ninguna alternativa de bloqueo (retirada con Quick Unlock)', async ({ page }) => {
  await bootMenu(page, { online: false, pendingCount: 0 });
  await page.evaluate(() => window.confirmLubricadorLogout());
  await expect(page.locator('#modal-title-text')).toContainText('Estás sin conexión');
  await expect(page.locator('.modal-body')).toContainText('podrías necesitar conexión a internet');
  await expect(page.locator('#lub-logout-lock')).toHaveCount(0);
  await expect(page.locator('#lub-logout-confirm')).toContainText('Cerrar sesión de todos modos');
});

test('I — OFFLINE + pendientes de sincronizar muestra la advertencia REFORZADA (Sync.pendingCount() real)', async ({ page }) => {
  await bootMenu(page, { online: false, pendingCount: 3 });
  await page.evaluate(() => window.confirmLubricadorLogout());
  await expect(page.locator('#modal-title-text')).toContainText('información pendiente de sincronizar');
  await expect(page.locator('.modal-body')).toContainText('3 registro(s)');
  await expect(page.locator('#lub-logout-lock')).toHaveCount(0);
});

test('online, sin pendientes: confirmación simple ("Se cerrará la sesión de Jose Guerrero...")', async ({ page }) => {
  await bootMenu(page, { online: true, pendingCount: 0 });
  await page.evaluate(() => window.confirmLubricadorLogout());
  const modal = page.locator('.modal-body');
  await expect(modal).toContainText('Se cerrará la sesión de Jose Guerrero en este dispositivo.');
  await expect(page.locator('#lub-logout-lock')).toHaveCount(0); // nunca se ofrece Bloquear aquí, no hace falta
});

test('online CON pendientes: sigue siendo posible cerrar sesión, solo con advertencia adicional (nunca bloquea el cierre)', async ({ page }) => {
  await bootMenu(page, { online: true, pendingCount: 2 });
  await page.evaluate(() => window.confirmLubricadorLogout());
  const modal = page.locator('.modal-body');
  await expect(modal).toContainText('Se cerrará la sesión de Jose Guerrero en este dispositivo.');
  await expect(modal).toContainText('2 registro(s) todavía no se han sincronizado');
  await expect(page.locator('#lub-logout-confirm')).toBeVisible();
});

test('J — Cancelar no cambia la sesión (nunca llama logout())', async ({ page }) => {
  await bootMenu(page, { online: false, pendingCount: 1 });
  await page.evaluate(() => window.confirmLubricadorLogout());
  await page.locator('#lub-logout-cancel').click();
  const dbCalls = await page.evaluate(() => window.__dbWriteCalls);
  expect(dbCalls).toEqual([]);
  const gateCalls = await page.evaluate(() => window.__renderAuthGateCalls);
  expect(gateCalls).toBe(0);
  await expect(page.locator('#modal-overlay.open')).toHaveCount(0);
});

test('K/L — "Cerrar sesión de todos modos" (offline+pendientes) sigue sin tocar IndexedDB — ninguna foto/registro pendiente se pierde', async ({ page }) => {
  await bootMenu(page, { online: false, pendingCount: 5 });
  await page.evaluate(() => window.confirmLubricadorLogout());
  await page.locator('#lub-logout-confirm').click();
  await expect.poll(() => page.evaluate(() => window.__dbWriteCalls)).toEqual(['Auth.signOut']);
  const dbCalls = await page.evaluate(() => window.__dbWriteCalls.filter((c) => Array.isArray(c)));
  expect(dbCalls).toEqual([]);
});
