// tests/ui/lubricador-grease-form.spec.js
//
// UI/Responsive Fase 4, iteración 3 (docs/UI_RESPONSIVE.md) — formulario
// "Registrar engrase" (Agregar Engrase). No requiere login: fragmento estático
// con la estructura/clases REALES de startGreaseFlow() (app.js) tras el
// rediseño en cards (iteración 2) + el ajuste de ancho de página / layout
// tablet-desktop (iteración 3: contenedor propio de .grease-flow-panel,
// Horómetro y Lubricante comparten fila en escritorio, Horómetro y el
// checkbox "sin horómetro" comparten fila en todos los anchos) — datos de
// relleno, nunca registros de producción. No se verifica aquí ningún
// campo/validación/lógica — solo estructura visual y overflow.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

const FIXTURE = `
<div class="lub-shell">
  <main class="lub-content">
    <div class="grease-flow-panel">
      <div class="grease-flow-card grease-flow-equipo-card">
        <div class="grease-flow-equipo-code">EQ-0001</div>
        <div class="grease-flow-equipo-model">Marca Modelo</div>
        <div class="grease-flow-equipo-meta">Registrado por Usuario de prueba · Turno Día</div>
        <div class="grease-flow-turno-warn">⚠ Turno programado: Día · Registrando en turno Noche — quedará como "Realizado atrasado".</div>
        <div class="grease-flow-vencido-warn">⚠ Este equipo está VENCIDO — no se engrasó en el ciclo esperado.</div>
        <div class="grease-flow-carryover-warn">⚠ El turno Día no pudo ejecutar este engrase hoy — motivo: Condición insegura (Ana G.).</div>
      </div>
      <form id="grease-form" class="grease-flow-form">
        <div class="grease-flow-card">
          <h4 class="grease-flow-card-head">Horómetro</h4>
          <div class="grease-flow-hm-row">
            <label class="grease-flow-hm-field">Horómetro actual<input type="number" value="1234" class="big-input"/></label>
            <label class="grease-flow-toggle-row"><input type="checkbox"/><span>Sin horómetro / dañado</span></label>
          </div>
        </div>
        <div class="grease-flow-card">
          <h4 class="grease-flow-card-head">Lubricante utilizado</h4>
          <div class="form-grid grease-flow-lube-grid">
            <label>Tipo de grasa utilizada<select><option>Grasa</option></select></label>
            <label>Cantidad utilizada (lb)<input type="number" value="0.5"/></label>
          </div>
          <div class="retro-box">
            <h5 class="grease-flow-retro-head">Registro retroactivo</h5>
            <label class="retro-toggle"><input type="checkbox"/><span>Registrar como engrase ATRASADO (con fecha anterior)</span></label>
          </div>
        </div>
        <div class="grease-flow-card">
          <div class="grease-flow-points-head">
            <h4 class="grease-flow-card-head">Puntos de engrase</h4>
            <button type="button" class="btn btn-sm">Marcar todos</button>
          </div>
          <div id="checklist">
            <div class="checklist-item"><label class="check-row"><input type="checkbox" class="chk-done" checked/><span class="check-row-text">Punto A</span></label></div>
            <div class="checklist-item"><label class="check-row"><input type="checkbox" class="chk-done" checked/><span class="check-row-text">Punto B</span></label></div>
          </div>
        </div>
        <div class="grease-flow-card">
          <h4 class="grease-flow-card-head">Condición del equipo</h4>
          <div class="form-grid">
            <label class="span-2">Condición encontrada<select><option>Normal</option></select></label>
          </div>
        </div>
        <div class="grease-flow-card">
          <h4 class="grease-flow-card-head">Evidencia</h4>
          <div class="form-grid">
            <label class="span-2">Observaciones<textarea rows="2"></textarea></label>
          </div>
        </div>
        <div class="grease-flow-final">
          <div class="modal-actions">
            <button type="button" class="btn">No se pudo ejecutar</button>
            <button type="button" class="btn">Reportar anomalía</button>
            <button type="submit" class="btn btn-accent btn-grease-submit">Finalizar engrase</button>
          </div>
        </div>
      </form>
    </div>
  </main>
  <nav class="lub-bottom-nav">
    <button class="lub-nav-item active">Mi Turno</button>
    <button class="lub-nav-item">Anomalías</button>
    <button class="lub-nav-item">Mis Engrases</button>
    <button class="lub-nav-item">Ayuda</button>
  </nav>
</div>
`;

test('Registrar engrase: layout responsive por ancho, lb correcto, sin scroll horizontal', async ({ page }, testInfo) => {
  await page.setContent(FIXTURE);
  await page.addStyleTag({ path: STYLES_PATH });

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `scroll horizontal no deseado en ${testInfo.project.name}`).toBeLessThanOrEqual(clientWidth);

  // Equipo no lleva .grease-flow-card-head (código/marca-modelo tienen su propio
  // tratamiento tipográfico) — las 5 que sí lo llevan son las cards con encabezado.
  const cardHeads = await page.locator('.grease-flow-card-head').allTextContents();
  expect(cardHeads.map(s => s.trim())).toEqual([
    'Horómetro', 'Lubricante utilizado', 'Puntos de engrase', 'Condición del equipo', 'Evidencia',
  ]);

  // Cada card debe verse como bloque independiente: mismo fondo (var(--surface)),
  // radio de borde y separación vertical entre sí — no una franja continua.
  const cardCount = await page.locator('.grease-flow-card').count();
  expect(cardCount).toBe(6); // Equipo + Horómetro + Lubricante + Puntos + Condición + Evidencia
  const cardStyle = await page.locator('.grease-flow-card').first().evaluate(el => {
    const s = getComputedStyle(el);
    return { radius: parseFloat(s.borderTopLeftRadius) };
  });
  expect(cardStyle.radius).toBeGreaterThanOrEqual(10);

  // La unidad debe seguir siendo "lb" en Registrar Engrase, nunca "kg".
  const qtyLabel = (await page.locator('label:has(input[value="0.5"])').innerText()).trim();
  expect(qtyLabel).toContain('lb');
  expect(qtyLabel).not.toContain('kg');

  // Horómetro y el checkbox "sin horómetro" deben estar en la MISMA fila en
  // TODOS los anchos (pedido explícito) — se verifica que sus cajas se
  // superpongan verticalmente (misma franja Y) y que el checkbox quede a la
  // derecha del input.
  const hmFieldBox = await page.locator('.grease-flow-hm-field').boundingBox();
  const toggleBox = await page.locator('.grease-flow-toggle-row').boundingBox();
  const overlapY = Math.min(hmFieldBox.y + hmFieldBox.height, toggleBox.y + toggleBox.height) - Math.max(hmFieldBox.y, toggleBox.y);
  expect(overlapY, 'Horómetro y el checkbox deben compartir la misma fila').toBeGreaterThan(0);
  expect(toggleBox.x, 'el checkbox debe quedar a la derecha del input de horómetro').toBeGreaterThan(hmFieldBox.x);

  // Puntos de engrase: nunca en columnas — cada punto ocupa el ancho completo
  // de la card (el segundo punto arranca en el mismo borde izquierdo que el
  // primero, no al lado).
  const points = await page.locator('.checklist-item').all();
  const p0 = await points[0].boundingBox();
  const p1 = await points[1].boundingBox();
  expect(Math.abs(p1.x - p0.x), 'los puntos de engrase no deben quedar en columnas').toBeLessThan(2);

  const panelBox = await page.locator('.grease-flow-panel').boundingBox();
  const width = testInfo.project.use.viewport?.width;

  if (width && width <= 412) {
    // Móvil: el contenedor usa todo el ancho de .lub-content (sin límite propio
    // todavía), y Horómetro/Lubricante quedan APILADOS (1 columna).
    const hmCard = await page.locator('.grease-flow-card').nth(1).boundingBox(); // 0=Equipo
    const lubCard = await page.locator('.grease-flow-card').nth(2).boundingBox();
    expect(lubCard.y, 'en móvil, Horómetro y Lubricante van apilados (1 columna)').toBeGreaterThan(hmCard.y + hmCard.height - 2);
  }

  if (width === 768) {
    // Tablet: contenedor propio ~680-760px.
    expect(panelBox.width).toBeGreaterThanOrEqual(680);
    expect(panelBox.width).toBeLessThanOrEqual(760);
  }

  if (width && width >= 1024) {
    // Desktop/1920: contenedor propio ~900-1050px, NUNCA todo el monitor.
    expect(panelBox.width).toBeGreaterThanOrEqual(900);
    expect(panelBox.width).toBeLessThanOrEqual(1050);

    // Horómetro y Lubricante comparten fila de 2 columnas.
    const hmCard = await page.locator('.grease-flow-card').nth(1).boundingBox();
    const lubCard = await page.locator('.grease-flow-card').nth(2).boundingBox();
    expect(Math.abs(hmCard.y - lubCard.y), 'en escritorio, Horómetro y Lubricante comparten fila').toBeLessThan(2);
    expect(lubCard.x, 'Lubricante debe quedar a la derecha de Horómetro').toBeGreaterThan(hmCard.x);

    // Puntos/Condición/Evidencia/Finalizar ocupan todo el ancho del contenedor.
    const puntosCard = await page.locator('.grease-flow-card').nth(3).boundingBox();
    expect(puntosCard.width).toBeGreaterThan(hmCard.width * 1.8);
  }

  const submitBtn = page.locator('.btn-grease-submit');
  await expect(submitBtn).toBeVisible();
  const submitBox = await submitBtn.boundingBox();

  if (width && width <= 640) {
    // En móvil (donde el pedido pidió "ancho suficiente" para la acción principal):
    // min-height 52px (btn-grease-submit) — más alto que el mínimo táctil general
    // (44px) — y ancho >= al del botón secundario.
    expect(submitBox.height).toBeGreaterThanOrEqual(48);
    // Lote occurrences/carryover: ahora hay 2 botones secundarios ("No se
    // pudo ejecutar" + "Reportar anomalía") — .first() basta, el pedido
    // solo pide que Finalizar no quede más angosto que un secundario.
    const cancelBox = await page.locator('#grease-form .grease-flow-final .btn:not(.btn-accent)').first().boundingBox();
    expect(submitBox.width).toBeGreaterThanOrEqual(cancelBox.width);

    // Guardar fácil en móvil (cierre operativo §19): sticky real, nunca
    // tapa la barra inferior fija del Lubricador.
    const navBox = await page.locator('.lub-bottom-nav').boundingBox();
    expect(submitBox.y + submitBox.height, 'el botón Finalizar no debe quedar por debajo de donde empieza la barra inferior').toBeLessThanOrEqual(navBox.y + 1);
  } else if (width && width >= 1024) {
    // En escritorio no debe convertirse en un botón gigante de ancho completo.
    expect(submitBox.width).toBeLessThan(panelBox.width * 0.6);
  }
});
