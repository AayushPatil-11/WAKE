const CACHE = 'waypoint-v2';
const SHELL = ['./index.html', './css/style.css', './js/app.js', './js/map.js', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Never intercept Google Maps API calls — always go to network.
  if (event.request.url.includes('maps.googleapis.com')) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
