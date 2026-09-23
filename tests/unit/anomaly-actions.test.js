// Modularización JS Fase 2 — decisión de negocio de anomalías automáticas,
// extraída de app.js -> createAutoAnomalies() hacia
// src/core/anomaly-actions.js (evaluateAnomalyActions). Esta suite prueba
// SOLO la decisión (crear / actualizar / nada) — la persistencia real
// (DB.allActive/DB.put) sigue en app.js y no se prueba aquí, ver
// docs/AUTOMATED_TESTS.md.
import { describe, it, expect } from 'vitest';
import { loadAnomalyActionsLogic } from '../helpers/loadLubricationLogic.js';

const { evaluateAnomalyActions, hayPuntosOAnomaliaHorometro } = loadAnomalyActionsLogic();

const equipment = { id: 'eq1', code: '20-5530' };
const FECHA = '2026-01-14T10:00:00.000Z';

function baseRecord(overrides = {}) {
  return { date: FECHA, userName: 'Ana', details: [], photos: [], ...overrides };
}

describe('evaluateAnomalyActions() — decisión de anomalías automáticas', () => {
  it('1. nuevo punto fallado (sin anomalía previa) -> acción crear', () => {
    const record = baseRecord({ details: [{ pointId: 'p1', pointName: 'Buje pluma', done: false, reason: 'Grasera dañada' }] });
    const { acciones, avisos } = evaluateAnomalyActions(record, equipment, []);
    expect(acciones).toHaveLength(1);
    expect(acciones[0]).toMatchObject({
      tipo: 'crear',
      anomalia: { equipmentId: 'eq1', autoPointId: 'p1', criticality: 'Alta', status: 'Abierta', repeticiones: 1 },
    });
    expect(avisos).toEqual(['Buje pluma']);
  });

  it('2. mismo punto con anomalía activa ya abierta -> acción actualizar (no crea otra)', () => {
    const record = baseRecord({ details: [{ pointId: 'p1', pointName: 'Buje pluma', done: false, reason: 'Grasera dañada' }] });
    const abiertas = [{ id: 'anom1', equipmentId: 'eq1', autoPointId: 'p1', status: 'Abierta', repeticiones: 2 }];
    const { acciones, avisos } = evaluateAnomalyActions(record, equipment, abiertas);
    expect(acciones).toHaveLength(1);
    expect(acciones[0]).toMatchObject({ tipo: 'actualizar', anomaliaId: 'anom1', cambios: { repeticiones: 3 } });
    expect(avisos).toEqual([]); // no es un aviso de "nueva anomalía"
  });

  it('3. anomalía active:false: evaluateAnomalyActions() no filtra por active — asume que openAnomalies ya viene filtrada por DB.allActive() (igual que estadoCelda con plans/records). Si se le pasa una inactiva igual, SÍ la usa para no duplicar.', () => {
    const record = baseRecord({ details: [{ pointId: 'p1', pointName: 'Buje pluma', done: false, reason: 'Grasera dañada' }] });
    const abiertas = [{ id: 'anomX', equipmentId: 'eq1', autoPointId: 'p1', status: 'Abierta', repeticiones: 1, active: false }];
    const { acciones } = evaluateAnomalyActions(record, equipment, abiertas);
    expect(acciones[0].tipo).toBe('actualizar');
  });

  it('4. punto distinto al de la anomalía existente -> crea una nueva (no la confunde con la otra)', () => {
    const record = baseRecord({ details: [{ pointId: 'p2', pointName: 'Rodillo inferior', done: false, reason: 'Falta de lubricante' }] });
    const abiertas = [{ id: 'anom1', equipmentId: 'eq1', autoPointId: 'p1', status: 'Abierta', repeticiones: 1 }];
    const { acciones } = evaluateAnomalyActions(record, equipment, abiertas);
    expect(acciones).toHaveLength(1);
    expect(acciones[0]).toMatchObject({ tipo: 'crear', anomalia: { autoPointId: 'p2' } });
  });

  it('5. equipo distinto: evaluateAnomalyActions() decide SOLO por autoPointId, no por equipmentId — el filtrado por equipo es responsabilidad de quien arma `openAnomalies` (createAutoAnomalies() en app.js ya filtra por equipment.id antes de llamar). Documenta ese límite de responsabilidad.', () => {
    const record = baseRecord({ details: [{ pointId: 'p1', pointName: 'Buje pluma', done: false, reason: 'Grasera dañada' }] });
    // Anomalía con el mismo autoPointId pero de OTRO equipo, pasada igual (caso de uso
    // incorrecto si el caller no filtra) -> la función la toma como coincidencia igual.
    const abiertas = [{ id: 'anomOtroEquipo', equipmentId: 'eq2-otro', autoPointId: 'p1', status: 'Abierta', repeticiones: 1 }];
    const { acciones } = evaluateAnomalyActions(record, equipment, abiertas);
    expect(acciones[0].tipo).toBe('actualizar');
    expect(acciones[0].anomaliaId).toBe('anomOtroEquipo');
  });

  it('6. motivo "Falla mecánica" -> criticidad Crítica', () => {
    const record = baseRecord({ details: [{ pointId: 'p1', pointName: 'Motor', done: false, reason: 'Falla mecánica' }] });
    const { acciones } = evaluateAnomalyActions(record, equipment, []);
    expect(acciones[0].anomalia.criticality).toBe('Crítica');
  });

  it('7. motivo "Grasera dañada" -> criticidad Alta', () => {
    const record = baseRecord({ details: [{ pointId: 'p1', pointName: 'Grasera', done: false, reason: 'Grasera dañada' }] });
    const { acciones } = evaluateAnomalyActions(record, equipment, []);
    expect(acciones[0].anomalia.criticality).toBe('Alta');
  });

  it('8. motivo "Punto inaccesible" -> criticidad Media', () => {
    const record = baseRecord({ details: [{ pointId: 'p1', pointName: 'Punto alto', done: false, reason: 'Punto inaccesible' }] });
    const { acciones } = evaluateAnomalyActions(record, equipment, []);
    expect(acciones[0].anomalia.criticality).toBe('Media');
  });

  it('9. motivo desconocido (no está en CRITICIDAD_POR_MOTIVO) -> fallback Media', () => {
    const record = baseRecord({ details: [{ pointId: 'p1', pointName: 'X', done: false, reason: 'Motivo inventado que no existe' }] });
    const { acciones } = evaluateAnomalyActions(record, equipment, []);
    expect(acciones[0].anomalia.criticality).toBe('Media');
  });

  it('10. contador de repetición: sube en 1 respecto al valor existente de repeticiones', () => {
    const record = baseRecord({ details: [{ pointId: 'p1', pointName: 'Buje', done: false, reason: 'Grasera dañada' }] });
    const abiertas = [{ id: 'anom1', equipmentId: 'eq1', autoPointId: 'p1', status: 'Abierta', repeticiones: 5 }];
    const { acciones } = evaluateAnomalyActions(record, equipment, abiertas);
    expect(acciones[0].cambios.repeticiones).toBe(6);
  });

  it('10b. anomalía existente sin campo repeticiones (dato viejo) -> se asume 1 y sube a 2', () => {
    const record = baseRecord({ details: [{ pointId: 'p1', pointName: 'Buje', done: false, reason: 'Grasera dañada' }] });
    const abiertas = [{ id: 'anom1', equipmentId: 'eq1', autoPointId: 'p1', status: 'Abierta' }];
    const { acciones } = evaluateAnomalyActions(record, equipment, abiertas);
    expect(acciones[0].cambios.repeticiones).toBe(2);
  });

  it('11. datos incompletos: sin reason (null/undefined) -> "Sin motivo indicado"; sin photos -> []', () => {
    const record = baseRecord({ details: [{ pointId: 'p1', pointName: 'Buje', done: false, reason: null }], photos: undefined });
    const { acciones } = evaluateAnomalyActions(record, equipment, []);
    expect(acciones[0].anomalia.component).toBe('Sin motivo indicado');
    expect(acciones[0].anomalia.description).toContain('Sin motivo indicado');
    expect(acciones[0].anomalia.photos).toEqual([]);
    expect(acciones[0].anomalia.photo).toBeNull();
  });

  it('puntos ya marcados done:true no generan ninguna acción', () => {
    const record = baseRecord({ details: [{ pointId: 'p1', pointName: 'Buje', done: true, reason: 'Grasera dañada' }] });
    const { acciones, avisos } = evaluateAnomalyActions(record, equipment, []);
    expect(acciones).toEqual([]);
    expect(avisos).toEqual([]);
  });

  it('horómetro dañado/ilegible (sinHorometro) sin anomalía previa -> crea anomalía de Horómetro', () => {
    const record = baseRecord({ sinHorometro: true, noHourmeterReason: 'Pantalla rota' });
    const { acciones, avisos } = evaluateAnomalyActions(record, equipment, []);
    expect(acciones).toHaveLength(1);
    expect(acciones[0]).toMatchObject({ tipo: 'crear', anomalia: { component: 'Horómetro', autoPointId: '__horometro__', criticality: 'Media' } });
    expect(avisos).toEqual(['Horómetro']);
  });

  it('horómetro dañado con anomalía de horómetro ya abierta -> actualiza, no duplica', () => {
    const record = baseRecord({ sinHorometro: true, noHourmeterReason: 'Pantalla rota' });
    const abiertas = [{ id: 'anomHm', equipmentId: 'eq1', autoPointId: '__horometro__', status: 'Abierta', repeticiones: 1 }];
    const { acciones } = evaluateAnomalyActions(record, equipment, abiertas);
    expect(acciones).toHaveLength(1);
    expect(acciones[0]).toMatchObject({ tipo: 'actualizar', anomaliaId: 'anomHm', cambios: { repeticiones: 2 } });
  });

  it('"El equipo no tiene horómetro" NO genera anomalía (no es una falla)', () => {
    const record = baseRecord({ sinHorometro: true, noHourmeterReason: 'El equipo no tiene horómetro' });
    const { acciones, avisos } = evaluateAnomalyActions(record, equipment, []);
    expect(acciones).toEqual([]);
    expect(avisos).toEqual([]);
  });

  it('sin reason en horómetro -> fallback "Horómetro no legible"', () => {
    const record = baseRecord({ sinHorometro: true, noHourmeterReason: undefined });
    const { acciones } = evaluateAnomalyActions(record, equipment, []);
    expect(acciones[0].anomalia.description).toContain('Horómetro no legible');
  });

  it('sin puntos pendientes y sin problema de horómetro -> ninguna acción', () => {
    const record = baseRecord({ details: [{ pointId: 'p1', pointName: 'Buje', done: true }] });
    const { acciones, avisos } = evaluateAnomalyActions(record, equipment, []);
    expect(acciones).toEqual([]);
    expect(avisos).toEqual([]);
  });
});

describe('hayPuntosOAnomaliaHorometro() — guarda de entrada antes de leer IndexedDB', () => {
  it('true si hay al menos un punto pendiente', () => {
    expect(hayPuntosOAnomaliaHorometro(baseRecord({ details: [{ pointId: 'p1', done: false }] }))).toBe(true);
  });
  it('true si sinHorometro está activo, aunque no haya puntos pendientes', () => {
    expect(hayPuntosOAnomaliaHorometro(baseRecord({ sinHorometro: true }))).toBe(true);
  });
  it('false si todos los puntos están hechos y no hay problema de horómetro', () => {
    expect(hayPuntosOAnomaliaHorometro(baseRecord({ details: [{ pointId: 'p1', done: true }] }))).toBe(false);
  });
  it('false con details vacío/sin definir y sin sinHorometro', () => {
    expect(hayPuntosOAnomaliaHorometro(baseRecord({ details: [] }))).toBe(false);
    expect(hayPuntosOAnomaliaHorometro({ date: FECHA, userName: 'Ana' })).toBe(false);
  });
});
