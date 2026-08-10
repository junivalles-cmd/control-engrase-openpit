/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT — app.js
   ============================================================ */

const App = {
  currentUser: null,
  route: 'dashboard',
  configAlertYellow: 10
};

/* ============================================================
   INTEGRACIÓN NATIVA (solo activa dentro de la app Android/Capacitor;
   en la versión web estas funciones no hacen nada)
   ============================================================ */
function isNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

/* ---------- Cámara / galería nativa ---------- */
async function pickPhotoNative() {
  const Camera = window.Capacitor?.Plugins?.Camera;
  if (!Camera) return null;
  try {
    const photo = await Camera.getPhoto({
      quality: 70, width: 1000, resultType: 'dataUrl', source: 'CAMERA', allowEditing: false
    });
    return photo?.dataUrl || null;
  } catch (e) {
    return null; // el usuario canceló, no es un error
  }
}

function photoFieldHTML() {
  return `
    <label class="span-2">Fotografía (opcional)
      <div class="photo-field-native hidden">
        <button type="button" class="btn photo-pick-btn">${ic("camera")}Agregar foto (cámara o galería)</button>
        <div class="photo-preview-wrap hidden">
          <img class="photo-preview"/>
          <button type="button" class="btn btn-sm btn-danger photo-remove-btn">Quitar foto</button>
        </div>
      </div>
      <div class="photo-field-web">
        <input type="file" name="photo" accept="image/*"/>
        <span class="field-hint">Puedes tomar una foto nueva o elegir una de tu galería</span>
      </div>
    </label>`;
}

function wirePhotoField(container) {
  const nat = isNative();
  container.querySelector('.photo-field-native')?.classList.toggle('hidden', !nat);
  container.querySelector('.photo-field-web')?.classList.toggle('hidden', nat);

  container.querySelector('.photo-pick-btn')?.addEventListener('click', async () => {
    const dataUrl = await pickPhotoNative();
    if (!dataUrl) return;
    const img = container.querySelector('.photo-preview');
    img.src = dataUrl;
    img.dataset.photo = dataUrl;
    container.querySelector('.photo-preview-wrap').classList.remove('hidden');
  });
  container.querySelector('.photo-remove-btn')?.addEventListener('click', () => {
    const img = container.querySelector('.photo-preview');
    img.removeAttribute('src');
    delete img.dataset.photo;
    container.querySelector('.photo-preview-wrap').classList.add('hidden');
  });
}

async function getSelectedPhotoDataURL(formEl) {
  const preview = formEl.querySelector('.photo-preview');
  if (preview && preview.dataset.photo) return preview.dataset.photo;
  const fileInput = formEl.querySelector('input[name="photo"]');
  const file = fileInput?.files?.[0];
  return file ? await fileToCompressedDataURL(file) : null;
}

/* ---------- Equipos visitados recientemente (acceso rápido, por dispositivo) ---------- */
function trackRecentEquipment(id) {
  try {
    let recents = JSON.parse(localStorage.getItem('engrase_recents') || '[]');
    recents = recents.filter(x => x !== id);
    recents.unshift(id);
    localStorage.setItem('engrase_recents', JSON.stringify(recents.slice(0, 5)));
  } catch (e) { /* localStorage no disponible, no pasa nada */ }
}
function getRecentEquipmentIds() {
  try { return JSON.parse(localStorage.getItem('engrase_recents') || '[]'); } catch (e) { return []; }
}
async function recentEquiposHTML(onClickFnName) {
  const ids = getRecentEquipmentIds();
  if (!ids.length) return '';
  const equipos = (await Promise.all(ids.map(id => DB.get('equipment', id)))).filter(Boolean);
  if (!equipos.length) return '';
  return `
    <div class="recents-row">
      <span class="recents-label">Recientes:</span>
      ${equipos.map(e => `<button class="recents-chip" data-recent-id="${e.id}">${e.shortCode || e.code}</button>`).join('')}
    </div>`;
}

/* ---------- Códigos QR: generar por equipo y escanear ----------
   El QR codifica un LINK real (no un texto suelto). Así, cualquier cámara del
   celular lo reconoce y ofrece abrirlo — antes usábamos un texto tipo
   "ENGRASE-EQ:xxx" que Android intentaba abrir como enlace y fallaba con
   "no hay ninguna app asociada", porque no era una URL válida. */
function qrValueForEquipment(equipment) {
  return `${location.origin}${location.pathname}#eq=${equipment.id}`;
}

function parseEquipmentIdFromScan(text) {
  const raw = text.trim();
  try {
    const url = new URL(raw);
    const hashMatch = /#eq=([^&]+)/.exec(url.hash);
    if (hashMatch) return decodeURIComponent(hashMatch[1]);
  } catch (e) { /* no era una URL completa, seguimos con los formatos viejos */ }
  const hashOnlyMatch = /#eq=([^&]+)/.exec(raw);
  if (hashOnlyMatch) return decodeURIComponent(hashOnlyMatch[1]);
  if (raw.startsWith('ENGRASE-EQ:')) return raw.slice('ENGRASE-EQ:'.length); // compatibilidad con etiquetas viejas ya impresas
  return raw;
}

async function printAllQRCodes(equipos) {
  if (!equipos.length) { alert('No hay equipos para imprimir.'); return; }
  if (!window.QRious) { alert('No se pudo cargar el generador de QR (revisa tu conexión la primera vez que uses esta función).'); return; }
  if (isNative() && !confirm('Estás generando estas etiquetas desde la app instalada — el link que llevan solo va a funcionar bien si las generas desde la versión web. ¿Quieres continuar de todas formas?')) return;

  const items = equipos.map(e => {
    const qr = new QRious({ value: qrValueForEquipment(e), size: 200 });
    return { e, dataUrl: qr.toDataURL() };
  });

  const win = window.open('', '_blank');
  if (!win) { alert('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes para este sitio e intenta de nuevo.'); return; }
  win.document.write(`<!DOCTYPE html><html><head><title>Etiquetas QR — Control de Engrase</title>
    <style>
      body { font-family: sans-serif; margin: 16px; color: #111; }
      h2 { margin: 0 0 14px; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
      .label { text-align: center; border: 1px solid #ccc; border-radius: 8px; padding: 10px; page-break-inside: avoid; }
      .label img { width: 130px; height: 130px; }
      .label h4 { margin: 6px 0 2px; font-size: 13px; }
      .label p { margin: 0; font-size: 10px; color: #555; }
      @media print { .label { border: 1px dashed #999; } }
    </style>
  </head><body>
    <h2>Etiquetas QR — ${equipos.length} equipos</h2>
    <div class="grid">
      ${items.map(({ e, dataUrl }) => `
        <div class="label">
          <img src="${dataUrl}"/>
          <h4>${e.code}${e.shortCode ? ' · ' + e.shortCode : ''}</h4>
          <p>${e.brand} ${e.model}</p>
        </div>`).join('')}
    </div>
  </body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 300);
}

function openEquipmentQR(equipment) {
  const nativeWarning = isNative() ? `<p style="color:var(--amber); font-size:12px">⚠ Estás generando este QR desde la app instalada — para que cualquier celular pueda escanearlo, genera e imprime las etiquetas desde la versión web en vez de la app.</p>` : '';
  openModal(`Código QR · ${equipment.code}`, `
    <div style="text-align:center">
      <canvas id="qr-canvas"></canvas>
      <p class="dim" style="margin-top:10px">Imprime esta etiqueta y pégala en el equipo. Cualquier cámara del celular lo reconoce — no hace falta abrir la app primero.</p>
      ${nativeWarning}
      <button class="btn btn-accent" id="btn-print-qr">${ic("print")}Imprimir etiqueta</button>
    </div>
  `);
  try {
    // eslint-disable-next-line no-new
    new QRious({ element: $('#qr-canvas'), value: qrValueForEquipment(equipment), size: 220, background: '#ffffff', foreground: '#14171A' });
  } catch (e) { $('#qr-canvas').replaceWith('No se pudo generar el código QR (sin conexión la primera vez que se usa esta función).'); }
  $('#btn-print-qr').addEventListener('click', () => {
    const win = window.open('', '_blank');
    win.document.write(`<html><body style="text-align:center; font-family:sans-serif; padding:30px">
      <h2>${equipment.code}${equipment.shortCode ? ' · ' + equipment.shortCode : ''}</h2>
      <p>${equipment.brand} ${equipment.model}</p>
      <img src="${$('#qr-canvas').toDataURL()}" style="width:260px"/>
      </body></html>`);
    win.document.close();
    win.print();
  });
}

function decodeQrFromDataUrl(dataUrl) {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    let code = null;
    try {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      code = window.jsQR ? window.jsQR(imageData.data, canvas.width, canvas.height) : null;
    } catch (e) { /* ignore */ }
    if (code && code.data) handleScannedQR(code.data);
    else alert('No se detectó ningún código QR en la imagen. Intenta de nuevo con mejor luz y enfoque, más cerca de la etiqueta.');
  };
  img.src = dataUrl;
}

// Si la app se abrió (o ya estaba abierta) por el link de un QR escaneado con
// CUALQUIER cámara — no solo nuestro botón "Escanear QR" — esto salta directo al equipo.
async function handleQrDeepLink() {
  const match = /#eq=([^&]+)/.exec(location.hash);
  if (!match) return;
  const id = decodeURIComponent(match[1]);
  history.replaceState(null, '', location.pathname + location.search); // limpia el hash para no repetirlo
  const equipment = await DB.get('equipment', id);
  if (!equipment || equipment.active === false) return;
  if (App.currentUser.role === 'LUBRICADOR') {
    await startLubricadorGreaseFlow(equipment.id);
  } else {
    openEquipmentDetail(equipment.id);
  }
}

async function handleScannedQR(text) {
  const id = parseEquipmentIdFromScan(text);
  const equipment = await DB.get('equipment', id);
  if (!equipment || equipment.active === false) {
    alert('Este código QR no corresponde a ningún equipo activo del sistema.');
    return;
  }
  if (App.currentUser.role === 'LUBRICADOR') {
    if (App.route !== 'turno') { App.route = 'turno'; }
    await startLubricadorGreaseFlow(equipment.id);
  } else {
    openEquipmentDetail(equipment.id);
  }
}

async function openQrScanner() {
  if (isNative()) {
    const dataUrl = await pickPhotoNative();
    if (dataUrl) decodeQrFromDataUrl(dataUrl);
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment'; // en web, sesga hacia la cámara para escanear (no galería)
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const dataUrl = await fileToCompressedDataURL(file, 1200, 0.9);
    decodeQrFromDataUrl(dataUrl);
  });
  input.click();
}


const NOTIF_ID_DAILY_TASKS = 1001;
const NOTIF_ID_COMPLIANCE = 1002;
const NOTIF_ID_WEEKDAY_PLAN = 1003;

/* ---------- Validación de horómetro (evita errores de digitación) ---------- */
function validateHourmeterChange(oldValue, newValue) {
  if (isNaN(newValue) || newValue < 0) {
    return { ok: false, message: 'El horómetro debe ser un número válido y positivo.' };
  }
  if (newValue < oldValue) {
    return { ok: false, message: `El horómetro nuevo (${fmt(newValue)} h) es menor al actual (${fmt(oldValue)} h). El horómetro nunca debería bajar — revisa que no haya un error de digitación.` };
  }
  const diff = newValue - oldValue;
  if (diff > 500) {
    return { ok: 'warn', message: `El horómetro subió ${fmt(diff)} h de una sola vez (de ${fmt(oldValue)} a ${fmt(newValue)}). Es un salto grande. ¿Confirmas que el dato es correcto?` };
  }
  return { ok: true };
}
// Devuelve true si se puede continuar (ya sea porque es válido, o porque el usuario
// confirmó un salto grande); muestra alert/confirm según el caso.
function confirmHourmeterChange(oldValue, newValue) {
  const v = validateHourmeterChange(oldValue, newValue);
  if (v.ok === false) { alert(v.message); return false; }
  if (v.ok === 'warn') { return confirm(v.message); }
  return true;
}

function nextTimeAt(hour, minute) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  if (d <= new Date()) d.setDate(d.getDate() + 1);
  return d;
}

/* ---------- Contador de pendientes en el ícono de la app (badge) ---------- */
/* ---------- Notificaciones push reales (Firebase Cloud Messaging, vía Capacitor) ----------
   A diferencia de las notificaciones locales, estas SÍ pueden llegar aunque nadie tenga la
   app abierta — pero requieren que el proyecto de Firebase esté configurado (ver guía). Si
   el plugin no está disponible (app web, o Firebase no configurado), estas funciones no hacen nada. */
function wirePushListeners() {
  const PN = window.Capacitor?.Plugins?.PushNotifications;
  if (!PN || App._pushListenersWired) return;
  App._pushListenersWired = true;

  PN.addListener('registration', async (token) => {
    if (!App.currentUser || !token?.value) return;
    try {
      await DB.put('push_tokens', stamp({
        id: `tok_${App.currentUser.id}`, userId: App.currentUser.id, userName: App.currentUser.name,
        role: App.currentUser.role, token: token.value, platform: 'android', active: true
      }, App.currentUser.name));
      Sync.fullSync();
    } catch (e) { console.warn('No se pudo guardar el token de notificaciones push', e); }
  });

  PN.addListener('registrationError', (err) => console.warn('Error registrando notificaciones push', err));

  // Con la app abierta, FCM no muestra la notificación del sistema sola — la mostramos como toast
  PN.addListener('pushNotificationReceived', (n) => {
    showInAppToast(`${n.title || 'Aviso'}: ${n.body || ''}`);
  });

  // Si el usuario toca la notificación (app cerrada o en segundo plano), lo llevamos a Anomalías
  PN.addListener('pushNotificationActionPerformed', () => {
    if (App.currentUser) navigate(App.currentUser.role === 'LUBRICADOR' ? 'anomalias' : 'anomalias');
  });
}

async function initPushNotifications() {
  const PN = window.Capacitor?.Plugins?.PushNotifications;
  if (!PN || !App.currentUser) return;
  try {
    let perm = await PN.checkPermissions();
    if (perm.receive !== 'granted') perm = await PN.requestPermissions();
    if (perm.receive !== 'granted') return;
    await PN.register();
  } catch (e) { console.warn('Notificaciones push no disponibles en esta plataforma', e); }
}

async function disablePushForCurrentUser() {
  if (!App.currentUser) return;
  const userId = App.currentUser.id;
  const userName = App.currentUser.name;
  try {
    const tok = await DB.get('push_tokens', `tok_${userId}`);
    if (tok) { tok.active = false; await DB.put('push_tokens', stamp(tok, userName)); }
  } catch (e) {}
}

async function refreshAppBadge() {
  const Badge = window.Capacitor?.Plugins?.Badge;
  if (!Badge || !App.currentUser) return;
  try {
    let count = 0;
    if (App.currentUser.role === 'LUBRICADOR') {
      const equipos = await DB.allActive('equipment');
      const shift = currentShiftId();
      const myCuadrilla = App.currentUser.cuadrillaId;
      const mine = equipos.filter(e => e.shiftId === shift && (!e.cuadrillaId || e.cuadrillaId === myCuadrilla));
      const statuses = await computeAllStatuses(mine);
      count = statuses.filter(x => x.s.code === 'ROJO' || x.s.code === 'AMARILLO').length;
    } else if (['ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR'].includes(App.currentUser.role)) {
      const equipos = await DB.allActive('equipment');
      const statuses = await computeAllStatuses(equipos);
      count = statuses.filter(x => x.s.code === 'ROJO').length;
    }
    if (count > 0) await Badge.set({ count });
    else await Badge.clear();
  } catch (e) { /* el plugin puede no estar disponible en esta plataforma; no pasa nada */ }
}

async function clearAppBadge() {
  try { await window.Capacitor?.Plugins?.Badge?.clear(); } catch (e) {}
}

async function refreshLocalNotifications() {
  const LN = window.Capacitor?.Plugins?.LocalNotifications;
  if (!LN || !App.currentUser) return;
  try {
    const settings = (await DB.get('settings', 'notifications')) || {
      enabled: true, lubricadorDiaHour: 6, lubricadorDiaMinute: 0,
      lubricadorNocheHour: 18, lubricadorNocheMinute: 0, complianceHour: 7, complianceMinute: 0,
      weekdayPlanEnabled: false, weekdayPlanHour: 7, weekdayPlanMinute: 30
    };
    await LN.cancel({ notifications: [{ id: NOTIF_ID_DAILY_TASKS }, { id: NOTIF_ID_COMPLIANCE }, { id: NOTIF_ID_WEEKDAY_PLAN }] });
    if (!settings.enabled) return;

    const perm = await LN.checkPermissions();
    if (perm.display === 'denied') return; // ya lo rechazó antes — no volver a preguntar cada vez que entra
    if (perm.display !== 'granted') {
      const req = await LN.requestPermissions();
      if (req.display !== 'granted') return;
    }

    const equipos = await DB.allActive('equipment');
    const statuses = await computeAllStatuses(equipos);
    const vencidos = statuses.filter(x => x.s.code === 'ROJO').length;
    const proximos = statuses.filter(x => x.s.code === 'AMARILLO').length;
    const compliance = equipos.length ? Math.round(((equipos.length - vencidos) / equipos.length) * 100) : 100;

    const notifications = [];

    if (App.currentUser.role === 'LUBRICADOR') {
      const shift = currentShiftId();
      const shiftStatuses = statuses.filter(x => x.e.shiftId === shift);
      const pendientes = shiftStatuses.filter(x => x.s.code === 'ROJO' || x.s.code === 'AMARILLO').length;
      const h = shift === 'shift_dia' ? settings.lubricadorDiaHour : settings.lubricadorNocheHour;
      const m = shift === 'shift_dia' ? settings.lubricadorDiaMinute : settings.lubricadorNocheMinute;
      notifications.push({
        id: NOTIF_ID_DAILY_TASKS,
        title: 'Engrase de hoy',
        body: pendientes > 0
          ? `Tienes ${pendientes} equipo(s) pendientes de engrase en tu turno.`
          : 'Tu turno está al día con el engrase.',
        schedule: { at: nextTimeAt(h, m), every: 'day', repeats: true }
      });
    }

    if (['ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR'].includes(App.currentUser.role)) {
      notifications.push({
        id: NOTIF_ID_COMPLIANCE,
        title: 'Cumplimiento de engrase',
        body: `Cumplimiento actual: ${compliance}%. ${vencidos} vencido(s), ${proximos} próximo(s) a vencer.`,
        schedule: { at: nextTimeAt(settings.complianceHour, settings.complianceMinute), every: 'day', repeats: true }
      });
    }

    // Aviso específico de equipos con plan "Día y turno de la semana" — hora aparte,
    // configurable por Administrador o Planificador en Configuración → Notificaciones.
    if (settings.weekdayPlanEnabled && ['ADMINISTRADOR', 'PLANIFICADOR'].includes(App.currentUser.role)) {
      const weekdayStatuses = statuses.filter(x => x.s.plan && x.s.plan.controlType === 'Día y turno de la semana');
      const dueToday = weekdayStatuses.filter(x => x.s.code === 'AMARILLO' || x.s.code === 'ROJO');
      if (dueToday.length) {
        notifications.push({
          id: NOTIF_ID_WEEKDAY_PLAN,
          title: 'Equipos con plan por día/turno',
          body: `${dueToday.length} equipo(s) con plan por día y turno están pendientes o vencidos hoy.`,
          schedule: { at: nextTimeAt(settings.weekdayPlanHour, settings.weekdayPlanMinute), every: 'day', repeats: true }
        });
      }
    }

    if (notifications.length) await LN.schedule({ notifications });
  } catch (e) {
    console.warn('No se pudieron programar notificaciones locales', e);
  }
}

const PERMISSIONS = {
  ADMINISTRADOR: ['dashboard','equipos','plan','turno','registrar','horometros','anomalias','lubricantes','historial','reportes','usuarios','config','ayuda'],
  PLANIFICADOR: ['dashboard','equipos','plan','turno','historial','reportes','horometros','ayuda'],
  SUPERVISOR: ['dashboard','equipos','turno','anomalias','historial','usuarios','ayuda'],
  LUBRICADOR: ['turno','anomalias','historial','ayuda'],
  VISOR: ['dashboard','historial','reportes','ayuda']
};

/* ---------- utilidades ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const ic = (name) => `<span class="btn-icon icon-${name}"></span>`;
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const fmt = (n, d = 0) => Number(n).toLocaleString('es-NI', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDate = (iso) => new Date(iso).toLocaleString('es-NI', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Configuración general editable por el Administrador (horarios de turno, umbrales, etc.)
// Se carga en memoria al arrancar y se puede recargar cuando el admin la cambia.
App.generalSettings = { shiftDayStart: 6, shiftNightStart: 18, defaultAlertYellowHours: 10, complianceTarget: 95 };

async function loadGeneralSettings() {
  const s = await DB.get('settings', 'general');
  if (s) Object.assign(App.generalSettings, s);
}

function currentShiftId() {
  const h = new Date().getHours();
  const { shiftDayStart, shiftNightStart } = App.generalSettings;
  return (h >= shiftDayStart && h < shiftNightStart) ? 'shift_dia' : 'shift_noche';
}

const WEEKDAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const SCHEDULE_WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']; // Domingo se deja libre/rotativo, igual que en el plan en papel

function mostRecentAssignedDate(assignedDays) {
  if (!assignedDays || !assignedDays.length) return null;
  const todayIdx = new Date().getDay();
  const assignedIdx = assignedDays.map(d => WEEKDAY_NAMES.indexOf(d));
  for (let back = 0; back < 7; back++) {
    const idx = (todayIdx - back + 7) % 7;
    if (assignedIdx.includes(idx)) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - back);
      return d;
    }
  }
  return null;
}

async function weekdayStatusFor(equipment, plan, recordsList) {
  const lastDue = mostRecentAssignedDate(plan.assignedDays || []);
  if (!lastDue) return { code: 'GRIS', label: 'SIN DÍAS ASIGNADOS', remaining: null, plan };
  const records = recordsList || await DB.allActive('lubrication_records');
  const done = records.some(r => r.equipmentId === equipment.id && new Date(r.date) >= lastDue);
  const isToday = lastDue.toDateString() === new Date().toDateString();
  if (done) return { code: 'VERDE', label: 'AL DÍA', remaining: null, plan, scheduleDate: lastDue };
  if (isToday) return { code: 'AMARILLO', label: 'PROGRAMADO HOY', remaining: null, plan, scheduleDate: lastDue };
  return { code: 'ROJO', label: 'VENCIDO', remaining: null, plan, scheduleDate: lastDue };
}

// plansList / recordsList son opcionales: si se pasan (precargados una sola vez para
// varios equipos a la vez), evitamos volver a leer toda la tabla en cada llamada.
async function statusFor(equipment, plansList, recordsList) {
  if (equipment.status !== 'Operativo') {
    return { code: 'GRIS', label: 'DETENIDO', remaining: null };
  }
  const plans = plansList || await DB.allActive('lubrication_plans');
  const plan = plans.find(p => p.equipmentId === equipment.id);
  if (!plan) return { code: 'GRIS', label: 'SIN PLAN', remaining: null };

  if (plan.controlType === 'Día y turno de la semana') {
    return await weekdayStatusFor(equipment, plan, recordsList);
  }

  const nextHour = plan.lastGreaseHour + plan.frequency;
  const remaining = nextHour - equipment.hourmeter;
  let code, label;
  if (remaining < 0) { code = 'ROJO'; label = 'VENCIDO'; }
  else if (remaining <= (plan.alertYellowHours || 10)) { code = 'AMARILLO'; label = 'PRÓXIMO'; }
  else { code = 'VERDE'; label = 'AL DÍA'; }
  return { code, label, remaining, nextHour, plan };
}

// Calcula el estado de una lista de equipos leyendo planes/registros UNA sola vez,
// en vez de una vez por cada equipo (antes: N equipos = N consultas completas a la BD).
async function computeAllStatuses(equipos) {
  const [plans, records] = await Promise.all([
    DB.allActive('lubrication_plans'),
    DB.allActive('lubrication_records')
  ]);
  return Promise.all(equipos.map(async e => ({ e, s: await statusFor(e, plans, records) })));
}

const STATUS_COLOR = { VERDE: 'var(--green)', AMARILLO: 'var(--amber)', ROJO: 'var(--red)', GRIS: 'var(--gray-status)' };
const STATUS_ICON = { VERDE: '●', AMARILLO: '●', ROJO: '●', GRIS: '●' };

/* ---------- tema visual (color de acento + modo claro/oscuro) ---------- */
const THEMES = [
  { id: 'amber', label: 'Ámbar CAT', color: '#F2A900' },
  { id: 'blue', label: 'Azul Acero', color: '#3B82F6' },
  { id: 'green', label: 'Verde Mina', color: '#22C55E' },
  { id: 'red', label: 'Rojo Alerta', color: '#EF4444' },
  { id: 'graphite', label: 'Grafito', color: '#9CA3AF' }
];

function getTheme() {
  try { return Object.assign({ accent: 'amber', mode: 'dark' }, JSON.parse(localStorage.getItem('engrase_theme')) || {}); }
  catch { return { accent: 'amber', mode: 'dark' }; }
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme.accent);
  document.documentElement.setAttribute('data-mode', theme.mode);
}
function saveTheme(theme) { localStorage.setItem('engrase_theme', JSON.stringify(theme)); applyTheme(theme); }

// Aplicar de inmediato (antes de pintar la interfaz) para evitar parpadeo de color
applyTheme(getTheme());

function themeButtonHTML(extraClass = '') {
  return `<button type="button" class="icon-btn theme-btn ${extraClass}" id="btn-theme" title="Cambiar colores">🎨</button>`;
}

function openThemePicker() {
  const t = getTheme();
  openModal('Personalizar colores', `
    <p class="dim">Elige el color de acento de la app y si prefieres modo oscuro (recomendado en campo/de noche) o modo claro. El cambio se guarda en este dispositivo.</p>
    <div class="theme-swatches">
      ${THEMES.map(th => `
        <button type="button" class="theme-swatch ${th.id === t.accent ? 'selected' : ''}" data-accent="${th.id}" style="--sw:${th.color}">
          <span class="theme-swatch-dot"></span>${th.label}
        </button>`).join('')}
    </div>
    <div class="theme-mode-toggle">
      <button type="button" class="btn theme-mode-btn ${t.mode === 'dark' ? 'btn-accent' : ''}" data-mode="dark">🌙 Modo oscuro</button>
      <button type="button" class="btn theme-mode-btn ${t.mode === 'light' ? 'btn-accent' : ''}" data-mode="light">☀ Modo claro</button>
      <button type="button" class="btn theme-mode-btn ${t.mode === 'contrast' ? 'btn-accent' : ''}" data-mode="contrast">◐ Alto contraste (sol)</button>
    </div>
    <p class="dim" style="margin-top:10px">"Alto contraste" usa blanco y negro puro con bordes gruesos — pensado para leer la pantalla bajo sol directo en campo.</p>
  `);
  $$('.theme-swatch').forEach(b => b.addEventListener('click', () => {
    const cur = getTheme(); cur.accent = b.dataset.accent; saveTheme(cur);
    $$('.theme-swatch').forEach(x => x.classList.remove('selected'));
    b.classList.add('selected');
  }));
  $$('.theme-mode-btn').forEach(b => b.addEventListener('click', () => {
    const cur = getTheme(); cur.mode = b.dataset.mode; saveTheme(cur);
    $$('.theme-mode-btn').forEach(x => x.classList.remove('btn-accent'));
    b.classList.add('btn-accent');
  }));
}

/* ---------- arranque ---------- */
window.addEventListener('DOMContentLoaded', async () => {
  await DB.init();
  await loadGeneralSettings();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  window.addEventListener('online', updateConnBadge);
  window.addEventListener('offline', updateConnBadge);
  Sync.onChange(onSyncStateChange);
  wirePushListeners();
  Sync.startAuto();
  updateConnBadge();

  const saved = sessionStorage.getItem('engrase_user');
  if (saved) {
    App.currentUser = JSON.parse(saved);
    boot();
  } else {
    renderLogin();
  }
});

let lastSyncState = { status: 'idle' };
function onSyncStateChange(state) {
  lastSyncState = state;
  updateConnBadge();
  // Si el usuario está viendo el turno/dashboard, refresca datos que pudieron llegar del servidor
  if (state.status === 'ok' && (state.pulled > 0) && ['turno', 'dashboard', 'equipos'].includes(App.route)) {
    navigate(App.route);
  }
  if (state.status === 'ok' && state.newAnomalies && state.newAnomalies.length) {
    notifyNewAnomalies(state.newAnomalies);
  }
}

/* ---------- Aviso de anomalías nuevas reportadas por otros (al sincronizar) ---------- */
function getNotifiedAnomalyIds() {
  try { return new Set(JSON.parse(localStorage.getItem('engrase_notified_anomalies') || '[]')); }
  catch (e) { return new Set(); }
}
function markAnomalyNotified(id) {
  try {
    const seen = Array.from(getNotifiedAnomalyIds());
    seen.push(id);
    localStorage.setItem('engrase_notified_anomalies', JSON.stringify(seen.slice(-300)));
  } catch (e) { /* localStorage no disponible */ }
}

async function notifyNewAnomalies(anomalies) {
  if (!App.currentUser) return;
  const seen = getNotifiedAnomalyIds();
  const relevantRoles = ['ADMINISTRADOR', 'SUPERVISOR', 'PLANIFICADOR'];
  const isRelevantRole = relevantRoles.includes(App.currentUser.role);
  const equipos = isRelevantRole ? await DB.allActive('equipment') : [];

  for (const a of anomalies) {
    if (seen.has(a.id)) continue;
    markAnomalyNotified(a.id);
    if (a.createdBy === App.currentUser.name) continue; // no avisarle a quien la reportó
    if (!isRelevantRole) continue; // por ahora solo Admin/Supervisor/Planificador reciben el aviso, para no saturar a los lubricadores

    const eq = equipos.find(e => e.id === a.equipmentId);
    const title = a.criticality === 'Crítica' || a.criticality === 'Alta' ? '⚠ Anomalía crítica reportada' : 'Nueva anomalía reportada';
    const body = `${eq ? eq.code : 'Equipo'} · ${a.component} · Reportado por ${a.createdBy}`;

    const LN = window.Capacitor?.Plugins?.LocalNotifications;
    if (LN) {
      try {
        const perm = await LN.checkPermissions();
        if (perm.display === 'granted') {
          await LN.schedule({ notifications: [{
            id: Math.floor(Math.random() * 1000000) + 2000,
            title, body, schedule: { at: new Date(Date.now() + 500) }
          }] });
        }
      } catch (e) { /* no disponible en esta plataforma */ }
    }
    showInAppToast(`${title}: ${body}`);
  }
}

function showInAppToast(text) {
  let box = $('#toast-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast-box';
    document.body.appendChild(box);
  }
  const toast = document.createElement('div');
  toast.className = 'app-toast';
  toast.textContent = text;
  box.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

function updateConnBadge() {
  const b = $('#conn-badge');
  if (!b) return;
  if (!navigator.onLine) {
    b.textContent = 'SIN INTERNET · GUARDANDO LOCAL';
    b.className = 'conn-badge conn-off';
    return;
  }
  if (lastSyncState.status === 'unconfigured') {
    b.textContent = 'SOLO LOCAL · SIN SERVIDOR CONFIGURADO';
    b.className = 'conn-badge conn-warn';
  } else if (lastSyncState.status === 'syncing') {
    b.textContent = 'SINCRONIZANDO…';
    b.className = 'conn-badge conn-warn';
  } else if (lastSyncState.status === 'error') {
    b.textContent = 'ERROR DE SINCRONIZACIÓN';
    b.className = 'conn-badge conn-off';
  } else {
    b.textContent = 'SINCRONIZADO';
    b.className = 'conn-badge conn-ok';
  }
}

/* ---------- login ---------- */
async function renderLogin() {
  const users = await DB.allActive('users');
  const ROLE_ICON = { ADMINISTRADOR: '🛠️', PLANIFICADOR: '🗓️', SUPERVISOR: '👷', LUBRICADOR: '🛢️', VISOR: '👁️' };
  document.body.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        ${themeButtonHTML('login-theme-btn')}
        <div class="brand brand-login">
          <div class="brand-mark"></div>
          <div>
            <div class="brand-title">CONTROL DE ENGRASE</div>
            <div class="brand-sub">OPEN PIT · GESTIÓN DE LUBRICACIÓN</div>
          </div>
        </div>
        <p class="login-hint">Selecciona tu usuario e ingresa tu PIN para continuar.</p>
        <div id="login-users" class="login-users">
          ${users.map(u => `
            <button class="login-user" data-id="${u.id}">
              <span class="login-user-icon">${ROLE_ICON[u.role] || '👤'}</span>
              <span class="login-user-info">
                <span class="login-name">${u.name}</span>
                <span class="login-role">${u.role}</span>
              </span>
              <span class="login-chevron">›</span>
            </button>`).join('')}
        </div>
        <div id="pin-area" class="pin-area hidden">
          <input id="pin-input" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="4" placeholder="• • • •" />
          <button id="pin-submit" class="btn btn-accent">Ingresar</button>
        </div>
        <div id="login-error" class="login-error"></div>
        <div class="login-footer">Funciona sin conexión · los datos se sincronizan al recuperar internet</div>
      </div>
    </div>`;

  $('#btn-theme').addEventListener('click', openThemePicker);

  let selected = null;
  $$('.login-user').forEach(btn => {
    btn.addEventListener('click', () => {
      selected = users.find(u => u.id === btn.dataset.id);
      $$('.login-user').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      $('#pin-area').classList.remove('hidden');
      $('#pin-input').value = '';
      $('#pin-input').focus();
    });
  });
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS = 5 * 60 * 1000;

  function getLoginAttempts(userId) {
    try { return (JSON.parse(localStorage.getItem('engrase_login_attempts') || '{}'))[userId] || { count: 0, lockedUntil: 0 }; }
    catch (e) { return { count: 0, lockedUntil: 0 }; }
  }
  function setLoginAttempts(userId, data) {
    try {
      const all = JSON.parse(localStorage.getItem('engrase_login_attempts') || '{}');
      all[userId] = data;
      localStorage.setItem('engrase_login_attempts', JSON.stringify(all));
    } catch (e) { /* localStorage no disponible */ }
  }

  const doLogin = () => {
    const pin = $('#pin-input').value.trim();
    if (!selected) return;

    const attempts = getLoginAttempts(selected.id);
    if (attempts.lockedUntil > Date.now()) {
      const mins = Math.ceil((attempts.lockedUntil - Date.now()) / 60000);
      $('#login-error').textContent = `Demasiados intentos fallidos. Intenta de nuevo en ${mins} minuto(s).`;
      return;
    }

    if (pin === selected.pin) {
      setLoginAttempts(selected.id, { count: 0, lockedUntil: 0 });
      App.currentUser = { id: selected.id, name: selected.name, role: selected.role };
      sessionStorage.setItem('engrase_user', JSON.stringify(App.currentUser));
      boot();
    } else {
      const newCount = attempts.count + 1;
      if (newCount >= MAX_ATTEMPTS) {
        setLoginAttempts(selected.id, { count: 0, lockedUntil: Date.now() + LOCKOUT_MS });
        $('#login-error').textContent = `Demasiados intentos fallidos. Cuenta bloqueada por 5 minutos.`;
        logAudit('LOGIN_BLOQUEADO', `${selected.username} (${MAX_ATTEMPTS} intentos fallidos)`, 'sistema');
      } else {
        setLoginAttempts(selected.id, { count: newCount, lockedUntil: 0 });
        $('#login-error').textContent = `PIN incorrecto. Te quedan ${MAX_ATTEMPTS - newCount} intento(s).`;
      }
    }
  };
  $('#pin-submit').addEventListener('click', doLogin);
  $('#pin-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
}

function logout() {
  clearAppBadge();
  disablePushForCurrentUser();
  sessionStorage.removeItem('engrase_user');
  App.currentUser = null;
  renderLogin();
}

/* ---------- shell principal ---------- */
const MENU = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'equipos', label: 'Equipos', icon: 'truck' },
  { id: 'plan', label: 'Plan de Engrase', icon: 'list' },
  { id: 'turno', label: 'Engrase del Turno', icon: 'clock' },
  { id: 'registrar', label: 'Registrar Engrase', icon: 'check' },
  { id: 'horometros', label: 'Actualizar Horómetros', icon: 'gauge' },
  { id: 'anomalias', label: 'Anomalías', icon: 'alert' },
  { id: 'lubricantes', label: 'Lubricantes', icon: 'drop' },
  { id: 'historial', label: 'Historial', icon: 'history' },
  { id: 'reportes', label: 'Reportes', icon: 'report' },
  { id: 'usuarios', label: 'Usuarios', icon: 'users' },
  { id: 'config', label: 'Configuración', icon: 'gear' },
  { id: 'ayuda', label: 'Ayuda', icon: 'help' },
];

function boot() {
  Sync.fullSync();
  refreshLocalNotifications();
  refreshAppBadge();
  // Nota: las notificaciones push (initPushNotifications) YA NO se activan solas aquí.
  // Necesitan un proyecto de Firebase configurado (google-services.json en el proyecto
  // Android) — si se llaman sin eso, la app se cierra de golpe. Ahora solo se activan
  // cuando el Administrador las prende a propósito desde Configuración → Notificaciones push,
  // una vez que Firebase ya está listo.
  if (App.currentUser.role === 'LUBRICADOR') { bootLubricador(); return; }
  const allowed = PERMISSIONS[App.currentUser.role] || [];
  document.body.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand brand-sidebar">
          <div class="brand-mark small"></div>
          <div>
            <div class="brand-title small">ENGRASE</div>
            <div class="brand-sub small">OPEN PIT</div>
          </div>
        </div>
        <nav class="menu">
          ${MENU.filter(m => allowed.includes(m.id)).map(m => `
            <button class="menu-item" data-route="${m.id}">
              <span class="menu-icon icon-${m.icon}"></span>
              <span>${m.label}</span>
            </button>`).join('')}
        </nav>
        <button class="menu-item logout" id="btn-logout">
          <span class="menu-icon icon-logout"></span><span>Cerrar sesión</span>
        </button>
      </aside>

      <div class="main">
        <header class="topbar">
          <button id="btn-menu-toggle" class="icon-btn only-mobile">☰</button>
          <div class="topbar-title" id="topbar-title">Dashboard</div>
          <div class="topbar-right">
            ${themeButtonHTML()}
            <span id="conn-badge" class="conn-badge"></span>
            <span class="topbar-shift" id="topbar-shift"></span>
            <span class="topbar-user">${App.currentUser.name} · ${App.currentUser.role}</span>
          </div>
        </header>
        <main id="app-content" class="app-content"></main>
      </div>

      <nav class="bottom-nav only-mobile">
        ${MENU.filter(m => allowed.includes(m.id)).slice(0, 5).map(m => `
          <button class="bottom-item" data-route="${m.id}">
            <span class="menu-icon icon-${m.icon}"></span>
            <span>${m.label.split(' ')[0]}</span>
          </button>`).join('')}
      </nav>
    </div>`;

  updateConnBadge();
  updateShiftBadge();
  setInterval(updateShiftBadge, 60000);

  $$('.menu-item[data-route], .bottom-item[data-route]').forEach(b => {
    b.addEventListener('click', () => navigate(b.dataset.route));
  });
  $('#btn-logout').addEventListener('click', logout);
  $('#btn-theme').addEventListener('click', openThemePicker);
  const toggle = $('#btn-menu-toggle');
  if (toggle) toggle.addEventListener('click', () => $('#sidebar').classList.toggle('open'));

  navigate(allowed.includes('dashboard') ? 'dashboard' : allowed[0]);
  handleQrDeepLink();
}

function updateShiftBadge() {
  const el = $('#topbar-shift');
  if (!el) return;
  const isDay = currentShiftId() === 'shift_dia';
  el.textContent = isDay ? '☀ Turno Día' : '☾ Turno Noche';
}

function navigate(route) {
  App.route = route;
  $$('.menu-item[data-route], .bottom-item[data-route]').forEach(b => {
    b.classList.toggle('active', b.dataset.route === route);
  });
  const item = MENU.find(m => m.id === route);
  $('#topbar-title').textContent = item ? item.label : '';
  $('#sidebar')?.classList.remove('open');
  const renderers = {
    dashboard: renderDashboard, equipos: renderEquipos, plan: renderPlan,
    turno: renderTurno, registrar: renderRegistrar, horometros: renderHorometros,
    anomalias: renderAnomalias, lubricantes: renderLubricantes, historial: renderHistorial,
    reportes: renderReportes, usuarios: renderUsuarios, config: renderConfig, ayuda: renderAyuda
  };
  Promise.resolve((renderers[route] || renderDashboard)()).then(() => makeTablesResponsive($('#app-content')));
}

// Convierte cualquier <table class="data-table"> en tarjetas apiladas en pantallas angostas,
// copiando el texto de cada encabezado <th> a un atributo data-label en su columna. Así no
// hay que tocar cada pantalla una por una — se aplica solo con volver a llamar esta función.
function makeTablesResponsive(container) {
  if (!container) return;
  $$('table.data-table', container).forEach(table => {
    const headers = $$('thead th', table).map(th => th.textContent.trim());
    $$('tbody tr', table).forEach(tr => {
      $$('td', tr).forEach((td, i) => {
        if (headers[i] !== undefined) td.setAttribute('data-label', headers[i]);
      });
    });
  });
}

/* ============================================================
   INTERFAZ SIMPLIFICADA PARA LUBRICADOR (móvil, un toque)
   ============================================================ */
function bootLubricador() {
  document.body.innerHTML = `
    <div class="lub-shell">
      <header class="lub-topbar">
        <div class="brand brand-sidebar">
          <div class="brand-mark small"></div>
          <div>
            <div class="brand-title small">ENGRASE</div>
            <div class="brand-sub small">OPEN PIT</div>
          </div>
        </div>
        <div class="lub-topbar-right">
          ${themeButtonHTML()}
          <span id="conn-badge" class="conn-badge"></span>
          <button class="icon-btn" id="btn-logout" title="Cerrar sesión">⏻</button>
        </div>
      </header>
      <div class="lub-user-strip">👤 ${App.currentUser.name} · <span id="lub-shift"></span></div>
      <main id="app-content" class="lub-content"></main>
      <nav class="lub-bottom-nav">
        <button class="lub-nav-item active" data-route="turno"><span class="menu-icon icon-clock"></span><span>Mi Turno</span></button>
        <button class="lub-nav-item" data-route="anomalias"><span class="menu-icon icon-alert"></span><span>Anomalías</span></button>
        <button class="lub-nav-item" data-route="historial"><span class="menu-icon icon-history"></span><span>Mis Engrases</span></button>
        <button class="lub-nav-item" data-route="ayuda"><span class="menu-icon icon-help"></span><span>Ayuda</span></button>
      </nav>
    </div>`;

  updateConnBadge();
  const shiftLabel = () => { $('#lub-shift').textContent = currentShiftId() === 'shift_dia' ? '☀ Turno Día' : '☾ Turno Noche'; };
  shiftLabel();
  setInterval(shiftLabel, 60000);

  $('#btn-logout').addEventListener('click', logout);
  $('#btn-theme').addEventListener('click', openThemePicker);
  $$('.lub-nav-item').forEach(b => b.addEventListener('click', () => {
    $$('.lub-nav-item').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    App.route = b.dataset.route;
    if (b.dataset.route === 'turno') renderLubricadorHome();
    else if (b.dataset.route === 'anomalias') renderAnomalias();
    else if (b.dataset.route === 'historial') renderLubricadorHistorial();
    else renderAyuda();
  }));

  App.route = 'turno';
  renderLubricadorHome();
  handleQrDeepLink();
}

async function renderLubricadorHome() {
  const c = $('#app-content');
  c.innerHTML = `<div class="loading">Cargando tu turno…</div>`;
  const equipos = await DB.allActive('equipment');
  const locations = await DB.allActive('locations');
  const shift = currentShiftId();
  const myCuadrilla = App.currentUser.cuadrillaId;

  // Si el equipo tiene cuadrilla asignada, solo se lo mostramos a lubricadores de esa
  // misma cuadrilla (para que dos cuadrillas no engrasen el mismo equipo). Los equipos
  // sin cuadrilla asignada se muestran a todos, para no dejar nada fuera de la vista.
  const equiposTurno = equipos.filter(e => e.shiftId === shift && (!e.cuadrillaId || e.cuadrillaId === myCuadrilla));
  const statuses = await computeAllStatuses(equiposTurno);
  const order = { ROJO: 0, AMARILLO: 1, VERDE: 2, GRIS: 3 };
  statuses.sort((a, b) => order[a.s.code] - order[b.s.code]);

  const cuadrillas = await DB.allActive('cuadrillas');
  const myCuadrillaName = (cuadrillas.find(cq => cq.id === myCuadrilla) || {}).name;

  c.innerHTML = `
    <div class="lub-header-row">
      <div>
        <h2 class="lub-heading">Equipos del turno ${shift === 'shift_dia' ? 'Día' : 'Noche'}</h2>
        <p class="lub-sub">Toca un equipo para registrar el engrase.${myCuadrillaName ? ' · ' + myCuadrillaName : ''}</p>
      </div>
      <button class="btn btn-accent lub-scan-btn" id="lub-scan-qr">${ic("qr")}Escanear QR</button>
    </div>
    ${await recentEquiposHTML()}
    <div class="lub-eq-list">
      ${statuses.map(({ e, s }) => `
        <button class="lub-eq-btn" data-status="${s.code}" data-id="${e.id}">
          <div class="lub-eq-top">
            <span class="lub-eq-code">${e.code}</span>
            <span class="status-chip" style="--c:${STATUS_COLOR[s.code]}">${s.label}</span>
          </div>
          <div class="lub-eq-model">${e.brand} ${e.model}</div>
          <div class="lub-eq-location">📍 ${(locations.find(l => l.id === e.locationId) || {}).name || 'Sin ubicación'}</div>
          <div class="lub-eq-bottom">
            <span class="mono">${fmt(e.hourmeter)} h</span>
            ${s.remaining !== undefined && s.remaining !== null ? `<span class="mono" style="color:${STATUS_COLOR[s.code]}">${s.remaining < 0 ? fmt(Math.abs(s.remaining)) + ' h atraso' : fmt(s.remaining) + ' h restante'}</span>` : ''}
          </div>
        </button>`).join('') || `<div class="empty-state">No hay equipos asignados a este turno${myCuadrillaName ? ' para ' + myCuadrillaName : ''}.</div>`}
    </div>
    <button class="lub-anomaly-fab" id="lub-fab-anomaly">${ic("alert")}Reportar anomalía</button>
    ${colorLegendHTML()}
  `;
  $$('.lub-eq-btn', c).forEach(b => b.addEventListener('click', () => startLubricadorGreaseFlow(b.dataset.id)));
  $('#lub-fab-anomaly').addEventListener('click', () => openAnomalyForm());
  $('#lub-scan-qr').addEventListener('click', () => openQrScanner());
  $$('.recents-chip', c).forEach(b => b.addEventListener('click', () => startLubricadorGreaseFlow(b.dataset.recentId)));
}

async function startLubricadorGreaseFlow(equipmentId) {
  const c = $('#app-content');
  c.innerHTML = `<button class="btn lub-back" id="lub-back">← Volver a mi turno</button><div id="lub-flow"></div>`;
  $('#lub-back').addEventListener('click', renderLubricadorHome);
  await startGreaseFlow(equipmentId, $('#lub-flow'));
}

async function renderLubricadorHistorial() {
  const c = $('#app-content');
  const records = (await DB.allActive('lubrication_records'))
    .filter(r => r.userId === App.currentUser.id)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 30);
  const equipos = await DB.allActive('equipment');
  const todayStr = new Date().toDateString();
  c.innerHTML = `
    <h2 class="lub-heading">Mis últimos engrases</h2>
    <div class="lub-record-list">
      ${records.map(r => {
        const eq = equipos.find(e => e.id === r.equipmentId);
        const editable = new Date(r.date).toDateString() === todayStr;
        return `<div class="lub-record-card">
          <div class="lub-eq-top"><span class="lub-eq-code">${eq ? eq.code : '—'}</span><span class="dim">${fmtDate(r.date)}</span></div>
          <div class="lub-eq-model">${eq ? eq.brand + ' ' + eq.model : ''}</div>
          <div class="lub-eq-bottom"><span class="mono">${fmt(r.hourmeter)} h</span><span>${r.condition}</span></div>
          ${editable ? `<button class="btn btn-sm lub-edit-record" data-id="${r.id}" style="margin-top:8px; width:100%">✏ Editar este engrase</button>` : `<div class="dim" style="margin-top:6px; font-size:11px">Solo se puede editar el mismo día que se registró.</div>`}
        </div>`;
      }).join('') || `<div class="empty-state">Aún no has registrado engrases.</div>`}
    </div>`;
  $$('.lub-edit-record', c).forEach(btn => {
    btn.addEventListener('click', async () => openEditGreaseRecordForm(await DB.get('lubrication_records', btn.dataset.id)));
  });
}

/* ---------- Editar un engrase ya registrado (mismo día, para corregir errores) ---------- */
async function openEditGreaseRecordForm(record) {
  const equipment = await DB.get('equipment', record.equipmentId);
  const allRecords = (await DB.allActive('lubrication_records')).filter(r => r.equipmentId === record.equipmentId).sort((a, b) => new Date(b.date) - new Date(a.date));
  const isLatest = allRecords.length && allRecords[0].id === record.id;
  const lubricants = await DB.allActive('lubricants');
  const plan = (await DB.allActive('lubrication_plans')).find(p => p.equipmentId === record.equipmentId);
  const details = record.details || [];

  openModal(`Editar engrase · ${equipment.code}`, `
    <p class="dim">Registrado el ${fmtDate(record.date)} por ${record.userName}. ${isLatest
      ? 'Este es el registro más reciente de este equipo — si cambias el horómetro, también se actualiza el horómetro actual del equipo.'
      : 'Este NO es el registro más reciente de este equipo — cambiar el horómetro aquí solo corrige este registro histórico, no toca el horómetro actual del equipo.'}</p>
    <form id="edit-grease-form">
      <div class="form-grid">
        <label class="span-2">Horómetro<input required type="number" step="0.1" name="hourmeter" value="${record.hourmeter}" class="big-input"/></label>
        <label>Tipo de grasa
          <select name="greaseType">${lubricants.map(l => `<option value="${l.id}" ${l.id === record.greaseType ? 'selected' : ''}>${l.name}</option>`).join('')}</select>
        </label>
        <label>Cantidad (kg)<input type="number" step="0.1" name="qty" value="${record.qty}"/></label>
      </div>
      ${details.length ? `
      <div class="checklist-head"><h4>Checklist</h4></div>
      <div id="edit-checklist">
        ${details.map((d, i) => `
          <div class="checklist-item" data-idx="${i}">
            <label class="check-row">
              <input type="checkbox" class="chk-done" ${d.done ? 'checked' : ''}/>
              <span class="check-row-text">${d.pointName}</span>
              <span class="check-row-mark">✓</span>
            </label>
            <select class="chk-reason ${d.done ? 'hidden' : ''}">
              <option value="">¿Por qué no se realizó?</option>
              ${['Punto inaccesible', 'Grasera dañada', 'Línea de engrase obstruida', 'Equipo trabajando', 'Equipo detenido', 'Falta de lubricante', 'Falla mecánica', 'Otro'].map(o => `<option ${d.reason === o ? 'selected' : ''}>${o}</option>`).join('')}
            </select>
          </div>`).join('')}
      </div>` : ''}
      <div class="form-grid" style="margin-top:14px">
        <label>Condición encontrada
          <select name="condition">${['Normal', 'Con desgaste', 'Requiere atención'].map(o => `<option ${o === record.condition ? 'selected' : ''}>${o}</option>`).join('')}</select>
        </label>
        <label class="span-2">Observaciones<textarea name="notes" rows="2">${record.notes || ''}</textarea></label>
        ${photoFieldHTML()}
      </div>
      <div class="modal-actions"><button type="submit" class="btn btn-accent">${ic("save")}Guardar cambios</button></div>
    </form>
  `);

  if (record.photo) {
    const preview = $('.photo-preview');
    // Muestra la foto ya guardada como referencia (se reemplaza solo si eligen una nueva)
    const wrap = document.createElement('div');
    wrap.className = 'pt-current-photo';
    wrap.innerHTML = `Foto actual: ${photoThumbHTML(record.photo, equipment.code)}`;
    $('#edit-grease-form').querySelector('.photo-field-web, .photo-field-native')?.before(wrap);
    wirePhotoThumbs($('#edit-grease-form'));
  }
  wirePhotoField($('#edit-grease-form'));
  $$('.chk-done', $('#edit-checklist')).forEach(chk => {
    chk.addEventListener('change', (e) => {
      e.target.closest('.checklist-item').querySelector('.chk-reason').classList.toggle('hidden', e.target.checked);
    });
  });

  $('#edit-grease-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    const newHourmeter = parseFloat(fd.hourmeter);
    if (isLatest && !confirmHourmeterChange(equipment.hourmeter, newHourmeter)) return;

    const newDetails = $$('.checklist-item', $('#edit-checklist')).map((item, i) => ({
      pointId: details[i].pointId, pointName: details[i].pointName,
      done: item.querySelector('.chk-done').checked,
      reason: item.querySelector('.chk-reason').value || null
    }));
    const newPhoto = await getSelectedPhotoDataURL(ev.target);

    record.hourmeter = newHourmeter;
    record.greaseType = fd.greaseType;
    record.qty = parseFloat(fd.qty || 0);
    record.condition = fd.condition;
    record.notes = fd.notes;
    if (details.length) record.details = newDetails;
    if (newPhoto) record.photo = newPhoto;
    await DB.put('lubrication_records', stamp(record, App.currentUser.name));

    if (isLatest) {
      equipment.hourmeter = newHourmeter;
      await DB.put('equipment', stamp(equipment, App.currentUser.name));
      if (plan) { plan.lastGreaseHour = newHourmeter; await DB.put('lubrication_plans', stamp(plan, App.currentUser.name)); }
    }
    await logAudit('ENGRASE_EDITADO', `${equipment.code} · registro del ${fmtDate(record.date)}`, App.currentUser.name);
    closeModal();
    renderLubricadorHistorial();
  });
}

/* ============================================================
   DASHBOARD
   ============================================================ */
async function renderDashboard() {
  const c = $('#app-content');
  c.innerHTML = `<div class="loading">Calculando indicadores…</div>`;
  const equipos = await DB.allActive('equipment');
  const records = await DB.allActive('lubrication_records');
  const anomalies = await DB.allActive('anomalies');

  const statuses = await computeAllStatuses(equipos);
  const counts = { VERDE: 0, AMARILLO: 0, ROJO: 0, GRIS: 0 };
  statuses.forEach(x => counts[x.s.code]++);

  const today = new Date().toDateString();
  const doneToday = records.filter(r => new Date(r.createdAt).toDateString() === today).length;
  const openAnomalies = anomalies.filter(a => a.status !== 'Cerrada').length;

  const compliance = equipos.length ? Math.round(((counts.VERDE + counts.AMARILLO) / equipos.length) * 100) : 0;

  const attention = statuses
    .filter(x => x.s.code === 'ROJO' || x.s.code === 'AMARILLO')
    .sort((a, b) => (a.s.remaining ?? 0) - (b.s.remaining ?? 0));

  const allowedRoutes = PERMISSIONS[App.currentUser.role] || [];
  c.innerHTML = `
    <div class="kpi-grid">
      ${kpiCard('TOTAL EQUIPOS', equipos.length, 'neutral', allowedRoutes.includes('equipos') ? 'equipos' : null)}
      ${kpiCard('AL DÍA', counts.VERDE, 'green', allowedRoutes.includes('equipos') ? 'equipos' : null)}
      ${kpiCard('PRÓXIMOS A ENGRASE', counts.AMARILLO, 'amber', 'attention')}
      ${kpiCard('ENGRASE VENCIDO', counts.ROJO, 'red', 'attention')}
      ${kpiCard('REALIZADOS HOY', doneToday, 'neutral', allowedRoutes.includes('historial') ? 'historial' : null)}
      ${kpiCard('ANOMALÍAS ABIERTAS', openAnomalies, 'amber', allowedRoutes.includes('anomalias') ? 'anomalias' : null)}
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Cumplimiento de engrase</h3>
        <span class="pill">${compliance}% · objetivo ≥ ${App.generalSettings.complianceTarget}%</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${compliance}%; background:${compliance >= App.generalSettings.complianceTarget ? 'var(--green)' : compliance >= 80 ? 'var(--amber)' : 'var(--red)'}"></div></div>
    </div>

    <div class="panel" id="dash-attention-panel">
      <div class="panel-head"><h3>Equipos que requieren atención</h3></div>
      ${attention.length === 0 ? `<div class="empty-state">Todos los equipos están al día.</div>` : `
      <table class="data-table">
        <thead><tr><th>Estado</th><th>Código</th><th>Equipo</th><th>Horómetro</th><th>Próximo</th><th>Restante</th></tr></thead>
        <tbody>
          ${attention.map(x => `
            <tr>
              <td><span class="dot" style="background:${STATUS_COLOR[x.s.code]}"></span> ${x.s.label}</td>
              <td class="mono">${x.e.code}</td>
              <td>${x.e.brand} ${x.e.model}</td>
              <td class="mono">${fmt(x.e.hourmeter)} h</td>
              <td class="mono">${x.s.nextHour !== undefined ? fmt(x.s.nextHour) + ' h' : '—'}</td>
              <td class="mono" style="color:${STATUS_COLOR[x.s.code]}">${x.s.remaining !== undefined && x.s.remaining !== null ? (x.s.remaining < 0 ? '+' + fmt(Math.abs(x.s.remaining)) + ' h atraso' : fmt(x.s.remaining) + ' h') : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`}
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Semáforo de equipos</h3></div>
      <div class="cards-grid">
        ${statuses.map(x => equipmentCard(x.e, x.s, anomalies.filter(a => a.equipmentId === x.e.id && a.status !== 'Cerrada'))).join('')}
      </div>
    </div>
    ${colorLegendHTML()}
  `;

  $$('.kpi-clickable', c).forEach(card => {
    card.addEventListener('click', () => {
      const action = card.dataset.kpiAction;
      if (action === 'attention') {
        $('#dash-attention-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (action === 'anomalias') {
        navigate('anomalias');
      } else if (action === 'equipos') {
        navigate('equipos');
      } else if (action === 'historial') {
        navigate('historial');
      }
    });
  });
}

function colorLegendHTML() {
  return `
    <div class="color-legend">
      <span class="color-legend-item"><span class="dot" style="background:var(--green)"></span>Verde — al día</span>
      <span class="color-legend-item"><span class="dot" style="background:var(--amber)"></span>Amarillo — próximo a vencer</span>
      <span class="color-legend-item"><span class="dot" style="background:var(--red)"></span>Rojo — vencido</span>
      <span class="color-legend-item"><span class="dot" style="background:var(--gray-status)"></span>Gris — detenido o sin plan</span>
    </div>`;
}

function kpiCard(label, value, tone, action) {
  return `<div class="kpi-card tone-${tone} ${action ? 'kpi-clickable' : ''}" ${action ? `data-kpi-action="${action}"` : ''}>
    <div class="kpi-value">${fmt(value)}</div>
    <div class="kpi-label">${label}</div>
  </div>`;
}

function equipmentCard(e, s, equipmentAnomalies) {
  const anomalies = equipmentAnomalies || [];
  const criticas = anomalies.filter(a => a.criticality === 'Crítica' || a.criticality === 'Alta').length;
  return `<div class="eq-card" data-status="${s.code}">
    <div class="eq-card-head">
      <span class="eq-code">${e.code}</span>
      <span class="status-chip" style="--c:${STATUS_COLOR[s.code]}">${s.label}</span>
    </div>
    ${anomalies.length ? `<div class="eq-anomaly-badge ${criticas ? 'critical' : ''}">⚠ ${anomalies.length} anomalía${anomalies.length > 1 ? 's' : ''} abierta${anomalies.length > 1 ? 's' : ''}${criticas ? ' · crítica' : ''}</div>` : ''}
    <div class="eq-name">${e.brand} ${e.model}</div>
    <div class="eq-hourmeter">${fmt(e.hourmeter)}<span class="unit"> h</span></div>
    ${s.nextHour !== undefined ? `
    <div class="eq-detail-row"><span>Próximo engrase</span><span class="mono">${fmt(s.nextHour)} h</span></div>
    <div class="eq-detail-row"><span>${s.remaining < 0 ? 'Atraso' : 'Restante'}</span><span class="mono" style="color:${STATUS_COLOR[s.code]}">${fmt(Math.abs(s.remaining))} h</span></div>
    ` : s.scheduleDate ? `
    <div class="eq-detail-row"><span>Control</span><span>Por día/turno</span></div>
    <div class="eq-detail-row"><span>Día asignado</span><span>${WEEKDAY_NAMES[s.scheduleDate.getDay()]}</span></div>
    ` : `<div class="eq-detail-row"><span>Sin plan de engrase configurado</span></div>`}
  </div>`;
}

/* ============================================================
   EQUIPOS
   ============================================================ */
async function renderEquipos() {
  const c = $('#app-content');
  const equipos = await DB.allActive('equipment');
  const types = await DB.allActive('equipment_types');
  const locations = await DB.allActive('locations');
  const plans = await DB.allActive('lubrication_plans');
  const points = await DB.allActive('lubrication_points');
  const canEdit = App.currentUser.role === 'ADMINISTRADOR';
  let bulkMode = false;
  const selected = new Set();

  // Índice de búsqueda por equipo: código, ahorrativo, marca/modelo, ubicación y sus
  // puntos de engrase configurados — así "grasera dañada" o "articulación" también encuentra el equipo.
  const searchIndex = new Map();
  equipos.forEach(e => {
    const plan = plans.find(p => p.equipmentId === e.id);
    const eqPoints = plan ? points.filter(p => p.planId === plan.id).map(p => p.point) : [];
    const locName = (locations.find(l => l.id === e.locationId) || {}).name || '';
    searchIndex.set(e.id, [e.code, e.shortCode, e.brand, e.model, e.description, locName, ...eqPoints].join(' ').toLowerCase());
  });

  c.innerHTML = `
    <div class="toolbar">
      <input id="eq-search" class="input input-search" placeholder="Buscar por código, ubicación, punto de engrase…" />
      ${canEdit ? `<button class="btn btn-accent" id="eq-new">${ic("plus")}Nuevo equipo</button>` : ''}
      ${canEdit ? `<button class="btn" id="eq-import">${ic("upload")}Importar desde Excel</button>` : ''}
      ${canEdit ? `<button class="btn" id="eq-bulk-toggle">${ic("edit")}Editar en lote</button>` : ''}
      ${canEdit ? `<button class="btn" id="eq-print-all-qr">${ic("print")}Imprimir QR de todos</button>` : ''}
      <input type="file" id="eq-import-file" accept=".xlsx,.xls,.csv" class="hidden"/>
    </div>
    <div id="eq-bulk-bar" class="bulk-bar hidden">
      <span id="eq-bulk-count">0 seleccionados</span>
      <button class="btn btn-sm btn-accent" id="eq-bulk-apply">Editar en lote</button>
      <button class="btn btn-sm btn-danger" id="eq-bulk-delete">Eliminar seleccionados</button>
      <button class="btn btn-sm" id="eq-bulk-cancel">Cancelar</button>
    </div>
    <div id="eq-recents"></div>
    <div class="cards-grid" id="eq-list"></div>
  `;
  $('#eq-recents').innerHTML = await recentEquiposHTML();
  $$('.recents-chip', $('#eq-recents')).forEach(b => b.addEventListener('click', () => openEquipmentDetail(b.dataset.recentId)));

  async function draw(filter = '') {
    const list = $('#eq-list');
    const f = filter.toLowerCase();
    const filtered = equipos.filter(e => !f || (searchIndex.get(e.id) || '').includes(f));
    const withStatus = await computeAllStatuses(filtered);
    list.innerHTML = withStatus.map(({ e, s }) => `
      <div class="eq-card clickable ${bulkMode ? 'bulk-selectable' : ''} ${selected.has(e.id) ? 'bulk-selected' : ''}" data-id="${e.id}">
        <div class="eq-card-head">
          ${bulkMode ? `<input type="checkbox" class="eq-bulk-check" ${selected.has(e.id) ? 'checked' : ''}/>` : ''}
          <span class="eq-code">${e.shortCode ? e.shortCode + ' · ' : ''}${e.code}</span>
          <span class="status-chip" style="--c:${STATUS_COLOR[s.code]}">${s.label}</span>
        </div>
        <div class="eq-name">${e.brand} ${e.model}</div>
        <div class="eq-detail-row"><span>Tipo</span><span>${(types.find(t => t.id === e.typeId) || {}).name || '—'}</span></div>
        <div class="eq-detail-row"><span>Ubicación</span><span>${(locations.find(l => l.id === e.locationId) || {}).name || '—'}</span></div>
        <div class="eq-detail-row"><span>Estado</span><span>${e.status}</span></div>
        <div class="eq-hourmeter">${fmt(e.hourmeter)}<span class="unit"> h</span></div>
      </div>`).join('') || `<div class="empty-state">Sin resultados.</div>`;

    $$('.eq-card.clickable', list).forEach(card => {
      card.addEventListener('click', (ev) => {
        if (bulkMode) {
          ev.preventDefault();
          const id = card.dataset.id;
          selected.has(id) ? selected.delete(id) : selected.add(id);
          card.classList.toggle('bulk-selected');
          card.querySelector('.eq-bulk-check').checked = selected.has(id);
          $('#eq-bulk-count').textContent = `${selected.size} seleccionados`;
        } else {
          openEquipmentDetail(card.dataset.id);
        }
      });
    });
  }
  draw();
  $('#eq-search').addEventListener('input', (e) => draw(e.target.value));
  if (canEdit) $('#eq-new')?.addEventListener('click', () => openEquipmentForm(null, types, locations));

  if (canEdit) {
    $('#eq-print-all-qr').addEventListener('click', () => printAllQRCodes(equipos));
  }

  if (canEdit) {
    $('#eq-bulk-toggle').addEventListener('click', () => {
      bulkMode = !bulkMode;
      selected.clear();
      $('#eq-bulk-bar').classList.toggle('hidden', !bulkMode);
      $('#eq-bulk-count').textContent = '0 seleccionados';
      draw($('#eq-search').value);
    });
    $('#eq-bulk-cancel').addEventListener('click', () => {
      bulkMode = false; selected.clear();
      $('#eq-bulk-bar').classList.add('hidden');
      draw($('#eq-search').value);
    });
    $('#eq-bulk-apply').addEventListener('click', () => {
      if (!selected.size) { alert('Selecciona al menos un equipo.'); return; }
      openModal(`Editar ${selected.size} equipo(s)`, `
        <form id="bulk-form" class="form-grid">
          <label>Nueva ubicación (déjalo en blanco para no cambiarla)
            <select name="locationId"><option value="">— No cambiar —</option>${locations.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}</select>
          </label>
          <label>Nuevo turno (déjalo en blanco para no cambiarlo)
            <select name="shiftId"><option value="">— No cambiar —</option><option value="shift_dia">Turno Día</option><option value="shift_noche">Turno Noche</option></select>
          </label>
          <label>Nueva categoría (déjalo en blanco para no cambiarla)
            <select name="typeId"><option value="">— No cambiar —</option>${types.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}</select>
          </label>
          <label>Nuevo estado (déjalo en blanco para no cambiarlo)
            <select name="status"><option value="">— No cambiar —</option>${['Operativo', 'Detenido', 'En mantenimiento', 'Fuera de servicio'].map(s => `<option>${s}</option>`).join('')}</select>
          </label>
          <div class="modal-actions"><button type="submit" class="btn btn-accent">Aplicar a ${selected.size} equipo(s)</button></div>
        </form>
      `);
      $('#bulk-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const fd = Object.fromEntries(new FormData(ev.target).entries());
        for (const id of selected) {
          const eq = await DB.get('equipment', id);
          if (fd.locationId) eq.locationId = fd.locationId;
          if (fd.shiftId) eq.shiftId = fd.shiftId;
          if (fd.typeId) eq.typeId = fd.typeId;
          if (fd.status) eq.status = fd.status;
          await DB.put('equipment', stamp(eq, App.currentUser.name));
        }
        await logAudit('EQUIPOS_EDITADOS_LOTE', `${selected.size} equipos`, App.currentUser.name);
        closeModal();
        navigate('equipos');
      });
    });
    $('#eq-bulk-delete').addEventListener('click', async () => {
      if (!selected.size) { alert('Selecciona al menos un equipo.'); return; }
      if (!confirm(`¿Eliminar ${selected.size} equipo(s)? Es un borrado lógico — el historial de cada uno se conserva en auditoría, pero dejan de aparecer en la app. Esta acción no se puede deshacer desde la interfaz.`)) return;
      for (const id of selected) {
        const eq = await DB.get('equipment', id);
        eq.active = false;
        await DB.put('equipment', stamp(eq, App.currentUser.name));
        const eqPlans = (await DB.allActive('lubrication_plans')).filter(p => p.equipmentId === id);
        for (const plan of eqPlans) { plan.active = false; await DB.put('lubrication_plans', stamp(plan, App.currentUser.name)); }
      }
      await logAudit('EQUIPOS_ELIMINADOS_LOTE', `${selected.size} equipos`, App.currentUser.name);
      navigate('equipos');
    });
  }

  if (canEdit) {
    $('#eq-import').addEventListener('click', () => $('#eq-import-file').click());
    $('#eq-import-file').addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      await handleEquipmentExcelImport(file, types, locations);
      ev.target.value = '';
    });
  }
}

/* ---------- Importación masiva de equipos desde Excel ---------- */
function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function pickField(row, ...names) {
  const map = {};
  Object.keys(row).forEach(k => { map[normalizeHeader(k)] = row[k]; });
  for (const n of names) { if (map[n] !== undefined && map[n] !== '') return map[n]; }
  return '';
}
async function readWorkbookRows(file) {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

async function handleEquipmentExcelImport(file, types, locations) {
  let rows;
  try { rows = await readWorkbookRows(file); } catch (err) { alert('No se pudo leer el archivo: ' + err.message); return; }
  if (!rows.length) { alert('El archivo no tiene filas de datos.'); return; }

  const equipos = await DB.allActive('equipment');
  const preview = [];
  for (const row of rows) {
    const code = String(pickField(row, 'codigo', 'código', 'code')).trim();
    const shortCode = String(pickField(row, 'ahorrativo', 'codigo ahorrativo', 'código ahorrativo', 'shortcode')).trim();
    if (!code && !shortCode) continue;
    const hmRaw = pickField(row, 'horometro', 'horómetro', 'hourmeter');
    const existing = equipos.find(e =>
      (code && e.code.toLowerCase() === code.toLowerCase()) ||
      (shortCode && (e.shortCode || '').toLowerCase() === shortCode.toLowerCase()));
    preview.push({
      code: code || null, shortCode: shortCode || null,
      description: pickField(row, 'descripcion', 'descripción', 'description') || 'Equipo',
      brand: pickField(row, 'marca', 'brand'),
      model: pickField(row, 'modelo', 'model'),
      serial: pickField(row, 'serie', 'numero de serie', 'nº de serie', 'serial'),
      typeName: pickField(row, 'categoria', 'categoría', 'tipo', 'type'),
      locationName: pickField(row, 'ubicacion', 'ubicación', 'location'),
      status: pickField(row, 'estado', 'status') || 'Operativo',
      hourmeterRaw: hmRaw,
      shift: pickField(row, 'turno', 'shift'),
      existing
    });
  }
  if (!preview.length) { alert('No se encontraron filas con "Código" o "Ahorrativo" válidos.'); return; }

  openModal(`Importar equipos (${preview.length} filas)`, `
    <p class="dim">Se hará coincidir por <b>Código</b> o por <b>Ahorrativo</b> si el código no está. Los que coincidan se actualizan; el resto se crea con código automático si no traen uno. Categorías o ubicaciones que no existan se crean automáticamente.</p>
    <div style="max-height:40vh; overflow:auto; border:1px solid var(--border); border-radius:8px">
      <table class="data-table">
        <thead><tr><th>Código</th><th>Ahorrativo</th><th>Acción</th><th>Marca/Modelo</th></tr></thead>
        <tbody>${preview.map(p => `<tr><td class="mono">${p.code || '—'}</td><td class="mono">${p.shortCode || '—'}</td><td>${p.existing ? 'Actualizar' : 'Crear'}</td><td>${p.brand} ${p.model}</td></tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="modal-actions"><button class="btn btn-accent" id="btn-confirm-import">Confirmar importación</button></div>
  `);

  $('#btn-confirm-import').addEventListener('click', async () => {
    let created = 0, updated = 0;
    for (const p of preview) {
      let typeId = types.find(t => t.name.toLowerCase() === p.typeName.toLowerCase())?.id;
      if (!typeId && p.typeName) {
        const t = stamp({ id: uid('type'), name: p.typeName, active: true }, App.currentUser.name);
        await DB.put('equipment_types', t); types.push(t); typeId = t.id;
      }
      let locationId = locations.find(l => l.name.toLowerCase() === p.locationName.toLowerCase())?.id;
      if (!locationId && p.locationName) {
        const l = stamp({ id: uid('loc'), name: p.locationName, active: true }, App.currentUser.name);
        await DB.put('locations', l); locations.push(l); locationId = l.id;
      }
      const shiftId = /noche/i.test(p.shift) ? 'shift_noche' : 'shift_dia';
      const parsedHm = parseFloat(p.hourmeterRaw);
      const obj = p.existing || { id: uid('eq'), code: p.code || await generateNextEquipmentCode() };
      if (!obj.code) obj.code = p.code || await generateNextEquipmentCode();
      const hourmeter = !isNaN(parsedHm) && parsedHm > 0 ? parsedHm : (p.existing ? p.existing.hourmeter : 0);
      Object.assign(obj, {
        shortCode: p.shortCode || obj.shortCode || '',
        description: p.description, brand: p.brand, model: p.model, serial: p.serial,
        typeId: typeId || obj.typeId || (types[0] && types[0].id),
        locationId: locationId || obj.locationId || (locations[0] && locations[0].id),
        status: p.status, hourmeter, shiftId
      });
      await DB.put('equipment', stamp(obj, App.currentUser.name));
      p.existing ? updated++ : created++;
    }
    await logAudit('EQUIPOS_IMPORTADOS', `${created} creados, ${updated} actualizados`, App.currentUser.name);
    closeModal();
    navigate('equipos');
  });
}

async function openEquipmentDetail(id) {
  trackRecentEquipment(id);
  const e = await DB.get('equipment', id);
  const s = await statusFor(e);
  const types = await DB.allActive('equipment_types');
  const canEdit = App.currentUser.role === 'ADMINISTRADOR';
  openModal(`${e.code}${e.shortCode ? ' · ' + e.shortCode : ''} · ${e.brand} ${e.model}`, `
    <div class="detail-grid">
      <div><b>Código</b><div class="mono">${e.code}</div></div>
      <div><b>Código ahorrativo</b><div class="mono">${e.shortCode || '—'}</div></div>
      <div><b>Categoría</b><div>${(types.find(t => t.id === e.typeId) || {}).name || '—'}</div></div>
      <div><b>Serie</b><div>${e.serial || '—'}</div></div>
      <div><b>Estado</b><div>${e.status}</div></div>
      <div><b>Horómetro</b><div class="mono">${fmt(e.hourmeter)} h</div></div>
      <div><b>Estado de engrase</b><div><span class="dot" style="background:${STATUS_COLOR[s.code]}"></span> ${s.label}</div></div>
      ${s.nextHour !== undefined ? `<div><b>Próximo engrase</b><div class="mono">${fmt(s.nextHour)} h</div></div>` : ''}
    </div>
    <div class="modal-actions">
      ${canEdit ? `<button class="btn btn-danger" id="btn-delete-eq">${ic("trash")}Eliminar equipo</button>` : ''}
      ${canEdit ? `<button class="btn" id="btn-edit-eq">${ic("edit")}Editar</button>` : ''}
      <button class="btn" id="btn-view-qr">${ic("qr")}Código QR</button>
      <button class="btn" id="btn-view-hist">Ver historial</button>
    </div>
  `);
  $('#btn-edit-eq')?.addEventListener('click', async () => {
    closeModal();
    const locations = await DB.allActive('locations');
    openEquipmentForm(e, types, locations);
  });
  $('#btn-delete-eq')?.addEventListener('click', async () => {
    if (!confirm(`¿Eliminar el equipo ${e.code}${e.shortCode ? ' (' + e.shortCode + ')' : ''}? Esta acción es un borrado lógico: el equipo deja de aparecer en la app pero su historial de engrases y anomalías se conserva en la auditoría. No se puede deshacer desde la interfaz.`)) return;
    e.active = false;
    await DB.put('equipment', stamp(e, App.currentUser.name));
    const plans = (await DB.allActive('lubrication_plans')).filter(p => p.equipmentId === e.id);
    for (const plan of plans) { plan.active = false; await DB.put('lubrication_plans', stamp(plan, App.currentUser.name)); }
    await logAudit('EQUIPO_ELIMINADO', `${e.code}${e.shortCode ? ' (' + e.shortCode + ')' : ''}`, App.currentUser.name);
    closeModal();
    navigate('equipos');
  });
  $('#btn-view-qr')?.addEventListener('click', () => openEquipmentQR(e));
  $('#btn-view-hist')?.addEventListener('click', () => {
    closeModal(); navigate('historial');
    setTimeout(() => {
      const sel = $('#hist-equipo');
      if (sel) { sel.value = e.id; sel.dispatchEvent(new Event('change')); }
    }, 50);
  });
}

async function generateNextEquipmentCode() {
  const equipos = await DB.all('equipment'); // incluye inactivos, para no repetir nunca un código
  let max = 0;
  equipos.forEach(eq => {
    const m = /^EQ-(\d+)$/.exec(eq.code || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'EQ-' + String(max + 1).padStart(5, '0');
}

async function openEquipmentForm(equipment, types, locations) {
  const isNew = !equipment;
  const e = equipment || { code: '', shortCode: '', description: '', brand: '', model: '', serial: '', typeId: types[0]?.id, locationId: locations[0]?.id, status: 'Operativo', hourmeter: 0, shiftId: 'shift_dia', cuadrillaId: '' };
  if (isNew) e.code = await generateNextEquipmentCode();
  const cuadrillas = await DB.allActive('cuadrillas');

  openModal(equipment ? 'Editar equipo' : 'Nuevo equipo', `
    <form id="eq-form" class="form-grid">
      <label>Código<input required name="code" value="${e.code}"/><span class="field-hint">${isNew ? 'Sugerido automáticamente, puedes cambiarlo' : 'Puedes editarlo si lo necesitas'}</span></label>
      <label>Código ahorrativo<input name="shortCode" value="${e.shortCode || ''}" placeholder="Ej. A04, T01, V03..."/></label>
      <label class="span-2">Descripción<input required name="description" value="${e.description}"/></label>
      <label>Marca<input required name="brand" value="${e.brand}"/></label>
      <label>Modelo<input required name="model" value="${e.model}"/></label>
      <label>N° de serie<input name="serial" value="${e.serial || ''}"/></label>
      <label>Categoría
        <select name="typeId">${types.map(t => `<option value="${t.id}" ${t.id === e.typeId ? 'selected' : ''}>${t.name}</option>`).join('')}</select>
      </label>
      <label>Ubicación
        <select name="locationId">${locations.map(l => `<option value="${l.id}" ${l.id === e.locationId ? 'selected' : ''}>${l.name}</option>`).join('')}</select>
      </label>
      <label>Estado
        <select name="status">
          ${['Operativo', 'Detenido', 'En mantenimiento', 'Fuera de servicio'].map(st => `<option ${st === e.status ? 'selected' : ''}>${st}</option>`).join('')}
        </select>
      </label>
      <label>Horómetro actual<input required type="number" step="0.1" name="hourmeter" value="${e.hourmeter}"/></label>
      <label>Turno
        <select name="shiftId">
          <option value="shift_dia" ${e.shiftId === 'shift_dia' ? 'selected' : ''}>Turno Día</option>
          <option value="shift_noche" ${e.shiftId === 'shift_noche' ? 'selected' : ''}>Turno Noche</option>
        </select>
      </label>
      <label>Cuadrilla asignada
        <select name="cuadrillaId">
          <option value="">— Cualquier cuadrilla —</option>
          ${cuadrillas.map(cq => `<option value="${cq.id}" ${cq.id === e.cuadrillaId ? 'selected' : ''}>${cq.name}</option>`).join('')}
        </select>
        <span class="field-hint">Si asignas una cuadrilla, solo los lubricadores de esa cuadrilla verán este equipo en "Mi Turno" — evita que dos cuadrillas lo engrasen el mismo día.</span>
      </label>
      <div class="modal-actions">
        <button type="submit" class="btn btn-accent">${ic("save")}Guardar</button>
      </div>
    </form>
  `);
  $('#eq-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const obj = Object.fromEntries(fd.entries());
    obj.hourmeter = parseFloat(obj.hourmeter);
    obj.code = (obj.code || '').trim();
    if (!obj.code) { alert('El código no puede quedar vacío.'); return; }
    if (!isNew && !confirmHourmeterChange(e.hourmeter, obj.hourmeter)) return;

    const allEquipos = await DB.allActive('equipment');
    const collision = allEquipos.find(other => other.id !== e.id && other.code.toLowerCase() === obj.code.toLowerCase());
    if (collision) {
      alert(`Ese código ya lo tiene el equipo "${collision.brand} ${collision.model}". Usa uno distinto.`);
      return;
    }

    Object.assign(e, obj);
    await DB.put('equipment', stamp(e, App.currentUser.name));
    await logAudit('EQUIPO_GUARDADO', `Equipo ${e.code}${e.shortCode ? ' (' + e.shortCode + ')' : ''}`, App.currentUser.name);
    closeModal();
    navigate('equipos');
  });
}

/* ============================================================
   PLAN DE ENGRASE
   ============================================================ */
async function renderPlan() {
  const c = $('#app-content');
  const equipos = await DB.allActive('equipment');
  const plans = await DB.allActive('lubrication_plans');
  const lubricants = await DB.allActive('lubricants');
  const types = await DB.allActive('equipment_types');
  const canEdit = App.currentUser.role === 'ADMINISTRADOR';
  let bulkMode = false;
  const selected = new Set();

  c.innerHTML = `
    <div class="toolbar">
      ${canEdit ? `<button class="btn" id="pts-import">${ic("upload")}Importar puntos de engrase desde Excel</button>` : ''}
      ${canEdit ? `<button class="btn" id="plan-bulk-toggle">${ic("edit")}Configurar plan en lote</button>` : ''}
      <input type="file" id="pts-import-file" accept=".xlsx,.xls,.csv" class="hidden"/>
    </div>
    <div id="plan-bulk-bar" class="bulk-bar hidden">
      <span id="plan-bulk-count">0 seleccionados</span>
      <button class="btn btn-sm btn-accent" id="plan-bulk-apply">${ic("check")}Aplicar plan a seleccionados</button>
      <button class="btn btn-sm" id="plan-bulk-cancel">Cancelar</button>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Planes de engrase por equipo</h3></div>
      <table class="data-table">
        <thead><tr>${canEdit ? '<th></th>' : ''}<th>Código</th><th>Equipo</th><th>Control</th><th>Frecuencia / Días</th><th>Referencia</th><th>Puntos</th><th></th></tr></thead>
        <tbody>
          ${(await Promise.all(equipos.map(async e => {
            const plan = plans.find(p => p.equipmentId === e.id);
            const points = plan ? (await DB.allActive('lubrication_points')).filter(p => p.planId === plan.id) : [];
            const isWeekday = plan && plan.controlType === 'Día y turno de la semana';
            return `<tr data-row-id="${e.id}">
              ${canEdit ? `<td><input type="checkbox" class="plan-bulk-check ${bulkMode ? '' : 'hidden'}" data-id="${e.id}"/></td>` : ''}
              <td class="mono">${e.code}</td>
              <td>${e.brand} ${e.model}</td>
              <td>${plan ? plan.controlType : '—'}</td>
              <td class="mono">${plan ? (isWeekday ? (plan.assignedDays || []).map(d => d.slice(0, 3)).join(', ') || 'sin días' : plan.frequency + ' h') : '—'}</td>
              <td class="mono">${plan ? (isWeekday ? '—' : fmt(plan.lastGreaseHour) + ' h · alerta ' + plan.alertYellowHours + ' h') : '—'}</td>
              <td>${points.length}</td>
              <td><button class="btn btn-sm" data-eq="${e.id}" data-plan="${plan ? plan.id : ''}">${ic("edit")}Configurar</button></td>
            </tr>`;
          }))).join('')}
        </tbody>
      </table>
    </div>`;
  makeTablesResponsive(c);

  if (canEdit) {
    $('#pts-import').addEventListener('click', () => $('#pts-import-file').click());
    $('#pts-import-file').addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      await handlePointsExcelImport(file, equipos, types, lubricants);
      ev.target.value = '';
    });
  }

  $$('button[data-eq]', c).forEach(btn => {
    btn.addEventListener('click', () => openPlanForm(btn.dataset.eq, btn.dataset.plan || null, lubricants));
  });

  if (!canEdit) return;

  function updateBulkUI() {
    $$('.plan-bulk-check', c).forEach(chk => chk.classList.toggle('hidden', !bulkMode));
    $('#plan-bulk-bar').classList.toggle('hidden', !bulkMode);
    $('#plan-bulk-count').textContent = `${selected.size} seleccionados`;
  }

  $('#plan-bulk-toggle').addEventListener('click', () => {
    bulkMode = !bulkMode;
    selected.clear();
    updateBulkUI();
  });
  $('#plan-bulk-cancel').addEventListener('click', () => {
    bulkMode = false;
    selected.clear();
    updateBulkUI();
  });
  $$('.plan-bulk-check', c).forEach(chk => {
    chk.addEventListener('change', () => {
      chk.checked ? selected.add(chk.dataset.id) : selected.delete(chk.dataset.id);
      $('#plan-bulk-count').textContent = `${selected.size} seleccionados`;
    });
  });
  $('#plan-bulk-apply').addEventListener('click', () => {
    if (!selected.size) { alert('Selecciona al menos un equipo.'); return; }
    openBulkPlanForm(Array.from(selected));
  });
}

/* ---------- Configurar el mismo plan de engrase para varios equipos a la vez ---------- */
function openBulkPlanForm(equipmentIds) {
  openModal(`Configurar plan para ${equipmentIds.length} equipo(s)`, `
    <p class="dim">Esto crea o actualiza el plan de cada equipo seleccionado con estos mismos valores. Si un equipo ya tenía un plan por horas, su horómetro de referencia se toma del horómetro actual de CADA equipo (no un valor compartido). Los puntos de engrase no se tocan aquí — agrégalos por equipo o con "Importar puntos de engrase desde Excel".</p>
    <form id="bulk-plan-form" class="form-grid">
      <label class="span-2">Tipo de control
        <select name="controlType" id="bulk-plan-control-type">
          ${['Horas de operación', 'Día y turno de la semana', 'Fecha/calendario', 'Turno', 'Combinación de horas y calendario'].map(o => `<option>${o}</option>`).join('')}
        </select>
      </label>
      <div id="bulk-hours-fields" class="span-2 form-grid" style="padding:0">
        <label>Frecuencia (horas)<input type="number" name="frequency" value="50"/></label>
        <label>Alerta amarilla (horas antes)<input type="number" name="alertYellowHours" value="${App.generalSettings.defaultAlertYellowHours}"/></label>
      </div>
      <div id="bulk-weekday-fields" class="span-2 hidden">
        <label>Turno
          <select name="shiftId">
            <option value="shift_dia">Turno Día</option>
            <option value="shift_noche">Turno Noche</option>
          </select>
          <span class="field-hint">También actualiza el turno de cada equipo seleccionado, para que coincida con "Mi Turno" del lubricador.</span>
        </label>
        <label>Días de engrase asignados
          <div class="weekday-picker">
            ${SCHEDULE_WEEKDAYS.map(d => `
              <label class="weekday-chip">
                <input type="checkbox" name="assignedDays" value="${d}"/>
                <span>${d.slice(0, 3)}</span>
              </label>`).join('')}
          </div>
        </label>
      </div>
      <div class="modal-actions"><button type="submit" class="btn btn-accent">${ic("check")}Aplicar a ${equipmentIds.length} equipo(s)</button></div>
    </form>
  `);

  $('#bulk-plan-control-type').addEventListener('change', (e) => {
    const weekday = e.target.value === 'Día y turno de la semana';
    $('#bulk-hours-fields').classList.toggle('hidden', weekday);
    $('#bulk-weekday-fields').classList.toggle('hidden', !weekday);
  });

  $('#bulk-plan-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const controlType = fd.get('controlType');
    const weekday = controlType === 'Día y turno de la semana';
    const assignedDays = fd.getAll('assignedDays');
    const shiftId = fd.get('shiftId');
    const frequency = parseFloat(fd.get('frequency')) || 0;
    const alertYellowHours = parseFloat(fd.get('alertYellowHours')) || App.generalSettings.defaultAlertYellowHours;

    const allPlans = await DB.allActive('lubrication_plans');
    let created = 0, updated = 0;
    for (const eqId of equipmentIds) {
      const equipment = await DB.get('equipment', eqId);
      let plan = allPlans.find(p => p.equipmentId === eqId);
      const obj = { controlType };
      if (weekday) {
        obj.assignedDays = assignedDays;
        obj.shiftId = shiftId;
        obj.frequency = plan ? plan.frequency : 0;
        obj.lastGreaseHour = plan ? plan.lastGreaseHour : equipment.hourmeter;
        obj.alertYellowHours = plan ? plan.alertYellowHours : App.generalSettings.defaultAlertYellowHours;
        if (equipment.shiftId !== shiftId) {
          equipment.shiftId = shiftId;
          await DB.put('equipment', stamp(equipment, App.currentUser.name));
        }
      } else {
        obj.frequency = frequency;
        obj.alertYellowHours = alertYellowHours;
        obj.lastGreaseHour = plan ? plan.lastGreaseHour : equipment.hourmeter; // cada equipo usa su propio horómetro
        obj.assignedDays = plan ? plan.assignedDays : [];
      }
      if (plan) { Object.assign(plan, obj); updated++; }
      else { plan = stamp({ id: uid('plan'), equipmentId: eqId, ...obj }, App.currentUser.name); allPlans.push(plan); created++; }
      await DB.put('lubrication_plans', stamp(plan, App.currentUser.name));
    }
    await logAudit('PLAN_LOTE_APLICADO', `${created} creados, ${updated} actualizados`, App.currentUser.name);
    closeModal();
    navigate('plan');
  });
}

/* ---------- Importación masiva de puntos de engrase desde Excel ---------- */
async function handlePointsExcelImport(file, equipos, types, lubricants) {
  let rows;
  try { rows = await readWorkbookRows(file); } catch (err) { alert('No se pudo leer el archivo: ' + err.message); return; }
  if (!rows.length) { alert('El archivo no tiene filas de datos.'); return; }

  const defaultLub = lubricants[0]?.id;
  const parsed = [];
  for (const row of rows) {
    const category = String(pickField(row, 'categoria', 'categoría', 'tipo de equipo', 'tipo')).trim();
    const brand = String(pickField(row, 'marca', 'brand')).trim();
    const code = String(pickField(row, 'codigo', 'código', 'code')).trim();
    const point = String(pickField(row, 'punto de engrase', 'punto', 'point')).trim();
    const freq = parseFloat(pickField(row, 'frecuencia (horas)', 'frecuencia', 'frequency'));
    const system = String(pickField(row, 'sistema', 'system')) || 'General';
    const component = String(pickField(row, 'componente', 'component')) || point;
    if (!point || isNaN(freq)) continue;

    // Aplica a un equipo específico por código, o a todos los que coincidan con categoría (+ marca si se indicó)
    let targets = [];
    if (code) {
      const eq = equipos.find(e => e.code.toLowerCase() === code.toLowerCase());
      if (eq) targets = [eq];
    } else if (category) {
      const type = types.find(t => t.name.toLowerCase() === category.toLowerCase());
      targets = equipos.filter(e => (!type || e.typeId === type.id) &&
        (!brand || (e.brand || '').toLowerCase() === brand.toLowerCase()));
    }
    parsed.push({ category, brand, code, point, freq, system, component, targets });
  }

  if (!parsed.length) { alert('No se encontraron filas válidas. Se necesita al menos "Punto de engrase" y "Frecuencia (horas)", y "Categoría" o "Código" para saber a qué equipos aplicar.'); return; }

  const totalEquiposAfectados = new Set(parsed.flatMap(p => p.targets.map(t => t.id))).size;
  const sinCoincidencia = parsed.filter(p => !p.targets.length);

  openModal(`Importar puntos de engrase (${parsed.length} filas)`, `
    <p class="dim">Se aplicará cada punto a todos los equipos cuya categoría (y marca, si se indicó) coincidan — o a un equipo específico si la fila trae "Código". Si un equipo ya tiene un punto con el mismo nombre, no se duplica.</p>
    <div class="detail-grid" style="margin-bottom:10px">
      <div><b>Filas válidas</b><div>${parsed.length}</div></div>
      <div><b>Equipos que recibirán puntos</b><div>${totalEquiposAfectados}</div></div>
    </div>
    ${sinCoincidencia.length ? `<p style="color:var(--red); font-size:13px">${sinCoincidencia.length} fila(s) no coinciden con ningún equipo registrado (revisa categoría/marca/código): ${sinCoincidencia.slice(0, 8).map(p => p.point).join(', ')}${sinCoincidencia.length > 8 ? '…' : ''}</p>` : ''}
    <div class="modal-actions"><button class="btn btn-accent" id="btn-confirm-points">Aplicar puntos de engrase</button></div>
  `);

  $('#btn-confirm-points').addEventListener('click', async () => {
    let plansCreated = 0, pointsCreated = 0, pointsSkipped = 0;
    const allPlans = await DB.allActive('lubrication_plans');
    const allPoints = await DB.allActive('lubrication_points');

    for (const p of parsed) {
      for (const eq of p.targets) {
        let plan = allPlans.find(pl => pl.equipmentId === eq.id);
        if (!plan) {
          plan = stamp({
            id: uid('plan'), equipmentId: eq.id, controlType: 'Horas de operación',
            frequency: p.freq, lastGreaseHour: eq.hourmeter, alertYellowHours: App.generalSettings.defaultAlertYellowHours, active: true
          }, App.currentUser.name);
          await DB.put('lubrication_plans', plan);
          allPlans.push(plan);
          plansCreated++;
        }
        const existing = allPoints.find(pt => pt.planId === plan.id && pt.point.toLowerCase() === p.point.toLowerCase());
        if (existing) { pointsSkipped++; continue; }
        const newPoint = stamp({
          id: uid('pt'), planId: plan.id, system: p.system, component: p.component, point: p.point,
          greaseType: defaultLub, recommendedQty: 0.5, frequency: p.freq, notes: '', active: true
        }, App.currentUser.name);
        await DB.put('lubrication_points', newPoint);
        allPoints.push(newPoint);
        pointsCreated++;
      }
    }
    await logAudit('PUNTOS_IMPORTADOS', `${pointsCreated} puntos creados, ${pointsSkipped} ya existían, ${plansCreated} planes nuevos`, App.currentUser.name);
    closeModal();
    navigate('plan');
  });
}

async function openPlanForm(equipmentId, planId, lubricants) {
  const equipment = await DB.get('equipment', equipmentId);
  let plan = planId ? await DB.get('lubrication_plans', planId) : null;
  const points = plan ? (await DB.allActive('lubrication_points')).filter(p => p.planId === plan.id) : [];
  const isWeekday = plan && plan.controlType === 'Día y turno de la semana';
  const assignedDays = (plan && plan.assignedDays) || [];

  openModal(`Plan de engrase · ${equipment.code}`, `
    <form id="plan-form" class="form-grid">
      <label class="span-2">Tipo de control
        <select name="controlType" id="plan-control-type">
          ${['Horas de operación', 'Día y turno de la semana', 'Fecha/calendario', 'Turno', 'Combinación de horas y calendario'].map(o => `<option ${plan && plan.controlType === o ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
        <span class="field-hint">Usa "Día y turno de la semana" para equipos donde no se registra horómetro a diario — se controla por calendario en vez de por horas.</span>
      </label>

      <div id="hours-fields" class="span-2 form-grid ${isWeekday ? 'hidden' : ''}" style="padding:0">
        <label>Frecuencia (horas)<input type="number" name="frequency" value="${plan ? plan.frequency : 50}"/></label>
        <label>Horómetro del último engrase<input type="number" step="0.1" name="lastGreaseHour" value="${plan ? plan.lastGreaseHour : equipment.hourmeter}"/></label>
        <label>Alerta amarilla (horas antes)<input type="number" name="alertYellowHours" value="${plan ? plan.alertYellowHours : App.generalSettings.defaultAlertYellowHours}"/></label>
      </div>

      <div id="weekday-fields" class="span-2 ${isWeekday ? '' : 'hidden'}">
        <label>Turno
          <select name="shiftId">
            <option value="shift_dia" ${equipment.shiftId === 'shift_dia' ? 'selected' : ''}>Turno Día</option>
            <option value="shift_noche" ${equipment.shiftId === 'shift_noche' ? 'selected' : ''}>Turno Noche</option>
          </select>
          <span class="field-hint">También actualiza el turno del equipo, para que coincida con "Mi Turno" del lubricador.</span>
        </label>
        <label>Días de engrase asignados
          <div class="weekday-picker">
            ${SCHEDULE_WEEKDAYS.map(d => `
              <label class="weekday-chip">
                <input type="checkbox" name="assignedDays" value="${d}" ${assignedDays.includes(d) ? 'checked' : ''}/>
                <span>${d.slice(0, 3)}</span>
              </label>`).join('')}
          </div>
          <span class="field-hint">El equipo se marca "AL DÍA" en verde cuando exista un registro de engrase desde el día asignado más reciente; en amarillo si hoy es el día asignado y aún no se ha hecho; en rojo si ya pasó el día sin registrar.</span>
        </label>
      </div>

      <div class="modal-actions"><button type="submit" class="btn btn-accent">${ic("save")}Guardar plan</button></div>
    </form>
    <div class="panel-head" style="margin-top:16px"><h3>Puntos de engrase</h3></div>
    <div id="points-list">
      ${points.map(p => pointRow(p, lubricants)).join('') || '<div class="empty-state">Sin puntos configurados.</div>'}
    </div>
    <button class="btn btn-sm" id="btn-add-point" ${plan ? '' : 'disabled title="Guarda el plan primero"'}>${ic("plus")}Agregar punto</button>
  `);

  $('#plan-control-type').addEventListener('change', (e) => {
    const weekday = e.target.value === 'Día y turno de la semana';
    $('#hours-fields').classList.toggle('hidden', weekday);
    $('#weekday-fields').classList.toggle('hidden', !weekday);
  });
  wirePhotoThumbs($('#points-list'));

  $('#plan-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const controlType = fd.get('controlType');
    const weekday = controlType === 'Día y turno de la semana';
    const obj = { controlType };
    if (weekday) {
      obj.assignedDays = fd.getAll('assignedDays');
      obj.shiftId = fd.get('shiftId');
      obj.frequency = plan ? plan.frequency : 0;
      obj.lastGreaseHour = plan ? plan.lastGreaseHour : equipment.hourmeter;
      obj.alertYellowHours = plan ? plan.alertYellowHours : App.generalSettings.defaultAlertYellowHours;
      if (equipment.shiftId !== obj.shiftId) {
        equipment.shiftId = obj.shiftId;
        await DB.put('equipment', stamp(equipment, App.currentUser.name));
      }
    } else {
      obj.frequency = parseFloat(fd.get('frequency'));
      obj.lastGreaseHour = parseFloat(fd.get('lastGreaseHour'));
      obj.alertYellowHours = parseFloat(fd.get('alertYellowHours'));
      obj.assignedDays = plan ? plan.assignedDays : [];
    }
    if (!plan) plan = stamp({ id: uid('plan'), equipmentId, ...obj }, App.currentUser.name);
    else Object.assign(plan, obj);
    await DB.put('lubrication_plans', stamp(plan, App.currentUser.name));
    await logAudit('PLAN_GUARDADO', `Plan de ${equipment.code}`, App.currentUser.name);
    closeModal();
    navigate('plan');
  });

  $('#btn-add-point')?.addEventListener('click', () => {
    if (!plan) return;
    openPointForm(plan.id, null, lubricants);
  });

  $$('.point-edit', document).forEach(b => b.addEventListener('click', () => openPointForm(plan.id, b.dataset.id, lubricants)));
  $$('.point-del', document).forEach(b => b.addEventListener('click', async () => {
    await DB.delete('lubrication_points', b.dataset.id);
    closeModal();
    openPlanForm(equipmentId, plan.id, lubricants);
  }));
}

function pointRow(p, lubricants) {
  const lub = lubricants.find(l => l.id === p.greaseType);
  return `<div class="point-row">
    ${p.photo ? photoThumbHTML(p.photo, p.point) : ''}
    <div><b>${p.point}</b><div class="dim">${lub ? lub.name : ''} · ${p.recommendedQty} kg</div></div>
    <div class="row-actions">
      <button class="btn btn-sm point-edit" data-id="${p.id}">${ic("edit")}Editar</button>
      <button class="btn btn-sm btn-danger point-del" data-id="${p.id}">${ic("trash")}Eliminar</button>
    </div>
  </div>`;
}

function openPointForm(planId, pointId, lubricants) {
  DB.get('lubrication_points', pointId).then(existing => {
    const p = existing || { system: 'General', component: '', point: '', greaseType: lubricants[0]?.id, recommendedQty: 0.5, frequency: 50, notes: '', photo: null };
    openModal(pointId ? 'Editar punto' : 'Nuevo punto de engrase', `
      <form id="point-form" class="form-grid">
        <label>Sistema<input name="system" value="${p.system}"/></label>
        <label>Componente<input name="component" value="${p.component}"/></label>
        <label>Punto de engrase<input required name="point" value="${p.point}"/></label>
        <label>Tipo de grasa
          <select name="greaseType">${lubricants.map(l => `<option value="${l.id}" ${l.id === p.greaseType ? 'selected' : ''}>${l.name}</option>`).join('')}</select>
        </label>
        <label>Cantidad recomendada (kg)<input type="number" step="0.1" name="recommendedQty" value="${p.recommendedQty}"/></label>
        <label class="span-2">Observaciones<input name="notes" value="${p.notes || ''}"/></label>
        ${photoFieldHTML()}
        ${p.photo ? `<div class="span-2">Foto actual: ${photoThumbHTML(p.photo, p.point)}</div>` : ''}
        <div class="modal-actions"><button type="submit" class="btn btn-accent">Guardar punto</button></div>
      </form>
    `);
    wirePhotoField($('#point-form'));
    wirePhotoThumbs($('#point-form'));
    $('#point-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target).entries());
      delete fd.photo;
      fd.recommendedQty = parseFloat(fd.recommendedQty);
      const newPhoto = await getSelectedPhotoDataURL(ev.target);
      if (newPhoto) fd.photo = newPhoto;
      const obj = existing ? Object.assign(existing, fd) : stamp({ id: uid('pt'), planId, photo: null, ...fd }, App.currentUser.name);
      await DB.put('lubrication_points', stamp(obj, App.currentUser.name));
      closeModal();
      openPlanForm((await DB.get('lubrication_plans', planId)).equipmentId, planId, lubricants);
    });
  });
}

/* ============================================================
   ENGRASE DEL TURNO
   ============================================================ */
async function renderTurno() {
  const c = $('#app-content');
  const equipos = await DB.allActive('equipment');
  const locations = await DB.allActive('locations');
  const shift = currentShiftId();
  const equiposTurno = equipos.filter(e => e.shiftId === shift);
  const statuses = await computeAllStatuses(equiposTurno);
  statuses.sort((a, b) => (a.s.remaining ?? 9999) - (b.s.remaining ?? 9999));

  c.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>Plan de engrase del turno — ${shift === 'shift_dia' ? 'Día' : 'Noche'}</h3>
        <span class="pill">${equiposTurno.length} equipos</span>
      </div>
      <table class="data-table">
        <thead><tr><th>Estado</th><th>Código</th><th>Equipo</th><th>Ubicación</th><th>Horómetro</th><th>Último</th><th>Próximo</th><th>Restante</th><th></th></tr></thead>
        <tbody>
          ${statuses.map(({ e, s }) => `
            <tr>
              <td><span class="dot" style="background:${STATUS_COLOR[s.code]}"></span> ${s.label}</td>
              <td class="mono">${e.code}</td>
              <td>${e.brand} ${e.model}</td>
              <td>${(locations.find(l => l.id === e.locationId) || {}).name || '—'}</td>
              <td class="mono">${fmt(e.hourmeter)} h</td>
              <td class="mono">${s.plan ? fmt(s.plan.lastGreaseHour) + ' h' : '—'}</td>
              <td class="mono">${s.nextHour !== undefined ? fmt(s.nextHour) + ' h' : '—'}</td>
              <td class="mono" style="color:${STATUS_COLOR[s.code]}">${s.remaining !== undefined && s.remaining !== null ? fmt(s.remaining) + ' h' : '—'}</td>
              <td><button class="btn btn-sm btn-accent" data-id="${e.id}">Realizar engrase</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  $$('button[data-id]', c).forEach(b => b.addEventListener('click', () => startGreaseFlow(b.dataset.id)));
}

/* ============================================================
   REGISTRAR ENGRASE (checklist)
   ============================================================ */
async function renderRegistrar() {
  const c = $('#app-content');
  const equipos = await DB.allActive('equipment');
  c.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Seleccionar equipo</h3></div>
      <select id="reg-eq-select" class="input">
        <option value="">— Selecciona un equipo —</option>
        ${equipos.map(e => `<option value="${e.id}">${e.code} · ${e.brand} ${e.model}</option>`).join('')}
      </select>
    </div>
    <div id="reg-flow-area"></div>
  `;
  $('#reg-eq-select').addEventListener('change', (e) => {
    if (e.target.value) startGreaseFlow(e.target.value, $('#reg-flow-area'));
  });
}

async function startGreaseFlow(equipmentId, target) {
  trackRecentEquipment(equipmentId);
  const equipment = await DB.get('equipment', equipmentId);
  const plan = (await DB.allActive('lubrication_plans')).find(p => p.equipmentId === equipmentId);
  const points = plan ? (await DB.allActive('lubrication_points')).filter(p => p.planId === plan.id) : [];
  const lubricants = await DB.allActive('lubricants');

  // Aviso si el equipo ya fue engrasado hoy por alguien más (evita que dos cuadrillas repitan el mismo trabajo)
  const todayStr = new Date().toDateString();
  const todaysRecords = (await DB.allActive('lubrication_records'))
    .filter(r => r.equipmentId === equipmentId && new Date(r.date).toDateString() === todayStr)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const alreadyDoneToday = todaysRecords[0];
  const duplicateWarning = alreadyDoneToday && alreadyDoneToday.userId !== App.currentUser.id
    ? `<div class="duplicate-warning">⚠ Este equipo ya fue engrasado hoy por <b>${alreadyDoneToday.userName}</b> a las ${new Date(alreadyDoneToday.date).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' })}. Verifica con tu supervisor antes de registrar otro engrase, para no duplicar el trabajo.</div>`
    : '';

  const draftId = `draft_${equipmentId}_${App.currentUser.id}`;
  const draft = await DB.get('grease_drafts', draftId);

  const html = `
    <div class="panel">
      <div class="panel-head"><h3>Registrar engrase — ${equipment.code} · ${equipment.brand} ${equipment.model}</h3></div>
      <div class="dim" style="padding:0 14px 8px">Registrado por ${App.currentUser.name} · ${fmtDate(nowISO())} · ${currentShiftId() === 'shift_dia' ? 'Turno Día' : 'Turno Noche'}</div>
      ${duplicateWarning}
      ${draft ? `<div class="draft-banner" id="draft-banner">📝 Tienes un progreso sin terminar guardado ${fmtDate(draft.savedAt)}. <button type="button" class="btn btn-sm btn-accent" id="btn-restore-draft">Continuar</button> <button type="button" class="btn btn-sm" id="btn-discard-draft">Descartar</button></div>` : ''}
      <form id="grease-form">
        <div class="form-grid">
          <label class="span-2">Horómetro actual<input required type="number" step="0.1" inputmode="decimal" name="hourmeter" value="${equipment.hourmeter}" class="big-input"/></label>
          <label>Tipo de grasa utilizada
            <select name="greaseType">${lubricants.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}</select>
          </label>
          <label>Cantidad utilizada (kg)<input type="number" step="0.1" inputmode="decimal" name="qty" value="0"/></label>
        </div>

        <div class="checklist-head">
          <h4>Checklist de puntos de engrase</h4>
          ${points.length ? `<button type="button" class="btn btn-sm" id="btn-check-all">${ic("check")}Marcar todos</button>` : ''}
        </div>
        ${points.length ? `<div class="checklist-progress"><div class="checklist-progress-fill" id="checklist-progress-fill" style="width:100%"></div></div><div class="dim" id="checklist-progress-text" style="padding:4px 4px 8px">${points.length} de ${points.length} puntos marcados</div>` : ''}
        <div id="checklist">
          ${points.length ? points.map(p => `
            <div class="checklist-item" data-point="${p.id}">
              <label class="check-row">
                ${p.photo ? `<img src="${p.photo}" class="photo-thumb check-row-thumb" data-full="${p.photo}" data-caption="${p.point}"/>` : ''}
                <input type="checkbox" class="chk-done" checked/>
                <span class="check-row-text">${p.point}</span>
                <span class="check-row-mark">✓</span>
              </label>
              <select class="chk-reason hidden">
                <option value="">¿Por qué no se realizó?</option>
                ${['Punto inaccesible', 'Grasera dañada', 'Línea de engrase obstruida', 'Equipo trabajando', 'Equipo detenido', 'Falta de lubricante', 'Falla mecánica', 'Otro'].map(o => `<option>${o}</option>`).join('')}
              </select>
            </div>`).join('') : `<div class="empty-state">Este equipo no tiene puntos de engrase configurados. Configúralos en "Plan de Engrase".</div>`}
        </div>

        <div class="form-grid" style="margin-top:16px">
          <label>Condición encontrada
            <select name="condition">
              <option>Normal</option><option>Con desgaste</option><option>Requiere atención</option>
            </select>
          </label>
          <label class="span-2">Observaciones<textarea name="notes" rows="2"></textarea></label>
          ${photoFieldHTML()}
        </div>

        <div class="modal-actions">
          <button type="button" class="btn" id="btn-report-anomaly">${ic("alert")}Reportar anomalía</button>
          <button type="submit" class="btn btn-accent">${ic("check")}Finalizar engrase</button>
        </div>
        <div class="dim" id="draft-save-indicator" style="text-align:right; margin-top:6px; min-height:14px"></div>
      </form>
    </div>`;

  const area = target || (() => { navigate('registrar'); return $('#reg-flow-area'); })();
  if (target) target.innerHTML = html; else setTimeout(() => { $('#reg-flow-area').innerHTML = html; wireGreaseForm(); }, 30);
  if (target) wireGreaseForm();

  function collectDraftState() {
    const form = $('#grease-form');
    if (!form) return null;
    const fd = Object.fromEntries(new FormData(form).entries());
    const checklist = $$('.checklist-item').map(item => ({
      pointId: item.dataset.point,
      checked: item.querySelector('.chk-done').checked,
      reason: item.querySelector('.chk-reason').value || ''
    }));
    return { id: draftId, equipmentId, userId: App.currentUser.id, savedAt: nowISO(), fields: fd, checklist };
  }

  let draftSaveTimer = null;
  function scheduleDraftSave() {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(async () => {
      const state = collectDraftState();
      if (!state) return;
      await DB.put('grease_drafts', state);
      const ind = $('#draft-save-indicator');
      if (ind) { ind.textContent = 'Borrador guardado ✓'; setTimeout(() => { if (ind) ind.textContent = ''; }, 1500); }
    }, 700);
  }

  async function discardDraft() { try { await DB.delete('grease_drafts', draftId); } catch (e) {} }

  function restoreDraftIntoForm(d) {
    const form = $('#grease-form');
    if (!form || !d) return;
    Object.entries(d.fields || {}).forEach(([k, v]) => {
      const field = form.querySelector(`[name="${k}"]`);
      if (field && field.type !== 'file') field.value = v;
    });
    (d.checklist || []).forEach(entry => {
      const item = form.querySelector(`.checklist-item[data-point="${entry.pointId}"]`);
      if (!item) return;
      const chk = item.querySelector('.chk-done');
      chk.checked = entry.checked;
      const sel = item.querySelector('.chk-reason');
      sel.classList.toggle('hidden', entry.checked);
      if (entry.reason) sel.value = entry.reason;
    });
  }

  function wireGreaseForm() {
    function updateProgress() {
      const total = $$('.chk-done').length;
      if (!total) return;
      const done = $$('.chk-done').filter(c => c.checked).length;
      const fill = $('#checklist-progress-fill');
      const text = $('#checklist-progress-text');
      if (fill) fill.style.width = Math.round((done / total) * 100) + '%';
      if (text) text.textContent = `${done} de ${total} puntos marcados`;
    }
    $$('.chk-done').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const sel = e.target.closest('.checklist-item').querySelector('.chk-reason');
        sel.classList.toggle('hidden', e.target.checked);
        if (e.target.checked) sel.value = '';
        updateProgress();
      });
    });
    $('#btn-check-all')?.addEventListener('click', () => {
      $$('.chk-done').forEach(chk => {
        chk.checked = true;
        chk.closest('.checklist-item').querySelector('.chk-reason').classList.add('hidden');
      });
      updateProgress();
      scheduleDraftSave();
    });
    wirePhotoField($('#grease-form'));
    $$('.check-row-thumb').forEach(img => {
      img.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openPhotoLightbox(img.dataset.full, img.dataset.caption);
      });
    });
    $('#btn-report-anomaly').addEventListener('click', () => openAnomalyForm(equipment.id, equipment.code));

    // Autoguardado: cualquier cambio en el formulario programa un guardado de borrador local
    $('#grease-form').addEventListener('input', scheduleDraftSave);
    $('#grease-form').addEventListener('change', scheduleDraftSave);

    $('#btn-restore-draft')?.addEventListener('click', () => {
      restoreDraftIntoForm(draft);
      updateProgress();
      $('#draft-banner')?.remove();
    });
    $('#btn-discard-draft')?.addEventListener('click', async () => {
      await discardDraft();
      $('#draft-banner')?.remove();
    });

    $('#grease-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target).entries());
      const newHourmeter = parseFloat(fd.hourmeter);
      if (!confirmHourmeterChange(equipment.hourmeter, newHourmeter)) return;

      const incomplete = $$('.checklist-item').filter(item => !item.querySelector('.chk-done').checked);
      for (const item of incomplete) {
        const reason = item.querySelector('.chk-reason').value;
        if (!reason) {
          alert('Selecciona el motivo de "No realizado" para: ' + item.querySelector('span').textContent);
          return;
        }
      }

      const details = $$('.checklist-item').map(item => ({
        pointId: item.dataset.point,
        pointName: item.querySelector('span').textContent,
        done: item.querySelector('.chk-done').checked,
        reason: item.querySelector('.chk-reason').value || null
      }));

      const photoData = await getSelectedPhotoDataURL(ev.target);

      const record = stamp({
        id: uid('greg'), equipmentId: equipment.id, planId: plan ? plan.id : null,
        date: nowISO(), shiftId: currentShiftId(), hourmeter: newHourmeter,
        userId: App.currentUser.id, userName: App.currentUser.name,
        greaseType: fd.greaseType, qty: parseFloat(fd.qty || 0),
        condition: fd.condition, notes: fd.notes, details, photo: photoData,
        synced: navigator.onLine
      }, App.currentUser.name);
      await DB.put('lubrication_records', record);

      equipment.hourmeter = newHourmeter;
      await DB.put('equipment', stamp(equipment, App.currentUser.name));

      if (plan) {
        plan.lastGreaseHour = newHourmeter;
        await DB.put('lubrication_plans', stamp(plan, App.currentUser.name));
      }
      await logAudit('ENGRASE_REGISTRADO', `${equipment.code} en ${fmt(newHourmeter)} h`, App.currentUser.name);
      await discardDraft();
      await refreshLocalNotifications();
      await refreshAppBadge();

      area.innerHTML = `<div class="panel"><div class="empty-state success">✓ Engrase registrado para ${equipment.code}. Próximo engrase recalculado automáticamente.</div></div>`;
      setTimeout(() => navigate(App.route), 900);
    });
  }
}

/* ============================================================
   ACTUALIZAR HORÓMETROS
   ============================================================ */
async function renderHorometros() {
  const c = $('#app-content');
  const equipos = await DB.allActive('equipment');
  c.innerHTML = `
    <div class="toolbar">
      <button class="btn" id="hm-import">${ic("upload")}Importar horómetros desde Excel</button>
      <input type="file" id="hm-import-file" accept=".xlsx,.xls,.csv" class="hidden"/>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Actualización rápida de horómetros</h3></div>
      <table class="data-table">
        <thead><tr><th>Código</th><th>Equipo</th><th>Horómetro anterior</th><th>Horómetro actual</th><th></th></tr></thead>
        <tbody>
          ${equipos.map(e => `
            <tr data-id="${e.id}">
              <td class="mono">${e.code}</td>
              <td>${e.brand} ${e.model}</td>
              <td class="mono">${fmt(e.hourmeter)} h</td>
              <td><input type="number" step="0.1" class="input input-sm hm-input" value="${e.hourmeter}"/></td>
              <td><button class="btn btn-sm btn-accent hm-save">${ic("save")}Guardar</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  $$('tr[data-id]', c).forEach(row => {
    row.querySelector('.hm-save').addEventListener('click', async () => {
      const id = row.dataset.id;
      const eq = await DB.get('equipment', id);
      const newVal = parseFloat(row.querySelector('.hm-input').value);
      if (isNaN(newVal)) return;
      if (!confirmHourmeterChange(eq.hourmeter, newVal)) return;
      eq.hourmeter = newVal;
      await DB.put('equipment', stamp(eq, App.currentUser.name));
      await logAudit('HOROMETRO_ACTUALIZADO', `${eq.code} → ${fmt(newVal)} h`, App.currentUser.name);
      renderHorometros();
    });
  });

  $('#hm-import').addEventListener('click', () => $('#hm-import-file').click());
  $('#hm-import-file').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    await handleHourmeterExcelImport(file, equipos);
    ev.target.value = '';
  });
}

async function handleHourmeterExcelImport(file, equipos) {
  let rows;
  try { rows = await readWorkbookRows(file); } catch (err) { alert('No se pudo leer el archivo: ' + err.message); return; }
  if (!rows.length) { alert('El archivo no tiene filas de datos.'); return; }

  const preview = [];
  for (const row of rows) {
    const code = String(pickField(row, 'codigo', 'código', 'code')).trim();
    const val = parseFloat(pickField(row, 'horometro', 'horómetro', 'horometro actual', 'hourmeter'));
    if (!code || isNaN(val)) continue;
    const eq = equipos.find(e => e.code.toLowerCase() === code.toLowerCase());
    if (!eq) { preview.push({ code, found: false }); continue; }
    const check = validateHourmeterChange(eq.hourmeter, val);
    preview.push({ code, found: true, id: eq.id, before: eq.hourmeter, after: val, issue: check.ok !== true ? check.message : null });
  }
  if (!preview.length) { alert('No se encontraron filas válidas con "Código" y "Horómetro".'); return; }
  const withIssues = preview.filter(p => p.issue).length;

  openModal(`Importar horómetros (${preview.length} filas)`, `
    ${withIssues ? `<p style="color:var(--amber); font-size:13px">⚠ ${withIssues} fila(s) tienen un horómetro menor al actual o un salto muy grande — revísalas antes de confirmar (marcadas en rojo/amarillo). Se aplicarán igual si continúas, pero verifica que no sean errores de digitación en tu Excel.</p>` : ''}
    <div style="max-height:40vh; overflow:auto; border:1px solid var(--border); border-radius:8px">
      <table class="data-table">
        <thead><tr><th>Código</th><th>Anterior</th><th>Nuevo</th><th>Estado</th></tr></thead>
        <tbody>${preview.map(p => `<tr>
          <td class="mono">${p.code}</td>
          <td class="mono">${p.found ? fmt(p.before) + ' h' : '—'}</td>
          <td class="mono">${p.found ? fmt(p.after) + ' h' : '—'}</td>
          <td>${!p.found ? '<span style="color:var(--red)">Código no encontrado</span>' : p.issue ? `<span style="color:var(--amber)" title="${p.issue}">⚠ Revisar</span>` : 'OK'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="modal-actions"><button class="btn btn-accent" id="btn-confirm-hm">Aplicar actualización</button></div>
  `);
  $('#btn-confirm-hm').addEventListener('click', async () => {
    let applied = 0;
    for (const p of preview) {
      if (!p.found) continue;
      const eq = await DB.get('equipment', p.id);
      eq.hourmeter = p.after;
      await DB.put('equipment', stamp(eq, App.currentUser.name));
      applied++;
    }
    await logAudit('HOROMETROS_IMPORTADOS', `${applied} equipos actualizados desde Excel`, App.currentUser.name);
    closeModal();
    navigate('horometros');
  });
}

/* ============================================================
   ANOMALÍAS
   ============================================================ */
async function renderAnomalias() {
  const c = $('#app-content');
  const anomalies = (await DB.allActive('anomalies')).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const equipos = await DB.allActive('equipment');

  c.innerHTML = `
    <div class="toolbar">
      <select id="anom-filter" class="input">
        <option value="">Todos los estados</option>
        <option>Abierta</option><option>En atención</option><option>Cerrada</option>
      </select>
      <button class="btn btn-accent" id="btn-new-anom">${ic("plus")}Nueva anomalía</button>
    </div>
    <div class="panel">
      <table class="data-table" id="anom-table">
        <thead><tr><th>Criticidad</th><th>Equipo</th><th>Componente</th><th>Descripción</th><th>Fecha</th><th>Responsable</th><th>Estado</th><th>Foto</th><th></th></tr></thead>
        <tbody></tbody>
      </table>
    </div>`;

  const CRIT_COLOR = { Baja: 'var(--gray-status)', Media: 'var(--amber)', Alta: 'var(--red)', Crítica: '#ff2d2d' };

  function draw(filter = '') {
    const rows = anomalies.filter(a => !filter || a.status === filter);
    $('#anom-table tbody').innerHTML = rows.map(a => {
      const eq = equipos.find(e => e.id === a.equipmentId);
      return `<tr>
        <td><span class="dot" style="background:${CRIT_COLOR[a.criticality]}"></span> ${a.criticality}</td>
        <td class="mono">${eq ? eq.code : '—'}</td>
        <td>${a.component}</td>
        <td>${a.description}</td>
        <td>${fmtDate(a.createdAt)}</td>
        <td>${a.createdBy}</td>
        <td>${a.status}</td>
        <td>${photoThumbHTML(a.photo, `${eq ? eq.code : ''} · ${a.component}`)}</td>
        <td>${a.status !== 'Cerrada' && ['ADMINISTRADOR', 'SUPERVISOR'].includes(App.currentUser.role) ? `<button class="btn btn-sm" data-id="${a.id}">${ic("check")}Cerrar</button>` : ''}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="9" class="empty-state">Sin anomalías registradas.</td></tr>';
    wirePhotoThumbs($('#anom-table'));
    makeTablesResponsive($('#anom-table').closest('.panel'));

    $$('button[data-id]', c).forEach(b => b.addEventListener('click', async () => {
      const a = await DB.get('anomalies', b.dataset.id);
      a.status = 'Cerrada';
      await DB.put('anomalies', stamp(a, App.currentUser.name));
      await logAudit('ANOMALIA_CERRADA', a.id, App.currentUser.name);
      renderAnomalias();
    }));
  }
  draw();
  $('#anom-filter').addEventListener('change', (e) => draw(e.target.value));
  $('#btn-new-anom').addEventListener('click', () => openAnomalyForm());
}

async function openAnomalyForm(equipmentId, equipmentLabel) {
  const equipos = await DB.allActive('equipment');
  openModal('Reportar anomalía', `
    <form id="anom-form" class="form-grid">
      <label>Equipo
        <select name="equipmentId">
          ${equipos.map(e => `<option value="${e.id}" ${e.id === equipmentId ? 'selected' : ''}>${e.code} · ${e.brand} ${e.model}</option>`).join('')}
        </select>
      </label>
      <label>Tipo de anomalía
        <select name="component">
          ${['Grasera dañada', 'Línea de grasa rota', 'Falta de lubricación', 'Buje con juego', 'Pin con desgaste', 'Fuga de aceite', 'Fuga de grasa', 'Sello dañado', 'Manguera dañada', 'Componente flojo', 'Daño estructural', 'Otro'].map(o => `<option>${o}</option>`).join('')}
        </select>
      </label>
      <label>Descripción<textarea required name="description" rows="2"></textarea></label>
      <label>Criticidad
        <select name="criticality">
          <option>Baja</option><option>Media</option><option selected>Alta</option><option>Crítica</option>
        </select>
      </label>
      ${photoFieldHTML()}
      <div class="modal-actions"><button type="submit" class="btn btn-accent">${ic("alert")}Registrar anomalía</button></div>
    </form>
  `);
  wirePhotoField($('#anom-form'));
  $('#anom-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    delete fd.photo;
    const photoData = await getSelectedPhotoDataURL(ev.target);
    const anomaly = stamp({ id: uid('anom'), status: 'Abierta', ...fd, photo: photoData }, App.currentUser.name);
    await DB.put('anomalies', anomaly);
    await logAudit('ANOMALIA_CREADA', anomaly.component, App.currentUser.name);
    closeModal();
    if (App.route === 'anomalias') renderAnomalias();
  });
}

/* ============================================================
   LUBRICANTES
   ============================================================ */
async function renderLubricantes() {
  const c = $('#app-content');
  const lubricants = await DB.allActive('lubricants');
  const records = await DB.allActive('lubrication_records');
  const canEdit = App.currentUser.role === 'ADMINISTRADOR';

  c.innerHTML = `
    <div class="toolbar">
      ${canEdit ? `<button class="btn btn-accent" id="btn-new-lub">${ic("plus")}Nuevo lubricante</button>` : '<span></span>'}
    </div>
    <div class="panel">
      <table class="data-table">
        <thead><tr><th>Nombre</th><th>Marca</th><th>Tipo</th><th>Grado</th><th>Código</th><th>Consumo total (kg)</th>${canEdit ? '<th></th>' : ''}</tr></thead>
        <tbody>
          ${lubricants.map(l => {
            const total = records.filter(r => r.greaseType === l.id).reduce((s, r) => s + (r.qty || 0), 0);
            return `<tr>
              <td>${l.name}</td><td>${l.brand}</td><td>${l.type}</td><td>${l.grade}</td><td class="mono">${l.code}</td><td class="mono">${fmt(total, 1)}</td>
              ${canEdit ? `<td class="row-actions">
                <button class="btn btn-sm lub-edit" data-id="${l.id}">${ic("edit")}Editar</button>
                <button class="btn btn-sm btn-danger lub-remove" data-id="${l.id}">${ic("trash")}Eliminar</button>
              </td>` : ''}
            </tr>`;
          }).join('') || `<tr><td colspan="${canEdit ? 7 : 6}" class="empty-state">Sin lubricantes registrados.</td></tr>`}
        </tbody>
      </table>
    </div>`;
  makeTablesResponsive(c);

  function lubForm(existing) {
    const l = existing || { name: '', brand: '', type: '', grade: '', code: '', unit: 'kg' };
    openModal(existing ? `Editar · ${existing.name}` : 'Nuevo lubricante', `
      <form id="lub-form" class="form-grid">
        <label>Nombre<input required name="name" value="${l.name}"/></label>
        <label>Marca<input name="brand" value="${l.brand}"/></label>
        <label>Tipo<input name="type" value="${l.type}"/></label>
        <label>Grado<input name="grade" placeholder="NLGI 2" value="${l.grade}"/></label>
        <label>Código interno<input name="code" value="${l.code}"/></label>
        <label>Unidad<input name="unit" value="${l.unit || 'kg'}"/></label>
        <div class="modal-actions"><button type="submit" class="btn btn-accent">${existing ? 'Guardar cambios' : 'Guardar'}</button></div>
      </form>`);
    $('#lub-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target).entries());
      const obj = existing ? Object.assign(existing, fd) : { id: uid('lub'), ...fd, active: true };
      await DB.put('lubricants', stamp(obj, App.currentUser.name));
      await logAudit(existing ? 'LUBRICANTE_EDITADO' : 'LUBRICANTE_CREADO', fd.name, App.currentUser.name);
      closeModal();
      renderLubricantes();
    });
  }

  $('#btn-new-lub')?.addEventListener('click', () => lubForm(null));
  $$('.lub-edit', c).forEach(btn => btn.addEventListener('click', async () => {
    lubForm(await DB.get('lubricants', btn.dataset.id));
  }));
  $$('.lub-remove', c).forEach(btn => btn.addEventListener('click', async () => {
    const l = await DB.get('lubricants', btn.dataset.id);
    if (!confirm(`¿Eliminar "${l.name}"? Los engrases que ya lo usaron conservan el historial, solo deja de aparecer como opción para elegir.`)) return;
    l.active = false;
    await DB.put('lubricants', stamp(l, App.currentUser.name));
    await logAudit('LUBRICANTE_ELIMINADO', l.name, App.currentUser.name);
    renderLubricantes();
  }));
}

/* ============================================================
   HISTORIAL
   ============================================================ */
async function renderHistorial() {
  const c = $('#app-content');
  const equipos = await DB.allActive('equipment');
  c.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Historial por equipo</h3></div>
      <select id="hist-equipo" class="input">
        <option value="">— Selecciona un equipo —</option>
        ${equipos.map(e => `<option value="${e.id}">${e.code} · ${e.brand} ${e.model}</option>`).join('')}
      </select>
    </div>
    <div id="hist-area"></div>
  `;
  $('#hist-equipo').addEventListener('change', async (e) => {
    const id = e.target.value;
    if (!id) { $('#hist-area').innerHTML = ''; return; }
    await drawHistory(id);
  });
}

async function drawHistory(equipmentId) {
  const equipment = await DB.get('equipment', equipmentId);
  const records = (await DB.allActive('lubrication_records')).filter(r => r.equipmentId === equipmentId).sort((a, b) => new Date(b.date) - new Date(a.date));
  const anomalies = (await DB.allActive('anomalies')).filter(a => a.equipmentId === equipmentId);
  const lubricants = await DB.allActive('lubricants');
  const isAdmin = App.currentUser.role === 'ADMINISTRADOR';

  let avgInterval = '—';
  if (records.length > 1) {
    const sorted = [...records].sort((a, b) => a.hourmeter - b.hourmeter);
    let diffs = [];
    for (let i = 1; i < sorted.length; i++) diffs.push(sorted[i].hourmeter - sorted[i - 1].hourmeter);
    avgInterval = fmt(diffs.reduce((a, b) => a + b, 0) / diffs.length, 1) + ' h';
  }

  $('#hist-area').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>${equipment.code} · ${equipment.brand} ${equipment.model}</h3></div>
      <div class="detail-grid">
        <div><b>Horómetro actual</b><div class="mono">${fmt(equipment.hourmeter)} h</div></div>
        <div><b>Engrases registrados</b><div>${records.length}</div></div>
        <div><b>Intervalo promedio real</b><div>${avgInterval}</div></div>
        <div><b>Anomalías registradas</b><div>${anomalies.length}</div></div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Engrases</h3></div>
      <table class="data-table">
        <thead><tr><th>Fecha</th><th>Turno</th><th>Horómetro</th><th>Responsable</th><th>Grasa</th><th>Cantidad</th><th>Condición</th><th>Foto</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
        <tbody>
          ${records.map(r => `<tr data-rec="${r.id}">
            <td>${fmtDate(r.date)}</td>
            <td>${r.shiftId === 'shift_dia' ? 'Día' : 'Noche'}</td>
            <td class="mono">${fmt(r.hourmeter)} h</td>
            <td>${r.userName}</td>
            <td>${(lubricants.find(l => l.id === r.greaseType) || {}).name || '—'}</td>
            <td class="mono">${fmt(r.qty, 1)} kg</td>
            <td>${r.condition}</td>
            <td>${photoThumbHTML(r.photo, `${equipment.code} · ${fmtDate(r.date)}`)}</td>
            ${isAdmin ? `<td><button class="btn btn-sm btn-danger btn-del-record" data-id="${r.id}">${ic("trash")}Eliminar</button></td>` : ''}
          </tr>`).join('') || `<tr><td colspan="${isAdmin ? 9 : 8}" class="empty-state">Sin registros.</td></tr>`}
        </tbody>
      </table>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Anomalías</h3></div>
      <table class="data-table">
        <thead><tr><th>Fecha</th><th>Componente</th><th>Descripción</th><th>Criticidad</th><th>Estado</th><th>Foto</th></tr></thead>
        <tbody>
          ${anomalies.map(a => `<tr><td>${fmtDate(a.createdAt)}</td><td>${a.component}</td><td>${a.description}</td><td>${a.criticality}</td><td>${a.status}</td><td>${photoThumbHTML(a.photo, `${equipment.code} · ${a.component}`)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">Sin anomalías.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  wirePhotoThumbs($('#hist-area'));
  makeTablesResponsive($('#hist-area'));

  if (isAdmin) {
    $$('.btn-del-record').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este registro de engrase? Esta acción se guarda como borrado lógico (queda en auditoría) y NO recalcula automáticamente el horómetro ni el plan de engrase del equipo — revísalos manualmente si era el registro más reciente.')) return;
      const rec = await DB.get('lubrication_records', b.dataset.id);
      rec.active = false;
      await DB.put('lubrication_records', stamp(rec, App.currentUser.name));
      await logAudit('ENGRASE_ELIMINADO', `${equipment.code} · ${fmtDate(rec.date)}`, App.currentUser.name);
      drawHistory(equipmentId);
    }));
  }
}

/* ============================================================
   REPORTES
   ============================================================ */
async function renderReportes() {
  const c = $('#app-content');
  const equipos = await DB.allActive('equipment');
  const allRecords = await DB.allActive('lubrication_records');
  const anomalies = await DB.allActive('anomalies');
  const users = await DB.allActive('users');
  const locations = await DB.allActive('locations');
  const lubricants = await DB.allActive('lubricants');
  const statuses = await computeAllStatuses(equipos);

  const total = equipos.length;
  const vencidos = statuses.filter(x => x.s.code === 'ROJO').length;
  const pendientes = statuses.filter(x => x.s.code === 'AMARILLO').length;
  const alDia = statuses.filter(x => x.s.code === 'VERDE').length;
  const compliance = total ? Math.round(((total - vencidos) / total) * 100) : 0;

  const today = new Date();
  const toInput = today.toISOString().slice(0, 10);
  const fromInput = ''; // sin límite por defecto — antes ocultaba silenciosamente todo lo anterior a 30 días

  c.innerHTML = `
    ${total === 0 ? `<div class="panel"><div class="empty-state">No hay equipos registrados en este dispositivo todavía. Si ya los cargaste en otro dispositivo, ve a Configuración → Sincronización y confirma que esté conectado — puede que falte sincronizar.</div></div>` : ''}
    <div class="kpi-grid">
      ${kpiCard('TOTAL EQUIPOS', total, 'neutral')}
      ${kpiCard('AL DÍA', alDia, 'green')}
      ${kpiCard('PENDIENTES', pendientes, 'amber')}
      ${kpiCard('VENCIDOS', vencidos, 'red')}
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Filtros del reporte</h3></div>
      <div class="toolbar" style="padding:0 14px 14px">
        <label class="filter-label">Desde <input type="date" id="f-from" class="input input-sm" value="${fromInput}"/></label>
        <label class="filter-label">Hasta <input type="date" id="f-to" class="input input-sm" value="${toInput}"/></label>
        <label class="filter-label">Equipo
          <select id="f-equipo" class="input input-sm">
            <option value="">Todos</option>
            ${equipos.map(e => `<option value="${e.id}">${e.code} · ${e.brand} ${e.model}</option>`).join('')}
          </select>
        </label>
        <label class="filter-label">Turno
          <select id="f-turno" class="input input-sm">
            <option value="">Ambos</option><option value="shift_dia">Día</option><option value="shift_noche">Noche</option>
          </select>
        </label>
        <label class="filter-label">Responsable
          <select id="f-resp" class="input input-sm">
            <option value="">Todos</option>
            ${users.map(u => `<option value="${u.id}">${u.name}</option>`).join('')}
          </select>
        </label>
        <button class="btn btn-accent" id="f-apply">Aplicar filtros</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Cumplimiento de engrase</h3><span class="pill">${compliance}%</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${compliance}%; background:${compliance >= App.generalSettings.complianceTarget ? 'var(--green)' : compliance >= 80 ? 'var(--amber)' : 'var(--red)'}"></div></div>
    </div>

    <div class="charts-grid">
      <div class="panel"><div class="panel-head"><h3>Engrases por día</h3></div><div class="chart-box"><canvas id="chart-daily"></canvas></div></div>
      <div class="panel"><div class="panel-head"><h3>Engrases por turno</h3></div><div class="chart-box"><canvas id="chart-shift"></canvas></div></div>
      <div class="panel"><div class="panel-head"><h3>Engrases por equipo</h3></div><div class="chart-box"><canvas id="chart-equipo"></canvas></div></div>
      <div class="panel"><div class="panel-head"><h3>Engrases por responsable</h3></div><div class="chart-box"><canvas id="chart-resp"></canvas></div></div>
      <div class="panel"><div class="panel-head"><h3>Estado actual de la flota</h3></div><div class="chart-box"><canvas id="chart-fleet"></canvas></div></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Informe fotográfico</h3></div>
      <div class="dim" style="padding:0 14px 10px">Fotos tomadas al registrar engrases y anomalías. Se filtran igual que las gráficas de arriba.</div>
      <div id="photo-report-grid" class="photo-report-grid"></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Informes ejecutivos</h3></div>
      <div style="padding:0 14px 6px" class="dim">Listos para imprimir o enviar por correo. Usan los mismos filtros de fecha/equipo/turno/responsable de arriba.</div>
      <div class="toolbar" style="padding:0 14px 14px">
        <button class="btn btn-accent" id="exp-pdf">${ic("download")}Informe ejecutivo (PDF)</button>
        <button class="btn btn-accent" id="exp-excel">${ic("download")}Informe completo (Excel)</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Exportar por separado (CSV)</h3></div>
      <div class="toolbar" style="padding:0 14px 14px">
        <button class="btn" id="exp-cumplimiento">${ic("download")}Cumplimiento (CSV)</button>
        <button class="btn" id="exp-historico">${ic("download")}Histórico de engrases (CSV)</button>
        <button class="btn" id="exp-anomalias">${ic("download")}Anomalías (CSV)</button>
      </div>
    </div>`;

  const charts = {};
  function destroyCharts() { Object.values(charts).forEach(ch => ch && ch.destroy()); }

  function applyFilters() {
    const from = $('#f-from').value ? new Date($('#f-from').value + 'T00:00:00') : null;
    const to = $('#f-to').value ? new Date($('#f-to').value + 'T23:59:59') : null;
    const eqId = $('#f-equipo').value;
    const turno = $('#f-turno').value;
    const respId = $('#f-resp').value;
    return allRecords.filter(r => {
      const d = new Date(r.date);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (eqId && r.equipmentId !== eqId) return false;
      if (turno && r.shiftId !== turno) return false;
      if (respId && r.userId !== respId) return false;
      return true;
    });
  }

  function drawCharts() {
    destroyCharts();
    if (!window.Chart) {
      $$('.chart-box', c).forEach(box => box.innerHTML = '<div class="empty-state">No se pudo cargar el motor de gráficas (revisa tu conexión la primera vez que uses esta pantalla, luego funciona sin internet).</div>');
      return;
    }
    try {
      drawChartsInner();
    } catch (err) {
      console.error('Error dibujando reportes', err);
      $$('.chart-box', c).forEach(box => box.innerHTML = `<div class="empty-state">No se pudo generar esta gráfica (${err.message}).</div>`);
    }
  }

  function drawChartsInner() {
    const records = applyFilters();
    const CHART_TEXT = '#9BA3AA';
    const GRID = 'rgba(255,255,255,0.06)';
    Chart.defaults.color = CHART_TEXT;
    Chart.defaults.borderColor = GRID;
    Chart.defaults.font.family = "'Inter', sans-serif";

    // Por día
    const byDay = {};
    records.forEach(r => { const k = new Date(r.date).toLocaleDateString('es-NI', { day: '2-digit', month: '2-digit' }); byDay[k] = (byDay[k] || 0) + 1; });
    const dayKeys = Object.keys(byDay);
    charts.daily = new Chart($('#chart-daily'), {
      type: 'line',
      data: { labels: dayKeys, datasets: [{ label: 'Engrases', data: dayKeys.map(k => byDay[k]), borderColor: '#F2A900', backgroundColor: 'rgba(242,169,0,0.15)', fill: true, tension: 0.3 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });

    // Por turno
    const dia = records.filter(r => r.shiftId === 'shift_dia').length;
    const noche = records.filter(r => r.shiftId === 'shift_noche').length;
    charts.shift = new Chart($('#chart-shift'), {
      type: 'bar',
      data: { labels: ['Día', 'Noche'], datasets: [{ data: [dia, noche], backgroundColor: ['#F2A900', '#3B4A5A'] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });

    // Por equipo
    const byEq = {};
    records.forEach(r => { const eq = equipos.find(e => e.id === r.equipmentId); const k = eq ? eq.code : '—'; byEq[k] = (byEq[k] || 0) + 1; });
    const eqKeys = Object.keys(byEq).sort((a, b) => byEq[b] - byEq[a]).slice(0, 10);
    charts.equipo = new Chart($('#chart-equipo'), {
      type: 'bar',
      data: { labels: eqKeys, datasets: [{ data: eqKeys.map(k => byEq[k]), backgroundColor: '#E8A33D' }] },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
    });

    // Por responsable
    const byResp = {};
    records.forEach(r => { byResp[r.userName] = (byResp[r.userName] || 0) + 1; });
    const respKeys = Object.keys(byResp);
    charts.resp = new Chart($('#chart-resp'), {
      type: 'bar',
      data: { labels: respKeys, datasets: [{ data: respKeys.map(k => byResp[k]), backgroundColor: '#3FB950' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });

    // Estado de la flota
    charts.fleet = new Chart($('#chart-fleet'), {
      type: 'doughnut',
      data: { labels: ['Al día', 'Próximos', 'Vencidos', 'Detenidos/Sin plan'], datasets: [{ data: [alDia, pendientes, vencidos, total - alDia - pendientes - vencidos], backgroundColor: ['#3FB950', '#E8A33D', '#E5484D', '#7A828A'] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } } }
    });

    drawPhotoReport(records);
  }

  function drawPhotoReport(records) {
    const from = $('#f-from').value ? new Date($('#f-from').value + 'T00:00:00') : null;
    const to = $('#f-to').value ? new Date($('#f-to').value + 'T23:59:59') : null;
    const eqId = $('#f-equipo').value;
    const respId = $('#f-resp').value;
    const respUser = respId ? users.find(u => u.id === respId) : null;

    const filteredAnomalies = anomalies.filter(a => {
      const d = new Date(a.createdAt);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (eqId && a.equipmentId !== eqId) return false;
      if (respUser && a.createdBy !== respUser.name) return false;
      return true;
    });

    const photoItems = [
      ...records.filter(r => r.photo).map(r => ({
        photo: r.photo, date: r.date, type: 'Engrase',
        eq: (equipos.find(e => e.id === r.equipmentId) || {}).code || '—', by: r.userName
      })),
      ...filteredAnomalies.filter(a => a.photo).map(a => ({
        photo: a.photo, date: a.createdAt, type: 'Anomalía · ' + a.component,
        eq: (equipos.find(e => e.id === a.equipmentId) || {}).code || '—', by: a.createdBy
      }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    const grid = $('#photo-report-grid');
    grid.innerHTML = photoItems.length ? photoItems.map(p => `
      <div class="photo-report-item">
        <img src="${p.photo}" class="photo-thumb-lg" data-full="${p.photo}" data-caption="${p.eq} · ${p.type} · ${fmtDate(p.date)}"/>
        <div class="photo-report-caption"><b>${p.eq}</b> · ${p.type}<br/>${fmtDate(p.date)} · ${p.by}</div>
      </div>`).join('') : `<div class="empty-state">No hay fotos para el rango y filtros seleccionados.</div>`;

    $$('.photo-thumb-lg', grid).forEach(img => {
      img.addEventListener('click', () => openPhotoLightbox(img.dataset.full, img.dataset.caption));
    });
  }

  drawCharts();
  $('#f-apply').addEventListener('click', drawCharts);

  $('#exp-cumplimiento').addEventListener('click', () => {
    const rows = [['Código', 'Equipo', 'Horómetro', 'Estado', 'Próximo engrase', 'Restante/Atraso']];
    statuses.forEach(({ e, s }) => rows.push([e.code, `${e.brand} ${e.model}`, e.hourmeter, s.label, s.nextHour ?? '', s.remaining ?? '']));
    downloadCSV(rows, 'reporte_cumplimiento_engrase.csv');
  });
  $('#exp-historico').addEventListener('click', () => {
    const records = applyFilters();
    const rows = [['Fecha', 'Equipo', 'Horómetro', 'Turno', 'Responsable', 'Cantidad (kg)', 'Condición']];
    records.forEach(r => {
      const eq = equipos.find(e => e.id === r.equipmentId);
      rows.push([fmtDate(r.date), eq ? eq.code : '', r.hourmeter, r.shiftId === 'shift_dia' ? 'Día' : 'Noche', r.userName, r.qty, r.condition]);
    });
    downloadCSV(rows, 'historico_engrases.csv');
  });
  $('#exp-anomalias').addEventListener('click', () => {
    const rows = [['Fecha', 'Equipo', 'Componente', 'Descripción', 'Criticidad', 'Estado', 'Responsable']];
    anomalies.forEach(a => {
      const eq = equipos.find(e => e.id === a.equipmentId);
      rows.push([fmtDate(a.createdAt), eq ? eq.code : '', a.component, a.description, a.criticality, a.status, a.createdBy]);
    });
    downloadCSV(rows, 'reporte_anomalias.csv');
  });

  $('#exp-excel').addEventListener('click', () => {
    const records = applyFilters();
    const filteredAnomalies = anomalies; // las anomalías se listan completas, con su propia fecha de creación
    const wb = XLSX.utils.book_new();

    // Hoja 1: Resumen ejecutivo
    const wsResumen = XLSX.utils.aoa_to_sheet([
      ['CONTROL DE ENGRASE — OPEN PIT'],
      ['Informe Ejecutivo de Cumplimiento de Engrase'],
      [`Generado: ${fmtDate(nowISO())}  ·  Por: ${App.currentUser.name}`],
      [`Periodo del filtro: ${$('#f-from').value || '(sin definir)'} a ${$('#f-to').value || '(sin definir)'}`],
      [],
      ['Indicador', 'Valor'],
      ['Total de equipos activos', total],
      ['Equipos al día', alDia],
      ['Equipos próximos a vencer', pendientes],
      ['Equipos vencidos', vencidos],
      ['% de cumplimiento de flota', compliance + '%'],
      ['Anomalías abiertas', anomalies.filter(a => a.status !== 'Cerrada').length],
      ['Engrases registrados en el periodo filtrado', records.length],
      [],
      ['Lectura rápida', compliance >= App.generalSettings.complianceTarget
        ? `La flota está dentro del objetivo de cumplimiento (≥${App.generalSettings.complianceTarget}%).`
        : compliance >= 80
          ? 'La flota está por debajo del objetivo (95%). Revisar los equipos vencidos como prioridad.'
          : 'Cumplimiento crítico. Se recomienda intervención inmediata sobre los equipos vencidos.']
    ]);
    wsResumen['!cols'] = [{ wch: 34 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen Ejecutivo');

    // Hoja 2: Equipos y estado de engrase
    const wsEquipos = XLSX.utils.json_to_sheet(statuses.map(({ e, s }) => ({
      'Código': e.code,
      'Cód. Ahorrativo': e.shortCode || '',
      'Marca': e.brand,
      'Modelo': e.model,
      'Ubicación': (locations.find(l => l.id === e.locationId) || {}).name || '',
      'Turno': e.shiftId === 'shift_dia' ? 'Día' : 'Noche',
      'Horómetro (h)': e.hourmeter,
      'Estado': s.label,
      'Próximo engrase (h)': s.nextHour ?? '',
      'Restante/Atraso (h)': s.remaining ?? ''
    })));
    wsEquipos['!cols'] = [{ wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 13 }, { wch: 12 }, { wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsEquipos, 'Equipos');

    // Hoja 3: Histórico de engrases (según filtros)
    const wsHist = XLSX.utils.json_to_sheet(records.map(r => {
      const eq = equipos.find(e => e.id === r.equipmentId);
      return {
        'Fecha': fmtDate(r.date), 'Código': eq ? eq.code : '', 'Equipo': eq ? `${eq.brand} ${eq.model}` : '',
        'Turno': r.shiftId === 'shift_dia' ? 'Día' : 'Noche', 'Responsable': r.userName,
        'Horómetro (h)': r.hourmeter, 'Grasa': (lubricants.find(l => l.id === r.greaseType) || {}).name || '',
        'Cantidad (kg)': r.qty, 'Condición': r.condition, 'Observaciones': r.notes || ''
      };
    }));
    wsHist['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 16 }, { wch: 8 }, { wch: 16 }, { wch: 13 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsHist, 'Histórico Engrases');

    // Hoja 4: Anomalías
    const wsAnom = XLSX.utils.json_to_sheet(filteredAnomalies.map(a => {
      const eq = equipos.find(e => e.id === a.equipmentId);
      return {
        'Fecha': fmtDate(a.createdAt), 'Código': eq ? eq.code : '', 'Componente': a.component,
        'Descripción': a.description, 'Criticidad': a.criticality, 'Estado': a.status, 'Responsable': a.createdBy
      };
    }));
    wsAnom['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 20 }, { wch: 36 }, { wch: 10 }, { wch: 10 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsAnom, 'Anomalías');

    XLSX.writeFile(wb, `informe_ejecutivo_engrase_${new Date().toISOString().slice(0, 10)}.xlsx`);
  });

  $('#exp-pdf').addEventListener('click', () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 0;

    // Encabezado
    doc.setFillColor(20, 23, 26);
    doc.rect(0, 0, pageWidth, 72, 'F');
    doc.setTextColor(242, 169, 0);
    doc.setFont(undefined, 'bold'); doc.setFontSize(17);
    doc.text('CONTROL DE ENGRASE — OPEN PIT', 40, 30);
    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, 'normal'); doc.setFontSize(11);
    doc.text('Informe Ejecutivo de Cumplimiento de Engrase', 40, 48);
    doc.setFontSize(8.5);
    doc.text(`Generado: ${fmtDate(nowISO())}   ·   Por: ${App.currentUser.name}   ·   Periodo: ${$('#f-from').value || '—'} a ${$('#f-to').value || '—'}`, 40, 62);
    y = 100;

    // Tarjetas KPI
    const kpis = [['Total equipos', total], ['Al día', alDia], ['Próximos', pendientes], ['Vencidos', vencidos], ['Cumplimiento', compliance + '%']];
    const gap = 8;
    const boxW = (pageWidth - 80 - gap * (kpis.length - 1)) / kpis.length;
    kpis.forEach((k, i) => {
      const x = 40 + i * (boxW + gap);
      doc.setDrawColor(225); doc.setFillColor(247, 247, 245);
      doc.roundedRect(x, y, boxW, 48, 4, 4, 'FD');
      doc.setTextColor(25, 25, 25); doc.setFont(undefined, 'bold'); doc.setFontSize(15);
      doc.text(String(k[1]), x + 10, y + 24);
      doc.setTextColor(110); doc.setFont(undefined, 'normal'); doc.setFontSize(7.5);
      doc.text(String(k[0]), x + 10, y + 38);
    });
    y += 68;

    // Narrativa
    const openAnom = anomalies.filter(a => a.status !== 'Cerrada').length;
    const target = App.generalSettings.complianceTarget;
    const narrative = `Al día de hoy, la flota registra un cumplimiento de engrase del ${compliance}%. De ${total} equipos activos, ${alDia} están al día, ${pendientes} próximos a vencer y ${vencidos} vencidos que requieren atención inmediata. Actualmente hay ${openAnom} anomalía(s) abierta(s) pendientes de resolución. ${compliance < target ? `Se recomienda priorizar el engrase de los equipos vencidos listados a continuación para volver al objetivo de cumplimiento (≥${target}%).` : `La flota se mantiene dentro del objetivo de cumplimiento definido (≥${target}%).`}`;
    doc.setTextColor(20); doc.setFontSize(9.5);
    const lines = doc.splitTextToSize(narrative, pageWidth - 80);
    doc.text(lines, 40, y);
    y += lines.length * 12 + 16;

    // Tabla: equipos que requieren atención
    const attention = statuses.filter(x => x.s.code === 'ROJO' || x.s.code === 'AMARILLO')
      .sort((a, b) => (a.s.remaining ?? 0) - (b.s.remaining ?? 0));
    doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.setTextColor(20);
    doc.text('Equipos que requieren atención', 40, y); y += 6;
    doc.autoTable({
      startY: y, margin: { left: 40, right: 40 }, styles: { fontSize: 8 }, headStyles: { fillColor: [20, 23, 26] },
      head: [['Estado', 'Código', 'Equipo', 'Horómetro', 'Restante/Atraso']],
      body: attention.length ? attention.map(({ e, s }) => [
        s.label, e.code, `${e.brand} ${e.model}`, fmt(e.hourmeter) + ' h',
        s.remaining != null ? (s.remaining < 0 ? fmt(Math.abs(s.remaining)) + ' h atraso' : fmt(s.remaining) + ' h') : (s.scheduleDate ? WEEKDAY_NAMES[s.scheduleDate.getDay()] : '—')
      ]) : [['—', '—', 'Todos los equipos están al día', '—', '—']]
    });
    y = doc.lastAutoTable.finalY + 20;

    // Tabla: anomalías abiertas
    const openAnomalies = anomalies.filter(a => a.status !== 'Cerrada');
    if (y > 620) { doc.addPage(); y = 40; }
    doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.setTextColor(20);
    doc.text('Anomalías abiertas', 40, y); y += 6;
    doc.autoTable({
      startY: y, margin: { left: 40, right: 40 }, styles: { fontSize: 8 }, headStyles: { fillColor: [229, 72, 77] },
      head: [['Criticidad', 'Código', 'Componente', 'Descripción', 'Estado']],
      body: openAnomalies.length ? openAnomalies.map(a => {
        const eq = equipos.find(e => e.id === a.equipmentId);
        return [a.criticality, eq ? eq.code : '—', a.component, a.description, a.status];
      }) : [['—', '—', '—', 'Sin anomalías abiertas', '—']]
    });
    y = doc.lastAutoTable.finalY + 20;

    // Tabla: histórico de engrases del periodo filtrado (resumen, últimos 40)
    const records = applyFilters().slice(0, 40);
    if (y > 620) { doc.addPage(); y = 40; }
    doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.setTextColor(20);
    doc.text('Histórico de engrases (periodo filtrado)', 40, y); y += 6;
    doc.autoTable({
      startY: y, margin: { left: 40, right: 40 }, styles: { fontSize: 7.5 }, headStyles: { fillColor: [63, 185, 80] },
      head: [['Fecha', 'Código', 'Turno', 'Responsable', 'Horómetro', 'Condición']],
      body: records.length ? records.map(r => {
        const eq = equipos.find(e => e.id === r.equipmentId);
        return [fmtDate(r.date), eq ? eq.code : '', r.shiftId === 'shift_dia' ? 'Día' : 'Noche', r.userName, fmt(r.hourmeter) + ' h', r.condition];
      }) : [['—', '—', '—', '—', '—', 'Sin registros en el periodo']]
    });

    // Pie de página
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7.5); doc.setTextColor(150);
      doc.text(`Página ${i} de ${pageCount}  ·  Control de Engrase — Open Pit`, 40, doc.internal.pageSize.getHeight() - 20);
    }

    doc.save(`informe_ejecutivo_engrase_${new Date().toISOString().slice(0, 10)}.pdf`);
  });
}

/* ============================================================
   FOTOGRAFÍAS: compresión, almacenamiento y visor
   ============================================================ */
function fileToCompressedDataURL(file, maxDim = 1000, quality = 0.72) {
  return new Promise((resolve) => {
    if (!file) { resolve(null); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(null);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function openPhotoLightbox(src, caption) {
  openModal(caption || 'Fotografía', `<img src="${src}" style="width:100%; border-radius:8px; display:block"/>`);
}

function photoThumbHTML(src, caption) {
  if (!src) return '<span class="dim">—</span>';
  return `<img src="${src}" class="photo-thumb" data-full="${src}" data-caption="${(caption || '').replace(/"/g, '&quot;')}" alt="Foto"/>`;
}

function wirePhotoThumbs(container) {
  $$('.photo-thumb', container).forEach(img => {
    img.addEventListener('click', () => openPhotoLightbox(img.dataset.full, img.dataset.caption));
  });
}

function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ============================================================
   USUARIOS
   ============================================================ */
async function renderUsuarios() {
  const c = $('#app-content');
  const isSupervisor = App.currentUser.role === 'SUPERVISOR';
  // Un supervisor solo administra cuentas de lubricadores; el administrador ve y crea todos los roles.
  const allUsers = await DB.allActive('users');
  const users = isSupervisor ? allUsers.filter(u => u.role === 'LUBRICADOR') : allUsers;
  const rolesDisponibles = isSupervisor ? ['LUBRICADOR'] : Object.keys(PERMISSIONS);
  const cuadrillas = await DB.allActive('cuadrillas');

  c.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-accent" id="btn-new-lubricador">${ic("plus")}Nuevo lubricador</button>
      ${!isSupervisor ? `<button class="btn" id="btn-new-user">+ Otro tipo de usuario</button>` : ''}
    </div>
    <div class="panel">
      <table class="data-table">
        <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Cuadrilla</th><th></th></tr></thead>
        <tbody>
          ${users.map(u => `<tr>
            <td>${u.name}</td><td class="mono">${u.username}</td><td>${u.role}</td>
            <td>${u.role === 'LUBRICADOR' ? ((cuadrillas.find(cq => cq.id === u.cuadrillaId) || {}).name || '—') : '—'}</td>
            <td class="row-actions">
              <button class="btn btn-sm" data-edit="${u.id}">${ic("edit")}Editar</button>
              ${u.id !== App.currentUser.id ? `<button class="btn btn-sm btn-danger" data-deactivate="${u.id}">${ic("trash")}Desactivar</button>` : ''}
            </td></tr>`).join('') || '<tr><td colspan="5" class="empty-state">Sin usuarios lubricadores registrados.</td></tr>'}
        </tbody>
      </table>
    </div>`;

  function userForm(existing, lockRoleToLubricador) {
    const u = existing || { name: '', username: '', pin: '', role: 'LUBRICADOR', cuadrillaId: '' };
    openModal(existing ? `Editar usuario · ${existing.name}` : 'Nuevo lubricador', `
      <form id="user-form" class="form-grid">
        <label>Nombre completo<input required name="name" value="${u.name}"/></label>
        <label>Usuario<input required name="username" value="${u.username}"/></label>
        <label>PIN (4 dígitos)<input required name="pin" maxlength="4" pattern="\\d{4}" value="${u.pin}"/></label>
        <label>Rol
          ${lockRoleToLubricador
            ? `<input type="text" disabled value="LUBRICADOR"/><input type="hidden" name="role" value="LUBRICADOR"/>`
            : `<select name="role">${rolesDisponibles.map(r => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select>`}
        </label>
        <label>Cuadrilla de lubricación
          <select name="cuadrillaId">
            <option value="">— Sin asignar —</option>
            ${cuadrillas.map(cq => `<option value="${cq.id}" ${cq.id === u.cuadrillaId ? 'selected' : ''}>${cq.name}</option>`).join('')}
          </select>
          <span class="field-hint">Determina qué equipos ve en "Mi Turno" cuando el equipo también tiene cuadrilla asignada, para que dos cuadrillas no engrasen el mismo equipo.</span>
        </label>
        <div class="modal-actions"><button type="submit" class="btn btn-accent">${existing ? 'Guardar cambios' : 'Crear usuario'}</button></div>
      </form>`);
    $('#user-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target).entries());
      const obj = existing ? Object.assign(existing, fd) : { id: uid('u'), ...fd, active: true };
      await DB.put('users', stamp(obj, App.currentUser.name));
      await logAudit(existing ? 'USUARIO_EDITADO' : 'USUARIO_CREADO', fd.username, App.currentUser.name);
      closeModal();
      renderUsuarios();
    });
  }

  $('#btn-new-lubricador').addEventListener('click', () => userForm(null, true));
  $('#btn-new-user')?.addEventListener('click', () => userForm(null, false));

  $$('button[data-edit]', c).forEach(b => b.addEventListener('click', async () => {
    const u = await DB.get('users', b.dataset.edit);
    userForm(u, isSupervisor || u.role === 'LUBRICADOR');
  }));
  $$('button[data-deactivate]', c).forEach(b => b.addEventListener('click', async () => {
    const u = await DB.get('users', b.dataset.deactivate);
    if (isSupervisor && u.role !== 'LUBRICADOR') return;
    u.active = false;
    await DB.put('users', stamp(u, App.currentUser.name));
    await logAudit('USUARIO_DESACTIVADO', u.username, App.currentUser.name);
    renderUsuarios();
  }));
}

/* ============================================================
   CONFIGURACIÓN
   ============================================================ */
/* ============================================================
   AYUDA — puntos de engrase por familia de equipo (gráfico)
   ============================================================ */
const EQUIPMENT_FAMILIES = [
  {
    id: 'articulado', name: 'Camión Articulado', svg: 'articulado',
    zones: [
      { name: 'Delantero', color: 'var(--green)', points: ['Cilindro de dirección izquierdo', 'Cilindro de dirección derecho', 'Suspensión delantera izquierda', 'Suspensión delantera derecha'] },
      { name: 'Articulación central', color: 'var(--accent)', points: ['Pasador de articulación central', 'Pasadores de la cabina', 'Bisagra de la góndola'] },
      { name: 'Trasero / transmisión', color: 'var(--red)', points: ['Cruz cardán delantera', 'Cruz cardán trasera', 'Suspensión trasera', 'Rodamiento de enganche', 'Pines de la tolva'] }
    ]
  },
  {
    id: 'excavadora', name: 'Excavadora de Orugas', svg: 'excavadora',
    zones: [
      { name: 'Base / giro', color: 'var(--green)', points: ['Tornamesa (giro)', 'Rodillos de oruga'] },
      { name: 'Boom y stick', color: 'var(--accent)', points: ['Articulación boom/stick', 'Cilindro del boom (izq. y der.)', 'Cilindro del stick'] },
      { name: 'Cucharón', color: 'var(--red)', points: ['Varillaje del cucharón', 'Cilindro del cucharón (bastago y botella)'] }
    ]
  },
  {
    id: 'tractor', name: 'Tractor de Orugas', svg: 'tractor',
    zones: [
      { name: 'Cuchilla (blade)', color: 'var(--green)', points: ['Cilindros de inclinación de la hoja', 'Cojinetes de los cilindros de levantamiento', 'Tirante de inclinación'] },
      { name: 'Chasis', color: 'var(--accent)', points: ['Barra ecualizadora', 'Rodillos de oruga'] },
      { name: 'Desgarrador (ripper)', color: 'var(--red)', points: ['Varillaje y cojinetes del cilindro del desgarrador'] }
    ]
  },
  {
    id: 'volquete', name: 'Camión Volquete', svg: 'volquete',
    zones: [
      { name: 'Dirección / ejes', color: 'var(--green)', points: ['Columnas y muñequillas de dirección', 'Ejes delanteros y traseros'] },
      { name: 'Frenos', color: 'var(--accent)', points: ['Rash de frenos delanteros y traseros', '"S" de freno'] },
      { name: 'Tolva', color: 'var(--red)', points: ['Cruz cardánica de la barra de ejes traseros', 'Cilindro de levante y pines de la tolva', 'Trunnion trasero'] }
    ]
  },
  {
    id: 'generico', name: 'Motoniveladora / Cargador Frontal / Retroexcavadora', svg: 'generico',
    zones: [
      { name: 'Implemento (hoja, cuchara o balde)', color: 'var(--green)', points: ['Pines de acople del implemento', 'Cilindros hidráulicos del implemento'] },
      { name: 'Articulación / chasis', color: 'var(--accent)', points: ['Articulación central (si aplica)', 'Pasadores de bastidor', 'Rodamientos de rueda o eje'] },
      { name: 'Transmisión', color: 'var(--red)', points: ['Cardanes', 'Bisagras y bujes de brazo'] }
    ],
    generic: true
  }
];

function familySilhouetteSvg(kind) {
  const svgs = {
    articulado: `<svg viewBox="0 0 300 120" class="family-svg">
      <rect x="10" y="55" width="70" height="35" rx="6" fill="none" stroke="var(--green)" stroke-width="3"/>
      <circle cx="30" cy="95" r="12" fill="none" stroke="var(--text-dim)" stroke-width="3"/>
      <circle cx="70" cy="95" r="12" fill="none" stroke="var(--text-dim)" stroke-width="3"/>
      <circle cx="150" cy="70" r="10" fill="var(--accent)"/>
      <rect x="160" y="45" width="130" height="45" rx="6" fill="none" stroke="var(--red)" stroke-width="3"/>
      <circle cx="200" cy="95" r="12" fill="none" stroke="var(--text-dim)" stroke-width="3"/>
      <circle cx="250" cy="95" r="12" fill="none" stroke="var(--text-dim)" stroke-width="3"/>
      <line x1="80" y1="70" x2="140" y2="70" stroke="var(--text-dim)" stroke-width="3"/>
    </svg>`,
    excavadora: `<svg viewBox="0 0 300 130" class="family-svg">
      <rect x="20" y="80" width="180" height="20" rx="4" fill="none" stroke="var(--green)" stroke-width="3"/>
      <circle cx="45" cy="100" r="10" fill="none" stroke="var(--text-dim)" stroke-width="3"/>
      <circle cx="175" cy="100" r="10" fill="none" stroke="var(--text-dim)" stroke-width="3"/>
      <rect x="60" y="45" width="60" height="35" rx="6" fill="none" stroke="var(--text-dim)" stroke-width="3"/>
      <circle cx="120" cy="55" r="8" fill="var(--accent)"/>
      <line x1="120" y1="55" x2="220" y2="35" stroke="var(--accent)" stroke-width="5"/>
      <line x1="220" y1="35" x2="270" y2="70" stroke="var(--accent)" stroke-width="5"/>
      <path d="M270 70 L290 65 L285 90 L265 88 Z" fill="none" stroke="var(--red)" stroke-width="4"/>
    </svg>`,
    tractor: `<svg viewBox="0 0 300 120" class="family-svg">
      <rect x="60" y="65" width="170" height="18" rx="4" fill="none" stroke="var(--accent)" stroke-width="3"/>
      <circle cx="85" cy="83" r="9" fill="none" stroke="var(--text-dim)" stroke-width="3"/>
      <circle cx="205" cy="83" r="9" fill="none" stroke="var(--text-dim)" stroke-width="3"/>
      <rect x="110" y="35" width="55" height="30" rx="5" fill="none" stroke="var(--text-dim)" stroke-width="3"/>
      <path d="M20 90 L20 55 L60 65 L60 90 Z" fill="none" stroke="var(--green)" stroke-width="4"/>
      <line x1="230" y1="70" x2="270" y2="55" stroke="var(--red)" stroke-width="4"/>
      <line x1="270" y1="55" x2="270" y2="85" stroke="var(--red)" stroke-width="4"/>
    </svg>`,
    volquete: `<svg viewBox="0 0 300 120" class="family-svg">
      <rect x="20" y="45" width="55" height="45" rx="6" fill="none" stroke="var(--green)" stroke-width="3"/>
      <rect x="85" y="35" width="195" height="55" rx="6" fill="none" stroke="var(--red)" stroke-width="3"/>
      <circle cx="45" cy="95" r="11" fill="none" stroke="var(--accent)" stroke-width="3"/>
      <circle cx="110" cy="95" r="11" fill="none" stroke="var(--accent)" stroke-width="3"/>
      <circle cx="150" cy="95" r="11" fill="none" stroke="var(--accent)" stroke-width="3"/>
      <circle cx="230" cy="95" r="11" fill="none" stroke="var(--accent)" stroke-width="3"/>
    </svg>`,
    generico: `<svg viewBox="0 0 300 120" class="family-svg">
      <rect x="70" y="55" width="150" height="35" rx="6" fill="none" stroke="var(--accent)" stroke-width="3"/>
      <circle cx="100" cy="95" r="11" fill="none" stroke="var(--text-dim)" stroke-width="3"/>
      <circle cx="190" cy="95" r="11" fill="none" stroke="var(--text-dim)" stroke-width="3"/>
      <path d="M20 90 L20 60 L70 70 L70 90 Z" fill="none" stroke="var(--green)" stroke-width="4"/>
      <line x1="220" y1="60" x2="270" y2="45" stroke="var(--red)" stroke-width="4"/>
      <line x1="270" y1="45" x2="270" y2="80" stroke="var(--red)" stroke-width="4"/>
    </svg>`
  };
  return svgs[kind] || svgs.generico;
}

const DEFAULT_FAQ = [
  { id: 'faq1', question: '¿Qué significa cada color del semáforo?', answer: '🟢 Verde: al día. 🟡 Amarillo: próximo a vencer (o programado para hoy en equipos con control por día/turno). 🔴 Rojo: vencido, requiere atención. ⚪ Gris: equipo detenido o sin plan configurado.' },
  { id: 'faq2', question: '¿Qué hago si un punto de engrase no se puede lubricar?', answer: 'En el checklist, desmarca el punto y selecciona el motivo (grasera dañada, punto inaccesible, etc.). Queda registrado para que mantenimiento le dé seguimiento.' },
  { id: 'faq3', question: '¿Cuándo uso control "por horas" y cuándo "por día y turno"?', answer: 'Usa horas cuando el equipo tiene horómetro y se actualiza seguido. Usa "Día y turno de la semana" cuando no se registra horómetro a diario — el plan de la Mina Volcán es un ejemplo de esto.' },
  { id: 'faq4', question: '¿La app funciona sin internet?', answer: 'Sí. Todo se guarda primero en el celular y se sincroniza solo cuando hay conexión.' }
];

// Los puntos pueden venir como texto plano (formato viejo) o como {text, photo}
// (formato nuevo, con foto). Esto normaliza cualquiera de los dos a objeto.
function normalizePoint(p) {
  if (typeof p === 'string') return { id: uid('pt'), text: p, photo: null };
  return { id: p.id || uid('pt'), text: p.text || '', photo: p.photo || null };
}

async function getHelpContent() {
  let help = await DB.get('settings', 'help_content');
  if (!help) {
    help = stamp({ id: 'help_content', families: EQUIPMENT_FAMILIES, faq: DEFAULT_FAQ }, 'sistema');
    await DB.put('settings', help);
  }
  help.families.forEach(f => f.zones.forEach(z => { z.points = (z.points || []).map(normalizePoint); }));
  return help;
}

function familyCardHTML(fam, canEdit) {
  return `
    <div class="panel family-card" data-family-id="${fam.id}">
      <div class="panel-head">
        <h3>${fam.name}</h3>
        ${canEdit ? `<button class="btn btn-sm family-edit-btn" data-id="${fam.id}">${ic("edit")}Editar</button>` : ''}
      </div>
      <div class="family-body">
        <div class="family-diagram">${familySilhouetteSvg(fam.svg)}</div>
        <div class="family-zones">
          ${fam.zones.map(z => `
            <div class="family-zone">
              <div class="family-zone-title"><span class="dot" style="background:${z.color}"></span>${z.name}</div>
              <ul class="family-zone-list">${z.points.map(p => `<li>${p.photo ? photoThumbHTML(p.photo, p.text) : ''}<span>${p.text}</span></li>`).join('')}</ul>
            </div>`).join('')}
        </div>
      </div>
      ${fam.generic ? '<div class="dim" style="padding:0 14px 14px">Puntos de referencia general — verifica el manual del fabricante para el modelo específico de tu equipo.</div>' : ''}
    </div>`;
}

async function renderAyuda() {
  const c = $('#app-content');
  const canEdit = App.currentUser.role === 'ADMINISTRADOR';
  const help = await getHelpContent();

  c.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Guía de puntos de engrase por familia de equipo</h3></div>
      <div class="dim" style="padding:0 14px 14px">Referencia visual rápida. Los diagramas son esquemáticos (no a escala ni específicos de una marca) — para el detalle exacto de tu equipo, usa "Plan de Engrase → Configurar" donde están los puntos reales configurados.</div>
      ${canEdit ? `<div class="toolbar" style="padding:0 14px 14px"><button class="btn btn-accent" id="family-add-btn">${ic("plus")}Agregar familia de equipo</button></div>` : ''}
    </div>
    ${help.families.map(f => familyCardHTML(f, canEdit)).join('')}
    <div class="panel">
      <div class="panel-head">
        <h3>Preguntas frecuentes</h3>
        ${canEdit ? `<button class="btn btn-sm" id="faq-edit-btn">Editar preguntas</button>` : ''}
      </div>
      <div style="padding:4px 14px 14px">
        ${help.faq.map(f => `<details class="faq-item"><summary>${f.question}</summary><p>${f.answer}</p></details>`).join('') || '<div class="empty-state">Sin preguntas todavía.</div>'}
      </div>
    </div>`;
  wirePhotoThumbs(c);

  if (!canEdit) return;
  $('#family-add-btn').addEventListener('click', () => openFamilyEditForm(help, null));
  $('#faq-edit-btn').addEventListener('click', () => openFaqEditForm(help));
  $$('.family-edit-btn', c).forEach(btn => {
    btn.addEventListener('click', () => openFamilyEditForm(help, help.families.find(f => f.id === btn.dataset.id)));
  });
}

/* ---------- Edición de familias de equipo (solo Administrador) ---------- */
function openFamilyEditForm(help, existing) {
  const fam = existing || { id: uid('fam'), name: '', svg: 'generico', generic: true, zones: [{ name: 'General', color: 'var(--accent)', points: [] }] };
  const isNew = !existing;

  function bodyHTML() {
    return `
      <form id="family-form">
        <label>Nombre de la familia<input required id="fam-name" value="${fam.name}"/></label>
        <div id="fam-zones-area" style="margin-top:14px"></div>
        <button type="button" class="btn btn-sm" id="fam-add-zone">${ic("plus")}Agregar zona</button>
        <div class="modal-actions">
          ${!isNew ? `<button type="button" class="btn btn-danger" id="fam-delete">${ic("trash")}Eliminar familia</button>` : ''}
          <button type="submit" class="btn btn-accent">${ic("save")}Guardar</button>
        </div>
      </form>`;
  }

  function pointRowEditorHTML(p) {
    return `
      <div class="pt-editor-row" data-existing-photo="${p.photo || ''}">
        <div class="pt-editor-top">
          <input class="pt-text" placeholder="Ej. Cilindro de dirección izquierdo" value="${p.text}"/>
          <button type="button" class="btn btn-sm btn-danger pt-remove-row">✕</button>
        </div>
        ${p.photo ? `
          <div class="pt-current-photo">
            ${photoThumbHTML(p.photo, p.text)}
            <label class="pt-remove-photo-label"><input type="checkbox" class="pt-remove-photo"/> Quitar esta foto</label>
          </div>` : ''}
        ${photoFieldHTML()}
      </div>`;
  }

  function zonesHTML() {
    const colors = [['var(--green)', 'Verde'], ['var(--accent)', 'Ámbar'], ['var(--red)', 'Rojo']];
    return fam.zones.map((z, i) => `
      <div class="fam-zone-editor" data-zi="${i}">
        <div class="form-grid">
          <label>Nombre de zona<input class="fz-name" value="${z.name}"/></label>
          <label>Color
            <select class="fz-color">${colors.map(([v, l]) => `<option value="${v}" ${z.color === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          </label>
        </div>
        <div class="pt-list" data-zi="${i}">
          ${z.points.map(pointRowEditorHTML).join('') || '<div class="empty-state">Sin puntos todavía.</div>'}
        </div>
        <div class="row-actions" style="margin-top:8px">
          <button type="button" class="btn btn-sm pt-add" data-zi="${i}">${ic("plus")}Agregar punto con foto</button>
          <button type="button" class="btn btn-sm btn-danger fz-remove">Eliminar esta zona</button>
        </div>
      </div>`).join('');
  }

  openModal(isNew ? 'Nueva familia de equipo' : `Editar · ${fam.name}`, bodyHTML());

  function renderZones() {
    $('#fam-zones-area').innerHTML = zonesHTML();
    $$('.pt-editor-row', $('#fam-zones-area')).forEach(row => wirePhotoField(row));
    wirePhotoThumbs($('#fam-zones-area'));
    wireZoneEvents();
  }

  function wireZoneEvents() {
    $$('.fz-remove', $('#fam-zones-area')).forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.closest('.fam-zone-editor').dataset.zi, 10);
        fam.zones.splice(i, 1);
        renderZones();
      });
    });
    $$('.pt-add', $('#fam-zones-area')).forEach(btn => {
      btn.addEventListener('click', () => {
        const zi = parseInt(btn.dataset.zi, 10);
        fam.zones[zi].points.push({ id: uid('pt'), text: '', photo: null });
        renderZones();
      });
    });
    $$('.pt-remove-row', $('#fam-zones-area')).forEach(btn => {
      btn.addEventListener('click', () => {
        const zoneEl = btn.closest('.fam-zone-editor');
        const zi = parseInt(zoneEl.dataset.zi, 10);
        const rowEl = btn.closest('.pt-editor-row');
        const pi = Array.from(zoneEl.querySelectorAll('.pt-editor-row')).indexOf(rowEl);
        fam.zones[zi].points.splice(pi, 1);
        renderZones();
      });
    });
  }

  renderZones();

  $('#fam-add-zone').addEventListener('click', () => {
    fam.zones.push({ name: '', color: 'var(--accent)', points: [] });
    renderZones();
  });

  $('#fam-delete')?.addEventListener('click', async () => {
    if (!confirm(`¿Eliminar la familia "${fam.name}"? Esto no afecta los planes de engrase ya configurados por equipo, solo esta guía.`)) return;
    help.families = help.families.filter(f => f.id !== fam.id);
    await DB.put('settings', stamp(help, App.currentUser.name));
    await logAudit('AYUDA_ACTUALIZADA', `Familia eliminada: ${fam.name}`, App.currentUser.name);
    closeModal();
    renderAyuda();
  });

  $('#family-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    fam.name = $('#fam-name').value.trim() || 'Sin nombre';

    const zoneEls = $$('.fam-zone-editor', $('#fam-zones-area'));
    for (let zi = 0; zi < zoneEls.length; zi++) {
      const zoneEl = zoneEls[zi];
      fam.zones[zi].name = zoneEl.querySelector('.fz-name').value.trim() || 'Zona';
      fam.zones[zi].color = zoneEl.querySelector('.fz-color').value;

      const rowEls = $$('.pt-editor-row', zoneEl);
      for (let pi = 0; pi < rowEls.length; pi++) {
        const row = rowEls[pi];
        const text = row.querySelector('.pt-text').value.trim();
        const newPhoto = await getSelectedPhotoDataURL(row);
        const removeChecked = row.querySelector('.pt-remove-photo')?.checked;
        const existingPhoto = row.dataset.existingPhoto || null;
        fam.zones[zi].points[pi].text = text;
        fam.zones[zi].points[pi].photo = newPhoto || (removeChecked ? null : existingPhoto);
      }
      // descarta puntos que quedaron sin texto y sin foto
      fam.zones[zi].points = fam.zones[zi].points.filter(p => p.text || p.photo);
    }

    if (isNew) help.families.push(fam);
    await DB.put('settings', stamp(help, App.currentUser.name));
    await logAudit('AYUDA_ACTUALIZADA', `Familia guardada: ${fam.name}`, App.currentUser.name);
    closeModal();
    renderAyuda();
  });
}

/* ---------- Edición de preguntas frecuentes (solo Administrador) ---------- */
function openFaqEditForm(help) {
  function bodyHTML() {
    return `
      <div id="faq-editor-area">
        ${help.faq.map((f, i) => `
          <div class="faq-editor-row" data-fi="${i}">
            <input class="faq-q" placeholder="Pregunta" value="${f.question}"/>
            <textarea class="faq-a" placeholder="Respuesta" rows="2">${f.answer}</textarea>
            <button type="button" class="btn btn-sm btn-danger faq-remove">${ic("trash")}Eliminar</button>
          </div>`).join('')}
      </div>
      <button type="button" class="btn btn-sm" id="faq-add-btn">${ic("plus")}Agregar pregunta</button>
      <div class="modal-actions"><button type="button" class="btn btn-accent" id="faq-save-btn">${ic("save")}Guardar</button></div>`;
  }
  openModal('Editar preguntas frecuentes', bodyHTML());

  function wireRemove() {
    $$('.faq-remove', $('#faq-editor-area')).forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.closest('.faq-editor-row').dataset.fi, 10);
        help.faq.splice(i, 1);
        $('#faq-editor-area').outerHTML = bodyHTML();
        wireAll();
      });
    });
  }
  function wireAll() {
    wireRemove();
    $('#faq-add-btn').addEventListener('click', () => {
      help.faq.push({ id: uid('faq'), question: '', answer: '' });
      $('#faq-editor-area').outerHTML = bodyHTML();
      wireAll();
    });
    $('#faq-save-btn').addEventListener('click', async () => {
      $$('.faq-editor-row').forEach((el, i) => {
        help.faq[i].question = el.querySelector('.faq-q').value.trim();
        help.faq[i].answer = el.querySelector('.faq-a').value.trim();
      });
      help.faq = help.faq.filter(f => f.question); // descarta preguntas vacías
      await DB.put('settings', stamp(help, App.currentUser.name));
      await logAudit('AYUDA_ACTUALIZADA', 'Preguntas frecuentes actualizadas', App.currentUser.name);
      closeModal();
      renderAyuda();
    });
  }
  wireAll();
}

/* ---------- Gestor genérico de listas simples {id, name} (cuadrillas, ubicaciones, categorías) ---------- */
async function simpleListPanelHTML(store, title, hint) {
  const items = await DB.allActive(store);
  return `
    <div class="panel" data-simple-store="${store}">
      <div class="panel-head"><h3>${title}</h3></div>
      ${hint ? `<div class="dim" style="padding:0 14px 10px">${hint}</div>` : ''}
      <div class="simple-list">
        ${items.map(it => `
          <div class="simple-list-row" data-id="${it.id}">
            <span class="simple-list-name">${it.name}</span>
            <div class="row-actions">
              <button class="btn btn-sm sl-rename">Renombrar</button>
              <button class="btn btn-sm btn-danger sl-remove">${ic("trash")}Eliminar</button>
            </div>
          </div>`).join('') || '<div class="empty-state">Sin elementos todavía.</div>'}
      </div>
      <div class="toolbar" style="padding:10px 14px">
        <input class="input sl-new-input" placeholder="Nombre nuevo…"/>
        <button class="btn btn-accent sl-add">${ic("plus")}Agregar</button>
      </div>
    </div>`;
}

function wireSimpleListPanel(container, store, onChange) {
  const panel = container.querySelector(`[data-simple-store="${store}"]`);
  if (!panel) return;
  panel.querySelector('.sl-add').addEventListener('click', async () => {
    const input = panel.querySelector('.sl-new-input');
    const name = input.value.trim();
    if (!name) return;
    await DB.put(store, stamp({ id: uid(store.slice(0, 3)), name, active: true }, App.currentUser.name));
    await logAudit('LISTA_ACTUALIZADA', `${store}: agregado "${name}"`, App.currentUser.name);
    onChange();
  });
  panel.querySelectorAll('.sl-rename').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.simple-list-row');
      const id = row.dataset.id;
      const current = row.querySelector('.simple-list-name').textContent;
      const newName = prompt('Nuevo nombre:', current);
      if (!newName || !newName.trim() || newName === current) return;
      const item = await DB.get(store, id);
      item.name = newName.trim();
      await DB.put(store, stamp(item, App.currentUser.name));
      await logAudit('LISTA_ACTUALIZADA', `${store}: "${current}" → "${newName}"`, App.currentUser.name);
      onChange();
    });
  });
  panel.querySelectorAll('.sl-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.simple-list-row');
      const id = row.dataset.id;
      const name = row.querySelector('.simple-list-name').textContent;
      if (!confirm(`¿Eliminar "${name}"? Los equipos o usuarios que ya lo tengan asignado no se modifican, pero dejará de aparecer como opción para elegir.`)) return;
      const item = await DB.get(store, id);
      item.active = false;
      await DB.put(store, stamp(item, App.currentUser.name));
      await logAudit('LISTA_ACTUALIZADA', `${store}: eliminado "${name}"`, App.currentUser.name);
      onChange();
    });
  });
}

/* ---------- Respaldo completo: exportar / restaurar todos los datos ---------- */
async function exportFullBackup() {
  const backup = { exportedAt: nowISO(), exportedBy: App.currentUser.name, appVersion: DB_VERSION, data: {} };
  for (const store of STORES) {
    backup.data[store] = await DB.all(store);
  }
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `respaldo_engrase_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  await logAudit('RESPALDO_DESCARGADO', `${Object.values(backup.data).reduce((s, r) => s + r.length, 0)} registros`, App.currentUser.name);
}

async function previewAndImportBackup(file) {
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch (err) { alert('El archivo no es un respaldo válido (no es JSON).'); return; }
  if (!backup || !backup.data) { alert('El archivo no tiene el formato esperado de un respaldo de esta app.'); return; }

  const counts = Object.keys(backup.data)
    .filter(store => STORES.includes(store))
    .map(store => ({ store, count: (backup.data[store] || []).length }))
    .filter(c => c.count > 0);

  openModal('Restaurar respaldo', `
    <p class="dim">Respaldo generado ${backup.exportedAt ? fmtDate(backup.exportedAt) : '(fecha desconocida)'} por ${backup.exportedBy || 'desconocido'}.</p>
    <table class="data-table">
      <thead><tr><th>Tabla</th><th>Registros a restaurar</th></tr></thead>
      <tbody>${counts.map(c => `<tr><td>${c.store}</td><td class="mono">${c.count}</td></tr>`).join('') || '<tr><td colspan="2" class="empty-state">El archivo no tiene datos reconocibles.</td></tr>'}</tbody>
    </table>
    <p class="dim" style="margin-top:10px">Esto NO borra tus datos actuales — combina lo del archivo con lo que ya tienes (gana el registro más reciente en caso de choque).</p>
    <div class="modal-actions"><button class="btn btn-accent" id="btn-confirm-restore">Restaurar ahora</button></div>
  `);

  $('#btn-confirm-restore').addEventListener('click', async () => {
    let applied = 0;
    for (const { store } of counts) {
      for (const row of backup.data[store]) {
        await DB.put(store, row);
        applied++;
      }
    }
    await loadGeneralSettings();
    await logAudit('RESPALDO_RESTAURADO', `${applied} registros desde archivo de ${backup.exportedAt || '?'}`, App.currentUser.name);
    closeModal();
    alert(`Listo, se restauraron ${applied} registros.`);
    renderConfig();
  });
}

async function renderConfig() {
  const c = $('#app-content');
  const cfg = (await DB.getConfig()) || {};
  const log = (await DB.all('audit_log')).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);
  const pending = await Sync.pendingCount();
  const notif = (await DB.get('settings', 'notifications')) || {
    id: 'notifications', enabled: true, lubricadorDiaHour: 6, lubricadorDiaMinute: 0,
    lubricadorNocheHour: 18, lubricadorNocheMinute: 0, complianceHour: 7, complianceMinute: 0,
    weekdayPlanEnabled: false, weekdayPlanHour: 7, weekdayPlanMinute: 30
  };
  const gen = App.generalSettings;
  const pad = n => String(n).padStart(2, '0');
  const timeVal = (h, m) => `${pad(h)}:${pad(m)}`;

  c.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Turnos y umbrales generales</h3></div>
      <div style="padding:14px">
        <p class="dim">Estos valores controlan toda la app: qué hora se considera turno día/noche, cuánto antes se marca "próximo a vencer" un plan nuevo, y la meta de cumplimiento que se muestra en Dashboard y Reportes.</p>
        <form id="general-form" class="form-grid">
          <label>Inicio del turno Día<input type="time" name="shiftDayStart" value="${pad(gen.shiftDayStart)}:00"/></label>
          <label>Inicio del turno Noche<input type="time" name="shiftNightStart" value="${pad(gen.shiftNightStart)}:00"/></label>
          <label>Alerta amarilla por defecto (horas antes)<input type="number" name="defaultAlertYellowHours" value="${gen.defaultAlertYellowHours}"/></label>
          <label>Meta de cumplimiento de flota (%)<input type="number" min="1" max="100" name="complianceTarget" value="${gen.complianceTarget}"/></label>
          <div class="modal-actions" style="grid-column:1/-1; justify-content:flex-start">
            <button type="submit" class="btn btn-accent">${ic("save")}Guardar</button>
          </div>
        </form>
      </div>
    </div>
    ${await simpleListPanelHTML('cuadrillas', 'Cuadrillas de lubricación', 'Se asignan a lubricadores (Usuarios) y a equipos (ficha del equipo) para que dos cuadrillas no engrasen el mismo equipo.')}
    ${await simpleListPanelHTML('locations', 'Ubicaciones / Flotas', 'Aparecen como opción de "Ubicación" al crear o editar un equipo.')}
    ${await simpleListPanelHTML('equipment_types', 'Categorías de equipo', 'Aparecen como opción de "Categoría" al crear o editar un equipo.')}

    <div class="panel">
      <div class="panel-head"><h3>Notificaciones de la app instalada (Android)</h3></div>
      <div style="padding:14px">
        <p class="dim">Estas notificaciones solo funcionan en la app instalada en el celular (no en la versión web del navegador). Los horarios aplican para todos los usuarios de ese rol.</p>
        <form id="notif-form" class="form-grid">
          <label class="span-2">
            <span style="display:flex; align-items:center; gap:8px; flex-direction:row">
              <input type="checkbox" name="enabled" ${notif.enabled ? 'checked' : ''} style="width:20px;height:20px"/> Activar notificaciones
            </span>
          </label>
          <label>Aviso al Lubricador · Turno Día<input type="time" name="lubricadorDia" value="${timeVal(notif.lubricadorDiaHour, notif.lubricadorDiaMinute)}"/></label>
          <label>Aviso al Lubricador · Turno Noche<input type="time" name="lubricadorNoche" value="${timeVal(notif.lubricadorNocheHour, notif.lubricadorNocheMinute)}"/></label>
          <label>Aviso de cumplimiento (Admin/Planificador/Supervisor)<input type="time" name="compliance" value="${timeVal(notif.complianceHour, notif.complianceMinute)}"/></label>
          <label class="span-2">
            <span style="display:flex; align-items:center; gap:8px; flex-direction:row">
              <input type="checkbox" name="weekdayPlanEnabled" ${notif.weekdayPlanEnabled ? 'checked' : ''} style="width:20px;height:20px"/> Activar aviso aparte para equipos con plan "Día y turno de la semana"
            </span>
          </label>
          <label>Hora del aviso de plan por día/turno (Admin/Planificador)<input type="time" name="weekdayPlan" value="${timeVal(notif.weekdayPlanHour ?? 7, notif.weekdayPlanMinute ?? 30)}"/></label>
          <div class="modal-actions" style="grid-column:1/-1; justify-content:flex-start">
            <button type="submit" class="btn btn-accent">Guardar horarios</button>
          </div>
        </form>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Notificaciones push (llegan aunque la app esté cerrada)</h3></div>
      <div style="padding:14px">
        <p class="dim">Requieren un proyecto de Firebase configurado (ver guía aparte) — si activas esto SIN haber configurado Firebase primero (google-services.json en el proyecto Android), la app se puede cerrar de golpe al intentar registrarse. Solo actívalo si ya seguiste la guía de Firebase.</p>
        <div id="push-status" class="dim" style="margin-bottom:10px">
          ${window.Capacitor?.Plugins?.PushNotifications ? 'Este dispositivo soporta notificaciones push.' : 'Este dispositivo (navegador web) no recibe notificaciones push — solo la app instalada en Android las recibe.'}
        </div>
        ${window.Capacitor?.Plugins?.PushNotifications ? `<button class="btn btn-accent" id="btn-enable-push">Activar en este dispositivo</button>` : ''}
        <div id="push-tokens-list" style="margin-top:14px"></div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Sincronización con base de datos remota</h3></div>
      <div style="padding:14px">
        <p class="dim">La app siempre guarda primero en este dispositivo (IndexedDB) y funciona sin internet. Cuando conectes una base de datos remota (Supabase), sincroniza automáticamente al recuperar conexión — así todos los equipos, lubricadores y supervisores comparten la misma información.</p>
        <p class="dim">1. Crea un proyecto gratis en <b>supabase.com</b>. 2. Ejecuta el archivo <code>schema.sql</code> incluido en el paquete, en el "SQL Editor" de Supabase. 3. Copia la "Project URL" y la "anon public key" desde Project Settings → API y pégalas aquí.</p>
        <form id="sync-form" class="form-grid" style="margin-top:10px">
          <label>Project URL<input name="url" placeholder="https://xxxxx.supabase.co" value="${cfg.url || ''}"/></label>
          <label>Anon public key<input name="anonKey" placeholder="eyJhbGciOi..." value="${cfg.anonKey || ''}"/></label>
          <div class="modal-actions" style="grid-column:1/-1; justify-content:flex-start">
            <button type="submit" class="btn btn-accent">Guardar y probar conexión</button>
            <button type="button" class="btn" id="btn-sync-now">Sincronizar ahora</button>
          </div>
        </form>
        <div id="sync-status" class="dim" style="margin-top:10px">
          ${cfg.url ? `Servidor conectado. Última subida: ${cfg.lastPush ? fmtDate(cfg.lastPush) : 'nunca'} · Última descarga: ${cfg.lastPull ? fmtDate(cfg.lastPull) : 'nunca'} · Pendientes por subir: ${pending}` : 'Aún no hay servidor remoto configurado — todo funciona solo en este dispositivo.'}
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Respaldo completo de datos</h3></div>
      <div style="padding:14px">
        <p class="dim">Descarga una copia de absolutamente todo (equipos, planes, engrases, anomalías, usuarios, etc.) en un solo archivo. Guárdala en un lugar seguro fuera de la nube — sirve para recuperar información si algo sale mal, o para migrar a otro proyecto de Supabase.</p>
        <div class="toolbar">
          <button class="btn btn-accent" id="btn-export-backup">${ic("download")}Descargar copia completa</button>
          <button class="btn" id="btn-import-backup">${ic("upload")}Restaurar desde archivo</button>
          <input type="file" id="backup-file-input" accept=".json" class="hidden"/>
        </div>
        <p class="dim" style="margin-top:6px">Restaurar NO borra lo que ya tienes — combina los datos del archivo con los actuales (si un registro existe en ambos, gana el más reciente).</p>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Registro de auditoría (últimas 50 acciones)</h3></div>
      <table class="data-table">
        <thead><tr><th>Fecha</th><th>Acción</th><th>Detalle</th><th>Usuario</th></tr></thead>
        <tbody>${log.map(l => `<tr><td>${fmtDate(l.createdAt)}</td><td>${l.action}</td><td>${l.detail}</td><td>${l.user}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">Sin actividad.</td></tr>'}</tbody>
      </table>
    </div>`;

  $('#btn-export-backup').addEventListener('click', () => exportFullBackup());
  $('#btn-import-backup').addEventListener('click', () => $('#backup-file-input').click());
  $('#backup-file-input').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    await previewAndImportBackup(file);
    ev.target.value = '';
  });

  $('#general-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    const [dayH] = fd.shiftDayStart.split(':').map(Number);
    const [nightH] = fd.shiftNightStart.split(':').map(Number);
    const updated = {
      id: 'general', shiftDayStart: dayH, shiftNightStart: nightH,
      defaultAlertYellowHours: parseFloat(fd.defaultAlertYellowHours),
      complianceTarget: parseFloat(fd.complianceTarget)
    };
    await DB.put('settings', stamp(updated, App.currentUser.name));
    await logAudit('CONFIG_GENERAL_ACTUALIZADA', `Día ${dayH}h · Noche ${nightH}h · Alerta ${updated.defaultAlertYellowHours}h · Meta ${updated.complianceTarget}%`, App.currentUser.name);
    await loadGeneralSettings();
    await refreshLocalNotifications();
    renderConfig();
  });

  wireSimpleListPanel(c, 'cuadrillas', () => renderConfig());
  wireSimpleListPanel(c, 'locations', () => renderConfig());
  wireSimpleListPanel(c, 'equipment_types', () => renderConfig());

  $('#btn-enable-push')?.addEventListener('click', async () => {
    if (!confirm('Esto solo debe activarse si ya seguiste la guía de Firebase (google-services.json ya está en el proyecto Android y recompilaste la app). ¿Ya lo hiciste?')) return;
    await initPushNotifications();
    alert('Listo. Si Firebase está bien configurado, este dispositivo debería aparecer en la lista de abajo en unos segundos (puede que tengas que volver a entrar a esta pantalla).');
    renderConfig();
  });

  const pushTokens = (await DB.allActive('push_tokens'));
  $('#push-tokens-list').innerHTML = pushTokens.length ? `
    <table class="data-table">
      <thead><tr><th>Usuario</th><th>Rol</th><th>Plataforma</th><th>Registrado</th></tr></thead>
      <tbody>${pushTokens.map(t => `<tr><td>${t.userName}</td><td>${t.role}</td><td>${t.platform}</td><td>${fmtDate(t.updatedAt)}</td></tr>`).join('')}</tbody>
    </table>` : '<div class="empty-state">Nadie ha activado las notificaciones push todavía (o Firebase aún no está configurado).</div>';
  makeTablesResponsive($('#push-tokens-list'));

  $('#notif-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    const [dh, dm] = fd.lubricadorDia.split(':').map(Number);
    const [nh, nm] = fd.lubricadorNoche.split(':').map(Number);
    const [ch, cm] = fd.compliance.split(':').map(Number);
    const [wh, wm] = fd.weekdayPlan.split(':').map(Number);
    await DB.put('settings', stamp({
      id: 'notifications', enabled: !!fd.enabled,
      lubricadorDiaHour: dh, lubricadorDiaMinute: dm,
      lubricadorNocheHour: nh, lubricadorNocheMinute: nm,
      complianceHour: ch, complianceMinute: cm,
      weekdayPlanEnabled: !!fd.weekdayPlanEnabled, weekdayPlanHour: wh, weekdayPlanMinute: wm
    }, App.currentUser.name));
    await logAudit('NOTIFICACIONES_CONFIGURADAS', fd.enabled ? 'Activadas' : 'Desactivadas', App.currentUser.name);
    await refreshLocalNotifications();
    renderConfig();
  });

  $('#sync-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    const statusEl = $('#sync-status');
    statusEl.textContent = 'Probando conexión…';
    try {
      await Sync.saveConfig(fd.url, fd.anonKey);
      await logAudit('SERVIDOR_CONFIGURADO', fd.url, App.currentUser.name);
      statusEl.textContent = 'Conexión exitosa. Sincronizando…';
      await Sync.fullSync();
      renderConfig();
    } catch (err) {
      statusEl.textContent = 'No se pudo conectar: ' + err.message;
    }
  });
  $('#btn-sync-now').addEventListener('click', async () => {
    $('#sync-status').textContent = 'Sincronizando…';
    await Sync.fullSync();
    renderConfig();
  });
}

/* ============================================================
   MODAL genérico
   ============================================================ */
function openModal(title, bodyHTML) {
  let overlay = $('#modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h3>${title}</h3><button class="icon-btn" id="modal-close">✕</button></div>
      <div class="modal-body">${bodyHTML}</div>
    </div>`;
  overlay.classList.add('open');
  $('#modal-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
}
function closeModal() {
  const overlay = $('#modal-overlay');
  if (overlay) overlay.classList.remove('open');
}
