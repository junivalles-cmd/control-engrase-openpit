import { test, expect } from '@playwright/test';
import { bootBell } from '../helpers/lubNotificationBellFixture.js';

async function seedMessages(page) {
  await page.evaluate(async () => {
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const date = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const base = { active: true, targetType: 'ALL_LUBRICATORS', priority: 'IMPORTANTE', message: 'Mensaje operativo de prueba', createdBy: 'supervisor', createdAt: today.toISOString() };
    for (const row of [
      { id: 'one' }, { id: 'two', targetType: 'CREW', targetId: 'C1' }, { id: 'three', targetType: 'USER', targetId: 'lub' },
      { id: 'read' }, { id: 'deleted', active: false }, { id: 'expired', validUntil: date(yesterday) },
      { id: 'wrong-user', targetType: 'USER', targetId: 'someone' }, { id: 'wrong-crew', targetType: 'CREW', targetId: 'C2' },
      { id: 'wrong-location', targetType: 'LOCATION', targetId: 'mojon' }, { id: 'retired', retiredAt: today.toISOString() },
    ]) await DB.put('broadcast_messages', { ...base, ...row });
    await DB.put('broadcast_message_reads', { id: 'read:lub', userId: 'lub', messageId: 'read', active: true });
    await DB.put('manual_tasks', { id: 'manual', crewId: 'C1', locationId: 'volcan', equipmentId: 'e1', status: 'PENDING', active: true });
    window.__noticeBuilds = 0;
    const original = buildBroadcastNotices;
    buildBroadcastNotices = (...args) => { window.__noticeBuilds++; return original(...args); };
    await renderLubricadorHome();
    await updateTareasMensajesNavBadge();
  });
}

test('Mi Turno lazy, unread-only scoped badge, read persistence and offline drawer', async ({ page, context }, testInfo) => {
  const errors = await bootBell(page);
  await seedMessages(page);
  const bell = page.locator('#btn-lub-notifications');
  const badge = bell.locator('[data-lub-notification-count]');
  await expect(bell).toBeVisible();
  await expect(badge).toHaveText('3');
  await expect(page.locator('[data-nav-badge="tareas-mensajes"]')).toHaveText('1');
  await expect(page.locator('#app-content')).not.toContainText('NOTIFICACIONES');
  await expect(page.locator('#app-content')).not.toContainText('Mensaje operativo de prueba');
  await expect(page.locator('#lub-notifications-panel')).toHaveCount(0);
  expect(await page.evaluate(() => window.__noticeBuilds)).toBe(0);
  const controls = await page.locator('.lub-topbar-right > button:not(.hidden), .quick-find-toggle').evaluateAll(elements => elements.filter(el => getComputedStyle(el).display !== 'none').map(el => {
    const r = el.getBoundingClientRect(); return { id: el.id, x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height };
  }));
  for (const b of controls) { expect(b.width, b.id).toBeGreaterThanOrEqual(44); expect(b.height, b.id).toBeGreaterThanOrEqual(44); expect(b.x).toBeGreaterThanOrEqual(0); expect(b.right).toBeLessThanOrEqual(page.viewportSize().width); }
  for (let i=0;i<controls.length;i++) for (let j=i+1;j<controls.length;j++) {
    const a=controls[i], b=controls[j]; expect(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y, `${a.id} overlaps ${b.id}`).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mi-turno.png'), fullPage:true });
  await context.setOffline(true);
  await bell.click();
  const panel = page.locator('#lub-notifications-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('article')).toHaveCount(4);
  await expect(panel).not.toContainText('wrong-');
  await expect(panel.locator('[data-read-message]')).toHaveCount(3);
  await expect(panel).toContainText('Origen: supervisor');
  await expect(panel).toContainText('Cuadrilla: Cuadrilla C1');
  const box = await panel.boundingBox();
  expect(Math.abs(box.x + box.width - page.viewportSize().width)).toBeLessThan(2);
  expect(box.height).toBeGreaterThanOrEqual(page.viewportSize().height - 2);
  if (page.viewportSize().width < 768) expect(box.width).toBe(page.viewportSize().width);
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await panel.locator('[data-read-message="one"]').click();
  await expect(badge).toHaveText('2');
  await expect(panel.locator('[data-notification-id="one"]')).toContainText('Leído');
  await panel.locator('[data-close-notifications]').click();
  await bell.click();
  await expect(panel.locator('[data-read-message="one"]')).toHaveCount(0);
  await panel.locator('[data-read-message="two"]').click();
  await panel.locator('[data-read-message="three"]').click();
  await expect(badge).toBeHidden();
  await page.screenshot({ path:testInfo.outputPath('notifications.png'), fullPage:true });
  await panel.locator('[data-view-message="one"]').click();
  await expect.poll(() => page.evaluate(() => window.__focus)).toEqual({kind:'MENSAJE',id:'one'});
  await expect(panel).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('sync refresh and calendar expiry update badge and an open panel', async ({ page }) => {
  const errors = await bootBell(page);
  await seedMessages(page);
  const badge = page.locator('[data-lub-notification-count]');
  await page.locator('#btn-lub-notifications').click();
  await page.evaluate(async () => {
    const m = await DB.get('broadcast_messages','one');
    await DB.put('broadcast_messages',{...m,active:false});
    await onSyncStateChange({status:'ok',pulled:1});
  });
  await expect(badge).toHaveText('2');
  await expect(page.locator('[data-notification-id="one"]')).toHaveCount(0);
  await page.evaluate(async () => {
    const m = await DB.get('broadcast_messages','one');
    await DB.put('broadcast_messages',{...m,id:'new',active:true,targetType:'LOCATION',targetId:'volcan',validUntil:todayDateISO()});
    await onSyncStateChange({status:'ok',pulled:1});
  });
  await expect(badge).toHaveText('3');
  await page.clock.install();
  await page.evaluate(() => updateTareasMensajesNavBadge());
  const untilMidnight = await page.evaluate(() => { const d=new Date();d.setHours(24,0,0,20);return d-Date.now(); });
  await page.clock.fastForward(untilMidnight);
  await expect(badge).toHaveText('2');
  await expect(page.locator('[data-notification-id="new"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
