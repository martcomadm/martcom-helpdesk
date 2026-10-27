# MARTCOM Helpdesk — Fase 1

## 1. Requisitos
- Node.js 20+
- PocketBase

## 2. PocketBase
Copia `pb_migrations/1755774000_phase1_users.js` a la carpeta `pb_migrations` de tu instalación de PocketBase.

Arranca PocketBase:

```bash
./pocketbase serve --http=0.0.0.0:8090
```

La migración crea la colección auth `users` con:
- name
- department
- role: empleado | supervisor | admin
- active

La creación de usuarios queda bloqueada al público; se hace desde el dashboard de PocketBase o posteriormente desde el panel admin de la app.

## 3. Frontend

```bash
cp .env.example .env
npm install
npm run dev
```

Configura en `.env`:

```env
VITE_POCKETBASE_URL=http://TU-IP-O-DOMINIO:8090
```

## 4. Primer usuario
Desde `/_/` crea manualmente el primer registro en `users`:
- name: Axel
- department: IT
- role: admin
- active: true
- email y contraseña deseados

Después entra a la app con ese usuario.

## 5. Notificaciones con sonido y push

La campana de notificaciones ahora:
- **Suena** cuando llega una notificación nueva con la app abierta. Las de SLA en riesgo o vencido usan un tono más insistente. Cada persona puede apagarlo desde el menú de la campana.
- **Envía avisos al navegador o al celular aunque la pestaña esté cerrada** (Web Push). Cada persona los activa en su dispositivo con el botón "Recibir avisos con la pestaña cerrada" del menú de la campana.
- Muestra el número de pendientes sobre el ícono si la app está instalada.

Al tocar un aviso se abre el ticket. Al cerrar sesión, ese dispositivo deja de recibir avisos de esa cuenta.

### Configuración

**No hay que configurar nada.** Al arrancar, el servicio `sla-watcher`:
- crea en PocketBase la colección `hd_push_subscriptions` (dispositivos de cada usuario), la colección `hd_push_config` y el campo `push_sent_at` en `hd_notifications`, si no existen;
- genera las llaves VAPID la primera vez y las guarda en `hd_push_config`. La app lee de ahí la llave pública; la privada es un campo oculto que solo ve un superusuario;
- envía como push cada registro nuevo de `hd_notifications`, sea de la app o del propio watcher (SLA, recordatorios, cierres).

Solo hace falta que el watcher esté corriendo con sus variables de siempre (`PB_URL`, `PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD`). No requiere `npm install`: el cifrado usa `node:crypto`.

Variables opcionales del watcher:
```env
VAPID_SUBJECT=mailto:soporte@tu-dominio.com   # contacto que se manda a los servicios de push
PUSH_INTERVAL_MS=5000                          # cada cuánto revisa notificaciones nuevas
PUSH_MAX_AGE_MINUTES=30                        # no envía push de notificaciones más viejas
VAPID_PUBLIC_KEY= / VAPID_PRIVATE_KEY=         # solo si quieres fijar tus propias llaves (npm run vapid)
```

### Requisitos y limitaciones

- El sitio debe servirse por **HTTPS**.
- **Android, Windows y macOS** (Chrome, Edge, Firefox): funciona directo desde el navegador.
- **iPhone/iPad** (iOS 16.4 o superior): primero hay que abrir el sitio en Safari, tocar Compartir → "Agregar a inicio", abrir la app desde ese ícono y activar los avisos ahí. El menú de la campana muestra estas instrucciones.
- Si alguien bloqueó las notificaciones del sitio, tiene que permitirlas desde el candado de la barra de direcciones.
- Los íconos están en `public/` (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `badge-96.png`) y se pueden reemplazar por el logo de MARTCOM.
