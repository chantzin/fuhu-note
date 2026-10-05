/* EVERNOT 筆記 — Service Worker
 * 離線支援：快取應用外殼與 Firebase SDK，斷網仍可開啟與編輯。
 * 部署時請以 HTTPS 或 localhost 提供服務（Service Worker 的要求）。
 */
const CACHE_NAME = 'evernot-v1';
const PRECACHE = [
  './',
  './index.html',
  './css/app.css',
  './js/config.js',
  './js/db.js',
  './js/sync.js',
  './js/ui.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 外部資源（Firebase SDK CDN）：快取優先、網路備援
  if (url.origin !== self.location.origin) {
    e.respondWith(
      caches.match(req).then((hit) =>
        hit || fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        }).catch(() => caches.match(req))
      )
    );
    return;
  }

  // 頁面導航：網路優先，離線時回退到應用外殼
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 同源靜態資源：快取優先
  e.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        return res;
      })
    )
  );
});
