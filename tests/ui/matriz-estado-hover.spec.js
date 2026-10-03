// tests/ui/matriz-estado-hover.spec.js
//
// Matriz Semanal — hover de celdas de estado (lote "fix: refine settings
// layout and matrix status styling", HALLAZGO 2). Causa raíz real: la
// regla global "table.matriz tbody tr:hover td { background:
// rgba(255,255,255,0.03) }" tiene MÁS especificidad (2 clases: .matriz +
// :hover) que un solo ".celda-X" (1 clase) — le ganaba a CUALQUIER celda
// de estado que no tuviera su PROPIA excepción "tr:hover .celda-X", sin
// importar el orden de aparición en el archivo. ".celda-hecho"/
// ".celda-pendiente"/".celda-no-realizado" ya tenían esa excepción;
// ".celda-hecho-atrasado"/".celda-hecho-adelantado"/".celda-pausado" NO —
// por eso se veían casi blancas/vacías en hover. Carga el CSS real
// (styles.css) contra un fixture estático con la MISMA estructura de
// table.matriz — sin DB/Auth, mismo método que el resto de specs de este
// proyecto.
//
// Pruebas K-S pedidas explícitamente:
//   K) REALIZADO ATRASADO tiene clase/estado propio.
//   L) fondo no es blanco.
//   M) hover mantiene color semántico (para TODOS los estados, no solo el
//      reportado).
//   N) contraste/texto sigue visible.
//   O) REALIZADO sigue verde.
//   P) NO REALIZADO sigue rojo.
//   Q) leyenda coincide con el color exacto de "Realizado atrasado".
//   R) tooltip (title nativo) sigue disponible.
//   S) no se cambia la lógica del estado — ver tests/unit/matriz-estado-celda.test.js
//      (estadoCelda() no se tocó) y la verificación de fuente al final de
//      este archivo (la clase/condición que arma <td class="celda-hecho-atrasado">
//      es idéntica a la de antes del lote, solo cambió el CSS).

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

// Mismas clases reales que estadoCelda()/renderMatriz() generan (app.js) —
// 1 fila con las 6 celdas de estado relevantes, 1 columna "equipo" real.
function matrizFixture() {
  return `
  <table class="matriz">
    <thead><tr><th>Equipo</th><th>Lun</th><th>Mar</th><th>Mié</th><th>Jue</th><th>Vie</th><th>Sáb</th></tr></thead>
    <tbody>
      <tr>
        <td class="matriz-eq">T-06</td>
        <td class="celda-hecho">REALIZADO</td>
        <td class="celda-hecho-atrasado" title="Realizado atrasado (turno distinto al planificado) por Juan · 01/10/2026">REALIZADO ATRASADO</td>
        <td class="celda-hecho-adelantado">REALIZADO ADELANTADO</td>
        <td class="celda-no-realizado">NO REALIZADO</td>
        <td class="celda-pendiente">PENDIENTE</td>
        <td class="celda-pausado">PAUSADO</td>
      </tr>
    </tbody>
  </table>`;
}

async function setup(page) {
  await page.setContent(matrizFixture());
  await page.addStyleTag({ path: STYLES_PATH });
}

function parseRGB(rgbString) {
  const m = rgbString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function luminance([r, g, b]) {
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(rgb1, rgb2) {
  const l1 = luminance(rgb1), l2 = luminance(rgb2);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

test('K) "REALIZADO ATRASADO" tiene una clase/estado CSS propio, distinto de Realizado/No realizado/Pendiente/Pausado', async ({ page }) => {
  await setup(page);
  const cell = page.locator('.celda-hecho-atrasado');
  await expect(cell).toHaveText('REALIZADO ATRASADO');
  const bg = await cell.evaluate(el => getComputedStyle(el).backgroundColor);
  const others = await page.locator('.celda-hecho, .celda-no-realizado, .celda-pendiente, .celda-pausado, .celda-hecho-adelantado').evaluateAll(
    els => els.map(el => getComputedStyle(el).backgroundColor)
  );
  for (const otherBg of others) expect(bg).not.toBe(otherBg);
});

test('L) el fondo de "REALIZADO ATRASADO" NO es blanco/casi-blanco (identidad de color preservada)', async ({ page }) => {
  await setup(page);
  const bg = await page.locator('.celda-hecho-atrasado').evaluate(el => getComputedStyle(el).backgroundColor);
  const rgb = parseRGB(bg);
  // Blanco/casi-blanco: los 3 canales muy altos y parejos. Ámbar oscuro real
  // (#8A5A00): R=138 G=90 B=0 — lejos de ese rango.
  expect(rgb[0]).toBeLessThan(220);
  expect(luminance(rgb)).toBeLessThan(0.5);
});

test('M) hover mantiene el color semántico de CADA estado (nunca se vuelve blanco/neutro)', async ({ page }) => {
  await setup(page);
  const estados = ['celda-hecho', 'celda-hecho-atrasado', 'celda-hecho-adelantado', 'celda-no-realizado', 'celda-pendiente', 'celda-pausado'];
  for (const cls of estados) {
    const cell = page.locator(`.${cls}`);
    const bgBefore = await cell.evaluate(el => getComputedStyle(el).backgroundColor);
    await cell.hover();
    const bgHover = await cell.evaluate(el => getComputedStyle(el).backgroundColor);
    const rgbBefore = parseRGB(bgBefore);
    const rgbHover = parseRGB(bgHover);
    // Nunca se vuelve (casi) blanco en hover.
    expect(luminance(rgbHover), `${cls}: el hover no debe volverse blanco/neutro`).toBeLessThan(0.6);
    // El tono se mantiene en la misma familia de color — el canal dominante
    // (el de mayor valor en el color base) sigue siendo el dominante en hover,
    // en vez de los 3 canales igualándose hacia blanco.
    const dominant = rgbBefore.indexOf(Math.max(...rgbBefore));
    const sortedHover = [...rgbHover].sort((a, b) => b - a);
    expect(rgbHover[dominant], `${cls}: el canal dominante del color base sigue siendo el más alto en hover`).toBe(sortedHover[0]);
  }
});

test('N) el texto de "REALIZADO ATRASADO" mantiene contraste AA (>=4.5:1) en estado normal y en hover', async ({ page }) => {
  await setup(page);
  const cell = page.locator('.celda-hecho-atrasado');
  const before = await cell.evaluate(el => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, color: cs.color };
  });
  const ratioBefore = contrastRatio(parseRGB(before.bg), parseRGB(before.color));
  expect(ratioBefore, 'contraste normal AA').toBeGreaterThanOrEqual(4.5);

  await cell.hover();
  const after = await cell.evaluate(el => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, color: cs.color };
  });
  const ratioAfter = contrastRatio(parseRGB(after.bg), parseRGB(after.color));
  expect(ratioAfter, 'contraste en hover AA').toBeGreaterThanOrEqual(4.5);
});

test('O) "REALIZADO" sigue siendo verde (normal y en hover)', async ({ page }) => {
  await setup(page);
  const cell = page.locator('.celda-hecho');
  const isGreenDominant = async () => {
    const rgb = parseRGB(await cell.evaluate(el => getComputedStyle(el).backgroundColor));
    return rgb[1] > rgb[0] && rgb[1] > rgb[2];
  };
  expect(await isGreenDominant()).toBe(true);
  await cell.hover();
  expect(await isGreenDominant()).toBe(true);
});

test('P) "NO REALIZADO" sigue siendo rojo (normal y en hover)', async ({ page }) => {
  await setup(page);
  const cell = page.locator('.celda-no-realizado');
  const isRedDominant = async () => {
    const rgb = parseRGB(await cell.evaluate(el => getComputedStyle(el).backgroundColor));
    return rgb[0] > rgb[1] && rgb[0] > rgb[2] && rgb[0] > 120;
  };
  expect(await isRedDominant()).toBe(true);
  await cell.hover();
  expect(await isRedDominant()).toBe(true);
});

test('Q) la leyenda incluye "Realizado atrasado" con el MISMO color exacto que la celda real', async () => {
  const appSource = readSource(APP_JS_PATH);
  expect(appSource).toContain('Realizado atrasado (turno distinto al planificado)</span>');
  // Mismo hex en los 3 lugares: celda real (styles.css), legend (app.js) y
  // exportación a Excel (app.js) — nunca 3 colores "parecidos" distintos.
  const cssSource = readSource(STYLES_PATH);
  expect(cssSource).toMatch(/\.celda-hecho-atrasado \{\s*background: #8A5A00;/);
  expect(appSource).toContain('style="background:#8A5A00"');
  expect(appSource).toContain("fill: { fgColor: { rgb: '8A5A00' } }");
});

test('R) el tooltip (title nativo) de "REALIZADO ATRASADO" sigue disponible con la misma información', async ({ page }) => {
  await setup(page);
  const cell = page.locator('.celda-hecho-atrasado');
  await expect(cell).toHaveAttribute('title', /Realizado atrasado \(turno distinto al planificado\)/);
  // El <td> no es nativamente enfocable (igual que el resto de celdas de la
  // matriz, nunca eran botones) — el tooltip funciona con mouse (title
  // nativo), tal como antes del lote; este test documenta ese estado real,
  // no inventa un comportamiento de foco nuevo fuera de lo pedido.
  const tabIndex = await cell.evaluate(el => el.tabIndex);
  expect(tabIndex).toBe(-1);
});

test('S) no se cambió la lógica del estado — la clase/condición de "hecho_atrasado" en el template es idéntica a antes del lote', async () => {
  const appSource = readSource(APP_JS_PATH);
  expect(appSource).toContain(`if (s.tipo === 'hecho_atrasado') return \`<td class="celda-hecho-atrasado\${hoyCls}" title="Realizado atrasado (turno distinto al planificado) por \${esc(s.por)} · \${fmtDate(s.fecha)}">REALIZADO ATRASADO</td>\`;`);
  expect(appSource).toContain("const TIPOS_HECHO = ['hecho', 'hecho_atrasado', 'hecho_adelantado'];");
});
