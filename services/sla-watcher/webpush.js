// Web Push sin dependencias: cifrado aes128gcm (RFC 8291 / RFC 8188) y
// autenticación VAPID (RFC 8292) usando solo node:crypto.
import crypto from 'node:crypto';

export function b64url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(value) {
  return Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function generateVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

function vapidPrivateKeyObject(publicKey, privateKey) {
  const pub = fromB64url(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY inválida (se esperan 65 bytes sin comprimir).');
  return crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) },
    format: 'jwk',
  });
}

export function createVapidHeader({ endpoint, subject, publicKey, privateKey, expiresInSeconds = 12 * 3600 }) {
  const audience = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + expiresInSeconds, sub: subject }));
  const unsigned = `${header}.${claims}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), {
    key: vapidPrivateKeyObject(publicKey, privateKey),
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${unsigned}.${b64url(signature)}, k=${publicKey}`;
}

function hkdf(salt, ikm, info, length) {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, length));
}

export function encryptPayload({ p256dh, auth }, payload) {
  const uaPublic = fromB64url(p256dh);
  const authSecret = fromB64url(auth);
  if (uaPublic.length !== 65) throw new Error('p256dh inválido');
  if (authSecret.length < 16) throw new Error('auth inválido');

  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const sharedSecret = ecdh.computeSecret(uaPublic);
  const salt = crypto.randomBytes(16);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, sharedSecret, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  const plaintext = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return Buffer.concat([salt, recordSize, Buffer.from([asPublic.length]), asPublic, ciphertext]);
}

export class PushError extends Error {
  constructor(statusCode, body) {
    super(`Push ${statusCode}: ${body}`);
    this.statusCode = statusCode;
    this.body = body;
  }
}

export async function sendPush(subscription, payload, { vapid, ttl = 86400, urgency = 'normal' }) {
  const body = encryptPayload(subscription.keys, payload);
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: createVapidHeader({ endpoint: subscription.endpoint, ...vapid }),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: urgency,
    },
    body,
  });
  if (!res.ok) throw new PushError(res.status, await res.text().catch(() => ''));
  return res.status;
}
