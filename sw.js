const CACHE = 'engrase-openpit-v6';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './db.js', './sync.js', './manifest.json',
  './favicon.png', './apple-touch-icon.png',
  './icon-72.png', './icon-96.png', './icon-128.png', './icon-144.png', './icon-152.png',
  './icon-192.png', './icon-384.png', './icon-512.png',
  './icon-maskable-192.png', './icon-maskable-512.png'
];

// Librerías externas (gráficas, Excel, PDF) que también queremos disponibles sin internet
// después del primer uso. Se cachean por separado y con manejo de error individual, para
// que si una falla (ej. sin internet en la instalación) no tumbe la instalación completa.
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js'
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
  const isKnownCdn = reqUrl.origin === 'https://cdnjs.cloudflare.com';

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
