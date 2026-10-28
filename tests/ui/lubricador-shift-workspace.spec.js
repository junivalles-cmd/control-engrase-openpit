import { test, expect } from '@playwright/test';
import { bootLubricadorFollowUp, followUpEquipment } from '../helpers/lubricadorFollowUpFixture.js';

for (const count of [0, 1, 2, 3, 8]) test(`workspace ${count} recommendations: real content width, density and keyboard`, async ({ page }, info) => {
  const equipos = Array.from({ length: count }, (_, i) => ({ ...followUpEquipment[0], id: `workspace-${i}`, code: `WS-${i}` }));
  const errors = await bootLubricadorFollowUp(page, { equipos, records: [] });
  // Apply the real shell content class; the shared fixture intentionally omits it.
  await page.locator('#app-content').evaluate(el => el.classList.add('lub-content'));
  await expect(page.locator('.lub-section-head', { hasText: 'Acciones rápidas' })).toBeVisible();
  await expect(page.locator('#lub-fab-anomaly')).toHaveText('Nueva anomalía');
  for (const mode of ['light', 'dark', 'sun', 'contrast']) {
    await page.evaluate(mode => { document.documentElement.dataset.theme = 'amarillo-cat'; document.documentElement.dataset.mode = mode; }, mode);
    const layout = await page.evaluate(() => {
      const main = document.getElementById('app-content'), rect = main.getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth, width: rect.width, centered: Math.abs(rect.left - (innerWidth - rect.width) / 2) < 1,
        columns: document.querySelector('#lub-follow-up .lub-eq-list') ? getComputedStyle(document.querySelector('#lub-follow-up .lub-eq-list')).gridTemplateColumns.split(' ').length : 0,
        // UX CAMPO V2 (2026-10-24): la fila de 4 .lub-kpi-card se retiró —
        // el acordeón real equivalente es .lub-accordion-head (3, SIEMPRE
        // presentes, misma consistencia visual de altura que antes).
        kpis: [...document.querySelectorAll('.lub-accordion-head')].map(el => el.getBoundingClientRect().height),
        quickColumns: getComputedStyle(document.querySelector('.lub-quick-actions')).gridTemplateColumns.split(' ').length,
        small: [...main.querySelectorAll('button')].some(el => { const r = el.getBoundingClientRect(); return r.width < 44 || r.height < 44; }),
      };
    });
    expect(layout.overflow, mode).toBe(false); expect(layout.centered, mode).toBe(true); expect(layout.small, mode).toBe(false);
    expect(new Set(layout.kpis).size, mode).toBe(1);
    const width = info.project.use.viewport.width;
    if (width >= 1200) expect(layout.width, mode).toBe(1220);
    if (count) expect(layout.columns, mode).toBe(width >= 1200 && count >= 3 ? 3 : width >= 768 ? 2 : 1);
    expect(layout.quickColumns, mode).toBe(width < 480 ? 2 : 4);
    for (const selector of ['#lub-quick-registrar', '#lub-quick-qr', '#lub-quick-buscar', '#lub-quick-matriz', '#lub-fab-anomaly', ...(count ? ['.lub-follow-up-ver', '.lub-follow-up-reg'] : [])]) {
      const button = page.locator(selector).first(); await button.focus();
      expect(await button.evaluate(el => { const s = getComputedStyle(el); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2 && s.boxShadow === 'none'; })).toBe(true);
      await page.keyboard.press('Tab'); expect(await button.evaluate(el => el.matches(':focus-visible'))).toBe(false);
    }
  }
  if (count === 3) await page.locator('#app-content').screenshot({ path: info.outputPath('workspace.png') });
  expect(errors).toEqual([]);
});

test('switching authorized crew recalculates local follow-up without changing equipment', async ({ page }) => {
  const errors = await bootLubricadorFollowUp(page);
  await page.evaluate(async () => {
    await DB.put('cuadrillas', { id: 'C2', name: 'Segunda ficticia', locationId: 'O', active: true, memberUserIds: ['U1'] });
    await DB.put('crew_locations', {id:'CO',crew_id:'C2',location_id:'O',role:'PRINCIPAL',active:true});
    setSelectedCrewId('U1', 'C1');
    return renderLubricadorHome();
  });
  await expect(page.locator('#lub-change-crew')).toBeVisible(); await page.locator('#lub-change-crew').click();
  const choice = page.locator('[data-crew-id="C2"]');
  await choice.click();
  await expect(page.locator('#lub-follow-up .lub-eq-code')).toHaveText(['TEST-O']);
  expect((await page.evaluate(() => DB.all('equipment'))).map(e => [e.id, e.locationId])).toEqual(followUpEquipment.map(e => [e.id, e.locationId]));
  expect(errors).toEqual([]);
});
