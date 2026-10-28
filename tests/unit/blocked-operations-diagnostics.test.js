// tests/unit/blocked-operations-diagnostics.test.js
//
// LOTE "DIAGNÓSTICO BLOCKED" — Configuración → Diagnóstico de
// sincronización, sección "Operaciones bloqueadas" (app.js). Carga las
// funciones REALES (extractDeclaration + new Function, mismo patrón que
// master-data-import-gate.test.js/lub02-checklist...test.js), nunca una
// reimplementación. DB es un fake en memoria (mismo criterio que
// storage-privacy.test.js) — sin IndexedDB real, sin red, sin Supabase.
//
// pendingCount() se carga del sync.js REAL (loadSyncLogic) contra el MISMO
// fake DB, para confirmar con la lógica real (no una copia) que descartar
// una operación bloqueada de verdad baja el contador.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readSource, extractDeclaration, buildModuleBody } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, loadSyncLogic } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const NAMES = [
  'esc', 'fmtDate',
  'BLOCKED_OPERATION_REASON_LABELS', 'blockedOperationReasonLabel',
  'BLOCKED_OPERATION_TYPE_LABELS', 'blockedOperationTypeLabel',
  'resolveBlockedOperationEquipmentId', 'effectiveBlockedReason',
  'SAFE_DISCARD_TARGET_STORES', 'isBlockedOperationSafeToDiscard',
  'blockedOperationsDiagnostics', 'blockedOperationRowHTML', 'blockedOperationsPanelHTML',
  'retryBlockedOperation', 'discardBlockedOperation',
];
const body = buildModuleBody(appSource, NAMES);

function load(DB, Auth) {
  const factory = new Function('DB', 'Auth', body);
  return factory(DB, Auth);
}

const PROFILE = { appUserId: 'u1', authorizationFingerprint: 'fp-1' };
function makeFakeAuth(profile = PROFILE) {
  return { getProfile: () => profile };
}

function makeFakeDB(seed = {}) {
  const appConfig = new Map();
  for (const [key, value] of Object.entries(seed.app_config || {})) appConfig.set(key, { key, value });
  const data = {};
  for (const [store, rows] of Object.entries(seed)) if (store !== 'app_config') data[store] = [...rows];

  return {
    _appConfig: appConfig, _data: data,
    async getConfig() { return { url: 'https://fake.supabase.co', anonKey: 'anon-test' }; },
    async all(store) { return store === 'app_config' ? [...appConfig.values()] : (data[store] ? [...data[store]] : []); },
    async allActive(store) { return (data[store] || []).filter(r => r.active !== false); },
    async get(store, id) {
      if (store === 'app_config') return appConfig.get(id) || null;
      return (data[store] || []).find(r => r.id === id) || null;
    },
    async put(store, obj) {
      if (store === 'app_config') { appConfig.set(obj.key, obj); return obj; }
      data[store] = data[store] || [];
      const i = data[store].findIndex(r => r.id === obj.id);
      if (i >= 0) data[store][i] = obj; else data[store].push(obj);
      return obj;
    },
    async delete(store, id) {
      if (store === 'app_config') { appConfig.delete(id); return true; }
      data[store] = (data[store] || []).filter(r => r.id !== id);
      return true;
    },
    async getExecutionOperations() {
      return [...appConfig.values()].filter(r => r.key.startsWith('execution:')).map(r => r.value)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    },
    async getEvidenceOperations() {
      return [...appConfig.values()].filter(r => r.key.startsWith('evidence:')).map(r => r.value)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    },
    async updateExecutionOperation(op) { appConfig.set('execution:' + op.id, { key: 'execution:' + op.id, value: op }); return op; },
    async updateEvidenceOperation(op) { appConfig.set('evidence:' + op.id, { key: 'evidence:' + op.id, value: op }); return op; },
  };
}

const EQUIPO = { id: 'eq1', code: 'A-01', active: true };

function executionOp(overrides = {}) {
  return {
    id: 'exop1', actorId: 'u1', authorizationFingerprint: 'fp-1', createdAt: '2026-10-20T10:00:00.000Z',
    params: { p_action: 'CREATE', p_equipment_id: 'eq1', p_record_id: 'rec1' },
    ...overrides,
  };
}
function evidenceOp(overrides = {}) {
  return {
    id: 'evop1', actorId: 'u1', authorizationFingerprint: 'fp-1', createdAt: '2026-10-20T10:00:00.000Z',
    rpc: 'record_lubrication_skip', kind: 'CATALOG', targetStore: 'lubrication_skips',
    params: { p_equipment_id: 'eq1', p_id: 'skip1' },
    ...overrides,
  };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('0 bloqueadas', () => {
  it('sin operaciones en cola: devuelve []', async () => {
    const { blockedOperationsDiagnostics } = load(makeFakeDB(), makeFakeAuth());
    expect(await blockedOperationsDiagnostics()).toEqual([]);
  });

  it('con operaciones en cola pero ninguna bloqueada (cuenta/alcance al día): devuelve []', async () => {
    const DB = makeFakeDB({
      app_config: { 'execution:exop1': executionOp({ status: 'PENDING' }) },
      equipment: [EQUIPO],
    });
    const { blockedOperationsDiagnostics } = load(DB, makeFakeAuth());
    expect(await blockedOperationsDiagnostics()).toEqual([]);
  });
});

describe('1 bloqueada', () => {
  it('una operación EXECUTION bloqueada por el servidor (BLOCKED real): aparece con equipo/fecha/motivo legibles', async () => {
    const DB = makeFakeDB({
      app_config: { 'execution:exop1': executionOp({ status: 'BLOCKED', code: 'AUTH_FORBIDDEN' }) },
      equipment: [EQUIPO],
    });
    const { blockedOperationsDiagnostics } = load(DB, makeFakeAuth());
    const result = await blockedOperationsDiagnostics();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'exop1', source: 'execution', equipmentCode: 'A-01', reasonCode: 'AUTH_FORBIDDEN',
      typeLabel: 'Registro de engrase', canDiscardSafely: false,
    });
    expect(result[0].reasonLabel).not.toBe('AUTH_FORBIDDEN'); // nunca el código crudo
    expect(result[0].reasonLabel.toLowerCase()).toContain('permiso');
  });

  it('CREW_SELECTION_REQUIRED (evidence BLOCKED real): motivo legible, nunca el código crudo', async () => {
    const DB = makeFakeDB({
      app_config: { 'evidence:evop1': evidenceOp({ status: 'BLOCKED', code: 'CREW_SELECTION_REQUIRED' }) },
      equipment: [EQUIPO],
    });
    const { blockedOperationsDiagnostics } = load(DB, makeFakeAuth());
    const result = await blockedOperationsDiagnostics();
    expect(result).toHaveLength(1);
    expect(result[0].reasonCode).toBe('CREW_SELECTION_REQUIRED');
    expect(result[0].reasonLabel).toContain('cuadrilla');
  });
});

describe('varios bloqueadas (persistidas + calculadas en caliente)', () => {
  it('mezcla real: BLOCKED persistido + EXECUTION_ACCOUNT_MISMATCH + AUTHORIZATION_SCOPE_STALE, todas visibles', async () => {
    const DB = makeFakeDB({
      app_config: {
        'execution:exop1': executionOp({ status: 'BLOCKED', code: 'SIGNED_RECORD_LOCKED' }),
        'execution:exop2': executionOp({ id: 'exop2', actorId: 'OTRO_USUARIO' }), // nunca persiste BLOCKED, se calcula
        'evidence:evop1': evidenceOp({ authorizationFingerprint: 'fp-VIEJA' }), // alcance desactualizado
      },
      equipment: [EQUIPO],
    });
    const { blockedOperationsDiagnostics } = load(DB, makeFakeAuth());
    const result = await blockedOperationsDiagnostics();
    expect(result).toHaveLength(3);
    const byId = Object.fromEntries(result.map(r => [r.id, r]));
    expect(byId.exop1.reasonCode).toBe('SIGNED_RECORD_LOCKED');
    expect(byId.exop2.reasonCode).toBe('EXECUTION_ACCOUNT_MISMATCH');
    expect(byId.evop1.reasonCode).toBe('AUTHORIZATION_SCOPE_STALE');
  });
});

describe('Reintentar', () => {
  it('quita status/code BLOCKED — la operación deja de aparecer en el diagnóstico (nunca contacta la red por su cuenta)', async () => {
    const DB = makeFakeDB({
      app_config: { 'evidence:evop1': evidenceOp({ status: 'BLOCKED', code: 'CREW_SELECTION_REQUIRED' }) },
      equipment: [EQUIPO],
    });
    const { blockedOperationsDiagnostics, retryBlockedOperation } = load(DB, makeFakeAuth());
    expect(await blockedOperationsDiagnostics()).toHaveLength(1);

    await retryBlockedOperation('evidence', 'evop1');

    const stored = await DB.get('app_config', 'evidence:evop1');
    expect(stored.value.status).toBe('PENDING');
    expect(stored.value.code).toBeUndefined();
    expect(await blockedOperationsDiagnostics()).toEqual([]);
  });
});

describe('Descarte permitido', () => {
  it('CATALOG/lubrication_skips BLOCKED: isBlockedOperationSafeToDiscard() true, la fila renderizada ofrece "Descartar"', async () => {
    const { isBlockedOperationSafeToDiscard, blockedOperationRowHTML } = load(makeFakeDB(), makeFakeAuth());
    const item = { id: 'evop1', source: 'evidence', typeLabel: 'x', equipmentCode: 'A-01', date: null, reasonLabel: 'x', canDiscardSafely: true };
    expect(isBlockedOperationSafeToDiscard({ ...evidenceOp(), status: 'BLOCKED', source: 'evidence' })).toBe(true);
    expect(blockedOperationRowHTML(item)).toContain('btn-discard-blocked-op');
  });

  it('descartar realmente borra SOLO la operación — deja de contarse en Sync.pendingCount() real', async () => {
    const DB = makeFakeDB({
      app_config: { 'evidence:evop1': evidenceOp({ status: 'BLOCKED', code: 'CREW_SELECTION_REQUIRED' }) },
      equipment: [EQUIPO],
      lubrication_skips: [],
    });
    const { discardBlockedOperation } = load(DB, makeFakeAuth());
    const { Sync } = loadSyncLogic(DB, ['equipment', 'lubrication_skips']);

    const before = await Sync.pendingCount();
    expect(before).toBe(1); // la operación bloqueada, sin ninguna fila que la represente

    await discardBlockedOperation('evidence', 'evop1');

    expect(await DB.get('app_config', 'evidence:evop1')).toBeNull();
    expect(await Sync.pendingCount()).toBe(0);
  });
});

describe('Descarte prohibido', () => {
  it('operación EXECUTION: isBlockedOperationSafeToDiscard() false, la fila SOLO ofrece "Reintentar" + explicación', async () => {
    const { isBlockedOperationSafeToDiscard, blockedOperationRowHTML } = load(makeFakeDB(), makeFakeAuth());
    expect(isBlockedOperationSafeToDiscard({ ...executionOp(), status: 'BLOCKED', source: 'execution' })).toBe(false);
    const item = { id: 'exop1', source: 'execution', typeLabel: 'Registro de engrase', equipmentCode: 'A-01', date: null, reasonLabel: 'x', canDiscardSafely: false };
    const html = blockedOperationRowHTML(item);
    expect(html).toContain('btn-retry-blocked-op');
    expect(html).not.toContain('btn-discard-blocked-op');
    expect(html).toContain('No se puede descartar');
  });

  it('evidence NO-CATALOG (ej. anomalía): tampoco es seguro descartar', () => {
    const { isBlockedOperationSafeToDiscard } = load(makeFakeDB(), makeFakeAuth());
    expect(isBlockedOperationSafeToDiscard({ status: 'BLOCKED', source: 'evidence', rpc: 'report_anomaly', kind: undefined, targetStore: undefined })).toBe(false);
  });

  it('evidence CATALOG pero sobre equipment/lubrication_plans: tampoco es seguro (blockEvidenceOperation no les fija originalRow)', () => {
    const { isBlockedOperationSafeToDiscard } = load(makeFakeDB(), makeFakeAuth());
    expect(isBlockedOperationSafeToDiscard({ status: 'BLOCKED', source: 'evidence', kind: 'CATALOG', targetStore: 'equipment' })).toBe(false);
    expect(isBlockedOperationSafeToDiscard({ status: 'BLOCKED', source: 'evidence', kind: 'CATALOG', targetStore: 'lubrication_plans' })).toBe(false);
  });

  it('un bloqueo CALCULADO (no persistido) nunca es seguro de descartar, aunque el targetStore sea el seguro', () => {
    const { isBlockedOperationSafeToDiscard } = load(makeFakeDB(), makeFakeAuth());
    expect(isBlockedOperationSafeToDiscard({ status: 'PENDING', source: 'evidence', kind: 'CATALOG', targetStore: 'lubrication_skips' })).toBe(false);
  });
});

describe('No afecta registros reales', () => {
  it('discardBlockedOperation() nunca toca otras filas de negocio no relacionadas', async () => {
    const otroRegistro = { id: 'rec_otro', equipmentId: 'eq1', data: 'intacto' };
    const DB = makeFakeDB({
      app_config: { 'evidence:evop1': evidenceOp({ status: 'BLOCKED', code: 'CREW_SELECTION_REQUIRED' }) },
      equipment: [EQUIPO],
      lubrication_records: [otroRegistro],
    });
    const { discardBlockedOperation } = load(DB, makeFakeAuth());
    await discardBlockedOperation('evidence', 'evop1');
    expect(await DB.get('lubrication_records', 'rec_otro')).toEqual(otroRegistro);
    expect(await DB.get('equipment', 'eq1')).toEqual(EQUIPO);
  });
});

describe('pendingCount se actualiza', () => {
  it('baja en 1 al descartar una operación bloqueada representada; no cambia al reintentar', async () => {
    const DB = makeFakeDB({
      app_config: {
        'evidence:evop1': evidenceOp({ status: 'BLOCKED', code: 'CREW_SELECTION_REQUIRED' }),
        'evidence:evop2': evidenceOp({ id: 'evop2', status: 'BLOCKED', code: 'CREW_SELECTION_REQUIRED' }),
      },
      equipment: [EQUIPO],
    });
    const { retryBlockedOperation, discardBlockedOperation } = load(DB, makeFakeAuth());
    const { Sync } = loadSyncLogic(DB, ['equipment', 'lubrication_skips']);

    expect(await Sync.pendingCount()).toBe(2);

    await retryBlockedOperation('evidence', 'evop2');
    expect(await Sync.pendingCount()).toBe(2); // sigue pendiente, solo deja de estar BLOCKED

    await discardBlockedOperation('evidence', 'evop1');
    expect(await Sync.pendingCount()).toBe(1);
  });
});

describe('Offline', () => {
  it('leer el diagnóstico, reintentar y descartar funcionan igual sin conexión — todo es lectura/escritura local', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const DB = makeFakeDB({
      app_config: { 'evidence:evop1': evidenceOp({ status: 'BLOCKED', code: 'CREW_SELECTION_REQUIRED' }) },
      equipment: [EQUIPO],
    });
    const { blockedOperationsDiagnostics, retryBlockedOperation, discardBlockedOperation } = load(DB, makeFakeAuth());

    expect(await blockedOperationsDiagnostics()).toHaveLength(1);
    await retryBlockedOperation('evidence', 'evop1');
    expect((await DB.get('app_config', 'evidence:evop1')).value.status).toBe('PENDING');

    await discardBlockedOperation('evidence', 'evop1');
    expect(await DB.get('app_config', 'evidence:evop1')).toBeNull();
  });
});
