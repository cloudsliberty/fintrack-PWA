// FinTrack PWA — service-worker.js
//
// Caches ONLY the static app shell (HTML/CSS/JS/icons) so the app can load offline. Deliberately
// does NOT intercept or cache any request to a Nextcloud server (/index.php/...) — financial data
// must only ever be persisted encrypted, via IndexedDB (see db.js/crypto.js), never as plaintext
// responses in the browser's (unencrypted) Cache Storage.

const CACHE_NAME = 'fintrack-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/crypto.js',
  './js/db.js',
  './js/pin.js',
  './js/api.js',
  './js/app.js',
  './js/sections.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never touch cross-origin requests (the Nextcloud API) or any Nextcloud-shaped path even if
  // it somehow shares an origin with this PWA — those must always hit the network live.
  if (url.origin !== self.location.origin || url.pathname.includes('/index.php/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
