// tests/ui/lubricador-mi-turno.spec.js
//
// UI/Responsive Fase 3 (docs/UI_RESPONSIVE.md) — "Mi Turno" del Lubricador.
// No requiere login: usa un fragmento estático con la estructura/clases REALES
// de bootLubricador()/renderLubricadorHome() (app.js) — datos de relleno,
// nunca equipos/horómetros de producción.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

const FIXTURE = `
  <div class="lub-shell">
    <header class="lub-topbar">
      <div class="brand brand-sidebar"><div class="brand-mark small"></div>
        <div><div class="brand-title small">ENGRASE</div><div class="brand-sub small">OPEN PIT</div></div></div>
      <div class="lub-topbar-right"><button class="conn-badge">EN LÍNEA</button></div>
    </header>
    <div class="lub-user-strip">Usuario de prueba · Turno Día</div>
    <main id="app-content" class="lub-content">
      <div class="lub-header-row">
        <div><h2 class="lub-heading">Equipos del turno Día</h2><p class="lub-sub">Toca un equipo para registrar el engrase.</p></div>
        <button class="btn btn-accent lub-scan-btn">Escanear QR</button>
      </div>
      <div class="lub-eq-list">
        <button class="lub-eq-btn" data-status="ROJO">
          <div class="lub-eq-top">
            <span class="lub-eq-icon icon-hauler" aria-hidden="true"></span>
            <span class="lub-eq-code">EQ-0001</span>
            <span class="status-chip" style="--c:red">VENCIDO</span>
          </div>
          <div class="lub-eq-model">Marca Modelo</div>
          <div class="lub-eq-location">Ubicación</div>
          <div class="lub-eq-bottom"><span class="mono">1234 h</span><span class="mono">+50 h atraso</span></div>
        </button>
      </div>
      <button class="lub-anomaly-fab">Reportar anomalía</button>
    </main>
    <nav class="lub-bottom-nav">
      <button class="lub-nav-item active"><span>Mi Turno</span></button>
      <button class="lub-nav-item"><span>Anomalías</span></button>
    </nav>
  </div>
`;

test('Mi Turno: sin scroll horizontal, ícono de equipo visible, margen reducido consistente', async ({ page }, testInfo) => {
  await page.setContent(FIXTURE);
  await page.addStyleTag({ path: STYLES_PATH });

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `scroll horizontal no deseado en ${testInfo.project.name}`).toBeLessThanOrEqual(clientWidth);

  const iconVisible = await page.evaluate(() => {
    const el = document.querySelector('.lub-eq-icon');
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  expect(iconVisible, 'el ícono de equipo (icon-hauler) debe estar visible en la tarjeta').toBe(true);

  // UI-RESP: el inset acumulado (padding del contenedor + padding de la tarjeta)
  // debe ser MENOR al valor medido antes de esta fase (36px por lado), sin llegar
  // a 0 (no queremos las tarjetas pegadas al borde). Medido relativo al propio
  // .lub-content (no al borde crudo del viewport): en ≥640px .lub-content se
  // centra con max-width, así que el borde del viewport ya no sirve de referencia.
  // Se mide hasta .lub-eq-icon (el primer elemento dentro de la tarjeta) — no
  // hasta .lub-eq-code, que ahora queda después del ícono nuevo a propósito.
  const leftInset = await page.evaluate(() => {
    const content = document.querySelector('.lub-content').getBoundingClientRect();
    const icon = document.querySelector('.lub-eq-icon').getBoundingClientRect();
    return icon.left - content.left;
  });
  expect(leftInset, 'inset izquierdo debe ser menor que el valor previo (36px)').toBeLessThan(36);
  expect(leftInset, 'inset izquierdo no debe ser 0 (tarjetas no deben pegarse al borde)').toBeGreaterThan(15);
});
