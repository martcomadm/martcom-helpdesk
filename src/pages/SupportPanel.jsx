import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { currentUser, logout, pb } from '../lib/pocketbase';
import { getTicketSla, slaBadge } from '../lib/sla';

const statusLabels = { nuevo: 'Nuevo', en_proceso: 'En proceso', esperando_usuario: 'Esperando usuario', esperando_tercero: 'Esperando tercero', resuelto: 'Resuelto', cerrado: 'Cerrado', cancelado: 'Cancelado' };
const OPEN_STATUSES = new Set(['nuevo', 'en_proceso', 'esperando_usuario', 'esperando_tercero']);
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
  const [slaFilter, setSlaFilter] = useState('todos');
  const [assigneeFilter, setAssigneeFilter] = useState('todos');
  const [realtimeReady, setRealtimeReady] = useState(false);
  const [, setClock] = useState(Date.now());

  async function loadTickets() {
    const ticketRecords = await pb.collection('hd_tickets').getFullList({ sort: '-created', expand: 'category,requester,assigned_to' });
    setTickets(ticketRecords);
  }

  useEffect(() => {
    async function loadData() {
      try {
        const [, categoryRecords] = await Promise.all([loadTickets(), pb.collection('hd_categories').getFullList({ filter: 'active = true', sort: 'order,name' })]);
        setCategories(categoryRecords);
        try {
          const userRecords = await pb.collection('hd_users').getFullList({ filter: 'active = true', sort: 'name,email' });
          setUsersById(Object.fromEntries(userRecords.map((item) => [item.id, item])));
        } catch (userError) { console.warn('No fue posible cargar hd_users para expandir nombres:', userError); }
      } catch (err) {
        console.error(err);
        setError(err?.response?.message || err?.message || 'No fue posible cargar el panel de soporte.');
      } finally { setLoading(false); }
    }
    loadData();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let unsubscribeTickets; let active = true;
    async function connectRealtime() {
      try {
        unsubscribeTickets = await pb.collection('hd_tickets').subscribe('*', async () => {
          if (!active) return;
          try { await loadTickets(); } catch (err) { console.warn('Error actualizando panel en tiempo real:', err); }
        });
        if (active) setRealtimeReady(true);
      } catch (err) { console.warn('No fue posible iniciar Realtime en el panel:', err); if (active) setRealtimeReady(false); }
    }
    connectRealtime();
    return () => { active = false; if (unsubscribeTickets) unsubscribeTickets(); };
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

  const workload = useMemo(() => {
    const activeUsers = Object.values(usersById).filter((item) => item.role === 'admin' || item.role === 'supervisor' || item.role === 'soporte');
    const rows = activeUsers.map((member) => {
      const assigned = tickets.filter((ticket) => ticket.assigned_to === member.id && OPEN_STATUSES.has(ticket.status));
      return {
        id: member.id,
        name: member.name || member.email,
        total: assigned.length,
        nuevos: assigned.filter((ticket) => ticket.status === 'nuevo').length,
        proceso: assigned.filter((ticket) => ticket.status === 'en_proceso').length,
        esperando: assigned.filter((ticket) => ['esperando_usuario', 'esperando_tercero'].includes(ticket.status)).length,
        vencidos: assigned.filter((ticket) => getTicketSla(ticket)?.overall === 'breached').length,
        riesgo: assigned.filter((ticket) => getTicketSla(ticket)?.overall === 'warning').length,
      };
    }).sort((a, b) => a.total - b.total || a.name.localeCompare(b.name));
    const unassigned = tickets.filter((ticket) => !ticket.assigned_to && OPEN_STATUSES.has(ticket.status));
    return { rows, unassigned: unassigned.length, unassignedBreached: unassigned.filter((ticket) => getTicketSla(ticket)?.overall === 'breached').length };
  }, [tickets, usersById]);

  const filteredTickets = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tickets.filter((ticket) => {
      const requester = requesterLabel(ticket);
      const categoryName = ticket.expand?.category?.name || '';
      const sla = getTicketSla(ticket);
      const matchesSearch = !term || [ticket.folio, ticket.title, ticket.description, requester, categoryName, ticket.department, ticket.equipment].some((value) => String(value || '').toLowerCase().includes(term));
      const matchesSla = slaFilter === 'todos' || (slaFilter === 'vencidos' && sla?.overall === 'breached') || (slaFilter === 'riesgo' && sla?.overall === 'warning') || (slaFilter === 'cumplidos' && sla?.overall === 'met');
      const matchesAssignee = assigneeFilter === 'todos' || (assigneeFilter === 'sin_asignar' ? !ticket.assigned_to : ticket.assigned_to === assigneeFilter);
      return matchesSearch && matchesSla && matchesAssignee && (status === 'todos' || ticket.status === status) && (priority === 'todas' || ticket.priority === priority) && (category === 'todas' || ticket.category === category) && (department === 'todos' || ticket.department === department);
    });
  }, [tickets, usersById, search, status, priority, category, department, slaFilter, assigneeFilter]);

  const stats = useMemo(() => ({
    nuevos: tickets.filter((ticket) => ticket.status === 'nuevo').length,
    proceso: tickets.filter((ticket) => ticket.status === 'en_proceso').length,
    esperando: tickets.filter((ticket) => ['esperando_usuario', 'esperando_tercero'].includes(ticket.status)).length,
    vencidos: tickets.filter((ticket) => getTicketSla(ticket)?.overall === 'breached').length,
  }), [tickets]);

  function handleLogout() { logout(); navigate('/login'); }
  if (user?.role !== 'admin' && user?.role !== 'supervisor') return <Navigate to="/" replace />;

  return (
    <main className="app-shell">
      <aside className="sidebar"><div><p className="eyebrow">MARTCOM</p><h2>Soporte IT</h2></div><nav><a onClick={() => navigate('/')}>Dashboard</a><a onClick={() => navigate('/tickets/new')}>Crear ticket</a><a onClick={() => navigate('/tickets/mine')}>Mis tickets</a><a className="active">Panel de soporte</a></nav><button className="secondary" onClick={handleLogout}>Cerrar sesión</button></aside>
      <section className="content">
        <header className="topbar"><div><p className="muted">Mesa de ayuda</p><h1>Panel de soporte</h1><p className="muted">Bandeja general de incidencias, solicitudes y cumplimiento de SLA.</p></div><div className="topbar-badges"><span className={`live-badge ${realtimeReady ? 'online' : ''}`}>● {realtimeReady ? 'En vivo' : 'Conectando'}</span><span className="role-badge">{user?.role}</span></div></header>
        <div className="stats-grid support-stats"><article className="card"><span>Nuevos</span><strong>{stats.nuevos}</strong></article><article className="card"><span>En proceso</span><strong>{stats.proceso}</strong></article><article className="card"><span>Esperando</span><strong>{stats.esperando}</strong></article><article className="card"><span>SLA vencido</span><strong className={stats.vencidos ? 'priority-critica' : ''}>{stats.vencidos}</strong></article></div>

        <article className="card" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
            <div><p className="eyebrow">CARGA OPERATIVA</p><h2 style={{ margin: '4px 0' }}>Carga por responsable</h2><p className="muted" style={{ margin: 0 }}>Tickets abiertos por integrante. Ordenado de menor a mayor carga para facilitar la asignación.</p></div>
            <button className="secondary" onClick={() => setAssigneeFilter('sin_asignar')}>Sin asignar: {workload.unassigned}{workload.unassignedBreached ? ` · ${workload.unassignedBreached} vencido${workload.unassignedBreached === 1 ? '' : 's'}` : ''}</button>
          </div>
          {workload.rows.length === 0 ? <p className="muted">No hay responsables activos disponibles.</p> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12 }}>
            {workload.rows.map((member, index) => <button key={member.id} onClick={() => setAssigneeFilter(member.id)} style={{ textAlign: 'left', background: '#0e1628', border: '1px solid #263550', borderRadius: 12, padding: 14, color: 'inherit', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}><strong>{member.name}</strong><span className="sla-badge sla-ok">{member.total} abierto{member.total === 1 ? '' : 's'}</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 12, fontSize: 11, color: '#9aa9c1' }}><span>Proceso <strong style={{ display: 'block', color: '#e8edf6', fontSize: 16 }}>{member.proceso}</strong></span><span>Espera <strong style={{ display: 'block', color: '#e8edf6', fontSize: 16 }}>{member.esperando}</strong></span><span>Vencidos <strong style={{ display: 'block', color: member.vencidos ? '#ffb4bf' : '#e8edf6', fontSize: 16 }}>{member.vencidos}</strong></span></div>
              <small style={{ display: 'block', marginTop: 10, color: '#7485a4' }}>{index === 0 ? 'Menor carga actual · ' : ''}{member.riesgo} en riesgo</small>
            </button>)}
          </div>}
        </article>

        <div className="support-toolbar card">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar folio, asunto, solicitante, categoría, área o equipo…" />
          <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="todos">Todos los estados</option><option value="nuevo">Nuevo</option><option value="en_proceso">En proceso</option><option value="esperando_usuario">Esperando usuario</option><option value="esperando_tercero">Esperando tercero</option><option value="resuelto">Resuelto</option><option value="cerrado">Cerrado</option><option value="cancelado">Cancelado</option></select>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}><option value="todas">Todas las prioridades</option><option value="critica">Crítica</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></select>
          <select value={slaFilter} onChange={(e) => setSlaFilter(e.target.value)}><option value="todos">Todos los SLA</option><option value="vencidos">SLA vencido</option><option value="riesgo">SLA en riesgo</option><option value="cumplidos">SLA cumplido</option></select>
          <select value={category} onChange={(e) => setCategory(e.target.value)}><option value="todas">Todas las categorías</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select value={department} onChange={(e) => setDepartment(e.target.value)}><option value="todos">Todos los departamentos</option>{departments.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}><option value="todos">Todos los responsables</option><option value="sin_asignar">Sin asignar</option>{workload.rows.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
        </div>
        <div className="support-results-head"><span>{filteredTickets.length} ticket{filteredTickets.length === 1 ? '' : 's'}</span><button className="secondary" onClick={() => { setSearch(''); setStatus('todos'); setPriority('todas'); setCategory('todas'); setDepartment('todos'); setSlaFilter('todos'); setAssigneeFilter('todos'); }}>Limpiar filtros</button></div>
        {error && <div className="error">{error}</div>}
        {loading ? <article className="card empty-state"><p>Cargando tickets…</p></article> : filteredTickets.length === 0 ? <article className="card empty-state"><h2>Sin resultados</h2><p>No hay tickets que coincidan con los filtros seleccionados.</p></article> : (
          <div className="support-table-wrap card"><table className="support-table"><thead><tr><th>Ticket</th><th>Solicitante</th><th>Área</th><th>Categoría</th><th>Prioridad</th><th>Estado</th><th>SLA</th><th>Responsable</th><th>Creado</th></tr></thead><tbody>{filteredTickets.map((ticket) => { const sla = slaBadge(ticket); return (
            <tr key={ticket.id} onClick={() => navigate(`/tickets/${ticket.id}`, { state: { from: '/support' } })}>
              <td><strong>{ticket.folio}</strong><span className="table-subtext">{ticket.title}</span></td><td>{requesterLabel(ticket)}</td><td>{ticket.department || '—'}</td><td>{ticket.expand?.category?.name || '—'}</td><td><strong className={`priority-${ticket.priority}`}>{ticket.priority || '—'}</strong></td><td><span className={`status-badge status-${ticket.status}`}>{statusLabels[ticket.status] || ticket.status}</span></td><td><span className={`sla-badge sla-${sla.tone}`}>{sla.label}</span></td><td>{assigneeLabel(ticket)}</td><td>{formatDate(ticket.created)}</td>
            </tr>); })}</tbody></table></div>
        )}
      </section>
    </main>
  );
}
