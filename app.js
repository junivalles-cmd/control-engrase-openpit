/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT — app.js
   ============================================================ */

const App = {
  currentUser: null,
  route: 'dashboard',
  configAlertYellow: 10
};

const PERMISSIONS = {
  ADMINISTRADOR: ['dashboard','equipos','plan','turno','registrar','horometros','anomalias','lubricantes','historial','reportes','usuarios','config'],
  PLANIFICADOR: ['dashboard','equipos','plan','turno','historial','reportes','horometros'],
  SUPERVISOR: ['dashboard','equipos','turno','anomalias','historial','usuarios'],
  LUBRICADOR: ['turno','anomalias','historial']
};

/* ---------- utilidades ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const fmt = (n, d = 0) => Number(n).toLocaleString('es-NI', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDate = (iso) => new Date(iso).toLocaleString('es-NI', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function currentShiftId() {
  const h = new Date().getHours();
  return (h >= 6 && h < 18) ? 'shift_dia' : 'shift_noche';
}

async function statusFor(equipment) {
  if (equipment.status !== 'Operativo') {
    return { code: 'GRIS', label: 'DETENIDO', remaining: null };
  }
  const plans = await DB.allActive('lubrication_plans');
  const plan = plans.find(p => p.equipmentId === equipment.id);
  if (!plan) return { code: 'GRIS', label: 'SIN PLAN', remaining: null };
  const nextHour = plan.lastGreaseHour + plan.frequency;
  const remaining = nextHour - equipment.hourmeter;
  let code, label;
  if (remaining < 0) { code = 'ROJO'; label = 'VENCIDO'; }
  else if (remaining <= (plan.alertYellowHours || 10)) { code = 'AMARILLO'; label = 'PRÓXIMO'; }
  else { code = 'VERDE'; label = 'AL DÍA'; }
  return { code, label, remaining, nextHour, plan };
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
    </div>
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
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  window.addEventListener('online', updateConnBadge);
  window.addEventListener('offline', updateConnBadge);
  Sync.onChange(onSyncStateChange);
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
  const ROLE_ICON = { ADMINISTRADOR: '🛠️', PLANIFICADOR: '🗓️', SUPERVISOR: '👷', LUBRICADOR: '🛢️' };
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
  const doLogin = () => {
    const pin = $('#pin-input').value.trim();
    if (!selected) return;
    if (pin === selected.pin) {
      App.currentUser = { id: selected.id, name: selected.name, role: selected.role };
      sessionStorage.setItem('engrase_user', JSON.stringify(App.currentUser));
      boot();
    } else {
      $('#login-error').textContent = 'PIN incorrecto. Intenta nuevamente.';
    }
  };
  $('#pin-submit').addEventListener('click', doLogin);
  $('#pin-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
}

function logout() {
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
];

function boot() {
  Sync.fullSync();
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
    reportes: renderReportes, usuarios: renderUsuarios, config: renderConfig
  };
  (renderers[route] || renderDashboard)();
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
    else renderLubricadorHistorial();
  }));

  App.route = 'turno';
  renderLubricadorHome();
}

async function renderLubricadorHome() {
  const c = $('#app-content');
  c.innerHTML = `<div class="loading">Cargando tu turno…</div>`;
  const equipos = await DB.allActive('equipment');
  const shift = currentShiftId();
  const equiposTurno = equipos.filter(e => e.shiftId === shift);
  const statuses = await Promise.all(equiposTurno.map(async e => ({ e, s: await statusFor(e) })));
  const order = { ROJO: 0, AMARILLO: 1, VERDE: 2, GRIS: 3 };
  statuses.sort((a, b) => order[a.s.code] - order[b.s.code]);

  c.innerHTML = `
    <h2 class="lub-heading">Equipos del turno ${shift === 'shift_dia' ? 'Día' : 'Noche'}</h2>
    <p class="lub-sub">Toca un equipo para registrar el engrase.</p>
    <div class="lub-eq-list">
      ${statuses.map(({ e, s }) => `
        <button class="lub-eq-btn" data-status="${s.code}" data-id="${e.id}">
          <div class="lub-eq-top">
            <span class="lub-eq-code">${e.code}</span>
            <span class="status-chip" style="--c:${STATUS_COLOR[s.code]}">${s.label}</span>
          </div>
          <div class="lub-eq-model">${e.brand} ${e.model}</div>
          <div class="lub-eq-bottom">
            <span class="mono">${fmt(e.hourmeter)} h</span>
            ${s.remaining !== undefined && s.remaining !== null ? `<span class="mono" style="color:${STATUS_COLOR[s.code]}">${s.remaining < 0 ? fmt(Math.abs(s.remaining)) + ' h atraso' : fmt(s.remaining) + ' h restante'}</span>` : ''}
          </div>
        </button>`).join('') || `<div class="empty-state">No hay equipos asignados a este turno.</div>`}
    </div>
    <button class="lub-anomaly-fab" id="lub-fab-anomaly">⚠ Reportar anomalía</button>
  `;
  $$('.lub-eq-btn', c).forEach(b => b.addEventListener('click', () => startLubricadorGreaseFlow(b.dataset.id)));
  $('#lub-fab-anomaly').addEventListener('click', () => openAnomalyForm());
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
  c.innerHTML = `
    <h2 class="lub-heading">Mis últimos engrases</h2>
    <div class="lub-record-list">
      ${records.map(r => {
        const eq = equipos.find(e => e.id === r.equipmentId);
        return `<div class="lub-record-card">
          <div class="lub-eq-top"><span class="lub-eq-code">${eq ? eq.code : '—'}</span><span class="dim">${fmtDate(r.date)}</span></div>
          <div class="lub-eq-model">${eq ? eq.brand + ' ' + eq.model : ''}</div>
          <div class="lub-eq-bottom"><span class="mono">${fmt(r.hourmeter)} h</span><span>${r.condition}</span></div>
        </div>`;
      }).join('') || `<div class="empty-state">Aún no has registrado engrases.</div>`}
    </div>`;
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

  const statuses = await Promise.all(equipos.map(async e => ({ e, s: await statusFor(e) })));
  const counts = { VERDE: 0, AMARILLO: 0, ROJO: 0, GRIS: 0 };
  statuses.forEach(x => counts[x.s.code]++);

  const today = new Date().toDateString();
  const doneToday = records.filter(r => new Date(r.createdAt).toDateString() === today).length;
  const openAnomalies = anomalies.filter(a => a.status !== 'Cerrada').length;

  const compliance = equipos.length ? Math.round(((counts.VERDE + counts.AMARILLO) / equipos.length) * 100) : 0;

  const attention = statuses
    .filter(x => x.s.code === 'ROJO' || x.s.code === 'AMARILLO')
    .sort((a, b) => (a.s.remaining ?? 0) - (b.s.remaining ?? 0));

  c.innerHTML = `
    <div class="kpi-grid">
      ${kpiCard('TOTAL EQUIPOS', equipos.length, 'neutral')}
      ${kpiCard('AL DÍA', counts.VERDE, 'green')}
      ${kpiCard('PRÓXIMOS A ENGRASE', counts.AMARILLO, 'amber')}
      ${kpiCard('ENGRASE VENCIDO', counts.ROJO, 'red')}
      ${kpiCard('REALIZADOS HOY', doneToday, 'neutral')}
      ${kpiCard('ANOMALÍAS ABIERTAS', openAnomalies, 'amber')}
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Cumplimiento de engrase</h3>
        <span class="pill">${compliance}% · objetivo ≥ 95%</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${compliance}%; background:${compliance >= 95 ? 'var(--green)' : compliance >= 80 ? 'var(--amber)' : 'var(--red)'}"></div></div>
    </div>

    <div class="panel">
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
        ${statuses.map(x => equipmentCard(x.e, x.s)).join('')}
      </div>
    </div>
  `;
}

function kpiCard(label, value, tone) {
  return `<div class="kpi-card tone-${tone}">
    <div class="kpi-value">${fmt(value)}</div>
    <div class="kpi-label">${label}</div>
  </div>`;
}

function equipmentCard(e, s) {
  return `<div class="eq-card" data-status="${s.code}">
    <div class="eq-card-head">
      <span class="eq-code">${e.code}</span>
      <span class="status-chip" style="--c:${STATUS_COLOR[s.code]}">${s.label}</span>
    </div>
    <div class="eq-name">${e.brand} ${e.model}</div>
    <div class="eq-hourmeter">${fmt(e.hourmeter)}<span class="unit"> h</span></div>
    ${s.nextHour !== undefined ? `
    <div class="eq-detail-row"><span>Próximo engrase</span><span class="mono">${fmt(s.nextHour)} h</span></div>
    <div class="eq-detail-row"><span>${s.remaining < 0 ? 'Atraso' : 'Restante'}</span><span class="mono" style="color:${STATUS_COLOR[s.code]}">${fmt(Math.abs(s.remaining))} h</span></div>
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
  const canEdit = App.currentUser.role === 'ADMINISTRADOR';

  c.innerHTML = `
    <div class="toolbar">
      <input id="eq-search" class="input" placeholder="Buscar por código, marca, modelo…" />
      ${canEdit ? `<button class="btn btn-accent" id="eq-new">+ Nuevo equipo</button>` : ''}
      ${canEdit ? `<button class="btn" id="eq-import">⇪ Importar desde Excel</button>` : ''}
      <input type="file" id="eq-import-file" accept=".xlsx,.xls,.csv" class="hidden"/>
    </div>
    <div class="cards-grid" id="eq-list"></div>
  `;

  async function draw(filter = '') {
    const list = $('#eq-list');
    const f = filter.toLowerCase();
    const filtered = equipos.filter(e =>
      !f || [e.code, e.shortCode, e.brand, e.model, e.description].join(' ').toLowerCase().includes(f));
    const withStatus = await Promise.all(filtered.map(async e => ({ e, s: await statusFor(e) })));
    list.innerHTML = withStatus.map(({ e, s }) => `
      <div class="eq-card clickable" data-id="${e.id}">
        <div class="eq-card-head">
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
      card.addEventListener('click', () => openEquipmentDetail(card.dataset.id));
    });
  }
  draw();
  $('#eq-search').addEventListener('input', (e) => draw(e.target.value));
  if (canEdit) $('#eq-new')?.addEventListener('click', () => openEquipmentForm(null, types, locations));
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
      ${canEdit ? `<button class="btn btn-danger" id="btn-delete-eq">Eliminar equipo</button>` : ''}
      ${canEdit ? `<button class="btn" id="btn-edit-eq">Editar</button>` : ''}
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
  const e = equipment || { code: '', shortCode: '', description: '', brand: '', model: '', serial: '', typeId: types[0]?.id, locationId: locations[0]?.id, status: 'Operativo', hourmeter: 0, shiftId: 'shift_dia' };
  if (isNew) e.code = await generateNextEquipmentCode();

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
      <div class="modal-actions">
        <button type="submit" class="btn btn-accent">Guardar</button>
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

  c.innerHTML = `
    <div class="toolbar">
      ${canEdit ? `<button class="btn" id="pts-import">⇪ Importar puntos de engrase desde Excel</button>` : ''}
      <input type="file" id="pts-import-file" accept=".xlsx,.xls,.csv" class="hidden"/>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Planes de engrase por equipo</h3></div>
      <table class="data-table">
        <thead><tr><th>Código</th><th>Equipo</th><th>Control</th><th>Frecuencia</th><th>Último engrase</th><th>Alerta amarilla</th><th>Puntos</th><th></th></tr></thead>
        <tbody>
          ${(await Promise.all(equipos.map(async e => {
            const plan = plans.find(p => p.equipmentId === e.id);
            const points = plan ? (await DB.allActive('lubrication_points')).filter(p => p.planId === plan.id) : [];
            return `<tr>
              <td class="mono">${e.code}</td>
              <td>${e.brand} ${e.model}</td>
              <td>${plan ? plan.controlType : '—'}</td>
              <td class="mono">${plan ? plan.frequency + ' h' : '—'}</td>
              <td class="mono">${plan ? fmt(plan.lastGreaseHour) + ' h' : '—'}</td>
              <td class="mono">${plan ? plan.alertYellowHours + ' h' : '—'}</td>
              <td>${points.length}</td>
              <td><button class="btn btn-sm" data-eq="${e.id}" data-plan="${plan ? plan.id : ''}">Configurar</button></td>
            </tr>`;
          }))).join('')}
        </tbody>
      </table>
    </div>`;

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
            frequency: p.freq, lastGreaseHour: eq.hourmeter, alertYellowHours: 10, active: true
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

  openModal(`Plan de engrase · ${equipment.code}`, `
    <form id="plan-form" class="form-grid">
      <label>Tipo de control
        <select name="controlType">
          ${['Horas de operación', 'Fecha/calendario', 'Turno', 'Combinación de horas y calendario'].map(o => `<option ${plan && plan.controlType === o ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
      </label>
      <label>Frecuencia (horas)<input required type="number" name="frequency" value="${plan ? plan.frequency : 50}"/></label>
      <label>Horómetro del último engrase<input required type="number" step="0.1" name="lastGreaseHour" value="${plan ? plan.lastGreaseHour : equipment.hourmeter}"/></label>
      <label>Alerta amarilla (horas antes)<input required type="number" name="alertYellowHours" value="${plan ? plan.alertYellowHours : 10}"/></label>
      <div class="modal-actions"><button type="submit" class="btn btn-accent">Guardar plan</button></div>
    </form>
    <div class="panel-head" style="margin-top:16px"><h3>Puntos de engrase</h3></div>
    <div id="points-list">
      ${points.map(p => pointRow(p, lubricants)).join('') || '<div class="empty-state">Sin puntos configurados.</div>'}
    </div>
    <button class="btn btn-sm" id="btn-add-point" ${plan ? '' : 'disabled title="Guarda el plan primero"'}>+ Agregar punto</button>
  `);

  $('#plan-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    fd.frequency = parseFloat(fd.frequency);
    fd.lastGreaseHour = parseFloat(fd.lastGreaseHour);
    fd.alertYellowHours = parseFloat(fd.alertYellowHours);
    if (!plan) plan = stamp({ id: uid('plan'), equipmentId, ...fd }, App.currentUser.name);
    else Object.assign(plan, fd);
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
    <div><b>${p.point}</b><div class="dim">${lub ? lub.name : ''} · ${p.recommendedQty} kg</div></div>
    <div class="row-actions">
      <button class="btn btn-sm point-edit" data-id="${p.id}">Editar</button>
      <button class="btn btn-sm btn-danger point-del" data-id="${p.id}">Eliminar</button>
    </div>
  </div>`;
}

function openPointForm(planId, pointId, lubricants) {
  DB.get('lubrication_points', pointId).then(existing => {
    const p = existing || { system: 'General', component: '', point: '', greaseType: lubricants[0]?.id, recommendedQty: 0.5, frequency: 50, notes: '' };
    openModal(pointId ? 'Editar punto' : 'Nuevo punto de engrase', `
      <form id="point-form" class="form-grid">
        <label>Sistema<input name="system" value="${p.system}"/></label>
        <label>Componente<input name="component" value="${p.component}"/></label>
        <label>Punto de engrase<input required name="point" value="${p.point}"/></label>
        <label>Tipo de grasa
          <select name="greaseType">${lubricants.map(l => `<option value="${l.id}" ${l.id === p.greaseType ? 'selected' : ''}>${l.name}</option>`).join('')}</select>
        </label>
        <label>Cantidad recomendada (kg)<input type="number" step="0.1" name="recommendedQty" value="${p.recommendedQty}"/></label>
        <label>Observaciones<input name="notes" value="${p.notes || ''}"/></label>
        <div class="modal-actions"><button type="submit" class="btn btn-accent">Guardar punto</button></div>
      </form>
    `);
    $('#point-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target).entries());
      fd.recommendedQty = parseFloat(fd.recommendedQty);
      const obj = existing ? Object.assign(existing, fd) : stamp({ id: uid('pt'), planId, ...fd }, App.currentUser.name);
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
  const shift = currentShiftId();
  const equiposTurno = equipos.filter(e => e.shiftId === shift);
  const statuses = await Promise.all(equiposTurno.map(async e => ({ e, s: await statusFor(e) })));
  statuses.sort((a, b) => (a.s.remaining ?? 9999) - (b.s.remaining ?? 9999));

  c.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>Plan de engrase del turno — ${shift === 'shift_dia' ? 'Día' : 'Noche'}</h3>
        <span class="pill">${equiposTurno.length} equipos</span>
      </div>
      <table class="data-table">
        <thead><tr><th>Estado</th><th>Código</th><th>Equipo</th><th>Horómetro</th><th>Último</th><th>Próximo</th><th>Restante</th><th></th></tr></thead>
        <tbody>
          ${statuses.map(({ e, s }) => `
            <tr>
              <td><span class="dot" style="background:${STATUS_COLOR[s.code]}"></span> ${s.label}</td>
              <td class="mono">${e.code}</td>
              <td>${e.brand} ${e.model}</td>
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
  const equipment = await DB.get('equipment', equipmentId);
  const plan = (await DB.allActive('lubrication_plans')).find(p => p.equipmentId === equipmentId);
  const points = plan ? (await DB.allActive('lubrication_points')).filter(p => p.planId === plan.id) : [];
  const lubricants = await DB.allActive('lubricants');

  const html = `
    <div class="panel">
      <div class="panel-head"><h3>Registrar engrase — ${equipment.code} · ${equipment.brand} ${equipment.model}</h3></div>
      <div class="dim" style="padding:0 14px 8px">Registrado por ${App.currentUser.name} · ${fmtDate(nowISO())} · ${currentShiftId() === 'shift_dia' ? 'Turno Día' : 'Turno Noche'}</div>
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
          ${points.length ? `<button type="button" class="btn btn-sm" id="btn-check-all">Marcar todos</button>` : ''}
        </div>
        ${points.length ? `<div class="checklist-progress"><div class="checklist-progress-fill" id="checklist-progress-fill" style="width:100%"></div></div><div class="dim" id="checklist-progress-text" style="padding:4px 4px 8px">${points.length} de ${points.length} puntos marcados</div>` : ''}
        <div id="checklist">
          ${points.length ? points.map(p => `
            <div class="checklist-item" data-point="${p.id}">
              <label class="check-row">
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
          <label>Fotografía (opcional)<input type="file" name="photo" accept="image/*"/><span class="field-hint">Puedes tomar una foto nueva o elegir una de tu galería</span></label>
          <label class="span-2">Observaciones<textarea name="notes" rows="2"></textarea></label>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn" id="btn-report-anomaly">⚠ Reportar anomalía</button>
          <button type="submit" class="btn btn-accent">✓ Finalizar engrase</button>
        </div>
      </form>
    </div>`;

  const area = target || (() => { navigate('registrar'); return $('#reg-flow-area'); })();
  if (target) target.innerHTML = html; else setTimeout(() => { $('#reg-flow-area').innerHTML = html; wireGreaseForm(); }, 30);
  if (target) wireGreaseForm();

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
    });
    $('#btn-report-anomaly').addEventListener('click', () => openAnomalyForm(equipment.id, equipment.code));

    $('#grease-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target).entries());
      const newHourmeter = parseFloat(fd.hourmeter);

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

      const photoFile = ev.target.querySelector('input[name="photo"]').files[0];
      const photoData = await fileToCompressedDataURL(photoFile);

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
      <button class="btn" id="hm-import">⇪ Importar horómetros desde Excel</button>
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
              <td><button class="btn btn-sm btn-accent hm-save">Guardar</button></td>
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
    preview.push({ code, found: true, id: eq.id, before: eq.hourmeter, after: val });
  }
  if (!preview.length) { alert('No se encontraron filas válidas con "Código" y "Horómetro".'); return; }

  openModal(`Importar horómetros (${preview.length} filas)`, `
    <div style="max-height:40vh; overflow:auto; border:1px solid var(--border); border-radius:8px">
      <table class="data-table">
        <thead><tr><th>Código</th><th>Anterior</th><th>Nuevo</th><th>Estado</th></tr></thead>
        <tbody>${preview.map(p => `<tr>
          <td class="mono">${p.code}</td>
          <td class="mono">${p.found ? fmt(p.before) + ' h' : '—'}</td>
          <td class="mono">${p.found ? fmt(p.after) + ' h' : '—'}</td>
          <td>${p.found ? 'OK' : '<span style="color:var(--red)">Código no encontrado</span>'}</td>
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
      <button class="btn btn-accent" id="btn-new-anom">+ Nueva anomalía</button>
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
        <td>${a.status !== 'Cerrada' && ['ADMINISTRADOR', 'SUPERVISOR'].includes(App.currentUser.role) ? `<button class="btn btn-sm" data-id="${a.id}">Cerrar</button>` : ''}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="9" class="empty-state">Sin anomalías registradas.</td></tr>';
    wirePhotoThumbs($('#anom-table'));

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
      <label>Fotografía (opcional)<input type="file" accept="image/*" name="photo"/><span class="field-hint">Puedes tomar una foto nueva o elegir una de tu galería</span></label>
      <div class="modal-actions"><button type="submit" class="btn btn-accent">Registrar anomalía</button></div>
    </form>
  `);
  $('#anom-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    delete fd.photo;
    const photoFile = ev.target.querySelector('input[name="photo"]').files[0];
    const photoData = await fileToCompressedDataURL(photoFile);
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
      ${canEdit ? `<button class="btn btn-accent" id="btn-new-lub">+ Nuevo lubricante</button>` : '<span></span>'}
    </div>
    <div class="panel">
      <table class="data-table">
        <thead><tr><th>Nombre</th><th>Marca</th><th>Tipo</th><th>Grado</th><th>Código</th><th>Consumo total (kg)</th></tr></thead>
        <tbody>
          ${lubricants.map(l => {
            const total = records.filter(r => r.greaseType === l.id).reduce((s, r) => s + (r.qty || 0), 0);
            return `<tr><td>${l.name}</td><td>${l.brand}</td><td>${l.type}</td><td>${l.grade}</td><td class="mono">${l.code}</td><td class="mono">${fmt(total, 1)}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  $('#btn-new-lub')?.addEventListener('click', () => {
    openModal('Nuevo lubricante', `
      <form id="lub-form" class="form-grid">
        <label>Nombre<input required name="name"/></label>
        <label>Marca<input name="brand"/></label>
        <label>Tipo<input name="type"/></label>
        <label>Grado<input name="grade" placeholder="NLGI 2"/></label>
        <label>Código interno<input name="code"/></label>
        <label>Unidad<input name="unit" value="kg"/></label>
        <div class="modal-actions"><button type="submit" class="btn btn-accent">Guardar</button></div>
      </form>`);
    $('#lub-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target).entries());
      await DB.put('lubricants', stamp({ id: uid('lub'), ...fd }, App.currentUser.name));
      closeModal();
      renderLubricantes();
    });
  });
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
            ${isAdmin ? `<td><button class="btn btn-sm btn-danger btn-del-record" data-id="${r.id}">Eliminar</button></td>` : ''}
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
  const statuses = await Promise.all(equipos.map(async e => ({ e, s: await statusFor(e) })));

  const total = equipos.length;
  const vencidos = statuses.filter(x => x.s.code === 'ROJO').length;
  const pendientes = statuses.filter(x => x.s.code === 'AMARILLO').length;
  const alDia = statuses.filter(x => x.s.code === 'VERDE').length;
  const compliance = total ? Math.round(((total - vencidos) / total) * 100) : 0;

  const today = new Date();
  const defaultFrom = new Date(today); defaultFrom.setDate(defaultFrom.getDate() - 30);
  const toInput = today.toISOString().slice(0, 10);
  const fromInput = defaultFrom.toISOString().slice(0, 10);

  c.innerHTML = `
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
      <div class="progress-track"><div class="progress-fill" style="width:${compliance}%; background:${compliance >= 95 ? 'var(--green)' : compliance >= 80 ? 'var(--amber)' : 'var(--red)'}"></div></div>
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
      <div class="panel-head"><h3>Exportar (según filtros aplicados)</h3></div>
      <div class="toolbar" style="padding:0 14px 14px">
        <button class="btn btn-accent" id="exp-cumplimiento">Cumplimiento (CSV)</button>
        <button class="btn" id="exp-historico">Histórico de engrases (CSV)</button>
        <button class="btn" id="exp-anomalias">Anomalías (CSV)</button>
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

  c.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-accent" id="btn-new-lubricador">+ Nuevo lubricador</button>
      ${!isSupervisor ? `<button class="btn" id="btn-new-user">+ Otro tipo de usuario</button>` : ''}
    </div>
    <div class="panel">
      <table class="data-table">
        <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th></th></tr></thead>
        <tbody>
          ${users.map(u => `<tr>
            <td>${u.name}</td><td class="mono">${u.username}</td><td>${u.role}</td>
            <td class="row-actions">
              <button class="btn btn-sm" data-edit="${u.id}">Editar</button>
              ${u.id !== App.currentUser.id ? `<button class="btn btn-sm btn-danger" data-deactivate="${u.id}">Desactivar</button>` : ''}
            </td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">Sin usuarios lubricadores registrados.</td></tr>'}
        </tbody>
      </table>
    </div>`;

  function userForm(existing, lockRoleToLubricador) {
    const u = existing || { name: '', username: '', pin: '', role: 'LUBRICADOR' };
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
async function renderConfig() {
  const c = $('#app-content');
  const cfg = (await DB.getConfig()) || {};
  const log = (await DB.all('audit_log')).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);
  const pending = await Sync.pendingCount();

  c.innerHTML = `
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
      <div class="panel-head"><h3>Registro de auditoría (últimas 50 acciones)</h3></div>
      <table class="data-table">
        <thead><tr><th>Fecha</th><th>Acción</th><th>Detalle</th><th>Usuario</th></tr></thead>
        <tbody>${log.map(l => `<tr><td>${fmtDate(l.createdAt)}</td><td>${l.action}</td><td>${l.detail}</td><td>${l.user}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">Sin actividad.</td></tr>'}</tbody>
      </table>
    </div>`;

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
