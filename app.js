/* v1 -> v2 bridge: only the cached v1 page loads this file. Refresh page + menu.json, then open the new page once. */
(function () {
  var marker = 'bc-bridge=1';
  if (location.search.indexOf(marker) > -1) return; // already tried once: never loop
  var target = location.pathname + (location.search ? location.search + '&' : '?') + marker + location.hash;
  var go = function () { location.replace(target); };
  if (!window.fetch) return go();
  Promise.all([
    fetch(location.pathname + location.search, { cache: 'reload', credentials: 'same-origin' }),
    fetch('menu.json', { cache: 'reload' })
  ]).then(go, go);
})();
