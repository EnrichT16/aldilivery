/* global self */
/*
 * Notifications, inside the service worker, so they arrive when no Aldilivery page is open.
 *
 * Loaded into the generated service worker by `workbox.importScripts` in vite.config.ts. The
 * server sends { title, body, url, tag }; see packages/api/src/lib/push.ts. A notification stays
 * until it is dealt with, because a Runner's question needs an answer, and pressing it opens the
 * page named in `url` — the Your order page — or brings an open one to the front.
 */

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = {};
  }
  const title = message.title || 'Aldilivery';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: message.body || 'Open Aldilivery to see what is new.',
      tag: message.tag,
      renotify: Boolean(message.tag),
      requireInteraction: true,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [300, 150, 300],
      lang: 'en-GB',
      data: { url: typeof message.url === 'string' && message.url.startsWith('/') ? message.url : '/my-order' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/my-order', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of open) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
