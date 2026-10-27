// Genera un par de llaves VAPID para notificaciones push: npm run vapid
import { generateVapidKeys } from './webpush.js';

const { publicKey, privateKey } = generateVapidKeys();
console.log('Opcional: el watcher genera y guarda sus propias llaves en PocketBase.\nUsa estas solo si quieres fijarlas tú:\n');
console.log('# sla-watcher');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:soporte@tu-dominio.com\n');
console.log('\nLa llave privada no debe subirse al repositorio ni ponerse en el frontend.');
