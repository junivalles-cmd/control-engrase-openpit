// Prioridad Paso 10: pruebas de seguridad básicas posibles sin tocar la
// arquitectura (no hay migración Auth/RLS todavía). Prueba esc(), la función
// real de app.js que escapa texto antes de insertarlo como HTML (usada en
// prácticamente toda la interfaz para evitar XSS por datos de usuario).
import { describe, it, expect } from 'vitest';
import { loadAppLogic, loadDbLogic } from '../helpers/loadLubricationLogic.js';

const fakeApp = {
  currentUser: null,
  generalSettings: { shiftDayStart: 6, shiftNightStart: 18, defaultAlertYellowHours: 10, complianceTarget: 95 },
};
const { esc } = loadAppLogic(fakeApp);

describe('esc() — escape de texto antes de insertarlo como HTML', () => {
  it('escapa < y > (evita inyectar etiquetas)', () => {
    expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapa comillas dobles y simples (evita romper atributos HTML)', () => {
    expect(esc(`He said "hi" and 'bye'`)).toBe('He said &quot;hi&quot; and &#39;bye&#39;');
  });

  it('escapa & (para no corromper otras entidades)', () => {
    expect(esc('Tuercas & Pernos')).toBe('Tuercas &amp; Pernos');
  });

  it('null -> cadena vacía (no lanza error, no imprime "null")', () => {
    expect(esc(null)).toBe('');
  });

  it('undefined -> cadena vacía', () => {
    expect(esc(undefined)).toBe('');
  });

  it('número -> se convierte a texto sin romper', () => {
    expect(esc(1234)).toBe('1234');
  });

  it('texto normal sin caracteres especiales -> queda igual', () => {
    expect(esc('Excavadora CAT 336')).toBe('Excavadora CAT 336');
  });

  it('intento de inyección de atributo (onerror=) queda inerte tras escapar comillas', () => {
    const maligno = `"><img src=x onerror=alert(1)>`;
    const out = esc(maligno);
    expect(out).not.toContain('"');
    expect(out).toContain('&quot;');
  });
});

describe('stamp() con objetos incompletos (datos de versiones anteriores) — no debe lanzar', () => {
  const { stamp } = loadDbLogic();

  it('objeto vacío -> no lanza, produce un registro válido', () => {
    expect(() => stamp({}, 'tester')).not.toThrow();
  });

  it('sin nombre de usuario (undefined) -> usa "sistema" como respaldo', () => {
    const obj = stamp({}, undefined);
    expect(obj.createdBy).toBe('sistema');
  });

  it('objeto con campos extra desconocidos (de una versión futura) se conserva tal cual, sin perder datos', () => {
    const obj = stamp({ campoQueAunNoExisteEnEstaVersion: 'valor' }, 'tester');
    expect(obj.campoQueAunNoExisteEnEstaVersion).toBe('valor');
  });
});
