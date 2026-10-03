// tests/ui/dashboard-priority-tiers.spec.js
//
// Rediseño aprobado del Dashboard (prioridades visuales + grids reales).
// Complementa dashboard-operativo.spec.js (que ya cubre orden/composición)
// con lo que ese archivo no prueba:
//   - .dash-hero-grid ya no se queda fijo en "5+1": a 1440px+ muestra las 6
//     tarjetas en una sola fila real; en 1024-1439 se adapta de forma
//     natural (auto-fit) en vez de forzar 5 columnas fijas.
//   - Prioridad 3 (<details id="dash-tier-3">) es nativamente colapsable:
//     sin el atributo "open" el contenido no ocupa espacio/no es visible;
//     con "open" sí. (El criterio de qué estado usar según el ancho —
//     desktop abierto / mobile cerrado — es JS real, probado por fuente en
//     tests/unit/dashboard-priority-tiers.test.js; aquí solo se prueba que
//     el CSS no "pelea" contra el <details> nativo en ningún estado.)

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

function heroGridFixture() {
  return `
    <div class="layout-wide">
      <div class="dash-hero-grid">
        ${Array.from({ length: 6 }, (_, i) => `<div class="dash-hero-card"><div class="dash-hero-value">${i}</div><div class="dash-hero-label">KPI ${i}</div></div>`).join('')}
      </div>
    </div>`;
}

function tier3Fixture(open) {
  return `
    <details class="dash-tier dash-tier-3" id="dash-tier-3"${open ? ' open' : ''}>
      <summary class="dash-tier-label dash-tier-summary">Cumplimiento y más</summary>
      <div class="panel"><div class="panel-head"><h3>Cumplimiento operativo</h3></div><div id="tier3-content">contenido</div></div>
    </details>`;
}

const HERO_WIDTHS = [
  { width: 390, label: '2 columnas (mobile)', expectCols: 2 },
  { width: 412, label: '2 columnas (mobile)', expectCols: 2 },
  { width: 768, label: '3 columnas (tablet)', expectCols: 3 },
  { width: 1440, label: '6 columnas reales (desktop ancho)', expectCols: 6 },
  { width: 1920, label: '6 columnas reales (desktop ancho)', expectCols: 6 },
];

for (const { width, label, expectCols } of HERO_WIDTHS) {
  test(`.dash-hero-grid @ ${width}px — ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(heroGridFixture());
    await page.addStyleTag({ path: STYLES_PATH });

    const cols = await page.locator('.dash-hero-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);
    expect(cols).toBe(expectCols);
  });
}

test('.dash-hero-grid @ 1024px — ya no fuerza "5+1": se adapta de forma natural (auto-fit), nunca menos de 3 columnas', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.setContent(heroGridFixture());
  await page.addStyleTag({ path: STYLES_PATH });

  const cols = await page.locator('.dash-hero-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);
  expect(cols).toBeGreaterThanOrEqual(3);

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test('Prioridad 3 (<details>) SIN "open" — el contenido no es visible ni ocupa espacio (colapso nativo real, no solo visual)', async ({ page }) => {
  await page.setContent(tier3Fixture(false));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('#tier3-content')).toBeHidden();
  const summaryBox = await page.locator('.dash-tier-summary').boundingBox();
  const detailsBox = await page.locator('#dash-tier-3').boundingBox();
  // Sin "open", el <details> mide aproximadamente lo mismo que su <summary>
  // (el contenido no agrega altura) — colapso nativo real.
  expect(detailsBox.height).toBeLessThanOrEqual(summaryBox.height + 12);
});

test('Prioridad 3 (<details>) CON "open" — el contenido de Cumplimiento operativo es visible', async ({ page }) => {
  await page.setContent(tier3Fixture(true));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('#tier3-content')).toBeVisible();
  await expect(page.locator('.panel-head h3')).toHaveText('Cumplimiento operativo');
});

test('Prioridad 3 — el summary es accesible por teclado (min 44px de alto) y sin viñeta nativa de lista', async ({ page }) => {
  await page.setContent(tier3Fixture(false));
  await page.addStyleTag({ path: STYLES_PATH });

  const box = await page.locator('.dash-tier-summary').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  const listStyle = await page.locator('.dash-tier-summary').evaluate(el => getComputedStyle(el).listStyle);
  expect(listStyle).toContain('none');
});

test('Prioridad 3 — clic en el summary expande el contenido (toggle nativo real, sin JS adicional)', async ({ page }) => {
  await page.setContent(tier3Fixture(false));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('#tier3-content')).toBeHidden();
  await page.locator('.dash-tier-summary').click();
  await expect(page.locator('#tier3-content')).toBeVisible();
});
