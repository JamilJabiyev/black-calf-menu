// Versioned CSS/JS and fonts: cache-first. Page and menu.json: network-first with a timeout (new prices at once,
// cached menu offline). Bump: tools/bump_version.py. Emergency: KILL = true clears caches and unregisters.
const VERSION = '2026-11-24-r2';
const KILL = false;
const CACHE = `bc-${VERSION}`;
const NETWORK_TIMEOUT_MS = 2500;
const CORE = ['./', 'menu.json', `css/app.css?v=${VERSION}`, `js/main.js?v=${VERSION}`, `js/model.js?v=${VERSION}`, `js/views.js?v=${VERSION}`];
const FONTS = ['unbounded-800-caps-az', 'onest-400-700-az', 'unbounded-800-caps-ru', 'onest-400-ru', 'onest-700-ru'];
const NOT_CACHED = /\/(qr\.html|js\/qr\.js|css\/qr\.css|js\/vendor\/|assets\/)/; // internal QR tool

async function install() {
  const cache = await caches.open(CACHE);
  // no-cache: never freeze a 10-minute-old HTTP copy into a new version
  await cache.addAll(CORE.map((url) => new Request(url, { cache: 'no-cache' })));
  // only the font subsets this guest already downloaded
  await Promise.all(FONTS.map(async (name) => {
    const url = `fonts/${name}.woff2`;
    const hit = await fetch(url, { cache: 'only-if-cached', mode: 'same-origin' }).catch(() => null);
    if (hit && hit.ok) await cache.put(url, hit);
  }));
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  if (!KILL) event.waitUntil(install());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => KILL || key !== CACHE).map((key) => caches.delete(key)));
    if (KILL) await self.registration.unregister();
    else await self.clients.claim();
  })());
});

async function networkFirst(event, key) {
  const cache = await caches.open(CACHE);
  const network = fetch(event.request).then(async (response) => {
    if (response.ok) await cache.put(key, response.clone());
    return response;
  });
  event.waitUntil(network.catch(() => {}));
  const timeout = new Promise((resolve) => { setTimeout(resolve, NETWORK_TIMEOUT_MS); });
  const fresh = await Promise.race([network.catch(() => null), timeout]);
  return fresh || (await cache.match(key)) || network;
}

async function cacheFirst(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (response.ok) event.waitUntil(cache.put(event.request, response.clone()));
  return response;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (KILL || event.request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (NOT_CACHED.test(url.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length);
  // ?lang= / ?src= variants of the page share one cached copy
  if (path === '' || path === 'index.html') event.respondWith(networkFirst(event, scope.href));
  else if (path === 'menu.json') event.respondWith(networkFirst(event, `${scope.href}menu.json`));
  else event.respondWith(cacheFirst(event));
});
