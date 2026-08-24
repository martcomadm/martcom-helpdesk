import { currentUser, pb } from './pocketbase';

export async function createNotification({ recipient, ticket, type, title, message = '', actor }) {
  const user = currentUser();
  const actorId = actor || user?.id;
  if (!recipient || !ticket || !actorId || recipient === actorId) return null;

  return pb.collection('hd_notifications').create({
    recipient,
    ticket,
    actor: actorId,
    type,
    title,
    message,
    read: false,
  });
}

export async function notifySupport({ ticket, type, title, message = '', actor }) {
  const user = currentUser();
  const actorId = actor || user?.id;
  if (!ticket?.id || !actorId) return [];

  let recipients = [];
  if (ticket.assigned_to && ticket.assigned_to !== actorId) {
    recipients = [ticket.assigned_to];
  } else {
    const support = await pb.collection('hd_users').getFullList({
      filter: 'active = true && (role = "admin" || role = "supervisor")',
      sort: 'name,email',
    });
    recipients = support.map((item) => item.id).filter((id) => id !== actorId);
  }

  const uniqueRecipients = [...new Set(recipients)];
  return Promise.allSettled(uniqueRecipients.map((recipient) => createNotification({
    recipient,
    ticket: ticket.id,
    actor: actorId,
    type,
    title,
    message,
  })));
}

export async function notifyRequester({ ticket, type, title, message = '', actor }) {
  const user = currentUser();
  const actorId = actor || user?.id;
  if (!ticket?.requester || ticket.requester === actorId) return null;
  return createNotification({
    recipient: ticket.requester,
    ticket: ticket.id,
    actor: actorId,
    type,
    title,
    message,
  });
}

export async function markNotificationRead(notification) {
  if (!notification || notification.read) return notification;
  return pb.collection('hd_notifications').update(notification.id, {
    read: true,
    read_at: new Date().toISOString(),
  });
}

export async function markTicketNotificationsRead(ticketId) {
  if (!ticketId) return [];
  const records = await pb.collection('hd_notifications').getFullList({
    filter: `ticket = "${ticketId}" && read = false`,
    sort: '-created',
  });
  return Promise.allSettled(records.map((record) => markNotificationRead(record)));
}

export async function markAllNotificationsRead() {
  const records = await pb.collection('hd_notifications').getFullList({
    filter: 'read = false',
    sort: '-created',
  });
  return Promise.allSettled(records.map((record) => markNotificationRead(record)));
}
