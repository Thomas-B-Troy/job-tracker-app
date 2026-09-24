// Caches the app shell so it opens offline. Tracker data is never cached here:
// GitHub API calls go straight to the network (the app keeps its own copy on device).
const CACHE = "jt-shell-v6";
const SHELL = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest", "icon.svg",
  "vendor/js-yaml.min.js", "vendor/marked.min.js", "vendor/purify.min.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/sample/")) return;
  // Network first, skipping the browser's HTTP cache (GitHub Pages allows 10 minutes), so updates
  // show up straight away; fall back to the cached shell when offline.
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))));
});
