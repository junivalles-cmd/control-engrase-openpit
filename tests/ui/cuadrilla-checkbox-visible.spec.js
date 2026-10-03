// tests/ui/cuadrilla-checkbox-visible.spec.js
//
// Diagnóstico "Mi Turno no muestra equipos de Volcán" — HALLAZGO 1 (fix
// visual): el checkbox "Cuadrilla principal de esta ubicación" (y los de
// "Miembros autorizados") no mostraban NINGÚN indicador visible porque les
// faltaba <span class="check-row-mark">, el elemento que
// ".check-row input.chk-done:checked ~ .check-row-mark" (styles.css)
// necesita para pintar el círculo de check — el <input> real queda con
// opacity:0 a propósito (ver regla ".check-row input.chk-done"), así que
// sin el .check-row-mark la fila se veía como solo texto, sin forma de
// confirmar si estaba marcada. Fragmento estático con la MISMA estructura
// real que genera wireCuadrillasPanel()/openCuadrillaForm() (app.js).

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

function fixture({ checked }) {
  return `
  <div class="modal-body">
    <form id="cq-form">
      <label class="check-row" style="margin-top:8px">
        <input type="checkbox" class="chk-done" name="isDefault" ${checked ? 'checked' : ''}/>
        <span class="check-row-text">Cuadrilla principal de esta ubicación<br/><span class="field-hint" style="margin:0">Recibe automáticamente el trabajo planificado normal.</span></span>
        <span class="check-row-mark">✓</span>
      </label>
    </form>
  </div>`;
}

test('checked=true — el indicador .check-row-mark es visible y muestra el color "marcado" (verde)', async ({ page }) => {
  await page.setContent(fixture({ checked: true }));
  await page.addStyleTag({ path: STYLES_PATH });

  const mark = page.locator('.check-row-mark');
  await expect(mark).toBeVisible();
  const box = await mark.boundingBox();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);

  const bg = await mark.evaluate(el => getComputedStyle(el).backgroundColor);
  // Checked usa var(--green) de fondo (ver ".check-row input.chk-done:checked ~ .check-row-mark").
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
});

test('checked=false — el indicador .check-row-mark sigue siendo visible (borde), nunca invisible/ausente', async ({ page }) => {
  await page.setContent(fixture({ checked: false }));
  await page.addStyleTag({ path: STYLES_PATH });

  const mark = page.locator('.check-row-mark');
  await expect(mark).toBeVisible();
  const box = await mark.boundingBox();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
});

test('clic en cualquier parte de la fila (texto incluido) togglea el checkbox real — el <label> envolvente sigue intacto', async ({ page }) => {
  await page.setContent(fixture({ checked: false }));
  await page.addStyleTag({ path: STYLES_PATH });

  const input = page.locator('input[name="isDefault"]');
  await expect(input).not.toBeChecked();
  await page.locator('.check-row-text').click();
  await expect(input).toBeChecked();
});

test('el <input> real sigue existiendo en el DOM (name="isDefault", para que FormData lo siga leyendo al guardar)', async ({ page }) => {
  await page.setContent(fixture({ checked: true }));
  await page.addStyleTag({ path: STYLES_PATH });

  await expect(page.locator('input[name="isDefault"]')).toHaveCount(1);
  await expect(page.locator('input[name="isDefault"]')).toBeChecked();
});
