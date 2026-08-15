/*
 * Keep the service worker deliberately non-caching.
 * Household data is private and must continue to use the authenticated API.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
