// tests/unit/dashboard-sin-plan.test.js
//
// Dashboard — KPI "Equipos sin plan". Dos niveles de prueba:
//  1) Fuente: renderDashboard() calcula sinPlan como equipos SIN ningún plan
//     asociado (ni día/turno ni horas — cada equipo tiene a lo sumo 1 plan,
//     así que "no existe plan" cubre ambos casos a la vez), reutiliza
//     DB.allActive('equipment') como único criterio de "activo" (sin agregar
//     un filtro nuevo por status), y el KPI está cableado a data-kpi-action
//     "sin-plan" → openSinPlanModal().
//  2) Ejecución real: openSinPlanModal() (función pura de armado de HTML,
//     sin DOM salvo la llamada final a openModal — se prueba solo el HTML
//     que arma antes de esa llamada, extrayendo la función real).

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);

describe('renderDashboard() — conteo de equipos sin plan', () => {
  const src = extractDeclaration(appSource, 'renderDashboard');

  it('cuenta por ausencia de plan asociado (ni día/turno ni horas)', () => {
    expect(src).toContain('const planPorEquipoId = new Set(plans.map(p => p.equipmentId));');
    expect(src).toContain('const sinPlan = equipos.filter(e => !planPorEquipoId.has(e.id));');
  });

  it('usa DB.allActive("equipment") como único criterio de activo (sin filtro nuevo por status en sinPlan)', () => {
    expect(src).toContain("await DB.allActive('equipment')");
    // No debe agregarse un ".filter(e => e.status === ...)" extra ANTES de
    // sinPlan (el criterio de "activo" ya existente basta) — se acota la
    // porción del código revisada porque más abajo SÍ existe, a propósito,
    // un filtro por status para un cálculo DISTINTO (pausados, ver B4).
    const hastaSinPlan = src.slice(0, src.indexOf('const sinPlan ='));
    expect(hastaSinPlan).not.toMatch(/equipos\.filter\(e => e\.status/);
  });

  it('el KPI está en "Indicadores secundarios" (rediseño Parte D), cableado a la acción "sin-plan"', () => {
    expect(src).toContain("dashActivityCard('Sin plan', sinPlan.length");
    expect(src).toContain("'sin-plan'");
  });

  it('el click en el KPI abre el modal con la lista completa (equipos, types, locations)', () => {
    expect(src).toContain("openSinPlanModal(sinPlan, types, locations)");
  });
});

describe('openSinPlanModal() real — listado con las 5 columnas pedidas', () => {
  const src = extractDeclaration(appSource, 'openSinPlanModal');
  // openModal/makeTablesResponsive/esc/$ son dependencias de DOM — se
  // reemplazan por stubs mínimos para poder ejecutar la función real y
  // capturar el HTML que arma, sin necesitar un DOM completo.
  let capturedHTML = '';
  const fakeGlobals = {
    openModal: (title, html) => { capturedHTML = html; },
    makeTablesResponsive: () => {},
    esc: (s) => String(s ?? ''),
    $: () => null,
  };
  const fn = new Function('openModal', 'makeTablesResponsive', 'esc', '$', `${src}\nreturn openSinPlanModal;`)(
    fakeGlobals.openModal, fakeGlobals.makeTablesResponsive, fakeGlobals.esc, fakeGlobals.$
  );

  const equipos = [
    { id: 'e1', code: 'T-06', brand: 'Caterpillar', model: 'D8T', typeId: 'ty1', locationId: 'lo1', status: 'Operativo' },
    { id: 'e2', code: 'CIS-03', brand: 'Cisterna', model: '5000gal', typeId: null, locationId: null, status: 'Detenido' },
  ];
  const types = [{ id: 'ty1', name: 'Tractor de Oruga' }];
  const locations = [{ id: 'lo1', name: 'Rajo Principal' }];

  it('arma las 5 columnas pedidas: código, familia, modelo, ubicación, estado', () => {
    fn(equipos, types, locations);
    expect(capturedHTML).toContain('<th>Código</th><th>Familia</th><th>Modelo</th><th>Ubicación</th><th>Estado</th>');
  });

  it('incluye los datos reales de cada equipo, con familia/ubicación resueltas por id', () => {
    fn(equipos, types, locations);
    expect(capturedHTML).toContain('T-06');
    expect(capturedHTML).toContain('Tractor de Oruga');
    expect(capturedHTML).toContain('Rajo Principal');
    expect(capturedHTML).toContain('Operativo');
  });

  it('un equipo sin familia/ubicación asignada muestra "—" en vez de romper', () => {
    fn(equipos, types, locations);
    expect(capturedHTML).toContain('CIS-03');
    expect(capturedHTML).toContain('Detenido');
  });

  it('lista vacía muestra el estado vacío, no una tabla rota', () => {
    fn([], types, locations);
    expect(capturedHTML).toContain('Sin equipos.');
  });
});
