import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';
import { readSource } from '../helpers/extractFromSource.js';
import { bootLubricadorFollowUp, followUpEquipment } from '../helpers/lubricadorFollowUpFixture.js';

test('shared card structure, aligned rails/actions and AA contrast in all four modes', async ({ page }, testInfo) => {
  // Illustrative codes only; these are controlled IDs, locations and dates.
  const equipment = ['45-77', '25-46', 'A-02', 'SIN-REG'].map((code, i) => ({ ...followUpEquipment[0], id: `visual-${i}`, code }));
  const records = [5, 8, 9].map((day, i) => ({ id: `r-${i}`, equipmentId: equipment[i].id, date: `2026-10-0${day}T08:39:00`, active: true }));
  const errors = await bootLubricadorFollowUp(page, { equipos: equipment, records });
  await expect(page.locator('.lub-follow-up-priority')).toHaveText(['Sin registro', 'Crítico', 'Atención', 'Seguimiento']);
  for (const mode of ['light', 'dark', 'sun', 'contrast']) {
    await page.evaluate(mode => { document.documentElement.dataset.theme = 'amarillo-cat'; document.documentElement.dataset.mode = mode; }, mode);
    const result = await page.locator('#lub-follow-up').evaluate(panel => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d');
      const luminance = color => {
        ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
        const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const contrast = el => {
        let parent = el, background = getComputedStyle(parent).backgroundColor;
        while (background === 'rgba(0, 0, 0, 0)' && parent.parentElement) { parent = parent.parentElement; background = getComputedStyle(parent).backgroundColor; }
        const a = luminance(getComputedStyle(el).color), b = luminance(background);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      };
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        cards: [...panel.querySelectorAll('.lub-follow-up-row')].map(card => {
          const style = getComputedStyle(card), rect = card.getBoundingClientRect();
          const primary = card.querySelector('.lub-follow-up-reg'), secondary = card.querySelector('.lub-follow-up-ver');
          const a = primary.getBoundingClientRect(), b = secondary.getBoundingClientRect();
          return {
            height: rect.height, padding: style.padding, radius: style.borderRadius, rail: style.borderLeftWidth, border: style.borderTopWidth,
            dayWidth: card.querySelector('.lub-follow-up-age').getBoundingClientRect().width,
            sameActionLine: Math.abs(a.top - b.top) < 1,
            actionBottom: Math.round(rect.bottom - a.bottom),
            small: a.width < 44 || a.height < 44 || b.width < 44 || b.height < 44,
            primaryBackground: getComputedStyle(primary).backgroundColor,
            secondaryBackground: getComputedStyle(secondary).backgroundColor,
            secondaryBorder: getComputedStyle(secondary).borderColor,
            ratios: [...card.querySelectorAll('.lub-follow-up-priority, .lub-follow-up-age, .lub-eq-code, .lub-eq-model, .lub-follow-up-location, .lub-follow-up-date, button')].map(contrast),
          };
        }),
      };
    });
    expect(result.overflow, mode).toBe(false);
    for (const key of ['height', 'padding', 'radius', 'rail', 'border', 'dayWidth', 'actionBottom', 'primaryBackground']) expect(new Set(result.cards.map(c => c[key])).size, `${mode}/${key}`).toBe(1);
    for (const card of result.cards) {
      expect(card.rail, mode).toBe('4px'); expect(card.dayWidth, mode).toBe(72);
      expect(card.height, mode).toBeLessThanOrEqual(185);
      expect(card.sameActionLine, mode).toBe(true); expect(card.small, mode).toBe(false);
      expect(card.primaryBackground, mode).not.toBe('rgba(0, 0, 0, 0)');
      expect(card.primaryBackground, mode).not.toBe(card.secondaryBackground);
      expect(card.secondaryBorder, mode).not.toBe('rgba(0, 0, 0, 0)');
      for (const ratio of card.ratios) expect(ratio, `${mode}/AA`).toBeGreaterThanOrEqual(4.5);
    }
    const button = page.locator('.lub-follow-up-reg').first();
    await button.focus();
    expect(await button.evaluate(el => { const s = getComputedStyle(el); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; })).toBe(true);
    await page.locator('#lub-pending-follow-up').screenshot({ path: testInfo.outputPath(`follow-up-${mode}.png`) });
  }
  await page.evaluate(async () => {
    await DB.put('lubrication_records', { id: 'r-0', equipmentId: 'visual-0', date: '2026-09-28T08:39:00', active: true });
    return renderLubricadorHome();
  });
  const twoDigits = page.locator('[data-equipment-id="visual-0"] .lub-follow-up-age');
  await expect(twoDigits.locator('strong')).toHaveText('12');
  expect(await twoDigits.evaluate(el => el.getBoundingClientRect().width)).toBe(72);
  expect(errors).toEqual([]);
});

test('all app logic and handlers remain byte-for-byte unchanged', () => {
  expect(readSource(APP_JS_PATH)).toBe(execFileSync('git', ['show', 'fb3f60f:CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js'], { encoding: 'utf8' }).replace(/\r\n/g, '\n'));
});
