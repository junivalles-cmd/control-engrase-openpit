import { test, expect } from '@playwright/test';
import { bootLubricadorFollowUp } from '../helpers/lubricadorFollowUpFixture.js';

const ids = ['lub-quick-registrar', 'lub-quick-qr', 'lub-quick-buscar', 'lub-quick-matriz', 'lub-fab-anomaly'];

test('seven widths / four modes: semantic color, AA, centered mask icons and intact interactions', async ({ page }, testInfo) => {
  const errors = await bootLubricadorFollowUp(page);
  await page.evaluate(() => {
    window.__actionCalls = [];
    window.openOutOfPlanEquipmentPicker = () => __actionCalls.push('register');
    window.openQrScanner = () => __actionCalls.push('qr');
    window.openLubricadorMatrizModal = options => __actionCalls.push(options.equipos ? 'matrix' : 'invalid-matrix');
    window.openAnomalyForm = () => __actionCalls.push('anomaly');
    document.body.insertAdjacentHTML('afterbegin', '<input id="quick-find" aria-label="Buscar equipo">');
  });
  for (const mode of ['light', 'dark', 'sun', 'contrast']) {
    await page.evaluate(mode => { document.documentElement.dataset.theme = 'amarillo-cat'; document.documentElement.dataset.mode = mode; }, mode);
    const result = await page.evaluate(ids => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d');
      const rgb = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
      const luminance = color => {
        const values = rgb(color).slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
        return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
      };
      const ratio = (a, b) => { a = luminance(a); b = luminance(b); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
      return { overflow: document.documentElement.scrollWidth > innerWidth, buttons: ids.map(id => {
        const el = document.getElementById(id), style = getComputedStyle(el), rect = el.getBoundingClientRect();
        const icon = el.querySelector('.btn-icon'), iconStyle = getComputedStyle(icon), iconRect = icon.getBoundingClientRect();
        const subtitle = el.querySelector('.lub-hero-action-sub');
        return {
          id, width: rect.width, height: rect.height,
          cut: el.scrollWidth > el.clientWidth + 1 || rect.right > innerWidth || [...el.children].some(n => n.getBoundingClientRect().right > rect.right + 1),
          textContrast: ratio(style.color, style.backgroundColor),
          subtitleContrast: subtitle ? ratio(getComputedStyle(subtitle).color, style.backgroundColor) : null,
          iconContrast: ratio(iconStyle.backgroundColor, style.backgroundColor),
          actualIconInk: rgb(iconStyle.backgroundColor).join(',') === rgb(iconStyle.color).join(','),
          mask: iconStyle.maskImage !== 'none', color: rgb(iconStyle.backgroundColor).join(','),
          iconCentered: id === 'lub-quick-registrar' || Math.abs(iconRect.left + iconRect.width / 2 - rect.left - rect.width / 2) < 1,
        };
      }) };
    }, ids);
    expect(result.overflow, mode).toBe(false);
    expect(new Set(result.buttons.slice(1).map(b => b.color)).size, mode).toBe(4);
    expect(new Set(result.buttons.slice(1).map(b => b.height)).size, mode).toBe(1);
    for (const button of result.buttons) {
      expect(button.width, `${mode}/${button.id}`).toBeGreaterThanOrEqual(44); expect(button.height).toBeGreaterThanOrEqual(44);
      expect(button.cut, `${mode}/${button.id}`).toBe(false); expect(button.iconCentered).toBe(true);
      expect(button.textContrast, `${mode}/${button.id}`).toBeGreaterThanOrEqual(4.5);
      expect(button.iconContrast, `${mode}/${button.id}/icon`).toBeGreaterThanOrEqual(3);
      if (button.subtitleContrast !== null) expect(button.subtitleContrast, mode).toBeGreaterThanOrEqual(4.5);
      expect(button.actualIconInk, mode).toBe(true); expect(button.mask, mode).toBe(true);
    }
    for (const id of ids) {
      const button = page.locator(`#${id}`); await button.focus();
      expect(await button.evaluate(el => { const s = getComputedStyle(el); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; })).toBe(true);
    }
    await page.locator('.lub-quick-actions').screenshot({ path: testInfo.outputPath(`quick-actions-${mode}.png`) });
    await page.locator('#lub-quick-registrar').screenshot({ path: testInfo.outputPath(`out-of-plan-${mode}.png`) });
  }
  await page.locator('#lub-quick-registrar').click(); await page.locator('#lub-quick-qr').click();
  await page.locator('#lub-quick-buscar').click(); await expect(page.locator('#quick-find')).toBeFocused();
  await page.locator('#lub-quick-matriz').click(); await page.locator('#lub-fab-anomaly').click();
  expect(await page.evaluate(() => __actionCalls)).toEqual(['register', 'qr', 'matrix', 'anomaly']);
  expect(errors).toEqual([]);
});

test('hover, pressed and disabled remain visible and legible', async ({ page }) => {
  await bootLubricadorFollowUp(page);
  for (const mode of ['light', 'dark', 'sun', 'contrast']) {
    await page.evaluate(mode => { document.documentElement.dataset.theme = 'amarillo-cat'; document.documentElement.dataset.mode = mode; }, mode);
    for (const id of ids) {
      const button = page.locator(`#${id}`); await page.mouse.move(0, 0);
      const assertContrast = async state => {
        const ratios = await button.evaluate(el => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d');
          const lum = color => {
            ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
            const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
            return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
          };
          const style = getComputedStyle(el), bg = lum(style.backgroundColor);
          const ratio = color => { const ink = lum(color); return (Math.max(ink, bg) + .05) / (Math.min(ink, bg) + .05); };
          const subtitle = el.querySelector('.lub-hero-action-sub');
          return { text: ratio(style.color), icon: ratio(getComputedStyle(el.querySelector('.btn-icon')).backgroundColor), subtitle: subtitle ? ratio(getComputedStyle(subtitle).color) : null };
        });
        expect(ratios.text, `${mode}/${id}/${state}/text`).toBeGreaterThanOrEqual(4.5);
        expect(ratios.icon, `${mode}/${id}/${state}/icon`).toBeGreaterThanOrEqual(3);
        if (ratios.subtitle !== null) expect(ratios.subtitle, `${mode}/${state}/subtitle`).toBeGreaterThanOrEqual(4.5);
      };
      const background = () => button.evaluate(el => getComputedStyle(el).backgroundColor);
      const initial = await background(); await button.hover(); const hover = await background();
      expect(hover, `${mode}/${id}/hover`).not.toBe(initial);
      await assertContrast('hover');
      await page.mouse.down(); const active = await background(); await assertContrast('pressed'); await page.mouse.move(0, 0); await page.mouse.up();
      expect(active, `${mode}/${id}/pressed`).not.toBe(hover);
      await button.evaluate(el => { el.disabled = true; });
      const disabled = await button.evaluate(el => { const s = getComputedStyle(el); return { opacity: s.opacity, cursor: s.cursor, color: s.color }; });
      expect(disabled.opacity).toBe('1'); expect(disabled.cursor).toBe('not-allowed');
      await assertContrast('disabled');
      await button.evaluate(el => { el.disabled = false; });
    }
  }
});
