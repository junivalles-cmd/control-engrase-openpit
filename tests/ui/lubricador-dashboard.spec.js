// tests/ui/lubricador-dashboard.spec.js
//
// "Mi Turno" del Lubricador (renderLubricadorHome(), ruta 'turno') —
// fragmento estático con la MISMA estructura/clases REALES que genera la
// función (lub-turno-header/lub-accordion*/lub-arrastrado-card/lub-eq-btn/
// lub-quick-actions) — sin login/DB real, mismo método que el resto de
// specs del proyecto.
//
// UX CAMPO V2 (2026-10-24): reemplaza la fila de 4 .lub-kpi-card por 3
// acordeones reales (Pendientes anteriores/Atención prioritaria/Engrases
// de mi turno), cada uno SIEMPRE presente (incluso en 0, con su propio
// estado vacío) — "Realizados" y "Requieren seguimiento" (antes
// "Alertas") siguen ocultándose por completo cuando están vacíos, sin
// cambios de esa propiedad.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

function accordion({ key, title, subtitle, count, cardsHTML, emptyText, expanded = true }) {
  return `
  <section class="lub-accordion" data-accordion="${key}">
    <button type="button" class="lub-accordion-head" id="lub-acc-${key}-btn" aria-expanded="${expanded}" aria-controls="lub-acc-${key}-panel" aria-label="${title}, ${count} trabajo${count === 1 ? '' : 's'}">
      <span class="lub-accordion-titles">
        <span class="lub-accordion-title">${title}</span>
        <span class="lub-accordion-subtitle">${subtitle}</span>
      </span>
      <span class="lub-accordion-count" data-tone="${count ? 'active' : 'empty'}">${count}</span>
      <span class="lub-accordion-chevron" aria-hidden="true">⌄</span>
    </button>
    <div class="lub-accordion-panel" id="lub-acc-${key}-panel" role="region" ${expanded ? '' : 'hidden'}>
      ${count ? `<div class="lub-eq-list">${cardsHTML}</div>` : `<p class="field-hint lub-accordion-empty">${emptyText}</p>`}
    </div>
  </section>`;
}

function fixture({ withArrastrados = true, withMiTurno = true, withRealizados = true, withAlertas = true, asignadoEnMiTurno = true } = {}) {
  const arrastradoCard = `
    <div class="lub-arrastrado-card lub-pending-card tone-amber">
      <span class="lub-arrastrado-origen tone-amber">Turno anterior</span>
      <div class="lub-eq-top"><span class="lub-eq-code">T-06</span></div>
      <div class="lub-eq-model">Caterpillar D8T</div>
      <div class="lub-eq-location">📍 Rajo Principal</div>
      <div class="lub-arrastrado-motivo">Motivo: No hubo tiempo</div>
      <div class="lub-arrastrado-actions"><button class="btn btn-accent">Registrar engrase</button><button class="btn">Ver ficha</button></div>
    </div>`;
  const miTurnoCard = `
    <div class="lub-eq-btn" data-status="AMARILLO">
      <div class="lub-eq-top">
        <span class="lub-eq-code">T-09</span>
        <span class="status-chip" style="--c:var(--amber)">PRÓXIMO</span>
        ${asignadoEnMiTurno ? '<span class="status-chip chip-origen" style="--c:var(--amber)">ASIGNADO</span>' : ''}
      </div>
      <div class="lub-eq-model">Komatsu WA470</div>
      <div class="lub-eq-location">📍 Rajo Principal</div>
      <div class="lub-eq-bottom"><span class="mono">900 h</span></div>
      <div class="lub-arrastrado-actions"><button class="btn btn-accent">Registrar engrase</button><button class="btn">Ver ficha</button></div>
    </div>`;

  return `
  <div class="lub-shell">
    <main class="lub-content">
      <div class="lub-turno-header">
        <div class="lub-turno-header-top">
          <div class="lub-turno-header-identity">
            <span class="lub-turno-header-crew">👥 Cuadrilla A</span>
            <span class="lub-turno-header-detail">
              <span class="lub-context-chip lub-coverage-chip" title="Rajo Principal" aria-label="Cobertura: Rajo Principal">📍 Rajo Principal</span>
              ☀ Turno Día
            </span>
          </div>
        </div>
        <div class="lub-turno-header-summary">${withArrastrados ? 1 : 0} pendiente · 0 prioridad · ${withMiTurno ? 1 : 0} turno</div>
      </div>

      <div class="lub-accordions" id="lub-accordions">
        ${accordion({ key: 'pendientes-anteriores', title: 'Pendientes anteriores', subtitle: 'Trabajo de turnos anteriores sin completar', count: withArrastrados ? 1 : 0, cardsHTML: arrastradoCard, emptyText: 'No hay pendientes de turnos anteriores.' })}
        ${accordion({ key: 'atencion-prioritaria', title: 'Atención prioritaria', subtitle: 'Equipos que requieren atención primero', count: 0, cardsHTML: '', emptyText: 'No hay equipos que requieran atención prioritaria.' })}
        ${accordion({ key: 'mi-turno', title: 'Engrases de mi turno', subtitle: 'Trabajo programado para este turno', count: withMiTurno ? 1 : 0, cardsHTML: miTurnoCard, emptyText: 'No hay engrases programados para este turno.' })}
      </div>

      ${withAlertas ? `
      <section id="lub-pending-follow-up" aria-label="Seguimiento sugerido">
        <section id="lub-follow-up">
          <h3 class="lub-section-head">REQUIEREN SEGUIMIENTO · 1</h3>
          <div class="lub-eq-list" id="alertas-list">
            <div class="lub-arrastrado-card tone-amber">
              <div class="lub-eq-top"><button type="button" class="lub-eq-code dash-code-link">T-11</button><span class="dim">12 días sin engrasar</span></div>
              <div class="lub-eq-model">Volvo A40</div>
            </div>
          </div>
        </section>
      </section>` : `<section id="lub-pending-follow-up"><p class="field-hint">✓ Sin pendientes ni equipos que requieran seguimiento.</p></section>`}

      ${withRealizados ? `
      <div class="lub-section-head" id="realizados-head"><span class="status-chip" style="--c:var(--green)">REALIZADOS (<span class="lub-realizados-count">1</span>)</span></div>
      <div class="lub-eq-list" id="realizados-list">
        <div class="lub-arrastrado-card tone-green">
          <div class="lub-eq-top"><span class="lub-eq-code">T-02</span><span class="dim">08:15</span></div>
          <div class="lub-eq-model">Caterpillar 740B</div>
          <div class="lub-record-meta dim"><span>2.5 lb</span><span>Juan Pérez</span></div>
          <div class="lub-record-validacion"><span class="status-chip">Validado</span></div>
          <div class="lub-arrastrado-actions"><button class="btn">Ver ficha</button></div>
        </div>
      </div>` : ''}

      <button class="lub-hero-action" id="qa-registrar">
        <span class="lub-hero-action-text">
          <span class="lub-hero-action-title">Registrar fuera de plan</span>
          <span class="lub-hero-action-sub">Engrasar otro equipo</span>
        </span>
        <span class="lub-hero-action-arrow">→</span>
      </button>

      <div class="lub-section-head"><span class="dim">Accesos rápidos</span></div>
      <div class="lub-quick-actions">
        <button class="btn lub-quick-action" id="qa-qr">Escanear QR</button>
        <button class="btn lub-quick-action" id="qa-buscar">Buscar equipo</button>
        <button class="btn lub-quick-action" id="qa-matriz">Matriz semanal</button>
        <button class="btn lub-quick-action" id="qa-anomalia">Reportar anomalía</button>
      </div>
    </main>
  </div>`;
}

// Auditoría de campo: cubre las cinco anchuras operativas solicitadas, con el
// fixture REAL completo (header + 3 acordeones + Realizados/Requieren
// seguimiento + acción principal + Accesos rápidos), no solo el topbar
// vacío (eso ya lo cubre lubricador-mobile-ux.spec.js aparte).
for (const width of [360, 390, 412, 600, 768]) {
  test(`Mi Turno @ ${width}px — sin scroll horizontal`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 });
    await page.setContent(fixture());
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
    await page.addStyleTag({ path: STYLES_PATH });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test(`Mi Turno @ ${width}px — los 3 acordeones ocupan el ancho completo, apilados, sin scroll adicional`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 });
    await page.setContent(fixture());
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
    await page.addStyleTag({ path: STYLES_PATH });

    const heads = page.locator('.lub-accordion-head');
    await expect(heads).toHaveCount(3);
    const lefts = await heads.evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(lefts).size).toBe(1); // misma columna, apilados verticalmente
    const tops = await heads.evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
    expect(tops[0]).toBeLessThan(tops[1]); expect(tops[1]).toBeLessThan(tops[2]);
  });

  test(`Mi Turno @ ${width}px — acordeones, acciones rápidas y acciones de tarjetas cumplen touch target >=48px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 });
    await page.setContent(fixture());
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
    await page.addStyleTag({ path: STYLES_PATH });

    const heads = page.locator('.lub-accordion-head');
    const h = await heads.count();
    for (let i = 0; i < h; i++) {
      const box = await heads.nth(i).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(48);
    }
    const quickActions = page.locator('.lub-quick-action');
    const n = await quickActions.count();
    for (let i = 0; i < n; i++) {
      const box = await quickActions.nth(i).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(48);
    }
    const hero = await page.locator('.lub-hero-action').boundingBox();
    expect(hero.height).toBeGreaterThanOrEqual(48);
    // .lub-arrastrado-actions se reusa tal cual en Pendientes anteriores,
    // Mi Turno y Realizados (hardening UI 2026-10-08) — este selector ya
    // cubre los 3.
    const arrBtns = page.locator('.lub-arrastrado-actions .btn');
    const m = await arrBtns.count();
    expect(m).toBeGreaterThan(0);
    for (let i = 0; i < m; i++) {
      const box = await arrBtns.nth(i).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(48);
    }
  });
}

test('los 3 acordeones siempre muestran su encabezado y contador, incluso en 0 (nunca desaparecen, a diferencia de Realizados/Requieren seguimiento)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture({ withArrastrados: false, withMiTurno: false, withRealizados: false, withAlertas: false }));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('.lub-accordion-head')).toHaveCount(3);
  const values = await page.locator('.lub-accordion-count').allTextContents();
  expect(values).toEqual(['0', '0', '0']);
  await expect(page.locator('#lub-acc-pendientes-anteriores-panel')).toContainText('No hay pendientes de turnos anteriores.');
  await expect(page.locator('#lub-acc-mi-turno-panel')).toContainText('No hay engrases programados para este turno.');
});

test('"Pendientes anteriores" muestra su estado vacío (nunca una tarjeta en 0) cuando no hay registros', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture({ withArrastrados: false }));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('#lub-acc-pendientes-anteriores-panel .lub-pending-card')).toHaveCount(0);
  await expect(page.locator('#lub-acc-pendientes-anteriores-panel')).toContainText('No hay pendientes de turnos anteriores.');
});

test('"Mi Turno" muestra su estado vacío (nunca una tarjeta en 0) cuando no hay trabajo del turno actual', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture({ withMiTurno: false }));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('#lub-acc-mi-turno-panel .lub-eq-btn')).toHaveCount(0);
  await expect(page.locator('#lub-acc-mi-turno-panel')).toContainText('No hay engrases programados para este turno.');
});

test('"Realizados" se oculta por completo cuando no hay engrases completados hoy', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture({ withRealizados: false }));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('#realizados-head')).toHaveCount(0);
  await expect(page.locator('#realizados-list')).toHaveCount(0);
});

test('"Requieren seguimiento" (antes "Alertas") se oculta por completo cuando no hay equipos para mostrar', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture({ withAlertas: false }));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('#alertas-list')).toHaveCount(0);
});

test('orden de pantalla: Pendientes anteriores > Atención prioritaria > Mi Turno > Realizados > Requieren seguimiento', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 1200 });
  await page.setContent(fixture());
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

  const pendientesBox = await page.locator('#lub-acc-pendientes-anteriores-btn').boundingBox();
  const atencionBox = await page.locator('#lub-acc-atencion-prioritaria-btn').boundingBox();
  const miTurnoBox = await page.locator('#lub-acc-mi-turno-btn').boundingBox();
  const realizadosBox = await page.locator('#realizados-head').boundingBox();
  const alertasBox = await page.locator('#lub-pending-follow-up').boundingBox();
  expect(atencionBox.y).toBeGreaterThan(pendientesBox.y);
  expect(miTurnoBox.y).toBeGreaterThan(atencionBox.y);
  expect(realizadosBox.y).toBeGreaterThan(miTurnoBox.y);
  expect(alertasBox.y).toBeGreaterThan(miTurnoBox.y);
});

test('cada tarjeta de "Pendientes anteriores" muestra código, modelo, ubicación, origen y acciones Registrar/Ver ficha', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture());
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

  const card = page.locator('#lub-acc-pendientes-anteriores-panel .lub-arrastrado-card').first();
  await expect(card.locator('.lub-arrastrado-origen')).toHaveText('Turno anterior');
  await expect(card.locator('.lub-eq-code')).toHaveText('T-06');
  await expect(card.locator('.lub-eq-model')).toContainText('Caterpillar D8T');
  await expect(card.locator('.lub-eq-location')).toContainText('Rajo Principal');
  await expect(card.locator('button', { hasText: 'Registrar engrase' })).toBeVisible();
  await expect(card.locator('button', { hasText: 'Ver ficha' })).toBeVisible();
});

test('una tarjeta de Mi Turno asignada muestra el badge ASIGNADO junto al estado', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture({ asignadoEnMiTurno: true }));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

  const card = page.locator('#lub-acc-mi-turno-panel .lub-eq-btn').first();
  const chips = await card.locator('.lub-eq-top .status-chip').allTextContents();
  expect(chips).toContain('ASIGNADO');
});

test('una tarjeta de Mi Turno sin asignación NO muestra el badge ASIGNADO', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture({ asignadoEnMiTurno: false }));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

  const card = page.locator('#lub-acc-mi-turno-panel .lub-eq-btn').first();
  const chips = await card.locator('.lub-eq-top .status-chip').allTextContents();
  expect(chips).not.toContain('ASIGNADO');
});

test('§12: el badge ASIGNADO (origen) se ve visualmente distinto del status-chip de ESTADO (sin confundirse, aunque comparten color)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture({ asignadoEnMiTurno: true }));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

  const estadoChip = page.locator('#lub-acc-mi-turno-panel .lub-eq-top .status-chip', { hasText: 'PRÓXIMO' });
  const asignadoChip = page.locator('#lub-acc-mi-turno-panel .lub-eq-top .status-chip', { hasText: 'ASIGNADO' });
  const estadoBg = await estadoChip.evaluate(el => getComputedStyle(el).backgroundColor);
  const asignadoBg = await asignadoChip.evaluate(el => getComputedStyle(el).backgroundColor);
  // ESTADO sigue macizo (mismo --c con 18% de opacidad); ASIGNADO pasa a
  // transparente con contorno — nunca el mismo fondo, aunque el --c sea el
  // mismo ámbar en los dos.
  expect(asignadoBg).not.toBe(estadoBg);
  expect(await asignadoChip.evaluate(el => getComputedStyle(el).borderStyle)).toBe('solid');
});

test('cada tarjeta de Realizados muestra código, hora, lb, quién lo realizó, estado de validación y Ver ficha', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture());
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

  const card = page.locator('#realizados-list .lub-arrastrado-card').first();
  await expect(card.locator('.lub-eq-code')).toHaveText('T-02');
  await expect(card).toContainText('08:15');
  await expect(card.locator('.lub-record-meta')).toContainText('2.5 lb');
  await expect(card.locator('.lub-record-meta')).toContainText('Juan Pérez');
  await expect(card.locator('.lub-record-validacion')).toBeVisible();
  await expect(card.locator('button', { hasText: 'Ver ficha' })).toBeVisible();
});

test('cada tarjeta de "Requieren seguimiento" muestra el código de equipo (abre la Ficha) y los días sin engrasar', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture());
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

  const card = page.locator('#alertas-list .lub-arrastrado-card').first();
  await expect(card.locator('.lub-eq-code')).toHaveText('T-11');
  await expect(card).toContainText('días sin engrasar');
});

test('header compacto muestra cuadrilla + ubicación (chip con title/aria-label) + turno, y el resumen de 3 números', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture());
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('.lub-turno-header-crew')).toContainText('Cuadrilla A');
  await expect(page.locator('.lub-turno-header-detail')).toContainText('Turno Día');
  await expect(page.locator('.lub-coverage-chip')).toHaveAttribute('title', 'Rajo Principal');
  await expect(page.locator('.lub-turno-header-summary')).toContainText('1 pendiente');
  await expect(page.locator('.lub-turno-header-summary')).toContainText('0 prioridad');
  await expect(page.locator('.lub-turno-header-summary')).toContainText('1 turno');
});

test('"Registrar fuera de plan" es la acción principal dominante (tarjeta grande separada), y Accesos rápidos tiene exactamente 4 botones: Escanear QR, Buscar equipo, Matriz semanal, Reportar anomalía', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture());
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('.lub-hero-action')).toContainText('Registrar fuera de plan');
  const labels = await page.locator('.lub-quick-action').allTextContents();
  expect(labels).toEqual(['Escanear QR', 'Buscar equipo', 'Matriz semanal', 'Reportar anomalía']);
});

test('los 3 acordeones tienen accesibilidad real: <button>, aria-expanded, aria-controls y aria-label con el conteo', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 1200 });
  await page.setContent(fixture());
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.addStyleTag({ path: STYLES_PATH });

  const btn = page.locator('#lub-acc-pendientes-anteriores-btn');
  expect(await btn.evaluate(el => el.tagName)).toBe('BUTTON');
  await expect(btn).toHaveAttribute('aria-controls', 'lub-acc-pendientes-anteriores-panel');
  await expect(btn).toHaveAttribute('aria-label', /Pendientes anteriores, 1 trabajo/);
});
