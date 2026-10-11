// tests/unit/corporate-theme-palette.test.js
//
// Pedido "WIDGET ANDROID + PALETA CORPORATIVA FINAL + MODO SOL"
// (2026-10-09), Parte B — casos A-I del §19. Contraste verificado con la
// MISMA fórmula real de luminancia relativa de WCAG ya usada en
// tests/unit/accessibility-contrast-motion.test.js (nunca un valor
// hardcodeado "esperado").

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
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrastRatio(hexA, hexB) {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

const themesSrc = extractDeclaration(appSource, 'THEMES');
const THEMES = new Function(`${themesSrc}\nreturn THEMES;`)();
const modesSrc = extractDeclaration(appSource, 'MODES');
const MODES = new Function(`${modesSrc}\nreturn MODES;`)();

function dataThemeBlock(id) {
  const re = new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`);
  const m = stylesSource.match(re);
  if (!m) throw new Error(`No se encontró [data-theme="${id}"] en styles.css`);
  return m[1];
}
function dataModeBlock(id) {
  const re = new RegExp(`\\[data-mode="${id}"\\]\\s*\\{([^}]*)\\}`);
  const m = stylesSource.match(re);
  if (!m) throw new Error(`No se encontró [data-mode="${id}"] en styles.css`);
  return m[1];
}

describe('A. exactamente 8 presets de acento disponibles (THEMES)', () => {
  it('THEMES tiene exactamente 8 entradas', () => {
    expect(THEMES.length).toBe(8);
  });
  it('son EXACTAMENTE los 8 corporativos pedidos, ninguno de la biblioteca anterior', () => {
    expect(THEMES.map((t) => t.id).sort()).toEqual([
      'azul-corp', 'amarillo-cat', 'azul-acero', 'petroleo-ejec', 'grafito', 'verde-bosque', 'cobre-ejec', 'violeta-ejec',
    ].sort());
  });
});

describe('B. Azul es el DEFAULT', () => {
  it('es el primero en THEMES (orden de aparición en el selector)', () => {
    expect(THEMES[0].id).toBe('azul-corp');
  });
  it('getTheme() usa "azul-corp" como accent por defecto', () => {
    const getThemeSrc = extractDeclaration(appSource, 'getTheme');
    expect(getThemeSrc).toContain("accent: 'azul-corp'");
  });
  it('--accent de "azul-corp" es el hex EXACTO pedido (#185ABD, oscuro #123E82)', () => {
    const block = dataThemeBlock('azul-corp');
    expect(block).toMatch(/--accent:\s*#185ABD/i);
    expect(block).toMatch(/--accent-dark:\s*#123E82/i);
  });
});

describe('C. persistencia local (sin cambios de mecanismo — localStorage, misma clave)', () => {
  it('saveTheme() sigue escribiendo en localStorage("engrase_theme")', () => {
    const src = extractDeclaration(appSource, 'saveTheme');
    expect(src).toContain("localStorage.setItem('engrase_theme', JSON.stringify(theme))");
  });
});

describe('D. cambio instantáneo (sin reload)', () => {
  it('applyTheme() usa setAttribute (nunca location.reload())', () => {
    const src = extractDeclaration(appSource, 'applyTheme');
    expect(src).toContain('setAttribute');
    expect(src).not.toContain('location.reload');
  });
});

describe('E. Burdeos conserva el ID antiguo y pasa AA con blanco', () => {
  const access = THEMES.find(t => t.id === 'amarillo-cat');
  it('publica nombre y tokens nuevos sin romper el ID', () => {
    expect(access.label).toBe('Burdeos'); expect(access.color).toBe('#A4373A'); expect(access.onColor).toBe('#FFFFFF');
  });
  it('el texto blanco pasa AA sobre accent y accent-dark', () => {
    expect(contrastRatio(access.onColor, access.color)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(access.onColor, access.colorDark)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('F. los semánticos (--green/--amber/--red/--gray-status) NO cambian entre temas de acento', () => {
  it.each(THEMES.map((t) => t.id))('[data-theme="%s"] solo declara --accent/--accent-dark/--on-accent, nunca un semántico', (id) => {
    const block = dataThemeBlock(id);
    expect(block).not.toMatch(/--green|--amber|--red|--gray-status/);
  });
});

describe('G. Modo Sol conserva el acento corporativo completo (nunca lo oculta/fuerza a negro)', () => {
  it('[data-mode="sun"] no redefine --accent/--accent-dark/--on-accent', () => {
    const block = dataModeBlock('sun');
    expect(block).not.toMatch(/--accent\s*:|--accent-dark\s*:|--on-accent\s*:/);
  });
  it('.btn-accent NO está forzado a negro bajo Modo Sol (a diferencia de Alto Contraste)', () => {
    expect(stylesSource).not.toMatch(/\[data-mode="sun"\][^{]*\.btn-accent\s*\{[^}]*background:\s*#000000/);
  });
});

describe('H. Alto Contraste se retira del selector y queda como alias del modo Sol', () => {
  it('solo hay tres modos visibles', () => expect(MODES.map(m => m.id)).toEqual(['light', 'dark', 'sun']));
  it('el CSS legacy comparte el bloque de Sol', () => expect(stylesSource).toMatch(/\[data-mode="contrast"\], \[data-mode="high-contrast"\], \[data-mode="sun"\] \{/));
  it('no quedan botones productivos forzados a negro por el modo retirado', () => {
    expect(stylesSource).not.toMatch(/\[data-mode="contrast"\]\s*\.btn-accent\s*\{/);
    expect(stylesSource).not.toMatch(/\[data-mode="contrast"\]\s*\.lub-hero-action\s*\{/);
  });
  it('Modo Sol conserva foco reforzado', () => expect(stylesSource).toContain('outline: 3px solid var(--focus)'));
});

describe('I. los 8 acentos pasan la regla de contraste AA (on-accent vs accent) — especial atención a Verde Bosque/Cobre Ejecutivo/Violeta Ejecutivo', () => {
  it.each(THEMES.map((t) => [t.id, t]))('%s: contraste onColor vs color >= 4.5:1 (AA texto normal)', (id, theme) => {
    const ratio = contrastRatio(theme.onColor, theme.color);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['verde-bosque', 'cobre-ejec', 'violeta-ejec'])('%s: el CSS real ([data-theme]) coincide con el THEMES de JS (mismo hex, nunca desincronizado)', (id) => {
    const theme = THEMES.find((t) => t.id === id);
    const block = dataThemeBlock(id);
    expect(block.match(/--accent:\s*(#[0-9A-Fa-f]{6})/)[1].toLowerCase()).toBe(theme.color.toLowerCase());
    expect(block.match(/--accent-dark:\s*(#[0-9A-Fa-f]{6})/)[1].toLowerCase()).toBe(theme.colorDark.toLowerCase());
  });
});

describe('Claro — valores base EXACTOS pedidos (§12)', () => {
  it('bg/surface/surface-2/border/text/text-dim coinciden con el pedido', () => {
    const block = dataModeBlock('light');
    expect(block).toMatch(/--bg:\s*#F4F6F8/i);
    expect(block).toMatch(/--surface:\s*#FFFFFF/i);
    expect(block).toMatch(/--surface-2:\s*#EEF2F5/i);
    expect(block).toMatch(/--border:\s*#CBD5E1/i);
    expect(block).toMatch(/--text:\s*#111827/i);
    expect(block).toMatch(/--text-dim:\s*#5B6573/i);
  });
});

describe('Paleta Office: valores completos sincronizados con CSS', () => {
  const expected = [
    ['azul-corp','Azul','#185ABD','#123E82','#EAF2FD'],
    ['verde-bosque','Verde','#217346','#185233','#EAF6EF'],
    ['cobre-ejec','Naranja','#D14726','#9E341A','#FBEDE8'],
    ['azul-acero','Azul ejecutivo','#1F4E79','#163A5C','#E9F2FB'],
    ['violeta-ejec','Morado','#80397B','#5E295A','#F4ECF4'],
    ['petroleo-ejec','Índigo','#6264A7','#464775','#EEEEF8'],
    ['amarillo-cat','Burdeos','#A4373A','#742629','#F8ECEC'],
    ['grafito','Grafito','#5E6A71','#3F494F','#EFF2F4'],
  ];
  it.each(expected)('%s: label, accent, dark, soft y AA de ambas variantes', (id,label,color,dark,soft) => {
    const theme=THEMES.find(t=>t.id===id), block=dataThemeBlock(id);
    expect([theme.label,theme.color,theme.colorDark,theme.colorSoft,theme.onColor]).toEqual([label,color,dark,soft,'#FFFFFF']);
    for (const value of [color,dark,soft]) expect(block.toUpperCase()).toContain(value);
    expect(contrastRatio('#FFFFFF',color)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#FFFFFF',dark)).toBeGreaterThanOrEqual(4.5);
  });
});
