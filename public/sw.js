const CACHE_NAME = "popzilla-app-v2";

self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Always let API requests go directly to the server.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Let POST, PUT, PATCH and DELETE requests go directly to the server.
  if (event.request.method !== "GET") {
    return;
  }

  // Let normal page and asset requests go directly to the server.
  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request))
  );
});
