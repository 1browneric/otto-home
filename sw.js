/* Otto Home service worker. Caches the shell only; never data.
   Shell: stale-while-revalidate, so the app opens offline and updates on the next open.
   Anything else (sample-snapshot.json, the /exec URL on another origin) goes to the network untouched. */
var CACHE = "otto-home-shell-v2";
var SHELL = [
  "./", "index.html", "app.js", "styles.css", "manifest.webmanifest",
  "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"
];
var SHELL_URLS = SHELL.map(function (p) { return new URL(p, self.registration.scope).href; });

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("otto-home-shell-") === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var bare = url.origin + url.pathname;
  var isNav = req.mode === "navigate" && /\/(index\.html)?$/.test(url.pathname);
  if (!isNav && SHELL_URLS.indexOf(bare) < 0) return;
  var key = isNav ? new URL("index.html", self.registration.scope).href : bare;
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(key).then(function (hit) {
      var net = fetch(isNav ? key : req).then(function (res) {
        if (res && res.ok) c.put(key, res.clone());
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    });
  }));
});
