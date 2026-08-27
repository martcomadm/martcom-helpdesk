import { useMemo } from 'react';

function dateMs(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function localDayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shortDay(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short' }).format(new Date(year, month - 1, day));
}

function dayName(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', { weekday: 'long' }).format(new Date(year, month - 1, day));
}

function TrendChart({ rows }) {
  if (!rows.length) return <div className="metric-empty">Sin datos en este periodo.</div>;
  const max = Math.max(1, ...rows.flatMap((row) => [row.created, row.resolved]));
  return <div className="trend-chart">
    <div className="trend-legend"><span><i className="trend-dot" /> Creados</span><span><i className="trend-dot resolved" /> Resueltos</span></div>
    {rows.map((row) => <div className="trend-row" key={row.key}>
      <span className="trend-label">{shortDay(row.key)}</span>
      <div className="trend-bars"><div className="trend-bar"><span style={{ width: `${(row.created / max) * 100}%` }} /></div><div className="trend-bar resolved"><span style={{ width: `${(row.resolved / max) * 100}%` }} /></div></div>
      <span className="trend-counts">{row.created} / {row.resolved}</span>
    </div>)}
  </div>;
}

export default function TemporalAnalytics({ tickets, period }) {
  const data = useMemo(() => {
    const byDay = new Map();
    const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
    const weekdays = new Map();
    const allTickets = [...tickets];

    allTickets.forEach((ticket) => {
      const created = dateMs(ticket.created);
      if (created == null) return;
      const createdDate = new Date(created);
      const key = localDayKey(createdDate);
      if (!byDay.has(key)) byDay.set(key, { key, created: 0, resolved: 0 });
      byDay.get(key).created += 1;
      hours[createdDate.getHours()].count += 1;
      const weekday = new Intl.DateTimeFormat('es-MX', { weekday: 'long' }).format(createdDate);
      weekdays.set(weekday, (weekdays.get(weekday) || 0) + 1);

      const resolvedValue = ticket.resolved_at || ticket.closed_at;
      if (resolvedValue) {
        const resolvedKey = localDayKey(resolvedValue);
        if (!byDay.has(resolvedKey)) byDay.set(resolvedKey, { key: resolvedKey, created: 0, resolved: 0 });
        byDay.get(resolvedKey).resolved += 1;
      }
    });

    const rows = [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key));
    const visibleRows = period === '7' ? rows.slice(-7) : period === '30' ? rows.slice(-30) : period === '90' ? rows.slice(-30) : rows.slice(-30);
    let backlog = 0;
    const backlogRows = rows.map((row) => { backlog = Math.max(0, backlog + row.created - row.resolved); return { ...row, backlog }; });
    const peakDay = [...rows].sort((a, b) => b.created - a.created)[0] || null;
    const peakHour = [...hours].sort((a, b) => b.count - a.count)[0] || null;
    const peakWeekday = [...weekdays.entries()].sort((a, b) => b[1] - a[1])[0] || null;
    const createdTotal = rows.reduce((sum, row) => sum + row.created, 0);
    const resolvedTotal = rows.reduce((sum, row) => sum + row.resolved, 0);
    const currentOpen = allTickets.filter((ticket) => ['nuevo', 'en_proceso', 'esperando_usuario', 'esperando_tercero'].includes(ticket.status)).length;
    return { visibleRows, backlogRows: backlogRows.slice(-30), hours, peakDay, peakHour, peakWeekday, createdTotal, resolvedTotal, currentOpen };
  }, [tickets, period]);

  const maxHour = Math.max(1, ...data.hours.map((item) => item.count));
  const balance = data.createdTotal - data.resolvedTotal;

  return <>
    <h2 className="dashboard-section-title">Análisis temporal y tendencias</h2>
    <div className="temporal-summary">
      <div className="performance-box"><span>Día con mayor entrada</span><strong>{data.peakDay ? shortDay(data.peakDay.key) : '—'}</strong><small>{data.peakDay ? `${data.peakDay.created} ticket${data.peakDay.created === 1 ? '' : 's'} creado${data.peakDay.created === 1 ? '' : 's'} · ${dayName(data.peakDay.key)}` : 'Sin datos'}</small></div>
      <div className="performance-box"><span>Hora con mayor demanda</span><strong>{data.peakHour?.count ? `${String(data.peakHour.hour).padStart(2, '0')}:00` : '—'}</strong><small>{data.peakHour?.count ? `${data.peakHour.count} ticket${data.peakHour.count === 1 ? '' : 's'} creado${data.peakHour.count === 1 ? '' : 's'}` : 'Sin datos'}</small></div>
      <div className="performance-box"><span>Balance del periodo</span><strong>{balance > 0 ? `+${balance}` : balance}</strong><small>{data.createdTotal} creados · {data.resolvedTotal} resueltos · {data.currentOpen} abiertos actuales</small></div>
    </div>

    <div className="dashboard-grid">
      <article className="card"><div className="dashboard-card-head"><div><p className="eyebrow">TENDENCIA</p><h2>Creados vs. resueltos</h2></div><span>Últimos {data.visibleRows.length} días con actividad</span></div><TrendChart rows={data.visibleRows} /></article>
      <article className="card"><div className="dashboard-card-head"><div><p className="eyebrow">DEMANDA</p><h2>Volumen por hora</h2></div><span>{data.peakWeekday ? `Día fuerte: ${data.peakWeekday[0]}` : ''}</span></div><div className="hour-grid">{data.hours.map((item) => <div className="hour-cell" key={item.hour} title={`${String(item.hour).padStart(2, '0')}:00 · ${item.count} tickets`}><div className="hour-bar-wrap"><div className="hour-bar" style={{ height: `${Math.max(item.count ? 5 : 0, (item.count / maxHour) * 100)}%` }} /></div><span>{String(item.hour).padStart(2, '0')}</span></div>)}</div></article>
    </div>
  </>;
}
