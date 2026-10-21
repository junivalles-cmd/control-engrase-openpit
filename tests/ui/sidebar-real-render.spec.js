import { test, expect } from '@playwright/test';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const source = readSource(APP_JS_PATH);
const declarations = ['$', '$$', 'esc', 'PERMISSIONS', 'getAllowedRoutes', 'MENU', 'boot'].map(name => extractDeclaration(source, name)).join('\n');

test('real boot replaces the shell; each permitted sidebar route appears once after repeated renders', async ({ page }) => {
  await page.setContent('<div></div>');
  await page.addScriptTag({ content: `
    window.App = { currentUser: { role: 'ADMINISTRADOR', name: 'Fixture' } };
    window.Sync = { runAutoCycle() {} };
    window.Auth = { isSupabaseMode: () => true };
    window.ic = () => '';
    window.__routes = [];
    window.navigate = route => window.__routes.push(route);
    ${['updateTareasMensajesNavBadge', 'wireEvidenceImgFallbackOnce', 'refreshLocalNotifications', 'refreshAppBadge', 'startInactivityTracking',
      'programarCierrePorFinDeTurno', 'updateConnBadge', 'wireShiftTimer', 'updateShiftBadge', 'confirmLogout',
      'lockApp', 'confirmChangeUser', 'wireQuickFind', 'openQrScanner', 'handleQrDeepLink'].map(name => `window.${name} = () => {};`).join('\n')}
    ${declarations}
    window.boot = boot;
    window.__allowed = MENU.filter(m => PERMISSIONS.ADMINISTRADOR.includes(m.id) && m.id !== 'usuarios').map(m => m.id);
  ` });
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.boot());
    await expect(page.locator('#sidebar')).toHaveCount(1);
    const routes = await page.locator('#sidebar .menu-item[data-route]').evaluateAll(nodes => nodes.map(n => n.dataset.route));
    expect(routes).toEqual(await page.evaluate(() => window.__allowed));
    expect(new Set(routes).size).toBe(routes.length);
  }
  await page.locator('#sidebar [data-route="equipos"]').click({ force: true });
  expect(await page.evaluate(() => window.__routes.at(-1))).toBe('equipos');
});
