import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { pb } from '../lib/pocketbase';
import { markAllNotificationsRead, markNotificationRead } from '../lib/notifications';
import { initNotificationSound, isSoundEnabled, playNotificationSound, setSoundEnabled } from '../lib/sound';
import { enablePush, getPushState, registerServiceWorker, syncPushSubscription } from '../lib/push';

const URGENT_TYPES = new Set(['sla_breached', 'sla_warning']);

const PUSH_HINTS = {
  unconfigured: 'Las notificaciones del dispositivo aún no están configuradas en el servidor.',
  'ios-install': 'En iPhone/iPad: toca Compartir → "Agregar a inicio" y abre la app desde ahí para recibir avisos.',
  unsupported: 'Este navegador no permite notificaciones con la pestaña cerrada.',
  denied: 'Bloqueaste las notificaciones. Actívalas desde el candado junto a la dirección del sitio.',
};

function notificationLabel(type) {
  const labels = {
    new_ticket: 'Nuevo ticket',
    new_message: 'Nuevo mensaje',
    assignment: 'Asignación',
    status_change: 'Cambio de estado',
    priority_change: 'Cambio de prioridad',
    resolved: 'Ticket resuelto',
    closed: 'Ticket cerrado',
    sla_warning: 'SLA en riesgo',
    sla_breached: 'SLA vencido',
    waiting_user_reminder: 'Recordatorio',
  };
  return labels[type] || 'Notificación';
}

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [error, setError] = useState('');
  const [soundOn, setSoundOn] = useState(isSoundEnabled);
  const [pushState, setPushState] = useState('loading');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState('');

  const unread = useMemo(() => notifications.filter((item) => !item.read).length, [notifications]);

  async function loadNotifications() {
    try {
      const records = await pb.collection('hd_notifications').getList(1, 25, {
        sort: '-created',
        expand: 'actor,ticket',
      });
      setNotifications(records.items);
      setError('');
    } catch (err) {
      console.error('No fue posible cargar notificaciones:', err);
      setError('No fue posible cargar las notificaciones.');
    }
  }

  useEffect(() => {
    loadNotifications();
    let active = true;
    initNotificationSound();
    registerServiceWorker()
      .then(() => syncPushSubscription())
      .finally(() => getPushState().then((state) => { if (active) setPushState(state); }).catch(() => {}));

    pb.collection('hd_notifications').subscribe('*', (event) => {
      if (!active) return;
      const me = pb.authStore.record?.id;
      if (event?.action === 'create' && event.record?.recipient === me && document.visibilityState === 'visible') {
        playNotificationSound({ urgent: URGENT_TYPES.has(event.record.type) });
      }
      loadNotifications();
    }).catch((err) => console.error('Realtime notificaciones:', err));

    const onClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);

    // Clic en una notificación del sistema con la app ya abierta: el service
    // worker pide navegar al ticket sin recargar la página.
    const onWorkerMessage = (event) => {
      if (event.data?.type === 'navigate' && typeof event.data.url === 'string') navigate(event.data.url);
    };
    navigator.serviceWorker?.addEventListener('message', onWorkerMessage);

    return () => {
      active = false;
      document.removeEventListener('mousedown', onClick);
      navigator.serviceWorker?.removeEventListener('message', onWorkerMessage);
      pb.collection('hd_notifications').unsubscribe('*').catch(() => {});
    };
  }, []);

  useEffect(() => {
    // Contador sobre el ícono de la app instalada (Android/Chrome/Edge/iOS PWA).
    if (!('setAppBadge' in navigator)) return;
    if (unread > 0) navigator.setAppBadge(unread).catch(() => {});
    else navigator.clearAppBadge?.().catch(() => {});
  }, [unread]);

  function toggleSound() {
    const next = !soundOn;
    setSoundEnabled(next);
    setSoundOn(next);
    if (next) playNotificationSound({ force: true });
  }

  async function activatePush() {
    setPushBusy(true);
    setPushError('');
    try {
      await enablePush();
    } catch (err) {
      console.error('Push:', err);
      setPushError(err?.response?.message || err?.message || 'No fue posible activar las notificaciones.');
    } finally {
      setPushState(await getPushState().catch(() => 'unsupported'));
      setPushBusy(false);
    }
  }

  async function openNotification(item) {
    try {
      if (!item.read) await markNotificationRead(item);
    } catch (err) {
      console.error(err);
    }
    setOpen(false);
    if (item.ticket) navigate(`/tickets/${item.ticket}`);
  }

  async function markAll() {
    try {
      await markAllNotificationsRead();
      await loadNotifications();
    } catch (err) {
      console.error(err);
      setError('No fue posible marcar las notificaciones como leídas.');
    }
  }

  return (
    <div className="notification-center" ref={rootRef}>
      <button className="notification-bell" type="button" onClick={() => setOpen((value) => !value)} aria-label="Notificaciones">
        <span aria-hidden="true">🔔</span>
        {unread > 0 && <span className="notification-count">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notification-menu">
          <div className="notification-menu-head">
            <div><strong>Notificaciones</strong><span>{unread ? `${unread} sin leer` : 'Todo al día'}</span></div>
            {unread > 0 && <button type="button" onClick={markAll}>Marcar leídas</button>}
          </div>
          <div className="notification-settings">
            <button type="button" className={`notification-toggle ${soundOn ? 'on' : ''}`} onClick={toggleSound} aria-pressed={soundOn}>
              <span aria-hidden="true">{soundOn ? '🔊' : '🔇'}</span> Sonido {soundOn ? 'activado' : 'desactivado'}
            </button>
            {pushState === 'enabled' && <span className="notification-push-ok">📲 Avisos activos en este dispositivo</span>}
            {pushState === 'available' && (
              <button type="button" className="notification-push-enable" onClick={activatePush} disabled={pushBusy}>
                {pushBusy ? 'Activando…' : '📲 Recibir avisos con la pestaña cerrada'}
              </button>
            )}
            {PUSH_HINTS[pushState] && <span className="notification-push-hint">{PUSH_HINTS[pushState]}</span>}
            {pushError && <span className="notification-push-hint error-text">{pushError}</span>}
          </div>
          {error && <div className="notification-empty">{error}</div>}
          {!error && notifications.length === 0 && <div className="notification-empty">No tienes notificaciones.</div>}
          {!error && notifications.map((item) => (
            <button key={item.id} type="button" className={`notification-item ${item.read ? '' : 'unread'}`} onClick={() => openNotification(item)}>
              <span className="notification-dot" />
              <span className="notification-body">
                <span className="notification-type">{notificationLabel(item.type)}</span>
                <strong>{item.title}</strong>
                {item.message && <span>{item.message}</span>}
                <small>{formatDate(item.created)}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
