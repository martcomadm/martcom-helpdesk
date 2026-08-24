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

function calculateTarget(created, targetHours, actualAt) {
  const createdAt = new Date(created);
  const targetAt = new Date(createdAt.getTime() + hoursToMs(targetHours));
  const targetMs = hoursToMs(targetHours);
  const fixedActualAt = actualAt ? new Date(actualAt) : null;

  const getEndAt = () => fixedActualAt || new Date();
  const getElapsedMs = () => diffMs(createdAt, getEndAt());
  const getRemainingMs = () => targetAt.getTime() - getEndAt().getTime();
  const getMet = () => fixedActualAt ? getElapsedMs() <= targetMs : null;
  const getBreached = () => fixedActualAt ? !getMet() : getRemainingMs() < 0;
  const getWarning = () => !fixedActualAt && !getBreached() && getRemainingMs() <= targetMs * 0.25;

  return {
    targetAt,
    targetHours,
    actualAt: actualAt || null,
    get elapsedMs() { return getElapsedMs(); },
    get remainingMs() { return getRemainingMs(); },
    get met() { return getMet(); },
    get breached() { return getBreached(); },
    get warning() { return getWarning(); },
  };
}

export function getTicketSla(ticket) {
  if (!ticket?.created) return null;
  const policy = getSlaPolicy(ticket.priority);
  const response = calculateTarget(ticket.created, policy.firstResponseHours, ticket.first_response_at);
  const resolutionActual = ticket.resolved_at || ticket.closed_at || null;
  const resolution = calculateTarget(ticket.created, policy.resolutionHours, resolutionActual);
  const terminal = CLOSED_STATUSES.includes(ticket.status);

  const getOverall = () => {
    if (response.breached || (!terminal && resolution.breached) || (resolution.actualAt && resolution.breached)) return 'breached';
    if (response.warning || (!terminal && resolution.warning)) return 'warning';
    if (terminal && response.met !== false && resolution.met !== false) return 'met';
    return 'ok';
  };

  return {
    policy,
    response,
    resolution,
    terminal,
    get overall() { return getOverall(); },
  };
}

export function slaBadge(ticket) {
  const sla = getTicketSla(ticket);
  if (!sla) return { label: '—', tone: 'neutral' };

  return {
    get tone() {
      if (sla.overall === 'breached') return 'breached';
      if (sla.overall === 'warning') return 'warning';
      if (sla.overall === 'met') return 'met';
      return 'ok';
    },
    get label() {
      if (sla.overall === 'breached') {
        const activeTarget = !sla.response.actualAt && sla.response.breached ? sla.response : sla.resolution;
        return `Vencido ${formatDuration(Math.abs(activeTarget.remainingMs))}`;
      }
      if (sla.overall === 'warning') {
        const activeTarget = !sla.response.actualAt ? sla.response : sla.resolution;
        return `En riesgo ${formatDuration(activeTarget.remainingMs)}`;
      }
      if (sla.overall === 'met') return 'SLA cumplido';
      const activeTarget = !sla.response.actualAt ? sla.response : sla.resolution;
      return `Dentro ${formatDuration(activeTarget.remainingMs)}`;
    },
  };
}
