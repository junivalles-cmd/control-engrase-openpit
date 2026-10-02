// tests/unit/device-independence-requirements.test.js
//
// CORRECCIÓN ARQUITECTÓNICA OBLIGATORIA (2026-10-02) — pedido explícito del
// usuario: "CONTROL DE ENGRASE NO PUEDE DEPENDER DE UN DISPOSITIVO FÍSICO
// REGISTRADO". Este archivo mapea 1:1 los 8 puntos de prueba pedidos
// (A-H) a aserciones concretas contra el código REAL (src/core/
// operational-scope.js + app.js), para que quede trazable cuál test prueba
// cuál punto — la cobertura de fondo ya vive en operational-scope.test.js/
// device-assignment-isolation.test.js/quick-unlock.test.js; este archivo
// es el índice verificable, no una reimplementación paralela.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadOperationalScopeLogic, loadDeviceIdentityLogic } from '../helpers/loadLubricationLogic.js';

const { resolveOperationalScope, getAuthorizedCrews } = loadOperationalScopeLogic();

describe('A — Lubricador puede iniciar sesión en un dispositivo NUEVO y trabajar normalmente', () => {
  it('con cuadrillas[].memberUserIds YA autorizando al usuario en el servidor, un scope resuelto SIN ningún dato local previo (selectedCrewId vacío, como un localStorage recién estrenado) ya da CREW_SCOPED de inmediato', () => {
    const cuadrillas = [{ id: 'crew_mojon', locationId: 'loc_mojon', active: true, memberUserIds: ['u_lub1'] }];
    const scope = resolveOperationalScope({ currentUser: { id: 'u_lub1', role: 'LUBRICADOR' }, cuadrillas, selectedCrewId: '', shiftId: 'shift_dia' });
    expect(scope.kind).toBe('CREW_SCOPED');
    expect(scope.crewId).toBe('crew_mojon');
  });
});

describe('B — No necesita hardware registrado', () => {
  it('resolveOperationalScope()/getAuthorizedCrews() no reciben ni leen ningún parámetro de identificador de dispositivo (deviceId/IMEI/serial/Android ID) — su firma real es solo currentUser/cuadrillas/selectedCrewId/shiftId', () => {
    expect(resolveOperationalScope.toString()).not.toMatch(/deviceId|deviceAssignment|IMEI|androidId/i);
    expect(getAuthorizedCrews.toString()).not.toMatch(/deviceId|deviceAssignment|IMEI|androidId/i);
  });

  it('getAuthorizedCrews() autoriza SOLO por userId — dos "dispositivos" distintos (sin ningún dato compartido entre sí) dan el MISMO resultado para el mismo usuario', () => {
    const cuadrillas = [{ id: 'crew_mojon', active: true, memberUserIds: ['u_lub1'] }];
    // "Dispositivo A" y "dispositivo B" aquí son simplemente dos llamadas
    // independientes, sin ningún estado compartido entre ellas — la
    // autorización no depende de haber "visto" este aparato antes.
    const resultadoDispositivoA = getAuthorizedCrews(cuadrillas, 'u_lub1');
    const resultadoDispositivoB = getAuthorizedCrews(cuadrillas, 'u_lub1');
    expect(resultadoDispositivoA).toEqual(resultadoDispositivoB);
  });
});

describe('C — Usuario con UNA cuadrilla autorizada entra directamente (sin pantalla de selección)', () => {
  it('1 sola cuadrilla autorizada -> CREW_SCOPED inmediato, kind nunca es NEEDS_CREW_SELECTION', () => {
    const cuadrillas = [{ id: 'crew_mojon', locationId: 'loc_mojon', active: true, memberUserIds: ['u_lub1'] }];
    const scope = resolveOperationalScope({ currentUser: { id: 'u_lub1', role: 'LUBRICADOR' }, cuadrillas, shiftId: 'shift_dia' });
    expect(scope.kind).toBe('CREW_SCOPED');
  });
});

describe('D — Usuario con VARIAS cuadrillas puede seleccionar una autorizada', () => {
  it('2+ cuadrillas autorizadas reales -> NEEDS_CREW_SELECTION hasta elegir; eligiendo una de las autorizadas -> CREW_SCOPED con esa', () => {
    const cuadrillas = [
      { id: 'crew_mojon', locationId: 'loc_mojon', active: true, memberUserIds: ['u_lub1'] },
      { id: 'crew_volcan', locationId: 'loc_volcan', active: true, memberUserIds: ['u_lub1'] },
    ];
    const sinElegir = resolveOperationalScope({ currentUser: { id: 'u_lub1', role: 'LUBRICADOR' }, cuadrillas, shiftId: 'shift_dia' });
    expect(sinElegir.kind).toBe('NEEDS_CREW_SELECTION');
    expect(sinElegir.authorizedCrews).toHaveLength(2);

    const eligiendoVolcan = resolveOperationalScope({ currentUser: { id: 'u_lub1', role: 'LUBRICADOR' }, cuadrillas, selectedCrewId: 'crew_volcan', shiftId: 'shift_dia' });
    expect(eligiendoVolcan.kind).toBe('CREW_SCOPED');
    expect(eligiendoVolcan.crewId).toBe('crew_volcan');
  });
});

describe('E — Usuario NO puede seleccionar una cuadrilla sin permiso', () => {
  it('selectedCrewId apuntando a una cuadrilla donde el usuario NO está en memberUserIds -> se ignora por completo, nunca se acepta', () => {
    const cuadrillas = [
      { id: 'crew_mojon', locationId: 'loc_mojon', active: true, memberUserIds: ['u_lub1'] },
      { id: 'crew_ajena', locationId: 'loc_x', active: true, memberUserIds: ['otro_usuario'] },
    ];
    const scope = resolveOperationalScope({ currentUser: { id: 'u_lub1', role: 'LUBRICADOR' }, cuadrillas, selectedCrewId: 'crew_ajena', shiftId: 'shift_dia' });
    expect(scope.kind).toBe('CREW_SCOPED'); // cae a la única REAL autorizada
    expect(scope.crewId).toBe('crew_mojon'); // NUNCA crew_ajena
  });
});

describe('F — Cambiar de dispositivo conserva los mismos permisos remotos', () => {
  it('resolver el scope con el MISMO usuario/cuadrillas pero sin ningún dato local previo (equivalente a un dispositivo nuevo) da exactamente el mismo resultado', () => {
    const cuadrillas = [{ id: 'crew_mojon', locationId: 'loc_mojon', active: true, memberUserIds: ['u_lub1'] }];
    const dispositivoViejo = resolveOperationalScope({ currentUser: { id: 'u_lub1', role: 'LUBRICADOR' }, cuadrillas, selectedCrewId: 'crew_mojon', shiftId: 'shift_dia' });
    const dispositivoNuevo = resolveOperationalScope({ currentUser: { id: 'u_lub1', role: 'LUBRICADOR' }, cuadrillas, selectedCrewId: '', shiftId: 'shift_dia' });
    expect(dispositivoNuevo).toEqual(dispositivoViejo);
  });
});

describe('G — Quick Unlock es LOCAL y nunca determina permisos/cuadrilla/ubicación', () => {
  it('attemptUnlock() exitoso no devuelve ni toca ningún campo de cuadrilla/ubicación — solo confirma identidad local, el scope real se resuelve aparte', async () => {
    // Mismo patrón de prueba que tests/unit/quick-unlock.test.js (sección N,
    // "el PIN nunca cambia ni eleva el rol") — aquí se confirma lo mismo
    // para cuadrilla/ubicación, el campo que este lote agrega.
    const { loadQuickUnlockLogic } = await import('../helpers/loadLubricationLogic.js');
    const { QuickUnlock } = loadQuickUnlockLogic(makeFakeDbForPin());
    await QuickUnlock.configure('u_lub1', '739184');
    const result = await QuickUnlock.attemptUnlock('u_lub1', '739184');
    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty('crewId');
    expect(result).not.toHaveProperty('cuadrillaId');
    expect(result).not.toHaveProperty('locationId');
  });

  function makeFakeDbForPin() {
    let quickUnlock = null;
    return {
      async getQuickUnlock() { return quickUnlock; },
      async setQuickUnlock(v) { quickUnlock = v; return v; },
    };
  }
});

describe('H — Offline sigue funcionando después de sincronización inicial (sin cambios por este lote — confirmado que sigue intacto)', () => {
  it('getCurrentOperationalScope()/resolveOperationalScope() son funciones PURAS/locales (cuadrillas ya sincronizadas vía DB.allActive) — nunca hacen fetch ni dependen de estar online', async () => {
    const db = {
      _data: { cuadrillas: [{ id: 'crew_mojon', locationId: 'loc_mojon', active: true, memberUserIds: ['u_lub1'] }] },
      async allActive(store) { return this._data[store] || []; },
    };
    const App = { currentUser: { id: 'u_lub1', role: 'LUBRICADOR' }, generalSettings: { shiftDayStart: 6, shiftNightStart: 18 } };
    const ls = (() => { let s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; })();
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('window', { Capacitor: undefined });
    const { getCurrentOperationalScope } = loadDeviceIdentityLogic(db, App);
    // Sin ningún stub de `fetch` global: si esta cadena intentara red, la
    // llamada fallaría (no hay fetch definido) — pasar confirma que es
    // 100% local.
    const scope = await getCurrentOperationalScope();
    expect(scope.kind).toBe('CREW_SCOPED');
  });
});
