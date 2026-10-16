// Service worker for the Kites and Threads workflow app.
// Makes the app open and work with no internet connection once it has been visited.
// The sync API (/api/) is never cached: sync data must always come from the server.

const CACHE = 'kites-workflow-v2';

// App shell, as relative URLs so the app also works from a subpath (for example a sync server).
const PRECACHE = [
  './',
  './index.html',
  './workflow.js',
  './invoice.js',
  './pwa.js',
  './logo-white.png',
  './logo-black.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './manifest.webmanifest',
];

const url = (rel) => new URL(rel, self.location).href;

self.addEventListener('install', (event) => {
  // One missing file (a 404 on a fresh server) must not break the whole install.
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(PRECACHE.map((rel) => cache.add(url(rel))))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let target;
  try {
    target = new URL(request.url);
  } catch (e) {
    return;
  }
  // Same origin only, and never cache the sync API.
  if (target.origin !== self.location.origin) return;
  if (target.pathname.startsWith('/api/')) return;

  // Opening the app: try the network, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(url('./index.html'), copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(url('./index.html'))
            .then((cached) => cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }))
        )
    );
    return;
  }

  // Other assets: serve from cache first, then refresh the copy in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
