const CACHE = 'engrase-openpit-v3';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './db.js', './sync.js', './manifest.json',
  './favicon.png', './apple-touch-icon.png',
  './icon-72.png', './icon-96.png', './icon-128.png', './icon-144.png', './icon-152.png',
  './icon-192.png', './icon-384.png', './icon-512.png',
  './icon-maskable-192.png', './icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
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
  // Solo controlamos archivos propios de la app (mismo origen). Cualquier petición
  // hacia otro dominio (Supabase, CDNs, etc.) se deja pasar sin interceptar, para
  // no interferir con la sincronización ni con peticiones cross-origin en móvil.
  if (new URL(e.request.url).origin !== self.location.origin) return;

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
