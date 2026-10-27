// Envía como push del navegador/celular cada registro nuevo de hd_notifications,
// venga de la app o del propio watcher (SLA, recordatorios, cierres).
// Cola: notificaciones con push_sent_at vacío y creadas hace poco.
import { PushError, sendPush } from './webpush.js';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:soporte@martcom.mx';
const MAX_AGE_MINUTES = Math.max(1, Number(process.env.PUSH_MAX_AGE_MINUTES || 30));
const BATCH_SIZE = 100;
const URGENT_TYPES = new Set(['sla_breached', 'sla_warning']);

export const PUSH_INTERVAL_MS = Math.max(2000, Number(process.env.PUSH_INTERVAL_MS || 5000));

export function pushConfigured() {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

const VAPID = { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY };

// PocketBase guarda fechas como "2026-10-27 16:00:00.000Z".
function pbDate(date) {
  return date.toISOString().replace('T', ' ');
}

function payloadFor(notification) {
  return JSON.stringify({
    title: notification.title || 'MARTCOM Soporte IT',
    body: notification.message || '',
    type: notification.type || '',
    url: notification.ticket ? `/tickets/${notification.ticket}` : '/',
    // Varias notificaciones del mismo ticket se agrupan en una sola en el sistema.
    tag: notification.ticket ? `ticket-${notification.ticket}` : notification.id,
    notificationId: notification.id,
    timestamp: String(notification.created || '').replace(' ', 'T'),
  });
}

export function createPushDispatcher(pb) {
  async function subscriptionsFor(userId) {
    const params = new URLSearchParams({ page: '1', perPage: '50', filter: `user = "${userId}"` });
    const data = await pb(`/api/collections/hd_push_subscriptions/records?${params}`);
    return data.items;
  }

  async function deleteSubscription(id) {
    await pb(`/api/collections/hd_push_subscriptions/records/${id}`, { method: 'DELETE' }).catch(() => {});
  }

  async function sendTo(subscription, notification) {
    try {
      await sendPush(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        payloadFor(notification),
        { vapid: VAPID, ttl: 24 * 3600, urgency: URGENT_TYPES.has(notification.type) ? 'high' : 'normal' },
      );
      return true;
    } catch (err) {
      // 404/410: el dispositivo ya no existe o el usuario revocó el permiso.
      if (err instanceof PushError && (err.statusCode === 404 || err.statusCode === 410)) {
        await deleteSubscription(subscription.id);
        subscription.dead = true;
        console.log(`[PUSH] Suscripción eliminada (${err.statusCode}) ${subscription.device || subscription.id}`);
      } else {
        console.warn(`[PUSH] Error enviando a ${subscription.device || subscription.id}:`, err?.statusCode || '', err?.body || err?.message || err);
      }
      return false;
    }
  }

  async function processQueue() {
    const cutoff = pbDate(new Date(Date.now() - MAX_AGE_MINUTES * 60000));
    const params = new URLSearchParams({
      page: '1',
      perPage: String(BATCH_SIZE),
      filter: `push_sent_at = "" && created >= "${cutoff}"`,
      sort: 'created',
    });
    const data = await pb(`/api/collections/hd_notifications/records?${params}`);
    if (!data.items.length) return;

    const cache = new Map();
    for (const notification of data.items) {
      if (!cache.has(notification.recipient)) cache.set(notification.recipient, await subscriptionsFor(notification.recipient));
      const subscriptions = cache.get(notification.recipient);
      const alive = subscriptions.filter((sub) => !sub.dead);
      const results = await Promise.all(alive.map((sub) => sendTo(sub, notification)));
      // Se marca aunque no haya dispositivos para no reprocesarla en cada ciclo.
      await pb(`/api/collections/hd_notifications/records/${notification.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ push_sent_at: new Date().toISOString() }),
      });
      const sent = results.filter(Boolean).length;
      if (sent) console.log(`[PUSH] ${notification.type || 'notificación'} → ${sent} dispositivo(s): ${notification.title}`);
    }
  }

  let running = false;
  return async function pushCycle() {
    if (running) return;
    running = true;
    try {
      await processQueue();
    } catch (err) {
      console.error('[PUSH] Error:', err?.message || err);
    } finally {
      running = false;
    }
  };
}
