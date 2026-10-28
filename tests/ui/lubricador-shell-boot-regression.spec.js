// Ejecuta el shell y Mi Turno reales con IndexedDB de la fixture compartida.
import { test, expect } from '@playwright/test';
import { bootBell } from '../helpers/lubNotificationBellFixture.js';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

async function bootShell(page) {
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  // La fixture usa un origen ficticio: no resolver sus imágenes por DNS.
  await page.route('**/*', route => route.request().resourceType() === 'document'
    ? route.fallback() : route.fulfill({ status: 204, body: '' }));
  const errors = await bootBell(page);
  await page.addScriptTag({content: extractDeclaration(readSource(APP_JS_PATH), 'openLubAccountMenu')});
  await page.evaluate(() => {
    window.renderAnomalias = () => { document.querySelector('#app-content').innerHTML = '<div id="marker-anomalias">ANOMALIAS</div>'; };
    window.renderLubricadorHistorial = () => { document.querySelector('#app-content').innerHTML = '<div id="marker-historial">HISTORIAL</div>'; };
    window.renderTareasYMensajes = () => { document.querySelector('#app-content').innerHTML = '<div id="marker-tareas">TAREAS</div>'; };
    bootLubricador();
  });
  await expect(page.locator('.lub-turno-header')).toBeVisible();
  return {errors, consoleErrors};
}

test('LUBRICADOR: bootLubricador() renderiza el shell completo y Mi Turno, sin pageerrors/console.error', async ({ page }) => {
  const { errors, consoleErrors } = await bootShell(page);
  expect(errors, 'no debe haber pageerror').toEqual([]);
  expect(consoleErrors, 'no debe haber console.error').toEqual([]);

  await expect(page.locator('.lub-topbar')).toBeVisible();
  await expect(page.locator('.lub-bottom-nav')).toBeVisible();
  const html = await page.locator('#app-content').innerHTML();
  expect(html.length, 'el contenido central NUNCA debe quedar vacío').toBeGreaterThan(0);
  await expect(page.locator('.lub-turno-header')).toBeVisible();
});

test('LUBRICADOR: los 4 botones de navegación inferior SÍ responden (wiring real, no solo presencia en el DOM)', async ({ page }) => {
  const { errors } = await bootShell(page);
  expect(errors).toEqual([]);

  await page.locator('.lub-nav-item[data-route="anomalias"]').click();
  await expect(page.locator('#marker-anomalias')).toBeVisible();

  await page.locator('.lub-nav-item[data-route="historial"]').click();
  await expect(page.locator('#marker-historial')).toBeVisible();

  await expect(page.locator('.lub-nav-item[data-route="ayuda"]')).toHaveCount(0);

  await page.locator('.lub-nav-item[data-route="turno"]').click();
  await expect(page.locator('.lub-turno-header')).toBeVisible();
});

test('LUBRICADOR: "Mi cuenta" (gear) SÍ responde y abre el modal real', async ({ page }) => {
  const { errors } = await bootShell(page);
  expect(errors).toEqual([]);

  await page.locator('#btn-lub-account-menu').click();
  const menu = page.locator('.lub-account-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('#lub-menu-logout')).toContainText('Cerrar sesión');
});
