// tests/unit/sync-audit-log-legacy.test.js
//
// Auditoría "upgrade de APK sobre cola legacy de audit_log" — hallazgo
// confirmado: 0013 deniega a propósito el INSERT/UPDATE genérico de
// audit_log (ver docs/AUTHORIZATION_ROW_SCOPE_PHASE_2D2.md), pero
// pushAll() todavía intentaba un POST/PATCH genérico para ese store, y
// registrarAvisoEnviado() (app.js) seguía escribiendo audit_log incluso en
// modo Supabase, sin la guarda que ya tiene logAudit() (db.js).
//
// Corrección mínima, SOLO cliente, SIN tocar RLS/0014/account-scoped sync/
// DAY-NIGHT/SUPPORT_OTHER_LOCATION:
//   1) sync.js pushAll(): audit_log nunca entra a `toPush` — exclusión
//      local intencional, nunca un fallo de sync (no entra a
//      errors/authErrors).
//   2) app.js registrarAvisoEnviado(): mismo principio que logAudit() —
//      en modo Supabase Auth, no escribe audit_log sincronizable. La
//      notificación local del teléfono (LN.schedule) es independiente.
//
// Contra el código REAL de sync.js/db.js/app.js — nunca una reimplementación
// paralela. Sin red real, sin IndexedDB real, sin producción.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadSyncLogic, APP_JS_PATH, DB_JS_PATH } from '../helpers/loadLubricationLogic.js';
import { extractDeclaration, readSource } from '../helpers/extractFromSource.js';

afterEach(() => vi.unstubAllGlobals());

const dbSource = readSource(DB_JS_PATH);
const appSource = readSource(APP_JS_PATH);

/** DB fake mínima que soporta tanto el loop genérico de STORES (audit_log,
 * equipment, ...) como las colas de operaciones (ejecución/evidencia), para
 * poder probar su coexistencia dentro de UN mismo pushAll() real. */
function makeFixtureDB() {
  const rows = {};
  let config = { url: 'https://fixture.test', anonKey: 'anon-test' };
  const executionOps = [];
  const evidenceOps = [];
  return {
    _rows: rows, _executionOps: executionOps, _evidenceOps: evidenceOps,
    async getConfig() { return config; },
    async setConfig(v) { config = v; return v; },
    async get(store, id) { return rows[store]?.[id] ?? null; },
    async put(store, obj) { (rows[store] ||= {})[obj.id] = structuredClone(obj); return obj; },
    async all(store) { return Object.values(rows[store] || {}); },
    async recordConflicts() {},
    async getExecutionOperations() { return structuredClone(executionOps); },
    async updateExecutionOperation(op) {
      const i = executionOps.findIndex(r => r.id === op.id);
      if (i >= 0) executionOps[i] = structuredClone(op); else executionOps.push(structuredClone(op));
    },
    async finishExecutionOperation(op, replyRows) {
      executionOps.splice(executionOps.findIndex(r => r.id === op.id), 1);
      for (const r of replyRows) { (rows[r.store] ||= {})[r.id] = { ...r.payload, _pushedVersion: r.updated_at, updatedAt: r.updated_at }; }
    },
    async getEvidenceOperations() { return structuredClone(evidenceOps); },
    async updateEvidenceOperation(op) {
      const i = evidenceOps.findIndex(r => r.id === op.id);
      if (i >= 0) evidenceOps[i] = structuredClone(op); else evidenceOps.push(structuredClone(op));
    },
    async finishEvidenceOperation(op, replyRows) {
      evidenceOps.splice(evidenceOps.findIndex(r => r.id === op.id), 1);
      for (const r of replyRows) { (rows[r.store] ||= {})[r.id] = { ...r.payload, _pushedVersion: r.updated_at, updatedAt: r.updated_at }; }
    },
    async blockEvidenceOperation(op) {
      const i = evidenceOps.findIndex(r => r.id === op.id);
      if (i >= 0) evidenceOps[i] = structuredClone(op);
    },
  };
}

function fakeAuth({ role = 'ADMINISTRADOR', appUserId = 'u1', authUserId = 'auth-u1', fingerprint = 'fp1' } = {}) {
  return {
    isSupabaseMode: () => true, isAuthenticated: () => true,
    getSession: () => ({ accessToken: 'user-jwt' }),
    getProfile: () => ({ role, appUserId, authUserId, authorizationFingerprint: fingerprint, rowScopeEnforced: true }),
    getSessionEpoch: () => 1,
  };
}

const legacyAuditRowNew = { id: 'log-new', action: 'ENGRASE_REGISTRADO', detail: 'legacy sin vínculo', user: 'sistema', createdAt: '2026-01-01T00:00:00.000Z', active: true, updatedAt: '2026-01-01T00:00:00.000Z' };
const legacyAuditRowEdited = { id: 'log-edited', action: 'ENGRASE_EDITADO', detail: 'legacy editado', user: 'sistema', createdAt: '2026-01-01T00:00:00.000Z', active: true, updatedAt: '2026-01-02T00:00:00.000Z', _pushedVersion: '2026-01-01T00:00:00.000Z' };

describe('1/2/3/5) pushAll() nunca intenta POST/PATCH genérico de audit_log — permanece dirty y local, nunca AUTH_FORBIDDEN', () => {
  it('fila audit_log NUEVA (sin _pushedVersion) no genera ningún POST', async () => {
    const db = makeFixtureDB();
    await db.put('audit_log', legacyAuditRowNew);
    const { Sync } = loadSyncLogic(db, ['audit_log'], fakeAuth());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await Sync.pushAll();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.errors).toEqual([]);
    expect(res.authErrors).toBe(0);
    expect(res.ok).toBe(true);
  });

  it('fila audit_log YA subida y vuelta a editar (tendría CAS/PATCH) no genera ningún PATCH', async () => {
    const db = makeFixtureDB();
    await db.put('audit_log', legacyAuditRowEdited);
    const { Sync } = loadSyncLogic(db, ['audit_log'], fakeAuth());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await Sync.pushAll();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.errors).toEqual([]);
    expect(res.authErrors).toBe(0);
  });

  it('las filas dirty de audit_log permanecen intactas en IndexedDB después de pushAll() (nunca se borran, nunca se marcan como subidas)', async () => {
    const db = makeFixtureDB();
    await db.put('audit_log', legacyAuditRowNew);
    await db.put('audit_log', legacyAuditRowEdited);
    const { Sync } = loadSyncLogic(db, ['audit_log'], fakeAuth());
    vi.stubGlobal('fetch', vi.fn());

    await Sync.pushAll();

    expect(await db.get('audit_log', 'log-new')).toEqual(legacyAuditRowNew); // byte-idéntica, sin _pushedVersion inventado
    expect(await db.get('audit_log', 'log-edited')).toEqual(legacyAuditRowEdited); // conserva su _pushedVersion viejo real, nunca se "finge" subida
    // Siguen siendo "pending" ante el resto del sistema a propósito — nunca
    // se fabrica un _pushedVersion falso para apagar el contador; es una
    // exclusión local permanente, no una sincronización simulada.
    expect(await db.all('audit_log')).toHaveLength(2);
  });

  it('nunca se clasifica como AUTH_FORBIDDEN/authError — es una exclusión local, no un rechazo del servidor', async () => {
    const db = makeFixtureDB();
    await db.put('audit_log', legacyAuditRowNew);
    const { Sync } = loadSyncLogic(db, ['audit_log'], fakeAuth());
    vi.stubGlobal('fetch', vi.fn());

    const res = await Sync.pushAll();

    expect(res.authErrors).toBe(0);
    expect(res.authErrorDetails ?? []).toEqual([]);
    expect(res.reason).toBeUndefined();
  });
});

describe('4) fullSync() ya no falla ni muestra AUTH_FORBIDDEN solo por audit_log legacy', () => {
  it('con audit_log dirty y todo lo demás limpio, fullSync() notifica status "ok"', async () => {
    const db = makeFixtureDB();
    await db.put('audit_log', legacyAuditRowNew);
    await db.setConfig({
      url: 'https://fixture.test', anonKey: 'anon-test',
      activeAccountSyncKey: 'auth-u1:fp1',
      accountSyncStates: { 'auth-u1:fp1': { authUserId: 'auth-u1', authorizationFingerprint: 'fp1', bootstrapComplete: true, lastPull: '2026-01-01T00:00:00.000Z' } },
    });
    const { Sync } = loadSyncLogic(db, ['audit_log'], { ...fakeAuth(), restoreSession: async () => {}, refreshAuthorizationContext: async () => ({ ok: true, changed: false, firstSnapshot: false, context: { rowScopeEnforced: true } }) });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }))); // pull: sin novedades; nunca se llega a POST de audit_log

    let notified = null;
    Sync.onChange(s => { notified = s; });
    await Sync.fullSync();

    expect(notified.status).toBe('ok');
    expect(notified.errors).toEqual([]);
    expect(notified.authErrors).toBe(0);
  });
});

describe('6) lubrication_execution pendiente sigue enviándose con normalidad, aunque audit_log legacy esté dirty', () => {
  it('la cola de ejecución dispara su POST real a /rpc/lubrication_execution; audit_log nunca genera un segundo fetch', async () => {
    const db = makeFixtureDB();
    await db.put('audit_log', legacyAuditRowNew); // convive en la misma IndexedDB
    const operation = {
      id: 'exec-op-1', actorId: 'u1', authorizationFingerprint: 'fp1',
      params: { p_operation_id: 'exec-op-1', p_action: 'CREATE', p_record_id: 'r1', p_equipment_id: 'e1', p_plan_id: 'p1' },
      localVersions: { lubrication_records: 'local', equipment: 'old' }, localPhotos: [], frozen: true,
    };
    db._executionOps.push(operation);
    const { Sync } = loadSyncLogic(db, ['audit_log', 'lubrication_records', 'equipment'], fakeAuth());
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({
      status: 'APPLIED',
      rows: [
        { store: 'lubrication_records', id: 'r1', payload: { id: 'r1' }, updated_at: '2026-10-16T12:00:00.000Z' },
        { store: 'equipment', id: 'e1', payload: { id: 'e1' }, updated_at: '2026-10-16T12:00:00.000Z' },
      ],
    }) }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await Sync.pushAll();

    expect(fetchMock).toHaveBeenCalledTimes(1); // solo la ejecución real; audit_log nunca intentó nada
    expect(fetchMock.mock.calls[0][0]).toContain('/rpc/lubrication_execution');
    expect(res.pushed).toBe(1);
    expect(await db.get('audit_log', 'log-new')).toEqual(legacyAuditRowNew); // sigue intacta
  });
});

describe('7/8) evidence/assignments/skips pendientes siguen su flujo normal (misma cola CATALOG/evidence), aunque audit_log legacy esté dirty', () => {
  it('evidence pendiente (report_anomaly) sigue enviándose por su RPC típico', async () => {
    const db = makeFixtureDB();
    await db.put('audit_log', legacyAuditRowNew);
    db._evidenceOps.push({
      id: 'ev-op-1', actorId: 'u1', authorizationFingerprint: 'fp1', rpc: 'report_anomaly', kind: 'EVIDENCE',
      params: { p_operation_id: 'ev-op-1', p_id: 'a1', p_equipment_id: 'e1' }, frozen: true,
    });
    const { Sync } = loadSyncLogic(db, ['audit_log', 'anomalies'], fakeAuth());
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: 'APPLIED',
      rows: [{ store: 'anomalies', id: 'a1', payload: { id: 'a1' }, updated_at: '2026-10-16T12:00:00.000Z' }] }) }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await Sync.pushAll();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/rpc/report_anomaly');
    expect(res.pushed).toBe(1);
  });

  it('assignment (manage_lubrication_assignment) y skip (record_lubrication_skip) pendientes siguen su flujo CATALOG normal', async () => {
    const db = makeFixtureDB();
    await db.put('audit_log', legacyAuditRowEdited);
    db._evidenceOps.push(
      { id: 'asg-op-1', actorId: 'u1', authorizationFingerprint: 'fp1', rpc: 'manage_lubrication_assignment', kind: 'CATALOG', targetStore: 'lubrication_assignments',
        params: { p_operation_id: 'asg-op-1', p_action: 'CREATE', p_id: 'asg1', p_equipment_id: 'e1', p_plan_id: 'p1', p_occurrence_key: 'p1:2026-10-16', p_crew_id: 'c1', p_notes: '' }, frozen: true },
      { id: 'skip-op-1', actorId: 'u1', authorizationFingerprint: 'fp1', rpc: 'record_lubrication_skip', kind: 'CATALOG', targetStore: 'lubrication_skips',
        params: { p_operation_id: 'skip-op-1', p_id: 'skip1', p_equipment_id: 'e1', p_plan_id: 'p1', p_occurrence_key: 'p1:2026-10-16', p_crew_id: 'c1', p_date: '2026-10-16T12:00:00.000Z', p_shift_id: 'shift_dia', p_reason: 'SIN_TIEMPO' }, frozen: true },
    );
    const { Sync } = loadSyncLogic(db, ['audit_log', 'lubrication_assignments', 'lubrication_skips'], fakeAuth());
    const fetchMock = vi.fn(async (url) => ({ ok: true, status: 200, json: async () => ({ status: 'APPLIED',
      rows: [{ store: String(url).includes('manage_lubrication_assignment') ? 'lubrication_assignments' : 'lubrication_skips',
        id: String(url).includes('manage_lubrication_assignment') ? 'asg1' : 'skip1',
        payload: { id: String(url).includes('manage_lubrication_assignment') ? 'asg1' : 'skip1' }, updated_at: '2026-10-16T12:00:00.000Z' }] }) }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await Sync.pushAll();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map(c => c[0]);
    expect(urls.some(u => u.includes('/rpc/manage_lubrication_assignment'))).toBe(true);
    expect(urls.some(u => u.includes('/rpc/record_lubrication_skip'))).toBe(true);
    expect(res.pushed).toBe(2);
    expect(await db.get('audit_log', 'log-edited')).toEqual(legacyAuditRowEdited); // intacta todo el tiempo
  });
});

describe('9) cambio de cuenta en el mismo dispositivo no mezcla audit_log ni otros stores', () => {
  it('audit_log legacy de la cuenta A nunca se envía bajo la identidad B; los stores normales de B siguen su propio alcance', async () => {
    const db = makeFixtureDB();
    await db.put('audit_log', legacyAuditRowNew); // cola legacy, previa a cualquier cuenta real
    await db.put('equipment', { id: 'eA', locationId: 'loc1', updatedAt: 'new', active: true }); // dirty, de la sesión de A

    const authA = fakeAuth({ appUserId: 'u1', authUserId: 'auth-a', fingerprint: 'fp-a' });
    const { Sync: SyncA } = loadSyncLogic(db, ['audit_log', 'equipment'], authA);
    const fetchA = vi.fn(async () => ({ ok: true, status: 200, json: async () => [{ id: 'eA' }] }));
    vi.stubGlobal('fetch', fetchA);
    const resA = await SyncA.pushAll();
    expect(resA.pushed).toBe(1); // solo equipment; audit_log nunca contado
    expect(fetchA).toHaveBeenCalledTimes(1);
    expect(fetchA.mock.calls[0][0]).not.toContain('audit_log');

    // Cambia de cuenta en el MISMO dispositivo/IndexedDB.
    vi.unstubAllGlobals();
    await db.put('equipment', { id: 'eB', locationId: 'loc2', updatedAt: 'new', active: true }); // dirty, de la sesión de B
    const authB = fakeAuth({ appUserId: 'u2', authUserId: 'auth-b', fingerprint: 'fp-b' });
    const { Sync: SyncB } = loadSyncLogic(db, ['audit_log', 'equipment'], authB);
    const fetchB = vi.fn(async (url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : null;
      // B nunca intenta re-subir el audit_log legacy ni el equipment ya confirmado de A.
      expect(url).not.toContain('audit_log');
      if (Array.isArray(body)) expect(body.every(r => r.id !== 'eA')).toBe(true);
      return { ok: true, status: 200, json: async () => [{ id: 'eB' }] };
    });
    vi.stubGlobal('fetch', fetchB);
    const resB = await SyncB.pushAll();
    expect(resB.pushed).toBe(1); // solo eB, su propio dirty
    expect(await db.get('audit_log', 'log-new')).toEqual(legacyAuditRowNew); // sigue intacta, de nadie en particular
  });
});

describe('10) registrarAvisoEnviado() en modo Supabase Auth ya NO crea audit_log sincronizable (mismo principio que logAudit())', () => {
  function loadRegistrarAviso(DB, App, Auth) {
    const body = [
      extractDeclaration(dbSource, 'uid'),
      extractDeclaration(dbSource, 'nowISO'),
      extractDeclaration(dbSource, 'stamp'),
      extractDeclaration(dbSource, 'isSupabaseAuthMode'),
      extractDeclaration(appSource, 'registrarAvisoEnviado'),
    ].join(';\n') + ';\nreturn registrarAvisoEnviado;';
    return new Function('DB', 'App', 'Auth', body)(DB, App, Auth);
  }

  it('modo Supabase: no escribe audit_log, nunca lanza, devuelve null', async () => {
    const DB = { put: vi.fn() };
    const App = { currentUser: { name: 'Operador' } };
    const Auth = { isSupabaseMode: () => true };
    const registrarAvisoEnviado = loadRegistrarAviso(DB, App, Auth);

    const result = await registrarAvisoEnviado('vencidos', 'Título', 'Cuerpo', 'LUBRICADOR');

    expect(result).toBeNull();
    expect(DB.put).not.toHaveBeenCalled();
  });

  it('modo legacy/no-Supabase: conserva el comportamiento anterior (sigue escribiendo audit_log local) si todavía aplica', async () => {
    const DB = { put: vi.fn(async (store, row) => row) };
    const App = { currentUser: { name: 'Operador' } };
    const Auth = { isSupabaseMode: () => false };
    const registrarAvisoEnviado = loadRegistrarAviso(DB, App, Auth);

    await registrarAvisoEnviado('vencidos', 'Título', 'Cuerpo', 'LUBRICADOR');

    expect(DB.put).toHaveBeenCalledTimes(1);
    const [store, row] = DB.put.mock.calls[0];
    expect(store).toBe('audit_log');
    expect(row).toMatchObject({ action: 'AVISO_ENVIADO', user: 'LUBRICADOR' });
  });

  it('sin Auth cargado (mismo default defensivo que isSupabaseAuthMode en todo el proyecto): se comporta como legacy, nunca asume supabase', async () => {
    const DB = { put: vi.fn(async (store, row) => row) };
    const App = { currentUser: { name: 'Operador' } };
    const registrarAvisoEnviado = loadRegistrarAviso(DB, App, undefined);

    await registrarAvisoEnviado('porEngrasar', 'T', 'C', 'rol');

    expect(DB.put).toHaveBeenCalledTimes(1); // Auth undefined -> isSupabaseAuthMode() === false -> comportamiento legacy
  });
});

describe('11) LocalNotifications sigue programándose con normalidad — independiente de registrarAvisoEnviado()', () => {
  const refreshSrc = extractDeclaration(appSource, 'refreshLocalNotifications');

  it('refreshLocalNotifications() sigue construyendo `notifications` y llamando LN.schedule() exactamente igual, sin tocar ese camino', () => {
    expect(refreshSrc).toContain('const notifications = [];');
    expect(refreshSrc).toContain('if (notifications.length) await LN.schedule({ notifications });');
  });

  it('los 5 call-sites de registrarAvisoEnviado() (vencidos/escalamiento/porEngrasar/asignación/validación) siguen presentes e intactos — solo cambió SU cuerpo, no quién la llama', () => {
    // 5to call-site agregado con "validaciones" (panel de tareas —
    // "validación pendiente" ahora también deja registro de auditoría,
    // mismo patrón que el resto, ver app.js:registrarAvisoEnviado()).
    expect(refreshSrc.match(/registrarAvisoEnviado\(/g) || []).toHaveLength(5);
    expect(refreshSrc).toContain("registrarAvisoEnviado('vencidos', titulo, cuerpo, rol);");
    expect(refreshSrc).toContain("registrarAvisoEnviado('porEngrasar', titulo, cuerpo, rol);");
    expect(refreshSrc).toContain("registrarAvisoEnviado('validacion', tituloVal, cuerpoVal, rol);");
  });
});
