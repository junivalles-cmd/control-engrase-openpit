import { test, expect } from '@playwright/test';
import { bootBell } from '../helpers/lubNotificationBellFixture.js';

test('sync terminado repinta Mi Turno sin referencias al antiguo panel de broadcasts', async ({ page }) => {
  const errors = await bootBell(page);
  await page.evaluate(async () => {
    // The production sync listener calls the production home renderer.
    // Only the transport is synthetic; IndexedDB and scoped reads are real.
    window.redibujarPantallaActual = () => { window.__syncRender = renderLubricadorHome(); };
    await DB.put('broadcast_messages', {
      id:'sync-notice',targetType:'ALL_LUBRICATORS',message:'Aviso operativo',
      priority:'IMPORTANTE',active:true,createdAt:new Date().toISOString(),
    });
    await onSyncStateChange({status:'ok',pulled:1,pushed:0,at:new Date().toISOString()});
    await window.__syncRender;
  });
  await expect(page.locator('.lub-welcome-card')).toBeVisible();
  await expect(page.locator('#app-content .loading')).toHaveCount(0);
  await expect(page.locator('#app-content')).not.toContainText('Aviso operativo');
  await expect(page.locator('[data-lub-notification-count]')).toHaveText('1');
  await page.locator('#btn-lub-notifications').click();
  await expect(page.locator('#lub-notifications-panel')).toContainText('Aviso operativo');
  expect(errors).toEqual([]);
});
