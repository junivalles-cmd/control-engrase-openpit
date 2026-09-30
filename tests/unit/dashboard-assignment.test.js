// tests/unit/dashboard-assignment.test.js
//
// Rediseño estructural del Dashboard (cierre Parte D) — sección G,
// "Asignaciones activas": compacta, separada de lo PLANIFICADO (D/E), sin
// doble conteo con pendientes/vencidos. Prueba a nivel de FUENTE.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const src = extractDeclaration(appSource, 'renderDashboard');

describe('G — "Asignaciones activas" usa el ciclo de vida real (ASSIGNMENT_STATUS.PENDING), no un cálculo propio', () => {
  it('assignmentsActivas filtra por status PENDING + active + dentro del filtro Ubicación/Familia vigente', () => {
    expect(src).toContain('const assignmentsActivas = assignments.filter(a =>');
    expect(src).toContain('a.active !== false && a.status === ASSIGNMENT_STATUS.PENDING && equipoIdsFiltrados.has(a.equipmentId));');
  });

  it('se muestra en su propia tarjeta compacta (dashActivityCard), dentro de la sección G, nunca mezclada con colaAtencion (D)', () => {
    expect(src).toContain("dashActivityCard('Asignaciones activas', assignmentsActivas.length, assignmentsActivas.length ? 'amber' : 'neutral', null)");
    const iG = src.indexOf('dash-panel-operativo');
    const iCola = src.indexOf('const colaAtencion = [');
    expect(iCola).toBeLessThan(iG); // colaAtencion ya se construyó antes; G no la reutiliza
    const iFinG = src.indexOf('</section>', iG);
    expect(src.slice(iG, iFinG)).not.toContain('colaAtencion');
  });
});

describe('No double count — asignaciones activas (trabajo PENDIENTE) vs. Vencidos/Pendientes hoy (estado del equipo)', () => {
  it('son conjuntos con fuente de datos distinta: assignments (ciclo de vida propio) vs. statuses/attention (semáforo por plan) — nunca se resta uno del otro ni se suman en un mismo KPI', () => {
    expect(src).not.toMatch(/counts\.ROJO\s*[-+]\s*assignmentsActivas/);
    expect(src).not.toMatch(/pendientesHoyList\.length\s*[-+]\s*assignmentsActivas/);
  });
});
