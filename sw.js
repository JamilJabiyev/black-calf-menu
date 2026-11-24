// Versioned CSS/JS and fonts: cache-first. Page and menu.json: network-first with a timeout (new prices at once,
// cached menu offline). Bump: tools/bump_version.py. Emergency: KILL = true clears caches and unregisters.
const VERSION = '2026-11-25-r10';
const KILL = false;
const CACHE = `bc-${VERSION}`;
const NETWORK_TIMEOUT_MS = 2500;
const CORE = ['./', 'menu.json', `css/app.css?v=${VERSION}`, `js/main.js?v=${VERSION}`, `js/model.js?v=${VERSION}`, `js/views.js?v=${VERSION}`];
const FONTS = ['unbounded-800-caps-az', 'onest-400-700-az', 'unbounded-800-caps-ru', 'onest-400-ru', 'onest-700-ru'];
const NOT_CACHED = /\/(qr\.html|js\/qr\.js|css\/qr\.css|js\/vendor\/|assets\/|app\.js$|styles\.css$)/; // QR tool, v1 bridge

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
    if (KILL) return self.registration.unregister();
    await self.registration.navigationPreload?.enable(); // page request starts while the worker boots
    await self.clients.claim();
  })());
});

let offlineUntil = 0; // after a failed page load, serve menu.json from cache at once (captive Wi-Fi)

/** Cached copy marked for the page ("offline · version of …"). */
async function cachedCopy(cache, key) {
  const hit = await cache.match(key);
  if (!hit) return null;
  const headers = new Headers(hit.headers);
  headers.set('x-bc-offline', '1');
  return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
}

async function networkFirst(event, key, isPage) {
  const cache = await caches.open(CACHE);
  if (!isPage && Date.now() < offlineUntil) return (await cachedCopy(cache, key)) || fetch(event.request);
  // no-cache: a cheap conditional request instead of the 10-minute HTTP copy; navigations use the preload
  const request = isPage ? new Request(event.request.url, { cache: 'no-cache', credentials: 'same-origin' })
    : new Request(event.request, { cache: 'no-cache' });
  const network = Promise.resolve(isPage && event.preloadResponse).then((pre) => pre || fetch(request)).then(async (response) => {
    if (response.ok) await cache.put(key, response.clone());
    return response;
  });
  event.waitUntil(network.catch(() => {}));
  const timeout = new Promise((resolve) => { setTimeout(resolve, NETWORK_TIMEOUT_MS); });
  const fresh = await Promise.race([network.then((r) => (r.ok ? r : null), () => null), timeout]);
  if (fresh) return fresh;
  if (isPage) offlineUntil = Date.now() + 10000;
  return (await cachedCopy(cache, key)) || network; // 404/5xx or timeout: the good cached copy wins
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
  // ?lang= / ?src= / ?v= variants share one cached copy
  if (path === '' || path === 'index.html') event.respondWith(networkFirst(event, scope.href, true));
  else if (path === 'menu.json') event.respondWith(networkFirst(event, `${scope.href}menu.json`, false));
  else event.respondWith(cacheFirst(event));
});
