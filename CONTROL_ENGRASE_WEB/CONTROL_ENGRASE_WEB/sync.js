/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT — sync.js
   Sincronización offline-first contra una base de datos remota
   (Supabase / PostgREST). Todo se escribe primero en IndexedDB
   (funciona sin internet) y se empuja/hala del servidor cuando
   hay conexión.
   ============================================================ */

const PHOTO_BUCKET = 'engrase-photos';

function dataURLtoBlob(dataURL) {
  const [header, base64] = dataURL.split(',');
  const mimeMatch = /data:(.*?);base64/.exec(header || '');
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const Sync = {
  syncing: false,
  listeners: [],

  onChange(fn) { this.listeners.push(fn); },
  notify(state) { this.listeners.forEach(fn => { try { fn(state); } catch (e) {} }); },

  async isConfigured() {
    const cfg = await DB.getConfig();
    return !!(cfg && cfg.url && cfg.anonKey);
  },

  async testConnection(url, anonKey) {
    const clean = url.trim().replace(/\/+$/, '');
    if (!/^https:\/\//i.test(clean)) {
      throw new Error('La URL debe empezar con https:// (cópiala tal cual aparece en Project Settings → API → Project URL).');
    }
    let resp;
    try {
      resp = await fetch(`${clean}/rest/v1/engrase_sync?select=store&limit=1`, {
        headers: { apikey: anonKey.trim(), Authorization: `Bearer ${anonKey.trim()}` }
      });
    } catch (networkErr) {
      throw new Error('No se pudo contactar el servidor (sin internet, la URL está mal escrita, o el navegador bloqueó la conexión). Revisa que tengas datos/wifi activos y que la URL sea exactamente la de Supabase.');
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new Error('Conectó al servidor pero la llave (anon key) fue rechazada. Verifica que copiaste la "anon public key" completa, sin espacios ni saltos de línea.');
    }
    if (resp.status === 404) {
      throw new Error('El servidor respondió pero no encuentra la tabla "engrase_sync". Ejecuta el script schema.sql en el SQL Editor de Supabase.');
    }
    if (!resp.ok) throw new Error(`Respuesta ${resp.status} del servidor. Verifica la URL, la llave y que ejecutaste el script SQL.`);
    return true;
  },

  async saveConfig(url, anonKey) {
    const clean = url.trim().replace(/\/+$/, '');
    const key = anonKey.trim();
    await this.testConnection(clean, key);
    const prev = (await DB.getConfig()) || {};
    await DB.setConfig({ ...prev, url: clean, anonKey: key });
    return true;
  },

  async pendingCount() {
    const cfg = await DB.getConfig();
    if (!cfg || !cfg.url) return 0;
    let count = 0;
    for (const store of STORES) {
      const rows = await DB.all(store);
      count += rows.filter(r => r._pushedVersion !== r.updatedAt).length;
    }
    return count;
  },

  // Sube una foto (guardada localmente en base64) a Supabase Storage y devuelve la URL
  // pública. Solo se llama una vez por foto — el registro local se marca con
  // photoUploaded para no volver a subirla en cada sincronización.
  // Sube a Supabase Storage cada foto que todavía esté en base64, y devuelve una
  // copia del registro con LINKS en vez de imágenes — así la base de datos no se
  // llena. El registro local conserva las imágenes completas para verlas sin internet.
  async uploadPhotoIfNeeded(store, row, cfg) {
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
        const resp = await fetch(`${cfg.url}/storage/v1/object/${PHOTO_BUCKET}/${path}`, {
          method: 'POST',
          headers: {
            apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}`,
            'Content-Type': blob.type || 'image/jpeg', 'x-upsert': 'true'
          },
          body: blob
        });
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

    if (algunaSubida && !row.photoUploaded) {
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
  async uploadSignatureIfNeeded(store, row, cfg) {
    const local = row.signatureLocal;
    if (typeof local !== 'string' || !local.startsWith('data:image')) return row;

    try {
      const blob = dataURLtoBlob(local);
      const ext = (blob.type && blob.type.includes('webp')) ? 'webp' : 'png';
      const path = `${store}/${row.id}.${ext}`;
      const resp = await fetch(`${cfg.url}/storage/v1/object/${PHOTO_BUCKET}/${path}`, {
        method: 'POST',
        headers: {
          apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}`,
          'Content-Type': blob.type || 'image/png', 'x-upsert': 'true'
        },
        body: blob
      });
      if (!resp.ok) {
        console.warn(`No se pudo subir la firma de ${store}/${row.id}: ${resp.status}`);
        return row; // se queda en base64; se reintenta en la próxima sincronización
      }
      const url = `${cfg.url}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`;
      if (!row.signatureUploaded) {
        row.signatureUploaded = true; // marca local, no cambia updatedAt (evita reintentos infinitos)
        await DB.put(store, row);
      }
      // Copia para el servidor: URL en vez de base64 (no duplicar el peso en
      // el payload jsonb de engrase_sync); el registro local conserva la firma completa.
      return { ...row, signatureLocal: null, signatureUrl: url };
    } catch (e) {
      console.warn('No se pudo subir la firma a Storage', e);
      return row;
    }
  },

  async pushAll() {
    const cfg = await DB.getConfig();
    if (!cfg || !cfg.url || !cfg.anonKey) return { ok: false, reason: 'not_configured' };
    let pushed = 0;
    const errors = [];

    for (const store of STORES) {
      try {
        const rows = await DB.all(store);
        // Antes comparábamos la hora del cambio contra "la última vez que sincronicé"
        // (cfg.lastPush) — si el reloj de algún dispositivo estaba desajustado, un
        // cambio nuevo podía parecer "más viejo" que ese punto y nunca subir. Ahora
        // cada registro se marca individualmente al confirmarse: se sube si su versión
        // actual (updatedAt) todavía no coincide con la última versión confirmada por
        // el servidor (_pushedVersion) — no depende de comparar relojes entre equipos.
        const toPush = rows.filter(r => r._pushedVersion !== r.updatedAt);
        if (!toPush.length) continue;

        const preparedRows = [];
        for (const r of toPush) {
          let prepared = await this.uploadPhotoIfNeeded(store, r, cfg);
          prepared = await this.uploadSignatureIfNeeded(store, prepared, cfg);
          preparedRows.push(prepared);
        }

        const body = preparedRows.map(r => ({
          store, id: r.id, payload: r, updated_at: r.updatedAt, deleted: r.active === false
        }));
        const resp = await fetch(`${cfg.url}/rest/v1/engrase_sync?on_conflict=store,id`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: cfg.anonKey,
            Authorization: `Bearer ${cfg.anonKey}`,
            Prefer: 'resolution=merge-duplicates,return=minimal'
          },
          body: JSON.stringify(body)
        });
        if (!resp.ok) throw new Error(`${resp.status}`);
        pushed += toPush.length;
        // Confirma cada registro por separado — solo AHORA que el servidor lo aceptó.
        for (const r of toPush) {
          r._pushedVersion = r.updatedAt;
          await DB.put(store, r);
        }
      } catch (err) {
        // Un problema en UN store (ej. una foto que no subió, un error de red puntual) ya
        // no frena a los demás — seguimos con el resto y avisamos al final cuáles fallaron.
        console.error(`Error al subir el store "${store}"`, err);
        errors.push(store);
      }
    }
    return { ok: errors.length === 0, pushed, errors };
  },

  async pullAll() {
    const cfg = await DB.getConfig();
    if (!cfg || !cfg.url || !cfg.anonKey) return { ok: false, reason: 'not_configured' };
    const since = cfg.lastPull || '1970-01-01T00:00:00.000Z';

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
    while (true) {
      const resp = await fetch(
        `${cfg.url}/rest/v1/engrase_sync?select=*&updated_at=gt.${encodeURIComponent(since)}&order=updated_at.asc,store.asc,id.asc&limit=${PAGE_SIZE}&offset=${offset}`,
        { headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` } }
      );
      if (!resp.ok) throw new Error(`Error al descargar cambios: ${resp.status}`);
      const page = await resp.json();
      rows = rows.concat(page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    let maxUpdated = since;
    const newAnomalies = [];
    for (const row of rows) {
      if (!STORES.includes(row.store)) continue;
      const rec = row.payload;
      rec.active = !row.deleted;
      const existing = await DB.get(row.store, rec.id).catch(() => null);
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
      await DB.put(row.store, rec);
      if (row.store === 'anomalies' && !row.deleted) newAnomalies.push(rec);
      if (row.updated_at > maxUpdated) maxUpdated = row.updated_at;
    }
    cfg.lastPull = maxUpdated;
    await DB.setConfig(cfg);
    return { ok: true, pulled: rows.length, newAnomalies };
  },

  async fullSync() {
    if (this.syncing) return;
    if (!(await this.isConfigured())) { this.notify({ status: 'unconfigured' }); return; }
    if (!navigator.onLine) { this.notify({ status: 'offline' }); return; }
    this.syncing = true;
    this.notify({ status: 'syncing' });
    try {
      // En la PRIMERA sincronización de un dispositivo se baja antes de subir. Si no,
      // el catálogo base que la app crea al instalarse (turnos, lubricantes, cuadrillas)
      // se sube como "nuevo" y revive lo que el administrador ya había borrado en el
      // servidor. Bajando primero, este dispositivo se entera de qué está eliminado
      // antes de proponer nada.
      const cfg = await DB.getConfig();
      const esPrimeraVez = !cfg.lastPull;
      let pushRes, pullRes;
      if (esPrimeraVez) {
        pullRes = await this.pullAll();
        pushRes = await this.pushAll();
      } else {
        pushRes = await this.pushAll();
        pullRes = await this.pullAll();
      }
      const hasErrors = pushRes.errors && pushRes.errors.length;
      this.notify({
        status: hasErrors ? 'partial' : 'ok',
        pushed: pushRes.pushed || 0, pulled: pullRes.pulled || 0,
        errors: pushRes.errors || [], newAnomalies: pullRes.newAnomalies || [], at: nowISO()
      });
    } catch (err) {
      console.error('Sync error', err);
      this.notify({ status: 'error', message: err.message });
    } finally {
      this.syncing = false;
    }
  },

  startAuto() {
    window.addEventListener('online', () => this.fullSync());

    // Cada 20 segundos (antes 45): así un cambio hecho por el administrador —cerrar o
    // borrar una anomalía, por ejemplo— llega al resto del equipo en segundos y no en
    // casi un minuto. Cada ciclo mueve solo lo que cambió, así que el costo es mínimo.
    setInterval(() => { if (navigator.onLine) this.fullSync(); }, 20000);

    // Al volver a la app después de tenerla en segundo plano, sincroniza enseguida en
    // vez de esperar el siguiente ciclo. Es el momento en que la persona mira la
    // pantalla, y es cuando peor sienta ver datos viejos.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && navigator.onLine) this.fullSync();
    });

    if (navigator.onLine) this.fullSync();
  }
};
