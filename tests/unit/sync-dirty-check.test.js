// Prioridad Paso 9: sincronización. NO se conecta a Supabase, NO escribe ni
// borra datos reales — solo documenta, con mocks/objetos locales, dos reglas
// de negocio puras que gobiernan sync.js:
//
//   1) qué registros hace falta subir (_pushedVersion !== updatedAt)
//   2) en qué orden sincroniza un dispositivo nuevo (bajar antes de subir)
//
// Sync.pushAll()/pullAll()/fullSync() en sí mismos están fuertemente
// acoplados a fetch() (red real a Supabase) y a DB (IndexedDB real), y no se
// pueden ejecutar en este entorno de pruebas sin mockear ambos por completo.
// REQUIERE EXTRACCIÓN DURANTE MODULARIZACIÓN (ver docs/AUTOMATED_TESTS.md).
import { describe, it, expect } from 'vitest';

describe('Regla "necesita subirse" (documenta sync.js:144 `rows.filter(r => r._pushedVersion !== r.updatedAt)`)', () => {
  const needsPush = (r) => r._pushedVersion !== r.updatedAt;

  it('registro nuevo, nunca subido (_pushedVersion undefined) -> necesita subirse', () => {
    expect(needsPush({ updatedAt: '2026-01-01T00:00:00.000Z' })).toBe(true);
  });

  it('registro ya sincronizado (_pushedVersion === updatedAt) -> NO necesita subirse', () => {
    const v = '2026-01-01T00:00:00.000Z';
    expect(needsPush({ updatedAt: v, _pushedVersion: v })).toBe(false);
  });

  it('registro editado después del último push (updatedAt cambió) -> necesita subirse de nuevo', () => {
    expect(needsPush({ updatedAt: '2026-01-02T00:00:00.000Z', _pushedVersion: '2026-01-01T00:00:00.000Z' })).toBe(true);
  });

  it('una lista mixta separa correctamente los pendientes de los ya sincronizados', () => {
    const rows = [
      { id: 1, updatedAt: 'a', _pushedVersion: 'a' }, // sincronizado
      { id: 2, updatedAt: 'b', _pushedVersion: undefined }, // nuevo
      { id: 3, updatedAt: 'd', _pushedVersion: 'c' }, // editado tras el último push
    ];
    const pendientes = rows.filter(needsPush).map((r) => r.id);
    expect(pendientes).toEqual([2, 3]);
  });
});

describe('Orden de sincronización para dispositivo nuevo (documenta sync.js:240-247 `fullSync`)', () => {
  // esPrimeraVez = !cfg.lastPull — si el dispositivo nunca ha hecho pull,
  // se BAJA antes de SUBIR, para no revivir en el servidor lo que el
  // administrador ya había borrado con el catálogo semilla local.
  function ordenDeSincronizacion(cfg) {
    const esPrimeraVez = !cfg.lastPull;
    return esPrimeraVez ? ['pull', 'push'] : ['push', 'pull'];
  }

  it('dispositivo nuevo (sin lastPull) -> DESCARGAR antes de SUBIR', () => {
    expect(ordenDeSincronizacion({})).toEqual(['pull', 'push']);
  });

  it('dispositivo que ya sincronizó antes -> SUBIR antes de DESCARGAR', () => {
    expect(ordenDeSincronizacion({ lastPull: '2026-01-01T00:00:00.000Z' })).toEqual(['push', 'pull']);
  });
});

describe('Detección de "ya existe en el servidor" al descargar (documenta sync.js:215-216 en pullAll)', () => {
  // Si el registro entrante coincide en _pushedVersion con el existente local,
  // se conserva esa marca (ya está sincronizado en ambos lados).
  function mergeEntrante(existing, entrante) {
    if (existing && existing._pushedVersion === entrante.updatedAt) {
      return { ...entrante, _pushedVersion: existing._pushedVersion };
    }
    return entrante;
  }

  it('el registro entrante coincide con lo ya sincronizado -> conserva _pushedVersion', () => {
    const existing = { id: 1, updatedAt: 'a', _pushedVersion: 'a' };
    const entrante = { id: 1, updatedAt: 'a' };
    expect(mergeEntrante(existing, entrante)._pushedVersion).toBe('a');
  });

  it('no existe localmente todavía -> se guarda tal cual llega (sin _pushedVersion propio)', () => {
    const entrante = { id: 2, updatedAt: 'x' };
    expect(mergeEntrante(null, entrante)._pushedVersion).toBeUndefined();
  });
});
