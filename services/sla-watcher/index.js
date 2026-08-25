const PB_URL = (process.env.PB_URL || '').replace(/\/$/, '');
const PB_EMAIL = process.env.PB_SUPERUSER_EMAIL || '';
const PB_PASSWORD = process.env.PB_SUPERUSER_PASSWORD || '';
const INTERVAL_MS = Math.max(60000, Number(process.env.SLA_WATCH_INTERVAL_MS || 60000));

const POLICY = {
  critica: { firstResponseHours: 1, resolutionHours: 4 },
  alta: { firstResponseHours: 2, resolutionHours: 8 },
  media: { firstResponseHours: 4, resolutionHours: 24 },
  baja: { firstResponseHours: 8, resolutionHours: 48 },
};
const TERMINAL = new Set(['resuelto', 'cerrado', 'cancelado']);
let token = '';

function requireConfig() {
  const missing = [];
  if (!PB_URL) missing.push('PB_URL');
  if (!PB_EMAIL) missing.push('PB_SUPERUSER_EMAIL');
  if (!PB_PASSWORD) missing.push('PB_SUPERUSER_PASSWORD');
  if (missing.length) throw new Error(`Faltan variables: ${missing.join(', ')}`);
}

async function authenticate() {
  const res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASSWORD }),
  });
  if (!res.ok) throw new Error(`PocketBase auth ${res.status}: ${await res.text()}`);
  token = (await res.json()).token;
}

async function pb(path, options = {}, retry = true) {
  if (!token) await authenticate();
  const headers = { ...(options.headers || {}), Authorization: token };
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${PB_URL}${path}`, { ...options, headers });
  if (res.status === 401 && retry) { token = ''; await authenticate(); return pb(path, options, false); }
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path} ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

function hoursMs(hours) { return hours * 3600000; }
function stateFor(created, hours, actualAt) {
  if (actualAt) return 'done';
  const total = hoursMs(hours);
  const remaining = new Date(created).getTime() + total - Date.now();
  if (remaining < 0) return 'breached';
  if (remaining <= total * 0.25) return 'warning';
  return 'ok';
}

async function getLeadershipRecipients() {
  const params = new URLSearchParams({ page: '1', perPage: '200', filter: 'active = true && (role = "admin" || role = "supervisor")' });
  const data = await pb(`/api/collections/hd_users/records?${params}`);
  return data.items.map((u) => u.id);
}

async function getSupportRecipients(ticket) {
  if (ticket.assigned_to) return [ticket.assigned_to];
  return getLeadershipRecipients();
}

async function getEscalationRecipients(ticket) {
  const leadership = await getLeadershipRecipients();
  return [...new Set([ticket.assigned_to, ...leadership].filter(Boolean))];
}

async function notifyRecipients(ticket, recipients, type, title, message) {
  for (const recipient of recipients) {
    await pb('/api/collections/hd_notifications/records', {
      method: 'POST', body: JSON.stringify({ recipient, ticket: ticket.id, type, title, message, read: false }),
    });
  }
}

async function notify(ticket, type, title, message) {
  const recipients = await getSupportRecipients(ticket);
  await notifyRecipients(ticket, recipients, type, title, message);
}

async function escalate(ticket, label) {
  const recipients = await getEscalationRecipients(ticket);
  const ownerText = ticket.assigned_to
    ? 'El responsable y liderazgo de soporte han sido notificados.'
    : 'El ticket continúa sin responsable; liderazgo de soporte ha sido notificado.';

  await notifyRecipients(
    ticket,
    recipients,
    'sla_breached',
    `ESCALAMIENTO SLA: ${ticket.folio}`,
    `El objetivo de ${label} ha vencido. ${ownerText}`,
  );
}

async function patchTicket(ticketId, data) {
  await pb(`/api/collections/hd_tickets/records/${ticketId}`, { method: 'PATCH', body: JSON.stringify(data) });
}

async function processTarget(ticket, kind, state, flagWarning, flagBreached) {
  const label = kind === 'response' ? 'primera respuesta' : 'resolución';
  if (state === 'warning' && !ticket[flagWarning]) {
    await notify(ticket, 'sla_warning', `SLA en riesgo: ${ticket.folio}`, `El objetivo de ${label} está próximo a vencer.`);
    await patchTicket(ticket.id, { [flagWarning]: true });
    ticket[flagWarning] = true;
    console.log(`[SLA] WARNING ${ticket.folio} ${label}`);
  }
  if (state === 'breached' && !ticket[flagBreached]) {
    await escalate(ticket, label);
    await patchTicket(ticket.id, { [flagBreached]: true });
    ticket[flagBreached] = true;
    console.log(`[SLA] ESCALATED ${ticket.folio} ${label}`);
  }
}

async function run() {
  const params = new URLSearchParams({ page: '1', perPage: '500', filter: 'status != "resuelto" && status != "cerrado" && status != "cancelado"', sort: 'created' });
  const data = await pb(`/api/collections/hd_tickets/records?${params}`);
  for (const ticket of data.items) {
    if (TERMINAL.has(ticket.status)) continue;
    const policy = POLICY[ticket.priority] || POLICY.media;
    const response = stateFor(ticket.created, policy.firstResponseHours, ticket.first_response_at);
    const resolution = stateFor(ticket.created, policy.resolutionHours, ticket.resolved_at || ticket.closed_at);
    await processTarget(ticket, 'response', response, 'sla_response_warning_sent', 'sla_response_breached_sent');
    await processTarget(ticket, 'resolution', resolution, 'sla_resolution_warning_sent', 'sla_resolution_breached_sent');
  }
}

async function cycle() {
  try { await run(); }
  catch (err) { console.error('[SLA] Error:', err); }
}

requireConfig();
console.log(`[SLA] Watcher iniciado. Intervalo: ${INTERVAL_MS / 1000}s`);
await cycle();
setInterval(cycle, INTERVAL_MS);
