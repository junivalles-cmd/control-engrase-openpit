// Validación de cambios de horómetro (evita errores de digitación al
// registrar un engrase). Prueba validateHourmeterChange(), código real
// extraído de app.js.
import { describe, it, expect } from 'vitest';
import { loadAppLogic } from '../helpers/loadLubricationLogic.js';

const fakeApp = {
  currentUser: null,
  generalSettings: { shiftDayStart: 6, shiftNightStart: 18, defaultAlertYellowHours: 10, complianceTarget: 95 },
};
const { validateHourmeterChange } = loadAppLogic(fakeApp);

describe('validateHourmeterChange()', () => {
  it('valor normal, mayor al anterior -> ok', () => {
    expect(validateHourmeterChange(1000, 1010)).toEqual({ ok: true });
  });

  it('mismo valor que el anterior -> ok (no bajó, no es un salto)', () => {
    expect(validateHourmeterChange(1000, 1000)).toEqual({ ok: true });
  });

  it('valor menor al anterior -> rechazado (el horómetro nunca debería bajar)', () => {
    const r = validateHourmeterChange(1000, 990);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/menor al actual/);
  });

  it('valor negativo -> rechazado', () => {
    const r = validateHourmeterChange(1000, -5);
    expect(r.ok).toBe(false);
  });

  it('NaN -> rechazado', () => {
    const r = validateHourmeterChange(1000, NaN);
    expect(r.ok).toBe(false);
  });

  it('salto grande (>500h de una vez) -> advertencia, no bloqueo directo', () => {
    const r = validateHourmeterChange(1000, 1600);
    expect(r.ok).toBe('warn');
    expect(r.message).toMatch(/salto grande/);
  });

  it('salto de exactamente 500h -> ok (el límite es ">500", no ">=500")', () => {
    expect(validateHourmeterChange(1000, 1500)).toEqual({ ok: true });
  });

  it('salto de 501h -> advertencia', () => {
    const r = validateHourmeterChange(1000, 1501);
    expect(r.ok).toBe('warn');
  });
});
