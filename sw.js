// Service worker — caches all remote CDN assets on first fetch so subsequent
// loads work entirely offline (no internet needed after the first visit).

const CACHE_NAME = 'planetvoxel-v1';

// Only CDN URLs that need to be fetched remotely.
// Local files are served by python http.server and don't need SW caching.
const PRECACHE_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js',
];

// On install: pre-fetch and cache all CDN assets immediately.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// On activate: delete any old cache versions.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// On fetch: serve from cache if available, otherwise fetch from network and cache the result.
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Only intercept GET requests.
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(event.request);
      if (cached) return cached;

      // Not in cache yet — fetch from network, store, then return.
      const response = await fetch(event.request);
      if (response.ok) {
        cache.put(event.request, response.clone());
      }
      return response;
    })
  );
});
