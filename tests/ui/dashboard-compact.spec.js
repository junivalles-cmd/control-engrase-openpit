import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { bootDashboard } from '../helpers/dashboardFixture.js';

// Frozen release baseline: read-only, no checkout/reset or production data.
const oldSource = execFileSync('git', ['show', '23fef96:CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js'], { encoding: 'utf8' });
const oldCSS = execFileSync('git', ['show', '23fef96:CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css'], { encoding: 'utf8' });
const equipos = Array.from({ length: 8 }, (_, i) => ({ id: `e${i + 1}`, code: `TEST-${i + 1}`, brand: 'Fixture', model: 'Operational model',
  status: i === 5 ? 'Detenido' : 'Operativo', typeId: i % 2 ? 't2' : 't1', locationId: i % 2 ? 'l2' : 'l1', shiftId: i % 2 ? 'shift_noche' : 'shift_dia', hourmeter: i === 0 ? 240 : 190 }));
const fixture = {
  equipos,
  types: [{ id: 't1', name: 'Excavadora' }, { id: 't2', name: 'Camión' }],
  locations: [{ id: 'l1', name: 'Ubicación A' }, { id: 'l2', name: 'Ubicación B' }],
  plans: equipos.filter(e => e.id !== 'e5').map(e => ({ id: `p-${e.id}`, equipmentId: e.id,
    controlType: ['e1', 'e2', 'e6'].includes(e.id) ? 'Horas de operación' : 'Día y turno de la semana', frequency: 100, lastGreaseHour: 100,
    assignedDays: ['Sábado'], shiftId: e.shiftId })),
  records: [
    { id: 'r1', equipmentId: 'e1', date: '2026-10-10T11:00:00', createdAt: '2026-10-10T11:00:00', shiftId: 'shift_dia', operationalSnapshot: { executionType: 'OUT_OF_PLAN' }, userName: 'Fixture' },
    { id: 'r3', equipmentId: 'e3', date: '2026-10-10T10:00:00', createdAt: '2026-10-10T10:00:00', shiftId: 'shift_dia', userName: 'Fixture' },
    { id: 'r7', equipmentId: 'e7', date: '2026-10-01T10:00:00', createdAt: '2026-10-01T10:00:00', shiftId: 'shift_dia', userName: 'Fixture' },
  ],
  validations: ['v1', 'v2'].map(id => ({ id, lubricationRecordId: 'r3', signerRole: 'OPERADOR' })),
  anomalies: [{ id: 'a1', equipmentId: 'e1', status: 'Abierta' }, { id: 'a2', equipmentId: 'e2', status: 'En atención' }],
  assignments: [{ id: 'assignment', equipmentId: 'e2', status: 'PENDING' }],
  skips: [{ id: 'skip', equipmentId: 'e4', date: '2026-10-10T02:00:00', shiftId: 'shift_noche', reason: 'SIN_TIEMPO' }],
};
const modes = [['azul-corp', 'light'], ['amarillo-cat', 'light'], ['amarillo-cat', 'dark'], ['amarillo-cat', 'sun'], ['amarillo-cat', 'contrast']];
async function render(page, baseline = false, overrides = {}) {
  await page.clock.install({ time: new Date('2026-10-10T15:00:00') });
  await bootDashboard(page, { ...fixture, ...overrides, ...(baseline ? { source: oldSource, css: oldCSS } : {}) });
  await page.evaluate(() => window.renderDashboard());
  // Compare the same visible information, including the old collapsible footer.
  if (baseline) await page.evaluate(() => { const footer = document.querySelector('#dash-tier-3'); if (footer) footer.open = true; });
}
async function values(page) {
  return page.evaluate(() => {
    const metrics = {};
    document.querySelectorAll('.dash-hero-card, .dash-activity-card').forEach(card => {
      const label = card.querySelector('.dash-hero-label, .dash-activity-label')?.textContent.trim();
      if (label) metrics[label] = card.querySelector('.dash-hero-value, .dash-activity-value').textContent.trim();
    });
    metrics['Conflictos de validación'] ||= '0';
    return { metrics,
      locations: Array.from(document.querySelectorAll('#dash-ubic-panel tbody tr')).map(row => row.textContent.replace(/\s+/g, ' ').trim()),
      times: Array.from(document.querySelectorAll('.dash-exc-list .dash-exc-row')).map(row => ({
        id: row.dataset.id,
        code: row.querySelector('.dash-exc-code').textContent.trim(),
        modelLocation: row.querySelector('.dash-exc-line2').textContent.trim(),
        last: row.querySelector('time') ? fmtDate(row.querySelector('time').getAttribute('datetime')) : row.querySelector('.dash-exc-line3').textContent.replace(/^Último(?: engrase)?:\s*/, '').trim(),
        days: row.querySelector('.dash-exc-days').textContent.trim(),
      })),
      compliance: Array.from(document.querySelectorAll('.dash-compliance-card')).map(card => card.textContent.replace(/\s+/g, ' ').trim()),
      attention: Array.from(document.querySelectorAll('.dash-cola-row')).map(row => row.textContent.replace(/\s+/g, ' ').trim()),
    };
  });
}
test('all operational values and filter scopes match the release before redesign', async ({ page, context }) => {
  const before = await context.newPage();
  await render(before, true);
  await render(page);
  expect(await values(page)).toEqual(await values(before));
  for (const [selector, option] of [['#att-turno', 'shift_dia'], ['#att-dia', 'Sábado'], ['#dash-ubic', 'l1'], ['#dash-familia', 't1']]) {
    await before.locator(selector).selectOption(option);
    await page.locator(selector).selectOption(option);
    expect(await values(page)).toEqual(await values(before));
  }
  await before.close();
});

test('dashboard counts effective excavator DAY and NIGHT as two daily compliance opportunities', async ({ page }) => {
  const today = '2026-10-10';
  const plans = fixture.plans.map(plan => plan.equipmentId === 'e1'
    ? { ...plan, controlType: 'Horas de operación', requiredShifts: ['shift_dia', 'shift_noche'], effectiveDate: today }
    : plan);
  const records = [{ id: 'dual-day', equipmentId: 'e1', planId: 'p-e1', date: `${today}T11:00:00`, shiftId: 'shift_dia', qty: 2,
    details: [], operationalSnapshot: { operationalDate: today, occurrenceKey: `p-e1:${today}:shift_dia`, executionCompleteness: 'COMPLETE' } }];
  await render(page, false, { equipos: [fixture.equipos[0]], plans: plans.filter(plan => plan.equipmentId === 'e1'), records });
  const todayCard = page.locator('.dash-compliance-card').filter({ hasText: 'Hoy' });
  await expect(todayCard).toContainText('50%');
  await expect(todayCard).toContainText('1 de 2 programados');
  const dayCard = page.locator('.dash-compliance-card').filter({ hasText: 'Turno Día' });
  await expect(dayCard).toContainText('1 de 1 programados');
});

test('responsive order, touch targets, themes and reduced desktop scroll', async ({ page, context }, testInfo) => {
  await render(page);
  const width = page.viewportSize().width;
  for (const [theme, mode] of modes) {
    await page.evaluate(([theme, mode]) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.mode = mode; }, [theme, mode]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const bounds = await page.locator('.dash-admin-dashboard button').evaluateAll(buttons => buttons.filter(b => b.getBoundingClientRect().width > 0).map(b => ({ label: b.textContent.trim(), height: b.getBoundingClientRect().height })));
    expect(bounds.filter(b => b.height < 44), `${theme}/${mode}: small controls`).toEqual([]);
    const clipped = await page.locator('.dash-admin-dashboard .dash-cola-row, .dash-admin-dashboard .dash-hero-card, .dash-admin-dashboard .dash-activity-card').evaluateAll(cards => cards.flatMap(card => {
      const rect = card.getBoundingClientRect();
      return Array.from(card.children).filter(child => {
        const bounds = child.getBoundingClientRect();
        return bounds.left < rect.left - 1 || bounds.right > rect.right + 1;
      }).map(child => child.textContent.trim());
    }));
    expect(clipped, `${theme}/${mode}: content outside cards`).toEqual([]);
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'amarillo-cat'; document.documentElement.dataset.mode = 'light'; });
  const positions = await page.locator('#dash-attention-panel, #dash-ubic-panel').evaluateAll(panels => panels.map(p => ({ x: p.getBoundingClientRect().x, y: p.getBoundingClientRect().y })));
  if (width >= 1200) expect(Math.abs(positions[0].y - positions[1].y)).toBeLessThan(2);
  else expect(positions[1].y).toBeGreaterThan(positions[0].y);
  const before = await context.newPage();
  await render(before, true);
  const heights = { before: await before.locator('.layout-wide').evaluate(e => e.getBoundingClientRect().height), after: await page.locator('.layout-wide').evaluate(e => e.getBoundingClientRect().height) };
  console.log(`SCROLL ${testInfo.project.name}: ${JSON.stringify(heights)}`);
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
  if (width >= 1200) expect(heights.after).toBeLessThan(heights.before);
  await before.close();
});
test('empty previous shift stays compact; conflict indicator opens the existing flow', async ({ page }) => {
  await render(page, false, { skips: [] });
  await expect(page.locator('#dash-pendientes-anterior-panel')).toContainText('Ninguno');
  expect((await page.locator('#dash-pendientes-anterior-panel').boundingBox()).height).toBeLessThan(80);
  await page.locator('[data-kpi-action="conflictos-validacion"]').click();
  await expect(page.locator('.modal')).toContainText('TEST-3');
});

test('operational cards and tables retain accessible actions and data structure', async ({ page }) => {
  await render(page);
  const cards = page.locator('#dash-requires-attention .dash-activity-card');
  await expect(cards).toHaveCount(3);
  expect(await cards.evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().height))).toEqual(expect.arrayContaining([expect.any(Number)]));
  const heights = await cards.evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().height));
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
  await expect(cards.locator('a')).toHaveCount(0);
  const action = cards.first();
  await action.hover();
  expect(await action.evaluate(n => getComputedStyle(n).textDecorationLine)).toBe('none');
  await action.focus();
  expect(await action.evaluate(n => getComputedStyle(n).outlineStyle)).not.toBe('none');
  await action.press('Enter');
  await expect(page.locator('.modal')).toContainText('TEST-3');
  await page.evaluate(() => window.closeModal());
  await action.focus();
  await action.press('Space');
  await expect(page.locator('.modal')).toContainText('TEST-3');
  await page.evaluate(() => window.closeModal());
  await expect(page.locator('#dash-ubic-panel th[scope="col"]')).toHaveCount(5);
  const rows = page.locator('#dash-tiempo-sin-engrase-panel .dash-exc-row');
  await expect(rows).toHaveCount(5);
  // Observe the unchanged navigation handler, without navigating outside the fixture.
  await page.evaluate(() => { window.__navigation = []; window.navigate = route => window.__navigation.push(route); });
  await rows.first().locator('.dash-exc-hist-btn').click();
  expect(await page.evaluate(() => window.__navigation)).toContain('historial');
});

test('whole KPI surfaces use existing destinations; informative cards stay inert', async ({ page }) => {
  await render(page);
  const pending = page.locator('[data-kpi-action="pendientes-hoy"]');
  const box = await pending.boundingBox();
  await pending.click({ position: { x: box.width - 6, y: box.height - 6 } });
  await expect(page.locator('.modal')).toContainText('Pendientes hoy');
  await page.evaluate(() => window.closeModal());
  const conflict = page.locator('[data-kpi-action="conflictos-validacion"]');
  const bounds = await conflict.boundingBox();
  await conflict.click({ position: { x: bounds.width - 6, y: 6 } });
  await expect(page.locator('.modal')).toContainText('TEST-3');
  await page.evaluate(() => window.closeModal());
  const compliance = page.locator('#dash-summary .dash-hero-card').last();
  await expect(compliance).not.toHaveAttribute('data-kpi-action');
  expect(await compliance.evaluate(n => n.tagName)).toBe('DIV');
  await compliance.click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(page.locator('button button')).toHaveCount(0);
  await page.evaluate(async () => {
    const all = window.DB.allActive;
    window.DB.allActive = store => ['lubrication_records', 'grease_validations', 'anomalies'].includes(store) ? Promise.resolve([]) : all(store);
    await window.renderDashboard();
  });
  await expect(conflict.locator('.dash-activity-value')).toHaveText('0');
  await conflict.click();
  await expect(page.locator('.modal')).toContainText(/conflictos/i);
});

test('equipment row free space and keyboard open Ficha by id; inner actions fire only once', async ({ page }, testInfo) => {
  // Controlled fixture: the visible code does not define the equipment identity.
  await render(page, false, { equipos: equipos.map(e => e.id === 'e1' ? { ...e, code: '20-5530' } : e) });
  await page.evaluate(() => {
    window.__details = []; window.__routes = []; window.__startGreaseFlowCalls = [];
    window.openEquipmentDetail = id => window.__details.push(id);
    window.navigate = route => window.__routes.push(route);
  });
  const row = page.locator('.dash-cola-row[data-equipment-id="e1"]');
  for (const target of ['.dash-cola-badge', '.dash-cola-code', '.dash-cola-meta', '.dash-cola-plan']) {
    await row.locator(target).click();
  }
  const box = await row.boundingBox();
  await row.click({ position: { x: 2, y: 2 } });
  await row.focus(); await row.press('Enter'); await row.press('Space');
  const touch = testInfo.project.use.hasTouch;
  if (touch) await row.tap({ position: { x: 2, y: 2 } });
  const detailCount = touch ? 8 : 7;
  expect(await page.evaluate(() => window.__details)).toEqual(Array(detailCount).fill('e1'));
  await row.locator('.dash-cola-hist').click();
  await row.locator('.dash-cola-reg').click();
  await row.locator('.dash-cola-hist').focus(); await row.locator('.dash-cola-hist').press('Enter');
  await row.locator('.dash-cola-reg').focus(); await row.locator('.dash-cola-reg').press('Enter');
  expect(await page.evaluate(() => window.__details)).toHaveLength(detailCount);
  expect(await page.evaluate(() => window.__routes)).toEqual(['historial', 'historial']);
  expect(await page.evaluate(() => window.__startGreaseFlowCalls)).toEqual(['e1', 'e1']);
  expect(await page.evaluate(() => window.App.dashJumpEquipoId)).toBe('e1');
  await expect(page.locator('button button')).toHaveCount(0);
});

test('operational tables remain readable with long equipment and location names', async ({ page }) => {
  await render(page, false, {
    locations: [{ id: 'l1', name: 'Ubicación operativa extendida A' }, { id: 'l2', name: 'Ubicación operativa extendida B' }],
    equipos: equipos.map(e => ({ ...e, brand: 'Marca ficticia', model: 'Modelo operativo extendido de fixture' })),
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#dash-ubic-panel thead th')).toHaveText(['Ubicación', 'Equipos', 'Al día', 'Próximos', 'Vencidos']);
  const issues = await page.locator('#dash-ubic-panel table, #dash-tiempo-sin-engrase-panel .dash-exc-row').evaluateAll(nodes => nodes.flatMap(node => {
    const bounds = node.getBoundingClientRect();
    return Array.from(node.querySelectorAll('td, th, .dash-exc-line2, .dash-exc-line3, .dash-exc-hist-btn')).filter(child => {
      const header = child.closest('thead');
      if (header && getComputedStyle(header).position === 'absolute') return false; // Screen-reader headers in compact mobile representation.
      const r = child.getBoundingClientRect();
      return r.left < bounds.left - 1 || r.right > bounds.right + 1 || child.scrollWidth > child.clientWidth + 1;
    }).map(child => child.textContent.trim());
  }));
  expect(issues).toEqual([]);
  if (page.viewportSize().width <= 600) {
    const labels = await page.locator('.operational-responsive-table td[data-label]').evaluateAll(cells => cells.map(cell => ({
      wrapping: getComputedStyle(cell, '::before').whiteSpace,
      rightMargin: getComputedStyle(cell, '::before').marginRight,
    })));
    expect(labels.every(label => label.wrapping === 'nowrap' && label.rightMargin === '0px')).toBe(true);
  }
  expect(await page.locator('.dash-exc-line3').first().evaluate(n => parseFloat(getComputedStyle(n).fontSize))).toBeGreaterThanOrEqual(14);
});

test('Top 5 and Ver todos keep their order and independent Historial action', async ({ page }) => {
  await render(page);
  const visible = await page.locator('#dash-tiempo-sin-engrase-panel .dash-exc-row').evaluateAll(nodes => nodes.map(n => n.dataset.id));
  expect(visible).toHaveLength(5);
  await page.locator('#dash-tiempo-ver-todos').click();
  const all = await page.locator('.modal .dash-exc-row').evaluateAll(nodes => nodes.map(n => n.dataset.id));
  expect(all.slice(0, 5)).toEqual(visible);
  expect(all.length).toBeGreaterThan(5);
  await page.evaluate(() => { window.__details = []; window.__routes = []; window.openEquipmentDetail = id => window.__details.push(id); window.navigate = route => window.__routes.push(route); });
  await page.locator('.modal .dash-exc-hist-btn').first().click();
  expect(await page.evaluate(() => window.__details)).toEqual([]);
  expect(await page.evaluate(() => window.__routes)).toEqual(['historial']);
});
