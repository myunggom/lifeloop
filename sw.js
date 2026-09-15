// 앱 셸 캐시. 데이터는 localStorage에 있으므로 여기서 다룰 것이 없다.
// 비행기 모드에서도 앱이 열리게 하는 것이 전부다.

const CACHE = 'lifeloop-v1';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './js/app.js',
  './js/store.js',
  './js/ui.js',
  './js/exam.js',
  './js/share.js',
  './js/views/today.js',
  './js/views/goals.js',
  './js/views/notes.js',
  './js/views/review.js',
  './js/views/weekly.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) {
        // 캐시로 즉시 응답하되, 뒤에서 조용히 갱신한다.
        fetch(request).then((res) => res.ok && caches.open(CACHE).then((c) => c.put(request, res))).catch(() => {});
        return hit;
      }
      return fetch(request).catch(() => caches.match('./index.html'));
    })
  );
});
