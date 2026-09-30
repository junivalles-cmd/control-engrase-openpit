// tests/unit/registrar-engrase-inicial.test.js
//
// Rediseño de la pantalla inicial de Registrar Engrase (renderRegistrar,
// ANTES de elegir equipo) — mismo contenedor protagonista de siempre. Desde
// el lote occurrences/carryover (§2, "selector de equipo compacto"), el
// <select> con TODOS los equipos activos fue reemplazado por un buscador
// en vivo (wireRegEquipoSearch(), mismo patrón que wireQuickFind() de la
// topbar pero con su propio contenedor) — se agrega el bloque de equipos
// recientes reutilizando recentEquiposHTML()/trackRecentEquipment() YA
// EXISTENTES (Mi Turno/Equipos) — no se inventa persistencia nueva.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const src = extractDeclaration(appSource, 'renderRegistrar');
const searchSrc = extractDeclaration(appSource, 'wireRegEquipoSearch');

describe('renderRegistrar() — pantalla "Seleccionar equipo" más protagonista, mismo flujo funcional', () => {
  it('título y subtítulo pedidos, dentro de un contenedor con ancho de lectura limitado (no todo el monitor)', () => {
    expect(src).toContain('<h2 class="reg-select-title">Seleccionar equipo</h2>');
    expect(src).toContain('<p class="reg-select-subtitle">Busca y selecciona un equipo para registrar el engrase.</p>');
    expect(src).toContain('class="reg-select-wrap"');
    expect(src).toContain('class="reg-select-card"');
  });

  it('selector compacto: buscador en vivo (no un <select> con todos los equipos), delega en wireRegEquipoSearch()', () => {
    expect(src).not.toContain('<select id="reg-eq-select"');
    expect(src).toContain('<input type="text" id="reg-eq-search"');
    expect(src).toContain('<div id="reg-eq-search-results"');
    expect(src).toContain('wireRegEquipoSearch(equipos, $(\'#reg-flow-area\'));');
    expect(src).toContain('<div id="reg-flow-area"></div>');
  });

  it('wireRegEquipoSearch(): filtra por código/shortCode/marca+modelo y abre startGreaseFlow() al elegir un resultado — sin listener global en document (esta pantalla se redibuja completa en cada navegación)', () => {
    expect(searchSrc).toContain("(e.code || '').toLowerCase().includes(q)");
    expect(searchSrc).toContain("(e.shortCode || '').toLowerCase().includes(q)");
    expect(searchSrc).toContain('startGreaseFlow(eq.id, flowArea);');
    expect(searchSrc).not.toContain("document.addEventListener");
  });

  it('reutiliza recentEquiposHTML() ya existente (Mi Turno/Equipos) — no inventa una funcionalidad ni persistencia nueva', () => {
    expect(src).toContain('const recentsHTML = await recentEquiposHTML();');
    expect(src).toContain("$$('.recents-chip', c).forEach(b => b.addEventListener('click', () => startGreaseFlow(b.dataset.recentId, $('#reg-flow-area'))));");
  });
});
