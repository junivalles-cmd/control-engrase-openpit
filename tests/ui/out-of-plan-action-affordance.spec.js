import { test, expect } from '@playwright/test';
import { bootLubricadorFollowUp } from '../helpers/lubricadorFollowUpFixture.js';

test('global out-of-plan button: integrated icon, aligned labels/arrow and keyboard activation', async ({ page }, info) => {
  const errors = await bootLubricadorFollowUp(page);
  await page.locator('#app-content').evaluate(el => el.classList.add('lub-content'));
  await page.evaluate(() => { window.__pickerCalls = 0; window.openOutOfPlanEquipmentPicker = () => window.__pickerCalls++; });
  const button = page.locator('#lub-quick-registrar');
  for (const mode of ['light', 'dark', 'sun', 'contrast']) {
    await page.evaluate(mode => { document.documentElement.dataset.theme = 'amarillo-cat'; document.documentElement.dataset.mode = mode; }, mode);
    const result = await button.evaluate(el => {
      const rect = el.getBoundingClientRect(), group = el.querySelector('.lub-hero-action-text'), g = group.getBoundingClientRect();
      const icon = el.querySelector('.btn-icon'), i = icon.getBoundingClientRect(), arrow = el.querySelector('.lub-hero-action-arrow').getBoundingClientRect();
      const pseudo = getComputedStyle(group, '::before'), title = el.querySelector('.lub-hero-action-title').getBoundingClientRect(), subtitle = el.querySelector('.lub-hero-action-sub').getBoundingClientRect();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d');
      const lum = color => { ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722; };
      const a = lum(getComputedStyle(icon).color), b = lum(pseudo.backgroundColor);
      const border = lum(getComputedStyle(el).borderTopColor), background = lum(getComputedStyle(el).backgroundColor);
      return { width: rect.width, height: rect.height, iconCentered: Math.abs(i.left + i.width / 2 - g.left - 16) < 1 && Math.abs(i.top + i.height / 2 - g.top - g.height / 2) < 1,
        labelsAligned: Math.abs(title.left - subtitle.left) < 1, arrowCentered: Math.abs(arrow.top + arrow.height / 2 - rect.top - rect.height / 2) < 1,
        pseudoSize: [pseudo.width, pseudo.height], cursor: getComputedStyle(el).cursor,
        overflow: document.documentElement.scrollWidth > innerWidth || el.scrollWidth > el.clientWidth + 1,
        iconContrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), borderContrast: (Math.max(border, background) + .05) / (Math.min(border, background) + .05) };
    });
    expect(result.width, mode).toBeGreaterThanOrEqual(44); expect(result.height, mode).toBeGreaterThanOrEqual(44);
    expect(result.iconCentered, mode).toBe(true); expect(result.labelsAligned, mode).toBe(true); expect(result.arrowCentered, mode).toBe(true);
    expect(result.pseudoSize, mode).toEqual(['32px', '32px']); expect(result.cursor, mode).toBe('pointer'); expect(result.overflow, mode).toBe(false);
    expect(result.iconContrast, mode).toBeGreaterThanOrEqual(3);
    expect(result.borderContrast, mode).toBeGreaterThanOrEqual(3);
    await button.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Space');
    expect(await page.evaluate(() => window.__pickerCalls)).toBe((['light', 'dark', 'sun', 'contrast'].indexOf(mode) + 1) * 2);
    await button.screenshot({ path: info.outputPath(`out-of-plan-${mode}.png`) });
  }
  expect(errors).toEqual([]);
});
