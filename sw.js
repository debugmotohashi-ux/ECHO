// ECHO Service Worker
// Strategy:
//  - Navigations (the app itself): network-first, so updates arrive immediately when online;
//    falls back to the cached shell when offline.
//  - Same-origin static assets (icons, manifest): cache-first.
//  - cdn.jsdelivr.net (transformers.js / supabase-js): cache-first with background refresh,
//    so the app can boot offline. Model files (HuggingFace) are cached by transformers.js itself.
//  - Everything else (Supabase API, HuggingFace, ChatGPT): straight to network, never cached.

const CACHE = 'echo-shell-v1';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1) App shell navigations: network-first, offline fallback to cached shell
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match('./index.html', { ignoreSearch: true })
            .then((r) => r || caches.match('./', { ignoreSearch: true }))
        )
    );
    return;
  }

  // 2) Same-origin static assets: cache-first
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          })
      )
    );
    return;
  }

  // 3) Pinned CDN libraries: cache-first with background refresh
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(
      caches.match(req).then((hit) => {
        const network = fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          })
          .catch(() => hit);
        return hit || network;
      })
    );
    return;
  }

  // 4) Everything else: pass through untouched (Supabase, HuggingFace, ChatGPT)
});
