// tests/ui/modal-accessibility.spec.js
//
// Auditoría de accesibilidad — corrección #2 (el modal genérico
// openModal()/closeModal(), usado en decenas de pantallas). Antes: sin
// Escape, sin trampa de foco (Tab se escapaba a la página de atrás), sin
// foco inicial, sin devolver el foco al cerrar, sin role="dialog"/
// aria-modal/aria-labelledby, y el botón "✕" sin aria-label.
//
// Carga las funciones REALES openModal()/closeModal() (extraídas de
// app.js, mismo mecanismo que tests/ui/grease-validation.spec.js) dentro
// de una página real de Playwright — el foco/teclado/ARIA solo se puede
// verificar de verdad contra un DOM real, nunca con mocks de Node.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const appSource = readSource(APP_JS_PATH);
const APP_NAMES = ['$', '$$', 'esc', 'openModal', 'closeModal'];
const appRealSrc = APP_NAMES.map(n => extractDeclaration(appSource, n)).join('\n\n');

async function bootPage(page) {
  await page.setContent(`
    <button id="trigger-1">Abrir modal 1</button>
    <button id="trigger-2">Abrir modal 2</button>
    <div id="app-content"></div>
  `);
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      ${appRealSrc}
      window.$ = $; window.$$ = $$; window.esc = esc;
      window.openModal = openModal; window.closeModal = closeModal;
      window.openTestModal = () => openModal('Título de prueba', \`
        <div class="form-grid">
          <label>Campo 1<input id="campo-1" /></label>
          <label>Campo 2<input id="campo-2" /></label>
        </div>
        <div class="modal-actions"><button type="button" id="modal-guardar">Guardar</button></div>
      \`);
    `,
  });
}

test('el modal se abre con role="dialog", aria-modal, aria-labelledby apuntando al título, y el botón de cerrar tiene aria-label', async ({ page }) => {
  await bootPage(page);
  await page.click('#trigger-1');
  await page.evaluate(() => window.openTestModal());

  const modal = page.locator('.modal');
  await expect(modal).toHaveAttribute('role', 'dialog');
  await expect(modal).toHaveAttribute('aria-modal', 'true');
  const labelledBy = await modal.getAttribute('aria-labelledby');
  expect(labelledBy).toBeTruthy();
  await expect(page.locator(`#${labelledBy}`)).toHaveText('Título de prueba');

  await expect(page.locator('#modal-close')).toHaveAttribute('aria-label', 'Cerrar');
});

test('al abrir, el foco se mueve al modal (nunca se queda en la página de atrás)', async ({ page }) => {
  await bootPage(page);
  await page.click('#trigger-1');
  await page.evaluate(() => window.openTestModal());

  const isModalFocused = await page.evaluate(() => document.activeElement.classList.contains('modal'));
  expect(isModalFocused).toBe(true);
});

test('Escape cierra el modal, igual que el botón "✕" o el click afuera', async ({ page }) => {
  await bootPage(page);
  await page.click('#trigger-1');
  await page.evaluate(() => window.openTestModal());
  await expect(page.locator('.modal-overlay')).toHaveClass(/open/);

  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-overlay')).not.toHaveClass(/open/);
});

test('trampa de foco: Tab desde el último elemento enfocable vuelve al primero, Shift+Tab desde el primero va al último', async ({ page }) => {
  await bootPage(page);
  await page.click('#trigger-1');
  await page.evaluate(() => window.openTestModal());

  // El primer elemento enfocable real es el botón "✕" (aparece antes que
  // los campos en el markup) — foco inicial va al contenedor del modal
  // (tabindex="-1"), así que el primer Tab real mueve al primer enfocable.
  await page.locator('#modal-close').focus();
  await page.keyboard.press('Shift+Tab'); // debe saltar al ÚLTIMO enfocable (Guardar), nunca salir del modal
  await expect(page.locator('#modal-guardar')).toBeFocused();

  await page.keyboard.press('Tab'); // desde el último, Tab normal vuelve al PRIMERO
  await expect(page.locator('#modal-close')).toBeFocused();
});

test('al cerrar, el foco vuelve al elemento que abrió el modal', async ({ page }) => {
  await bootPage(page);
  await page.locator('#trigger-1').focus();
  await page.evaluate(() => window.openTestModal());

  await page.keyboard.press('Escape');
  await expect(page.locator('#trigger-1')).toBeFocused();
});

test('abrir un segundo modal no acumula el listener de Escape del primero (un solo Escape, un solo cierre, sin error)', async ({ page }) => {
  await bootPage(page);
  await page.click('#trigger-1');
  await page.evaluate(() => window.openTestModal());
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-overlay')).not.toHaveClass(/open/);

  await page.click('#trigger-2');
  await page.evaluate(() => window.openTestModal());
  await expect(page.locator('.modal-overlay')).toHaveClass(/open/);

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-overlay')).not.toHaveClass(/open/);
  expect(errors).toEqual([]);
});

test('click fuera del modal (en el overlay) sigue cerrando — comportamiento previo intacto', async ({ page }) => {
  await bootPage(page);
  await page.click('#trigger-1');
  await page.evaluate(() => window.openTestModal());

  await page.locator('.modal-overlay').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.modal-overlay')).not.toHaveClass(/open/);
});
