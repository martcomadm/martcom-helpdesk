import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { currentUser, logout, pb } from '../lib/pocketbase';

const statusLabels = {
  nuevo: 'Nuevo',
  en_proceso: 'En proceso',
  esperando_usuario: 'Esperando usuario',
  esperando_tercero: 'Esperando tercero',
  resuelto: 'Resuelto',
  cerrado: 'Cerrado',
  cancelado: 'Cancelado',
};
const priorityLabels = { baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Crítica' };

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function personName(record) { return record?.name || record?.email || 'Usuario'; }

export default function TicketDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const user = currentUser();
  const canManage = user?.role === 'admin' || user?.role === 'supervisor';

  const [ticket, setTicket] = useState(null);
  const [supportUsers, setSupportUsers] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [realtimeReady, setRealtimeReady] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [messageMode, setMessageMode] = useState('message');
  const [messageText, setMessageText] = useState('');
  const [messageFiles, setMessageFiles] = useState([]);
  const [composerKey, setComposerKey] = useState(0);

  const backPath = location.state?.from === '/support' ? '/support' : '/tickets/mine';
  const backLabel = backPath === '/support' ? 'Panel de soporte' : 'Mis tickets';

  async function loadTicket() {
    const record = await pb.collection('hd_tickets').getOne(id, { expand: 'category,requester,assigned_to' });
    setTicket(record);
    return record;
  }

  async function loadActivity() {
    const records = await pb.collection('hd_ticket_messages').getFullList({
      filter: `ticket = "${id}"`, sort: 'created', expand: 'author',
    });
    setActivity(records);
  }

  useEffect(() => {
    async function loadData() {
      try {
        await Promise.all([loadTicket(), loadActivity()]);
        if (canManage) {
          try {
            const records = await pb.collection('hd_users').getFullList({
              filter: 'active = true && (role = "admin" || role = "supervisor")', sort: 'name,email',
            });
            setSupportUsers(records);
          } catch (err) { console.warn('No fue posible cargar responsables:', err); }
        }
      } catch (err) {
        console.error(err);
        setError(err?.response?.message || err?.message || 'No fue posible cargar el ticket.');
      } finally { setLoading(false); }
    }
    loadData();
  }, [id, canManage]);

  useEffect(() => {
    let unsubTicket = null;
    let unsubMessages = null;
    let active = true;

    async function connectRealtime() {
      try {
        unsubTicket = await pb.collection('hd_tickets').subscribe(id, (event) => {
          if (!active) return;
          if (event.action === 'delete') return navigate(backPath, { replace: true });
          setTicket(event.record);
          loadTicket().catch((err) => console.warn('No se pudo refrescar ticket realtime:', err));
        }, { expand: 'category,requester,assigned_to' });

        unsubMessages = await pb.collection('hd_ticket_messages').subscribe('*', (event) => {
          if (!active) return;
          const record = event.record;
          if (!record || record.ticket !== id) return;

          setActivity((current) => {
            if (event.action === 'delete') return current.filter((item) => item.id !== record.id);
            const exists = current.some((item) => item.id === record.id);
            const next = exists
              ? current.map((item) => item.id === record.id ? record : item)
              : [...current, record];
            return next.sort((a, b) => new Date(a.created) - new Date(b.created));
          });
        }, { filter: `ticket = "${id}"`, expand: 'author' });

        if (active) setRealtimeReady(true);
      } catch (err) {
        console.error('Realtime del ticket no pudo conectarse:', err);
        if (active) setRealtimeReady(false);
      }
    }

    connectRealtime();
    return () => {
      active = false;
      setRealtimeReady(false);
      if (unsubTicket) unsubTicket();
      if (unsubMessages) unsubMessages();
    };
  }, [id]);

  const requesterName = useMemo(() => {
    if (ticket?.expand?.requester?.name) return ticket.expand.requester.name;
    if (ticket?.expand?.requester?.email) return ticket.expand.requester.email;
    if (ticket?.requester === user?.id) return user?.name || user?.email;
    return '—';
  }, [ticket, user]);

  function handleLogout() { logout(); navigate('/login'); }
  function flashSuccess(message) { setSuccess(message); window.setTimeout(() => setSuccess(''), 2500); }

  async function createSystemEvent({ message, field = '', oldValue = '', newValue = '' }) {
    await pb.collection('hd_ticket_messages').create({
      ticket: id, author: user.id, type: 'system', message, field,
      old_value: oldValue || '', new_value: newValue || '', internal: false,
    });
  }

  async function patchTicket(data, message, events = []) {
    setSaving(true); setError(''); setSuccess('');
    try {
      await pb.collection('hd_tickets').update(id, data);
      for (const event of events) await createSystemEvent(event);
      await Promise.all([loadTicket(), loadActivity()]);
      flashSuccess(message);
    } catch (err) {
      console.error(err);
      setError(err?.response?.message || err?.message || 'No fue posible actualizar el ticket.');
    } finally { setSaving(false); }
  }

  async function takeTicket() {
    const now = new Date().toISOString();
    const oldStatus = ticket.status;
    const data = { assigned_to: user.id };
    const events = [{ message: `${personName(user)} tomó el ticket.`, field: 'assigned_to', oldValue: ticket.assigned_to || '', newValue: user.id }];
    if (ticket.status === 'nuevo') {
      data.status = 'en_proceso';
      events.push({ message: 'Estado cambiado de Nuevo a En proceso.', field: 'status', oldValue: oldStatus, newValue: 'en_proceso' });
    }
    if (!ticket.first_response_at) data.first_response_at = now;
    await patchTicket(data, 'Ticket asignado correctamente.', events);
  }

  async function changeAssignee(value) {
    const oldId = ticket.assigned_to || '';
    if (value === oldId) return;
    const oldName = ticket.expand?.assigned_to ? personName(ticket.expand.assigned_to) : 'Sin asignar';
    const newUser = supportUsers.find((item) => item.id === value);
    const newName = value ? personName(newUser) : 'Sin asignar';
    const data = { assigned_to: value || '' };
    if (value && !ticket.first_response_at) data.first_response_at = new Date().toISOString();
    await patchTicket(data, value ? 'Responsable actualizado.' : 'Ticket dejado sin responsable.', [{
      message: `Responsable cambiado de ${oldName} a ${newName}.`, field: 'assigned_to', oldValue: oldId, newValue: value || '',
    }]);
  }

  async function changePriority(value) {
    if (value === ticket.priority) return;
    await patchTicket({ priority: value }, 'Prioridad actualizada.', [{
      message: `Prioridad cambiada de ${priorityLabels[ticket.priority] || ticket.priority} a ${priorityLabels[value] || value}.`,
      field: 'priority', oldValue: ticket.priority, newValue: value,
    }]);
  }

  async function changeStatus(value) {
    if (value === ticket.status) return;
    const now = new Date().toISOString();
    const oldStatus = ticket.status;
    const data = { status: value };
    if (value === 'en_proceso' && !ticket.first_response_at) data.first_response_at = now;
    if (value === 'resuelto') { if (!ticket.first_response_at) data.first_response_at = now; data.resolved_at = now; }
    if (value === 'cerrado') { if (!ticket.first_response_at) data.first_response_at = now; if (!ticket.resolved_at) data.resolved_at = now; data.closed_at = now; }
    await patchTicket(data, `Estado cambiado a ${statusLabels[value] || value}.`, [{
      message: `Estado cambiado de ${statusLabels[oldStatus] || oldStatus} a ${statusLabels[value] || value}.`,
      field: 'status', oldValue: oldStatus, newValue: value,
    }]);
  }

  async function submitMessage(e) {
    e.preventDefault();
    const text = messageText.trim();
    const files = Array.from(messageFiles).slice(0, 5);
    if (!text && files.length === 0) return setError('Escribe un mensaje o adjunta al menos un archivo.');

    setSending(true); setError(''); setSuccess('');
    try {
      if (canManage && messageMode === 'message' && !ticket.first_response_at) {
        const now = new Date().toISOString();
        const update = { first_response_at: now };
        if (ticket.status === 'nuevo') update.status = 'en_proceso';
        await pb.collection('hd_tickets').update(id, update);
        if (ticket.status === 'nuevo') await createSystemEvent({ message: 'Estado cambiado de Nuevo a En proceso.', field: 'status', oldValue: 'nuevo', newValue: 'en_proceso' });
      }

      const data = new FormData();
      data.append('ticket', id);
      data.append('author', user.id);
      data.append('type', canManage ? messageMode : 'message');
      data.append('message', text);
      data.append('internal', canManage && messageMode === 'internal_note' ? 'true' : 'false');
      files.forEach((file) => data.append('attachments', file));
      await pb.collection('hd_ticket_messages').create(data);

      setMessageText(''); setMessageFiles([]); setComposerKey((v) => v + 1);
      await Promise.all([loadActivity(), loadTicket()]);
      flashSuccess(messageMode === 'internal_note' ? 'Nota interna guardada.' : 'Respuesta enviada.');
    } catch (err) {
      console.error(err);
      setError(err?.response?.message || err?.message || 'No fue posible enviar la respuesta.');
    } finally { setSending(false); }
  }

  if (loading) return <main className="app-shell"><aside className="sidebar"><div><p className="eyebrow">MARTCOM</p><h2>Soporte IT</h2></div></aside><section className="content"><article className="card empty-state"><p>Cargando ticket…</p></article></section></main>;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div><p className="eyebrow">MARTCOM</p><h2>Soporte IT</h2></div>
        <nav><a onClick={() => navigate('/')}>Dashboard</a><a onClick={() => navigate('/tickets/new')}>Crear ticket</a><a className={!canManage ? 'active' : ''} onClick={() => navigate('/tickets/mine')}>Mis tickets</a>{canManage && <a className={backPath === '/support' ? 'active' : ''} onClick={() => navigate('/support')}>Panel de soporte</a>}</nav>
        <button className="secondary" onClick={handleLogout}>Cerrar sesión</button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div><button className="secondary back-button" onClick={() => navigate(backPath)}>← Volver a {backLabel}</button><p className="muted detail-kicker">Detalle del ticket</p><h1>{ticket?.folio || 'Ticket'}</h1></div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="role-badge">● {realtimeReady ? 'En vivo' : 'Conectando'}</span>{ticket && <span className={`status-badge status-${ticket.status}`}>{statusLabels[ticket.status] || ticket.status}</span>}</div>
        </header>

        {error && <div className="error">{error}</div>}{success && <div className="success">{success}</div>}

        {ticket && <>
          {canManage && <article className="card management-card"><div className="management-head"><div><p className="eyebrow">GESTIÓN IT</p><h2>Atender ticket</h2></div>{!ticket.assigned_to && <button onClick={takeTicket} disabled={saving}>Tomar ticket</button>}</div><div className="management-grid"><label>Responsable<select value={ticket.assigned_to || ''} onChange={(e) => changeAssignee(e.target.value)} disabled={saving}><option value="">Sin asignar</option>{supportUsers.map((item) => <option key={item.id} value={item.id}>{personName(item)}</option>)}</select></label><label>Prioridad<select value={ticket.priority || 'media'} onChange={(e) => changePriority(e.target.value)} disabled={saving}><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option><option value="critica">Crítica</option></select></label><label>Estado<select value={ticket.status} onChange={(e) => changeStatus(e.target.value)} disabled={saving}><option value="nuevo">Nuevo</option><option value="en_proceso">En proceso</option><option value="esperando_usuario">Esperando usuario</option><option value="esperando_tercero">Esperando tercero</option><option value="resuelto">Resuelto</option><option value="cerrado">Cerrado</option><option value="cancelado">Cancelado</option></select></label></div></article>}

          <div className="detail-grid"><article className="card detail-main-card">
            <h2>{ticket.title}</h2><p className="detail-description">{ticket.description}</p>
            <div className="detail-section"><h3>Información</h3><div className="detail-info-grid"><div><span>Categoría</span><strong>{ticket.expand?.category?.name || '—'}</strong></div><div><span>Prioridad</span><strong className={`priority-${ticket.priority}`}>{ticket.priority || '—'}</strong></div><div><span>Equipo / estación</span><strong>{ticket.equipment || '—'}</strong></div><div><span>Departamento</span><strong>{ticket.department || '—'}</strong></div><div><span>Solicitante</span><strong>{requesterName}</strong></div><div><span>Responsable</span><strong>{ticket.expand?.assigned_to?.name || ticket.expand?.assigned_to?.email || 'Sin asignar'}</strong></div></div></div>
            <div className="detail-section"><h3>Evidencias</h3>{ticket.attachments?.length ? <div className="attachment-list">{ticket.attachments.map((file) => <a key={file} href={pb.files.getURL(ticket, file)} target="_blank" rel="noreferrer" className="attachment-link">📎 {file}</a>)}</div> : <p className="muted">No se adjuntaron evidencias a este ticket.</p>}</div>

            <div className="detail-section activity-section"><div className="activity-title"><div><p className="eyebrow">BITÁCORA</p><h3>Actividad del ticket</h3></div><span>{activity.length} registro{activity.length === 1 ? '' : 's'}</span></div>
              <div className="activity-list">{activity.length === 0 ? <div className="activity-empty"><p>Aún no hay respuestas ni eventos registrados.</p></div> : activity.map((item) => {
                const author = item.expand?.author; const files = item.attachments || [];
                if (item.type === 'system') return <div className="activity-system" key={item.id}><div className="system-dot">•</div><div><div className="activity-meta"><strong>Sistema</strong><span>{formatDate(item.created)}</span></div><p>{item.message || 'Actualización del ticket'}</p></div></div>;
                const internal = item.type === 'internal_note' || item.internal;
                return <article className={`activity-message ${internal ? 'activity-internal' : ''}`} key={item.id}><div className="activity-meta"><div><strong>{personName(author)}</strong>{internal && <span className="internal-badge">Solo soporte</span>}</div><span>{formatDate(item.created)}</span></div>{item.message && <p>{item.message}</p>}{files.length > 0 && <div className="message-attachments">{files.map((file) => <a key={file} href={pb.files.getURL(item, file)} target="_blank" rel="noreferrer">📎 {file}</a>)}</div>}</article>;
              })}</div>
              <form className={`message-composer ${messageMode === 'internal_note' ? 'composer-internal' : ''}`} onSubmit={submitMessage}>{canManage && <div className="composer-tabs"><button type="button" className={messageMode === 'message' ? 'active' : ''} onClick={() => setMessageMode('message')}>Respuesta pública</button><button type="button" className={messageMode === 'internal_note' ? 'active internal-tab' : ''} onClick={() => setMessageMode('internal_note')}>Nota interna</button></div>}<label>{messageMode === 'internal_note' ? 'Nota interna para soporte' : 'Escribe una respuesta'}<textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} rows="5" maxLength="5000" /></label><div className="composer-bottom"><label className="file-picker">Adjuntar archivos<input key={composerKey} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setMessageFiles(e.target.files)} /></label><div className="composer-actions"><span className="muted">{messageFiles?.length ? `${messageFiles.length} archivo(s)` : 'Máximo 5 archivos'}</span><button disabled={sending}>{sending ? 'Enviando…' : messageMode === 'internal_note' ? 'Guardar nota' : 'Enviar respuesta'}</button></div></div></form>
            </div>
          </article><aside className="card detail-side-card"><h3>Seguimiento</h3><div className="timeline-list"><div><span>Creado</span><strong>{formatDate(ticket.created)}</strong></div><div><span>Primera respuesta</span><strong>{formatDate(ticket.first_response_at)}</strong></div><div><span>Resuelto</span><strong>{formatDate(ticket.resolved_at)}</strong></div><div><span>Cerrado</span><strong>{formatDate(ticket.closed_at)}</strong></div><div><span>Última actualización</span><strong>{formatDate(ticket.updated)}</strong></div></div></aside></div>
        </>}
      </section>
    </main>
  );
}
