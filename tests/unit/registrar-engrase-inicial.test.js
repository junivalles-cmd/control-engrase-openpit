// tests/unit/registrar-engrase-inicial.test.js
//
// Rediseño de la pantalla inicial de Registrar Engrase (renderRegistrar,
// ANTES de elegir equipo) — solo visual: mismo <select id="reg-eq-select">
// y el mismo listener 'change' → startGreaseFlow() de siempre (sin tocar el
// flujo funcional real, que ya está probado en otras suites). Se agrega el
// bloque de equipos recientes reutilizando recentEquiposHTML()/
// trackRecentEquipment() YA EXISTENTES (Mi Turno/Equipos) — no se inventa
// persistencia nueva.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const src = extractDeclaration(appSource, 'renderRegistrar');

describe('renderRegistrar() — pantalla "Seleccionar equipo" más protagonista, mismo flujo funcional', () => {
  it('título y subtítulo pedidos, dentro de un contenedor con ancho de lectura limitado (no todo el monitor)', () => {
    expect(src).toContain('<h2 class="reg-select-title">Seleccionar equipo</h2>');
    expect(src).toContain('<p class="reg-select-subtitle">Busca y selecciona un equipo para registrar el engrase.</p>');
    expect(src).toContain('class="reg-select-wrap"');
    expect(src).toContain('class="reg-select-card"');
  });

  it('sigue siendo el MISMO <select id="reg-eq-select"> con el MISMO listener change → startGreaseFlow (sin cambiar el flujo funcional)', () => {
    expect(src).toContain('<select id="reg-eq-select" class="input reg-eq-select">');
    expect(src).toContain("$('#reg-eq-select').addEventListener('change', (e) => {");
    expect(src).toContain('if (e.target.value) startGreaseFlow(e.target.value, $(\'#reg-flow-area\'));');
    expect(src).toContain('<div id="reg-flow-area"></div>');
  });

  it('reutiliza recentEquiposHTML() ya existente (Mi Turno/Equipos) — no inventa una funcionalidad ni persistencia nueva', () => {
    expect(src).toContain('const recentsHTML = await recentEquiposHTML();');
    expect(src).toContain("$$('.recents-chip', c).forEach(b => b.addEventListener('click', () => startGreaseFlow(b.dataset.recentId, $('#reg-flow-area'))));");
  });
});
