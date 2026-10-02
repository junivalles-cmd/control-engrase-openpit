// tests/unit/device-assignment-isolation.test.js
//
// CORRECCIÓN ARQUITECTÓNICA 2026-10-02 — reescrito por completo. El viejo
// §3 ("aislamiento de device assignment") probaba que cada DISPOSITIVO
// (`getDeviceId()`) leía/escribía SOLO su propia fila en una tabla
// compartida. Ese mecanismo fue eliminado por pedido explícito del
// usuario: "CONTROL DE ENGRASE NO PUEDE DEPENDER DE UN DISPOSITIVO FÍSICO
// REGISTRADO" — ver docs/OPERATIONAL_SCOPE.md.
//
// La garantía equivalente ahora es por USUARIO, no por dispositivo:
// getSelectedCrewId(userId)/setSelectedCrewId(userId, crewId) guardan
// SOLO la última cuadrilla elegida por ESA persona para la sesión actual
// (comodidad local, nunca autorización real) bajo una única clave de
// `localStorage` — si otra persona usa el MISMO teléfono después, su
// propio userId no coincide con el guardado, así que nunca hereda la
// cuadrilla de quien usó el aparato antes. La autorización REAL siempre
// viene de `cuadrillas[].memberUserIds` (servidor, sincronizado) vía
// resolveOperationalScope() — nunca de este valor local.
//
// Contra el código REAL de app.js + src/core/operational-scope.js, con
// IndexedDB/localStorage reemplazados por fakes en memoria — sin red, sin
// dispositivos reales.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadDeviceIdentityLogic } from '../helpers/loadLubricationLogic.js';

function makeFakeDB(seed = {}) {
  const data = {};
  for (const [store, rows] of Object.entries(seed)) data[store] = [...rows];
  const puts = [];
  return {
    _data: data,
    _puts: puts,
    async get(store, id) { return (data[store] || []).find(r => r.id === id) || null; },
    async put(store, obj) {
      puts.push({ store, id: obj.id });
      data[store] = data[store] || [];
      const i = data[store].findIndex(r => r.id === obj.id);
      if (i >= 0) data[store][i] = obj; else data[store].push(obj);
      return obj;
    },
    async allActive(store) { return (data[store] || []).filter(r => r.active !== false); },
  };
}

function makeFakeLocalStorage() {
  let store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

describe('Aislamiento de la selección de cuadrilla de sesión, por USUARIO (reemplaza el viejo aislamiento por dispositivo)', () => {
  let db, ls, App;

  beforeEach(() => {
    db = makeFakeDB({ cuadrillas: [] });
    ls = makeFakeLocalStorage();
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('window', { Capacitor: undefined });
    vi.stubGlobal('Sync', { fullSync: () => {} });
    App = { currentUser: { id: 'u_lub1', name: 'Ana', role: 'LUBRICADOR' }, generalSettings: { shiftDayStart: 6, shiftNightStart: 18 } };
  });

  it('usuario A elige su cuadrilla de sesión sin afectar la selección de usuario B, en el MISMO localStorage (mismo teléfono compartido)', () => {
    const { setSelectedCrewId, getSelectedCrewId } = loadDeviceIdentityLogic(db, App);
    setSelectedCrewId('u_A', 'crew_mojon');
    expect(getSelectedCrewId('u_A')).toBe('crew_mojon');
    expect(getSelectedCrewId('u_B')).toBe(''); // nunca hereda la de A
  });

  it('B elige la suya DESPUÉS (mismo localStorage) — A ya no ve su propia selección anterior (solo se guarda la ÚLTIMA, por diseño — ver punto 2 del pedido: "conservar localmente la última selección únicamente como comodidad")', () => {
    const { setSelectedCrewId, getSelectedCrewId } = loadDeviceIdentityLogic(db, App);
    setSelectedCrewId('u_A', 'crew_mojon');
    setSelectedCrewId('u_B', 'crew_volcan');
    expect(getSelectedCrewId('u_B')).toBe('crew_volcan');
    expect(getSelectedCrewId('u_A')).toBe(''); // A tendría que volver a elegir si entra de nuevo — esperado, no un bug
  });

  it('setSelectedCrewId()/getSelectedCrewId() escriben/leen ÚNICAMENTE localStorage — nunca tocan IndexedDB (DB.put nunca se llama)', () => {
    const { setSelectedCrewId } = loadDeviceIdentityLogic(db, App);
    setSelectedCrewId('u_A', 'crew_mojon');
    expect(db._puts).toHaveLength(0);
  });

  it('un dispositivo/localStorage NUEVO (nunca se usó aquí) -> getSelectedCrewId() de cualquier usuario da "", nunca lanza ni hereda nada', () => {
    const { getSelectedCrewId } = loadDeviceIdentityLogic(db, App);
    expect(getSelectedCrewId('u_lub1')).toBe('');
    expect(getSelectedCrewId('cualquier_otro')).toBe('');
  });

  it('sin userId (nadie logueado todavía) -> getSelectedCrewId()/setSelectedCrewId() no lanzan, dan "" sin escribir nada falso', () => {
    const { getSelectedCrewId, setSelectedCrewId } = loadDeviceIdentityLogic(db, App);
    expect(getSelectedCrewId(null)).toBe('');
    expect(() => setSelectedCrewId(null, 'crew_mojon')).not.toThrow();
  });

  // Punto E del pedido de corrección arquitectónica: "Usuario no puede
  // seleccionar una cuadrilla sin permiso" — la selección LOCAL nunca es
  // la fuente de autorización. Prueba end-to-end contra
  // getCurrentOperationalScope() real (no solo contra el helper de
  // localStorage) para que quede certificado con el código que de verdad
  // decide el scope.
  describe('la selección local NUNCA eleva permisos — getCurrentOperationalScope() ignora un selectedCrewId no autorizado', () => {
    it('usuario con 1 cuadrilla autorizada real + un selectedCrewId local de OTRA cuadrilla (nunca autorizada) -> CREW_SCOPED usa la ÚNICA autorizada real, ignora la selección local', async () => {
      db._data.cuadrillas = [
        { id: 'crew_mojon', locationId: 'loc_mojon', active: true, memberUserIds: ['u_lub1'] },
        { id: 'crew_taller', locationId: 'loc_taller', active: true, memberUserIds: [] }, // NUNCA autorizó a u_lub1
      ];
      const { setSelectedCrewId, getCurrentOperationalScope } = loadDeviceIdentityLogic(db, App);
      setSelectedCrewId('u_lub1', 'crew_taller'); // intento de "colarse" a una cuadrilla ajena
      const scope = await getCurrentOperationalScope();
      expect(scope.kind).toBe('CREW_SCOPED');
      expect(scope.crewId).toBe('crew_mojon'); // la única REAL autorizada, nunca crew_taller
    });

    it('usuario con 2+ cuadrillas autorizadas reales + selectedCrewId local apuntando a una NO autorizada -> NEEDS_CREW_SELECTION (se ignora, nunca se acepta a ciegas)', async () => {
      db._data.cuadrillas = [
        { id: 'crew_mojon', locationId: 'loc_mojon', active: true, memberUserIds: ['u_lub1'] },
        { id: 'crew_volcan', locationId: 'loc_volcan', active: true, memberUserIds: ['u_lub1'] },
        { id: 'crew_taller', locationId: 'loc_taller', active: true, memberUserIds: [] },
      ];
      const { setSelectedCrewId, getCurrentOperationalScope } = loadDeviceIdentityLogic(db, App);
      setSelectedCrewId('u_lub1', 'crew_taller');
      const scope = await getCurrentOperationalScope();
      expect(scope.kind).toBe('NEEDS_CREW_SELECTION');
      expect(scope.authorizedCrews.map(c => c.id).sort()).toEqual(['crew_mojon', 'crew_volcan']);
    });
  });
});
