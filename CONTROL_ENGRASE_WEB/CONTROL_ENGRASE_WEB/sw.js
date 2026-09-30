const CACHE = 'engrase-openpit-v59'; // v59: rediseño estructural del Dashboard (cierre Parte D) — misma lógica/datos/filtros de siempre, solo cambia JERARQUÍA+DISTRIBUCIÓN: A.Cabecera+Filtros B.KPI principales (Vencidos/Pendientes hoy/Próximos/Realizados hoy/Pendientes de validación/Cumplimiento hoy) C.Cumplimiento (Hoy/Semana/Turno) D.Requieren atención (Vencido>Turno anterior>Pendiente hoy>Próximo>Sin plan>Pausado) E.Pendientes del turno anterior (sección propia, nunca un KPI) F.Estado por ubicación G.Asignaciones activas+Fuera de plan+No ejecutados (compacto) H.Mayor tiempo sin engrasar I.Indicadores secundarios (Al día/Sin plan/Pausados/Anomalías abiertas/Total equipos, menor peso visual). Auditoría de no-double-count (§15): "Pendientes hoy" reusa el universo exacto de "Cumplimiento Hoy" (nunca doble con Vencidos, mutuamente excluyentes por construcción de weekdayStatusFor()); "Próximos" excluye lo etiquetado PROGRAMADO HOY; BUG REAL corregido — pendientesTurnoAnterior ahora excluye equipos ya engrasados más tarde el mismo día (antes contaba como "pendiente" Y "realizado" a la vez). Nada tocó producción/Supabase, nada desplegado.
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './db.js', './sync.js', './manifest.json',
  // Núcleo de lógica extraído de app.js (ver docs/MODULARIZATION.md) — deben
  // precachearse igual que app.js/db.js/sync.js para que el modo offline
  // siga funcionando.
  './src/core/auth.js', './src/core/quick-unlock.js', './src/core/shifts.js', './src/core/hourmeter.js',
  './src/core/lubrication-status.js', './src/core/anomalies.js',
  './src/core/weekly-matrix.js', './src/core/anomaly-actions.js',
  './src/core/plan-compliance.js', './src/core/grease-validation.js',
  './src/core/operational-scope.js', './src/core/notification-routing.js',
  './favicon.png', './apple-touch-icon.png',
  './icon-72.png', './icon-96.png', './icon-128.png', './icon-144.png', './icon-152.png',
  './icon-192.png', './icon-384.png', './icon-512.png',
  './icon-maskable-192.png', './icon-maskable-512.png'
];

// Librerías externas (gráficas, Excel, PDF) que también queremos disponibles sin internet
// después del primer uso. Se cachean por separado y con manejo de error individual, para
// que si una falla (ej. sin internet en la instalación) no tumbe la instalación completa.
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js',
  'https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Los archivos propios de la app deben cachear sí o sí; si alguno falla, la instalación falla (correcto).
    await cache.addAll(ASSETS);
    // Las librerías externas son "mejor esfuerzo": si no hay internet en este momento, se
    // cachearán solas la primera vez que alguien las use (ver el fetch handler más abajo).
    await Promise.allSettled(CDN_ASSETS.map(async (url) => {
      try {
        const resp = await fetch(url, { mode: 'cors' });
        if (resp.ok) await cache.put(url, resp);
      } catch (err) { /* sin internet en la instalación, no pasa nada, se cachea después */ }
    }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const reqUrl = new URL(e.request.url);
  const sameOrigin = reqUrl.origin === self.location.origin;
  const isKnownCdn = reqUrl.origin === 'https://cdn.jsdelivr.net';

  // Solo controlamos archivos propios de la app y las librerías CDN conocidas (arriba).
  // Cualquier otra petición cross-origin (Supabase, Capacitor, etc.) se deja pasar sin
  // interceptar, para no interferir con la sincronización.
  if (!sameOrigin && !isKnownCdn) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(networkResp => {
        if (networkResp && networkResp.ok) {
          const clone = networkResp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return networkResp;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

/* ============================================================
   NOTIFICACIONES PUSH (navegador / PWA instalada)
   El Service Worker sigue vivo aunque la pestaña esté cerrada, así que es él
   quien recibe el aviso del servidor y muestra la notificación del sistema.
   Sin este bloque, las push solo llegaban con la app abierta.
   ============================================================ */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    // Algunos servicios mandan texto plano en vez de JSON
    data = { title: 'Control de Engrase', body: event.data ? event.data.text() : '' };
  }

  // OneSignal y otros servicios anidan el contenido de formas distintas
  const titulo = data.title || data.headings?.en || data.notification?.title || 'Control de Engrase';
  const cuerpo = data.body || data.contents?.en || data.notification?.body || 'Tienes un aviso nuevo';
  const datos = data.data || data.custom?.a || {};

  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: cuerpo,
      icon: './icon-192.png',
      badge: './icon-96.png',
      tag: datos.type || 'engrase',   // agrupa avisos del mismo tipo en vez de apilarlos
      renotify: true,
      requireInteraction: datos.type === 'anomaly', // las anomalías se quedan hasta que las vean
      data: datos,
      vibrate: [200, 100, 200]
    })
  );
});

// Al tocar la notificación: si la app ya está abierta la trae al frente,
// y si no, la abre — en ambos casos llevando a la pantalla que corresponde.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const tipo = (event.notification.data && event.notification.data.type) || '';
  const destino = tipo === 'anomaly' ? './#ruta=anomalias' : './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const cliente of lista) {
        if ('focus' in cliente) {
          cliente.postMessage({ tipo: 'notificacion-abierta', destino: tipo });
          return cliente.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(destino);
    })
  );
});
