/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT
   Capa de datos: IndexedDB (offline-first, sin backend)
   ============================================================ */

const DB_NAME = 'engrase_openpit';
// v8: agrega el store 'lubrication_skips' ("No se pudo ejecutar" — lote
// occurrences/carryover, §1, ver src/core/operational-scope.js). NUNCA
// pisa/duplica lubrication_records: un skip es un registro de que la
// ocurrencia NO se hizo en este turno (motivo + observación), no un
// engrase. Migración NO destructiva: onupgradeneeded ya crea genéricamente
// cualquier store nuevo que aparezca en STORES (ver v6) — no hace falta
// tocar esa función, ningún store existente se toca ni se vacía.
// v9: additive crew coverage store; existing records and catalogs stay intact.
const DB_VERSION = 9;

// Almacenes que se sincronizan con el servidor remoto (todo excepto configuración local del dispositivo)
const STORES = [
  'users', 'shifts', 'locations', 'equipment_types', 'equipment',
  'lubricants', 'lubrication_plans', 'lubrication_points',
  'lubrication_records', 'anomalies', 'audit_log', 'settings', 'cuadrillas', 'push_tokens',
  'grease_validations', 'lubrication_assignments', 'lubrication_skips', 'crew_locations'
];

// app_config y grease_drafts viven solo en el dispositivo (credenciales de conexión,
// cursores de sincronización, borradores de formularios sin terminar)
const LOCAL_STORES = ['app_config', 'grease_drafts'];

let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      STORES.forEach(name => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      });
      if (!db.objectStoreNames.contains('app_config')) {
        db.createObjectStore('app_config', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('grease_drafts')) {
        db.createObjectStore('grease_drafts', { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeName, mode = 'readonly') {
  return _db.transaction(storeName, mode).objectStore(storeName);
}

function orderExecutionOperations(operations) {
  const remaining = [...operations].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const ordered = [];
  while (remaining.length) {
    const ids = new Set(remaining.map(op => op.id));
    const index = remaining.findIndex(op => Object.values(op.dependencies || {}).every(dep => !ids.has(dep.operationId)));
    if (index < 0) return [...ordered, ...remaining]; // Cycle remains pending, never dispatched blindly.
    ordered.push(...remaining.splice(index, 1));
  }
  return ordered;
}

function sameExecutionVersion(left, right) {
  const normalize = value => typeof value === 'string' ? value.replace(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/,
    (_, seconds, fraction) => `${seconds}.${(fraction || '').padEnd(6, '0')}Z`) : value;
  return normalize(left) === normalize(right);
}

const DB = {
  getExecutionOperations() {
    return new Promise((resolve, reject) => {
      const request = tx('app_config').getAll();
      request.onsuccess = () => resolve(orderExecutionOperations(request.result.filter(r => r.key.startsWith('execution:')).map(r => r.value)));
      request.onerror = () => reject(request.error);
    });
  },
  // Business rows and their restricted transport intent commit together locally.
  putExecutionOperation(operation, changes) {
    return new Promise((resolve, reject) => {
      const transaction = _db.transaction(['app_config', ...new Set([...changes, ...operation.localBases].map(c => c.store))], 'readwrite');
      let remaining = operation.localBases.length;
      let failure;
      for (const base of operation.localBases) {
        const request = transaction.objectStore(base.store).get(base.id);
        request.onsuccess = () => {
          if ((request.result?.updatedAt || null) !== base.updatedAt) {
            failure = new Error('LOCAL_VERSION_CONFLICT'); transaction.abort(); return;
          }
          if (--remaining !== 0) return;
          for (const { store, row } of changes) {
            transaction.objectStore(store).put({ ...row, _executionOperationId: operation.id });
          }
          transaction.objectStore('app_config').add({ key: 'execution:' + operation.id, value: operation });
        };
      }
      transaction.oncomplete = () => resolve(operation);
      transaction.onabort = () => reject(failure || transaction.error);
      transaction.onerror = () => reject(failure || transaction.error || new Error('LOCAL_VERSION_CONFLICT'));
    });
  },
  updateExecutionOperation(operation) {
    return new Promise((resolve, reject) => {
      const transaction = _db.transaction('app_config', 'readwrite');
      transaction.objectStore('app_config').put({ key: 'execution:' + operation.id, value: operation });
      transaction.oncomplete = () => resolve(operation);
      transaction.onabort = () => reject(transaction.error);
    });
  },
  blockSignedExecution(operation, canonicalRows) {
    return new Promise((resolve, reject) => {
      const transaction = _db.transaction(['app_config', ...new Set(canonicalRows.map(r => r.store))], 'readwrite');
      const config = transaction.objectStore('app_config');
      const request = config.getAll();
      request.onsuccess = () => {
        const blockedIds = new Set();
        for (const entry of request.result.filter(r => r.key.startsWith('execution:'))) {
          const op = entry.value;
          if (op.params.p_record_id !== operation.params.p_record_id || op.params.p_action !== 'EDIT') continue;
          op.status = 'BLOCKED'; op.code = 'SIGNED_RECORD_LOCKED';
          blockedIds.add(op.id); config.put(entry);
        }
        for (const remote of canonicalRows) {
          const store = transaction.objectStore(remote.store);
          const read = store.get(remote.id);
          read.onsuccess = () => {
            if (!blockedIds.has(read.result?._executionOperationId)) return;
            const payload = Object.fromEntries(Object.entries(remote.payload).filter(([key]) => !key.startsWith('_')));
            const original = operation.originalRecord;
            const photos = remote.store === 'lubrication_records' && original && sameExecutionVersion(original._pushedVersion, remote.updated_at)
              ? { photos: original.photos, photo: original.photo } : {};
            store.put({ ...payload, ...photos, updatedAt: remote.updated_at, _pushedVersion: remote.updated_at });
          };
        }
      };
      transaction.oncomplete = () => resolve(true);
      transaction.onabort = () => reject(transaction.error || new Error('SIGNED_RECORD_RESTORE_FAILED'));
      transaction.onerror = () => reject(transaction.error || new Error('SIGNED_RECORD_RESTORE_FAILED'));
    });
  },
  finishExecutionOperation(operation, canonicalRows) {
    return new Promise((resolve, reject) => {
      const transaction = _db.transaction(['app_config', ...new Set(canonicalRows.map(r => r.store))], 'readwrite');
      const config = transaction.objectStore('app_config');
      config.delete('execution:' + operation.id);
      for (const remote of canonicalRows) {
        const canonicalPayload = Object.fromEntries(Object.entries(remote.payload).filter(([key]) => !key.startsWith('_')));
        const store = transaction.objectStore(remote.store);
        const request = store.get(remote.id);
        request.onsuccess = () => {
          const local = request.result;
          if (!local) return;
          if (local._executionOperationId === operation.id && local.updatedAt === operation.localVersions[remote.store]) {
            // Preserve already stamped local evidence for offline viewing.
            const photos = remote.store === 'lubrication_records' ? { photos: local.photos, photo: local.photo } : {};
            store.put({ ...canonicalPayload, ...photos, updatedAt: remote.updated_at, _pushedVersion: remote.updated_at });
          } else if (local._executionOperationId === operation.id) {
            // Another local catalog operation happened during dispatch. Preserve its delta
            // against the exact submitted local row; remove only the completed transport tag.
            const base = operation.localRows[remote.store];
            const delta = Object.fromEntries(Object.entries(local).filter(([key, value]) =>
              !key.startsWith('_') && JSON.stringify(value) !== JSON.stringify(base[key])));
            store.put({ ...canonicalPayload, ...delta, updatedAt: local.updatedAt, _pushedVersion: remote.updated_at });
          } else if (local._executionOperationId) {
            store.put({ ...local, _pushedVersion: remote.updated_at });
          }
        };
      }
      const pendingRequest = config.getAll();
      pendingRequest.onsuccess = () => {
        for (const entry of pendingRequest.result.filter(r => r.key.startsWith('execution:'))) {
          const next = entry.value;
          for (const [field, dependency] of Object.entries(next.dependencies || {})) {
            if (dependency.operationId !== operation.id) continue;
            const remote = canonicalRows.find(r => r.store === dependency.store && r.id === dependency.id);
            if (!remote || next.frozen) { transaction.abort(); return; }
            next.params[field] = remote.updated_at;
            delete next.dependencies[field];
          }
          config.put(entry);
        }
      };
      transaction.oncomplete = () => resolve(true);
      transaction.onabort = () => reject(transaction.error || new Error('EXECUTION_ACK_CONFLICT'));
    });
  },
  resolveValidationConflict(recordId, expected, officialId, reason, actor) {
    if (!actor || actor.active === false || actor.role !== 'ADMINISTRADOR' || !actor.id) {
      return Promise.reject(new Error('Solo ADMINISTRADOR puede resolver el conflicto.'));
    }
    if (!reason || !reason.trim()) return Promise.reject(new Error('El motivo es obligatorio.'));
    return new Promise((resolve, reject) => {
      const transaction = _db.transaction('grease_validations', 'readwrite');
      const store = transaction.objectStore('grease_validations');
      let saved, failure;
      const request = store.getAll();
      request.onsuccess = () => {
        const rows = request.result.filter(v => v.lubricationRecordId === recordId && v.active !== false)
          .sort((a, b) => a.id.localeCompare(b.id));
        const versions = rows.map(v => ({ id: v.id, updatedAt: v.updatedAt }));
        if (rows.length < 2 || !rows.some(v => v.id === officialId) ||
            JSON.stringify(versions) !== JSON.stringify(expected)) {
          failure = new Error('El conflicto cambió. Recarga las firmas antes de resolver.');
          transaction.abort(); return;
        }
        const anchor = rows[0];
        if (anchor._validationResolutionConflict) {
          failure = new Error('Existe un conflicto CAS pendiente de sincronización.');
          transaction.abort(); return;
        }
        const previous = anchor.conflictResolution;
        const resolution = {
          id: uid('resolution'), officialValidationId: officialId,
          signatureIds: rows.map(v => v.id).sort(), resolvedById: actor.id,
          resolvedByName: actor.name, resolvedAt: nowISO(), reason: reason.trim(),
          history: previous ? [...(previous.history || []), { ...previous, history: undefined }] : [],
        };
        saved = stamp({ ...anchor, conflictResolution: resolution }, actor.name);
        // Keep the CAS revision distinct even with a frozen/coarse device clock.
        const previousTime = Date.parse(anchor.updatedAt);
        if (Number.isFinite(previousTime) && Date.parse(saved.updatedAt) <= previousTime) {
          saved.updatedAt = new Date(previousTime + 1).toISOString();
        }
        store.put(saved);
      };
      transaction.oncomplete = () => resolve(saved);
      transaction.onabort = () => reject(failure || transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  },
  async putMany(store, rows) {
    return new Promise((resolve, reject) => {
      const transaction = _db.transaction(store, 'readwrite');
      const objectStore = transaction.objectStore(store);
      rows.forEach(row => objectStore.put(row));
      transaction.oncomplete = () => resolve(rows);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  },
  async init() {
    await openDB();
    await ensureDefaultSyncConfig();
    // El catálogo base (turnos, ubicaciones, lubricantes, cuadrillas) solo se crea si
    // este dispositivo es el PRIMERO del sistema. Si el servidor ya tiene datos, se
    // baja lo que hay en vez de inventar copias nuevas.
    //
    // Antes no se consultaba al servidor: cada celular nuevo creaba su propio catálogo
    // de ejemplo y lo subía, así que lo que el administrador había borrado revivía en
    // cuanto alguien instalaba la app en otro teléfono.
    await seedSoloSiElSistemaEstaVacio();
    await ensureDefaultSyncConfig();
  },

  put(store, obj) {
    return new Promise((res, rej) => {
      const r = tx(store, 'readwrite').put(obj);
      r.onsuccess = () => res(obj);
      r.onerror = (e) => rej(e.target.error);
    });
  },
  get(store, id) {
    return new Promise((res, rej) => {
      const r = tx(store).get(id);
      r.onsuccess = () => res(r.result || null);
      r.onerror = (e) => rej(e.target.error);
    });
  },
  all(store) {
    return new Promise((res, rej) => {
      const r = tx(store).getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = (e) => rej(e.target.error);
    });
  },
  delete(store, id) {
    return new Promise((res, rej) => {
      const r = tx(store, 'readwrite').delete(id);
      r.onsuccess = () => res(true);
      r.onerror = (e) => rej(e.target.error);
    });
  },
  async allActive(store) {
    const rows = await this.all(store);
    return rows.filter(r => r.active !== false);
  },

  // Configuración local del dispositivo (URL/llave de Supabase, cursores de sync)
  async getConfig() {
    return new Promise((res, rej) => {
      const r = tx('app_config').get('sync');
      r.onsuccess = () => res(r.result ? r.result.value : null);
      r.onerror = (e) => rej(e.target.error);
    });
  },
  async setConfig(value) {
    return new Promise((res, rej) => {
      const r = tx('app_config', 'readwrite').put({ key: 'sync', value });
      r.onsuccess = () => res(value);
      r.onerror = (e) => rej(e.target.error);
    });
  },

  // Conflictos de sincronización multidispositivo (P0-1, ver sync.js
  // decidePullAction/checkPushAllowed): mismo registro cambiado en este
  // dispositivo Y en el servidor desde la última base en que ambos
  // coincidían. Se guardan en app_config (mismo patrón ya usado para la
  // config de sync: un blob bajo una key fija) — NO requiere un store
  // nuevo ni subir DB_VERSION. Nunca se acumulan copias viejas: cada
  // conflicto nuevo para el mismo store+id reemplaza al anterior (versión
  // más reciente conocida), nunca se borra ninguna versión de datos real.
  async getSyncConflicts() {
    return new Promise((res, rej) => {
      const r = tx('app_config').get('sync_conflicts');
      r.onsuccess = () => res(r.result ? r.result.value : []);
      r.onerror = (e) => rej(e.target.error);
    });
  },
  async recordConflicts(newConflicts) {
    if (!newConflicts || !newConflicts.length) return;
    const existing = await this.getSyncConflicts();
    const byKey = new Map(existing.map(c => [`${c.store}:${c.id}`, c]));
    for (const c of newConflicts) byKey.set(`${c.store}:${c.id}`, c);
    for (const c of newConflicts.filter(c => c.store === 'grease_validations')) {
      const row = await this.get(c.store, c.id);
      if (row?.conflictResolution) await this.put(c.store, { ...row, _validationResolutionConflict: true });
    }
    return new Promise((res, rej) => {
      const r = tx('app_config', 'readwrite').put({ key: 'sync_conflicts', value: Array.from(byKey.values()) });
      r.onsuccess = () => res(true);
      r.onerror = (e) => rej(e.target.error);
    });
  },
  // Se llama SOLO cuando un humano resuelve el conflicto a mano (fuera del
  // alcance de esta tarea) — nunca automáticamente al sincronizar.
  async clearSyncConflict(store, id) {
    const existing = await this.getSyncConflicts();
    const filtered = existing.filter(c => !(c.store === store && c.id === id));
    return new Promise((res, rej) => {
      const r = tx('app_config', 'readwrite').put({ key: 'sync_conflicts', value: filtered });
      r.onsuccess = () => res(true);
      r.onerror = (e) => rej(e.target.error);
    });
  },

  // Sesión de Supabase Auth (P0-2, ver src/core/auth.js) — SOLO
  // credenciales: { accessToken, refreshToken, expiresAt, authUserId } o
  // null. Namespace SEPARADO del snapshot de perfil (abajo) a propósito
  // — nunca se guardan juntos en la misma key, para que cualquier lectura
  // de "quién es el último usuario verificado en pantalla" no tenga que
  // tocar el blob que sí contiene tokens. Mismo patrón de
  // getSyncConflicts()/recordConflicts(): un blob bajo una key fija de
  // app_config (LOCAL_STORES, NUNCA sincroniza — nunca viaja por
  // pushAll()/pullAll(), ver STORES arriba). NUNCA contiene PIN ni
  // password — eso vive únicamente en auth.users, gestionado por
  // Supabase Auth, jamás en el cliente. Con AUTH_MODE='supabase' (el
  // default real y definitivo, ver src/core/auth.js), estos métodos se
  // usan activamente en cada login/restoreSession.
  async getAuthTokens() {
    return new Promise((res, rej) => {
      const r = tx('app_config').get('auth_tokens');
      r.onsuccess = () => res(r.result ? r.result.value : null);
      r.onerror = (e) => rej(e.target.error);
    });
  },
  async setAuthTokens(value) {
    return new Promise((res, rej) => {
      const r = tx('app_config', 'readwrite').put({ key: 'auth_tokens', value });
      r.onsuccess = () => res(value);
      r.onerror = (e) => rej(e.target.error);
    });
  },

  // Snapshot LOCAL de perfil ya validado — { authUserId, appUserId,
  // displayName, role, active, lastVerifiedAt } o null. Es UX offline
  // pura ("trabajando como <nombre>" sin red): jamás sustituye a un
  // token vigente como autoridad de servidor (ver
  // Auth.isAuthenticated(), que exige AMBAS cosas por separado). Vive en
  // su propia key, separada de auth_tokens — nunca en el mismo objeto.
  async getAuthProfileSnapshot() {
    return new Promise((res, rej) => {
      const r = tx('app_config').get('auth_profile_snapshot');
      r.onsuccess = () => res(r.result ? r.result.value : null);
      r.onerror = (e) => rej(e.target.error);
    });
  },
  async setAuthProfileSnapshot(value) {
    return new Promise((res, rej) => {
      const r = tx('app_config', 'readwrite').put({ key: 'auth_profile_snapshot', value });
      r.onsuccess = () => res(value);
      r.onerror = (e) => rej(e.target.error);
    });
  },

  // Quick unlock local (P0-2, ver src/core/quick-unlock.js) — { appUserId,
  // salt, hash, iterations, createdAt, failedAttempts, lockedUntil } o null.
  // NUNCA contiene el PIN en texto plano, solo su hash PBKDF2. Mismo
  // patrón que auth_tokens/auth_profile_snapshot: un blob en app_config
  // (LOCAL_STORES, nunca sincroniza). Vive en su PROPIA key, separada de
  // auth_tokens y auth_profile_snapshot — el PIN nunca sustituye ni toca
  // esos dos namespaces.
  async getQuickUnlock() {
    return new Promise((res, rej) => {
      const r = tx('app_config').get('auth_quick_unlock');
      r.onsuccess = () => res(r.result ? r.result.value : null);
      r.onerror = (e) => rej(e.target.error);
    });
  },
  async setQuickUnlock(value) {
    return new Promise((res, rej) => {
      const r = tx('app_config', 'readwrite').put({ key: 'auth_quick_unlock', value });
      r.onsuccess = () => res(value);
      r.onerror = (e) => rej(e.target.error);
    });
  }
};

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function nowISO() { return new Date().toISOString(); }

// Mejora pre-cutover — Bloque B (conectividad real): timeout central para
// las llamadas de red CRÍTICAS (Auth, app_profiles, engrase_sync,
// manage-users — ver auth.js/sync.js). Sin esto, un backend que nunca
// responde (ni 200 ni error, solo se queda callado) podía dejar un fetch
// colgado para siempre y, con él, `Sync.syncing` atascado en `true`,
// bloqueando cualquier sync futuro. `navigator.onLine` sigue decidiendo si
// SIQUIERA se intenta (ver sync.js fullSync()) — esto solo protege el
// intento en sí una vez que ya se decidió intentarlo. Deliberadamente NO se
// aplica a las subidas de Storage (fotos/firma): son payloads más grandes
// en redes lentas, fuera del alcance explícito de este cierre.
const NETWORK_TIMEOUT_MS = 10000;
function fetchWithTimeout(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
}

// Clasifica una excepción de fetch como "el backend no está disponible
// ahora mismo" (red inaccesible, DNS, timeout) — NUNCA un 401/403 (esas son
// respuestas HTTP reales con `resp.ok`, no excepciones) ni un bug de la
// app. `navigator.onLine === true` NO garantiza que esto no pase — hallazgo
// real confirmado en el piloto Android (el WebView reportaba online con la
// red realmente caída); la única señal confiable es que la request en sí
// falló a nivel de red/transporte.
function isNetworkFailure(err) {
  if (!err) return false;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true; // AbortSignal.timeout()
  if (err instanceof TypeError) return true; // "Failed to fetch" / DNS / sin red real
  return false;
}

function stamp(obj, user) {
  const t = nowISO();
  if (!obj.id) obj.id = uid('rec');
  if (!obj.createdAt) obj.createdAt = t;
  obj.updatedAt = t;
  if (!obj.createdBy) obj.createdBy = user || 'sistema';
  if (obj.active === undefined) obj.active = true;
  return obj;
}

// Fixed execution DTO: never transports arbitrary catalog fields or a store name.
async function queueLubricationExecution({ action, record, recordBefore, equipmentBefore, planBefore, assignmentBefore,
  equipmentAfter, planAfter, assignmentAfter, crewId, actorId }) {
  if (!actorId) throw new Error('AUTH_REQUIRED');
  // Do not absorb an earlier catalog mutation into the execution's restricted fields.
  // Its scope/version must reach the server through its own authorized workflow first.
  for (const row of [equipmentBefore, planBefore, assignmentBefore, recordBefore]) {
    if (row?.updatedAt && row._pushedVersion !== row.updatedAt && !row._executionOperationId) {
      throw new Error('CATALOG_SYNC_REQUIRED');
    }
  }
  const id = action === 'CREATE' ? record.id : uid('gedit');
  const snapshot = record.operationalSnapshot || {};
  const params = {
    p_operation_id: id, p_action: action, p_record_id: record.id,
    p_equipment_id: record.equipmentId, p_plan_id: record.planId || planBefore?.id || null,
    p_crew_id: crewId || snapshot.crewId || null,
    p_assignment_id: snapshot.assignmentId || null,
    p_execution_date: record.date, p_client_captured_at: record.createdAt || record.date, p_shift_id: record.shiftId,
    p_execution_type: snapshot.executionType || 'PLANNED',
    p_out_of_plan_reason: snapshot.outOfPlanReason || null,
    p_performed_by: record.userId, p_retroactive: !!record.retroactivo,
    p_hourmeter: Number(record.hourmeter), p_no_hourmeter: !!record.sinHorometro,
    p_no_hourmeter_reason: record.noHourmeterReason || null,
    p_lubricant_id: record.greaseType || null, p_quantity: Number(record.qty || 0),
    p_condition: record.condition || 'Normal', p_notes: record.notes || '',
    p_details: record.details || [], p_photos: record.photos || [],
    p_expected_record: record._pushedVersion || null,
    p_expected_equipment: equipmentBefore?._pushedVersion || null,
    p_expected_plan: planBefore?._pushedVersion || null,
    p_expected_assignment: assignmentBefore?._pushedVersion || null,
  };
  const dependencies = {};
  for (const [field, store, row] of [
    ['p_expected_record', 'lubrication_records', action === 'EDIT' ? record : null],
    ['p_expected_equipment', 'equipment', equipmentBefore],
    ['p_expected_plan', 'lubrication_plans', planBefore],
    ['p_expected_assignment', 'lubrication_assignments', assignmentBefore],
  ]) {
    if (row?._executionOperationId) dependencies[field] = { operationId: row._executionOperationId, store, id: row.id };
  }
  const changes = [{ store: 'lubrication_records', row: record }];
  if (equipmentAfter) changes.push({ store: 'equipment', row: equipmentAfter });
  if (planAfter) changes.push({ store: 'lubrication_plans', row: planAfter });
  if (assignmentAfter) changes.push({ store: 'lubrication_assignments', row: assignmentAfter });
  const operation = { id, actorId, params, dependencies, status: 'PENDING',
    originalRecord: recordBefore ? structuredClone(recordBefore) : null,
    localVersions: Object.fromEntries(changes.map(c => [c.store, c.row.updatedAt])),
    localRows: Object.fromEntries(changes.map(c => [c.store, structuredClone(c.row)])),
    localBases: [
      { store: 'lubrication_records', id: record.id, updatedAt: action === 'EDIT' ? recordBefore.updatedAt || null : null },
      ...[['equipment', equipmentBefore], ['lubrication_plans', planBefore], ['lubrication_assignments', assignmentBefore]]
        .filter(([, row]) => row).map(([store, row]) => ({ store, id: row.id, updatedAt: row.updatedAt || null })),
    ],
    localPhotos: params.p_photos, createdAt: nowISO() };
  await DB.putExecutionOperation(operation, changes);
  return operation;
}

async function logAudit(action, detail, user) {
  await DB.put('audit_log', stamp({
    id: uid('log'), action, detail, user: user || (App.currentUser && App.currentUser.name) || 'sistema'
  }));
}

/* ---------------- SEED DATA ---------------- */

// Única fuente de verdad del modo de autenticación: Auth.isSupabaseMode()
// (src/core/auth.js, constante AUTH_MODE) — db.js NUNCA repite ni
// reinterpreta ese valor, solo lo consulta de forma defensiva (nunca
// revienta si Auth no está cargado, ej. tests que cargan db.js aislado,
// o un orden de carga distinto). Mismo patrón defensivo que ya usa
// sync.js (`typeof Auth !== 'undefined' && Auth.isSupabaseMode()`). Sin
// Auth cargado, se comporta como 'legacy' — el default más seguro, nunca
// al revés (nunca asume 'supabase' por omisión).
function isSupabaseAuthMode() {
  return typeof Auth !== 'undefined' && typeof Auth.isSupabaseMode === 'function' && Auth.isSupabaseMode();
}

/* Pregunta al servidor si el sistema ya está en uso. Solo siembra el catálogo base
   cuando NO hay nada allá y tampoco aquí: es decir, en la primerísima instalación.
   Si no hay internet, siembra igual para que la app sirva desde el primer momento,
   pero marca los registros para que no pisen lo que ya exista al sincronizar.

   AUTH_MODE='supabase' (ver isSupabaseAuthMode arriba): NUNCA crea ningún
   usuario local (ni el catálogo de 4 usuarios de ejemplo, ni el admin
   temporal con PIN 1111) — la identidad/rol vienen de Supabase Auth +
   app_profiles, nunca de un PIN semilla. `users` puede quedar vacío
   localmente hasta que la sync real (ya autenticada) traiga lo que
   corresponda. El resto del catálogo (turnos, ubicaciones, categorías,
   cuadrillas, lubricantes, settings) se sigue sembrando igual — no tiene
   nada que ver con identidad/autenticación. */
async function seedSoloSiElSistemaEstaVacio() {
  // Production bootstrap is schema/config only. Remote state is NOT_CHECKED
  // until the first authenticated pull; never seed operational demo data.
  if (isSupabaseAuthMode() || globalThis.CONTROL_ENGRASE_ALLOW_DEMO_SEED !== true) return { remoteState: 'NOT_CHECKED' };
  const usuariosLocales = await DB.all('users');
  // OR con el flag: en AUTH_MODE='supabase', `users` se deja vacío a
  // propósito, así que `usuariosLocales.length` solo, por sí solo, ya NO
  // alcanza como señal de "este dispositivo ya decidió qué sembrar" — sin
  // el flag, este chequeo volvería a sembrar el catálogo completo en cada
  // boot. El flag es la señal principal; `usuariosLocales.length` se
  // conserva además por compatibilidad con dispositivos que ya tenían
  // datos de antes de que este flag existiera.
  if (usuariosLocales.length || localStorage.getItem('engrase_seed_hecho')) {
    await seedCuadrillasSoloSiNuncaSeSembraron();
    localStorage.setItem('engrase_seed_hecho', '1');
    return;
  }

  const servidorTieneDatos = false; // Explicit local demo only; no remote probe.

  if (servidorTieneDatos) {
    // El sistema ya existe: en AUTH_MODE='legacy', este dispositivo solo
    // necesita el usuario administrador temporal para poder entrar
    // mientras baja el resto. En AUTH_MODE='supabase' NO se crea — la
    // identidad ya viene de Auth + app_profiles, sin PIN alguno.
    if (!isSupabaseAuthMode()) {
      await seedSoloUsuarioInicial();
    }
    localStorage.setItem('engrase_seed_hecho', '1');
    return;
  }

  await seedIfEmpty();
  await seedCuadrillasIfMissing();
  localStorage.setItem('engrase_seed_hecho', '1');
}

/* Las cuadrillas solo se siembran una vez por dispositivo. Antes se recreaban cada vez
   que la lista quedaba vacía — así que borrar todas las cuadrillas era imposible:
   volvían al siguiente arranque. */
async function seedCuadrillasSoloSiNuncaSeSembraron() {
  if (localStorage.getItem('engrase_seed_hecho')) return;
  const existing = await DB.all('cuadrillas');
  if (existing.length) { localStorage.setItem('engrase_seed_hecho', '1'); return; }
  await seedCuadrillasIfMissing();
  localStorage.setItem('engrase_seed_hecho', '1');
}

/* Usuario mínimo para poder entrar en un dispositivo que se suma a un sistema ya
   existente. Se marca como temporal: al sincronizar llegan los usuarios de verdad.
   AUTH_MODE='supabase': NUNCA crea este usuario ni ningún PIN — guard
   defensivo además del que ya hace el llamador (seedSoloSiElSistemaEstaVacio),
   por si esta función se invoca alguna vez desde otro lugar. */
async function seedSoloUsuarioInicial() {
  if (isSupabaseAuthMode()) return;
  const users = await DB.all('users');
  if (users.length) return;
  await DB.put('users', stamp({
    id: 'u_admin', name: 'Administrador General', username: 'admin',
    pin: '1111', role: 'ADMINISTRADOR', active: true
  }, 'sistema'));
}

async function seedIfEmpty() {
  const users = await DB.all('users');
  if (users.length) return;

  const shifts = [
    { id: 'shift_dia', name: 'Turno Día', start: '06:00', end: '18:00', active: true },
    { id: 'shift_noche', name: 'Turno Noche', start: '18:00', end: '06:00', active: true }
  ];
  for (const s of shifts) await DB.put('shifts', stamp(s, 'sistema'));

  const locations = [
    { id: 'loc_pit1', name: 'Rajo Principal', active: true },
    { id: 'loc_botadero', name: 'Botadero Norte', active: true },
    { id: 'loc_taller', name: 'Taller Mecánico', active: true }
  ];
  for (const l of locations) await DB.put('locations', stamp(l, 'sistema'));

  const types = [
    ['type_articulado', 'Camión Articulado'], ['type_volquete', 'Camión Volquete'], ['type_excavadora', 'Excavadora'],
    ['type_tractor', 'Tractor de Oruga'], ['type_cargador', 'Cargador Frontal'], ['type_motoniveladora', 'Motoniveladora'],
    ['type_retro', 'Retroexcavadora'], ['type_perforadora', 'Perforadora'], ['type_auxiliar', 'Equipo Auxiliar']
  ].map(([id, name]) => ({ id, name, active: true }));
  for (const t of types) await DB.put('equipment_types', stamp(t, 'sistema'));

  const cuadrillas_seed = [
    { id: 'cuad_a', name: 'Cuadrilla A', active: true },
    { id: 'cuad_b', name: 'Cuadrilla B', active: true },
    { id: 'cuad_c', name: 'Cuadrilla C', active: true },
    { id: 'cuad_d', name: 'Cuadrilla D', active: true }
  ];
  for (const cq of cuadrillas_seed) await DB.put('cuadrillas', stamp(cq, 'sistema'));

  // AUTH_MODE='supabase': NUNCA se crean estos 4 usuarios ni sus PIN
  // (1111/2222/3333/4444) — `users` queda vacío localmente a propósito;
  // la identidad/rol vienen de Supabase Auth + app_profiles, nunca de un
  // usuario/PIN semilla. El resto del catálogo (arriba/abajo de este
  // bloque) no tiene relación con identidad y se siembra siempre igual.
  if (!isSupabaseAuthMode()) {
    const users_seed = [
      { id: 'u_admin', name: 'Administrador General', username: 'admin', role: 'ADMINISTRADOR', pin: '1111', active: true },
      { id: 'u_plan', name: 'Ana Planificadora', username: 'planificador', role: 'PLANIFICADOR', pin: '2222', active: true },
      { id: 'u_sup', name: 'Carlos Supervisor', username: 'supervisor', role: 'SUPERVISOR', pin: '3333', active: true },
      { id: 'u_lub1', name: 'Junior Lubricador', username: 'lubricador', role: 'LUBRICADOR', pin: '4444', active: true, cuadrillaId: 'cuad_a' }
    ];
    for (const u of users_seed) await DB.put('users', stamp(u, 'sistema'));
  }

  // 'lb': mismo valor que GREASE_UNIT en app.js — db.js carga antes que app.js
  // (scripts planos en index.html, sin módulos), así que no puede referenciar
  // esa constante y se repite aquí. Solo afecta instalaciones nuevas/vacías
  // (seedSoloSiElSistemaEstaVacio); nunca sobreescribe datos ya sembrados.
  const lubricants = [
    { id: 'lub_ep2', name: 'Grasa EP2', brand: 'Mobil', type: 'Multiuso', grade: 'NLGI 2', code: 'GR-EP2', unit: 'lb', active: true },
    { id: 'lub_moly', name: 'Grasa Moly', brand: 'Shell', type: 'Alta presión', grade: 'NLGI 2', code: 'GR-MOLY', unit: 'lb', active: true },
    { id: 'lub_ht', name: 'Grasa Alta Temperatura', brand: 'Chevron', type: 'Alta temperatura', grade: 'NLGI 2', code: 'GR-HT', unit: 'lb', active: true }
  ];
  for (const l of lubricants) await DB.put('lubricants', stamp(l, 'sistema'));

  // Nota: antes aquí se creaban 4 equipos de ejemplo (camiones/tractor de prueba) con sus
  // puntos de engrase. Se quitó — cada instalación nueva arranca con el catálogo base
  // (turnos, ubicaciones, categorías, lubricantes, cuadrillas) pero sin equipos de mentira.

  await DB.put('settings', stamp({
    id: 'notifications', enabled: true,
    lubricadorDiaHour: 6, lubricadorDiaMinute: 0,
    lubricadorNocheHour: 18, lubricadorNocheMinute: 0,
    complianceHour: 7, complianceMinute: 0
  }, 'sistema'));

  await logAudit('SEED', 'Datos base iniciales cargados (sin equipos de ejemplo)', 'sistema');
}

// Para instalaciones ya existentes (antes de que existieran las cuadrillas): si el store
// está vacío, crea las 4 cuadrillas por defecto sin tocar el resto de los datos.
async function seedCuadrillasIfMissing() {
  const existing = await DB.all('cuadrillas');
  if (existing.length) return;
  const cuadrillas_seed = [
    { id: 'cuad_a', name: 'Cuadrilla A', active: true },
    { id: 'cuad_b', name: 'Cuadrilla B', active: true },
    { id: 'cuad_c', name: 'Cuadrilla C', active: true },
    { id: 'cuad_d', name: 'Cuadrilla D', active: true }
  ];
  for (const cq of cuadrillas_seed) await DB.put('cuadrillas', stamp(cq, 'sistema'));
}

/* ============================================================
   CONFIGURACIÓN DE SUPABASE PRE-CARGADA
   Así cada dispositivo (web o app) que abra esta copia ya queda
   conectado a la base de datos remota sin configurarlo a mano.
   Si el Administrador cambia la URL/llave desde
   Configuración → Sincronización, ese cambio manual queda respetado y
   esta función ya no lo vuelve a sobreescribir.
   ============================================================ */
const DEFAULT_SYNC_CONFIG = {
  url: 'https://havrirlapjyqrffgalqx.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhdnJpcmxhcGp5cXJmZmdhbHF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTQwNzcsImV4cCI6MjEwMTc5MDA3N30.ikrxDitXQk3Qi-MhDaW4W8shToMyGezSQ9GQw7m6xR0'
};

async function ensureDefaultSyncConfig() {
  try {
    const existing = await DB.getConfig();
    if (existing && existing.url) return; // ya configurado (por esta función antes, o a mano por el admin) — no tocar
    await DB.setConfig({ url: DEFAULT_SYNC_CONFIG.url, anonKey: DEFAULT_SYNC_CONFIG.anonKey });
  } catch (e) {
    console.warn('No se pudo precargar la configuración de Supabase', e);
  }
}
