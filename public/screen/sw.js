/**
 * Service Worker – Media Cache für den Infoscreen
 *
 * Strategie: Cache-First für /uploads/*
 *   Beim ersten Aufruf wird die Datei vom Server geladen und im Cache gespeichert.
 *   Alle weiteren Aufrufe (auch nach Browser-Neustart) werden direkt aus dem lokalen
 *   Cache bedient – kein Netzwerk notwendig.
 *
 * Cache-Verwaltung:
 *   Beim Aktivieren des SW werden alle alten Cache-Versionen gelöscht.
 *   Um den Cache zu leeren (z. B. nach Medien-Austausch), die Version in CACHE_NAME erhöhen.
 */

const CACHE_NAME = 'infoscreen-media-v1';

self.addEventListener('install', () => {
  // Sofort aktivieren, ohne auf das Schließen alter Tabs zu warten
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Alte Cache-Versionen aufräumen
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Nur GET-Anfragen cachen
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Nur /uploads/* von der eigenen Origin abfangen
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/uploads/')) return;

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cached) => {
        if (cached) {
          return cached;
        }

        // Nicht im Cache → vom Server laden und dabei cachen
        return fetch(request).then((response) => {
          // Nur erfolgreiche, vollständige Antworten cachen (kein Range-Response 206)
          if (response.ok && response.status === 200) {
            cache.put(request, response.clone());
          }
          return response;
        });
      }),
    ),
  );
});
