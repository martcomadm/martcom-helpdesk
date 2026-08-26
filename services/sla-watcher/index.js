const PB_URL = (process.env.PB_URL || '').replace(/\/$/, '');
const PB_EMAIL = process.env.PB_SUPERUSER_EMAIL || '';
const PB_PASSWORD = process.env.PB_SUPERUSER_PASSWORD || '';
const INTERVAL_MS = Math.max(60000, Number(process.env.SLA_WATCH_INTERVAL_MS || 60000));
const AUTO_CLOSE_HOURS = Math.max(1, Number(process.env.AUTO_CLOSE_RESOLVED_HOURS || 24));
const WAITING_REMINDER_HOURS = Math.max(1, Number(process.env.WAITING_USER_REMINDER_HOURS || 24));
const WAITING_RESOLVE_HOURS = Math.max(WAITING_REMINDER_HOURS + 1, Number(process.env.WAITING_USER_AUTO_RESOLVE_HOURS || 72));

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

async function notifyRequester(ticket, type, title, message) {
  if (!ticket.requester) return;
  await notifyRecipients(ticket, [ticket.requester], type, title, message);
}

async function escalate(ticket, label) {
  const recipients = await getEscalationRecipients(ticket);
  const ownerText = ticket.assigned_to
    ? 'El responsable y liderazgo de soporte han sido notificados.'
    : 'El ticket continúa sin responsable; liderazgo de soporte ha sido notificado.';
  await notifyRecipients(ticket, recipients, 'sla_breached', `ESCALAMIENTO SLA: ${ticket.folio}`, `El objetivo de ${label} ha vencido. ${ownerText}`);
}

async function patchTicket(ticketId, data) {
  await pb(`/api/collections/hd_tickets/records/${ticketId}`, { method: 'PATCH', body: JSON.stringify(data) });
}

async function createSystemEvent(ticket, message, oldStatus = '', newStatus = '') {
  const author = ticket.assigned_to || ticket.requester;
  if (!author) {
    console.warn(`[SYSTEM] ${ticket.folio} sin autor disponible para bitácora.`);
    return;
  }
  await pb('/api/collections/hd_ticket_messages/records', {
    method: 'POST',
    body: JSON.stringify({
      ticket: ticket.id,
      author,
      type: 'system',
      message,
      field: oldStatus || newStatus ? 'status' : '',
      old_value: oldStatus,
      new_value: newStatus,
      internal: false,
    }),
  });
}

async function hasSystemEvent(ticketId, marker) {
  const filter = `ticket = "${ticketId}" && type = "system" && message ~ "${marker}"`;
  const params = new URLSearchParams({ page: '1', perPage: '1', filter });
  const data = await pb(`/api/collections/hd_ticket_messages/records?${params}`);
  return data.items.length > 0;
}

async function getLastRequesterMessageAt(ticket) {
  const filter = `ticket = "${ticket.id}" && author = "${ticket.requester}" && type = "message" && internal = false`;
  const params = new URLSearchParams({ page: '1', perPage: '1', filter, sort: '-created' });
  const data = await pb(`/api/collections/hd_ticket_messages/records?${params}`);
  return data.items[0]?.created || '';
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

async function processSla() {
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

async function processWaitingUser() {
  const params = new URLSearchParams({ page: '1', perPage: '500', filter: 'status = "esperando_usuario"', sort: 'updated' });
  const data = await pb(`/api/collections/hd_tickets/records?${params}`);
  const reminderMs = hoursMs(WAITING_REMINDER_HOURS);
  const resolveMs = hoursMs(WAITING_RESOLVE_HOURS);

  for (const ticket of data.items) {
    const waitingSince = new Date(ticket.updated).getTime();
    if (!Number.isFinite(waitingSince)) continue;

    const lastRequesterMessageAt = await getLastRequesterMessageAt(ticket);
    if (lastRequesterMessageAt && new Date(lastRequesterMessageAt).getTime() > waitingSince) {
      await patchTicket(ticket.id, { status: 'en_proceso' });
      await createSystemEvent(ticket, 'Sistema reactivó el ticket porque el solicitante respondió mientras estaba en Esperando usuario.', 'esperando_usuario', 'en_proceso');
      console.log(`[WAITING-USER] REACTIVATED ${ticket.folio} por respuesta del solicitante`);
      continue;
    }

    const elapsed = Date.now() - waitingSince;
    const marker = `[WAITING-USER-REMINDER:${WAITING_REMINDER_HOURS}H]`;

    if (elapsed >= resolveMs) {
      const resolvedAt = new Date().toISOString();
      await patchTicket(ticket.id, { status: 'resuelto', resolved_at: resolvedAt });
      await createSystemEvent(ticket, `Sistema resolvió automáticamente el ticket por falta de respuesta del solicitante después de ${WAITING_RESOLVE_HOURS} h en Esperando usuario.`, 'esperando_usuario', 'resuelto');
      await notifyRequester(ticket, 'resolved', `Ticket resuelto por inactividad: ${ticket.folio}`, `No recibimos respuesta durante ${WAITING_RESOLVE_HOURS} h. El ticket fue marcado como resuelto y posteriormente seguirá la política normal de cierre.`);
      console.log(`[WAITING-USER] RESOLVED ${ticket.folio} después de ${WAITING_RESOLVE_HOURS}h sin respuesta`);
      continue;
    }

    if (elapsed >= reminderMs && !(await hasSystemEvent(ticket.id, marker))) {
      await notifyRequester(ticket, 'waiting_user_reminder', `Seguimos esperando tu respuesta: ${ticket.folio}`, `Tu ticket está esperando información de tu parte. Si no recibimos respuesta, se resolverá automáticamente después de ${WAITING_RESOLVE_HOURS} h.`);
      await createSystemEvent(ticket, `${marker} Sistema envió un recordatorio al solicitante después de ${WAITING_REMINDER_HOURS} h sin respuesta.`);
      console.log(`[WAITING-USER] REMINDER ${ticket.folio} después de ${WAITING_REMINDER_HOURS}h`);
    }
  }
}

async function processAutoClose() {
  const params = new URLSearchParams({ page: '1', perPage: '500', filter: 'status = "resuelto" && resolved_at != ""', sort: 'resolved_at' });
  const data = await pb(`/api/collections/hd_tickets/records?${params}`);
  const thresholdMs = hoursMs(AUTO_CLOSE_HOURS);
  for (const ticket of data.items) {
    const resolvedAt = new Date(ticket.resolved_at).getTime();
    if (!Number.isFinite(resolvedAt)) continue;
    if (Date.now() - resolvedAt < thresholdMs) continue;
    const closedAt = new Date().toISOString();
    await patchTicket(ticket.id, { status: 'cerrado', closed_at: closedAt });
    await createSystemEvent(ticket, `Sistema cerró automáticamente el ticket después de ${AUTO_CLOSE_HOURS} h en estado Resuelto sin reactivación. Se conserva el SLA histórico del ciclo original.`, 'resuelto', 'cerrado');
    await notifyRequester(ticket, 'closed', `Ticket cerrado automáticamente: ${ticket.folio}`, `La solicitud permaneció resuelta durante ${AUTO_CLOSE_HOURS} h y fue cerrada automáticamente.`);
    console.log(`[AUTO-CLOSE] CLOSED ${ticket.folio} después de ${AUTO_CLOSE_HOURS}h resuelto`);
  }
}

async function run() {
  await processSla();
  await processWaitingUser();
  await processAutoClose();
}

async function cycle() {
  try { await run(); }
  catch (err) { console.error('[SLA] Error:', err); }
}

requireConfig();
console.log(`[SLA] Watcher iniciado. Intervalo: ${INTERVAL_MS / 1000}s`);
console.log(`[WAITING-USER] Recordatorio: ${WAITING_REMINDER_HOURS}h · Resolución por inactividad: ${WAITING_RESOLVE_HOURS}h.`);
console.log(`[AUTO-CLOSE] Tickets resueltos se cerrarán después de ${AUTO_CLOSE_HOURS}h.`);
await cycle();
setInterval(cycle, INTERVAL_MS);
