export const SLA_POLICY = {
  critica: { firstResponseHours: 1, resolutionHours: 4 },
  alta: { firstResponseHours: 2, resolutionHours: 8 },
  media: { firstResponseHours: 4, resolutionHours: 24 },
  baja: { firstResponseHours: 8, resolutionHours: 48 },
};

const CLOSED_STATUSES = ['resuelto', 'cerrado', 'cancelado'];

function hoursToMs(hours) {
  return hours * 60 * 60 * 1000;
}

function diffMs(from, to) {
  return new Date(to).getTime() - new Date(from).getTime();
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '—';
  const sign = ms < 0 ? '-' : '';
  const totalMinutes = Math.max(0, Math.round(Math.abs(ms) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${sign}${days}d ${hours}h`;
  if (hours > 0) return `${sign}${hours}h ${minutes}m`;
  return `${sign}${minutes}m`;
}

export function getSlaPolicy(priority = 'media') {
  return SLA_POLICY[priority] || SLA_POLICY.media;
}

function calculateTarget(created, targetHours, actualAt, now = new Date()) {
  const targetAt = new Date(new Date(created).getTime() + hoursToMs(targetHours));
  const endAt = actualAt ? new Date(actualAt) : now;
  const elapsedMs = diffMs(created, endAt);
  const targetMs = hoursToMs(targetHours);
  const remainingMs = targetAt.getTime() - endAt.getTime();
  const met = actualAt ? elapsedMs <= targetMs : null;
  const breached = actualAt ? !met : remainingMs < 0;
  const warning = !actualAt && !breached && remainingMs <= targetMs * 0.25;

  return {
    targetAt,
    targetHours,
    actualAt: actualAt || null,
    elapsedMs,
    remainingMs,
    met,
    breached,
    warning,
  };
}

export function getTicketSla(ticket, now = new Date()) {
  if (!ticket?.created) return null;
  const policy = getSlaPolicy(ticket.priority);
  const response = calculateTarget(ticket.created, policy.firstResponseHours, ticket.first_response_at, now);
  const resolutionActual = ticket.resolved_at || ticket.closed_at || null;
  const resolution = calculateTarget(ticket.created, policy.resolutionHours, resolutionActual, now);
  const terminal = CLOSED_STATUSES.includes(ticket.status);

  let overall = 'ok';
  if (response.breached || (!terminal && resolution.breached) || (resolution.actualAt && resolution.breached)) overall = 'breached';
  else if (response.warning || (!terminal && resolution.warning)) overall = 'warning';
  else if (terminal && response.met !== false && resolution.met !== false) overall = 'met';

  return { policy, response, resolution, overall, terminal };
}

export function slaBadge(ticket, now = new Date()) {
  const sla = getTicketSla(ticket, now);
  if (!sla) return { label: '—', tone: 'neutral' };

  if (sla.overall === 'breached') {
    const activeTarget = !sla.response.actualAt && sla.response.breached ? sla.response : sla.resolution;
    return { label: `Vencido ${formatDuration(Math.abs(activeTarget.remainingMs))}`, tone: 'breached' };
  }
  if (sla.overall === 'warning') {
    const activeTarget = !sla.response.actualAt ? sla.response : sla.resolution;
    return { label: `En riesgo ${formatDuration(activeTarget.remainingMs)}`, tone: 'warning' };
  }
  if (sla.overall === 'met') return { label: 'SLA cumplido', tone: 'met' };

  const activeTarget = !sla.response.actualAt ? sla.response : sla.resolution;
  return { label: `Dentro ${formatDuration(activeTarget.remainingMs)}`, tone: 'ok' };
}
