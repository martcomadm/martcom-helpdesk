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

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function TicketDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const user = currentUser();
  const canManage = user?.role === 'admin' || user?.role === 'supervisor';
  const [ticket, setTicket] = useState(null);
  const [supportUsers, setSupportUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const backPath = location.state?.from === '/support' ? '/support' : '/tickets/mine';
  const backLabel = backPath === '/support' ? 'Panel de soporte' : 'Mis tickets';

  async function loadTicket() {
    const record = await pb.collection('hd_tickets').getOne(id, { expand: 'category,requester,assigned_to' });
    setTicket(record);
  }

  useEffect(() => {
    async function loadData() {
      try {
        await loadTicket();
        if (canManage) {
          try {
            const records = await pb.collection('hd_users').getFullList({
              filter: 'active = true && (role = "admin" || role = "supervisor")',
              sort: 'name,email',
            });
            setSupportUsers(records);
          } catch (userError) {
            console.warn('No fue posible cargar responsables:', userError);
          }
        }
      } catch (err) {
        console.error(err);
        setError(err?.response?.message || err?.message || 'No fue posible cargar el ticket.');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [id, canManage]);

  const requesterName = useMemo(() => {
    if (ticket?.expand?.requester?.name) return ticket.expand.requester.name;
    if (ticket?.expand?.requester?.email) return ticket.expand.requester.email;
    if (ticket?.requester === user?.id) return user?.name || user?.email;
    return '—';
  }, [ticket, user]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  async function patchTicket(data, message) {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await pb.collection('hd_tickets').update(id, data);
      await loadTicket();
      setSuccess(message);
      window.setTimeout(() => setSuccess(''), 2500);
    } catch (err) {
      console.error(err);
      setError(err?.response?.message || err?.message || 'No fue posible actualizar el ticket.');
    } finally {
      setSaving(false);
    }
  }

  async function takeTicket() {
    const data = { assigned_to: user.id };
    if (ticket.status === 'nuevo') data.status = 'en_proceso';
    if (!ticket.first_response_at) data.first_response_at = new Date().toISOString();
    await patchTicket(data, 'Ticket asignado correctamente.');
  }

  async function changeAssignee(value) {
    const data = { assigned_to: value || '' };
    if (value && !ticket.first_response_at) data.first_response_at = new Date().toISOString();
    await patchTicket(data, value ? 'Responsable actualizado.' : 'Ticket dejado sin responsable.');
  }

  async function changePriority(value) {
    await patchTicket({ priority: value }, 'Prioridad actualizada.');
  }

  async function changeStatus(value) {
    const now = new Date().toISOString();
    const data = { status: value };
    if (value === 'en_proceso' && !ticket.first_response_at) data.first_response_at = now;
    if (value === 'resuelto') {
      if (!ticket.first_response_at) data.first_response_at = now;
      data.resolved_at = now;
    }
    if (value === 'cerrado') {
      if (!ticket.first_response_at) data.first_response_at = now;
      if (!ticket.resolved_at) data.resolved_at = now;
      data.closed_at = now;
    }
    await patchTicket(data, `Estado cambiado a ${statusLabels[value] || value}.`);
  }

  if (loading) {
    return (
      <main className="app-shell">
        <aside className="sidebar"><div><p className="eyebrow">MARTCOM</p><h2>Soporte IT</h2></div></aside>
        <section className="content"><article className="card empty-state"><p>Cargando ticket…</p></article></section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div><p className="eyebrow">MARTCOM</p><h2>Soporte IT</h2></div>
        <nav>
          <a onClick={() => navigate('/')}>Dashboard</a>
          <a onClick={() => navigate('/tickets/new')}>Crear ticket</a>
          <a className={!canManage ? 'active' : ''} onClick={() => navigate('/tickets/mine')}>Mis tickets</a>
          {canManage && <a className={backPath === '/support' ? 'active' : ''} onClick={() => navigate('/support')}>Panel de soporte</a>}
        </nav>
        <button className="secondary" onClick={handleLogout}>Cerrar sesión</button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <button className="secondary back-button" onClick={() => navigate(backPath)}>← Volver a {backLabel}</button>
            <p className="muted detail-kicker">Detalle del ticket</p>
            <h1>{ticket?.folio || 'Ticket'}</h1>
          </div>
          {ticket && <span className={`status-badge status-${ticket.status}`}>{statusLabels[ticket.status] || ticket.status}</span>}
        </header>

        {error && <div className="error">{error}</div>}
        {success && <div className="success">{success}</div>}

        {ticket ? (
          <>
            {canManage && (
              <article className="card management-card">
                <div className="management-head">
                  <div><p className="eyebrow">GESTIÓN IT</p><h2>Atender ticket</h2></div>
                  {!ticket.assigned_to && <button onClick={takeTicket} disabled={saving}>Tomar ticket</button>}
                </div>
                <div className="management-grid">
                  <label>
                    Responsable
                    <select value={ticket.assigned_to || ''} onChange={(e) => changeAssignee(e.target.value)} disabled={saving}>
                      <option value="">Sin asignar</option>
                      {supportUsers.map((item) => <option key={item.id} value={item.id}>{item.name || item.email}</option>)}
                      {ticket.assigned_to && !supportUsers.some((item) => item.id === ticket.assigned_to) && <option value={ticket.assigned_to}>{ticket.expand?.assigned_to?.name || ticket.expand?.assigned_to?.email || 'Responsable actual'}</option>}
                    </select>
                  </label>
                  <label>
                    Prioridad
                    <select value={ticket.priority || 'media'} onChange={(e) => changePriority(e.target.value)} disabled={saving}>
                      <option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option><option value="critica">Crítica</option>
                    </select>
                  </label>
                  <label>
                    Estado
                    <select value={ticket.status} onChange={(e) => changeStatus(e.target.value)} disabled={saving}>
                      <option value="nuevo">Nuevo</option><option value="en_proceso">En proceso</option><option value="esperando_usuario">Esperando usuario</option><option value="esperando_tercero">Esperando tercero</option><option value="resuelto">Resuelto</option><option value="cerrado">Cerrado</option><option value="cancelado">Cancelado</option>
                    </select>
                  </label>
                </div>
                {saving && <p className="muted saving-note">Guardando cambios…</p>}
              </article>
            )}

            <div className="detail-grid">
              <article className="card detail-main-card">
                <h2>{ticket.title}</h2>
                <p className="detail-description">{ticket.description}</p>

                <div className="detail-section">
                  <h3>Información</h3>
                  <div className="detail-info-grid">
                    <div><span>Categoría</span><strong>{ticket.expand?.category?.name || '—'}</strong></div>
                    <div><span>Prioridad</span><strong className={`priority-${ticket.priority}`}>{ticket.priority || '—'}</strong></div>
                    <div><span>Equipo / estación</span><strong>{ticket.equipment || '—'}</strong></div>
                    <div><span>Departamento</span><strong>{ticket.department || '—'}</strong></div>
                    <div><span>Solicitante</span><strong>{requesterName}</strong></div>
                    <div><span>Responsable</span><strong>{ticket.expand?.assigned_to?.name || ticket.expand?.assigned_to?.email || 'Sin asignar'}</strong></div>
                  </div>
                </div>

                <div className="detail-section">
                  <h3>Evidencias</h3>
                  {ticket.attachments?.length ? (
                    <div className="attachment-list">{ticket.attachments.map((file) => <a key={file} href={pb.files.getURL(ticket, file)} target="_blank" rel="noreferrer" className="attachment-link">📎 {file}</a>)}</div>
                  ) : <p className="muted">No se adjuntaron evidencias a este ticket.</p>}
                </div>
              </article>

              <aside className="card detail-side-card">
                <h3>Seguimiento</h3>
                <div className="timeline-list">
                  <div><span>Creado</span><strong>{formatDate(ticket.created)}</strong></div>
                  <div><span>Primera respuesta</span><strong>{formatDate(ticket.first_response_at)}</strong></div>
                  <div><span>Resuelto</span><strong>{formatDate(ticket.resolved_at)}</strong></div>
                  <div><span>Cerrado</span><strong>{formatDate(ticket.closed_at)}</strong></div>
                  <div><span>Última actualización</span><strong>{formatDate(ticket.updated)}</strong></div>
                </div>
              </aside>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
