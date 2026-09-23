// Prioridad Paso 8: borrado lógico (active:true/false). Un registro con
// active:false no debe reaparecer en listados normales.
//
// stamp() es una función real de db.js (agrega id/fechas/active por defecto
// a cualquier registro nuevo) — se prueba directamente, extraída del archivo
// fuente. DB.allActive() en sí usa IndexedDB real (this.all(store) vía una
// transacción) y no se puede ejecutar fuera del navegador sin un polyfill de
// IndexedDB (no instalado en esta fase) — así que el filtro que aplica
// (db.js línea 93: `rows.filter(r => r.active !== false)`) se prueba aquí
// como una regla de negocio documentada y aislada, no como el método real.
import { describe, it, expect } from 'vitest';
import { loadDbLogic } from '../helpers/loadLubricationLogic.js';

const { stamp } = loadDbLogic();

describe('stamp() — valores por defecto de un registro nuevo (db.js)', () => {
  it('un objeto nuevo sin "active" queda active:true por defecto', () => {
    const obj = stamp({}, 'tester');
    expect(obj.active).toBe(true);
  });

  it('si ya trae active:false explícito, NO lo sobrescribe a true', () => {
    const obj = stamp({ active: false }, 'tester');
    expect(obj.active).toBe(false);
  });

  it('genera id, createdAt y updatedAt si no existen', () => {
    const obj = stamp({}, 'tester');
    expect(obj.id).toBeTruthy();
    expect(obj.createdAt).toBeTruthy();
    expect(obj.updatedAt).toBeTruthy();
  });

  it('no pisa un id/createdAt ya existentes (por ejemplo, al editar un registro)', () => {
    const obj = stamp({ id: 'rec_fijo', createdAt: '2020-01-01T00:00:00.000Z' }, 'tester');
    expect(obj.id).toBe('rec_fijo');
    expect(obj.createdAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('siempre actualiza updatedAt, incluso en una edición', () => {
    const obj = stamp({ id: 'rec_fijo', updatedAt: '2020-01-01T00:00:00.000Z' }, 'tester');
    expect(obj.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('Filtro active!==false (documenta db.js:93 `allActive`, no ejecuta IndexedDB)', () => {
  const isActive = (r) => r.active !== false;

  it('active:true queda incluido', () => {
    expect(isActive({ active: true })).toBe(true);
  });

  it('active:false queda EXCLUIDO (borrado lógico)', () => {
    expect(isActive({ active: false })).toBe(false);
  });

  it('sin el campo "active" (undefined) queda incluido — registros viejos sin el campo siguen visibles', () => {
    expect(isActive({})).toBe(true);
  });

  it('una lista mixta filtra solo los active:false', () => {
    const rows = [
      { id: 1, active: true },
      { id: 2, active: false },
      { id: 3 },
      { id: 4, active: false },
    ];
    const visibles = rows.filter(isActive);
    expect(visibles.map((r) => r.id)).toEqual([1, 3]);
  });
});
