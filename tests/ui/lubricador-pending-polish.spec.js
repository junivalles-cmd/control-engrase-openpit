import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { bootLubricadorFollowUp } from '../helpers/lubricadorFollowUpFixture.js';
const baseline = execFileSync('git', ['show', 'f7d0d3a:CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js'], { encoding: 'utf8' });

test('previous pending: precedence, context, AA, footer and KPI invariance', async ({ page, context }, info) => {
  const plans = [{ id: 'P1', equipmentId: 'E1', controlType: 'Día y turno de la semana', assignedDays: ['Miércoles'], shiftId: 'shift_noche', active: true }];
  const before = await context.newPage(); await bootLubricadorFollowUp(before, { source: baseline, plans });
  const errors = await bootLubricadorFollowUp(page, { plans });
  await page.locator('#app-content').evaluate(el => el.classList.add('lub-content'));
  // UX CAMPO V2 (2026-10-24): la fila de 4 .lub-kpi-card se retiró a
  // propósito (acordeones propios) — la invariancia de valores de negocio
  // contra el baseline histórico (f7d0d3a) ahora se verifica contra los
  // contadores reales equivalentes, nunca contra markup retirado.
  // Orden histórico: Vencidos por horas/Pendientes hoy/Pendientes del
  // turno anterior/Realizados hoy = [0, 0, 1, 0] para este fixture.
  expect(await before.locator('.lub-kpi-value').allTextContents()).toEqual(['0', '0', '1', '0']);
  await expect(page.locator('#lub-acc-atencion-prioritaria-btn .lub-accordion-count')).toHaveText('0');
  await expect(page.locator('#lub-acc-mi-turno-btn .lub-accordion-count')).toHaveText('0');
  await expect(page.locator('#lub-acc-pendientes-anteriores-btn .lub-accordion-count')).toHaveText('1');
  await expect(page.locator('.lub-realizados-count')).toHaveCount(0); // 0 oculta su sección por completo
  expect(await page.locator('.lub-pending-card').getAttribute('data-equipment-id')).toBe('E1');
  await expect(page.locator('#lub-follow-up [data-equipment-id="E1"]')).toHaveCount(0);
  await expect(page.locator('.lub-pending-context')).toContainText('Turno Noche');
  expect(await page.locator('#lub-pending-follow-up h3.lub-section-head').allTextContents()).toEqual(['REQUIEREN SEGUIMIENTO · 1']);
  for (const mode of ['light', 'dark', 'sun', 'contrast']) {
    await page.evaluate(mode => { document.documentElement.dataset.theme = 'amarillo-cat'; document.documentElement.dataset.mode = mode; }, mode);
    const result = await page.locator('.lub-pending-card').evaluate(card => {
      const ctx = document.createElement('canvas').getContext('2d');
      const lum = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722; };
      const ratio = el => {
        const layers = []; for (let node = el; node; node = node.parentElement) layers.push(getComputedStyle(node).backgroundColor);
        ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1, 1);
        for (const color of layers.reverse()) { ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); }
        const pixel = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
        const b = lum(`rgb(${pixel.join(',')})`), a = lum(getComputedStyle(el).color);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      };
      const primary = card.querySelector('.lub-arr-reg').getBoundingClientRect(), secondary = card.querySelector('.lub-arr-ver').getBoundingClientRect(), rect = card.getBoundingClientRect();
      return { rail: getComputedStyle(card).borderLeftWidth, sameLine: Math.abs(primary.top - secondary.top) < 1, secondaryLeft: secondary.left < primary.left,
        small: [primary, secondary].some(r => r.width < 44 || r.height < 44), overflow: document.documentElement.scrollWidth > innerWidth,
        cut: [...card.children].some(el => el.getBoundingClientRect().right > rect.right + 1),
        ratios: [...card.querySelectorAll('.lub-arrastrado-origen, .lub-eq-code, .lub-eq-model, .lub-eq-location, .lub-pending-context, button')].map(el => ({ selector: el.className, value: ratio(el) })) };
    });
    expect(result.rail, mode).toBe('4px'); expect(result.sameLine, mode).toBe(true); expect(result.secondaryLeft, mode).toBe(true);
    expect(result.small, mode).toBe(false); expect(result.overflow, mode).toBe(false); expect(result.cut, mode).toBe(false);
    for (const ratio of result.ratios) expect(ratio.value, `${mode}/${ratio.selector}/AA`).toBeGreaterThanOrEqual(4.5);
  }
  await page.locator('#lub-pending-follow-up').screenshot({ path: info.outputPath('pending.png') });
  expect(errors).toEqual([]); await before.close();
});
