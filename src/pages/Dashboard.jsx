import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import pb, { currentUser, logout } from '../lib/pocketbase';
import '../dashboard.css';

const PERIODS = [
  { key: '7', label: '7 días', days: 7 },
  { key: '30', label: '30 días', days: 30 },
  { key: '90', label: '90 días', days: 90 },
  { key: 'all', label: 'Todo', days: null },
];

const PRIORITY_HOURS = {
  baja: { response: 8, resolution: 72 },
  media: { response: 4, resolution: 24 },
  alta: { response: 2, resolution: 8 },
  critica: { response: 1, resolution: 4 },
};

function dateMs(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function hoursBetween(a, b) {
  const start = dateMs(a);
  const end = dateMs(b);
  if (start == null || end == null) return null;
  return Math.max(0, (end - start) / 3600000);
}

function formatHours(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value < 1) return `${Math.round(value * 60)} min`;
  return `${value.toFixed(value < 10 ? 1 : 0)} h`;
}

function groupBy(items, getter) {
  const map = new Map();
  items.forEach((item) => {
    const raw = getter(item);
    const key = raw || 'Sin especificar';
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function MetricBars({ data }) {
  if (!data.length) return <div className="metric-empty">Sin datos en este periodo.</div>;
  const max = Math.max(...data.map(([, value]) => value), 1);
  return (
    <div className="metric-list">
      {data.slice(0, 8).map(([label, value]) => (
        <div className="metric-row" key={label}>
          <span className="metric-label" title={label}>{label}</span>
          <div className="metric-bar"><span style={{ width: `${Math.max(3, (value / max) * 100)}%` }} /></div>
          <span className="metric-value">{value}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const user = currentUser();
  const canManage = user?.role === 'admin' || user?.role === 'supervisor';
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('30');
  const [live, setLive] = useState(false);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  async function loadTickets(silent = false) {
    if (!silent) setLoading(true);
    try {
      const options = { sort: '-created', expand: 'requester,category,department,assigned_to' };
      if (!canManage && user?.id) options.filter = `requester = "${user.id}"`;
      const records = await pb.collection('hd_tickets').getFullList(options);
      setTickets(records);
      setError('');
      setLive(true);
    } catch (err) {
      console.error(err);
      setError('No fue posible cargar las métricas del Helpdesk.');
      setLive(false);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadTickets();
    let unsubscribe;
    pb.collection('hd_tickets').subscribe('*', () => loadTickets(true))
      .then((fn) => { unsubscribe = fn; setLive(true); })
      .catch((err) => { console.error('Dashboard realtime:', err); setLive(false); });
    return () => { if (unsubscribe) unsubscribe(); };
  }, []);

  const filtered = useMemo(() => {
    const config = PERIODS.find((item) => item.key === period);
    if (!config?.days) return tickets;
    const cutoff = Date.now() - config.days * 86400000;
    return tickets.filter((ticket) => (dateMs(ticket.created) || 0) >= cutoff);
  }, [tickets, period]);

  const metrics = useMemo(() => {
    const now = Date.now();
    const openStatuses = new Set(['nuevo', 'en_proceso', 'esperando_usuario', 'esperando_tercero']);
    const open = filtered.filter((t) => openStatuses.has(t.status));
    const resolved = filtered.filter((t) => t.resolved_at || t.status === 'resuelto' || t.status === 'cerrado');
    const responseSamples = filtered.map((t) => hoursBetween(t.created, t.first_response_at)).filter((v) => v != null);
    const resolutionSamples = resolved.map((t) => hoursBetween(t.created, t.resolved_at || t.closed_at)).filter((v) => v != null);
    const avgResponse = responseSamples.length ? responseSamples.reduce((a, b) => a + b, 0) / responseSamples.length : null;
    const avgResolution = resolutionSamples.length ? resolutionSamples.reduce((a, b) => a + b, 0) / resolutionSamples.length : null;

    let evaluated = 0;
    let compliant = 0;
    let breachedOpen = 0;
    let atRisk = 0;

    filtered.forEach((t) => {
      const sla = PRIORITY_HOURS[t.priority] || PRIORITY_HOURS.media;
      const created = dateMs(t.created);
      if (created == null) return;
      const responseHours = hoursBetween(t.created, t.first_response_at);
      const resolutionHours = hoursBetween(t.created, t.resolved_at || t.closed_at);
      const ageHours = Math.max(0, (now - created) / 3600000);
      const responseBreached = t.first_response_at ? responseHours > sla.response : ageHours > sla.response;
      const resolutionDone = !!(t.resolved_at || t.closed_at || t.status === 'resuelto' || t.status === 'cerrado');
      const resolutionBreached = resolutionDone ? (resolutionHours != null && resolutionHours > sla.resolution) : ageHours > sla.resolution;
      const responseEvaluable = !!t.first_response_at;
      const resolutionEvaluable = resolutionDone && resolutionHours != null;
      if (responseEvaluable) { evaluated += 1; if (!responseBreached) compliant += 1; }
      if (resolutionEvaluable) { evaluated += 1; if (!resolutionBreached) compliant += 1; }
      if (openStatuses.has(t.status) && (responseBreached || resolutionBreached)) breachedOpen += 1;
      else if (openStatuses.has(t.status) && ageHours >= sla.resolution * 0.8) atRisk += 1;
    });

    return {
      total: filtered.length,
      open: open.length,
      resolved: resolved.length,
      breachedOpen,
      atRisk,
      avgResponse,
      avgResolution,
      compliance: evaluated ? (compliant / evaluated) * 100 : null,
      categories: groupBy(filtered, (t) => t.expand?.category?.name || t.category_name),
      departments: groupBy(filtered, (t) => t.expand?.department?.name || t.department_name),
      priorities: groupBy(filtered, (t) => t.priority ? t.priority.charAt(0).toUpperCase() + t.priority.slice(1) : ''),
      recent: [...filtered].sort((a, b) => (dateMs(b.created) || 0) - (dateMs(a.created) || 0)).slice(0, 8),
    };
  }, [filtered]);

  function ticketSla(ticket) {
    const sla = PRIORITY_HOURS[ticket.priority] || PRIORITY_HOURS.media;
    const created = dateMs(ticket.created);
    if (created == null) return { label: 'Sin dato', cls: 'ok' };
    const age = (Date.now() - created) / 3600000;
    const done = ticket.resolved_at || ticket.closed_at || ticket.status === 'resuelto' || ticket.status === 'cerrado';
    const resolution = done ? hoursBetween(ticket.created, ticket.resolved_at || ticket.closed_at) : age;
    if (resolution > sla.resolution) return { label: 'Vencido', cls: 'breached' };
    if (!done && resolution >= sla.resolution * 0.8) return { label: 'En riesgo', cls: 'warning' };
    return { label: done ? 'Cumplido' : 'Dentro', cls: done ? 'met' : 'ok' };
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">MARTCOM</p>
          <h2>Soporte IT</h2>
          <nav>
            <a className="active" onClick={() => navigate('/')}>Dashboard</a>
            <a onClick={() => navigate('/tickets/new')}>Crear ticket</a>
            <a onClick={() => navigate('/tickets/mine')}>Mis tickets</a>
            {canManage && <a onClick={() => navigate('/support')}>Panel de soporte</a>}
          </nav>
        </div>
        <button className="secondary" onClick={handleLogout}>Cerrar sesión</button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="muted">Mesa de ayuda · Métricas</p>
            <h1>{canManage ? 'Dashboard ejecutivo' : `Hola, ${user?.name || user?.email}`}</h1>
            <p className="muted">{canManage ? 'Rendimiento, carga operativa y cumplimiento de SLA.' : 'Resumen de tus solicitudes de soporte.'}</p>
          </div>
          <div className="dashboard-header-actions">
            <span className={`dashboard-live ${live ? 'online' : ''}`}>● {live ? 'En vivo' : 'Sin realtime'}</span>
            <span className="role-badge">{user?.role || 'empleado'}</span>
          </div>
        </header>

        <div className="card dashboard-filters">
          <div>
            {PERIODS.map((item) => <button key={item.key} className={period === item.key ? 'active' : ''} onClick={() => setPeriod(item.key)}>{item.label}</button>)}
          </div>
          <span className="dashboard-period">{loading ? 'Actualizando…' : `${metrics.total} tickets analizados`}</span>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="stats-grid dashboard-kpis">
          <article className="card kpi-card"><span>Tickets creados</span><strong>{metrics.total}</strong><small>Periodo seleccionado</small></article>
          <article className="card kpi-card"><span>Abiertos</span><strong>{metrics.open}</strong><small>Pendientes de cierre</small></article>
          <article className="card kpi-card kpi-success"><span>Resueltos</span><strong>{metrics.resolved}</strong><small>Resueltos o cerrados</small></article>
          <article className="card kpi-card kpi-danger"><span>SLA vencido</span><strong>{metrics.breachedOpen}</strong><small>{metrics.atRisk} actualmente en riesgo</small></article>
          <article className="card kpi-card"><span>Cumplimiento SLA</span><strong>{metrics.compliance == null ? '—' : `${metrics.compliance.toFixed(0)}%`}</strong><small>Objetivos ya evaluables</small></article>
        </div>

        <div className="dashboard-grid">
          <article className="card">
            <div className="dashboard-card-head"><div><p className="eyebrow">DISTRIBUCIÓN</p><h2>Tickets por categoría</h2></div><span>Top 8</span></div>
            <MetricBars data={metrics.categories} />
          </article>
          <article className="card">
            <div className="dashboard-card-head"><div><p className="eyebrow">DESEMPEÑO</p><h2>Tiempos y cumplimiento</h2></div></div>
            <div className="dashboard-performance">
              <div className="performance-box"><span>Primera respuesta promedio</span><strong>{formatHours(metrics.avgResponse)}</strong><small>Tickets con primera respuesta</small></div>
              <div className="performance-box"><span>Resolución promedio</span><strong>{formatHours(metrics.avgResolution)}</strong><small>Tickets resueltos</small></div>
              <div className="performance-box"><span>En riesgo</span><strong>{metrics.atRisk}</strong><small>≥ 80% del objetivo</small></div>
              <div className="performance-box"><span>SLA vencidos abiertos</span><strong>{metrics.breachedOpen}</strong><small>Requieren atención</small></div>
            </div>
          </article>
        </div>

        {canManage && <div className="dashboard-grid">
          <article className="card"><div className="dashboard-card-head"><div><p className="eyebrow">OPERACIÓN</p><h2>Tickets por departamento</h2></div></div><MetricBars data={metrics.departments} /></article>
          <article className="card"><div className="dashboard-card-head"><div><p className="eyebrow">IMPACTO</p><h2>Tickets por prioridad</h2></div></div><MetricBars data={metrics.priorities} /></article>
        </div>}

        <h2 className="dashboard-section-title">Actividad reciente</h2>
        <article className="card dashboard-table-wrap">
          {metrics.recent.length ? <table className="dashboard-table">
            <thead><tr><th>Ticket</th><th>Prioridad</th><th>Estado</th><th>SLA</th>{canManage && <th>Responsable</th>}<th>Creado</th></tr></thead>
            <tbody>{metrics.recent.map((ticket) => {
              const sla = ticketSla(ticket);
              return <tr key={ticket.id} onClick={() => navigate(`/tickets/${ticket.id}`)}>
                <td><strong>{ticket.folio || ticket.id}</strong><span className="sub">{ticket.subject}</span></td>
                <td><strong className={`priority-${ticket.priority}`}>{ticket.priority || '—'}</strong></td>
                <td><span className={`status-badge status-${ticket.status}`}>{(ticket.status || '—').replaceAll('_', ' ')}</span></td>
                <td><span className={`sla-mini ${sla.cls}`}>{sla.label}</span></td>
                {canManage && <td>{ticket.expand?.assigned_to?.name || 'Sin asignar'}</td>}
                <td>{new Date(ticket.created).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}</td>
              </tr>;
            })}</tbody>
          </table> : <div className="metric-empty">No hay tickets en este periodo.</div>}
        </article>
        <p className="dashboard-note">Las métricas se actualizan automáticamente cuando cambia un ticket.</p>
      </section>
    </main>
  );
}
