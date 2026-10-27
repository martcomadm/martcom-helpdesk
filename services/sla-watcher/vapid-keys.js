// Genera un par de llaves VAPID para notificaciones push: npm run vapid
import { generateVapidKeys } from './webpush.js';

const { publicKey, privateKey } = generateVapidKeys();
console.log('Agrega estas variables:\n');
console.log('# sla-watcher');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:soporte@tu-dominio.com\n');
console.log('# frontend (.env, se lee al hacer build)');
console.log(`VITE_VAPID_PUBLIC_KEY=${publicKey}`);
console.log('\nLa llave privada no debe subirse al repositorio ni ponerse en el frontend.');
