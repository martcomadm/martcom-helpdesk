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
