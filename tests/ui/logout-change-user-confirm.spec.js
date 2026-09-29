// tests/ui/logout-change-user-confirm.spec.js
//
// Bloque A (pre-cutover, ver docs/SESSION_HANDOFF.md) — dos gaps reales que
// la auditoría encontró sobre un PIN persistente que YA funcionaba
// correctamente: "Cerrar sesión" disparaba logout() de inmediato al primer
// toque (ningún alert()/confirm()/modal), y no existía ninguna acción
// "Cambiar usuario" separada de Bloquear/Cerrar sesión. Prueba las
// funciones REALES confirmLogout()/confirmChangeUser() (extraídas de
// app.js) contra una página real de Playwright — logout() en sí se
// reemplaza por un espía (su comportamiento real, ya probado, vive en
// tests/unit/quick-unlock.test.js/auth.test.js).

import { test, expect } from '@playwright/test';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const APP_NAMES = ['$', '$$', 'esc', 'openModal', 'closeModal', 'confirmLogout', 'confirmChangeUser'];
const appRealSrc = APP_NAMES.map(n => extractDeclaration(appSource, n)).join('\n\n');

async function bootPage(page, { role = 'ADMINISTRADOR', name = 'Ana Supervisora' } = {}) {
  await page.setContent('<div id="app-content"></div>');
  await page.addScriptTag({
    content: `
      window.App = { currentUser: { id: 'u1', name: ${JSON.stringify(name)}, role: ${JSON.stringify(role)} } };
      window.Auth = { isSupabaseMode: () => true };
      window.__logoutCalls = 0;
      function logout() { window.__logoutCalls++; } // stub — comportamiento real ya probado en tests/unit
      ${appRealSrc}
      window.confirmLogout = confirmLogout;
      window.confirmChangeUser = confirmChangeUser;
    `,
  });
}

test.describe('confirmLogout() — reemplaza el logout() directo al primer click', () => {
  test('abre un modal de confirmación, NO llama a logout() de inmediato', async ({ page }) => {
    await bootPage(page);
    await page.evaluate(() => window.confirmLogout());
    await expect(page.locator('.modal-head')).toContainText('Cerrar sesión');
    await expect(page.locator('#confirm-logout-cancel')).toBeVisible();
    await expect(page.locator('#confirm-logout-confirm')).toBeVisible();
    const calls = await page.evaluate(() => window.__logoutCalls);
    expect(calls).toBe(0);
  });

  test('"Cancelar" cierra el modal SIN llamar a logout()', async ({ page }) => {
    await bootPage(page);
    await page.evaluate(() => window.confirmLogout());
    await page.locator('#confirm-logout-cancel').click();
    await expect(page.locator('#modal-overlay')).not.toHaveClass(/open/);
    const calls = await page.evaluate(() => window.__logoutCalls);
    expect(calls).toBe(0);
  });

  test('confirmar SÍ llama a logout(), exactamente una vez', async ({ page }) => {
    await bootPage(page);
    await page.evaluate(() => window.confirmLogout());
    await page.locator('#confirm-logout-confirm').click();
    const calls = await page.evaluate(() => window.__logoutCalls);
    expect(calls).toBe(1);
  });
});

test.describe('confirmChangeUser() — distinto de Bloquear y de Cerrar sesión, pero misma operación de fondo (arquitectura de una sola sesión activa)', () => {
  test('abre un modal propio, con el nombre del usuario actual, y NO llama a logout() hasta confirmar', async ({ page }) => {
    await bootPage(page, { name: 'Junior Valles' });
    await page.evaluate(() => window.confirmChangeUser());
    await expect(page.locator('.modal-head')).toContainText('Cambiar de usuario');
    await expect(page.locator('.modal-body')).toContainText('Junior Valles');
    const calls = await page.evaluate(() => window.__logoutCalls);
    expect(calls).toBe(0);
  });

  test('confirmar cambia de usuario (misma operación que logout(), nunca dos sesiones activas)', async ({ page }) => {
    await bootPage(page);
    await page.evaluate(() => window.confirmChangeUser());
    await page.locator('#confirm-change-user-confirm').click();
    const calls = await page.evaluate(() => window.__logoutCalls);
    expect(calls).toBe(1);
  });

  test('"Cancelar" no toca nada', async ({ page }) => {
    await bootPage(page);
    await page.evaluate(() => window.confirmChangeUser());
    await page.locator('#confirm-change-user-cancel').click();
    const calls = await page.evaluate(() => window.__logoutCalls);
    expect(calls).toBe(0);
  });

  test('en modo legacy (Auth.isSupabaseMode()=false): no hace nada (Cambiar usuario solo existe en modo supabase)', async ({ page }) => {
    await bootPage(page);
    await page.evaluate(() => { window.Auth.isSupabaseMode = () => false; });
    await page.evaluate(() => window.confirmChangeUser());
    await expect(page.locator('#modal-overlay.open')).toHaveCount(0);
  });
});
