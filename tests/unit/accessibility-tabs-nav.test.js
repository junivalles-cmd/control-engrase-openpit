// tests/unit/accessibility-tabs-nav.test.js
//
// Cierre de 3 hallazgos de la auditoría de accesibilidad (docs/
// SESSION_HANDOFF.md, parte 12) documentados como pendientes:
//   - .rep-tab (Reportes → Consumo de grasa) sin role="tab"/aria-selected,
//     a diferencia de .hist-tab que ya lo tenía.
//   - Ítem activo de navegación (sidebar/bottom-nav de escritorio, bottom-nav
//     del Lubricador) sin aria-current="page".
//   - <img> de evidencia/QR/foto sin atributo alt.
//
// Igual que tests/unit/dashboard-hierarchy.test.js: estas funciones arman
// HTML real o manipulan el DOM real de la app y no se ejecutan aquí (varias
// dependen de IndexedDB/Chart.js/canvas) — se extrae el texto fuente EXACTO
// con extractDeclaration() y se verifica contra ese texto, nunca una copia
// reescrita a mano.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);

describe('rep-tab (Reportes → Consumo de grasa) con la misma semántica ARIA que hist-tab', () => {
  const src = extractDeclaration(appSource, 'renderReportes');

  it('el contenedor declara role="tablist"', () => {
    expect(src).toMatch(/<div class="rep-tabs" id="rep-consumo-tabs" role="tablist">/);
  });

  it('los 3 botones declaran role="tab" + aria-selected inicial correcto', () => {
    expect(src).toMatch(/class="rep-tab active" data-tab="equipo" role="tab" aria-selected="true"/);
    expect(src).toMatch(/class="rep-tab" data-tab="familia" role="tab" aria-selected="false"/);
    expect(src).toMatch(/class="rep-tab" data-tab="lubricante" role="tab" aria-selected="false"/);
  });

  it('dibujarConsumoTab() actualiza aria-selected junto con la clase active', () => {
    expect(src).toMatch(
      /\$\$\('\.rep-tab', \$\('#rep-consumo-tabs'\)\)\.forEach\(b => \{ b\.classList\.toggle\('active', b\.dataset\.tab === tab\); b\.setAttribute\('aria-selected', b\.dataset\.tab === tab \? 'true' : 'false'\); \}\);/
    );
  });
});

describe('aria-current="page" en el ítem de navegación activo', () => {
  it('navigate() (sidebar + bottom-nav de escritorio) lo asigna y lo quita', () => {
    const src = extractDeclaration(appSource, 'navigate');
    expect(src).toMatch(/const active = b\.dataset\.route === route;/);
    expect(src).toMatch(/if \(active\) b\.setAttribute\('aria-current', 'page'\); else b\.removeAttribute\('aria-current'\);/);
  });

  it('bootLubricador(): el ítem inicial ("Mi Turno") lo tiene en el markup estático', () => {
    const src = extractDeclaration(appSource, 'bootLubricador');
    expect(src).toMatch(/class="lub-nav-item active" data-route="turno" aria-current="page"/);
  });

  it('bootLubricador(): el click en otra pestaña lo mueve de botón', () => {
    const src = extractDeclaration(appSource, 'bootLubricador');
    expect(src).toMatch(/x\.classList\.remove\('active'\); x\.removeAttribute\('aria-current'\); \}\);/);
    expect(src).toMatch(/b\.classList\.add\('active'\);\s*\n\s*b\.setAttribute\('aria-current', 'page'\);/);
  });

  it('irAMisEngrasesTrasRegistrar() lo mueve a "Mis Engrases" sin dejarlo en dos botones', () => {
    const src = extractDeclaration(appSource, 'irAMisEngrasesTrasRegistrar');
    expect(src).toMatch(/if \(active\) x\.setAttribute\('aria-current', 'page'\); else x\.removeAttribute\('aria-current'\);/);
  });
});

describe('<img> con alt real (evidencia/QR/foto), antes sin ninguno', () => {
  it('foto agregada a un punto de engrase (addPhotoToField)', () => {
    const src = extractDeclaration(appSource, 'addPhotoToField');
    expect(src).toContain('alt="Foto agregada"');
  });

  it('etiquetas QR para imprimir en lote (printAllQRCodes)', () => {
    const src = extractDeclaration(appSource, 'printAllQRCodes');
    expect(src).toMatch(/alt="Código QR de \$\{esc\(e\.code\)\}"/);
  });

  it('QR individual de un equipo (openEquipmentQR)', () => {
    const src = extractDeclaration(appSource, 'openEquipmentQR');
    expect(src).toMatch(/alt="Código QR de \$\{esc\(equipment\.code\)\}"/);
  });

  it('miniatura de punto de engrase durante el registro (startGreaseFlow)', () => {
    const src = extractDeclaration(appSource, 'startGreaseFlow');
    expect(src).toMatch(/alt="Foto de \$\{esc\(p\.point\)\}"/);
  });

  it('galería de fotos en Reportes (renderReportes)', () => {
    const src = extractDeclaration(appSource, 'renderReportes');
    expect(src).toMatch(/alt="Foto de \$\{esc\(p\.eq\)\} · \$\{esc\(p\.type\)\}"/);
  });

  it('visor de foto a pantalla completa (openPhotoLightbox)', () => {
    const src = extractDeclaration(appSource, 'openPhotoLightbox');
    expect(src).toMatch(/alt="\$\{esc\(caption \|\| 'Fotografía'\)\}"/);
  });
});
