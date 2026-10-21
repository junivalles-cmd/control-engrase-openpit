import { test, expect } from '@playwright/test';
import { bootBell } from '../helpers/lubNotificationBellFixture.js';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';
import { THEME_PREFERENCE_DECLARATIONS } from '../helpers/themeFixture.js';

const source = readSource(APP_JS_PATH);
const navigation = [...THEME_PREFERENCE_DECLARATIONS, 'PERMISSIONS', 'MENU', 'navigate',
  'makeTablesResponsive', 'renderLubricadorConfig', 'renderLubricadorHistorial',
  'renderAyuda', 'openLubAccountMenu'].map(n => extractDeclaration(source, n)).join('\n');

for (const width of [390, 412, 600, 768, 1024, 1366]) {
  test(`four operational destinations, configuration help and return at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 915 });
    const errors = await bootBell(page);
    await page.addScriptTag({ content: `
      for (const name of ['renderDashboard','renderEquipos','renderPlan','renderTurno','renderRegistrar',
        'renderHorometros','renderMatrizSemanal','renderLubricantes','renderHistorial','renderReportes',
        'renderUsuarios','renderConfig','renderMiPerfil']) window[name] = () => {};
      window.renderTareasYMensajes = () => { document.querySelector('#app-content').innerHTML = '<h2>Tareas y Mensajes</h2>'; };
      window.renderAnomalias = () => { document.querySelector('#app-content').innerHTML = '<h2>Anomalías</h2>'; };
      window.Auth.isAuthenticated = () => true;
      window.Auth.getProfile = () => ({appUserId:'lub',displayName:'Lubricador',role:'LUBRICADOR'});
      window.QuickUnlock = {isConfigured: async () => true};
      window.getHelpContent = async () => ({families:[],faq:[{question:'Consulta de ayuda',answer:'Contenido existente'}]});
      window.wirePhotoThumbs = () => {};
      window.openThemePicker = () => {};
      window.quickUnlockConfigureModal = () => {};
      window._activeConfigCategory = '';
      ${navigation}
    ` });
    await page.evaluate(() => bootLubricador());
    await expect(page.locator('.lub-welcome-card')).toBeVisible();
    const nav = page.locator('.lub-bottom-nav');
    await expect(nav.locator('button > span:last-child')).toHaveText(['Mi Turno', 'Tareas', 'Anomalías', 'Historial']);
    await expect(nav.getByRole('button', { name: 'Ayuda', exact: true })).toHaveCount(0);
    const geometry = await nav.locator('button').evaluateAll(buttons => buttons.map(b => {
      const r = b.getBoundingClientRect();
      return { width:r.width, height:r.height, unclipped:b.scrollWidth <= b.clientWidth };
    }));
    expect(geometry.every(b => b.width >= 44 && b.height >= 44 && b.unclipped)).toBe(true);
    expect(Math.max(...geometry.map(b => b.width)) - Math.min(...geometry.map(b => b.width))).toBeLessThan(1);
    for (const [route, title] of [['tareas-mensajes','Tareas y Mensajes'],['anomalias','Anomalías'],['historial','Historial']]) {
      await nav.locator(`[data-route="${route}"]`).click();
      await expect(page.locator('#app-content h2')).toHaveText(title);
      await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-route', route);
      expect(await page.evaluate(() => App.route)).toBe(route);
    }
    await expect(page.locator('.lub-record-list')).toContainText('Aún no has registrado engrases');
    await page.locator('#btn-lub-account-menu').click();
    await page.locator('#lub-menu-config').click();
    await expect(page.locator('#lub-config-help')).toBeVisible();
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);
    await page.locator('#lub-config-help').click();
    await expect(page.locator('.ayuda-page')).toContainText('Contenido existente');
    await page.locator('#lub-help-back-config').click();
    await expect(page.locator('#lub-config-help')).toBeVisible();
    await nav.locator('[data-route="turno"]').click();
    await expect(page.locator('.lub-welcome-card')).toBeVisible();
    await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-route', 'turno');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
