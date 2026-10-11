import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { bootLubricadorFollowUp, followUpEquipment as equipos, followUpRecords as records, followUpCoverage as coverage } from '../helpers/lubricadorFollowUpFixture.js';
const codes = page => page.locator('#lub-follow-up .lub-eq-code');
const kpis = page => page.locator('.lub-kpi-card').evaluateAll(cards => cards.map(c => c.textContent.replace(/\s+/g, ' ').trim()));
const baseline = execFileSync('git', ['show', 'fbabc2a:CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js'], { encoding: 'utf8' });
test('A/B principal and legacy show Mojón, reject unauthorized Volcán', async ({ page }) => {
  const errors = await bootLubricadorFollowUp(page, { coverage: [] });
  await expect(codes(page)).toHaveText(['TEST-M']);
  await expect(page.locator('#lub-follow-up')).toContainText('5 días sin engrasar');
  expect(errors).toEqual([]);
});
test('C/G principal + support without assignment, location filter and independent counters', async ({ page }) => {
  const errors = await bootLubricadorFollowUp(page);
  await expect(codes(page)).toHaveText(['TEST-M', 'TEST-V']);
  await expect(page.locator('.crew-location-filter')).toHaveCount(3);
  await page.locator('[data-location-id="V"]').click(); await expect(codes(page)).toHaveText(['TEST-V']);
  await expect(page.locator('.lub-kpi-value')).toHaveText(['0', '0', '0', '0']);
  await page.locator('[data-location-id="M"]').click(); await expect(codes(page)).toHaveText(['TEST-M']);
  await page.locator('[data-location-id=""]').click(); await expect(codes(page)).toHaveText(['TEST-M', 'TEST-V']);
  expect(errors).toEqual([]);
});
test('D strict previous-turn pending takes precedence, never duplicated in follow-up', async ({ page }) => {
  const errors = await bootLubricadorFollowUp(page, { plans: [{ id: 'P1', equipmentId: 'E1', controlType: 'Día y turno de la semana', assignedDays: ['Sábado'], active: true }], skips: [{ id: 'S1', equipmentId: 'E1', date: '2026-10-10T02:00:00', createdAt: '2026-10-10T02:00:00', shiftId: 'shift_noche', reason: 'SIN_TIEMPO', active: true }] });
  await expect(page.locator('.lub-section-head:has-text("PENDIENTES DEL TURNO ANTERIOR") + .lub-eq-list')).toContainText('TEST-M');
  await expect(codes(page)).toHaveText(['TEST-V']);
  await expect(page.locator('.lub-kpi-card', { hasText: 'Arrastrados' }).locator('.lub-kpi-value')).toHaveText('1');
  expect(errors).toEqual([]);
});
test('E Ficha and no occurrence reuse real OUT_OF_PLAN dispatcher without mutations', async ({ page }) => {
  const errors = await bootLubricadorFollowUp(page);
  await page.locator('[data-equipment-id="E1"] .lub-follow-up-ver').click();
  expect(await page.evaluate(() => window.__details)).toEqual(['E1']);
  await page.locator('[data-equipment-id="E1"] .lub-follow-up-reg').click();
  await page.locator('[data-equipment-id="E2"] .lub-follow-up-reg').click();
  await expect.poll(() => page.evaluate(() => window.__flows)).toEqual([{ id: 'E1', options: { outOfPlan: true } }, { id: 'E2', options: { outOfPlan: true } }]);
  expect(await page.evaluate(() => DB.all('lubrication_assignments'))).toEqual([]);
  expect((await page.evaluate(() => DB.all('equipment'))).map(e => [e.id, e.locationId]).sort()).toEqual(equipos.map(e => [e.id, e.locationId]).sort());
  expect(errors).toEqual([]);
});
test('existing assigned occurrence uses its normal flow and keeps assignment pending', async ({ page }) => {
  const errors = await bootLubricadorFollowUp(page, { plans: [{ id: 'P1', equipmentId: 'E2', controlType: 'Día y turno de la semana', assignedDays: ['Sábado'], active: true }], assignments: [{ id: 'A1', equipmentId: 'E2', assignedCrewId: 'C1', status: 'PENDING', occurrenceKey: 'P1:2026-10-10', active: true }] });
  await page.locator('[data-equipment-id="E2"] .lub-follow-up-reg').click();
  await expect(page.locator('#oop-open-pending')).toBeVisible(); await page.locator('#oop-open-pending').click();
  expect(await page.evaluate(() => window.__flows)).toEqual([{ id: 'E2', options: {} }]);
  expect((await page.evaluate(() => DB.all('lubrication_assignments')))[0].status).toBe('PENDING');
  expect(errors).toEqual([]);
});
test('F all existing KPIs and widget totals equal initial release for same local data', async ({ page, context }) => {
  const old = await context.newPage();
  const plans = [{ id: 'P1', equipmentId: 'E1', controlType: 'Día y turno de la semana', assignedDays: ['Sábado'], active: true }];
  await bootLubricadorFollowUp(old, { source: baseline, plans });
  const errors = await bootLubricadorFollowUp(page, { plans });
  expect(await kpis(page)).toEqual(await kpis(old));
  expect(await page.evaluate(() => window.__widget)).toEqual(await old.evaluate(() => window.__widget));
  expect(errors).toEqual([]); await old.close();
});
test('H offline rereads IndexedDB; seven viewport layouts and four themes keep controls accessible', async ({ page, context }, testInfo) => {
  const errors = await bootLubricadorFollowUp(page);
  const before = await codes(page).allTextContents();
  await context.setOffline(true); await page.evaluate(() => { window.__offline(); return renderLubricadorHome(); });
  expect(await codes(page).allTextContents()).toEqual(before);
  for (const mode of ['light', 'dark', 'sun', 'contrast']) {
    await page.evaluate(mode => { document.documentElement.dataset.theme = 'amarillo-cat'; document.documentElement.dataset.mode = mode; }, mode);
    const geometry = await page.locator('#lub-pending-follow-up').evaluate(panel => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      small: Array.from(panel.querySelectorAll('button')).filter(b => b.getBoundingClientRect().height < 44 || b.getBoundingClientRect().width < 44).map(b => b.textContent),
      outside: Array.from(panel.querySelectorAll('.lub-follow-up-row *')).filter(n => { const r = n.getBoundingClientRect(), p = panel.getBoundingClientRect(); return r.right > p.right + 1 || r.left < p.left - 1; }).map(n => n.textContent),
    }));
    expect(geometry, mode).toEqual({ overflow: false, small: [], outside: [] });
  }
  await page.evaluate(() => { document.documentElement.dataset.mode = 'light'; });
  await page.locator('#lub-pending-follow-up').screenshot({ path: testInfo.outputPath('crew-follow-up.png') });
  expect(errors).toEqual([]);
});
test('empty state, zero-day exclusion and expandable list of more than five', async ({ page }) => {
  const many = Array.from({ length: 8 }, (_, i) => ({ ...equipos[0], id: `extra-${i}`, code: `TEST-${i}` }));
  const errors = await bootLubricadorFollowUp(page, { equipos: many, records: [] });
  await expect(page.locator('#lub-follow-up .lub-follow-up-row:visible')).toHaveCount(5);
  await page.locator('#lub-follow-up summary').click(); await expect(page.locator('#lub-follow-up .lub-follow-up-row:visible')).toHaveCount(8);
  await page.evaluate(async () => { const equipment = await DB.all('equipment'); await DB.putMany('lubrication_records', equipment.map(e => ({ id: `r:${e.id}`, equipmentId: e.id, date: new Date().toISOString(), active: true }))); return renderLubricadorHome(); });
  await expect(page.locator('#lub-pending-follow-up')).toContainText('Sin pendientes ni equipos que requieran seguimiento.');
  await expect(page.locator('#lub-follow-up')).toHaveCount(0);
  expect(errors).toEqual([]);
});
