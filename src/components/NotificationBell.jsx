import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { pb } from '../lib/pocketbase';
import { markAllNotificationsRead, markNotificationRead } from '../lib/notifications';

function notificationLabel(type) {
  const labels = {
    new_ticket: 'Nuevo ticket',
    new_message: 'Nuevo mensaje',
    assignment: 'Asignación',
    status_change: 'Cambio de estado',
    priority_change: 'Cambio de prioridad',
    resolved: 'Ticket resuelto',
    closed: 'Ticket cerrado',
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
    pb.collection('hd_notifications').subscribe('*', () => {
      if (active) loadNotifications();
    }).catch((err) => console.error('Realtime notificaciones:', err));

    const onClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);

    return () => {
      active = false;
      document.removeEventListener('mousedown', onClick);
      pb.collection('hd_notifications').unsubscribe('*').catch(() => {});
    };
  }, []);

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
