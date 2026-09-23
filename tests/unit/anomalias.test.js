// Prioridad Paso 7 #15-#16: criticidad automática de una anomalía generada
// desde un punto de engrase no atendido, y prevención de duplicados.
//
// CRITICIDAD_POR_MOTIVO es una constante top-level real de app.js — se prueba
// directamente. La función que la USA, createAutoAnomalies(), está fuertemente
// acoplada a IndexedDB (DB.allActive/DB.put) y a App.currentUser — no se puede
// probar de forma aislada sin mockear la base de datos completa.
// REQUIERE EXTRACCIÓN DURANTE MODULARIZACIÓN (ver docs/AUTOMATED_TESTS.md).
//
// La prueba de "no duplicar" de abajo documenta, con un mock mínimo y
// explícito de solo la forma de los datos (no de IndexedDB), la MISMA regla
// que usa createAutoAnomalies() en app.js (buscar por `autoPointId`) — no es
// el código real ejecutándose, es una prueba de la regla de negocio en sí.
import { describe, it, expect } from 'vitest';
import { loadAppLogic } from '../helpers/loadLubricationLogic.js';

const fakeApp = {
  currentUser: null,
  generalSettings: { shiftDayStart: 6, shiftNightStart: 18, defaultAlertYellowHours: 10, complianceTarget: 95 },
};
const { CRITICIDAD_POR_MOTIVO } = loadAppLogic(fakeApp);

describe('CRITICIDAD_POR_MOTIVO — criticidad automática por motivo de punto no atendido', () => {
  it('Falla mecánica -> Crítica', () => {
    expect(CRITICIDAD_POR_MOTIVO['Falla mecánica']).toBe('Crítica');
  });
  it('Grasera dañada -> Alta', () => {
    expect(CRITICIDAD_POR_MOTIVO['Grasera dañada']).toBe('Alta');
  });
  it('Sello dañado -> Alta', () => {
    expect(CRITICIDAD_POR_MOTIVO['Sello dañado']).toBe('Alta');
  });
  it('Falta de lubricante -> Media', () => {
    expect(CRITICIDAD_POR_MOTIVO['Falta de lubricante']).toBe('Media');
  });
  it('Equipo trabajando -> Baja', () => {
    expect(CRITICIDAD_POR_MOTIVO['Equipo trabajando']).toBe('Baja');
  });
  it('motivo desconocido no está en la tabla (el código real usa || "Media" como respaldo)', () => {
    expect(CRITICIDAD_POR_MOTIVO['Motivo inventado que no existe']).toBeUndefined();
  });
});

describe('Regla de no-duplicado de anomalías automáticas (documenta app.js:4817, no ejecuta el código real)', () => {
  function yaExisteAnomaliaAbierta(abiertas, pointId) {
    // Misma regla que createAutoAnomalies(): coincide por punto (autoPointId),
    // no por el motivo, para no duplicar si el lubricador elige un motivo distinto.
    return !!abiertas.find((a) => a.autoPointId && a.autoPointId === pointId);
  }

  it('no crea una segunda anomalía si ya hay una abierta para el mismo punto', () => {
    const abiertas = [{ id: 'a1', autoPointId: 'punto_123', status: 'Abierta' }];
    expect(yaExisteAnomaliaAbierta(abiertas, 'punto_123')).toBe(true);
  });

  it('sí permite crear una anomalía nueva para un punto distinto', () => {
    const abiertas = [{ id: 'a1', autoPointId: 'punto_123', status: 'Abierta' }];
    expect(yaExisteAnomaliaAbierta(abiertas, 'punto_999')).toBe(false);
  });

  it('una anomalía CERRADA para el mismo punto ya no cuenta (createAutoAnomalies solo mira status !== "Cerrada")', () => {
    // Esto refleja el filtro previo en app.js: abiertas = anomalies.filter(a => a.status !== 'Cerrada')
    const todas = [{ id: 'a1', autoPointId: 'punto_123', status: 'Cerrada' }];
    const abiertas = todas.filter((a) => a.status !== 'Cerrada');
    expect(yaExisteAnomaliaAbierta(abiertas, 'punto_123')).toBe(false);
  });
});
