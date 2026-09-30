// tests/unit/dashboard-hierarchy.test.js
//
// Rediseño estructural del Dashboard (cierre Parte D) — orden visual A-I
// pedido explícitamente: Cabecera+Filtros, KPI principales, Cumplimiento,
// Requieren atención, Pendientes del turno anterior, Estado por ubicación,
// Assignments+Fuera de plan+No ejecutados, Mayor tiempo sin engrasar,
// Indicadores secundarios. Prueba a nivel de FUENTE (mismo criterio que el
// resto de dashboard-*.test.js): se confirma la posición relativa de los
// marcadores reales del template, nunca una reimplementación del HTML.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const src = extractDeclaration(appSource, 'renderDashboard');

describe('Orden A-I del Dashboard — cada bloque aparece en el orden exacto pedido', () => {
  const marcadores = {
    A_filtros: 'dash-filters-row',
    B_kpiPrincipales: 'dash-hero-grid',
    C_cumplimiento: 'dash-compliance-grid',
    D_atencion: 'dash-attention-panel',
    E_turnoAnterior: 'dash-pendientes-anterior-panel',
    F_ubicacion: 'dash-ubic-panel',
    G_assignments: 'dash-panel-operativo',
    H_tiempoSinEngrasar: 'dash-tiempo-sin-engrase-panel',
    I_indicadoresSecundarios: '<h2 class="dash-section-title">Indicadores secundarios</h2>',
  };

  it('todos los marcadores existen en el template', () => {
    Object.entries(marcadores).forEach(([nombre, marca]) => {
      expect(src.indexOf(marca), `falta el marcador de ${nombre} ("${marca}")`).toBeGreaterThan(-1);
    });
  });

  it('el orden real en el texto respeta A < B < C < D < E < F < G < H < I', () => {
    const posiciones = Object.entries(marcadores).map(([nombre, marca]) => ({ nombre, pos: src.indexOf(marca) }));
    for (let i = 1; i < posiciones.length; i++) {
      expect(posiciones[i].pos, `${posiciones[i].nombre} debe ir después de ${posiciones[i - 1].nombre}`)
        .toBeGreaterThan(posiciones[i - 1].pos);
    }
  });
});

describe('B — KPI principales: 6 tarjetas en el orden pedido, reusando valores ya calculados (sin fórmulas nuevas)', () => {
  it('Vencidos, Pendientes hoy, Próximos, Realizados hoy, Pendientes de validación, Cumplimiento hoy — en ese orden', () => {
    const iHero = src.indexOf('dash-hero-grid');
    const iFinHero = src.indexOf('</section>', iHero);
    const heroSrc = src.slice(iHero, iFinHero === -1 ? iHero + 2000 : iFinHero);
    const orden = ['Vencidos', 'Pendientes hoy', 'Próximos', 'Realizados hoy', 'Pendientes de validación', 'Cumplimiento hoy'];
    let cursor = -1;
    orden.forEach(label => {
      const pos = heroSrc.indexOf(label, cursor + 1);
      expect(pos, `"${label}" debe aparecer después del anterior`).toBeGreaterThan(cursor);
      cursor = pos;
    });
  });

  it('usa directamente counts.ROJO/pendientesHoyList/proximosSinHoy/doneToday/recordsPendientesValidacion/cumplHoy — ningún cálculo duplicado', () => {
    expect(src).toContain("dashHeroCard('Vencidos', counts.ROJO, 'red', 'vencidos')");
    expect(src).toContain('pendientesHoyList.length');
    expect(src).toContain('proximosSinHoy.length');
    expect(src).toContain("dashHeroCard('Realizados hoy', doneToday, 'green'");
    expect(src).toContain('recordsPendientesValidacion.length');
    expect(src).toContain('cumplHoy.pct');
  });
});

describe('I — Indicadores secundarios: menor peso visual (dashActivityCard, no dashHeroCard), al final', () => {
  it('Al día/Sin plan/Pausados/Anomalías abiertas/Total equipos usan dashActivityCard', () => {
    const iSec = src.indexOf('<h2 class="dash-section-title">Indicadores secundarios</h2>');
    const seccionSrc = src.slice(iSec);
    expect(seccionSrc).toContain("dashActivityCard('Al día'");
    expect(seccionSrc).toContain("dashActivityCard('Sin plan'");
    expect(seccionSrc).toContain("dashActivityCard('Pausados'");
    expect(seccionSrc).toContain("dashActivityCard('Anomalías abiertas'");
    expect(seccionSrc).toContain("dashActivityCard('Total equipos'");
    expect(seccionSrc).not.toContain('dashHeroCard(');
  });
});
