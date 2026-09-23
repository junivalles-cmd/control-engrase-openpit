// Prioridad Paso 7 #4-#12: pendiente / realizado / vencido, plan por
// frecuencia de horómetro (exacto, mayor, menor, null, inválido).
// Prueba statusFor(), código real extraído de app.js.
import { describe, it, expect } from 'vitest';
import { loadAppLogic } from '../helpers/loadLubricationLogic.js';

const fakeApp = {
  currentUser: null,
  generalSettings: { shiftDayStart: 6, shiftNightStart: 18, defaultAlertYellowHours: 10, complianceTarget: 95 },
};
const { statusFor } = loadAppLogic(fakeApp);

const planHorometro = (over = {}) => ({
  id: 'plan1', equipmentId: 'e1', controlType: 'Horómetro',
  frequency: 250, lastGreaseHour: 1000, alertYellowHours: 10, ...over,
});
const equipo = (over = {}) => ({ id: 'e1', status: 'Operativo', hourmeter: 1000, ...over });

describe('statusFor() — equipo fuera de servicio o sin plan', () => {
  it('equipo no Operativo -> DETENIDO, sin importar el plan', async () => {
    const r = await statusFor(equipo({ status: 'En taller' }), [planHorometro()], []);
    expect(r).toMatchObject({ code: 'GRIS', label: 'DETENIDO' });
  });

  it('sin plan asignado -> SIN PLAN', async () => {
    const r = await statusFor(equipo(), [], []);
    expect(r).toMatchObject({ code: 'GRIS', label: 'SIN PLAN' });
  });
});

describe('statusFor() — plan por frecuencia de horómetro', () => {
  it('frecuencia 0 -> PLAN MAL CONFIGURADO (evita quedar vencido para siempre)', async () => {
    const r = await statusFor(equipo(), [planHorometro({ frequency: 0 })], []);
    expect(r).toMatchObject({ code: 'GRIS', label: 'PLAN MAL CONFIGURADO' });
  });

  it('frecuencia negativa -> PLAN MAL CONFIGURADO', async () => {
    const r = await statusFor(equipo(), [planHorometro({ frequency: -50 })], []);
    expect(r).toMatchObject({ code: 'GRIS', label: 'PLAN MAL CONFIGURADO' });
  });

  it('lastGreaseHour mayor al horómetro actual -> DATOS INCONSISTENTES', async () => {
    const r = await statusFor(equipo({ hourmeter: 900 }), [planHorometro({ lastGreaseHour: 1000 })], []);
    expect(r).toMatchObject({ code: 'GRIS', label: 'DATOS INCONSISTENTES' });
  });

  it('horómetro null -> tratado como 0, dispara DATOS INCONSISTENTES (no revienta ni oculta el problema)', async () => {
    const r = await statusFor(equipo({ hourmeter: null }), [planHorometro({ lastGreaseHour: 1000 })], []);
    expect(r).toMatchObject({ code: 'GRIS', label: 'DATOS INCONSISTENTES' });
  });

  it('horómetro mayor a frecuencia (vencido) -> ROJO / VENCIDO', async () => {
    // próximo = 1000 + 250 = 1250; horómetro 1260 -> restante -10
    const r = await statusFor(equipo({ hourmeter: 1260 }), [planHorometro()], []);
    expect(r).toMatchObject({ code: 'ROJO', label: 'VENCIDO', remaining: -10 });
  });

  it('horómetro EXACTAMENTE en la frecuencia -> AMARILLO / PRÓXIMO (no VERDE, no ROJO)', async () => {
    // próximo = 1250; horómetro 1250 -> restante 0, dentro de alertYellowHours
    const r = await statusFor(equipo({ hourmeter: 1250 }), [planHorometro()], []);
    expect(r).toMatchObject({ code: 'AMARILLO', label: 'PRÓXIMO', remaining: 0 });
  });

  it('horómetro dentro de la ventana de alerta amarilla -> AMARILLO / PRÓXIMO', async () => {
    // restante 5, <= alertYellowHours (10)
    const r = await statusFor(equipo({ hourmeter: 1245 }), [planHorometro()], []);
    expect(r).toMatchObject({ code: 'AMARILLO', label: 'PRÓXIMO', remaining: 5 });
  });

  it('horómetro menor a frecuencia, fuera de la ventana de alerta -> VERDE / AL DÍA', async () => {
    // restante 50, > alertYellowHours (10)
    const r = await statusFor(equipo({ hourmeter: 1200 }), [planHorometro()], []);
    expect(r).toMatchObject({ code: 'VERDE', label: 'AL DÍA', remaining: 50 });
  });

  // ENGRASE-001 (docs/BUG_REGISTER.md): un horómetro que no es un número
  // válido debe marcarse como dato inconsistente, NUNCA como "AL DÍA".
  // Estas pruebas representan el comportamiento CORRECTO esperado, no el
  // que tenía el código antes de corregirse.
  describe('ENGRASE-001 — horómetro inválido debe marcarse como dato inconsistente', () => {
    it('hourmeter = "abc" (string no numérico) -> GRIS / DATOS INCONSISTENTES', async () => {
      const r = await statusFor(equipo({ hourmeter: 'abc' }), [planHorometro()], []);
      expect(r).toMatchObject({ code: 'GRIS', label: 'DATOS INCONSISTENTES' });
      expect(r.remaining).toBeNull();
    });

    it('hourmeter = undefined -> GRIS / DATOS INCONSISTENTES', async () => {
      const r = await statusFor(equipo({ hourmeter: undefined }), [planHorometro()], []);
      expect(r).toMatchObject({ code: 'GRIS', label: 'DATOS INCONSISTENTES' });
      expect(r.remaining).toBeNull();
    });

    it('hourmeter = "" (string vacío) -> GRIS / DATOS INCONSISTENTES', async () => {
      const r = await statusFor(equipo({ hourmeter: '' }), [planHorometro()], []);
      expect(r).toMatchObject({ code: 'GRIS', label: 'DATOS INCONSISTENTES' });
      expect(r.remaining).toBeNull();
    });

    it('hourmeter = NaN (número inválido) -> GRIS / DATOS INCONSISTENTES', async () => {
      const r = await statusFor(equipo({ hourmeter: NaN }), [planHorometro()], []);
      expect(r).toMatchObject({ code: 'GRIS', label: 'DATOS INCONSISTENTES' });
      expect(r.remaining).toBeNull();
    });

    it('hourmeter = null sigue marcando DATOS INCONSISTENTES (ya funcionaba, no debe regresar)', async () => {
      const r = await statusFor(equipo({ hourmeter: null }), [planHorometro()], []);
      expect(r).toMatchObject({ code: 'GRIS', label: 'DATOS INCONSISTENTES' });
    });

    it('un número válido en formato string ("1200") también se marca inconsistente — se exige el tipo number real, sin coerción', async () => {
      // Decisión explícita: no se hace coerción de ningún tipo (ni siquiera
      // "segura") para no repetir el patrón que causó el bug original. El
      // formulario real siempre entrega un `number`; si llega como string,
      // es en sí mismo una señal de dato corrupto (por ejemplo de una
      // importación) y debe tratarse igual que cualquier otro valor inválido.
      const r = await statusFor(equipo({ hourmeter: '1200' }), [planHorometro()], []);
      expect(r).toMatchObject({ code: 'GRIS', label: 'DATOS INCONSISTENTES' });
    });

    it('nunca queda un remaining=NaN visible al usuario para ningún valor de horómetro', async () => {
      for (const valorInvalido of ['abc', undefined, '', NaN, {}, []]) {
        const r = await statusFor(equipo({ hourmeter: valorInvalido }), [planHorometro()], []);
        expect(Number.isNaN(r.remaining)).toBe(false);
      }
    });
  });
});
