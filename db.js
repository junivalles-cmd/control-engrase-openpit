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
  async init() { await openDB(); await seedIfEmpty(); await seedCuadrillasIfMissing(); },

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

  const typeArt = types.find(t => t.name === 'Camión Articulado').id;
  const typeVolq = types.find(t => t.name === 'Camión Volquete').id;
  const typeTrac = types.find(t => t.name === 'Tractor de Oruga').id;

  const equipos = [
    {
      id: 'eq_demo_4586', code: '45-86', description: 'Camión Articulado', brand: 'Caterpillar', model: '745C',
      serial: 'CAT745C-0086', typeId: typeArt, locationId: 'loc_pit1', status: 'Operativo',
      hourmeter: 28470, shiftId: 'shift_dia', photo: null, active: true
    },
    {
      id: 'eq_demo_4569', code: '45-69', description: 'Camión Articulado', brand: 'Caterpillar', model: '740B',
      serial: 'CAT740B-0069', typeId: typeArt, locationId: 'loc_pit1', status: 'Operativo',
      hourmeter: 21492, shiftId: 'shift_dia', photo: null, active: true
    },
    {
      id: 'eq_demo_0568', code: '05-68', description: 'Tractor de Oruga', brand: 'Caterpillar', model: 'D8T',
      serial: 'CATD8T-0568', typeId: typeTrac, locationId: 'loc_botadero', status: 'Operativo',
      hourmeter: 14215, shiftId: 'shift_noche', photo: null, active: true
    },
    {
      id: 'eq_demo_1231', code: '12-31', description: 'Camión Volquete', brand: 'Volvo', model: 'FMX 500',
      serial: 'VOLFMX-1231', typeId: typeVolq, locationId: 'loc_pit1', status: 'Operativo',
      hourmeter: 9800, shiftId: 'shift_dia', photo: null, active: true
    }
  ];
  for (const e of equipos) await DB.put('equipment', stamp(e, 'sistema'));

  // Puntos de engrase estándar por tipo (plantilla simplificada)
  const puntosBase = {
    [typeArt]: ['Articulación central', 'Pines de tolva', 'Cardanes', 'Crucetas', 'Suspensión', 'Dirección'],
    [typeVolq]: ['Pines de tolva', 'Ejes', 'Suspensión', 'Dirección', 'Cardanes'],
    [typeTrac]: ['Pines de cuchilla', 'Cilindros de inclinación', 'Rodillos', 'Pasadores de bastidor', 'Bisagras']
  };

  const planes = [];
  for (const eq of equipos) {
    const plan = stamp({
      id: `plan_${eq.id}`, equipmentId: eq.id, controlType: 'Horas de operación',
      frequency: 50, lastGreaseHour: eq.hourmeter - (eq.code === '05-68' ? 65 : (eq.code === '45-69' ? 42 : 20)),
      alertYellowHours: 10, active: true
    }, 'sistema');
    planes.push(plan);
    await DB.put('lubrication_plans', plan);

    const puntos = puntosBase[eq.typeId] || ['Puntos generales'];
    for (const p of puntos) {
      await DB.put('lubrication_points', stamp({
        id: `pt_${eq.id}_${p.replace(/\s+/g, '')}`, planId: plan.id, system: 'General', component: p, point: p,
        greaseType: lubricants[0].id, recommendedQty: 0.5, frequency: 50, notes: '', active: true
      }, 'sistema'));
    }
  }

  await DB.put('settings', stamp({
    id: 'notifications', enabled: true,
    lubricadorDiaHour: 6, lubricadorDiaMinute: 0,
    lubricadorNocheHour: 18, lubricadorNocheMinute: 0,
    complianceHour: 7, complianceMinute: 0
  }, 'sistema'));

  await logAudit('SEED', 'Datos demo iniciales cargados', 'sistema');
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
