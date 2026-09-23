// Prioridad Paso 7 #1-#3: turno Día, turno Noche, y el cruce de medianoche
// durante el turno Noche. Se prueban currentShiftId() y dentroDeSuTurno(),
// código real extraído de app.js — no se reescribe la lógica.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadAppLogic } from '../helpers/loadLubricationLogic.js';

function appAt(hour, minute, overrides = {}) {
  const fakeApp = {
    currentUser: { role: 'LUBRICADOR', shiftId: null },
    generalSettings: { shiftDayStart: 6, shiftNightStart: 18, defaultAlertYellowHours: 10, complianceTarget: 95 },
    ...overrides,
  };
  const d = new Date(2026, 0, 15, hour, minute, 0, 0); // miércoles cualquiera
  return { fakeApp, date: d };
}

describe('currentShiftId() — determinación de turno Día/Noche', () => {
  beforeEach(() => { /* nada por defecto; cada test fija su propia hora */ });
  afterEach(() => { vi.useRealTimers(); });

  // Config por defecto: día 06:00–17:59, noche 18:00–05:59
  const casos = [
    ['17:59 (último minuto de turno Día)', 17, 59, 'shift_dia'],
    ['18:00 (arranca turno Noche)', 18, 0, 'shift_noche'],
    ['23:59 (noche, antes de medianoche)', 23, 59, 'shift_noche'],
    ['00:00 (medianoche, sigue turno Noche)', 0, 0, 'shift_noche'],
    ['00:01 (recién cruzada la medianoche)', 0, 1, 'shift_noche'],
    ['05:59 (último minuto de turno Noche)', 5, 59, 'shift_noche'],
    ['06:00 (arranca turno Día)', 6, 0, 'shift_dia'],
  ];

  for (const [nombre, hour, minute, esperado] of casos) {
    it(nombre, () => {
      const { fakeApp, date } = appAt(hour, minute);
      vi.useFakeTimers();
      vi.setSystemTime(date);
      const { currentShiftId } = loadAppLogic(fakeApp);
      expect(currentShiftId()).toBe(esperado);
      vi.useRealTimers();
    });
  }
});

describe('dentroDeSuTurno() — ventana de avisos del Lubricador (cruza medianoche en turno Noche)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('respeta soloEnTurno=false: siempre true sin importar la hora', () => {
    const { fakeApp, date } = appAt(12, 0);
    vi.useFakeTimers(); vi.setSystemTime(date);
    const { dentroDeSuTurno } = loadAppLogic(fakeApp);
    expect(dentroDeSuTurno({ soloEnTurno: false }, date)).toBe(true);
  });

  it('jefaturas (no LUBRICADOR) siempre están "dentro de turno"', () => {
    const { fakeApp, date } = appAt(3, 0, { currentUser: { role: 'ADMINISTRADOR' } });
    vi.useFakeTimers(); vi.setSystemTime(date);
    const { dentroDeSuTurno } = loadAppLogic(fakeApp);
    expect(dentroDeSuTurno({ soloEnTurno: true }, date)).toBe(true);
  });

  it('lubricador de turno Noche a las 00:01 (recién cruzada la medianoche) sigue "dentro de turno"', () => {
    const { fakeApp, date } = appAt(0, 1, { currentUser: { role: 'LUBRICADOR', shiftId: 'shift_noche' } });
    vi.useFakeTimers(); vi.setSystemTime(date);
    const { dentroDeSuTurno } = loadAppLogic(fakeApp);
    expect(dentroDeSuTurno({ soloEnTurno: true, minutosAntesDelTurno: 15, minutosDespuesDelTurno: 30 }, date)).toBe(true);
  });

  it('lubricador de turno Noche a las 12:00 del mediodía NO está en su turno', () => {
    const { fakeApp, date } = appAt(12, 0, { currentUser: { role: 'LUBRICADOR', shiftId: 'shift_noche' } });
    vi.useFakeTimers(); vi.setSystemTime(date);
    const { dentroDeSuTurno } = loadAppLogic(fakeApp);
    expect(dentroDeSuTurno({ soloEnTurno: true, minutosAntesDelTurno: 15, minutosDespuesDelTurno: 30 }, date)).toBe(false);
  });

  it('lubricador de turno Día a las 05:30 (bien antes de su entrada, fuera del margen de 15 min) NO está en su turno', () => {
    // margen: entra desde 5:45 (6:00 - 15min); 5:30 queda fuera de ese margen
    const { fakeApp, date } = appAt(5, 30, { currentUser: { role: 'LUBRICADOR', shiftId: 'shift_dia' } });
    vi.useFakeTimers(); vi.setSystemTime(date);
    const { dentroDeSuTurno } = loadAppLogic(fakeApp);
    expect(dentroDeSuTurno({ soloEnTurno: true, minutosAntesDelTurno: 15, minutosDespuesDelTurno: 30 }, date)).toBe(false);
  });

  it('lubricador de turno Día a las 05:50 SÍ entra con el margen de 15 min antes', () => {
    const { fakeApp, date } = appAt(5, 46, { currentUser: { role: 'LUBRICADOR', shiftId: 'shift_dia' } });
    vi.useFakeTimers(); vi.setSystemTime(date);
    const { dentroDeSuTurno } = loadAppLogic(fakeApp);
    // 6:00 - 15min = 5:45 -> a las 5:46 ya debería contar como dentro
    expect(dentroDeSuTurno({ soloEnTurno: true, minutosAntesDelTurno: 15, minutosDespuesDelTurno: 30 }, date)).toBe(true);
  });
});
