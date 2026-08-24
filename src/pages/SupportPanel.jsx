import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { currentUser, logout, pb } from '../lib/pocketbase';

const statusLabels = { nuevo: 'Nuevo', en_proceso: 'En proceso', esperando_usuario: 'Esperando usuario', esperando_tercero: 'Esperando tercero', resuelto: 'Resuelto', cerrado: 'Cerrado', cancelado: 'Cancelado' };
function formatDate(value) { if (!value) return '—'; return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }

export default function SupportPanel() {
  const navigate = useNavigate();
  const user = currentUser();
  const [tickets, setTickets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [usersById, setUsersById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('todos');
  const [priority, setPriority] = useState('todas');
  const [category, setCategory] = useState('todas');
  const [department, setDepartment] = useState('todos');

  useEffect(() => {
    async function loadData() {
      try {
        const [ticketRecords, categoryRecords] = await Promise.all([
          pb.collection('hd_tickets').getFullList({ sort: '-created', expand: 'category,requester,assigned_to' }),
          pb.collection('hd_categories').getFullList({ filter: 'active = true', sort: 'order,name' }),
        ]);
        setTickets(ticketRecords);
        setCategories(categoryRecords);
        try {
          const userRecords = await pb.collection('hd_users').getFullList({ filter: 'active = true', sort: 'name,email' });
          setUsersById(Object.fromEntries(userRecords.map((item) => [item.id, item])));
        } catch (userError) {
          console.warn('No fue posible cargar hd_users para expandir nombres:', userError);
        }
      } catch (err) {
        console.error(err);
        setError(err?.response?.message || err?.message || 'No fue posible cargar el panel de soporte.');
      } finally { setLoading(false); }
    }
    loadData();
  }, []);

  function requesterLabel(ticket) {
    const record = ticket.expand?.requester || usersById[ticket.requester];
    if (record?.name) return record.name;
    if (record?.email) return record.email;
    if (ticket.requester === user?.id) return user?.name || user?.email || 'Usuario actual';
    return '—';
  }
  function assigneeLabel(ticket) {
    const record = ticket.expand?.assigned_to || usersById[ticket.assigned_to];
    return record?.name || record?.email || 'Sin asignar';
  }

  const departments = useMemo(() => [...new Set(tickets.map((ticket) => ticket.department).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [tickets]);
  const filteredTickets = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tickets.filter((ticket) => {
      const requester = requesterLabel(ticket);
      const categoryName = ticket.expand?.category?.name || '';
      const matchesSearch = !term || [ticket.folio, ticket.title, ticket.description, requester, categoryName, ticket.department, ticket.equipment].some((value) => String(value || '').toLowerCase().includes(term));
      return matchesSearch && (status === 'todos' || ticket.status === status) && (priority === 'todas' || ticket.priority === priority) && (category === 'todas' || ticket.category === category) && (department === 'todos' || ticket.department === department);
    });
  }, [tickets, usersById, search, status, priority, category, department]);

  const stats = useMemo(() => ({
    nuevos: tickets.filter((ticket) => ticket.status === 'nuevo').length,
    proceso: tickets.filter((ticket) => ticket.status === 'en_proceso').length,
    esperando: tickets.filter((ticket) => ['esperando_usuario', 'esperando_tercero'].includes(ticket.status)).length,
    sinAsignar: tickets.filter((ticket) => !ticket.assigned_to && !['resuelto', 'cerrado', 'cancelado'].includes(ticket.status)).length,
  }), [tickets]);

  function handleLogout() { logout(); navigate('/login'); }
  if (user?.role !== 'admin' && user?.role !== 'supervisor') return <Navigate to="/" replace />;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div><p className="eyebrow">MARTCOM</p><h2>Soporte IT</h2></div>
        <nav><a onClick={() => navigate('/')}>Dashboard</a><a onClick={() => navigate('/tickets/new')}>Crear ticket</a><a onClick={() => navigate('/tickets/mine')}>Mis tickets</a><a className="active">Panel de soporte</a></nav>
        <button className="secondary" onClick={handleLogout}>Cerrar sesión</button>
      </aside>
      <section className="content">
        <header className="topbar"><div><p className="muted">Mesa de ayuda</p><h1>Panel de soporte</h1><p className="muted">Bandeja general de incidencias y solicitudes.</p></div><span className="role-badge">{user?.role}</span></header>
        <div className="stats-grid support-stats"><article className="card"><span>Nuevos</span><strong>{stats.nuevos}</strong></article><article className="card"><span>En proceso</span><strong>{stats.proceso}</strong></article><article className="card"><span>Esperando</span><strong>{stats.esperando}</strong></article><article className="card"><span>Sin asignar</span><strong>{stats.sinAsignar}</strong></article></div>
        <div className="support-toolbar card">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar folio, asunto, solicitante, categoría, área o equipo…" />
          <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="todos">Todos los estados</option><option value="nuevo">Nuevo</option><option value="en_proceso">En proceso</option><option value="esperando_usuario">Esperando usuario</option><option value="esperando_tercero">Esperando tercero</option><option value="resuelto">Resuelto</option><option value="cerrado">Cerrado</option><option value="cancelado">Cancelado</option></select>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}><option value="todas">Todas las prioridades</option><option value="critica">Crítica</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></select>
          <select value={category} onChange={(e) => setCategory(e.target.value)}><option value="todas">Todas las categorías</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select value={department} onChange={(e) => setDepartment(e.target.value)}><option value="todos">Todos los departamentos</option>{departments.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        </div>
        <div className="support-results-head"><span>{filteredTickets.length} ticket{filteredTickets.length === 1 ? '' : 's'}</span><button className="secondary" onClick={() => { setSearch(''); setStatus('todos'); setPriority('todas'); setCategory('todas'); setDepartment('todos'); }}>Limpiar filtros</button></div>
        {error && <div className="error">{error}</div>}
        {loading ? <article className="card empty-state"><p>Cargando tickets…</p></article> : filteredTickets.length === 0 ? <article className="card empty-state"><h2>Sin resultados</h2><p>No hay tickets que coincidan con los filtros seleccionados.</p></article> : (
          <div className="support-table-wrap card"><table className="support-table"><thead><tr><th>Ticket</th><th>Solicitante</th><th>Área</th><th>Categoría</th><th>Prioridad</th><th>Estado</th><th>Responsable</th><th>Creado</th></tr></thead><tbody>{filteredTickets.map((ticket) => (
            <tr key={ticket.id} onClick={() => navigate(`/tickets/${ticket.id}`, { state: { from: '/support' } })}>
              <td><strong>{ticket.folio}</strong><span className="table-subtext">{ticket.title}</span></td><td>{requesterLabel(ticket)}</td><td>{ticket.department || '—'}</td><td>{ticket.expand?.category?.name || '—'}</td><td><strong className={`priority-${ticket.priority}`}>{ticket.priority || '—'}</strong></td><td><span className={`status-badge status-${ticket.status}`}>{statusLabels[ticket.status] || ticket.status}</span></td><td>{assigneeLabel(ticket)}</td><td>{formatDate(ticket.created)}</td>
            </tr>))}</tbody></table></div>
        )}
      </section>
    </main>
  );
}
