// tests/unit/grease-unit-label.test.js
//
// Regresión: la unidad operativa real de la grasa es libras (lb) — la
// interfaz mostraba "kg" desde el commit baseline del proyecto, pero en
// campo siempre se digitó en libras (decisión confirmada por el usuario,
// ver docs/DECISIONS.md). Se corrigió únicamente la ETIQUETA, nunca el
// valor de `qty`/`recommendedQty`. Esta prueba no verifica lógica de
// negocio, solo que la etiqueta incorrecta no vuelva a aparecer.
import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, DB_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const dbSource = readSource(DB_JS_PATH);

describe('GREASE_UNIT (app.js)', () => {
  it('es la constante real "lb"', () => {
    const body = `${extractDeclaration(appSource, 'GREASE_UNIT')}\n\nreturn GREASE_UNIT;`;
    const GREASE_UNIT = new Function(body)();
    expect(GREASE_UNIT).toBe('lb');
  });
});

describe('Etiqueta de grasa: sin "kg" restante en las pantallas/exportaciones de engrase', () => {
  it('app.js no contiene la etiqueta incorrecta "(kg)"', () => {
    expect(appSource).not.toMatch(/\(kg\)/);
  });

  it('app.js no muestra cantidades con sufijo " kg" (plantillas de Historial/Plan de Engrase)', () => {
    expect(appSource).not.toMatch(/\}\s*kg</);
  });

  it('app.js no usa \'kg\' como unidad por defecto en el formulario/semilla de lubricante', () => {
    expect(appSource).not.toMatch(/unit:\s*'kg'/);
    expect(appSource).not.toMatch(/l\.unit \|\| 'kg'/);
  });

  it('db.js no siembra lubricantes nuevos con unit: \'kg\'', () => {
    expect(dbSource).not.toMatch(/unit:\s*'kg'/);
  });
});
