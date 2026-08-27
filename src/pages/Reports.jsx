import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { currentUser, logout, pb } from '../lib/pocketbase';
import '../reports.css';

const STATUS_LABELS = {
  nuevo: 'Nuevo', en_proceso: 'En proceso', esperando_usuario: 'Esperando usuario',
  esperando_tercero: 'Esperando tercero', resuelto: 'Resuelto', cerrado: 'Cerrado', cancelado: 'Cancelado',
};
const PRIORITY_LABELS = { baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Crítica' };
const PRIORITY_HOURS = {
  baja: { response: 8, resolution: 48 }, media: { response: 4, resolution: 24 },
  alta: { response: 2, resolution: 8 }, critica: { response: 1, resolution: 4 },
};
const OPEN = new Set(['nuevo', 'en_proceso', 'esperando_usuario', 'esperando_tercero']);

function ms(value) { const n = value ? new Date(value).getTime() : NaN; return Number.isFinite(n) ? n : null; }
function hours(a, b) { const x = ms(a); const y = ms(b); return x == null || y == null ? null : Math.max(0, (y - x) / 3600000); }
function avg(values) { const clean = values.filter((v) => v != null && Number.isFinite(v)); return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null; }
function fmtHours(value) { if (value == null) return '—'; if (value < 1) return `${Math.round(value * 60)} min`; return `${value.toFixed(value < 10 ? 1 : 0)} h`; }
function fmtDate(value) { if (!value) return '—'; return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function isoDate(date) { return date.toISOString().slice(0, 10); }
function csvEscape(value) { const s = String(value ?? ''); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; }

export default function Reports() {
  const navigate = useNavigate();
  const user = currentUser();
  const canManage = user?.role === 'admin' || user?.role === 'supervisor';
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [tickets, setTickets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(isoDate(monthStart));
  const [to, setTo] = useState(isoDate(today));
  const [assignee, setAssignee] = useState('todos');
  const [department, setDepartment] = useState('todos');
  const [category, setCategory] = useState('todas');
  const [status, setStatus] = useState('todos');
  const [priority, setPriority] = useState('todas');

  useEffect(() => {
    async function load() {
      try {
        const [ticketRows, categoryRows, userRows] = await Promise.all([
          pb.collection('hd_tickets').getFullList({ sort: '-created', expand: 'requester,category,assigned_to' }),
          pb.collection('hd_categories').getFullList({ sort: 'order,name' }),
          pb.collection('hd_users').getFullList({ filter: 'active = true', sort: 'name,email' }),
        ]);
        setTickets(ticketRows); setCategories(categoryRows); setUsers(userRows);
      } catch (err) {
        console.error(err); setError(err?.response?.message || err?.message || 'No fue posible cargar los datos del reporte.');
      } finally { setLoading(false); }
    }
    if (canManage) load();
  }, [canManage]);

  const supportUsers = useMemo(() => users.filter((item) => ['admin', 'supervisor', 'soporte'].includes(item.role)), [users]);
  const departments = useMemo(() => [...new Set(tickets.map((t) => t.department).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [tickets]);

  const filtered = useMemo(() => {
    const start = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity;
    const end = to ? new Date(`${to}T23:59:59.999`).getTime() : Infinity;
    return tickets.filter((ticket) => {
      const created = ms(ticket.created) || 0;
      return created >= start && created <= end
        && (assignee === 'todos' || (assignee === 'sin_asignar' ? !ticket.assigned_to : ticket.assigned_to === assignee))
        && (department === 'todos' || ticket.department === department)
        && (category === 'todas' || ticket.category === category)
        && (status === 'todos' || ticket.status === status)
        && (priority === 'todas' || ticket.priority === priority);
    });
  }, [tickets, from, to, assignee, department, category, status, priority]);

  const summary = useMemo(() => {
    const resolved = filtered.filter((t) => t.status === 'resuelto' || t.status === 'cerrado');
    const open = filtered.filter((t) => OPEN.has(t.status));
    const responseTimes = filtered.map((t) => hours(t.created, t.first_response_at));
    const resolutionTimes = resolved.map((t) => hours(t.created, t.resolved_at || t.closed_at));
    let evaluated = 0; let compliant = 0; let breached = 0;
    filtered.forEach((ticket) => {
      const policy = PRIORITY_HOURS[ticket.priority] || PRIORITY_HOURS.media;
      const response = hours(ticket.created, ticket.first_response_at);
      const resolution = hours(ticket.created, ticket.resolved_at || ticket.closed_at);
      if (response != null) { evaluated += 1; if (response <= policy.response) compliant += 1; else breached += 1; }
      if (resolution != null && (ticket.status === 'resuelto' || ticket.status === 'cerrado')) { evaluated += 1; if (resolution <= policy.resolution) compliant += 1; else breached += 1; }
    });
    return {
      total: filtered.length, open: open.length, resolved: resolved.length,
      avgResponse: avg(responseTimes), avgResolution: avg(resolutionTimes),
      compliance: evaluated ? (compliant / evaluated) * 100 : null, breached,
    };
  }, [filtered]);

  const agentRows = useMemo(() => supportUsers.map((member) => {
    const own = filtered.filter((ticket) => ticket.assigned_to === member.id);
    if (!own.length) return null;
    const resolved = own.filter((ticket) => ticket.status === 'resuelto' || ticket.status === 'cerrado');
    return {
      id: member.id, name: member.name || member.email, total: own.length, resolved: resolved.length,
      open: own.filter((ticket) => OPEN.has(ticket.status)).length,
      response: avg(own.map((ticket) => hours(ticket.created, ticket.first_response_at))),
      resolution: avg(resolved.map((ticket) => hours(ticket.created, ticket.resolved_at || ticket.closed_at))),
    };
  }).filter(Boolean).sort((a, b) => b.resolved - a.resolved || b.total - a.total), [supportUsers, filtered]);

  function resetFilters() {
    setFrom(isoDate(monthStart)); setTo(isoDate(today)); setAssignee('todos'); setDepartment('todos');
    setCategory('todas'); setStatus('todos'); setPriority('todas');
  }

  function exportCsv() {
    const headers = ['Folio','Asunto','Solicitante','Departamento','Categoría','Prioridad','Estado','Responsable','Creado','Primera respuesta','Resuelto','Cerrado','Tiempo primera respuesta (h)','Tiempo resolución (h)'];
    const rows = filtered.map((ticket) => [
      ticket.folio, ticket.title, ticket.expand?.requester?.name || ticket.expand?.requester?.email || '',
      ticket.department, ticket.expand?.category?.name || '', PRIORITY_LABELS[ticket.priority] || ticket.priority,
      STATUS_LABELS[ticket.status] || ticket.status, ticket.expand?.assigned_to?.name || ticket.expand?.assigned_to?.email || 'Sin asignar',
      fmtDate(ticket.created), fmtDate(ticket.first_response_at), fmtDate(ticket.resolved_at), fmtDate(ticket.closed_at),
      hours(ticket.created, ticket.first_response_at)?.toFixed(2) || '', hours(ticket.created, ticket.resolved_at || ticket.closed_at)?.toFixed(2) || '',
    ]);
    const csv = '\ufeff' + [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `reporte-helpdesk-${from || 'inicio'}-${to || 'fin'}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  function handleLogout() { logout(); navigate('/login'); }
  if (!canManage) return <Navigate to="/" replace />;

  return <main className="app-shell reports-page">
    <aside className="sidebar print-hide"><div><p className="eyebrow">MARTCOM</p><h2>Soporte IT</h2><nav><a onClick={() => navigate('/')}>Dashboard</a><a onClick={() => navigate('/tickets/new')}>Crear ticket</a><a onClick={() => navigate('/tickets/mine')}>Mis tickets</a><a onClick={() => navigate('/support')}>Panel de soporte</a><a className="active">Reportes</a></nav></div><button className="secondary" onClick={handleLogout}>Cerrar sesión</button></aside>
    <section className="content">
      <header className="topbar reports-header"><div><p className="muted">Mesa de ayuda · Dirección</p><h1>Reportes ejecutivos</h1><p className="muted">Indicadores, desempeño y detalle operativo del Helpdesk.</p></div><div className="report-actions print-hide"><button className="secondary" onClick={() => window.print()}>Imprimir / Guardar PDF</button><button onClick={exportCsv} disabled={!filtered.length}>Exportar CSV</button></div></header>

      <article className="card report-filters print-hide">
        <label>Desde<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Hasta<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label>Responsable<select value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="todos">Todos</option><option value="sin_asignar">Sin asignar</option>{supportUsers.map((item) => <option key={item.id} value={item.id}>{item.name || item.email}</option>)}</select></label>
        <label>Departamento<select value={department} onChange={(e) => setDepartment(e.target.value)}><option value="todos">Todos</option>{departments.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>Categoría<select value={category} onChange={(e) => setCategory(e.target.value)}><option value="todas">Todas</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Estado<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="todos">Todos</option>{Object.entries(STATUS_LABELS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Prioridad<select value={priority} onChange={(e) => setPriority(e.target.value)}><option value="todas">Todas</option>{Object.entries(PRIORITY_LABELS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <button className="secondary" onClick={resetFilters}>Restablecer</button>
      </article>

      {error && <div className="error">{error}</div>}
      <div className="report-print-title"><strong>Afiliaciones MARTCOM · Reporte Helpdesk</strong><span>Periodo: {from || 'inicio'} a {to || 'fin'} · Generado: {new Date().toLocaleString('es-MX')}</span></div>

      <div className="stats-grid report-kpis">
        <article className="card"><span>Tickets</span><strong>{loading ? '…' : summary.total}</strong><small>Dentro de filtros</small></article>
        <article className="card"><span>Abiertos</span><strong>{summary.open}</strong><small>Pendientes operativos</small></article>
        <article className="card"><span>Resueltos</span><strong>{summary.resolved}</strong><small>Resueltos + cerrados</small></article>
        <article className="card"><span>Cumplimiento SLA</span><strong>{summary.compliance == null ? '—' : `${summary.compliance.toFixed(0)}%`}</strong><small>{summary.breached} objetivos incumplidos</small></article>
        <article className="card"><span>1ª respuesta promedio</span><strong>{fmtHours(summary.avgResponse)}</strong><small>Tickets respondidos</small></article>
        <article className="card"><span>Resolución promedio</span><strong>{fmtHours(summary.avgResolution)}</strong><small>Tickets finalizados</small></article>
      </div>

      <h2 className="dashboard-section-title">Desempeño por responsable</h2>
      <article className="card report-table-wrap"><table className="report-table"><thead><tr><th>Responsable</th><th>Asignados</th><th>Resueltos</th><th>Abiertos</th><th>1ª respuesta prom.</th><th>Resolución prom.</th></tr></thead><tbody>{agentRows.length ? agentRows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.total}</td><td>{row.resolved}</td><td>{row.open}</td><td>{fmtHours(row.response)}</td><td>{fmtHours(row.resolution)}</td></tr>) : <tr><td colSpan="6" className="report-empty">Sin datos de responsables para estos filtros.</td></tr>}</tbody></table></article>

      <h2 className="dashboard-section-title">Detalle de tickets</h2>
      <article className="card report-table-wrap"><table className="report-table report-detail-table"><thead><tr><th>Ticket</th><th>Departamento</th><th>Categoría</th><th>Prioridad</th><th>Estado</th><th>Responsable</th><th>Creado</th></tr></thead><tbody>{filtered.length ? filtered.map((ticket) => <tr key={ticket.id} onClick={() => navigate(`/tickets/${ticket.id}`)}><td><strong>{ticket.folio}</strong><span>{ticket.title}</span></td><td>{ticket.department || '—'}</td><td>{ticket.expand?.category?.name || '—'}</td><td>{PRIORITY_LABELS[ticket.priority] || ticket.priority}</td><td>{STATUS_LABELS[ticket.status] || ticket.status}</td><td>{ticket.expand?.assigned_to?.name || ticket.expand?.assigned_to?.email || 'Sin asignar'}</td><td>{fmtDate(ticket.created)}</td></tr>) : <tr><td colSpan="7" className="report-empty">No hay tickets que coincidan con los filtros.</td></tr>}</tbody></table></article>
    </section>
  </main>;
}
