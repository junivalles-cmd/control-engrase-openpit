// tests/unit/historial-equipo-search.test.js
//
// Historial → "Buscar en todo el historial": buscador único por equipo,
// parcial y sin distinguir mayúsculas/minúsculas, sobre campos YA existentes
// (código, código ahorrativo, marca, modelo, descripción, N° de serie,
// familia/tipo, ubicación). Prueba la función REAL equoMatchesQuery()
// (app.js) extraída y ejecutada tal cual — sin reimplementar el matching a
// mano.

import { describe, it, expect, beforeAll } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

let equipoMatchesQuery;

beforeAll(() => {
  const src = extractDeclaration(readSource(APP_JS_PATH), 'equipoMatchesQuery');
  equipoMatchesQuery = new Function('eq', 'type', 'location', 'query', `${src}\nreturn equipoMatchesQuery(eq, type, location, query);`);
});

const eq = {
  code: 'T-06', shortCode: 'A04', brand: 'Caterpillar', model: 'D8T',
  description: 'Tractor de oruga', serial: 'CAT0D8T12345',
};
const type = { name: 'Tractor de Oruga' };
const location = { name: 'Rajo Principal · Volcán' };

describe('equipoMatchesQuery() — búsqueda parcial, case-insensitive, multi-campo', () => {
  it('coincide por código (parcial)', () => {
    expect(equipoMatchesQuery(eq, type, location, 'T-06')).toBe(true);
  });
  it('coincide por código en minúsculas', () => {
    expect(equipoMatchesQuery(eq, type, location, 't-06')).toBe(true);
  });
  it('coincide por código ahorrativo', () => {
    expect(equipoMatchesQuery(eq, type, location, 'A04')).toBe(true);
  });
  it('coincide por código ahorrativo con formato "05-68" (ejemplo del pedido)', () => {
    const eq2 = { ...eq, shortCode: '05-68' };
    expect(equipoMatchesQuery(eq2, type, location, '05-68')).toBe(true);
  });
  it('coincide por marca', () => {
    expect(equipoMatchesQuery(eq, type, location, 'caterpillar')).toBe(true);
  });
  it('coincide por modelo (parcial, minúsculas)', () => {
    expect(equipoMatchesQuery(eq, type, location, 'd8t')).toBe(true);
  });
  it('coincide por familia/tipo', () => {
    expect(equipoMatchesQuery(eq, type, location, 'oruga')).toBe(true);
  });
  it('coincide por ubicación (parcial, ej. "Volcán")', () => {
    expect(equipoMatchesQuery(eq, type, location, 'Volcán')).toBe(true);
  });
  it('coincide por descripción', () => {
    expect(equipoMatchesQuery(eq, type, location, 'tractor')).toBe(true);
  });
  it('coincide por N° de serie', () => {
    expect(equipoMatchesQuery(eq, type, location, 'CAT0D8T')).toBe(true);
  });
  it('no coincide con texto ajeno', () => {
    expect(equipoMatchesQuery(eq, type, location, 'excavadora')).toBe(false);
  });
  it('query vacío coincide con todo (sin filtrar)', () => {
    expect(equipoMatchesQuery(eq, type, location, '')).toBe(true);
    expect(equipoMatchesQuery(eq, type, location, '   ')).toBe(true);
  });
  it('funciona sin type/location (equipo sin familia/ubicación asignada)', () => {
    expect(equipoMatchesQuery(eq, undefined, undefined, 'D8T')).toBe(true);
    // 'Maquinaria Pesada' solo existiría en type.name — al no pasarse type,
    // no debe encontrarse en ningún otro campo del equipo.
    expect(equipoMatchesQuery(eq, undefined, undefined, 'Maquinaria Pesada')).toBe(false);
  });
});
