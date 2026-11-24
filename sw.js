// Service worker: instant repeat visits and offline menu on GitHub Pages (max-age=600, no custom headers).
// Static files: cache-first. index.html and menu.json: stale-while-revalidate (fresh copy shows on next open).
// Bump VERSION on every release. Emergency: set KILL = true and deploy — it clears caches and unregisters.
const VERSION = 'bc-2026-11-24-v2';
const KILL = false;
const CORE = ['./', 'css/app.css', 'js/main.js', 'js/model.js', 'js/views.js', 'menu.json'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  if (!KILL) event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(CORE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => KILL || key !== VERSION).map((key) => caches.delete(key)));
    if (KILL) await self.registration.unregister();
    else await self.clients.claim();
  })());
});

const isFresh = (url) => url.pathname.endsWith('/') || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/menu.json');

async function staleWhileRevalidate(request, key, event) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(key);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(key, response.clone());
    return response;
  });
  if (!cached) return network;
  event.waitUntil(network.catch(() => {}));
  return cached;
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone()); // fonts land here: only the subset this guest uses
  return response;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (KILL || event.request.method !== 'GET' || url.origin !== location.origin) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname) || url.pathname.endsWith('/qr.html')) return;
  // ?lang= / ?src= variants of the page share one cached copy
  const key = url.pathname.endsWith('/menu.json') ? scope.href + 'menu.json' : scope.href;
  if (isFresh(url)) event.respondWith(staleWhileRevalidate(event.request, key, event));
  else event.respondWith(cacheFirst(event.request));
});
