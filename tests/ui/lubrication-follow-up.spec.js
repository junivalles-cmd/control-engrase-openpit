import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { bootLubricadorFollowUp, followUpEquipment as equipos, followUpRecords as records, followUpCoverage as coverage } from '../helpers/lubricadorFollowUpFixture.js';
const codes = page => page.locator('#lub-follow-up .lub-eq-code');
// UX CAMPO V2 (2026-10-24): la fila de 4 .lub-kpi-card se retiró —
// "Vencidos por horas"/"Pendientes hoy"/"Pendientes del turno anterior"
// ahora son el contador propio (.lub-accordion-count) de su acordeón;
// "Realizados hoy" sigue siendo el único contador fuera de los 3
// acordeones (span dedicado dentro del status-chip "REALIZADOS (N)").
const kpis = page => page.evaluate(() => [
  document.querySelector('#lub-acc-atencion-prioritaria-btn .lub-accordion-count')?.textContent,
  document.querySelector('#lub-acc-mi-turno-btn .lub-accordion-count')?.textContent,
  document.querySelector('#lub-acc-pendientes-anteriores-btn .lub-accordion-count')?.textContent,
  document.querySelector('.lub-realizados-count')?.textContent ?? '0',
]);
function kpiByLabel(page, label) {
  const map = {
    'Vencidos por horas': '#lub-acc-atencion-prioritaria-btn .lub-accordion-count',
    'Pendientes hoy': '#lub-acc-mi-turno-btn .lub-accordion-count',
    'Pendientes del turno anterior': '#lub-acc-pendientes-anteriores-btn .lub-accordion-count',
    'Realizados hoy': '.lub-realizados-count',
  };
  if (!map[label]) throw new Error(`kpiByLabel(): etiqueta desconocida "${label}"`);
  return page.locator(map[label]);
}
const baseline = execFileSync('git', ['show', 'fbabc2a:CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js'], { encoding: 'utf8' });
test('A/B principal and legacy show Mojón, reject unauthorized Volcán', async ({ page }) => {
  const errors = await bootLubricadorFollowUp(page, { coverage: [] });
  await expect(codes(page)).toHaveText(['TEST-M']);
  await expect(page.locator('#lub-follow-up')).toContainText('5 días');
  expect(errors).toEqual([]);
});
test('C/G principal + support without assignment, location filter and independent counters', async ({ page }) => {
  const errors = await bootLubricadorFollowUp(page);
  await expect(codes(page)).toHaveText(['TEST-M', 'TEST-V']);
  await expect(page.locator('.crew-location-filter')).toHaveCount(3);
  await page.locator('[data-location-id="V"]').click(); await expect(codes(page)).toHaveText(['TEST-V']);
  await expect.poll(() => kpis(page)).toEqual(['0', '0', '0', '0']);
  await page.locator('[data-location-id="M"]').click(); await expect(codes(page)).toHaveText(['TEST-M']);
  await page.locator('[data-location-id=""]').click(); await expect(codes(page)).toHaveText(['TEST-M', 'TEST-V']);
  expect(errors).toEqual([]);
});
test('D strict previous-turn pending takes precedence, never duplicated in follow-up', async ({ page }) => {
  const errors = await bootLubricadorFollowUp(page, { plans: [{ id: 'P1', equipmentId: 'E1', controlType: 'Día y turno de la semana', assignedDays: ['Sábado'], active: true }], skips: [{ id: 'S1', equipmentId: 'E1', date: '2026-10-10T02:00:00', createdAt: '2026-10-10T02:00:00', shiftId: 'shift_noche', reason: 'SIN_TIEMPO', active: true }] });
  await page.evaluate(async () => {
    // A late upload from a different day is not the carried-over shift.
    await DB.put('lubrication_skips', { id: 'S2', equipmentId: 'E1', date: '2026-10-09T08:00:00', createdAt: '2026-10-10T13:00:00', shiftId: 'shift_dia', reason: 'SIN_TIEMPO', active: true });
    return renderLubricadorHome();
  });
  await expect(page.locator('#lub-acc-pendientes-anteriores-panel')).toContainText('TEST-M');
  await expect(codes(page)).toHaveText(['TEST-V']);
  await expect(page.locator('.lub-pending-context')).toContainText('Turno Noche');
  await expect(kpiByLabel(page, 'Pendientes del turno anterior')).toHaveText('1');
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
for (const kind of ['PLANNED', 'ASSIGNED']) test(`${kind} occurrence reuses normal flow and preserves assignments`, async ({ page }) => {
  const equipmentId = kind === 'PLANNED' ? 'E1' : 'E2';
  const assignments = kind === 'ASSIGNED' ? [{ id: 'A1', equipmentId, assignedCrewId: 'C1', status: 'PENDING', occurrenceKey: 'P1:2026-10-10', active: true }] : [];
  const errors = await bootLubricadorFollowUp(page, { plans: [{ id: 'P1', equipmentId, controlType: 'Día y turno de la semana', assignedDays: ['Sábado'], active: true }], assignments });
  await page.locator(`[data-equipment-id="${equipmentId}"] .lub-follow-up-reg`).click();
  await expect(page.locator('#oop-open-pending')).toBeVisible(); await page.locator('#oop-open-pending').click();
  expect(await page.evaluate(() => window.__flows)).toEqual([{ id: equipmentId, options: {} }]);
  expect(await page.evaluate(() => DB.all('lubrication_assignments'))).toEqual(assignments);
  expect(errors).toEqual([]);
});
test('F all existing KPIs and widget totals equal initial release for same local data', async ({ page, context }) => {
  const old = await context.newPage();
  const plans = [{ id: 'P1', equipmentId: 'E1', controlType: 'Día y turno de la semana', assignedDays: ['Sábado'], active: true }];
  await bootLubricadorFollowUp(old, { source: baseline, plans });
  const errors = await bootLubricadorFollowUp(page, { plans });
  // UX CAMPO V2 (2026-10-24): `old` sigue corriendo el código histórico
  // (fbabc2a, con la fila de 4 .lub-kpi-card) — `page` corre el código
  // actual (3 acordeones + Realizados). La invariancia de negocio se
  // verifica contra los contadores equivalentes de cada lado, nunca
  // contra markup retirado en el lado nuevo.
  const oldKpis = await old.locator('.lub-kpi-value').allTextContents();
  expect(await kpis(page)).toEqual(oldKpis);
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

test('A/B historical scheduled pending wins by ID and code; order precedes follow-up', async ({ page }) => {
  // Codes are illustrative; IDs and locations belong only to this controlled fixture.
  const equipment = equipos.map(e => ({ ...e, code: e.id === 'E1' ? '20-5530' : e.id === 'E2' ? '05-0870' : e.code }));
  equipment.push({ ...equipment[1], id: 'DUP', code: ' 20-5530 ' });
  const errors = await bootLubricadorFollowUp(page, { equipos: equipment, plans: [{ id: 'P1', equipmentId: 'E1', controlType: 'Día y turno de la semana', assignedDays: ['Miércoles'], shiftId: 'shift_noche', active: true }] });
  await expect(page.locator('.lub-pending-card .lub-eq-code')).toHaveText(['20-5530']);
  await expect(codes(page)).toHaveText(['05-0870']);
  await expect(page.locator('.lub-pending-context')).toContainText('Turno Noche');
  expect(await page.locator('#lub-pending-follow-up h3.lub-section-head').allTextContents()).toEqual(['REQUIEREN SEGUIMIENTO · 1']);
  await expect.poll(() => kpis(page)).toEqual(['0', '0', '1', '0']);
  expect(errors).toEqual([]);
});

test('one global sync indicator remains; compact global registration keeps its action', async ({ page }) => {
  const errors = await bootLubricadorFollowUp(page);
  await page.evaluate(() => { document.body.insertAdjacentHTML('afterbegin', '<button id="conn-badge">Sincronizado</button>'); window.openOutOfPlanEquipmentPicker = () => window.__globalPickerOpened = true; return renderLubricadorHome(); });
  await expect(page.locator('.lub-operational-context')).not.toContainText('Sincronizado');
  await expect(page.locator('#conn-badge')).toHaveText('Sincronizado');
  await expect(page.locator('#lub-quick-registrar')).not.toHaveClass(/lub-hero-action/);
  await page.locator('#lub-quick-registrar').click();
  expect(await page.evaluate(() => window.__globalPickerOpened)).toBe(true);
  expect(errors).toEqual([]);
});

for (const count of [0, 1, 2, 3, 5]) test(`${count} recommendations, four themes, compact actions and responsive columns`, async ({ page }, testInfo) => {
  const equipment = Array.from({ length: count }, (_, i) => ({ ...equipos[0], id: `visual-${i}`, code: `VIS-${i}` }));
  const dates = ['2026-10-05', '2026-10-08', '2026-10-09'];
  const localRecords = equipment.map((e, i) => ({ id: `r:${e.id}`, equipmentId: e.id, date: `${dates[i % 3]}T08:39:00`, active: true }));
  const errors = await bootLubricadorFollowUp(page, { equipos: equipment, records: localRecords });
  await expect(codes(page)).toHaveCount(count);
  for (const mode of ['light', 'dark', 'sun', 'contrast']) {
    await page.evaluate(mode => { document.documentElement.dataset.theme = 'amarillo-cat'; document.documentElement.dataset.mode = mode; }, mode);
    const geometry = await page.locator('#lub-pending-follow-up').evaluate(panel => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      small: [...panel.querySelectorAll('button')].some(b => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44; }),
      rowHeight: Math.max(0, ...[...panel.querySelectorAll('.lub-follow-up-row')].map(n => n.getBoundingClientRect().height)),
      columns: new Set([...panel.querySelectorAll('.lub-follow-up-row')].map(n => Math.round(n.getBoundingClientRect().left))).size,
    }));
    expect(geometry.overflow, mode).toBe(false); expect(geometry.small, mode).toBe(false);
    expect(geometry.rowHeight, mode).toBeLessThanOrEqual(185); expect(geometry.columns, mode).toBeLessThanOrEqual(testInfo.project.use.viewport.width >= 1200 ? 3 : 2);
    if (count) {
      await expect(page.locator('.lub-follow-up-reg').first()).toContainText('Registrar engrase');
      await expect(page.locator('.lub-follow-up-reg').first()).toHaveClass(/btn-accent/);
    }
  }
  await page.evaluate(() => { document.documentElement.dataset.mode = 'light'; });
  if (count) await page.locator('#lub-pending-follow-up').screenshot({ path: testInfo.outputPath(`follow-up-${count}.png`) });
  expect(errors).toEqual([]);
});
