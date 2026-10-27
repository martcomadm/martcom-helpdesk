/* Service worker de MARTCOM Helpdesk: recibe notificaciones push aunque la
   pestaña esté cerrada y abre el ticket al tocarlas. No cachea la app. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'MARTCOM Soporte IT';
  const urgent = data.type === 'sla_breached' || data.type === 'sla_warning';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    requireInteraction: urgent,
    vibrate: urgent ? [200, 100, 200, 100, 300] : [150, 80, 150],
    timestamp: data.timestamp ? new Date(data.timestamp).getTime() : Date.now(),
    data: { url: data.url || '/', notificationId: data.notificationId || '' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const sameOrigin = windows.filter((client) => new URL(client.url).origin === self.location.origin);
    const target = sameOrigin.find((client) => client.focused) || sameOrigin[0];
    if (target) {
      await target.focus();
      target.postMessage({ type: 'navigate', url: new URL(url).pathname });
      return;
    }
    await self.clients.openWindow(url);
  })());
});

// El navegador puede rotar la suscripción; la app la vuelve a guardar al abrirse
// (syncPushSubscription), así que aquí solo se intenta re-suscribir.
self.addEventListener('pushsubscriptionchange', (event) => {
  const options = event.oldSubscription?.options;
  if (!options) return;
  event.waitUntil(self.registration.pushManager.subscribe(options).catch(() => {}));
});
