import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const source = readSource(APP_JS_PATH);
const themes = new Function(extractDeclaration(source, 'THEMES') + '; return THEMES;')();
const ratio = (a, b) => {
  const lum = channels => channels.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const values = [lum(a), lum(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
};

async function palette(page, mode) {
  await page.setContent(`<main style="max-width:920px;margin:12px auto;padding:12px;background:var(--surface)">
    <nav><button class="menu-item active">Dashboard</button></nav>
    <div class="panel"><div class="panel-head"><h3>Burdeos</h3></div>
      <div style="padding:12px"><button class="btn btn-accent">Registrar</button>
      <span class="status-chip" style="--c:var(--amber)">PENDIENTE HOY</span>
      <span class="status-chip" style="--c:var(--green)">REALIZADO</span></div></div>
    <div class="lub-welcome-card"><div class="lub-welcome-name">Lubricador de prueba</div><div class="lub-welcome-role">LUBRICADOR</div></div>
    <div class="crew-location-filters"><button class="btn" aria-pressed="true">Todas (3)</button><button class="btn">Zona A (2)</button></div>
  </main>`);
  await page.addStyleTag({ path: path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css') });
  await page.evaluate(mode => { document.documentElement.dataset.theme = 'amarillo-cat'; document.documentElement.dataset.mode = mode; }, mode);
}

async function colors(page, selector) {
  return page.locator(selector).evaluate(el => {
    const css = getComputedStyle(el);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const rgb = (color, base = 'white') => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = base; ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    return { fg: rgb(css.color), bg: rgb(css.backgroundColor, getComputedStyle(document.querySelector('main')).backgroundColor), outline: css.outlineStyle, outlineColor: rgb(css.outlineColor) };
  });
}

for (const mode of ['light', 'dark', 'sun']) {
  test('office Access AA controls, semantics, borders and focus: ' + mode, async ({ page }, testInfo) => {
    await palette(page, mode);
    const tokens = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      return Object.fromEntries(['accent', 'accent-dark', 'on-accent', 'green', 'amber', 'red', 'gray-status'].map(name => [name, css.getPropertyValue('--' + name).trim()]));
    });
    expect(tokens.accent).toBe('#A4373A'); expect(tokens['accent-dark']).toBe('#742629'); expect(tokens['on-accent']).toBe('#FFFFFF');
    const button = page.locator('.btn-accent');
    for (const selector of ['.btn-accent', '.menu-item.active', '.crew-location-filters [aria-pressed=true]', '.lub-welcome-role', '.status-chip:first-of-type']) {
      const c = await colors(page, selector); expect(ratio(c.fg, c.bg), selector).toBeGreaterThanOrEqual(4.5);
    }
    await button.hover();
    const hover = await colors(page, '.btn-accent'); expect(ratio(hover.fg, hover.bg)).toBeGreaterThanOrEqual(4.5);
    expect(hover.bg).toEqual([116, 38, 41]);
    await page.mouse.move(0, 0); await button.focus();
    const focus = await colors(page, '.btn-accent'); expect(focus.outline).not.toBe('none');
    expect(ratio(focus.outlineColor, (await colors(page, 'main')).bg)).toBeGreaterThanOrEqual(3);
    const border = await page.locator('.lub-welcome-card').evaluate(el => getComputedStyle(el).borderTopColor);
    expect(border).toBe('rgb(164, 55, 58)');
    const stripes = await page.locator('.panel-head').evaluate(el => getComputedStyle(el).borderImageSource);
    expect(stripes).toContain('164, 55, 58');
    // Switching presets must not modify status semantics or their meaning.
    for (const theme of themes.filter(t => t.id !== 'amarillo-cat')) {
      await page.evaluate(id => { document.documentElement.dataset.theme = id; }, theme.id);
      const actual = await page.evaluate(() => {
        const css = getComputedStyle(document.documentElement);
        return Object.fromEntries(['accent', 'green', 'amber', 'red', 'gray-status'].map(name => [name, css.getPropertyValue('--' + name).trim()]));
      });
      expect(actual.accent.toUpperCase()).toBe(theme.color.toUpperCase());
      for (const key of ['green', 'amber', 'red', 'gray-status']) expect(actual[key]).toBe(tokens[key]);
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'amarillo-cat'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('yellow-' + mode + '.png'), fullPage: true });
  });
}
