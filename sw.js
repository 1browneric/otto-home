/* Otto Home service worker. Caches the shell only; never data.
   Shell: network first (a new deploy shows on the next open), the cache only when offline.
   Anything else (sample-snapshot.json, the /exec URL on another origin) goes to the network untouched. */
var CACHE = "otto-home-shell-v17";
// Exactly the deployed files (scripts/deploy_otto_home.sh SHELL_FILES) but sw.js, plus "./".
var SHELL = [
  "./", "index.html", "app.js", "styles.css", "manifest.webmanifest",
  "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png",
  "themes/list.js", "themes/v3.css", "themes/v3.js", "themes/network.css", "themes/network.js",
  "themes/ask.css", "themes/ask.js"
];
var SHELL_URLS = SHELL.map(function (p) { return new URL(p, self.registration.scope).href; });

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: "no-cache" }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("otto-home-shell-") === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Network first for the page and every code/style file, so a new deploy shows on the next
// open (a cache-first shell kept an old look on the phone after a deploy). "no-cache" skips
// the HTTP cache too. Offline: the cached copy. Icons: cache first (they never change).
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var bare = url.origin + url.pathname;
  var isNav = req.mode === "navigate" && /\/(index\.html)?$/.test(url.pathname);
  if (!isNav && SHELL_URLS.indexOf(bare) < 0) return;
  var key = isNav ? new URL("index.html", self.registration.scope).href : bare;
  if (/\/icons\//.test(url.pathname)) {
    e.respondWith(caches.open(CACHE).then(function (c) {
      return c.match(key).then(function (hit) {
        return hit || fetch(req).then(function (res) { if (res && res.ok) c.put(key, res.clone()); return res; });
      });
    }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(function (c) {
    return fetch(new Request(key, { cache: "no-cache" })).then(function (res) {
      if (res && res.ok) { c.put(key, res.clone()); return res; }
      return c.match(key).then(function (hit) { return hit || res; });
    }).catch(function () {
      return c.match(key).then(function (hit) { return hit || Response.error(); });
    });
  }));
});
