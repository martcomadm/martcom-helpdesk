import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function TicketDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const user = currentUser();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadTicket() {
      try {
        const record = await pb.collection('hd_tickets').getOne(id, {
          expand: 'category,requester,assigned_to',
        });
        setTicket(record);
      } catch (err) {
        console.error(err);
        setError(err?.response?.message || err?.message || 'No fue posible cargar el ticket.');
      } finally {
        setLoading(false);
      }
    }
    loadTicket();
  }, [id]);

  function handleLogout() {
    logout();
    navigate('/login');
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
        <div>
          <p className="eyebrow">MARTCOM</p>
          <h2>Soporte IT</h2>
        </div>
        <nav>
          <a onClick={() => navigate('/')}>Dashboard</a>
          <a onClick={() => navigate('/tickets/new')}>Crear ticket</a>
          <a className="active" onClick={() => navigate('/tickets/mine')}>Mis tickets</a>
          {(user?.role === 'admin' || user?.role === 'supervisor') && <a>Panel de soporte</a>}
        </nav>
        <button className="secondary" onClick={handleLogout}>Cerrar sesión</button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <button className="secondary back-button" onClick={() => navigate('/tickets/mine')}>← Volver a Mis tickets</button>
            <p className="muted detail-kicker">Detalle del ticket</p>
            <h1>{ticket?.folio || 'Ticket'}</h1>
          </div>
          {ticket && <span className={`status-badge status-${ticket.status}`}>{statusLabels[ticket.status] || ticket.status}</span>}
        </header>

        {error ? (
          <div className="error">{error}</div>
        ) : ticket ? (
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
                  <div><span>Solicitante</span><strong>{ticket.expand?.requester?.name || ticket.expand?.requester?.email || '—'}</strong></div>
                  <div><span>Responsable</span><strong>{ticket.expand?.assigned_to?.name || ticket.expand?.assigned_to?.email || 'Sin asignar'}</strong></div>
                </div>
              </div>

              <div className="detail-section">
                <h3>Evidencias</h3>
                {ticket.attachments?.length ? (
                  <div className="attachment-list">
                    {ticket.attachments.map((file) => (
                      <a key={file} href={pb.files.getURL(ticket, file)} target="_blank" rel="noreferrer" className="attachment-link">📎 {file}</a>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No se adjuntaron evidencias a este ticket.</p>
                )}
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
        ) : null}
      </section>
    </main>
  );
}
