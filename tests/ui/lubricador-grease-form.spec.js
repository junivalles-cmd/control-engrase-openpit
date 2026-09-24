// tests/ui/lubricador-grease-form.spec.js
//
// UI/Responsive Fase 3 (docs/UI_RESPONSIVE.md) — formulario "Registrar engrase"
// (Agregar Engrase). No requiere login: fragmento estático con la estructura/
// clases REALES de startGreaseFlow() (app.js) tras la reorganización visual en
// secciones — datos de relleno, nunca registros de producción. No se verifica
// aquí ningún campo/validación/lógica — solo estructura visual y overflow.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

const FIXTURE = `
<div class="lub-shell">
  <main class="lub-content">
    <div class="panel">
      <div class="panel-head"><h3>Registrar engrase — EQ-0001 · Marca Modelo</h3></div>
      <div class="dim" style="padding:0 14px 8px">Registrado por Usuario de prueba · Turno Día</div>
      <form id="grease-form">
        <div class="grease-section">
          <h4 class="grease-section-head">Horómetro</h4>
          <div class="form-grid">
            <label class="span-2">Horómetro actual<input type="number" value="1234" class="big-input"/></label>
          </div>
        </div>
        <div class="grease-section">
          <h4 class="grease-section-head">Engrase</h4>
          <div class="form-grid">
            <label>Tipo de grasa utilizada<select><option>Grasa</option></select></label>
            <label>Cantidad utilizada (lb)<input type="number" value="0.5"/></label>
          </div>
          <div class="checklist-head"><h4>Checklist de puntos de engrase</h4></div>
          <div id="checklist">
            <div class="checklist-item"><label class="check-row"><input type="checkbox" class="chk-done" checked/><span class="check-row-text">Punto A</span></label></div>
          </div>
        </div>
        <div class="grease-section">
          <h4 class="grease-section-head">Evidencia</h4>
          <div class="form-grid">
            <label class="span-2">Observaciones<textarea rows="2"></textarea></label>
          </div>
        </div>
        <div class="grease-section grease-section-final">
          <div class="modal-actions">
            <button type="button" class="btn">Reportar anomalía</button>
            <button type="submit" class="btn btn-accent btn-grease-submit">Finalizar engrase</button>
          </div>
        </div>
      </form>
    </div>
  </main>
</div>
`;

test('Registrar engrase: 3 secciones visibles, sin scroll horizontal, botón primario diferenciado', async ({ page }, testInfo) => {
  await page.setContent(FIXTURE);
  await page.addStyleTag({ path: STYLES_PATH });

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `scroll horizontal no deseado en ${testInfo.project.name}`).toBeLessThanOrEqual(clientWidth);

  const sectionHeads = await page.locator('.grease-section-head').allTextContents();
  expect(sectionHeads.map(s => s.trim())).toEqual(['Horómetro', 'Engrase', 'Evidencia']);

  const submitBtn = page.locator('.btn-grease-submit');
  await expect(submitBtn).toBeVisible();
  const submitBox = await submitBtn.boundingBox();

  const width = testInfo.project.use.viewport?.width;
  if (width && width <= 640) {
    // En móvil (donde el pedido pidió "ancho suficiente" para la acción principal):
    // min-height 52px (btn-grease-submit) — más alto que el mínimo táctil general
    // (44px) — y ancho >= al del botón secundario.
    expect(submitBox.height).toBeGreaterThanOrEqual(48);
    const cancelBox = await page.locator('#grease-form .grease-section-final .btn:not(.btn-accent)').boundingBox();
    expect(submitBox.width).toBeGreaterThanOrEqual(cancelBox.width);
  }
});
