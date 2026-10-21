/**
 * SJVN Integrated Energy Commercial & Trading Platform — Service Worker
 * Progressive Web App (PWA) Offline Fallback & Cache Management
 * Compliant with GIGW 3.0 Resilience & Disaster Management Standards
 */

const CACHE_NAME = 'sjvn-pwa-v2';
const OFFLINE_URL = '/offline.html';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  OFFLINE_URL,
  '/manifest.json',
  '/sjvn-logo.png',
  '/prefs-boot.js',
  '/images/sjvn-hero-panoramic.avif',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/favicon-32.png',
];

// Install: Pre-cache static shell & offline fallback
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SJVN-SW] Pre-caching asset failed:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up outdated caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SJVN-SW] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Strategy depending on request type
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Bypass non-GET requests immediately
  if (request.method !== 'GET') {
    return;
  }

  // Video is fetched with Range requests (206 partial content), which a cache
  // cannot answer; leave media to the browser.
  if (request.headers.has('range') || request.destination === 'video' || request.destination === 'audio') {
    return;
  }

  // API Requests Handling
  if (url.pathname.startsWith('/api/')) {
    // Only cache public static site information; never cache authenticated trading/billing APIs
    if (url.pathname === '/api/public/site-info') {
      event.respondWith(
        fetch(request)
          .then((networkRes) => {
            if (networkRes.status === 200) {
              const resClone = networkRes.clone();
              caches.open(CACHE_NAME).then((c) => c.put(request, resClone));
            }
            return networkRes;
          })
          .catch(() => caches.match(request))
      );
    }
    return;
  }

  // Navigation (HTML Pages) — Network first, then cache, fallback to offline.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkRes) => {
          if (networkRes.status === 200) {
            const resClone = networkRes.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, resClone));
          }
          return networkRes;
        })
        .catch(async () => {
          const cachedRes = await caches.match(request);
          if (cachedRes) {
            return cachedRes;
          }
          const offlinePage = await caches.match(OFFLINE_URL);
          return offlinePage || new Response('Offline — Connection unavailable', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' },
          });
        })
    );
    return;
  }

  // Hashed build output and images never change under the same URL: cache first.
  // Everything else (prefs-boot.js, manifest.json, the logo) can change on a
  // deploy under the same URL, so it goes to the network first and the cache is
  // only the offline fallback.
  const immutable = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/images/') || url.pathname.startsWith('/icons/');
  const store = (res) => {
    if (res && res.status === 200 && url.origin === self.location.origin) {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(request, copy));
    }
    return res;
  };
  if (immutable) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then(store)));
  } else {
    event.respondWith(fetch(request).then(store).catch(() => caches.match(request)));
  }
});
