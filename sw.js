const CACHE = 'eclair-v1';
const SHARED = 'eclair-shared';   // livres reçus par le partage (Android), en attente d'import par la page
const SHELL = [
  './', 'index.html', 'css/app.css', 'js/app.js', 'vendor/jszip.min.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARED).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Partage vers l'app : le système envoie les fichiers en POST sur share-target (voir le manifeste).
// On les met de côté, puis on ouvre l'app, qui les importe au démarrage.
async function receiveShare(req) {
  try {
    const form = await req.formData();
    const cache = await caches.open(SHARED);
    const files = form.getAll('books').filter((f) => typeof f !== 'string' && f.size);
    await Promise.all(files.map((f, i) => cache.put(`shared/${Date.now()}-${i}`, new Response(f, {
      headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Name': encodeURIComponent(f.name) },
    }))));
  } catch (err) {
    console.error(err);
  }
  return Response.redirect('./?partage', 303);
}

// Stale-while-revalidate pour les fichiers de l'application
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) { e.respondWith(receiveShare(req)); return; }
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })
  );
});
