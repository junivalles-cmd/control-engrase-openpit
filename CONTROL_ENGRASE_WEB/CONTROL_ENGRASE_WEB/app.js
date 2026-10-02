/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT — app.js
   ============================================================ */

const App = {
  currentUser: null,
  route: 'dashboard',
  configAlertYellow: 10,
  pendingQrEquipmentId: null, // equipo pendiente de mostrar tras escanear un QR (ver captureQrDeepLink)
  // Estado EXPLÍCITO del flujo Registrar Engrase del Lubricador (formulario →
  // guardado → "Validar ahora/después" → validación si aplica). true desde
  // startLubricadorGreaseFlow() hasta que el flujo termina de verdad (llega a
  // Mis Engrases) o la persona lo cancela ("← Volver a mi turno"). Fuente
  // principal para que onSyncStateChange() no interrumpa el flujo con un
  // rerender automático — más confiable que inferirlo de selectores DOM
  // (#grease-form/.grease-validate-choice), que igual se conservan como
  // defensa secundaria.
  lubricadorGreaseFlowActive: false
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

// Unidad operativa real del consumo de grasa. La interfaz mostraba "kg" desde
// el inicio del proyecto, pero en campo siempre se digitó en libras — la
// etiqueta era incorrecta, no el dato: `qty`/`recommendedQty` no cambian de
// valor ni de significado, solo el texto que los acompaña (docs/DECISIONS.md).
const GREASE_UNIT = 'lb';

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
  slot.innerHTML = `<img src="${dataUrl}" alt="Foto agregada"/><button type="button" class="photo-slot-remove" title="Quitar esta foto">✕</button>`;
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
          <img src="${dataUrl}" alt="Código QR de ${esc(e.code)}"/>
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
      <div class="modal-actions" style="justify-content:center">
        <button class="btn btn-accent" id="btn-print-qr">${ic("print")}Imprimir etiqueta</button>
        <button class="btn" id="btn-check-applink">${ic("help")}¿Por qué abre el navegador?</button>
      </div>
      <div id="applink-diag" style="margin-top:12px"></div>
    </div>
  `);
  try {
    // eslint-disable-next-line no-new
    new QRious({ element: $('#qr-canvas'), value: qrValueForEquipment(equipment), size: 220, background: '#ffffff', foreground: '#14171A' });
  } catch (e) { $('#qr-canvas').replaceWith('No se pudo generar el código QR (sin conexión la primera vez que se usa esta función).'); }
  // Comprueba en vivo si el sitio publica el archivo que Android necesita para
  // abrir la app en vez del navegador. Es el fallo más común y difícil de diagnosticar.
  $('#btn-check-applink')?.addEventListener('click', async () => {
    const caja = $('#applink-diag');
    caja.innerHTML = '<div class="dim">Comprobando…</div>';
    const url = `${location.origin}/.well-known/assetlinks.json`;
    let html = '';
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('código ' + r.status);
      const txt = await r.text();
      const json = JSON.parse(txt);
      const paquete = json?.[0]?.target?.package_name;
      html = `<div class="qr-info-ok">✓ El sitio SÍ publica el archivo de verificación.<br/>
        Aplicación declarada: <span class="mono">${esc(paquete || '?')}</span></div>
        <p class="dim" style="margin-top:8px">Si aun así se abre el navegador:</p>
        <ul class="dim" style="margin:4px 0 0 18px; font-size:12px; line-height:1.7">
          <li>Desinstala la app y vuelve a instalarla (la verificación se hace al instalar).</li>
          <li>Necesita internet la primera vez que se instala, para verificar.</li>
          <li>Revisa que el APK se haya firmado con el keystore de siempre.</li>
          <li>En Ajustes del teléfono → Apps → Control de Engrase → "Abrir por defecto",
              debe aparecer el enlace como verificado.</li>
        </ul>`;
    } catch (e) {
      html = `<div class="qr-info-alert">✗ El sitio NO está publicando el archivo de verificación.<br/>
        <span class="mono" style="font-size:11px">${esc(url)}</span></div>
        <p class="dim" style="margin-top:8px"><b>Por eso el QR abre el navegador.</b> Para corregirlo:</p>
        <ul class="dim" style="margin:4px 0 0 18px; font-size:12px; line-height:1.7">
          <li>Sube a GitHub el archivo <span class="mono">.nojekyll</span> (vacío) junto a index.html.
              Sin él, GitHub ignora la carpeta <span class="mono">.well-known</span>.</li>
          <li>Sube también la carpeta <span class="mono">.well-known</span> con su archivo dentro.</li>
          <li>Espera 1-2 minutos y vuelve a comprobar aquí.</li>
        </ul>`;
    }
    caja.innerHTML = html;
  });

  $('#btn-print-qr').addEventListener('click', () => {
    printHTMLDocument(`Etiqueta QR — ${equipment.code}`, `
      <div style="text-align:center; padding:20px">
        <h2>${esc(equipment.code)}${equipment.shortCode ? ' · ' + esc(equipment.shortCode) : ''}</h2>
        <p>${esc(equipment.brand)} ${esc(equipment.model)}</p>
        <img src="${$('#qr-canvas').toDataURL()}" style="width:260px" alt="Código QR de ${esc(equipment.code)}"/>
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
  const canRegisterRole = ['LUBRICADOR', 'ADMINISTRADOR', 'SUPERVISOR', 'PLANIFICADOR'].includes(App.currentUser.role);
  // Un Lubricador solo puede ejecutar equipos de su cuadrilla/ubicación, o con
  // una asignación manual activa hacia su cuadrilla (§AO) — nunca cualquier
  // equipo del sistema solo por escanear su QR.
  let outOfScopeMsg = '';
  let canRegister = canRegisterRole;
  // §21 del lote "engrase fuera de plan": A) assignment a mi cuadrilla ->
  // ASSIGNED, B) occurrence normal pendiente -> PLANNED (ambas abren igual,
  // "Registrar engrase ahora" ya las detecta solo), C) sin ninguna pero
  // dentro de mi scope -> ofrece "Registrar fuera de plan" en vez del botón
  // normal, D) fuera de mi scope -> bloqueado (ya cubierto arriba/abajo).
  let ofreceFueraDePlan = false;
  if (canRegisterRole && App.currentUser.role === 'LUBRICADOR') {
    const scope = await getCurrentOperationalScope();
    const { assignments } = await loadAssignmentContext();
    canRegister = canLubricadorExecuteEquipment({ scope, equipo: equipment, assignments });
    if (!canRegister) {
      outOfScopeMsg = '<div class="qr-info-alert">Este equipo no pertenece a tu cuadrilla ni tiene una asignación activa para ti — no puedes registrar su engrase desde aquí.</div>';
    } else {
      const plan = (await DB.allActive('lubrication_plans')).find(p => p.equipmentId === equipmentId) || null;
      const existing = plan ? findExistingWorkForEquipment({ plan, assignments, statusCode: s.code, todayDate: new Date() }) : { kind: 'NONE' };
      if (existing.kind === 'NONE') ofreceFueraDePlan = true;
    }
  }

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
      ${outOfScopeMsg}

      <div class="modal-actions" style="flex-wrap:wrap">
        ${canRegister && !ofreceFueraDePlan ? `<button class="btn btn-accent" id="qr-info-register">${ic("check")}Registrar engrase ahora</button>` : ''}
        ${ofreceFueraDePlan ? `<button class="btn btn-accent" id="qr-info-out-of-plan">${ic("plus")}Registrar fuera de plan</button>` : ''}
        ${App.currentUser.role !== 'LUBRICADOR' ? `<button class="btn" id="qr-info-detail">Ver ficha completa</button>` : ''}
      </div>
    </div>
  `);

  $('#qr-info-register')?.addEventListener('click', async () => {
    closeModal();
    if (App.currentUser.role === 'LUBRICADOR') await startLubricadorGreaseFlow(equipment.id);
    // FIX: startGreaseFlow() espera un elemento DOM real o `undefined`
    // (cae a navigate('registrar') + #reg-flow-area) — App.route es un
    // string (ej. 'equipos') y nunca debió pasarse aquí: una asignación de
    // propiedad sobre un string primitivo no lanza error, simplemente no
    // hace nada, así que el formulario nunca aparecía para jefaturas desde
    // este botón (bug documentado en docs/OPERATIONAL_SCOPE.md).
    else await startGreaseFlow(equipment.id);
  });
  $('#qr-info-out-of-plan')?.addEventListener('click', async () => {
    closeModal();
    await startLubricadorGreaseFlow(equipment.id, { outOfPlan: true });
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
const NOTIF_ID_ASSIGNED = 1010;        // engrase asignado manualmente a mi cuadrilla
const NOTIF_ID_ASSIGNED_REC = 1011;    // recordatorio de asignación todavía pendiente

// Factorizada aparte (lote arquitectura de notificaciones, §15) para poder
// cancelar TODAS las notificaciones locales programadas desde logout()
// incluso sin App.currentUser (refreshLocalNotifications() exige un
// usuario válido — logout() ya lo dejó en null para ese momento). Misma
// lista que ya se cancelaba al inicio de refreshLocalNotifications(), sin
// cambios.
const LOCAL_NOTIF_IDS = [
  { id: NOTIF_ID_DAILY_TASKS }, { id: NOTIF_ID_COMPLIANCE }, { id: NOTIF_ID_WEEKDAY_PLAN },
  { id: NOTIF_ID_VENCIDOS }, { id: NOTIF_ID_POR_ENGRASAR },
  { id: NOTIF_ID_VENCIDOS_REC }, { id: NOTIF_ID_POR_ENGRASAR_REC },
  { id: NOTIF_ID_SEMANAL }, { id: NOTIF_ID_ESCALADO },
  { id: NOTIF_ID_ASSIGNED }, { id: NOTIF_ID_ASSIGNED_REC }
];
async function cancelAllLocalNotifications() {
  const LN = window.Capacitor?.Plugins?.LocalNotifications;
  if (!LN) return;
  try { await LN.cancel({ notifications: LOCAL_NOTIF_IDS }); } catch (e) {}
}

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

/* dentroDeSuTurno() se movió a src/core/shifts.js (sigue disponible como
   global, ver docs/MODULARIZATION.md). */

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

/* validateHourmeterChange() se movió a src/core/hourmeter.js (sigue
   disponible como global, ver docs/MODULARIZATION.md). */
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
  await refreshPushTokenDeviceScope();
  Sync.fullSync();
}

/* ============================================================
   SCOPE OPERATIVO CENTRAL (dispositivos compartidos + cuadrillas +
   ubicaciones + asignación manual de engrases) — ver
   docs/OPERATIONAL_SCOPE.md. Las reglas de decisión viven, puras, en
   src/core/operational-scope.js; aquí solo se conectan con IndexedDB/App,
   nunca se reimplementan.
   ============================================================ */

// Scope vigente EN ESTE MOMENTO para el usuario/dispositivo actual. El turno
// SIEMPRE viene de currentShiftId() en vivo, nunca de un valor guardado en
// el dispositivo (ver §H del pedido — resolveOperationalScope() ya lo
// garantiza, esto solo junta los datos que necesita).
async function getCurrentOperationalScope() {
  const deviceAssignment = await getDeviceAssignment();
  const cuadrillas = await DB.allActive('cuadrillas');
  return resolveOperationalScope({
    currentUser: App.currentUser,
    deviceAssignment,
    cuadrillas,
    shiftId: currentShiftId()
  });
}

function todayDateISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Clave de ocurrencia (identidad de "este engrase pendiente hoy", ver
// computeOccurrenceKey en operational-scope.js) del trabajo de un equipo
// según su plan activo. null si el equipo no tiene plan configurado.
function equipoOccurrenceKey(equipo, plansByEquipoId) {
  const plan = plansByEquipoId[equipo.id];
  if (!plan) return null;
  return computeOccurrenceKey(plan, { dateISO: todayDateISO() });
}

async function loadAssignmentContext() {
  const [assignments, cuadrillas, plans] = await Promise.all([
    DB.allActive('lubrication_assignments'),
    DB.allActive('cuadrillas'),
    DB.allActive('lubrication_plans')
  ]);
  const plansByEquipoId = {};
  plans.forEach(p => { plansByEquipoId[p.equipmentId] = p; });
  return { assignments, cuadrillas, plansByEquipoId };
}

// Asigna manualmente el engrase PENDIENTE de `equipo` a `assignedCrewId`
// (responsabilidad temporal — NUNCA mueve el equipo de ubicación, ver
// moverEquipoDeUbicacion() más abajo para eso). Si ya había una asignación
// activa para esta misma ocurrencia, la reasigna en vez de duplicarla.
async function assignGreaseToCrew(equipo, assignedCrewId, notes) {
  const { assignments, cuadrillas, plansByEquipoId } = await loadAssignmentContext();
  const plan = plansByEquipoId[equipo.id];
  if (!plan) throw new Error('Este equipo no tiene un plan de engrase activo — no hay nada que asignar.');
  const occurrenceKey = equipoOccurrenceKey(equipo, plansByEquipoId);
  const existing = findActivePendingAssignment(assignments, occurrenceKey);
  const crew = cuadrillas.find(cq => cq.id === assignedCrewId);
  let saved;
  if (existing) {
    saved = reassignAssignment(existing, { newCrewId: assignedCrewId, now: nowISO() });
    await logAudit('GREASE_REASSIGNED', `${esc(equipo.code)} → ${esc(crew ? crew.name : assignedCrewId)}`, App.currentUser.name);
  } else {
    saved = createAssignment({
      existing, occurrenceKey, equipmentId: equipo.id, planId: plan.id,
      assignedCrewId, assignedByUserId: App.currentUser.id, assignedByUserName: App.currentUser.name,
      notes, now: nowISO(), uid
    });
    await logAudit('GREASE_ASSIGNED', `${esc(equipo.code)} → ${esc(crew ? crew.name : assignedCrewId)}`, App.currentUser.name);
  }
  await DB.put('lubrication_assignments', stamp(saved, App.currentUser.name));
  Sync.fullSync();
  return saved;
}

// Cancela una asignación PENDING: el equipo vuelve a su flujo normal (la
// cuadrilla default de su ubicación), sin borrar el historial de que existió.
async function cancelGreaseAssignment(assignment, equipo) {
  const cancelled = cancelAssignment(assignment, { now: nowISO() });
  await DB.put('lubrication_assignments', stamp(cancelled, App.currentUser.name));
  await logAudit('GREASE_ASSIGNMENT_CANCELLED', esc(equipo ? equipo.code : assignment.equipmentId), App.currentUser.name);
  Sync.fullSync();
  return cancelled;
}

// Se llama al guardar un registro de engrase, con la occurrenceKey calculada
// ANTES de que el plan se actualice (el horómetro base cambia al guardar, ver
// startGreaseFlow) — si esa ocurrencia tenía una asignación manual PENDING la
// cierra; si el equipo se engrasó dentro de su trabajo normal, no hace nada.
async function completeGreaseAssignmentForOccurrence(equipo, occurrenceKey, recordId) {
  if (!occurrenceKey) return null;
  const assignments = await DB.allActive('lubrication_assignments');
  const completed = completeAssignmentIfPending(assignments, { occurrenceKey, recordId, now: nowISO() });
  if (!completed) return null;
  await DB.put('lubrication_assignments', stamp(completed, App.currentUser.name));
  await logAudit('GREASE_ASSIGNMENT_COMPLETED', esc(equipo.code), App.currentUser.name);
  Sync.fullSync();
  return completed;
}

// Mueve PERMANENTEMENTE un equipo a otra ubicación (distinto de asignar un
// engrase puntual — ver §M del pedido). Solo ADMIN/PLANIFICADOR
// (canMoveEquipment, validado también en la UI que llama a esto).
async function moverEquipoDeUbicacion(equipo, newLocationId, locations) {
  const anterior = locations.find(l => l.id === equipo.locationId);
  const nueva = locations.find(l => l.id === newLocationId);
  equipo.locationId = newLocationId;
  await DB.put('equipment', stamp(equipo, App.currentUser.name));
  await logAudit('EQUIPMENT_LOCATION_CHANGED',
    `${esc(equipo.code)}: ${esc(anterior ? anterior.name : 'sin ubicación')} → ${esc(nueva ? nueva.name : newLocationId)}`,
    App.currentUser.name);
  Sync.fullSync();
}

// Snapshot del scope del DISPOSITIVO (cuadrilla/ubicación/turno asignado,
// ver getDeviceAssignment()) para copiarlo sobre la fila push_tokens de LA
// PERSONA. BUG REAL encontrado en este lote (auditoría de notify-vencidos/
// notify-push): esos Edge Functions ya filtran Lubricador por
// `disp.shiftId`/`disp.locationId`/`disp.cuadrillaId`, pero la fila que
// saveOneSignalId() escribía nunca tenía esos campos (solo existían en la
// fila APARTE del dispositivo, keyed por getDeviceId(), que jamás tiene un
// `token` real) — en la práctica ese filtro nunca hacía nada: TODOS los
// tokens de Lubricador recibían TODOS los avisos sin importar turno/zona/
// cuadrilla. Corregido copiando el scope del dispositivo aquí; se vuelve a
// llamar cada vez que cambia la suscripción Y cada vez que cambia la
// asignación del dispositivo (ver saveDeviceAssignment()) para que nunca
// quede desactualizado mientras la persona sigue conectada.
async function currentDeviceScopeSnapshotForPush() {
  const deviceAssignment = await getDeviceAssignment();
  if (!deviceAssignment.cuadrillaId) return { cuadrillaId: '', locationId: '', shiftId: deviceAssignment.shiftId || '' };
  const cuadrilla = await DB.get('cuadrillas', deviceAssignment.cuadrillaId).catch(() => null);
  return {
    cuadrillaId: deviceAssignment.cuadrillaId,
    locationId: cuadrilla?.locationId || '',
    shiftId: deviceAssignment.shiftId || ''
  };
}

async function saveOneSignalId(subscriptionId, plataforma) {
  try {
    // El id incluye la plataforma: así una misma persona puede recibir avisos en la app
    // del celular Y en el navegador de la computadora, sin que uno pise al otro.
    const plat = plataforma || (window.Capacitor ? 'android' : 'web');
    const id = `tok_${App.currentUser.id}_${plat}`;
    // notificationShift/notificationAvailability/receiveAllShifts (lote
    // arquitectura de notificaciones, §2/§29): preferencias PROPIAS de la
    // persona, nunca reseteadas por un simple cambio de subscription id —
    // se preservan si ya existían, con default BOTH/AVAILABLE/false solo
    // para una fila nueva.
    const actual = await DB.get('push_tokens', id).catch(() => null);
    const deviceScope = await currentDeviceScopeSnapshotForPush();
    await DB.put('push_tokens', stamp({
      ...(actual || {}),
      id, userId: App.currentUser.id, userName: App.currentUser.name,
      role: App.currentUser.role, token: subscriptionId, platform: plat, active: true,
      cuadrillaId: deviceScope.cuadrillaId, locationId: deviceScope.locationId, shiftId: deviceScope.shiftId,
      notificationShift: actual?.notificationShift || 'BOTH',
      notificationAvailability: actual?.notificationAvailability || 'AVAILABLE',
      receiveAllShifts: actual?.receiveAllShifts || false
    }, App.currentUser.name));
    Sync.fullSync();
  } catch (e) { console.warn('No se pudo guardar el ID de notificaciones push', e); }
}

// Refresca el scope de dispositivo (cuadrillaId/locationId/shiftId) sobre
// la fila push_tokens de QUIEN TENGA SESIÓN ABIERTA ahora mismo — se llama
// desde saveDeviceAssignment() (cambia la cuadrilla/turno del dispositivo
// mientras alguien sigue conectado en él) para que esa fila nunca quede
// desactualizada hasta la próxima vez que cambie la suscripción. Si la
// persona actual no tiene todavía un push_token (nunca activó push), no
// hace nada — no se inventa una fila sin un subscription id real.
async function refreshPushTokenDeviceScope() {
  if (!App.currentUser) return;
  try {
    const plat = window.Capacitor ? 'android' : 'web';
    const id = `tok_${App.currentUser.id}_${plat}`;
    const actual = await DB.get('push_tokens', id).catch(() => null);
    if (!actual || !actual.token) return;
    const deviceScope = await currentDeviceScopeSnapshotForPush();
    await DB.put('push_tokens', stamp({
      ...actual, cuadrillaId: deviceScope.cuadrillaId, locationId: deviceScope.locationId, shiftId: deviceScope.shiftId
    }, App.currentUser.name));
  } catch (e) { console.warn('No se pudo actualizar el scope de push del dispositivo', e); }
}

// Preferencias de notificación PROPIAS (lote arquitectura de
// notificaciones, §2/§21/§22/§29) — autoservicio: cada persona ajusta su
// turno de notificación/disponibilidad; receiveAllShifts solo tiene efecto
// real para ADMINISTRADOR (isUserEligibleForNotification() lo ignora para
// cualquier otro rol, pero se guarda igual si se manda — sin inventar una
// restricción de rol aquí, esa regla vive en notification-routing.js).
// Actualiza TODAS las filas push_tokens de la persona (puede tener una por
// plataforma: android Y web) — nunca solo la primera que encuentre.
async function applyNotificationPreferencesToRows(rows, { notificationShift, notificationAvailability, receiveAllShifts }, stampedBy) {
  for (const tok of rows) {
    await DB.put('push_tokens', stamp({
      ...tok,
      notificationShift: notificationShift || tok.notificationShift || 'BOTH',
      notificationAvailability: notificationAvailability || tok.notificationAvailability || 'AVAILABLE',
      receiveAllShifts: receiveAllShifts !== undefined ? !!receiveAllShifts : !!tok.receiveAllShifts
    }, stampedBy));
  }
  Sync.fullSync();
}

async function saveNotificationPreferences(prefs) {
  if (!App.currentUser) throw new Error('No hay sesión activa.');
  const propios = (await DB.allActive('push_tokens')).filter(t => t.userId === App.currentUser.id);
  if (!propios.length) throw new Error('Todavía no activaste las notificaciones push en este dispositivo — no hay nada que configurar.');
  await applyNotificationPreferencesToRows(propios, prefs, App.currentUser.name);
}

// Un ADMINISTRADOR ajusta las preferencias de OTRA persona (Configuración →
// Notificaciones push → "Editar" en la lista de dispositivos) — mismo
// mecanismo de escritura que el autoservicio de arriba, apuntando a las
// filas de la persona elegida en vez de App.currentUser. Nunca toca una
// fila de DISPOSITIVO (sin userId, ver saveDeviceAssignment()) — solo las
// filas de PERSONA del userId recibido.
async function saveNotificationPreferencesForUser(targetUserId, prefs) {
  if (!App.currentUser || App.currentUser.role !== 'ADMINISTRADOR') throw new Error('Solo un administrador puede editar las notificaciones de otra persona.');
  const ajenos = (await DB.allActive('push_tokens')).filter(t => t.userId === targetUserId);
  if (!ajenos.length) throw new Error('Esa persona todavía no activó las notificaciones push en ningún dispositivo.');
  await applyNotificationPreferencesToRows(ajenos, prefs, App.currentUser.name);
}

// Modal de edición — mismos 3 campos que el autoservicio "Mis
// notificaciones" (renderConfig()), prellenados con la primera fila activa
// de esa persona (misma convención que usa el propio autoservicio: las
// preferencias son iguales en todas sus plataformas).
async function openEditUserNotificationPrefsModal(targetUserId, targetUserName) {
  const suyos = (await DB.allActive('push_tokens')).filter(t => t.userId === targetUserId);
  const actual = suyos[0] || {};
  openModal(`Notificaciones de ${esc(targetUserName)}`, `
    <form id="edit-user-notif-form" class="form-grid">
      <label>Turno en el que recibe avisos
        <select name="notificationShift">
          <option value="BOTH" ${actual.notificationShift === 'BOTH' || !actual.notificationShift ? 'selected' : ''}>Ambos turnos</option>
          <option value="DAY" ${actual.notificationShift === 'DAY' ? 'selected' : ''}>Solo Turno Día</option>
          <option value="NIGHT" ${actual.notificationShift === 'NIGHT' ? 'selected' : ''}>Solo Turno Noche</option>
        </select>
      </label>
      <label>Disponibilidad
        <select name="notificationAvailability">
          <option value="AVAILABLE" ${actual.notificationAvailability !== 'RESTING' ? 'selected' : ''}>Disponible</option>
          <option value="RESTING" ${actual.notificationAvailability === 'RESTING' ? 'selected' : ''}>De descanso (no recibir avisos operativos)</option>
        </select>
      </label>
      <label class="retro-toggle span-2">
        <input type="checkbox" name="receiveAllShifts" ${actual.receiveAllShifts ? 'checked' : ''}/>
        <span>Recibir alertas de todos los turnos (ignora el filtro de turno para esta persona)</span>
      </label>
      <div class="modal-actions span-2">
        <button type="submit" class="btn btn-accent">Guardar</button>
      </div>
    </form>`);
  $('#edit-user-notif-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    try {
      await saveNotificationPreferencesForUser(targetUserId, {
        notificationShift: fd.notificationShift,
        notificationAvailability: fd.notificationAvailability,
        receiveAllShifts: fd.receiveAllShifts === 'on'
      });
      closeModal();
      showInAppToast(`✓ Notificaciones de ${targetUserName} guardadas`);
      renderConfig();
    } catch (e) { alert(e.message || 'No se pudo guardar.'); }
  });
}

// Contexto de elegibilidad de QUIEN tiene sesión en ESTE dispositivo ahora
// mismo (lote arquitectura de notificaciones, cierre §1/§9/§13) — objeto
// listo para isUserEligibleForNotification() (notification-routing.js).
// Nunca exige haber activado push: si la persona no tiene ninguna fila
// push_tokens todavía (nunca activó notificaciones push), se usan los
// defaults BOTH/AVAILABLE/false — NUNCA más restrictivo que el
// comportamiento de siempre (las notificaciones LOCALES no dependen de
// OneSignal). Si tiene varias filas (android+web), usa la primera — las
// preferencias son las MISMAS en todas (ver saveNotificationPreferences()).
async function currentUserEligibilityContext() {
  if (!App.currentUser) return null;
  const propios = (await DB.allActive('push_tokens')).filter(t => t.userId === App.currentUser.id);
  const prefs = propios[0] || {};
  return {
    active: true, role: App.currentUser.role,
    notificationShift: prefs.notificationShift || 'BOTH',
    notificationAvailability: prefs.notificationAvailability || 'AVAILABLE',
    receiveAllShifts: !!prefs.receiveAllShifts
  };
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

// BUG REAL corregido en este lote: buscaba la fila por `tok_${userId}`
// (sin la plataforma), pero saveOneSignalId() SIEMPRE la guarda como
// `tok_${userId}_${plataforma}` (android/web) — esa clave nunca existía,
// así que DB.get() nunca encontraba nada y ESTA función jamás desactivó un
// push_token real, en ningún logout, desde que se escribió. Corregido
// buscando por el campo `userId` (que sí existe en la fila) en vez de
// adivinar la clave — de paso, desactiva TODAS las plataformas de la
// persona (android Y web), no solo una.
async function disablePushForCurrentUser() {
  if (!App.currentUser) return;
  const userId = App.currentUser.id;
  const userName = App.currentUser.name;
  try {
    const propios = (await DB.allActive('push_tokens')).filter(t => t.userId === userId && t.active !== false);
    for (const tok of propios) {
      await DB.put('push_tokens', stamp({ ...tok, active: false }, userName));
    }
  } catch (e) {}
}

/* ============================================================
   IDENTIDAD ONESIGNAL (lote arquitectura de notificaciones, §9-§13) —
   ata la identidad de push al USUARIO Auth actual (App.currentUser.id,
   que en AUTH_MODE='supabase' es profile.appUserId), NUNCA al
   deviceId/cuadrillaId (esos siguen siendo del dispositivo, ver bloque de
   arriba — no se tocan aquí). Así, en un dispositivo compartido, la
   identidad de push SIEMPRE es la de quien tiene sesión iniciada, no la
   de quien lo usó por última vez. Sin efecto mientras ONESIGNAL_APP_ID
   esté vacío (feature apagada hoy) — mismo guard que el resto de este
   bloque, nunca lanza si OneSignal no está disponible.
   ============================================================ */
function oneSignalHandle() {
  return window.plugins?.OneSignal || window.OneSignal || null;
}

// Se llama SOLO al iniciar sesión con éxito (enterAppAsProfile()) — nunca
// antes de resolver identidad (§10: "No enviar push antes de resolver
// identidad" — aquí "enviar" es responsabilidad de la Edge Function/
// servidor, pero la identidad SIEMPRE se asocia antes de cualquier otra
// cosa que dependa de ella, como initPushNotifications()).
async function bindOneSignalIdentity(userId) {
  if (!ONESIGNAL_APP_ID || !userId) return;
  const OneSignal = oneSignalHandle();
  if (!OneSignal || typeof OneSignal.login !== 'function') return;
  try { await OneSignal.login(String(userId)); } catch (e) { console.warn('No se pudo asociar la identidad de OneSignal', e); }
}

// Se llama SOLO en Cerrar sesión real (logout(), AUTH_MODE='supabase') —
// NUNCA en Bloquear (lockApp() no la toca, la persona sigue siendo la
// misma, §12) ni en Cambiar usuario de forma directa (confirmChangeUser()
// ya delega en logout() para la salida; el login siguiente vuelve a
// asociar con bindOneSignalIdentity(), ver §11).
async function clearOneSignalIdentity() {
  if (!ONESIGNAL_APP_ID) return;
  const OneSignal = oneSignalHandle();
  if (!OneSignal || typeof OneSignal.logout !== 'function') return;
  try { await OneSignal.logout(); } catch (e) { console.warn('No se pudo retirar la identidad de OneSignal', e); }
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
  if (!LN) return;
  // Se cancelan todas primero, INCLUSO sin usuario válido (§15: al cambiar
  // de usuario/cerrar sesión, las notificaciones de la persona anterior
  // deben desaparecer de inmediato, no quedar "pegadas" hasta el próximo
  // login) — antes este cancel vivía DESPUÉS del guard de App.currentUser,
  // así que nunca corría en ese caso.
  await cancelAllLocalNotifications();
  if (!App.currentUser) return;
  try {
    const settings = mergeNotifSettings(await DB.get('settings', 'notifications'));
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

    // Migración al routing central (lote arquitectura de notificaciones,
    // cierre §8/§9 del pedido de cierre): cada tipo programado de abajo ya
    // NO decide solo por rol (`cfg.roles.includes(rol)`) — pasa por
    // isUserEligibleForNotification() (notification-routing.js), la MISMA
    // regla que usan los Edge Functions para push remoto. Disponibilidad
    // RESTING o turno de notificación incompatible apagan CUALQUIER tipo
    // programado de esta función, sin excepción por tipo.
    const personaElegible = await currentUserEligibilityContext();
    const turnoReal = currentShiftId();
    const elegiblePara = (cfg) => isUserEligibleForNotification({
      user: personaElegible, rolesPermitidos: cfg.roles, currentShiftId: turnoReal
    });

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
    if (cfgV.enabled && elegiblePara(cfgV) && (!cfgV.soloSiHay || vencidos.length)) {
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
    if (cfgP.enabled && elegiblePara(cfgP) && (!cfgP.soloSiHay || porEngrasar.length)) {
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
    if (cfgC.enabled && elegiblePara(cfgC)) {
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
    if (cfgS && cfgS.enabled && elegiblePara(cfgS)) {
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

    // ── 5) Asignaciones manuales PENDIENTES para la cuadrilla de este
    // dispositivo (§2 del cierre de lote — ver docs/OPERATIONAL_SCOPE.md) ──
    // Todo el ciclo de vida (crear/reasignar/cancelar/completar) se resuelve
    // SOLO recalculando desde cero cada vez que esta función corre, sin
    // rastrear estado propio: arriba se cancelan TODAS las notificaciones
    // conocidas (incluidas estas dos IDs) antes de reprogramar, así que una
    // asignación que dejó de estar PENDING para la cuadrilla de este
    // dispositivo (completada, cancelada, o reasignada a otra cuadrilla)
    // simplemente deja de calificar aquí y no se reprograma — nunca hace
    // falta "cancelarla" a mano. Mismo patrón agrupado que vencidos/
    // porEngrasar arriba (una notificación por tipo, nunca una por fila).
    // Migrado al routing central (cierre §3): RESTING sigue apagando este
    // aviso aunque sea Lubricador con asignación real — sin `rolesPermitidos`
    // porque el rol ya está fijo (LUBRICADOR) en el `if` de abajo.
    if (rol === 'LUBRICADOR' && isUserEligibleForNotification({ user: personaElegible, currentShiftId: turnoReal })) {
      const scopeNotif = await getCurrentOperationalScope();
      if (scopeNotif.kind === 'DEVICE_SCOPED') {
        // Mismo criterio EXACTO que "ASIGNADOS A MI CUADRILLA" en Mi Turno
        // (renderLubricadorHome) — reutiliza classifyEquipmentWork() en vez
        // de repetir el filtro PENDING+assignedCrewId por separado.
        const { assignments, cuadrillas, plansByEquipoId } = await loadAssignmentContext();
        const { assigned: misAsignaciones } = classifyEquipmentWork({
          scope: scopeNotif, equipos, cuadrillas, assignments,
          equipoOccurrenceKeyFn: (e) => equipoOccurrenceKey(e, plansByEquipoId)
        });
        if (misAsignaciones.length) {
          const equiposAsignados = misAsignaciones
            .map(a => equipos.find(e => e.id === a.equipmentId))
            .filter(Boolean);
          const listaAsig = equiposAsignados.slice(0, 5).map(e => e.code).join(', ');
          const tituloAsig = `🟣 ${misAsignaciones.length} engrase(s) asignado(s) a tu cuadrilla`;
          const cuerpoAsig = `${listaAsig}${equiposAsignados.length > 5 ? ` y ${equiposAsignados.length - 5} más` : ''}. Fuera de tu ubicación normal.`;
          const extraAsig = {
            tipo: 'asignacion',
            equipoId: equiposAsignados.length === 1 ? equiposAsignados[0].id : '',
            ruta: 'turno'
          };
          // Aviso inicial: casi inmediato (esto corre cuando llegó la
          // asignación por sync o al abrir la app — no es un aviso diario a
          // hora fija como vencidos/porEngrasar).
          notifications.push({
            id: NOTIF_ID_ASSIGNED, title: tituloAsig, body: cuerpoAsig,
            extra: extraAsig, schedule: { at: new Date(Date.now() + 3000) }
          });
          registrarAvisoEnviado('asignacion', tituloAsig, cuerpoAsig, rol);
          // Recordatorio: si sigue pendiente 2 horas después de la última vez
          // que se recalculó (sync/apertura de app), vuelve a sonar. Al
          // recalcularse de nuevo con la asignación todavía activa, el
          // recordatorio simplemente se reprograma más adelante (nunca se
          // acumulan varios).
          notifications.push({
            id: NOTIF_ID_ASSIGNED_REC,
            title: `🟣 Recordatorio: ${misAsignaciones.length} engrase(s) asignado(s) siguen pendientes`,
            body: listaAsig,
            extra: extraAsig,
            schedule: { at: new Date(Date.now() + 2 * 60 * 60 * 1000) }
          });
        }
      }
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
    // §27/§6 (cierre): un engrase FUERA DE PLAN completado nunca dispara
    // este aviso — mismo criterio ya aplicado al push remoto real
    // (supabase/functions/notify-push, shouldNotifyOutOfPlanCompletion()).
    if (!shouldNotifyOutOfPlanCompletion() && record.operationalSnapshot?.executionType === 'OUT_OF_PLAN') return;

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
// El media query CSS prefers-reduced-motion (styles.css) ya apaga toda
// transición/animación DECLARADA EN CSS, pero Chart.js anima sus gráficos
// (Reportes → Tendencia/Consumo) dibujando directo en <canvas>, fuera del
// alcance de CSS — necesita apagarse desde JS.
function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
/* fmt() se movió a src/core/lubrication-status.js (sigue disponible como
   global, ver docs/MODULARIZATION.md). */
const fmtDate = (iso) => new Date(iso).toLocaleString('es-NI', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Mejora: intervalo de auto-sync configurable por el Administrador desde
// Configuración → Sincronización. Opciones FIJAS (nunca texto libre, nunca
// menor a 30s) — cualquier otro valor (sin configurar, corrupto, de una
// versión futura con más opciones) cae al default. Vive en el mismo
// documento `settings/general` que ya sincroniza entre TODOS los
// dispositivos (nunca solo en app_config, que es local a este teléfono) —
// no requiere store nuevo ni subir DB_VERSION.
const SYNC_INTERVAL_OPTIONS = [30, 60, 120, 300, 600];
const SYNC_INTERVAL_DEFAULT = 120;
function normalizeSyncInterval(value) {
  return SYNC_INTERVAL_OPTIONS.includes(value) ? value : SYNC_INTERVAL_DEFAULT;
}
function syncIntervalLabel(seconds) {
  if (seconds < 60) return `Cada ${seconds} segundos`;
  const mins = seconds / 60;
  return `Cada ${mins} minuto${mins === 1 ? '' : 's'}`;
}

// Configuración general editable por el Administrador (horarios de turno, umbrales, etc.)
// Se carga en memoria al arrancar y se puede recargar cuando el admin la cambia.
App.generalSettings = { shiftDayStart: 6, shiftNightStart: 18, defaultAlertYellowHours: 10, complianceTarget: 95, syncIntervalSeconds: SYNC_INTERVAL_DEFAULT };

async function loadGeneralSettings() {
  const s = await DB.get('settings', 'general');
  if (s) Object.assign(App.generalSettings, s);
  // Normaliza SIEMPRE, incluso si `s` no traía el campo (documento viejo,
  // nunca configurado) o traía un valor fuera de las opciones válidas.
  App.generalSettings.syncIntervalSeconds = normalizeSyncInterval(App.generalSettings.syncIntervalSeconds);
}

/* currentShiftId() se movió a src/core/shifts.js (sigue disponible como
   global, ver docs/MODULARIZATION.md). */

/* WEEKDAY_NAMES, mostRecentAssignedDate(), weekdayStatusFor() y statusFor()
   se movieron a src/core/lubrication-status.js (siguen disponibles como
   globales, ver docs/MODULARIZATION.md). */
const SCHEDULE_WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// Calcula el estado de una lista de equipos leyendo planes/registros UNA sola vez,
// en vez de una vez por cada equipo (antes: N equipos = N consultas completas a la BD).
async function computeAllStatuses(equipos) {
  const [plans, records] = await Promise.all([
    DB.allActive('lubrication_plans'),
    DB.allActive('lubrication_records')
  ]);
  return Promise.all(equipos.map(async e => ({ e, s: await statusFor(e, plans, records) })));
}

/* Color por criticidad de anomalía. Está aquí arriba (no dentro de una función) porque
   lo usan tanto la pantalla de Anomalías como la ficha del equipo. */
const CRIT_COLOR = { Baja: 'var(--gray-status)', Media: 'var(--amber)', Alta: 'var(--red)', 'Crítica': '#ff2d2d' };

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

// Instalación nueva (sin preferencia guardada todavía) arranca en modo CLARO.
// Si el usuario ya guardó una preferencia (JSON.parse(...) no vacío), esa
// gana siempre — Object.assign la sobrescribe sobre este valor por defecto.
function getTheme() {
  try { return Object.assign({ accent: 'amber', mode: 'light' }, JSON.parse(localStorage.getItem('engrase_theme')) || {}); }
  catch { return { accent: 'amber', mode: 'light' }; }
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
  Sync.startAuto(App.generalSettings.syncIntervalSeconds);
  updateConnBadge();

  // AUTH_MODE='supabase': flujo de login/PIN completamente separado (ver
  // renderAuthGateSupabase() más abajo) — nunca toca sessionStorage
  // 'engrase_user' (eso es exclusivamente del login PIN legacy). Con
  // AUTH_MODE='legacy' (default) este branch nunca se toma.
  if (typeof Auth !== 'undefined' && Auth.isSupabaseMode()) {
    renderAuthGateSupabase();
  } else {
    const saved = sessionStorage.getItem('engrase_user');
    if (saved) {
      App.currentUser = JSON.parse(saved);
      boot();
    } else {
      renderLogin();
    }
  }
});

let lastSyncState = { status: 'idle' };
/* Redibuja la pantalla actual sin importar si es la interfaz de escritorio o la del
   lubricador. Antes se llamaba a navigate(), que da por hecho el menú lateral y la
   barra superior — en la pantalla del lubricador esos elementos no existen y fallaba
   antes de redibujar, así que sus datos se quedaban viejos. */
function redibujarPantallaActual() {
  try {
    const esLubricador = !!document.querySelector('.lub-shell');
    if (esLubricador) {
      const pintar = { anomalias: renderAnomalias, historial: renderLubricadorHistorial, turno: renderLubricadorHome };
      const fn = pintar[App.route] || renderLubricadorHome;
      fn();
    } else {
      navigate(App.route);
    }
  } catch (e) { console.warn('No se pudo redibujar tras sincronizar', e); }
}

/* ---------- Buscador rápido de la barra superior ----------
   Escribes un código (completo o parte) desde cualquier pantalla y saltas directo a
   ese equipo, sin tener que ir a Equipos y filtrar. Busca por código, código corto,
   marca y modelo. */
function wireQuickFind() {
  const input = $('#quick-find');
  const caja = $('#quick-find-results');
  if (!input || !caja || input.dataset.wired) return;
  input.dataset.wired = '1';

  // En pantallas angostas el buscador arranca colapsado en solo el ícono
  // (ver .quick-find-toggle en styles.css); tocarlo enfoca el input, que se
  // expande solo por CSS (:focus-within), sin más estado que mantener.
  const toggle = $('#quick-find-toggle');
  if (toggle) toggle.addEventListener('click', () => input.focus());

  let resultados = [];
  let seleccion = -1;

  async function buscar() {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { caja.classList.add('hidden'); caja.innerHTML = ''; return; }
    const equipos = await DB.allActive('equipment');
    resultados = equipos.filter(e =>
      (e.code || '').toLowerCase().includes(q) ||
      (e.shortCode || '').toLowerCase().includes(q) ||
      `${e.brand} ${e.model}`.toLowerCase().includes(q)
    ).slice(0, 8);
    seleccion = -1;

    if (!resultados.length) {
      caja.innerHTML = '<div class="qf-vacio">Ningún equipo coincide</div>';
      caja.classList.remove('hidden');
      return;
    }
    const statuses = await computeAllStatuses(resultados);
    caja.innerHTML = resultados.map((e, i) => {
      const st = statuses.find(x => x.e.id === e.id);
      return `<button type="button" class="qf-item" data-i="${i}">
        <span class="dot" style="background:${st ? STATUS_COLOR[st.s.code] : 'var(--border)'}"></span>
        <span class="mono"><b>${esc(e.code)}</b>${e.shortCode ? ' · ' + esc(e.shortCode) : ''}</span>
        <span class="dim">${esc(e.brand)} ${esc(e.model)}</span>
      </button>`;
    }).join('');
    caja.classList.remove('hidden');
    $$('.qf-item', caja).forEach(b => b.addEventListener('click', () => abrir(resultados[+b.dataset.i])));
  }

  function abrir(eq) {
    if (!eq) return;
    input.value = '';
    caja.classList.add('hidden');
    caja.innerHTML = '';
    openEquipmentDetail(eq.id);
  }

  let temporizador;
  input.addEventListener('input', () => { clearTimeout(temporizador); temporizador = setTimeout(buscar, 180); });

  // Flechas y Enter, para no tener que soltar el teclado
  input.addEventListener('keydown', (ev) => {
    const items = $$('.qf-item', caja);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!items.length) return;
      seleccion = ev.key === 'ArrowDown'
        ? (seleccion + 1) % items.length
        : (seleccion - 1 + items.length) % items.length;
      items.forEach((b, i) => b.classList.toggle('qf-activo', i === seleccion));
      items[seleccion].scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      abrir(resultados[seleccion >= 0 ? seleccion : 0]);
    } else if (ev.key === 'Escape') {
      input.value = ''; caja.classList.add('hidden');
    }
  });

  // Al tocar fuera, se cierra la lista
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('.quick-find')) caja.classList.add('hidden');
  });
}

function onSyncStateChange(state) {
  lastSyncState = state;
  updateConnBadge();
  // Si llegaron datos nuevos del servidor, se redibuja la pantalla actual para que la
  // persona vea el cambio sin tener que salir y volver a entrar. Antes solo se refrescaban
  // tres pantallas, así que una anomalía borrada por el admin seguía visible en la lista
  // del lubricador hasta que él cambiaba de pantalla a mano.
  const pantallasQueSeRefrescan = ['turno', 'dashboard', 'equipos', 'anomalias', 'historial', 'matriz', 'plan', 'horometros'];
  if (state.status === 'ok' && state.pulled > 0 && pantallasQueSeRefrescan.includes(App.route)) {
    // No se redibuja si hay una ventana abierta: le borraría lo que está escribiendo.
    // BUG-CRÍTICO (doble guardado en Registrar Engrase): el flujo de Finalizar Engrase
    // del Lubricador (startLubricadorGreaseFlow/startGreaseFlow) NO cambia App.route —
    // se queda en 'turno' mientras el formulario está abierto Y mientras se muestra la
    // pantalla "Validar ahora/después" (y la validación, si aplica) tras guardar. 'turno'
    // SÍ está en la lista de arriba, así que un sync automático (cada 20s, al reconectar,
    // al volver a la app) que trajera CUALQUIER cambio de CUALQUIER parte del sistema
    // hacía redibujarPantallaActual() → renderLubricadorHome(), reemplazando #app-content
    // entero — el formulario en curso o la confirmación recién guardada desaparecían sin
    // aviso (el usuario veía "Mi Turno" en vez de su confirmación y, pensando que no se
    // guardó, repetía la operación → 2 lubrication_record). El guardado en sí YA era
    // correcto/idempotente (enviandoEngrase); el problema era que la UI se borraba antes
    // de que la persona la viera.
    //
    // Fuente PRINCIPAL: App.lubricadorGreaseFlowActive, un estado explícito (no inferido
    // de selectores DOM) que startLubricadorGreaseFlow() enciende al entrar y solo se
    // apaga al terminar de verdad (Mis Engrases) o al cancelar ("← Volver a mi turno") —
    // sigue true durante formulario, guardado, "Validar ahora/después" y el modal de
    // validación. El guard DOM anterior se conserva como defensa secundaria (por si algún
    // camino nuevo olvida tocar el flag), no como fuente principal.
    if (!App.lubricadorGreaseFlowActive &&
        !document.querySelector('#modal-overlay.open') && !document.querySelector('#grease-form') && !document.querySelector('.grease-validate-choice')) {
      redibujarPantallaActual();
    }
  }
  if (state.status === 'ok' && state.newAnomalies && state.newAnomalies.length) {
    notifyNewAnomalies(state.newAnomalies);
  }
  // Recalcula avisos locales (incluida una asignación manual nueva/cancelada/
  // reasignada llegada por sync, §2 del cierre de lote) SOLO cuando de verdad
  // llegó algo nuevo — nunca en cada tick del timer sin cambios, para no
  // convertir esto en un polling adicional (ya reutiliza el mismo ciclo de
  // sync existente, con su propio intervalo configurable).
  if (state.status === 'ok' && state.pulled > 0) {
    refreshLocalNotifications();
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
  // Migrado al routing central (lote arquitectura de notificaciones, cierre
  // §7): antes esta función avisaba de CUALQUIER severidad (solo cambiaba
  // el texto entre "crítica"/genérico) — nunca correspondía con §28
  // (Media/Baja van a resumen/pantalla normal, nunca push/local
  // individual). Se calcula UNA vez, no por anomalía: la disponibilidad/
  // turno de la persona no cambia entre una anomalía y la siguiente del
  // mismo lote.
  const personaElegibleAnom = isRelevantRole ? await currentUserEligibilityContext() : null;
  const elegibleAhoraAnom = isRelevantRole && isUserEligibleForNotification({
    user: personaElegibleAnom, rolesPermitidos: relevantRoles, currentShiftId: currentShiftId()
  });

  for (const a of anomalies) {
    if (seen.has(a.id)) continue;
    markAnomalyNotified(a.id);
    if (a.createdBy === App.currentUser.name) continue; // no avisarle a quien la reportó
    if (!elegibleAhoraAnom) continue; // rol no relevante, RESTING, o turno de notificación incompatible
    // §28: solo Crítica/Alta son un aviso individual inmediato — Media/Baja
    // quedan para la pantalla de Anomalías/Dashboard, nunca un push/local
    // aparte (evita saturar con anomalías menores).
    if (routeAnomalyEvent(a.criticality) === 'SUMMARY') continue;

    const eq = equipos.find(e => e.id === a.equipmentId);
    const title = a.criticality === 'Crítica' ? '⚠ Anomalía crítica reportada' : '⚠ Anomalía de alta prioridad reportada';
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
  } else if (lastSyncState.status === 'offline') {
    // navigator.onLine ya dio false ANTES de llegar aquí (mismo caso que el
    // chequeo de arriba) — se cubre igual por si algo más adelante llega a
    // notificar este status directamente.
    b.textContent = 'SIN INTERNET · GUARDANDO LOCAL';
    b.className = 'conn-badge conn-off';
  } else if (lastSyncState.status === 'backend_unreachable') {
    // Distinto de "SIN INTERNET": el dispositivo SÍ cree tener conexión
    // (navigator.onLine=true) pero el servidor no respondió a tiempo — ver
    // Bloque B (conectividad real), hallazgo real del piloto Android.
    // Nunca se confunde con "SINCRONIZADO"; el trabajo local sigue intacto.
    b.textContent = 'SIN CONEXIÓN CON EL SERVIDOR';
    b.className = 'conn-badge conn-off';
    b.title = 'No se pudo contactar al servidor a tiempo. Tus cambios siguen guardados en este dispositivo — se reintenta solo en la próxima sincronización.';
  } else if (lastSyncState.status === 'error') {
    b.textContent = 'ERROR DE SINCRONIZACIÓN';
    b.className = 'conn-badge conn-off';
    b.title = lastSyncState.message || '';
  } else if (lastSyncState.status === 'partial') {
    b.textContent = `SINCRONIZADO PARCIAL (${lastSyncState.errors.length} con error)`;
    b.className = 'conn-badge conn-warn';
    b.title = 'Falló: ' + lastSyncState.errors.join(', ') + ' — se reintenta solo en la próxima sincronización.';
  } else if (lastSyncState.status === 'AUTH_REQUIRED' || lastSyncState.status === 'AUTH_FORBIDDEN') {
    // Solo posible en AUTH_MODE='supabase' (inerte en 'legacy', ver
    // sync.js) — nunca debe leerse como "SINCRONIZADO" solo porque
    // navigator.onLine es true.
    b.textContent = lastSyncState.status === 'AUTH_REQUIRED' ? 'SESIÓN REQUERIDA' : 'SIN PERMISO PARA SINCRONIZAR';
    b.className = 'conn-badge conn-off';
  } else if (lastSyncState.status === 'ok') {
    b.textContent = 'SINCRONIZADO';
    b.className = 'conn-badge conn-ok';
  } else {
    // Estado inicial (nunca se ha sincronizado todavía en esta sesión) —
    // antes cualquier status desconocido caía aquí y decía "SINCRONIZADO"
    // sin haber sincronizado nunca; ahora los status reales de arriba están
    // todos cubiertos explícitamente y este es solo el arranque en frío.
    b.textContent = 'SINCRONIZANDO…';
    b.className = 'conn-badge conn-warn';
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

// Modal de confirmación de "Cerrar sesión" (pre-cutover, ver
// docs/SESSION_HANDOFF.md) — antes disparaba logout() directo desde el
// click, sin ningún alert()/confirm() nativo ni modal propio. Nunca
// destructivo por accidente: un solo toque en el botón del sidebar ya no
// cierra la sesión de inmediato.
function confirmLogout() {
  openModal('¿Cerrar sesión en este dispositivo?', `
    <p>Después tendrás que ingresar nuevamente tu usuario y contraseña.</p>
    <p class="dim">El acceso rápido mediante PIN de esta sesión se eliminará.</p>
    <div class="modal-actions">
      <button type="button" class="btn" id="confirm-logout-cancel">Cancelar</button>
      <button type="button" class="btn btn-danger" id="confirm-logout-confirm">Cerrar sesión</button>
    </div>
  `);
  $('#confirm-logout-cancel').addEventListener('click', closeModal);
  $('#confirm-logout-confirm').addEventListener('click', () => { closeModal(); logout(); });
}

// "Cambiar usuario" — distinto de Bloquear (mantiene todo intacto) y de
// Cerrar sesión (mismo texto que esa acción para quien lo lee, pero pensado
// para el flujo "otra persona va a usar este teléfono ahora", no para dejar
// de trabajar). Arquitectura de una sola sesión Auth activa por dispositivo
// (ver docs/SESSION_HANDOFF.md, "auditar arquitectura antes de PIN
// multiusuario" — NO se implementó un almacén de varios refresh_tokens en
// este lote): en la práctica es la MISMA operación de fondo que Cerrar
// sesión (Auth.signOut() + borrar el PIN de este dispositivo), la próxima
// persona entra con SU usuario/contraseña y configura SU propio PIN — nunca
// pisa el PIN de la persona anterior hasta que de verdad haga login.
// `App.currentUser` puede venir null (se llama también desde el propio
// gate/login, no solo desde dentro de la app).
function confirmChangeUser() {
  if (typeof Auth === 'undefined' || !Auth.isSupabaseMode()) return;
  const nombreActual = App.currentUser ? esc(App.currentUser.name) : 'este usuario';
  openModal('Cambiar de usuario', `
    <p>Vas a salir de la sesión de <b>${nombreActual}</b> en este dispositivo para que otra persona entre con su propio usuario y contraseña.</p>
    <p class="dim">El PIN configurado aquí se reemplaza por el de la persona nueva cuando lo configure — la cuadrilla/ubicación de este dispositivo NO cambia.</p>
    <div class="modal-actions">
      <button type="button" class="btn" id="confirm-change-user-cancel">Cancelar</button>
      <button type="button" class="btn btn-accent" id="confirm-change-user-confirm">Cambiar usuario</button>
    </div>
  `);
  $('#confirm-change-user-cancel').addEventListener('click', closeModal);
  $('#confirm-change-user-confirm').addEventListener('click', () => { closeModal(); logout(); });
}

function logout() {
  clearAppBadge();
  disablePushForCurrentUser();
  // Retira la identidad de OneSignal de ESTA persona (lote arquitectura de
  // notificaciones, §13) — solo tiene sentido en modo supabase (identidad
  // Auth real); el login PIN legacy nunca asoció una. NUNCA se llama desde
  // lockApp() (§12: bloquear conserva la identidad, sigue siendo la misma
  // persona) ni cambia nada del deviceId/cuadrillaId del dispositivo.
  if (typeof Auth !== 'undefined' && Auth.isSupabaseMode()) clearOneSignalIdentity();
  // Cancela de inmediato las notificaciones locales de la persona que se
  // va (§15) — sin esto, quedarían programadas hasta que alguien más
  // inicie sesión y refreshLocalNotifications() las recalcule.
  cancelAllLocalNotifications();
  stopInactivityTimer();
  App.currentUser = null;
  App.lubricadorGreaseFlowActive = false; // salida explícita — no debe sobrevivir a la sesión siguiente
  // AUTH_MODE='supabase': CERRAR SESIÓN real — distinto de "Bloquear"
  // (lockApp() más abajo). Borra auth_tokens + profile snapshot + PIN
  // rápido configurado (P0-2): la próxima vez exige Usuario + Contraseña
  // de nuevo, nunca queda un PIN "huérfano" de una sesión ya cerrada.
  // NUNCA toca IndexedDB operativo (engrases pendientes, anomalías,
  // catálogos siguen intactos — ver docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §25).
  if (typeof Auth !== 'undefined' && Auth.isSupabaseMode()) {
    Auth.signOut().then(() => QuickUnlock.disable()).then(() => renderAuthGateSupabase());
    return;
  }
  sessionStorage.removeItem('engrase_user');
  renderLogin();
}

// "Bloquear" — a propósito NUNCA llama a Auth.signOut() ni
// QuickUnlock.disable(): la sesión Auth y el PIN configurado siguen
// intactos, listos para desbloquear de nuevo (ver renderAuthGateSupabase(),
// que se llama exactamente igual al arrancar la app y al bloquear — nunca
// reingresa en silencio). Solo existe en AUTH_MODE='supabase' — el login
// PIN legacy no distingue "bloquear" de "cerrar sesión".
function lockApp() {
  if (typeof Auth === 'undefined' || !Auth.isSupabaseMode()) return;
  clearAppBadge();
  stopInactivityTimer();
  App.currentUser = null;
  App.lubricadorGreaseFlowActive = false;
  renderAuthGateSupabase();
}

/* ============================================================
   LOGIN / DESBLOQUEO — AUTH_MODE='supabase' (P0-2). Módulo de pantallas
   separado del login PIN legacy de arriba — mientras AUTH_MODE sea
   'legacy' (default), nada de esto se ejecuta (ver el branch del listener
   de DOMContentLoaded). La identidad real SIEMPRE viene de Auth (Supabase
   Auth + app_profiles, ver src/core/auth.js) — este bloque solo decide qué
   pantalla mostrar y traduce Auth.getProfile()/el snapshot al shape
   mínimo que ya usa el resto de app.js.
   ============================================================ */

// Mismo patrón que doLogin() (legacy) al armar App.currentUser — sin
// inventar campos que Auth/app_profiles no tiene (shiftId/cuadrillaId/
// locationId: fuera de alcance de P0-2, las personas Auth reales no están
// ligadas al store "users" legacy, ver docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §17).
function currentUserFromAuthProfile(profile) {
  return { id: profile.appUserId, name: profile.displayName, role: profile.role, username: profile.appUserId };
}

function enterAppAsProfile(profile) {
  App.currentUser = currentUserFromAuthProfile(profile);
  bindOneSignalIdentity(profile.appUserId); // no await: nunca bloquea boot()
  boot();
}

// Punto de entrada único para AUTH_MODE='supabase': se llama al arrancar Y
// cada vez que se bloquea (lockApp()) — SIEMPRE vuelve a pedir PIN o
// contraseña, nunca reingresa en silencio (ese es el punto del "quick
// unlock": nunca queda una sesión abierta indefinidamente en pantalla,
// aunque el token siga vigente). Auth.restoreSession() ya refresca/valida
// la sesión real en segundo plano; sync.js decide aparte, con su propio
// gate (sin cambios de esta tarea), si eso alcanza para sincronizar — esta
// pantalla NUNCA decide sync, solo qué pantalla mostrar.
async function renderAuthGateSupabase() {
  await Auth.restoreSession();
  const snapshot = await DB.getAuthProfileSnapshot();
  if (snapshot && isValidProfile(snapshot)) {
    const configured = await QuickUnlock.isConfigured(snapshot.appUserId);
    if (configured) return renderQuickUnlockScreen(snapshot);
  }
  return renderSupabaseLoginForm();
}

function renderSupabaseLoginForm() {
  const online = navigator.onLine;
  document.body.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="brand"><div class="brand-mark"></div><div><div class="brand-title">ENGRASE</div><div class="brand-sub">OPEN PIT</div></div></div>
        ${!online ? '<p class="login-hint">Sin conexión — se necesita Internet para iniciar sesión la primera vez. Si ya configuraste un PIN rápido antes, vuelve a intentarlo con señal.</p>' : ''}
        <form id="supabase-login-form" class="form-grid">
          <label>Usuario<input required name="username" autocomplete="username" ${online ? '' : 'disabled'}/></label>
          <label>Contraseña<input required type="password" name="password" autocomplete="current-password" ${online ? '' : 'disabled'}/></label>
          <div id="supabase-login-error" class="login-error"></div>
          <button type="submit" class="btn btn-accent" ${online ? '' : 'disabled'}>Entrar</button>
        </form>
      </div>
    </div>`;
  $('#supabase-login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    $('#supabase-login-error').textContent = '';
    try {
      const { user: profile } = await Auth.signIn(fd.username, fd.password);
      const configured = await QuickUnlock.isConfigured(profile.appUserId);
      if (!configured) return offerQuickUnlockSetup(profile);
      enterAppAsProfile(profile);
    } catch (e) {
      $('#supabase-login-error').textContent = e.message || 'No se pudo iniciar sesión.';
    }
  });
}

function renderQuickUnlockScreen(snapshot) {
  document.body.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="brand"><div class="brand-mark"></div><div><div class="brand-title">ENGRASE</div><div class="brand-sub">OPEN PIT</div></div></div>
        <p class="login-hint">${esc(snapshot.displayName)}</p>
        <div id="quick-unlock-area" class="form-grid">
          <input id="quick-unlock-pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="PIN" maxlength="6"/>
          <button type="button" id="quick-unlock-submit" class="btn btn-accent">Entrar</button>
        </div>
        <div id="quick-unlock-error" class="login-error"></div>
        <button type="button" id="quick-unlock-use-password" class="btn">Usar contraseña</button>
      </div>
    </div>`;

  $('#quick-unlock-use-password').addEventListener('click', () => renderSupabaseLoginForm());

  const doUnlock = async () => {
    const pin = $('#quick-unlock-pin').value.trim();
    const res = await QuickUnlock.attemptUnlock(snapshot.appUserId, pin);
    if (res.ok) { enterAppAsProfile(snapshot); return; }
    if (res.reason === 'LOCKED') {
      const mins = Math.ceil(res.remainingMs / 60000);
      $('#quick-unlock-error').textContent = `Demasiados intentos fallidos. Intenta de nuevo en ${mins} minuto(s).`;
    } else {
      $('#quick-unlock-error').textContent = res.attemptsLeft != null
        ? `PIN incorrecto. Te quedan ${res.attemptsLeft} intento(s).`
        : 'PIN incorrecto.';
    }
    $('#quick-unlock-pin').value = '';
    $('#quick-unlock-pin').focus();
  };
  $('#quick-unlock-submit').addEventListener('click', doUnlock);
  $('#quick-unlock-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') doUnlock(); });

  // Si ya estaba bloqueado desde antes (recarga de página durante el
  // bloqueo), avisar de una vez en vez de esperar el primer intento.
  QuickUnlock.isLockedOut(snapshot.appUserId).then(async (locked) => {
    if (!locked) return;
    const remainingMs = await QuickUnlock.getLockRemainingMs(snapshot.appUserId);
    const mins = Math.ceil(remainingMs / 60000);
    $('#quick-unlock-error').textContent = `Demasiados intentos fallidos. Intenta de nuevo en ${mins} minuto(s).`;
  });
}

// Se ofrece UNA vez, justo después de un login real exitoso (online,
// perfil activo) — nunca antes (ver principio de seguridad en
// src/core/quick-unlock.js). "Ahora no" entra normalmente sin configurar
// nada; puede configurarse/cambiarse/desactivarse después desde
// Configuración (ver renderConfig()).
function offerQuickUnlockSetup(profile) {
  document.body.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="brand"><div class="brand-mark"></div><div><div class="brand-title">ENGRASE</div><div class="brand-sub">OPEN PIT</div></div></div>
        <p class="login-hint">¿Configurar un PIN rápido (4 o 6 dígitos) para entrar sin escribir tu contraseña cada vez, incluso sin Internet?</p>
        <form id="quick-unlock-setup-form" class="form-grid">
          <label>PIN<input required name="pin" inputmode="numeric" pattern="\\d{4}|\\d{6}" autocomplete="off" maxlength="6"/></label>
          <div id="quick-unlock-setup-error" class="login-error"></div>
          <button type="submit" class="btn btn-accent">Configurar PIN</button>
        </form>
        <button type="button" id="quick-unlock-setup-skip" class="btn">Ahora no</button>
      </div>
    </div>`;
  $('#quick-unlock-setup-skip').addEventListener('click', () => enterAppAsProfile(profile));
  $('#quick-unlock-setup-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    try {
      await QuickUnlock.configure(profile.appUserId, fd.pin);
      enterAppAsProfile(profile);
    } catch (e) {
      $('#quick-unlock-setup-error').textContent = e.message;
    }
  });
}

// Configurar/Cambiar desde Configuración (ver renderConfig()) — ya dentro
// de la app, con sesión activa confirmada por Auth.isAuthenticated()
// (nunca se ofrece esto sin eso, ver quickUnlockAvailable en renderConfig()).
// changePin() reutiliza exactamente las mismas reglas de configure()
// (formato, PIN trivial) — nunca duplica esa validación.
function quickUnlockConfigureModal(mode) {
  openModal(mode === 'change' ? 'Cambiar PIN rápido' : 'Configurar PIN rápido', `
    <form id="quick-unlock-modal-form" class="form-grid">
      <label>PIN (4 o 6 dígitos)<input required name="pin" inputmode="numeric" pattern="\\d{4}|\\d{6}" autocomplete="off" maxlength="6"/></label>
      <div class="modal-actions"><button type="submit" class="btn btn-accent">Guardar</button></div>
    </form>`);
  $('#quick-unlock-modal-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    try {
      const appUserId = Auth.getProfile().appUserId;
      await QuickUnlock.changePin(appUserId, fd.pin);
      await logAudit(mode === 'change' ? 'QUICK_UNLOCK_CAMBIADO' : 'QUICK_UNLOCK_CONFIGURADO', App.currentUser.name, App.currentUser.name);
      showInAppToast('✓ PIN rápido guardado');
      closeModal();
      renderConfig();
    } catch (e) {
      showInAppToast('✗ ' + e.message);
    }
  });
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
// Orden por prioridad operativa (no altera rutas/permisos, solo navegación):
// 1) operación diaria, 2) consulta/control, 3) administración — el grupo se
// usa únicamente para pintar un separador MUY discreto entre bloques (ver
// boot(), ".menu-sep"), nunca para ocultar ni reordenar por rol.
const MENU = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid', group: 'op' },
  { id: 'plan', label: 'Plan de Engrase', icon: 'list', group: 'op' },
  { id: 'matriz', label: 'Matriz Semanal', icon: 'matrix', group: 'op' },
  { id: 'turno', label: 'Engrase del Turno', icon: 'clock', group: 'op' },
  { id: 'registrar', label: 'Registrar Engrase', icon: 'check', group: 'op' },
  { id: 'horometros', label: 'Actualizar Horómetros', icon: 'gauge', group: 'op' },
  { id: 'anomalias', label: 'Anomalías', icon: 'alert', group: 'op' },
  { id: 'equipos', label: 'Equipos', icon: 'truck', group: 'con' },
  { id: 'historial', label: 'Historial', icon: 'history', group: 'con' },
  { id: 'reportes', label: 'Reportes', icon: 'report', group: 'con' },
  { id: 'lubricantes', label: 'Lubricantes', icon: 'drop', group: 'con' },
  { id: 'usuarios', label: 'Usuarios', icon: 'users', group: 'adm' },
  { id: 'config', label: 'Configuración', icon: 'gear', group: 'adm' },
  { id: 'ayuda', label: 'Ayuda', icon: 'help', group: 'adm' },
];

function boot() {
  wireEvidenceImgFallbackOnce();
  // runAutoCycle() (no fullSync() directo): además del sync incremental de
  // siempre, revisa si hay una ventana de full refresh 07:00/19:00
  // pendiente de HOY — es el catch-up real al abrir la app (ver
  // docs/SESSION_HANDOFF.md, nunca bloquea esta pantalla: corre aparte).
  Sync.runAutoCycle();
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
          ${(() => {
            const items = MENU.filter(m => allowed.includes(m.id));
            let prevGroup = null;
            return items.map(m => {
              const sep = (prevGroup !== null && m.group !== prevGroup) ? '<div class="menu-sep" aria-hidden="true"></div>' : '';
              prevGroup = m.group;
              return `${sep}
            <button class="menu-item" data-route="${m.id}">
              <span class="menu-icon icon-${m.icon}"></span>
              <span>${m.label}</span>
            </button>`;
            }).join('');
          })()}
        </nav>
        ${(typeof Auth !== 'undefined' && Auth.isSupabaseMode()) ? `<button class="menu-item" id="btn-lock-app"><span class="menu-icon icon-lock"></span><span>Bloquear</span></button>` : ''}
        ${(typeof Auth !== 'undefined' && Auth.isSupabaseMode()) ? `<button class="menu-item" id="btn-change-user"><span class="menu-icon icon-repeat"></span><span>Cambiar usuario</span></button>` : ''}
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
            <div class="quick-find">
              <button type="button" id="quick-find-toggle" class="icon-btn quick-find-toggle" aria-label="Buscar equipo">${ic('search')}</button>
              <input type="search" id="quick-find" placeholder="Buscar equipo (código)…" autocomplete="off" aria-label="Buscar equipo por código"/>
              <div id="quick-find-results" class="quick-find-results hidden"></div>
            </div>
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
  $('#btn-logout').addEventListener('click', confirmLogout);
  $('#btn-lock-app')?.addEventListener('click', lockApp);
  $('#btn-change-user')?.addEventListener('click', confirmChangeUser);
  const toggle = $('#btn-menu-toggle');
  if (toggle) toggle.addEventListener('click', () => $('#sidebar').classList.toggle('open'));

  wireQuickFind();
  navigate(allowed.includes('dashboard') ? 'dashboard' : allowed[0]);
  handleQrDeepLink();
  setTimeout(() => revisarRecordatorioRespaldo(), 4000); // tras dejar cargar la pantalla
}

function updateShiftBadge() {
  const el = $('#topbar-shift');
  if (!el) return;
  const isDay = currentShiftId() === 'shift_dia';
  const label = isDay ? 'Turno Día' : 'Turno Noche';
  el.title = label;
  // El texto se separa del ícono para poder ocultarlo solo en móvil (CSS)
  // y ahorrar espacio horizontal, sin perder el dato (queda en el title).
  el.innerHTML = `<span class="topbar-shift-icon">${isDay ? '☀' : '☾'}</span><span class="topbar-shift-label"> ${label}</span>`;
}

function navigate(route) {
  App.route = route;
  $$('.menu-item[data-route], .bottom-item[data-route]').forEach(b => {
    const active = b.dataset.route === route;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const item = MENU.find(m => m.id === route);
  // Estos dos elementos SOLO existen en la interfaz de escritorio. La del lubricador no
  // tiene barra superior ni menú lateral, así que se accede con protección: sin esto,
  // llamar a navigate() desde su pantalla rompía la función a la mitad y la vista se
  // quedaba con datos viejos (fue la causa de que una anomalía borrada siguiera visible).
  const titulo = $('#topbar-title');
  if (titulo) titulo.textContent = item ? item.label : '';
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
          <button type="button" id="conn-badge" class="conn-badge" title="Tocar para sincronizar ahora"></button>
          ${(typeof Auth !== 'undefined' && Auth.isSupabaseMode()) ? `<button class="icon-btn lub-logout-btn" id="btn-lock-app" title="Bloquear"><span class="lub-logout-text">Bloquear</span></button>` : ''}
          ${(typeof Auth !== 'undefined' && Auth.isSupabaseMode()) ? `<button class="icon-btn lub-logout-btn" id="btn-change-user" title="Cambiar usuario"><span class="lub-logout-text">Cambiar usuario</span></button>` : ''}
          <button class="icon-btn lub-logout-btn" id="btn-logout" title="Cerrar sesión">${ic('logout')}<span class="lub-logout-text">Cerrar sesión</span></button>
        </div>
      </header>
      <div class="lub-user-strip">👤 ${esc(App.currentUser.name)} · <span id="lub-shift"></span></div>
      <main id="app-content" class="lub-content"></main>
      <nav class="lub-bottom-nav">
        <button class="lub-nav-item active" data-route="turno" aria-current="page"><span class="menu-icon icon-clock"></span><span>Mi Turno</span></button>
        <button class="lub-nav-item" data-route="anomalias"><span class="menu-icon icon-alert"></span><span>Anomalías</span></button>
        <button class="lub-nav-item" data-route="historial"><span class="menu-icon icon-history"></span><span>Mis Engrases</span></button>
        <button class="lub-nav-item" data-route="ayuda"><span class="menu-icon icon-help"></span><span>Ayuda</span></button>
      </nav>
    </div>`;

  updateConnBadge();
  const shiftLabel = () => { $('#lub-shift').textContent = currentShiftId() === 'shift_dia' ? '☀ Turno Día' : '☾ Turno Noche'; };
  shiftLabel();
  setInterval(shiftLabel, 60000);

  $('#btn-logout').addEventListener('click', confirmLogout);
  $('#btn-lock-app')?.addEventListener('click', lockApp);
  $('#btn-change-user')?.addEventListener('click', confirmChangeUser);
  $$('.lub-nav-item').forEach(b => b.addEventListener('click', () => {
    // La barra inferior vive FUERA de #app-content (nunca se borra al entrar a
    // Registrar Engrase) — tocar cualquiera de estas 4 secciones es una salida
    // EXPLÍCITA del flujo hacia una pantalla estable, sea cual sea la pantalla
    // que estuviera mostrando #app-content en ese momento (formulario o
    // "Validar ahora/después" incluidos). Sin este reset, el flag se quedaba en
    // true para siempre y el sync dejaba de refrescar Anomalías/Mis Engrases/
    // Ayuda/Mi Turno hasta recargar la app entera.
    App.lubricadorGreaseFlowActive = false;
    $$('.lub-nav-item').forEach(x => { x.classList.remove('active'); x.removeAttribute('aria-current'); });
    b.classList.add('active');
    b.setAttribute('aria-current', 'page');
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
  if (!c) return; // la pantalla ya no está en el documento (cambio de vista o de usuario)
  c.innerHTML = `<div class="loading">Cargando tu turno…</div>`;
  const equipos = await DB.allActive('equipment');
  const locations = await DB.allActive('locations');

  const scope = await getCurrentOperationalScope();
  const cuadrillas = await DB.allActive('cuadrillas');
  const myCrew = cuadrillas.find(cq => cq.id === scope.crewId);

  // Dispositivo sin cuadrilla asignada (§G del pedido): NUNCA cae a la lista
  // global de equipos — se muestra un mensaje claro y se pide contactar a
  // un Planificador/Administrador para asignarlo desde "Dispositivo
  // operativo" en Configuración.
  if (scope.kind === 'DEVICE_UNASSIGNED') {
    c.innerHTML = `
      <div class="lub-header-row"><div><h2 class="lub-heading">Este dispositivo no tiene cuadrilla</h2></div></div>
      <div class="empty-state">
        Este teléfono/tablet todavía no está asignado a ninguna cuadrilla, así que no se le puede mostrar ningún equipo.
        Pide a un Administrador o Planificador que lo configure en <b>Configuración → Dispositivo operativo</b>.
      </div>
      <button class="lub-anomaly-fab" id="lub-fab-anomaly">${ic("alert")}Reportar anomalía</button>`;
    $('#lub-fab-anomaly').addEventListener('click', () => openAnomalyForm());
    return;
  }

  const { assignments, plansByEquipoId } = await loadAssignmentContext();
  const { normal, assigned } = classifyEquipmentWork({
    scope, equipos, cuadrillas, assignments,
    equipoOccurrenceKeyFn: (e) => equipoOccurrenceKey(e, plansByEquipoId)
  });

  const statusesNormal = await computeAllStatuses(normal);
  const equiposAsignados = assigned.map(a => equipos.find(e => e.id === a.equipmentId)).filter(Boolean);
  const statusesAssigned = await computeAllStatuses(equiposAsignados);
  const order = { ROJO: 0, AMARILLO: 1, VERDE: 2, GRIS: 3 };
  // Prioridad (§T): asignados a mi cuadrilla > vencidos > pendientes de turno > al día.
  statusesNormal.sort((a, b) => order[a.s.code] - order[b.s.code]);
  statusesAssigned.sort((a, b) => order[a.s.code] - order[b.s.code]);

  const eqButtonHTML = (e, s) => `
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
    </button>`;

  c.innerHTML = `
    <div class="lub-header-row">
      <div>
        <h2 class="lub-heading">Equipos asignados</h2>
        <p class="lub-sub">Toca un equipo para registrar el engrase.${myCrew ? ' · ' + esc(myCrew.name) : ''}</p>
      </div>
      <div class="lub-header-actions">
        <button class="btn btn-accent lub-scan-btn" id="lub-scan-qr">${ic("qr")}Escanear QR</button>
        <button class="btn lub-outofplan-btn" id="lub-out-of-plan">${ic("plus")}Fuera de plan</button>
      </div>
    </div>
    ${await recentEquiposHTML()}
    ${statusesAssigned.length ? `
    <div class="lub-section-head"><span class="status-chip" style="--c:${STATUS_COLOR.AMARILLO}">ASIGNADOS A MI CUADRILLA</span></div>
    <div class="lub-eq-list">${statusesAssigned.map(({ e, s }) => eqButtonHTML(e, s)).join('')}</div>` : ''}
    ${scope.kind === 'GLOBAL' ? '' : '<div class="lub-section-head"><span class="dim">Trabajo normal de mi cuadrilla</span></div>'}
    <div class="lub-eq-list">
      ${statusesNormal.map(({ e, s }) => eqButtonHTML(e, s)).join('') || `<div class="empty-state">No hay equipos asignados a este turno${myCrew ? ' para ' + esc(myCrew.name) : ''}.</div>`}
    </div>
    <button class="lub-anomaly-fab" id="lub-fab-anomaly">${ic("alert")}Reportar anomalía</button>
    ${colorLegendHTML()}
  `;
  $$('.lub-eq-btn', c).forEach(b => b.addEventListener('click', () => startLubricadorGreaseFlow(b.dataset.id)));
  $('#lub-fab-anomaly').addEventListener('click', () => openAnomalyForm());
  $('#lub-scan-qr').addEventListener('click', () => openQrScanner());
  $('#lub-out-of-plan').addEventListener('click', () => openOutOfPlanEquipmentPicker());
  $$('.recents-chip', c).forEach(b => b.addEventListener('click', () => startLubricadorGreaseFlow(b.dataset.recentId)));
}

async function startLubricadorGreaseFlow(equipmentId, options) {
  const c = $('#app-content');
  if (!c) return;
  App.lubricadorGreaseFlowActive = true;
  c.innerHTML = `<button class="btn lub-back" id="lub-back">← Volver a mi turno</button><div id="lub-flow"></div>`;
  $('#lub-back').addEventListener('click', () => {
    App.lubricadorGreaseFlowActive = false; // cancelación explícita: vuelve a una pantalla estable
    renderLubricadorHome();
  });
  await startGreaseFlow(equipmentId, $('#lub-flow'), options);
}

/* ============================================================
   ENGRASE FUERA DE PLAN (§3-§6 del lote correspondiente) — botón
   "+ Fuera de plan" en Mi Turno, NUNCA una pestaña nueva de la barra
   inferior. Antes de abrir el flujo, SIEMPRE se detecta si el equipo ya
   tiene trabajo pendiente (ASSIGNED > PLANNED > ninguno, §5/§15) — un
   engrase fuera de plan JAMÁS permite saltarse el scope operativo del
   Lubricador (canLubricadorExecuteEquipment sigue siendo la única puerta).
   ============================================================ */
async function openOutOfPlanEquipmentPicker() {
  const equipos = await DB.allActive('equipment');
  let candidatos = equipos;

  if (App.currentUser.role === 'LUBRICADOR') {
    const scope = await getCurrentOperationalScope();
    if (scope.kind !== 'DEVICE_SCOPED') { candidatos = []; } else {
      const { assignments, cuadrillas, plansByEquipoId } = await loadAssignmentContext();
      const { normal, assigned } = classifyEquipmentWork({
        scope, equipos, cuadrillas, assignments,
        equipoOccurrenceKeyFn: (e) => equipoOccurrenceKey(e, plansByEquipoId)
      });
      const asignadosEq = assigned.map(a => equipos.find(e => e.id === a.equipmentId)).filter(Boolean);
      candidatos = [...normal, ...asignadosEq];
      // Un PM puede pasar en cualquier momento, no solo cuando el equipo ya
      // está vencido/próximo — se agrega el resto de la ubicación de la
      // cuadrilla aunque hoy no le "toque" nada (nunca toda la flota, ver §4).
      const idsYa = new Set(candidatos.map(e => e.id));
      equipos.filter(e => e.locationId === scope.crewLocationId && !idsYa.has(e.id)).forEach(e => candidatos.push(e));
    }
  }

  openModal('Engrase fuera de plan', `
    <p class="dim">Busca el equipo. Si ya tiene un engrase pendiente o asignado, se abrirá directo — "Fuera de plan" es solo para trabajo que no estaba programado ahora (PM, correctivo, oportunidad).</p>
    <input type="search" id="oop-search" class="input" placeholder="Buscar por código, marca o modelo…" autocomplete="off"/>
    <div id="oop-results" class="hist-eq-results" style="position:static; margin-top:8px; max-height:320px; overflow-y:auto"></div>
    <div class="modal-actions"><button type="button" class="btn" id="oop-scan-qr">${ic("qr")}Escanear QR</button></div>
  `);
  const box = $('#oop-results');
  function pintar(lista) {
    box.innerHTML = lista.slice(0, 30).map(e => `
      <button type="button" class="hist-eq-result" data-id="${e.id}">
        <span class="mono"><b>${esc(e.code)}</b></span>
        <span class="dim">${esc(e.brand)} ${esc(e.model)}</span>
      </button>`).join('') || '<div class="empty-state">Ningún equipo coincide, o este dispositivo no tiene equipos visibles.</div>';
    $$('.hist-eq-result', box).forEach(b => b.addEventListener('click', () => {
      closeModal();
      handleOutOfPlanEquipoSelected(b.dataset.id);
    }));
  }
  pintar(candidatos);
  $('#oop-search').addEventListener('input', () => {
    const q = $('#oop-search').value.trim().toLowerCase();
    pintar(!q ? candidatos : candidatos.filter(e =>
      (e.code || '').toLowerCase().includes(q) || (e.brand || '').toLowerCase().includes(q) || (e.model || '').toLowerCase().includes(q)));
  });
  $('#oop-scan-qr').addEventListener('click', () => {
    closeModal();
    openQrScanner();
  });
}

// Decide, para UN equipo elegido desde "+ Fuera de plan" (o desde QR, ver
// §21), si ya hay trabajo pendiente que abrir en vez de crear uno fuera de
// plan — nunca duplica occurrence/assignment (§5).
async function handleOutOfPlanEquipoSelected(equipmentId) {
  const equipo = await DB.get('equipment', equipmentId);
  if (!equipo || equipo.active === false) { alert('Este equipo no está activo, o este dispositivo aún no lo ha sincronizado.'); return; }

  if (App.currentUser.role === 'LUBRICADOR') {
    const scope = await getCurrentOperationalScope();
    const { assignments } = await loadAssignmentContext();
    if (!canLubricadorExecuteEquipment({ scope, equipo, assignments })) {
      alert('Este equipo no está asignado a su cuadrilla.');
      return;
    }
  }

  const plan = (await DB.allActive('lubrication_plans')).find(p => p.equipmentId === equipmentId) || null;
  const { assignments } = await loadAssignmentContext();
  const s = await statusFor(equipo);
  const existing = plan ? findExistingWorkForEquipment({ plan, assignments, statusCode: s.code, todayDate: new Date() }) : { kind: 'NONE' };

  if (existing.kind !== 'NONE') {
    openModal('Este equipo ya tiene un engrase pendiente', `
      <p class="dim">${existing.kind === 'ASSIGNED'
        ? 'Hay una asignación manual activa para este equipo — ábrelo desde ahí, no hace falta registrarlo como fuera de plan.'
        : 'Este equipo ya tiene su engrase normal pendiente. Regístralo como cualquier otro, no como fuera de plan.'}</p>
      <div class="modal-actions"><button type="button" class="btn btn-accent" id="oop-open-pending">${ic("check")}Abrir trabajo pendiente</button></div>
    `);
    $('#oop-open-pending').addEventListener('click', () => {
      closeModal();
      if (App.currentUser.role === 'LUBRICADOR') startLubricadorGreaseFlow(equipmentId);
      // Sin `target`: cae a navigate('registrar') + #reg-flow-area, el mismo
      // patrón real que usa esta pantalla para cualquier otro equipo (ver
      // renderRegistrar()) — nunca un `target` string como App.route, que
      // startGreaseFlow() no sabe interpretar como contenedor DOM.
      else startGreaseFlow(equipmentId);
    });
    return;
  }

  if (App.currentUser.role === 'LUBRICADOR') startLubricadorGreaseFlow(equipmentId, { outOfPlan: true });
  else startGreaseFlow(equipmentId, undefined, { outOfPlan: true });
}

// "Mis Engrases" — trabajo YA realizado por este lubricador (distinto de
// "Mi Turno" = trabajo por hacer, ver renderLubricadorHome). Es el destino
// SIEMPRE correcto tras Finalizar Engrase (ver irAMisEngrasesTrasRegistrar).
// Misma vista de tarjetas de siempre, ahora con Turno/Cantidad/Lubricador y
// el estado de validación real (grease_validations) + su acción — sin
// crear una segunda versión de esta pantalla.
async function renderLubricadorHistorial() {
  const c = $('#app-content');
  if (!c) return; // la pantalla ya no está en el documento (cambio de vista o de usuario)
  const records = (await DB.allActive('lubrication_records'))
    .filter(r => r.userId === App.currentUser.id)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 30);
  const equipos = await DB.allActive('equipment');
  const validations = await DB.allActive('grease_validations');
  const todayStr = new Date().toDateString();
  const ahora = new Date(); // una sola vez por render — nunca fecha de sync/apertura de pantalla
  c.innerHTML = `
    <h2 class="lub-heading">Mis últimos engrases</h2>
    <div class="lub-record-list">
      ${records.map(r => {
        const eq = equipos.find(e => e.id === r.equipmentId);
        const editable = new Date(r.date).toDateString() === todayStr;
        const activasEsteRegistro = findActiveValidations(r.id, validations);
        const valStatus = validationStatusForRecord(r, validations, ahora, App.generalSettings);
        // Vencida: NO se ofrece "Validar" (no crear firma retroactiva desde
        // aquí una vez pasado el plazo, ver MAX_VALIDATION_SHIFTS).
        const valAction = valStatus === VALIDATION_STATUS.HISTORICO || valStatus === VALIDATION_STATUS.VENCIDA ? '' :
          activasEsteRegistro.length === 0
            ? `<button type="button" class="btn btn-sm lub-validar-btn" data-rec="${r.id}" data-eq="${eq ? eq.id : ''}">Validar</button>`
            : activasEsteRegistro.length === 1
              ? `<button type="button" class="btn btn-sm lub-ver-validacion-btn" data-rec="${r.id}" data-eq="${eq ? eq.id : ''}">Ver validación</button>`
              : `<button type="button" class="btn btn-sm lub-ver-conflicto-btn" data-rec="${r.id}" data-eq="${eq ? eq.id : ''}">Ver conflicto</button>`;
        return `<div class="lub-record-card">
          <div class="lub-eq-top"><span class="lub-eq-code">${eq ? eq.code : '—'}</span><span class="dim">${fmtDate(r.date)}</span></div>
          <div class="lub-eq-model">${eq ? eq.brand + ' ' + eq.model : ''}</div>
          <div class="lub-eq-bottom"><span class="mono">${fmt(r.hourmeter)} h</span><span>${esc(r.condition)}</span></div>
          <div class="lub-record-meta dim">
            <span>Turno ${r.shiftId === 'shift_dia' ? 'Día' : 'Noche'}</span>
            <span>${fmt(r.qty, 1)} ${GREASE_UNIT}</span>
            <span>${esc(r.userName)}</span>
          </div>
          <div class="lub-record-validacion">
            ${validationBadgeHTML(valStatus)}
            ${valAction}
          </div>
          ${editable ? `<button class="btn btn-sm lub-edit-record" data-id="${r.id}" style="margin-top:8px; width:100%">✏ Editar este engrase</button>` : `<div class="dim" style="margin-top:6px; font-size:11px">Solo se puede editar el mismo día que se registró.</div>`}
        </div>`;
      }).join('') || `<div class="empty-state">Aún no has registrado engrases.</div>`}
    </div>`;
  $$('.lub-edit-record', c).forEach(btn => {
    btn.addEventListener('click', async () => openEditGreaseRecordForm(await DB.get('lubrication_records', btn.dataset.id)));
  });
  $$('.lub-validar-btn', c).forEach(b => b.addEventListener('click', async () => {
    const rec = await DB.get('lubrication_records', b.dataset.rec);
    const eq = equipos.find(e => e.id === b.dataset.eq);
    if (rec && eq) openValidationModal(rec, eq, () => renderLubricadorHistorial());
  }));
  $$('.lub-ver-validacion-btn', c).forEach(b => b.addEventListener('click', async () => {
    const validation = findActiveValidation(b.dataset.rec, validations);
    const rec = records.find(r => r.id === b.dataset.rec);
    const eq = equipos.find(e => e.id === b.dataset.eq);
    if (validation && eq) await openValidationDetailModal(validation, eq, rec ? rec.date : null);
  }));
  $$('.lub-ver-conflicto-btn', c).forEach(b => b.addEventListener('click', async () => {
    const activas = findActiveValidations(b.dataset.rec, validations);
    const rec = records.find(r => r.id === b.dataset.rec);
    const eq = equipos.find(e => e.id === b.dataset.eq);
    if (activas.length > 1 && eq) await openValidationConflictModal(activas, eq, rec ? rec.date : null);
  }));
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
        <label>Cantidad (${GREASE_UNIT})<input type="number" step="0.1" name="qty" value="${record.qty}"/></label>
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
// Abreviaturas de día SOLO para presentación compacta en "Equipos que
// requieren atención" (nunca se usan para calcular ni se guardan — el dato
// real sigue siendo el nombre completo en plan.assignedDays/WEEKDAY_NAMES).
const WEEKDAY_ABBR_DASH = { 'Domingo': 'Dom', 'Lunes': 'Lun', 'Martes': 'Mar', 'Miércoles': 'Mié', 'Jueves': 'Jue', 'Viernes': 'Vie', 'Sábado': 'Sáb' };
// Etiquetas de NO_EXECUTION_REASONS (operational-scope.js) — global porque
// tanto startGreaseFlow() (formulario "No se pudo ejecutar") como
// renderDashboard() (agregado "Motivos de no ejecución") las necesitan;
// mismo criterio que STATUS_COLOR/WEEKDAY_ABBR_DASH arriba (una sola copia,
// nunca duplicada por pantalla).
const NO_EXECUTION_REASON_LABELS = {
  REPARACION: 'Equipo en reparación', YA_ENGRASADO: 'Ya engrasado recientemente',
  SIN_TIEMPO: 'No hubo tiempo', NO_DISPONIBLE: 'Equipo no disponible',
  CONDICION_INSEGURA: 'Condición insegura', OTRO: 'Otro'
};

async function renderDashboard() {
  const c = $('#app-content');
  if (!c) return; // la pantalla ya no está en el documento (cambio de vista o de usuario)
  c.innerHTML = `<div class="loading">Calculando indicadores…</div>`;
  const records = await DB.allActive('lubrication_records');
  const anomalies = await DB.allActive('anomalies');
  const plans = await DB.allActive('lubrication_plans');
  const types = await DB.allActive('equipment_types');
  const locations = await DB.allActive('locations');
  // TODAS (no solo activas) — SOLO para el lookup de nombres de abajo
  // (typePorId/locPorId, puro texto en pantalla). `types`/`locations` de
  // arriba siguen activas-solo a propósito: alimentan los <select> de
  // filtro Ubicación/Familia, donde SÍ no debe poder elegirse algo ya
  // desactivado. BUG REAL encontrado (DATA-PENDING-A02, docs/BUG_REGISTER.md):
  // un equipo cuya ubicación/familia se desactiva DESPUÉS sigue mostrando
  // "—" para siempre en vez de su nombre real, aunque el dato en `equipment`
  // nunca cambió — por construir este lookup desde la lista YA FILTRADA.
  const typesAll = await DB.all('equipment_types');
  const locationsAll = await DB.all('locations');
  const validations = await DB.allActive('grease_validations');
  const assignments = await DB.allActive('lubrication_assignments');
  const skips = await DB.allActive('lubrication_skips');

  // Filtros generales Ubicación/Familia (AND, se combinan entre sí): mismo
  // patrón ya usado en Matriz Semanal (App.matrizUbic/Tipo) — se guardan en
  // App para sobrevivir el re-render al cambiar, y filtran `equipos` UNA vez
  // aquí arriba, así todo lo que se deriva de él (KPIs, sin plan, atención,
  // mayor tiempo sin engrasar, semáforo) queda consistente entre sí.
  if (App.dashUbic === undefined) App.dashUbic = '';
  if (App.dashFamilia === undefined) App.dashFamilia = '';
  let equipos = await DB.allActive('equipment');
  if (App.dashUbic) equipos = equipos.filter(e => e.locationId === App.dashUbic);
  if (App.dashFamilia) equipos = equipos.filter(e => e.typeId === App.dashFamilia);

  const statuses = await computeAllStatuses(equipos);
  const counts = { VERDE: 0, AMARILLO: 0, ROJO: 0, GRIS: 0 };
  statuses.forEach(x => counts[x.s.code]++);
  // BUG REAL encontrado y corregido en este lote: `turnoActual` se declaraba
  // mucho más abajo (sección "Cumplimiento operativo"), pero
  // `pendientesTurnoAnterior` (Panel operativo, unas líneas abajo) ya lo
  // usaba dentro de `carry && carry.shiftId !== turnoActual` — el `&&`
  // cortocircuitaba y NUNCA llegaba a leer `turnoActual` mientras
  // `carry` fuera null (sin ningún skip real hoy, el caso de prueba más
  // común), así que nunca se notó. En cuanto existiera un carryover REAL
  // (justo el escenario que esta sección existe para mostrar), `carry` se
  // vuelve verdadero y la lectura de `turnoActual` caía en su "temporal
  // dead zone" (`const` usado antes de su declaración) -> ReferenceError,
  // reventando TODO el render del Dashboard. Se sube la declaración aquí
  // (no depende de nada calculado entre medio) para que exista desde el
  // principio de la función.
  const turnoActual = currentShiftId();

  const today = new Date().toDateString();
  const doneToday = records.filter(r => new Date(r.createdAt).toDateString() === today).length;
  const openAnomalies = anomalies.filter(a => a.status !== 'Cerrada').length;

  const attention = statuses
    .filter(x => x.s.code === 'ROJO' || x.s.code === 'AMARILLO')
    .sort((a, b) => (a.s.remaining ?? 0) - (b.s.remaining ?? 0));

  // Equipos cuyo plan tiene datos imposibles: no salen como vencidos ni como al día,
  // así que sin este aviso quedarían invisibles y nadie los corregiría nunca.
  const conProblemas = statuses.filter(x => x.s.alerta);

  // Equipos SIN NINGÚN plan configurado (ni "Día y turno de la semana" ni "Horas de
  // operación") — distinto del balde GRIS de statusFor()/counts.GRIS, que también
  // mezcla equipos detenidos y planes mal configurados. Prioridad de planificación
  // día/turno > horas > sin plan: como cada equipo tiene a lo sumo 1 plan, basta con
  // que NO exista ningún plan asociado (sea cual sea su tipo) para contar aquí — ya
  // filtrados por DB.allActive('equipment') (equipos activos, mismo criterio que el
  // resto del Dashboard, sin agregar un filtro nuevo por e.status).
  const planPorEquipoId = new Set(plans.map(p => p.equipmentId));
  const sinPlan = equipos.filter(e => !planPorEquipoId.has(e.id));

  // Equipos CON plan pero no operativos: no cuentan como vencidos/próximos
  // (statusFor() ya los manda a GRIS/DETENIDO) ni como sin plan — son un
  // estado propio, igual criterio que PAUSADO en la Matriz Semanal.
  const pausados = equipos.filter(e => e.status !== 'Operativo' && planPorEquipoId.has(e.id));

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

  // "Mayor tiempo sin engrasar": SOLO días de calendario desde el último
  // registro — nunca se mezcla con vencimiento por horómetro (ROJO/AMARILLO
  // ya es otro criterio, ver counts arriba). Prioriza equipos Operativos
  // (los detenidos/en mantenimiento no sorprenden por no tener engrase
  // reciente); "nunca engrasado" (null) se trata como el caso más urgente.
  const tiempoSinEngrase = [...equipos].sort((a, b) => {
    const opA = a.status === 'Operativo' ? 0 : 1, opB = b.status === 'Operativo' ? 0 : 1;
    if (opA !== opB) return opA - opB;
    const dA = daysSinceLastGrease(a.id), dB = daysSinceLastGrease(b.id);
    return (dB === null ? Infinity : dB) - (dA === null ? Infinity : dA);
  }).slice(0, 10);
  // Resumen en vivo del header del panel ("Máximo: 11 d · A-02") — SIEMPRE
  // calculado del propio tiempoSinEngrase, nunca hardcodeado. Si el primero
  // de la lista nunca fue engrasado (dias === null) no hay un "máximo en
  // días" real que mostrar, así que se omite el resumen.
  const tiempoSinEngraseTop = tiempoSinEngrase[0] || null;
  const tiempoSinEngraseMaxDias = tiempoSinEngraseTop ? daysSinceLastGrease(tiempoSinEngraseTop.id) : null;
  const tiempoSinEngraseMaxCode = tiempoSinEngraseTop ? tiempoSinEngraseTop.code : null;
  // Datos de apoyo para el rediseño operativo del Dashboard (solo
  // presentación — ningún cálculo de negocio nuevo, reutiliza `statuses`/
  // `attention`/`equipos` ya filtrados por Ubicación/Familia arriba).
  const typePorId = {}; typesAll.forEach(t => typePorId[t.id] = t);
  const locPorId = {}; locationsAll.forEach(l => locPorId[l.id] = l);
  const alDia = statuses.filter(x => x.s.code === 'VERDE');
  const proximos = attention.filter(x => x.s.code === 'AMARILLO'); // `attention` ya viene ordenado por urgencia
  const vencidos = attention.filter(x => x.s.code === 'ROJO'); // idem: más vencido (remaining más negativo) primero
  // "Realizados hoy" respeta Ubicación/Familia en la LISTA del modal — el
  // número del KPI (`doneToday`, arriba) se mantiene intacto tal cual ya se
  // calculaba, sin cambiar esa fórmula.
  const equipoIdsFiltrados = new Set(equipos.map(e => e.id));
  const recordsHoy = records.filter(r => new Date(r.createdAt).toDateString() === today && equipoIdsFiltrados.has(r.equipmentId));

  // "Pendientes de validación"/"Conflictos de validación" — KPIs secundarios,
  // lectura REAL de grease_validations (entidad separada, ver
  // docs/GREASE_VALIDATION_AUDIT.md). A propósito NO se acota a "hoy": la
  // validación ahora puede diferirse (Validar ahora/Validar después) y
  // regularizarse horas o incluso días después, así que un pendiente de
  // ayer no debe desaparecer del KPI ni de la lista solo por cruzar la
  // medianoche — usa `records` completo (ya en memoria), filtrado por los
  // equipos que respetan Ubicación/Familia. Concepto DISTINTO de
  // "Cumplimiento operativo" (trabajo programado ejecutado) — esto es sobre
  // CONFIRMAR lo ya ejecutado, no sobre si se ejecutó. Ambos usan las
  // funciones CENTRALES de src/core/grease-validation.js
  // (isRecordPendingValidation()/isRecordInConflict(), que a su vez
  // dependen de isRecordSubjectToValidation()) — MISMA regla que Historial/
  // Mis Engrases/Reportes, sin excepción propia del Dashboard: mientras
  // GREASE_VALIDATION_ENABLED_FROM siga en null, ningún registro es
  // "sujeto" todavía, así que ambos conteos dan 0 (ver
  // docs/GREASE_VALIDATION_AUDIT.md §14) — nunca 0 se fuerza a mano aquí,
  // sale solo de la función central.
  const ahoraValidacion = new Date(); // una sola vez — nunca fecha de sync/apertura de pantalla
  const recordsParaValidacion = records.filter(r => equipoIdsFiltrados.has(r.equipmentId));
  const recordsPendientesValidacion = recordsParaValidacion
    .filter(r => isRecordPendingValidation(r, validations, ahoraValidacion, App.generalSettings))
    .sort((a, b) => new Date(a.date) - new Date(b.date)); // más antiguo pendiente primero
  const recordsConflictoValidacion = recordsParaValidacion.filter(r => isRecordInConflict(r, validations));
  const pendientesTurnoActual = recordsPendientesValidacion.filter(r => r.shiftId === currentShiftId());

  // "Panel operativo" (lote occurrences/carryover, §3) — CERO cálculo de
  // negocio nuevo: reusa ASSIGNMENT_STATUS/EXECUTION_TYPE/
  // resolveRecordExecutionType() (operational-scope.js), el `statuses` ya
  // calculado arriba (nunca se recalcula el semáforo) y
  // findCarriedOverSkipForToday() (mismo módulo, ya usado en
  // startGreaseFlow()) — todo respeta Ubicación/Familia vía
  // `equipoIdsFiltrados`. Independiente de "Cumplimiento operativo"
  // (arriba): eso responde "¿se ejecutó lo programado?"; esto responde
  // "¿quién tiene trabajo pendiente/fuera de plan/sin poder ejecutar AHORA
  // mismo?" — nunca se mezclan los dos conteos.
  const assignmentsActivas = assignments.filter(a =>
    a.active !== false && a.status === ASSIGNMENT_STATUS.PENDING && equipoIdsFiltrados.has(a.equipmentId));
  const recordsOutOfPlanHoy = recordsHoy.filter(r => resolveRecordExecutionType(r).value === EXECUTION_TYPE.OUT_OF_PLAN);
  const todayISODash = todayDateISO();
  const skipsHoy = skips.filter(s =>
    s.active !== false && (s.date || '').slice(0, 10) === todayISODash && equipoIdsFiltrados.has(s.equipmentId));
  // "Pendiente de turno anterior": la ocurrencia de hoy quedó marcada "no
  // se pudo ejecutar" en un turno que YA NO es el actual — sigue
  // 'pendiente' en la Matriz Semanal (ver comentario de
  // findCarriedOverSkipForToday() en operational-scope.js), este KPI solo
  // la hace visible sin tener que abrir cada equipo uno por uno.
  // BUG REAL encontrado y corregido en este lote (auditoría de no-double-
  // count, §15): antes NO se excluía un equipo que YA se engrasó más tarde
  // el mismo día (Realizado atrasado) — el skip seguía existiendo, así que
  // ese equipo aparecía como "pendiente" aquí Y como "realizado" en
  // Cumplimiento operativo/Historial a la vez. Ahora se excluye cualquier
  // equipo con un lubrication_record real de HOY, sin importar el turno.
  const pendientesTurnoAnterior = equipos.filter(e => {
    const carry = findCarriedOverSkipForToday(skipsHoy, { equipmentId: e.id, dateISO: todayISODash });
    if (!carry || carry.shiftId === turnoActual) return false;
    const yaEngrasadoHoy = records.some(r => r.equipmentId === e.id && new Date(r.date).toDateString() === today);
    return !yaEngrasadoHoy;
  });
  const motivosNoEjecucionHoy = {};
  skipsHoy.forEach(s => { motivosNoEjecucionHoy[s.reason] = (motivosNoEjecucionHoy[s.reason] || 0) + 1; });
  // Estado por ubicación — reagrupa el MISMO `statuses` (sin recalcular el
  // semáforo), solo para las ubicaciones que de verdad tienen equipos
  // dentro del filtro Ubicación/Familia vigente.
  const estadoPorUbicacion = locations.map(loc => {
    const deEsaUbic = statuses.filter(x => x.e.locationId === loc.id);
    return {
      location: loc, total: deEsaUbic.length,
      verde: deEsaUbic.filter(x => x.s.code === 'VERDE').length,
      amarillo: deEsaUbic.filter(x => x.s.code === 'AMARILLO').length,
      rojo: deEsaUbic.filter(x => x.s.code === 'ROJO').length,
    };
  }).filter(u => u.total > 0);

  // Cola de atención unificada (reemplaza la tabla ancha de 9 columnas):
  // mismos conjuntos ya calculados arriba (vencidos/proximos/sinPlan/
  // pausados) — sin cálculo de negocio nuevo, solo se arma un texto legible
  // por fila (motivo/plan aplicable/urgencia) a partir de datos que
  // statusFor()/weekdayStatusFor() ya devuelven (x.s.plan/remaining/
  // scheduleDate). Orden fijo por prioridad: Vencidos > Próximos > Sin
  // plan > Pausados (solo si hay alguno).
  const planByEquipoId = {}; plans.forEach(p => planByEquipoId[p.equipmentId] = p);

  // KPIs "Cumplimiento operativo" (Hoy/Semana/Turno actual) — realizados/
  // programados, SOLO planes "Día y turno de la semana". Planes por Horas
  // se EXCLUYEN a propósito (auditado antes de implementar, ver
  // docs/PLAN_COMPLIANCE_ANTICIPADO.md): su vencimiento depende del uso real
  // del equipo (horómetro), no de un calendario — no hay forma de saber si
  // a un equipo por horas "le tocaba" hoy/esta semana/este turno sin
  // proyectar horas→tiempo (calcular un intervalo promedio de uso del
  // equipo), y eso está explícitamente prohibido. "Programado" aquí
  // siempre significa un día/turno REAL ya definido en
  // `plan.assignedDays`/`plan.shiftId`, nunca un valor inventado.
  // Independiente de `computeFleetCompliance()` (histórico por registro) —
  // no se mezclan. Movido ARRIBA de `colaAtencion` (rediseño de jerarquía,
  // cierre Parte D) porque `colaAtencion` ahora necesita `progHoy`/
  // `hechoHoy` para el bucket "Pendiente hoy" — antes se calculaban
  // DESPUÉS de construir la cola, así que no estaban disponibles ahí.
  const nowTs = new Date();
  const hoyWeekday = WEEKDAY_NAMES[nowTs.getDay()];
  const turnoActualLabel = turnoActual === 'shift_dia' ? 'Turno Día' : 'Turno Noche';
  // Universo evaluable: equipos operativos (un equipo pausado no "debía"
  // engrasarse) con plan Día/Turno, ya filtrados por Ubicación/Familia
  // arriba (derivan de `equipos`).
  const equiposDT = equipos.filter(e => e.status === 'Operativo' && (planByEquipoId[e.id] || {}).controlType === 'Día y turno de la semana');
  function turnoOk(plan, shiftId) { return !plan.shiftId || plan.shiftId === shiftId; }
  function hechoEnFecha(equipmentId, plan, fechaStr) {
    return records.some(r => r.equipmentId === equipmentId && new Date(r.date).toDateString() === fechaStr && turnoOk(plan, r.shiftId));
  }

  // Hoy: equipos cuyo plan tiene HOY como día asignado.
  const progHoy = equiposDT.filter(e => (planByEquipoId[e.id].assignedDays || []).includes(hoyWeekday));
  const hechoHoy = progHoy.filter(e => hechoEnFecha(e.id, planByEquipoId[e.id], today));
  // "Pendientes hoy" (KPI principal nuevo, cierre Parte D §4/§24): MISMO
  // universo ya usado para "Cumplimiento Hoy" (progHoy/hechoHoy) — nunca
  // una fórmula nueva, solo la diferencia de dos listas ya calculadas.
  // Se reusa a propósito (en vez de derivar de `counts.AMARILLO`, que
  // mezcla esto con lo próximo a vencer por horómetro) para que el número
  // de esta tarjeta y el de "Cumplimiento Hoy" sean SIEMPRE consistentes
  // entre sí (mismo denominador).
  const pendientesHoyIds = new Set(progHoy.map(e => e.id)); hechoHoy.forEach(e => pendientesHoyIds.delete(e.id));
  const pendientesHoyList = progHoy.filter(e => pendientesHoyIds.has(e.id));

  // Turno actual: de lo programado hoy, lo que aplica al turno en curso
  // (plan sin turno fijo = aplica a ambos) y tiene un registro hecho
  // específicamente en ESE turno hoy (no en cualquier turno del día).
  const progTurno = progHoy.filter(e => turnoOk(planByEquipoId[e.id], turnoActual));
  const hechoTurno = progTurno.filter(e => records.some(r => r.equipmentId === e.id && new Date(r.date).toDateString() === today && r.shiftId === turnoActual));

  // Semana: días de Lunes a HOY (nunca días futuros de la semana — eso sería
  // proyectar); por cada equipo con plan Día/Turno se cuentan los días ya
  // transcurridos que coinciden con su `assignedDays`.
  function startOfWeek(d) {
    const day = d.getDay(); // 0=Domingo..6=Sábado
    const diff = (day === 0 ? -6 : 1) - day; // retrocede hasta el Lunes
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }
  const diasTranscurridosSemana = [];
  for (let d = startOfWeek(nowTs); d <= nowTs; d.setDate(d.getDate() + 1)) diasTranscurridosSemana.push(new Date(d));
  let progSemana = 0, hechoSemana = 0;
  equiposDT.forEach(e => {
    const plan = planByEquipoId[e.id];
    diasTranscurridosSemana.forEach(d => {
      if ((plan.assignedDays || []).includes(WEEKDAY_NAMES[d.getDay()])) {
        progSemana++;
        if (hechoEnFecha(e.id, plan, d.toDateString())) hechoSemana++;
      }
    });
  });

  function cumplimientoPct(x, y) { return y ? Math.round((x / y) * 100) : null; }
  const cumplHoy = { x: hechoHoy.length, y: progHoy.length, pct: cumplimientoPct(hechoHoy.length, progHoy.length) };
  const cumplTurno = { x: hechoTurno.length, y: progTurno.length, pct: cumplimientoPct(hechoTurno.length, progTurno.length) };
  const cumplSemana = { x: hechoSemana, y: progSemana, pct: cumplimientoPct(hechoSemana, progSemana) };

  function planLabelFor(plan) {
    if (!plan) return '—';
    if (plan.controlType === 'Horas de operación') return `Cada ${fmt(plan.frequency || 0)} h`;
    // Presentación compacta (WEEKDAY_ABBR_DASH, ver drawColaAtencion): la
    // fila ya antepone "Plan:" — aquí solo van los días, abreviados
    // ("Lun · Jue · Sáb" en vez de "Día: Lunes/Jueves/Sábado"). El dato
    // completo (plan.assignedDays con nombres completos) no se toca.
    if (plan.controlType === 'Día y turno de la semana') {
      return (plan.assignedDays || []).length ? plan.assignedDays.map(d => WEEKDAY_ABBR_DASH[d] || d).join(' · ') : '—';
    }
    return '—';
  }
  function motivoFor(x) {
    if (x.s.nextHour !== undefined) return x.s.code === 'ROJO' ? 'Vencido por horómetro' : 'Próximo por horómetro';
    return x.s.code === 'ROJO' ? 'Vencido por día/turno' : 'Programado hoy';
  }
  function urgenciaFor(x) {
    if (x.s.remaining !== undefined && x.s.remaining !== null) {
      return x.s.remaining < 0 ? `Atraso: ${fmt(Math.abs(x.s.remaining))} h` : `Restante: ${fmt(x.s.remaining)} h`;
    }
    if (x.s.scheduleDate) return `Día: ${WEEKDAY_NAMES[x.s.scheduleDate.getDay()]}`;
    return '—';
  }
  // "Próximos" (KPI + cola de atención) ahora EXCLUYE lo que ya se cuenta
  // como "Pendiente hoy" (§15 del pedido — "no double count"): antes
  // `proximos` (counts.AMARILLO) mezclaba "próximo a vencer por
  // horómetro" CON "programado hoy por día/turno, todavía sin hacer" en
  // un solo balde — ahora que "Pendientes hoy" es su PROPIA tarjeta
  // (arriba), dejarlo también aquí duplicaría el mismo equipo en 2 KPIs
  // principales a la vez. `x.s.label === 'PROGRAMADO HOY'` es el MISMO
  // campo que weekdayStatusFor() (lubrication-status.js) ya pone — no se
  // inventa un criterio nuevo, solo se usa para filtrar.
  const proximosSinHoy = proximos.filter(x => x.s.label !== 'PROGRAMADO HOY');
  const colaAtencion = [
    ...vencidos.map(x => ({ estado: 'Vencido', tone: 'red', e: x.e, motivo: motivoFor(x), plan: planLabelFor(x.s.plan), urgencia: urgenciaFor(x), planObj: x.s.plan })),
    // Pendiente turno anterior (§6/§25 del pedido): MISMA lista ya
    // calculada para el bloque dedicado de la sección E — se reusa aquí
    // tal cual, sin recalcular.
    ...pendientesTurnoAnterior.map(e => ({ estado: 'Turno anterior', tone: 'amber', e, motivo: 'Pendiente del turno anterior (carryover)', plan: planLabelFor(planByEquipoId[e.id]), urgencia: '—', planObj: planByEquipoId[e.id] || null })),
    ...pendientesHoyList.map(e => ({ estado: 'Pendiente hoy', tone: 'amber', e, motivo: 'Programado hoy', plan: planLabelFor(planByEquipoId[e.id]), urgencia: `Día: ${hoyWeekday}`, planObj: planByEquipoId[e.id] || null })),
    ...proximosSinHoy.map(x => ({ estado: 'Próximo', tone: 'amber', e: x.e, motivo: motivoFor(x), plan: planLabelFor(x.s.plan), urgencia: urgenciaFor(x), planObj: x.s.plan })),
    ...[...sinPlan].sort((a, b) => a.code.localeCompare(b.code)).map(e => ({ estado: 'Sin plan', tone: 'red', e, motivo: 'Sin plan de engrase configurado', plan: '—', urgencia: '—', planObj: null })),
    ...pausados.map(e => ({ estado: 'Pausado', tone: 'neutral', e, motivo: 'Equipo pausado (no operativo)', plan: planLabelFor(planByEquipoId[e.id]), urgencia: '—', planObj: null })),
  ];

  const allowedRoutes = PERMISSIONS[App.currentUser.role] || [];
  // Rediseño estructural del Dashboard (cierre Parte D, pedido explícito):
  // MISMAS fuentes de datos/fórmulas/filtros de siempre — el cambio es
  // JERARQUÍA + DISTRIBUCIÓN (§1/§17). Orden A-I pedido:
  //   A. Cabecera+filtros (ya existía, sin cambios)
  //   B. KPI principales (Vencidos/Pendientes hoy/Próximos/Realizados hoy/
  //      Pendientes de validación/Cumplimiento hoy) — antes repartidos
  //      entre "Estado de lubricación"/"Actividad"/"Cumplimiento operativo"
  //   C. Cumplimiento (Hoy/Semana/Turno) — ya existía, solo se mueve arriba
  //   D. Requieren atención — ya existía (al fondo), ahora justo después
  //      de B/C; "con el plan mal configurado" (conProblemas) queda junto
  //      a esta sección por ser igual de urgente
  //   E. Pendientes del turno anterior — antes mezclado dentro de "Panel
  //      operativo", ahora su propia sección (§7: "no convertirla en KPI")
  //   F. Estado por ubicación — idem, separado de "Panel operativo"
  //   G. Assignments activas + Fuera de plan + No ejecutados — el resto de
  //      lo que era "Panel operativo"
  //   H. Mayor tiempo sin engrasar — ya existía, se mueve más abajo
  //   I. Indicadores secundarios (Al día/Sin plan/Pausados/Anomalías
  //      abiertas/Total equipos) — antes "Estado de lubricación"/
  //      "Actividad", ahora al final con menor peso visual (dashActivityCard
  //      en vez de dashHeroCard)
  c.innerHTML = `
    <div class="layout-wide">
    <div class="toolbar dash-filters-row">
      <label class="filter-label">Ubicación
        <select id="dash-ubic" class="input input-sm">
          <option value="">Todas</option>
          ${locations.map(l => `<option value="${l.id}" ${App.dashUbic === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
        </select>
      </label>
      <label class="filter-label">Familia
        <select id="dash-familia" class="input input-sm">
          <option value="">Todas</option>
          ${types.map(t => `<option value="${t.id}" ${App.dashFamilia === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select>
      </label>
    </div>

    <section class="dash-section">
      <h2 class="dash-section-title">Qué requiere acción</h2>
      <div class="dash-hero-grid">
        ${dashHeroCard('Vencidos', counts.ROJO, 'red', 'vencidos')}
        ${dashHeroCard('Pendientes hoy', pendientesHoyList.length, pendientesHoyList.length ? 'amber' : 'neutral', null)}
        ${dashHeroCard('Próximos', proximosSinHoy.length, proximosSinHoy.length ? 'amber' : 'neutral', 'proximos')}
        ${dashHeroCard('Realizados hoy', doneToday, 'green', allowedRoutes.includes('historial') ? 'realizados-hoy' : null)}
        ${dashHeroCard('Pendientes de validación', recordsPendientesValidacion.length, recordsPendientesValidacion.length ? 'amber' : 'neutral', recordsPendientesValidacion.length ? 'pendientes-validacion' : null)}
        <div class="dash-hero-card tone-${cumplHoy.pct === null ? 'neutral' : cumplHoy.pct >= App.generalSettings.complianceTarget ? 'green' : cumplHoy.pct >= 80 ? 'amber' : 'red'}">
          <div class="dash-hero-value">${cumplHoy.pct === null ? '—' : cumplHoy.pct + '%'}</div>
          <div class="dash-hero-label">Cumplimiento hoy</div>
        </div>
      </div>
      ${recordsConflictoValidacion.length > 0 ? `<div class="dash-activity-row" style="margin-top:8px">${dashActivityCard('Conflictos de validación', recordsConflictoValidacion.length, 'red', 'conflictos-validacion')}</div>` : ''}
    </section>

    <div class="panel">
      <div class="panel-head"><h3>Cumplimiento operativo</h3></div>
      <div class="dim dash-compliance-note">Basado en planes programados por Día/Turno.<br>Los planes por Horas no se incluyen.</div>
      <div class="dash-compliance-grid">
        ${dashComplianceCard('Hoy', cumplHoy)}
        ${dashComplianceCard('Semana', cumplSemana)}
        ${dashComplianceCard(turnoActualLabel, cumplTurno)}
      </div>
    </div>

    <div class="panel" id="dash-attention-panel">
      <div class="panel-head"><h3>Equipos que requieren atención</h3></div>
      ${colaAtencion.length === 0 ? `<div class="empty-state">Todos los equipos están al día.</div>` : `
      <div class="toolbar" style="padding:0 14px 10px">
        <label class="filter-label">Turno
          <select id="att-turno" class="input input-sm"><option value="">Ambos</option><option value="shift_dia">Día</option><option value="shift_noche">Noche</option></select>
        </label>
        <label class="filter-label">Día asignado
          <select id="att-dia" class="input input-sm"><option value="">Todos</option>${SCHEDULE_WEEKDAYS.map(d => `<option value="${d}">${d}</option>`).join('')}</select>
        </label>
      </div>
      <div class="dash-cola-atencion" id="dash-cola-atencion"></div>`}
    </div>

    ${conProblemas.length ? `
    <div class="panel panel-alerta">
      <div class="panel-head"><h3>⚠ ${conProblemas.length} equipo(s) con el plan mal configurado</h3></div>
      <div class="dim" style="padding:0 14px 10px">Estos equipos NO se están controlando: sus datos son imposibles, así que el sistema no puede saber si les toca engrase.</div>
      <table class="data-table">
        <thead><tr><th>Código</th><th>Equipo</th><th>Problema</th><th></th></tr></thead>
        <tbody>${conProblemas.map(x => `<tr>
          <td class="mono">${esc(x.e.code)}</td>
          <td>${esc(x.e.brand)} ${esc(x.e.model)}</td>
          <td>${esc(x.s.alerta)}</td>
          <td>${allowedRoutes.includes('plan') ? `<button class="btn btn-sm arreglar-plan" data-id="${x.e.id}">Corregir</button>` : ''}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>` : ''}

    <div class="panel" id="dash-pendientes-anterior-panel">
      <div class="panel-head"><h3>Pendientes del turno anterior</h3></div>
      ${pendientesTurnoAnterior.length ? `
      <div class="dash-pendientes-anterior-list">
        <div class="dim" style="padding:0 14px 4px">${pendientesTurnoAnterior.length} equipo(s) — distinto de "Vencidos" (histórico): esto es de HOY, heredado del turno que ya terminó.</div>
        <div class="dash-motivos-noexec-list" style="padding:0 14px 10px">
          ${pendientesTurnoAnterior.map(e => `<span class="dash-motivo-chip mono">${esc(e.code)}</span>`).join('')}
        </div>
      </div>` : `<div class="empty-state">Ninguno — nada heredado del turno anterior.</div>`}
    </div>

    ${estadoPorUbicacion.length > 1 ? `
    <div class="panel" id="dash-ubic-panel">
      <div class="panel-head"><h3>Estado por ubicación</h3></div>
      <div class="dash-ubic-breakdown">
        <table class="data-table">
          <thead><tr><th>Ubicación</th><th>Equipos</th><th>Al día</th><th>Próximos</th><th>Vencidos</th></tr></thead>
          <tbody>${estadoPorUbicacion.map(u => `<tr>
            <td>${esc(u.location.name)}</td>
            <td>${u.total}</td>
            <td style="color:var(--green)">${u.verde}</td>
            <td style="color:var(--amber)">${u.amarillo}</td>
            <td style="color:var(--red)">${u.rojo}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>` : ''}

    <section class="dash-section dash-section-secondary" id="dash-panel-operativo">
      <h2 class="dash-section-title">Asignaciones · Fuera de plan · No ejecutados</h2>
      <div class="dash-activity-row">
        ${dashActivityCard('Asignaciones activas', assignmentsActivas.length, assignmentsActivas.length ? 'amber' : 'neutral', null)}
        ${dashActivityCard('Fuera de plan hoy', recordsOutOfPlanHoy.length, 'neutral', null)}
        ${dashActivityCard('No ejecutados hoy', skipsHoy.length, skipsHoy.length ? 'red' : 'neutral', null)}
      </div>
      ${Object.keys(motivosNoEjecucionHoy).length ? `
      <div class="dash-motivos-noexec">
        <div class="dim" style="padding:8px 0 4px">Motivos de "no se pudo ejecutar" hoy (informativo — nunca se cuenta como realizado):</div>
        <div class="dash-motivos-noexec-list">
          ${Object.entries(motivosNoEjecucionHoy).map(([reason, n]) => `<span class="dash-motivo-chip">${esc(NO_EXECUTION_REASON_LABELS[reason] || reason)}: <b>${n}</b></span>`).join('')}
        </div>
      </div>` : ''}
    </section>

    <div class="panel" id="dash-tiempo-sin-engrase-panel">
      <div class="panel-head dash-exc-head">
        <h3>Mayor tiempo sin engrasar</h3>
        ${tiempoSinEngrase.length > 1 ? `<button type="button" class="link-btn" id="dash-tiempo-ver-todos">Ver todos</button>` : ''}
      </div>
      <div class="dash-exc-sub">
        <span class="dim">Equipos ordenados por días desde el último engrase.</span>
        ${tiempoSinEngraseMaxDias !== null ? `<span class="dash-exc-summary">Máximo: ${tiempoSinEngraseMaxDias} d · <span class="mono">${esc(tiempoSinEngraseMaxCode)}</span></span>` : ''}
      </div>
      ${tiempoSinEngrase.length === 0 ? `<div class="empty-state">Sin equipos para mostrar.</div>` : `
      <div class="dash-exc-list">
        ${tiempoSinEngrase.slice(0, 5).map((e, idx) => tiempoExcepcionRowHTML(e, lastRecordByEquipo[e.id], daysSinceLastGrease(e.id), locPorId, idx === 0)).join('')}
      </div>
      `}
    </div>

    <section class="dash-section dash-section-secondary">
      <h2 class="dash-section-title">Indicadores secundarios</h2>
      <div class="dash-activity-row">
        ${dashActivityCard('Al día', counts.VERDE, 'green', 'al-dia')}
        ${dashActivityCard('Sin plan', sinPlan.length, sinPlan.length ? 'red' : 'neutral', 'sin-plan')}
        ${dashActivityCard('Pausados', pausados.length, 'neutral', pausados.length ? 'pausados' : null)}
        ${dashActivityCard('Anomalías abiertas', openAnomalies, openAnomalies ? 'amber' : 'neutral', allowedRoutes.includes('anomalias') ? 'anomalias' : null)}
        ${dashActivityCard('Total equipos', equipos.length, 'neutral', allowedRoutes.includes('equipos') ? 'total-equipos' : null)}
      </div>
    </section>
    </div>
  `;

  $$('.arreglar-plan', c).forEach(btn => {
    btn.addEventListener('click', async () => {
      const lubricants = await DB.allActive('lubricants');
      const plan = (await DB.allActive('lubrication_plans')).find(p => p.equipmentId === btn.dataset.id);
      openPlanForm(btn.dataset.id, plan ? plan.id : null, lubricants);
    });
  });

  // Modales de listado del Dashboard (Al día/Próximos/Vencidos/Total
  // equipos): mismo patrón que openSinPlanModal()/openPausadosModal()
  // (abajo), con 3 acciones reutilizables por fila (dashListRowActionsHTML).
  function openDashStatusModal(title, desc, list) {
    openModal(title, `
      <p class="dim">${desc}</p>
      <table class="data-table">
        <thead><tr><th>Código</th><th>Familia</th><th>Modelo</th><th>Ubicación</th><th>Estado</th><th></th></tr></thead>
        <tbody>${list.map(x => `<tr>
          <td class="mono">${esc(x.e.code)}</td>
          <td>${esc((typePorId[x.e.typeId] || {}).name || '—')}</td>
          <td>${esc(x.e.brand)} ${esc(x.e.model)}</td>
          <td>${esc((locPorId[x.e.locationId] || {}).name || '—')}</td>
          <td><span class="dot" style="background:${STATUS_COLOR[x.s.code]}"></span> ${x.s.label}</td>
          ${dashListRowActionsHTML(x.e.id)}
        </tr>`).join('') || '<tr><td colspan="6" class="empty-state">Sin equipos.</td></tr>'}</tbody>
      </table>
    `);
    makeTablesResponsive($('.modal-body'));
    wireDashListActions($('.modal-body'));
  }

  function openRealizadosHoyModal() {
    openModal('Engrases realizados hoy', `
      <p class="dim">${recordsHoy.length} engrase(s) hoy, según los filtros de Ubicación/Familia actuales.</p>
      <table class="data-table">
        <thead><tr><th>Código</th><th>Familia</th><th>Modelo</th><th>Ubicación</th><th>Hora</th><th></th></tr></thead>
        <tbody>${recordsHoy.map(r => {
          const eq = equipos.find(e => e.id === r.equipmentId);
          if (!eq) return '';
          return `<tr>
            <td class="mono">${esc(eq.code)}</td>
            <td>${esc((typePorId[eq.typeId] || {}).name || '—')}</td>
            <td>${esc(eq.brand)} ${esc(eq.model)}</td>
            <td>${esc((locPorId[eq.locationId] || {}).name || '—')}</td>
            <td>${fmtDate(r.date)}</td>
            ${dashListRowActionsHTML(eq.id)}
          </tr>`;
        }).join('') || '<tr><td colspan="6" class="empty-state">Sin engrases hoy.</td></tr>'}</tbody>
      </table>
    `);
    makeTablesResponsive($('.modal-body'));
    wireDashListActions($('.modal-body'));
  }

  // Lista de engrasados SIN firma (cualquier fecha, no solo hoy — la
  // validación ahora puede diferirse, ver Finalizar engrase) — acción
  // "Validar" abre el mismo modal real de Historial (openValidationModal),
  // que persiste en grease_validations (ver
  // docs/GREASE_VALIDATION_AUDIT.md). Re-renderiza el Dashboard al
  // confirmar para que el KPI baje en vivo. Ordenada por más antiguo
  // primero (recordsPendientesValidacion ya viene ordenada así).
  function openPendientesValidacionModal() {
    const turnoActualLabel = currentShiftId() === 'shift_dia' ? 'Día' : 'Noche';
    const filaHTML = (r) => {
      const eq = equipos.find(e => e.id === r.equipmentId);
      return eq ? pendienteValidacionRowHTML(r, eq) : '';
    };
    openModal('Pendientes de validación', `
      <p class="dim">${recordsPendientesValidacion.length} engrase(s) todavía sin firma, según los filtros de Ubicación/Familia actuales. Más antiguo primero.</p>
      <div class="dash-tiempo-modal-list">
        ${recordsPendientesValidacion.map(filaHTML).join('') || '<div class="empty-state">Sin pendientes.</div>'}
      </div>
      ${pendientesTurnoActual.length > 0 && pendientesTurnoActual.length < recordsPendientesValidacion.length ? `
      <div class="dash-tiempo-modal-sub">
        <div class="panel-head"><h4>Pendientes del turno actual (${turnoActualLabel})</h4></div>
        <div class="dash-tiempo-modal-list">${pendientesTurnoActual.map(filaHTML).join('')}</div>
      </div>` : ''}
    `);
    $$('.dash-validar-btn', $('.modal-body')).forEach(b => b.addEventListener('click', async () => {
      const rec = recordsPendientesValidacion.find(r => r.id === b.dataset.rec);
      const eq = equipos.find(e => e.id === b.dataset.eq);
      if (rec && eq) openValidationModal(rec, eq, () => renderDashboard());
    }));
  }

  // Lista de engrasados de hoy con 2+ firmas activas para el mismo registro
  // (doble validación offline/multidispositivo, ver
  // docs/GREASE_VALIDATION_AUDIT.md §10). "Ver conflicto" abre
  // openValidationConflictModal() con TODAS las activas — nunca elige ni
  // oculta ninguna.
  function openConflictosValidacionModal() {
    openModal('Conflictos de validación', `
      <p class="dim">${recordsConflictoValidacion.length} engrase(s) de hoy con más de una firma activa para el mismo registro, según los filtros de Ubicación/Familia actuales.</p>
      <div class="dash-tiempo-modal-list">
        ${recordsConflictoValidacion.map(r => {
          const eq = equipos.find(e => e.id === r.equipmentId);
          if (!eq) return '';
          return `<div class="dash-tiempo-modal-row">
            <div class="dash-op-line1"><span class="mono">${esc(eq.code)}</span></div>
            <div class="dash-op-line2">${esc(eq.brand)} ${esc(eq.model)} · ${fmtDate(r.date)}</div>
            <div class="dash-list-actions compact">
              <button type="button" class="btn btn-sm dash-ver-conflicto-btn" data-rec="${r.id}">Ver conflicto</button>
            </div>
          </div>`;
        }).join('') || '<div class="empty-state">Sin conflictos.</div>'}
      </div>
    `);
    $$('.dash-ver-conflicto-btn', $('.modal-body')).forEach(b => b.addEventListener('click', async () => {
      const activas = findActiveValidations(b.dataset.rec, validations);
      const rec = recordsConflictoValidacion.find(r => r.id === b.dataset.rec);
      const eq = rec ? equipos.find(e => e.id === rec.equipmentId) : null;
      if (activas.length > 1) await openValidationConflictModal(activas, eq, rec ? rec.date : null);
    }));
  }

  function openTiempoSinEngraseModal(rows) {
    // Mismo patrón visual compacto que el panel (tiempoExcepcionRowHTML), no
    // una tabla distinta ni tarjetas — ya viene ordenado por días
    // descendente. "Registrar" no aplica aquí: esta lista es para
    // priorizar/navegar a Historial, no para reemplazar Registrar Engrase.
    openModal(`Mayor tiempo sin engrasar (${rows.length})`, `
      <div class="dash-exc-list">
        ${rows.map(({ e, last, dias }, idx) => tiempoExcepcionRowHTML(e, last, dias, locPorId, idx === 0)).join('')}
      </div>
    `);
    $$('.dash-exc-hist-btn', $('.modal-body')).forEach(btn => {
      btn.addEventListener('click', () => { closeModal(); App.dashJumpEquipoId = btn.dataset.id; navigate('historial'); });
    });
  }

  $$('.kpi-clickable', c).forEach(card => {
    card.addEventListener('click', () => {
      const action = card.dataset.kpiAction;
      if (action === 'anomalias') {
        navigate('anomalias');
      } else if (action === 'sin-plan') {
        openSinPlanModal(sinPlan, typesAll, locationsAll);
      } else if (action === 'pausados') {
        openPausadosModal(pausados, typesAll, locationsAll);
      } else if (action === 'al-dia') {
        openDashStatusModal('Equipos al día', `${alDia.length} equipo(s) al día.`, alDia);
      } else if (action === 'proximos') {
        openDashStatusModal('Próximos a engrase', `${proximosSinHoy.length} equipo(s) próximos a vencer, ordenados por mayor urgencia.`, proximosSinHoy);
      } else if (action === 'vencidos') {
        openDashStatusModal('Equipos vencidos', `${vencidos.length} equipo(s) vencidos, los más atrasados primero.`, vencidos);
      } else if (action === 'total-equipos') {
        openDashStatusModal('Total de equipos', `${statuses.length} equipo(s) según los filtros actuales.`, statuses);
      } else if (action === 'realizados-hoy') {
        openRealizadosHoyModal();
      } else if (action === 'pendientes-validacion') {
        openPendientesValidacionModal();
      } else if (action === 'conflictos-validacion') {
        openConflictosValidacionModal();
      }
    });
  });

  $('#dash-tiempo-ver-todos')?.addEventListener('click', () => {
    openTiempoSinEngraseModal(tiempoSinEngrase.map(e => ({ e, last: lastRecordByEquipo[e.id], dias: daysSinceLastGrease(e.id) })));
  });
  // "Historial" es la acción PRINCIPAL visible de la fila — Registrar se
  // quitó a propósito: esta lista es para priorizar, no reemplaza Registrar
  // Engrase.
  $$('.dash-exc-hist-btn', c).forEach(btn => {
    btn.addEventListener('click', () => { App.dashJumpEquipoId = btn.dataset.id; navigate('historial'); });
  });

  $('#dash-ubic')?.addEventListener('change', e => { App.dashUbic = e.target.value; renderDashboard(); });
  $('#dash-familia')?.addEventListener('change', e => { App.dashFamilia = e.target.value; renderDashboard(); });

  // Cola compacta (reemplaza la tabla ancha de 9 columnas): una fila
  // horizontal en desktop, la misma información en tarjeta vertical en
  // móvil vía CSS (sin duplicar markup) — sin scroll horizontal.
  //
  // "Programación" compacta (SOLO presentación, misma urgencia/motivo ya
  // calculados arriba en urgenciaFor()/motivoFor() — no se recalcula nada):
  // un plan por horómetro ya trae la urgencia lista ("Atraso: Xh"/
  // "Restante: Xh"); un plan Día/turno tenía 3 expresiones largas
  // redundantes (urgencia "Día: Sábado" + motivo "Programado hoy"/"Vencido
  // por día/turno") — se combinan en un solo texto corto ("HOY · SÁB" /
  // "VENCIDO · SÁB") usando WEEKDAY_ABBR_DASH.
  function progCompactaFor(item) {
    if (item.urgencia.startsWith('Día: ')) {
      const dia = WEEKDAY_ABBR_DASH[item.urgencia.slice(5)] || item.urgencia.slice(5);
      const cuando = item.motivo.startsWith('Vencido') ? 'VENCIDO' : 'HOY';
      return `${cuando} · ${dia}`;
    }
    return item.urgencia; // ya compacto: "Atraso: Xh" / "Restante: Xh" / "—"
  }

  function drawColaAtencion() {
    const cont = $('#dash-cola-atencion');
    if (!cont) return;
    const turnoFilter = $('#att-turno').value;
    const diaFilter = $('#att-dia').value;

    const filtered = colaAtencion.filter(item => {
      if (turnoFilter && item.e.shiftId !== turnoFilter) return false;
      if (diaFilter) {
        if (!item.planObj || !item.planObj.assignedDays || !item.planObj.assignedDays.includes(diaFilter)) return false;
      }
      return true;
    });

    // Filas planas (sin líneas fijas de igual flex-grow — eso era la causa
    // de los huecos horizontales en desktop): CSS decide cuántas líneas usar
    // según el ancho real (flex-wrap en móvil, una sola fila en desktop).
    cont.innerHTML = filtered.map(item => `
      <div class="dash-cola-row">
        <span class="dash-cola-badge tone-${item.tone}">${item.estado}</span>
        <span class="dash-cola-code mono">${esc(item.e.code)}</span>
        <span class="dash-cola-meta dim">${esc(item.e.brand)} ${esc(item.e.model)} · ${esc((locPorId[item.e.locationId] || {}).name || '—')}</span>
        <span class="dash-cola-prog-tag" style="color:${item.tone === 'red' ? 'var(--red)' : item.tone === 'amber' ? 'var(--amber)' : 'var(--text-dim)'}">${esc(progCompactaFor(item))}</span>
        <span class="dash-cola-plan dim">Plan: ${esc(item.plan)}</span>
        <div class="dash-cola-actions">
          <button type="button" class="btn btn-sm dash-cola-hist" data-id="${item.e.id}">Historial</button>
          <button type="button" class="btn btn-sm btn-accent dash-cola-reg" data-id="${item.e.id}">Registrar</button>
        </div>
      </div>`).join('') || `<div class="empty-state">Sin equipos para este filtro.</div>`;

    $$('.dash-cola-hist', cont).forEach(b => b.addEventListener('click', () => { App.dashJumpEquipoId = b.dataset.id; navigate('historial'); }));
    $$('.dash-cola-reg', cont).forEach(b => b.addEventListener('click', () => startGreaseFlow(b.dataset.id)));
  }
  drawColaAtencion();
  $('#att-turno')?.addEventListener('change', drawColaAtencion);
  $('#att-dia')?.addEventListener('change', drawColaAtencion);
}

// KPI "Equipos sin plan" del Dashboard: listado en modal (no crea una OT ni una
// pantalla nueva), con código/familia/modelo/ubicación/estado de cada equipo.
function openSinPlanModal(list, types, locations) {
  const typePorId = {}; types.forEach(t => typePorId[t.id] = t);
  const locPorId = {}; locations.forEach(l => locPorId[l.id] = l);
  openModal('Equipos sin plan de engrase', `
    <p class="dim">${list.length} equipo(s) activo(s) sin plan por día/turno ni por horas — no se están controlando.</p>
    <table class="data-table">
      <thead><tr><th>Código</th><th>Familia</th><th>Modelo</th><th>Ubicación</th><th>Estado</th></tr></thead>
      <tbody>${list.map(e => `<tr>
        <td class="mono">${esc(e.code)}</td>
        <td>${esc((typePorId[e.typeId] || {}).name || '—')}</td>
        <td>${esc(e.brand)} ${esc(e.model)}</td>
        <td>${esc((locPorId[e.locationId] || {}).name || '—')}</td>
        <td>${esc(e.status)}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty-state">Sin equipos.</td></tr>'}</tbody>
    </table>
  `);
  makeTablesResponsive($('.modal-body'));
}

// KPI "Pausados" del Dashboard: equipos CON plan pero no operativos (mismo
// criterio que PAUSADO en Matriz Semanal, ver src/core/weekly-matrix.js).
function openPausadosModal(list, types, locations) {
  const typePorId = {}; types.forEach(t => typePorId[t.id] = t);
  const locPorId = {}; locations.forEach(l => locPorId[l.id] = l);
  openModal('Equipos pausados', `
    <p class="dim">${list.length} equipo(s) con plan configurado, pero no operativos — no cuentan como vencidos ni próximos mientras estén así.</p>
    <table class="data-table">
      <thead><tr><th>Código</th><th>Familia</th><th>Modelo</th><th>Ubicación</th><th>Estado</th></tr></thead>
      <tbody>${list.map(e => `<tr>
        <td class="mono">${esc(e.code)}</td>
        <td>${esc((typePorId[e.typeId] || {}).name || '—')}</td>
        <td>${esc(e.brand)} ${esc(e.model)}</td>
        <td>${esc((locPorId[e.locationId] || {}).name || '—')}</td>
        <td>${esc(e.status)}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty-state">Sin equipos.</td></tr>'}</tbody>
    </table>
  `);
  makeTablesResponsive($('.modal-body'));
}

// Fila de acciones reutilizada en los modales de listado del Dashboard
// rediseñado (Al día/Próximos/Vencidos/Total equipos/Realizados hoy/Mayor
// tiempo sin engrasar) — mismas 3 acciones, sin duplicar el flujo real de
// cada una: Ver equipo (openEquipmentDetail ya existente), Ver historial
// (Historial con el equipo preseleccionado vía App.dashJumpEquipoId) y
// Registrar engrase (startGreaseFlow ya existente, mismo botón que usa
// Equipos/Engrase del Turno).
function dashListRowActionsHTML(equipmentId) {
  return `<td class="dash-list-actions">
    <button type="button" class="btn btn-sm dash-list-ver-eq" data-id="${equipmentId}">Ver equipo</button>
    <button type="button" class="btn btn-sm dash-list-ver-hist" data-id="${equipmentId}">Historial</button>
    <button type="button" class="btn btn-sm dash-list-registrar" data-id="${equipmentId}">Registrar</button>
  </td>`;
}
function wireDashListActions(root) {
  $$('.dash-list-ver-eq', root).forEach(b => b.addEventListener('click', () => { closeModal(); openEquipmentDetail(b.dataset.id); }));
  $$('.dash-list-ver-hist', root).forEach(b => b.addEventListener('click', () => { closeModal(); App.dashJumpEquipoId = b.dataset.id; navigate('historial'); }));
  $$('.dash-list-registrar', root).forEach(b => b.addEventListener('click', () => { closeModal(); startGreaseFlow(b.dataset.id); }));
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

// Tarjetas del rediseño del Dashboard operativo: mayor jerarquía visual para
// "Estado de lubricación" (dashHeroCard) y una fila discreta para
// "Actividad" (dashActivityCard) — mismo mecanismo data-kpi-action/
// kpi-clickable que kpiCard(), solo cambia la presentación (styles.css).
function dashHeroCard(label, value, tone, action) {
  return `<div class="dash-hero-card tone-${tone} ${action ? 'kpi-clickable' : ''}" ${action ? `data-kpi-action="${action}"` : ''}>
    <div class="dash-hero-value">${fmt(value)}</div>
    <div class="dash-hero-label">${label}</div>
  </div>`;
}
// Tarjetas SECUNDARIAS de "Actividad" — número arriba (más visible), label
// debajo (mismo orden visual que dashHeroCard, pero más chicas: son de
// menor jerarquía que Al día/Próximos/Vencidos/Sin plan/Pausados).
function dashActivityCard(label, value, tone, action) {
  return `<div class="dash-activity-card tone-${tone} ${action ? 'kpi-clickable' : ''}" ${action ? `data-kpi-action="${action}"` : ''}>
    <span class="dash-activity-value">${fmt(value)}</span>
    <span class="dash-activity-label">${label}</span>
  </div>`;
}

// Tarjeta de "Cumplimiento operativo" (Hoy/Semana/Turno actual): % +
// "X de Y programados" + barra — estado neutro y sin % cuando y=0 (nunca
// NaN/Infinity). `c` = { x, y, pct } ya calculado en renderDashboard().
function dashComplianceCard(label, c) {
  return `<div class="dash-compliance-card">
    <div class="dash-compliance-label">${label}</div>
    <div class="dash-compliance-pct">${c.pct === null ? '—' : c.pct + '%'}</div>
    <div class="dash-compliance-frac">${c.y === 0 ? 'Sin engrases programados' : `${c.x} de ${c.y} programados`}</div>
    <div class="progress-track"><div class="progress-fill" style="width:${c.pct === null ? 0 : c.pct}%; background:${c.pct === null ? 'var(--text-dim)' : c.pct >= App.generalSettings.complianceTarget ? 'var(--green)' : c.pct >= 80 ? 'var(--amber)' : 'var(--red)'}"></div></div>
  </div>`;
}

// Tiempo transcurrido desde el engrase hasta AHORA — solo para mostrar en
// "Pendientes de validación" (nunca se usa para Cumplimiento ni para
// vencimiento por horómetro, son conceptos separados).
function tiempoPendienteDesde(dateISO) {
  const horas = Math.floor((Date.now() - new Date(dateISO).getTime()) / 3600000);
  if (horas < 1) return 'Menos de 1 h';
  if (horas < 24) return `${horas} h`;
  const dias = Math.floor(horas / 24);
  const horasResto = horas % 24;
  return horasResto ? `${dias} d ${horasResto} h` : `${dias} d`;
}

// Fila de "Pendientes de validación": código+tiempo pendiente (línea 1),
// modelo (línea 2), fecha/turno/lubricador (línea 3) — mismo patrón
// .dash-op-line* que el resto del Dashboard, con Validar como única acción.
function pendienteValidacionRowHTML(r, eq) {
  return `<div class="dash-tiempo-modal-row">
    <div class="dash-op-line1">
      <span class="mono">${esc(eq.code)}</span>
      <span class="dash-pendiente-tiempo">${tiempoPendienteDesde(r.date)}</span>
    </div>
    <div class="dash-op-line2">${esc(eq.brand)} ${esc(eq.model)}</div>
    <div class="dash-op-line3 dim">${fmtDate(r.date)} · Turno ${r.shiftId === 'shift_dia' ? 'Día' : 'Noche'} · ${esc(r.userName || '—')}</div>
    <div class="dash-list-actions compact">
      <button type="button" class="btn btn-sm dash-validar-btn" data-rec="${r.id}" data-eq="${eq.id}">Validar</button>
    </div>
  </div>`;
}

// Lista/ranking operativo compacto (estilo Fiix/UpKeep/Fracttal: KPI/resumen
// → lista → drill-down), NO ranking con números #1/#2/#3 ni tarjetas. El dato
// clave (días) se presenta como bloque destacado (número + etiqueta corta),
// no un texto aislado — con "Historial" como acción PRINCIPAL visible (antes
// solo la fila entera era clickable, sin ningún control visible). isMax (el
// más urgente, ya viene primero por el sort de tiempoSinEngrase) recibe un
// acento ámbar discreto vía CSS (borde + número), nunca una tarjeta aparte.
// Reutilizada también en "Ver todos" (mismo patrón visual, nunca otra tabla).
function tiempoExcepcionRowHTML(e, last, dias, locPorId, isMax) {
  return `<div class="dash-exc-row${isMax ? ' is-max' : ''}" data-id="${e.id}">
    <div class="dash-exc-main">
      <div class="dash-exc-line1"><span class="dash-exc-code mono">${esc(e.code)}</span></div>
      <div class="dash-exc-line2">${esc(e.brand)} ${esc(e.model)} · ${esc((locPorId[e.locationId] || {}).name || '—')}</div>
      <div class="dash-exc-line3 dim">Último engrase: ${last ? fmtDate(last) : 'Sin registro'}</div>
    </div>
    <div class="dash-exc-side">
      <div class="dash-exc-days-wrap${isMax ? ' is-max' : ''}">
        <span class="dash-exc-days${isMax ? ' is-max' : ''}">${dias === null ? '—' : dias}</span>
        <span class="dash-exc-days-label dim">${dias === null ? 'Sin registro' : 'días sin engrasar'}</span>
      </div>
      <button type="button" class="btn btn-sm dash-exc-hist-btn" data-id="${e.id}">Historial</button>
    </div>
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
  if (!c) return; // la pantalla ya no está en el documento (cambio de vista o de usuario)
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
    <div class="layout-wide">
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
    </div>
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

  // Últimos engrases y anomalías abiertas, para no tener que ir a Historial y filtrar
  const lubricantes = await DB.allActive('lubricants');
  const ultimos = (await DB.allActive('lubrication_records'))
    .filter(r => r.equipmentId === id)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 3);
  const anomaliasAbiertas = (await DB.allActive('anomalies'))
    .filter(a => a.equipmentId === id && a.status !== 'Cerrada')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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

    ${anomaliasAbiertas.length ? `
      <div class="ficha-bloque ficha-alerta">
        <h4>${ic("alert")}${anomaliasAbiertas.length} anomalía(s) abierta(s)</h4>
        ${anomaliasAbiertas.slice(0, 3).map(a => `
          <div class="ficha-fila">
            <span class="dot" style="background:${CRIT_COLOR[a.criticality]}"></span>
            <span><b>${esc(a.component)}</b> — ${esc((a.description || '').slice(0, 60))}</span>
            <span class="dim">${fmtDate(a.createdAt)}</span>
          </div>`).join('')}
        ${anomaliasAbiertas.length > 3 ? `<div class="dim" style="padding:4px 0">y ${anomaliasAbiertas.length - 3} más…</div>` : ''}
      </div>` : ''}

    <div class="ficha-bloque">
      <h4>${ic("history")}Últimos engrases</h4>
      ${ultimos.length ? ultimos.map(r => {
        const lub = lubricantes.find(l => l.id === r.greaseType);
        const pend = (r.details || []).filter(d => !d.done).length;
        return `<div class="ficha-fila">
          <span class="mono">${fmtDate(r.date)}</span>
          <span>${esc(r.userName)}${r.retroactivo ? ' <span class="retro-tag">atrasado</span>' : ''}</span>
          <span class="mono dim">${fmt(r.hourmeter)} h</span>
          <span class="dim">${lub ? esc(lub.name) : '—'}</span>
          ${pend ? `<span class="motivo-tag">${pend} punto(s) sin engrasar</span>` : ''}
        </div>`;
      }).join('') : '<div class="dim" style="padding:6px 0">Este equipo todavía no tiene engrases registrados.</div>'}
    </div>

    <div class="modal-actions">
      ${canEdit ? `<button class="btn btn-danger" id="btn-delete-eq">${ic("trash")}Eliminar equipo</button>` : ''}
      ${canEdit ? `<button class="btn" id="btn-edit-eq">${ic("edit")}Editar</button>` : ''}
      <button class="btn" id="btn-view-qr">${ic("qr")}Código QR</button>
      ${['ADMINISTRADOR','PLANIFICADOR','SUPERVISOR'].includes(App.currentUser.role) ? `
        <button class="btn" id="btn-pausar-avisos">${ic("clock")}${avisosPausados(e) ? 'Reanudar avisos' : 'Pausar avisos'}</button>` : ''}
      ${['ADMINISTRADOR','PLANIFICADOR','SUPERVISOR'].includes(App.currentUser.role) && s.plan && s.plan.controlType === 'Día y turno de la semana' ? `
        <button class="btn" id="btn-reprogramar">${ic("clock")}Reprogramar esta semana</button>` : ''}
      ${canManageAssignments(App.currentUser.role) && (s.code === 'ROJO' || s.code === 'AMARILLO') ? `
        <button class="btn" id="btn-asignar-cuadrilla">${ic("clock")}Asignar a cuadrilla</button>` : ''}
      ${canMoveEquipment(App.currentUser.role) ? `
        <button class="btn" id="btn-mover-ubicacion">${ic("edit")}Mover ubicación</button>` : ''}
      ${canRegisterOutOfPlan(App.currentUser.role) ? `
        <button class="btn" id="btn-fuera-de-plan">${ic("plus")}Registrar fuera de plan</button>` : ''}
      <button class="btn" id="btn-view-hist">Ver historial</button>
    </div>
  `);
  $('#btn-edit-eq')?.addEventListener('click', async () => {
    closeModal();
    const locations = await DB.allActive('locations');
    openEquipmentForm(e, types, locations);
  });
  $('#btn-asignar-cuadrilla')?.addEventListener('click', () => { closeModal(); openAssignGreaseModal(e); });
  $('#btn-mover-ubicacion')?.addEventListener('click', () => { closeModal(); openMoveEquipmentLocationModal(e); });
  $('#btn-fuera-de-plan')?.addEventListener('click', () => { closeModal(); handleOutOfPlanEquipoSelected(e.id); });
  $('#btn-delete-eq')?.addEventListener('click', async () => {
    if (!confirm(`¿Eliminar el equipo ${esc(e.code)}${e.shortCode ? ' (' + e.shortCode + ')' : ''}? Esta acción es un borrado lógico: el equipo deja de aparecer en la app pero su historial de engrases y anomalías se conserva en la auditoría. No se puede deshacer desde la interfaz.`)) return;
    await deleteEquipmentCascade(e);
    await logAudit('EQUIPO_ELIMINADO', `${esc(e.code)}${e.shortCode ? ' (' + e.shortCode + ')' : ''}`, App.currentUser.name);
    showInAppToast(`✓ Equipo ${esc(e.code)} eliminado`);
    closeModal();
    navigate('equipos');
  });
  $('#btn-view-qr')?.addEventListener('click', () => openEquipmentQR(e));

  // Reprogramar: mueve el engrase de ESTA semana a otro día, sin alterar el plan
  // permanente. Evita que un equipo que no se pudo atender el lunes quede marcado
  // como vencido toda la semana cuando en realidad se acordó hacerlo el martes.
  $('#btn-reprogramar')?.addEventListener('click', async () => {
    const plan = s.plan;
    if (!plan) return;
    const yaReprogramado = plan.reprogramadoHasta && new Date(plan.reprogramadoHasta) >= new Date(new Date().toDateString());
    const hoy = new Date();
    const maxFecha = new Date(hoy); maxFecha.setDate(maxFecha.getDate() + 7);
    openModal(`Reprogramar ${e.code}`, `
      <p class="dim">El plan permanente de este equipo (${(plan.assignedDays || []).join(', ') || 'sin días'}) <b>no se modifica</b>. Solo se mueve el engrase de esta semana.</p>
      ${yaReprogramado ? `<div class="qr-info-alert">Ya está reprogramado para el ${fmtDate(plan.reprogramadoHasta)}.</div>` : ''}
      <label>Nueva fecha
        <input type="date" id="repro-fecha" class="input"
               value="${new Date(hoy.getTime() - hoy.getTimezoneOffset() * 60000).toISOString().slice(0, 10)}"
               min="${new Date(hoy.getTime() - hoy.getTimezoneOffset() * 60000).toISOString().slice(0, 10)}"
               max="${new Date(maxFecha.getTime() - maxFecha.getTimezoneOffset() * 60000).toISOString().slice(0, 10)}"/>
      </label>
      <label>Motivo (queda en el historial)
        <select id="repro-motivo" class="input">
          <option>Equipo en operación, sin acceso</option>
          <option>Equipo fuera del área</option>
          <option>Falta de lubricante</option>
          <option>Personal insuficiente en el turno</option>
          <option>Condiciones del terreno / clima</option>
          <option>Otro</option>
        </select>
      </label>
      <div class="modal-actions">
        ${yaReprogramado ? `<button class="btn" id="repro-cancelar">Quitar reprogramación</button>` : ''}
        <button class="btn btn-accent" id="repro-ok">${ic("check")}Reprogramar</button>
      </div>
    `);
    $('#repro-ok').addEventListener('click', async () => {
      const f = $('#repro-fecha').value;
      const motivo = $('#repro-motivo').value;
      if (!f) { alert('Elige una fecha.'); return; }
      plan.reprogramadoHasta = new Date(f + 'T12:00:00').toISOString();
      plan.reprogramadoMotivo = motivo;
      await DB.put('lubrication_plans', stamp(plan, App.currentUser.name));
      await logAudit('ENGRASE_REPROGRAMADO', `${e.code} al ${f} · ${motivo}`, App.currentUser.name);
      showInAppToast(`✓ ${e.code} reprogramado al ${fmtDate(plan.reprogramadoHasta)}`);
      Sync.fullSync();
      closeModal();
    });
    $('#repro-cancelar')?.addEventListener('click', async () => {
      plan.reprogramadoHasta = null;
      plan.reprogramadoMotivo = null;
      await DB.put('lubrication_plans', stamp(plan, App.currentUser.name));
      await logAudit('REPROGRAMACION_CANCELADA', e.code, App.currentUser.name);
      showInAppToast('✓ Vuelve a su día habitual');
      Sync.fullSync();
      closeModal();
    });
  });

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

/* ---------- Asignar/reasignar/cancelar el engrase pendiente de un equipo a
   otra cuadrilla (responsabilidad temporal, NUNCA mueve el equipo — ver
   openMoveEquipmentLocationModal() para eso). Solo ADMIN/PLANIFICADOR/
   SUPERVISOR, ver canManageAssignments(). ---------- */
async function openAssignGreaseModal(equipo) {
  const { assignments, cuadrillas, plansByEquipoId } = await loadAssignmentContext();
  const plan = plansByEquipoId[equipo.id];
  if (!plan) { alert('Este equipo no tiene un plan de engrase activo — no hay nada que asignar.'); return; }
  const occurrenceKey = equipoOccurrenceKey(equipo, plansByEquipoId);
  const current = findActivePendingAssignment(assignments, occurrenceKey);
  const currentCrew = current ? cuadrillas.find(cq => cq.id === current.assignedCrewId) : null;
  const opciones = cuadrillas.filter(cq => cq.active !== false);

  openModal(`Asignar engrase · ${esc(equipo.code)}`, `
    ${current
      ? `<p class="dim">Actualmente asignado a <b>${esc(currentCrew ? currentCrew.name : current.assignedCrewId)}</b>.</p>`
      : '<p class="dim">Este engrase sigue su flujo normal (sin asignación manual todavía).</p>'}
    <form id="assign-crew-form">
      <label>Asignar a cuadrilla
        <select name="crewId" required>
          <option value="">— Selecciona —</option>
          ${opciones.map(cq => `<option value="${cq.id}" ${current && current.assignedCrewId === cq.id ? 'selected' : ''}>${esc(cq.name)}</option>`).join('')}
        </select>
      </label>
      <label>Notas (opcional)<textarea name="notes" rows="2">${current ? esc(current.notes || '') : ''}</textarea></label>
      <div class="modal-actions">
        ${current ? `<button type="button" class="btn btn-danger" id="btn-cancel-assign">Cancelar asignación</button>` : ''}
        <button type="submit" class="btn btn-accent">${ic("check")}${current ? 'Reasignar' : 'Asignar'}</button>
      </div>
    </form>
  `);
  $('#assign-crew-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    if (!fd.crewId) { alert('Selecciona una cuadrilla.'); return; }
    try {
      await assignGreaseToCrew(equipo, fd.crewId, fd.notes);
      showInAppToast(`✓ ${esc(equipo.code)} asignado`);
      closeModal();
      navigate(App.route);
    } catch (err) {
      alert(err.message || 'No se pudo asignar este engrase.');
    }
  });
  $('#btn-cancel-assign')?.addEventListener('click', async () => {
    if (!confirm('¿Cancelar esta asignación? El engrase vuelve a su flujo normal.')) return;
    await cancelGreaseAssignment(current, equipo);
    showInAppToast('✓ Asignación cancelada');
    closeModal();
    navigate(App.route);
  });
}

/* ---------- Mover PERMANENTEMENTE un equipo a otra ubicación — distinto de
   asignar un engrase puntual (ver openAssignGreaseModal()). Solo ADMIN/
   PLANIFICADOR, ver canMoveEquipment(). ---------- */
async function openMoveEquipmentLocationModal(equipo) {
  const locations = await DB.allActive('locations');
  const { assignments, plansByEquipoId } = await loadAssignmentContext();
  const occurrenceKey = equipoOccurrenceKey(equipo, plansByEquipoId);
  const activeAssignment = occurrenceKey ? findActivePendingAssignment(assignments, occurrenceKey) : null;

  openModal(`Mover ubicación · ${esc(equipo.code)}`, `
    <p class="dim">Esto mueve <b>permanentemente</b> el equipo a otra ubicación — distinto de asignar un engrase puntual a otra cuadrilla. Queda registrado en la auditoría.</p>
    ${activeAssignment ? '<div class="qr-info-alert">Este equipo tiene una asignación manual de engrase pendiente.</div>' : ''}
    <form id="move-eq-form">
      <label>Nueva ubicación
        <select name="locationId" required>
          <option value="">— Selecciona —</option>
          ${locations.map(l => `<option value="${l.id}" ${l.id === equipo.locationId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
        </select>
      </label>
      ${activeAssignment ? `
      <label class="check-row" style="margin-top:8px">
        <input type="checkbox" class="chk-done" name="cancelAssignment" checked/>
        <span class="check-row-text">Cancelar la asignación pendiente al mover (recomendado)</span>
      </label>` : ''}
      <div class="modal-actions"><button type="submit" class="btn btn-accent">${ic("check")}Mover</button></div>
    </form>
  `);
  $('#move-eq-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const locationId = fd.get('locationId');
    if (!locationId) { alert('Selecciona una ubicación.'); return; }
    if (locationId === equipo.locationId) { closeModal(); return; }
    if (activeAssignment && fd.get('cancelAssignment')) {
      await cancelGreaseAssignment(activeAssignment, equipo);
    }
    await moverEquipoDeUbicacion(equipo, locationId, locations);
    showInAppToast(`✓ ${esc(equipo.code)} movido de ubicación`);
    closeModal();
    navigate(App.route);
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
  if (!c) return; // la pantalla ya no está en el documento (cambio de vista o de usuario)
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
  // Asignar a cuadrilla es una acción DISTINTA de editar el plan (canEdit) —
  // SUPERVISOR también puede asignar, aunque no configure planes (§AB).
  const canAssign = canManageAssignments(App.currentUser.role);
  const statusByEquipoId = {};
  if (canAssign) (await computeAllStatuses(equipos)).forEach(({ e, s }) => { statusByEquipoId[e.id] = s; });
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
        <thead><tr>${canEdit ? '<th></th>' : ''}<th>Código</th><th>Equipo</th><th>Control</th><th>Frecuencia / Días</th><th>Referencia</th><th>Puntos</th><th></th>${canAssign ? '<th></th>' : ''}</tr></thead>
        <tbody>
          ${(await Promise.all(equipos.map(async e => {
            const plan = plans.find(p => p.equipmentId === e.id);
            // Los puntos se cargan UNA vez fuera del bucle (antes se recargaba la tabla
            // completa por cada equipo: con 300 equipos eran 300 lecturas de 4.500 puntos).
            const points = plan ? (puntosPorPlan[plan.id] || []) : [];
            const isWeekday = plan && plan.controlType === 'Día y turno de la semana';
            const st = statusByEquipoId[e.id];
            const puedeAsignar = canAssign && plan && st && (st.code === 'ROJO' || st.code === 'AMARILLO');
            return `<tr data-row-id="${e.id}">
              ${canEdit ? `<td><input type="checkbox" class="plan-bulk-check ${bulkMode ? '' : 'hidden'}" data-id="${e.id}"/></td>` : ''}
              <td class="mono">${esc(e.code)}</td>
              <td>${esc(e.brand)} ${esc(e.model)}</td>
              <td>${plan ? plan.controlType : '—'}</td>
              <td class="mono">${plan ? (isWeekday ? (plan.assignedDays || []).map(d => d.slice(0, 3)).join(', ') || 'sin días' : plan.frequency + ' h') : '—'}</td>
              <td class="mono">${plan ? (isWeekday ? '—' : fmt(plan.lastGreaseHour) + ' h · alerta ' + plan.alertYellowHours + ' h') : '—'}</td>
              <td>${points.length}</td>
              <td><button class="btn btn-sm" data-eq="${e.id}" data-plan="${plan ? plan.id : ''}">${ic("edit")}Configurar</button></td>
              ${canAssign ? `<td>${puedeAsignar ? `<button class="btn btn-sm" data-assign-eq="${e.id}">${ic("clock")}Asignar a cuadrilla</button>` : ''}</td>` : ''}
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
  $$('button[data-assign-eq]', c).forEach(btn => {
    btn.addEventListener('click', () => {
      const eq = equipos.find(x => x.id === btn.dataset.assignEq);
      if (eq) openAssignGreaseModal(eq);
    });
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
        <span><b style="background:#00B050;color:#fff;padding:2px 6px">REALIZADO</b> = se hizo</span>
        <span><b style="background:#C00000;color:#fff;padding:2px 6px">NO REALIZADO</b> = le tocaba y no se hizo</span>
        <span><b style="background:#F4B183;padding:2px 6px">naranja</b> = pendiente / programado</span>
        <span>vacío = no le corresponde ese día</span>
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
        <label>Frecuencia (horas)<input required type="number" min="1" max="5000" name="frequency" value="50"/></label>
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

    // Misma validación que en el plan individual: frecuencia 0 dejaría a TODOS los
    // equipos seleccionados marcados como vencidos de forma permanente.
    if (!weekday && (!frequency || frequency <= 0)) {
      alert('La frecuencia debe ser mayor que 0 horas. Si estos equipos no se controlan por horas, usa el tipo "Día y turno de la semana".');
      return;
    }
    if (!weekday && frequency > 5000) {
      alert('Esa frecuencia parece un error de digitación (más de 5000 horas). Verifícala antes de aplicar.');
      return;
    }

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
  // Gap de Storage privado cerrado (ver docs/STORAGE_PRIVACY_DESIGN.md §7):
  // la miniatura de un punto puede venir de otro dispositivo (URL/path de
  // Storage, no base64 local) — se resuelve ANTES de armar el HTML, igual
  // que Reportes/firma de validación.
  const pointPhotoSrcs = await Promise.all(points.map(p => resolveEvidenceSrc(p.photo)));

  openModal(`Plan de engrase · ${esc(equipment.code)}`, `
    <form id="plan-form" class="form-grid">
      <label class="span-2">Tipo de control
        <select name="controlType" id="plan-control-type">
          ${['Horas de operación', 'Día y turno de la semana'].map(o => `<option ${plan && plan.controlType === o ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
        <span class="field-hint">Usa "Día y turno de la semana" para equipos donde no se registra horómetro a diario — se controla por calendario en vez de por horas.</span>
      </label>

      <div id="hours-fields" class="span-2 form-grid ${isWeekday ? 'hidden' : ''}" style="padding:0">
        <label>Frecuencia (horas)<input required type="number" min="1" max="5000" name="frequency" value="${plan ? plan.frequency : 50}"/></label>
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
      ${points.map((p, i) => pointRow(p, lubricants, pointPhotoSrcs[i])).join('') || '<div class="empty-state">Sin puntos configurados.</div>'}
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

      // Una frecuencia de 0 (o vacía) dejaría el equipo marcado como vencido para
      // siempre, sin forma de cumplirlo. Se valida aquí y no solo en el campo HTML,
      // porque los datos también pueden entrar por importación o sincronización.
      if (!obj.frequency || obj.frequency <= 0) {
        alert('La frecuencia debe ser mayor que 0 horas. Si el equipo no se controla por horas, usa el tipo "Día y turno de la semana".');
        return;
      }
      if (obj.frequency > 5000) {
        alert('Esa frecuencia parece un error de digitación (más de 5000 horas). Verifícala antes de guardar.');
        return;
      }
      if (isNaN(obj.lastGreaseHour) || obj.lastGreaseHour < 0) {
        alert('El horómetro del último engrase debe ser un número válido y positivo.');
        return;
      }
      // El horómetro de referencia no puede ser MAYOR al horómetro actual del equipo:
      // eso daría un margen falso y ocultaría un vencimiento real.
      if (obj.lastGreaseHour > equipment.hourmeter) {
        if (!confirm(`El horómetro del último engrase (${fmt(obj.lastGreaseHour)} h) es MAYOR que el horómetro actual del equipo (${fmt(equipment.hourmeter)} h).\n\nEso haría que el equipo parezca al día cuando quizá no lo está. ¿Seguro que los datos son correctos?`)) return;
      }
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

function pointRow(p, lubricants, resolvedPhotoSrc) {
  const lub = lubricants.find(l => l.id === p.greaseType);
  return `<div class="point-row">
    ${p.photo ? photoThumbHTML(resolvedPhotoSrc !== undefined ? resolvedPhotoSrc : p.photo, p.point) : ''}
    <div><b>${esc(p.point)}</b><div class="dim">${lub ? lub.name : ''} · ${p.recommendedQty} ${GREASE_UNIT}</div></div>
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
    const planOrigen = plans.find(p => p.id === planId);
    const resumenPlan = planOrigen
      ? (planOrigen.controlType === 'Día y turno de la semana'
          ? `Por día y turno · ${(planOrigen.assignedDays || []).join(', ') || 'sin días'}`
          : `Por horas · cada ${fmt(planOrigen.frequency)} h · avisa ${fmt(planOrigen.alertYellowHours)} h antes`)
      : '';
    $('#copy-preview').innerHTML = `
      ${planOrigen ? `
        <label class="copy-plan-opcion">
          <input type="checkbox" id="copy-tambien-plan" checked/>
          <span><b>Copiar también la configuración del plan</b><br/>
            <span class="dim">${esc(resumenPlan)}</span><br/>
            <span class="dim" style="font-size:11px">Si lo desmarcas, solo se copian los puntos y este equipo conserva su frecuencia actual.</span>
          </span>
        </label>` : ''}
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

    // Si se pidió, el plan destino adopta la frecuencia/días del plan de origen
    let planCopiado = false;
    if ($('#copy-tambien-plan')?.checked) {
      const origen = plans.find(p => p.id === $('#copy-source').value);
      if (origen) {
        plan.controlType = origen.controlType;
        if (origen.controlType === 'Día y turno de la semana') {
          plan.assignedDays = [...(origen.assignedDays || [])];
          plan.frequency = 0;
        } else {
          plan.frequency = origen.frequency;
          plan.alertYellowHours = origen.alertYellowHours;
          // lastGreaseHour NO se copia: es el horómetro real de ESTE equipo, no del otro
        }
        await DB.put('lubrication_plans', stamp(plan, App.currentUser.name));
        planCopiado = true;
      }
    }

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
    showInAppToast(`✓ ${copiados} punto(s) copiados${planCopiado ? ' + configuración del plan' : ''}${repetidos ? ` · ${repetidos} ya existían y se omitieron` : ''}`);
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
            <label>Cantidad recomendada (${GREASE_UNIT})<input type="number" step="0.1" name="recommendedQty" value="${p.recommendedQty}"/></label>
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
  if (!c) return; // la pantalla ya no está en el documento (cambio de vista o de usuario)
  const equipos = await DB.allActive('equipment');
  const plans = await DB.allActive('lubrication_plans');
  const records = await DB.allActive('lubrication_records');
  const types = await DB.allActive('equipment_types');
  const locations = await DB.allActive('locations');
  // TODAS (no solo activas) — solo para el modal "Equipos sin plan" de abajo
  // (mismo bug real que renderDashboard, ver DATA-PENDING-A02 en
  // docs/BUG_REGISTER.md). `types`/`locations` de arriba siguen
  // activas-solo: alimentan los <select> de filtro de esta pantalla.
  const typesAll = await DB.all('equipment_types');
  const locationsAll = await DB.all('locations');

  // Semana visible (se puede navegar hacia atrás/adelante)
  if (!App.matrizOffset) App.matrizOffset = 0;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const lunes = new Date(hoy);
  lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7) + (App.matrizOffset * 7));
  const dias = [];
  for (let i = 0; i < 7; i++) { const d = new Date(lunes); d.setDate(lunes.getDate() + i); dias.push(d); }
  const finSemana = new Date(dias[6]); finSemana.setHours(23, 59, 59, 999);

  // Presentación compacta del rango — SOLO formato de texto, misma semana
  // calculada arriba (nunca se recalculan los días). "21–27 Sep" o, si la
  // semana cruza de mes, "29 Sep – 5 Oct".
  const MESES_ABBR_MTZ = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const rangoCompacto = dias[0].getMonth() === dias[6].getMonth()
    ? `${dias[0].getDate()}–${dias[6].getDate()} ${MESES_ABBR_MTZ[dias[0].getMonth()]}`
    : `${dias[0].getDate()} ${MESES_ABBR_MTZ[dias[0].getMonth()]} – ${dias[6].getDate()} ${MESES_ABBR_MTZ[dias[6].getMonth()]}`;

  const filtroTurno = App.matrizTurno || '';
  const filtroTipo = App.matrizTipo || '';
  const filtroUbic = App.matrizUbic || '';

  let visibles = equipos.filter(e => {
    if (filtroTurno && e.shiftId !== filtroTurno) return false;
    if (filtroTipo && e.typeId !== filtroTipo) return false;
    if (filtroUbic && e.locationId !== filtroUbic) return false;
    return true;
  });
  // Equipos SIN NINGÚN plan (ni día/turno ni horas), dentro de los mismos
  // filtros turno/tipo/ubicación — no aparecen como filas en esta matriz (no
  // tienen días asignados), así que se resumen en un aviso aparte (D, mismo
  // criterio y modal que el KPI del Dashboard, sin duplicar lógica).
  const sinPlan = visibles.filter(e => !plans.some(p => p.equipmentId === e.id));
  // Solo equipos con plan por día/turno (los que tienen días asignados)
  visibles = visibles.filter(e => {
    const p = plans.find(pl => pl.equipmentId === e.id);
    return p && p.controlType === 'Día y turno de la semana' && (p.assignedDays || []).length;
  }).sort((a, b) => (a.shiftId || '').localeCompare(b.shiftId || '') || a.code.localeCompare(b.code));

  // estadoCelda() se movió a src/core/weekly-matrix.js (lógica pura, sin DOM
  // ni IndexedDB) — ver docs/MODULARIZATION.md. Aquí solo se le pasan los
  // datos ya cargados (plans, records, hoy).

  // "Hecho" para efectos de cumplimiento incluye las 3 variantes reales de
  // trabajo completado (a tiempo, atrasado en otro turno, o adelantado por
  // fuera de plan) — antes solo se contaba 'hecho' a secas, así que
  // hecho_adelantado (ya existía) y hecho_atrasado (nuevo) quedaban
  // invisibles en el % de cumplimiento aunque el trabajo SÍ se hizo.
  const TIPOS_HECHO = ['hecho', 'hecho_atrasado', 'hecho_adelantado'];
  const esTipoHecho = tipo => TIPOS_HECHO.includes(tipo);

  // Resumen por turno (D/N) para el subtítulo del header azul — SOLO reusa
  // estadoCelda()/la MISMA fórmula de cumplimiento ya usada arriba (hechas/
  // (hechas+no_realizado+pendiente)), aplicada al subconjunto de ese turno.
  // No es un cálculo nuevo, es el mismo agregado con un `lista` distinto.
  function resumenTurno(lista) {
    const contarT = tipo => lista.reduce((n, eq) => n + dias.filter(d => estadoCelda(eq, d, plans, records, hoy).tipo === tipo).length, 0);
    const hechasT = lista.reduce((n, eq) => n + dias.filter(d => esTipoHecho(estadoCelda(eq, d, plans, records, hoy).tipo)).length, 0);
    const yaVencidasT = hechasT + contarT('no_realizado') + contarT('pendiente');
    return { equipos: lista.length, pct: yaVencidasT ? Math.round((hechasT / yaVencidasT) * 100) : 100 };
  }

  const tablaTurno = (titulo, lista) => {
    if (!lista.length) return '';
    const r = resumenTurno(lista);
    return `
      <div class="matriz-wrap">
        <table class="matriz">
          <thead>
            <tr><th colspan="${dias.length + 1}" class="matriz-titulo">${esc(titulo)}<div class="matriz-titulo-resumen">${r.equipos} equipo${r.equipos === 1 ? '' : 's'} · ${r.pct}%</div></th></tr>
            <tr>
              <th class="matriz-eq">Equipo / No.</th>
              ${dias.map(d => {
                const esHoy = d.toDateString() === hoy.toDateString();
                return `<th${esHoy ? ' class="is-today"' : ''}>${WEEKDAY_NAMES[d.getDay()]}<div class="matriz-fecha">${d.getDate()}/${d.getMonth() + 1}</div>${esHoy ? '<div class="matriz-hoy-tag">HOY</div>' : ''}</th>`;
              }).join('')}
            </tr>
          </thead>
          <tbody>
            ${lista.map(eq => `
              <tr>
                <td class="matriz-eq mono">${esc(eq.code)}${eq.shortCode ? ` / ${esc(eq.shortCode)}` : ''}</td>
                ${dias.map(d => {
                  const esHoy = d.toDateString() === hoy.toDateString();
                  const hoyCls = esHoy ? ' is-today' : '';
                  const s = estadoCelda(eq, d, plans, records, hoy);
                  if (s.tipo === 'hecho') return `<td class="celda-hecho${hoyCls}" title="Realizado por ${esc(s.por)} · ${fmtDate(s.fecha)}">REALIZADO</td>`;
                  // Corrección real (lote occurrences/carryover): estas dos celdas
                  // NUNCA se habían wireado aquí — caían al <td> en blanco del
                  // final, sin etiqueta ni color, aunque estadoCelda() ya las
                  // distinguía desde antes (hecho_adelantado) o recién ahora
                  // (hecho_atrasado).
                  if (s.tipo === 'hecho_atrasado') return `<td class="celda-hecho-atrasado${hoyCls}" title="Realizado atrasado (turno distinto al planificado) por ${esc(s.por)} · ${fmtDate(s.fecha)}">REALIZADO ATRASADO</td>`;
                  if (s.tipo === 'hecho_adelantado') return `<td class="celda-hecho-adelantado${hoyCls}" title="Satisfecho por adelantado por ${esc(s.por)} · ${fmtDate(s.fecha)}">REALIZADO ADELANTADO</td>`;
                  if (s.tipo === 'no_realizado') return `<td class="celda-no-realizado${hoyCls}" title="Le tocaba hace ${s.diasAtras} día(s) y no se registró">NO REALIZADO</td>`;
                  if (s.tipo === 'pendiente') return `<td class="celda-pendiente${hoyCls}" title="Le toca HOY, aún sin registrar">PENDIENTE HOY</td>`;
                  if (s.tipo === 'pausado') return `<td class="celda-pausado${hoyCls}" title="Equipo ${esc(s.status)} — no se proyecta mientras no esté operativo">PAUSADO</td>`;
                  if (s.tipo === 'futuro') return `<td class="celda-futuro${hoyCls}" title="Programado para este día"></td>`;
                  return `<td class="${hoyCls.trim()}"></td>`;
                }).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  };

  const delDia = visibles.filter(e => e.shiftId === 'shift_dia');
  const deNoche = visibles.filter(e => e.shiftId === 'shift_noche');

  // Conteos de la semana visible
  const contar = tipo => visibles.reduce((n, eq) => n + dias.filter(d => estadoCelda(eq, d, plans, records, hoy).tipo === tipo).length, 0);
  const totalCeldas = visibles.reduce((n, eq) => n + dias.filter(d => estadoCelda(eq, d, plans, records, hoy).tipo !== 'vacio').length, 0);
  const hechas = visibles.reduce((n, eq) => n + dias.filter(d => esTipoHecho(estadoCelda(eq, d, plans, records, hoy).tipo)).length, 0);
  const noRealizadas = contar('no_realizado');
  const pendientes = contar('pendiente');
  const futuras = contar('futuro');
  const pausadas = contar('pausado');
  // El cumplimiento se mide solo sobre lo que YA debió hacerse (lo de más adelante en
  // la semana todavía no cuenta en contra). Antes lo futuro bajaba el porcentaje
  // injustamente: un lunes marcaba 17% aunque no se hubiera incumplido nada.
  const yaVencidas = hechas + noRealizadas + pendientes;
  const pct = yaVencidas ? Math.round((hechas / yaVencidas) * 100) : 100;

  c.innerHTML = `
    <div class="layout-wide">
    <div class="toolbar mtz-nav-row">
      <button class="btn btn-sm mtz-nav-btn" id="mtz-prev" aria-label="Semana anterior" title="Semana anterior">‹<span class="mtz-nav-label"> Semana anterior</span></button>
      <span class="matriz-rango">${rangoCompacto}${App.matrizOffset === 0 ? ' · Semana actual' : ''}</span>
      <button class="btn btn-sm mtz-nav-btn" id="mtz-next" aria-label="Semana siguiente" title="Semana siguiente"><span class="mtz-nav-label">Semana siguiente </span>›</button>
      ${App.matrizOffset !== 0 ? `<button class="btn btn-sm" id="mtz-hoy">Ir a hoy</button>` : ''}
      <button class="btn btn-sm btn-accent" id="mtz-print">${ic("print")}Imprimir</button>
      <button class="btn btn-sm" id="mtz-excel">${ic("download")}Descargar Excel</button>
    </div>

    <div class="mtz-filters-toggle-row">
      <button type="button" class="btn btn-sm" id="mtz-filters-toggle" aria-expanded="false" aria-controls="mtz-filters-panel">Filtros <span class="mtz-toggle-chevron">▾</span></button>
    </div>
    <div class="toolbar mtz-filters-row mtz-collapsible-mobile mtz-collapsed-mobile" id="mtz-filters-panel">
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
      ${kpiCard('NO REALIZADOS', noRealizadas, noRealizadas ? 'red' : 'neutral')}
      ${kpiCard('PENDIENTES HOY', pendientes, pendientes ? 'amber' : 'neutral')}
      ${kpiCard('PAUSADOS', pausadas, 'neutral')}
      ${kpiCard('CUMPLIMIENTO %', pct, pct >= App.generalSettings.complianceTarget ? 'green' : 'red')}
    </div>

    ${sinPlan.length ? `
    <button type="button" class="mtz-sin-plan-note" id="mtz-sin-plan-btn">
      ${ic('alert')}${sinPlan.length} equipo(s) sin plan de engrase — no aparecen en esta matriz
    </button>` : ''}

    ${visibles.length ? `
      ${tablaTurno('PLAN DE ENGRASE (TURNO DÍA)', delDia)}
      ${tablaTurno('PLAN DE ENGRASE (TURNO NOCHE)', deNoche)}
      <div class="mtz-legend-toggle-row">
        <button type="button" class="btn btn-sm" id="mtz-legend-toggle" aria-expanded="false" aria-controls="mtz-legend">Ver leyenda <span class="mtz-toggle-chevron">▾</span></button>
      </div>
      <div class="color-legend mtz-collapsible-mobile mtz-collapsed-mobile" id="mtz-legend">
        <span class="color-legend-item"><span class="dot" style="background:#00B050"></span>Realizado</span>
        <span class="color-legend-item"><span class="dot" style="background:#C00000"></span>No realizado (día ya pasado)</span>
        <span class="color-legend-item"><span class="dot" style="background:#F4B183"></span>Pendiente hoy</span>
        <span class="color-legend-item"><span class="dot" style="background:#F4B183; opacity:0.5"></span>Programado más adelante</span>
        <span class="color-legend-item"><span class="dot" style="background:var(--gray-status)"></span>Pausado (equipo no operativo)</span>
        <span class="color-legend-item"><span class="dot" style="background:var(--border)"></span>No le toca ese día</span>
      </div>`
    : `<div class="panel"><div class="empty-state">No hay equipos con plan por "Día y turno de la semana" que coincidan con estos filtros.<br/>Esta vista solo muestra equipos con días asignados — configúralos en Plan de Engrase.</div></div>`}
    </div>
  `;

  $('#mtz-sin-plan-btn')?.addEventListener('click', () => openSinPlanModal(sinPlan, typesAll, locationsAll));
  $('#mtz-filters-toggle')?.addEventListener('click', (e) => {
    const abierto = $('#mtz-filters-panel').classList.toggle('mtz-collapsed-mobile') === false;
    e.currentTarget.setAttribute('aria-expanded', String(abierto));
  });
  $('#mtz-legend-toggle')?.addEventListener('click', (e) => {
    const abierto = $('#mtz-legend').classList.toggle('mtz-collapsed-mobile') === false;
    e.currentTarget.setAttribute('aria-expanded', String(abierto));
  });
  $('#mtz-prev').addEventListener('click', () => { App.matrizOffset--; renderMatrizSemanal(); });
  $('#mtz-next').addEventListener('click', () => { App.matrizOffset++; renderMatrizSemanal(); });
  $('#mtz-hoy')?.addEventListener('click', () => { App.matrizOffset = 0; renderMatrizSemanal(); });
  $('#mtz-turno').addEventListener('change', e => { App.matrizTurno = e.target.value; renderMatrizSemanal(); });
  $('#mtz-tipo').addEventListener('change', e => { App.matrizTipo = e.target.value; renderMatrizSemanal(); });
  $('#mtz-ubic').addEventListener('change', e => { App.matrizUbic = e.target.value; renderMatrizSemanal(); });

  // Al entrar (o cambiar de semana/filtro), desliza cada tabla hasta la
  // columna HOY si está dentro de la semana mostrada — sin esto quedaba
  // fuera de vista a la derecha del scroll horizontal en móvil, obligando a
  // deslizar a ciegas para encontrarla. Nunca toca el layout de la tabla
  // (sigue siendo tabla, sigue siendo scroll horizontal).
  $$('.matriz-wrap').forEach((wrap) => {
    const hoyTh = wrap.querySelector('th.is-today');
    if (hoyTh) hoyTh.scrollIntoView({ block: 'nearest', inline: 'center' });
  });

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
      .matriz-titulo-resumen{font-weight:normal;font-size:9px;letter-spacing:normal;text-transform:none;opacity:.85;margin-top:2px}
      table.matriz thead tr:nth-child(2) th{background:#F2F2F2 !important;font-weight:bold}
      table.matriz thead tr:nth-child(2) th.is-today{background:#FCEBC9 !important}
      .matriz-hoy-tag{font-size:7.5px;color:#C55A11;font-weight:bold}
      .matriz-eq{text-align:left !important;font-weight:bold;white-space:nowrap;background:#F2F2F2 !important}
      .matriz-fecha{font-weight:normal;font-size:8.5px;color:#666}
      /* Doble seguro: además del color de fondo, cada celda lleva un símbolo y un borde
         distinto, para que la hoja se entienda aunque el navegador imprima sin colores
         (pasa cuando "Gráficos de fondo" está desactivado en el diálogo de impresión). */
      .celda-hecho{background:#00B050 !important;color:#fff !important;font-weight:bold;font-style:italic;border:2px solid #00703C !important}
      .celda-no-realizado{background:#C00000 !important;color:#fff !important;font-weight:bold;border:2px solid #7F0000 !important}
      .celda-pendiente{background:#F4B183 !important;border:2px dashed #C55A11 !important;font-size:8px;font-weight:bold;color:#7A3B0A}
      .celda-futuro{background:#F4B183 !important;border:2px dashed #C55A11 !important}
      .aviso-color{font-size:9px;color:#888;border:1px dashed #bbb;padding:4px 8px;margin-bottom:10px;border-radius:4px}
      @media print{.aviso-color{display:none}}
      .leyenda{margin-top:10px;font-size:9.5px;display:flex;gap:16px;align-items:center}
      .leyenda span{display:inline-flex;align-items:center;gap:5px}
      .lg{width:14px;height:11px;border:1px solid #333;display:inline-block}
      .matriz-wrap{overflow:visible}
    </style></head><body>
      <h1>Plan de Engrase — Semana ${dias[0].getDate()}/${dias[0].getMonth() + 1} al ${dias[6].getDate()}/${dias[6].getMonth() + 1}/${dias[6].getFullYear()}</h1>
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
    if (!window.XLSX) { alert('No se pudo cargar el generador de Excel. Revisa tu conexión la primera vez que uses esta función.'); return; }

    // Genera un .xlsx REAL con colores. Antes se producía un archivo HTML renombrado a
    // .xls: Excel lo abría con una advertencia de seguridad y no siempre respetaba el
    // formato. La librería xlsx-js-style sí escribe estilos dentro del archivo.
    const borde = { style: 'thin', color: { rgb: '333333' } };
    const bordes = { top: borde, bottom: borde, left: borde, right: borde };
    const filas = [];
    const merges = [];
    const nCols = dias.length + 1;

    const celda = (v, estilo) => ({ v, t: 's', s: estilo });
    const vacia = () => celda('', { border: bordes });

    // Encabezado del documento
    filas.push([celda(`Plan de Engrase — Semana ${dias[0].getDate()}/${dias[0].getMonth() + 1} al ${dias[6].getDate()}/${dias[6].getMonth() + 1}/${dias[6].getFullYear()}`,
      { font: { bold: true, sz: 15 } })]);
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: nCols - 1 } });
    filas.push([celda(`Generado el ${fmtDate(nowISO())} por ${App.currentUser.name} · Cumplimiento ${pct}% (${hechas} de ${totalCeldas})`,
      { font: { sz: 9, color: { rgb: '666666' } } })]);
    merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: nCols - 1 } });
    filas.push([]);

    const bloque = (titulo, lista) => {
      if (!lista.length) return;
      const filaTitulo = filas.length;
      const fila = [celda(titulo, {
        font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '1F3864' } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: bordes
      })];
      for (let i = 1; i < nCols; i++) fila.push(celda('', { fill: { fgColor: { rgb: '1F3864' } }, border: bordes }));
      filas.push(fila);
      merges.push({ s: { r: filaTitulo, c: 0 }, e: { r: filaTitulo, c: nCols - 1 } });

      const estiloCab = {
        font: { bold: true, sz: 10 },
        fill: { fgColor: { rgb: 'F2F2F2' } },
        alignment: { horizontal: 'center', wrapText: true },
        border: bordes
      };
      filas.push([
        celda('Equipo / No.', estiloCab),
        ...dias.map(d => celda(`${WEEKDAY_NAMES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`, estiloCab))
      ]);

      lista.forEach(eq => {
        const fila = [celda(`${eq.code}${eq.shortCode ? ' / ' + eq.shortCode : ''}`, {
          font: { bold: true, sz: 10 },
          fill: { fgColor: { rgb: 'F2F2F2' } },
          border: bordes
        })];
        dias.forEach(d => {
          const s = estadoCelda(eq, d, plans, records, hoy);
          if (s.tipo === 'hecho') {
            fila.push(celda('REALIZADO', {
              font: { bold: true, italic: true, sz: 9, color: { rgb: 'FFFFFF' } },
              fill: { fgColor: { rgb: '00B050' } },
              alignment: { horizontal: 'center', vertical: 'center' },
              border: bordes
            }));
          } else if (s.tipo === 'hecho_atrasado') {
            fila.push(celda('REALIZADO ATRASADO', {
              font: { bold: true, italic: true, sz: 8, color: { rgb: 'FFFFFF' } },
              fill: { fgColor: { rgb: '2DB6A3' } },
              alignment: { horizontal: 'center', vertical: 'center' },
              border: bordes
            }));
          } else if (s.tipo === 'hecho_adelantado') {
            fila.push(celda('REALIZADO ADELANTADO', {
              font: { bold: true, italic: true, sz: 8, color: { rgb: 'FFFFFF' } },
              fill: { fgColor: { rgb: '5B7FBF' } },
              alignment: { horizontal: 'center', vertical: 'center' },
              border: bordes
            }));
          } else if (s.tipo === 'no_realizado') {
            fila.push(celda('NO REALIZADO', {
              font: { bold: true, sz: 9, color: { rgb: 'FFFFFF' } },
              fill: { fgColor: { rgb: 'C00000' } },
              alignment: { horizontal: 'center', vertical: 'center' },
              border: bordes
            }));
          } else if (s.tipo === 'pendiente') {
            fila.push(celda('PENDIENTE HOY', {
              font: { bold: true, sz: 8, color: { rgb: '7A3B0A' } },
              fill: { fgColor: { rgb: 'F4B183' } },
              alignment: { horizontal: 'center', vertical: 'center' },
              border: bordes
            }));
          } else if (s.tipo === 'vacio') {
            fila.push(vacia());
          } else {
            fila.push(celda('', { fill: { fgColor: { rgb: 'F4B183' } }, border: bordes }));
          }
        });
        filas.push(fila);
      });
      filas.push([]);
    };

    bloque('PLAN DE ENGRASE (TURNO DÍA)', delDia);
    bloque('PLAN DE ENGRASE (TURNO NOCHE)', deNoche);
    filas.push([celda('Leyenda: verde = realizado · rojo = NO realizado (le tocaba y no se hizo) · naranja = pendiente o programado · vacío = no le corresponde ese día',
      { font: { sz: 9, color: { rgb: '666666' } } })]);

    const ws = XLSX.utils.aoa_to_sheet(filas.map(f => f.map(c => (c ? c.v : ''))));
    // Se vuelven a aplicar los estilos celda por celda (aoa_to_sheet solo guarda valores)
    filas.forEach((fila, r) => fila.forEach((cel, col) => {
      if (!cel) return;
      const ref = XLSX.utils.encode_cell({ r, c: col });
      if (!ws[ref]) ws[ref] = { v: cel.v, t: 's' };
      ws[ref].s = cel.s;
    }));
    ws['!merges'] = merges;
    ws['!cols'] = [{ wch: 20 }, ...dias.map(() => ({ wch: 13 }))];
    ws['!rows'] = filas.map(() => ({ hpt: 20 }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Plan semanal');
    XLSX.writeFile(wb, `plan_engrase_${dias[0].getDate()}-${dias[0].getMonth() + 1}-${dias[6].getFullYear()}.xlsx`);
    showInAppToast('✓ Excel descargado con colores');
  });
}

/* ============================================================
   ENGRASE DEL TURNO
   ============================================================ */
async function renderTurno() {
  const c = $('#app-content');
  if (!c) return; // la pantalla ya no está en el documento (cambio de vista o de usuario)
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
      <table class="data-table turno-table">
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
  if (!c) return; // la pantalla ya no está en el documento (cambio de vista o de usuario)
  const equipos = await DB.allActive('equipment');
  // Equipos recientes: función YA existente (trackRecentEquipment()/
  // recentEquiposHTML(), reutilizada tal cual en Mi Turno y Equipos, ver
  // línea ~178) — se muestra aquí porque ya hay datos reales para hacerlo
  // (startGreaseFlow() ya llama trackRecentEquipment() al registrar), sin
  // inventar ninguna persistencia ni funcionalidad nueva.
  const recentsHTML = await recentEquiposHTML();
  c.innerHTML = `
    <div class="reg-select-wrap">
      <div class="reg-select-card">
        <h2 class="reg-select-title">Seleccionar equipo</h2>
        <p class="reg-select-subtitle">Busca y selecciona un equipo para registrar el engrase.</p>
        <div class="reg-eq-search">
          <input type="text" id="reg-eq-search" class="input" placeholder="Busca por código, marca o modelo…" autocomplete="off"/>
          <div id="reg-eq-search-results" class="reg-eq-search-results hidden"></div>
        </div>
        ${recentsHTML}
      </div>
    </div>
    <div id="reg-flow-area"></div>
  `;
  wireRegEquipoSearch(equipos, $('#reg-flow-area'));
  $$('.recents-chip', c).forEach(b => b.addEventListener('click', () => {
    const eq = equipos.find(e => e.id === b.dataset.recentId);
    if (eq) collapseRegSelectToChip(eq);
    startGreaseFlow(b.dataset.recentId, $('#reg-flow-area'));
  }));
}

// Selector compacto tras elegir equipo (cierre operativo §13) — el buscador
// + recientes ya no siguen ocupando espacio mientras se completa el
// formulario: se reemplazan por un chip fijo con la opción de "Cambiar"
// (vuelve a dibujar renderRegistrar() desde cero, el camino más simple y
// seguro — no intenta "deshacer" el chip a mano).
function collapseRegSelectToChip(equipo) {
  const card = document.querySelector('.reg-select-card');
  if (!card) return;
  card.innerHTML = `
    <div class="reg-select-chip">
      <span class="mono"><b>${esc(equipo.code)}</b> · ${esc(equipo.brand)} ${esc(equipo.model)}</span>
      <button type="button" class="btn btn-sm" id="reg-select-change">Cambiar</button>
    </div>`;
  $('#reg-select-change').addEventListener('click', () => renderRegistrar());
}

// Selector de equipo compacto (lote occurrences/carryover, §2) — escribir
// para filtrar en vez de desplazarse por un <select> con TODOS los equipos
// activos. Mismo patrón que wireQuickFind() (topbar), pero con su PROPIO
// contenedor/posicionamiento (ancho completo, no anclado a la derecha como
// el de la topbar) — no reutiliza .quick-find-results a propósito. Sin
// listener en `document` (esta pantalla se vuelve a dibujar completa en
// cada navegación — un listener global se acumularía); se cierra con
// blur (con margen para que el click en un resultado alcance a disparar
// antes) o Escape.
function wireRegEquipoSearch(equipos, flowArea) {
  const input = $('#reg-eq-search');
  const caja = $('#reg-eq-search-results');
  if (!input || !caja) return;
  let resultados = [];
  function buscar() {
    const q = input.value.trim().toLowerCase();
    if (!q) { caja.classList.add('hidden'); caja.innerHTML = ''; return; }
    resultados = equipos.filter(e =>
      (e.code || '').toLowerCase().includes(q) ||
      (e.shortCode || '').toLowerCase().includes(q) ||
      `${e.brand} ${e.model}`.toLowerCase().includes(q)
    ).slice(0, 8);
    if (!resultados.length) {
      caja.innerHTML = '<div class="qf-vacio">Ningún equipo coincide</div>';
      caja.classList.remove('hidden');
      return;
    }
    caja.innerHTML = resultados.map((e, i) => `
      <button type="button" class="qf-item" data-i="${i}">
        <span class="mono"><b>${esc(e.code)}</b>${e.shortCode ? ' · ' + esc(e.shortCode) : ''}</span>
        <span class="dim">${esc(e.brand)} ${esc(e.model)}</span>
      </button>`).join('');
    caja.classList.remove('hidden');
    $$('.qf-item', caja).forEach(b => b.addEventListener('mousedown', (ev) => {
      ev.preventDefault(); // evita que el blur del input se dispare ANTES del click y oculte la caja
      const eq = resultados[+b.dataset.i];
      caja.classList.add('hidden');
      collapseRegSelectToChip(eq);
      startGreaseFlow(eq.id, flowArea);
    }));
  }
  let temporizador;
  input.addEventListener('input', () => { clearTimeout(temporizador); temporizador = setTimeout(buscar, 150); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && resultados.length === 1) { ev.preventDefault(); $('.qf-item', caja)?.dispatchEvent(new MouseEvent('mousedown')); }
    if (ev.key === 'Escape') { input.value = ''; caja.classList.add('hidden'); }
  });
  input.addEventListener('blur', () => { caja.classList.add('hidden'); });
  input.addEventListener('focus', () => { if (resultados.length) caja.classList.remove('hidden'); });
}

// A dónde ir tras Finalizar Engrase (Validar ahora/después) — NUNCA usar
// navigate() a secas aquí: navigate() es el router de escritorio
// (renderTurno/renderHistorial de ADMIN) y, dentro del shell del
// Lubricador (.lub-shell), App.route suele seguir en 'turno' porque
// bootLubricador() lleva su propia navegación aparte (ver
// redibujarPantallaActual, mismo criterio) — llamar a navigate('turno') ahí
// terminaba pintando la tabla de escritorio "PLAN DE ENGRASE DEL TURNO"
// dentro de la pantalla del Lubricador. "Mi Turno" (trabajo por hacer) y
// "Mis Engrases" (trabajo ya hecho) son pantallas distintas — el destino
// correcto después de registrar SIEMPRE es Mis Engrases, reutilizando
// renderLubricadorHistorial() (misma vista de tarjetas, sin duplicarla).
function irAMisEngrasesTrasRegistrar() {
  App.lubricadorGreaseFlowActive = false; // el flujo terminó de verdad: llegó a Mis Engrases
  if (document.querySelector('.lub-shell')) {
    App.route = 'historial';
    $$('.lub-nav-item').forEach(x => {
      const active = x.dataset.route === 'historial';
      x.classList.toggle('active', active);
      if (active) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current');
    });
    renderLubricadorHistorial();
  } else {
    navigate(App.route);
  }
}

async function startGreaseFlow(equipmentId, target, options) {
  const outOfPlan = !!(options && options.outOfPlan);
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
  const allRecordsForEq = (await DB.allActive('lubrication_records'))
    .filter(r => r.equipmentId === equipmentId)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const todaysRecords = allRecordsForEq.filter(r => new Date(r.date).toDateString() === todayStr);
  const alreadyDoneToday = todaysRecords[0];
  const ultimoEngraseReg = allRecordsForEq[0] || null;
  const duplicateWarning = alreadyDoneToday && alreadyDoneToday.userId !== App.currentUser.id
    ? `<div class="duplicate-warning">⚠ Este equipo ya fue engrasado hoy por <b>${esc(alreadyDoneToday.userName)}</b> a las ${new Date(alreadyDoneToday.date).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' })}. Verifica con tu supervisor antes de registrar otro engrase, para no duplicar el trabajo.</div>`
    : '';

  const draftId = `draft_${equipmentId}_${App.currentUser.id}`;
  const draft = await DB.get('grease_drafts', draftId);

  // Contexto de ocurrencia (lote occurrences/carryover, §2): turno programado
  // por el plan vs. turno en el que se está registrando de verdad, y si esta
  // MISMA ocurrencia de hoy ya quedó marcada "no se pudo ejecutar" en un
  // turno anterior (carryover) — ver src/core/operational-scope.js. Solo
  // informativo aquí: NO bloquea el registro (si el turno no coincide, el
  // engrase se guarda igual y plan-compliance.js ya lo cuenta como
  // 'realizado_atrasado', no como incumplimiento).
  const todayISOReg = todayDateISO();
  const occurrenceKeyHoy = plan ? computeOccurrenceKey(plan, { dateISO: todayISOReg }) : null;
  const skipsActivosReg = await DB.allActive('lubrication_skips');
  const carriedOverSkip = occurrenceKeyHoy ? findCarriedOverSkipForToday(skipsActivosReg, { equipmentId, dateISO: todayISOReg }) : null;
  const turnoActualReg = currentShiftId();
  const turnoProgramadoReg = plan && plan.shiftId ? plan.shiftId : null;
  const turnoDistintoReg = !!(turnoProgramadoReg && turnoProgramadoReg !== turnoActualReg);
  const shiftLabel = (s) => s === 'shift_dia' ? 'Día' : 'Noche';

  // Contexto completo de la ocurrencia (cierre operativo §11/§12): código+
  // modelo/ubicación/tipo de trabajo/estado/programado/turno actual/último
  // engrase — TODO con datos reales ya cargados, nunca texto fijo. "Tipo de
  // trabajo" reutiliza findExistingWorkForEquipment() (operational-scope.js,
  // ya usado por el botón "+ Fuera de plan") en vez de reinventar la
  // prioridad ASSIGNED > PLANNED > (ninguno).
  const ubicacionReg = equipment.locationId ? (await DB.get('locations', equipment.locationId)) : null;
  const assignmentsActivosReg = await DB.allActive('lubrication_assignments');
  const trabajoReg = findExistingWorkForEquipment({
    plan, assignments: assignmentsActivosReg, statusCode: estadoPrevio, todayDate: new Date()
  });
  const TIPO_TRABAJO_LABELS = { ASSIGNED: 'Asignado', PLANNED: 'Planificado', NONE: plan ? 'Sin ocurrencia hoy' : 'Sin plan' };
  const tipoTrabajoLabelReg = outOfPlan ? 'Fuera de plan' : TIPO_TRABAJO_LABELS[trabajoReg.kind];
  const ESTADO_PREVIO_LABELS = { ROJO: 'Vencido', AMARILLO: 'Próximo a vencer', VERDE: 'Al día', GRIS: 'Sin plan / pausado' };
  const programadoLabelReg = !plan ? '—'
    : plan.controlType === 'Horas de operación' ? `Cada ${fmt(plan.frequency || 0)} h`
    : (plan.assignedDays || []).length ? `${plan.assignedDays.map(d => WEEKDAY_ABBR_DASH[d] || d).join(' · ')} · ${shiftLabel(plan.shiftId || turnoActualReg)}` : '—';
  const ultimoEngraseLabelReg = ultimoEngraseReg ? `${fmtDate(ultimoEngraseReg.date)} · ${fmt(ultimoEngraseReg.hourmeter)} h` : 'Nunca registrado';

  const OUT_OF_PLAN_REASON_LABELS = { PM: 'PM / Mantenimiento preventivo', CORRECTIVO: 'Mantenimiento correctivo', OPORTUNIDAD: 'Oportunidad operativa', OTRO: 'Otro' };
  const html = `
    <div class="grease-flow-panel">
      <div class="grease-flow-card grease-flow-equipo-card">
        ${outOfPlan ? `<span class="oop-badge">FUERA DE PLAN</span>` : ''}
        <div class="grease-flow-equipo-code">${esc(equipment.code)}</div>
        <div class="grease-flow-equipo-model">${esc(equipment.brand)} ${esc(equipment.model)}</div>
        <div class="grease-flow-equipo-meta">Registrado por ${esc(App.currentUser.name)} · ${fmtDate(nowISO())} · ${currentShiftId() === 'shift_dia' ? 'Turno Día' : 'Turno Noche'}</div>
        ${turnoDistintoReg ? `<div class="grease-flow-turno-warn">⚠ Turno programado: ${shiftLabel(turnoProgramadoReg)} · Registrando en turno ${shiftLabel(turnoActualReg)} — quedará como "Realizado atrasado".</div>` : ''}
        ${estadoPrevio === 'ROJO' ? `<div class="grease-flow-vencido-warn">⚠ Este equipo está VENCIDO — no se engrasó en el ciclo esperado.</div>` : ''}
        ${carriedOverSkip ? `<div class="grease-flow-carryover-warn">⚠ El turno ${shiftLabel(carriedOverSkip.shiftId)} no pudo ejecutar este engrase hoy — motivo: ${esc(NO_EXECUTION_REASON_LABELS[carriedOverSkip.reason] || carriedOverSkip.reason)}${carriedOverSkip.observacion ? ' · ' + esc(carriedOverSkip.observacion) : ''} (${esc(carriedOverSkip.userName)}).</div>` : ''}
        ${outOfPlan ? `<p class="dim" style="margin:6px 0 0">Este engrase no estaba programado para este momento.</p>` : ''}
        <dl class="grease-flow-contexto">
          <div><dt>Ubicación</dt><dd>${esc(ubicacionReg ? ubicacionReg.name : '—')}</dd></div>
          <div><dt>Tipo de trabajo</dt><dd>${esc(tipoTrabajoLabelReg)}</dd></div>
          <div><dt>Estado</dt><dd>${esc(ESTADO_PREVIO_LABELS[estadoPrevio] || estadoPrevio)}</dd></div>
          <div><dt>Programado</dt><dd>${esc(programadoLabelReg)}</dd></div>
          <div><dt>Turno actual</dt><dd>${shiftLabel(turnoActualReg)}</dd></div>
          <div><dt>Último engrase</dt><dd>${esc(ultimoEngraseLabelReg)}</dd></div>
        </dl>
      </div>
      ${outOfPlan ? `
      <div class="grease-flow-card">
        <h4 class="grease-flow-card-head">Motivo</h4>
        <div class="form-grid">
          <label class="span-2">Motivo del engrase fuera de plan
            <select required name="outOfPlanReason" id="oop-reason-select">
              ${OUT_OF_PLAN_REASONS.map(r => `<option value="${r}">${OUT_OF_PLAN_REASON_LABELS[r]}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>` : ''}
      ${duplicateWarning}
      ${draft ? `<div class="draft-banner" id="draft-banner">📝 Tienes un progreso sin terminar guardado ${fmtDate(draft.savedAt)}. <button type="button" class="btn btn-sm btn-accent" id="btn-restore-draft">Continuar</button> <button type="button" class="btn btn-sm" id="btn-discard-draft">Descartar</button></div>` : ''}
      <form id="grease-form" class="grease-flow-form">
        <div class="grease-flow-card">
          <h4 class="grease-flow-card-head">Horómetro</h4>
          <div class="grease-flow-hm-row">
            <label class="grease-flow-hm-field">Horómetro actual
              <input required type="number" step="0.1" inputmode="decimal" name="hourmeter" id="hourmeter-input" value="${equipment.hourmeter}" class="big-input"/>
            </label>
            <label class="grease-flow-toggle-row">
              <input type="checkbox" id="nohm-check" ${equipment.noHourmeter ? 'checked' : ''}/>
              <span>Sin horómetro / dañado</span>
            </label>
          </div>
          <div id="nohm-reason-wrap" class="hidden" style="margin-top:12px">
            <label>¿Por qué no se pudo leer?
              <select name="noHourmeterReason">
                ${['El equipo no tiene horómetro', 'Horómetro dañado', 'Pantalla ilegible / rota', 'Equipo apagado, no se pudo leer', 'Otro'].map(o => `<option>${o}</option>`).join('')}
              </select>
              <span class="field-hint">El engrase se registra igual. Queda anotado que no se pudo tomar el horómetro, y el plan por horas de este equipo no se recalcula.</span>
            </label>
          </div>
        </div>

        <div class="grease-flow-card">
          <h4 class="grease-flow-card-head">Lubricante utilizado</h4>
          <div class="form-grid grease-flow-lube-grid">
            <label>Tipo de grasa utilizada
              <select name="greaseType">${lubricants.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
            </label>
            <label>Cantidad utilizada (${GREASE_UNIT})<input type="number" step="0.1" inputmode="decimal" name="qty" value="0"/></label>
          </div>
          ${puedeRetroactivo ? `
          <details class="reg-advanced">
            <summary>Opciones avanzadas</summary>
            <div class="retro-box">
              <h5 class="grease-flow-retro-head">Registro retroactivo</h5>
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
            </div>
          </details>` : ''}
        </div>

        <div class="grease-flow-card">
          <div class="grease-flow-points-head">
            <h4 class="grease-flow-card-head">Puntos de engrase</h4>
            ${points.length ? `<button type="button" class="btn btn-sm" id="btn-check-all">${ic("check")}Marcar todos</button>` : ''}
          </div>
          ${points.length ? `<div class="checklist-progress"><div class="checklist-progress-fill" id="checklist-progress-fill" style="width:100%"></div></div><div class="dim" id="checklist-progress-text" style="padding:4px 4px 8px">${points.length} de ${points.length} puntos marcados</div>` : ''}
          <div id="checklist">
            ${points.length ? points.map(p => `
              <div class="checklist-item" data-point="${p.id}">
                <label class="check-row">
                  ${p.photo ? `<img src="${p.photo}" class="photo-thumb check-row-thumb" data-full="${p.photo}" data-caption="${esc(p.point)}" alt="Foto de ${esc(p.point)}"/>` : ''}
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
        </div>

        <div class="grease-flow-card">
          <h4 class="grease-flow-card-head">Condición del equipo</h4>
          <div class="form-grid">
            <label class="span-2">Condición encontrada
              <select name="condition">
                <option>Normal</option><option>Con desgaste</option><option>Requiere atención</option>
              </select>
            </label>
          </div>
        </div>

        <div class="grease-flow-card">
          <h4 class="grease-flow-card-head">Evidencia</h4>
          <div class="form-grid">
            <label class="span-2">Observaciones<textarea name="notes" rows="2"></textarea></label>
            ${photoFieldHTML()}
          </div>
        </div>

        <div class="grease-flow-final">
          <div class="modal-actions">
            ${!outOfPlan && trabajoReg.kind !== 'NONE' ? `<button type="button" class="btn" id="btn-no-ejecutado">No se pudo ejecutar</button>` : ''}
            <button type="button" class="btn" id="btn-report-anomaly">${ic("alert")}Reportar anomalía</button>
            <button type="submit" class="btn btn-accent btn-grease-submit">${ic("check")}Finalizar engrase</button>
          </div>
          <div class="dim" id="draft-save-indicator" style="text-align:right; margin-top:6px; min-height:14px"></div>
        </div>
      </form>
    </div>`;

  const area = target || (() => { navigate('registrar'); return $('#reg-flow-area'); })();
  if (target) {
    target.innerHTML = html;
  } else {
    // Se espera un instante a que la pantalla termine de dibujarse. Si para entonces el
    // usuario ya cambió de vista, el contenedor no existe: hay que comprobarlo antes de
    // escribir, o la app se rompe justo al tocar algo mientras carga.
    setTimeout(() => {
      const area = $('#reg-flow-area');
      if (!area) return; // el usuario se fue a otra pantalla; no hay nada que hacer
      area.innerHTML = html;
      wireGreaseForm();
    }, 30);
  }
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

  // "No se pudo ejecutar" (lote occurrences/carryover, §1) — NUNCA crea un
  // lubrication_record: guarda un lubrication_skips con motivo+observación
  // y vuelve a una pantalla estable. El carryover al turno siguiente es
  // automático (ver comentario de findCarriedOverSkipForToday() en
  // operational-scope.js) — esta función solo registra el motivo, no
  // reprograma nada del plan.
  function openNoExecutionForm() {
    openModal('No se pudo ejecutar este engrase', `
      <div class="form-grid">
        <label class="span-2">Motivo
          <select id="noexec-reason">
            ${NO_EXECUTION_REASONS.map(r => `<option value="${r}">${esc(NO_EXECUTION_REASON_LABELS[r])}</option>`).join('')}
          </select>
        </label>
        <label class="span-2">Observación<textarea id="noexec-obs" rows="3" placeholder="Obligatoria si el motivo es &quot;Otro&quot;"></textarea></label>
      </div>
      <div id="noexec-match-result"></div>
      <div class="modal-actions" style="margin-top:14px">
        <button type="button" class="btn" id="noexec-cancel">Cancelar</button>
        <button type="button" class="btn btn-accent" id="noexec-confirm">Confirmar</button>
      </div>
    `);
    $('#noexec-cancel').addEventListener('click', closeModal);

    // YA_ENGRASADO (cierre histórico, Parte A): busca automáticamente si
    // hay un lubrication_record real que satisfaga ESTA ocurrencia antes
    // de dejarlo como una afirmación sin respaldo — NUNCA cierra nada solo
    // por elegir el motivo (§2 del pedido). Ver
    // findMatchingGreaseRecordForOccurrence() en operational-scope.js.
    async function actualizarMatchYaEngrasado() {
      const cont = $('#noexec-match-result');
      if (!cont) return;
      if ($('#noexec-reason').value !== 'YA_ENGRASADO' || !plan) { cont.innerHTML = ''; return; }
      cont.innerHTML = `<p class="dim" style="margin:8px 0 0">Buscando un engrase reciente compatible…</p>`;
      const [recordsParaMatch, assignmentsParaMatch, skipsParaMatch] = await Promise.all([
        DB.allActive('lubrication_records'), DB.allActive('lubrication_assignments'), DB.allActive('lubrication_skips')
      ]);
      const match = findMatchingGreaseRecordForOccurrence({
        plan, occurrenceKey: occurrenceKeyHoy, occurrenceDate: new Date(),
        records: recordsParaMatch, assignments: assignmentsParaMatch, skips: skipsParaMatch
      });
      if (match.status === 'MATCH') {
        const rec = match.records[0];
        cont.innerHTML = `
          <div class="grease-flow-carryover-warn" style="margin-top:10px">
            <b>✓ Se encontró un engrase reciente compatible.</b><br>
            ${esc(equipment.code)} · ${fmtDate(rec.date)} · ${fmt(rec.hourmeter)} h · ${esc(rec.userName || '—')}
            <div class="modal-actions" style="margin-top:8px"><button type="button" class="btn btn-sm btn-accent" id="noexec-vincular">Vincular al plan</button></div>
          </div>`;
        $('#noexec-vincular').addEventListener('click', () => guardarNoEjecucion({ linkedRecordId: rec.id }));
      } else if (match.status === 'AMBIGUOUS') {
        cont.innerHTML = `<div class="grease-flow-vencido-warn" style="margin-top:10px">⚠ Se encontraron varios engrases posibles. Requiere revisión del Planificador.</div>`;
      } else {
        cont.innerHTML = `<p class="dim" style="margin:8px 0 0">No se encontró un engrase compatible.</p>`;
      }
    }
    $('#noexec-reason').addEventListener('change', actualizarMatchYaEngrasado);

    async function guardarNoEjecucion({ linkedRecordId } = {}) {
      const reason = $('#noexec-reason').value;
      const observacion = $('#noexec-obs').value;
      let skip;
      try {
        skip = buildNoExecutionRecord({
          id: uid('skip'), equipmentId: equipment.id, planId: plan ? plan.id : null,
          occurrenceKey: occurrenceKeyHoy, date: nowISO(), shiftId: turnoActualReg,
          reason, observacion, userId: App.currentUser.id, userName: App.currentUser.name, now: nowISO(),
          linkedRecordId
        });
      } catch (err) {
        alert(err.message);
        return;
      }
      await DB.put('lubrication_skips', skip);
      await logAudit('ENGRASE_NO_EJECUTADO',
        `${equipment.code} · motivo ${reason}${skip.observacion ? ' · ' + skip.observacion : ''}${linkedRecordId ? ' · vinculado a ' + linkedRecordId : ''}`,
        App.currentUser.name);
      await discardDraft();
      closeModal();
      showInAppToast(linkedRecordId ? `✓ Vinculado a un engrase real — ${equipment.code}` : `Registrado: no se pudo ejecutar — ${equipment.code}`);
      App.lubricadorGreaseFlowActive = false; // el flujo terminó (sin engrase) — no debe sobrevivir a la sesión siguiente
      Sync.fullSync();
      redibujarPantallaActual();
    }
    $('#noexec-confirm').addEventListener('click', () => guardarNoEjecucion());
  }

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
      // Acción explícita (lote occurrences/carryover, §2): "Marcar todos" ya
      // no aplica de un solo toque — pide confirmación, para que no sea un
      // atajo accidental que declare puntos como realizados sin haberlos
      // engrasado de verdad. Si ya estaban todos marcados, no hay nada que
      // confirmar (evita un confirm() sin sentido al tocarlo dos veces).
      const puntos = $$('.chk-done');
      if (puntos.every(c => c.checked)) return;
      if (!confirm(`¿Marcar los ${puntos.length} puntos de engrase como realizados? Confírmalo solo si de verdad engrasaste todos.`)) return;
      puntos.forEach(chk => {
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
    $('#btn-no-ejecutado')?.addEventListener('click', () => openNoExecutionForm());

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

    let enviandoEngrase = false; // guarda contra doble click/doble submit: nunca duplicar lubrication_record
    $('#grease-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (enviandoEngrase) return;
      enviandoEngrase = true;
      $('.btn-grease-submit').disabled = true;
      try {
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

      // Validación real (lote occurrences/carryover, §2): si TODOS los puntos
      // del checklist quedaron marcados como realizados, la cantidad de
      // grasa no puede ser 0 — sería contradictorio (se engrasó todo el
      // equipo sin gastar nada de lubricante). Sin puntos configurados no
      // hay nada que exigir aquí (mismo criterio que
      // computeExecutionCompleteness() en operational-scope.js: sin
      // checklist, siempre se considera completo).
      const totalPuntosChecklist = $$('.checklist-item').length;
      const qtyIngresada = parseFloat(fd.qty || 0);
      if (totalPuntosChecklist > 0 && incomplete.length === 0 && !(qtyIngresada > 0)) {
        alert(`Marcaste los ${totalPuntosChecklist} puntos de engrase como realizados, pero la cantidad de grasa es 0. Anota la cantidad real utilizada.`);
        return;
      }

      // "Otro" como motivo de fuera de plan exige observación — nunca depender
      // solo de esa etiqueta genérica (§7 del lote correspondiente).
      if (outOfPlan && fd.outOfPlanReason === 'OTRO' && !(fd.notes || '').trim()) {
        alert('Escribe una observación describiendo el motivo del engrase fuera de plan.');
        return;
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

      // Un engrase no puede tener fecha futura: pasa si el reloj del celular está mal
      // o hay un error de tipeo al capturar uno atrasado. Sin esta validación el equipo
      // aparecería "al día" por algo que todavía no ocurrió.
      if (esRetro) {
        const fechaElegida = new Date(fd.retroDate);
        if (isNaN(fechaElegida.getTime())) { alert('La fecha indicada no es válida.'); return; }
        const margen = 5 * 60 * 1000; // 5 minutos de tolerancia por desfases de reloj
        if (fechaElegida.getTime() > Date.now() + margen) {
          alert('La fecha del engrase no puede ser futura. Revisa la fecha que indicaste (y la hora del celular si acabas de cambiarla).');
          return;
        }
        const haceUnAnio = Date.now() - 365 * 86400000;
        if (fechaElegida.getTime() < haceUnAnio &&
            !confirm(`Estás registrando un engrase de hace más de un año (${fmtDate(fechaElegida.toISOString())}). ¿Es correcto?`)) return;
      }

      const fechaRegistro = esRetro ? new Date(fd.retroDate).toISOString() : nowISO();
      const turnoRegistro = esRetro ? (fd.retroShift || currentShiftId()) : currentShiftId();
      const autor = esRetro && fd.retroUser
        ? (await DB.get('users', fd.retroUser)) || App.currentUser
        : App.currentUser;

      // Snapshot operativo (§1 del cierre de lote — ver docs/OPERATIONAL_SCOPE.md):
      // se calcula ANTES de tocar el plan/equipo (lastGreaseHour/locationId
      // pueden cambiar después de HOY) para que quede fijo el contexto de
      // ESTE momento, nunca reconstruible desde el estado actual. Se
      // calcula ANTES de guardar nada — completeGreaseAssignmentForOccurrence()
      // más abajo reutiliza la MISMA occurrenceKey, nunca la recalcula.
      // Retroactivo: la ocurrencia que se cierra es la de la fecha REAL del
      // engrase, no la de hoy (que es cuando se está capturando) — solo
      // importa para planes "Día y turno de la semana" (los de "Horas de
      // operación" no usan dateISO, ver computeOccurrenceKey()).
      const occurrenceKeyDeEsteEngrase = plan ? computeOccurrenceKey(plan, { dateISO: esRetro ? fechaRegistro.slice(0, 10) : todayDateISO() }) : null;
      const asignacionActivaDeEsteEngrase = occurrenceKeyDeEsteEngrase
        ? findActivePendingAssignment(await DB.allActive('lubrication_assignments'), occurrenceKeyDeEsteEngrase)
        : null;
      // Si había una asignación manual activa, la cuadrilla RESPONSABLE es la
      // asignada (aunque quien tenga la sesión sea una jefatura registrando en
      // nombre de otro); si no, la cuadrilla del DISPOSITIVO — solo cuando
      // quien registra es Lubricador con dispositivo configurado. Nunca se
      // inventa una cuadrilla cuando no se puede saber (jefatura registrando
      // sin asignación activa: queda null a propósito).
      let crewIdDeEsteEngrase = asignacionActivaDeEsteEngrase ? asignacionActivaDeEsteEngrase.assignedCrewId : null;
      if (!crewIdDeEsteEngrase && App.currentUser.role === 'LUBRICADOR') {
        const scopeDeEsteEngrase = await getCurrentOperationalScope();
        if (scopeDeEsteEngrase.kind === 'DEVICE_SCOPED') crewIdDeEsteEngrase = scopeDeEsteEngrase.crewId;
      }
      const crewLocationIdDeEsteEngrase = crewIdDeEsteEngrase
        ? ((await DB.allActive('cuadrillas')).find(c => c.id === crewIdDeEsteEngrase) || {}).locationId || null
        : null;
      // Fuera de plan (lote correspondiente) — prioridad ASSIGNED > OUT_OF_PLAN
      // > PLANNED (§15): una assignment activa SIEMPRE gana, aunque se haya
      // entrado por el botón "+ Fuera de plan" (nunca se convierte en
      // OUT_OF_PLAN solo porque el lubricador tocó ese botón por costumbre).
      const executionTypeDeEsteEngrase = asignacionActivaDeEsteEngrase
        ? 'ASSIGNED'
        : (outOfPlan ? 'OUT_OF_PLAN' : 'PLANNED');
      const completenessDeEsteEngrase = computeExecutionCompleteness(details);
      // Solo un engrase fuera de plan puede "satisfacer por adelantado" una
      // ocurrencia futura (§9/§10/§13/§14) — trabajo PLANNED/ASSIGNED ya
      // tiene su propio mecanismo (completeGreaseAssignmentForOccurrence()/
      // avance normal de plan.lastGreaseHour más abajo).
      const satisfiedOccurrenceKeyDeEsteEngrase = executionTypeDeEsteEngrase === 'OUT_OF_PLAN'
        ? resolveOutOfPlanSatisfaction({
            plan, completeness: completenessDeEsteEngrase,
            existingRecords: await DB.allActive('lubrication_records'),
            todayDate: esRetro ? new Date(fechaRegistro) : new Date()
          })
        : null;

      const operationalSnapshot = buildExecutionSnapshot({
        equipmentLocationId: equipment.locationId,
        crewId: crewIdDeEsteEngrase,
        crewLocationId: crewLocationIdDeEsteEngrase,
        performedByUserId: autor.id,
        shiftId: turnoRegistro,
        assignmentId: asignacionActivaDeEsteEngrase ? asignacionActivaDeEsteEngrase.id : null,
        executionType: executionTypeDeEsteEngrase,
        outOfPlanReason: executionTypeDeEsteEngrase === 'OUT_OF_PLAN' ? (fd.outOfPlanReason || 'OTRO') : null,
        executionCompleteness: completenessDeEsteEngrase,
        satisfiedOccurrenceKey: satisfiedOccurrenceKeyDeEsteEngrase
      });

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
        operationalSnapshot,
        synced: navigator.onLine
      }, App.currentUser.name);
      // ── Guardado protegido ────────────────────────────────────────────
      // Antes se guardaba pieza por pieza sin red: si el disco se llenaba o la app se
      // cerraba a mitad, quedaba el engrase registrado pero el equipo sin actualizar
      // (o al revés), y nadie se enteraba. Ahora se guarda todo el conjunto y, si algo
      // falla, se revierte lo ya escrito y se avisa a la persona.
      const respaldoEquipo = JSON.parse(JSON.stringify(equipment));
      const respaldoPlan = plan ? JSON.parse(JSON.stringify(plan)) : null;
      let registroGuardado = false;
      let anomaliasCreadas = [];

      try {
        await DB.put('lubrication_records', record);
        registroGuardado = true;

        // Cada punto que no se pudo engrasar genera una anomalía automática, para que
        // mantenimiento le dé seguimiento (ver createAutoAnomalies: evita duplicados).
        anomaliasCreadas = await createAutoAnomalies(record, equipment);
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

        // Evento propio para engrase fuera de plan (§27) — nunca tokens/PIN,
        // solo el contexto de negocio.
        if (executionTypeDeEsteEngrase === 'OUT_OF_PLAN') {
          await logAudit('OUT_OF_PLAN_GREASE_RECORDED',
            `${equipment.code} · motivo ${operationalSnapshot.outOfPlanReason} · ${completenessDeEsteEngrase}${satisfiedOccurrenceKeyDeEsteEngrase ? ' · satisface ' + satisfiedOccurrenceKeyDeEsteEngrase : ' · pendiente de conciliación'}`,
            App.currentUser.name);
        }

        // Si este engrase cerraba una asignación manual PENDING (§R), la
        // completa. Si era trabajo normal sin asignación, no hace nada.
        if (occurrenceKeyDeEsteEngrase) {
          await completeGreaseAssignmentForOccurrence(equipment, occurrenceKeyDeEsteEngrase, record.id)
            .catch(err => console.warn('No se pudo cerrar la asignación de este engrase', err));
        }

      } catch (err) {
        // Algo falló a mitad del guardado (disco lleno, base bloqueada, app cerrándose).
        // Se revierte lo que alcanzó a escribirse para no dejar el equipo con datos
        // contradictorios, y se conserva el borrador para que nada se pierda.
        console.error('Fallo al guardar el engrase', err);
        try {
          if (registroGuardado) await DB.delete('lubrication_records', record.id);
          await DB.put('equipment', respaldoEquipo);
          if (respaldoPlan) await DB.put('lubrication_plans', respaldoPlan);
        } catch (e2) { console.error('Además falló la reversión', e2); }

        alert('No se pudo guardar el engrase: ' + (err.message || 'error desconocido') +
              '\n\nNo se perdió nada de lo que llenaste: quedó como borrador y puedes reintentar. ' +
              'Si el problema persiste, revisa el espacio disponible en el teléfono.');
        return; // el borrador NO se descarta
      }

      showInAppToast(esRetro ? `✓ Engrase atrasado registrado — ${equipment.code}` : `✓ Engrase registrado — ${equipment.code}`);
      if (anomaliasCreadas.length) {
        showInAppToast(`⚠ Se abrió ${anomaliasCreadas.length} anomalía(s) automática(s): ${anomaliasCreadas.join(', ')}`);
      }
      await discardDraft();
      await refreshLocalNotifications();
      await refreshAppBadge();
      // Sube el engrase ya, para que el resto del equipo lo vea en segundos
      // en vez de esperar el siguiente ciclo del timer. No await: no debe
      // bloquear la pantalla de "Validar ahora/después" que sigue abajo. El
      // guard de onSyncStateChange() (ver más arriba en este archivo) sigue
      // intacto tal cual — este fullSync() NUNCA desmonta esta pantalla.
      Sync.fullSync();

      // La validación NO es obligatoria en el momento: el lubrication_record
      // ya quedó guardado arriba pase lo que pase acá. "Validar ahora" abre
      // el MISMO modal real (openValidationModal, grease_validations) sobre
      // este `record`/`equipment"; "Validar después" solo navega — no crea
      // ningún grease_validation, el estado derivado queda en
      // PENDIENTE_VALIDACION hasta que alguien firme (ver
      // docs/GREASE_VALIDATION_AUDIT.md).
      area.innerHTML = `<div class="panel">
        <div class="empty-state success">Engrase registrado correctamente — ${esc(equipment.code)}. Próximo engrase recalculado automáticamente.</div>
        <div class="grease-validate-choice">
          <p class="dim">¿Quién valida este engrase?</p>
          <div class="grease-validate-choice-actions">
            <button type="button" class="btn btn-accent" id="grease-validate-now-btn">Validar ahora</button>
            <button type="button" class="btn" id="grease-validate-later-btn">Validar después</button>
          </div>
        </div>
      </div>`;
      $('#grease-validate-now-btn')?.addEventListener('click', () => {
        openValidationModal(record, equipment, irAMisEngrasesTrasRegistrar);
      });
      $('#grease-validate-later-btn')?.addEventListener('click', irAMisEngrasesTrasRegistrar);
      } finally {
        // El botón puede ya no existir (éxito reemplazó `area.innerHTML`) —
        // reactivarlo solo importa en los caminos de error/validación fallida,
        // para que la persona pueda corregir y reintentar (nunca queda
        // bloqueado, pero tampoco permite un doble submit mientras procesa).
        enviandoEngrase = false;
        const btnSubmit = $('.btn-grease-submit');
        if (btnSubmit) btnSubmit.disabled = false;
      }
    });
  }
}

/* ============================================================
   ACTUALIZAR HORÓMETROS
   ============================================================ */
async function renderHorometros() {
  const c = $('#app-content');
  if (!c) return; // la pantalla ya no está en el documento (cambio de vista o de usuario)
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
      Sync.fullSync(); // sube el cambio ya, en vez de esperar el siguiente ciclo del timer
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

  // UI-FULL-102: navigate() ya aplica makeTablesResponsive() en la carga inicial de
  // esta pantalla, pero "Guardar" (arriba) llama a renderHorometros() directamente
  // para refrescar la tabla, sin pasar por navigate() — sin esta llamada, la tabla
  // pierde las etiquetas móviles justo después del primer guardado.
  makeTablesResponsive(c);
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
  // UI-FULL-305: esta tabla vive dentro de un modal (openModal), fuera de #app-content
  // — el gancho central de navigate() (que aplica makeTablesResponsive() a cada ruta)
  // nunca la alcanza. openModal() es síncrona, así que la tabla ya existe en el DOM aquí.
  makeTablesResponsive($('.modal-body'));
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
    Sync.fullSync(); // sube el lote ya, en vez de esperar el siguiente ciclo del timer
    closeModal();
    navigate('horometros');
  });
}

/* ============================================================
   ANOMALÍAS
   ============================================================ */
async function renderAnomalias() {
  const c = $('#app-content');
  if (!c) return; // la pantalla ya no está en el documento (cambio de vista o de usuario)
  const anomalies = (await DB.allActive('anomalies')).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const equipos = await DB.allActive('equipment');

  c.innerHTML = `
    <div class="layout-wide">
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
    </div>
    </div>`;


  async function draw(filter = '') {
    const rows = anomalies.filter(a => !filter || a.status === filter);
    // Gap de Storage privado cerrado (ver docs/STORAGE_PRIVACY_DESIGN.md
    // §7): las fotos de anomalías pueden venir de otro dispositivo — se
    // resuelven todas en paralelo antes de armar la tabla.
    const photoSrcs = await Promise.all(rows.map(a => resolvePhotoThumbSrcs(a)));
    $('#anom-table tbody').innerHTML = rows.map((a, i) => {
      const eq = equipos.find(e => e.id === a.equipmentId);
      return `<tr>
        <td><span class="dot" style="background:${CRIT_COLOR[a.criticality]}"></span> ${esc(a.criticality)}</td>
        <td class="mono">${eq ? eq.code : '—'}</td>
        <td>${esc(a.component)}${a.autoGenerada ? ` <span class="auto-tag" title="Creada automáticamente al registrar un engrase">auto</span>` : ''}${a.repeticiones > 1 ? ` <span class="repeat-tag" title="Se ha reportado ${a.repeticiones} veces">×${a.repeticiones}</span>` : ''}</td>
        <td>${esc(a.description)}${a.resolutionNote ? `<div class="dim" style="margin-top:4px">Resuelto: ${esc(a.resolutionNote)}</div>` : ''}</td>
        <td>${fmtDate(a.createdAt)}</td>
        <td>${esc(a.createdBy)}</td>
        <td>${esc(a.status)}</td>
        <td>${photoThumbsHTML(a, `${eq ? eq.code : ''} · ${esc(a.component)}`, photoSrcs[i])}</td>
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
      Sync.fullSync();
      renderAnomalias();
    }));
    $$('.anom-delete', c).forEach(b => b.addEventListener('click', async () => {
      const a = await DB.get('anomalies', b.dataset.id);
      if (!confirm(`¿Eliminar esta anomalía (${esc(a.component)})? No se puede deshacer desde la app.`)) return;
      a.active = false;
      await DB.put('anomalies', stamp(a, App.currentUser.name));
      await logAudit('ANOMALIA_ELIMINADA', `${esc(a.component)} · ${esc(a.description)}`, App.currentUser.name);
      showInAppToast('✓ Anomalía eliminada');
      Sync.fullSync(); // sube el cambio ya, para que los demás lo vean en segundos
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
/* CRITICIDAD_POR_MOTIVO se movió a src/core/anomalies.js (sigue disponible
   como global, ver docs/MODULARIZATION.md). */

// La decisión de negocio (¿crear anomalía nueva, actualizar una existente, o
// no hacer nada?) vive en src/core/anomaly-actions.js
// (evaluateAnomalyActions/hayPuntosOAnomaliaHorometro) — pura, sin DB ni
// DOM. Aquí solo se aplica esa decisión contra IndexedDB. Ver
// docs/MODULARIZATION.md.
async function createAutoAnomalies(record, equipment) {
  if (!hayPuntosOAnomaliaHorometro(record)) return [];

  const abiertas = (await DB.allActive('anomalies'))
    .filter(a => a.equipmentId === equipment.id && a.status !== 'Cerrada');

  const { acciones, avisos } = evaluateAnomalyActions(record, equipment, abiertas);

  for (const accion of acciones) {
    if (accion.tipo === 'actualizar') {
      const existente = abiertas.find(a => a.id === accion.anomaliaId);
      Object.assign(existente, accion.cambios);
      await DB.put('anomalies', stamp(existente, App.currentUser.name));
    } else {
      await DB.put('anomalies', stamp({ id: uid('anom'), ...accion.anomalia }, record.userName));
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
  if (!c) return; // la pantalla ya no está en el documento (cambio de vista o de usuario)
  const lubricants = await DB.allActive('lubricants');
  const records = await DB.allActive('lubrication_records');
  const canEdit = App.currentUser.role === 'ADMINISTRADOR';

  c.innerHTML = `
    <div class="toolbar">
      ${canEdit ? `<button class="btn btn-accent" id="btn-new-lub">${ic("plus")}Nuevo lubricante</button>` : '<span></span>'}
    </div>
    <div class="panel">
      <table class="data-table">
        <thead><tr><th>Nombre</th><th>Marca</th><th>Tipo</th><th>Grado</th><th>Código</th><th>Consumo total (${GREASE_UNIT})</th>${canEdit ? '<th></th>' : ''}</tr></thead>
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
    const l = existing || { name: '', brand: '', type: '', grade: '', code: '', unit: GREASE_UNIT };
    openModal(existing ? `Editar · ${esc(existing.name)}` : 'Nuevo lubricante', `
      <form id="lub-form" class="form-grid">
        <label>Nombre<input required name="name" value="${esc(l.name)}"/></label>
        <label>Marca<input name="brand" value="${esc(l.brand)}"/></label>
        <label>Tipo<input name="type" value="${esc(l.type)}"/></label>
        <label>Grado<input name="grade" placeholder="NLGI 2" value="${esc(l.grade)}"/></label>
        <label>Código interno<input name="code" value="${esc(l.code)}"/></label>
        <label>Unidad<input name="unit" value="${l.unit || GREASE_UNIT}"/></label>
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

// Búsqueda parcial, sin distinguir mayúsculas/minúsculas, sobre los campos
// de equipo ya existentes (código, código ahorrativo, marca, modelo,
// descripción, N° de serie, familia/tipo, ubicación) — reutilizada por el
// buscador de Historial. `type`/`location` son opcionales (el equipo puede
// no tener familia/ubicación asignada todavía).
function equipoMatchesQuery(eq, type, location, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    eq.code, eq.shortCode, eq.brand, eq.model, eq.description, eq.serial,
    type ? type.name : '', location ? location.name : '',
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(q);
}

/* ============================================================
   HISTORIAL
   ============================================================ */
async function renderHistorial() {
  const c = $('#app-content');
  if (!c) return; // la pantalla ya no está en el documento (cambio de vista o de usuario)
  const equipos = await DB.allActive('equipment');
  // TODAS (no solo activas) — esta pantalla nunca usa `types`/`locations`
  // para un <select> (a diferencia de Dashboard/Reportes/Matriz), solo para
  // mostrar el nombre de la ubicación/familia de cada equipo del historial
  // — un equipo con una ubicación YA desactivada debe seguir mostrando su
  // nombre real, nunca "—" (mismo bug real que DATA-PENDING-A02, ver
  // docs/BUG_REGISTER.md).
  const types = await DB.all('equipment_types');
  const locations = await DB.all('locations');
  const plans = await DB.allActive('lubrication_plans');
  const planPorEquipoIdHist = {}; plans.forEach(p => planPorEquipoIdHist[p.equipmentId] = p);
  const today = new Date().toISOString().slice(0, 10);
  let lastGeneralResults = [];
  // Pestañas (misma pantalla, sin navigate() — solo se alterna display vía
  // .hidden — ambos grupos ya cargaron sus datos, cambiar de pestaña no
  // vuelve a pedirlos ni pierde filtros/resultados). "Por equipo" abre por
  // defecto.
  c.innerHTML = `
    <div class="layout-wide">
    <div class="hist-tabs" role="tablist">
      <button type="button" class="hist-tab active" data-tab="equipo" role="tab" aria-selected="true">Por equipo</button>
      <button type="button" class="hist-tab" data-tab="global" role="tab" aria-selected="false">Historial global</button>
    </div>
    <div data-hist-panel="equipo">
      <div class="panel" id="hist-eq-panel">
        <div class="panel-head"><h3>Historial por equipo</h3></div>
        <div id="hist-eq-search-area"></div>
      </div>
      <div id="hist-area"></div>
    </div>
    <div data-hist-panel="global" class="hidden">
      <div class="panel hist-global-panel">
        <div class="panel-head"><h3>Historial global</h3></div>
        <div class="hist-global-body">
          <input type="search" id="gh-search" class="input hist-global-search" placeholder="Buscar: código, familia, marca, modelo, ubicación…" autocomplete="off"/>
          <div class="hist-global-filters-row">
            <label class="filter-label hist-global-filter">Desde <input type="date" id="gh-from" class="input input-sm"/></label>
            <label class="filter-label hist-global-filter">Hasta <input type="date" id="gh-to" class="input input-sm" value="${today}"/></label>
            <label class="filter-label hist-global-filter">Turno
              <select id="gh-turno" class="input input-sm"><option value="">Ambos</option><option value="shift_dia">Día</option><option value="shift_noche">Noche</option></select>
            </label>
            <label class="filter-label hist-global-filter">Estado del equipo
              <select id="gh-estado" class="input input-sm">
                <option value="">Todos</option>
                <option value="ROJO">Vencidos</option>
                <option value="AMARILLO">Próximos</option>
                <option value="VERDE">Al día</option>
              </select>
            </label>
            <div class="hist-global-summary" id="gh-summary"></div>
          </div>
          <div id="gh-results"></div>
        </div>
      </div>
    </div>
    </div>
  `;

  $$('.hist-tab', c).forEach(tab => tab.addEventListener('click', () => {
    $$('.hist-tab', c).forEach(t => { t.classList.toggle('active', t === tab); t.setAttribute('aria-selected', t === tab ? 'true' : 'false'); });
    $$('[data-hist-panel]', c).forEach(p => p.classList.toggle('hidden', p.dataset.histPanel !== tab.dataset.tab));
  }));

  // Buscador de equipo (código/familia/marca/modelo/ubicación), reutiliza
  // equipoMatchesQuery() — es la ÚNICA búsqueda de equipo de la pantalla (el
  // historial global ya no tiene una propia, ver A7). Al elegir un equipo, la
  // búsqueda se reemplaza por un encabezado compacto; "Cambiar equipo" vuelve
  // a mostrarla. Debounce ~280ms, mismo patrón que wireQuickFind() (topbar).
  const typePorIdHist = {}; types.forEach(t => typePorIdHist[t.id] = t);
  const locPorIdHist = {}; locations.forEach(l => locPorIdHist[l.id] = l);

  function renderEqSearch() {
    $('#hist-eq-search-area').innerHTML = `
      <div class="hist-eq-search-wrap">
        <input type="search" id="hist-eq-search" class="input hist-eq-search" placeholder="Buscar equipo: código, familia, marca, modelo, ubicación…" autocomplete="off"/>
        <div id="hist-eq-results" class="hist-eq-results hidden"></div>
      </div>`;
    $('#hist-area').innerHTML = '';
    wireEqSearch();
  }

  function renderEqHeader(eq) {
    const type = typePorIdHist[eq.typeId];
    const loc = locPorIdHist[eq.locationId];
    $('#hist-eq-search-area').innerHTML = `
      <div class="hist-eq-header">
        <div class="hist-eq-header-main">
          <span class="hist-eq-header-code">${esc(eq.code)}</span>
          <span class="hist-eq-header-model">${esc(eq.brand)} ${esc(eq.model)}</span>
        </div>
        <div class="hist-eq-header-meta">
          <span>${esc((type || {}).name || 'Sin familia')}</span>
          <span>${esc((loc || {}).name || 'Sin ubicación')}</span>
          <span class="hist-eq-header-status">${esc(eq.status)}</span>
        </div>
        <button type="button" class="btn btn-sm" id="hist-eq-change">${ic('search')}Cambiar equipo</button>
      </div>`;
    $('#hist-eq-change').addEventListener('click', renderEqSearch);
  }

  function wireEqSearch() {
    const input = $('#hist-eq-search');
    const box = $('#hist-eq-results');
    let temporizador;
    function buscar() {
      const q = input.value;
      if (!q.trim()) { box.classList.add('hidden'); box.innerHTML = ''; return; }
      const matches = equipos.filter(e => equipoMatchesQuery(e, typePorIdHist[e.typeId], locPorIdHist[e.locationId], q)).slice(0, 8);
      if (!matches.length) {
        box.innerHTML = '<div class="hist-eq-empty">Ningún equipo coincide</div>';
        box.classList.remove('hidden');
        return;
      }
      box.innerHTML = matches.map(e => `
        <button type="button" class="hist-eq-result" data-id="${e.id}">
          <span class="mono"><b>${esc(e.code)}</b></span>
          <span class="dim">${esc(e.brand)} ${esc(e.model)} · ${esc((locPorIdHist[e.locationId] || {}).name || 'Sin ubicación')}</span>
        </button>`).join('');
      box.classList.remove('hidden');
      $$('.hist-eq-result', box).forEach(b => b.addEventListener('click', async () => {
        const eq = equipos.find(e => e.id === b.dataset.id);
        renderEqHeader(eq);
        await drawHistory(eq.id);
      }));
    }
    input.addEventListener('input', () => { clearTimeout(temporizador); temporizador = setTimeout(buscar, 280); });
    document.addEventListener('click', ev => { if (!ev.target.closest('.hist-eq-search-wrap')) box.classList.add('hidden'); });
  }

  renderEqSearch();

  // Deep-link desde el Dashboard (fila/código de "Mayor tiempo sin
  // engrasar" o acción "Ver historial" de sus modales): preselecciona el
  // equipo igual que si el usuario lo hubiera elegido del buscador — no es
  // un filtro nuevo, reutiliza renderEqHeader()/drawHistory() reales.
  if (App.dashJumpEquipoId) {
    const jumpId = App.dashJumpEquipoId;
    App.dashJumpEquipoId = null;
    const eqJump = equipos.find(e => e.id === jumpId);
    if (eqJump) { renderEqHeader(eqJump); await drawHistory(eqJump.id); }
  }

  async function runGeneralSearch() {
    const from = $('#gh-from').value ? new Date($('#gh-from').value + 'T00:00:00') : null;
    const to = $('#gh-to').value ? new Date($('#gh-to').value + 'T23:59:59') : null;
    const turno = $('#gh-turno').value;
    const estado = $('#gh-estado').value;
    const query = $('#gh-search').value;

    // Todos los filtros se combinan con AND: cada uno reduce matchEquipos por
    // separado (vacío/"Todos" = no restringe), y turno/fechas filtran los
    // registros aparte — el resultado final cumple TODAS las condiciones
    // activas a la vez, nunca solo una.
    let matchEquipos = equipos;
    if (query.trim()) {
      matchEquipos = matchEquipos.filter(e => equipoMatchesQuery(e, typePorIdHist[e.typeId], locPorIdHist[e.locationId], query));
    }
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
    // Cumplimiento: el "registro anterior" para el vencimiento por horas es el
    // anterior REAL del equipo en TODO el historial (allRecords, sin el filtro
    // de fecha/turno visible), nunca del subconjunto filtrado en pantalla.
    const recordsPorEquipo = {};
    allRecords.forEach(r => { (recordsPorEquipo[r.equipmentId] = recordsPorEquipo[r.equipmentId] || []).push(r); });

    lastGeneralResults = results.map(r => ({ r, eq: eqPorId[r.equipmentId], lub: lubPorId[r.greaseType] }));

    // Solo se dibujan las primeras filas: con 2 años de historial son decenas de miles
    // de registros y el navegador (sobre todo en celular) se bloquea al renderizarlos.
    // La descarga en CSV sí incluye TODOS los resultados filtrados.
    const LIMITE_VISIBLE = 200;
    const visibles = results.slice(0, LIMITE_VISIBLE);
    const hayMas = results.length > LIMITE_VISIBLE;
    // Gap de Storage privado cerrado (ver docs/STORAGE_PRIVACY_DESIGN.md
    // §7) — solo se resuelven las filas VISIBLES (máximo 200), nunca los
    // miles de resultados filtrados completos.
    const photoSrcsVisibles = await Promise.all(visibles.map(r => resolvePhotoThumbSrcs(r)));

    $('#gh-summary').innerHTML = `
      <span class="hist-global-count">${results.length} resultados${hayMas ? ` · ${LIMITE_VISIBLE} recientes` : ''}</span>
      <button type="button" class="btn hist-export-btn" id="gh-export">${ic("download")}Exportar CSV</button>
    `;
    $('#gh-results').innerHTML = `
      ${hayMas ? `<div class="dim" style="padding:0 0 8px">Afina los filtros para ver menos resultados, o descarga el CSV que incluye los ${results.length} completos.</div>` : ''}
      <div class="hist-global-table-wrap">
      <table class="data-table hist-global-table">
        <thead><tr><th>Fecha</th><th>Código</th><th>Equipo</th><th>Turno</th><th>Responsable</th><th>Horómetro</th><th>Grasa</th><th>Condición</th><th>Cumplimiento</th><th>Foto</th></tr></thead>
        <tbody>${visibles.map((r, i) => {
          const eq = eqPorId[r.equipmentId];
          const planEq = planPorEquipoIdHist[r.equipmentId] || null;
          const compliance = evaluateRecordCompliance(r, planEq, findPreviousRecord(r, recordsPorEquipo[r.equipmentId] || []));
          return `<tr>
            <td>${fmtDate(r.date)}</td>
            <td class="mono">${eq ? eq.code : '—'}</td>
            <td>${eq ? eq.brand + ' ' + eq.model : '—'}</td>
            <td>${r.shiftId === 'shift_dia' ? 'Día' : 'Noche'}</td>
            <td>${esc(r.userName)}${r.retroactivo ? ` <span class="retro-tag" title="Capturado después por ${esc(r.capturadoPor || '')}">atrasado</span>` : ''}</td>
            <td class="mono">${fmt(r.hourmeter)} h</td>
            <td>${(lubPorId[r.greaseType] || {}).name || '—'}</td>
            <td>${esc(r.condition)}</td>
            <td>${complianceBadgeHTML(compliance)}</td>
            <td>${photoThumbsHTML(r, eq ? eq.code : '', photoSrcsVisibles[i])}</td>
          </tr>`;
        }).join('') || '<tr><td colspan="10" class="empty-state">Sin resultados para estos filtros.</td></tr>'}</tbody>
      </table>
      </div>`;
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

  // Sin botón Buscar: el texto busca con debounce ~280ms (mismo patrón que el
  // buscador de equipo de arriba); los demás filtros actualizan al cambiar.
  let ghTemporizador;
  $('#gh-search').addEventListener('input', () => { clearTimeout(ghTemporizador); ghTemporizador = setTimeout(runGeneralSearch, 280); });
  $('#gh-from').addEventListener('change', runGeneralSearch);
  $('#gh-to').addEventListener('change', runGeneralSearch);
  $('#gh-turno').addEventListener('change', runGeneralSearch);
  $('#gh-estado').addEventListener('change', runGeneralSearch);
  runGeneralSearch();
}

// Insignia visual para evaluateRecordCompliance()/findPreviousRecord()
// (src/core/plan-compliance.js) — 4 estados, nunca color-saturado: "cumplido"
// discreto (verde tenue), "fuera_de_plan" como alerta (rojo), "anticipado"
// (solo Horas, tolerancia ±10%) ámbar tenue — no es alerta ni logro, es una
// categoría propia — y "no_evaluable" gris/neutro (nunca se lee como un
// juicio negativo, es solo "no se sabe").
function complianceBadgeHTML(compliance) {
  const MAP = {
    cumplido: ['hist-compliance-ok', 'Cumplido'],
    fuera_de_plan: ['hist-compliance-alert', 'Fuera de plan'],
    anticipado: ['hist-compliance-early', 'Anticipado'],
    // Mismo tono que VALIDATION_BADGE.VALIDADO_ENCARGADO (hist-compliance-teal)
    // — un tercer color, ni verde "todo perfecto" ni rojo "incumplido", para
    // el caso real "se hizo, pero en el otro turno del mismo día" (lote
    // occurrences/carryover).
    realizado_atrasado: ['hist-compliance-teal', 'Realizado atrasado'],
    no_evaluable: ['hist-compliance-neutral', 'No evaluable'],
  };
  const [cls, label] = MAP[compliance.estado] || MAP.no_evaluable;
  return `<span class="hist-compliance-badge ${cls}" title="${esc(compliance.motivo || '')}">${label}</span>`;
}

// Insignia de VALIDATION_STATUS (src/core/grease-validation.js) — mismo
// componente visual que complianceBadgeHTML(), tono propio para Encargado
// (ni alerta ni el mismo verde que Operador, ver VALIDATION_BADGE).
function validationBadgeHTML(status) {
  const badge = VALIDATION_BADGE[status] || VALIDATION_BADGE[VALIDATION_STATUS.PENDIENTE];
  const toneClass = { amber: 'hist-compliance-early', green: 'hist-compliance-ok', teal: 'hist-compliance-teal', red: 'hist-compliance-alert' }[badge.tone] || 'hist-compliance-neutral';
  return `<span class="hist-compliance-badge ${toneClass}">${badge.label}</span>`;
}

// Modal de validación del engrase con firma manuscrita (canvas) — PERSISTE
// en el store separado `grease_validations` (nunca escribe en
// lubrication_records: la autoría del Lubricador no se toca, ver
// docs/GREASE_VALIDATION_AUDIT.md). Guardado offline-first igual que el
// resto de la app: DB.put() ya escribe primero en IndexedDB; sync.js
// (uploadSignatureIfNeeded) sube la firma a Storage cuando hay señal.
// Solo se debe abrir para un registro SIN validación activa — quien llama
// ya filtró por pendientes, pero se re-verifica justo antes de guardar
// (máximo una validación activa por registro, sin revalidación todavía).
// `onDone` se llama tras confirmar, para que quien abrió el modal decida
// cómo refrescar su propia pantalla (Historial vs. Dashboard).
async function openValidationModal(record, equipment, onDone) {
  const anomaliasRelacionadas = (await DB.allActive('anomalies')).filter(a => a.equipmentId === equipment.id && a.status !== 'Cerrada');

  openModal('Validar engrase', `
    <div class="val-info">
      <div class="val-info-row"><span>Equipo</span><span>${esc(equipment.code)} · ${esc(equipment.brand)} ${esc(equipment.model)}</span></div>
      <div class="val-info-row"><span>Fecha/hora del engrase</span><span>${fmtDate(record.date)}</span></div>
      <div class="val-info-row"><span>Lubricador</span><span>${esc(record.userName)}</span></div>
      <div class="val-info-row"><span>Turno</span><span>${record.shiftId === 'shift_dia' ? 'Día' : 'Noche'}</span></div>
      ${Number.isFinite(record.hourmeter) ? `<div class="val-info-row"><span>Horómetro</span><span>${fmt(record.hourmeter)} h</span></div>` : ''}
      ${record.qty ? `<div class="val-info-row"><span>Cantidad de grasa</span><span>${fmt(record.qty, 1)} ${GREASE_UNIT}</span></div>` : ''}
      ${anomaliasRelacionadas.length ? `<div class="val-info-row"><span>Anomalías abiertas del equipo</span><span>${anomaliasRelacionadas.length}</span></div>` : ''}
    </div>
    <div class="form-grid">
      <label>Nombre<input type="text" id="val-name" class="input" placeholder="Nombre de quien valida" autocomplete="off"/></label>
      <label>Rol
        <select id="val-role" class="input">
          <option value="">— Selecciona —</option>
          <option value="OPERADOR">Operador</option>
          <option value="ENCARGADO">Encargado</option>
        </select>
      </label>
      <label class="span-2 hidden" id="val-reason-wrap">Motivo (obligatorio si Encargado)<textarea id="val-reason" class="input" placeholder="Ej: Operador no disponible"></textarea></label>
    </div>
    <div class="val-signature-wrap">
      <div class="val-signature-label">Firma</div>
      <canvas id="val-signature-canvas" class="val-signature-canvas" width="500" height="180"></canvas>
      <div id="val-error" class="val-error hidden"></div>
      <div class="val-signature-actions">
        <button type="button" class="btn btn-sm" id="val-clear">Borrar firma</button>
        <button type="button" class="btn btn-accent" id="val-confirm">Confirmar validación</button>
      </div>
    </div>
  `);

  const canvas = $('#val-signature-canvas');
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1a1a1a';
  let hasSignature = false;
  let drawing = false;
  function posFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }
  function startStroke(e) { drawing = true; hasSignature = true; const p = posFromEvent(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  function moveStroke(e) { if (!drawing) return; const p = posFromEvent(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }
  function endStroke() { drawing = false; }
  canvas.addEventListener('pointerdown', startStroke);
  canvas.addEventListener('pointermove', moveStroke);
  window.addEventListener('pointerup', endStroke);

  $('#val-role').addEventListener('change', (e) => {
    $('#val-reason-wrap').classList.toggle('hidden', e.target.value !== 'ENCARGADO');
  });
  $('#val-clear').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasSignature = false;
  });
  $('#val-confirm').addEventListener('click', async () => {
    const form = {
      signerName: $('#val-name').value,
      signerRole: $('#val-role').value,
      reason: $('#val-reason') ? $('#val-reason').value : '',
      hasSignature,
    };
    const result = validateValidationForm(form);
    $('#val-error').classList.toggle('hidden', result.valid);
    if (!result.valid) { $('#val-error').textContent = Object.values(result.errors).join(' '); return; }

    // Re-chequeo justo antes de guardar (no solo al abrir el modal): si YA
    // hay alguna validación activa (una o varias — p. ej. otro dispositivo
    // validó offline mientras este formulario estaba abierto), NO se crea
    // otra en silencio. Se muestra lo que ya existe en vez de sumar una más.
    const yaActivas = findActiveValidations(record.id, await DB.allActive('grease_validations'));
    if (yaActivas.length === 1) {
      closeModal();
      await openValidationDetailModal(yaActivas[0], equipment, record.date);
      return;
    }
    if (yaActivas.length > 1) {
      closeModal();
      await openValidationConflictModal(yaActivas, equipment, record.date);
      return;
    }

    const validation = stamp({
      id: uid('val'), lubricationRecordId: record.id, equipmentId: equipment.id,
      signerName: form.signerName.trim(), signerRole: form.signerRole,
      reason: form.signerRole === 'ENCARGADO' ? form.reason.trim() : undefined,
      signedAt: nowISO(),
      signatureLocal: canvas.toDataURL('image/png'), // offline-first: base64 local primero
      signatureUrl: null, // lo llena sync.js (uploadSignatureIfNeeded) cuando hay señal
      signerUserId: App.currentUser ? App.currentUser.id : undefined,
    }, App.currentUser ? App.currentUser.name : 'sistema');
    await DB.put('grease_validations', validation);
    closeModal();
    if (onDone) onDone();
  });
}

// Vista de SOLO LECTURA de una validación ya existente — "Ver validación"
// (nunca se abre openValidationModal de nuevo sobre un registro ya
// validado: esta primera versión no soporta revalidación).
async function openValidationDetailModal(validation, equipment, recordDate) {
  const status = statusForSignerRole(validation.signerRole);
  // La firma es contenido sensible (§8 docs/STORAGE_PRIVACY_DESIGN.md) — si
  // este dispositivo no tiene la copia local (base64), se pide un signed
  // URL en vez de mostrar la URL cruda del bucket.
  const signatureRaw = validation.signatureLocal || validation.signatureUrl;
  const signatureSrc = await resolveEvidenceSrc(signatureRaw);
  openModal('Validación del engrase', `
    <div class="val-info">
      <div class="val-info-row"><span>Equipo</span><span>${esc(equipment.code)} · ${esc(equipment.brand)} ${esc(equipment.model)}</span></div>
      <div class="val-info-row"><span>Estado</span><span>${validationBadgeHTML(status)}</span></div>
      ${recordDate ? `<div class="val-info-row"><span>Fecha/hora del engrase</span><span>${fmtDate(recordDate)}</span></div>` : ''}
      <div class="val-info-row"><span>Nombre</span><span>${esc(validation.signerName)}</span></div>
      <div class="val-info-row"><span>Rol</span><span>${validation.signerRole === 'ENCARGADO' ? 'Encargado' : 'Operador'}</span></div>
      <div class="val-info-row"><span>Fecha/hora de la validación</span><span>${fmtDate(validation.signedAt)}</span></div>
      ${validation.reason ? `<div class="val-info-row"><span>Motivo</span><span>${esc(validation.reason)}</span></div>` : ''}
    </div>
    <div class="val-signature-wrap">
      <div class="val-signature-label">Firma</div>
      ${signatureSrc ? `<img class="val-signature-canvas" src="${signatureSrc}" alt="Firma de ${esc(validation.signerName)}"${evidenceValueAttr(signatureRaw)}/>` : '<p class="dim">Firma no disponible en este dispositivo todavía (pendiente de sincronizar).</p>'}
    </div>
  `);
}

// "Ver conflicto" — 2+ validaciones activas para el MISMO registro (doble
// firma offline/multidispositivo, ver docs/GREASE_VALIDATION_AUDIT.md §10).
// Muestra TODAS completas (nombre/rol/fecha/motivo/firma), sin elegir
// ninguna ni borrar nada — la resolución (marcar cuál es la válida) NO está
// implementada todavía (ver docs/GREASE_VALIDATION_AUDIT.md §13).
async function openValidationConflictModal(validationsActivas, equipment, recordDate) {
  // Misma resolución que openValidationDetailModal(), para cada firma —
  // todas se piden en paralelo antes de armar el modal (nunca una a la vez).
  const signatureRaws = validationsActivas.map(v => v.signatureLocal || v.signatureUrl);
  const signatureSrcs = await Promise.all(signatureRaws.map(v => resolveEvidenceSrc(v)));
  openModal(`Conflicto de validación (${validationsActivas.length})`, `
    <p class="dim">${validationsActivas.length} personas validaron este mismo engrase por separado (probablemente offline, en dispositivos distintos). Ninguna firma se eliminó — revisa cuál es la correcta manualmente.</p>
    ${recordDate ? `<div class="val-info"><div class="val-info-row"><span>Fecha/hora del engrase</span><span>${fmtDate(recordDate)}</span></div></div>` : ''}
    ${validationsActivas.map((validation, idx) => {
      const signatureSrc = signatureSrcs[idx];
      return `
      <div class="val-conflict-item">
        <div class="val-conflict-item-head">Firma ${idx + 1}</div>
        <div class="val-info">
          <div class="val-info-row"><span>Nombre</span><span>${esc(validation.signerName)}</span></div>
          <div class="val-info-row"><span>Rol</span><span>${validation.signerRole === 'ENCARGADO' ? 'Encargado' : 'Operador'}</span></div>
          <div class="val-info-row"><span>Fecha/hora</span><span>${fmtDate(validation.signedAt)}</span></div>
          ${validation.reason ? `<div class="val-info-row"><span>Motivo</span><span>${esc(validation.reason)}</span></div>` : ''}
        </div>
        <div class="val-signature-wrap">
          ${signatureSrc ? `<img class="val-signature-canvas" src="${signatureSrc}" alt="Firma de ${esc(validation.signerName)}"${evidenceValueAttr(signatureRaws[idx])}/>` : '<p class="dim">Firma no disponible en este dispositivo todavía.</p>'}
        </div>
      </div>`;
    }).join('')}
  `);
}

async function drawHistory(equipmentId) {
  const equipment = await DB.get('equipment', equipmentId);
  const allRecords = (await DB.allActive('lubrication_records')).filter(r => r.equipmentId === equipmentId).sort((a, b) => new Date(b.date) - new Date(a.date));
  const allAnomalies = (await DB.allActive('anomalies')).filter(a => a.equipmentId === equipmentId);
  // Cierre histórico, Parte B (§11/§12/§13/§15): "No se pudo ejecutar"
  // NUNCA había aparecido en Historial — los lubrication_skips se mezclan
  // ahora en la MISMA tabla de "Engrases" (nunca se borra ni se oculta un
  // NO EJECUTADO cuando el turno siguiente sí engrasa; ambos eventos
  // quedan, en su propio orden cronológico real).
  const allSkips = (await DB.allActive('lubrication_skips')).filter(s => s.equipmentId === equipmentId).sort((a, b) => new Date(b.date) - new Date(a.date));
  const lubricants = await DB.allActive('lubricants');
  const locationsHist = await DB.allActive('locations');
  const locNameHist = (id) => (locationsHist.find(l => l.id === id) || {}).name || 'Sin ubicación';
  // Ubicación de CADA registro AL MOMENTO en que se hizo (§1 del cierre de
  // lote): usa el snapshot guardado en ese registro si existe; para
  // registros de antes de este lote, cae a la ubicación ACTUAL del equipo
  // (marcado con "*" — nunca se presenta como si fuera dato histórico real,
  // ver resolveRecordEquipmentLocationId() en operational-scope.js).
  const ubicacionRecordHTML = (r) => {
    const { value, source } = resolveRecordEquipmentLocationId(r, equipment);
    const nombre = value ? locNameHist(value) : 'Sin ubicación';
    return source === 'snapshot'
      ? esc(nombre)
      : `<span title="Registro anterior al historial de ubicaciones: se muestra la ubicación ACTUAL del equipo, no necesariamente la de ese momento">${esc(nombre)} *</span>`;
  };
  // Tipo de ejecución (§18 del lote "engrase fuera de plan"): distingue
  // PLANIFICADO/ASIGNADO/FUERA DE PLAN — para FUERA DE PLAN se agrega motivo
  // + completo/parcial en el título (tooltip), sin ensuciar la tabla con más
  // columnas de las necesarias.
  const OOP_REASON_LABELS_HIST = { PM: 'PM / Mantenimiento preventivo', CORRECTIVO: 'Mantenimiento correctivo', OPORTUNIDAD: 'Oportunidad operativa', OTRO: 'Otro' };
  const tipoRecordHTML = (r) => {
    const { value: tipo } = resolveRecordExecutionType(r);
    if (tipo === 'OUT_OF_PLAN') {
      const motivo = resolveRecordOutOfPlanReason(r);
      const completeness = resolveRecordCompleteness(r);
      const detalle = [motivo ? OOP_REASON_LABELS_HIST[motivo] || motivo : null, completeness === 'COMPLETE' ? 'Completo' : completeness === 'PARTIAL' ? 'Parcial' : null].filter(Boolean).join(' · ');
      return `<span class="oop-badge" style="margin-bottom:0" title="${esc(detalle)}">Fuera de plan</span>`;
    }
    if (tipo === 'ASSIGNED') return '<span class="status-chip" style="--c:var(--amber)">Asignado</span>';
    return '<span class="dim">Planificado</span>';
  };
  const plan = (await DB.allActive('lubrication_plans')).find(p => p.equipmentId === equipmentId) || null;
  const validations = await DB.allActive('grease_validations');
  const isAdmin = App.currentUser.role === 'ADMINISTRADOR';

  // Filtro de período (Desde/Hasta) SOLO para este equipo — independiente del
  // buscador/filtros de "Historial global" (ids distintos, sin estado
  // compartido). Vacíos = todo el historial del equipo. Afecta Engrases Y
  // Anomalías a la vez (AND con el equipo ya seleccionado).
  $('#hist-area').innerHTML = `
    <div class="hist-eq-period-row">
      <label class="filter-label hist-eq-period-filter">Desde <input type="date" id="hist-eq-from" class="input input-sm"/></label>
      <label class="filter-label hist-eq-period-filter">Hasta <input type="date" id="hist-eq-to" class="input input-sm"/></label>
      <button type="button" class="hist-eq-clear-dates hidden" id="hist-eq-clear-dates">✕ Limpiar fechas</button>
    </div>
    <div id="hist-eq-content"></div>
  `;

  async function renderPeriodContent() {
    const fromVal = $('#hist-eq-from').value;
    const toVal = $('#hist-eq-to').value;
    const from = fromVal ? new Date(fromVal + 'T00:00:00') : null;
    const to = toVal ? new Date(toVal + 'T23:59:59') : null;
    const filtered = !!(from || to);
    $('#hist-eq-clear-dates').classList.toggle('hidden', !filtered);

    const records = allRecords.filter(r => {
      const d = new Date(r.date);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    const anomalies = allAnomalies.filter(a => {
      const d = new Date(a.createdAt);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    const skipsDelPeriodo = allSkips.filter(s => {
      const d = new Date(s.date);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    // Línea temporal unificada (§11/§15): ENGRASE y NO_EJECUTADO ordenados
    // por fecha real descendente, igual criterio que `records` a secas
    // (más reciente primero) — nunca se separan en 2 listas distintas.
    const eventosHist = [
      ...records.map(r => ({ tipo: 'ENGRASE', date: r.date, record: r })),
      ...skipsDelPeriodo.map(s => ({ tipo: 'NO_EJECUTADO', date: s.date, skip: s })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    let avgInterval = '—';
    if (records.length > 1) {
      const sorted = [...records].sort((a, b) => a.hourmeter - b.hourmeter);
      let diffs = [];
      for (let i = 1; i < sorted.length; i++) diffs.push(sorted[i].hourmeter - sorted[i - 1].hourmeter);
      avgInterval = fmt(diffs.reduce((a, b) => a + b, 0) / diffs.length, 1) + ' h';
    }

    // Condición larga (puntos sin engrasar / sin horómetro) se resume como
    // insignia corta + "Ver detalle" (modal), en vez de romper la fila de la
    // tabla con texto largo — el detalle completo no se pierde, solo se oculta
    // hasta que se pide.
    const condDetails = {};
    records.forEach(r => {
      const pend = (r.details || []).filter(d => !d.done);
      const avisos = [];
      if (pend.length) avisos.push(`<div class="pendiente-nota">${pend.length} punto(s) sin engrasar: ${pend.map(d => `${esc(d.pointName)} <i>(${esc(d.reason || 'sin motivo')})</i>`).join(', ')}</div>`);
      if (r.sinHorometro) avisos.push(`<div class="pendiente-nota">⚠ Sin lectura de horómetro: ${esc(r.noHourmeterReason || 'no se pudo leer')}</div>`);
      condDetails[r.id] = avisos.join('');
    });

    // KPI del período filtrado (con etiqueta que lo deja claro) cuando hay
    // fechas activas; histórico total del equipo cuando no las hay. El
    // horómetro actual es el valor EN VIVO del equipo — no es un dato de
    // período, así que nunca cambia con este filtro.
    const ahoraValHist = new Date(); // una sola vez — nunca fecha de sync/apertura de pantalla
    // Gap de Storage privado cerrado (ver docs/STORAGE_PRIVACY_DESIGN.md
    // §7): fotos de engrase/anomalías pueden venir de otro dispositivo.
    const [recordPhotoSrcs, anomalyPhotoSrcs] = await Promise.all([
      Promise.all(records.map(r => resolvePhotoThumbSrcs(r))),
      Promise.all(anomalies.map(a => resolvePhotoThumbSrcs(a))),
    ]);
    $('#hist-eq-content').innerHTML = `
      <div class="kpi-grid hist-kpi-grid">
        <div class="kpi-card"><div class="kpi-value mono">${fmt(equipment.hourmeter)} h</div><div class="kpi-label">Horómetro actual</div></div>
        <div class="kpi-card"><div class="kpi-value">${records.length}</div><div class="kpi-label">Engrases ${filtered ? 'en el período' : 'registrados'}</div></div>
        <div class="kpi-card"><div class="kpi-value">${avgInterval}</div><div class="kpi-label">Intervalo promedio ${filtered ? '(período)' : 'real'}</div></div>
        <div class="kpi-card ${anomalies.length ? 'tone-amber' : ''}"><div class="kpi-value">${anomalies.length}</div><div class="kpi-label">Anomalías ${filtered ? 'en el período' : 'registradas'}</div></div>
        <div class="kpi-card ${skipsDelPeriodo.length ? 'tone-amber' : ''}"><div class="kpi-value">${skipsDelPeriodo.length}</div><div class="kpi-label">No ejecutados ${filtered ? 'en el período' : 'registrados'}</div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Engrases</h3></div>
        <table class="data-table hist-table">
          <thead><tr><th>Fecha</th><th>Turno</th><th>Ubicación</th><th>Tipo</th><th>Horómetro</th><th>Responsable</th><th>Grasa</th><th>Cantidad (${GREASE_UNIT})</th><th>Condición</th><th>Cumplimiento</th><th>Validación</th><th>Foto</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
          <tbody>
            ${eventosHist.map((ev, i) => {
              if (ev.tipo === 'NO_EJECUTADO') {
                const s = ev.skip;
                // Fila compacta (cierre histórico §12/§13): mismas columnas de
                // la tabla, pero la mayoría no aplica a un "no ejecutado" — se
                // dejan en "—" en vez de inventar un dato. Nunca se muestra el
                // código interno del motivo (NO_EXECUTION_REASON_LABELS ya
                // traduce a texto real).
                return `<tr data-skip="${s.id}" class="hist-row-skip">
                <td>${fmtDate(s.date)}</td>
                <td>${s.shiftId === 'shift_dia' ? 'Día' : 'Noche'}</td>
                <td>—</td>
                <td><span class="hist-noexec-badge">No ejecutado</span></td>
                <td class="mono">—</td>
                <td>${esc(s.userName)}</td>
                <td>—</td>
                <td>—</td>
                <td><button type="button" class="btn btn-sm hist-skip-detail" data-skip="${s.id}">${esc(NO_EXECUTION_REASON_LABELS[s.reason] || s.reason)}</button></td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
                ${isAdmin ? '<td></td>' : ''}
              </tr>`;
              }
              const r = ev.record;
              const compliance = evaluateRecordCompliance(r, plan, findPreviousRecord(r, allRecords));
              const activasEsteRegistro = findActiveValidations(r.id, validations);
              const valStatus = validationStatusForRecord(r, validations, ahoraValHist, App.generalSettings);
              // Histórico (anterior a GREASE_VALIDATION_ENABLED_FROM): nunca exige
              // firma — ni siquiera muestra el botón "Validar" — ver
              // docs/GREASE_VALIDATION_AUDIT.md §14. Vencida (ya pasó el plazo de
              // MAX_VALIDATION_SHIFTS turnos): tampoco se ofrece "Validar" — no se
              // crea firma retroactiva normal desde Historial.
              const valAction = valStatus === VALIDATION_STATUS.HISTORICO || valStatus === VALIDATION_STATUS.VENCIDA ? '' :
                activasEsteRegistro.length === 0
                ? `<button type="button" class="btn btn-sm hist-validar-btn" data-rec="${r.id}">Validar</button>`
                : activasEsteRegistro.length === 1
                  ? `<button type="button" class="btn btn-sm hist-ver-validacion-btn" data-rec="${r.id}">Ver validación</button>`
                  : `<button type="button" class="btn btn-sm hist-ver-conflicto-btn" data-rec="${r.id}">Ver conflicto</button>`;
              const iRecords = records.indexOf(r); // índice real en `records` (recordPhotoSrcs está alineado con esa lista, no con eventosHist)
              return `<tr data-rec="${r.id}">
              <td>${fmtDate(r.date)}</td>
              <td>${r.shiftId === 'shift_dia' ? 'Día' : 'Noche'}</td>
              <td>${ubicacionRecordHTML(r)}</td>
              <td>${tipoRecordHTML(r)}</td>
              <td class="mono">${fmt(r.hourmeter)} h</td>
              <td>${esc(r.userName)}${r.retroactivo ? ` <span class="retro-tag" title="Capturado después por ${esc(r.capturadoPor || '')}">atrasado</span>` : ''}</td>
              <td>${(lubricants.find(l => l.id === r.greaseType) || {}).name || '—'}</td>
              <td class="mono">${fmt(r.qty, 1)} ${GREASE_UNIT}</td>
              <td><span class="hist-cond-badge">${esc(r.condition)}</span>${condDetails[r.id] ? ` <button type="button" class="hist-cond-link" data-rec="${r.id}">Ver detalle</button>` : ''}</td>
              <td>${complianceBadgeHTML(compliance)}</td>
              <td>${validationBadgeHTML(valStatus)} ${valAction}</td>
              <td>${photoThumbsHTML(r, `${esc(equipment.code)} · ${fmtDate(r.date)}`, recordPhotoSrcs[iRecords])}</td>
              ${isAdmin ? `<td><button type="button" class="icon-btn hist-del-btn btn-del-record" data-id="${r.id}" title="Eliminar registro">${ic("trash")}</button></td>` : ''}
            </tr>`;
            }).join('') || `<tr><td colspan="${isAdmin ? 13 : 12}" class="empty-state">${filtered ? 'Sin registros en este período.' : 'Sin registros.'}</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Anomalías</h3></div>
        <table class="data-table">
          <thead><tr><th>Fecha</th><th>Componente</th><th>Descripción</th><th>Criticidad</th><th>Estado</th><th>Foto</th></tr></thead>
          <tbody>
            ${anomalies.map((a, i) => `<tr><td>${fmtDate(a.createdAt)}</td><td>${esc(a.component)}</td><td>${esc(a.description)}</td><td>${esc(a.criticality)}</td><td>${esc(a.status)}</td><td>${photoThumbsHTML(a, `${esc(equipment.code)} · ${esc(a.component)}`, anomalyPhotoSrcs[i])}</td></tr>`).join('') || `<tr><td colspan="6" class="empty-state">${filtered ? 'Sin anomalías en este período.' : 'Sin anomalías.'}</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
    wirePhotoThumbs($('#hist-eq-content'));
    makeTablesResponsive($('#hist-eq-content'));

    $$('.hist-cond-link', $('#hist-eq-content')).forEach(b => b.addEventListener('click', () => {
      openModal('Detalle de la condición', condDetails[b.dataset.rec] || '<p class="dim">Sin detalles adicionales.</p>');
    }));

    // Detalle de "No ejecutado" (cierre histórico §16) — modal propio,
    // nunca reutiliza el flujo de Registrar Engrase (no hay nada que
    // registrar aquí, solo consultar lo que ya pasó).
    $$('.hist-skip-detail', $('#hist-eq-content')).forEach(b => b.addEventListener('click', () => {
      const s = allSkips.find(sk => sk.id === b.dataset.skip);
      if (!s) return;
      openModal('Detalle de "No se pudo ejecutar"', `
        <div class="form-grid">
          <div><b>Motivo</b><br>${esc(NO_EXECUTION_REASON_LABELS[s.reason] || s.reason)}</div>
          <div><b>Fecha/hora</b><br>${fmtDate(s.date)}</div>
          <div><b>Turno</b><br>${s.shiftId === 'shift_dia' ? 'Día' : 'Noche'}</div>
          <div><b>Registrado por</b><br>${esc(s.userName)}</div>
          ${s.observacion ? `<div class="span-2"><b>Observación</b><br>${esc(s.observacion)}</div>` : ''}
          ${s.linkedRecordId ? `<div class="span-2"><b>✓ Vinculado a un engrase real</b> (conciliado, ver fila del ${fmtDate((allRecords.find(r => r.id === s.linkedRecordId) || {}).date || '')} en esta misma tabla)</div>` : ''}
        </div>`);
    }));

    $$('.hist-validar-btn', $('#hist-eq-content')).forEach(b => b.addEventListener('click', async () => {
      const rec = records.find(r => r.id === b.dataset.rec);
      if (rec) openValidationModal(rec, equipment, () => drawHistory(equipmentId));
    }));
    $$('.hist-ver-validacion-btn', $('#hist-eq-content')).forEach(b => b.addEventListener('click', async () => {
      const validation = findActiveValidation(b.dataset.rec, validations);
      const rec = records.find(r => r.id === b.dataset.rec);
      if (validation) await openValidationDetailModal(validation, equipment, rec ? rec.date : null);
    }));
    $$('.hist-ver-conflicto-btn', $('#hist-eq-content')).forEach(b => b.addEventListener('click', async () => {
      const activas = findActiveValidations(b.dataset.rec, validations);
      const rec = records.find(r => r.id === b.dataset.rec);
      if (activas.length > 1) await openValidationConflictModal(activas, equipment, rec ? rec.date : null);
    }));

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

  renderPeriodContent();
  $('#hist-eq-from').addEventListener('change', renderPeriodContent);
  $('#hist-eq-to').addEventListener('change', renderPeriodContent);
  $('#hist-eq-clear-dates').addEventListener('click', () => {
    $('#hist-eq-from').value = '';
    $('#hist-eq-to').value = '';
    renderPeriodContent();
  });
}

/* ============================================================
   REPORTES
   ============================================================ */
// "YYYY-MM-DD" (valor nativo de <input type="date">) → "DD/MM/YYYY" para
// mostrar el período de forma compacta — puramente visual, no toca ninguna
// fecha usada en cálculos (esas siguen leyendo el input directo).
function ddmmyyyy(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

// Agrupa un rango de días en "cubetas" para la Tendencia de cumplimiento:
// 1 cubeta por día si el rango es corto (≤31 días, mismo criterio que "un
// mes" para no saturar el eje X); si es más amplio, 1 cubeta por semana
// (Lunes a Domingo) — infraestructura simple reutilizando el mismo cálculo
// de programado/realizado por cubeta, sin inventar un tercer criterio.
function construirBucketsTendencia(dias) {
  if (dias.length <= 31) return dias.map(d => ({ label: d.toLocaleDateString('es-NI', { day: '2-digit', month: '2-digit' }), dias: [d] }));
  const buckets = [];
  let actual = null;
  dias.forEach(d => {
    if (!actual || actual.dias.length >= 7) {
      actual = { label: d.toLocaleDateString('es-NI', { day: '2-digit', month: '2-digit' }), dias: [] };
      buckets.push(actual);
    }
    actual.dias.push(d);
  });
  return buckets;
}

// REPORTES / INFORMES — análisis HISTÓRICO por período (distinto del
// Dashboard: estado actual/alertas/acciones inmediatas). Pregunta que debe
// responder: "¿cómo nos fue en este período, qué no se cumplió y por qué?".
// El reporte principal es Realizados/Programados (computeProgramadoRealizadoPeriodo,
// src/core/plan-compliance.js) — SOLO planes Día/Turno, ver esa función para
// por qué los planes por Horas se excluyen a propósito (no se inventa una
// proyección horómetro→fecha). Validación de engrases usa el mismo baseline
// GREASE_VALIDATION_ENABLED_FROM del resto de la app (ver
// docs/GREASE_VALIDATION_AUDIT.md §14) — mientras siga en null, la sección
// se muestra como pendiente de configurar, nunca con datos fabricados.
async function renderReportes() {
  const c = $('#app-content');
  if (!c) return; // la pantalla ya no está en el documento (cambio de vista o de usuario)
  const equipos = await DB.allActive('equipment');
  const allRecords = await DB.allActive('lubrication_records');
  const anomalies = await DB.allActive('anomalies');
  // Cierre histórico, Parte C (§17-§22 del pedido): lubrication_skips
  // entran al análisis histórico como su PROPIA categoría — NUNCA se
  // cuentan como lubrication_records (un "no ejecutado" nunca es un
  // engrase realizado, ver §20).
  const allSkips = await DB.allActive('lubrication_skips');
  const users = await DB.allActive('users');
  const locations = await DB.allActive('locations');
  const lubricants = await DB.allActive('lubricants');
  const types = await DB.allActive('equipment_types');
  // TODAS (no solo activas) — solo para typePorId/locPorId (texto en
  // pantalla/exports). `types`/`locations` de arriba siguen activas-solo:
  // alimentan los <select> de filtro de esta pantalla. Mismo bug real que
  // DATA-PENDING-A02 (docs/BUG_REGISTER.md): un equipo con ubicación/familia
  // ya desactivada no debe perder su nombre en Reportes/exports.
  const typesAll = await DB.all('equipment_types');
  const locationsAll = await DB.all('locations');
  const plans = await DB.allActive('lubrication_plans');
  const validations = await DB.allActive('grease_validations');
  // Exportación de "No ejecutados" (§4 del pedido, columna "Cuadrilla"): el
  // skip no guarda su propia cuadrilla (no existe ese campo en el modelo),
  // así que se resuelve vía la cuadrilla ACTUAL del usuario que lo registró
  // — mismo fallback controlado que ya usa el resto de la app cuando no hay
  // snapshot histórico (nunca se inventa una cuadrilla).
  const cuadrillas = await DB.allActive('cuadrillas');
  const statuses = await computeAllStatuses(equipos);

  const equiposPorId = {}; equipos.forEach(e => equiposPorId[e.id] = e);
  const planByEquipoId = {}; plans.forEach(p => planByEquipoId[p.equipmentId] = p);
  const typePorId = {}; typesAll.forEach(t => typePorId[t.id] = t);
  const lubPorId = {}; lubricants.forEach(l => lubPorId[l.id] = l);
  const locPorId = {}; locationsAll.forEach(l => locPorId[l.id] = l);
  const usersPorId = {}; users.forEach(u => usersPorId[u.id] = u);
  const cuadrillasPorId = {}; cuadrillas.forEach(cq => cuadrillasPorId[cq.id] = cq);

  const total = equipos.length;

  const today = new Date();
  const toInput = today.toISOString().slice(0, 10);
  // Antes: sin límite por defecto ("todo el historial"), lo que impedía
  // calcular Programados/Realizados (necesita un rango ACOTADO de días para
  // recorrer). 30 días es un período de análisis inicial razonable — se
  // amplía con el filtro Desde, nunca se oculta nada silenciosamente (el
  // filtro queda visible y editable).
  const fromInput = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

  c.innerHTML = `
    <div class="rep-page layout-wide">
    ${total === 0 ? `<div class="panel"><div class="empty-state">No hay equipos registrados en este dispositivo todavía. Si ya los cargaste en otro dispositivo, ve a Configuración → Sincronización y confirma que esté conectado — puede que falte sincronizar.</div></div>` : ''}

    <div class="panel">
      <div class="panel-head"><h3>Filtros del informe</h3></div>
      <div class="toolbar rep-filters-row" style="padding:0 14px 14px">
        <label class="filter-label rep-filter-narrow">Desde <input type="date" id="f-from" class="input input-sm" value="${fromInput}"/></label>
        <label class="filter-label rep-filter-narrow">Hasta <input type="date" id="f-to" class="input input-sm" value="${toInput}" max="${toInput}"/></label>
        <label class="filter-label rep-filter-wide">Equipo
          <select id="f-equipo" class="input input-sm">
            <option value="">Todos</option>
            ${equipos.map(e => `<option value="${e.id}">${esc(e.code)} · ${esc(e.brand)} ${esc(e.model)}</option>`).join('')}
          </select>
        </label>
        <label class="filter-label rep-filter-wide">Familia
          <select id="f-familia" class="input input-sm">
            <option value="">Todas</option>
            ${types.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
          </select>
        </label>
        <label class="filter-label rep-filter-wide">Ubicación
          <select id="f-ubic" class="input input-sm">
            <option value="">Todas</option>
            ${locations.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}
          </select>
        </label>
        <label class="filter-label rep-filter-mid">Turno
          <select id="f-turno" class="input input-sm">
            <option value="">Ambos</option><option value="shift_dia">Día</option><option value="shift_noche">Noche</option>
          </select>
        </label>
        <label class="filter-label rep-filter-mid">Responsable
          <select id="f-resp" class="input input-sm">
            <option value="">Todos</option>
            ${users.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}
          </select>
        </label>
        <button class="btn btn-accent rep-filter-apply" id="f-apply">Aplicar filtros</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Resumen del período</h3></div>
      <div id="rep-resumen"></div>
    </div>

    <div class="rep-tendencia-turno-grid">
      <div class="panel">
        <div class="panel-head"><h3>Tendencia de cumplimiento</h3></div>
        <div class="dim" style="padding:0 14px 10px">Cumplimiento % (realizados/programados) por día, o por semana si el rango es amplio. Independiente de Cumplimiento operativo del Dashboard.</div>
        <div class="chart-box rep-chart-tendencia-box" id="chart-tendencia-box"></div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Cumplimiento por turno</h3></div>
        <div id="rep-turno-area" class="rep-turno-grid"></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Cumplimiento por equipo</h3></div>
      <div class="dim" style="padding:0 14px 10px">Ordenado de MENOR a mayor cumplimiento — más engrases no es mejor desempeño, esta lista es para detectar dónde actuar.</div>
      <div id="rep-equipo-area"></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Consumo de grasa</h3></div>
      <div id="rep-consumo-stats"></div>
      <div class="rep-tabs" id="rep-consumo-tabs" role="tablist">
        <button type="button" class="rep-tab active" data-tab="equipo" role="tab" aria-selected="true">Por equipo</button>
        <button type="button" class="rep-tab" data-tab="familia" role="tab" aria-selected="false">Por familia</button>
        <button type="button" class="rep-tab" data-tab="lubricante" role="tab" aria-selected="false">Por lubricante</button>
      </div>
      <div class="chart-box rep-chart-consumo-box" id="chart-consumo-box"></div>
    </div>

    <div class="rep-pareto-anomalias-grid">
      <div class="panel">
        <div class="panel-head"><h3>Puntos no engrasados</h3></div>
        <div class="dim" style="padding:0 14px 8px">Motivos más frecuentes en el período — detalle completo más abajo.</div>
        <div id="rep-motivos-pareto"></div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Anomalías de lubricación</h3></div>
        <div id="rep-anomalias-area"></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Detalle de puntos no engrasados</h3></div>
      <div id="skipped-points-area"></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>No ejecutados</h3></div>
      <div class="dim" style="padding:0 14px 8px">"No se pudo ejecutar" (lubrication_skips) — NUNCA se cuenta como engrase realizado, aunque el turno siguiente sí lo haya hecho (ver Historial para esa secuencia completa).</div>
      <div id="rep-no-ejecutados-area"></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Validación de engrases</h3></div>
      <div id="rep-validacion-area"></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Actividad por responsable</h3></div>
      <div id="rep-actividad-resp-area"></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Evidencia fotográfica</h3></div>
      <div class="rep-photo-toggle-row">
        <span id="rep-photo-count" class="dim">Cargando…</span>
        <button type="button" class="btn btn-sm" id="rep-photo-toggle">Ver fotos</button>
      </div>
      <div id="photo-report-grid" class="photo-report-grid hidden"></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Generar informe</h3></div>
      <div style="padding:0 14px 6px" class="dim">Usan los mismos filtros de arriba.</div>
      <div class="toolbar" style="padding:0 14px 10px">
        <button class="btn btn-accent" id="exp-pdf">${ic("download")}Informe ejecutivo (PDF)</button>
        <button class="btn btn-accent" id="exp-excel">${ic("download")}Informe completo (Excel)</button>
      </div>
      <details class="rep-more-exports" style="padding:0 14px 14px">
        <summary class="btn btn-sm">Más exportaciones ▾</summary>
        <div class="toolbar" style="padding-top:10px">
          <button class="btn btn-sm" id="exp-cumplimiento">${ic("download")}Cumplimiento (CSV)</button>
          <button class="btn btn-sm" id="exp-historico">${ic("download")}Histórico de engrases (CSV)</button>
          <button class="btn btn-sm" id="exp-anomalias">${ic("download")}Anomalías (CSV)</button>
          <button class="btn btn-sm" id="exp-puntos">${ic("download")}Puntos no engrasados (CSV)</button>
          <button class="btn btn-sm" id="exp-no-ejecutados">${ic("download")}No ejecutados (CSV)</button>
        </div>
      </details>
    </div>
    </div>`;

  const charts = {};
  function destroyChart(key) { if (charts[key]) { charts[key].destroy(); delete charts[key]; } }
  function destroyCharts() { Object.keys(charts).forEach(destroyChart); }

  // Estado de la pestaña activa de "Consumo de grasa" — persiste entre
  // llamadas a drawAll() (ej. al "Aplicar filtros") dentro del mismo render
  // de la pantalla, se reinicia solo si se vuelve a entrar a Reportes.
  let consumoTabActual = 'equipo';
  let consumoDatasets = null;

  // Equipos que pasan Equipo/Familia/Ubicación (sin fecha) — universo de
  // "programados" (Tendencia/por turno/por equipo): esto SÍ es correcto que
  // use la ubicación ACTUAL del equipo, porque "programado" es un concepto
  // del plan vigente HOY, no un dato histórico.
  function equiposFiltrados() {
    const eqId = $('#f-equipo').value;
    const fam = $('#f-familia').value;
    const ubic = $('#f-ubic').value;
    return equipos.filter(e => {
      if (eqId && e.id !== eqId) return false;
      if (fam && e.typeId !== fam) return false;
      if (ubic && e.locationId !== ubic) return false;
      return true;
    });
  }

  // Pendiente cerrado (§23/§24 del cierre de lote): los REGISTROS reales
  // (a diferencia de "programados" arriba) se filtran por Equipo/Familia
  // usando el equipo actual (esos dos campos no cambian con el tiempo), pero
  // por UBICACIÓN usan resolveRecordEquipmentLocationId() — la ubicación
  // real AL MOMENTO de ejecutarse cuando el registro tiene snapshot, nunca
  // la ubicación ACTUAL del equipo (que pudo moverse después). Registros
  // sin snapshot (de antes de este lote) siguen cayendo a la ubicación
  // actual, exactamente el comportamiento de siempre — fallback controlado,
  // nunca se inventa dónde estuvo el equipo en el pasado.
  function equiposFiltradosPorEquipoYFamilia() {
    const eqId = $('#f-equipo').value;
    const fam = $('#f-familia').value;
    return equipos.filter(e => {
      if (eqId && e.id !== eqId) return false;
      if (fam && e.typeId !== fam) return false;
      return true;
    });
  }

  function applyFilters() {
    const from = $('#f-from').value ? new Date($('#f-from').value + 'T00:00:00') : null;
    const to = $('#f-to').value ? new Date($('#f-to').value + 'T23:59:59') : null;
    const turno = $('#f-turno').value;
    const respId = $('#f-resp').value;
    const ubic = $('#f-ubic').value;
    const idsPermitidos = new Set(equiposFiltradosPorEquipoYFamilia().map(e => e.id));
    return allRecords.filter(r => {
      if (!idsPermitidos.has(r.equipmentId)) return false;
      if (ubic && resolveRecordEquipmentLocationId(r, equiposPorId[r.equipmentId]).value !== ubic) return false;
      const d = new Date(r.date);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (turno && r.shiftId !== turno) return false;
      if (respId && r.userId !== respId) return false;
      return true;
    });
  }

  function applyFiltersAnomalias() {
    const from = $('#f-from').value ? new Date($('#f-from').value + 'T00:00:00') : null;
    const to = $('#f-to').value ? new Date($('#f-to').value + 'T23:59:59') : null;
    const respId = $('#f-resp').value;
    const respUser = respId ? users.find(u => u.id === respId) : null;
    const idsPermitidos = new Set(equiposFiltrados().map(e => e.id));
    return anomalies.filter(a => {
      if (!idsPermitidos.has(a.equipmentId)) return false;
      const d = new Date(a.createdAt);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (respUser && a.createdBy !== respUser.name) return false;
      return true;
    });
  }

  // Cierre histórico, Parte C (§17) — MISMOS filtros (Desde/Hasta/Equipo/
  // Familia/Ubicación/Turno/Responsable) que applyFilters() aplica a
  // lubrication_records, para que "No ejecutados" responda a los mismos
  // controles del resto del informe sin un criterio propio.
  function applyFiltersSkips() {
    const from = $('#f-from').value ? new Date($('#f-from').value + 'T00:00:00') : null;
    const to = $('#f-to').value ? new Date($('#f-to').value + 'T23:59:59') : null;
    const turno = $('#f-turno').value;
    const respId = $('#f-resp').value;
    const ubic = $('#f-ubic').value;
    const idsPermitidos = new Set(equiposFiltradosPorEquipoYFamilia().map(e => e.id));
    return allSkips.filter(s => {
      if (!idsPermitidos.has(s.equipmentId)) return false;
      if (ubic && (equiposPorId[s.equipmentId] || {}).locationId !== ubic) return false;
      const d = new Date(s.date);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (turno && s.shiftId !== turno) return false;
      if (respId && s.userId !== respId) return false;
      return true;
    });
  }

  // Exportación de "No ejecutados" (lote dedicado, CSV/Excel/PDF): texto
  // legible de los filtros ACTIVOS del informe — reusa los mismos inputs
  // que applyFilters()/applyFiltersSkips() ya leen, nunca un criterio
  // propio. Solo lista lo que el usuario realmente eligió (§3/§6/§7).
  function filtrosActivosTexto() {
    const partes = [];
    const ubicId = $('#f-ubic').value; if (ubicId) partes.push(`Ubicación: ${(locPorId[ubicId] || {}).name || ubicId}`);
    const famId = $('#f-familia').value; if (famId) partes.push(`Familia: ${(typePorId[famId] || {}).name || famId}`);
    const eqId = $('#f-equipo').value; if (eqId) partes.push(`Equipo: ${(equiposPorId[eqId] || {}).code || eqId}`);
    const turno = $('#f-turno').value; if (turno) partes.push(`Turno: ${turno === 'shift_dia' ? 'Día' : 'Noche'}`);
    const respId = $('#f-resp').value; if (respId) partes.push(`Responsable: ${(usersPorId[respId] || {}).name || respId}`);
    return partes.length ? partes.join('  ·  ') : 'Todos los equipos/turnos/responsables';
  }

  // Filas de detalle de "No ejecutados" para exportar — FUENTE ÚNICA para
  // CSV/Excel/PDF (§8/§16 del pedido: mismo orden en los 3 formatos, sin
  // recalcular nada por separado). `skipsF` ya viene filtrado por
  // applyFiltersSkips() — nunca se reconstruye desde audit_log ni se
  // cuentan lubrication_records aquí. Orden: más reciente primero, misma
  // convención que puntosNoEngrasadosDe() (única lista de detalle
  // comparable que ya existe en este informe).
  function noEjecutadosFilasDetalle(skipsF) {
    return [...skipsF].sort((a, b) => new Date(b.date) - new Date(a.date)).map(s => {
      const eq = equiposPorId[s.equipmentId];
      const usr = usersPorId[s.userId];
      const cuadrillaNombre = usr ? (cuadrillasPorId[usr.cuadrillaId] || {}).name : null;
      const horaTxt = (s.date || '').includes('T')
        ? new Date(s.date).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' })
        : '—';
      return {
        fecha: fmtDate(s.date),
        hora: horaTxt,
        codigo: eq ? eq.code : '—',
        modelo: eq ? `${eq.brand} ${eq.model}` : '—',
        ubicacion: (locPorId[(eq || {}).locationId] || {}).name || '—',
        turno: s.shiftId === 'shift_dia' ? 'Día' : 'Noche',
        motivo: NO_EXECUTION_REASON_LABELS[s.reason] || s.reason,
        observacion: s.observacion || '—',
        usuario: s.userName || '—',
        cuadrilla: cuadrillaNombre || '—',
        occurrence: s.occurrenceKey || '—',
        estado: s.linkedRecordId ? 'Vinculado a un engrase real' : 'Sin vincular',
      };
    });
  }

  // null si no hay "Desde" (no se puede acotar el recorrido de días) — el
  // valor por defecto del input ya trae 30 días, así que esto solo pasa si
  // la persona lo borra a mano.
  function diasDelPeriodo() {
    const from = $('#f-from').value ? new Date($('#f-from').value + 'T00:00:00') : null;
    if (!from) return null;
    const hoy = new Date(new Date().setHours(0, 0, 0, 0));
    const hastaInput = $('#f-to').value ? new Date($('#f-to').value + 'T00:00:00') : hoy;
    // Nunca contar días futuros como "programados": un "Hasta" en el futuro
    // (el input ya trae max=hoy, pero se re-valida aquí por si acaso) se
    // recorta a HOY — de lo contrario días que todavía no ocurren se
    // contarían como "no realizados" sin que fuera posible cumplirlos.
    const to = hastaInput > hoy ? hoy : hastaInput;
    const out = [];
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) out.push(new Date(d));
    return out;
  }

  // Puntos que quedaron sin engrasar + su motivo — usado tanto para pintar
  // la sección en pantalla como para el CSV (misma lógica, una sola vez).
  function puntosNoEngrasadosDe(records) {
    const filas = [];
    records.forEach(r => {
      const eq = equiposPorId[r.equipmentId];
      (r.details || []).filter(d => !d.done).forEach(d => {
        filas.push({ fecha: r.date, code: eq ? eq.code : '—', equipo: eq ? `${eq.brand} ${eq.model}` : '—', punto: d.pointName, motivo: d.reason || '(sin motivo anotado)', por: r.userName });
      });
      if (r.sinHorometro) {
        filas.push({ fecha: r.date, code: eq ? eq.code : '—', equipo: eq ? `${eq.brand} ${eq.model}` : '—', punto: '⚠ Sin lectura de horómetro', motivo: r.noHourmeterReason || 'No se pudo leer', por: r.userName });
      }
    });
    filas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    return filas;
  }

  // Fuente ÚNICA de Consumo (Resumen, sección Consumo, Excel y PDF calculan
  // exactamente esto — nunca cada uno por su cuenta). "qty válida" = número
  // finito (incluye 0); un registro sin horómetro/qty no cuenta ni en el
  // total ni en el denominador del promedio, para no diluirlo con ceros que
  // en realidad son "sin dato".
  function consumoDe(records) {
    const registrosConQty = records.filter(r => Number.isFinite(Number(r.qty)));
    const totalQty = registrosConQty.reduce((s, r) => s + Number(r.qty), 0);
    const promedio = registrosConQty.length ? totalQty / registrosConQty.length : null;
    return { totalQty, promedio, registrosConQty };
  }

  function drawResumen(records, dias, progReal) {
    const area = $('#rep-resumen');
    const { totalQty } = consumoDe(records);
    const consumoCard = `<div class="kpi-card tone-neutral"><div class="kpi-value">${fmt(totalQty, 1)}</div><div class="kpi-label">Consumo total (${GREASE_UNIT})</div></div>`;
    const periodoTxt = `Período: ${ddmmyyyy($('#f-from').value)} – ${ddmmyyyy($('#f-to').value) || ddmmyyyy(toInput)}`;
    if (!dias || !progReal) {
      area.innerHTML = `<div class="empty-state">Selecciona una fecha "Desde" para calcular Cumplimiento/Programados/Realizados.</div><div class="rep-resumen-grid">${consumoCard}</div>`;
      return;
    }
    const { programados, realizados } = progReal.general;
    const pct = programados ? Math.round((realizados / programados) * 100) : null;
    // No realizados = obligaciones programadas del período (Día/Turno) que
    // NO tuvieron ejecución válida — nunca negativo (Math.max), nunca cuenta
    // días futuros (dias ya viene recortado a HOY, ver diasDelPeriodo()),
    // nunca usa el total de equipos como denominador (parte de `programados`,
    // que ya es 1 slot por equipo/día programado, no por equipo existente).
    const noRealizados = Math.max(programados - realizados, 0);
    const tone = pct === null ? 'neutral' : pct >= App.generalSettings.complianceTarget ? 'green' : pct >= 80 ? 'amber' : 'red';
    // "Vencidos" NO va aquí a propósito: es estado ACTUAL de la flota
    // (Dashboard), no una métrica del período histórico filtrado.
    area.innerHTML = `<div class="dim rep-periodo-line">${periodoTxt}</div>
      <div class="rep-resumen-grid">
        <div class="kpi-card tone-${tone}"><div class="kpi-value">${pct === null ? '—' : pct + '%'}</div><div class="kpi-label">Cumplimiento del período</div></div>
        ${kpiCard('Programados', programados, 'neutral')}
        ${kpiCard('Realizados', realizados, 'green')}
        ${kpiCard('No realizados', noRealizados, noRealizados > 0 ? 'amber' : 'neutral')}
        ${consumoCard}
      </div>
      <div class="dim rep-resumen-note">Cumplimiento basado en planes Día/Turno evaluables.</div>`;
  }

  function drawTendencia(records, dias, equiposDT, turnoSel) {
    destroyChart('tendencia');
    const box = $('#chart-tendencia-box');
    if (!dias) { box.innerHTML = '<div class="empty-state">Selecciona una fecha "Desde" para ver la tendencia.</div>'; return; }
    if (!window.Chart) { box.innerHTML = '<div class="empty-state">No se pudo cargar el motor de gráficas (revisa tu conexión la primera vez que uses esta pantalla, luego funciona sin internet).</div>'; return; }
    box.innerHTML = '<canvas id="chart-tendencia"></canvas>';
    const buckets = construirBucketsTendencia(dias);
    const labels = buckets.map(b => b.label);
    const data = buckets.map(b => {
      const r = computeProgramadoRealizadoPeriodo(equiposDT, records, planByEquipoId, b.dias, turnoSel);
      return r.general.programados ? Math.round((r.general.realizados / r.general.programados) * 100) : null;
    });
    charts.tendencia = new Chart($('#chart-tendencia'), {
      type: 'line',
      data: { labels, datasets: [{ label: 'Cumplimiento %', data, borderColor: '#F2A900', backgroundColor: 'rgba(242,169,0,0.10)', fill: true, tension: 0.3, spanGaps: false, borderWidth: 2, pointRadius: labels.length > 20 ? 0 : 3 }] },
      options: {
        responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        ...(prefersReducedMotion() ? { animation: false } : {}),
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } },
          // Todos los datos siguen ahí (no se recorta ningún punto) — solo se
          // reduce cuántas ETIQUETAS del eje X se dibujan, para que no se
          // amontonen cuando el rango es amplio.
          x: { ticks: { autoSkip: true, maxTicksLimit: 8 } }
        }
      }
    });
  }

  function drawCumplimientoTurno(progReal) {
    const area = $('#rep-turno-area');
    if (!progReal) { area.innerHTML = '<div class="empty-state">Selecciona una fecha "Desde".</div>'; return; }
    area.innerHTML = [['shift_dia', 'Día'], ['shift_noche', 'Noche']].map(([id, label]) => {
      const t = progReal.porTurno[id];
      const pct = t.programados ? Math.round((t.realizados / t.programados) * 100) : null;
      const tone = pct === null ? 'neutral' : pct >= App.generalSettings.complianceTarget ? 'green' : pct >= 80 ? 'amber' : 'red';
      return `<div class="rep-turno-card tone-${tone}">
        <div class="rep-turno-label">${label}</div>
        <div class="rep-turno-pct">${pct === null ? '—' : pct + '%'}</div>
        <div class="rep-turno-frac">${t.realizados} de ${t.programados}</div>
        <div class="progress-track rep-turno-bar"><div class="progress-fill" style="width:${pct === null ? 0 : pct}%; background:${tone === 'neutral' ? 'var(--text-dim)' : `var(--${tone})`}"></div></div>
      </div>`;
    }).join('');
  }

  function drawCumplimientoEquipo(progReal) {
    const area = $('#rep-equipo-area');
    if (!progReal) { area.innerHTML = '<div class="empty-state">Selecciona una fecha "Desde".</div>'; return; }
    // Un equipo con 0 programados en el período (sin días asignados que
    // cayeran en el rango) NO tiene un cumplimiento que evaluar — mostrar 0%
    // lo haría ver como un incumplimiento cuando en realidad no le tocaba
    // nada. Se EXCLUYE del ranking principal (nunca se le inventa un 0%).
    const sinProgramacion = progReal.porEquipo.filter(x => x.programados === 0).length;
    const filas = progReal.porEquipo
      .filter(x => x.programados > 0)
      .map(x => ({ ...x, pct: Math.round((x.realizados / x.programados) * 100) }))
      .sort((a, b) => a.pct - b.pct); // MENOR cumplimiento primero: ayuda a decidir dónde actuar
    if (!filas.length) { area.innerHTML = '<div class="empty-state">Ningún equipo con plan Día/Turno tuvo días programados en este período.</div>'; return; }
    area.innerHTML = `<table class="data-table rep-equipo-table">
      <thead><tr><th>Código</th><th>Modelo</th><th>Realizados/Programados</th><th>Cumplimiento</th></tr></thead>
      <tbody>${filas.map(f => `<tr>
        <td class="mono">${esc(f.e.code)}</td>
        <td>${esc(f.e.brand)} ${esc(f.e.model)}</td>
        <td class="mono">${f.realizados}/${f.programados}</td>
        <td><span class="hist-compliance-badge ${f.pct >= App.generalSettings.complianceTarget ? 'hist-compliance-ok' : f.pct >= 80 ? 'hist-compliance-early' : 'hist-compliance-alert'}">${f.pct}%</span></td>
      </tr>`).join('')}</tbody>
    </table>
    ${sinProgramacion > 0 ? `<div class="dim rep-resumen-note">${sinProgramacion} equipo(s) sin programación en este período (0 días asignados dentro del rango) no se muestran aquí — no es un incumplimiento, simplemente no tenían nada programado.</div>` : ''}`;
    makeTablesResponsive(area);
  }

  // Consumo de grasa: UN solo gráfico con tabs (Por equipo/Familia/
  // Lubricante) en vez de 3 visualizaciones simultáneas — nunca se borra
  // ningún dato, "Por equipo" solo RECORTA VISUALMENTE el ranking a los
  // Top 7 con mayor consumo (excluye los de 0 lb del ranking, el detalle
  // completo sigue en la exportación/informe). La altura del canvas se fija
  // según la cantidad real de categorías (ver dibujarConsumoTab()).
  function drawConsumo(records) {
    const { totalQty, promedio, registrosConQty } = consumoDe(records);
    $('#rep-consumo-stats').innerHTML = `<div class="kpi-grid">
      <div class="kpi-card tone-neutral"><div class="kpi-value">${fmt(totalQty, 1)}</div><div class="kpi-label">Total (${GREASE_UNIT})</div></div>
      <div class="kpi-card tone-neutral"><div class="kpi-value">${promedio === null ? '—' : fmt(promedio, 2)}</div><div class="kpi-label">Promedio por engrase (${GREASE_UNIT})</div></div>
    </div>`;

    const byEq = {};
    registrosConQty.forEach(r => { const eq = equiposPorId[r.equipmentId]; const k = eq ? eq.code : '—'; byEq[k] = (byEq[k] || 0) + Number(r.qty); });
    const byFamilia = {};
    registrosConQty.forEach(r => { const eq = equiposPorId[r.equipmentId]; const t = eq ? typePorId[eq.typeId] : null; const k = t ? t.name : 'Sin familia'; byFamilia[k] = (byFamilia[k] || 0) + Number(r.qty); });
    const byLub = {};
    registrosConQty.forEach(r => { const l = lubPorId[r.greaseType]; const k = l ? l.name : 'Sin identificar'; byLub[k] = (byLub[k] || 0) + Number(r.qty); });

    consumoDatasets = {
      equipo: Object.entries(byEq).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 7),
      familia: Object.entries(byFamilia).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]),
      lubricante: Object.entries(byLub).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]),
    };
    dibujarConsumoTab(consumoTabActual);
  }

  function dibujarConsumoTab(tab) {
    consumoTabActual = tab;
    $$('.rep-tab', $('#rep-consumo-tabs')).forEach(b => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false'); });
    destroyChart('consumo');
    const box = $('#chart-consumo-box');
    const entries = (consumoDatasets && consumoDatasets[tab]) || [];
    if (!window.Chart) { box.innerHTML = '<div class="empty-state">No se pudo cargar el motor de gráficas.</div>'; return; }
    if (!entries.length) { box.innerHTML = '<div class="empty-state">Sin consumo registrado en este período.</div>'; return; }
    // Altura proporcional a la cantidad real de categorías — nunca reserva
    // espacio para filas que no existen (tope 220px, mínimo legible 120px).
    box.style.height = `${Math.max(120, Math.min(220, entries.length * 32 + 40))}px`;
    box.innerHTML = '<canvas id="chart-consumo"></canvas>';
    charts.consumo = new Chart($('#chart-consumo'), {
      type: 'bar',
      data: { labels: entries.map(([k]) => k), datasets: [{ data: entries.map(([, v]) => Math.round(v * 10) / 10), backgroundColor: '#E8A33D' }] },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, ...(prefersReducedMotion() ? { animation: false } : {}), scales: { x: { beginAtZero: true } } }
    });
  }

  // Pareto de motivos (compacto, en su propio panel junto a Anomalías) +
  // detalle (tabla completa, panel aparte más abajo) — misma información
  // que antes, ahora en 2 paneles separados para reducir la altura del
  // Pareto (pedido explícito de densidad). % junto al conteo se mantiene;
  // el CSV sigue en "Generar informe".
  function drawSkippedPoints(records) {
    const paretoArea = $('#rep-motivos-pareto');
    const detalleArea = $('#skipped-points-area');
    if (!paretoArea || !detalleArea) return;
    const filas = puntosNoEngrasadosDe(records);
    const porMotivo = {};
    filas.forEach(f => { porMotivo[f.motivo] = (porMotivo[f.motivo] || 0) + 1; });
    const resumen = Object.entries(porMotivo).sort((a, b) => b[1] - a[1]);

    paretoArea.innerHTML = !filas.length
      ? '<div class="empty-state">Sin puntos pendientes en este periodo — todos los engrases se completaron.</div>'
      : `<div class="skipped-summary">
          ${resumen.map(([motivo, n]) => `<span class="skipped-chip">${esc(motivo)}: <b>${n}</b> (${Math.round(n / filas.length * 100)}%)</span>`).join('')}
        </div>
        <div class="dim" style="padding:6px 14px 0">${filas.length} punto(s) pendiente(s)</div>`;

    detalleArea.innerHTML = !filas.length
      ? '<div class="empty-state">Sin puntos pendientes en este periodo.</div>'
      : `<table class="data-table">
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
    makeTablesResponsive(detalleArea);
  }

  // El modelo real de anomalías (ver formulario de edición, app.js) permite
  // 3 valores de `status`: 'Abierta', 'En atención', 'Cerrada' — NO existe
  // un estado "Resuelta" separado, así que nunca se inventa. "Abiertas"
  // (KPI) es status !== 'Cerrada' (agrupa Abierta+En atención, real y
  // correcto); el desglose "Por estado" de abajo muestra el valor EXACTO de
  // `status` tal como está en los datos, agrupado dinámicamente — si algún
  // día se agrega/quita un valor, esto sigue siendo fiel sin tocar código.
  function drawAnomaliasSeccion(anomaliasF) {
    const area = $('#rep-anomalias-area');
    const abiertas = anomaliasF.filter(a => a.status !== 'Cerrada').length;
    const cerradas = anomaliasF.filter(a => a.status === 'Cerrada').length;
    const porEstado = {};
    anomaliasF.forEach(a => { const k = a.status || 'Sin estado'; porEstado[k] = (porEstado[k] || 0) + 1; });
    const estadosOrdenados = Object.entries(porEstado).sort((a, b) => b[1] - a[1]);
    const porTipo = {};
    anomaliasF.forEach(a => { porTipo[a.component] = (porTipo[a.component] || 0) + 1; });
    const tiposOrdenados = Object.entries(porTipo).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const porEquipo = {};
    anomaliasF.forEach(a => { const eq = equiposPorId[a.equipmentId]; const k = eq ? eq.code : '—'; porEquipo[k] = (porEquipo[k] || 0) + 1; });
    const equiposOrdenados = Object.entries(porEquipo).sort((a, b) => b[1] - a[1]).slice(0, 5);

    area.innerHTML = `<div class="kpi-grid">
        ${kpiCard('Detectadas', anomaliasF.length, 'neutral')}
        ${kpiCard('Abiertas', abiertas, abiertas > 0 ? 'red' : 'neutral')}
        ${kpiCard('Cerradas', cerradas, 'green')}
      </div>
      ${anomaliasF.length ? `
      <div class="rep-subhead" style="padding:0 14px">Por estado (real)</div>
      <div class="skipped-summary">${estadosOrdenados.map(([k, n]) => `<span class="skipped-chip">${esc(k)}: <b>${n}</b> (${Math.round(n / anomaliasF.length * 100)}%)</span>`).join('')}</div>
      <div class="rep-two-col">
        <div>
          <div class="rep-subhead">Principales tipos</div>
          <div class="skipped-summary">${tiposOrdenados.map(([k, n]) => `<span class="skipped-chip">${esc(k)}: <b>${n}</b> (${Math.round(n / anomaliasF.length * 100)}%)</span>`).join('')}</div>
        </div>
        <div>
          <div class="rep-subhead">Equipos con más anomalías</div>
          ${equiposOrdenados.map(([k, n]) => `<div class="rep-consumo-row"><span class="mono">${esc(k)}</span><span>${n}</span></div>`).join('')}
        </div>
      </div>` : '<div class="empty-state">Sin anomalías en este período.</div>'}`;
  }

  // Cierre histórico, Parte C (§18/§19/§20 del pedido) — "No ejecutados":
  // total + desglose por motivo/ubicación/equipo/turno/fecha. NUNCA se
  // trata como cumplimiento (§20: un skip nunca cierra una ocurrencia por
  // sí mismo — eso sigue dependiendo 100% de que exista un
  // lubrication_record real, ya sea directo o vinculado vía
  // findMatchingGreaseRecordForOccurrence(); este panel es puramente
  // informativo, un conteo aparte).
  function drawNoEjecutadosSeccion(skipsF) {
    const area = $('#rep-no-ejecutados-area');
    const porMotivo = {};
    skipsF.forEach(s => { const k = NO_EXECUTION_REASON_LABELS[s.reason] || s.reason; porMotivo[k] = (porMotivo[k] || 0) + 1; });
    const motivosOrdenados = Object.entries(porMotivo).sort((a, b) => b[1] - a[1]);
    const porUbicacion = {};
    skipsF.forEach(s => { const k = (locPorId[(equiposPorId[s.equipmentId] || {}).locationId] || {}).name || 'Sin ubicación'; porUbicacion[k] = (porUbicacion[k] || 0) + 1; });
    const ubicacionesOrdenadas = Object.entries(porUbicacion).sort((a, b) => b[1] - a[1]);
    const porEquipo = {};
    skipsF.forEach(s => { const eq = equiposPorId[s.equipmentId]; const k = eq ? eq.code : '—'; porEquipo[k] = (porEquipo[k] || 0) + 1; });
    const equiposOrdenados = Object.entries(porEquipo).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const porTurno = { 'Día': 0, 'Noche': 0 };
    skipsF.forEach(s => { porTurno[s.shiftId === 'shift_dia' ? 'Día' : 'Noche']++; });

    area.innerHTML = `<div class="kpi-grid">
        ${kpiCard('No ejecutados', skipsF.length, skipsF.length ? 'amber' : 'neutral')}
        ${kpiCard('Turno Día', porTurno['Día'], 'neutral')}
        ${kpiCard('Turno Noche', porTurno['Noche'], 'neutral')}
      </div>
      ${skipsF.length ? `
      <div class="rep-subhead" style="padding:0 14px">Por motivo</div>
      <div class="skipped-summary">${motivosOrdenados.map(([k, n]) => `<span class="skipped-chip">${esc(k)}: <b>${n}</b> (${Math.round(n / skipsF.length * 100)}%)</span>`).join('')}</div>
      <div class="rep-two-col">
        <div>
          <div class="rep-subhead">Por ubicación</div>
          <div class="skipped-summary">${ubicacionesOrdenadas.map(([k, n]) => `<span class="skipped-chip">${esc(k)}: <b>${n}</b></span>`).join('')}</div>
        </div>
        <div>
          <div class="rep-subhead">Equipos con más "no ejecutados"</div>
          ${equiposOrdenados.map(([k, n]) => `<div class="rep-consumo-row"><span class="mono">${esc(k)}</span><span>${n}</span></div>`).join('')}
        </div>
      </div>` : '<div class="empty-state">Sin "no se pudo ejecutar" en este período.</div>'}`;
  }

  function drawValidacionSeccion(records) {
    const area = $('#rep-validacion-area');
    // Sin excepción propia de Reportes: `sujetos` sale de la MISMA función
    // central que usan Dashboard/Historial/Mis Engrases
    // (isRecordSubjectToValidation()) — mientras GREASE_VALIDATION_ENABLED_FROM
    // siga en null, ningún registro es "sujeto" todavía (ver
    // docs/GREASE_VALIDATION_AUDIT.md §14), así que `sujetos` da vacío solo,
    // nunca por una rama aparte aquí. El mensaje solo distingue el motivo
    // (nunca fabrica un porcentaje falso como si fuera un dato real).
    const sujetos = records.filter(r => isRecordSubjectToValidation(r.date));
    if (!sujetos.length) {
      area.innerHTML = GREASE_VALIDATION_ENABLED_FROM
        ? '<div class="empty-state">Ningún registro del período está sujeto a validación.</div>'
        : '<div class="empty-state">Validación pendiente de activación — todavía no se definió la fecha/hora desde la cual un engrase queda sujeto a validación (GREASE_VALIDATION_ENABLED_FROM). Ver docs/GREASE_VALIDATION_AUDIT.md.</div>';
      return;
    }
    // Mismas funciones centrales que Dashboard/Historial/Mis Engrases (no se
    // reimplementa el conteo 0/1/2+ ni el plazo de MAX_VALIDATION_SHIFTS
    // turnos aquí — isRecordPendingValidation()/isRecordValidationExpired()/
    // isRecordInConflict() son la única fuente).
    const ahoraVal = new Date();
    let validados = 0, pendientes = 0, conflictos = 0, vencidos = 0, porOperador = 0, porEncargado = 0;
    sujetos.forEach(r => {
      const activas = findActiveValidations(r.id, validations);
      if (activas.length > 1) { conflictos++; return; }
      if (activas.length === 1) { validados++; if (activas[0].signerRole === 'OPERADOR') porOperador++; else porEncargado++; return; }
      if (isRecordValidationExpired(r, validations, ahoraVal, App.generalSettings)) vencidos++;
      else pendientes++;
    });
    const pctValidado = Math.round(validados / sujetos.length * 100);
    area.innerHTML = `<div class="kpi-grid">
        ${kpiCard('Sujetos a validación', sujetos.length, 'neutral')}
        ${kpiCard('Validados', validados, 'green')}
        ${kpiCard('Pendientes', pendientes, pendientes > 0 ? 'amber' : 'neutral')}
        ${kpiCard('Vencidos', vencidos, vencidos > 0 ? 'red' : 'neutral')}
        ${kpiCard('Conflictos', conflictos, conflictos > 0 ? 'red' : 'neutral')}
        ${kpiCard('Por Operador', porOperador, 'neutral')}
        ${kpiCard('Por Encargado', porEncargado, 'neutral')}
      </div>
      <div class="dim rep-resumen-note">% validado: ${pctValidado}%. Los registros anteriores a la activación no entran en este cálculo. "Vencidos" superó el plazo de ${MAX_VALIDATION_SHIFTS} turnos sin firma.</div>`;
  }

  // Ranking compacto (tabla + barra, no un gráfico grande) — es secundario,
  // solo carga de trabajo registrada, NUNCA se interpreta como desempeño
  // (sin colores de aprobado/reprobado). % calculado sobre los registros del
  // período ya filtrado (records.length, el mismo conjunto que reciben el
  // resto de las secciones de Reportes). Barra: columna propia, proporcional
  // al responsable con MÁS engrases (compara carga entre personas, no contra
  // el total del período). Mini-resumen arriba (responsables activos/mayor
  // actividad) + nota de "no es desempeño" abajo con menor peso visual.
  function drawActividadResponsable(records) {
    const area = $('#rep-actividad-resp-area');
    const byResp = {};
    records.forEach(r => { byResp[r.userName] = (byResp[r.userName] || 0) + 1; });
    const entries = Object.entries(byResp).sort((a, b) => b[1] - a[1]);
    if (!entries.length) { area.innerHTML = '<div class="empty-state">Sin actividad registrada en este período.</div>'; return; }
    const total = records.length;
    const maxN = entries[0][1];
    area.innerHTML = `
      <div class="rep-actividad-sub">
        <span>Responsables activos: <span class="mono">${entries.length}</span></span>
        <span>Mayor actividad: <span class="mono">${esc(entries[0][0])}</span></span>
      </div>
      <div class="rep-actividad-table">
        <div class="rep-actividad-row rep-actividad-head">
          <span>Responsable</span><span>Engrases</span><span>%</span><span>Carga</span>
        </div>
        ${entries.map(([nombre, n]) => `
          <div class="rep-actividad-row">
            <span class="rep-actividad-nombre">${esc(nombre)}</span>
            <span class="rep-actividad-count mono">${n}</span>
            <span class="rep-actividad-pct mono">${Math.round(n / total * 100)}%</span>
            <span class="rep-actividad-bar-track"><span class="rep-actividad-bar-fill" style="width:${Math.round(n / maxN * 100)}%"></span></span>
          </div>`).join('')}
      </div>
      <div class="dim rep-actividad-nota">Carga de trabajo registrada — no es una medición de cumplimiento ni de desempeño laboral.</div>`;
  }

  function drawPhotoReport(records) {
    const from = $('#f-from').value ? new Date($('#f-from').value + 'T00:00:00') : null;
    const to = $('#f-to').value ? new Date($('#f-to').value + 'T23:59:59') : null;
    const respId = $('#f-resp').value;
    const respUser = respId ? users.find(u => u.id === respId) : null;
    const idsPermitidos = new Set(equiposFiltrados().map(e => e.id));

    const filteredAnomalies = anomalies.filter(a => {
      const d = new Date(a.createdAt);
      if (!idsPermitidos.has(a.equipmentId)) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (respUser && a.createdBy !== respUser.name) return false;
      return true;
    });

    const photoItems = [
      ...records.filter(r => r.photo).map(r => ({
        photo: r.photo, date: r.date, type: 'Engrase',
        eq: (equiposPorId[r.equipmentId] || {}).code || '—', by: r.userName
      })),
      ...filteredAnomalies.filter(a => a.photo).map(a => ({
        photo: a.photo, date: a.createdAt, type: 'Anomalía · ' + a.component,
        eq: (equiposPorId[a.equipmentId] || {}).code || '—', by: a.createdBy
      }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    $('#rep-photo-count').textContent = `${photoItems.length} evidencia(s)`;

    // Las fotos se cargan de a tandas. Antes se insertaban TODAS de golpe: con 300 fotos
    // de 40 KB cada una eso son ~12 MB de texto que el navegador tiene que procesar de
    // una sola vez, y la pantalla tardaba más de 7 segundos en abrir.
    const grid = $('#photo-report-grid');
    const POR_TANDA = 24;
    let mostradas = 0;

    async function pintarTanda() {
      const tanda = photoItems.slice(mostradas, mostradas + POR_TANDA);
      // Cada foto puede ser base64 local (se muestra directo) o una URL/path
      // de Storage que puede necesitar un signed URL (ver
      // docs/STORAGE_PRIVACY_DESIGN.md) — se resuelven las de ESTA tanda
      // nada más (nunca las 300 de golpe), en paralelo.
      const srcs = await Promise.all(tanda.map(p => resolveEvidenceSrc(p.photo)));
      const html = tanda.map((p, i) => `
        <div class="photo-report-item">
          <img src="${srcs[i]}" class="photo-thumb-lg" loading="lazy" data-full="${srcs[i]}" data-caption="${esc(p.eq)} · ${esc(p.type)} · ${fmtDate(p.date)}" alt="Foto de ${esc(p.eq)} · ${esc(p.type)}"${evidenceValueAttr(p.photo)}/>
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

  function drawAll() {
    const records = applyFilters();
    const eqsF = equiposFiltrados();
    const dias = diasDelPeriodo();
    const equiposDT = eqsF.filter(e => e.status === 'Operativo' && (planByEquipoId[e.id] || {}).controlType === 'Día y turno de la semana');
    const turnoSel = $('#f-turno').value || null;
    const progReal = dias ? computeProgramadoRealizadoPeriodo(equiposDT, records, planByEquipoId, dias, turnoSel) : null;

    try {
      drawResumen(records, dias, progReal);
      drawTendencia(records, dias, equiposDT, turnoSel);
      drawCumplimientoTurno(progReal);
      drawCumplimientoEquipo(progReal);
      drawConsumo(records);
      drawSkippedPoints(records);
      drawAnomaliasSeccion(applyFiltersAnomalias());
      drawNoEjecutadosSeccion(applyFiltersSkips());
      drawValidacionSeccion(records);
      drawActividadResponsable(records);
      drawPhotoReport(records);
    } catch (err) {
      console.error('Error dibujando reportes', err);
    }
  }

  $('#rep-photo-toggle').addEventListener('click', () => {
    const grid = $('#photo-report-grid');
    const oculto = grid.classList.toggle('hidden');
    $('#rep-photo-toggle').textContent = oculto ? 'Ver fotos' : 'Ocultar fotos';
  });

  $$('.rep-tab', $('#rep-consumo-tabs')).forEach(b => b.addEventListener('click', () => dibujarConsumoTab(b.dataset.tab)));

  drawAll();
  $('#f-apply').addEventListener('click', drawAll);

  $('#exp-cumplimiento').addEventListener('click', () => {
    const idsF = new Set(equiposFiltrados().map(e => e.id));
    const rows = [['Código', 'Equipo', 'Horómetro', 'Estado', 'Próximo engrase', 'Restante/Atraso']];
    statuses.filter(x => idsF.has(x.e.id)).forEach(({ e, s }) => rows.push([e.code, `${esc(e.brand)} ${esc(e.model)}`, e.hourmeter, s.label, s.nextHour ?? '', s.remaining ?? '']));
    downloadCSV(rows, 'reporte_cumplimiento_engrase.csv');
  });
  $('#exp-historico').addEventListener('click', () => {
    const records = applyFilters();
    const rows = [['Fecha', 'Equipo', 'Horómetro', 'Turno', 'Responsable', `Cantidad (${GREASE_UNIT})`, 'Condición']];
    records.forEach(r => {
      const eq = equiposPorId[r.equipmentId];
      rows.push([fmtDate(r.date), eq ? eq.code : '', r.hourmeter, r.shiftId === 'shift_dia' ? 'Día' : 'Noche', r.userName, r.qty, r.condition]);
    });
    downloadCSV(rows, 'historico_engrases.csv');
  });
  $('#exp-anomalias').addEventListener('click', () => {
    const rows = [['Fecha', 'Equipo', 'Componente', 'Descripción', 'Criticidad', 'Estado', 'Responsable']];
    applyFiltersAnomalias().forEach(a => {
      const eq = equiposPorId[a.equipmentId];
      rows.push([fmtDate(a.createdAt), eq ? eq.code : '', a.component, a.description, a.criticality, a.status, a.createdBy]);
    });
    downloadCSV(rows, 'reporte_anomalias.csv');
  });
  $('#exp-puntos').addEventListener('click', () => {
    const filas = puntosNoEngrasadosDe(applyFilters());
    const rows = [['Fecha', 'Código', 'Equipo', 'Punto no realizado', 'Motivo', 'Reportado por']];
    filas.forEach(f => rows.push([fmtDate(f.fecha), f.code, f.equipo, f.punto, f.motivo, f.por]));
    downloadCSV(rows, 'puntos_no_engrasados.csv');
  });
  $('#exp-no-ejecutados').addEventListener('click', () => {
    // §10 del pedido: cero resultados no genera un archivo vacío/corrupto,
    // solo avisa — mismo mecanismo (alert nativo) que ya usa el resto de la
    // app para este tipo de guardia (ver "No hay equipos para imprimir.").
    const filasDet = noEjecutadosFilasDetalle(applyFiltersSkips());
    if (!filasDet.length) { alert('Sin registros para exportar en "No ejecutados" con los filtros actuales.'); return; }
    const rows = [['Fecha', 'Hora', 'Equipo', 'Modelo', 'Ubicación', 'Turno', 'Motivo', 'Observación', 'Usuario', 'Cuadrilla', 'Occurrence', 'Estado']];
    filasDet.forEach(f => rows.push([f.fecha, f.hora, f.codigo, f.modelo, f.ubicacion, f.turno, f.motivo, f.observacion, f.usuario, f.cuadrilla, f.occurrence, f.estado]));
    downloadCSV(rows, 'no_ejecutados.csv');
  });

  $('#exp-excel').addEventListener('click', () => {
    const records = applyFilters();
    const anomaliasF = applyFiltersAnomalias();
    const dias = diasDelPeriodo();
    const eqsF = equiposFiltrados();
    const equiposDT = eqsF.filter(e => e.status === 'Operativo' && (planByEquipoId[e.id] || {}).controlType === 'Día y turno de la semana');
    const turnoSel = $('#f-turno').value || null;
    const progReal = dias ? computeProgramadoRealizadoPeriodo(equiposDT, records, planByEquipoId, dias, turnoSel) : null;
    const pct = progReal && progReal.general.programados ? Math.round((progReal.general.realizados / progReal.general.programados) * 100) : null;
    const { totalQty, registrosConQty } = consumoDe(records);
    const abiertas = anomaliasF.filter(a => a.status !== 'Cerrada').length;

    const wb = XLSX.utils.book_new();
    const C = REPORT_COLORS;
    const meta = App.generalSettings.complianceTarget;
    const colorCumpl = colorPorCumplimiento(pct ?? 0, meta);
    const periodoTxt = `Periodo: ${$('#f-from').value || '—'} a ${$('#f-to').value || 'hoy'}`;

    /* ---------- Hoja 1: Resumen ---------- */
    const filasResumen = [
      ['CUMPLIMIENTO DEL PERÍODO', pct === null ? '—' : pct + '%', `Meta: ${meta}%`],
      [],
      ['PROGRAMADOS/REALIZADOS (Día/Turno)', '', ''],
      ['Programados', progReal ? progReal.general.programados : '—', ''],
      ['Realizados', progReal ? progReal.general.realizados : '—', ''],
      ['No realizados', progReal ? Math.max(progReal.general.programados - progReal.general.realizados, 0) : '—', ''],
      [],
      ['OTROS INDICADORES', '', ''],
      ['Consumo total de grasa', `${fmt(totalQty, 1)} ${GREASE_UNIT}`, ''],
      ['Anomalías abiertas', abiertas, ''],
      ['Engrases en el periodo', records.length, ''],
      ['Puntos no engrasados en el periodo', puntosNoEngrasadosDe(records).length, ''],
    ];
    const wsResumen = xlsHojaConFormato({
      titulo: 'CONTROL DE ENGRASE — OPEN PIT',
      subtitulo: `Informe Ejecutivo  ·  Generado: ${fmtDate(nowISO())}  ·  Por: ${App.currentUser.name}  ·  ${periodoTxt}`,
      columnas: ['Indicador', 'Valor', 'Referencia'],
      filas: filasResumen,
      estiloPorCelda: (valor, ci, fila) => {
        const etiqueta = String(fila[0] || '');
        if (['PROGRAMADOS/REALIZADOS (Día/Turno)', 'OTROS INDICADORES'].includes(etiqueta)) {
          return xlsEstiloCelda({ hexFondo: C.azulTitulo.hex, hexTexto: 'FFFFFF', negrita: true });
        }
        if (etiqueta === 'CUMPLIMIENTO DEL PERÍODO') {
          return ci === 1 ? xlsEstiloCelda({ hexFondo: colorCumpl.hex, hexTexto: 'FFFFFF', negrita: true, centrado: true }) : xlsEstiloCelda({ negrita: true });
        }
        if (etiqueta === 'Anomalías abiertas' && ci === 1 && abiertas > 0) return xlsEstiloCelda({ hexFondo: C.rojoSuave.hex, hexTexto: REPORT_COLORS.rojoTexto.hex, negrita: true, centrado: true });
        return xlsEstiloCelda({ centrado: ci > 0 });
      }
    });
    wsResumen['!cols'] = [{ wch: 38 }, { wch: 14 }, { wch: 18 }];
    delete wsResumen['!autofilter'];
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

    /* ---------- Hoja 2: Histórico de engrases ---------- */
    const colHist = ['Fecha', 'Código', 'Equipo', 'Turno', 'Responsable', 'Horómetro (h)', 'Grasa', `Cantidad (${GREASE_UNIT})`, 'Condición', 'Observaciones'];
    const filasHist = records.map(r => {
      const eq = equiposPorId[r.equipmentId];
      return [
        fmtDate(r.date), eq ? eq.code : '', eq ? `${eq.brand} ${eq.model}` : '',
        r.shiftId === 'shift_dia' ? 'Día' : 'Noche', r.userName, r.hourmeter,
        (lubPorId[r.greaseType] || {}).name || '', r.qty, r.condition, r.notes || ''
      ];
    });
    const wsHist = xlsHojaConFormato({
      titulo: 'HISTÓRICO DE ENGRASES', subtitulo: `${records.length} registros  ·  ${periodoTxt}`,
      columnas: colHist, filas: filasHist, hexEncabezado: C.verde.hex,
      estiloPorCelda: (valor, ci, fila) => {
        if (ci === 8 && fila[8] === 'Requiere atención') return xlsEstiloCelda({ hexFondo: C.ambarSuave.hex, hexTexto: REPORT_COLORS.ambarTexto.hex, negrita: true, centrado: true });
        return xlsEstiloCelda({ centrado: [3, 5, 7].includes(ci) });
      }
    });
    wsHist['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 18 }, { wch: 9 }, { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 13 }, { wch: 16 }, { wch: 32 }];
    XLSX.utils.book_append_sheet(wb, wsHist, 'Histórico Engrases');

    /* ---------- Hoja 3: Cumplimiento por equipo ---------- */
    const filasCumpl = progReal ? progReal.porEquipo.filter(x => x.programados > 0)
      .map(x => ({ ...x, pct: Math.round((x.realizados / x.programados) * 100) }))
      .sort((a, b) => a.pct - b.pct) : [];
    const wsCumpl = xlsHojaConFormato({
      titulo: 'CUMPLIMIENTO POR EQUIPO (Día/Turno)', subtitulo: `${filasCumpl.length} equipo(s)  ·  ${periodoTxt}  ·  menor cumplimiento primero`,
      columnas: ['Código', 'Marca', 'Modelo', 'Realizados', 'Programados', 'Cumplimiento %'],
      filas: filasCumpl.length ? filasCumpl.map(f => [f.e.code, f.e.brand, f.e.model, f.realizados, f.programados, f.pct + '%']) : [['—', '—', '—', '—', '—', 'Sin planes Día/Turno evaluables en el período']],
      hexEncabezado: C.azulTitulo.hex,
      estiloPorCelda: (valor, ci, fila) => ci >= 3 ? xlsEstiloCelda({ centrado: true }) : xlsEstiloCelda()
    });
    wsCumpl['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsCumpl, 'Cumplimiento');

    /* ---------- Hoja 4: Puntos no engrasados ---------- */
    const filasPtos = puntosNoEngrasadosDe(records);
    const wsPtos = xlsHojaConFormato({
      titulo: 'PUNTOS NO ENGRASADOS Y SUS MOTIVOS', subtitulo: `${filasPtos.length} punto(s) pendiente(s)  ·  ${periodoTxt}`,
      columnas: ['Fecha', 'Código', 'Equipo', 'Punto no realizado', 'Motivo', 'Reportado por'],
      filas: filasPtos.length ? filasPtos.map(f => [fmtDate(f.fecha), f.code, f.equipo, f.punto, f.motivo, f.por]) : [['—', '—', '—', 'Sin puntos pendientes en el periodo', '—', '—']],
      hexEncabezado: C.ambar.hex,
      estiloPorCelda: (valor, ci) => ci === 4 ? xlsEstiloCelda({ hexFondo: C.ambarSuave.hex, hexTexto: REPORT_COLORS.ambarTexto.hex, negrita: true }) : xlsEstiloCelda()
    });
    wsPtos['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 18 }, { wch: 28 }, { wch: 26 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsPtos, 'Puntos Pendientes');

    /* ---------- Hoja 5: Anomalías ---------- */
    const colAnom = ['Fecha', 'Código', 'Componente', 'Descripción', 'Criticidad', 'Estado', 'Responsable'];
    const filasAnom = anomaliasF.map(a => {
      const eq = equiposPorId[a.equipmentId];
      return [fmtDate(a.createdAt), eq ? eq.code : '', a.component, a.description, a.criticality, a.status, a.createdBy];
    });
    const wsAnom = xlsHojaConFormato({
      titulo: 'ANOMALÍAS REPORTADAS', subtitulo: `${anomaliasF.length} en total  ·  ${abiertas} abiertas  ·  ${periodoTxt}`,
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

    /* ---------- Hoja 6: Consumo por equipo ---------- */
    const byEqQty = {};
    registrosConQty.forEach(r => { const eq = equiposPorId[r.equipmentId]; if (!eq) return; byEqQty[eq.id] = byEqQty[eq.id] || { e: eq, qty: 0 }; byEqQty[eq.id].qty += Number(r.qty); });
    const filasConsumo = Object.values(byEqQty).sort((a, b) => b.qty - a.qty);
    const wsConsumo = xlsHojaConFormato({
      titulo: 'CONSUMO DE GRASA POR EQUIPO', subtitulo: `Total: ${fmt(totalQty, 1)} ${GREASE_UNIT}  ·  ${periodoTxt}`,
      columnas: ['Código', 'Marca', 'Modelo', `Consumo (${GREASE_UNIT})`],
      filas: filasConsumo.length ? filasConsumo.map(f => [f.e.code, f.e.brand, f.e.model, fmt(f.qty, 1)]) : [['—', '—', '—', 'Sin consumo en el período']],
      hexEncabezado: C.verde.hex,
      estiloPorCelda: (valor, ci) => ci === 3 ? xlsEstiloCelda({ centrado: true }) : xlsEstiloCelda()
    });
    wsConsumo['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsConsumo, 'Consumo');

    /* ---------- Hoja 7: Validación (solo si el baseline ya está configurado) ---------- */
    if (GREASE_VALIDATION_ENABLED_FROM) {
      const ahoraValXls = new Date();
      const sujetos = records.filter(r => isRecordSubjectToValidation(r.date));
      const filasVal = sujetos.map(r => {
        const eq = equiposPorId[r.equipmentId];
        const activas = findActiveValidations(r.id, validations);
        // Mismo criterio central que Dashboard/Historial (validationStatusForRecord):
        // conflicto tiene prioridad, 1 activa = validado, 0 activas = pendiente
        // o vencida según el plazo de MAX_VALIDATION_SHIFTS turnos.
        const estado = activas.length > 1 ? 'Conflicto'
          : activas.length === 1 ? (activas[0].signerRole === 'ENCARGADO' ? 'Validado · Encargado' : 'Validado · Operador')
          : isRecordValidationExpired(r, validations, ahoraValXls, App.generalSettings) ? 'Vencida' : 'Pendiente';
        return [fmtDate(r.date), eq ? eq.code : '', estado, activas.length === 1 ? activas[0].signerName : '', activas.length === 1 ? fmtDate(activas[0].signedAt) : ''];
      });
      const wsVal = xlsHojaConFormato({
        titulo: 'VALIDACIÓN DE ENGRASES', subtitulo: `${sujetos.length} sujeto(s) a validación  ·  ${periodoTxt}`,
        columnas: ['Fecha engrase', 'Código', 'Estado', 'Firmado por', 'Fecha validación'],
        filas: filasVal.length ? filasVal : [['—', '—', 'Sin registros sujetos a validación', '', '']],
        hexEncabezado: C.azulTitulo.hex,
        estiloPorCelda: () => xlsEstiloCelda()
      });
      wsVal['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 22 }, { wch: 20 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, wsVal, 'Validación');
    }

    /* ---------- Hoja 8: No ejecutados (lote de exportación dedicado) ----------
       Misma fuente/orden que el CSV y el PDF (noEjecutadosFilasDetalle()) —
       nunca se recalcula por separado. Título/Periodo/Filtros activos/Total
       van en el subtítulo (mismo patrón que el resto de hojas de este
       informe, ej. "Anomalías"/"Puntos Pendientes"), luego la tabla
       detallada. */
    const filasNoEjecXls = noEjecutadosFilasDetalle(applyFiltersSkips());
    const wsNoEjec = xlsHojaConFormato({
      titulo: 'NO EJECUTADOS',
      subtitulo: `Total: ${filasNoEjecXls.length}  ·  ${periodoTxt}  ·  Filtros: ${filtrosActivosTexto()}`,
      columnas: ['Fecha', 'Hora', 'Equipo', 'Modelo', 'Ubicación', 'Turno', 'Motivo', 'Observación', 'Usuario', 'Cuadrilla', 'Occurrence', 'Estado'],
      filas: filasNoEjecXls.length
        ? filasNoEjecXls.map(f => [f.fecha, f.hora, f.codigo, f.modelo, f.ubicacion, f.turno, f.motivo, f.observacion, f.usuario, f.cuadrilla, f.occurrence, f.estado])
        : [['—', '—', '—', '—', '—', '—', '—', 'Sin "no se pudo ejecutar" en el período', '—', '—', '—', '—']],
      hexEncabezado: C.ambar.hex,
      estiloPorCelda: (valor, ci) => ci === 11 && valor === 'Vinculado a un engrase real'
        ? xlsEstiloCelda({ hexFondo: C.verdeSuave.hex, hexTexto: REPORT_COLORS.verdeTexto.hex, centrado: true })
        : xlsEstiloCelda()
    });
    wsNoEjec['!cols'] = [{ wch: 18 }, { wch: 9 }, { wch: 12 }, { wch: 20 }, { wch: 16 }, { wch: 9 }, { wch: 22 }, { wch: 32 }, { wch: 18 }, { wch: 16 }, { wch: 22 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, wsNoEjec, 'No ejecutados');

    XLSX.writeFile(wb, `informe_ejecutivo_engrase_${new Date().toISOString().slice(0, 10)}.xlsx`);
  });

  $('#exp-pdf').addEventListener('click', () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 0;

    const records = applyFilters();
    const anomaliasF = applyFiltersAnomalias();
    const dias = diasDelPeriodo();
    const eqsF = equiposFiltrados();
    const equiposDT = eqsF.filter(e => e.status === 'Operativo' && (planByEquipoId[e.id] || {}).controlType === 'Día y turno de la semana');
    const turnoSel = $('#f-turno').value || null;
    const progReal = dias ? computeProgramadoRealizadoPeriodo(equiposDT, records, planByEquipoId, dias, turnoSel) : null;
    const pct = progReal && progReal.general.programados ? Math.round((progReal.general.realizados / progReal.general.programados) * 100) : null;
    const noRealizados = progReal ? Math.max(progReal.general.programados - progReal.general.realizados, 0) : 0;
    const { totalQty, registrosConQty } = consumoDe(records);
    const periodoTxt = `Periodo: ${$('#f-from').value || '—'} a ${$('#f-to').value || 'hoy'}`;

    // Encabezado
    doc.setFillColor(...REPORT_COLORS.marca.rgb);
    doc.rect(0, 0, pageWidth, 72, 'F');
    doc.setTextColor(...REPORT_COLORS.acento.rgb);
    doc.setFont(undefined, 'bold'); doc.setFontSize(17);
    doc.text('CONTROL DE ENGRASE — OPEN PIT', 40, 30);
    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, 'normal'); doc.setFontSize(11);
    doc.text('Informe Ejecutivo — Análisis del Período', 40, 48);
    doc.setFontSize(8.5);
    doc.text(`Generado: ${fmtDate(nowISO())}   ·   Por: ${esc(App.currentUser.name)}   ·   ${periodoTxt}`, 40, 62);
    y = 100;

    const C = REPORT_COLORS;
    const metaCumplimiento = App.generalSettings.complianceTarget;
    const colorCumpl = colorPorCumplimiento(pct ?? 0, metaCumplimiento);

    // --- Bloque 1: cifra grande de CUMPLIMIENTO DEL PERÍODO (ya no estado
    // actual de la flota — eso es Dashboard, no Reportes) ---
    const dashY = y;
    const dashH = 110;
    doc.setDrawColor(228); doc.setFillColor(252, 252, 251);
    doc.roundedRect(40, dashY, pageWidth - 80, dashH, 6, 6, 'FD');
    doc.setTextColor(...colorCumpl.rgb);
    doc.setFont(undefined, 'bold'); doc.setFontSize(46);
    doc.text(pct === null ? '—' : `${pct}%`, 62, dashY + 56);
    doc.setTextColor(...C.textoTenue.rgb); doc.setFont(undefined, 'normal'); doc.setFontSize(9);
    doc.text('CUMPLIMIENTO DEL PERÍODO (Día/Turno)', 62, dashY + 72);
    doc.setFontSize(8);
    doc.text(`Meta establecida: ${metaCumplimiento}%  ·  Programados: ${progReal ? progReal.general.programados : '—'}  ·  Realizados: ${progReal ? progReal.general.realizados : '—'}`, 62, dashY + 85);
    if (pct !== null) {
      const barX = 62, barW2 = pageWidth - 62 - 80;
      doc.setFillColor(234, 234, 232); doc.roundedRect(barX, dashY + 95, barW2, 10, 3, 3, 'F');
      doc.setFillColor(...colorCumpl.rgb);
      doc.roundedRect(barX, dashY + 95, Math.max(barW2 * (pct / 100), 3), 10, 3, 3, 'F');
    }
    y = dashY + dashH + 16;

    // --- Bloque 2: tarjetas KPI del período ---
    const kpis = [
      ['Programados', progReal ? progReal.general.programados : '—', C.gris],
      ['Realizados', progReal ? progReal.general.realizados : '—', C.verde],
      ['No realizados', noRealizados, noRealizados > 0 ? C.ambar : C.gris],
      [`Consumo (${GREASE_UNIT})`, fmt(totalQty, 1), C.gris],
      ['Anomalías abiertas', anomaliasF.filter(a => a.status !== 'Cerrada').length, anomaliasF.filter(a => a.status !== 'Cerrada').length > 0 ? C.rojo : C.gris]
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

    // Cumplimiento por turno (texto compacto, sin tabla)
    if (progReal) {
      doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.setTextColor(20);
      doc.text('Cumplimiento por turno', 40, y); y += 16;
      doc.setFont(undefined, 'normal'); doc.setFontSize(9.5);
      [['shift_dia', 'Día'], ['shift_noche', 'Noche']].forEach(([id, label]) => {
        const t = progReal.porTurno[id];
        const tpct = t.programados ? Math.round((t.realizados / t.programados) * 100) : null;
        doc.text(`${label}: ${t.realizados}/${t.programados}  (${tpct === null ? '—' : tpct + '%'})`, 40, y);
        y += 14;
      });
      y += 6;
    }

    // Tabla: equipos con menor cumplimiento (reemplaza "equipos que requieren atención")
    const equiposMenorCumpl = progReal ? progReal.porEquipo.filter(x => x.programados > 0)
      .map(x => ({ ...x, pct: Math.round((x.realizados / x.programados) * 100) }))
      .sort((a, b) => a.pct - b.pct).slice(0, 15) : [];
    doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.setTextColor(20);
    doc.text('Equipos con menor cumplimiento', 40, y); y += 6;
    doc.autoTable({
      startY: y, margin: { left: 40, right: 40 }, styles: { fontSize: 8 }, headStyles: { fillColor: REPORT_COLORS.marca.rgb },
      head: [['Código', 'Equipo', 'Realizados', 'Programados', 'Cumplimiento']],
      body: equiposMenorCumpl.length ? equiposMenorCumpl.map(f => [f.e.code, `${esc(f.e.brand)} ${esc(f.e.model)}`, f.realizados, f.programados, f.pct + '%']) : [['—', 'Sin planes Día/Turno evaluables en el período', '—', '—', '—']],
      didParseCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 4) return;
        const p = parseInt(data.cell.raw, 10);
        if (Number.isFinite(p) && p < 80) { data.cell.styles.textColor = REPORT_COLORS.rojoTexto.rgb; data.cell.styles.fontStyle = 'bold'; }
      }
    });
    y = doc.lastAutoTable.finalY + 20;

    // Tabla: consumo de grasa (top equipos)
    if (y > 620) { doc.addPage(); y = 40; }
    const byEqQtyPdf = {};
    registrosConQty.forEach(r => { const eq = equiposPorId[r.equipmentId]; if (!eq) return; byEqQtyPdf[eq.id] = byEqQtyPdf[eq.id] || { e: eq, qty: 0 }; byEqQtyPdf[eq.id].qty += Number(r.qty); });
    const consumoTop = Object.values(byEqQtyPdf).sort((a, b) => b.qty - a.qty).slice(0, 10);
    doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.setTextColor(20);
    doc.text(`Consumo de grasa — total ${fmt(totalQty, 1)} ${GREASE_UNIT}`, 40, y); y += 6;
    doc.autoTable({
      startY: y, margin: { left: 40, right: 40 }, styles: { fontSize: 8 }, headStyles: { fillColor: REPORT_COLORS.verde.rgb },
      head: [['Código', 'Equipo', `Consumo (${GREASE_UNIT})`]],
      body: consumoTop.length ? consumoTop.map(f => [f.e.code, `${esc(f.e.brand)} ${esc(f.e.model)}`, fmt(f.qty, 1)]) : [['—', 'Sin consumo en el período', '—']]
    });
    y = doc.lastAutoTable.finalY + 20;

    // Tabla: principales motivos de no engrase
    const puntosPendientes = puntosNoEngrasadosDe(records);
    const porMotivoPdf = {};
    puntosPendientes.forEach(f => { porMotivoPdf[f.motivo] = (porMotivoPdf[f.motivo] || 0) + 1; });
    const motivosOrdenados = Object.entries(porMotivoPdf).sort((a, b) => b[1] - a[1]);
    if (y > 620) { doc.addPage(); y = 40; }
    doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.setTextColor(20);
    doc.text('Principales motivos de no engrase', 40, y); y += 6;
    doc.autoTable({
      startY: y, margin: { left: 40, right: 40 }, styles: { fontSize: 8 }, headStyles: { fillColor: REPORT_COLORS.ambar.rgb },
      head: [['Motivo', 'Cantidad', '%']],
      body: motivosOrdenados.length ? motivosOrdenados.map(([m, n]) => [m, n, Math.round(n / puntosPendientes.length * 100) + '%']) : [['—', '—', 'Sin puntos pendientes en el periodo']]
    });
    y = doc.lastAutoTable.finalY + 20;

    // Tabla: anomalías relevantes (abiertas del período)
    const openAnomalies = anomaliasF.filter(a => a.status !== 'Cerrada');
    if (y > 620) { doc.addPage(); y = 40; }
    doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.setTextColor(20);
    doc.text('Anomalías abiertas', 40, y); y += 6;
    doc.autoTable({
      startY: y, margin: { left: 40, right: 40 }, styles: { fontSize: 8 }, headStyles: { fillColor: REPORT_COLORS.rojo.rgb },
      head: [['Criticidad', 'Código', 'Componente', 'Descripción', 'Estado']],
      body: openAnomalies.length ? openAnomalies.map(a => {
        const eq = equiposPorId[a.equipmentId];
        return [a.criticality, eq ? eq.code : '—', a.component, a.description, a.status];
      }) : [['—', '—', '—', 'Sin anomalías abiertas', '—']],
      didParseCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 0) return;
        const t = String(data.cell.raw || '');
        if (t === 'Crítica') { data.cell.styles.textColor = REPORT_COLORS.rojoTexto.rgb; data.cell.styles.fontStyle = 'bold'; }
        else if (t === 'Alta') { data.cell.styles.textColor = REPORT_COLORS.ambarTexto.rgb; data.cell.styles.fontStyle = 'bold'; }
        else if (t === 'Media') { data.cell.styles.textColor = REPORT_COLORS.ambarTexto.rgb; }
      }
    });
    y = doc.lastAutoTable.finalY + 20;

    // Tabla: validación de engrases — SOLO si el baseline ya está configurado
    if (GREASE_VALIDATION_ENABLED_FROM) {
      const ahoraValPdf = new Date();
      const sujetos = records.filter(r => isRecordSubjectToValidation(r.date));
      let validados = 0, pendientesVal = 0, conflictosVal = 0, vencidosVal = 0;
      sujetos.forEach(r => {
        const activas = findActiveValidations(r.id, validations);
        if (activas.length > 1) { conflictosVal++; return; }
        if (activas.length === 1) { validados++; return; }
        if (isRecordValidationExpired(r, validations, ahoraValPdf, App.generalSettings)) vencidosVal++; else pendientesVal++;
      });
      if (y > 620) { doc.addPage(); y = 40; }
      doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.setTextColor(20);
      doc.text('Validación de engrases', 40, y); y += 16;
      doc.setFont(undefined, 'normal'); doc.setFontSize(9.5);
      doc.text(`Sujetos: ${sujetos.length}  ·  Validados: ${validados}  ·  Pendientes: ${pendientesVal}  ·  Vencidos: ${vencidosVal}  ·  Conflictos: ${conflictosVal}`, 40, y);
      y += 20;
    }

    // Sección "NO EJECUTADOS" (lote de exportación dedicado) — MISMA
    // fuente/orden que el CSV y la hoja de Excel (noEjecutadosFilasDetalle(),
    // más reciente primero), nunca una consulta aparte. autoTable pagina
    // solo (multipágina real); "Observación" usa el wrap por defecto de
    // autoTable (overflow:'linebreak') para que el texto largo se vea
    // completo en varias líneas, nunca recortado/oculto.
    const filasNoEjecPdf = noEjecutadosFilasDetalle(applyFiltersSkips());
    if (y > 600) { doc.addPage(); y = 40; }
    doc.setFont(undefined, 'bold'); doc.setFontSize(13); doc.setTextColor(20);
    doc.text('NO EJECUTADOS', 40, y); y += 18;
    doc.setFont(undefined, 'normal'); doc.setFontSize(9.5); doc.setTextColor(60);
    doc.text(periodoTxt, 40, y); y += 14;
    doc.text(`Filtros utilizados: ${filtrosActivosTexto()}`, 40, y); y += 14;
    doc.text(`Total: ${filasNoEjecPdf.length}`, 40, y); y += 16;

    // Resumen por motivo — SIEMPRE los 6 motivos reales (aunque alguno esté
    // en 0), en el orden pedido explícitamente — nunca solo los presentes.
    const ORDEN_MOTIVOS_RESUMEN_PDF = ['REPARACION', 'SIN_TIEMPO', 'NO_DISPONIBLE', 'CONDICION_INSEGURA', 'YA_ENGRASADO', 'OTRO'];
    const conteoPorMotivoPdf = {};
    filasNoEjecPdf.forEach(f => { conteoPorMotivoPdf[f.motivo] = (conteoPorMotivoPdf[f.motivo] || 0) + 1; });
    doc.autoTable({
      startY: y, margin: { left: 40, right: 40 }, styles: { fontSize: 8 }, headStyles: { fillColor: REPORT_COLORS.ambar.rgb },
      head: [['Motivo', 'Cantidad']],
      body: ORDEN_MOTIVOS_RESUMEN_PDF.map(r => [NO_EXECUTION_REASON_LABELS[r], conteoPorMotivoPdf[NO_EXECUTION_REASON_LABELS[r]] || 0])
    });
    y = doc.lastAutoTable.finalY + 16;

    if (y > 600) { doc.addPage(); y = 40; }
    doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.setTextColor(20);
    doc.text('Detalle', 40, y); y += 6;
    doc.autoTable({
      startY: y, margin: { left: 40, right: 40 }, styles: { fontSize: 7.5 }, headStyles: { fillColor: REPORT_COLORS.ambar.rgb },
      head: [['Fecha', 'Hora', 'Equipo', 'Modelo', 'Ubicación', 'Turno', 'Motivo', 'Observación', 'Usuario', 'Cuadrilla', 'Occurrence', 'Estado']],
      body: filasNoEjecPdf.length
        ? filasNoEjecPdf.map(f => [f.fecha, f.hora, f.codigo, f.modelo, f.ubicacion, f.turno, f.motivo, f.observacion, f.usuario, f.cuadrilla, f.occurrence, f.estado])
        : [['—', '—', '—', '—', '—', '—', '—', 'Sin "no se pudo ejecutar" en el período', '—', '—', '—', '—']],
      columnStyles: { 7: { cellWidth: 70 } }
    });
    y = doc.lastAutoTable.finalY + 20;

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

// P0-3 (ver docs/STORAGE_PRIVACY_DESIGN.md) — resuelve el `src` real para
// mostrar UNA evidencia (foto de engrase/anomalía, firma) que puede venir
// como base64 local (offline, este dispositivo la tomó) o como una URL/path
// de Storage (la subió este u otro dispositivo). Base64 se muestra directo,
// sin red. Cualquier otra cosa intenta un signed URL (funciona igual hoy,
// con el bucket todavía público, que el día que deje de serlo); si eso
// falla por lo que sea (sin conexión, sesión vencida, bucket aún no
// migrado) cae de vuelta al valor original — nunca deja de mostrar algo si
// había algo que mostrar. Usado hoy solo en las dos pantallas de evidencia
// "cruzable entre dispositivos" (Reportes, firma de validación) — ver
// docs/STORAGE_PRIVACY_DESIGN.md §Limitaciones para los sitios que SIGUEN
// usando el valor crudo (miniaturas de checklist, diagramas de familia).
async function resolveEvidenceSrc(value, { force = false } = {}) {
  if (!value || typeof value !== 'string') return value || null;
  if (value.startsWith('data:image')) return value; // copia local, nunca red
  try {
    const cfg = await DB.getConfig();
    const signed = await Sync.getSignedPhotoUrl(value, cfg, { force });
    return signed || value;
  } catch (e) {
    return value;
  }
}

// Atributo `data-evidence-value` para un <img> resuelto vía
// resolveEvidenceSrc() — guarda el valor CRUDO (nunca el signed URL ya
// usado) para que wireEvidenceImgFallbackOnce() pueda pedir uno nuevo si
// este falla. Base64 nunca lo necesita (no hay nada que "regenerar").
function evidenceValueAttr(rawValue) {
  if (!rawValue || typeof rawValue !== 'string' || rawValue.startsWith('data:image')) return '';
  return ` data-evidence-value="${esc(rawValue)}"`;
}

// Reintento único + placeholder controlado (§38/§40 docs/
// STORAGE_PRIVACY_DESIGN.md): un <img> de evidencia (foto/firma) puede
// fallar por una URL firmada vencida (más de ~1h en pantalla), sin red, o
// el bucket ya privado sin sesión válida. Wireado UNA sola vez a nivel de
// documento (el evento 'error' de <img> no burbujea, por eso se usa
// captura) — cubre Reportes/Ayuda/Plan de engrase/validación sin tener que
// wirear cada pantalla por separado. Solo actúa sobre <img
// data-evidence-value="..."> (el valor CRUDO guardado, nunca el signed
// URL ya usado) — cualquier otra imagen de la app (íconos, avatares) la
// ignora tal cual.
function wireEvidenceImgFallbackOnce() {
  if (wireEvidenceImgFallbackOnce._wired) return;
  wireEvidenceImgFallbackOnce._wired = true;
  document.addEventListener('error', async (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.evidenceValue) return;
    if (img.dataset.evidenceRetried) {
      const placeholder = document.createElement('div');
      placeholder.className = 'photo-thumb-placeholder dim';
      placeholder.style.cssText = 'display:flex; align-items:center; justify-content:center; text-align:center; padding:8px; font-size:11px; min-height:60px';
      placeholder.textContent = 'Imagen no disponible sin conexión';
      img.replaceWith(placeholder);
      return;
    }
    img.dataset.evidenceRetried = '1';
    const fresh = await resolveEvidenceSrc(img.dataset.evidenceValue, { force: true });
    if (fresh) img.src = fresh;
  }, true);
}

function openPhotoLightbox(src, caption) {
  openModal(caption || 'Fotografía', `<img src="${src}" style="width:100%; border-radius:8px; display:block" alt="${esc(caption || 'Fotografía')}"/>`);
}

function photoThumbHTML(src, caption, rawValue) {
  if (!src) return '<span class="dim">—</span>';
  return `<img src="${src}" class="photo-thumb" data-full="${src}" data-caption="${(caption || '').replace(/"/g, '&quot;')}" alt="Foto"${evidenceValueAttr(rawValue)}/>`;
}

// Muestra TODAS las fotos de un registro (funciona igual con registros viejos de una sola foto).
// `resolvedSrcs` (mismo orden que photosOf(record)) viene de
// resolvePhotoThumbSrcs() — quien llama lo resuelve ANTES para no volver
// async esta función ni romper sus muchos llamadores síncronos. Sin
// `resolvedSrcs` cae al valor crudo (compatibilidad con cualquier llamador
// que aún no se haya actualizado).
function photoThumbsHTML(record, caption, resolvedSrcs) {
  const photos = photosOf(record);
  if (!photos.length) return '<span class="dim">—</span>';
  const srcs = resolvedSrcs || photos;
  return `<div class="photo-thumb-group">${photos.map((p, i) =>
    photoThumbHTML(srcs[i], `${caption || ''}${photos.length > 1 ? ` (${i + 1}/${photos.length})` : ''}`, p)
  ).join('')}</div>`;
}

// Gap de Storage privado cerrado (ver docs/STORAGE_PRIVACY_DESIGN.md §7):
// resuelve TODAS las fotos de un registro en paralelo — usado por Historial
// (equipo/global) y Anomalías antes de armar la tabla.
async function resolvePhotoThumbSrcs(record) {
  return Promise.all(photosOf(record).map(p => resolveEvidenceSrc(p)));
}

function wirePhotoThumbs(container) {
  if (!container) return;
  $$('.photo-thumb', container).forEach(img => {
    img.addEventListener('click', () => openPhotoLightbox(img.dataset.full, img.dataset.caption));
  });
}

// Protecci\u00F3n CSV/Excel formula injection (lote "No ejecutados", \u00A75 \u2014
// aplica a TODOS los CSV de la app por venir de la funci\u00F3n compartida):
// un valor que EMPIECE con =, +, -, @ (o tab/CR, los otros disparadores
// documentados) es interpretado como f\u00F3rmula por Excel/Sheets al abrir el
// CSV. Se neutraliza con una comilla simple al frente \u2014 el campo sigue
// vi\u00E9ndose igual como texto, nunca cambia el valor real exportado. Los
// exports existentes (c\u00F3digos, fechas, n\u00FAmeros) no empiezan con esos
// caracteres en la pr\u00E1ctica, as\u00ED que esto no altera su salida; el caso real
// que lo necesita es el nuevo campo libre "Observaci\u00F3n" de No ejecutados.
function csvSafeField(v) {
  const s = String(v ?? '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(v => `"${csvSafeField(v).replace(/"/g, '""')}"`).join(',')).join('\n');
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
  if (!c) return; // la pantalla ya no está en el documento (cambio de vista o de usuario)
  // AUTH_MODE='supabase': pantalla completamente distinta (administra
  // personas reales vía la Edge Function manage-users, nunca el store
  // "users" legacy) — ver renderUsuariosSupabase() más abajo. Con
  // AUTH_MODE='legacy' (default), esta rama nunca se toma y todo lo de
  // abajo sigue exactamente igual que siempre.
  if (typeof Auth !== 'undefined' && Auth.isSupabaseMode()) {
    return renderUsuariosSupabase(c);
  }
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
      ${!isSupervisor ? `<button class="btn" id="btn-new-user">${ic("plus")}Otro tipo de usuario</button>` : ''}
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
   USUARIOS — AUTH_MODE='supabase' (P0-2, personas reales vía
   supabase/functions/manage-users). Nunca toca el store "users" legacy
   (esos 7 registros no son cuentas Auth, ver docs/
   AUTH_RLS_IMPLEMENTATION_PLAN.md §17) — todo pasa por Auth.manageUsers(),
   que a su vez exige una sesión ya autenticada y reenvía el JWT propio;
   la autorización real (¿este caller es ADMINISTRADOR activo?) la decide
   siempre la Edge Function server-side, nunca este archivo.
   ============================================================ */
// FIX "Agregar usuario" (auditoría previa): Auth.manageUsers() ya llamaba
// correctamente a la Edge Function real (nunca auth.admin.* directo, nunca
// service_role) — el problema era puramente de esta capa de UI: errores
// del servidor mostrados como código crudo ("username_taken"), sin guardia
// de doble-click, sin confirmación de contraseña, y fallas de red sin
// traducir. Una sola tabla de traducción para las 4 pantallas (crear/rol/
// activar/resetear) — nunca stack trace/service_role/JWT en el mensaje.
const MANAGE_USERS_ERROR_LABELS = {
  AUTH_REQUIRED: 'Tu sesión expiró o no hay una sesión activa. Vuelve a iniciar sesión.',
  AUTH_FORBIDDEN: 'No tienes permisos de Administrador para hacer esto.',
  SYNC_NOT_CONFIGURED: 'La sincronización no está configurada en este dispositivo.',
  NETWORK: 'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.',
  TIMEOUT: 'El servidor no respondió a tiempo. Intenta de nuevo.',
  username_taken: 'Ese nombre de usuario ya existe. Elige otro.',
  invalid_role: 'El rol seleccionado no es válido.',
  temp_password_required_min_8: 'La contraseña debe tener al menos 8 caracteres.',
  new_password_required_min_8: 'La contraseña debe tener al menos 8 caracteres.',
  display_name_required: 'Escribe el nombre completo.',
  app_user_id_required: 'Falta indicar a qué usuario aplica esto.',
  invalid_input: 'Los datos ingresados no son válidos.',
  not_found: 'No se encontró ese usuario.',
  cannot_remove_last_admin: 'No puedes quitar el rol de Administrador al único activo — activa otro Administrador primero.',
  cannot_deactivate_last_admin: 'No puedes desactivar al único Administrador activo — activa otro primero.',
  auth_create_failed: 'No se pudo crear la cuenta (podría ya existir, o los datos no son válidos).',
  auth_create_no_id: 'El servidor no confirmó la creación de la cuenta. Intenta de nuevo.',
  profile_create_failed_rolled_back: 'No se pudo completar la creación del usuario — no quedó ninguna cuenta a medio crear. Intenta de nuevo.',
  update_failed: 'No se pudo guardar el cambio. Intenta de nuevo.',
  reset_failed: 'No se pudo restablecer la contraseña. Intenta de nuevo.',
  internal_error: 'Ocurrió un error inesperado en el servidor. Intenta de nuevo.',
  unknown_action: 'Acción no reconocida.',
};
function manageUsersErrorMessage(err) {
  const code = (err && err.message) || '';
  if (MANAGE_USERS_ERROR_LABELS[code]) return MANAGE_USERS_ERROR_LABELS[code];
  if (code.startsWith('list_failed_') || code.startsWith('HTTP_')) {
    return 'No se pudo completar la acción (el servidor respondió con un error). Intenta de nuevo.';
  }
  return 'No se pudo completar la acción. Intenta de nuevo.';
}
async function renderUsuariosSupabase(c) {
  const offline = !navigator.onLine;
  c.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-accent" id="btn-new-user-sb" ${offline ? 'disabled title="Requiere conexión"' : ''}>${ic('plus')}Nuevo usuario</button>
      ${offline ? '<span class="dim">Sin conexión — la administración de usuarios requiere Internet.</span>' : ''}
    </div>
    <div class="panel">
      <table class="data-table">
        <thead><tr><th>Nombre</th><th>Rol</th><th>Activo</th><th></th></tr></thead>
        <tbody id="usuarios-sb-tbody">
          <tr><td colspan="4" class="empty-state">${offline ? 'Sin conexión — no se puede listar.' : 'Cargando…'}</td></tr>
        </tbody>
      </table>
    </div>`;

  // Offline: la administración de usuarios exige Internet siempre — no
  // hay snapshot local de la lista completa que mostrar, y los botones
  // de acción quedan deshabilitados (arriba). Nada de esto se guarda para
  // sincronizar después: no es un cambio operativo diferible, es una
  // operación de seguridad que solo tiene sentido hecha en el momento,
  // contra el servidor real.
  if (offline) return;

  let users = [];
  try {
    const res = await Auth.manageUsers('LIST_USERS');
    users = res.users || [];
  } catch (e) {
    const tbody = $('#usuarios-sb-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No se pudo cargar: ${esc(manageUsersErrorMessage(e))}</td></tr>`;
    return;
  }

  const tbody = $('#usuarios-sb-tbody');
  if (!tbody) return; // la pantalla cambió mientras esperábamos la respuesta
  tbody.innerHTML = users.map(u => `
    <tr>
      <td>${esc(u.display_name)}</td>
      <td>${esc(u.role)}</td>
      <td>${u.active ? 'Sí' : 'No'}</td>
      <td class="row-actions">
        <button class="btn btn-sm" data-role="${esc(u.app_user_id)}">${ic('edit')}Rol</button>
        <button class="btn btn-sm ${u.active ? 'btn-danger' : ''}" data-toggle="${esc(u.app_user_id)}" data-active="${u.active ? 'true' : 'false'}">
          ${u.active ? ic('trash') + 'Desactivar' : ic('check') + 'Activar'}
        </button>
        <button class="btn btn-sm" data-reset="${esc(u.app_user_id)}">${ic("rotate-ccw")}Reset password</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty-state">Sin usuarios reales todavía — ver "Usuarios históricos" (legacy, solo lectura) si aplica.</td></tr>';

  $('#btn-new-user-sb')?.addEventListener('click', () => userFormSupabase(c));
  $$('button[data-role]', c).forEach(b => b.addEventListener('click', () => {
    const u = users.find(x => x.app_user_id === b.dataset.role);
    if (u) roleFormSupabase(u, c);
  }));
  $$('button[data-toggle]', c).forEach(b => b.addEventListener('click', async () => {
    const activeNow = b.dataset.active === 'true';
    try {
      await Auth.manageUsers('SET_ACTIVE', { app_user_id: b.dataset.toggle, active: !activeNow });
      showInAppToast(activeNow ? '✓ Usuario desactivado' : '✓ Usuario activado');
      renderUsuariosSupabase(c);
    } catch (e) { showInAppToast('✗ ' + manageUsersErrorMessage(e)); }
  }));
  $$('button[data-reset]', c).forEach(b => b.addEventListener('click', () => resetPasswordFormSupabase(b.dataset.reset)));
}

// Deshabilita el submit mientras la llamada está en vuelo (evita doble
// creación/doble submit por doble click o red lenta) y restaura texto+
// estado al terminar, sin importar si fue éxito o error — un solo lugar
// para las 3 formas de este archivo, en vez de repetir el patrón 3 veces.
async function withSubmitGuard(form, busyLabel, fn) {
  const btn = form.querySelector('button[type="submit"]');
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = busyLabel;
  try {
    await fn();
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
}

// "Activo" NO es un campo de este formulario a propósito: handleCreateUser()
// (manage-users) siempre crea la cuenta con active=true — un checkbox aquí
// no tendría ningún efecto real en el servidor (revisado explícitamente,
// no agregado "por si acaso"). Desactivar es SET_ACTIVE, una acción
// posterior y separada sobre un usuario ya creado.
// Preparado para el futuro modelo de turno de notificaciones (§13 del
// pedido de este fix, NO implementado aquí): `fd` se arma directo desde
// FormData y se reenvía tal cual — el día que se agreguen inputs nuevos
// (notificationShift/notificationAvailability/receiveAllShifts), viajan
// solos sin tocar este handler, siempre que manage-users los valide como
// campos PROPIOS y separados de `role` (nunca mezclados, nunca
// SUPERVISOR_DIA/NOCHE como rol).
function userFormSupabase(c) {
  openModal('Nuevo usuario', `
    <form id="user-form-sb" class="form-grid">
      <label>Nombre completo<input required name="display_name"/></label>
      <label>Usuario<input required name="username" pattern="[a-zA-Z0-9._-]+"/>
        <span class="field-hint">Sin espacios ni "@" — se usa para generar el acceso interno, nunca se muestra completo.</span>
      </label>
      <label>Rol<select name="role">${Object.keys(PERMISSIONS).map(r => `<option>${r}</option>`).join('')}</select></label>
      <label>Contraseña temporal (mínimo 8 caracteres)<input required minlength="8" type="password" name="temp_password" autocomplete="new-password"/>
        <span class="field-hint">La persona debería cambiarla apenas entre. Nunca queda guardada en este dispositivo.</span>
      </label>
      <label>Confirmar contraseña<input required minlength="8" type="password" name="temp_password_confirm" autocomplete="new-password"/></label>
      <div class="modal-actions"><button type="submit" class="btn btn-accent">Crear usuario</button></div>
    </form>`);
  $('#user-form-sb').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const fd = Object.fromEntries(new FormData(form).entries());
    // Validación de formulario (nunca sustituye al servidor, solo evita
    // un viaje de red inútil por un error obvio): campos requeridos ya
    // los cubre `required`/`minlength` del HTML; lo único que el HTML no
    // puede validar es que ambas contraseñas coincidan.
    if (fd.temp_password !== fd.temp_password_confirm) {
      showInAppToast('✗ Las contraseñas no coinciden.');
      return;
    }
    delete fd.temp_password_confirm; // nunca se envía al servidor, es solo un chequeo de UI
    await withSubmitGuard(form, 'Creando…', async () => {
      try {
        await Auth.manageUsers('CREATE_USER', fd);
        showInAppToast('✓ Usuario creado correctamente.');
        closeModal();
        if (c) renderUsuariosSupabase(c); // refresca solo la lista, sin recargar toda la pantalla
      } catch (e) {
        showInAppToast('✗ ' + manageUsersErrorMessage(e));
      } finally {
        fd.temp_password = ''; // limpia la referencia local apenas termina el submit
      }
    });
  });
}

function roleFormSupabase(u, c) {
  openModal(`Cambiar rol · ${esc(u.display_name)}`, `
    <form id="role-form-sb" class="form-grid">
      <label>Rol<select name="role">${Object.keys(PERMISSIONS).map(r => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <div class="modal-actions"><button type="submit" class="btn btn-accent">Guardar</button></div>
    </form>`);
  $('#role-form-sb').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const fd = Object.fromEntries(new FormData(form).entries());
    await withSubmitGuard(form, 'Guardando…', async () => {
      try {
        await Auth.manageUsers('UPDATE_ROLE', { app_user_id: u.app_user_id, role: fd.role });
        showInAppToast('✓ Rol actualizado correctamente.');
        closeModal();
        if (c) renderUsuariosSupabase(c);
      } catch (e) { showInAppToast('✗ ' + manageUsersErrorMessage(e)); }
    });
  });
}

function resetPasswordFormSupabase(appUserId) {
  openModal('Restablecer contraseña', `
    <form id="reset-form-sb" class="form-grid">
      <label>Contraseña temporal nueva (mínimo 8 caracteres)<input required minlength="8" type="password" name="new_password" autocomplete="new-password"/></label>
      <label>Confirmar contraseña<input required minlength="8" type="password" name="new_password_confirm" autocomplete="new-password"/></label>
      <div class="modal-actions"><button type="submit" class="btn btn-accent">Restablecer</button></div>
    </form>`);
  $('#reset-form-sb').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const fd = Object.fromEntries(new FormData(form).entries());
    if (fd.new_password !== fd.new_password_confirm) {
      showInAppToast('✗ Las contraseñas no coinciden.');
      return;
    }
    await withSubmitGuard(form, 'Restableciendo…', async () => {
      try {
        await Auth.manageUsers('RESET_PASSWORD', { app_user_id: appUserId, new_password: fd.new_password });
        showInAppToast('✓ Contraseña restablecida correctamente.');
        closeModal();
      } catch (e) { showInAppToast('✗ ' + manageUsersErrorMessage(e)); }
    });
  });
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

// Gap de Storage privado cerrado (ver docs/STORAGE_PRIVACY_DESIGN.md §7):
// el diagrama de familia y las miniaturas de sus puntos pueden venir de
// otro dispositivo — async ahora, resuelve TODO antes de armar el HTML
// (mismo patrón que Reportes/firma de validación/pointRow).
async function familyCardHTML(fam, canEdit) {
  const allPoints = fam.zones.flatMap(z => z.points);
  const [diagramSrc, ...pointSrcs] = await Promise.all([
    resolveEvidenceSrc(fam.photo),
    ...allPoints.map(p => resolveEvidenceSrc(p.photo)),
  ]);
  const pointSrcByRef = new Map(allPoints.map((p, i) => [p, pointSrcs[i]]));
  return `
    <div class="panel family-card" data-family-id="${fam.id}">
      <div class="panel-head">
        <h3>${esc(fam.name)}</h3>
        ${canEdit ? `<button class="btn btn-sm family-edit-btn" data-id="${fam.id}">${ic("edit")}Editar</button>` : ''}
      </div>
      <div class="family-body">
        <div class="family-diagram">${fam.photo
          ? `<img src="${diagramSrc}" class="family-photo photo-thumb" data-full="${diagramSrc}" data-caption="${esc(fam.name)}" alt="${esc(fam.name)}"/>`
          : familySilhouetteSvg(fam.svg)}</div>
        <div class="family-zones">
          ${fam.zones.map(z => `
            <div class="family-zone">
              <div class="family-zone-title"><span class="dot" style="background:${z.color}"></span>${esc(z.name)}</div>
              <ul class="family-zone-list">${z.points.map(p => `<li>${p.photo ? photoThumbHTML(pointSrcByRef.get(p), p.text) : ''}<span>${p.text}</span></li>`).join('')}</ul>
            </div>`).join('')}
        </div>
      </div>
      ${fam.generic ? '<div class="dim" style="padding:0 14px 14px">Puntos de referencia general — verifica el manual del fabricante para el modelo específico de tu equipo.</div>' : ''}
    </div>`;
}

async function renderAyuda() {
  const c = $('#app-content');
  if (!c) return; // la pantalla ya no está en el documento (cambio de vista o de usuario)
  const canEdit = App.currentUser.role === 'ADMINISTRADOR';
  const help = await getHelpContent();

  // Accesos compactos por familia (chip) en vez de mostrar las N tarjetas completas de
  // una vez — la tarjeta real (familyCardHTML) se muestra/oculta al tocar su chip.
  // familyCardHTML() es async (resuelve signed URLs) — se resuelven todas
  // las familias en paralelo antes de armar el HTML final.
  const familyCards = await Promise.all(help.families.map(f => familyCardHTML(f, canEdit)));
  const familiesHTML = help.families.length ? `
      <div class="ayuda-family-chips">
        ${help.families.map(f => `<button type="button" class="ayuda-family-chip" data-family-id="${f.id}">${esc(f.name)}</button>`).join('')}
      </div>
      ${help.families.map((f, i) => `<div class="ayuda-family-card hidden" data-family-wrap="${f.id}">${familyCards[i]}</div>`).join('')}`
    : `<div class="empty-state">No hay guías visuales configuradas todavía.</div>`;

  c.innerHTML = `
    <div class="ayuda-page">
      <div class="panel">
        <div class="panel-head"><h3>Ayuda y soporte</h3></div>
        <div class="dim" style="padding:0 14px 14px">Consulta rápidamente cómo interpretar estados, registrar incidencias y trabajar sin conexión.</div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Guía de puntos de engrase por familia de equipo</h3></div>
        <div class="dim ayuda-guia-sub">Referencia visual por categoría de equipo — imagen y puntos de engrase. Para el detalle exacto de un equipo específico, usa "Plan de Engrase → Configurar".</div>
        ${canEdit ? `<div class="toolbar ayuda-guia-toolbar"><button class="btn btn-accent" id="family-add-btn">${ic("plus")}Agregar familia de equipo</button></div>` : ''}
        ${familiesHTML}
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>Preguntas frecuentes</h3>
          ${canEdit ? `<button class="btn btn-sm" id="faq-edit-btn">Editar preguntas</button>` : ''}
        </div>
        <div class="ayuda-faq-list">
          ${help.faq.map(f => `<details class="faq-item"><summary>${esc(f.question)}<span class="faq-chevron">›</span></summary><p>${esc(f.answer)}</p></details>`).join('') || '<div class="empty-state" style="padding:0 14px 14px">Sin preguntas todavía.</div>'}
        </div>
      </div>

      ${!canEdit ? `
      <div class="panel ayuda-apariencia-row">
        <div class="ayuda-apariencia-info">
          <b>Apariencia</b>
          <span class="dim">Color de acento y tema claro/oscuro.</span>
        </div>
        <button type="button" class="btn btn-sm" id="btn-theme">🎨 Cambiar colores</button>
      </div>` : ''}
    </div>`;
  wirePhotoThumbs(c);

  $$('.ayuda-family-chip', c).forEach(chip => {
    chip.addEventListener('click', () => {
      const wrap = c.querySelector(`.ayuda-family-card[data-family-wrap="${chip.dataset.familyId}"]`);
      if (!wrap) return;
      const nowOpen = wrap.classList.toggle('hidden') === false;
      chip.classList.toggle('active', nowOpen);
      if (nowOpen) wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  if (!canEdit) {
    $('#btn-theme').addEventListener('click', openThemePicker);
    return;
  }
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

/* ---------- Cuadrillas: panel dedicado (Configuración) ----------
   Distinto del genérico simpleListPanelHTML (solo nombre+activo): cada
   cuadrilla tiene además `locationId` y `isDefault` (§C/§K del pedido) —
   máximo una cuadrilla `isDefault:true` por ubicación, la que recibe el
   trabajo normal (ver resolveDefaultCrewForLocation() en
   operational-scope.js). Cambiar la ubicación de una cuadrilla queda en
   auditoría (CREW_LOCATION_CHANGED). ---------- */
async function cuadrillasPanelHTML() {
  const cuadrillas = await DB.allActive('cuadrillas');
  const locations = await DB.allActive('locations');
  const locName = (id) => (locations.find(l => l.id === id) || {}).name || '—';
  return `
    <div class="panel" data-cuadrillas-panel>
      <div class="panel-head"><h3>Cuadrillas de lubricación</h3></div>
      <div class="dim" style="padding:0 14px 10px">Una cuadrilla marcada "por defecto" recibe el trabajo normal de engrase de su ubicación. Puede haber más de una cuadrilla en la misma ubicación (por ejemplo, una auxiliar) — solo la default recibe el trabajo normal; el resto solo ve lo que se le asigne manualmente desde Plan de Engrase o la ficha del equipo.</div>
      <table class="data-table">
        <thead><tr><th>Nombre</th><th>Ubicación</th><th>Por defecto</th><th></th></tr></thead>
        <tbody>
          ${cuadrillas.map(cq => `
            <tr data-id="${cq.id}">
              <td>${esc(cq.name)}</td>
              <td>${esc(locName(cq.locationId))}</td>
              <td>${cq.isDefault ? '✓' : '—'}</td>
              <td class="row-actions">
                <button class="btn btn-sm cq-edit">${ic("edit")}Editar</button>
                <button class="btn btn-sm btn-danger cq-remove">${ic("trash")}Eliminar</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="4" class="empty-state">Sin cuadrillas todavía.</td></tr>'}
        </tbody>
      </table>
      <div class="toolbar" style="padding:10px 14px">
        <button class="btn btn-accent" id="cq-add">${ic("plus")}Agregar cuadrilla</button>
      </div>
    </div>`;
}

function wireCuadrillasPanel(container, onChange) {
  const panel = container.querySelector('[data-cuadrillas-panel]');
  if (!panel) return;

  async function openCuadrillaForm(cuadrilla) {
    const locations = await DB.allActive('locations');
    openModal(cuadrilla ? `Editar ${esc(cuadrilla.name)}` : 'Nueva cuadrilla', `
      <form id="cq-form">
        <label>Nombre<input required name="name" value="${cuadrilla ? esc(cuadrilla.name) : ''}"/></label>
        <label>Ubicación
          <select name="locationId">
            <option value="">— Sin ubicación —</option>
            ${locations.map(l => `<option value="${l.id}" ${cuadrilla && cuadrilla.locationId === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
          </select>
        </label>
        <label class="check-row" style="margin-top:8px">
          <input type="checkbox" class="chk-done" name="isDefault" ${cuadrilla && cuadrilla.isDefault ? 'checked' : ''}/>
          <span class="check-row-text">Cuadrilla por defecto de esa ubicación (recibe el trabajo normal)</span>
        </label>
        <span class="field-hint">Si la marcas como default, se desmarca automáticamente cualquier otra cuadrilla que ya lo fuera en la misma ubicación — solo puede haber una.</span>
        <div class="modal-actions"><button type="submit" class="btn btn-accent">${ic("save")}Guardar</button></div>
      </form>
    `);
    $('#cq-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target).entries());
      const locationId = fd.locationId || null;
      const isDefault = !!fd.isDefault;
      const anterior = cuadrilla ? await DB.get('cuadrillas', cuadrilla.id) : null;
      const cambioUbicacion = !!anterior && anterior.locationId !== locationId;

      // Máximo una default por ubicación (§K): marcar esta desmarca las demás de esa ubicación.
      if (isDefault && locationId) {
        const todas = await DB.allActive('cuadrillas');
        for (const otra of todas) {
          if (otra.id !== (cuadrilla ? cuadrilla.id : null) && otra.locationId === locationId && otra.isDefault) {
            otra.isDefault = false;
            await DB.put('cuadrillas', stamp(otra, App.currentUser.name));
          }
        }
      }

      const item = cuadrilla || { id: uid('cua'), active: true };
      item.name = fd.name.trim();
      item.locationId = locationId;
      item.isDefault = isDefault;
      await DB.put('cuadrillas', stamp(item, App.currentUser.name));

      if (cambioUbicacion) {
        const nombreAntes = locName2(locations, anterior.locationId);
        const nombreDespues = locName2(locations, locationId);
        await logAudit('CREW_LOCATION_CHANGED', `${esc(item.name)}: ${esc(nombreAntes)} → ${esc(nombreDespues)}`, App.currentUser.name);
      } else {
        await logAudit('LISTA_ACTUALIZADA', `cuadrillas: "${esc(item.name)}" guardada`, App.currentUser.name);
      }
      showInAppToast(`✓ "${esc(item.name)}" guardada`);
      Sync.fullSync();
      closeModal();
      onChange();
    });
  }
  function locName2(locations, id) { return (locations.find(l => l.id === id) || {}).name || 'sin ubicación'; }

  panel.querySelector('#cq-add').addEventListener('click', () => openCuadrillaForm(null));
  panel.querySelectorAll('.cq-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      openCuadrillaForm(await DB.get('cuadrillas', id));
    });
  });
  panel.querySelectorAll('.cq-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('tr');
      const id = row.dataset.id;
      const item = await DB.get('cuadrillas', id);
      if (!confirm(`¿Eliminar la cuadrilla "${esc(item.name)}"? Los dispositivos que ya la tengan asignada no se modifican, pero dejará de aparecer como opción.`)) return;
      item.active = false;
      await DB.put('cuadrillas', stamp(item, App.currentUser.name));
      await logAudit('LISTA_ACTUALIZADA', `cuadrillas: eliminada "${esc(item.name)}"`, App.currentUser.name);
      showInAppToast(`✓ "${esc(item.name)}" eliminada`);
      onChange();
    });
  });
}

/* ---------- Dispositivo operativo (Configuración) ----------
   Conecta getDeviceAssignment()/saveDeviceAssignment() (app.js, ya
   existían para push pero nunca se usaban para scope operativo — ver
   docs/OPERATIONAL_SCOPE.md) con una UI real. Visibilidad por rol (§F):
   ADMIN/PLANIFICADOR editan, SUPERVISOR y LUBRICADOR solo lectura,
   VISOR no ve este panel. ---------- */
async function devicePanelHTML() {
  const role = App.currentUser.role;
  if (role === 'VISOR') return '';
  const assignment = await getDeviceAssignment();
  const cuadrillas = await DB.allActive('cuadrillas');
  const locations = await DB.allActive('locations');
  const crew = cuadrillas.find(cq => cq.id === assignment.cuadrillaId);
  const crewLocationName = crew ? (locations.find(l => l.id === crew.locationId) || {}).name : null;
  const canEditDevice = canConfigureDevice(role);
  return `
    <div class="panel" data-device-panel>
      <div class="panel-head"><h3>Dispositivo operativo</h3></div>
      <div style="padding:14px">
        <p class="dim">Este teléfono/tablet se asigna a UNA cuadrilla — de ahí sale qué equipos ve "Mi Turno" de cualquier Lubricador que inicie sesión aquí. La asignación es de ESTE dispositivo, no de la persona, y sigue guardada aunque cierres sesión, uses el PIN rápido o reinstales la app. El turno (Día/Noche) nunca se guarda aquí: siempre se calcula por la hora real.</p>
        <div class="detail-grid" style="margin:10px 0">
          <div><b>Identificador</b><div class="mono" style="font-size:11px">${esc(getDeviceId())}</div></div>
          <div><b>Cuadrilla asignada</b><div>${crew ? esc(crew.name) : 'Sin asignar'}</div></div>
          <div><b>Ubicación (según la cuadrilla)</b><div>${crewLocationName ? esc(crewLocationName) : '—'}</div></div>
        </div>
        ${canEditDevice
          ? `<button class="btn btn-accent" id="btn-device-config">${ic("edit")}${crew ? 'Cambiar cuadrilla' : 'Asignar cuadrilla'}</button>`
          : role === 'LUBRICADOR'
            ? '<p class="dim">Solo un Administrador o Planificador puede cambiar la cuadrilla de este dispositivo.</p>'
            : ''}
      </div>
    </div>`;
}

function wireDevicePanel(container, onChange) {
  const panel = container.querySelector('[data-device-panel]');
  if (!panel) return;
  panel.querySelector('#btn-device-config')?.addEventListener('click', async () => {
    const assignment = await getDeviceAssignment();
    const cuadrillas = (await DB.allActive('cuadrillas')).filter(cq => cq.active !== false);
    openModal('Dispositivo operativo', `
      <form id="device-form">
        <label>Nombre de este dispositivo (opcional, para identificarlo)
          <input name="nombre" value="${esc(assignment.nombre || '')}" placeholder="Ej: Teléfono Volcán 1"/>
        </label>
        <label>Cuadrilla asignada
          <select name="cuadrillaId">
            <option value="">— Sin asignar —</option>
            ${cuadrillas.map(cq => `<option value="${cq.id}" ${assignment.cuadrillaId === cq.id ? 'selected' : ''}>${esc(cq.name)}</option>`).join('')}
          </select>
          <span class="field-hint">Los lubricadores que inicien sesión en este dispositivo verán el trabajo de esta cuadrilla en "Mi Turno".</span>
        </label>
        <div class="modal-actions"><button type="submit" class="btn btn-accent">${ic("save")}Guardar</button></div>
      </form>
    `);
    $('#device-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target).entries());
      const crewAnterior = cuadrillas.find(cq => cq.id === assignment.cuadrillaId);
      const crewNueva = cuadrillas.find(cq => cq.id === fd.cuadrillaId);
      await saveDeviceAssignment({ cuadrillaId: fd.cuadrillaId || '', nombre: fd.nombre });
      await logAudit('DEVICE_CREW_CHANGED', `${esc(getDeviceId())}: ${esc(crewAnterior ? crewAnterior.name : 'sin asignar')} → ${esc(crewNueva ? crewNueva.name : 'sin asignar')}`, App.currentUser.name);
      showInAppToast('✓ Dispositivo actualizado');
      closeModal();
      onChange();
    });
  });
}

/* ---------- Respaldo completo: exportar / restaurar todos los datos ---------- */
/* ---------- Recordatorio de respaldo ----------
   El respaldo depende de que alguien se acuerde de bajarlo. Esto avisa al Administrador
   cuando pasó una semana sin hacerlo, y le ofrece descargarlo en el momento. No se
   descarga solo: el navegador no permite bajar archivos sin que la persona lo pida. */
const DIAS_ENTRE_RESPALDOS = 7;

function ultimoRespaldo() {
  try { return localStorage.getItem('engrase_ultimo_respaldo'); } catch (e) { return null; }
}
function marcarRespaldoHecho() {
  try { localStorage.setItem('engrase_ultimo_respaldo', nowISO()); } catch (e) {}
}

async function revisarRecordatorioRespaldo() {
  if (!App.currentUser || App.currentUser.role !== 'ADMINISTRADOR') return;
  const ultimo = ultimoRespaldo();
  const dias = ultimo ? Math.floor((Date.now() - new Date(ultimo).getTime()) / 86400000) : null;

  // La primera vez no molesta enseguida: espera a que haya datos que valga la pena guardar
  if (!ultimo) {
    const registros = await DB.all('lubrication_records');
    if (registros.length < 20) return;
  } else if (dias < DIAS_ENTRE_RESPALDOS) return;

  // Se pospone si ya se avisó hoy, para no repetir en cada entrada
  const avisadoHoy = localStorage.getItem('engrase_aviso_respaldo') === new Date().toDateString();
  if (avisadoHoy) return;
  try { localStorage.setItem('engrase_aviso_respaldo', new Date().toDateString()); } catch (e) {}

  openModal('Respaldo de seguridad', `
    <p>${ultimo
      ? `El último respaldo fue hace <b>${dias} día(s)</b>.`
      : 'Todavía no se ha descargado ningún respaldo de este sistema.'}</p>
    <p class="dim">Un respaldo es un archivo con todo: equipos, planes, engrases, anomalías y usuarios.
    Sirve si el servidor falla o si alguien borra algo por error. Guárdalo fuera de la nube
    (en la computadora o en una memoria USB).</p>
    <div class="modal-actions">
      <button class="btn" id="resp-luego">Recordármelo mañana</button>
      <button class="btn btn-accent" id="resp-ahora">${ic("download")}Descargar ahora</button>
    </div>
  `);
  $('#resp-ahora').addEventListener('click', async () => {
    closeModal();
    await exportFullBackup();
  });
  $('#resp-luego').addEventListener('click', () => closeModal());
}

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
  marcarRespaldoHecho();
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
          <div class="notif-extra">
            <label class="notif-extra-check">
              <input type="checkbox" name="${clave}_recordatorio" ${cfg.recordatorio ? 'checked' : ''}/>
              <span>Recordar a media jornada si sigue pendiente</span>
            </label>
            <span class="notif-inline">
              pasadas
              <input type="number" name="${clave}_recordatorioHoras" value="${cfg.recordatorioHoras || 4}" min="1" max="12" step="1" class="notif-num" aria-label="Horas hasta el recordatorio"/>
              horas
            </span>
          </div>` : ''}
        ${conEscalamiento ? `
          <div class="notif-extra notif-escalamiento">
            <span class="notif-inline">
              Si lleva más de
              <input type="number" name="${clave}_escalarDias" value="${cfg.escalarDias || 3}" min="1" max="30" step="1" class="notif-num" aria-label="Días vencido antes de escalar"/>
              día(s) vencido, avisar también a:
            </span>
            <div class="notif-roles-list">
              ${NOTIF_ROLES_DISPONIBLES.map(r => `
                <label class="notif-rol">
                  <input type="checkbox" name="${clave}_esc_${r}" ${(cfg.escalarA || []).includes(r) ? 'checked' : ''}/>
                  <span>${r.charAt(0) + r.slice(1).toLowerCase()}</span>
                </label>`).join('')}
            </div>
          </div>` : ''}
      </div>
    </div>`;
}

async function renderConfig() {
  const c = $('#app-content');
  if (!c) return; // la pantalla ya no está en el documento (cambio de vista o de usuario)
  const cfg = (await DB.getConfig()) || {};
  const log = (await DB.all('audit_log')).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);
  const pending = await Sync.pendingCount();
  const notif = mergeNotifSettings(await DB.get('settings', 'notifications'));
  const gen = App.generalSettings;
  const pad = n => String(n).padStart(2, '0');
  const timeVal = (h, m) => `${pad(h)}:${pad(m)}`;
  // PIN rápido (P0-2): SOLO en AUTH_MODE='supabase' con sesión real ya
  // autenticada — nunca aparece en modo legacy ni sin login, ver
  // src/core/quick-unlock.js. Auth.getProfile() es la misma identidad que
  // Auth.isAuthenticated() ya validó, nunca App.currentUser.id a ciegas
  // (evita depender del shape armado en currentUserFromAuthProfile()).
  const quickUnlockAvailable = typeof Auth !== 'undefined' && Auth.isSupabaseMode() && Auth.isAuthenticated();
  const quickUnlockConfigured = quickUnlockAvailable && await QuickUnlock.isConfigured(Auth.getProfile().appUserId);

  c.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Apariencia</h3></div>
      <div style="padding:14px">
        <p class="dim">Color de acento y modo claro/oscuro de la aplicación.</p>
        <button type="button" class="btn" id="btn-theme">🎨 Cambiar colores</button>
      </div>
    </div>
    ${quickUnlockAvailable ? `
    <div class="panel">
      <div class="panel-head"><h3>PIN rápido (desbloqueo sin Internet)</h3></div>
      <div style="padding:14px">
        <p class="dim">Permite volver a entrar en este dispositivo con un PIN de 4 o 6 dígitos, sin escribir tu contraseña cada vez — incluso sin Internet. Nunca reemplaza tu contraseña real ni tu rol: solo desbloquea la pantalla.</p>
        ${quickUnlockConfigured
          ? `<button type="button" class="btn" id="btn-quick-unlock-change">Cambiar PIN</button> <button type="button" class="btn btn-danger" id="btn-quick-unlock-disable">Desactivar PIN rápido</button>`
          : `<button type="button" class="btn btn-accent" id="btn-quick-unlock-configure">Configurar PIN rápido</button>`}
      </div>
    </div>` : ''}
    ${await devicePanelHTML()}
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
    ${await cuadrillasPanelHTML()}
    ${await simpleListPanelHTML('locations', 'Ubicaciones / Flotas', 'Aparecen como opción de "Ubicación" al crear o editar un equipo.')}
    ${await simpleListPanelHTML('equipment_types', 'Categorías de equipo', 'Aparecen como opción de "Categoría" al crear o editar un equipo.')}

    <div class="panel" id="notif-panel">
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
        ${ONESIGNAL_APP_ID ? `
        <p class="dim">Recibe avisos aunque tengas la app cerrada.</p>
        <div id="push-status" class="dim" style="margin-bottom:10px">
          ${(('serviceWorker' in navigator && 'PushManager' in window) || window.Capacitor)
            ? 'Este dispositivo puede recibir notificaciones aunque la app esté cerrada.'
            : 'Este navegador no soporta notificaciones push. En iPhone, primero agrega la web a la pantalla de inicio.'}
        </div>
        ${(('serviceWorker' in navigator && 'PushManager' in window) || window.Capacitor)
          ? `<button class="btn btn-accent" id="btn-enable-push">Activar en este dispositivo</button>` : ''}
        <div id="my-notif-prefs" style="margin-top:14px"></div>
        <div id="push-tokens-list" style="margin-top:14px"></div>
        ` : `
        <p class="dim"><b>Notificaciones push no configuradas</b></p>
        <p class="dim">Esta función todavía no está disponible.</p>
        <button class="btn" disabled>Activar en este dispositivo</button>
        `}
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
        <form id="sync-interval-form" class="form-grid" style="margin-top:14px; border-top:1px solid var(--border); padding-top:14px">
          <label>Sincronización automática
            <select name="syncIntervalSeconds" ${App.currentUser.role !== 'ADMINISTRADOR' ? 'disabled' : ''}>
              ${SYNC_INTERVAL_OPTIONS.map(s => `<option value="${s}" ${App.generalSettings.syncIntervalSeconds === s ? 'selected' : ''}>${syncIntervalLabel(s)}</option>`).join('')}
            </select>
            <span class="field-hint">También se sincroniza al recuperar conexión y después de operaciones importantes.</span>
          </label>
          ${App.currentUser.role === 'ADMINISTRADOR' ? `
          <div class="modal-actions" style="grid-column:1/-1; justify-content:flex-start">
            <button type="submit" class="btn btn-accent">Guardar intervalo</button>
          </div>` : ''}
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
    <div class="panel" id="audit-log-panel">
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

  $('#btn-theme').addEventListener('click', openThemePicker);

  $('#btn-quick-unlock-configure')?.addEventListener('click', () => quickUnlockConfigureModal('configure'));
  $('#btn-quick-unlock-change')?.addEventListener('click', () => quickUnlockConfigureModal('change'));
  $('#btn-quick-unlock-disable')?.addEventListener('click', async () => {
    await QuickUnlock.disable();
    await logAudit('QUICK_UNLOCK_DESACTIVADO', App.currentUser.name, App.currentUser.name);
    showInAppToast('✓ PIN rápido desactivado');
    renderConfig();
  });

  $('#general-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    const [dayH] = fd.shiftDayStart.split(':').map(Number);
    const [nightH] = fd.shiftNightStart.split(':').map(Number);
    // ...(current): el documento `settings/general` guarda MÁS campos que
    // este formulario conoce (syncIntervalSeconds, ver #sync-interval-form
    // más abajo) — nunca se reconstruye desde cero, o guardar esto
    // borraría en silencio lo que el otro formulario acababa de guardar.
    const current = (await DB.get('settings', 'general')) || {};
    const updated = {
      ...current, id: 'general', shiftDayStart: dayH, shiftNightStart: nightH,
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

  $('#sync-interval-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    // Defensa además de deshabilitar/ocultar el control (ver markup
    // arriba): aunque alguien forzara el <select> por DevTools, esto
    // sigue sin permitir el cambio si no es ADMINISTRADOR.
    if (App.currentUser.role !== 'ADMINISTRADOR') return;
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    const seconds = normalizeSyncInterval(parseInt(fd.syncIntervalSeconds, 10));
    const current = (await DB.get('settings', 'general')) || {};
    const updated = { ...current, id: 'general', syncIntervalSeconds: seconds };
    await DB.put('settings', stamp(updated, App.currentUser.name));
    await logAudit('SYNC_INTERVALO_ACTUALIZADO', syncIntervalLabel(seconds), App.currentUser.name);
    await loadGeneralSettings();
    // Aplica YA, sin reiniciar la app — Sync.setAutoInterval() apaga el
    // timer anterior antes de crear el nuevo (nunca quedan dos activos).
    Sync.setAutoInterval(App.generalSettings.syncIntervalSeconds);
    showInAppToast('✓ Intervalo de sincronización actualizado');
    renderConfig();
  });

  wireCuadrillasPanel(c, () => renderConfig());
  wireDevicePanel(c, () => renderConfig());
  wireSimpleListPanel(c, 'locations', () => renderConfig());
  wireSimpleListPanel(c, 'equipment_types', () => renderConfig());

  $('#btn-enable-push')?.addEventListener('click', async () => {
    if (!confirm('Se te va a pedir permiso para mostrar notificaciones. ¿Continuar?')) return;
    await initPushNotifications();
    alert('Listo. Si OneSignal está bien configurado, este dispositivo debería aparecer en la lista de abajo en unos segundos (puede que tengas que volver a entrar a esta pantalla).');
    renderConfig();
  });

  // "Mis notificaciones" (lote arquitectura de notificaciones, §2/§21/§22/
  // §29) — autoservicio: cada persona ajusta SU PROPIO turno/disponibilidad
  // de notificación; receiveAllShifts solo se ofrece a ADMINISTRADOR (a
  // cualquier otro rol isUserEligibleForNotification() lo ignora, pero
  // tampoco tiene sentido mostrárselo). Solo existe si la persona YA
  // activó push en este dispositivo (si no, no hay fila push_tokens propia
  // que editar — se pide activar primero, nunca se inventa una fila vacía
  // aquí en la UI).
  const misPrefsEl = $('#my-notif-prefs');
  if (misPrefsEl) {
    const misTokens = (await DB.allActive('push_tokens')).filter(t => t.userId === App.currentUser.id);
    if (!misTokens.length) {
      misPrefsEl.innerHTML = `<p class="dim">Activa las notificaciones push arriba para poder configurar tu turno de notificación.</p>`;
    } else {
      const actual = misTokens[0]; // mismas preferencias en todas las plataformas de la persona (ver saveNotificationPreferences)
      misPrefsEl.innerHTML = `
        <h4 class="grease-flow-card-head" style="margin-top:0">Mis notificaciones</h4>
        <form id="my-notif-prefs-form" class="form-grid">
          <label>Turno en el que quiero recibir avisos
            <select name="notificationShift">
              <option value="BOTH" ${actual.notificationShift === 'BOTH' || !actual.notificationShift ? 'selected' : ''}>Ambos turnos</option>
              <option value="DAY" ${actual.notificationShift === 'DAY' ? 'selected' : ''}>Solo Turno Día</option>
              <option value="NIGHT" ${actual.notificationShift === 'NIGHT' ? 'selected' : ''}>Solo Turno Noche</option>
            </select>
          </label>
          <label>Disponibilidad
            <select name="notificationAvailability">
              <option value="AVAILABLE" ${actual.notificationAvailability !== 'RESTING' ? 'selected' : ''}>Disponible</option>
              <option value="RESTING" ${actual.notificationAvailability === 'RESTING' ? 'selected' : ''}>De descanso (no recibir avisos operativos)</option>
            </select>
          </label>
          ${App.currentUser.role === 'ADMINISTRADOR' ? `
          <label class="retro-toggle span-2">
            <input type="checkbox" name="receiveAllShifts" ${actual.receiveAllShifts ? 'checked' : ''}/>
            <span>Recibir alertas de todos los turnos (ignora el filtro de turno para mí)</span>
          </label>` : ''}
          <div class="span-2"><button type="submit" class="btn btn-sm btn-accent">Guardar mis notificaciones</button></div>
        </form>`;
      $('#my-notif-prefs-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const fd = Object.fromEntries(new FormData(ev.target).entries());
        try {
          await saveNotificationPreferences({
            notificationShift: fd.notificationShift,
            notificationAvailability: fd.notificationAvailability,
            receiveAllShifts: fd.receiveAllShifts === 'on'
          });
          showInAppToast('✓ Preferencias de notificación guardadas');
        } catch (e) { alert(e.message || 'No se pudo guardar.'); }
      });
    }
  }

  // Solo existe cuando ONESIGNAL_APP_ID está configurado (ver markup arriba)
  // — nunca se toca este bloque si la tarjeta muestra "no configuradas".
  const pushTokensListEl = $('#push-tokens-list');
  if (pushTokensListEl) {
    // Filtra las filas de DISPOSITIVO (sin userId, ver saveDeviceAssignment())
    // — esta tabla es "Usuario/Rol", nunca tuvo sentido mostrarlas aquí
    // (tienen su propio panel en Configuración → Cuadrillas/Dispositivo).
    const pushTokens = (await DB.allActive('push_tokens')).filter(t => t.userId);
    pushTokensListEl.innerHTML = pushTokens.length ? `
      <table class="data-table">
        <thead><tr><th>Usuario</th><th>Rol</th><th>Plataforma</th><th>Registrado</th><th></th></tr></thead>
        <tbody>${pushTokens.map(t => `<tr><td>${esc(t.userName)}</td><td>${t.role}</td><td>${t.platform}</td><td>${fmtDate(t.updatedAt)}</td><td><button type="button" class="btn btn-sm" data-edit-notif-user="${esc(t.userId)}" data-edit-notif-name="${esc(t.userName)}">Editar</button></td></tr>`).join('')}</tbody>
      </table>` : '<div class="empty-state">Nadie ha activado las notificaciones push todavía (o Firebase aún no está configurado).</div>';
    makeTablesResponsive($('#push-tokens-list'));
    $$('[data-edit-notif-user]', pushTokensListEl).forEach(btn => {
      btn.addEventListener('click', () => openEditUserNotificationPrefsModal(btn.dataset.editNotifUser, btn.dataset.editNotifName));
    });
  }
  // UI-FULL-103: navigate() ya aplica makeTablesResponsive() en la primera entrada a
  // Configuración, pero renderConfig() se vuelve a llamar directamente (sin pasar por
  // navigate()) después de casi cualquier acción de esta pantalla (guardar ajustes,
  // agregar cuadrilla/ubicación/tipo, activar push, restaurar respaldo…) — cada una de
  // esas veces reconstruye la tabla de auditoría sin la etiqueta móvil si no se repite
  // la llamada aquí.
  makeTablesResponsive($('#audit-log-panel'));

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
// Accesibilidad del modal (auditoría de accesibilidad, corrección #2 —
// mayor impacto por lo poco que cuesta: un solo arreglo aquí cubre TODAS
// las pantallas que llaman openModal()). Antes: sin Escape, sin trampa de
// foco (Tab se escapaba a la página de atrás), sin foco inicial, sin
// devolver el foco al cerrar, sin role/aria-modal/aria-labelledby, y el
// botón "✕" sin aria-label.
//
// El estado (foco previo, listener de teclado) se guarda como propiedades
// ad-hoc del propio nodo `overlay` (que es un singleton, nunca se recrea,
// solo se vacía su innerHTML) — a propósito, en vez de funciones/variables
// nuevas a nivel de módulo: varios specs reales (ej.
// tests/ui/grease-validation.spec.js) extraen SOLO openModal()/closeModal()
// con una lista acotada de nombres para probarlos en una página aislada;
// agregar un identificador global nuevo rompería esos specs con un
// ReferenceError. Manteniendo todo dentro de estas dos funciones, cualquier
// arnés que ya extraiga openModal()/closeModal() sigue funcionando sin
// tocar su lista de nombres.
function openModal(title, bodyHTML) {
  let overlay = $('#modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
  }
  overlay._previousFocus = document.activeElement;
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-text" tabindex="-1">
      <div class="modal-head"><h3 id="modal-title-text">${title}</h3><button class="icon-btn" id="modal-close" aria-label="Cerrar">✕</button></div>
      <div class="modal-body">${bodyHTML}</div>
    </div>`;
  overlay.classList.add('open');
  $('#modal-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  // Trampa de foco + Escape: Tab/Shift+Tab nunca deben salir del modal, y
  // Escape cierra igual que el botón "✕". `offsetParent !== null` excluye
  // elementos ocultos (display:none / ramas condicionales del HTML).
  function focusableElements() {
    return Array.from(overlay.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null);
  }
  function onKeydown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); closeModal(); return; }
    if (e.key !== 'Tab') return;
    const focusable = focusableElements();
    if (!focusable.length) { e.preventDefault(); return; } // nada que enfocar: el foco se queda en el modal mismo
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  // Quita el listener del modal anterior (si `overlay` se reutiliza para
  // abrir varios modales en la misma sesión) antes de agregar el nuevo —
  // nunca se acumulan listeners de Escape/Tab de modales ya cerrados.
  if (overlay._onKeydown) overlay.removeEventListener('keydown', overlay._onKeydown);
  overlay._onKeydown = onKeydown;
  overlay.addEventListener('keydown', onKeydown);

  // Foco inicial: el contenedor del modal mismo (tabindex="-1", nunca queda
  // en el orden normal de Tab) — el lector de pantalla anuncia el diálogo y
  // su título (aria-labelledby) antes de que la persona empiece a tabular
  // por su contenido, en vez de quedarse leyendo donde estaba la página de
  // atrás.
  overlay.querySelector('.modal').focus();
}
function closeModal() {
  const overlay = $('#modal-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  // Además de ocultarlo, vaciamos el contenido: si solo se quita la clase, el formulario
  // anterior sigue existiendo dentro del documento con sus campos y manejadores viejos,
  // y al abrir otra ventana se mezclan (ese era el "desfase" al agregar puntos de engrase).
  overlay.innerHTML = '';
  // Devuelve el foco a quien abrió el modal — nunca lo deja "perdido" en el
  // body. Si ese elemento ya no existe (la pantalla cambió debajo, o era de
  // un modal anterior encadenado), focus() en un nodo desconectado es un
  // no-op inofensivo, no un error.
  if (overlay._previousFocus && typeof overlay._previousFocus.focus === 'function') {
    overlay._previousFocus.focus();
  }
  overlay._previousFocus = null;
}
