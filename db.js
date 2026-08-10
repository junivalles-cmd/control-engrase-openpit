/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT
   Capa de datos: IndexedDB (offline-first, sin backend)
   ============================================================ */

const DB_NAME = 'engrase_openpit';
const DB_VERSION = 5;

// Almacenes que se sincronizan con el servidor remoto (todo excepto configuración local del dispositivo)
const STORES = [
  'users', 'shifts', 'locations', 'equipment_types', 'equipment',
  'lubricants', 'lubrication_plans', 'lubrication_points',
  'lubrication_records', 'anomalies', 'audit_log', 'settings', 'cuadrillas', 'push_tokens'
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

const DB = {
  async init() { await openDB(); await seedIfEmpty(); await seedCuadrillasIfMissing(); await ensureDefaultSyncConfig(); },

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
  }
};

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function nowISO() { return new Date().toISOString(); }

function stamp(obj, user) {
  const t = nowISO();
  if (!obj.id) obj.id = uid('rec');
  if (!obj.createdAt) obj.createdAt = t;
  obj.updatedAt = t;
  if (!obj.createdBy) obj.createdBy = user || 'sistema';
  if (obj.active === undefined) obj.active = true;
  return obj;
}

async function logAudit(action, detail, user) {
  await DB.put('audit_log', stamp({
    id: uid('log'), action, detail, user: user || (App.currentUser && App.currentUser.name) || 'sistema'
  }));
}

/* ---------------- SEED DATA ---------------- */

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

  const users_seed = [
    { id: 'u_admin', name: 'Administrador General', username: 'admin', role: 'ADMINISTRADOR', pin: '1111', active: true },
    { id: 'u_plan', name: 'Ana Planificadora', username: 'planificador', role: 'PLANIFICADOR', pin: '2222', active: true },
    { id: 'u_sup', name: 'Carlos Supervisor', username: 'supervisor', role: 'SUPERVISOR', pin: '3333', active: true },
    { id: 'u_lub1', name: 'Junior Lubricador', username: 'lubricador', role: 'LUBRICADOR', pin: '4444', active: true, cuadrillaId: 'cuad_a' }
  ];
  for (const u of users_seed) await DB.put('users', stamp(u, 'sistema'));

  const lubricants = [
    { id: 'lub_ep2', name: 'Grasa EP2', brand: 'Mobil', type: 'Multiuso', grade: 'NLGI 2', code: 'GR-EP2', unit: 'kg', active: true },
    { id: 'lub_moly', name: 'Grasa Moly', brand: 'Shell', type: 'Alta presión', grade: 'NLGI 2', code: 'GR-MOLY', unit: 'kg', active: true },
    { id: 'lub_ht', name: 'Grasa Alta Temperatura', brand: 'Chevron', type: 'Alta temperatura', grade: 'NLGI 2', code: 'GR-HT', unit: 'kg', active: true }
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
