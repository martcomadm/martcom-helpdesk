import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { pb } from '../lib/pocketbase';

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function personName(record) {
  return record?.name || record?.email || 'Soporte';
}

export default function ReopenHistoryPanel() {
  const { id } = useParams();
  const [events, setEvents] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(true);

  async function load() {
    try {
      const records = await pb.collection('hd_ticket_messages').getFullList({
        filter: `ticket = "${id}" && field = "status"`,
        sort: 'created',
        expand: 'author',
      });
      setEvents(records);
    } catch (err) {
      console.warn('No fue posible cargar historial de reaperturas:', err);
    }
  }

  useEffect(() => {
    load();
    let unsubscribe;
    pb.collection('hd_ticket_messages').subscribe('*', (event) => {
      const record = event.record;
      if (record?.ticket === id && record?.field === 'status') load();
    }, { filter: `ticket = "${id}"` })
      .then((fn) => { unsubscribe = fn; })
      .catch((err) => console.warn('Realtime reaperturas:', err));

    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => {
      if (unsubscribe) unsubscribe();
      window.clearInterval(timer);
    };
  }, [id]);

  const cycles = useMemo(() => {
    const terminal = new Set(['resuelto', 'cerrado', 'cancelado']);
    const reopenEvents = events.filter((event) => event.old_value === 'cerrado' && event.new_value === 'en_proceso');
    return reopenEvents.map((event, index) => {
      const start = new Date(event.created).getTime();
      const terminalEvent = events.find((candidate) => {
        const candidateTime = new Date(candidate.created).getTime();
        return candidateTime > start && terminal.has(candidate.new_value);
      });
      const end = terminalEvent ? new Date(terminalEvent.created).getTime() : now;
      return {
        id: event.id,
        number: index + 1,
        start: event.created,
        end: terminalEvent?.created || null,
        endStatus: terminalEvent?.new_value || null,
        durationMs: Math.max(0, end - start),
        author: event.expand?.author,
      };
    });
  }, [events, now]);

  if (!cycles.length) return null;

  const latest = cycles[cycles.length - 1];
  const active = !latest.end;

  return (
    <aside style={{
      position: 'fixed', right: 24, bottom: 24, width: 360, maxWidth: 'calc(100vw - 48px)',
      zIndex: 35, background: '#121d31', border: '1px solid #2a3a57', borderRadius: 14,
      boxShadow: '0 18px 50px rgba(0,0,0,.35)', overflow: 'hidden', color: '#e8edf6',
    }}>
      <button type="button" onClick={() => setOpen((value) => !value)} style={{
        width: '100%', padding: '14px 16px', border: 0, borderRadius: 0, background: '#17243c',
        color: '#e8edf6', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
      }}>
        <span style={{ textAlign: 'left' }}>
          <strong style={{ display: 'block', fontSize: 14 }}>Historial de reaperturas</strong>
          <small style={{ color: '#93a4c1' }}>{cycles.length} reapertura{cycles.length === 1 ? '' : 's'} · Última {formatDate(latest.start)}</small>
        </span>
        <span>{open ? '−' : '+'}</span>
      </button>

      {open && <div style={{ padding: 14, maxHeight: '42vh', overflowY: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div style={{ padding: 10, borderRadius: 10, background: '#0d1628', border: '1px solid #22314c' }}>
            <small style={{ color: '#8798b5' }}>Total</small>
            <strong style={{ display: 'block', marginTop: 3 }}>{cycles.length}</strong>
          </div>
          <div style={{ padding: 10, borderRadius: 10, background: '#0d1628', border: '1px solid #22314c' }}>
            <small style={{ color: '#8798b5' }}>Último ciclo</small>
            <strong style={{ display: 'block', marginTop: 3 }}>{formatDuration(latest.durationMs)}</strong>
          </div>
        </div>

        {active && <div style={{ marginBottom: 10, padding: '9px 10px', borderRadius: 9, background: '#3c3418', color: '#ffe3a3', fontSize: 12 }}>
          La reapertura actual sigue en curso. Este tiempo es operativo y no reinicia el SLA original.
        </div>}

        <div style={{ display: 'grid', gap: 8 }}>
          {[...cycles].reverse().map((cycle) => (
            <div key={cycle.id} style={{ padding: 11, borderRadius: 10, background: '#0d1628', border: '1px solid #22314c' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 5 }}>
                <strong style={{ fontSize: 12 }}>Reapertura #{cycle.number}</strong>
                <span style={{ fontSize: 11, color: cycle.end ? '#b9f3dc' : '#ffe3a3' }}>{cycle.end ? 'Finalizada' : 'En curso'}</span>
              </div>
              <div style={{ fontSize: 11, color: '#9aabc6', lineHeight: 1.55 }}>
                <div>Reabierto: <strong style={{ color: '#dbe4f4' }}>{formatDate(cycle.start)}</strong></div>
                <div>Por: <strong style={{ color: '#dbe4f4' }}>{personName(cycle.author)}</strong></div>
                <div>Duración: <strong style={{ color: '#dbe4f4' }}>{formatDuration(cycle.durationMs)}</strong></div>
                <div>Fin: <strong style={{ color: '#dbe4f4' }}>{cycle.end ? `${cycle.endStatus} · ${formatDate(cycle.end)}` : 'Pendiente'}</strong></div>
              </div>
            </div>
          ))}
        </div>
      </div>}
    </aside>
  );
}
