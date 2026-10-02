// tests/unit/accessibility-contrast-motion.test.js
//
// Cierre de 2 hallazgos más de la auditoría de accesibilidad (parte 12):
//   - .icon-btn bajo el objetivo táctil de 44px (solo altura, nunca ancho).
//   - Colores semánticos (--green/--amber/--red) del modo claro heredaban
//     los valores del modo oscuro, pensados para contrastar contra un fondo
//     oscuro — contra blanco dan ~2.2-3.9:1, bajo el mínimo WCAG de 3:1.
//   - Chart.js (Reportes → Tendencia/Consumo) anima en <canvas>, fuera del
//     alcance del media query CSS prefers-reduced-motion — necesita
//     apagarse desde JS.
//
// El contraste se verifica con la fórmula REAL de luminancia relativa de
// WCAG 2.x sobre los valores hex que styles.css declara hoy — si alguien
// cambia esos colores a algo que vuelva a fallar, este test lo detecta sin
// depender de un valor hardcodeado "esperado".

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STYLES_PATH = path.resolve(__dirname, '../../CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const stylesSource = fs.readFileSync(STYLES_PATH, 'utf8');
const appSource = readSource(APP_JS_PATH);

function relativeLuminance(hex) {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(hexA, hexB) {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

function cssVarsInBlock(selectorRegex, varNames) {
  const blockMatch = stylesSource.match(selectorRegex);
  if (!blockMatch) throw new Error(`No se encontró el bloque ${selectorRegex}`);
  const out = {};
  for (const name of varNames) {
    const m = blockMatch[0].match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
    if (!m) throw new Error(`--${name} no está declarado en ese bloque`);
    out[name] = m[1];
  }
  return out;
}

describe('Contraste WCAG de los colores semánticos en modo claro (antes heredaban el valor de modo oscuro)', () => {
  const lightVars = cssVarsInBlock(/\[data-mode="light"\]\s*\{[^}]*\}/, ['green', 'amber', 'red']);
  const white = '#FFFFFF'; // --surface del modo claro: paneles/tarjetas/modal sobre los que se pintan estos colores

  it.each(['green', 'amber', 'red'])('--%s sobre --surface (blanco) cumple al menos 3:1 (texto grande/ícono, WCAG AA)', (name) => {
    const ratio = contrastRatio(lightVars[name], white);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it('los 3 colores de modo claro son DISTINTOS de los de modo oscuro (si no, seguiría siendo el mismo bug)', () => {
    const darkGreen = stylesSource.match(/:root\s*\{[^}]*--green:\s*(#[0-9A-Fa-f]{6})/)[1];
    const darkAmber = stylesSource.match(/:root\s*\{[^}]*--amber:\s*(#[0-9A-Fa-f]{6})/)[1];
    const darkRed = stylesSource.match(/:root\s*\{[^}]*--red:\s*(#[0-9A-Fa-f]{6})/)[1];
    expect(lightVars.green.toLowerCase()).not.toBe(darkGreen.toLowerCase());
    expect(lightVars.amber.toLowerCase()).not.toBe(darkAmber.toLowerCase());
    expect(lightVars.red.toLowerCase()).not.toBe(darkRed.toLowerCase());
  });
});

describe('.icon-btn — objetivo táctil de 44px también en ancho (antes solo tenía min-height)', () => {
  it('declara min-width: var(--tap), igual que el min-height ya existente', () => {
    const rule = stylesSource.match(/\.icon-btn\s*\{[^}]*\}/)[0];
    expect(rule).toMatch(/min-width:\s*var\(--tap\)/);
  });
});

describe('Chart.js (Reportes) respeta prefers-reduced-motion (CSS no alcanza <canvas>)', () => {
  it('prefersReducedMotion() consulta matchMedia en vivo, sin cachear el resultado', () => {
    const src = extractDeclaration(appSource, 'prefersReducedMotion');
    expect(src).toMatch(/matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
  });

  function sliceFrom(src, marker, len) {
    const i = src.indexOf(marker);
    if (i === -1) throw new Error(`No se encontró "${marker}" en renderReportes`);
    return src.slice(i, i + len);
  }

  it('el gráfico de Tendencia apaga su animación cuando corresponde', () => {
    const src = extractDeclaration(appSource, 'renderReportes');
    expect(sliceFrom(src, 'charts.tendencia = new Chart(', 700)).toContain('...(prefersReducedMotion() ? { animation: false } : {})');
  });

  it('el gráfico de Consumo apaga su animación cuando corresponde', () => {
    const src = extractDeclaration(appSource, 'renderReportes');
    expect(sliceFrom(src, 'charts.consumo = new Chart(', 500)).toContain('...(prefersReducedMotion() ? { animation: false } : {})');
  });
});
