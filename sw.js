// Offline app shell. Data lives in IndexedDB, never in this cache.
const CACHE = 'northstar-v33';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'md.js', 'pdf.js', 'ai.js', 'vendor/anthropic.mjs', 'vendor/jspdf.umd.min.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // API calls go straight to the network
  // network first so updates arrive (no-cache: always check with the server, never a stale browser copy), cache as fallback for offline use
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
