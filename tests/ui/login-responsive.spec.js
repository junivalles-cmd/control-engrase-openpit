// tests/ui/login-responsive.spec.js
//
// Auditoría UI/Responsive Fase 1 — SOLO pantalla de login (pública, sin
// autenticación, sin datos de negocio). Ver docs/UI_RESPONSIVE.md para por
// qué el resto de pantallas (requieren PIN real de producción) queda
// marcado "REQUIERE VALIDACIÓN MANUAL" en vez de automatizarse aquí — no
// hay credenciales de prueba seguras en este entorno, y Playwright no debe
// escribir ni leer datos reales de negocio.
//
// Se ejecuta una vez por cada resolución configurada en playwright.config.js
// (7 proyectos). Detecta heurísticas automáticas (scroll horizontal global,
// controles táctiles pequeños, solapamiento) — NO se usan como verdad
// absoluta: cada hallazgo se revisa visualmente antes de registrarse como
// bug real (ver docs/UI_RESPONSIVE.md).

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SCREENSHOT_DIR = path.resolve('tests/ui/screenshots-audit');

test.beforeAll(() => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

test('pantalla de login: sin scroll horizontal, controles táctiles válidos, sin solapamiento', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.waitForSelector('.login-screen', { timeout: 15000 });

  // Criterio 1: scroll horizontal global no deseado.
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `scrollWidth (${scrollWidth}) > clientWidth (${clientWidth}) en ${testInfo.project.name} — scroll horizontal no deseado`
  ).toBeLessThanOrEqual(clientWidth);

  // Criterio 2: elementos interactivos visibles fuera del viewport.
  const outOfViewport = await page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    return Array.from(document.querySelectorAll('button, a, input, select'))
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ sel: el.className || el.tagName, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh))
      .map(({ sel }) => sel);
  });
  testInfo.attach('out-of-viewport.json', { body: JSON.stringify(outOfViewport, null, 2), contentType: 'application/json' });
  if (outOfViewport.length) console.log(`[${testInfo.project.name}] fuera de viewport:`, outOfViewport);

  // Criterio 3: controles táctiles interactivos por debajo de ~44x44 (objetivo para uso con guantes).
  const smallTargets = await page.evaluate(() => {
    const MIN = 44;
    return Array.from(document.querySelectorAll('button, a, input, select'))
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { sel: el.className || el.tagName, w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter((x) => x.w > 0 && x.h > 0 && (x.w < MIN || x.h < MIN));
  });
  testInfo.attach('small-touch-targets.json', { body: JSON.stringify(smallTargets, null, 2), contentType: 'application/json' });
  if (smallTargets.length) console.log(`[${testInfo.project.name}] controles < 44px:`, smallTargets);

  // Criterio 4: elementos interactivos que se solapan más del 50% del área del más chico.
  const overlaps = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('button, a, input, select'))
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ sel: el.className || el.tagName, r: el.getBoundingClientRect() }));
    const found = [];
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i].r, b = els[j].r;
        const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        const overlapArea = ix * iy;
        const minArea = Math.min(a.width * a.height, b.width * b.height);
        if (minArea > 0 && overlapArea / minArea > 0.5) {
          found.push({ a: els[i].sel, b: els[j].sel });
        }
      }
    }
    return found;
  });
  testInfo.attach('overlaps.json', { body: JSON.stringify(overlaps, null, 2), contentType: 'application/json' });
  expect(overlaps, `elementos interactivos solapados en ${testInfo.project.name}: ${JSON.stringify(overlaps)}`).toEqual([]);

  // Captura de auditoría — fuera de dist/, NO versionada (tests/ui/screenshots-audit/ está en .gitignore),
  // porque tras unos segundos Sync.startAuto() puede poblar #login-users con nombres reales de usuarios.
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${testInfo.project.name}-login.png`), fullPage: true });
});
