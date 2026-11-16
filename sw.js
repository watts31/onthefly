// Minimal service worker so phones can install the app full-screen.
// It always goes to the network, so live data is never served stale.
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {});
