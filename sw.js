const CACHE_NAME = "biblioteca-studio-v1.0.2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=1.0.2",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./app.js?v=1.0.2",
  "./config.js",
  "./utils.js",
  "./isbn.js",
  "./model.js",
  "./db.js",
  "./catalogs.js",
  "./backup.js",
  "./excel.js",
  "./scanner.js",
  "./ocr.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    return (await caches.match(request)) || (await caches.match("./index.html"));
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  if (url.origin === self.location.origin) {
    if (event.request.mode === "navigate" || ["script", "style"].includes(event.request.destination)) {
      event.respondWith(networkFirst(event.request));
      return;
    }
    event.respondWith(
      caches.match(event.request).then((cached) => cached || networkFirst(event.request))
    );
    return;
  }

  if (/unpkg\.com|cdn\.jsdelivr\.net|cdn\.sheetjs\.com/.test(url.hostname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
        if (response.ok || response.type === "opaque") {
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
        }
        return response;
      }))
    );
  }
});
