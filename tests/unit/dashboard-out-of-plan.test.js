// tests/unit/dashboard-out-of-plan.test.js
//
// Rediseño estructural del Dashboard (cierre Parte D) — sección G, "Fuera de
// plan hoy": usa resolveRecordExecutionType()/EXECUTION_TYPE.OUT_OF_PLAN
// (operational-scope.js) ya existente, compacto, sin doble conteo con
// "Realizados hoy" (B) ni con "Requieren atención" (D). Prueba a nivel de
// FUENTE.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const src = extractDeclaration(appSource, 'renderDashboard');

describe('G — "Fuera de plan hoy" usa la función central de clasificación, nunca un criterio propio', () => {
  it('recordsOutOfPlanHoy filtra recordsHoy (records reales de HOY) por EXECUTION_TYPE.OUT_OF_PLAN vía resolveRecordExecutionType()', () => {
    expect(src).toContain('const recordsOutOfPlanHoy = recordsHoy.filter(r => resolveRecordExecutionType(r).value === EXECUTION_TYPE.OUT_OF_PLAN);');
  });

  it('se muestra compacto (dashActivityCard) dentro de la sección G', () => {
    expect(src).toContain("dashActivityCard('Fuera de plan hoy', recordsOutOfPlanHoy.length, 'neutral', null)");
  });
});

describe('No double count — "Fuera de plan hoy" (G) vs. "Realizados hoy" (B, KPI principal)', () => {
  it('"Realizados hoy" (doneToday) y "Fuera de plan hoy" (recordsOutOfPlanHoy) nunca se suman ni se restan entre sí en un mismo KPI — son presentaciones separadas del mismo historial de registros, en secciones distintas (B vs. G)', () => {
    expect(src).not.toMatch(/doneToday\s*[-+]\s*recordsOutOfPlanHoy/);
    expect(src).not.toMatch(/recordsOutOfPlanHoy\.length\s*[-+]\s*doneToday/);
    const iHero = src.indexOf('dash-hero-grid');
    const iFinHero = src.indexOf('</section>', iHero);
    expect(src.slice(iHero, iFinHero)).not.toContain('recordsOutOfPlanHoy');
  });

  it('un registro Fuera de plan tampoco aparece en colaAtencion (D) — esa cola solo lista EQUIPOS con trabajo pendiente/vencido, no registros ya ejecutados', () => {
    const iCola = src.indexOf('const colaAtencion = [');
    const iFinCola = src.indexOf('];', iCola);
    expect(src.slice(iCola, iFinCola)).not.toContain('recordsOutOfPlanHoy');
  });
});
