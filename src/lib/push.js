import { currentUser, pb } from './pocketbase';

// Notificaciones push del navegador / celular. Funcionan con la pestaña
// cerrada: el service worker (public/sw.js) las recibe y las muestra.
// El envío lo hace services/sla-watcher, que también crea las llaves VAPID y
// guarda la pública en la colección hd_push_config.

const COLLECTION = 'hd_push_subscriptions';
let vapidKeyPromise = null;

async function getVapidPublicKey() {
  const fromEnv = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';
  if (fromEnv) return fromEnv;
  if (!vapidKeyPromise) {
    vapidKeyPromise = pb.collection('hd_push_config')
      .getList(1, 1, { sort: 'created' })
      .then((res) => res.items[0]?.public_key || '')
      .catch(() => '');
  }
  const key = await vapidKeyPromise;
  if (!key) vapidKeyPromise = null; // reintenta la próxima vez
  return key;
}

export function isIos() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function pushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

// Estados posibles:
//  unconfigured  el servicio sla-watcher aún no ha preparado las llaves
//  ios-install   iPhone/iPad: hay que agregar la app a la pantalla de inicio
//  unsupported   el navegador no soporta push
//  denied        la persona bloqueó las notificaciones del sitio
//  enabled       este dispositivo ya está suscrito
//  available     se puede activar
export async function getPushState() {
  if (isIos() && !isStandalone()) return 'ios-install';
  if (!pushSupported()) return 'unsupported';
  if (!(await getVapidPublicKey())) return 'unconfigured';
  if (Notification.permission === 'denied') return 'denied';
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription && Notification.permission === 'granted') return 'enabled';
  return 'available';
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (err) {
    console.warn('No fue posible registrar el service worker:', err);
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /android/i.test(ua) ? 'Android' : isIos() ? 'iOS' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'macOS' : /linux/i.test(ua) ? 'Linux' : 'Otro';
  const browser = /edg\//i.test(ua) ? 'Edge' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Navegador';
  return `${browser} · ${os}`;
}

async function saveSubscription(subscription) {
  const user = currentUser();
  if (!user) return;
  const json = subscription.toJSON();
  const data = {
    user: user.id,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh || '',
    auth: json.keys?.auth || '',
    device: deviceLabel(),
  };
  const existing = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter('user = {:user} && endpoint = {:endpoint}', { user: user.id, endpoint: json.endpoint }),
  });
  if (existing.items[0]) {
    await pb.collection(COLLECTION).update(existing.items[0].id, { p256dh: data.p256dh, auth: data.auth, device: data.device });
  } else {
    await pb.collection(COLLECTION).create(data);
  }
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Este navegador no soporta notificaciones push.');
  const vapidPublicKey = await getVapidPublicKey();
  if (!vapidPublicKey) throw new Error('Las notificaciones del dispositivo aún no están listas en el servidor.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('No se otorgó permiso para mostrar notificaciones.');

  const registration = (await registerServiceWorker()) || (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }
  await saveSubscription(subscription);
  return subscription;
}

// Al abrir la app con permiso ya concedido, refresca la suscripción guardada
// (el navegador puede rotarla) sin volver a pedir permiso.
export async function syncPushSubscription() {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const registration = await registerServiceWorker();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await saveSubscription(subscription).catch((err) => console.warn('No fue posible sincronizar push:', err));
}

// Se llama al cerrar sesión: este dispositivo deja de recibir push de esa cuenta.
// Recibe el token porque la sesión se limpia antes de que termine la petición.
export async function removePushSubscription({ token, userId } = {}) {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => {});
  if (!token || !userId) return;
  const headers = { Authorization: token };
  const existing = await pb.collection(COLLECTION).getList(1, 50, {
    filter: pb.filter('user = {:user} && endpoint = {:endpoint}', { user: userId, endpoint }),
    headers,
  });
  await Promise.allSettled(existing.items.map((item) => pb.collection(COLLECTION).delete(item.id, { headers })));
}
