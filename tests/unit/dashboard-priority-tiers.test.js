// tests/unit/dashboard-priority-tiers.test.js
//
// Rediseño aprobado del Dashboard (prioridades visuales + grids reales,
// lote "feat: restructure dashboard and settings ux"). Prueba por patrón de
// fuente (mismo método que dashboard-sin-plan.test.js) las partes que no se
// cubren en el fixture estático de tests/ui/dashboard-operativo.spec.js:
//   - "Cumplimiento operativo" vive en Prioridad 3 (después de "Mayor tiempo
//     sin engrasar", antes de "Indicadores secundarios"), nunca se movió el
//     cálculo, solo la posición en la plantilla.
//   - Prioridad 3 es colapsable (<details>) y arranca abierta en desktop /
//     cerrada en mobile — el mismo criterio de breakpoint (1024px) que ya
//     usa wireConfigCategoryNav() en Configuración.
//   - "Sin plan" nunca usa tono de peligro (rojo) — es informativo, no una
//     alerta (se mantiene el cálculo real de sinPlan, solo cambia el tono).
//   - El código de equipo en "Equipos que requieren atención" y "Mayor
//     tiempo sin engrasar" abre la Ficha real (openEquipmentDetail), nunca
//     una reimplementación.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const src = extractDeclaration(appSource, 'renderDashboard');

describe('Prioridad 3 — "Cumplimiento operativo" se reubicó, nunca se tocó su cálculo', () => {
  it('el bloque de Prioridad 3 (<details id="dash-tier-3">) contiene Cumplimiento operativo Y Indicadores secundarios, en ese orden', () => {
    const tier3Match = src.match(/<details class="dash-tier dash-tier-3"[\s\S]*?<\/details>/);
    expect(tier3Match).not.toBeNull();
    const block = tier3Match[0];
    const cumplIdx = block.indexOf('Cumplimiento operativo');
    const secundariosIdx = block.indexOf('Indicadores secundarios');
    expect(cumplIdx).toBeGreaterThan(-1);
    expect(secundariosIdx).toBeGreaterThan(-1);
    expect(cumplIdx).toBeLessThan(secundariosIdx);
  });

  it('"Cumplimiento operativo" sigue usando las mismas 3 tarjetas reales (dashComplianceCard) sin cambios de cálculo', () => {
    expect(src).toContain("dashComplianceCard('Hoy', cumplHoy)");
    expect(src).toContain("dashComplianceCard('Semana', cumplSemana)");
    expect(src).toContain('dashComplianceCard(turnoActualLabel, cumplTurno)');
  });

  it('Prioridad 3 arranca abierta en desktop (>=1024px) y cerrada en mobile — mismo criterio de breakpoint que Configuración', () => {
    expect(src).toContain("window.matchMedia('(min-width: 1024px)').matches");
    expect(src).toContain('dashTier3.open = isDesktopDash');
  });
});

describe('"Sin plan" — informativo, nunca tono de peligro (rojo)', () => {
  it('la tarjeta de "Sin plan" en Indicadores secundarios usa tono neutral', () => {
    expect(src).toContain("dashActivityCard('Sin plan', sinPlan.length, 'neutral', 'sin-plan')");
  });

  it('la entrada "Sin plan" de la cola de atención también usa tono neutral (nunca red)', () => {
    expect(src).toContain("estado: 'Sin plan', tone: 'neutral'");
  });
});

describe('Código de equipo clicable — abre la Ficha real (openEquipmentDetail), nunca una reimplementación', () => {
  it('"Equipos que requieren atención" wirea .dash-cola-code a openEquipmentDetail', () => {
    expect(src).toContain("$$('.dash-cola-code', cont).forEach(b => b.addEventListener('click', () => openEquipmentDetail(b.dataset.id)));");
  });

  it('"Mayor tiempo sin engrasar" wirea .dash-exc-code a openEquipmentDetail (lista principal y modal "Ver todos")', () => {
    const matches = src.match(/openEquipmentDetail\(btn\.dataset\.id\)/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('los códigos clicables son <button>, no <span> — accesibles por teclado, con clase .dash-code-link', () => {
    // tiempoExcepcionRowHTML() es una función top-level propia (no anidada en
    // renderDashboard()), así que se extrae por separado.
    const excRowSrc = extractDeclaration(appSource, 'tiempoExcepcionRowHTML');
    expect(excRowSrc).toContain('class="dash-exc-code dash-code-link mono"');
    expect(src).toContain('class="dash-cola-code dash-code-link mono"');
  });
});
