/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT — sync.js
   Sincronización offline-first contra una base de datos remota
   (Supabase / PostgREST). Todo se escribe primero en IndexedDB
   (funciona sin internet) y se empuja/hala del servidor cuando
   hay conexión.
   ============================================================ */

const PHOTO_BUCKET = 'engrase-photos';

// Instrumentación de rendimiento (lote SYNC_PERFORMANCE, 2026-10-18) — SOLO
// mide (nunca cambia qué se sincroniza ni el orden). `perfNow()` usa
// performance.now() cuando existe (navegador/Node moderno, monotónico,
// mejor resolución) con Date.now() como respaldo (entornos de test sin
// `performance` global). pushAll()/pullAll()/fullSync() devuelven un campo
// `perf` additivo (nadie que ya lea `.pushed`/`.pulled`/etc. se entera de
// que existe) con duraciones en ms y conteos — NUNCA payloads/filas reales,
// solo números. `logSyncPerf()` imprime el resumen pedido ("SYNC PERF ...")
// vía console.info — un solo string compacto, fácil de copiar a un reporte.
function perfNow() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }

function logSyncPerf(perf, label = 'SYNC PERF') {
  if (!perf) return;
  const line = (name, ms, extra) => `${name}: ${Math.round(ms)}ms${extra ? ' / ' + extra : ''}`;
  const parts = [];
  if (perf.push) parts.push(line('push', perf.push.ms, `${perf.push.rows} rows`));
  if (perf.pull) {
    parts.push(line('pull network', perf.pull.networkMs, `${perf.pull.rows} rows, ${perf.pull.pages} pages`));
    parts.push(line('pull merge', perf.pull.mergeMs));
    parts.push(line('idb write', perf.pull.idbWriteMs, `${perf.pull.puts} puts`));
  }
  parts.push(line('total', perf.totalMs));
  console.info(`${label}\n` + parts.join('\n'));
}

// Pre-cutover — ventanas diarias de "full refresh" (ver
// docs/SESSION_HANDOFF.md, lote PIN+sync+storage). El sync incremental
// normal (pushAll/pullAll cada `syncIntervalSeconds`, ver startAuto() más
// abajo) sigue corriendo exactamente igual — esto es una red de seguridad
// ADICIONAL, no un reemplazo: dos veces al día se fuerza un re-pull
// COMPLETO (cursor `lastPull` retrocedido, nunca filtrado por store — el
// esquema de `engrase_sync` no separa cursores por store) para autocorregir
// cualquier fila que el sync incremental haya podido saltarse, sin depender
// de que el dispositivo esté encendido justo a esa hora (ver
// runFullRefreshIfDue() y el catch-up al reabrir la app).
const FULL_REFRESH_WINDOWS = [
  { id: 'AM', hour: 7, minute: 0 },
  { id: 'PM', hour: 19, minute: 0 },
];

function localDateISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Puras — qué ventanas de HOY ya deberían haber pasado y cuál (si alguna)
// sigue pendiente, dado el estado ya guardado en cfg.lastFullRefreshWindow
// (`{ date, windows: [...ids ya cumplidos hoy] }`). Un día distinto al
// guardado reinicia la lista (ninguna ventana de HOY se ha cumplido
// todavía) — nunca se arrastra el estado de un día anterior.
function dueFullRefreshWindows(now, lastState) {
  const todayISO = localDateISO(now);
  const doneToday = (lastState && lastState.date === todayISO) ? (lastState.windows || []) : [];
  return FULL_REFRESH_WINDOWS.filter(w => {
    const pasoLaHora = now.getHours() > w.hour || (now.getHours() === w.hour && now.getMinutes() >= w.minute);
    return pasoLaHora && !doneToday.includes(w.id);
  });
}

// P0-3 (ver docs/STORAGE_PRIVACY_DESIGN.md) — compatibilidad hacia atrás:
// todo registro YA sincronizado (y todo el que se siga subiendo hoy, ver
// uploadPhotoIfNeeded/uploadSignatureIfNeeded) guarda la URL PÚBLICA
// completa (`.../storage/v1/object/public/<bucket>/<path>`), nunca un path
// suelto — cambiar ese formato de escritura hoy habría significado revisar
// TODO lugar que hace `<img src="${row.photo}">` en app.js (miniaturas de
// checklist, diagramas de familia de equipo — fuera del alcance de fotos de
// engrase/anomalías/firmas que pide este lote) para que supieran resolver
// un path suelto, con riesgo real de romper alguno en silencio. En vez de
// eso, esta función EXTRAE el path desde la URL pública ya guardada (o lo
// devuelve tal cual si ya es un path suelto, para cuando en el futuro se
// decida escribirlo así) — así getSignedPhotoUrl() funciona HOY, sin migrar
// ni un solo registro histórico ni cambiar el formato de escritura.
// null/undefined/base64 (`data:image...`, foto local sin subir todavía) no
// son URLs de Storage — no se les puede pedir un signed URL, devuelve null.
function resolvePhotoStoragePath(value) {
  if (typeof value !== 'string' || !value) return null;
  if (value.startsWith('data:image')) return null;
  const marker = `/storage/v1/object/public/${PHOTO_BUCKET}/`;
  const idx = value.indexOf(marker);
  if (idx !== -1) return value.slice(idx + marker.length);
  // Ya es un path suelto (sin protocolo) — se acepta tal cual.
  if (!/^https?:\/\//i.test(value)) return value;
  // Una URL absoluta que no es de nuestro bucket público conocido (dato
  // legado de otra forma, o ya un signed URL) — no hay path que extraer.
  return null;
}

function dataURLtoBlob(dataURL) {
  const [header, base64] = dataURL.split(',');
  const mimeMatch = /data:(.*?);base64/.exec(header || '');
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/* ============================================================
   RESOLUCIÓN SEGURA DE CONFLICTOS MULTIDISPOSITIVO (P0-1)
   ============================================================
   No hay columna `version` en engrase_sync (ver schema.sql) ni en los
   registros locales — lo único confiable para saber "¿coinciden todavía
   local y remoto?" es comparar updatedAt/updated_at contra `_pushedVersion`
   (la última versión que este dispositivo confirmó que el SERVIDOR tiene).
   `_pushedVersion` hace doble función a propósito, y es la base de todo lo
   de abajo:
     - lo pone pushAll() al confirmar una subida (ya documentado, fix
       original de _pushedVersion).
     - lo pone pullAll() al ACEPTAR una fila remota (ver decidePullAction) —
       es decir, también es "la última versión en que este dispositivo y el
       servidor estuvieron de acuerdo" (la BASE para detectar conflictos).
   Fila "dirty" (cambio local sin confirmar por el servidor) sigue siendo
   exactamente la misma comparación que ya usaba pushAll():
   `_pushedVersion !== updatedAt`. `createdAt` no participa en nada de esto
   (no es una versión, es un dato del registro); `active`/`deleted` tampoco
   son un caso especial — son un campo más cubierto por `updatedAt`, igual
   que cualquier otro cambio. */

// ¿Esta fila local tiene un cambio SIN confirmar por el servidor?
function isRowDirty(localRow) {
  return !!localRow && (localRow._pushedVersion !== localRow.updatedAt ||
    !!localRow._executionOperationId || !!localRow._evidenceOperationId);
}

// Qué hacer con UNA fila que llega del servidor en pullAll(), sin tocar DB
// ni red — solo mirando el estado local ya conocido:
//   - local SIN cambios pendientes -> ACCEPT (comportamiento de siempre:
//     guardar lo que trae el servidor, es la fuente de verdad).
//   - local con cambio pendiente Y remote sigue exactamente en la base que
//     ese cambio local conocía (localRow._pushedVersion) -> KEEP_LOCAL: no
//     pisar nada, el cambio local todavía puede subirse después con
//     pushAll() sin pisar a nadie.
//   - local con cambio pendiente Y remote se movió desde esa base (otro
//     dispositivo cambió el mismo registro después de la última vez que
//     este dispositivo estuvo de acuerdo con el servidor) -> CONFLICT real:
//     los dos lados cambiaron desde la misma base, ninguno gana en
//     silencio (NO es LWW ciego).
function decidePullAction(localRow, remoteUpdatedAt) {
  if (!isRowDirty(localRow)) return { action: 'ACCEPT' };
  if (localRow._pushedVersion === remoteUpdatedAt) return { action: 'KEEP_LOCAL' };
  return { action: 'CONFLICT', localVersion: localRow.updatedAt, remoteVersion: remoteUpdatedAt };
}

// Every operational request requires a valid Supabase user session.
// The public key is only the gateway apikey, never a bearer fallback.
function syncAuthHeaders(cfg) {
  if (typeof Auth === 'undefined' || !Auth.isSupabaseMode() || !Auth.isAuthenticated()) throw new Error('AUTH_REQUIRED');
  const bearer = Auth.getSession()?.accessToken;
  if (!bearer || bearer === cfg.anonKey) throw new Error('AUTH_REQUIRED');
  return { apikey: cfg.anonKey, Authorization: `Bearer ${bearer}` };
}

function syncSessionEpoch() {
  return typeof Auth !== 'undefined' ? (Auth.getSessionEpoch?.() || 0) : null;
}

async function syncConfig() {
  const epoch = syncSessionEpoch();
  const cfg = { ...(await DB.getConfig()) };
  Object.defineProperty(cfg, '_authEpoch', { value: epoch });
  return cfg;
}

async function authenticatedSyncFetch(url, options, cfg) {
  const epoch = cfg?._authEpoch ?? syncSessionEpoch();
  cfg = cfg || await DB.getConfig();
  if (typeof Auth === 'undefined' || !Auth.isSupabaseMode() || epoch !== syncSessionEpoch()) throw new Error('AUTH_REQUIRED');
  if (!Auth.isAuthenticated() && Auth.getSession()?.refreshToken) {
    try { await Auth.restoreSession(); } catch (_) { throw new Error('AUTH_REQUIRED'); }
  }
  if (epoch !== syncSessionEpoch()) throw new Error('AUTH_REQUIRED');
  // No asynchronous boundary between the final session check and dispatch.
  const headers = { ...options.headers, ...syncAuthHeaders(cfg) };
  return fetchWithTimeout(url, { ...options, headers });
}

// Diagnóstico SANITIZADO de un rechazo 403 (AUTH_FORBIDDEN) — lote "Sync 403
// diagnostic". Objetivo: poder saber DESPUÉS, sin reproducir el problema a
// ciegas, qué store/operación concreta rechazó RLS. Lee SOLO el cuerpo de
// error que el propio PostgREST ya devuelve (nunca el request que mandamos:
// jamás incluye el JWT, el apikey, ni el payload completo de la fila — esos
// nunca viajan en la RESPUESTA, no hace falta excluirlos a mano). Recortado
// a 200 caracteres por las dudas; si el cuerpo no es JSON o no trae esos
// campos, devuelve cadena vacía — nunca lanza, nunca bloquea el flujo normal
// de pushAll() por un problema al leer el diagnóstico.
async function readAuthErrorMessage(resp) {
  try {
    const data = await resp.json();
    const raw = (data && (data.message || data.hint || data.code)) || '';
    return String(raw).slice(0, 200);
  } catch (e) {
    return '';
  }
}

// Mismo criterio en los 3 campos que ya identifican una fila en
// `errors`/`conflicts` (store/id) — agrega SOLO lo necesario para diagnosticar
// un 403 sin reproducirlo a ciegas: operación, el mensaje ya sanitizado
// (ver readAuthErrorMessage), el rol vigente en EL MOMENTO del rechazo
// (nunca el JWT en sí) y la hora. `role` puede quedar null si Auth no está
// cargado (AUTH_MODE='legacy') — coherente con que este código es inerte ahí.
function buildAuthErrorDetail({ store, id, operation, message }) {
  const role = (typeof Auth !== 'undefined' && Auth.getProfile && Auth.getProfile()) ? Auth.getProfile().role : null;
  return { store, id, status: 403, operation, message, role, at: nowISO() };
}

// P0-1 (endurecimiento): la primera versión de este archivo comprobaba la
// versión remota con un GET separado ANTES del upsert (checkPushAllowed(),
// ya eliminada) — eso deja una ventana real entre "leer" y "escribir": dos
// dispositivos pueden leer T0, los dos ver luz verde, y el segundo en
// escribir pisa al primero de todos modos. GET+UPSERT nunca es una garantía
// de concurrencia, sin importar qué tan rápido se haga la comprobación.
// pushAll() ya NO comprueba y después escribe: hace UNA sola operación
// atómica por fila (ver más abajo):
//   - fila nueva (_pushedVersion undefined, nunca confirmada por el
//     servidor) -> INSERT protegido por la PK real (store, id) con
//     `Prefer: resolution=ignore-duplicates` — si otro dispositivo ya creó
//     ese mismo id, esta fila queda afuera de la respuesta y nunca lo pisa.
//   - fila con base conocida (_pushedVersion definido) -> UPDATE (PATCH)
//     condicionado con `updated_at=eq.<_pushedVersion>` en el WHERE — la
//     misma sentencia SQL compara y escribe: si el servidor ya se movió
//     desde esa base, la condición no matchea NINGUNA fila (0 filas
//     afectadas) y PostgREST lo confirma en la respuesta, sin ambigüedad.
// Ambas usan columnas/constraints que YA existen en engrase_sync (ver
// schema.sql: `primary key (store, id)`, columna `updated_at` filtrable) —
// no hizo falta ningún cambio de schema para lograr esto.

const Sync = {
  syncing: false,
  listeners: [],
  // Signed URLs de Storage — EN MEMORIA nada más (§39 docs/
  // STORAGE_PRIVACY_DESIGN.md), se vacía sola al recargar la página, nunca
  // se persiste. Ver getSignedPhotoUrl() más abajo.
  _signedUrlCache: new Map(),
  // Mejora: intervalo de auto-sync configurable por el Administrador (ver
  // app.js renderConfig() → "Sincronización"). Guardan el ID del timer
  // activo y el intervalo vigente para poder cambiarlo en caliente sin
  // duplicar timers — ver _restartAutoTimer()/setAutoInterval() abajo.
  _autoTimerId: null,
  _autoIntervalSeconds: null,

  onChange(fn) { this.listeners.push(fn); },
  notify(state) { this.listeners.forEach(fn => { try { fn(state); } catch (e) {} }); },

  async isConfigured() {
    const cfg = await syncConfig();
    return !!(cfg && cfg.url && cfg.anonKey);
  },

  async testConnection(url, anonKey) {
    const clean = url.trim().replace(/\/+$/, '');
    if (!/^https:\/\//i.test(clean)) return { status: 'SERVER_ERROR' };
    if (typeof Auth === 'undefined' || !Auth.isSupabaseMode() || !Auth.isAuthenticated()) return { status: 'AUTH_REQUIRED' };
    const cfg = { url: clean, anonKey: anonKey.trim(), _authEpoch: syncSessionEpoch() };
    try {
      const resp = await authenticatedSyncFetch(clean + '/rest/v1/engrase_sync?select=store&limit=1', {}, cfg);
      if (resp.status === 401 || resp.status === 403) return { status: 'AUTH_REQUIRED', network: 'NETWORK_OK', httpStatus: resp.status };
      return { status: resp.ok ? 'AUTHENTICATED_REMOTE_OK' : 'SERVER_ERROR', network: 'NETWORK_OK', httpStatus: resp.status };
    } catch (error) {
      return { status: error.message === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : isNetworkFailure(error) ? 'NETWORK_ERROR' : 'SERVER_ERROR' };
    }
  },

  async saveConfig(url, anonKey) {
    const clean = url.trim().replace(/\/+$/, '');
    const key = anonKey.trim();
    const result = await this.testConnection(clean, key);
    if (result.status !== 'AUTHENTICATED_REMOTE_OK') throw new Error(result.status);
    const prev = (await DB.getConfig()) || {};
    await DB.setConfig({ ...prev, url: clean, anonKey: key });
    return result;
  },

  async pendingCount() {
    const cfg = await syncConfig();
    if (!cfg || !cfg.url) return 0;
    let count = 0;
    const representedEvidence = new Set();
    for (const store of STORES) {
      const rows = await DB.all(store);
      count += rows.filter(r => r._pushedVersion !== r.updatedAt).length;
      rows.filter(r => r._pushedVersion !== r.updatedAt && r._evidenceOperationId)
        .forEach(r => representedEvidence.add(r._evidenceOperationId));
    }
    if (DB.getEvidenceOperations) count += (await DB.getEvidenceOperations()).filter(op => !representedEvidence.has(op.id)).length;
    return count;
  },

  // Sube una foto (guardada localmente en base64) a Supabase Storage y devuelve la URL
  // pública. Solo se llama una vez por foto — el registro local se marca con
  // photoUploaded para no volver a subirla en cada sincronización.
  // Sube a Supabase Storage cada foto que todavía esté en base64, y devuelve una
  // copia del registro con LINKS en vez de imágenes — así la base de datos no se
  // llena. El registro local conserva las imágenes completas para verlas sin internet.
  async uploadPhotoIfNeeded(store, row, cfg, persistMetadata = true) {
    const localPhotos = Array.isArray(row.photos) && row.photos.length
      ? row.photos
      : (row.photo ? [row.photo] : []);
    if (!localPhotos.length) return row;

    const uploaded = [];
    let algunaSubida = false;

    for (let i = 0; i < localPhotos.length; i++) {
      const p = localPhotos[i];
      if (typeof p !== 'string') { uploaded.push(p); continue; }
      if (!p.startsWith('data:image')) { uploaded.push(p); continue; } // ya es un link

      try {
        const blob = dataURLtoBlob(p);
        const ext = (blob.type && blob.type.includes('webp')) ? 'webp' : 'jpg';
        const path = `${store}/${row.id}_${i}.${ext}`;
        const resp = await authenticatedSyncFetch(`${cfg.url}/storage/v1/object/${PHOTO_BUCKET}/${path}`, {
          method: 'POST',
          headers: {
            apikey: cfg.anonKey,
            'Content-Type': blob.type || 'image/jpeg', 'x-upsert': 'true'
          },
          body: blob
        }, cfg);
        if (!resp.ok) {
          console.warn(`No se pudo subir la foto ${i} de ${store}/${row.id}: ${resp.status}`);
          uploaded.push(p); // se queda en base64; se reintenta en la próxima sincronización
          continue;
        }
        uploaded.push(`${cfg.url}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`);
        algunaSubida = true;
      } catch (e) {
        console.warn('No se pudo subir una foto a Storage', e);
        uploaded.push(p);
      }
    }

    if (persistMetadata && algunaSubida && !row.photoUploaded) {
      row.photoUploaded = true; // marca local, no cambia updatedAt (evita reintentos infinitos)
      await DB.put(store, row);
    }
    // Copia para el servidor con links; el registro local mantiene las imágenes completas
    return { ...row, photos: uploaded, photo: uploaded[0] || null };
  },

  // Firma manuscrita de grease_validations (campo `signatureLocal`, base64 —
  // UNA sola imagen, no un array). Mismo mecanismo que uploadPhotoIfNeeded():
  // sube a Storage (mismo bucket, prefijo natural "<store>/" — sin bucket ni
  // configuración nueva), y devuelve una copia del registro con
  // `signatureUrl` en vez de base64 para el servidor; el registro local
  // conserva `signatureLocal` completo para verla sin internet.
  async uploadSignatureIfNeeded(store, row, cfg, persist = true) {
    const local = row.signatureLocal;
    if (typeof local !== 'string' || !local.startsWith('data:image')) return row;

    try {
      const blob = dataURLtoBlob(local);
      const ext = (blob.type && blob.type.includes('webp')) ? 'webp' : 'png';
      const path = `${store}/${row.id}.${ext}`;
      const resp = await authenticatedSyncFetch(`${cfg.url}/storage/v1/object/${PHOTO_BUCKET}/${path}`, {
        method: 'POST',
        headers: {
          apikey: cfg.anonKey,
          'Content-Type': blob.type || 'image/png', 'x-upsert': 'false'
        },
        body: blob
      }, cfg);
      if (!resp.ok && [400, 409].includes(resp.status)) {
        // A lost ACK may leave an identical object. Never accept a collision blindly.
        const existing = await authenticatedSyncFetch(`${cfg.url}/storage/v1/object/authenticated/${PHOTO_BUCKET}/${path}`, {
          headers: { apikey: cfg.anonKey },
        }, cfg);
        if (!existing.ok) return row;
        const left = new Uint8Array(await blob.arrayBuffer());
        const right = new Uint8Array(await existing.arrayBuffer());
        if (left.length !== right.length || left.some((byte, i) => byte !== right[i])) throw new Error('SIGNATURE_BINARY_CONFLICT');
      } else if (!resp.ok) {
        console.warn(`No se pudo subir la firma de ${store}/${row.id}: ${resp.status}`);
        return row; // se queda en base64; se reintenta en la próxima sincronización
      }
      const url = `${cfg.url}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`;
      if (persist && !row.signatureUploaded) {
        row.signatureUploaded = true; // marca local, no cambia updatedAt (evita reintentos infinitos)
        await DB.put(store, row);
      }
      // Copia para el servidor: URL en vez de base64 (no duplicar el peso en
      // el payload jsonb de engrase_sync); el registro local conserva la firma completa.
      return { ...row, signatureLocal: null, signatureUrl: url };
    } catch (e) {
      console.warn('No se pudo subir la firma a Storage', e);
      if (e.message === 'SIGNATURE_BINARY_CONFLICT' || e.message === 'AUTH_REQUIRED') throw e;
      return row;
    }
  },

  // P0-3 (ver docs/STORAGE_PRIVACY_DESIGN.md) — genera una URL firmada
  // TEMPORAL para ver una evidencia (foto/firma) que este dispositivo NO
  // tiene en base64 local (la subió otro dispositivo, o se perdió la copia
  // local tras reinstalar). Es el mecanismo de lectura que sigue
  // funcionando cuando el bucket deje de ser público — hoy, con el bucket
  // todavía público, también funciona (la policy "lectura publica" sigue
  // activa), así que no cambia nada visible todavía.
  // NUNCA se persiste el resultado (el token expira) — quien la use la pide
  // de nuevo cada vez que necesita mostrar la imagen, nunca la guarda en
  // IndexedDB ni en el payload que se sube a engrase_sync.
  // Devuelve null (nunca lanza) si: el valor no es una URL/path de Storage
  // reconocible (p.ej. sigue en base64, o está vacío), si AUTH_MODE es
  // 'supabase' y no hay sesión válida (mismo gate que pushAll/pullAll — cero
  // requests de red sin sesión), o si la request de firmado falla (sin
  // conexión, bucket todavía no privado pero policy de signing distinta,
  // etc.) — quien llama debe caer de vuelta a la URL/valor original en ese
  // caso (ver app.js, siempre con fallback).
  // Cache EN MEMORIA (nunca IndexedDB, nunca sobrevive un reload) por path
  // — dentro de la ventana de vigencia (menos un margen de 60s) devuelve la
  // misma URL sin pedir otra al servidor; `force: true` (usado por el
  // reintento de app.js cuando un <img> falla por URL vencida, ver
  // resolveEvidenceSrc()) ignora el cache y pide una nueva de una vez.
  async getSignedPhotoUrl(value, cfg, { expiresIn = 3600, force = false } = {}) {
    const path = resolvePhotoStoragePath(value);
    if (!path) return null;
    if (!cfg || !cfg.url || !cfg.anonKey) return null;
    if (typeof Auth === 'undefined' || !Auth.isSupabaseMode() || !Auth.isAuthenticated()) return null;
    const profile=Auth.getProfile?.();
    const context=profile?.appUserId && await DB.getAuthorizationContext?.(profile.appUserId);
    const cacheKey = [cfg.url,profile?.authUserId,profile?.authorizationFingerprint,context?.supportGrants?.revision,path].join('::');
    if (!force) {
      const cached = this._signedUrlCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.url;
    }
    try {
      const resp = await authenticatedSyncFetch(`${cfg.url}/storage/v1/object/sign/${PHOTO_BUCKET}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey },
        body: JSON.stringify({ expiresIn })
      }, cfg);
      if (!resp.ok) return null;
      const json = await resp.json();
      if (!json || typeof json.signedURL !== 'string') return null;
      const url = `${cfg.url}/storage/v1${json.signedURL}`;
      this._signedUrlCache.set(cacheKey, { url, expiresAt: Date.now() + expiresIn * 1000 - 60000 });
      return url;
    } catch (e) {
      return null;
    }
  },

  // SOLO para completar la metadata de un conflicto YA DETECTADO de forma
  // atómica (ver pushAll) — nunca se usa para DECIDIR si se puede escribir,
  // así que no reintroduce la ventana de carrera del GET+UPSERT original.
  // Si esta consulta falla, el conflicto igual queda registrado (con
  // remoteVersion en null) — nunca bloquea el resultado por un problema al
  // buscar el dato de diagnóstico.
  async fetchRemoteUpdatedAt(store, id, cfg) {
    try {
      const resp = await authenticatedSyncFetch(
        `${cfg.url}/rest/v1/engrase_sync?select=updated_at&store=eq.${encodeURIComponent(store)}&id=eq.${encodeURIComponent(id)}`,
        { headers: { apikey: cfg.anonKey } }
      , cfg);
      if (!resp.ok) return null;
      const rows = await resp.json();
      return rows.length ? rows[0].updated_at : null;
    } catch (e) {
      if (e.message === 'AUTH_REQUIRED') throw e;
      return null;
    }
  },

  async pushExecutionOperations(cfg) {
    const result = { pushed: 0, errors: [], authRequired: false };
    const operations = DB.getExecutionOperations ? await DB.getExecutionOperations() : [];
    for (const pending of operations) {
      // A preceding acknowledgment can resolve this operation's CAS dependencies.
      const operation = (await DB.getExecutionOperations()).find(r => r.id === pending.id);
      if (!operation) continue;
      if (operation.status === 'BLOCKED') { result.errors.push(operation.code); continue; }
      if (Object.keys(operation.dependencies || {}).length) { result.errors.push('EXECUTION_DEPENDENCY_PENDING'); continue; }
      if (operation.actorId !== Auth.getProfile()?.appUserId) { result.errors.push('EXECUTION_ACCOUNT_MISMATCH'); continue; }
      if (!Auth.getProfile()?.authorizationFingerprint || operation.authorizationFingerprint !== Auth.getProfile()?.authorizationFingerprint) {
        result.errors.push('AUTHORIZATION_SCOPE_STALE'); continue;
      }
      try {
        if (!operation.frozen) {
          if (operation.params.p_assignment_id && (operation.localPhotos || []).some(p=>typeof p==='string' && p.startsWith('data:image'))) {
            await this.authorizeSupportUpload(cfg,operation.params.p_assignment_id,null,operation.params.p_crew_id);
          }
          const prepared = await this.uploadPhotoIfNeeded('lubrication_records', {
            // Edits cannot overwrite objects referenced by the previous (possibly signed) version.
            id: operation.params.p_action === 'EDIT' ? operation.id : operation.params.p_record_id,
            photos: operation.localPhotos,
          }, cfg, false);
          if ((prepared.photos || []).some(p => typeof p !== 'string' || p.startsWith('data:'))) {
            throw new Error('EVIDENCE_UPLOAD_PENDING');
          }
          operation.params.p_photos = prepared.photos || [];
          // Persist the exact retry request BEFORE dispatch; canonical receipts compare it.
          operation.frozen = true;
          await DB.updateExecutionOperation(operation);
        }
        const response = await authenticatedSyncFetch(`${cfg.url}/rest/v1/rpc/lubrication_execution`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(operation.params),
        }, cfg);
        if (response.status === 401) { result.authRequired = true; break; }
        if (!response.ok) {
          operation.code = response.status === 403 ? 'AUTH_FORBIDDEN' : 'GATEWAY_UNAVAILABLE';
          operation.status = response.status === 403 ? 'BLOCKED' : 'RETRYABLE';
          await DB.updateExecutionOperation(operation);
          result.errors.push(operation.code); continue;
        }
        const reply = await response.json();
        if (cfg._authEpoch !== syncSessionEpoch() || !Auth.isAuthenticated()) {
          result.authRequired = true; break;
        }
        const expectedIds = { lubrication_records: operation.params.p_record_id, equipment: operation.params.p_equipment_id,
          lubrication_plans: operation.params.p_plan_id,
          lubrication_assignments: operation.params.p_action === 'CREATE' ? operation.params.p_assignment_id : null };
        const validRows = Array.isArray(reply.rows) && reply.rows.every(row => expectedIds[row.store] && row.id === expectedIds[row.store]
          && row.payload?.id === row.id && Number.isFinite(Date.parse(row.updated_at)));
        if (reply.status !== 'APPLIED') {
          operation.status = 'BLOCKED';
          operation.code = reply.code || reply.status || 'GATEWAY_REJECTED';
          await DB.updateExecutionOperation(operation);
          if (operation.code === 'SIGNED_RECORD_LOCKED' && typeof showInAppToast === 'function') {
            showInAppToast('Este engrase tiene firmas asociadas y no puede editarse directamente.');
          }
          if (operation.code === 'ASSIGNED_COMPLETENESS_IMMUTABLE' && typeof showInAppToast === 'function') showInAppToast('Continúa la asignación con un nuevo registro; esta corrección no cambia su resultado.');
          if (operation.code === 'SIGNED_RECORD_LOCKED' && validRows && reply.rows.some(row => row.store === 'lubrication_records')) {
            await DB.blockSignedExecution(operation, reply.rows);
          }
          result.errors.push(operation.code); continue;
        }
        // Guard again before local acknowledgment: logout cannot consume another account's intent.
        if (cfg._authEpoch !== syncSessionEpoch() || !Auth.isAuthenticated()) {
          result.authRequired = true; break;
        }
        if (!validRows || Object.keys(operation.localVersions).some(store => !reply.rows.some(row => row.store === store))) {
          throw new Error('GATEWAY_INVALID_RESPONSE');
        }
        await DB.finishExecutionOperation(operation, reply.rows);
        result.pushed++;
      } catch (error) {
        if (error.message === 'AUTH_REQUIRED') { result.authRequired = true; break; }
        operation.status = operation.code === 'SIGNED_RECORD_LOCKED' ? 'BLOCKED' : 'RETRYABLE';
        operation.code = error.message || 'GATEWAY_UNAVAILABLE';
        await DB.updateExecutionOperation(operation);
        result.errors.push(error.message || 'GATEWAY_UNAVAILABLE');
      }
    }
    return result;
  },

  async pushEvidenceOperations(cfg) {
    const result = { pushed: 0, errors: [], authRequired: false };
    const operations = DB.getEvidenceOperations ? await DB.getEvidenceOperations() : [];
    for (const operation of operations) {
      if (operation.status === 'BLOCKED') { result.errors.push(operation.code); continue; }
      if (operation.actorId !== Auth.getProfile()?.appUserId) { result.errors.push('EVIDENCE_ACCOUNT_MISMATCH'); continue; }
      if (!Auth.getProfile()?.authorizationFingerprint || operation.authorizationFingerprint !== Auth.getProfile()?.authorizationFingerprint) {
        result.errors.push('AUTHORIZATION_SCOPE_STALE'); continue;
      }
      try {
        if (!operation.frozen) {
          if (operation.recordDependency) {
            const acknowledgment = operation.executionDependencyId && await DB.get('app_config', 'execution-ack:' + operation.executionDependencyId);
            if (!acknowledgment) {
              result.errors.push('EVIDENCE_EXECUTION_PENDING'); continue;
            }
            operation.params.p_expected = acknowledgment.value;
            operation.recordDependency = null;
          }
          if (operation.rpc === 'resolve_grease_validation_conflict') {
            const signatures = (await DB.all('grease_validations')).filter(v => v.active !== false &&
              v.lubricationRecordId === operation.params.p_record_id).sort((a, b) => a.id.localeCompare(b.id));
            if (signatures.some(v => v._evidenceOperationId && v._evidenceOperationId !== operation.id)) {
              result.errors.push('EVIDENCE_SIGNATURE_PENDING'); continue;
            }
            if (JSON.stringify(signatures.map(v => v.id)) !== JSON.stringify(operation.resolutionVersions.map(v => v.id))) {
              throw new Error('SIGNATURES_VERSION_CONFLICT');
            }
            operation.params.p_expected_signatures = signatures.map(v => ({ id: v.id, updatedAt: v._pushedVersion || v.updatedAt }));
          }
          if (operation.localPhotos) {
            if (operation.supportAssignmentId || operation.params.p_assignment_id) await this.authorizeSupportUpload(cfg,operation.supportAssignmentId || operation.params.p_assignment_id,operation.params.p_id,operation.params.p_crew_id);
            const prepared = await this.uploadPhotoIfNeeded('anomalies', { id: operation.id, photos: operation.localPhotos }, cfg, false);
            if ((prepared.photos || []).some(p => typeof p !== 'string' || !p.startsWith('https://'))) throw new Error('EVIDENCE_UPLOAD_PENDING');
            operation.params.p_photos = prepared.photos || [];
          }
          if (operation.signatureLocal) {
            if (operation.supportAssignmentId) await this.authorizeSupportUpload(cfg,null,operation.params.p_record_id,operation.params.p_crew_id);
            const prepared = await this.uploadSignatureIfNeeded('grease_validations', {
              id: operation.params.p_id, signatureLocal: operation.signatureLocal,
            }, cfg, false);
            if (!prepared.signatureUrl) throw new Error('EVIDENCE_UPLOAD_PENDING');
            operation.params.p_signature_url = prepared.signatureUrl;
          }
          operation.frozen = true;
          await DB.updateEvidenceOperation(operation);
        }
        let canonicalConflictRows = [];
        const response = await authenticatedSyncFetch(`${cfg.url}/rest/v1/rpc/${operation.rpc}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation.params),
        }, cfg);
        if (response.status === 401) { result.authRequired = true; break; }
        if (!response.ok) {
          operation.code = response.status === 403 ? 'AUTH_FORBIDDEN' : 'EVIDENCE_GATEWAY_UNAVAILABLE';
          operation.status = response.status === 403 ? 'BLOCKED' : 'RETRYABLE';
        } else {
          const reply = await response.json();
          if (cfg._authEpoch !== syncSessionEpoch() || !Auth.isAuthenticated()) { result.authRequired = true; break; }
          if (reply.status === 'APPLIED') {
            const store = operation.kind === 'CATALOG' ? operation.targetStore : operation.rpc.includes('anomaly') ? 'anomalies' : 'grease_validations';
            if (!Array.isArray(reply.rows) || reply.rows.some(r => r.store !== store || !r.id || r.payload?.id !== r.id ||
              !Number.isFinite(Date.parse(r.updated_at)))) throw new Error('EVIDENCE_INVALID_RESPONSE');
            if (operation.rpc !== 'repeat_anomaly_from_execution' && (reply.rows.length !== 1 ||
              (operation.rpc !== 'resolve_grease_validation_conflict' && reply.rows[0].id !== operation.params.p_id))) {
              throw new Error('EVIDENCE_INVALID_RESPONSE');
            }
            await DB.finishEvidenceOperation(operation, reply.rows); result.pushed++; continue;
          }
          operation.code = reply.code || 'EVIDENCE_REJECTED'; operation.status = 'BLOCKED';
          if (operation.rpc === 'resolve_grease_validation_conflict' && operation.code === 'SIGNATURES_VERSION_CONFLICT' &&
            Array.isArray(reply.rows) && reply.rows.every(r => r.store === 'grease_validations' && r.payload?.id === r.id &&
              r.payload.lubricationRecordId === operation.params.p_record_id && Number.isFinite(Date.parse(r.updated_at)))) {
            canonicalConflictRows = reply.rows;
          }
        }
        if (operation.status === 'BLOCKED') await DB.blockEvidenceOperation(operation, canonicalConflictRows);
        else await DB.updateEvidenceOperation(operation);
        result.errors.push(operation.code);
      } catch (error) {
        if (error.message === 'AUTH_REQUIRED') { result.authRequired = true; break; }
        operation.code = error.message; operation.status = ['SIGNATURES_VERSION_CONFLICT','SIGNATURE_BINARY_CONFLICT'].includes(error.message)
          ? 'BLOCKED' : 'RETRYABLE';
        if (operation.status === 'BLOCKED') await DB.blockEvidenceOperation(operation);
        else await DB.updateEvidenceOperation(operation);
        result.errors.push(operation.code);
      }
    }
    return result;
  },

  async pushAll() {
    const pushStart = perfNow();
    const cfg = await syncConfig();
    if (!cfg || !cfg.url || !cfg.anonKey) return { ok: false, reason: 'not_configured' };
    // P0-2 Etapa B1: mientras Auth.getMode() sea 'legacy' (default) esta
    // rama nunca corre — `typeof Auth === 'undefined'` también es válido
    // (tests/fixtures que no cargan auth.js), así que el comportamiento
    // de hoy queda intacto. Solo cuando se active AUTH_MODE='supabase' se
    // exige sesión válida ANTES de tocar la red — nunca fallback a anon.
    if (typeof Auth === 'undefined' || !Auth.isSupabaseMode() || !Auth.isAuthenticated()) {
      return { ok: false, reason: 'AUTH_REQUIRED' };
    }
    let pushed = 0;
    const errors = [];
    const conflicts = [];
    const authErrors = [];
    let authRequired = false;

    const executionPush = await this.pushExecutionOperations(cfg);
    pushed += executionPush.pushed;
    errors.push(...executionPush.errors);
    if (executionPush.authRequired) return { ok: false, reason: 'AUTH_REQUIRED', pushed, errors, conflicts: 0, authErrors: 0, authErrorDetails: [] };

    const evidencePush = await this.pushEvidenceOperations(cfg);
    pushed += evidencePush.pushed; errors.push(...evidencePush.errors);
    if (evidencePush.authRequired) return { ok: false, reason: 'AUTH_REQUIRED', pushed, errors, conflicts: 0, authErrors: 0, authErrorDetails: [] };

    // Perf 2026-10-18 (lote SYNC_PERFORMANCE): UN solo contexto de
    // autorización para TODO este push, reusado en las N llamadas a
    // DB.all(store) de abajo (una por store en STORES) — antes cada store
    // releía el MISMO blob de app_config por su cuenta (N lecturas
    // IndexedDB idénticas por ciclo). El contexto ya quedó resuelto/
    // congelado por fullSync() (Auth.refreshAuthorizationContext(), ANTES
    // de llamar pushAll()) — compartirlo durante este push nunca cambia
    // qué filas se consideran autorizadas, solo evita releerlo.
    // `undefined` (nunca `null`) cuando no hay appUserId o el DB en uso no
    // implementa getAuthorizationContext (mismo guard defensivo que ya usa
    // pullAll() con `if (DB.setAuthorizationContext) ...` — algunos fakes
    // de test no lo implementan): deja que cada DB.all(store) caiga
    // exactamente en su comportamiento de siempre.
    const pushAppUserId = typeof Auth !== 'undefined' ? Auth.getProfile?.()?.appUserId : undefined;
    const pushContext = (pushAppUserId && DB.getAuthorizationContext) ? await DB.getAuthorizationContext(pushAppUserId) : undefined;

    for (const store of STORES) {
      try {
        const rows = await DB.all(store, pushContext);
        // Antes comparábamos la hora del cambio contra "la última vez que sincronicé"
        // (cfg.lastPush) — si el reloj de algún dispositivo estaba desajustado, un
        // cambio nuevo podía parecer "más viejo" que ese punto y nunca subir. Ahora
        // cada registro se marca individualmente al confirmarse: se sube si su versión
        // actual (updatedAt) todavía no coincide con la última versión confirmada por
        // el servidor (_pushedVersion) — no depende de comparar relojes entre equipos.
        const toPush = [];
        for (const row of rows) {
          if (row._pushedVersion === row.updatedAt || row._executionOperationId) continue;
          if (row._evidenceOperationId) continue;
          // Auditoría APK-upgrade/audit_log legacy: 0013 deniega a propósito el
          // INSERT/UPDATE genérico de audit_log (su identidad real solo puede
          // venir del RPC autoritativo que hizo la operación, nunca de una fila
          // armada por el cliente — ver docs/AUTHORIZATION_ROW_SCOPE_PHASE_2D2.md).
          // Tanto la cola legacy de un APK viejo como las nuevas filas de
          // registrarAvisoEnviado() en modo legacy quedan dirty para siempre,
          // visibles localmente (Configuración→Auditoría sigue leyéndolas), sin
          // POST/PATCH jamás — exclusión local intencional, nunca un fallo de
          // sync: no entra a errors/authErrors, así que nunca convierte
          // fullSync() en 'partial'/AUTH_FORBIDDEN ni bloquea otros stores.
          if (store === 'audit_log') continue;
          const role=Auth.getProfile?.()?.role;
          // IndexedDB is shared by local sessions on this device. A dirty
          // token belonging to a different account is preserved for its
          // owner to retry after login, never dispatched with the new JWT.
          if (store === 'push_tokens' && row.userId !== Auth.getProfile?.()?.appUserId) {
            errors.push('PUSH_TOKEN_ACCOUNT_MISMATCH');
            continue;
          }
          if ((['equipment','settings'].includes(store) && role!=='ADMINISTRADOR') ||
            (['lubrication_plans','lubrication_points'].includes(store) && !['ADMINISTRADOR','PLANIFICADOR'].includes(role))) {
            errors.push('CATALOG_LEGACY_BLOCKED:'+store);continue;
          }
          if (['anomalies', 'grease_validations'].includes(store)) {
            if (!row._evidenceOperationId) errors.push('EVIDENCE_LEGACY_REVIEW_REQUIRED');
            continue; // Never POST/PATCH evidence as a fallback, including legacy dirty rows.
          }
          if (store === 'grease_validations' && (await DB.get('lubrication_records', row.lubricationRecordId))?._executionOperationId) continue;
          toPush.push(row);
        }
        if (!toPush.length) continue;

        // CREATE: nunca antes confirmadas por el servidor. INSERT protegido
        // por la PK real (store,id) con ignore-duplicates — atómico: si otro
        // dispositivo ya creó el mismo id, esa fila queda afuera de la
        // respuesta y jamás se convierte en overwrite.
        const newRows = toPush.filter(r => r._pushedVersion === undefined);
        // UPDATE (incluye soft-delete): ya tienen una base remota conocida.
        // CAS atómico vía PATCH condicionado a esa base exacta.
        const updateRows = toPush.filter(r => r._pushedVersion !== undefined);

        if (newRows.length) {
          const prepared = [];
          for (const r of newRows) {
            let p = await this.uploadPhotoIfNeeded(store, r, cfg);
            p = await this.uploadSignatureIfNeeded(store, p, cfg);
            prepared.push(p);
          }
          const body = prepared.map(r => ({
            store, id: r.id, payload: this.stripLocalAuthorizationMetadata(r), updated_at: r.updatedAt, deleted: r.active === false
          }));
          const resp = await authenticatedSyncFetch(`${cfg.url}/rest/v1/engrase_sync?on_conflict=store,id`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: cfg.anonKey,
              // ignore-duplicates (NO merge-duplicates): si el id ya existe en
              // el servidor, esa fila se omite de la respuesta en vez de
              // pisarla — así se puede distinguir "se creó" de "ya existía
              // (conflicto de creación)" leyendo qué ids vinieron de vuelta.
              Prefer: 'resolution=ignore-duplicates,return=representation'
            },
            body: JSON.stringify(body)
          }, cfg);
          if (cfg._authEpoch !== syncSessionEpoch() || !Auth.isAuthenticated()) { authRequired = true; break; }
          const authIssueCreate = classifyAuthStatus(resp.status);
          if (authIssueCreate === 'AUTH_REQUIRED') { authRequired = true; break; }
          if (authIssueCreate === 'AUTH_FORBIDDEN') {
            // Rechazo de autorización (RLS), NUNCA un conflicto de versión
            // CAS — la fila sigue dirty tal cual, no se marca en `conflicts`.
            // Diagnóstico sanitizado (lote "Sync 403 diagnostic") — mismo
            // mensaje para las N filas de este POST en lote, nunca el
            // payload que se envió. Antes esto hacía `continue`, que — al
            // no haber ningún loop propio entre este bloque y `for (const
            // store of STORES)` — saltaba al SIGUIENTE STORE y se comía
            // por completo el `for (const r of updateRows)` de abajo: una
            // sola fila con INSERT rechazado bloqueaba cualquier UPDATE
            // legítimo pendiente del MISMO store en cada ciclo de sync
            // (hallazgo real de la sesión E2E Android 2026-10-20, caso:
            // un manual_tasks huérfano sin `updatedAt` nunca dejaba subir
            // la finalización real de otra tarea). Ahora solo se omite el
            // resto de ESTE bloque (vía `else`) — el loop de updateRows
            // del mismo store sigue ejecutándose normal.
            const message = await readAuthErrorMessage(resp);
            newRows.forEach(r => authErrors.push(buildAuthErrorDetail({ store, id: r.id, operation: 'INSERT', message })));
          } else {
            if (!resp.ok) throw new Error(`${resp.status}`);
            const insertedIds = new Set((await resp.json()).map(r => r.id));
            for (const r of newRows) {
              if (insertedIds.has(r.id)) {
                r._pushedVersion = r.updatedAt;
                await DB.put(store, r);
                pushed++;
              } else {
                const remoteVersion = await this.fetchRemoteUpdatedAt(store, r.id, cfg);
                conflicts.push({ store, id: r.id, localVersion: r.updatedAt, remoteVersion, detectedAt: nowISO() });
              }
            }
          }
        }

        for (const r of updateRows) {
          let prepared = await this.uploadPhotoIfNeeded(store, r, cfg);
          prepared = await this.uploadSignatureIfNeeded(store, prepared, cfg);
          // UNA sola sentencia UPDATE con el WHERE incluyendo la base
          // esperada (updated_at=eq.<_pushedVersion>) — Postgres evalúa la
          // condición y escribe en la MISMA operación atómica: no hay
          // ventana entre "leer" y "escribir" donde otro dispositivo pueda
          // meterse (a diferencia de un GET seguido de un POST separado).
          const resp = await authenticatedSyncFetch(
            `${cfg.url}/rest/v1/engrase_sync?store=eq.${encodeURIComponent(store)}&id=eq.${encodeURIComponent(r.id)}&updated_at=eq.${encodeURIComponent(r._pushedVersion)}`,
            {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                apikey: cfg.anonKey,
                Prefer: 'return=representation'
              },
              body: JSON.stringify({ payload: this.stripLocalAuthorizationMetadata(prepared), updated_at: prepared.updatedAt, deleted: prepared.active === false })
            }
          , cfg);
          if (cfg._authEpoch !== syncSessionEpoch() || !Auth.isAuthenticated()) { authRequired = true; break; }
          const authIssueUpdate = classifyAuthStatus(resp.status);
          if (authIssueUpdate === 'AUTH_REQUIRED') { authRequired = true; break; }
          if (authIssueUpdate === 'AUTH_FORBIDDEN') {
            // Igual que arriba: rechazo de autorización, NUNCA conflicto
            // CAS — la fila sigue dirty, se reintenta sola cuando cambie
            // la sesión/perfil, nunca en un loop de reintentos inmediato.
            const message = await readAuthErrorMessage(resp);
            authErrors.push(buildAuthErrorDetail({ store, id: r.id, operation: 'UPDATE', message }));
            continue;
          }
          if (!resp.ok) throw new Error(`${resp.status}`);
          const updatedRows = await resp.json();
          if (updatedRows.length === 1) {
            r._pushedVersion = r.updatedAt;
            await DB.put(store, r);
            pushed++;
          } else {
            // 0 filas afectadas: el WHERE no matcheó porque el servidor ya
            // no está en la base esperada — NUNCA se reintenta como upsert
            // ciego, se marca conflicto y la fila local sigue pendiente.
            const remoteVersion = await this.fetchRemoteUpdatedAt(store, r.id, cfg);
            conflicts.push({ store, id: r.id, localVersion: r.updatedAt, remoteVersion, detectedAt: nowISO() });
          }
        }
        // El `break` de arriba (dentro del for de updateRows) solo sale de
        // ESE loop — hace falta este segundo chequeo para que un
        // AUTH_REQUIRED detectado ahí también corte el loop de stores.
        if (authRequired) break;
      } catch (err) {
        // Un problema en UN store (ej. una foto que no subió, un error de red puntual) ya
        // no frena a los demás — seguimos con el resto y avisamos al final cuáles fallaron.
        if (err.message === 'AUTH_REQUIRED') { authRequired = true; break; }
        console.error(`Error al subir el store "${store}"`, err);
        errors.push(store);
      }
    }
    if (conflicts.length) await DB.recordConflicts(conflicts);
    // authErrors: la CANTIDAD (igual que siempre, nunca cambia de tipo —
    // fullSync()/los tests existentes lo usan como número). authErrorDetails:
    // el detalle sanitizado de CADA rechazo (lote "Sync 403 diagnostic"),
    // nuevo, aparte — nunca reemplaza al conteo.
    const pushPerf = { ms: perfNow() - pushStart, rows: pushed };
    if (authRequired) return { ok: false, reason: 'AUTH_REQUIRED', pushed, errors, conflicts: conflicts.length, authErrors: authErrors.length, authErrorDetails: authErrors, perf: pushPerf };
    return { ok: errors.length === 0 && authErrors.length === 0, pushed, errors, conflicts: conflicts.length, authErrors: authErrors.length, authErrorDetails: authErrors, perf: pushPerf };
  },

  async getAccountSyncState(contextOverride = null) {
    const profile = typeof Auth !== 'undefined' ? Auth.getProfile?.() : null;
    const context = contextOverride || (profile?.appUserId && await DB.getAuthorizationContext?.(profile.appUserId)) || profile;
    const authUserId = context?.authUserId || profile?.authUserId;
    const fingerprint = context?.authorizationFingerprint;
    if (!authUserId || !fingerprint || context?.rowScopeEnforced !== true) return { bootstrapComplete:false, key:null, context };
    if (profile?.authUserId && authUserId !== profile.authUserId) return { bootstrapComplete:false,key:null,context:null };
    const key = encodeURIComponent(authUserId) + ':' + encodeURIComponent(fingerprint);
    const cfg = await DB.getConfig();
    const saved = cfg?.accountSyncStates?.[key] || {};
    return { ...saved, key, context, authUserId, authorizationFingerprint:fingerprint,
      bootstrapComplete:saved.bootstrapComplete === true && cfg?.activeAccountSyncKey === key };
  },

  async authorizeSupportUpload(cfg, assignmentId, recordId, crewId) {
    const response=await authenticatedSyncFetch(cfg.url+'/rest/v1/rpc/authorize_assignment_evidence_upload',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_assignment_id:assignmentId,p_record_id:recordId,p_crew_id:crewId})},cfg);
    if (!response.ok || await response.json()!==true) throw new Error('SUPPORT_UPLOAD_DENIED');
  },
  async fetchSupportManifest(cfg, account) {
    if (account.context.scopeType!=='CREW_SCOPED') return {status:'AUTHORIZED',authUserId:account.authUserId,appUserId:account.context.appUserId,rows:[],operational:[],revision:'GLOBAL'};
    const response=await authenticatedSyncFetch(cfg.url+'/rest/v1/rpc/get_assignment_support_context',
      {method:'POST',headers:{apikey:cfg.anonKey,'Content-Type':'application/json'},body:'{}'},cfg);
    // Compatible pre-0014 servers have no support grants. Never infer grants locally.
    if (response.status===404) return {status:'AUTHORIZED',authUserId:account.authUserId,appUserId:account.context.appUserId,rows:[],operational:[],revision:'pre-0014'};
    if (!response.ok) throw new Error(classifyAuthStatus(response.status) || 'SUPPORT_BOOTSTRAP_UNAVAILABLE');
    const manifest=await response.json();
    if (manifest.status!=='AUTHORIZED' || manifest.authUserId!==account.authUserId || manifest.appUserId!==account.context.appUserId
      || !Array.isArray(manifest.rows) || !Array.isArray(manifest.operational) || typeof manifest.revision!=='string') throw new Error('SUPPORT_CONTEXT_MISMATCH');
    return manifest;
  },
  async fetchSupportRows(cfg, manifest) {
    const rows=[];
    for (const store of [...new Set(manifest.rows.map(ref=>ref.store))]) {
      if (!STORES.includes(store)) throw new Error('SUPPORT_UNKNOWN_STORE');
      const ids=manifest.rows.filter(ref=>ref.store===store).map(ref=>ref.id);
      for (let i=0;i<ids.length;i+=100) {
        const filter='('+ids.slice(i,i+100).map(id=>JSON.stringify(id)).join(',')+')';
        const response=await authenticatedSyncFetch(cfg.url+'/rest/v1/engrase_sync?select=store,id,payload,updated_at,deleted&store=eq.'+encodeURIComponent(store)+'&id=in.'+encodeURIComponent(filter),{headers:{apikey:cfg.anonKey}},cfg);
        if (!response.ok) throw new Error('SUPPORT_DEPENDENCIES_UNAVAILABLE');
        rows.push(...await response.json());
      }
    }
    return rows;
  },
  async pullAll({ forceFull = false } = {}) {
    const cfg = await syncConfig();
    if (!cfg || !cfg.url || !cfg.anonKey) return { ok: false, reason: 'not_configured' };
    // P0-2 Etapa B1: mismo gate que pushAll() — inerte mientras
    // AUTH_MODE sea 'legacy' o Auth no esté cargado (ver nota en pushAll).
    if (typeof Auth === 'undefined' || !Auth.isSupabaseMode() || !Auth.isAuthenticated()) {
      return { ok: false, reason: 'AUTH_REQUIRED' };
    }
    const account = await this.getAccountSyncState();
    if (!account.key) return { ok:false,reason:'AUTHORIZATION_BOOTSTRAP_INCOMPLETE' };
    let supportManifest,supportRows;
    try {
      supportManifest=await this.fetchSupportManifest(cfg,account);
      supportRows=await this.fetchSupportRows(cfg,supportManifest);
    } catch(error) {
      if (['AUTH_REQUIRED','AUTH_FORBIDDEN'].includes(error.message)) return {ok:false,reason:error.message};
      throw error;
    }
    const since = !forceFull && account.bootstrapComplete && account.lastPull
      ? account.lastPull : '1970-01-01T00:00:00.000Z';

    // Supabase/PostgREST limita cada respuesta a ~1000 filas sin importar el "limit"
    // pedido (confirmado en producción: limit=2000 devolvía como máximo 1000). Sin
    // paginar, un historial más grande que eso quedaba truncado en silencio — el
    // cursor (lastPull) avanzaba solo hasta la última fila de esa primera página, así
    // que el resto se iba recuperando de a poco en sincronizaciones futuras, pero
    // mientras tanto el dispositivo trabajaba con datos incompletos. Se pagina con
    // order+offset determinista (updated_at, luego store/id como desempate estable
    // para filas con el mismo updated_at) hasta recibir una página más corta que
    // PAGE_SIZE — así no hay huecos ni duplicados entre páginas.
    const PAGE_SIZE = 1000;
    let rows = [];
    let offset = 0;
    let pages = 0;
    const pullStart = perfNow();
    let networkMs = 0;
    let parseMs = 0;
    while (true) {
      let resp;
      const fetchStart = perfNow();
      try { resp = await authenticatedSyncFetch(
        `${cfg.url}/rest/v1/engrase_sync?select=*&updated_at=gt.${encodeURIComponent(since)}&order=updated_at.asc,store.asc,id.asc&limit=${PAGE_SIZE}&offset=${offset}`,
        { headers: { apikey: cfg.anonKey } }
      , cfg); } catch (error) {
        if (error.message === 'AUTH_REQUIRED') return { ok:false, reason:'AUTH_REQUIRED' };
        throw error;
      }
      networkMs += perfNow() - fetchStart;
      pages++;
      const authIssuePull = classifyAuthStatus(resp.status);
      // 401/403 en la lectura NUNCA es el CAS de P0-1 (que solo vive en
      // pushAll, siempre 200) — se corta el pull entero, sin tocar nada
      // local, en vez de seguir el camino genérico de `throw` de abajo.
      // Diagnóstico sanitizado (lote "Sync 403 diagnostic"): un pull es UNA
      // sola consulta cruzando todos los stores, nunca uno en particular —
      // `store: null` a propósito, nunca un valor inventado.
      if (authIssuePull) {
        const authErrorDetails = authIssuePull === 'AUTH_FORBIDDEN'
          ? [buildAuthErrorDetail({ store: null, id: null, operation: 'SELECT', message: await readAuthErrorMessage(resp) })]
          : [];
        return { ok: false, reason: authIssuePull, pulled: 0, newAnomalies: [], authErrorDetails };
      }
      if (!resp.ok) throw new Error(`Error al descargar cambios: ${resp.status}`);
      const parseStart = perfNow();
      const page = await resp.json();
      if (!Array.isArray(page)) throw new Error('INVALID_SYNC_RESPONSE');
      rows = rows.concat(page);
      parseMs += perfNow() - parseStart;
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    // Grant dependencies bypass the timestamp cursor; absence is revocation, not a tombstone.
    const confirmed=await this.fetchSupportManifest(cfg,account);
    if (confirmed.revision!==supportManifest.revision) return {ok:false,reason:'SUPPORT_GRANTS_CHANGED'};
    if (!confirmed.rows.every(ref=>supportRows.some(row=>row.store===ref.store && row.id===ref.id))) return {ok:false,reason:'SUPPORT_DEPENDENCIES_INCOMPLETE'};
    if (cfg._authEpoch !== syncSessionEpoch()) throw new Error('AUTH_REQUIRED');
    const supportGrants={...confirmed,authorizationFingerprint:account.authorizationFingerprint};
    account.context={...account.context,supportGrants};
    if (DB.setAuthorizationContext) await DB.setAuthorizationContext(account.context.appUserId,account.context);
    const incrementalMax=rows.reduce((max,row)=>row.updated_at>max ? row.updated_at : max,since);
    const byReference=new Map(rows.map(row=>[row.store+':'+row.id,row]));
    for (const row of supportRows) byReference.set(row.store+':'+row.id,row);
    rows.splice(0,rows.length,...byReference.values());
    let maxUpdated = since;
    const newAnomalies = [];
    const conflicts = [];
    let blockedForeignRows = 0;
    // UN cache por pull (perf 2026-10-18, lote SYNC_PERFORMANCE) — antes
    // cada DB.put() de este loop releía cuadrillas/crew_locations por su
    // cuenta para resolver broadcast_messages targetType=LOCATION; ahora
    // las filas de ESTE pull comparten una sola lectura. Vive solo en esta
    // variable local, nunca se guarda: desaparece al terminar pullAll().
    const pullCoverageCache = {};
    // A partial rehydration may replace clean shared slots. Invalidate cache
    // readiness BEFORE those writes, so returning to the old account after a
    // failed pull cannot reuse its cursor against a partly retagged catalog.
    //
    // Auditoría de sincronización — CIERRE DE ROOT CAUSE #2 (2026-10-20):
    // el null-out de abajo solo tiene sentido como protección de AISLAMIENTO
    // ENTRE CUENTAS — las tablas de catálogo compartido (equipment/
    // cuadrillas/locations/crew_locations, sin namespacing por cuenta en
    // IndexedDB) están a punto de retaguearse con la autorización de una
    // identidad distinta, y nadie debe poder leerlas como "listas" hasta
    // que ese pull termine y `complete` (más abajo) lo confirme. ESE caso
    // (`beforeWrites.activeAccountSyncKey !== account.key`, incluyendo el
    // primer bootstrap de siempre desde `null`) se protege exactamente
    // igual que antes.
    //
    // El bug real: este bloque también se ejecutaba cuando `account.key` YA
    // era el dueño activo (`forceFull` del refresh periódico 07:00/19:00,
    // que SOLO corre sobre una cuenta ya bootstrapeada — ver
    // runFullRefreshIfDue()/ANDs `!account.bootstrapComplete` cuando el
    // puntero global ya había quedado en null por un intento previo de esta
    // MISMA cuenta). En ese caso las filas por escribir son SIEMPRE de esta
    // misma identidad — jamás hay riesgo de fuga entre cuentas — pero el
    // null-out igual corría, y si el proceso se interrumpía (app cerrada,
    // red caída, WebView reiniciado) entre este punto y la escritura final
    // de abajo, `activeAccountSyncKey` quedaba en `null` PARA SIEMPRE,
    // aunque el estado por cuenta (`accountSyncStates[key]`, con su propio
    // `lastPull` válido) seguía intacto. `bootstrapComplete` (que exige
    // AMBOS: el flag por cuenta Y `activeAccountSyncKey===key`) calculaba
    // `false` en cada apertura futura — exactamente el síntoma reportado:
    // "Sincronizando datos..." con caché local válida de la MISMA cuenta.
    // Ahora solo se nulea cuando realmente cambia el dueño del caché
    // compartido; si es la misma cuenta, una interrupción deja el estado
    // previo (ya probado válido) intacto, sin tocarlo especulativamente.
    if ((forceFull || !account.bootstrapComplete) && rows.length) {
      const beforeWrites = await DB.getConfig();
      if (cfg._authEpoch !== syncSessionEpoch()) throw new Error('AUTH_REQUIRED');
      if (beforeWrites?.activeAccountSyncKey !== account.key) {
        await DB.setConfig({...beforeWrites,activeAccountSyncKey:null});
      }
    }
    // mergeMs: decidir qué hacer con cada fila (decidePullAction/dedupe de
    // fotos-firma). idbWriteMs: SOLO el tiempo dentro de DB.put() (la
    // escritura real a IndexedDB). Separados a propósito — son los 2
    // candidatos distintos a "esto es lo que tarda" del pedido.
    let mergeMs = 0, idbWriteMs = 0, puts = 0;
    for (const row of rows) {
      const rowStart = perfNow();
      if (cfg._authEpoch !== syncSessionEpoch()) throw new Error('AUTH_REQUIRED');
      if (!STORES.includes(row.store)) continue;
      const rec = row.payload;
      rec.active = !row.deleted;
      const existing = await (DB.getRaw ? DB.getRaw(row.store, rec.id) : DB.get(row.store, rec.id));

      // P0-1: si este dispositivo tiene un cambio local SIN confirmar por el
      // servidor para este mismo id, NO lo pisamos a ciegas con lo que llega
      // acá — antes cualquier fila remota se guardaba siempre, sin mirar si
      // había un cambio local pendiente (ese era el riesgo exacto de esta
      // tarea). decidePullAction() decide ACCEPT/KEEP_LOCAL/CONFLICT (ver
      // arriba); el cursor (maxUpdated) SIEMPRE avanza con lo que ya vimos,
      // aunque no lo hayamos aplicado localmente — así la próxima
      // sincronización no vuelve a traer la misma fila en un loop.
      const decision = decidePullAction(existing, row.updated_at);
      if (decision.action !== 'ACCEPT') {
        if (existing?.__authorizationAppUserId && existing.__authorizationAppUserId!==account.context.appUserId) blockedForeignRows++;
        if (decision.action === 'CONFLICT') {
          conflicts.push({ store: row.store, id: rec.id, localVersion: decision.localVersion, remoteVersion: decision.remoteVersion, detectedAt: nowISO() });
        }
        if (row.updated_at > maxUpdated && row.updated_at <= incrementalMax) maxUpdated = row.updated_at;
        mergeMs += perfNow() - rowStart;
        continue; // KEEP_LOCAL o CONFLICT: el cambio local pendiente queda intacto
      }

      // Si ya tenemos localmente las fotos completas (base64, funcionan sin internet) y lo
      // que llega del servidor son solo links (porque este mismo dispositivo ya las subió),
      // NO las reemplazamos — conservamos las copias completas para verlas sin conexión.
      if (existing) {
        const localTieneBase64 = (Array.isArray(existing.photos) && existing.photos.some(p => typeof p === 'string' && p.startsWith('data:image')))
          || (existing.photo && existing.photo.startsWith('data:image'));
        const remotoSonLinks = (Array.isArray(rec.photos) && rec.photos.every(p => typeof p === 'string' && !p.startsWith('data:image')))
          || (rec.photo && !rec.photo.startsWith('data:image'));
        if (localTieneBase64 && remotoSonLinks) {
          if (existing.photos) rec.photos = existing.photos;
          if (existing.photo) rec.photo = existing.photo;
        }
        // Mismo criterio para la firma (grease_validations.signatureLocal):
        // si YA tenemos la firma completa en este dispositivo (la creó aquí
        // mismo), nunca la reemplazamos por el eco del propio push (que llega
        // con signatureLocal:null + signatureUrl) ni por lo que suba otro dispositivo.
        if (typeof existing.signatureLocal === 'string' && existing.signatureLocal.startsWith('data:image')) {
          rec.signatureLocal = existing.signatureLocal;
        }
      }
      // Toda fila que llega aquí viene confirmada por el servidor (es su versión
      // vigente para ese id), así que queda marcada como YA SINCRONIZADA de una vez:
      // pushAll() compara _pushedVersion contra updatedAt para decidir qué subir, y
      // antes esta marca solo se ponía cuando era literalmente el eco del propio push
      // (existing._pushedVersion === rec.updatedAt). Cualquier fila nueva o traída de
      // OTRO dispositivo se quedaba sin _pushedVersion definido, así que pushAll() la
      // interpretaba como "cambio local pendiente" y la volvía a subir de inmediato —
      // ese era el bug (pull → push involuntario de vuelta al servidor).
      rec._pushedVersion = rec.updatedAt;
      rec.__authorizationAppUserId = Auth.getProfile?.()?.appUserId || null;
      rec.__authorizationState = 'AUTHORIZED';
      mergeMs += perfNow() - rowStart;
      const putStart = perfNow();
      await DB.put(row.store, rec, { source: 'server', coverageCache: pullCoverageCache });
      idbWriteMs += perfNow() - putStart;
      puts++;
      if (row.store === 'anomalies' && !row.deleted) newAnomalies.push(rec);
      if (row.updated_at > maxUpdated && row.updated_at <= incrementalMax) maxUpdated = row.updated_at;
    }
    if (conflicts.length) await DB.recordConflicts(conflicts);
    // The legacy cursor is never promoted to a new account's bootstrap.
    // Require persisted/visible authorized crew and location rows, not just
    // HTTP 200. Dirty foreign rows retain their owner/CAS state and may block
    // bootstrap until reviewed; never retag or discard them to manufacture it.
    const context = account.context;
    const crews = await DB.all('cuadrillas');
    const locations = await DB.all('locations');
    const crewsReady = (context.authorizedCrewIds || []).every(id => crews.some(c => c.id===id && c.active!==false &&
      (context.scopeType!=='CREW_SCOPED' || (c.memberUserIds || []).includes(context.appUserId))));
    const locationsReady = (context.authorizedLocationIds || []).every(id => locations.some(l => l.id===id && l.active!==false));
    const complete = (rows.length>0 || account.bootstrapComplete) && crewsReady && locationsReady && blockedForeignRows===0;
    if (cfg._authEpoch !== syncSessionEpoch()) throw new Error('AUTH_REQUIRED');
    const latest = await DB.getConfig();
    if (cfg._authEpoch !== syncSessionEpoch()) throw new Error('AUTH_REQUIRED');
    await DB.setConfig({ ...latest,
      activeAccountSyncKey:complete ? account.key : latest?.activeAccountSyncKey,
      accountSyncStates:{ ...latest?.accountSyncStates, [account.key]:{
        authUserId:account.authUserId,authorizationFingerprint:account.authorizationFingerprint,
        bootstrapComplete:complete,lastPull:complete ? maxUpdated : account.lastPull || null,
        lastFullRefreshAt:account.lastFullRefreshAt || null,lastFullRefreshWindow:account.lastFullRefreshWindow || null
      }}
    });
    const pullPerf = { networkMs, parseMs, mergeMs, idbWriteMs, rows: rows.length, pages, puts, totalMs: perfNow() - pullStart };
    if (!complete) return { ok:false,reason:'AUTHORIZATION_BOOTSTRAP_INCOMPLETE',pulled:rows.length,conflicts:conflicts.length,perf:pullPerf };
    return { ok: true, pulled: rows.length, newAnomalies, conflicts: conflicts.length, perf:pullPerf };
  },

  // `_pushedVersion` es puramente bookkeeping LOCAL (nunca lo vio el
  // servidor en el INSERT, que lo serializa `undefined` -> ausente del
  // JSON) — pero sin excluirlo aquí, cualquier UPDATE posterior lo filtraba
  // igual hacia el jsonb remoto (quedaba en `row` desde que pushAll() lo
  // asigna tras el INSERT). Para la mayoría de stores eso era inofensivo
  // (su RLS nunca compara el `payload` byte a byte). manual_tasks (0017) sí
  // lo hace para la transición LUBRICADOR PENDING->COMPLETED
  // (manual_task_row_in_scope compara `payload - allowlist` contra
  // `old_payload - allowlist`) — una clave extra que el remoto nunca tuvo
  // rompía esa comparación y el RLS denegaba la propia transición que 0017
  // fue diseñada para permitir. Corregido acá, nunca en la migración.
  //
  // `__freezeEmbeddedUpdatedAt`: ese mismo chequeo de 0017 tampoco incluye
  // `updatedAt` en su allowlist de campos permitidos — y pushAll() SIEMPRE
  // necesita bumpear `row.updatedAt` para que el loop de arriba considere
  // la fila "dirty" y la intente subir. Un store puede marcar una fila con
  // `__freezeEmbeddedUpdatedAt:<valor anterior>` para pedir que el
  // `updatedAt` EMBEBIDO en el jsonb enviado quede congelado en ese valor
  // (bytes idénticos a lo que el servidor ya tiene), mientras la columna
  // top-level `updated_at` (usada para el WHERE optimista y para que
  // pullAll() reconcilie `_pushedVersion`) sigue avanzando normal — ver
  // queueManualTaskCompletion() en db.js, el único caller hoy.
  stripLocalAuthorizationMetadata(row) {
    const { __authorizationAppUserId, __authorizationState, _supportOperational, _pushedVersion, __freezeEmbeddedUpdatedAt, ...payload } = row || {};
    if (row?.__freezeEmbeddedUpdatedAt) payload.updatedAt = row.__freezeEmbeddedUpdatedAt;
    return payload;
  },

  // Se llama SOLO desde dentro de fullSync() (después de un push/pull
  // incremental exitoso) — nunca desde afuera, así nunca corre en paralelo
  // con otro fullSync() (this.syncing ya lo serializa) y nunca corre sobre
  // una sesión sin validar. Si ninguna ventana está pendiente, no hace
  // ninguna request de más — el chequeo de fecha/hora es 100% local.
  async runFullRefreshIfDue() {
    const account = await this.getAccountSyncState();
    if (!account.bootstrapComplete) return null;
    const now = new Date();
    const pendientes = dueFullRefreshWindows(now, account.lastFullRefreshWindow);
    if (!pendientes.length) return null;
    const ventana = pendientes[0]; // una por llamada — la siguiente ventana (si la hay) se toma en el próximo ciclo/apertura
    // Fuerza un re-pull COMPLETO sin modificar el cursor previamente guardado.
    // pullAll() ya
    // aplica decidePullAction()/CAS (ver P0-1) fila por fila, así que un
    // cambio local pendiente NUNCA se pisa aunque el full refresh recorra
    // años de historial (§22 del pedido: full refresh no debe borrar dirty).
    // pullAll() no tiene try/catch propio (a diferencia de pushAll(), que sí
    // aísla errores por store) — una falla de red a mitad del re-pull
    // completo (mucho más largo que un pull incremental normal) puede
    // lanzar en vez de devolver {ok:false}. Cualquiera de los dos casos
    // deja el cursor anterior intacto, sin marcar la ventana — y (desde el
    // cierre de ROOT CAUSE #2, 2026-10-20) también deja `activeAccountSyncKey`
    // intacto: como esta función solo corre sobre una cuenta YA
    // bootstrapeada (ver el `if (!account.bootstrapComplete) return null;`
    // de arriba), el null-out defensivo de pullAll() nunca se dispara aquí
    // (ver su comentario) — una interrupción a mitad de este refresh nunca
    // vuelve a mostrar el loader de bootstrap para esta misma cuenta.
    let pullRes;
    try {
      pullRes = await this.pullAll({ forceFull:true });
    } catch (e) {
      pullRes = { ok: false, reason: isNetworkFailure(e) ? 'backend_unreachable' : 'error' };
    }
    if (!pullRes.ok) {
      // No se pudo completar (sin sesión, red cortada a mitad de camino,
      // etc.) — se restaura el cursor anterior para no perder el progreso
      // incremental normal, y se reintenta en el próximo ciclo/apertura
      // (nunca se marca la ventana como cumplida).
      return { ok: false, window: ventana.id, reason: pullRes.reason };
    }
    const pushRes = await this.pushAll();
    const cfgFinal = await DB.getConfig();
    const state = cfgFinal.accountSyncStates?.[account.key];
    if ((await this.getAccountSyncState()).key !== account.key) return {ok:false,reason:'AUTH_REQUIRED'};
    const doneToday = state?.lastFullRefreshWindow?.date === localDateISO(now) ? state.lastFullRefreshWindow.windows : [];
    cfgFinal.accountSyncStates[account.key] = {...state,lastFullRefreshAt:nowISO(),
      lastFullRefreshWindow:{ date:localDateISO(now),windows:[...doneToday,ventana.id] }};
    await DB.setConfig(cfgFinal);
    return { ok: true, window: ventana.id, pulled: pullRes.pulled, pushed: pushRes.pushed };
  },

  async fullSync(reason = 'manual') {
    // Auditoría de sincronización (2026-10-20, §4 "SINGLE-FLIGHT") — bug
    // real confirmado: `this.syncing = true` se fijaba DESPUÉS de
    // `await this.isConfigured()`, el PRIMER await de toda la función. El
    // guard de la línea siguiente (`if (this.syncing) return;`) es
    // síncrono, así que protege llamadas EN EL MISMO tick — pero dos
    // disparadores casi simultáneos (reconnect + timer, foreground +
    // timer, manual + reconnect — ver runAutoCycle()/startAuto()) podían
    // pasar AMBOS ese chequeo antes de que el primero terminara de
    // resolver isConfigured(), y terminar corriendo dos pushAll()/
    // pullAll() completos a la vez. Ahora la bandera se fija como PRIMERA
    // operación síncrona, antes de cualquier await — el resto de la
    // función (incluyendo los chequeos de isConfigured()/navigator.onLine,
    // ahora DENTRO del try) queda protegido por el mismo finally de
    // siempre, que ya garantizaba `this.syncing = false` sin importar la
    // salida.
    if (this.syncing) return;
    this.syncing = true;
    // Auditoría de sincronización (2026-10-20, §18 "INSTRUMENTACIÓN") — un
    // contador de ciclo (`SYNC #id`) y la razón que disparó este fullSync()
    // (startup/timer/reconnect/foreground/manual), SOLO para poder leer en
    // consola/CDP qué disparador causó qué ciclo al investigar un caso real
    // de campo. Vive en `this` (no como `let` de módulo) porque el arnés de
    // tests (tests/helpers/loadLubricationLogic.js) extrae el objeto `Sync`
    // completo pero no soporta extraer `let`s sueltos a nivel de módulo.
    // Nunca imprime tokens, payloads ni datos de filas — solo id, razón y
    // los mismos números de `perf` que ya existían (ver logSyncPerf()).
    this._syncCycleCounter = (this._syncCycleCounter || 0) + 1;
    const cycleId = this._syncCycleCounter;
    const fullSyncStart = perfNow();
    try {
      if (!(await this.isConfigured())) { this.notify({ status: 'unconfigured' }); return; }
      if (!navigator.onLine) { this.notify({ status: 'offline' }); return; }
      this.notify({ status: 'syncing' });
      // P0-2: al reconectar, refresca sesión Y perfil ANTES de tocar la
      // red de sync — nunca se sincroniza con una sesión que no se
      // intentó refrescar primero (ver docs/AUTH_RLS_IMPLEMENTATION_PLAN.md
      // §12 y Auth.restoreSession()). Inerte mientras AUTH_MODE sea
      // 'legacy' o Auth no esté cargado — no cambia nada del flujo actual.
      const cycleEpoch = syncSessionEpoch();
      if (typeof Auth === 'undefined' || !Auth.isSupabaseMode()) throw new Error('AUTH_REQUIRED');
      if (Auth.isSupabaseMode()) {
        await Auth.restoreSession();
        if (cycleEpoch !== syncSessionEpoch()) throw new Error('AUTH_REQUIRED');
        if (!Auth.isAuthenticated()) {
          this.notify({ status: 'AUTH_REQUIRED', at: nowISO() });
          return;
        }
        // Resolve the server authority before either push or pull. A changed
        // snapshot resolves a separate bootstrap namespace. Rehydrate before
        // upload when the identity/fingerprint no longer matches the cache.
        const authorization = await Auth.refreshAuthorizationContext();
        if (cycleEpoch !== syncSessionEpoch()) throw new Error('AUTH_REQUIRED');
        if (!authorization.ok) {
          this.notify({ status: authorization.reason || 'AUTHORIZATION_UNAVAILABLE', at: nowISO() });
          return;
        }
        if (authorization.context.rowScopeEnforced !== true) {
          this.notify({ status: 'AUTHORIZATION_SCOPE_NOT_ENFORCED', at: nowISO() });
          return;
        }
      }
      // En la PRIMERA sincronización de un dispositivo se baja antes de subir. Si no,
      // el catálogo base que la app crea al instalarse (turnos, lubricantes, cuadrillas)
      // se sube como "nuevo" y revive lo que el administrador ya había borrado en el
      // servidor. Bajando primero, este dispositivo se entera de qué está eliminado
      // antes de proponer nada.
      const account = await this.getAccountSyncState();
      const esPrimeraVez = !account.bootstrapComplete;
      let pushRes, pullRes;
      if (esPrimeraVez) {
        if (cycleEpoch !== syncSessionEpoch()) throw new Error('AUTH_REQUIRED');
        pullRes = await this.pullAll();
        // P0-2 Etapa B1: si el pull inicial ya no tiene sesión válida
        // (solo posible con AUTH_MODE='supabase'), no tiene sentido
        // intentar el push detrás — se corta acá, nada local se toca.
        if (!pullRes.ok) {
          this.notify({ status: pullRes.reason, at: nowISO(), authErrorDetails: pullRes.authErrorDetails || [] });
          return;
        }
        if (cycleEpoch !== syncSessionEpoch()) throw new Error('AUTH_REQUIRED');
        pushRes = await this.pushAll();
      } else {
        if (cycleEpoch !== syncSessionEpoch()) throw new Error('AUTH_REQUIRED');
        pushRes = await this.pushAll();
        if (cycleEpoch !== syncSessionEpoch()) throw new Error('AUTH_REQUIRED');
        if (pushRes.reason === 'AUTH_REQUIRED') {
          this.notify({ status:'AUTH_REQUIRED', at:nowISO() });
          return;
        }
        pullRes = await this.pullAll();
      }
      if (!pullRes.ok) { this.notify({status:pullRes.reason || 'error',at:nowISO(),pulled:pullRes.pulled || 0}); return; }
      // AUTH_REQUIRED/AUTH_FORBIDDEN son distintos de un conflicto CAS —
      // nunca se reportan como 'ok'/'partial' (ver docs/
      // AUTH_RLS_IMPLEMENTATION_PLAN.md §11). Con AUTH_MODE='legacy'
      // (default) ninguno de los dos `reason` puede ocurrir nunca.
      if (pushRes.reason === 'AUTH_REQUIRED' || pullRes.reason === 'AUTH_REQUIRED') {
        this.notify({ status: 'AUTH_REQUIRED', at: nowISO() });
        return;
      }
      // Corrección de semántica visual (2026-10-20, "indicador rojo de
      // sincronización en Android") — hallazgo real: por este punto
      // `pullRes.ok` YA es `true` (el `if (!pullRes.ok) {... return; }` de
      // arriba corta antes si no lo es), así que `pullRes.reason ===
      // 'AUTH_FORBIDDEN'` NUNCA puede ser verdad aquí — ese caso (el pull
      // GLOBAL completo rechazado) ya se reportó arriba, en su propio
      // notify(), como un fallo real. Lo que SÍ llega hasta aquí con
      // `pushRes.authErrors>0` es SIEMPRE una fila AISLADA del push (el
      // aislamiento por store/fila de pushAll() ya garantiza que ninguna
      // fila mala bloquea a las demás ni al pull) — un solo fixture
      // huérfano con un 403 pintaba TODO el ciclo como "SIN PERMISO PARA
      // SINCRONIZAR" en rojo, aunque push+pull hubieran terminado
      // normalmente. Ahora cualquier problema AISLADO (fila con 403,
      // fila con error de datos, o un conflicto CAS detectado) cae en el
      // mismo balde "partial" (ámbar) — nunca en rojo. Rojo queda
      // reservado para lo que de verdad no terminó: AUTH_REQUIRED/pull
      // global rechazado (ya manejados arriba), offline/backend
      // inalcanzable/error fatal/bootstrap incompleto (manejados en
      // notify() de otros códigos de salida de esta función).
      const hasIsolatedAuthForbidden = (pushRes.authErrors || 0) > 0;
      const hasErrors = pushRes.errors && pushRes.errors.length;
      const hasConflicts = ((pushRes.conflicts || 0) + (pullRes.conflicts || 0)) > 0;
      const hasIsolatedIssues = hasIsolatedAuthForbidden || hasErrors || hasConflicts;
      // perf (lote SYNC_PERFORMANCE 2026-10-18): SOLO diagnóstico — nunca
      // decide nada del resultado/estado de arriba. Additive en notify() y
      // en el valor devuelto; nadie que ya lea `.pushed`/`.pulled` se
      // entera de que existe. `this._lastSyncPerf` queda disponible para
      // quien quiera leerlo desde la consola sin tener que interceptar la
      // promesa (p.ej. durante un benchmark manual).
      const fullSyncPerf = { push: pushRes.perf, pull: pullRes.perf, totalMs: perfNow() - fullSyncStart, bootstrap: esPrimeraVez };
      this._lastSyncPerf = fullSyncPerf;
      if (typeof this._logPerf === 'function') this._logPerf(fullSyncPerf); else logSyncPerf(fullSyncPerf, `SYNC #${cycleId} [${reason}]`);
      this.notify({
        status: hasIsolatedIssues ? 'partial' : 'ok',
        pushed: pushRes.pushed || 0, pulled: pullRes.pulled || 0,
        errors: pushRes.errors || [], newAnomalies: pullRes.newAnomalies || [],
        conflicts: (pushRes.conflicts || 0) + (pullRes.conflicts || 0),
        authErrors: pushRes.authErrors || 0, at: nowISO(),
        // Diagnóstico sanitizado (lote "Sync 403 diagnostic") — concatena el
        // detalle de push (por store/fila) y de pull (si lo hubo), nunca
        // reemplaza `authErrors` (el conteo, usado por el resto del código).
        authErrorDetails: [...(pushRes.authErrorDetails || []), ...(pullRes.authErrorDetails || [])],
        perf: fullSyncPerf
      });
      return {ok:!hasIsolatedIssues,pulled:pullRes.pulled || 0,perf:fullSyncPerf};
    } catch (err) {
      // navigator.onLine=true no garantiza que el backend responda (ver
      // Bloque B, hallazgo real del piloto Android) — una falla de red/
      // timeout aquí (nunca un 401/403 real, esos ya se manejan aparte) se
      // reporta como 'backend_unreachable', NUNCA como si hubiera
      // sincronizado. No se toca sesión/tokens/snapshot ni se genera
      // conflicto CAS — el catch nunca los tocó, esto solo afina el status.
      const status = err.message === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : isNetworkFailure(err) ? 'backend_unreachable' : 'error';
      console.error(`SYNC #${cycleId} [${reason}] error`, err);
      this.notify({ status, message: err.message });
    } finally {
      this.syncing = false;
    }
  },

  // Wrapper para los puntos de entrada AUTOMÁTICOS de sync (arranque de la
  // app, timer periódico, reconexión, volver a foreground) — NUNCA para
  // fullSync() en sí, que se deja intacto a propósito (lo llaman decenas de
  // sitios existentes, incluyendo TODOS los tests de tests/unit/sync-*, que
  // no deben depender del reloj real). Corre el sync incremental de
  // siempre y, aparte, revisa si hay una ventana de full refresh pendiente
  // (07:00/19:00, ver runFullRefreshIfDue()) — nunca antes de la primera
  // bootstrap de cuenta completo ni sin sesión
  // válida en modo supabase (mismo gate que pushAll/pullAll).
  async runAutoCycle(reason = 'auto') {
    // Mirar la identidad/cache de cuenta ANTES del ciclo, para no duplicar
    // un pull completo si el propio ciclo hizo bootstrap o cambió fingerprint.
    const before = await this.getAccountSyncState();
    const esPrimeraVez = !before.bootstrapComplete;
    const cycle = await this.fullSync(reason);
    if (!cycle?.ok) return;
    if (esPrimeraVez || (await this.getAccountSyncState()).key !== before.key) return;
    if (typeof Auth === 'undefined' || !Auth.isSupabaseMode() || !Auth.isAuthenticated()) return;
    const refresh = await this.runFullRefreshIfDue();
    if (refresh && !refresh.ok) this.notify({status:refresh.reason || 'error',at:nowISO()});
  },

  // `intervalSeconds`: lo decide el Administrador desde Configuración (ver
  // app.js App.generalSettings.syncIntervalSeconds, ya sincronizado y
  // validado — antes era un fijo de 20s). Los listeners de
  // 'online'/'visibilitychange' se agregan UNA sola vez aquí; el timer
  // periódico en sí vive en _restartAutoTimer(), para poder cambiarlo en
  // caliente (setAutoInterval()) sin duplicar listeners ni crear un
  // segundo timer.
  startAuto(intervalSeconds = 120) {
    window.addEventListener('online', () => this.runAutoCycle('reconnect'));

    // Al volver a la app después de tenerla en segundo plano, sincroniza enseguida en
    // vez de esperar el siguiente ciclo. Es el momento en que la persona mira la
    // pantalla, y es cuando peor sienta ver datos viejos.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && navigator.onLine) this.runAutoCycle('foreground');
    });

    this._restartAutoTimer(intervalSeconds);
    if (navigator.onLine) this.runAutoCycle('startup');
  },

  // Cambia el intervalo del auto-sync EN CALIENTE (el Administrador lo
  // ajusta desde Configuración) — nunca requiere reiniciar la app. Siempre
  // apaga el timer anterior antes de crear el nuevo: en cualquier momento
  // existe como máximo 1 timer de auto-sync activo.
  setAutoInterval(intervalSeconds) {
    this._restartAutoTimer(intervalSeconds);
  },

  _restartAutoTimer(intervalSeconds) {
    if (this._autoTimerId) clearInterval(this._autoTimerId);
    this._autoIntervalSeconds = intervalSeconds;
    // Cada ciclo mueve solo lo que cambió (ver pushAll/pullAll), así que el
    // costo de un intervalo corto es mínimo — el valor en sí ahora lo
    // decide el Administrador, ya no un fijo de 20s.
    this._autoTimerId = setInterval(() => { if (navigator.onLine) this.runAutoCycle('timer'); }, intervalSeconds * 1000);
  }
};
