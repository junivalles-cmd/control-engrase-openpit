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
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const KB_WATCHER_SRC = extractDeclaration(readSource(APP_JS_PATH), 'wireKeyboardOpenWatcher');

const FIXTURE = `
<div class="lub-shell">
  <main class="lub-content">
    <div class="grease-flow-panel">
      <div class="grease-flow-card grease-flow-equipo-card">
        <div class="grease-flow-equipo-code">EQ-0001</div>
        <div class="grease-flow-equipo-model">Marca Modelo</div>
        <div class="grease-flow-equipo-meta">Registrado por Usuario de prueba · 01/01/2026</div>
        <div class="grease-flow-turno-warn">⚠ Turno programado: Día · Registrando en turno Noche — quedará como "Realizado atrasado".</div>
        <div class="grease-flow-vencido-warn">⚠ Este equipo está VENCIDO — no se engrasó en el ciclo esperado.</div>
        <div class="grease-flow-carryover-warn">⚠ El turno Día no pudo ejecutar este engrase hoy — motivo: Condición insegura (Ana G.).</div>
        <dl class="grease-flow-contexto">
          <div><dt>Ubicación</dt><dd>Botadero Norte</dd></div>
          <div><dt>Tipo de trabajo</dt><dd>Planificado</dd></div>
          <div><dt>Estado</dt><dd><span class="status-chip" style="--c:var(--amber)">Próximo a vencer</span></dd></div>
          <div><dt>Programación</dt><dd><span class="grease-flow-chip-row"><span class="grease-flow-daychip">LUN</span><span class="grease-flow-daychip">MIÉ</span><span class="grease-flow-daychip">VIE</span></span></dd></div>
          <div><dt>Turno actual</dt><dd><span class="grease-flow-daychip">Día</span></dd></div>
          <div><dt>Último engrase</dt><dd>01/01/2026 · 1,200 h</dd></div>
        </dl>
      </div>
      <form id="grease-form" class="grease-flow-form">
        <div class="grease-flow-card grease-flow-card-horometro">
          <h4 class="grease-flow-card-head">Horómetro</h4>
          <div class="grease-flow-hm-row">
            <label class="grease-flow-hm-field">Horómetro actual
              <span class="input-suffix-group"><input type="number" value="1234" class="big-input"/><span class="input-suffix">h</span></span>
            </label>
            <label class="grease-flow-toggle-row"><input type="checkbox"/><span>Sin horómetro / dañado</span></label>
          </div>
        </div>
        <div class="grease-flow-card grease-flow-card-puntos">
          <div class="grease-flow-points-head">
            <h4 class="grease-flow-card-head">Puntos de engrase</h4>
            <button type="button" class="btn btn-sm">Marcar todos</button>
          </div>
          <div id="checklist">
            <div class="checklist-item"><label class="check-row"><input type="checkbox" class="chk-done" checked/><span class="check-row-text">Punto A</span></label></div>
            <div class="checklist-item"><label class="check-row"><input type="checkbox" class="chk-done" checked/><span class="check-row-text">Punto B</span></label></div>
          </div>
        </div>
        <div class="grease-flow-card grease-flow-card-lubricante">
          <h4 class="grease-flow-card-head">Lubricante utilizado</h4>
          <div class="form-grid grease-flow-lube-grid">
            <label>Tipo de grasa utilizada<select><option>Grasa</option></select></label>
            <label>Cantidad utilizada
              <span class="input-suffix-group"><input type="number" value="0.5"/><span class="input-suffix">lb</span></span>
            </label>
          </div>
          <div class="retro-box">
            <h5 class="grease-flow-retro-head">Registro retroactivo</h5>
            <label class="retro-toggle"><input type="checkbox"/><span>Registrar como engrase ATRASADO (con fecha anterior)</span></label>
          </div>
        </div>
        <div class="grease-flow-card grease-flow-card-condicion">
          <h4 class="grease-flow-card-head">Condición del equipo</h4>
          <div class="form-grid">
            <label class="span-2">Condición encontrada<select><option>Normal</option></select></label>
          </div>
        </div>
        <div class="grease-flow-card grease-flow-card-evidencia">
          <h4 class="grease-flow-card-head">Evidencia</h4>
          <div class="form-grid">
            <label class="span-2">Observaciones<textarea rows="2"></textarea></label>
          </div>
        </div>
        <div class="grease-flow-final">
          <div class="modal-actions grease-flow-actions">
            <div class="grease-flow-actions-secondary">
              <button type="button" class="btn">No se pudo ejecutar</button>
              <button type="button" class="btn">Reportar anomalía</button>
            </div>
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
  // Orden real de startGreaseFlow() (app.js): Horómetro, Puntos, Lubricante,
  // Condición, Evidencia — el orden del DOM/móvil NO cambia con el rediseño
  // de columnas de escritorio (§1/§12 del pedido "REDISEÑO UX FORMULARIO
  // REGISTRAR ENGRASE", 2026-10-10): la reubicación a 2 columnas se hace
  // solo con grid-column/grid-row (CSS), nunca reordenando el HTML.
  const cardHeads = await page.locator('.grease-flow-card-head').allTextContents();
  expect(cardHeads.map(s => s.trim())).toEqual([
    'Horómetro', 'Puntos de engrase', 'Lubricante utilizado', 'Condición del equipo', 'Evidencia',
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
    // todavía), y TODAS las cards quedan apiladas (1 columna), en orden de fuente.
    const hmCard = await page.locator('.grease-flow-card').nth(1).boundingBox(); // 0=Equipo
    const puntosCard = await page.locator('.grease-flow-card').nth(2).boundingBox();
    expect(puntosCard.y, 'en móvil, Horómetro y Puntos van apilados (1 columna)').toBeGreaterThan(hmCard.y + hmCard.height - 2);
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

    // Fix 2026-10-10 (§1 del pedido): Horómetro/Lubricante/Condición en la
    // columna IZQUIERDA (~34%), apilados cada uno con SU propia altura
    // (nunca estirados); Puntos en la columna DERECHA (~66%), compartiendo
    // la fila 1 con Horómetro — ya NO "Horómetro y Lubricante comparten fila".
    const hmCard = await page.locator('.grease-flow-card-horometro').boundingBox();
    const puntosCard = await page.locator('.grease-flow-card-puntos').boundingBox();
    const lubCard = await page.locator('.grease-flow-card-lubricante').boundingBox();
    const condCard = await page.locator('.grease-flow-card-condicion').boundingBox();
    const evidCard = await page.locator('.grease-flow-card-evidencia').boundingBox();

    expect(Math.abs(hmCard.y - puntosCard.y), 'Horómetro y Puntos comparten la fila 1').toBeLessThan(2);
    expect(puntosCard.x, 'Puntos debe quedar a la derecha de Horómetro').toBeGreaterThan(hmCard.x);
    expect(puntosCard.width, 'la columna derecha (Puntos) debe ser bastante más ancha que la izquierda').toBeGreaterThan(hmCard.width * 1.3);

    // Lubricante/Condición quedan en la MISMA columna que Horómetro (mismo x),
    // apilados DEBAJO de él — nunca al lado de Puntos.
    expect(Math.abs(lubCard.x - hmCard.x), 'Lubricante queda en la misma columna que Horómetro').toBeLessThan(2);
    expect(lubCard.y, 'Lubricante va debajo de Horómetro').toBeGreaterThan(hmCard.y + hmCard.height - 2);
    expect(Math.abs(condCard.x - hmCard.x), 'Condición queda en la misma columna que Horómetro').toBeLessThan(2);
    expect(condCard.y, 'Condición va debajo de Lubricante').toBeGreaterThan(lubCard.y + lubCard.height - 2);

    // Fix real del bug reportado: Horómetro NUNCA se estira a la altura de
    // Puntos — su altura real (Horómetro+checkbox) debe ser bastante menor
    // que la de la card de Puntos.
    expect(hmCard.height, 'Horómetro no debe estirarse a la altura de Puntos').toBeLessThan(puntosCard.height);

    // Evidencia ocupa todo el ancho del contenedor (debajo de ambas columnas).
    expect(evidCard.width, 'Evidencia ocupa todo el ancho, no solo una columna').toBeGreaterThan(hmCard.width * 1.8);
    expect(evidCard.y, 'Evidencia va debajo de las 2 columnas').toBeGreaterThan(Math.max(condCard.y + condCard.height, puntosCard.y + puntosCard.height) - 2);
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

    // Fix 2026-10-10 (§9 del pedido "REDISEÑO UX FORMULARIO REGISTRAR
    // ENGRASE"): se PROBÓ sticky/fixed y se encontró que, incluso
    // implementado correctamente (position:fixed, evitando el bug real de
    // sticky que se "pega" desde el primer pixel por ser .grease-flow-final
    // el último hijo), en equipos con pocos puntos de engrase la barra
    // flotante SÍ llegaba a tapar parcialmente el checklist — justo lo que
    // el pedido pidió evitar. Con autorización explícita del usuario
    // (AskUserQuestion) se mantiene static — mismo criterio que el pedido
    // 2026-10-08 que lo había quitado por primera vez.
    const finalPosition = await page.locator('.grease-flow-final').evaluate(el => getComputedStyle(el).position);
    expect(finalPosition, 'el footer de acciones nunca debe ser sticky/fixed').toBe('static');
    const lastCardBox = await page.locator('.grease-flow-card').last().boundingBox();
    expect(submitBox.y, 'Finalizar engrase debe venir DESPUÉS de la última card, en flujo normal').toBeGreaterThanOrEqual(lastCardBox.y + lastCardBox.height - 2);
  } else if (width && width >= 1024) {
    // En escritorio no debe convertirse en un botón gigante de ancho completo.
    expect(submitBox.width).toBeLessThan(panelBox.width * 0.6);
  }
});

// El footer es SIEMPRE static (con o sin teclado, en cualquier ancho) — lo
// único que sigue cambiando con .keyboard-open es ocultar la barra inferior
// fija, que sí compite por espacio con el teclado. Este test cubre SOLO el
// efecto CSS de ".keyboard-open" (clase puesta a mano, sin pasar por
// wireKeyboardOpenWatcher()) — el test de abajo ("focusin real en campos
// reales…") cubre la detección real end-to-end.
test('Registrar engrase — el footer nunca es sticky (con o sin .keyboard-open); la barra inferior sí se oculta con teclado (solo móvil)', async ({ page }, testInfo) => {
  const width = testInfo.project.use?.viewport?.width;
  await page.setContent(FIXTURE);
  await page.addStyleTag({ path: STYLES_PATH });

  const before = await page.evaluate(() => ({
    footerPosition: getComputedStyle(document.querySelector('.grease-flow-final')).position,
    navDisplay: getComputedStyle(document.querySelector('.lub-bottom-nav')).display,
  }));
  expect(before.footerPosition, `antes de abrir teclado en ${testInfo.project.name}`).toBe('static');

  await page.locator('.lub-shell').evaluate(el => el.classList.add('keyboard-open'));
  const after = await page.evaluate(() => ({
    footerPosition: getComputedStyle(document.querySelector('.grease-flow-final')).position,
    navDisplay: getComputedStyle(document.querySelector('.lub-bottom-nav')).display,
  }));
  expect(after.footerPosition, `con teclado abierto en ${testInfo.project.name}, el footer sigue static`).toBe('static');

  if (width && width <= 640) {
    expect(before.navDisplay, `antes de abrir teclado en ${testInfo.project.name}`).not.toBe('none');
    expect(after.navDisplay, `con teclado abierto en ${testInfo.project.name}, la barra inferior se oculta`).toBe('none');
  } else {
    expect(after.navDisplay, `${testInfo.project.name} no debe ocultar la barra inferior`).not.toBe('none');
  }
});

// focusin/focusout REAL (fix Android 2026-10-08, item 9 del pedido): carga
// wireKeyboardOpenWatcher() REAL (extraída de app.js, mismo mecanismo que
// tests/ui/modal-accessibility.spec.js) y lo ejercita con foco/blur reales
// sobre los campos reales del fixture — nunca una clase puesta a mano.
async function bootKeyboardWatcher(page) {
  await page.setContent(FIXTURE);
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({ content: `${KB_WATCHER_SRC}\nwireKeyboardOpenWatcher();` });
}

const kbState = (page) => page.evaluate(() => ({
  open: document.querySelector('.lub-shell').classList.contains('keyboard-open'),
  navDisplay: getComputedStyle(document.querySelector('.lub-bottom-nav')).display,
  footerPosition: getComputedStyle(document.querySelector('.grease-flow-final')).position,
}));

for (const [label, selector] of [
  ['horómetro', '.grease-flow-hm-field input'],
  ['cantidad utilizada (lb)', '.grease-flow-lube-grid input[type="number"]'],
  ['observaciones', 'textarea'],
]) {
  test(`Registrar engrase (móvil) — focus real en "${label}" abre el teclado-open; blur lo cierra`, async ({ page }, testInfo) => {
    const width = testInfo.project.use?.viewport?.width;
    test.skip(!width || width > 640, 'Solo aplica en anchos móviles (≤640px).');

    await bootKeyboardWatcher(page);
    expect((await kbState(page)).open, 'antes de enfocar nada').toBe(false);

    await page.locator(selector).focus();
    const focused = await kbState(page);
    expect(focused.open, `focus en "${label}" debe activar .keyboard-open`).toBe(true);
    expect(focused.navDisplay, 'bottom-nav oculto con el teclado abierto').toBe('none');
    expect(focused.footerPosition, 'el footer de acciones sigue static').toBe('static');

    await page.locator(selector).blur();
    // Antes de que pase el debounce (200ms) debe seguir abierto — si no,
    // cualquier salto rápido entre campos parpadearía.
    await page.waitForTimeout(80);
    expect((await kbState(page)).open, 'justo después del blur, todavía dentro del debounce').toBe(true);

    await page.waitForTimeout(250);
    const afterBlur = await kbState(page);
    expect(afterBlur.open, 'tras el debounce, sin nada enfocado, se cierra').toBe(false);
    expect(afterBlur.navDisplay, 'bottom-nav vuelve a aparecer').not.toBe('none');
    // El footer nunca vuelve a ser sticky al cerrar el teclado — sigue
    // static, igual que antes de abrirlo.
    expect(afterBlur.footerPosition, 'el footer sigue static al cerrar el teclado').toBe('static');
  });
}

test('Registrar engrase (móvil) — saltar de un campo a otro NO cierra/reabre el teclado-open de forma incorrecta', async ({ page }, testInfo) => {
  const width = testInfo.project.use?.viewport?.width;
  test.skip(!width || width > 640, 'Solo aplica en anchos móviles (≤640px).');

  await bootKeyboardWatcher(page);
  const hm = page.locator('.grease-flow-hm-field input');
  const notes = page.locator('textarea');

  await hm.focus();
  expect((await kbState(page)).open).toBe(true);

  // Blur de "horómetro" + focus casi inmediato de "observaciones" (como el
  // botón "Siguiente" del teclado) — nunca debe pasar por "cerrado" en el medio.
  await hm.blur();
  await notes.focus();
  await page.waitForTimeout(250); // más que el debounce de cierre (200ms)
  const after = await kbState(page);
  expect(after.open, 'sigue abierto: el 2do campo tomó el foco antes de que el 1er blur cerrara nada').toBe(true);
  expect(after.navDisplay).toBe('none');

  await notes.blur();
  await page.waitForTimeout(250);
  expect((await kbState(page)).open, 'al blur final (sin otro foco), sí se cierra').toBe(false);
});
