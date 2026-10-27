// Prepara todo lo que necesitan las notificaciones push, sin pasos manuales:
// - crea en PocketBase las colecciones/campos que falten
// - genera las llaves VAPID la primera vez y las guarda en PocketBase
//   (la pública la lee la app; la privada es un campo oculto, solo superusuarios)
// Si existen las variables VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, se usan esas.
import { generateVapidKeys } from './webpush.js';

const SUBSCRIPTIONS = 'hd_push_subscriptions';
const CONFIG = 'hd_push_config';

async function getCollection(pb, name) {
  try {
    return await pb(`/api/collections/${name}`);
  } catch (err) {
    if (/ 404:/.test(err.message)) return null;
    throw err;
  }
}

const autodateFields = [
  { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
  { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
];

async function ensureSubscriptions(pb) {
  if (await getCollection(pb, SUBSCRIPTIONS)) return;
  const users = await pb('/api/collections/hd_users');
  await pb('/api/collections', {
    method: 'POST',
    body: JSON.stringify({
      type: 'base',
      name: SUBSCRIPTIONS,
      listRule: '@request.auth.id != "" && user = @request.auth.id',
      viewRule: '@request.auth.id != "" && user = @request.auth.id',
      createRule: '@request.auth.id != "" && @request.body.user = @request.auth.id',
      updateRule: '@request.auth.id != "" && user = @request.auth.id && (@request.body.user:isset = false || @request.body.user = @request.auth.id)',
      deleteRule: '@request.auth.id != "" && user = @request.auth.id',
      fields: [
        { type: 'relation', name: 'user', required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
        { type: 'text', name: 'endpoint', required: true, max: 1000 },
        { type: 'text', name: 'p256dh', required: true, max: 200 },
        { type: 'text', name: 'auth', required: true, max: 100 },
        { type: 'text', name: 'device', max: 120 },
        ...autodateFields,
      ],
      indexes: [`CREATE UNIQUE INDEX idx_hd_push_user_endpoint ON ${SUBSCRIPTIONS} (user, endpoint)`],
    }),
  });
  console.log(`[PUSH] Colección ${SUBSCRIPTIONS} creada.`);
}

async function ensureConfig(pb) {
  if (await getCollection(pb, CONFIG)) return;
  await pb('/api/collections', {
    method: 'POST',
    body: JSON.stringify({
      type: 'base',
      name: CONFIG,
      // Cualquier usuario con sesión puede leer la llave pública; nadie más que
      // un superusuario puede crear/editar, y private_key es un campo oculto.
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'text', name: 'public_key', required: true, max: 200 },
        { type: 'text', name: 'private_key', required: true, max: 200, hidden: true },
        ...autodateFields,
      ],
    }),
  });
  console.log(`[PUSH] Colección ${CONFIG} creada.`);
}

async function ensureNotificationField(pb) {
  const notifications = await pb('/api/collections/hd_notifications');
  if (notifications.fields.some((field) => field.name === 'push_sent_at')) return;
  await pb(`/api/collections/${notifications.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: [...notifications.fields, { type: 'date', name: 'push_sent_at' }] }),
  });
  console.log('[PUSH] Campo push_sent_at agregado a hd_notifications.');
}

async function loadKeys(pb) {
  const envPublic = process.env.VAPID_PUBLIC_KEY || '';
  const envPrivate = process.env.VAPID_PRIVATE_KEY || '';
  const data = await pb(`/api/collections/${CONFIG}/records?page=1&perPage=1&sort=created`);
  const stored = data.items[0];

  if (envPublic && envPrivate) {
    if (!stored) {
      await pb(`/api/collections/${CONFIG}/records`, { method: 'POST', body: JSON.stringify({ public_key: envPublic, private_key: envPrivate }) });
    } else if (stored.public_key !== envPublic || stored.private_key !== envPrivate) {
      await pb(`/api/collections/${CONFIG}/records/${stored.id}`, { method: 'PATCH', body: JSON.stringify({ public_key: envPublic, private_key: envPrivate }) });
    }
    return { publicKey: envPublic, privateKey: envPrivate };
  }

  if (stored?.public_key && stored?.private_key) return { publicKey: stored.public_key, privateKey: stored.private_key };

  const keys = generateVapidKeys();
  await pb(`/api/collections/${CONFIG}/records`, { method: 'POST', body: JSON.stringify({ public_key: keys.publicKey, private_key: keys.privateKey }) });
  console.log('[PUSH] Llaves VAPID generadas y guardadas en PocketBase.');
  return keys;
}

export async function setupPush(pb) {
  await ensureSubscriptions(pb);
  await ensureConfig(pb);
  await ensureNotificationField(pb);
  return loadKeys(pb);
}
