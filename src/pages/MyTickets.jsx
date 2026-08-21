import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { currentUser, logout, pb } from '../lib/pocketbase';

const statusLabels = { nuevo: 'Nuevo', en_proceso: 'En proceso', esperando_usuario: 'Esperando usuario', esperando_tercero: 'Esperando tercero', resuelto: 'Resuelto', cerrado: 'Cerrado', cancelado: 'Cancelado' };

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function MyTickets() {
  const navigate = useNavigate();
  const user = currentUser();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('todos');

  useEffect(() => {
    async function loadTickets() {
      try {
        const records = await pb.collection('hd_tickets').getFullList({ filter: `requester = "${user.id}"`, sort: '-created', expand: 'category,assigned_to' });
        setTickets(records);
      } catch (err) {
        console.error(err);
        setError(err?.response?.message || err?.message || 'No fue posible cargar tus tickets.');
      } finally { setLoading(false); }
    }
    loadTickets();
  }, [user.id]);

  const filteredTickets = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tickets.filter((ticket) => {
      const matchesStatus = status === 'todos' || ticket.status === status;
      const category = ticket.expand?.category?.name || '';
      const matchesSearch = !term || [ticket.folio, ticket.title, ticket.description, category, ticket.equipment].some((value) => String(value || '').toLowerCase().includes(term));
      return matchesStatus && matchesSearch;
    });
  }, [tickets, search, status]);

  function handleLogout() { logout(); navigate('/login'); }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div><p className="eyebrow">MARTCOM</p><h2>Soporte IT</h2></div>
        <nav>
          <a onClick={() => navigate('/')}>Dashboard</a>
          <a onClick={() => navigate('/tickets/new')}>Crear ticket</a>
          <a className="active">Mis tickets</a>
          {(user?.role === 'admin' || user?.role === 'supervisor') && <a>Panel de soporte</a>}
        </nav>
        <button className="secondary" onClick={handleLogout}>Cerrar sesión</button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div><p className="muted">Mesa de ayuda</p><h1>Mis tickets</h1><p className="muted">Consulta el estado de las solicitudes que has registrado.</p></div>
          <button onClick={() => navigate('/tickets/new')}>+ Crear ticket</button>
        </header>

        <div className="ticket-toolbar">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por folio, asunto, categoría o equipo…" />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="todos">Todos los estados</option><option value="nuevo">Nuevo</option><option value="en_proceso">En proceso</option><option value="esperando_usuario">Esperando usuario</option><option value="esperando_tercero">Esperando tercero</option><option value="resuelto">Resuelto</option><option value="cerrado">Cerrado</option><option value="cancelado">Cancelado</option>
          </select>
        </div>

        {error && <div className="error">{error}</div>}
        {loading ? <article className="card empty-state"><p>Cargando tus tickets…</p></article> : filteredTickets.length === 0 ? (
          <article className="card empty-state"><h2>{tickets.length ? 'Sin coincidencias' : 'Aún no tienes tickets'}</h2><p>{tickets.length ? 'Prueba con otro texto o estado.' : 'Cuando registres una solicitud aparecerá aquí.'}</p>{!tickets.length && <button onClick={() => navigate('/tickets/new')}>Crear mi primer ticket</button>}</article>
        ) : (
          <div className="ticket-list">
            {filteredTickets.map((ticket) => (
              <article className="card ticket-row clickable" key={ticket.id} onClick={() => navigate(`/tickets/${ticket.id}`)}>
                <div className="ticket-main">
                  <div className="ticket-heading"><span className="ticket-folio">{ticket.folio}</span><span className={`status-badge status-${ticket.status}`}>{statusLabels[ticket.status] || ticket.status}</span></div>
                  <h3>{ticket.title}</h3>
                  <p className="muted ticket-description">{ticket.description}</p>
                  <div className="ticket-details"><span>Categoría: <strong>{ticket.expand?.category?.name || '—'}</strong></span><span>Prioridad: <strong className={`priority-${ticket.priority}`}>{ticket.priority || '—'}</strong></span><span>Equipo: <strong>{ticket.equipment || '—'}</strong></span><span>Creado: <strong>{formatDate(ticket.created)}</strong></span></div>
                </div>
                <span className="ticket-open-hint">Ver detalle →</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
