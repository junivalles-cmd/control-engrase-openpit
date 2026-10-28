import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const app = readSource(APP_JS_PATH);
const source = ['$', '$$', 'esc', 'ic', 'openModal', 'closeModal', 'crewCoveragePresentation', 'openLubAccountMenu']
  .map(name => extractDeclaration(app, name)).join('\n');

async function boot(page) {
  await page.setContent('<main id="app-content"><div class="lub-operational-context" data-crew-name="Cuadrilla ficticia C1" data-coverage-label="3 ubicaciones" data-coverage-title="Zona A + Zona B + Zona C"></div></main>');
  await page.addStyleTag({ path: path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css') });
  await page.addScriptTag({ content: `
    window.App = { currentUser: { name: 'Ana de prueba', role: 'LUBRICADOR' } };
    window.Auth = { isSupabaseMode: () => true };
    window.__calls = [];
    window.navigate = route => __calls.push(route);
    window.confirmChangeUser = () => __calls.push('change-user');
    window.confirmLubricadorLogout = () => __calls.push('logout-confirm');
    ${source}
    openLubAccountMenu();
  ` });
}

test('Mi Cuenta summary uses rendered operational context; logout remains danger', async ({ page }, testInfo) => {
  await boot(page);
  await expect(page.locator('.lub-account-summary')).toContainText('Ana de prueba');
  await expect(page.locator('.lub-account-summary')).toContainText('LUBRICADOR · Cuadrilla ficticia C1');
  await expect(page.locator('.lub-account-summary [title]')).toHaveAttribute('title', 'Zona A + Zona B + Zona C');
  await expect(page.locator('#lub-menu-logout')).toHaveClass(/btn-danger/);
  await expect(page.locator('#lub-menu-lock')).toHaveCount(0); // retirado con Quick Unlock (UX CAMPO V2)
  await expect(page.locator('#lub-menu-change-user')).not.toHaveClass(/btn-danger/);
  for (const button of await page.locator('.lub-account-menu button').all()) {
    expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('account-context.png') });
});

for (const [id, call] of [['mi-perfil', 'miperfil'], ['config', 'lubconfig'], ['change-user', 'change-user'], ['logout', 'logout-confirm']]) {
  test('Mi Cuenta preserves action ' + id, async ({ page }) => {
    await boot(page);
    await page.locator('#lub-menu-' + id).click();
    expect(await page.evaluate(() => __calls)).toEqual([call]);
    await expect(page.locator('.lub-account-menu')).toHaveCount(0);
  });
}

test('Mi Cuenta resolves summary from other routes without changing scope or writing data', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    closeModal();
    document.querySelector('#app-content').innerHTML = '<h3>Historial ficticio</h3>';
    window.DB = { allActive: async store => store === 'cuadrillas'
      ? [{ id: 'fixture-c1', name: 'Cuadrilla ficticia C1' }]
      : [{ id: 'fixture-a', name: 'Zona A' }, { id: 'fixture-b', name: 'Zona B' }] };
    window.getCurrentOperationalScope = async () => ({ kind: 'CREW_SCOPED', crewId: 'fixture-c1',
      allAuthorizedLocationIds: ['fixture-a', 'fixture-b'], principalLocationIds: ['fixture-a'], supportLocationIds: ['fixture-b'] });
    await openLubAccountMenu();
  });
  await expect(page.locator('.lub-account-summary')).toContainText('Cuadrilla ficticia C1');
  await expect(page.locator('.lub-account-summary')).toContainText('Zona A + Zona B');
  expect(await page.evaluate(() => __calls)).toEqual([]);
});
