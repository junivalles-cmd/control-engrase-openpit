/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT — app.js
   ============================================================ */

const App = {
  currentUser: null,
  route: 'dashboard',
  configAlertYellow: 10,
  pendingQrEquipmentId: null // equipo pendiente de mostrar tras escanear un QR (ver captureQrDeepLink)
};

/* ============================================================
   INTEGRACIÓN NATIVA (solo activa dentro de la app Android/Capacitor;
   en la versión web estas funciones no hacen nada)
   ============================================================ */
function isNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

/* ---------- Cámara / galería nativa ---------- */
async function pickPhotoNative(source) {
  const Camera = window.Capacitor?.Plugins?.Camera;
  if (!Camera) return null;
  try {
    const photo = await Camera.getPhoto({
      quality: 70, width: 1000, resultType: 'dataUrl', source: source || 'CAMERA', allowEditing: false
    });
    return photo?.dataUrl || null;
  } catch (e) {
    const msg = (e && e.message || '').toLowerCase();
    const userCancelled = msg.includes('cancel');
    if (!userCancelled) {
      alert(`No se pudo abrir ${source === 'PHOTOS' ? 'la galería' : 'la cámara'}. Si el celular pidió permiso y lo rechazaste, ve a Ajustes del teléfono → Apps → Control de Engrase → Permisos, y actívalo ahí. (${e?.message || 'error desconocido'})`);
    }
    return null;
  }
}

const MAX_PHOTOS = 5;

function photoFieldHTML() {
  return `
    <label class="span-2">Fotografías (opcional, hasta ${MAX_PHOTOS})
      <div class="photo-field-native hidden">
        <div class="photo-pick-row">
          <button type="button" class="btn photo-pick-camera-btn">${ic("camera")}Tomar foto</button>
          <button type="button" class="btn photo-pick-gallery-btn">${ic("gallery")}Elegir de galería</button>
        </div>
      </div>
      <div class="photo-field-web">
        <input type="file" name="photo" accept="image/*" multiple/>
        <span class="field-hint">Puedes seleccionar varias a la vez (máximo ${MAX_PHOTOS})</span>
      </div>
      <div class="photo-gallery-strip"></div>
      <span class="field-hint photo-count-hint"></span>
    </label>`;
}

// Devuelve el arreglo de fotos que hay ahora mismo en el campo (data URLs)
function getPhotoFieldPhotos(container) {
  if (!container) return [];
  const strip = container.querySelector('.photo-gallery-strip');
  if (!strip) return [];
  return Array.from(strip.querySelectorAll('.photo-slot')).map(el => el.dataset.photo).filter(Boolean);
}

function renderPhotoStrip(container) {
  const strip = container.querySelector('.photo-gallery-strip');
  const hint = container.querySelector('.photo-count-hint');
  if (!strip) return;
  const photos = getPhotoFieldPhotos(container);
  if (hint) hint.textContent = photos.length ? `${photos.length} de ${MAX_PHOTOS} fotos` : '';
  // Oculta los botones de agregar cuando ya se llegó al tope
  const full = photos.length >= MAX_PHOTOS;
  container.querySelector('.photo-pick-row')?.classList.toggle('hidden', full);
  const webInput = container.querySelector('input[name="photo"]');
  if (webInput) webInput.disabled = full;
}

function addPhotoToField(container, dataUrl) {
  const strip = container.querySelector('.photo-gallery-strip');
  if (!strip || !dataUrl) return false;
  if (getPhotoFieldPhotos(container).length >= MAX_PHOTOS) {
    alert(`Ya llegaste al máximo de ${MAX_PHOTOS} fotos. Quita alguna si quieres agregar otra.`);
    return false;
  }
  const slot = document.createElement('div');
  slot.className = 'photo-slot';
  slot.dataset.photo = dataUrl;
  slot.innerHTML = `<img src="${dataUrl}"/><button type="button" class="photo-slot-remove" title="Quitar esta foto">✕</button>`;
  slot.querySelector('.photo-slot-remove').addEventListener('click', () => {
    slot.remove();
    renderPhotoStrip(container);
  });
  strip.appendChild(slot);
  renderPhotoStrip(container);
  return true;
}

function wirePhotoField(container) {
  if (!container) return; // el formulario puede no existir (ej. equipo sin puntos de engrase)
  // Preguntamos directamente si el plugin de cámara existe — más confiable que una
  // bandera de "plataforma", que puede variar según la configuración del WebView.
  const hasCameraPlugin = !!(window.Capacitor?.Plugins?.Camera);
  container.querySelector('.photo-field-native')?.classList.toggle('hidden', !hasCameraPlugin);
  container.querySelector('.photo-field-web')?.classList.toggle('hidden', hasCameraPlugin);

  const pickAndAdd = async (source) => {
    const dataUrl = await pickPhotoNative(source);
    if (dataUrl) addPhotoToField(container, dataUrl);
  };
  container.querySelector('.photo-pick-camera-btn')?.addEventListener('click', () => pickAndAdd('CAMERA'));
  container.querySelector('.photo-pick-gallery-btn')?.addEventListener('click', () => pickAndAdd('PHOTOS'));

  // Versión web: permite elegir varias de una vez
  container.querySelector('input[name="photo"]')?.addEventListener('change', async (ev) => {
    const files = Array.from(ev.target.files || []);
    const espacio = MAX_PHOTOS - getPhotoFieldPhotos(container).length;
    if (files.length > espacio) {
      alert(`Solo caben ${espacio} foto(s) más (máximo ${MAX_PHOTOS} en total). Se tomarán las primeras ${espacio}.`);
    }
    for (const file of files.slice(0, espacio)) {
      const dataUrl = await fileToCompressedDataURL(file);
      if (dataUrl) addPhotoToField(container, dataUrl);
    }
    ev.target.value = ''; // permite volver a elegir el mismo archivo si lo quitó
  });

  renderPhotoStrip(container);
}

// Precarga fotos ya guardadas (al editar un registro existente)
function preloadPhotosIntoField(container, photos) {
  if (!container || !photos) return;
  const list = Array.isArray(photos) ? photos : [photos];
  list.filter(Boolean).slice(0, MAX_PHOTOS).forEach(p => addPhotoToField(container, p));
}

// Devuelve TODAS las fotos del formulario como arreglo.
async function getSelectedPhotos(formEl) {
  if (!formEl) return [];
  return getPhotoFieldPhotos(formEl);
}

// Compatibilidad: el código viejo espera UNA foto (la primera).
async function getSelectedPhotoDataURL(formEl) {
  const photos = await getSelectedPhotos(formEl);
  return photos.length ? photos[0] : null;
}

// Normaliza: un registro puede tener `photo` (formato viejo, una sola) o
// `photos` (formato nuevo, arreglo). Devuelve siempre un arreglo.
function photosOf(record) {
  if (!record) return [];
  if (Array.isArray(record.photos) && record.photos.length) return record.photos;
  if (record.photo) return [record.photo];
  return [];
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

  printHTMLDocument('Etiquetas QR — Control de Engrase', `
    <h2>Etiquetas QR — ${equipos.length} equipos</h2>
    <div class="grid">
      ${items.map(({ e, dataUrl }) => `
        <div class="label">
          <img src="${dataUrl}"/>
          <h4>${esc(e.code)}${e.shortCode ? ' · ' + esc(e.shortCode) : ''}</h4>
          <p>${esc(e.brand)} ${esc(e.model)}</p>
        </div>`).join('')}
    </div>`, `
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
      .label { text-align: center; border: 1px solid #ccc; border-radius: 8px; padding: 10px; page-break-inside: avoid; }
      .label img { width: 130px; height: 130px; }
      .label h4 { margin: 6px 0 2px; font-size: 13px; }
      .label p { margin: 0; font-size: 10px; color: #555; }
      @media print { .label { border: 1px dashed #999; } }`);
}

function openEquipmentQR(equipment) {
  const nativeWarning = isNative() ? `<p style="color:var(--amber); font-size:12px">⚠ Estás generando este QR desde la app instalada — para que cualquier celular pueda escanearlo, genera e imprime las etiquetas desde la versión web en vez de la app.</p>` : '';
  openModal(`Código QR · ${esc(equipment.code)}`, `
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
    printHTMLDocument(`Etiqueta QR — ${equipment.code}`, `
      <div style="text-align:center; padding:20px">
        <h2>${esc(equipment.code)}${equipment.shortCode ? ' · ' + esc(equipment.shortCode) : ''}</h2>
        <p>${esc(equipment.brand)} ${esc(equipment.model)}</p>
        <img src="${$('#qr-canvas').toDataURL()}" style="width:260px"/>
      </div>`);
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
//
// Ojo con el orden: al escanear el QR la app arranca en la pantalla de LOGIN, así que
// el `#eq=...` se lee y se guarda apenas carga la página, y se usa después de que la
// persona ingresa su PIN. Antes se leía solo después del login, y para entonces ya se
// había perdido — por eso el QR "no hacía nada" y solo abría la app.
function captureQrDeepLink() {
  const match = /#eq=([^&]+)/.exec(location.hash);
  if (!match) return;
  App.pendingQrEquipmentId = decodeURIComponent(match[1]);
  history.replaceState(null, '', location.pathname + location.search); // limpia el hash
}

async function handleQrDeepLink() {
  const id = App.pendingQrEquipmentId;
  if (!id) return;
  App.pendingQrEquipmentId = null; // se consume una sola vez
  const equipment = await DB.get('equipment', id);
  if (!equipment || equipment.active === false) {
    alert('El código QR escaneado no corresponde a ningún equipo activo. Si el equipo es nuevo, revisa que este dispositivo ya haya sincronizado.');
    return;
  }
  await showEquipmentQrInfo(equipment.id);
}

async function handleScannedQR(text) {
  const id = parseEquipmentIdFromScan(text);
  const equipment = await DB.get('equipment', id);
  if (!equipment || equipment.active === false) {
    alert('Este código QR no corresponde a ningún equipo activo del sistema.');
    return;
  }
  if (App.currentUser.role === 'LUBRICADOR' && App.route !== 'turno') { App.route = 'turno'; }
  await showEquipmentQrInfo(equipment.id);
}

/* ---------- Pantalla que se muestra al escanear el QR de un equipo: resumen
   rápido de su estado de engrase, y un botón directo al formulario si le toca. ---------- */
async function showEquipmentQrInfo(equipmentId) {
  const equipment = await DB.get('equipment', equipmentId);
  if (!equipment || equipment.active === false) {
    // Puede pasar con una etiqueta QR pegada en un equipo que ya se dio de baja,
    // o si este dispositivo todavía no ha sincronizado ese equipo.
    alert('Este código QR no corresponde a ningún equipo activo del sistema. Si el equipo es nuevo, revisa que este dispositivo ya haya sincronizado.');
    return;
  }
  const s = await statusFor(equipment);
  const records = (await DB.allActive('lubrication_records')).filter(r => r.equipmentId === equipmentId);
  const lastRecord = records.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  const daysSince = lastRecord
    ? Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(lastRecord.date).setHours(0, 0, 0, 0)) / 86400000)
    : null;
  const location_ = (await DB.allActive('locations')).find(l => l.id === equipment.locationId);
  const needsGrease = s.code === 'ROJO' || s.code === 'AMARILLO';
  const canRegister = ['LUBRICADOR', 'ADMINISTRADOR', 'SUPERVISOR', 'PLANIFICADOR'].includes(App.currentUser.role);

  openModal(`${esc(equipment.code)}${equipment.shortCode ? ' · ' + equipment.shortCode : ''}`, `
    <div class="qr-info-card">
      <div class="qr-info-status" style="color:${STATUS_COLOR[s.code]}">
        <span class="dot" style="background:${STATUS_COLOR[s.code]}"></span> ${s.label}
      </div>
      <p class="dim" style="margin-top:-6px">${esc(equipment.brand)} ${esc(equipment.model)} · ${location_ ? location_.name : 'Sin ubicación'} · Turno ${equipment.shiftId === 'shift_dia' ? 'Día' : 'Noche'}</p>

      <div class="qr-info-grid">
        <div><span class="dim">Horómetro actual</span><div class="mono" style="font-size:18px">${fmt(equipment.hourmeter)} h</div></div>
        <div><span class="dim">Días sin engrase</span><div class="mono" style="font-size:18px">${daysSince === null ? 'Nunca' : daysSince + ' día(s)'}</div></div>
      </div>

      ${lastRecord ? `<p class="dim">Último engrase: ${fmtDate(lastRecord.date)} por ${esc(lastRecord.userName)}</p>` : '<p class="dim">Este equipo no tiene ningún engrase registrado todavía.</p>'}
      ${s.scheduleDate ? `<p class="dim">Día asignado: ${WEEKDAY_NAMES[s.scheduleDate.getDay()]}</p>` : ''}

      ${needsGrease
        ? `<div class="qr-info-alert">${s.code === 'ROJO' ? '🔴 Este equipo tiene el engrase vencido.' : '🟡 Este equipo está próximo a vencer.'}</div>`
        : `<div class="qr-info-ok">✓ Este equipo está al día, no necesita engrase ahora.</div>`}

      <div class="modal-actions" style="flex-wrap:wrap">
        ${canRegister ? `<button class="btn btn-accent" id="qr-info-register">${ic("check")}Registrar engrase ahora</button>` : ''}
        ${App.currentUser.role !== 'LUBRICADOR' ? `<button class="btn" id="qr-info-detail">Ver ficha completa</button>` : ''}
      </div>
    </div>
  `);

  $('#qr-info-register')?.addEventListener('click', async () => {
    closeModal();
    if (App.currentUser.role === 'LUBRICADOR') await startLubricadorGreaseFlow(equipment.id);
    else await startGreaseFlow(equipment.id, App.route);
  });
  $('#qr-info-detail')?.addEventListener('click', () => {
    closeModal();
    openEquipmentDetail(equipment.id);
  });
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


const NOTIF_ID_DAILY_TASKS = 1001;   // aviso al lubricador de lo que le toca hoy
const NOTIF_ID_COMPLIANCE = 1002;    // resumen de cumplimiento para jefaturas
const NOTIF_ID_WEEKDAY_PLAN = 1003;  // equipos con plan por día/turno
const NOTIF_ID_VENCIDOS = 1004;      // equipos con el engrase VENCIDO
const NOTIF_ID_POR_ENGRASAR = 1005;  // equipos que toca engrasar hoy
const NOTIF_ID_VENCIDOS_REC = 1006;    // recordatorio de vencidos a media jornada
const NOTIF_ID_POR_ENGRASAR_REC = 1007; // recordatorio de lo que falta por engrasar
const NOTIF_ID_SEMANAL = 1008;         // resumen semanal (lunes)
const NOTIF_ID_ESCALADO = 1009;        // escalamiento por atraso grave

/* Configuración por defecto de las notificaciones. El Administrador puede cambiar
   cada una por separado desde Configuración: activarla o apagarla, a qué hora suena,
   y qué roles la reciben. */
const NOTIF_DEFAULTS = {
  id: 'notifications',
  enabled: true,
  // Regla general: nadie recibe avisos fuera de su turno de trabajo. Es especialmente
  // importante porque las cuadrillas COMPARTEN el teléfono — el aviso debe ser para
  // quien está trabajando en ese momento, no para quien está descansando.
  soloEnTurno: true,
  minutosAntesDelTurno: 15,   // margen para avisar justo antes de entrar
  minutosDespuesDelTurno: 30, // margen para cerrar pendientes al salir

  // 1) Engrases VENCIDOS
  vencidos: { enabled: true, hour: 7, minute: 0, roles: ['ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR'], soloSiHay: true,
              recordatorio: true, recordatorioHoras: 6, escalarDias: 3, escalarA: ['ADMINISTRADOR'] },
  // 2) Equipos POR ENGRASAR hoy
  porEngrasar: { enabled: true, hour: 6, minute: 0, roles: ['LUBRICADOR', 'SUPERVISOR'], soloSiHay: true,
                 recordatorio: true, recordatorioHoras: 4 },
  // 3) Aviso INMEDIATO cada vez que se registra un engrase
  engraseRealizado: { enabled: false, roles: ['SUPERVISOR'], soloCriticos: false },
  // 4) Resumen de cumplimiento
  cumplimiento: { enabled: true, hour: 7, minute: 30, roles: ['ADMINISTRADOR', 'PLANIFICADOR'] },
  // 5) Anomalías nuevas (inmediata, se agrupan si llegan varias seguidas)
  anomalias: { enabled: true, roles: ['ADMINISTRADOR', 'SUPERVISOR', 'PLANIFICADOR'], agruparMinutos: 30 },
  // 6) Resumen SEMANAL (lunes)
  resumenSemanal: { enabled: true, hour: 7, minute: 0, diaSemana: 1, roles: ['ADMINISTRADOR', 'PLANIFICADOR'] }
};

/* ---------- ¿Qué equipos le corresponden a esta persona? ----------
   Regla de campo: cada zona (Mojón, Volcán…) tiene su propio celular, que comparten
   la cuadrilla de día y la de noche de esa zona. Por eso el filtro es, en orden:
     1. TURNO   — el de quien tiene la sesión abierta (día o noche)
     2. ZONA    — si el usuario tiene una asignada, solo ve equipos de ahí
     3. CUADRILLA — filtro fino dentro de la zona, si ambos la tienen definida
   Un filtro vacío significa "sin restricción", para no dejar equipos huérfanos. */
function equiposDeEstaPersona(equipos, usuario) {
  const u = usuario || App.currentUser;
  if (!u) return [];
  if (u.role !== 'LUBRICADOR') return equipos; // jefaturas ven toda la flota

  const turno = u.shiftId || currentShiftId();
  return equipos.filter(e => {
    if (e.shiftId !== turno) return false;
    if (u.locationId && e.locationId && e.locationId !== u.locationId) return false;
    if (u.cuadrillaId && e.cuadrillaId && e.cuadrillaId !== u.cuadrillaId) return false;
    return true;
  });
}

/* ---------- ¿Está esta persona dentro de su turno de trabajo? ----------
   Con teléfonos compartidos entre cuadrillas, esto es clave: el aviso debe ser para
   quien tiene la sesión abierta Y está trabajando, no para quien ya se fue a casa. */
function dentroDeSuTurno(settings, fecha) {
  if (!settings.soloEnTurno) return true;
  const u = App.currentUser;
  if (!u) return false;
  // Jefaturas y oficina no tienen turno rotativo: reciben en horario de oficina
  if (u.role !== 'LUBRICADOR') return true;

  const ahora = fecha || new Date();
  const min = ahora.getHours() * 60 + ahora.getMinutes();
  const { shiftDayStart, shiftNightStart } = App.generalSettings;
  const antes = settings.minutosAntesDelTurno ?? 15;
  const despues = settings.minutosDespuesDelTurno ?? 30;

  // El turno del usuario se toma del que tenga asignado; si no, del horario actual
  const turno = u.shiftId || currentShiftId();
  if (turno === 'shift_dia') {
    const ini = shiftDayStart * 60 - antes;
    const fin = shiftNightStart * 60 + despues;
    return min >= ini && min <= fin;
  }
  // Turno noche: cruza la medianoche
  const ini = shiftNightStart * 60 - antes;
  const fin = shiftDayStart * 60 + despues;
  return min >= ini || min <= fin;
}

/* Devuelve la hora a la que conviene mandar un aviso a esta persona: si la hora
   configurada cae fuera de su turno, lo corre al inicio de su turno. */
function horaAjustadaAlTurno(settings, hour, minute) {
  if (!settings.soloEnTurno || !App.currentUser || App.currentUser.role !== 'LUBRICADOR') {
    return { hour, minute };
  }
  const turno = App.currentUser.shiftId || currentShiftId();
  const { shiftDayStart, shiftNightStart } = App.generalSettings;
  const inicioTurno = turno === 'shift_dia' ? shiftDayStart : shiftNightStart;

  // Ojo: aquí se comprueba contra el turno ESTRICTO (sin los márgenes de entrada y
  // salida). Esos márgenes existen para que alguien alcance a cerrar pendientes al
  // salir, pero no tiene sentido PROGRAMAR un aviso nuevo dentro de ellos.
  const min = hour * 60 + minute;
  const { shiftDayStart: ini, shiftNightStart: fin } = App.generalSettings;
  const enTurnoEstricto = turno === 'shift_dia'
    ? (min >= ini * 60 && min < fin * 60)
    : (min >= fin * 60 || min < ini * 60);

  if (enTurnoEstricto) return { hour, minute };
  return { hour: inicioTurno, minute: 0 }; // se corre al arranque de su turno
}

// Une lo guardado con los valores por defecto, para que si en el futuro agregamos un
// tipo de aviso nuevo, las configuraciones viejas no se queden sin esa parte.
function mergeNotifSettings(guardado) {
  const base = JSON.parse(JSON.stringify(NOTIF_DEFAULTS));
  if (!guardado) return base;
  const out = { ...base, ...guardado };
  ['vencidos', 'porEngrasar', 'engraseRealizado', 'cumplimiento', 'anomalias', 'resumenSemanal'].forEach(k => {
    out[k] = { ...base[k], ...(guardado[k] || {}) };
  });
  return out;
}

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
/* ---------- Notificaciones push reales (vía OneSignal) ----------
   A diferencia de las notificaciones locales, estas SÍ pueden llegar aunque nadie tenga la
   app abierta. Usamos OneSignal en vez de conectar Firebase a mano — la única configuración
   que hace falta es pegar el "App ID" de OneSignal aquí abajo (ver GUIA_NOTIFICACIONES_PUSH.md).
   Si el plugin no está disponible (app web, o todavía no se configuró el App ID), estas
   funciones simplemente no hacen nada — el resto de la app funciona igual. */
const ONESIGNAL_APP_ID = ''; // pega aquí tu App ID de OneSignal (ver la guía) — mientras esté vacío, el push queda desactivado sin dar error

function wirePushListeners() {
  const OneSignal = window.plugins?.OneSignal || window.OneSignal;
  if (!OneSignal || App._pushListenersWired || !ONESIGNAL_APP_ID) return;
  App._pushListenersWired = true;

  try {
    OneSignal.initialize(ONESIGNAL_APP_ID);

    // Con la app abierta, mostramos la notificación como toast en vez del aviso del sistema
    OneSignal.Notifications.addEventListener('foregroundWillDisplay', (e) => {
      const n = e.getNotification ? e.getNotification() : e.notification;
      showInAppToast(`${n?.title || 'Aviso'}: ${n?.body || ''}`);
    });

    // Al tocar la notificación se abre justo lo que anunciaba: si era de UN equipo,
    // se abre ese equipo listo para registrar; si era de varios, la pantalla que toca.
    OneSignal.Notifications.addEventListener('click', (e) => {
      const datos = e?.notification?.additionalData || e?.result?.notification?.additionalData || {};
      abrirDesdeNotificacion(datos);
    });

    // Cuando OneSignal asigna/actualiza el ID de este dispositivo, lo guardamos
    OneSignal.User.pushSubscription.addEventListener('change', (e) => {
      const id = e?.current?.id;
      if (id && App.currentUser) saveOneSignalId(id);
    });
  } catch (e) { console.warn('No se pudo inicializar OneSignal', e); }
}

/* ============================================================
   IDENTIDAD DEL DISPOSITIVO (teléfonos compartidos por cuadrilla)
   ------------------------------------------------------------
   En el pit un mismo teléfono lo usan los 4 lubricadores de una cuadrilla, turnándose
   con su propio PIN. Por eso las notificaciones NO se registran por persona sino por
   TELÉFONO: si se registraran por usuario, el mismo aviso llegaría varias veces al
   mismo aparato y al cambiar de turno el sistema no sabría a quién avisarle.

   Cada teléfono tiene su propio identificador fijo y se le asigna una cuadrilla y un
   turno desde Configuración. Los avisos se filtran por esa asignación, no por quién
   tenga la sesión abierta en ese momento.
   ============================================================ */
function getDeviceId() {
  let id = null;
  try { id = localStorage.getItem('engrase_device_id'); } catch (e) {}
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    try { localStorage.setItem('engrase_device_id', id); } catch (e) {}
  }
  return id;
}

function getDeviceName() {
  try { return localStorage.getItem('engrase_device_name') || ''; } catch (e) { return ''; }
}
function setDeviceName(nombre) {
  try { localStorage.setItem('engrase_device_name', nombre); } catch (e) {}
}

// Cuadrilla y turno asignados a ESTE teléfono (no al usuario que tenga la sesión)
async function getDeviceAssignment() {
  const reg = await DB.get('push_tokens', getDeviceId()).catch(() => null);
  return {
    cuadrillaId: reg?.cuadrillaId || '',
    shiftId: reg?.shiftId || '',
    nombre: reg?.deviceName || getDeviceName(),
    roles: reg?.roles || []
  };
}

async function saveDeviceAssignment({ cuadrillaId, shiftId, nombre, roles }) {
  const id = getDeviceId();
  const actual = await DB.get('push_tokens', id).catch(() => null);
  if (nombre !== undefined) setDeviceName(nombre);
  await DB.put('push_tokens', stamp({
    ...(actual || {}),
    id,
    deviceName: nombre !== undefined ? nombre : (actual?.deviceName || ''),
    cuadrillaId: cuadrillaId !== undefined ? cuadrillaId : (actual?.cuadrillaId || ''),
    shiftId: shiftId !== undefined ? shiftId : (actual?.shiftId || ''),
    roles: roles !== undefined ? roles : (actual?.roles || []),
    token: actual?.token || null,
    platform: actual?.platform || (window.Capacitor ? 'android' : 'web'),
    ultimoUsuario: App.currentUser ? App.currentUser.name : (actual?.ultimoUsuario || ''),
    active: true
  }, App.currentUser ? App.currentUser.name : 'sistema'));
  Sync.fullSync();
}

async function saveOneSignalId(subscriptionId, plataforma) {
  try {
    // El id incluye la plataforma: así una misma persona puede recibir avisos en la app
    // del celular Y en el navegador de la computadora, sin que uno pise al otro.
    const plat = plataforma || (window.Capacitor ? 'android' : 'web');
    await DB.put('push_tokens', stamp({
      id: `tok_${App.currentUser.id}_${plat}`, userId: App.currentUser.id, userName: App.currentUser.name,
      role: App.currentUser.role, token: subscriptionId, platform: plat, active: true
    }, App.currentUser.name));
    Sync.fullSync();
  } catch (e) { console.warn('No se pudo guardar el ID de notificaciones push', e); }
}

/* ---------- Push en NAVEGADOR (sin Capacitor) ----------
   Usa el SDK web de OneSignal. Funciona en Chrome/Edge de Android y de escritorio,
   incluso con la pestaña cerrada, porque quien recibe el aviso es el Service Worker.
   En iPhone solo funciona si el usuario "instala" la web en su pantalla de inicio. */
async function initWebPush() {
  if (!ONESIGNAL_APP_ID || window.Capacitor) return; // en la app nativa se usa el plugin
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    // Carga el SDK web solo cuando hace falta
    if (!window.OneSignalDeferred) {
      window.OneSignalDeferred = [];
      const s = document.createElement('script');
      s.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
      s.defer = true;
      document.head.appendChild(s);
    }
    window.OneSignalDeferred.push(async (OneSignal) => {
      await OneSignal.init({ appId: ONESIGNAL_APP_ID, allowLocalhostAsSecureOrigin: true });
      await OneSignal.Notifications.requestPermission();
      const id = OneSignal.User?.PushSubscription?.id;
      if (id && App.currentUser) await saveOneSignalId(id, 'web');
      OneSignal.User.PushSubscription.addEventListener('change', (e) => {
        const nuevo = e?.current?.id;
        if (nuevo && App.currentUser) saveOneSignalId(nuevo, 'web');
      });
    });
  } catch (e) { console.warn('No se pudo activar el push en el navegador', e); }
}

async function initPushNotifications() {
  if (!App.currentUser || !ONESIGNAL_APP_ID) return;

  // En el navegador (web o PWA instalada) se usa el SDK web
  if (!window.Capacitor) { await initWebPush(); return; }

  // En la app instalada de Android se usa el plugin nativo
  const OneSignal = window.plugins?.OneSignal || window.OneSignal;
  if (!OneSignal) return;
  try {
    await OneSignal.Notifications.requestPermission(true);
    const id = OneSignal.User?.pushSubscription?.id;
    if (id) await saveOneSignalId(id, 'android');
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
      const mine = equiposDeEstaPersona(equipos, App.currentUser);
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

/* ¿Este equipo tiene los avisos pausados? (equipo en taller, por ejemplo) */
function avisosPausados(equipo) {
  if (!equipo || !equipo.avisosPausadosHasta) return false;
  return new Date(equipo.avisosPausadosHasta).getTime() > Date.now();
}

/* Guarda un registro de cada aviso enviado, para poder responder "¿me llegó o no?" */
async function registrarAvisoEnviado(tipo, titulo, cuerpo, destinatarios) {
  try {
    await DB.put('audit_log', stamp({
      id: uid('notif'),
      action: 'AVISO_ENVIADO',
      detail: `[${tipo}] ${titulo} — ${cuerpo}`.slice(0, 300),
      user: destinatarios || App.currentUser?.name || 'sistema',
      createdAt: nowISO(),
      active: true
    }, 'sistema'));
  } catch (e) { /* si falla el registro, no se frena el aviso */ }
}

/* Abre la pantalla correcta al tocar una notificación. Si el aviso era de un solo
   equipo, se abre ese equipo directo (listo para engrasar); si era de varios, la
   pantalla general que corresponda. Antes todo llevaba a Anomalías. */
async function abrirDesdeNotificacion(datos) {
  if (!App.currentUser || !datos) return;
  try {
    if (datos.equipoId) {
      const eq = await DB.get('equipment', datos.equipoId);
      if (eq && eq.active !== false) {
        if (App.currentUser.role === 'LUBRICADOR') await startLubricadorGreaseFlow(eq.id);
        else await showEquipmentQrInfo(eq.id);
        return;
      }
    }
    const permitidas = PERMISSIONS[App.currentUser.role] || [];
    const destino = datos.ruta && permitidas.includes(datos.ruta) ? datos.ruta : permitidas[0];
    if (destino) navigate(destino);
  } catch (e) { console.warn('No se pudo abrir desde la notificación', e); }
}

/* Conecta el toque de las notificaciones LOCALES (las programadas en el celular) */
function wireLocalNotificationTaps() {
  const LN = window.Capacitor?.Plugins?.LocalNotifications;
  if (!LN || App._localTapsWired) return;
  App._localTapsWired = true;
  try {
    LN.addListener('localNotificationActionPerformed', (ev) => {
      abrirDesdeNotificacion(ev?.notification?.extra || {});
    });
  } catch (e) { /* no disponible en esta plataforma */ }
}

async function refreshLocalNotifications() {
  const LN = window.Capacitor?.Plugins?.LocalNotifications;
  if (!LN || !App.currentUser) return;
  try {
    const settings = mergeNotifSettings(await DB.get('settings', 'notifications'));

    // Se cancelan todas primero: si el admin apaga un aviso, deja de sonar
    await LN.cancel({ notifications: [
      { id: NOTIF_ID_DAILY_TASKS }, { id: NOTIF_ID_COMPLIANCE }, { id: NOTIF_ID_WEEKDAY_PLAN },
      { id: NOTIF_ID_VENCIDOS }, { id: NOTIF_ID_POR_ENGRASAR },
      { id: NOTIF_ID_VENCIDOS_REC }, { id: NOTIF_ID_POR_ENGRASAR_REC },
      { id: NOTIF_ID_SEMANAL }, { id: NOTIF_ID_ESCALADO }
    ]});
    if (!settings.enabled) return;

    const perm = await LN.checkPermissions();
    if (perm.display === 'denied') return;
    if (perm.display !== 'granted') {
      const req = await LN.requestPermissions();
      if (req.display !== 'granted') return;
    }

    const rol = App.currentUser.role;
    const equipos = await DB.allActive('equipment');
    const statuses = await computeAllStatuses(equipos);
    const notifications = [];

    // Filtro base: turno y cuadrilla del lubricador, y equipos con avisos pausados
    const relevantes = statuses.filter(x => {
      if (avisosPausados(x.e)) return false; // equipo en taller: no molesta
      if (rol !== 'LUBRICADOR') return true;
      const mios = equiposDeEstaPersona([x.e], App.currentUser);
      return mios.length > 0;
    });

    const vencidos = relevantes.filter(x => x.s.code === 'ROJO');
    const porEngrasar = relevantes.filter(x => x.s.code === 'AMARILLO');

    // Al tocar un aviso, la app abre el equipo correcto en vez de una pantalla genérica
    const extraDatos = (lista, tipo) => ({
      tipo,
      equipoId: lista.length === 1 ? lista[0].e.id : '',
      ruta: lista.length === 1 ? 'equipo' : (tipo === 'anomalia' ? 'anomalias' : 'dashboard')
    });

    // ── 1) Engrases VENCIDOS ──────────────────────────────────────
    const cfgV = settings.vencidos;
    if (cfgV.enabled && cfgV.roles.includes(rol) && (!cfgV.soloSiHay || vencidos.length)) {
      const h = horaAjustadaAlTurno(settings, cfgV.hour, cfgV.minute);
      const lista = vencidos.slice(0, 5).map(x => x.e.code).join(', ');
      const titulo = vencidos.length ? `🔴 ${vencidos.length} equipo(s) con engrase VENCIDO` : 'Sin engrases vencidos';
      const cuerpo = vencidos.length
        ? `${lista}${vencidos.length > 5 ? ` y ${vencidos.length - 5} más` : ''}. Requieren atención inmediata.`
        : 'Ningún equipo tiene el engrase vencido. Buen trabajo.';
      notifications.push({
        id: NOTIF_ID_VENCIDOS, title: titulo, body: cuerpo,
        extra: extraDatos(vencidos, 'vencidos'),
        schedule: { at: nextTimeAt(h.hour, h.minute), every: 'day', repeats: true }
      });
      if (vencidos.length) registrarAvisoEnviado('vencidos', titulo, cuerpo, rol);

      // Recordatorio a media jornada, solo si SIGUE habiendo vencidos
      if (cfgV.recordatorio && vencidos.length) {
        const hr = (h.hour + (cfgV.recordatorioHoras || 6)) % 24;
        const hAjust = horaAjustadaAlTurno(settings, hr, h.minute);
        notifications.push({
          id: NOTIF_ID_VENCIDOS_REC,
          title: `🔴 Recordatorio: ${vencidos.length} equipo(s) siguen vencidos`,
          body: `${lista}${vencidos.length > 5 ? ` y ${vencidos.length - 5} más` : ''}.`,
          extra: extraDatos(vencidos, 'vencidos'),
          schedule: { at: nextTimeAt(hAjust.hour, hAjust.minute), every: 'day', repeats: true }
        });
      }

      // Escalamiento: lo que lleva demasiados días vencido sube a jefatura
      const diasEscalar = cfgV.escalarDias || 3;
      const graves = vencidos.filter(x => {
        const plan = x.s.plan;
        if (!plan) return false;
        if (x.s.scheduleDate) {
          const dias = Math.floor((Date.now() - x.s.scheduleDate.getTime()) / 86400000);
          return dias >= diasEscalar;
        }
        // Por horas: se estima con las horas de atraso (jornada de ~10 h)
        return (x.s.remaining ?? 0) < -(diasEscalar * 10);
      });
      if (graves.length && (cfgV.escalarA || []).includes(rol)) {
        const t = `‼ ${graves.length} equipo(s) con más de ${diasEscalar} días vencidos`;
        const cu = `${graves.slice(0, 5).map(x => x.e.code).join(', ')}. Atraso crítico.`;
        notifications.push({
          id: NOTIF_ID_ESCALADO, title: t, body: cu,
          extra: extraDatos(graves, 'vencidos'),
          schedule: { at: nextTimeAt(h.hour, h.minute + 5), every: 'day', repeats: true }
        });
        registrarAvisoEnviado('escalamiento', t, cu, rol);
      }
    }

    // ── 2) Equipos POR ENGRASAR hoy ───────────────────────────────
    const cfgP = settings.porEngrasar;
    if (cfgP.enabled && cfgP.roles.includes(rol) && (!cfgP.soloSiHay || porEngrasar.length)) {
      const h = horaAjustadaAlTurno(settings, cfgP.hour, cfgP.minute);
      const lista = porEngrasar.slice(0, 5).map(x => x.e.code).join(', ');
      const titulo = porEngrasar.length ? `🟡 ${porEngrasar.length} equipo(s) por engrasar hoy` : 'Sin engrases programados';
      const cuerpo = porEngrasar.length
        ? `${lista}${porEngrasar.length > 5 ? ` y ${porEngrasar.length - 5} más` : ''}.`
        : 'No hay equipos programados para hoy.';
      notifications.push({
        id: NOTIF_ID_POR_ENGRASAR, title: titulo, body: cuerpo,
        extra: extraDatos(porEngrasar, 'porEngrasar'),
        schedule: { at: nextTimeAt(h.hour, h.minute), every: 'day', repeats: true }
      });
      if (porEngrasar.length) registrarAvisoEnviado('porEngrasar', titulo, cuerpo, rol);

      if (cfgP.recordatorio && porEngrasar.length) {
        const hr = (h.hour + (cfgP.recordatorioHoras || 4)) % 24;
        const hAjust = horaAjustadaAlTurno(settings, hr, h.minute);
        notifications.push({
          id: NOTIF_ID_POR_ENGRASAR_REC,
          title: `🟡 Recordatorio: faltan ${porEngrasar.length} equipo(s) por engrasar`,
          body: lista,
          extra: extraDatos(porEngrasar, 'porEngrasar'),
          schedule: { at: nextTimeAt(hAjust.hour, hAjust.minute), every: 'day', repeats: true }
        });
      }
    }

    // ── 3) Resumen de CUMPLIMIENTO ────────────────────────────────
    const cfgC = settings.cumplimiento;
    if (cfgC.enabled && cfgC.roles.includes(rol)) {
      const totalV = statuses.filter(x => x.s.code === 'ROJO').length;
      const totalA = statuses.filter(x => x.s.code === 'AMARILLO').length;
      const compliance = equipos.length ? Math.round(((equipos.length - totalV) / equipos.length) * 100) : 100;
      const hace7 = Date.now() - 7 * 86400000;
      const pendSemana = (await DB.allActive('lubrication_records'))
        .filter(r => new Date(r.date).getTime() >= hace7)
        .reduce((n, r) => n + (r.details || []).filter(d => !d.done).length, 0);
      notifications.push({
        id: NOTIF_ID_COMPLIANCE,
        title: 'Cumplimiento de engrase',
        body: `Cumplimiento: ${compliance}%. ${totalV} vencido(s), ${totalA} próximo(s).${pendSemana ? ` ${pendSemana} punto(s) sin engrasar esta semana.` : ''}`,
        extra: { tipo: 'cumplimiento', ruta: 'dashboard' },
        schedule: { at: nextTimeAt(cfgC.hour, cfgC.minute), every: 'day', repeats: true }
      });
    }

    // ── 4) Resumen SEMANAL (lunes) ────────────────────────────────
    const cfgS = settings.resumenSemanal;
    if (cfgS && cfgS.enabled && cfgS.roles.includes(rol)) {
      const hace7 = Date.now() - 7 * 86400000;
      const recs = (await DB.allActive('lubrication_records')).filter(r => new Date(r.date).getTime() >= hace7);
      const puntosFallidos = {};
      recs.forEach(r => (r.details || []).filter(d => !d.done).forEach(d => {
        const k = d.reason || 'Sin motivo';
        puntosFallidos[k] = (puntosFallidos[k] || 0) + 1;
      }));
      const topMotivo = Object.entries(puntosFallidos).sort((a, b) => b[1] - a[1])[0];
      const totalV = statuses.filter(x => x.s.code === 'ROJO').length;
      const compliance = equipos.length ? Math.round(((equipos.length - totalV) / equipos.length) * 100) : 100;
      notifications.push({
        id: NOTIF_ID_SEMANAL,
        title: '📊 Resumen de la semana',
        body: `${recs.length} engrase(s) realizados · Cumplimiento ${compliance}%${topMotivo ? ` · Lo que más falló: ${topMotivo[0]} (${topMotivo[1]})` : ''}`,
        extra: { tipo: 'semanal', ruta: 'reportes' },
        schedule: { at: proximoDiaSemana(cfgS.diaSemana ?? 1, cfgS.hour, cfgS.minute), every: 'week', repeats: true }
      });
    }

    if (notifications.length) await LN.schedule({ notifications });
  } catch (e) {
    console.warn('No se pudieron programar notificaciones locales', e);
  }
}

/* Próxima fecha en que cae determinado día de la semana (0=domingo, 1=lunes...) */
function proximoDiaSemana(dia, hora, minuto) {
  const d = new Date();
  d.setHours(hora, minuto, 0, 0);
  const diff = (dia - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + (diff === 0 && d.getTime() <= Date.now() ? 7 : diff));
  return d;
}

/* ---------- Aviso INMEDIATO al registrar un engrase ----------
   Se dispara en el momento en que un lubricador termina un engrase, si el
   Administrador activó ese aviso. A quien lo registró NO se le avisa (ya lo sabe). */
async function notificarEngraseRealizado(record, equipment) {
  try {
    const settings = mergeNotifSettings(await DB.get('settings', 'notifications'));
    const cfg = settings.engraseRealizado;
    if (!settings.enabled || !cfg.enabled) return;

    // Si está marcado "solo críticos", avisa únicamente cuando el equipo venía VENCIDO
    // o quedaron puntos sin engrasar — así no se satura a nadie con avisos de rutina.
    if (cfg.soloCriticos) {
      const huboPendientes = (record.details || []).some(d => !d.done);
      const veniaVencido = record._veniaVencido === true;
      if (!huboPendientes && !veniaVencido) return;
    }

    const pendientes = (record.details || []).filter(d => !d.done).length;
    const titulo = pendientes ? '⚠ Engrase con puntos pendientes' : '✓ Engrase realizado';
    const cuerpo = `${equipment.code} · ${record.userName}${pendientes ? ` · ${pendientes} punto(s) sin engrasar` : ''}`;

    // En este dispositivo se muestra como aviso en pantalla; a los demás les llega por push
    if (cfg.roles.includes(App.currentUser.role) && record.userId !== App.currentUser.id) {
      showInAppToast(`${titulo}: ${cuerpo}`);
    }
    // El envío a los demás dispositivos lo hace la función del servidor al detectar el
    // registro nuevo (ver supabase/functions/notify-push).
  } catch (e) { console.warn('No se pudo avisar del engrase', e); }
}

const PERMISSIONS = {
  ADMINISTRADOR: ['dashboard','equipos','plan','matriz','turno','registrar','horometros','anomalias','lubricantes','historial','reportes','usuarios','config','ayuda'],
  PLANIFICADOR: ['dashboard','equipos','plan','matriz','turno','historial','reportes','horometros','ayuda'],
  SUPERVISOR: ['dashboard','equipos','matriz','turno','anomalias','historial','usuarios','ayuda'],
  LUBRICADOR: ['turno','anomalias','historial','ayuda'],
  VISOR: ['dashboard','matriz','historial','reportes','ayuda']
};

/* ---------- utilidades ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const ic = (name) => `<span class="btn-icon icon-${name}"></span>`;

/* ---------- Escape de HTML (protección contra XSS) ----------
   Todo texto que haya escrito una persona (códigos, descripciones, notas, nombres…)
   DEBE pasar por aquí antes de insertarse en la página. Sin esto, alguien podría
   escribir código dentro del nombre de un equipo y ese código se ejecutaría en el
   navegador de todos los demás al sincronizar. */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
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

/* ---------- Utilidades de formato para Excel ----------
   SheetJS en su versión gratuita no aplica estilos automáticamente, pero sí los
   conserva si se escriben en cada celda. Estas funciones ponen encabezados con
   fondo de color, bordes y celdas coloreadas según el estado. */
function xlsCell(valor, estilo) {
  const esNumero = typeof valor === 'number';
  return { v: valor, t: esNumero ? 'n' : 's', s: estilo };
}

function xlsEstiloEncabezado(hexFondo = REPORT_COLORS.marca.hex) {
  return {
    font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
    fill: { patternType: 'solid', fgColor: { rgb: hexFondo } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: { top: { style: 'thin', color: { rgb: 'D0D5DD' } }, bottom: { style: 'thin', color: { rgb: 'D0D5DD' } },
              left: { style: 'thin', color: { rgb: 'D0D5DD' } }, right: { style: 'thin', color: { rgb: 'D0D5DD' } } }
  };
}

function xlsEstiloCelda({ hexFondo, hexTexto, negrita, centrado } = {}) {
  const e = {
    font: { sz: 10, bold: !!negrita, color: { rgb: hexTexto || '1B1F23' } },
    alignment: { vertical: 'center', horizontal: centrado ? 'center' : 'left', wrapText: false },
    border: { top: { style: 'hair', color: { rgb: 'D0D5DD' } }, bottom: { style: 'hair', color: { rgb: 'D0D5DD' } },
              left: { style: 'hair', color: { rgb: 'D0D5DD' } }, right: { style: 'hair', color: { rgb: 'D0D5DD' } } }
  };
  if (hexFondo) e.fill = { patternType: 'solid', fgColor: { rgb: hexFondo } };
  return e;
}

// Colores de relleno/texto según el estado del equipo
function xlsEstiloEstado(label) {
  const t = String(label || '').toUpperCase();
  const C = REPORT_COLORS;
  if (t.includes('VENCID')) return xlsEstiloCelda({ hexFondo: C.rojoSuave.hex, hexTexto: REPORT_COLORS.rojoTexto.hex, negrita: true, centrado: true });
  if (t.includes('PRÓXIM') || t.includes('PROXIM')) return xlsEstiloCelda({ hexFondo: C.ambarSuave.hex, hexTexto: REPORT_COLORS.ambarTexto.hex, negrita: true, centrado: true });
  if (t.includes('AL DÍA') || t.includes('AL DIA')) return xlsEstiloCelda({ hexFondo: C.verdeSuave.hex, hexTexto: REPORT_COLORS.verdeTexto.hex, negrita: true, centrado: true });
  return xlsEstiloCelda({ hexFondo: C.grisSuave.hex, hexTexto: REPORT_COLORS.grisTexto.hex, centrado: true });
}

function xlsEstiloCriticidad(crit) {
  const C = REPORT_COLORS;
  if (crit === 'Crítica') return xlsEstiloCelda({ hexFondo: C.rojoSuave.hex, hexTexto: REPORT_COLORS.rojoTexto.hex, negrita: true, centrado: true });
  if (crit === 'Alta') return xlsEstiloCelda({ hexFondo: C.ambarSuave.hex, hexTexto: REPORT_COLORS.ambarTexto.hex, negrita: true, centrado: true });
  if (crit === 'Media') return xlsEstiloCelda({ hexFondo: REPORT_COLORS.ambarSuave.hex, hexTexto: REPORT_COLORS.ambarTexto.hex, centrado: true });
  return xlsEstiloCelda({ centrado: true });
}

// Construye una hoja con encabezado de marca + tabla formateada
function xlsHojaConFormato({ titulo, subtitulo, columnas, filas, estiloPorCelda, hexEncabezado }) {
  const aoa = [];
  aoa.push([titulo]);
  if (subtitulo) aoa.push([subtitulo]);
  aoa.push([]);
  aoa.push(columnas);
  filas.forEach(f => aoa.push(f));

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const filaEncabezado = subtitulo ? 3 : 2; // índice 0

  // Título de marca
  ws['A1'].s = { font: { bold: true, sz: 15, color: { rgb: REPORT_COLORS.acento.hex } },
                 fill: { patternType: 'solid', fgColor: { rgb: REPORT_COLORS.marca.hex } },
                 alignment: { vertical: 'center' } };
  if (subtitulo && ws['A2']) {
    ws['A2'].s = { font: { sz: 10, color: { rgb: REPORT_COLORS.textoTenue.hex } } };
  }
  ws['!merges'] = ws['!merges'] || [];
  ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(columnas.length - 1, 1) } });
  if (subtitulo) ws['!merges'].push({ s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(columnas.length - 1, 1) } });
  ws['!rows'] = [{ hpt: 26 }];

  // Encabezados de columna
  columnas.forEach((_, ci) => {
    const ref = XLSX.utils.encode_cell({ r: filaEncabezado, c: ci });
    if (ws[ref]) ws[ref].s = xlsEstiloEncabezado(hexEncabezado);
  });

  // Cuerpo
  filas.forEach((fila, fi) => {
    fila.forEach((valor, ci) => {
      const ref = XLSX.utils.encode_cell({ r: filaEncabezado + 1 + fi, c: ci });
      if (!ws[ref]) return;
      ws[ref].s = estiloPorCelda ? estiloPorCelda(valor, ci, fila, fi) : xlsEstiloCelda();
    });
  });

  // Congelar la fila de encabezados para que no se pierda al desplazar
  ws['!freeze'] = { xSplit: 0, ySplit: filaEncabezado + 1 };
  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range(
      { r: filaEncabezado, c: 0 },
      { r: filaEncabezado + filas.length, c: columnas.length - 1 }
    )
  };
  return ws;
}

/* ---------- Paleta única para TODOS los informes (PDF, Excel, impresos) ----------
   Una sola fuente de verdad: si algún día se cambia un color de marca, se cambia aquí
   y queda igual en el PDF, en el Excel y en las hojas impresas. */
const REPORT_COLORS = {
  // Paleta validada por medición, no a ojo: navy apagado (49% de saturación, no el
  // azul eléctrico que se veía chillón impreso), estados de Atlassian suavizados, y
  // un ámbar desplazado hacia el dorado para que NO se confunda con el rojo (la
  // separación pasó de 38 a 81). Todos los textos superan 6.5 de contraste sobre su
  // fondo — el mínimo legible es 4.5.

  // ── Base institucional ──
  marca:      { rgb: [29, 41, 57],   hex: '1D2939' }, // tinta: casi negro azulado
  acento:     { rgb: [242, 169, 0],  hex: 'F2A900' }, // ámbar CAT (identidad de la app)
  azulTitulo: { rgb: [44, 62, 86],   hex: '2C3E56' }, // navy apagado para encabezados

  // ── Estados: color FUERTE (rellenos con texto blanco encima) ──
  verde:      { rgb: [33, 110, 78],  hex: '216E4E' },
  ambar:      { rgb: [141, 110, 0],  hex: '8D6E00' },
  rojo:       { rgb: [174, 46, 36],  hex: 'AE2E24' },
  gris:       { rgb: [90, 100, 115], hex: '5A6473' },

  // ── Estados: TEXTO oscuro (contraste ≥6.6 sobre su fondo claro) ──
  verdeTexto: { rgb: [23, 94, 69],   hex: '175E45' },
  ambarTexto: { rgb: [122, 82, 0],   hex: '7A5200' },
  rojoTexto:  { rgb: [145, 32, 24],  hex: '912018' },
  grisTexto:  { rgb: [71, 84, 103],  hex: '475467' },

  // ── Estados: FONDO claro (para celdas) ──
  verdeSuave: { rgb: [236, 253, 243],hex: 'ECFDF3' },
  ambarSuave: { rgb: [254, 250, 232],hex: 'FEFAE8' },
  rojoSuave:  { rgb: [254, 243, 242],hex: 'FEF3F2' },
  grisSuave:  { rgb: [242, 244, 247],hex: 'F2F4F7' },

  textoTenue: { rgb: [102, 112, 133],hex: '667085' }
};

// Color que corresponde a un porcentaje de cumplimiento, según la meta configurada
function colorPorCumplimiento(pct, meta = App.generalSettings.complianceTarget) {
  if (pct >= meta) return REPORT_COLORS.verde;
  if (pct >= 80) return REPORT_COLORS.ambar;
  return REPORT_COLORS.rojo;
}

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
  captureQrDeepLink(); // guarda el equipo del QR antes de mostrar el login
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    // Cuando el usuario toca una notificación del sistema, el Service Worker nos avisa
    // para llevarlo a la pantalla correspondiente.
    navigator.serviceWorker.addEventListener('message', (ev) => {
      if (ev.data?.tipo === 'notificacion-abierta' && App.currentUser) {
        const destino = ev.data.destino === 'anomaly' ? 'anomalias' : 'dashboard';
        const permitidas = PERMISSIONS[App.currentUser.role] || [];
        if (permitidas.includes(destino)) navigate(destino);
      }
    });
  }
  window.addEventListener('online', updateConnBadge);
  window.addEventListener('offline', updateConnBadge);
  Sync.onChange(onSyncStateChange);

  // Delegado en document (no en el botón directamente) porque el topbar se
  // vuelve a dibujar entero cada vez que cambia de pantalla — así funciona
  // siempre, sin tener que re-conectar el clic cada vez.
  document.addEventListener('click', (e) => {
    if (e.target.closest('#conn-badge')) {
      if (!navigator.onLine) { showInAppToast('Sin conexión a internet en este momento.'); return; }
      Sync.fullSync();
    }
  });
  wirePushListeners();
  wireLocalNotificationTaps();
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
    const body = `${eq ? eq.code : 'Equipo'} · ${esc(a.component)} · Reportado por ${esc(a.createdBy)}`;

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
    b.title = lastSyncState.message || '';
  } else if (lastSyncState.status === 'partial') {
    b.textContent = `SINCRONIZADO PARCIAL (${lastSyncState.errors.length} con error)`;
    b.className = 'conn-badge conn-warn';
    b.title = 'Falló: ' + lastSyncState.errors.join(', ') + ' — se reintenta solo en la próxima sincronización.';
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
                <span class="login-name">${esc(u.name)}</span>
                <span class="login-role">${esc(u.role)}</span>
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
        logAudit('LOGIN_BLOQUEADO', `${esc(selected.username)} (${MAX_ATTEMPTS} intentos fallidos)`, 'sistema');
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
  stopInactivityTimer();
  sessionStorage.removeItem('engrase_user');
  App.currentUser = null;
  renderLogin();
}

/* ---------- Cierre de sesión por inactividad ----------
   Si alguien deja el celular desbloqueado con la app abierta en el pit, la sesión
   se cierra sola tras un rato sin uso, en vez de quedar abierta indefinidamente. */
const INACTIVITY_MINUTES = 30;
let inactivityTimer = null;
let finTurnoTimer = null;

/* ---------- Cierre de sesión al terminar el turno ----------
   Pensado para los teléfonos COMPARTIDOS entre cuadrillas: si la cuadrilla saliente
   deja la sesión abierta, la entrante registraría engrases con el nombre equivocado.
   Al terminar el turno la sesión se cierra sola, obligando a que cada quien entre
   con su propio PIN — así el historial siempre dice quién hizo qué. */
function programarCierrePorFinDeTurno() {
  clearTimeout(finTurnoTimer);
  if (!App.currentUser || App.currentUser.role !== 'LUBRICADOR') return;

  const { shiftDayStart, shiftNightStart } = App.generalSettings;
  const turno = App.currentUser.shiftId || currentShiftId();
  const horaFin = turno === 'shift_dia' ? shiftNightStart : shiftDayStart;

  const fin = new Date();
  fin.setHours(horaFin, 30, 0, 0); // media hora de margen para cerrar pendientes
  if (fin.getTime() <= Date.now()) fin.setDate(fin.getDate() + 1);

  const faltan = fin.getTime() - Date.now();
  if (faltan > 0 && faltan < 24 * 3600 * 1000) {
    finTurnoTimer = setTimeout(() => {
      if (!App.currentUser) return;
      alert('Terminó tu turno. La sesión se cierra para que la siguiente cuadrilla entre con su propio usuario.');
      logout();
    }, faltan);
  }
}

function resetInactivityTimer() {
  if (!App.currentUser) return;
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    if (!App.currentUser) return;
    alert(`Se cerró la sesión por ${INACTIVITY_MINUTES} minutos de inactividad. Vuelve a ingresar tu PIN.`);
    logout();
  }, INACTIVITY_MINUTES * 60 * 1000);
}

function stopInactivityTimer() { clearTimeout(inactivityTimer); inactivityTimer = null; clearTimeout(finTurnoTimer); finTurnoTimer = null; }

function startInactivityTracking() {
  ['click', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
    document.addEventListener(evt, resetInactivityTimer, { passive: true });
  });
  resetInactivityTimer();
}

/* ---------- shell principal ---------- */
const MENU = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'equipos', label: 'Equipos', icon: 'truck' },
  { id: 'plan', label: 'Plan de Engrase', icon: 'list' },
  { id: 'matriz', label: 'Matriz Semanal', icon: 'grid' },
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
  startInactivityTracking();
  programarCierrePorFinDeTurno();
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
          <div class="brand-mark small only-mobile"></div>
          <div class="topbar-title" id="topbar-title">Dashboard</div>
          <div class="topbar-right">
            ${themeButtonHTML()}
            <button type="button" id="conn-badge" class="conn-badge" title="Tocar para sincronizar ahora"></button>
            <span class="topbar-shift" id="topbar-shift"></span>
            <span class="topbar-user">${esc(App.currentUser.name)} · ${App.currentUser.role}</span>
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
    matriz: renderMatrizSemanal,
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
          <button type="button" id="conn-badge" class="conn-badge" title="Tocar para sincronizar ahora"></button>
          <button class="icon-btn" id="btn-logout" title="Cerrar sesión">⏻</button>
        </div>
      </header>
      <div class="lub-user-strip">👤 ${esc(App.currentUser.name)} · <span id="lub-shift"></span></div>
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
  const equiposTurno = equiposDeEstaPersona(equipos, App.currentUser);
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
            <span class="lub-eq-code">${esc(e.code)}</span>
            <span class="status-chip" style="--c:${STATUS_COLOR[s.code]}">${s.label}</span>
          </div>
          <div class="lub-eq-model">${esc(e.brand)} ${esc(e.model)}</div>
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
          <div class="lub-eq-bottom"><span class="mono">${fmt(r.hourmeter)} h</span><span>${esc(r.condition)}</span></div>
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

  openModal(`Editar engrase · ${esc(equipment.code)}`, `
    <p class="dim">Registrado el ${fmtDate(record.date)} por ${esc(record.userName)}. ${isLatest
      ? 'Este es el registro más reciente de este equipo — si cambias el horómetro, también se actualiza el horómetro actual del equipo.'
      : 'Este NO es el registro más reciente de este equipo — cambiar el horómetro aquí solo corrige este registro histórico, no toca el horómetro actual del equipo.'}</p>
    <form id="edit-grease-form">
      <div class="form-grid">
        <label class="span-2">Horómetro<input required type="number" step="0.1" name="hourmeter" value="${record.hourmeter}" class="big-input"/></label>
        <label>Tipo de grasa
          <select name="greaseType">${lubricants.map(l => `<option value="${l.id}" ${l.id === record.greaseType ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
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
              <span class="check-row-text">${esc(d.pointName)}</span>
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

  wirePhotoField($('#edit-grease-form'));
  // Carga las fotos que ya tenía el registro, para poder quitarlas o agregar más
  preloadPhotosIntoField($('#edit-grease-form'), photosOf(record));
  if (details.length) {
    $$('.chk-done', $('#edit-checklist')).forEach(chk => {
      chk.addEventListener('change', (e) => {
        e.target.closest('.checklist-item').querySelector('.chk-reason').classList.toggle('hidden', e.target.checked);
      });
    });
  }

  $('#edit-grease-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    const newHourmeter = parseFloat(fd.hourmeter);
    if (isLatest && !confirmHourmeterChange(equipment.hourmeter, newHourmeter)) return;

    const newDetails = details.length ? $$('.checklist-item', $('#edit-checklist')).map((item, i) => ({
      pointId: details[i].pointId, pointName: details[i].pointName,
      done: item.querySelector('.chk-done').checked,
      reason: item.querySelector('.chk-reason').value || null
    })) : [];
    const newPhotos = await getSelectedPhotos(ev.target);

    record.hourmeter = newHourmeter;
    record.greaseType = fd.greaseType;
    record.qty = parseFloat(fd.qty || 0);
    record.condition = fd.condition;
    record.notes = fd.notes;
    if (details.length) record.details = newDetails;
    record.photos = newPhotos;
    record.photo = newPhotos[0] || null; // compatibilidad con registros viejos
    await DB.put('lubrication_records', stamp(record, App.currentUser.name));

    if (isLatest) {
      equipment.hourmeter = newHourmeter;
      await DB.put('equipment', stamp(equipment, App.currentUser.name));
      if (plan) { plan.lastGreaseHour = newHourmeter; await DB.put('lubrication_plans', stamp(plan, App.currentUser.name)); }
    }
    await logAudit('ENGRASE_EDITADO', `${esc(equipment.code)} · registro del ${fmtDate(record.date)}`, App.currentUser.name);
    showInAppToast('✓ Engrase actualizado');
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

  // Días desde el último engrase registrado de cada equipo (sea cual sea su tipo de control)
  const lastRecordByEquipo = {};
  records.forEach(r => {
    if (!lastRecordByEquipo[r.equipmentId] || new Date(r.date) > new Date(lastRecordByEquipo[r.equipmentId])) {
      lastRecordByEquipo[r.equipmentId] = r.date;
    }
  });
  function daysSinceLastGrease(equipmentId) {
    const last = lastRecordByEquipo[equipmentId];
    if (!last) return null;
    return Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(last).setHours(0, 0, 0, 0)) / 86400000);
  }

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
      <div class="toolbar" style="padding:0 14px 10px">
        <label class="filter-label">Turno
          <select id="att-turno" class="input input-sm"><option value="">Ambos</option><option value="shift_dia">Día</option><option value="shift_noche">Noche</option></select>
        </label>
        <label class="filter-label">Día asignado
          <select id="att-dia" class="input input-sm"><option value="">Todos</option>${SCHEDULE_WEEKDAYS.map(d => `<option value="${d}">${d}</option>`).join('')}</select>
        </label>
      </div>
      <table class="data-table" id="att-table">
        <thead><tr><th>Estado</th><th>Código</th><th>Equipo</th><th>Turno</th><th>Control</th><th>Horómetro</th><th>Próximo / Día asignado</th><th>Restante / Atraso</th><th>Días sin engrase</th></tr></thead>
        <tbody id="att-tbody"></tbody>
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

  function drawAttentionTable() {
    const tbody = $('#att-tbody');
    if (!tbody) return;
    const turnoFilter = $('#att-turno').value;
    const diaFilter = $('#att-dia').value;

    const filtered = attention.filter(x => {
      if (turnoFilter && x.e.shiftId !== turnoFilter) return false;
      if (diaFilter) {
        if (!x.s.plan || !x.s.plan.assignedDays || !x.s.plan.assignedDays.includes(diaFilter)) return false;
      }
      return true;
    });

    tbody.innerHTML = filtered.map(x => {
      const isWeekday = !!x.s.scheduleDate;
      const isHours = x.s.nextHour !== undefined;
      let controlLabel = '—', nextCol = '—', restCol = '—';
      if (isHours) {
        controlLabel = 'Por horas';
        nextCol = fmt(x.s.nextHour) + ' h';
        restCol = x.s.remaining !== undefined && x.s.remaining !== null
          ? (x.s.remaining < 0 ? '+' + fmt(Math.abs(x.s.remaining)) + ' h atraso' : fmt(x.s.remaining) + ' h')
          : '—';
      } else if (isWeekday) {
        controlLabel = 'Día/turno';
        nextCol = WEEKDAY_NAMES[x.s.scheduleDate.getDay()];
        const diffDays = Math.floor((new Date().setHours(0, 0, 0, 0) - x.s.scheduleDate.getTime()) / 86400000);
        restCol = x.s.code === 'ROJO' ? `${diffDays} día(s) atraso` : (x.s.code === 'AMARILLO' ? 'Programado hoy' : '—');
      }
      const dsg = daysSinceLastGrease(x.e.id);
      return `<tr>
        <td><span class="dot" style="background:${STATUS_COLOR[x.s.code]}"></span> ${x.s.label}</td>
        <td class="mono">${esc(x.e.code)}</td>
        <td>${esc(x.e.brand)} ${esc(x.e.model)}</td>
        <td>${x.e.shiftId === 'shift_dia' ? 'Día' : 'Noche'}</td>
        <td>${controlLabel}</td>
        <td class="mono">${isHours ? fmt(x.e.hourmeter) + ' h' : '—'}</td>
        <td class="mono">${nextCol}</td>
        <td class="mono" style="color:${STATUS_COLOR[x.s.code]}">${restCol}</td>
        <td class="mono">${dsg === null ? 'Nunca registrado' : dsg + ' día(s)'}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="9" class="empty-state">Sin equipos para este filtro.</td></tr>`;
    makeTablesResponsive($('#dash-attention-panel'));
  }
  drawAttentionTable();
  $('#att-turno')?.addEventListener('change', drawAttentionTable);
  $('#att-dia')?.addEventListener('change', drawAttentionTable);
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
      <span class="eq-code">${esc(e.code)}</span>
      <span class="status-chip" style="--c:${STATUS_COLOR[s.code]}">${s.label}</span>
    </div>
    ${anomalies.length ? `<div class="eq-anomaly-badge ${criticas ? 'critical' : ''}">⚠ ${anomalies.length} anomalía${anomalies.length > 1 ? 's' : ''} abierta${anomalies.length > 1 ? 's' : ''}${criticas ? ' · crítica' : ''}</div>` : ''}
    <div class="eq-name">${esc(e.brand)} ${esc(e.model)}</div>
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
          <span class="eq-code">${e.shortCode ? e.shortCode + ' · ' : ''}${esc(e.code)}</span>
          <span class="status-chip" style="--c:${STATUS_COLOR[s.code]}">${s.label}</span>
        </div>
        <div class="eq-name">${esc(e.brand)} ${esc(e.model)}</div>
        <div class="eq-detail-row"><span>Tipo</span><span>${(types.find(t => t.id === e.typeId) || {}).name || '—'}</span></div>
        <div class="eq-detail-row"><span>Ubicación</span><span>${(locations.find(l => l.id === e.locationId) || {}).name || '—'}</span></div>
        <div class="eq-detail-row"><span>Estado</span><span>${esc(e.status)}</span></div>
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
            <select name="locationId"><option value="">— No cambiar —</option>${locations.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
          </label>
          <label>Nuevo turno (déjalo en blanco para no cambiarlo)
            <select name="shiftId"><option value="">— No cambiar —</option><option value="shift_dia">Turno Día</option><option value="shift_noche">Turno Noche</option></select>
          </label>
          <label>Nueva categoría (déjalo en blanco para no cambiarla)
            <select name="typeId"><option value="">— No cambiar —</option>${types.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
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
        const changes = [];
        if (fd.locationId) changes.push(`Ubicación → ${locations.find(l => l.id === fd.locationId)?.name || fd.locationId}`);
        if (fd.shiftId) changes.push(`Turno → ${fd.shiftId === 'shift_dia' ? 'Día' : 'Noche'}`);
        if (fd.typeId) changes.push(`Categoría → ${types.find(t => t.id === fd.typeId)?.name || fd.typeId}`);
        if (fd.status) changes.push(`Estado → ${fd.status}`);
        if (!changes.length) { alert('No marcaste ningún cambio — elige al menos un campo.'); return; }

        const affected = equipos.filter(e => selected.has(e.id));
        openModal('Confirmar cambio en lote', `
          <p><b>Se van a aplicar estos cambios:</b></p>
          <ul>${changes.map(c => `<li>${c}</li>`).join('')}</ul>
          <p><b>A estos ${affected.length} equipo(s):</b></p>
          <div style="max-height:30vh; overflow:auto; border:1px solid var(--border); border-radius:8px; padding:8px">
            ${affected.map(e => `<div class="mono">${esc(e.code)} — ${esc(e.brand)} ${esc(e.model)}</div>`).join('')}
          </div>
          <div class="modal-actions">
            <button class="btn" id="bulk-confirm-back">Volver</button>
            <button class="btn btn-accent" id="bulk-confirm-apply">${ic("check")}Sí, aplicar</button>
          </div>
        `);
        $('#bulk-confirm-back').addEventListener('click', () => $('#eq-bulk-apply').click());
        $('#bulk-confirm-apply').addEventListener('click', async () => {
          for (const id of selected) {
            const eq = await DB.get('equipment', id);
            if (fd.locationId) eq.locationId = fd.locationId;
            if (fd.shiftId) eq.shiftId = fd.shiftId;
            if (fd.typeId) eq.typeId = fd.typeId;
            if (fd.status) eq.status = fd.status;
            await DB.put('equipment', stamp(eq, App.currentUser.name));
          }
          await logAudit('EQUIPOS_EDITADOS_LOTE', `${selected.size} equipos: ${changes.join(', ')}`, App.currentUser.name);
          showInAppToast(`✓ ${selected.size} equipo(s) actualizados`);
          closeModal();
          navigate('equipos');
        });
      });
    });
    $('#eq-bulk-delete').addEventListener('click', async () => {
      if (!selected.size) { alert('Selecciona al menos un equipo.'); return; }
      if (!confirm(`¿Eliminar ${selected.size} equipo(s)? Es un borrado lógico — el historial de cada uno se conserva en auditoría, pero dejan de aparecer en la app. Esta acción no se puede deshacer desde la interfaz.`)) return;
      for (const id of selected) {
        const eq = await DB.get('equipment', id);
        if (eq) await deleteEquipmentCascade(eq);
      }
      await logAudit('EQUIPOS_ELIMINADOS_LOTE', `${selected.size} equipos`, App.currentUser.name);
      showInAppToast(`✓ ${selected.size} equipo(s) eliminados`);
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
        <tbody>${preview.map(p => `<tr><td class="mono">${p.code || '—'}</td><td class="mono">${p.shortCode || '—'}</td><td>${p.existing ? 'Actualizar' : 'Crear'}</td><td>${esc(p.brand)} ${esc(p.model)}</td></tr>`).join('')}</tbody>
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
    showInAppToast(`✓ Equipos importados: ${created} creados, ${updated} actualizados`);
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
  openModal(`${esc(e.code)}${e.shortCode ? ' · ' + e.shortCode : ''} · ${esc(e.brand)} ${esc(e.model)}`, `
    <div class="detail-grid">
      <div><b>Código</b><div class="mono">${esc(e.code)}</div></div>
      <div><b>Código ahorrativo</b><div class="mono">${e.shortCode || '—'}</div></div>
      <div><b>Categoría</b><div>${(types.find(t => t.id === e.typeId) || {}).name || '—'}</div></div>
      <div><b>Serie</b><div>${e.serial || '—'}</div></div>
      <div><b>Estado</b><div>${esc(e.status)}</div></div>
      <div><b>Horómetro</b><div class="mono">${fmt(e.hourmeter)} h</div></div>
      <div><b>Estado de engrase</b><div><span class="dot" style="background:${STATUS_COLOR[s.code]}"></span> ${s.label}</div></div>
      ${s.nextHour !== undefined ? `<div><b>Próximo engrase</b><div class="mono">${fmt(s.nextHour)} h</div></div>` : ''}
    </div>
    <div class="modal-actions">
      ${canEdit ? `<button class="btn btn-danger" id="btn-delete-eq">${ic("trash")}Eliminar equipo</button>` : ''}
      ${canEdit ? `<button class="btn" id="btn-edit-eq">${ic("edit")}Editar</button>` : ''}
      <button class="btn" id="btn-view-qr">${ic("qr")}Código QR</button>
      ${['ADMINISTRADOR','PLANIFICADOR','SUPERVISOR'].includes(App.currentUser.role) ? `
        <button class="btn" id="btn-pausar-avisos">${ic("clock")}${avisosPausados(e) ? 'Reanudar avisos' : 'Pausar avisos'}</button>` : ''}
      <button class="btn" id="btn-view-hist">Ver historial</button>
    </div>
  `);
  $('#btn-edit-eq')?.addEventListener('click', async () => {
    closeModal();
    const locations = await DB.allActive('locations');
    openEquipmentForm(e, types, locations);
  });
  $('#btn-delete-eq')?.addEventListener('click', async () => {
    if (!confirm(`¿Eliminar el equipo ${esc(e.code)}${e.shortCode ? ' (' + e.shortCode + ')' : ''}? Esta acción es un borrado lógico: el equipo deja de aparecer en la app pero su historial de engrases y anomalías se conserva en la auditoría. No se puede deshacer desde la interfaz.`)) return;
    await deleteEquipmentCascade(e);
    await logAudit('EQUIPO_ELIMINADO', `${esc(e.code)}${e.shortCode ? ' (' + e.shortCode + ')' : ''}`, App.currentUser.name);
    showInAppToast(`✓ Equipo ${esc(e.code)} eliminado`);
    closeModal();
    navigate('equipos');
  });
  $('#btn-view-qr')?.addEventListener('click', () => openEquipmentQR(e));

  // Pausar avisos: útil cuando un equipo entra a taller y seguiría generando avisos
  // de vencido todos los días sin que nadie pueda hacer nada.
  $('#btn-pausar-avisos')?.addEventListener('click', async () => {
    if (avisosPausados(e)) {
      e.avisosPausadosHasta = null;
      await DB.put('equipment', stamp(e, App.currentUser.name));
      await logAudit('AVISOS_REANUDADOS', e.code, App.currentUser.name);
      showInAppToast(`✓ Avisos reanudados para ${e.code}`);
      closeModal();
      return;
    }
    openModal(`Pausar avisos de ${e.code}`, `
      <p class="dim">Mientras el equipo esté pausado no generará avisos de engrase vencido ni aparecerá en las notificaciones. Sigue visible en las pantallas y en los reportes.</p>
      <label>Pausar hasta
        <input type="date" id="pausa-hasta" class="input" value="${new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)}"/>
      </label>
      <label>Motivo (queda en el historial)
        <select id="pausa-motivo" class="input">
          <option>En taller / mantenimiento mayor</option>
          <option>Equipo fuera de operación</option>
          <option>En traslado a otra mina</option>
          <option>Esperando repuestos</option>
          <option>Otro</option>
        </select>
      </label>
      <div class="modal-actions"><button class="btn btn-accent" id="btn-confirmar-pausa">${ic("check")}Pausar avisos</button></div>
    `);
    $('#btn-confirmar-pausa').addEventListener('click', async () => {
      const hasta = $('#pausa-hasta').value;
      const motivo = $('#pausa-motivo').value;
      if (!hasta) { alert('Elige hasta qué fecha.'); return; }
      e.avisosPausadosHasta = new Date(hasta + 'T23:59:59').toISOString();
      e.avisosPausaMotivo = motivo;
      await DB.put('equipment', stamp(e, App.currentUser.name));
      await logAudit('AVISOS_PAUSADOS', `${e.code} hasta ${hasta} · ${motivo}`, App.currentUser.name);
      showInAppToast(`✓ Avisos de ${e.code} pausados hasta ${hasta}`);
      closeModal();
    });
  });
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

/* ---------- Eliminar un equipo en cascada ----------
   Al dar de baja un equipo hay que ocultar TAMBIÉN lo que cuelga de él: su plan, sus
   puntos de engrase, sus registros y sus anomalías. Antes solo se ocultaban el equipo
   y el plan, así que los puntos/engrases/anomalías seguían activos y aparecían en
   reportes y conteos aunque el equipo ya no existiera en la lista. */
async function deleteEquipmentCascade(equipment, opts = {}) {
  const quien = App.currentUser.name;
  const conservarHistorial = opts.conservarHistorial !== false; // por defecto sí se conserva

  equipment.active = false;
  await DB.put('equipment', stamp(equipment, quien));

  const planes = (await DB.allActive('lubrication_plans')).filter(p => p.equipmentId === equipment.id);
  const puntos = await DB.allActive('lubrication_points');
  for (const plan of planes) {
    plan.active = false;
    await DB.put('lubrication_plans', stamp(plan, quien));
    for (const pt of puntos.filter(p => p.planId === plan.id)) {
      pt.active = false;
      await DB.put('lubrication_points', stamp(pt, quien));
    }
  }

  // Las anomalías abiertas de un equipo dado de baja ya no tienen sentido: se ocultan
  for (const a of (await DB.allActive('anomalies')).filter(a => a.equipmentId === equipment.id)) {
    a.active = false;
    await DB.put('anomalies', stamp(a, quien));
  }

  // El historial de engrases se conserva por defecto (sirve para auditoría), pero
  // se marca para que no cuente en los reportes de equipos activos.
  if (!conservarHistorial) {
    for (const r of (await DB.allActive('lubrication_records')).filter(r => r.equipmentId === equipment.id)) {
      r.active = false;
      await DB.put('lubrication_records', stamp(r, quien));
    }
  }
}

async function openEquipmentForm(equipment, types, locations) {
  const isNew = !equipment;
  const e = equipment || { code: '', shortCode: '', description: '', brand: '', model: '', serial: '', typeId: types[0]?.id, locationId: locations[0]?.id, status: 'Operativo', hourmeter: 0, shiftId: 'shift_dia', cuadrillaId: '' };
  if (isNew) e.code = await generateNextEquipmentCode();
  const cuadrillas = await DB.allActive('cuadrillas');

  openModal(equipment ? 'Editar equipo' : 'Nuevo equipo', `
    <form id="eq-form" class="form-grid">
      <label>Código<input required name="code" value="${esc(e.code)}"/><span class="field-hint">${isNew ? 'Sugerido automáticamente, puedes cambiarlo' : 'Puedes editarlo si lo necesitas'}</span></label>
      <label>Código ahorrativo<input name="shortCode" value="${e.shortCode || ''}" placeholder="Ej. A04, T01, V03..."/></label>
      <label class="span-2">Descripción<input required name="description" value="${esc(e.description)}"/></label>
      <label>Marca<input required name="brand" value="${esc(e.brand)}"/></label>
      <label>Modelo<input required name="model" value="${esc(e.model)}"/></label>
      <label>N° de serie<input name="serial" value="${e.serial || ''}"/></label>
      <label>Categoría
        <select name="typeId">${types.map(t => `<option value="${t.id}" ${t.id === e.typeId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      </label>
      <label>Ubicación
        <select name="locationId">${locations.map(l => `<option value="${l.id}" ${l.id === e.locationId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
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
          ${cuadrillas.map(cq => `<option value="${cq.id}" ${cq.id === e.cuadrillaId ? 'selected' : ''}>${esc(cq.name)}</option>`).join('')}
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
    if (isNaN(obj.hourmeter) || obj.hourmeter < 0) { alert('El horómetro debe ser un número válido y positivo.'); return; }
    if (obj.hourmeter > 200000) { alert('Ese horómetro parece un error de digitación (más de 200.000 horas). Verifícalo antes de guardar.'); return; }
    if ((obj.description || '').length > 500) { alert('La descripción es demasiado larga (máximo 500 caracteres).'); return; }
    if (!isNew && !confirmHourmeterChange(e.hourmeter, obj.hourmeter)) return;

    const allEquipos = await DB.allActive('equipment');
    const collision = allEquipos.find(other => other.id !== e.id && other.code.toLowerCase() === obj.code.toLowerCase());
    if (collision) {
      alert(`Ese código ya lo tiene el equipo "${esc(collision.brand)} ${esc(collision.model)}". Usa uno distinto.`);
      return;
    }

    Object.assign(e, obj);
    await DB.put('equipment', stamp(e, App.currentUser.name));
    await logAudit('EQUIPO_GUARDADO', `Equipo ${esc(e.code)}${e.shortCode ? ' (' + e.shortCode + ')' : ''}`, App.currentUser.name);
    showInAppToast(`✓ Equipo ${esc(e.code)} guardado`);
    closeModal();
    if (isNew && confirm(`Equipo "${esc(e.code)}" creado. ¿Quieres configurar su plan de engrase ahora?`)) {
      const lubricants = await DB.allActive('lubricants');
      openPlanForm(e.id, null, lubricants);
    } else {
      navigate('equipos');
    }
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
  // Índice de puntos por plan: una sola lectura para toda la pantalla
  const puntosPorPlan = {};
  (await DB.allActive('lubrication_points')).forEach(p => {
    (puntosPorPlan[p.planId] = puntosPorPlan[p.planId] || []).push(p);
  });
  // A diferencia de otras pantallas (Equipos, Usuarios), aquí también dejamos entrar al
  // Planificador con las herramientas completas — configurar el plan de engrase es
  // literalmente su trabajo principal, no tenía sentido limitarlo a solo uno por uno.
  const canEdit = ['ADMINISTRADOR', 'PLANIFICADOR'].includes(App.currentUser.role);
  let bulkMode = false;
  const selected = new Set();

  c.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-accent" id="plan-matrix">${ic("grid")}Ver matriz semanal</button>
      <button class="btn" id="plan-print-week">${ic("print")}Imprimir plan de la semana</button>
      <button class="btn" id="plan-print-month">${ic("print")}Imprimir plan del mes</button>
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
            // Los puntos se cargan UNA vez fuera del bucle (antes se recargaba la tabla
            // completa por cada equipo: con 300 equipos eran 300 lecturas de 4.500 puntos).
            const points = plan ? (puntosPorPlan[plan.id] || []) : [];
            const isWeekday = plan && plan.controlType === 'Día y turno de la semana';
            return `<tr data-row-id="${e.id}">
              ${canEdit ? `<td><input type="checkbox" class="plan-bulk-check ${bulkMode ? '' : 'hidden'}" data-id="${e.id}"/></td>` : ''}
              <td class="mono">${esc(e.code)}</td>
              <td>${esc(e.brand)} ${esc(e.model)}</td>
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

  $('#plan-matrix').addEventListener('click', () => navigate('matriz'));
  $('#plan-print-week').addEventListener('click', () => printGreasePlan('semana', equipos, plans, types));
  $('#plan-print-month').addEventListener('click', () => printGreasePlan('mes', equipos, plans, types));

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

/* ---------- Imprimir / compartir contenido HTML ----------
   En el navegador se abre una ventana nueva y se manda a imprimir. En la APP INSTALADA
   no existen las ventanas emergentes (window.open devuelve null), y por eso antes daba
   error: ahí mostramos el contenido dentro de la propia app, con opción de imprimir
   mediante el diálogo del sistema Android. */
function printHTMLDocument(titulo, cuerpoHTML, estilosExtra = '') {
  const estilosBase = `
    body { font-family: Arial, sans-serif; margin: 16px; color: #111; font-size: 12px; background: #fff; }
    h1 { font-size: 17px; margin: 0 0 2px; color: #1D2939; }
    .sub { color: #555; font-size: 11px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    th, td { border: 1px solid #D0D5DD; padding: 5px 6px; text-align: left; }
    @media print { body { margin: 6px; } .no-print { display: none !important; } }
    ${estilosExtra}`;

  const docHTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${titulo}</title><style>${estilosBase}</style></head><body>${cuerpoHTML}</body></html>`;

  const win = window.open('', '_blank');
  if (win && win.document) {
    win.document.write(docHTML);
    win.document.close();
    setTimeout(() => { try { win.print(); } catch (e) {} }, 400);
    return;
  }

  // Sin ventanas emergentes (app instalada): se muestra dentro de la app misma.
  const overlay = document.createElement('div');
  overlay.className = 'print-overlay';
  overlay.innerHTML = `
    <div class="print-overlay-bar no-print">
      <button class="btn btn-sm" id="print-close">✕ Cerrar</button>
      <span class="print-overlay-title">${esc(titulo)}</span>
      <button class="btn btn-sm btn-accent" id="print-now">${ic("print")}Imprimir / PDF</button>
    </div>
    <div class="print-overlay-content">${cuerpoHTML}</div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('printing-mode');

  const cerrar = () => { overlay.remove(); document.body.classList.remove('printing-mode'); };
  overlay.querySelector('#print-close').addEventListener('click', cerrar);
  overlay.querySelector('#print-now').addEventListener('click', () => {
    // El diálogo de impresión de Android permite "Guardar como PDF" y compartirlo
    try { window.print(); }
    catch (e) { alert('Este dispositivo no permite imprimir directamente. Puedes tomar una captura de pantalla, o generar el informe desde la versión web.'); }
  });
}

/* ---------- Plan de engrase imprimible, en formato de MATRIZ semanal ----------
   Una fila por equipo y una columna por día, igual que la planilla que se usa en campo:
   REALIZADO (verde) donde ya se engrasó, NO REALIZADO (naranja) donde tocaba y no se hizo,
   y en blanco los días que no estaban programados para ese equipo. */
async function printGreasePlan(rango, equipos, plans, types) {
  const locations = await DB.allActive('locations');
  const records = await DB.allActive('lubrication_records');
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

  // Rango de días (lunes a sábado; el domingo se muestra como columna fija de descanso)
  let inicio, fin;
  if (rango === 'semana') {
    inicio = new Date(hoy);
    const dow = inicio.getDay();
    inicio.setDate(inicio.getDate() - (dow === 0 ? 6 : dow - 1)); // lunes de esta semana
    fin = new Date(inicio); fin.setDate(inicio.getDate() + 5);    // sábado
  } else {
    inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
  }

  const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

  // Fechas de cada día del rango (para el mes, se agrupan por semana)
  function fechasDeSemana(lunes) {
    return DIAS_SEMANA.map((_, i) => { const d = new Date(lunes); d.setDate(lunes.getDate() + i); return d; });
  }
  const semanas = [];
  if (rango === 'semana') {
    semanas.push({ lunes: new Date(inicio), fechas: fechasDeSemana(inicio) });
  } else {
    let cursor = new Date(inicio);
    const dowIni = cursor.getDay();
    cursor.setDate(cursor.getDate() - (dowIni === 0 ? 6 : dowIni - 1)); // retrocede al lunes
    while (cursor <= fin) {
      semanas.push({ lunes: new Date(cursor), fechas: fechasDeSemana(cursor) });
      cursor.setDate(cursor.getDate() + 7);
    }
  }

  const nombreLoc = id => (locations.find(l => l.id === id) || {}).name || '';

  // ¿Se engrasó este equipo en esta fecha?
  function seEngraso(equipmentId, fecha) {
    const dStr = fecha.toDateString();
    return records.some(r => r.equipmentId === equipmentId && new Date(r.date).toDateString() === dStr);
  }

  // ¿Estaba programado este equipo para esta fecha?
  function estabaProgramado(eq, plan, fecha) {
    if (!plan) return false;
    if (plan.controlType === 'Día y turno de la semana') {
      return (plan.assignedDays || []).includes(WEEKDAY_NAMES[fecha.getDay()]);
    }
    // Control por horas: se considera programado el día en que estaba vencido o próximo
    if (fecha.getTime() > hoy.getTime()) return false; // el futuro por horas no se puede saber
    const proximo = plan.lastGreaseHour + plan.frequency;
    return (proximo - eq.hourmeter) <= (plan.alertYellowHours || 0);
  }

  function celda(eq, plan, fecha) {
    const futuro = fecha.getTime() > hoy.getTime();
    if (seEngraso(eq.id, fecha)) return '<td class="ok">REALIZADO</td>';
    if (!estabaProgramado(eq, plan, fecha)) return '<td></td>';
    if (futuro) return '<td class="prog">PROGRAMADO</td>';
    return '<td class="no">NO REALIZADO</td>';
  }

  function tablaTurno(titulo, listaEquipos, fechas) {
    if (!listaEquipos.length) return '';
    return `
      <table class="matriz">
        <thead>
          <tr><th class="tit" colspan="8">${esc(titulo)}</th></tr>
          <tr>
            <th class="eqcol">Equipo/No.</th>
            ${fechas.map((d, i) => `<th>${DIAS_SEMANA[i]}<div class="fechita">${d.getDate()}/${d.getMonth() + 1}</div></th>`).join('')}
            <th class="domingo-h">Domingo</th>
          </tr>
        </thead>
        <tbody>
          ${listaEquipos.map(({ eq, plan }, idx) => `
            <tr>
              <td class="eqcol"><b>${esc(eq.code)}</b>${eq.shortCode ? ` / ${esc(eq.shortCode)}` : ''}</td>
              ${fechas.map(d => celda(eq, plan, d)).join('')}
              ${idx === 0 ? `<td class="domingo" rowspan="${listaEquipos.length}"><span>ENGRASE A FLOTA DE VOLQUETES</span></td>` : ''}
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  // Equipos con plan, separados por turno
  const conPlan = equipos
    .filter(e => e.status === 'Operativo')
    .map(e => ({ eq: e, plan: plans.find(p => p.equipmentId === e.id) }))
    .filter(x => x.plan)
    .sort((a, b) => a.eq.code.localeCompare(b.eq.code, undefined, { numeric: true }));

  const dia = conPlan.filter(x => x.eq.shiftId === 'shift_dia');
  const noche = conPlan.filter(x => x.eq.shiftId === 'shift_noche');

  if (!conPlan.length) {
    alert('No hay equipos con plan de engrase configurado todavía. Configura al menos un plan antes de imprimir.');
    return;
  }

  const bloques = semanas.map(({ lunes, fechas }) => {
    const rotulo = rango === 'mes'
      ? `<h2 class="semana-tit">Semana del ${lunes.getDate()}/${lunes.getMonth() + 1}</h2>` : '';
    return `${rotulo}
      ${tablaTurno('PLAN DE ENGRASE FLOTA DE ACARREO (TURNO DÍA)', dia, fechas)}
      ${tablaTurno('PLAN DE ENGRASE FLOTA DE ACARREO (TURNO NOCHE)', noche, fechas)}`;
  }).join('');

  // Paleta IBM Carbon: los tonos de texto tienen contraste >= 7 sobre su fondo,
  // así la hoja se lee bien impresa, con poca luz o fotocopiada.
  const estilos = `
    .matriz { border-collapse: collapse; margin-bottom: 18px; page-break-inside: avoid; }
    .matriz th, .matriz td { border: 1px solid #D0D5DD; padding: 5px 6px; text-align: center; font-size: 11px; }
    .matriz .tit { background: #2C3E56; color: #fff; font-size: 13px; letter-spacing: .02em; padding: 7px; border-color: #2C3E56; }
    .matriz thead tr:nth-child(2) th { background: #F2F4F7; color: #1D2939; font-weight: bold; border-bottom: 2px solid #2C3E56; }
    .matriz .eqcol { text-align: left; background: #fff; font-weight: bold; white-space: nowrap; }
    .matriz .fechita { font-weight: normal; font-size: 9px; color: #667085; }
    .matriz td.ok   { background: #ECFDF3; color: #175E45; font-weight: bold; }
    .matriz td.no   { background: #FEF3F2; color: #912018; font-weight: bold; }
    .matriz td.prog { background: #FEFAE8; color: #7A5200; }
    .matriz .domingo, .matriz .domingo-h { background: #F2F4F7; color: #475467; font-weight: bold; }
    .matriz .domingo span { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; font-size: 11px; }
    .semana-tit { font-size: 13px; margin: 16px 0 6px; color: #1D2939; border-bottom: 2px solid #F2A900; padding-bottom: 3px; }
    .leyenda { display: flex; gap: 10px; font-size: 10.5px; margin-bottom: 12px; flex-wrap: wrap; }
    .leyenda span { padding: 3px 10px; border: 1px solid #D0D5DD; font-weight: bold; }
    .lg-ok   { background: #ECFDF3; color: #175E45; }
    .lg-no   { background: #FEF3F2; color: #912018; }
    .lg-prog { background: #FEFAE8; color: #7A5200; }
    .lg-vacio { background: #fff; color: #475467; font-weight: normal; }`;

  const cuerpo = `
    <h1>Plan de Engrase — ${rango === 'semana' ? `Semana del ${inicio.getDate()}/${inicio.getMonth() + 1} al ${fin.getDate()}/${fin.getMonth() + 1}` : `Mes de ${hoy.toLocaleDateString('es', { month: 'long', year: 'numeric' })}`}</h1>
    <div class="sub">Generado el ${fmtDate(nowISO())} por ${esc(App.currentUser.name)}</div>
    <div class="leyenda">
      <span class="lg-ok">REALIZADO</span>
      <span class="lg-no">NO REALIZADO</span>
      <span class="lg-prog">PROGRAMADO (aún no llega el día)</span>
      <span class="lg-vacio">En blanco = no programado</span>
    </div>
    ${bloques}`;

  printHTMLDocument(`Plan de engrase — ${rango === 'semana' ? 'Semana' : 'Mes'}`, cuerpo, estilos);
}

/* ---------- Configurar el mismo plan de engrase para varios equipos a la vez ---------- */
function openBulkPlanForm(equipmentIds) {
  openModal(`Configurar plan para ${equipmentIds.length} equipo(s)`, `
    <p class="dim">Esto crea o actualiza el plan de cada equipo seleccionado con estos mismos valores. Si un equipo ya tenía un plan por horas, su horómetro de referencia se toma del horómetro actual de CADA equipo (no un valor compartido). Los puntos de engrase no se tocan aquí — agrégalos por equipo o con "Importar puntos de engrase desde Excel".</p>
    <form id="bulk-plan-form" class="form-grid">
      <label class="span-2">Tipo de control
        <select name="controlType" id="bulk-plan-control-type">
          ${['Horas de operación', 'Día y turno de la semana'].map(o => `<option>${o}</option>`).join('')}
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
    showInAppToast(`✓ Plan aplicado en lote: ${created} creados, ${updated} actualizados`);
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
    showInAppToast(`✓ Puntos de engrase importados: ${pointsCreated} nuevos`);
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

  openModal(`Plan de engrase · ${esc(equipment.code)}`, `
    <form id="plan-form" class="form-grid">
      <label class="span-2">Tipo de control
        <select name="controlType" id="plan-control-type">
          ${['Horas de operación', 'Día y turno de la semana'].map(o => `<option ${plan && plan.controlType === o ? 'selected' : ''}>${o}</option>`).join('')}
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
    <div class="row-actions" style="flex-wrap:wrap; gap:8px">
      <button class="btn btn-sm" id="btn-add-point" ${plan ? '' : 'disabled title="Guarda el plan primero"'}>${ic("plus")}Agregar punto</button>
      <button class="btn btn-sm" id="btn-copy-points" ${plan ? '' : 'disabled title="Guarda el plan primero"'}>${ic("list")}Copiar puntos de otro equipo</button>
    </div>
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
    await logAudit('PLAN_GUARDADO', `Plan de ${esc(equipment.code)}`, App.currentUser.name);
    showInAppToast(`✓ Plan de ${esc(equipment.code)} guardado`);
    closeModal();
    navigate('plan');
  });

  $('#btn-add-point')?.addEventListener('click', () => {
    if (!plan) return;
    openPointForm(plan.id, null, lubricants);
  });

  $('#btn-copy-points')?.addEventListener('click', () => {
    if (!plan) return;
    openCopyPointsForm(plan, equipment, lubricants);
  });

  $$('.point-edit', document).forEach(b => b.addEventListener('click', () => openPointForm(plan.id, b.dataset.id, lubricants)));
  $$('.point-del', document).forEach(b => b.addEventListener('click', async () => {
    // Borrado LÓGICO (active=false), no DB.delete: si se borra solo del dispositivo, el
    // servidor no se entera y en la siguiente sincronización el punto vuelve a aparecer.
    const pt = await DB.get('lubrication_points', b.dataset.id);
    if (!pt) return;
    if (!confirm(`¿Eliminar el punto "${pt.point}"?`)) return;
    pt.active = false;
    await DB.put('lubrication_points', stamp(pt, App.currentUser.name));
    await logAudit('PUNTO_ELIMINADO', `${pt.point} (plan de ${equipment.code})`, App.currentUser.name);
    showInAppToast('✓ Punto eliminado');
    closeModal();
    openPlanForm(equipmentId, plan.id, lubricants);
  }));
}

function pointRow(p, lubricants) {
  const lub = lubricants.find(l => l.id === p.greaseType);
  return `<div class="point-row">
    ${p.photo ? photoThumbHTML(p.photo, p.point) : ''}
    <div><b>${esc(p.point)}</b><div class="dim">${lub ? lub.name : ''} · ${p.recommendedQty} kg</div></div>
    <div class="row-actions">
      <button class="btn btn-sm point-edit" data-id="${p.id}">${ic("edit")}Editar</button>
      <button class="btn btn-sm btn-danger point-del" data-id="${p.id}">${ic("trash")}Eliminar</button>
    </div>
  </div>`;
}

/* ---------- Copiar puntos de engrase de otro equipo (agrupados por familia) ----------
   Evita tener que escribir a mano los mismos 20 puntos en cada excavadora: se eligen
   los puntos de un equipo que ya está configurado y se copian a este. Los equipos se
   agrupan por categoría (Excavadora, Tractor, etc.), poniendo primero la del equipo actual. */
async function openCopyPointsForm(plan, equipment, lubricants) {
  const equipos = await DB.allActive('equipment');
  const plans = await DB.allActive('lubrication_plans');
  const allPoints = await DB.allActive('lubrication_points');
  const types = await DB.allActive('equipment_types');

  const conPuntos = equipos
    .filter(e => e.id !== equipment.id)
    .map(e => {
      const p = plans.find(pl => pl.equipmentId === e.id);
      const pts = p ? allPoints.filter(pt => pt.planId === p.id) : [];
      return { e, plan: p, pts };
    })
    .filter(x => x.pts.length > 0);

  if (!conPuntos.length) {
    alert('Todavía no hay ningún otro equipo con puntos de engrase configurados para copiar. Configura uno primero y luego podrás reutilizarlo en los demás.');
    return;
  }

  const porTipo = {};
  conPuntos.forEach(x => {
    const t = types.find(ty => ty.id === x.e.typeId);
    const nombre = t ? t.name : 'Sin categoría';
    (porTipo[nombre] = porTipo[nombre] || []).push(x);
  });
  const tipoActual = (types.find(t => t.id === equipment.typeId) || {}).name;
  const nombresOrdenados = Object.keys(porTipo).sort((a, b) => {
    if (a === tipoActual) return -1;
    if (b === tipoActual) return 1;
    return a.localeCompare(b);
  });

  openModal(`Copiar puntos a ${equipment.code}`, `
    <p class="dim">Elige un equipo que ya tenga sus puntos configurados y cópialos a <b>${esc(equipment.code)}</b>. Después puedes editarlos o quitar los que no apliquen.</p>
    <label>Copiar desde
      <select id="copy-source" class="input" style="width:100%">
        ${nombresOrdenados.map(nombre => `
          <optgroup label="${esc(nombre)}${nombre === tipoActual ? ' (misma categoría)' : ''}">
            ${porTipo[nombre].map(x => `<option value="${x.plan.id}">${esc(x.e.code)} · ${esc(x.e.brand)} ${esc(x.e.model)} — ${x.pts.length} punto(s)</option>`).join('')}
          </optgroup>`).join('')}
      </select>
    </label>
    <div id="copy-preview" style="margin-top:14px"></div>
    <div class="modal-actions">
      <button class="btn btn-accent" id="btn-do-copy">${ic("check")}Copiar los puntos seleccionados</button>
    </div>
  `);

  function pintarPreview() {
    const planId = $('#copy-source').value;
    const pts = allPoints.filter(pt => pt.planId === planId);
    $('#copy-preview').innerHTML = `
      <div class="dim" style="margin-bottom:6px">Se copiarán estos ${pts.length} punto(s) — desmarca los que no quieras:</div>
      <div class="copy-points-list">
        ${pts.map(pt => `
          <label class="copy-point-row">
            <input type="checkbox" class="copy-pt" value="${pt.id}" checked/>
            <span>${esc(pt.point)}</span>
          </label>`).join('')}
      </div>`;
  }
  pintarPreview();
  $('#copy-source').addEventListener('change', pintarPreview);

  $('#btn-do-copy').addEventListener('click', async () => {
    const ids = $$('.copy-pt').filter(chk => chk.checked).map(chk => chk.value);
    if (!ids.length) { alert('No seleccionaste ningún punto.'); return; }

    const yaExisten = allPoints.filter(pt => pt.planId === plan.id).map(pt => (pt.point || '').toLowerCase());
    let copiados = 0, repetidos = 0;
    for (const id of ids) {
      const origen = allPoints.find(pt => pt.id === id);
      if (!origen) continue;
      if (yaExisten.includes((origen.point || '').toLowerCase())) { repetidos++; continue; }
      await DB.put('lubrication_points', stamp({
        id: uid('pt'), planId: plan.id,
        system: origen.system, component: origen.component, point: origen.point,
        greaseType: origen.greaseType, recommendedQty: origen.recommendedQty,
        frequency: origen.frequency, notes: origen.notes,
        photos: origen.photos || [], photo: origen.photo || null,
        active: true
      }, App.currentUser.name));
      copiados++;
    }
    await logAudit('PUNTOS_COPIADOS', `${copiados} puntos copiados a ${equipment.code}`, App.currentUser.name);
    showInAppToast(`✓ ${copiados} punto(s) copiados${repetidos ? ` · ${repetidos} ya existían y se omitieron` : ''}`);
    closeModal();
    openPlanForm(equipment.id, plan.id, lubricants);
  });
}

function openPointForm(planId, pointId, lubricants) {
  const loadExisting = pointId ? DB.get('lubrication_points', pointId) : Promise.resolve(null);
  loadExisting.then(existing => {
    const p = existing || { system: 'General', component: '', point: '', greaseType: lubricants[0]?.id, recommendedQty: 0.5, frequency: 50, notes: '', photo: null };
    // Formulario simplificado: lo único obligatorio es el NOMBRE del punto. El resto
    // (grasa, cantidad, observaciones, foto) queda plegado en "Más opciones" — así
    // agregar 20 puntos de un equipo es rápido, sin llenar 7 campos cada vez.
    openModal(pointId ? 'Editar punto' : 'Nuevo punto de engrase', `
      <form id="point-form">
        <label class="pt-main-label">Nombre del punto de engrase
          <input required name="point" value="${esc(p.point)}" class="big-input" placeholder="Ej. Pin de dirección izquierdo" autofocus/>
          <span class="field-hint">Es lo único obligatorio. Lo demás puedes dejarlo como está.</span>
        </label>

        <details class="pt-more" ${existing && (p.notes || p.photo || p.component) ? 'open' : ''}>
          <summary>Más opciones (grasa, cantidad, foto…)</summary>
          <div class="form-grid" style="margin-top:12px">
            <label>Tipo de grasa
              <select name="greaseType">${lubricants.map(l => `<option value="${l.id}" ${l.id === p.greaseType ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
            </label>
            <label>Cantidad recomendada (kg)<input type="number" step="0.1" name="recommendedQty" value="${p.recommendedQty}"/></label>
            <label>Sistema<input name="system" value="${esc(p.system)}" placeholder="General"/></label>
            <label>Componente<input name="component" value="${esc(p.component)}" placeholder="Opcional"/></label>
            <label class="span-2">Observaciones<input name="notes" value="${esc(p.notes || '')}" placeholder="Opcional"/></label>
            ${photoFieldHTML()}
          </div>
        </details>

        <div class="modal-actions">
          ${!pointId ? `<button type="submit" class="btn" name="andAnother" value="1" id="pt-save-another">${ic("plus")}Guardar y agregar otro</button>` : ''}
          <button type="submit" class="btn btn-accent">${ic("save")}Guardar punto</button>
        </div>
      </form>
    `);
    wirePhotoField($('#point-form'));
    preloadPhotosIntoField($('#point-form'), photosOf(p));

    let agregarOtro = false;
    $('#pt-save-another')?.addEventListener('click', () => { agregarOtro = true; });

    $('#point-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target).entries());
      delete fd.photo; delete fd.andAnother;
      fd.recommendedQty = parseFloat(fd.recommendedQty) || 0;
      const fotos = await getSelectedPhotos(ev.target);
      fd.photos = fotos;
      fd.photo = fotos[0] || null; // compatibilidad con puntos guardados antes
      const obj = existing ? Object.assign(existing, fd) : stamp({ id: uid('pt'), planId, ...fd }, App.currentUser.name);
      await DB.put('lubrication_points', stamp(obj, App.currentUser.name));
      showInAppToast(`✓ Punto "${fd.point}" guardado`);
      closeModal();
      const equipmentId = (await DB.get('lubrication_plans', planId)).equipmentId;
      if (agregarOtro) {
        openPointForm(planId, null, lubricants); // vuelve al formulario vacío, listo para el siguiente
      } else {
        openPlanForm(equipmentId, planId, lubricants);
      }
    });
  });
}

/* ============================================================
   MATRIZ SEMANAL — vista tipo tabla: equipos en filas, días en columnas.
   Replica el formato que se usa en papel: verde = REALIZADO, naranja =
   programado pero pendiente, blanco = no le toca ese día.
   ============================================================ */
async function renderMatrizSemanal() {
  const c = $('#app-content');
  const equipos = await DB.allActive('equipment');
  const plans = await DB.allActive('lubrication_plans');
  const records = await DB.allActive('lubrication_records');
  const types = await DB.allActive('equipment_types');
  const locations = await DB.allActive('locations');

  // Semana visible (se puede navegar hacia atrás/adelante)
  if (!App.matrizOffset) App.matrizOffset = 0;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const lunes = new Date(hoy);
  lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7) + (App.matrizOffset * 7));
  const dias = [];
  for (let i = 0; i < 6; i++) { const d = new Date(lunes); d.setDate(lunes.getDate() + i); dias.push(d); }
  const finSemana = new Date(dias[5]); finSemana.setHours(23, 59, 59, 999);

  const filtroTurno = App.matrizTurno || '';
  const filtroTipo = App.matrizTipo || '';
  const filtroUbic = App.matrizUbic || '';

  let visibles = equipos.filter(e => {
    if (filtroTurno && e.shiftId !== filtroTurno) return false;
    if (filtroTipo && e.typeId !== filtroTipo) return false;
    if (filtroUbic && e.locationId !== filtroUbic) return false;
    return true;
  });
  // Solo equipos con plan por día/turno (los que tienen días asignados)
  visibles = visibles.filter(e => {
    const p = plans.find(pl => pl.equipmentId === e.id);
    return p && p.controlType === 'Día y turno de la semana' && (p.assignedDays || []).length;
  }).sort((a, b) => (a.shiftId || '').localeCompare(b.shiftId || '') || a.code.localeCompare(b.code));

  function estadoCelda(eq, fecha) {
    const plan = plans.find(p => p.equipmentId === eq.id);
    if (!plan) return { tipo: 'vacio' };
    const nombreDia = WEEKDAY_NAMES[fecha.getDay()];
    if (!(plan.assignedDays || []).includes(nombreDia)) return { tipo: 'vacio' };

    const hecho = records.find(r => r.equipmentId === eq.id &&
      new Date(r.date).toDateString() === fecha.toDateString());
    if (hecho) return { tipo: 'hecho', por: hecho.userName, fecha: hecho.date };
    if (fecha.getTime() > hoy.getTime()) return { tipo: 'futuro' };
    return { tipo: 'pendiente' };
  }

  const tablaTurno = (titulo, lista) => {
    if (!lista.length) return '';
    return `
      <div class="matriz-wrap">
        <table class="matriz">
          <thead>
            <tr><th colspan="${dias.length + 1}" class="matriz-titulo">${esc(titulo)}</th></tr>
            <tr>
              <th class="matriz-eq">Equipo / No.</th>
              ${dias.map(d => `<th>${WEEKDAY_NAMES[d.getDay()]}<div class="matriz-fecha">${d.getDate()}/${d.getMonth() + 1}</div></th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${lista.map(eq => `
              <tr>
                <td class="matriz-eq mono">${esc(eq.code)}${eq.shortCode ? ` / ${esc(eq.shortCode)}` : ''}</td>
                ${dias.map(d => {
                  const s = estadoCelda(eq, d);
                  if (s.tipo === 'hecho') return `<td class="celda-hecho" title="Realizado por ${esc(s.por)} · ${fmtDate(s.fecha)}">REALIZADO</td>`;
                  if (s.tipo === 'pendiente') return `<td class="celda-pendiente" title="Programado, sin registrar"></td>`;
                  if (s.tipo === 'futuro') return `<td class="celda-futuro" title="Programado para este día"></td>`;
                  return '<td></td>';
                }).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  };

  const delDia = visibles.filter(e => e.shiftId === 'shift_dia');
  const deNoche = visibles.filter(e => e.shiftId === 'shift_noche');

  // Conteos de la semana visible
  const totalCeldas = visibles.reduce((n, eq) => n + dias.filter(d => estadoCelda(eq, d).tipo !== 'vacio').length, 0);
  const hechas = visibles.reduce((n, eq) => n + dias.filter(d => estadoCelda(eq, d).tipo === 'hecho').length, 0);
  const pendientes = visibles.reduce((n, eq) => n + dias.filter(d => estadoCelda(eq, d).tipo === 'pendiente').length, 0);
  const pct = totalCeldas ? Math.round((hechas / totalCeldas) * 100) : 0;

  c.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-sm" id="mtz-prev">← Semana anterior</button>
      <span class="matriz-rango">${dias[0].getDate()}/${dias[0].getMonth() + 1} — ${dias[5].getDate()}/${dias[5].getMonth() + 1}/${dias[5].getFullYear()}${App.matrizOffset === 0 ? ' (semana actual)' : ''}</span>
      <button class="btn btn-sm" id="mtz-next">Semana siguiente →</button>
      ${App.matrizOffset !== 0 ? `<button class="btn btn-sm" id="mtz-hoy">Ir a hoy</button>` : ''}
      <button class="btn btn-sm btn-accent" id="mtz-print">${ic("print")}Imprimir</button>
      <button class="btn btn-sm" id="mtz-excel">${ic("download")}Descargar Excel</button>
    </div>

    <div class="toolbar">
      <label class="filter-label">Turno
        <select id="mtz-turno" class="input input-sm">
          <option value="">Ambos</option>
          <option value="shift_dia" ${filtroTurno === 'shift_dia' ? 'selected' : ''}>Día</option>
          <option value="shift_noche" ${filtroTurno === 'shift_noche' ? 'selected' : ''}>Noche</option>
        </select>
      </label>
      <label class="filter-label">Categoría
        <select id="mtz-tipo" class="input input-sm">
          <option value="">Todas</option>
          ${types.map(t => `<option value="${t.id}" ${filtroTipo === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select>
      </label>
      <label class="filter-label">Ubicación
        <select id="mtz-ubic" class="input input-sm">
          <option value="">Todas</option>
          ${locations.map(l => `<option value="${l.id}" ${filtroUbic === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
        </select>
      </label>
    </div>

    <div class="kpi-grid">
      ${kpiCard('PROGRAMADOS', totalCeldas, 'neutral')}
      ${kpiCard('REALIZADOS', hechas, 'green')}
      ${kpiCard('PENDIENTES', pendientes, 'amber')}
      ${kpiCard('CUMPLIMIENTO %', pct, pct >= App.generalSettings.complianceTarget ? 'green' : 'amber')}
    </div>

    ${visibles.length ? `
      ${tablaTurno('PLAN DE ENGRASE (TURNO DÍA)', delDia)}
      ${tablaTurno('PLAN DE ENGRASE (TURNO NOCHE)', deNoche)}
      <div class="color-legend">
        <span class="color-legend-item"><span class="dot" style="background:var(--green)"></span>Realizado</span>
        <span class="color-legend-item"><span class="dot" style="background:#F2B78C"></span>Programado, sin registrar</span>
        <span class="color-legend-item"><span class="dot" style="background:var(--border)"></span>No le toca ese día</span>
      </div>`
    : `<div class="panel"><div class="empty-state">No hay equipos con plan por "Día y turno de la semana" que coincidan con estos filtros.<br/>Esta vista solo muestra equipos con días asignados — configúralos en Plan de Engrase.</div></div>`}
  `;

  $('#mtz-prev').addEventListener('click', () => { App.matrizOffset--; renderMatrizSemanal(); });
  $('#mtz-next').addEventListener('click', () => { App.matrizOffset++; renderMatrizSemanal(); });
  $('#mtz-hoy')?.addEventListener('click', () => { App.matrizOffset = 0; renderMatrizSemanal(); });
  $('#mtz-turno').addEventListener('change', e => { App.matrizTurno = e.target.value; renderMatrizSemanal(); });
  $('#mtz-tipo').addEventListener('change', e => { App.matrizTipo = e.target.value; renderMatrizSemanal(); });
  $('#mtz-ubic').addEventListener('change', e => { App.matrizUbic = e.target.value; renderMatrizSemanal(); });

  $('#mtz-print').addEventListener('click', () => {
    const win = window.open('', '_blank');
    if (!win) { alert('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes e intenta de nuevo.'); return; }
    const tablas = (delDia.length ? tablaTurno('PLAN DE ENGRASE (TURNO DÍA)', delDia) : '') +
                   (deNoche.length ? tablaTurno('PLAN DE ENGRASE (TURNO NOCHE)', deNoche) : '');
    win.document.write(`<!DOCTYPE html><html><head><title>Plan de engrase semanal</title><style>
      /* Los navegadores QUITAN los colores de fondo al imprimir para ahorrar tinta.
         Estas dos reglas los fuerzan — sin ellas la hoja sale en blanco y negro. */
      *{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
      @page{size:landscape;margin:10mm}
      body{font-family:Arial,sans-serif;margin:14px;color:#111;font-size:11px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      h1{font-size:15px;margin:0 0 2px}
      .sub{color:#555;font-size:10px;margin-bottom:10px}
      table.matriz{width:100%;border-collapse:collapse;margin-bottom:18px;page-break-inside:avoid}
      table.matriz th,table.matriz td{border:1px solid #333;padding:5px 6px;text-align:center;font-size:10px}
      .matriz-titulo{background:#1F3864 !important;color:#fff !important;font-size:12px;padding:7px;letter-spacing:.5px}
      table.matriz thead tr:nth-child(2) th{background:#F2F2F2 !important;font-weight:bold}
      .matriz-eq{text-align:left !important;font-weight:bold;white-space:nowrap;background:#F2F2F2 !important}
      .matriz-fecha{font-weight:normal;font-size:8.5px;color:#666}
      /* Doble seguro: además del color de fondo, cada celda lleva un símbolo y un borde
         distinto, para que la hoja se entienda aunque el navegador imprima sin colores
         (pasa cuando "Gráficos de fondo" está desactivado en el diálogo de impresión). */
      .celda-hecho{background:#00B050 !important;color:#fff !important;font-weight:bold;font-style:italic;border:2px solid #00703C !important}
      .celda-pendiente,.celda-futuro{background:#F4B183 !important;border:2px dashed #C55A11 !important}
      .celda-pendiente:after,.celda-futuro:after{content:"PENDIENTE";font-size:8px;font-weight:bold;color:#7A3B0A}
      .aviso-color{font-size:9px;color:#888;border:1px dashed #bbb;padding:4px 8px;margin-bottom:10px;border-radius:4px}
      @media print{.aviso-color{display:none}}
      .leyenda{margin-top:10px;font-size:9.5px;display:flex;gap:16px;align-items:center}
      .leyenda span{display:inline-flex;align-items:center;gap:5px}
      .lg{width:14px;height:11px;border:1px solid #333;display:inline-block}
      .matriz-wrap{overflow:visible}
    </style></head><body>
      <h1>Plan de Engrase — Semana ${dias[0].getDate()}/${dias[0].getMonth() + 1} al ${dias[5].getDate()}/${dias[5].getMonth() + 1}/${dias[5].getFullYear()}</h1>
      <div class="sub">Generado el ${fmtDate(nowISO())} por ${esc(App.currentUser.name)} · Cumplimiento: ${pct}% (${hechas} de ${totalCeldas})</div>
      <div class="aviso-color">Si esta hoja sale sin colores: en el diálogo de impresión abre "Más ajustes" y activa <b>"Gráficos de fondo"</b>.</div>
      ${tablas}
      <div class="leyenda">
        <span><i class="lg" style="background:#00B050"></i> Realizado</span>
        <span><i class="lg" style="background:#F4B183"></i> Programado, sin registrar</span>
        <span><i class="lg" style="background:#fff"></i> No le corresponde ese día</span>
      </div>
    </body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 400);
  });

  $('#mtz-excel').addEventListener('click', () => {
    // Nota técnica: la librería gratuita de Excel (SheetJS) NO exporta colores ni bordes —
    // generaría una hoja en blanco y negro. Por eso se genera un archivo .xls en formato
    // HTML: Excel lo abre nativamente y SÍ respeta colores, bordes y celdas combinadas,
    // que es justo lo que hace falta para que la matriz se vea como la planilla.
    const encabezadoDias = dias.map(d =>
      `<th style="background-color:#F2F2F2;border:1px solid #333333;font-weight:bold;text-align:center;font-size:11px">${WEEKDAY_NAMES[d.getDay()]}<br/>${d.getDate()}/${d.getMonth() + 1}</th>`
    ).join('');

    const bloque = (titulo, lista) => {
      if (!lista.length) return '';
      return `
        <tr><td colspan="${dias.length + 1}" style="background-color:#1F3864;color:#FFFFFF;font-weight:bold;text-align:center;border:1px solid #333333;height:26px;font-size:13px">${esc(titulo)}</td></tr>
        <tr><th style="background-color:#F2F2F2;border:1px solid #333333;font-weight:bold;font-size:11px">Equipo / No.</th>${encabezadoDias}</tr>
        ${lista.map(eq => `
          <tr>
            <td style="border:1px solid #333333;font-weight:bold;background-color:#F2F2F2;font-size:11px">${esc(eq.code)}${eq.shortCode ? ' / ' + esc(eq.shortCode) : ''}</td>
            ${dias.map(d => {
              const s = estadoCelda(eq, d);
              if (s.tipo === 'hecho') return `<td style="background-color:#00B050;color:#FFFFFF;font-weight:bold;font-style:italic;text-align:center;border:1px solid #333333;font-size:10px">REALIZADO</td>`;
              if (s.tipo === 'vacio') return `<td style="border:1px solid #333333">&nbsp;</td>`;
              return `<td style="background-color:#F4B183;text-align:center;border:1px solid #333333">&nbsp;</td>`;
            }).join('')}
          </tr>`).join('')}
        <tr><td colspan="${dias.length + 1}" style="height:10px"></td></tr>`;
    };

    const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"/>
      <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
        <x:Name>Plan semanal</x:Name>
        <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
      </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
      <style>td,th{padding:5px 7px;font-family:Arial,sans-serif} col{width:110px}</style>
      </head><body>
      <table border="0" cellspacing="0" cellpadding="0">
        <colgroup><col style="width:150px"/>${dias.map(() => '<col/>').join('')}</colgroup>
        <tr><td colspan="${dias.length + 1}" style="font-size:16px;font-weight:bold">Plan de Engrase — Semana ${dias[0].getDate()}/${dias[0].getMonth() + 1} al ${dias[5].getDate()}/${dias[5].getMonth() + 1}/${dias[5].getFullYear()}</td></tr>
        <tr><td colspan="${dias.length + 1}" style="font-size:10px;color:#555555">Generado el ${fmtDate(nowISO())} por ${esc(App.currentUser.name)} · Cumplimiento ${pct}% (${hechas} de ${totalCeldas})</td></tr>
        <tr><td colspan="${dias.length + 1}" style="height:8px"></td></tr>
        ${bloque('PLAN DE ENGRASE (TURNO DÍA)', delDia)}
        ${bloque('PLAN DE ENGRASE (TURNO NOCHE)', deNoche)}
        <tr><td colspan="${dias.length + 1}" style="font-size:10px">Leyenda: verde = realizado · naranja = programado sin registrar · vacío = no le corresponde ese día</td></tr>
      </table></body></html>`;

    const blob = new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plan_engrase_${dias[0].getDate()}-${dias[0].getMonth() + 1}-${dias[5].getFullYear()}.xls`;
    a.click();
    URL.revokeObjectURL(url);
    showInAppToast('✓ Excel descargado con colores');
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
              <td class="mono">${esc(e.code)}</td>
              <td>${esc(e.brand)} ${esc(e.model)}</td>
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
        ${equipos.map(e => `<option value="${e.id}">${esc(e.code)} · ${esc(e.brand)} ${esc(e.model)}</option>`).join('')}
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
  // Estado ANTES de engrasar: sirve para saber si el equipo venía vencido, dato que usa
  // el aviso de "solo avisar de engrases críticos".
  const estadoPrevio = (await statusFor(equipment)).code;
  const plan = (await DB.allActive('lubrication_plans')).find(p => p.equipmentId === equipmentId);
  const points = plan ? (await DB.allActive('lubrication_points')).filter(p => p.planId === plan.id) : [];
  const lubricants = await DB.allActive('lubricants');
  // Solo Planificador y Administrador pueden capturar un engrase con fecha pasada
  // (por ejemplo, si al lubricador se le olvidó registrarlo en el sistema ese día).
  const puedeRetroactivo = ['PLANIFICADOR', 'ADMINISTRADOR'].includes(App.currentUser.role);
  const lubricadores = puedeRetroactivo
    ? (await DB.allActive('users')).filter(u => u.role === 'LUBRICADOR')
    : [];

  // Aviso si el equipo ya fue engrasado hoy por alguien más (evita que dos cuadrillas repitan el mismo trabajo)
  const todayStr = new Date().toDateString();
  const todaysRecords = (await DB.allActive('lubrication_records'))
    .filter(r => r.equipmentId === equipmentId && new Date(r.date).toDateString() === todayStr)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const alreadyDoneToday = todaysRecords[0];
  const duplicateWarning = alreadyDoneToday && alreadyDoneToday.userId !== App.currentUser.id
    ? `<div class="duplicate-warning">⚠ Este equipo ya fue engrasado hoy por <b>${esc(alreadyDoneToday.userName)}</b> a las ${new Date(alreadyDoneToday.date).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' })}. Verifica con tu supervisor antes de registrar otro engrase, para no duplicar el trabajo.</div>`
    : '';

  const draftId = `draft_${equipmentId}_${App.currentUser.id}`;
  const draft = await DB.get('grease_drafts', draftId);

  const html = `
    <div class="panel">
      <div class="panel-head"><h3>Registrar engrase — ${esc(equipment.code)} · ${esc(equipment.brand)} ${esc(equipment.model)}</h3></div>
      <div class="dim" style="padding:0 14px 8px">Registrado por ${esc(App.currentUser.name)} · ${fmtDate(nowISO())} · ${currentShiftId() === 'shift_dia' ? 'Turno Día' : 'Turno Noche'}</div>
      ${duplicateWarning}
      ${draft ? `<div class="draft-banner" id="draft-banner">📝 Tienes un progreso sin terminar guardado ${fmtDate(draft.savedAt)}. <button type="button" class="btn btn-sm btn-accent" id="btn-restore-draft">Continuar</button> <button type="button" class="btn btn-sm" id="btn-discard-draft">Descartar</button></div>` : ''}
      <form id="grease-form">
        <div class="form-grid">
          <label class="span-2">Horómetro actual
            <input required type="number" step="0.1" inputmode="decimal" name="hourmeter" id="hourmeter-input" value="${equipment.hourmeter}" class="big-input"/>
          </label>
          <label class="span-2 nohm-toggle">
            <input type="checkbox" id="nohm-check" ${equipment.noHourmeter ? 'checked' : ''}/>
            <span>Este equipo NO tiene horómetro, o está dañado / no se puede leer</span>
          </label>
          <div id="nohm-reason-wrap" class="span-2 hidden">
            <label>¿Por qué no se pudo leer?
              <select name="noHourmeterReason">
                ${['El equipo no tiene horómetro', 'Horómetro dañado', 'Pantalla ilegible / rota', 'Equipo apagado, no se pudo leer', 'Otro'].map(o => `<option>${o}</option>`).join('')}
              </select>
              <span class="field-hint">El engrase se registra igual. Queda anotado que no se pudo tomar el horómetro, y el plan por horas de este equipo no se recalcula.</span>
            </label>
          </div>
          <label>Tipo de grasa utilizada
            <select name="greaseType">${lubricants.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
          </label>
          <label>Cantidad utilizada (kg)<input type="number" step="0.1" inputmode="decimal" name="qty" value="0"/></label>
          ${puedeRetroactivo ? `
          <div class="span-2 retro-box">
            <label class="retro-toggle">
              <input type="checkbox" id="retro-check"/>
              <span>Registrar como engrase ATRASADO (con fecha anterior)</span>
            </label>
            <div id="retro-fields" class="form-grid hidden" style="margin-top:10px">
              <label>Fecha en que se hizo<input type="datetime-local" name="retroDate" max="${new Date().toISOString().slice(0, 16)}"/></label>
              <label>Turno en que se hizo
                <select name="retroShift"><option value="shift_dia">Turno Día</option><option value="shift_noche">Turno Noche</option></select>
              </label>
              <label class="span-2">Lo realizó
                <select name="retroUser">
                  ${lubricadores.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('') || '<option value="">(sin lubricadores registrados)</option>'}
                </select>
                <span class="field-hint">Queda registrado que ${esc(App.currentUser.name)} lo capturó de forma retroactiva.</span>
              </label>
            </div>
          </div>` : ''}
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
                ${p.photo ? `<img src="${p.photo}" class="photo-thumb check-row-thumb" data-full="${p.photo}" data-caption="${esc(p.point)}"/>` : ''}
                <input type="checkbox" class="chk-done" checked/>
                <span class="check-row-text">${esc(p.point)}</span>
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
    // Si por cualquier motivo el formulario no llegó a dibujarse (pantalla cambiada,
    // contenedor inexistente), salimos en silencio en vez de romper la app.
    if (!$('#grease-form')) return;
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
    // Equipo sin horómetro (o dañado): al marcarlo, el campo deja de ser obligatorio
    $('#nohm-check')?.addEventListener('change', (e) => {
      const sinHm = e.target.checked;
      $('#nohm-reason-wrap').classList.toggle('hidden', !sinHm);
      const input = $('#hourmeter-input');
      if (input) {
        input.required = !sinHm;
        input.disabled = sinHm;
        input.classList.toggle('input-disabled', sinHm);
      }
    });
    // Si el equipo ya venía marcado como "sin horómetro", aplicarlo al abrir
    if ($('#nohm-check')?.checked) $('#nohm-check').dispatchEvent(new Event('change'));

    $('#retro-check')?.addEventListener('change', (e) => {
      $('#retro-fields').classList.toggle('hidden', !e.target.checked);
      if (e.target.checked && !$('[name="retroDate"]').value) {
        // Por defecto, propone ayer a la misma hora — lo más común al capturar un olvido
        const ayer = new Date(Date.now() - 86400000);
        $('[name="retroDate"]').value = new Date(ayer.getTime() - ayer.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      }
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
    $('#btn-report-anomaly')?.addEventListener('click', () => openAnomalyForm(equipment.id, equipment.code));

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
      const marcadoRetro = !!$('#retro-check')?.checked && fd.retroDate;
      // Equipo SIN horómetro (o dañado/ilegible): el engrase se registra igual, sin
      // exigir la lectura. El plan por horas de ese equipo no se recalcula, porque no
      // hay dato fiable — queda anotado el motivo para que mantenimiento lo revise.
      const sinHorometro = !!$('#nohm-check')?.checked;
      if (sinHorometro) {
        // no validamos el horómetro: no hay lectura que validar
      } else if (marcadoRetro) {
        if (isNaN(newHourmeter) || newHourmeter < 0) {
          alert('El horómetro debe ser un número válido y positivo.');
          return;
        }
        if (newHourmeter > equipment.hourmeter) {
          if (!confirm(`El horómetro que anotaste (${fmt(newHourmeter)} h) es MAYOR que el horómetro actual del equipo (${fmt(equipment.hourmeter)} h). En un engrase atrasado normalmente debería ser menor. ¿Continuar de todas formas?`)) return;
        }
      } else if (!confirmHourmeterChange(equipment.hourmeter, newHourmeter)) return;

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

      const photos = await getSelectedPhotos(ev.target);

      // ¿Es un engrase atrasado (capturado después, con fecha anterior)?
      const esRetro = !!$('#retro-check')?.checked && fd.retroDate;
      const fechaRegistro = esRetro ? new Date(fd.retroDate).toISOString() : nowISO();
      const turnoRegistro = esRetro ? (fd.retroShift || currentShiftId()) : currentShiftId();
      const autor = esRetro && fd.retroUser
        ? (await DB.get('users', fd.retroUser)) || App.currentUser
        : App.currentUser;

      const record = stamp({
        id: uid('greg'), equipmentId: equipment.id, planId: plan ? plan.id : null,
        date: fechaRegistro, shiftId: turnoRegistro, hourmeter: sinHorometro ? equipment.hourmeter : newHourmeter,
        userId: autor.id, userName: autor.name,
        greaseType: fd.greaseType, qty: parseFloat(fd.qty || 0),
        condition: fd.condition, notes: fd.notes, details,
        photos, photo: photos[0] || null, // `photo` se mantiene por compatibilidad con registros viejos
        sinHorometro: sinHorometro || undefined,
        noHourmeterReason: sinHorometro ? fd.noHourmeterReason : undefined,
        retroactivo: esRetro || undefined,
        capturadoPor: esRetro ? App.currentUser.name : undefined,
        synced: navigator.onLine
      }, App.currentUser.name);
      await DB.put('lubrication_records', record);

      // Cada punto que no se pudo engrasar genera una anomalía automática, para que
      // mantenimiento le dé seguimiento (ver createAutoAnomalies: evita duplicados).
      const anomaliasCreadas = await createAutoAnomalies(record, equipment);
      // Guarda si el equipo venía vencido, para el aviso de "solo críticos"
      record._veniaVencido = estadoPrevio === 'ROJO';
      await notificarEngraseRealizado(record, equipment);

      // Un engrase ATRASADO no debe pisar el estado actual del equipo si ya hubo
      // engrases posteriores — solo actualiza si de verdad es el más reciente.
      const todosDelEquipo = (await DB.allActive('lubrication_records')).filter(r => r.equipmentId === equipment.id);
      const esElMasReciente = !todosDelEquipo.some(r => r.id !== record.id && new Date(r.date) > new Date(fechaRegistro));

      if (esElMasReciente && !sinHorometro) {
        // Ojo: aunque sea el registro más reciente, un engrase atrasado NUNCA debe bajar
        // el horómetro actual del equipo — desde aquella fecha el equipo siguió trabajando
        // y ese dato de hoy es más fiable que el que se anotó para el pasado.
        if (!esRetro || newHourmeter > equipment.hourmeter) {
          equipment.hourmeter = newHourmeter;
          await DB.put('equipment', stamp(equipment, App.currentUser.name));
        }
        if (plan) {
          plan.lastGreaseHour = newHourmeter;
          await DB.put('lubrication_plans', stamp(plan, App.currentUser.name));
        }
      } else if (sinHorometro && plan && plan.controlType === 'Horas de operación') {
        // Sin lectura de horómetro no podemos recalcular por horas, pero el engrase SÍ se
        // hizo: dejamos anotada la fecha para que el equipo no se muestre como abandonado.
        plan.lastGreaseDateNoHm = fechaRegistro;
        await DB.put('lubrication_plans', stamp(plan, App.currentUser.name));
      }

      await logAudit(esRetro ? 'ENGRASE_RETROACTIVO_REGISTRADO' : 'ENGRASE_REGISTRADO',
        `${equipment.code} en ${fmt(newHourmeter)} h${esRetro ? ` · fecha ${fmtDate(fechaRegistro)} · lo hizo ${autor.name} · capturado por ${App.currentUser.name}` : ''}`,
        App.currentUser.name);
      showInAppToast(esRetro ? `✓ Engrase atrasado registrado — ${equipment.code}` : `✓ Engrase registrado — ${equipment.code}`);
      if (anomaliasCreadas.length) {
        showInAppToast(`⚠ Se abrió ${anomaliasCreadas.length} anomalía(s) automática(s): ${anomaliasCreadas.join(', ')}`);
      }
      await discardDraft();
      await refreshLocalNotifications();
      await refreshAppBadge();

      area.innerHTML = `<div class="panel"><div class="empty-state success">✓ Engrase registrado para ${esc(equipment.code)}. Próximo engrase recalculado automáticamente.</div></div>`;
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
              <td class="mono">${esc(e.code)}</td>
              <td>${esc(e.brand)} ${esc(e.model)}</td>
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
      await logAudit('HOROMETRO_ACTUALIZADO', `${esc(eq.code)} → ${fmt(newVal)} h`, App.currentUser.name);
      showInAppToast(`✓ Horómetro de ${esc(eq.code)} actualizado`);
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
          <td class="mono">${esc(p.code)}</td>
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
    showInAppToast(`✓ Horómetros importados: ${applied} equipos`);
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
        <td><span class="dot" style="background:${CRIT_COLOR[a.criticality]}"></span> ${esc(a.criticality)}</td>
        <td class="mono">${eq ? eq.code : '—'}</td>
        <td>${esc(a.component)}${a.autoGenerada ? ` <span class="auto-tag" title="Creada automáticamente al registrar un engrase">auto</span>` : ''}${a.repeticiones > 1 ? ` <span class="repeat-tag" title="Se ha reportado ${a.repeticiones} veces">×${a.repeticiones}</span>` : ''}</td>
        <td>${esc(a.description)}${a.resolutionNote ? `<div class="dim" style="margin-top:4px">Resuelto: ${esc(a.resolutionNote)}</div>` : ''}</td>
        <td>${fmtDate(a.createdAt)}</td>
        <td>${esc(a.createdBy)}</td>
        <td>${esc(a.status)}</td>
        <td>${photoThumbsHTML(a, `${eq ? eq.code : ''} · ${esc(a.component)}`)}</td>
        <td class="row-actions">
          <button class="btn btn-sm anom-edit" data-id="${a.id}">${ic("edit")}Editar</button>
          ${a.status !== 'Cerrada' && ['ADMINISTRADOR', 'SUPERVISOR'].includes(App.currentUser.role) ? `<button class="btn btn-sm anom-close" data-id="${a.id}">${ic("check")}Cerrar</button>` : ''}
          ${App.currentUser.role === 'ADMINISTRADOR' ? `<button class="btn btn-sm btn-danger anom-delete" data-id="${a.id}">${ic("trash")}Eliminar</button>` : ''}
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="9" class="empty-state">Sin anomalías registradas.</td></tr>';
    wirePhotoThumbs($('#anom-table'));
    makeTablesResponsive($('#anom-table').closest('.panel'));

    $$('.anom-edit', c).forEach(b => b.addEventListener('click', async () => {
      openAnomalyForm(null, null, await DB.get('anomalies', b.dataset.id));
    }));
    $$('.anom-close', c).forEach(b => b.addEventListener('click', async () => {
      const a = await DB.get('anomalies', b.dataset.id);
      const note = prompt('¿Cómo se resolvió? (queda guardado en el historial de la anomalía)', '');
      if (note === null) return; // canceló, no cierra nada
      a.status = 'Cerrada';
      a.resolutionNote = note.trim() || null;
      await DB.put('anomalies', stamp(a, App.currentUser.name));
      await logAudit('ANOMALIA_CERRADA', `${a.id}${note ? ' — ' + note : ''}`, App.currentUser.name);
      showInAppToast('✓ Anomalía cerrada');
      renderAnomalias();
    }));
    $$('.anom-delete', c).forEach(b => b.addEventListener('click', async () => {
      const a = await DB.get('anomalies', b.dataset.id);
      if (!confirm(`¿Eliminar esta anomalía (${esc(a.component)})? No se puede deshacer desde la app.`)) return;
      a.active = false;
      await DB.put('anomalies', stamp(a, App.currentUser.name));
      await logAudit('ANOMALIA_ELIMINADA', `${esc(a.component)} · ${esc(a.description)}`, App.currentUser.name);
      showInAppToast('✓ Anomalía eliminada');
      renderAnomalias();
    }));
  }
  draw();
  $('#anom-filter').addEventListener('change', (e) => draw(e.target.value));
  $('#btn-new-anom').addEventListener('click', () => openAnomalyForm());
}

/* ---------- Anomalías automáticas por puntos no engrasados ----------
   Cada punto que el lubricador no pudo engrasar genera una anomalía para que
   mantenimiento le dé seguimiento. Control de duplicados: si ya existe una
   anomalía ABIERTA por ese mismo punto del mismo equipo, no se crea otra —
   solo se actualiza para dejar constancia de que volvió a ocurrir. */
const CRITICIDAD_POR_MOTIVO = {
  'Grasera dañada': 'Alta',
  'Línea de engrase obstruida': 'Alta',
  'Falla mecánica': 'Crítica',
  'Sello dañado': 'Alta',
  'Punto inaccesible': 'Media',
  'Falta de lubricante': 'Media',
  'Equipo trabajando': 'Baja',
  'Equipo detenido': 'Baja',
  'Otro': 'Media'
};

async function createAutoAnomalies(record, equipment) {
  const pendientes = (record.details || []).filter(d => !d.done);
  const avisos = [];
  if (!pendientes.length && !record.sinHorometro) return avisos;

  const abiertas = (await DB.allActive('anomalies'))
    .filter(a => a.equipmentId === equipment.id && a.status !== 'Cerrada');

  for (const d of pendientes) {
    const motivo = d.reason || 'Sin motivo indicado';
    // ¿Ya hay una anomalía abierta por este mismo punto? (se identifica por el punto,
    // no por el motivo, para no duplicar si el lubricador elige un motivo distinto)
    const yaExiste = abiertas.find(a => a.autoPointId && a.autoPointId === d.pointId);

    if (yaExiste) {
      yaExiste.repeticiones = (yaExiste.repeticiones || 1) + 1;
      yaExiste.description = `${d.pointName}: ${motivo}. Reportado ${yaExiste.repeticiones} veces (última: ${fmtDate(record.date)} por ${record.userName}).`;
      await DB.put('anomalies', stamp(yaExiste, App.currentUser.name));
    } else {
      await DB.put('anomalies', stamp({
        id: uid('anom'),
        equipmentId: equipment.id,
        component: motivo,
        description: `${d.pointName}: ${motivo}. Detectado al engrasar el ${fmtDate(record.date)} por ${record.userName}.`,
        criticality: CRITICIDAD_POR_MOTIVO[motivo] || 'Media',
        status: 'Abierta',
        photos: record.photos || [], photo: (record.photos || [])[0] || null,
        autoGenerada: true,
        autoPointId: d.pointId,
        repeticiones: 1
      }, record.userName));
      avisos.push(d.pointName);
    }
  }

  // También el horómetro dañado/ilegible genera anomalía (es una falla del equipo)
  if (record.sinHorometro) {
    const motivoHm = record.noHourmeterReason || 'Horómetro no legible';
    const yaHm = abiertas.find(a => a.autoPointId === '__horometro__');
    if (yaHm) {
      yaHm.repeticiones = (yaHm.repeticiones || 1) + 1;
      yaHm.description = `${motivoHm}. Reportado ${yaHm.repeticiones} veces (última: ${fmtDate(record.date)} por ${record.userName}).`;
      await DB.put('anomalies', stamp(yaHm, App.currentUser.name));
    } else if (motivoHm !== 'El equipo no tiene horómetro') {
      // Si el equipo simplemente NO tiene horómetro, no es una falla — no se crea anomalía
      await DB.put('anomalies', stamp({
        id: uid('anom'),
        equipmentId: equipment.id,
        component: 'Horómetro',
        description: `${motivoHm}. Detectado al engrasar el ${fmtDate(record.date)} por ${record.userName}.`,
        criticality: 'Media',
        status: 'Abierta',
        photos: [], photo: null,
        autoGenerada: true,
        autoPointId: '__horometro__',
        repeticiones: 1
      }, record.userName));
      avisos.push('Horómetro');
    }
  }

  if (avisos.length) {
    await logAudit('ANOMALIAS_AUTOMATICAS', `${equipment.code}: ${avisos.join(', ')}`, App.currentUser.name);
  }
  return avisos;
}

async function openAnomalyForm(equipmentId, equipmentLabel, existing) {
  const equipos = await DB.allActive('equipment');
  const a = existing || { equipmentId, component: '', description: '', criticality: 'Alta', photo: null };
  const componentOptions = ['Grasera dañada', 'Línea de grasa rota', 'Falta de lubricación', 'Buje con juego', 'Pin con desgaste', 'Fuga de aceite', 'Fuga de grasa', 'Sello dañado', 'Manguera dañada', 'Componente flojo', 'Daño estructural', 'Otro'];
  openModal(existing ? `Editar anomalía · ${esc(existing.component)}` : 'Reportar anomalía', `
    <form id="anom-form" class="form-grid">
      <label>Equipo
        <select name="equipmentId">
          ${equipos.map(e => `<option value="${e.id}" ${e.id === (a.equipmentId || equipmentId) ? 'selected' : ''}>${esc(e.code)} · ${esc(e.brand)} ${esc(e.model)}</option>`).join('')}
        </select>
      </label>
      <label>Tipo de anomalía
        <select name="component">
          ${componentOptions.map(o => `<option ${o === a.component ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
      </label>
      <label>Descripción<textarea required name="description" rows="2">${a.description || ''}</textarea></label>
      <label>Criticidad
        <select name="criticality">
          ${['Baja', 'Media', 'Alta', 'Crítica'].map(o => `<option ${o === a.criticality ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
      </label>
      ${existing && existing.status ? `<label>Estado
        <select name="status">${['Abierta', 'En atención', 'Cerrada'].map(o => `<option ${o === existing.status ? 'selected' : ''}>${o}</option>`).join('')}</select>
      </label>` : ''}
      ${photoFieldHTML()}
      <div class="modal-actions"><button type="submit" class="btn btn-accent">${ic(existing ? "save" : "alert")}${existing ? 'Guardar cambios' : 'Registrar anomalía'}</button></div>
    </form>
  `);
  wirePhotoField($('#anom-form'));
  preloadPhotosIntoField($('#anom-form'), photosOf(a));
  wirePhotoThumbs($('#anom-form'));
  $('#anom-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    delete fd.photo;
    const newPhotos = await getSelectedPhotos(ev.target);
    fd.photos = newPhotos;
    fd.photo = newPhotos[0] || null; // compatibilidad con registros viejos
    const anomaly = existing ? Object.assign(existing, fd) : stamp({ id: uid('anom'), status: 'Abierta', ...fd }, App.currentUser.name);
    await DB.put('anomalies', stamp(anomaly, App.currentUser.name));
    await logAudit(existing ? 'ANOMALIA_EDITADA' : 'ANOMALIA_CREADA', anomaly.component, App.currentUser.name);
    showInAppToast(existing ? '✓ Anomalía actualizada' : '✓ Anomalía reportada');
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
              <td>${esc(l.name)}</td><td>${esc(l.brand)}</td><td>${esc(l.type)}</td><td>${esc(l.grade)}</td><td class="mono">${esc(l.code)}</td><td class="mono">${fmt(total, 1)}</td>
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
    openModal(existing ? `Editar · ${esc(existing.name)}` : 'Nuevo lubricante', `
      <form id="lub-form" class="form-grid">
        <label>Nombre<input required name="name" value="${esc(l.name)}"/></label>
        <label>Marca<input name="brand" value="${esc(l.brand)}"/></label>
        <label>Tipo<input name="type" value="${esc(l.type)}"/></label>
        <label>Grado<input name="grade" placeholder="NLGI 2" value="${esc(l.grade)}"/></label>
        <label>Código interno<input name="code" value="${esc(l.code)}"/></label>
        <label>Unidad<input name="unit" value="${l.unit || 'kg'}"/></label>
        <div class="modal-actions"><button type="submit" class="btn btn-accent">${existing ? 'Guardar cambios' : 'Guardar'}</button></div>
      </form>`);
    $('#lub-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target).entries());
      const obj = existing ? Object.assign(existing, fd) : { id: uid('lub'), ...fd, active: true };
      await DB.put('lubricants', stamp(obj, App.currentUser.name));
      await logAudit(existing ? 'LUBRICANTE_EDITADO' : 'LUBRICANTE_CREADO', fd.name, App.currentUser.name);
      showInAppToast(existing ? '✓ Lubricante actualizado' : '✓ Lubricante creado');
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
    if (!confirm(`¿Eliminar "${esc(l.name)}"? Los engrases que ya lo usaron conservan el historial, solo deja de aparecer como opción para elegir.`)) return;
    l.active = false;
    await DB.put('lubricants', stamp(l, App.currentUser.name));
    await logAudit('LUBRICANTE_ELIMINADO', l.name, App.currentUser.name);
    showInAppToast('✓ Lubricante eliminado');
    renderLubricantes();
  }));
}

/* ============================================================
   HISTORIAL
   ============================================================ */
async function renderHistorial() {
  const c = $('#app-content');
  const equipos = await DB.allActive('equipment');
  const types = await DB.allActive('equipment_types');
  const today = new Date().toISOString().slice(0, 10);
  let lastGeneralResults = [];
  c.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Buscar en todo el historial</h3></div>
      <div class="toolbar" style="padding:0 14px 14px">
        <label class="filter-label">Desde <input type="date" id="gh-from" class="input input-sm"/></label>
        <label class="filter-label">Hasta <input type="date" id="gh-to" class="input input-sm" value="${today}"/></label>
        <label class="filter-label">Turno
          <select id="gh-turno" class="input input-sm"><option value="">Ambos</option><option value="shift_dia">Día</option><option value="shift_noche">Noche</option></select>
        </label>
        <label class="filter-label">Familia
          <select id="gh-familia" class="input input-sm"><option value="">Todas</option>${types.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
        </label>
        <label class="filter-label">Estado del equipo
          <select id="gh-estado" class="input input-sm">
            <option value="">Todos</option>
            <option value="ROJO">Vencidos</option>
            <option value="AMARILLO">Próximos</option>
            <option value="VERDE">Al día</option>
          </select>
        </label>
        <button class="btn btn-accent" id="gh-apply">${ic("search")}Buscar</button>
      </div>
      <div id="gh-results"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Historial por equipo</h3></div>
      <select id="hist-equipo" class="input">
        <option value="">— Selecciona un equipo —</option>
        ${equipos.map(e => `<option value="${e.id}">${esc(e.code)} · ${esc(e.brand)} ${esc(e.model)}</option>`).join('')}
      </select>
    </div>
    <div id="hist-area"></div>
  `;
  $('#hist-equipo').addEventListener('change', async (e) => {
    const id = e.target.value;
    if (!id) { $('#hist-area').innerHTML = ''; return; }
    await drawHistory(id);
  });

  async function runGeneralSearch() {
    const from = $('#gh-from').value ? new Date($('#gh-from').value + 'T00:00:00') : null;
    const to = $('#gh-to').value ? new Date($('#gh-to').value + 'T23:59:59') : null;
    const turno = $('#gh-turno').value;
    const familia = $('#gh-familia').value;
    const estado = $('#gh-estado').value;

    let matchEquipos = equipos;
    if (familia) matchEquipos = matchEquipos.filter(e => e.typeId === familia);
    if (estado) {
      const statuses = await computeAllStatuses(matchEquipos);
      const okIds = new Set(statuses.filter(x => x.s.code === estado).map(x => x.e.id));
      matchEquipos = matchEquipos.filter(e => okIds.has(e.id));
    }
    const matchIds = new Set(matchEquipos.map(e => e.id));

    const allRecords = await DB.allActive('lubrication_records');
    const results = allRecords.filter(r => {
      if (!matchIds.has(r.equipmentId)) return false;
      const d = new Date(r.date);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (turno && r.shiftId !== turno) return false;
      return true;
    }).sort((a, b) => new Date(b.date) - new Date(a.date));

    const lubricants = await DB.allActive('lubricants');
    // Índices por id: buscar dentro del bucle con .find() era O(n²) y con miles de
    // registros dejaba la pantalla congelada varios segundos.
    const eqPorId = {}; equipos.forEach(e => eqPorId[e.id] = e);
    const lubPorId = {}; lubricants.forEach(l => lubPorId[l.id] = l);

    lastGeneralResults = results.map(r => ({ r, eq: eqPorId[r.equipmentId], lub: lubPorId[r.greaseType] }));

    // Solo se dibujan las primeras filas: con 2 años de historial son decenas de miles
    // de registros y el navegador (sobre todo en celular) se bloquea al renderizarlos.
    // La descarga en CSV sí incluye TODOS los resultados filtrados.
    const LIMITE_VISIBLE = 200;
    const visibles = results.slice(0, LIMITE_VISIBLE);
    const hayMas = results.length > LIMITE_VISIBLE;

    $('#gh-results').innerHTML = `
      <div class="toolbar" style="padding:10px 0">
        <button class="btn btn-sm" id="gh-export">${ic("download")}Descargar estos resultados (CSV)</button>
        <span class="dim">${results.length} resultado(s)${hayMas ? ` · mostrando los ${LIMITE_VISIBLE} más recientes` : ''}</span>
      </div>
      ${hayMas ? `<div class="dim" style="padding:0 0 8px">Afina los filtros para ver menos resultados, o descarga el CSV que incluye los ${results.length} completos.</div>` : ''}
      <table class="data-table">
        <thead><tr><th>Fecha</th><th>Código</th><th>Equipo</th><th>Turno</th><th>Responsable</th><th>Horómetro</th><th>Grasa</th><th>Condición</th><th>Foto</th></tr></thead>
        <tbody>${visibles.map(r => {
          const eq = eqPorId[r.equipmentId];
          return `<tr>
            <td>${fmtDate(r.date)}</td>
            <td class="mono">${eq ? eq.code : '—'}</td>
            <td>${eq ? eq.brand + ' ' + eq.model : '—'}</td>
            <td>${r.shiftId === 'shift_dia' ? 'Día' : 'Noche'}</td>
            <td>${esc(r.userName)}${r.retroactivo ? ` <span class="retro-tag" title="Capturado después por ${esc(r.capturadoPor || '')}">atrasado</span>` : ''}</td>
            <td class="mono">${fmt(r.hourmeter)} h</td>
            <td>${(lubPorId[r.greaseType] || {}).name || '—'}</td>
            <td>${esc(r.condition)}</td>
            <td>${photoThumbsHTML(r, eq ? eq.code : '')}</td>
          </tr>`;
        }).join('') || '<tr><td colspan="9" class="empty-state">Sin resultados para estos filtros.</td></tr>'}</tbody>
      </table>`;
    makeTablesResponsive($('#gh-results'));
    wirePhotoThumbs($('#gh-results'));
    $('#gh-export')?.addEventListener('click', () => {
      const rows = [['Fecha', 'Código', 'Equipo', 'Turno', 'Responsable', 'Horómetro', 'Grasa', 'Condición']];
      lastGeneralResults.forEach(({ r, eq, lub }) => {
        rows.push([fmtDate(r.date), eq ? eq.code : '', eq ? eq.brand + ' ' + eq.model : '', r.shiftId === 'shift_dia' ? 'Día' : 'Noche', r.userName, r.hourmeter, lub ? lub.name : '', r.condition]);
      });
      downloadCSV(rows, 'historial_filtrado.csv');
    });
  }

  $('#gh-apply').addEventListener('click', runGeneralSearch);
  runGeneralSearch();
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
      <div class="panel-head"><h3>${esc(equipment.code)} · ${esc(equipment.brand)} ${esc(equipment.model)}</h3></div>
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
            <td>${esc(r.userName)}${r.retroactivo ? ` <span class="retro-tag" title="Capturado después por ${esc(r.capturadoPor || '')}">atrasado</span>` : ''}</td>
            <td>${(lubricants.find(l => l.id === r.greaseType) || {}).name || '—'}</td>
            <td class="mono">${fmt(r.qty, 1)} kg</td>
            <td>${esc(r.condition)}${(() => {
              const pend = (r.details || []).filter(d => !d.done);
              const avisos = [];
              if (pend.length) avisos.push(`<div class="pendiente-nota">${pend.length} punto(s) sin engrasar: ${pend.map(d => `${esc(d.pointName)} <i>(${esc(d.reason || 'sin motivo')})</i>`).join(', ')}</div>`);
              if (r.sinHorometro) avisos.push(`<div class="pendiente-nota">⚠ Sin lectura de horómetro: ${esc(r.noHourmeterReason || 'no se pudo leer')}</div>`);
              return avisos.join('');
            })()}</td>
            <td>${photoThumbsHTML(r, `${esc(equipment.code)} · ${fmtDate(r.date)}`)}</td>
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
          ${anomalies.map(a => `<tr><td>${fmtDate(a.createdAt)}</td><td>${esc(a.component)}</td><td>${esc(a.description)}</td><td>${esc(a.criticality)}</td><td>${esc(a.status)}</td><td>${photoThumbsHTML(a, `${esc(equipment.code)} · ${esc(a.component)}`)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">Sin anomalías.</td></tr>'}
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
      await logAudit('ENGRASE_ELIMINADO', `${esc(equipment.code)} · ${fmtDate(rec.date)}`, App.currentUser.name);
      showInAppToast('✓ Registro de engrase eliminado');
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
            ${equipos.map(e => `<option value="${e.id}">${esc(e.code)} · ${esc(e.brand)} ${esc(e.model)}</option>`).join('')}
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
            ${users.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}
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
      <div class="panel-head"><h3>Puntos no engrasados y sus motivos</h3></div>
      <div class="dim" style="padding:0 14px 10px">Cada punto que un lubricador no pudo engrasar, con la razón que anotó. Sirve para dar seguimiento a graseras dañadas, líneas obstruidas y puntos inaccesibles. Usa los mismos filtros de arriba.</div>
      <div id="skipped-points-area"></div>
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
    // Las tablas (fotos y puntos pendientes) se dibujan SIEMPRE, aunque el motor de
    // gráficas no cargue — antes quedaban en blanco junto con las gráficas.
    const registrosFiltrados = applyFilters();
    try {
      drawPhotoReport(registrosFiltrados);
      drawSkippedPoints(registrosFiltrados);
    } catch (err) {
      console.error('Error dibujando las tablas de reportes', err);
    }

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

  }

  // Lista todos los puntos que NO se engrasaron, con el motivo que anotó el lubricador.
  // Antes esa información se guardaba pero no se mostraba en ninguna pantalla.
  function drawSkippedPoints(records) {
    const area = $('#skipped-points-area');
    if (!area) return;

    const filas = [];
    records.forEach(r => {
      const eq = equipos.find(e => e.id === r.equipmentId);
      (r.details || []).filter(d => !d.done).forEach(d => {
        filas.push({
          fecha: r.date, code: eq ? eq.code : '—', equipo: eq ? `${eq.brand} ${eq.model}` : '—',
          punto: d.pointName, motivo: d.reason || '(sin motivo anotado)', por: r.userName
        });
      });
      // También los engrases donde no se pudo leer el horómetro
      if (r.sinHorometro) {
        filas.push({
          fecha: r.date, code: eq ? eq.code : '—', equipo: eq ? `${eq.brand} ${eq.model}` : '—',
          punto: '⚠ Sin lectura de horómetro', motivo: r.noHourmeterReason || 'No se pudo leer', por: r.userName
        });
      }
    });
    filas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    // Resumen por motivo, para ver de un vistazo qué falla más
    const porMotivo = {};
    filas.forEach(f => { porMotivo[f.motivo] = (porMotivo[f.motivo] || 0) + 1; });
    const resumen = Object.entries(porMotivo).sort((a, b) => b[1] - a[1]);

    area.innerHTML = !filas.length
      ? '<div class="empty-state">Sin puntos pendientes en este periodo — todos los engrases se completaron.</div>'
      : `
        <div class="skipped-summary">
          ${resumen.map(([motivo, n]) => `<span class="skipped-chip">${esc(motivo)}: <b>${n}</b></span>`).join('')}
        </div>
        <div class="toolbar" style="padding:6px 14px 10px">
          <button class="btn btn-sm" id="exp-skipped">${ic("download")}Descargar esta lista (CSV)</button>
          <span class="dim">${filas.length} punto(s) pendiente(s)</span>
        </div>
        <table class="data-table">
          <thead><tr><th>Fecha</th><th>Código</th><th>Equipo</th><th>Punto</th><th>Motivo</th><th>Reportado por</th></tr></thead>
          <tbody>${filas.map(f => `<tr>
            <td>${fmtDate(f.fecha)}</td>
            <td class="mono">${esc(f.code)}</td>
            <td>${esc(f.equipo)}</td>
            <td>${esc(f.punto)}</td>
            <td><span class="motivo-tag">${esc(f.motivo)}</span></td>
            <td>${esc(f.por)}</td>
          </tr>`).join('')}</tbody>
        </table>`;
    makeTablesResponsive(area);

    $('#exp-skipped')?.addEventListener('click', () => {
      const rows = [['Fecha', 'Código', 'Equipo', 'Punto no realizado', 'Motivo', 'Reportado por']];
      filas.forEach(f => rows.push([fmtDate(f.fecha), f.code, f.equipo, f.punto, f.motivo, f.por]));
      downloadCSV(rows, 'puntos_no_engrasados.csv');
    });
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

    // Las fotos se cargan de a tandas. Antes se insertaban TODAS de golpe: con 300 fotos
    // de 40 KB cada una eso son ~12 MB de texto que el navegador tiene que procesar de
    // una sola vez, y la pantalla tardaba más de 7 segundos en abrir.
    const grid = $('#photo-report-grid');
    const POR_TANDA = 24;
    let mostradas = 0;

    function pintarTanda() {
      const tanda = photoItems.slice(mostradas, mostradas + POR_TANDA);
      const html = tanda.map(p => `
        <div class="photo-report-item">
          <img src="${p.photo}" class="photo-thumb-lg" loading="lazy" data-full="${p.photo}" data-caption="${esc(p.eq)} · ${esc(p.type)} · ${fmtDate(p.date)}"/>
          <div class="photo-report-caption"><b>${esc(p.eq)}</b> · ${esc(p.type)}<br/>${fmtDate(p.date)} · ${esc(p.by)}</div>
        </div>`).join('');

      const btnViejo = $('#photo-load-more');
      if (btnViejo) btnViejo.remove();
      grid.insertAdjacentHTML('beforeend', html);
      mostradas += tanda.length;

      $$('.photo-thumb-lg', grid).forEach(img => {
        if (img.dataset.wired) return;
        img.dataset.wired = '1';
        img.addEventListener('click', () => openPhotoLightbox(img.dataset.full, img.dataset.caption));
      });

      if (mostradas < photoItems.length) {
        grid.insertAdjacentHTML('afterend',
          `<button class="btn" id="photo-load-more" style="margin-top:12px">Ver más fotos (${photoItems.length - mostradas} restantes)</button>`);
        $('#photo-load-more').addEventListener('click', pintarTanda);
      }
    }

    grid.innerHTML = '';
    $('#photo-load-more')?.remove();
    if (!photoItems.length) {
      grid.innerHTML = `<div class="empty-state">No hay fotos para el rango y filtros seleccionados.</div>`;
    } else {
      pintarTanda();
    }
  }

  drawCharts();
  $('#f-apply').addEventListener('click', drawCharts);

  $('#exp-cumplimiento').addEventListener('click', () => {
    const rows = [['Código', 'Equipo', 'Horómetro', 'Estado', 'Próximo engrase', 'Restante/Atraso']];
    statuses.forEach(({ e, s }) => rows.push([e.code, `${esc(e.brand)} ${esc(e.model)}`, e.hourmeter, s.label, s.nextHour ?? '', s.remaining ?? '']));
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
    const filteredAnomalies = anomalies;
    const wb = XLSX.utils.book_new();
    const C = REPORT_COLORS;
    const meta = App.generalSettings.complianceTarget;
    const colorCumpl = colorPorCumplimiento(compliance, meta);
    const abiertas = anomalies.filter(a => a.status !== 'Cerrada').length;
    const detenidos = Math.max(total - alDia - pendientes - vencidos, 0);
    const periodoTxt = $('#f-from').value
      ? `Periodo: ${$('#f-from').value} a ${$('#f-to').value || 'hoy'}`
      : `Periodo: todo el historial hasta ${$('#f-to').value || 'hoy'}`;

    /* ---------- Hoja 1: Panel ejecutivo ---------- */
    const filasResumen = [
      ['CUMPLIMIENTO DE ENGRASE', compliance + '%', `Meta: ${meta}%`],
      [],
      ['ESTADO DE LA FLOTA', 'Equipos', '% del total'],
      ['Al día', alDia, total ? Math.round(alDia / total * 100) + '%' : '0%'],
      ['Próximos a vencer', pendientes, total ? Math.round(pendientes / total * 100) + '%' : '0%'],
      ['Vencidos', vencidos, total ? Math.round(vencidos / total * 100) + '%' : '0%'],
      ['Detenidos / sin plan', detenidos, total ? Math.round(detenidos / total * 100) + '%' : '0%'],
      ['TOTAL', total, '100%'],
      [],
      ['OTROS INDICADORES', '', ''],
      ['Anomalías abiertas', abiertas, ''],
      ['Engrases en el periodo', records.length, ''],
      ['Puntos no engrasados en el periodo', records.reduce((n, r) => n + (r.details || []).filter(d => !d.done).length, 0), ''],
      [],
      ['LECTURA RÁPIDA', '', ''],
      [compliance >= meta
        ? `La flota está dentro del objetivo de cumplimiento (mínimo ${meta}%).`
        : compliance >= 80
          ? `La flota está por debajo del objetivo (${meta}%). Revisar los equipos vencidos como prioridad.`
          : 'Cumplimiento crítico. Se recomienda intervención inmediata sobre los equipos vencidos.', '', '']
    ];

    const wsResumen = xlsHojaConFormato({
      titulo: 'CONTROL DE ENGRASE — OPEN PIT',
      subtitulo: `Informe Ejecutivo  ·  Generado: ${fmtDate(nowISO())}  ·  Por: ${App.currentUser.name}  ·  ${periodoTxt}`,
      columnas: ['Indicador', 'Valor', 'Referencia'],
      filas: filasResumen,
      estiloPorCelda: (valor, ci, fila) => {
        const etiqueta = String(fila[0] || '');
        // Sub-encabezados de sección
        if (['ESTADO DE LA FLOTA', 'OTROS INDICADORES', 'LECTURA RÁPIDA'].includes(etiqueta)) {
          return xlsEstiloCelda({ hexFondo: C.azulTitulo.hex, hexTexto: 'FFFFFF', negrita: true });
        }
        if (etiqueta === 'CUMPLIMIENTO DE ENGRASE') {
          return ci === 1
            ? xlsEstiloCelda({ hexFondo: colorCumpl.hex, hexTexto: 'FFFFFF', negrita: true, centrado: true })
            : xlsEstiloCelda({ negrita: true });
        }
        if (etiqueta === 'Al día') return ci === 0 ? xlsEstiloCelda() : xlsEstiloCelda({ hexFondo: C.verdeSuave.hex, hexTexto: REPORT_COLORS.verdeTexto.hex, centrado: true });
        if (etiqueta === 'Próximos a vencer') return ci === 0 ? xlsEstiloCelda() : xlsEstiloCelda({ hexFondo: C.ambarSuave.hex, hexTexto: REPORT_COLORS.ambarTexto.hex, centrado: true });
        if (etiqueta === 'Vencidos') return ci === 0 ? xlsEstiloCelda() : xlsEstiloCelda({ hexFondo: C.rojoSuave.hex, hexTexto: REPORT_COLORS.rojoTexto.hex, centrado: true });
        if (etiqueta === 'TOTAL') return xlsEstiloCelda({ hexFondo: C.grisSuave.hex, negrita: true, centrado: ci > 0 });
        if (etiqueta === 'Anomalías abiertas' && ci === 1 && abiertas > 0) return xlsEstiloCelda({ hexFondo: C.rojoSuave.hex, hexTexto: REPORT_COLORS.rojoTexto.hex, negrita: true, centrado: true });
        return xlsEstiloCelda({ centrado: ci > 0 });
      }
    });
    wsResumen['!cols'] = [{ wch: 38 }, { wch: 14 }, { wch: 18 }];
    delete wsResumen['!autofilter']; // en el panel no tiene sentido el filtro
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Panel Ejecutivo');

    /* ---------- Hoja 2: Equipos ---------- */
    const colEquipos = ['Código', 'Cód. Ahorrativo', 'Marca', 'Modelo', 'Ubicación', 'Turno', 'Horómetro (h)', 'Estado', 'Próximo engrase (h)', 'Restante/Atraso (h)'];
    const filasEquipos = statuses.map(({ e, s }) => [
      e.code, e.shortCode || '', e.brand, e.model,
      (locations.find(l => l.id === e.locationId) || {}).name || '',
      e.shiftId === 'shift_dia' ? 'Día' : 'Noche',
      e.hourmeter, s.label, s.nextHour ?? '', s.remaining ?? ''
    ]);
    const wsEquipos = xlsHojaConFormato({
      titulo: 'EQUIPOS Y ESTADO DE ENGRASE',
      subtitulo: `${statuses.length} equipos  ·  Generado: ${fmtDate(nowISO())}`,
      columnas: colEquipos, filas: filasEquipos,
      estiloPorCelda: (valor, ci, fila) => ci === 7 ? xlsEstiloEstado(fila[7]) : xlsEstiloCelda({ centrado: ci >= 5 })
    });
    wsEquipos['!cols'] = [{ wch: 12 }, { wch: 15 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 9 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsEquipos, 'Equipos');

    /* ---------- Hoja 3: Histórico de engrases ---------- */
    const colHist = ['Fecha', 'Código', 'Equipo', 'Turno', 'Responsable', 'Horómetro (h)', 'Grasa', 'Cantidad (kg)', 'Condición', 'Observaciones'];
    const filasHist = records.map(r => {
      const eq = equipos.find(e => e.id === r.equipmentId);
      return [
        fmtDate(r.date), eq ? eq.code : '', eq ? `${eq.brand} ${eq.model}` : '',
        r.shiftId === 'shift_dia' ? 'Día' : 'Noche', r.userName, r.hourmeter,
        (lubricants.find(l => l.id === r.greaseType) || {}).name || '', r.qty, r.condition, r.notes || ''
      ];
    });
    const wsHist = xlsHojaConFormato({
      titulo: 'HISTÓRICO DE ENGRASES',
      subtitulo: `${records.length} registros  ·  ${periodoTxt}`,
      columnas: colHist, filas: filasHist, hexEncabezado: C.verde.hex,
      estiloPorCelda: (valor, ci, fila) => {
        if (ci === 8 && fila[8] === 'Requiere atención') return xlsEstiloCelda({ hexFondo: C.ambarSuave.hex, hexTexto: REPORT_COLORS.ambarTexto.hex, negrita: true, centrado: true });
        return xlsEstiloCelda({ centrado: [3, 5, 7].includes(ci) });
      }
    });
    wsHist['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 18 }, { wch: 9 }, { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 13 }, { wch: 16 }, { wch: 32 }];
    XLSX.utils.book_append_sheet(wb, wsHist, 'Histórico Engrases');

    /* ---------- Hoja 4: Anomalías ---------- */
    const colAnom = ['Fecha', 'Código', 'Componente', 'Descripción', 'Criticidad', 'Estado', 'Responsable'];
    const filasAnom = filteredAnomalies.map(a => {
      const eq = equipos.find(e => e.id === a.equipmentId);
      return [fmtDate(a.createdAt), eq ? eq.code : '', a.component, a.description, a.criticality, a.status, a.createdBy];
    });
    const wsAnom = xlsHojaConFormato({
      titulo: 'ANOMALÍAS REPORTADAS',
      subtitulo: `${filteredAnomalies.length} en total  ·  ${abiertas} abiertas`,
      columnas: colAnom, filas: filasAnom, hexEncabezado: C.rojo.hex,
      estiloPorCelda: (valor, ci, fila) => {
        if (ci === 4) return xlsEstiloCriticidad(fila[4]);
        if (ci === 5) return fila[5] === 'Cerrada'
          ? xlsEstiloCelda({ hexFondo: C.verdeSuave.hex, hexTexto: REPORT_COLORS.verdeTexto.hex, centrado: true })
          : xlsEstiloCelda({ hexFondo: C.rojoSuave.hex, hexTexto: REPORT_COLORS.rojoTexto.hex, negrita: true, centrado: true });
        return xlsEstiloCelda();
      }
    });
    wsAnom['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 22 }, { wch: 40 }, { wch: 12 }, { wch: 12 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsAnom, 'Anomalías');

    /* ---------- Hoja 5: Puntos no engrasados ---------- */
    const colPtos = ['Fecha', 'Código', 'Equipo', 'Punto no realizado', 'Motivo', 'Reportado por'];
    const filasPtos = [];
    records.forEach(r => {
      const eq = equipos.find(e => e.id === r.equipmentId);
      (r.details || []).filter(d => !d.done).forEach(d => {
        filasPtos.push([fmtDate(r.date), eq ? eq.code : '', eq ? `${eq.brand} ${eq.model}` : '', d.pointName, d.reason || '(sin motivo)', r.userName]);
      });
      if (r.sinHorometro) {
        filasPtos.push([fmtDate(r.date), eq ? eq.code : '', eq ? `${eq.brand} ${eq.model}` : '', 'Sin lectura de horómetro', r.noHourmeterReason || 'No se pudo leer', r.userName]);
      }
    });
    const wsPtos = xlsHojaConFormato({
      titulo: 'PUNTOS NO ENGRASADOS Y SUS MOTIVOS',
      subtitulo: `${filasPtos.length} punto(s) pendiente(s)  ·  ${periodoTxt}`,
      columnas: colPtos,
      filas: filasPtos.length ? filasPtos : [['—', '—', '—', 'Sin puntos pendientes en el periodo', '—', '—']],
      hexEncabezado: C.ambar.hex,
      estiloPorCelda: (valor, ci) => ci === 4
        ? xlsEstiloCelda({ hexFondo: C.ambarSuave.hex, hexTexto: REPORT_COLORS.ambarTexto.hex, negrita: true })
        : xlsEstiloCelda()
    });
    wsPtos['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 18 }, { wch: 28 }, { wch: 26 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsPtos, 'Puntos Pendientes');

    XLSX.writeFile(wb, `informe_ejecutivo_engrase_${new Date().toISOString().slice(0, 10)}.xlsx`);
  });

  $('#exp-pdf').addEventListener('click', () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 0;

    // Encabezado
    doc.setFillColor(...REPORT_COLORS.marca.rgb);
    doc.rect(0, 0, pageWidth, 72, 'F');
    doc.setTextColor(...REPORT_COLORS.acento.rgb);
    doc.setFont(undefined, 'bold'); doc.setFontSize(17);
    doc.text('CONTROL DE ENGRASE — OPEN PIT', 40, 30);
    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, 'normal'); doc.setFontSize(11);
    doc.text('Informe Ejecutivo de Cumplimiento de Engrase', 40, 48);
    doc.setFontSize(8.5);
    const periodoTxt = $('#f-from').value
      ? `Periodo: ${$('#f-from').value} a ${$('#f-to').value || 'hoy'}`
      : `Periodo: todo el historial hasta ${$('#f-to').value || 'hoy'}`;
    doc.text(`Generado: ${fmtDate(nowISO())}   ·   Por: ${esc(App.currentUser.name)}   ·   ${periodoTxt}`, 40, 62);
    y = 100;

    // ============ DASHBOARD EJECUTIVO ============
    const C = REPORT_COLORS;
    const metaCumplimiento = App.generalSettings.complianceTarget;
    const colorCumpl = colorPorCumplimiento(compliance, metaCumplimiento);
    const detenidos = Math.max(total - alDia - pendientes - vencidos, 0);

    // --- Bloque 1: cifra grande de cumplimiento + anillo de estado de flota ---
    const dashY = y;
    const dashH = 130;
    doc.setDrawColor(228); doc.setFillColor(252, 252, 251);
    doc.roundedRect(40, dashY, pageWidth - 80, dashH, 6, 6, 'FD');

    // Cifra principal de cumplimiento
    doc.setTextColor(...colorCumpl.rgb);
    doc.setFont(undefined, 'bold'); doc.setFontSize(46);
    doc.text(`${compliance}%`, 62, dashY + 56);
    doc.setTextColor(...C.textoTenue.rgb); doc.setFont(undefined, 'normal'); doc.setFontSize(9);
    doc.text('CUMPLIMIENTO DE ENGRASE', 62, dashY + 72);
    doc.setFontSize(8);
    doc.text(`Meta establecida: ${metaCumplimiento}%`, 62, dashY + 85);

    // Barra de avance contra la meta
    const barX = 62, barW2 = 230;
    doc.setFillColor(234, 234, 232); doc.roundedRect(barX, dashY + 95, barW2, 10, 3, 3, 'F');
    doc.setFillColor(...colorCumpl.rgb);
    doc.roundedRect(barX, dashY + 95, Math.max(barW2 * (compliance / 100), 3), 10, 3, 3, 'F');
    const metaX2 = barX + barW2 * (metaCumplimiento / 100);
    doc.setDrawColor(60); doc.setLineWidth(1.2);
    doc.line(metaX2, dashY + 91, metaX2, dashY + 109);
    doc.setLineWidth(0.2);

    // --- Anillo (dona) con la composición de la flota ---
    const cx = pageWidth - 170, cy = dashY + 62, rExt = 44, rInt = 26;
    const segmentos = [
      { v: alDia, c: C.verde, lbl: 'Al día' },
      { v: pendientes, c: C.ambar, lbl: 'Próximos' },
      { v: vencidos, c: C.rojo, lbl: 'Vencidos' },
      { v: detenidos, c: C.gris, lbl: 'Detenidos/Sin plan' }
    ].filter(s => s.v > 0);
    const totalSeg = segmentos.reduce((a, s) => a + s.v, 0) || 1;

    // Dibuja cada porción como un abanico de triángulos finos
    let angIni = -Math.PI / 2;
    segmentos.forEach(s => {
      const barrido = (s.v / totalSeg) * Math.PI * 2;
      doc.setFillColor(...s.c.rgb);
      const pasos = Math.max(Math.ceil(barrido / 0.06), 2);
      for (let i = 0; i < pasos; i++) {
        const a1 = angIni + (barrido * i) / pasos;
        const a2 = angIni + (barrido * (i + 1)) / pasos;
        doc.triangle(
          cx + rExt * Math.cos(a1), cy + rExt * Math.sin(a1),
          cx + rExt * Math.cos(a2), cy + rExt * Math.sin(a2),
          cx, cy, 'F'
        );
      }
      angIni += barrido;
    });
    // Centro blanco para que quede como anillo, con el total al medio
    doc.setFillColor(252, 252, 251);
    doc.circle(cx, cy, rInt, 'F');
    doc.setTextColor(25); doc.setFont(undefined, 'bold'); doc.setFontSize(18);
    doc.text(String(total), cx, cy + 2, { align: 'center' });
    doc.setTextColor(...C.textoTenue.rgb); doc.setFont(undefined, 'normal'); doc.setFontSize(6.5);
    doc.text('EQUIPOS', cx, cy + 12, { align: 'center' });

    // Leyenda del anillo
    let ly = dashY + 22;
    segmentos.forEach(s => {
      doc.setFillColor(...s.c.rgb);
      doc.roundedRect(cx + rExt + 14, ly - 6, 8, 8, 1.5, 1.5, 'F');
      doc.setTextColor(60); doc.setFontSize(7.5); doc.setFont(undefined, 'normal');
      doc.text(`${s.lbl}: ${s.v}`, cx + rExt + 26, ly);
      ly += 13;
    });
    y = dashY + dashH + 16;

    // --- Bloque 2: tarjetas KPI con franja de color ---
    const kpis = [
      ['Total equipos', total, C.gris],
      ['Al día', alDia, C.verde],
      ['Próximos a vencer', pendientes, pendientes > 0 ? C.ambar : C.gris],
      ['Vencidos', vencidos, vencidos > 0 ? C.rojo : C.gris],
      ['Anomalías abiertas', anomalies.filter(a => a.status !== 'Cerrada').length, anomalies.filter(a => a.status !== 'Cerrada').length > 0 ? C.rojo : C.gris]
    ];
    const gap = 8;
    const boxW = (pageWidth - 80 - gap * (kpis.length - 1)) / kpis.length;
    kpis.forEach((k, i) => {
      const x = 40 + i * (boxW + gap);
      doc.setDrawColor(228); doc.setFillColor(250, 250, 249);
      doc.roundedRect(x, y, boxW, 50, 4, 4, 'FD');
      doc.setFillColor(...k[2].rgb);
      doc.rect(x, y + 4, 3.5, 42, 'F');
      doc.setTextColor(25); doc.setFont(undefined, 'bold'); doc.setFontSize(17);
      doc.text(String(k[1]), x + 12, y + 26);
      doc.setTextColor(...C.textoTenue.rgb); doc.setFont(undefined, 'normal'); doc.setFontSize(6.8);
      doc.text(String(k[0]), x + 12, y + 40);
    });
    y += 66;

    // Narrativa
    const openAnom = anomalies.filter(a => a.status !== 'Cerrada').length;
    const target = App.generalSettings.complianceTarget;
    const narrative = `Al día de hoy, la flota registra un cumplimiento de engrase del ${compliance}%. De ${total} equipos activos, ${alDia} están al día, ${pendientes} próximos a vencer y ${vencidos} vencidos que requieren atención inmediata. Actualmente hay ${openAnom} anomalía(s) abierta(s) pendientes de resolución. ${compliance < target ? `Se recomienda priorizar el engrase de los equipos vencidos listados a continuación para volver al objetivo de cumplimiento (mínimo ${target}%).` : `La flota se mantiene dentro del objetivo de cumplimiento definido (mínimo ${target}%).`}`;
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
      startY: y, margin: { left: 40, right: 40 }, styles: { fontSize: 8 }, headStyles: { fillColor: REPORT_COLORS.marca.rgb },
      head: [['Estado', 'Código', 'Equipo', 'Turno', 'Horómetro', 'Restante/Atraso']],
      body: attention.length ? attention.map(({ e, s }) => [
        s.label, e.code, `${esc(e.brand)} ${esc(e.model)}`,
        e.shiftId === 'shift_dia' ? 'Día' : 'Noche',
        fmt(e.hourmeter) + ' h',
        s.remaining != null ? (s.remaining < 0 ? fmt(Math.abs(s.remaining)) + ' h atraso' : fmt(s.remaining) + ' h') : (s.scheduleDate ? WEEKDAY_NAMES[s.scheduleDate.getDay()] : '—')
      ]) : [['—', '—', 'Todos los equipos están al día', '—', '—', '—']],
      // Colorea la columna Estado según sea VENCIDO (rojo) o PRÓXIMO (ámbar), para
      // que en una hoja impresa se distingan de un vistazo sin tener que leer.
      didParseCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 0) return;
        const txt = String(data.cell.raw || '').toUpperCase();
        if (txt.includes('VENCID')) { data.cell.styles.textColor = REPORT_COLORS.rojoTexto.rgb; data.cell.styles.fontStyle = 'bold'; }
        else if (txt.includes('PRÓXIM') || txt.includes('PROXIM')) { data.cell.styles.textColor = REPORT_COLORS.ambarTexto.rgb; data.cell.styles.fontStyle = 'bold'; }
      }
    });
    y = doc.lastAutoTable.finalY + 20;

    // Tabla: anomalías abiertas
    const openAnomalies = anomalies.filter(a => a.status !== 'Cerrada');
    if (y > 620) { doc.addPage(); y = 40; }
    doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.setTextColor(20);
    doc.text('Anomalías abiertas', 40, y); y += 6;
    doc.autoTable({
      startY: y, margin: { left: 40, right: 40 }, styles: { fontSize: 8 }, headStyles: { fillColor: REPORT_COLORS.rojo.rgb },
      head: [['Criticidad', 'Código', 'Componente', 'Descripción', 'Estado']],
      body: openAnomalies.length ? openAnomalies.map(a => {
        const eq = equipos.find(e => e.id === a.equipmentId);
        return [a.criticality, eq ? eq.code : '—', a.component, a.description, a.status];
      }) : [['—', '—', '—', 'Sin anomalías abiertas', '—']]
          ,didParseCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 0) return;
        const t = String(data.cell.raw || '');
        if (t === 'Crítica') { data.cell.styles.textColor = REPORT_COLORS.rojoTexto.rgb; data.cell.styles.fontStyle = 'bold'; }
        else if (t === 'Alta') { data.cell.styles.textColor = REPORT_COLORS.ambarTexto.rgb; data.cell.styles.fontStyle = 'bold'; }
        else if (t === 'Media') { data.cell.styles.textColor = REPORT_COLORS.ambarTexto.rgb; }
      }
    });
    y = doc.lastAutoTable.finalY + 20;

    // Tabla: puntos que quedaron sin engrasar, con su motivo
    // (ojo: se llama puntosPendientes y no "pendientes" — ese nombre ya está usado
    //  más arriba en esta misma función para el conteo de equipos próximos a vencer)
    const puntosPendientes = [];
    applyFilters().forEach(r => {
      const eq = equipos.find(e => e.id === r.equipmentId);
      (r.details || []).filter(d => !d.done).forEach(d => {
        puntosPendientes.push([fmtDate(r.date), eq ? eq.code : '—', d.pointName, d.reason || '(sin motivo)', r.userName]);
      });
      if (r.sinHorometro) {
        puntosPendientes.push([fmtDate(r.date), eq ? eq.code : '—', 'Sin lectura de horómetro', r.noHourmeterReason || 'No se pudo leer', r.userName]);
      }
    });
    if (y > 620) { doc.addPage(); y = 40; }
    doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.setTextColor(20);
    doc.text('Puntos no engrasados y sus motivos', 40, y); y += 6;
    doc.autoTable({
      startY: y, margin: { left: 40, right: 40 }, styles: { fontSize: 7.5 }, headStyles: { fillColor: REPORT_COLORS.ambar.rgb },
      head: [['Fecha', 'Código', 'Punto', 'Motivo', 'Reportado por']],
      body: puntosPendientes.length ? puntosPendientes.slice(0, 40) : [['—', '—', '—', 'Sin puntos pendientes en el periodo', '—']]
    });
    y = doc.lastAutoTable.finalY + 20;

    // Tabla: histórico de engrases del periodo filtrado (resumen, últimos 40)
    const records = applyFilters().slice(0, 40);
    if (y > 620) { doc.addPage(); y = 40; }
    doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.setTextColor(20);
    doc.text('Histórico de engrases (periodo filtrado)', 40, y); y += 6;
    doc.autoTable({
      startY: y, margin: { left: 40, right: 40 }, styles: { fontSize: 7.5 }, headStyles: { fillColor: REPORT_COLORS.verde.rgb },
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
/* Comprime una foto antes de guardarla. Usa WebP, que a igual peso conserva
   bastante más detalle que JPEG (medido: WebP a 1400px pesa lo mismo que JPEG a
   1000px). Si el navegador no soporta WebP, cae de vuelta a JPEG solo. */
function fileToCompressedDataURL(file, maxDim = 1400, quality = 0.8) {
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
        let out = canvas.toDataURL('image/webp', quality);
        // Si el navegador no soporta WebP, toDataURL devuelve un PNG (mucho más
        // pesado) — en ese caso usamos JPEG, que sí es universal.
        if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', quality);
        resolve(out);
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

// Muestra TODAS las fotos de un registro (funciona igual con registros viejos de una sola foto)
function photoThumbsHTML(record, caption) {
  const photos = photosOf(record);
  if (!photos.length) return '<span class="dim">—</span>';
  return `<div class="photo-thumb-group">${photos.map((p, i) =>
    photoThumbHTML(p, `${caption || ''}${photos.length > 1 ? ` (${i + 1}/${photos.length})` : ''}`)
  ).join('')}</div>`;
}

function wirePhotoThumbs(container) {
  if (!container) return;
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
  const locationsLista = await DB.allActive('locations');

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
            <td>${esc(u.name)}</td><td class="mono">${esc(u.username)}</td><td>${esc(u.role)}</td>
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
    openModal(existing ? `Editar usuario · ${esc(existing.name)}` : 'Nuevo lubricador', `
      <form id="user-form" class="form-grid">
        <label>Nombre completo<input required name="name" value="${esc(u.name)}"/></label>
        <label>Usuario<input required name="username" value="${esc(u.username)}"/></label>
        <label>PIN (4 dígitos)<input required name="pin" maxlength="4" pattern="\\d{4}" value="${u.pin}"/></label>
        <label>Rol
          ${lockRoleToLubricador
            ? `<input type="text" disabled value="LUBRICADOR"/><input type="hidden" name="role" value="LUBRICADOR"/>`
            : `<select name="role">${rolesDisponibles.map(r => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select>`}
        </label>
        <label>Turno habitual
          <select name="shiftId">
            <option value="">— Según la hora —</option>
            <option value="shift_dia" ${u.shiftId === 'shift_dia' ? 'selected' : ''}>Turno Día</option>
            <option value="shift_noche" ${u.shiftId === 'shift_noche' ? 'selected' : ''}>Turno Noche</option>
          </select>
          <span class="field-hint">Se usa para no mandarle avisos fuera de su horario de trabajo.</span>
        </label>
        <label>Zona / Ubicación asignada
          <select name="locationId">
            <option value="">— Todas las zonas —</option>
            ${locationsLista.map(l => `<option value="${l.id}" ${l.id === u.locationId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
          </select>
          <span class="field-hint">Si trabaja solo en una zona (Mojón, Volcán…), aquí se limita para que en "Mi Turno" vea únicamente los equipos de ahí. Útil cuando cada zona tiene su propio celular compartido.</span>
        </label>
        <label>Cuadrilla de lubricación
          <select name="cuadrillaId">
            <option value="">— Sin asignar —</option>
            ${cuadrillas.map(cq => `<option value="${cq.id}" ${cq.id === u.cuadrillaId ? 'selected' : ''}>${esc(cq.name)}</option>`).join('')}
          </select>
          <span class="field-hint">Filtro adicional dentro de la zona, para que dos cuadrillas del mismo turno no engrasen el mismo equipo.</span>
        </label>
        <div class="modal-actions"><button type="submit" class="btn btn-accent">${existing ? 'Guardar cambios' : 'Crear usuario'}</button></div>
      </form>`);
    $('#user-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target).entries());
      const obj = existing ? Object.assign(existing, fd) : { id: uid('u'), ...fd, active: true };
      await DB.put('users', stamp(obj, App.currentUser.name));
      await logAudit(existing ? 'USUARIO_EDITADO' : 'USUARIO_CREADO', fd.username, App.currentUser.name);
      showInAppToast(existing ? '✓ Usuario actualizado' : '✓ Usuario creado');
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
    showInAppToast('✓ Usuario desactivado');
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
  // Ilustraciones propias, dibujadas para este proyecto. No se usan fotos de
  // fabricantes (Caterpillar, Komatsu…) ni imágenes de internet porque son
  // propiedad de sus dueños. Si el Administrador sube una foto real del equipo
  // desde Ayuda → Editar familia, esa foto reemplaza a este dibujo.
  const T = 'var(--text-dim)';   // estructura
  const A = 'var(--accent)';     // implemento / parte activa
  const G = 'var(--green)';      // zona delantera
  const R = 'var(--red)';        // zona trasera

  // Oruga con rodillos (se reutiliza en excavadora y tractor)
  const oruga = (x, y, w) => `
    <rect x="${x}" y="${y}" width="${w}" height="17" rx="8.5" fill="none" stroke="${T}" stroke-width="3"/>
    <circle cx="${x + 13}" cy="${y + 8.5}" r="6.5" fill="none" stroke="${T}" stroke-width="2.5"/>
    <circle cx="${x + w - 13}" cy="${y + 8.5}" r="6.5" fill="none" stroke="${T}" stroke-width="2.5"/>
    ${[0.3, 0.45, 0.6, 0.75].map(p => `<circle cx="${x + w * p}" cy="${y + 12}" r="3" fill="none" stroke="${T}" stroke-width="2"/>`).join('')}`;

  // Rueda con llanta y rin
  const rueda = (cx, cy, r) => `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${T}" stroke-width="3.5"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.45}" fill="none" stroke="${T}" stroke-width="2"/>`;

  const svgs = {
    articulado: `<svg viewBox="0 0 320 130" class="family-svg">
      <!-- tractor delantero: cabina + capó -->
      <path d="M28 78 L28 52 L52 52 L58 34 L92 34 L92 78 Z" fill="none" stroke="${G}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M62 38 L88 38 L88 52 L62 52 Z" fill="none" stroke="${G}" stroke-width="2"/>
      <rect x="14" y="58" width="16" height="16" rx="3" fill="none" stroke="${G}" stroke-width="2.5"/>
      ${rueda(46, 92, 15)}
      <!-- articulación central: el punto de engrase más importante -->
      <line x1="92" y1="66" x2="128" y2="66" stroke="${T}" stroke-width="5"/>
      <circle cx="110" cy="66" r="9" fill="${A}"/>
      <circle cx="110" cy="66" r="14" fill="none" stroke="${A}" stroke-width="2" opacity=".5"/>
      <!-- tolva basculante -->
      <path d="M128 74 L136 40 L296 40 L302 74 Z" fill="none" stroke="${R}" stroke-width="3" stroke-linejoin="round"/>
      <line x1="140" y1="52" x2="296" y2="52" stroke="${R}" stroke-width="1.5" opacity=".6"/>
      <rect x="128" y="74" width="174" height="10" rx="3" fill="none" stroke="${T}" stroke-width="2.5"/>
      ${rueda(172, 96, 15)}
      ${rueda(215, 96, 15)}
      ${rueda(272, 96, 15)}
      <!-- pistón de volteo -->
      <line x1="150" y1="74" x2="176" y2="58" stroke="${A}" stroke-width="3"/>
    </svg>`,

    excavadora: `<svg viewBox="0 0 320 140" class="family-svg">
      ${oruga(24, 104, 168)}
      <!-- carro superior giratorio -->
      <rect x="46" y="92" width="126" height="12" rx="4" fill="none" stroke="${T}" stroke-width="2.5"/>
      <circle cx="108" cy="92" r="7" fill="none" stroke="${A}" stroke-width="2.5"/>
      <!-- cabina y contrapeso -->
      <path d="M52 92 L52 56 L74 56 L82 42 L108 42 L108 92 Z" fill="none" stroke="${G}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M86 46 L104 46 L104 58 L86 58 Z" fill="none" stroke="${G}" stroke-width="2"/>
      <path d="M108 92 L108 58 L166 58 L172 78 L172 92 Z" fill="none" stroke="${T}" stroke-width="2.5" stroke-linejoin="round"/>
      <!-- pluma -->
      <line x1="112" y1="66" x2="196" y2="26" stroke="${A}" stroke-width="7" stroke-linecap="round"/>
      <circle cx="112" cy="66" r="6" fill="${A}"/>
      <!-- brazo -->
      <line x1="196" y1="26" x2="252" y2="80" stroke="${A}" stroke-width="6" stroke-linecap="round"/>
      <circle cx="196" cy="26" r="5.5" fill="${A}"/>
      <!-- cilindros hidráulicos -->
      <line x1="128" y1="76" x2="168" y2="44" stroke="${T}" stroke-width="4"/>
      <line x1="186" y1="36" x2="228" y2="44" stroke="${T}" stroke-width="4"/>
      <!-- cucharón -->
      <path d="M252 80 L246 104 L282 112 L292 88 L272 76 Z" fill="none" stroke="${R}" stroke-width="3.5" stroke-linejoin="round"/>
      <circle cx="252" cy="80" r="5.5" fill="${A}"/>
      ${[252, 262, 272, 282].map(x => `<line x1="${x - 4}" y1="106" x2="${x - 6}" y2="116" stroke="${R}" stroke-width="2.5"/>`).join('')}
    </svg>`,

    tractor: `<svg viewBox="0 0 320 130" class="family-svg">
      ${oruga(66, 92, 190)}
      <!-- cuerpo y cabina -->
      <path d="M104 92 L104 54 L134 54 L142 34 L192 34 L200 54 L226 54 L226 92 Z" fill="none" stroke="${T}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M146 38 L188 38 L192 52 L146 52 Z" fill="none" stroke="${T}" stroke-width="2"/>
      <!-- brazos de empuje de la cuchilla -->
      <line x1="104" y1="80" x2="58" y2="86" stroke="${A}" stroke-width="4"/>
      <circle cx="104" cy="80" r="5.5" fill="${A}"/>
      <!-- cilindros de inclinación -->
      <line x1="112" y1="60" x2="66" y2="52" stroke="${A}" stroke-width="3.5"/>
      <circle cx="66" cy="52" r="4.5" fill="${A}"/>
      <!-- cuchilla frontal -->
      <path d="M52 26 L52 100 L36 104 L34 30 Z" fill="none" stroke="${G}" stroke-width="3.5" stroke-linejoin="round"/>
      <line x1="52" y1="60" x2="36" y2="62" stroke="${G}" stroke-width="2" opacity=".6"/>
      <!-- ripper trasero -->
      <line x1="226" y1="72" x2="268" y2="78" stroke="${R}" stroke-width="4"/>
      <path d="M268 78 L276 78 L282 112 L272 112 Z" fill="none" stroke="${R}" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="226" cy="72" r="5" fill="${A}"/>
    </svg>`,

    volquete: `<svg viewBox="0 0 320 130" class="family-svg">
      <!-- chasis -->
      <rect x="30" y="76" width="266" height="11" rx="3" fill="none" stroke="${T}" stroke-width="2.5"/>
      <!-- cabina -->
      <path d="M30 76 L30 40 L58 40 L68 22 L96 22 L96 76 Z" fill="none" stroke="${G}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M70 26 L92 26 L92 42 L70 42 Z" fill="none" stroke="${G}" stroke-width="2"/>
      <!-- tolva con pines -->
      <path d="M104 76 L112 30 L292 30 L296 76 Z" fill="none" stroke="${R}" stroke-width="3" stroke-linejoin="round"/>
      <line x1="116" y1="46" x2="292" y2="46" stroke="${R}" stroke-width="1.5" opacity=".55"/>
      <circle cx="292" cy="74" r="7" fill="${A}"/>
      <circle cx="292" cy="74" r="11" fill="none" stroke="${A}" stroke-width="2" opacity=".5"/>
      <!-- cilindro de volteo -->
      <line x1="140" y1="76" x2="176" y2="52" stroke="${A}" stroke-width="4"/>
      <circle cx="140" cy="76" r="5" fill="${A}"/>
      ${rueda(70, 92, 16)}
      ${rueda(214, 92, 16)}
      ${rueda(258, 92, 16)}
    </svg>`,

    generico: `<svg viewBox="0 0 320 130" class="family-svg">
      <!-- motoniveladora: chasis largo articulado -->
      <path d="M196 68 L196 40 L222 40 L230 24 L266 24 L266 68 Z" fill="none" stroke="${T}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M234 28 L262 28 L262 40 L234 40 Z" fill="none" stroke="${T}" stroke-width="2"/>
      <line x1="40" y1="62" x2="196" y2="62" stroke="${T}" stroke-width="5"/>
      <!-- articulación central -->
      <circle cx="150" cy="62" r="8" fill="${A}"/>
      <circle cx="150" cy="62" r="12.5" fill="none" stroke="${A}" stroke-width="2" opacity=".5"/>
      <!-- círculo y hoja vertedera -->
      <ellipse cx="112" cy="74" rx="30" ry="9" fill="none" stroke="${A}" stroke-width="3"/>
      <path d="M84 82 L142 96 L146 82 L88 68 Z" fill="none" stroke="${G}" stroke-width="3.5" stroke-linejoin="round"/>
      <!-- cilindros de la hoja -->
      <line x1="96" y1="62" x2="88" y2="76" stroke="${A}" stroke-width="3"/>
      <line x1="132" y1="62" x2="140" y2="80" stroke="${A}" stroke-width="3"/>
      <!-- escarificador delantero -->
      <line x1="40" y1="62" x2="40" y2="88" stroke="${R}" stroke-width="3"/>
      ${rueda(48, 92, 14)}
      ${rueda(214, 92, 15)}
      ${rueda(258, 92, 15)}
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
        <h3>${esc(fam.name)}</h3>
        ${canEdit ? `<button class="btn btn-sm family-edit-btn" data-id="${fam.id}">${ic("edit")}Editar</button>` : ''}
      </div>
      <div class="family-body">
        <div class="family-diagram">${fam.photo
          ? `<img src="${fam.photo}" class="family-photo photo-thumb" data-full="${fam.photo}" data-caption="${esc(fam.name)}" alt="${esc(fam.name)}"/>`
          : familySilhouetteSvg(fam.svg)}</div>
        <div class="family-zones">
          ${fam.zones.map(z => `
            <div class="family-zone">
              <div class="family-zone-title"><span class="dot" style="background:${z.color}"></span>${esc(z.name)}</div>
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
        ${help.faq.map(f => `<details class="faq-item"><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`).join('') || '<div class="empty-state">Sin preguntas todavía.</div>'}
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
        <label>Nombre de la familia<input required id="fam-name" value="${esc(fam.name)}"/></label>

        <div class="fam-img-box">
          <label>Dibujo de referencia
            <select id="fam-svg">
              ${[['articulado','Camión articulado'],['excavadora','Excavadora de orugas'],['tractor','Tractor de orugas'],['volquete','Camión volquete'],['generico','Motoniveladora / Cargador']]
                .map(([v,l]) => `<option value="${v}" ${fam.svg === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </label>
          <div class="fam-img-preview" id="fam-preview">
            ${fam.photo ? `<img src="${fam.photo}" alt="Foto del equipo"/>` : familySilhouetteSvg(fam.svg)}
          </div>
          <div class="dim" style="font-size:12px; margin-bottom:8px">
            Puedes usar una <b>foto real de tu equipo</b> en vez del dibujo — se reconoce mejor en campo.
            No uses fotos de catálogo de fabricantes (Caterpillar, Komatsu…): son propiedad de la marca.
          </div>
          ${photoFieldHTML()}
          ${fam.photo ? `<button type="button" class="btn btn-sm btn-danger" id="fam-quitar-foto">${ic("trash")}Quitar la foto y volver al dibujo</button>` : ''}
        </div>

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
          <label>Nombre de zona<input class="fz-name" value="${esc(z.name)}"/></label>
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

  openModal(isNew ? 'Nueva familia de equipo' : `Editar · ${esc(fam.name)}`, bodyHTML());

  // ── Imagen de la familia: dibujo de referencia o foto propia ──
  let fotoQuitada = false;
  const cajaImagen = $('.fam-img-box');
  wirePhotoField(cajaImagen);

  function refrescarPreview() {
    const prev = $('#fam-preview');
    if (!prev) return;
    const subidas = getPhotoFieldPhotos(cajaImagen);
    if (subidas.length) prev.innerHTML = `<img src="${subidas[0]}" alt="Foto del equipo"/>`;
    else if (fam.photo && !fotoQuitada) prev.innerHTML = `<img src="${fam.photo}" alt="Foto del equipo"/>`;
    else prev.innerHTML = familySilhouetteSvg($('#fam-svg').value);
  }

  $('#fam-svg')?.addEventListener('change', refrescarPreview);
  cajaImagen?.addEventListener('click', () => setTimeout(refrescarPreview, 400)); // tras elegir foto
  $('#fam-quitar-foto')?.addEventListener('click', () => {
    fotoQuitada = true;
    fam.photo = null;
    $('#fam-quitar-foto').remove();
    refrescarPreview();
  });

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
    if (!confirm(`¿Eliminar la familia "${esc(fam.name)}"? Esto no afecta los planes de engrase ya configurados por equipo, solo esta guía.`)) return;
    help.families = help.families.filter(f => f.id !== fam.id);
    await DB.put('settings', stamp(help, App.currentUser.name));
    await logAudit('AYUDA_ACTUALIZADA', `Familia eliminada: ${esc(fam.name)}`, App.currentUser.name);
    showInAppToast('✓ Familia eliminada');
    closeModal();
    renderAyuda();
  });

  $('#family-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    fam.name = $('#fam-name').value.trim() || 'Sin nombre';
    fam.svg = $('#fam-svg')?.value || fam.svg || 'generico';
    const fotoSubida = getPhotoFieldPhotos(cajaImagen)[0];
    if (fotoSubida) fam.photo = fotoSubida;
    else if (fotoQuitada) fam.photo = null;

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
    await logAudit('AYUDA_ACTUALIZADA', `Familia guardada: ${esc(fam.name)}`, App.currentUser.name);
    showInAppToast('✓ Familia guardada');
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
            <input class="faq-q" placeholder="Pregunta" value="${esc(f.question)}"/>
            <textarea class="faq-a" placeholder="Respuesta" rows="2">${esc(f.answer)}</textarea>
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
      showInAppToast('✓ Preguntas frecuentes actualizadas');
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
            <span class="simple-list-name">${esc(it.name)}</span>
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
    await logAudit('LISTA_ACTUALIZADA', `${store}: agregado "${esc(name)}"`, App.currentUser.name);
    showInAppToast(`✓ "${esc(name)}" agregado`);
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
      showInAppToast(`✓ Actualizado a "${newName}"`);
      onChange();
    });
  });
  panel.querySelectorAll('.sl-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.simple-list-row');
      const id = row.dataset.id;
      const name = row.querySelector('.simple-list-name').textContent;
      if (!confirm(`¿Eliminar "${esc(name)}"? Los equipos o usuarios que ya lo tengan asignado no se modifican, pero dejará de aparecer como opción para elegir.`)) return;
      const item = await DB.get(store, id);
      item.active = false;
      await DB.put(store, stamp(item, App.currentUser.name));
      await logAudit('LISTA_ACTUALIZADA', `${store}: eliminado "${esc(name)}"`, App.currentUser.name);
      showInAppToast(`✓ "${esc(name)}" eliminado`);
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
  showInAppToast('✓ Respaldo descargado');
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
    showInAppToast(`✓ Respaldo restaurado: ${applied} registros`);
    closeModal();
    alert(`Listo, se restauraron ${applied} registros.`);
    renderConfig();
  });
}

/* ---------- Papelera: ver y restaurar lo eliminado (borrado lógico) ---------- */
const TRASH_STORES = [
  { store: 'equipment', label: 'Equipos', name: r => `${r.code || '?'} · ${r.brand || ''} ${r.model || ''}` },
  { store: 'lubricants', label: 'Lubricantes', name: r => r.name || '?' },
  { store: 'anomalies', label: 'Anomalías', name: r => `${r.component || '?'} — ${(r.description || '').slice(0, 40)}` },
  { store: 'users', label: 'Usuarios', name: r => `${r.name || '?'} (${r.username || ''})` },
  { store: 'locations', label: 'Ubicaciones', name: r => r.name || '?' },
  { store: 'equipment_types', label: 'Categorías', name: r => r.name || '?' },
  { store: 'cuadrillas', label: 'Cuadrillas', name: r => r.name || '?' },
];

/* ---------- Liberar espacio: borrado DEFINITIVO (no se puede deshacer) ----------
   A diferencia del borrado normal (que solo oculta el registro y lo conserva para
   auditoría y para la papelera), esto lo elimina de verdad, tanto del dispositivo
   como del servidor. Es la salida cuando la base de datos se llena. */

// Calcula cuánto espacio ocupa cada tipo de dato, para saber qué conviene limpiar
async function calcularEspacio() {
  const stats = { total: 0, fotos: 0, porStore: {}, borrados: 0, registrosViejos: 0 };
  const haceUnAnio = Date.now() - 365 * 86400000;

  for (const store of STORES) {
    const rows = await DB.all(store);
    let bytes = 0;
    rows.forEach(r => {
      const size = JSON.stringify(r).length;
      bytes += size;
      if (r.active === false) stats.borrados++;
      const fotos = photosOf(r).filter(p => typeof p === 'string' && p.startsWith('data:image'));
      fotos.forEach(f => { stats.fotos += f.length; });
      if (r.date && new Date(r.date).getTime() < haceUnAnio) stats.registrosViejos++;
    });
    stats.porStore[store] = { bytes, count: rows.length };
    stats.total += bytes;
  }
  return stats;
}

function formatoMB(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Borra de verdad un registro: del dispositivo Y del servidor
async function borrarDefinitivo(store, id) {
  const cfg = await DB.getConfig();
  if (cfg && cfg.url && cfg.anonKey && navigator.onLine) {
    try {
      await fetch(`${cfg.url}/rest/v1/engrase_sync?store=eq.${store}&id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` }
      });
    } catch (e) { console.warn('No se pudo borrar del servidor', store, id, e); }
  }
  await DB.delete(store, id);
}

async function renderStorageStats() {
  const el = $('#storage-stats');
  if (!el) return;
  const s = await calcularEspacio();
  const top = Object.entries(s.porStore)
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 4)
    .map(([store, d]) => `${store}: ${formatoMB(d.bytes)} (${d.count})`)
    .join(' · ');
  el.innerHTML = `
    <b>Espacio usado: ${formatoMB(s.total)}</b> — de eso, ${formatoMB(s.fotos)} son fotos guardadas en el dispositivo.<br/>
    ${top}<br/>
    <span style="color:var(--amber)">${s.borrados} registro(s) en la papelera · ${s.registrosViejos} registro(s) con más de un año</span>`;
}

async function purgarPapelera() {
  const aBorrar = [];
  for (const store of STORES) {
    const rows = await DB.all(store);
    rows.filter(r => r.active === false).forEach(r => aBorrar.push({ store, id: r.id }));
  }
  if (!aBorrar.length) { alert('La papelera ya está vacía.'); return; }
  if (!confirm(`Se van a eliminar DEFINITIVAMENTE ${aBorrar.length} registro(s) de la papelera.\n\nEsto NO se puede deshacer y también los borra del servidor.\n\n¿Continuar?`)) return;
  if (!confirm('Confirmación final: ¿ya descargaste una copia de respaldo?')) return;

  let n = 0;
  for (const { store, id } of aBorrar) { await borrarDefinitivo(store, id); n++; }
  await logAudit('PURGA_PAPELERA', `${n} registros eliminados definitivamente`, App.currentUser.name);
  showInAppToast(`✓ ${n} registro(s) eliminados definitivamente`);
  renderConfig();
}

async function purgarRegistrosAntiguos() {
  openModal('Borrar registros antiguos', `
    <p class="dim">Elimina de forma permanente los engrases y anomalías <b>cerradas</b> anteriores a la fecha que elijas. Los equipos, planes y usuarios NO se tocan.</p>
    <label>Borrar todo lo anterior a
      <input type="date" id="purge-date" class="input" value="${new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)}"/>
    </label>
    <div id="purge-preview" class="dim" style="margin-top:12px">Elige una fecha para ver cuántos se borrarían.</div>
    <div class="modal-actions">
      <button class="btn btn-danger" id="btn-do-purge-old">${ic("trash")}Borrar definitivamente</button>
    </div>
  `);

  async function contar() {
    const limite = new Date($('#purge-date').value).getTime();
    if (isNaN(limite)) return { records: [], anomalies: [] };
    const records = (await DB.all('lubrication_records')).filter(r => new Date(r.date).getTime() < limite);
    const anomalies = (await DB.all('anomalies')).filter(a => a.status === 'Cerrada' && new Date(a.createdAt).getTime() < limite);
    $('#purge-preview').innerHTML = `Se borrarían <b>${records.length}</b> registro(s) de engrase y <b>${anomalies.length}</b> anomalía(s) cerrada(s).`;
    return { records, anomalies };
  }
  await contar();
  $('#purge-date').addEventListener('change', contar);

  $('#btn-do-purge-old').addEventListener('click', async () => {
    const { records, anomalies } = await contar();
    const total = records.length + anomalies.length;
    if (!total) { alert('No hay registros anteriores a esa fecha.'); return; }
    if (!confirm(`Se eliminarán DEFINITIVAMENTE ${total} registro(s), también del servidor.\n\nEsto NO se puede deshacer. ¿Continuar?`)) return;
    if (!confirm('Confirmación final: ¿ya descargaste una copia de respaldo?')) return;

    for (const r of records) await borrarDefinitivo('lubrication_records', r.id);
    for (const a of anomalies) await borrarDefinitivo('anomalies', a.id);
    await logAudit('PURGA_ANTIGUOS', `${total} registros anteriores a ${$('#purge-date').value}`, App.currentUser.name);
    showInAppToast(`✓ ${total} registro(s) eliminados definitivamente`);
    closeModal();
    renderConfig();
  });
}

async function purgarFotosAntiguas() {
  openModal('Quitar fotos antiguas', `
    <p class="dim">Quita solo las <b>fotos</b> de los engrases y anomalías anteriores a la fecha elegida. Los registros se conservan completos (fecha, horómetro, quién lo hizo, observaciones) — solo se libera el espacio de las imágenes.</p>
    <label>Quitar fotos anteriores a
      <input type="date" id="photo-purge-date" class="input" value="${new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10)}"/>
    </label>
    <div id="photo-purge-preview" class="dim" style="margin-top:12px"></div>
    <div class="modal-actions">
      <button class="btn btn-danger" id="btn-do-purge-photos">${ic("trash")}Quitar esas fotos</button>
    </div>
  `);

  async function contarFotos() {
    const limite = new Date($('#photo-purge-date').value).getTime();
    if (isNaN(limite)) return [];
    const afectados = [];
    let bytes = 0;
    for (const store of ['lubrication_records', 'anomalies']) {
      const rows = await DB.all(store);
      rows.forEach(r => {
        const fecha = new Date(r.date || r.createdAt).getTime();
        if (fecha >= limite) return;
        const locales = photosOf(r).filter(p => typeof p === 'string' && p.startsWith('data:image'));
        if (locales.length) {
          locales.forEach(p => { bytes += p.length; });
          afectados.push({ store, r, cantidad: locales.length });
        }
      });
    }
    $('#photo-purge-preview').innerHTML = `Se quitarían <b>${afectados.reduce((n, a) => n + a.cantidad, 0)}</b> foto(s) de ${afectados.length} registro(s) — liberaría aprox. <b>${formatoMB(bytes)}</b>.`;
    return afectados;
  }
  await contarFotos();
  $('#photo-purge-date').addEventListener('change', contarFotos);

  $('#btn-do-purge-photos').addEventListener('click', async () => {
    const afectados = await contarFotos();
    if (!afectados.length) { alert('No hay fotos anteriores a esa fecha guardadas en este dispositivo.'); return; }
    if (!confirm(`Se quitarán las fotos de ${afectados.length} registro(s). Los datos del engrase se conservan.\n\n¿Continuar?`)) return;

    for (const { store, r } of afectados) {
      // Si las fotos ya se subieron al servidor, conserva los enlaces; solo quita las
      // copias pesadas en base64 que ocupan espacio en el dispositivo.
      const enlaces = photosOf(r).filter(p => typeof p === 'string' && !p.startsWith('data:image'));
      r.photos = enlaces;
      r.photo = enlaces[0] || null;
      await DB.put(store, r); // sin stamp: no queremos que esto cuente como "editado" ni re-sincronice
    }
    await logAudit('PURGA_FOTOS', `Fotos quitadas de ${afectados.length} registros`, App.currentUser.name);
    showInAppToast(`✓ Fotos liberadas de ${afectados.length} registro(s)`);
    closeModal();
    renderConfig();
  });
}

async function renderTrash() {
  const area = $('#trash-area');
  if (!area) return;
  const bloques = [];
  for (const { store, label, name } of TRASH_STORES) {
    const all = await DB.all(store);
    const borrados = all.filter(r => r.active === false);
    if (!borrados.length) continue;
    bloques.push(`
      <div class="trash-block">
        <h4>${label} (${borrados.length})</h4>
        ${borrados.map(r => `
          <div class="trash-row">
            <span>${esc(name(r))}<span class="dim"> · eliminado ${r.updatedAt ? fmtDate(r.updatedAt) : 'sin fecha'}</span></span>
            <button class="btn btn-sm trash-restore" data-store="${store}" data-id="${r.id}">Restaurar</button>
          </div>`).join('')}
      </div>`);
  }
  area.innerHTML = bloques.join('') || '<div class="empty-state">La papelera está vacía — no hay nada eliminado.</div>';

  $$('.trash-restore', area).forEach(btn => {
    btn.addEventListener('click', async () => {
      const { store, id } = btn.dataset;
      const rec = await DB.get(store, id);
      if (!rec) return;
      rec.active = true;
      await DB.put(store, stamp(rec, App.currentUser.name));
      await logAudit('RESTAURADO_DE_PAPELERA', `${store}: ${id}`, App.currentUser.name);
      showInAppToast('✓ Restaurado correctamente');
      renderConfig();
    });
  });
}

/* Arma la tarjeta de configuración de UN tipo de notificación:
   interruptor + hora (si aplica) + roles que la reciben + opciones extra. */
const NOTIF_ROLES_DISPONIBLES = ['ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR', 'LUBRICADOR'];

function notifCardHTML(clave, titulo, descripcion, cfg, conHora, conSoloSiHay, conSoloCriticos, conRecordatorio, conEscalamiento) {
  const pad = n => String(n).padStart(2, '0');
  return `
    <div class="notif-card ${cfg.enabled ? '' : 'notif-off'}">
      <label class="notif-card-head">
        <input type="checkbox" name="${clave}_enabled" ${cfg.enabled ? 'checked' : ''} data-notif-toggle="${clave}"/>
        <span><b>${titulo}</b><br/><span class="dim">${descripcion}</span></span>
      </label>
      <div class="notif-card-body">
        ${conHora ? `
          <label class="notif-hora">Hora del aviso
            <input type="time" name="${clave}_hora" value="${pad(cfg.hour)}:${pad(cfg.minute)}"/>
          </label>` : `<div class="notif-hora dim">Se envía en el momento en que ocurre</div>`}
        <div class="notif-roles">
          <span class="dim">Lo reciben:</span>
          <div class="notif-roles-list">
            ${NOTIF_ROLES_DISPONIBLES.map(r => `
              <label class="notif-rol">
                <input type="checkbox" name="${clave}_rol_${r}" ${(cfg.roles || []).includes(r) ? 'checked' : ''}/>
                <span>${r.charAt(0) + r.slice(1).toLowerCase()}</span>
              </label>`).join('')}
          </div>
        </div>
        ${conSoloSiHay ? `
          <label class="notif-extra">
            <input type="checkbox" name="${clave}_soloSiHay" ${cfg.soloSiHay ? 'checked' : ''}/>
            <span>Avisar solo si hay equipos (si no, también avisa "todo al día")</span>
          </label>` : ''}
        ${conSoloCriticos ? `
          <label class="notif-extra">
            <input type="checkbox" name="${clave}_soloCriticos" ${cfg.soloCriticos ? 'checked' : ''}/>
            <span>Avisar solo casos importantes (equipo vencido o con puntos sin engrasar)</span>
          </label>` : ''}
        ${conRecordatorio ? `
          <label class="notif-extra">
            <input type="checkbox" name="${clave}_recordatorio" ${cfg.recordatorio ? 'checked' : ''}/>
            <span>Recordar a media jornada si sigue pendiente, pasadas
              <input type="number" name="${clave}_recordatorioHoras" value="${cfg.recordatorioHoras || 4}" min="1" max="12" class="notif-num"/> horas
            </span>
          </label>` : ''}
        ${conEscalamiento ? `
          <label class="notif-extra">
            <span>Si lleva más de
              <input type="number" name="${clave}_escalarDias" value="${cfg.escalarDias || 3}" min="1" max="30" class="notif-num"/> día(s) vencido, avisar también a:
            </span>
            <span class="notif-roles-list" style="margin-left:6px">
              ${NOTIF_ROLES_DISPONIBLES.map(r => `
                <label class="notif-rol">
                  <input type="checkbox" name="${clave}_esc_${r}" ${(cfg.escalarA || []).includes(r) ? 'checked' : ''}/>
                  <span>${r.charAt(0) + r.slice(1).toLowerCase()}</span>
                </label>`).join('')}
            </span>
          </label>` : ''}
      </div>
    </div>`;
}

async function renderConfig() {
  const c = $('#app-content');
  const cfg = (await DB.getConfig()) || {};
  const log = (await DB.all('audit_log')).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);
  const pending = await Sync.pendingCount();
  const notif = mergeNotifSettings(await DB.get('settings', 'notifications'));
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
      <div class="panel-head"><h3>Notificaciones — control por tipo</h3></div>
      <div style="padding:14px">
        <p class="dim">Cada aviso se controla por separado: puedes activarlo o apagarlo, elegir a qué hora suena y qué roles lo reciben. Los cambios aplican a todos los dispositivos al sincronizar.</p>
        <form id="notif-form">
          <label class="notif-master">
            <input type="checkbox" name="enabled" ${notif.enabled ? 'checked' : ''}/>
            <span><b>Notificaciones activadas</b><br/><span class="dim">Si apagas esto, no suena ninguna, sin importar lo de abajo.</span></span>
          </label>

          <label class="notif-master" style="border-color:var(--border); background:var(--surface-2)">
            <input type="checkbox" name="soloEnTurno" ${notif.soloEnTurno ? 'checked' : ''}/>
            <span><b>Avisar solo dentro del turno de trabajo</b><br/><span class="dim">Recomendado. Un lubricador del turno noche no recibe avisos mientras descansa. Si un aviso cae fuera de su turno, se corre al inicio del mismo. Importante cuando las cuadrillas comparten el teléfono.</span></span>
          </label>

          ${notifCardHTML('vencidos', '🔴 Engrases VENCIDOS', 'Avisa de los equipos que ya pasaron su fecha o su horómetro de engrase.', notif.vencidos, true, true, false, true, true)}
          ${notifCardHTML('porEngrasar', '🟡 Equipos POR ENGRASAR hoy', 'Avisa de los equipos que toca engrasar en el día.', notif.porEngrasar, true, true, false, true)}
          ${notifCardHTML('engraseRealizado', '✓ Cuando se REGISTRA un engrase', 'Aviso inmediato cada vez que un lubricador termina un engrase.', notif.engraseRealizado, false, false, true)}
          ${notifCardHTML('cumplimiento', '📊 Resumen de cumplimiento', 'Resumen diario con el porcentaje de cumplimiento de la flota.', notif.cumplimiento, true, false)}
          ${notifCardHTML('anomalias', '⚠ Anomalías nuevas', 'Aviso inmediato cuando alguien reporta una anomalía. Si llegan varias seguidas se agrupan en una sola.', notif.anomalias, false, false)}
          ${notifCardHTML('resumenSemanal', '📅 Resumen semanal (lunes)', 'Cada lunes: engrases de la semana, cumplimiento y qué fue lo que más falló.', notif.resumenSemanal, true, false)}

          <div class="modal-actions" style="justify-content:flex-start; margin-top:16px">
            <button type="submit" class="btn btn-accent">${ic("save")}Guardar notificaciones</button>
          </div>
        </form>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Notificaciones push (llegan aunque la app esté cerrada)</h3></div>
      <div style="padding:14px">
        <p class="dim">Usan OneSignal (más simple que conectar Firebase a mano — ver GUIA_NOTIFICACIONES_PUSH.md). Necesitas pegar tu "App ID" de OneSignal en el código antes de que esto funcione.</p>
        <div id="push-status" class="dim" style="margin-bottom:10px">
          ${(('serviceWorker' in navigator && 'PushManager' in window) || window.Capacitor)
            ? 'Este dispositivo puede recibir notificaciones aunque la app esté cerrada.'
            : 'Este navegador no soporta notificaciones push. En iPhone, primero agrega la web a la pantalla de inicio.'}
        </div>
        ${(('serviceWorker' in navigator && 'PushManager' in window) || window.Capacitor)
          ? `<button class="btn btn-accent" id="btn-enable-push">Activar en este dispositivo</button>` : ''}
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
          ${cfg.url ? `Servidor conectado. Última descarga: ${cfg.lastPull ? fmtDate(cfg.lastPull) : 'nunca'} · Pendientes por subir: ${pending}` : 'Aún no hay servidor remoto configurado — todo funciona solo en este dispositivo.'}
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Papelera — recuperar lo eliminado</h3></div>
      <div style="padding:14px">
        <p class="dim">Cuando se elimina un equipo, lubricante, anomalía o usuario, no se borra de verdad: queda oculto aquí. Si fue por error, puedes restaurarlo.</p>
        <div id="trash-area"></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Liberar espacio — borrado definitivo</h3></div>
      <div style="padding:14px">
        <p class="dim">Cuando la base de datos se llene, aquí puedes borrar de forma <b>permanente</b> lo que ya no necesitas: registros antiguos, fotos viejas y lo que está en la papelera. A diferencia de eliminar desde las pantallas, esto <b>no se puede deshacer</b>.</p>
        <div id="storage-stats" class="dim" style="margin:10px 0">Calculando espacio usado…</div>
        <div class="toolbar">
          <button class="btn" id="btn-purge-trash">${ic("trash")}Vaciar papelera</button>
          <button class="btn" id="btn-purge-old">${ic("trash")}Borrar registros antiguos…</button>
          <button class="btn" id="btn-purge-photos">${ic("gallery")}Quitar fotos antiguas…</button>
        </div>
        <p class="dim" style="margin-top:8px; color:var(--amber)">⚠ Antes de borrar, descarga una copia completa (panel de abajo). Es tu única forma de recuperar lo que se elimine aquí.</p>
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
        <tbody>${log.map(l => `<tr><td>${fmtDate(l.createdAt)}</td><td>${l.action}</td><td>${esc(l.detail)}</td><td>${l.user}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">Sin actividad.</td></tr>'}</tbody>
      </table>
    </div>`;

  await renderTrash();
  renderStorageStats();
  $('#btn-purge-trash')?.addEventListener('click', purgarPapelera);
  $('#btn-purge-old')?.addEventListener('click', purgarRegistrosAntiguos);
  $('#btn-purge-photos')?.addEventListener('click', purgarFotosAntiguas);
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
    showInAppToast('✓ Configuración general guardada');
    await loadGeneralSettings();
    await refreshLocalNotifications();
    renderConfig();
  });

  wireSimpleListPanel(c, 'cuadrillas', () => renderConfig());
  wireSimpleListPanel(c, 'locations', () => renderConfig());
  wireSimpleListPanel(c, 'equipment_types', () => renderConfig());

  $('#btn-enable-push')?.addEventListener('click', async () => {
    if (!ONESIGNAL_APP_ID) { alert('Falta pegar el App ID de OneSignal en el código (ver GUIA_NOTIFICACIONES_PUSH.md). Sin eso las notificaciones no pueden activarse.'); return; }
    if (!confirm('Se te va a pedir permiso para mostrar notificaciones. ¿Continuar?')) return;
    await initPushNotifications();
    alert('Listo. Si OneSignal está bien configurado, este dispositivo debería aparecer en la lista de abajo en unos segundos (puede que tengas que volver a entrar a esta pantalla).');
    renderConfig();
  });

  const pushTokens = (await DB.allActive('push_tokens'));
  $('#push-tokens-list').innerHTML = pushTokens.length ? `
    <table class="data-table">
      <thead><tr><th>Usuario</th><th>Rol</th><th>Plataforma</th><th>Registrado</th></tr></thead>
      <tbody>${pushTokens.map(t => `<tr><td>${esc(t.userName)}</td><td>${t.role}</td><td>${t.platform}</td><td>${fmtDate(t.updatedAt)}</td></tr>`).join('')}</tbody>
    </table>` : '<div class="empty-state">Nadie ha activado las notificaciones push todavía (o Firebase aún no está configurado).</div>';
  makeTablesResponsive($('#push-tokens-list'));

  // Al apagar un tipo de aviso, su tarjeta se atenúa enseguida (sin esperar a guardar)
  $$('[data-notif-toggle]', c).forEach(chk => {
    chk.addEventListener('change', () => {
      chk.closest('.notif-card').classList.toggle('notif-off', !chk.checked);
    });
  });

  $('#notif-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const val = k => fd.get(k);
    const marcado = k => fd.get(k) !== null;

    // Arma la configuración de un tipo leyendo sus campos del formulario
    const leerTipo = (clave, conHora) => {
      const roles = NOTIF_ROLES_DISPONIBLES.filter(r => marcado(`${clave}_rol_${r}`));
      const out = { enabled: marcado(`${clave}_enabled`), roles };
      if (conHora) {
        const [h, m] = String(val(`${clave}_hora`) || '07:00').split(':').map(Number);
        out.hour = h; out.minute = m;
      }
      if (fd.has(`${clave}_soloSiHay`) || ev.target.querySelector(`[name="${clave}_soloSiHay"]`)) {
        out.soloSiHay = marcado(`${clave}_soloSiHay`);
      }
      if (ev.target.querySelector(`[name="${clave}_soloCriticos"]`)) {
        out.soloCriticos = marcado(`${clave}_soloCriticos`);
      }
      if (ev.target.querySelector(`[name="${clave}_recordatorio"]`)) {
        out.recordatorio = marcado(`${clave}_recordatorio`);
        out.recordatorioHoras = parseInt(val(`${clave}_recordatorioHoras`), 10) || 4;
      }
      if (ev.target.querySelector(`[name="${clave}_escalarDias"]`)) {
        out.escalarDias = parseInt(val(`${clave}_escalarDias`), 10) || 3;
        out.escalarA = NOTIF_ROLES_DISPONIBLES.filter(r => marcado(`${clave}_esc_${r}`));
      }
      if (clave === 'resumenSemanal') out.diaSemana = 1; // lunes
      return out;
    };

    const nuevo = {
      id: 'notifications',
      enabled: marcado('enabled'),
      soloEnTurno: marcado('soloEnTurno'),
      minutosAntesDelTurno: 15,
      minutosDespuesDelTurno: 30,
      vencidos: leerTipo('vencidos', true),
      porEngrasar: leerTipo('porEngrasar', true),
      engraseRealizado: leerTipo('engraseRealizado', false),
      cumplimiento: leerTipo('cumplimiento', true),
      anomalias: leerTipo('anomalias', false),
      resumenSemanal: leerTipo('resumenSemanal', true)
    };

    // Aviso útil: si un tipo queda activo pero sin ningún rol, nunca le llegaría a nadie
    const sinDestinatario = ['vencidos', 'porEngrasar', 'engraseRealizado', 'cumplimiento', 'anomalias', 'resumenSemanal']
      .filter(k => nuevo[k].enabled && !nuevo[k].roles.length);
    if (sinDestinatario.length && !confirm(`Hay ${sinDestinatario.length} aviso(s) activado(s) pero sin ningún rol marcado — no le llegarían a nadie.\n\n¿Guardar de todas formas?`)) return;

    await DB.put('settings', stamp(nuevo, App.currentUser.name));
    await logAudit('NOTIFICACIONES_CONFIGURADAS',
      nuevo.enabled ? `Activas: ${['vencidos','porEngrasar','engraseRealizado','cumplimiento','anomalias','resumenSemanal'].filter(k => nuevo[k].enabled).join(', ') || 'ninguna'}` : 'Desactivadas',
      App.currentUser.name);
    showInAppToast('✓ Notificaciones actualizadas');
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
      showInAppToast('✓ Servidor configurado');
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
  if (!overlay) return;
  overlay.classList.remove('open');
  // Además de ocultarlo, vaciamos el contenido: si solo se quita la clase, el formulario
  // anterior sigue existiendo dentro del documento con sus campos y manejadores viejos,
  // y al abrir otra ventana se mezclan (ese era el "desfase" al agregar puntos de engrase).
  overlay.innerHTML = '';
}
