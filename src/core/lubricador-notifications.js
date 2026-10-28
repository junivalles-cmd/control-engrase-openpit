// Presentation only. DB.allActive owns operational scope; the existing
// computeTasksMensajesBadgeCount owns unread count. No stores or sync logic.
const LubNotificationUI = { controller: null, timer: null, refresh: 0, render: 0 };

function wireLubNotificationBell() {
  LubNotificationUI.controller?.abort();
  clearTimeout(LubNotificationUI.timer);
  LubNotificationUI.refresh++;
  LubNotificationUI.render++;
  const button = document.getElementById('btn-lub-notifications');
  if (!button || App.currentUser?.role !== 'LUBRICADOR') return;
  const controller = new AbortController();
  LubNotificationUI.controller = controller;
  const options = { signal: controller.signal };
  button.addEventListener('click', openLubNotificationPanel, options);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateTareasMensajesNavBadge();
  }, options);
  window.addEventListener('focus', () => updateTareasMensajesNavBadge(), options);
}

async function refreshLubNotificationBell(unreadCount) {
  const button = document.getElementById('btn-lub-notifications');
  if (!button || App.currentUser?.role !== 'LUBRICADOR') return;
  const actorId = App.currentUser.id;
  const refresh = ++LubNotificationUI.refresh;
  const count = unreadCount ?? await computeTasksMensajesBadgeCount({ messagesOnly: true });
  if (!button.isConnected || App.currentUser?.id !== actorId || refresh !== LubNotificationUI.refresh) return;
  const badge = button.querySelector('[data-lub-notification-count]');
  badge.textContent = String(count);
  badge.classList.toggle('hidden', count === 0);
  const label = count ? `Notificaciones, ${count} mensaje${count === 1 ? '' : 's'} operativo${count === 1 ? '' : 's'} no leído${count === 1 ? '' : 's'}` : 'Notificaciones, sin mensajes operativos no leídos';
  button.setAttribute('aria-label', label);
  button.title = label;
  const status = document.getElementById('lub-notification-status');
  if (status && status.textContent !== label) status.textContent = label;
  // Existing validity is calendar-day based. Midnight changes eligibility
  // without a sync; foreground/focus catches suspended timers or clock changes.
  clearTimeout(LubNotificationUI.timer);
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 10);
  LubNotificationUI.timer = setTimeout(() => {
    if (button.isConnected && App.currentUser?.id === actorId) updateTareasMensajesNavBadge();
  }, Math.max(1, midnight.getTime() - Date.now()));
  if (document.getElementById('lub-notifications-panel')?.open) await renderLubNotificationPanel();
}

async function openLubNotificationPanel() {
  if (App.currentUser?.role !== 'LUBRICADOR') return;
  let panel = document.getElementById('lub-notifications-panel');
  if (!panel) {
    panel = document.createElement('dialog');
    panel.id = 'lub-notifications-panel';
    panel.className = 'lub-notification-sheet';
    panel.setAttribute('aria-labelledby', 'lub-notifications-title');
    panel.innerHTML = `<header class="lub-notification-header">
      <h2 id="lub-notifications-title">Notificaciones</h2>
      <button type="button" class="icon-btn" data-close-notifications aria-label="Cerrar notificaciones">✕</button>
    </header>
    <div class="lub-notification-list" data-notification-list aria-busy="true"><p class="dim">Cargando mensajes…</p></div>
    <footer class="lub-notification-footer"><button type="button" class="btn" data-open-messages>Abrir Tareas y Mensajes</button></footer>`;
    document.body.appendChild(panel);
    panel.querySelector('[data-close-notifications]').addEventListener('click', () => panel.close());
    panel.addEventListener('close', () => {
      LubNotificationUI.render++;
      document.getElementById('btn-lub-notifications')?.setAttribute('aria-expanded', 'false');
    });
    panel.addEventListener('click', async event => {
      if (event.target === panel) {
        const box = panel.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) panel.close();
        return;
      }
      const action = event.target.closest('button[data-read-message], button[data-view-message], button[data-open-messages]');
      if (!action || action.disabled) return;
      const actorId = App.currentUser?.id;
      const id = action.dataset.readMessage || action.dataset.viewMessage;
      action.disabled = true;
      try {
        if (id && action.dataset.messageRead !== 'true') await markBroadcastAsRead(id);
        if (App.currentUser?.id !== actorId || App.currentUser?.role !== 'LUBRICADOR') return;
        if (action.hasAttribute('data-view-message') || action.hasAttribute('data-open-messages')) {
          panel.close();
          navigate('tareas-mensajes');
          if (id) await focusTareasYMensajesItem('MENSAJE', id);
        }
      } catch (error) {
        const list = panel.querySelector('[data-notification-list]');
        if (panel.isConnected && App.currentUser?.id === actorId) {
          let alert = list.querySelector('[role="alert"]');
          if (!alert) { alert = document.createElement('p'); alert.setAttribute('role', 'alert'); list.prepend(alert); }
          alert.textContent = 'No se pudo guardar la lectura. Intenta de nuevo.';
        }
      } finally { if (action.isConnected) action.disabled = false; }
    });
  }
  document.getElementById('btn-lub-notifications')?.setAttribute('aria-expanded', 'true');
  if (!panel.open) panel.showModal();
  await renderLubNotificationPanel();
}

async function renderLubNotificationPanel() {
  const panel = document.getElementById('lub-notifications-panel');
  if (!panel?.open || App.currentUser?.role !== 'LUBRICADOR') return;
  const actor = App.currentUser;
  const render = ++LubNotificationUI.render;
  const list = panel.querySelector('[data-notification-list]');
  try {
    const [broadcasts, reads, crews, locations] = await Promise.all([
      DB.allActive('broadcast_messages'), DB.allActive('broadcast_message_reads'),
      DB.allActive('cuadrillas'), DB.allActive('locations'),
    ]);
    if (!panel.isConnected || !panel.open || App.currentUser?.id !== actor.id || render !== LubNotificationUI.render) return;
    const readIds = new Set(reads.filter(r => r.userId === actor.id).map(r => r.messageId));
    // The same existing notice builder handles validity/read presentation;
    // it is called only when the sheet is OPEN, never by Mi Turno or badge.
    const notices = buildBroadcastNotices({ broadcasts: broadcasts.filter(m => m.active !== false), readMessageIds: readIds, todayISO: todayDateISO() });
    const markup = notices.length ? notices.map(item => {
      const msg = broadcasts.find(m => m.id === item.actionTarget);
      const target = msg.targetType === 'ALL_LUBRICATORS' ? 'Todos los lubricadores'
        : msg.targetType === 'USER' ? 'Para ti'
        : msg.targetType === 'CREW' ? `Cuadrilla: ${crews.find(c => c.id === msg.targetId)?.name || msg.targetId}`
        : `Ubicación: ${locations.find(l => l.id === msg.targetId)?.name || msg.targetId}`;
      const priority = msg.priority === 'CRITICA' ? 'CRÍTICA' : msg.priority === 'IMPORTANTE' ? 'IMPORTANTE' : 'INFORMATIVA';
      const date = msg.createdAt && !Number.isNaN(new Date(msg.createdAt).getTime()) ? new Date(msg.createdAt).toLocaleString('es-NI') : 'Fecha no disponible';
      const origin = msg.createdBy === actor.id ? actor.name : msg.createdBy || 'No disponible';
      return `<article class="lub-notification-item${item.read ? ' broadcast-read' : ''}" data-notification-id="${esc(msg.id)}">
        <div class="lub-notification-meta"><span class="status-chip lub-notification-priority" data-priority="${esc(msg.priority || 'INFORMATIVA')}">${priority}</span><span>${item.read ? 'Leído' : 'No leído'}</span></div>
        <button type="button" class="lub-notification-message" data-view-message="${esc(msg.id)}" data-message-read="${item.read}"><strong>${esc(item.title)}</strong><span>${esc(msg.message || '')}</span></button>
        <div class="lub-notification-meta"><time>${esc(date)}</time><span>Origen: ${esc(origin)}</span><span>${esc(target)}</span></div>
        ${item.read ? '' : `<button type="button" class="btn" data-read-message="${esc(msg.id)}">Marcar leído</button>`}
      </article>`;
    }).join('') : '<p class="lub-notification-empty">No hay mensajes operativos vigentes.</p>';
    if (list.innerHTML !== markup) {
      const active = panel.contains(document.activeElement) ? document.activeElement : null;
      const focusId = active?.dataset?.readMessage || active?.dataset?.viewMessage;
      list.innerHTML = markup;
      if (focusId) [...list.querySelectorAll('[data-view-message]')].find(b => b.dataset.viewMessage === focusId)?.focus({ preventScroll: true });
    }
    list.setAttribute('aria-busy', 'false');
  } catch (error) {
    if (panel.open && App.currentUser?.id === actor.id && render === LubNotificationUI.render) {
      list.innerHTML = '<p role="alert">No se pudieron cargar los mensajes locales. Cierra y vuelve a intentar.</p>';
      list.setAttribute('aria-busy', 'false');
    }
  }
}
