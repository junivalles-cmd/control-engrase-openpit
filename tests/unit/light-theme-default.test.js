// tests/unit/light-theme-default.test.js
//
// Tema claro por defecto en instalaciones sin preferencia guardada. Prueba a
// nivel de código fuente (igual que grease-unit-label.test.js): getTheme() usa
// localStorage + document, así que se verifica el texto real de app.js en vez
// de ejecutarlo (entorno de test sin DOM, ver vitest.config.js). Confirma que
// el valor por defecto cambió a 'light' y que la preferencia guardada sigue
// ganando siempre (Object.assign la sobrescribe, sin tocar esa línea).

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const getThemeSrc = extractDeclaration(appSource, 'getTheme');

describe('getTheme() — modo por defecto', () => {
  it('el valor por defecto (sin preferencia guardada) es light', () => {
    // El acento default cambió a 'teal' (rediseño visual 2026-10-08, nuevo
    // preset recomendado) — el valor que esta prueba protege es el MODO
    // ('light'), nunca el acento, así que el regex ya no fija 'amber'.
    expect(getThemeSrc).toMatch(/\{\s*accent:\s*'[\w-]+',\s*mode:\s*'light'\s*\}/);
  });

  it('ya no queda ningún default en dark', () => {
    expect(getThemeSrc).not.toContain("mode: 'dark'");
  });

  it('la preferencia guardada sigue ganando sobre el default (Object.assign la sobrescribe)', () => {
    expect(getThemeSrc).toMatch(/Object\.assign\(\{[^}]*\},\s*JSON\.parse\(localStorage\.getItem\('engrase_theme'\)\)/);
  });

  it('el catch (localStorage corrupto/no disponible) también cae en light, no en dark', () => {
    const catchBlock = getThemeSrc.slice(getThemeSrc.indexOf('catch'));
    expect(catchBlock).toContain("mode: 'light'");
    expect(catchBlock).not.toContain("mode: 'dark'");
  });

  it('el selector conserva Claro/Oscuro/Sol y retira Alto Contraste', () => {
    expect(appSource).toMatch(/\{\s*id:\s*'light',\s*label:\s*'Claro'/);
    expect(appSource).toMatch(/\{\s*id:\s*'dark',\s*label:\s*'Oscuro'/);
    expect(appSource).toMatch(/\{\s*id:\s*'sun',\s*label:\s*'Modo Sol \/ Alta luz'/);
    expect(appSource).not.toMatch(/\{\s*id:\s*'contrast',\s*label:/);
    expect(appSource).toContain('data-mode="${m.id}"');
  });
});
