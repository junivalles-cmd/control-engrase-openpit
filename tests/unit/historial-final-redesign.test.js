// tests/unit/historial-final-redesign.test.js
//
// LOTE COMBINADO — Historial. Dos niveles:
//  1) Fuente: confirma en el código REAL de renderHistorial() lo que no se
//     puede verificar con un fixture estático (orden en el template,
//     ausencia de botones, debounce, encadenado AND de filtros).
//  2) Combinación AND de filtros: ejecuta la función REAL equipoMatchesQuery()
//     (mismo criterio que usa runGeneralSearch() para el texto) combinada con
//     los mismos predicados triviales de igualdad/rango que usa el código
//     fuente para turno/estado/fechas — no se reimplementa equipoMatchesQuery,
//     solo se encadena tal como lo hace runGeneralSearch() (equipos → query →
//     estado → records → turno/fechas, todo AND por construcción de
//     `.filter()` en cadena).

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const src = extractDeclaration(appSource, 'renderHistorial');
const equipoMatchesQuerySrc = extractDeclaration(appSource, 'equipoMatchesQuery');
const equipoMatchesQuery = new Function(`${equipoMatchesQuerySrc}\nreturn equipoMatchesQuery;`)();

describe('A1 — Historial por equipo ARRIBA, sin botón Buscar, con debounce', () => {
  it('el panel "Historial por equipo" aparece ANTES que "Historial global" en el template', () => {
    const iEquipo = src.indexOf('id="hist-eq-panel"');
    const iGlobal = src.indexOf('hist-global-panel');
    expect(iEquipo).toBeGreaterThan(-1);
    expect(iGlobal).toBeGreaterThan(-1);
    expect(iEquipo).toBeLessThan(iGlobal);
  });

  it('ningún buscador (equipo ni global) tiene botón Buscar — ambos buscan con debounce', () => {
    expect(src).not.toContain('id="gh-apply"');
    expect(src).not.toContain('id="hist-eq-apply"');
    expect(src).toMatch(/setTimeout\(buscar,\s*280\)/);
    expect(src).toMatch(/setTimeout\(runGeneralSearch,\s*280\)/);
  });
});

describe('Historial global — textbox full-width + 4 filtros, todo AND, sin Familia', () => {
  it('reincorpora el textbox global (gh-search) además de Desde/Hasta/Turno/Estado', () => {
    expect(src).toContain('id="gh-search"');
    expect(src).toContain('id="gh-from"');
    expect(src).toContain('id="gh-to"');
    expect(src).toContain('id="gh-turno"');
    expect(src).toContain('id="gh-estado"');
    expect(src).not.toContain('id="gh-familia"');
  });

  it('gh-search se cablea a "input" con debounce, los demás a "change" (auto-actualiza, sin botón)', () => {
    expect(src).toMatch(/gh-search'\)\.addEventListener\('input'/);
    expect(src).toMatch(/gh-from'\)\.addEventListener\('change', runGeneralSearch\)/);
    expect(src).toMatch(/gh-to'\)\.addEventListener\('change', runGeneralSearch\)/);
    expect(src).toMatch(/gh-turno'\)\.addEventListener\('change', runGeneralSearch\)/);
    expect(src).toMatch(/gh-estado'\)\.addEventListener\('change', runGeneralSearch\)/);
  });

  it('runGeneralSearch encadena query Y estado sobre matchEquipos (AND, no OR)', () => {
    const fnSrc = src.slice(src.indexOf('async function runGeneralSearch'));
    const iQuery = fnSrc.indexOf('if (query.trim())');
    const iEstado = fnSrc.indexOf('if (estado)');
    expect(iQuery).toBeGreaterThan(-1);
    expect(iEstado).toBeGreaterThan(-1);
    // Ambos reasignan matchEquipos (encadenado), no una rama if/else excluyente.
    expect(fnSrc).toMatch(/matchEquipos = matchEquipos\.filter\(e => equipoMatchesQuery/);
    expect(fnSrc).toMatch(/matchEquipos = matchEquipos\.filter\(e => okIds\.has/);
  });

  it('el contador y el CSV se movieron a #gh-summary (fila 2, junto a los filtros)', () => {
    expect(src).toContain("$('#gh-summary').innerHTML");
  });
});

describe('Combinación AND real (equipoMatchesQuery + turno/estado/fechas) — casos pedidos', () => {
  const equipos = [
    { id: 'e1', code: 'T-06', brand: 'Caterpillar', model: 'D8T', typeId: 't1', locationId: 'l1', status: 'Operativo' },
    { id: 'e2', code: 'EXC-02', brand: 'Komatsu', model: 'PC200', typeId: 't2', locationId: 'l2', status: 'Operativo' },
  ];
  const types = { t1: { name: 'Tractor de Oruga' }, t2: { name: 'Excavadora' } };
  const locs = { l1: { name: 'Volcán' }, l2: { name: 'Rajo Principal' } };
  const records = [
    { equipmentId: 'e1', date: '2026-09-10T08:00:00', shiftId: 'shift_dia' },
    { equipmentId: 'e1', date: '2026-09-20T20:00:00', shiftId: 'shift_noche' },
    { equipmentId: 'e2', date: '2026-09-20T08:00:00', shiftId: 'shift_dia' },
  ];
  const matchByQuery = (q) => equipos.filter(e => equipoMatchesQuery(e, types[e.typeId], locs[e.locationId], q));
  const recordsFor = (matchEquipos, { from, to, turno } = {}) => {
    const ids = new Set(matchEquipos.map(e => e.id));
    return records.filter(r => {
      if (!ids.has(r.equipmentId)) return false;
      const d = new Date(r.date);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (turno && r.shiftId !== turno) return false;
      return true;
    });
  };

  it('texto solo: "D8T" → solo registros de T-06', () => {
    const res = recordsFor(matchByQuery('D8T'));
    expect(res.map(r => r.equipmentId)).toEqual(['e1', 'e1']);
  });

  it('texto + turno: "D8T" + Noche → solo el registro de T-06 en turno noche', () => {
    const res = recordsFor(matchByQuery('D8T'), { turno: 'shift_noche' });
    expect(res).toHaveLength(1);
    expect(res[0].date).toBe('2026-09-20T20:00:00');
  });

  it('texto + estado: "Volcán" (ubicación) simulando estado Operativo → T-06 pasa ambos filtros', () => {
    const porTexto = matchByQuery('Volcán');
    const porEstado = porTexto.filter(e => e.status === 'Operativo'); // mismo AND que estado en runGeneralSearch
    expect(porEstado.map(e => e.id)).toEqual(['e1']);
  });

  it('texto + rango de fechas: "D8T" + desde 15/09 → excluye el registro del 10/09', () => {
    const res = recordsFor(matchByQuery('D8T'), { from: new Date('2026-09-15T00:00:00') });
    expect(res).toHaveLength(1);
    expect(res[0].date).toBe('2026-09-20T20:00:00');
  });

  it('texto + turno + estado + fechas combinados: las 4 condiciones deben cumplirse a la vez', () => {
    const porTexto = matchByQuery('D8T');
    const porEstado = porTexto.filter(e => e.status === 'Operativo');
    const res = recordsFor(porEstado, { from: new Date('2026-09-01T00:00:00'), to: new Date('2026-09-30T23:59:59'), turno: 'shift_dia' });
    // El único registro de T-06 en turno Día (10/09) SÍ cumple las 4; el de Noche (20/09) no.
    expect(res).toHaveLength(1);
    expect(res[0].shiftId).toBe('shift_dia');
  });

  it('quitar un filtro (turno) restaura los resultados que ese filtro excluía', () => {
    const conTurno = recordsFor(matchByQuery('D8T'), { turno: 'shift_noche' });
    const sinTurno = recordsFor(matchByQuery('D8T'));
    expect(conTurno).toHaveLength(1);
    expect(sinTurno).toHaveLength(2); // vuelven a aparecer ambos registros de T-06
  });

  it('filtro vacío ("") no restringe — equivalente a sin texto', () => {
    expect(matchByQuery('')).toHaveLength(equipos.length);
  });
});
