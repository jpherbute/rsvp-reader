// Service worker d'Éclair : l'app fonctionne hors ligne et chaque mise à jour arrive d'un bloc.
// Les fichiers de l'app sont servis depuis le cache complet le plus récent. À chaque lancement,
// on vérifie en arrière-plan si le site a changé ; si oui, on télécharge le nouveau jeu complet
// dans un nouveau cache, puis on prévient la page (« Nouvelle version disponible »).
const SHELL = [
  './', 'index.html', 'css/app.css', 'js/app.js', 'vendor/jszip.min.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];
const PREFIX = 'eclair-shell-';      // + horodatage : le plus récent l'emporte
const DONE = '__complet__';          // entrée posée en dernier : le cache est complet
const SHARED = 'eclair-shared';      // livres reçus par le partage (Android), en attente d'import par la page

async function current() {
  const names = (await caches.keys()).filter((k) => k.startsWith(PREFIX)).sort().reverse();
  for (const name of names) {
    const c = await caches.open(name);
    if (await c.match(DONE)) return c;
  }
  return null;
}

function same(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a), y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

// Télécharge tous les fichiers de l'app ; s'ils diffèrent du cache courant, les enregistre
// dans un nouveau cache complet. Renvoie true si une nouvelle version remplace une ancienne.
// Au plus une vérification toutes les 10 s (lancement = navigation + retour sur l'app), sauf s'il n'y a
// pas encore de cache complet. Une vérification demandée pendant une autre attend sa fin puis repart si
// besoin (par exemple si la page a vidé le cache entre-temps pour se réparer).
let checking = null, lastCheck = 0;
function refresh(force) {
  if (checking) return checking.then(() => refresh(force), () => refresh(force));
  checking = (async () => {
    const cur = await current();
    if (cur && !force && Date.now() - lastCheck < 10000) return false;
    lastCheck = Date.now();
    const res = await Promise.all(SHELL.map((u) => fetch(u, { cache: 'no-cache' })));
    if (!res.every((r) => r.ok)) return false;
    const fresh = await Promise.all(res.map((r) => r.clone().arrayBuffer()));
    if (cur) {
      const old = await Promise.all(SHELL.map(async (u) => { const r = await cur.match(u); return r && r.arrayBuffer(); }));
      if (old.every((b, i) => b && same(b, fresh[i]))) return false;
    }
    const name = PREFIX + Date.now();
    const c = await caches.open(name);
    await Promise.all(SHELL.map((u, i) => c.put(u, res[i])));
    await c.put(DONE, new Response('1'));
    const stale = (await caches.keys()).filter((k) => k.startsWith('eclair-') && k !== name && k !== SHARED);
    await Promise.all(stale.map((k) => caches.delete(k)));
    return !!cur;
  })().finally(() => { checking = null; });
  return checking;
}

async function announce() {
  for (const client of await self.clients.matchAll({ type: 'window' })) client.postMessage({ type: 'update-ready' });
}
const check = () => refresh(false).then((updated) => updated && announce()).catch(() => {});

let installedUpdate = false;
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    installedUpdate = await refresh(true);
    if (!(await current())) throw new Error('Fichiers de l’app incomplets');
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // caches des versions précédentes de ce service worker (ex. « eclair-v1 »)
    const legacy = (await caches.keys()).filter((k) => k.startsWith('eclair-') && !k.startsWith(PREFIX) && k !== SHARED);
    await Promise.all(legacy.map((k) => caches.delete(k)));
    await self.clients.claim();
    if (installedUpdate) await announce();
  })());
});

// La page demande une vérification quand on revient sur l'app laissée ouverte
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'check') e.waitUntil(check());
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

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) { e.respondWith(receiveShare(req)); return; }
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') e.waitUntil(check());
  e.respondWith((async () => {
    const cur = await current();
    const hit = cur && await cur.match(req, { ignoreSearch: true });
    return hit || fetch(req);
  })());
});
