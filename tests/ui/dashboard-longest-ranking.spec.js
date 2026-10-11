import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { bootDashboard } from '../helpers/dashboardFixture.js';

const baseline = execFileSync('git', ['show', '997203a:CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js'], { encoding: 'utf8' });
const baselineCSS = execFileSync('git', ['show', '997203a:CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css'], { encoding: 'utf8' });
const equipos = Array.from({ length: 8 }, (_, i) => ({ id: `fixture-${i}`, code: `TEST-${100 + i}`, brand: 'Komatsu', model: 'PC500LC-10M0', status: 'Operativo', typeId: 't1', locationId: i % 2 ? 'l2' : 'l1' }));
const records = equipos.map((e, i) => ({ id: `record-${i}`, equipmentId: e.id, date: `2026-10-${String(i + 1).padStart(2, '0')}T08:39:00`, shiftId: 'shift_dia', userName: 'Fixture' }));
const fixture = { equipos, records, locations: [{ id: 'l1', name: 'Volcán' }, { id: 'l2', name: 'Mojón' }] };
async function render(page, old = false, overrides = {}) {
  await page.clock.install({ time: new Date('2026-10-10T15:00:00') });
  await bootDashboard(page, { ...fixture, ...overrides, ...(old ? { source: baseline, css: baselineCSS } : {}) });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'amarillo-cat'; document.documentElement.dataset.mode = 'light'; return window.renderDashboard(); });
}
async function values(page) {
  return page.locator('#dash-tiempo-sin-engrase-panel').evaluate(panel => ({
    max: panel.querySelector('.dash-exc-summary')?.textContent.trim(),
    rows: Array.from(panel.querySelectorAll('.dash-exc-row')).map(row => ({
      id: row.dataset.id, code: row.querySelector('.dash-exc-code').textContent,
      model: row.querySelector('.dash-exc-line2').textContent,
      last: row.querySelector('time') ? fmtDate(row.querySelector('time').getAttribute('datetime')) : row.querySelector('.dash-exc-line3').textContent.replace(/^Último: /, ''),
      days: row.querySelector('.dash-exc-days').textContent,
    })),
  }));
}
test('same equipment, order, last timestamp, days, maximum and Top 5 before/after and filters', async ({ page, context }) => {
  const old = await context.newPage();
  await render(old, true); await render(page);
  expect(await values(page)).toEqual(await values(old));
  expect((await values(page)).rows).toHaveLength(5);
  expect((await values(page)).max).toBe('Máximo: 9 d · TEST-100');
  await expect(page.locator('.dash-exc-rank')).toHaveText(['#1', '#2', '#3', '#4', '#5']);
  await expect(page.locator('.dash-exc-priority')).toHaveText(['Mayor tiempo', 'Atención', 'Seguimiento', 'Seguimiento', 'Seguimiento']);
  for (const location of ['l1', 'l2', '']) {
    await old.locator('#dash-ubic').selectOption(location);
    await page.locator('#dash-ubic').selectOption(location);
    expect(await values(page)).toEqual(await values(old));
  }
  const timestamps = await page.locator('#dash-tiempo-sin-engrase-panel time').evaluateAll(nodes => nodes.map(n => n.getAttribute('datetime')));
  expect(timestamps.every(t => records.some(r => r.date === t))).toBe(true);
  await old.close();
});
test('seven viewport layouts, four themes, contrast and touch targets', async ({ page }, testInfo) => {
  await render(page);
  const panel = page.locator('#dash-tiempo-sin-engrase-panel');
  for (const mode of ['light', 'dark', 'sun', 'contrast']) {
    await page.evaluate(mode => { document.documentElement.dataset.mode = mode; }, mode);
    const result = await panel.evaluate(panel => {
      const outside = Array.from(panel.querySelectorAll('.dash-exc-code, .dash-exc-days-wrap, .dash-exc-hist-btn, time')).filter(el => {
        const r = el.getBoundingClientRect(), p = panel.getBoundingClientRect();
        return r.left < p.left || r.right > p.right || el.scrollWidth > el.clientWidth + 1;
      }).map(el => el.textContent);
      const small = Array.from(panel.querySelectorAll('button')).filter(el => el.getBoundingClientRect().height < 44 || el.getBoundingClientRect().width < 44).map(el => el.textContent);
      const luminance = color => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
        const rgb = Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const contrast = selector => {
        const el = panel.querySelector(selector), foreground = luminance(getComputedStyle(el).color);
        let parent = el, color = getComputedStyle(parent).backgroundColor;
        while (color === 'rgba(0, 0, 0, 0)' && parent.parentElement) { parent = parent.parentElement; color = getComputedStyle(parent).backgroundColor; }
        const background = luminance(color);
        return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
      };
      return { outside, small, overflow: document.documentElement.scrollWidth > innerWidth, days: contrast('.is-max .dash-exc-days'), code: contrast('.is-max .dash-exc-code'), rank: contrast('.dash-exc-rank'), labels: [1, 2, 3].flatMap(rank => ['.dash-exc-priority', '.dash-exc-days'].map(selector => contrast(`[data-rank="${rank}"] ${selector}`))) };
    });
    expect(result.outside, mode).toEqual([]); expect(result.small, mode).toEqual([]); expect(result.overflow, mode).toBe(false);
    expect(result.days, mode).toBeGreaterThanOrEqual(4.5); expect(result.code, mode).toBeGreaterThanOrEqual(4.5); expect(result.rank, mode).toBeGreaterThanOrEqual(4.5);
    for (const ratio of result.labels) expect(ratio, mode).toBeGreaterThanOrEqual(4.5);
  }
  await page.evaluate(() => { document.documentElement.dataset.mode = 'light'; });
  await panel.screenshot({ path: testInfo.outputPath('longest-ranking.png') });
});
test('no record and empty fleet retain their honest states', async ({ page, context }) => {
  const old = await context.newPage();
  await render(old, true, { records: [] }); await render(page, false, { records: [] });
  expect(await values(page)).toEqual(await values(old));
  await expect(page.locator('#dash-tiempo-sin-engrase-panel time')).toHaveCount(0);
  await expect(page.locator('#dash-tiempo-sin-engrase-panel .dash-exc-days').first()).toHaveText('—');
  await page.evaluate(() => { DB.allActive = async () => []; return window.renderDashboard(); });
  await expect(page.locator('#dash-tiempo-sin-engrase-panel .empty-state')).toHaveText('Sin equipos para mostrar.');
  await expect(page.locator('#dash-tiempo-ver-todos')).toHaveCount(0);
  await old.close();
});
test('one day uses singular without changing relative ranking semantics', async ({ page }) => {
  await render(page, false, { equipos: [equipos[0]], records: [{ ...records[0], date: '2026-10-09T08:39:00' }] });
  const panel = page.locator('#dash-tiempo-sin-engrase-panel');
  await expect(panel.locator('.dash-exc-days')).toHaveText('1');
  await expect(panel.locator('.dash-exc-days-label')).toHaveText('día');
  await expect(panel.locator('.dash-exc-priority')).toHaveText('Mayor tiempo');
});
test('Ficha, independent history, Ver todos and keyboard keep existing actions', async ({ page }) => {
  await render(page);
  await page.evaluate(() => { window.__routes = []; window.__details = []; window.openEquipmentDetail = id => window.__details.push(id); window.navigate = route => window.__routes.push({ route, equipment: App.dashJumpEquipoId }); });
  const row = page.locator('#dash-tiempo-sin-engrase-panel .dash-exc-row').first();
  const id = await row.getAttribute('data-id');
  await row.locator('.dash-exc-hist-btn').click();
  expect(await page.evaluate(() => window.__routes)).toEqual([{ route: 'historial', equipment: id }]);
  expect(await page.evaluate(() => window.__details)).toEqual([]);
  await row.locator('.dash-exc-code').focus(); await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__details)).toEqual([id]);
  await page.locator('#dash-tiempo-ver-todos').click();
  await expect(page.locator('.modal .dash-exc-row')).toHaveCount(8);
  await expect(page.locator('.modal .dash-exc-rank')).toHaveCount(0);
});
