/// <reference path="../pb_data/types.d.ts" />
// Notificaciones push del navegador/celular.
// - hd_push_subscriptions: un registro por dispositivo y usuario.
// - hd_notifications.push_sent_at: el sla-watcher marca aquí cuándo envió el push.

migrate((app) => {
  const users = app.findCollectionByNameOrId('hd_users');

  const subscriptions = new Collection({
    type: 'base',
    name: 'hd_push_subscriptions',
    listRule: '@request.auth.id != "" && user = @request.auth.id',
    viewRule: '@request.auth.id != "" && user = @request.auth.id',
    createRule: '@request.auth.id != "" && @request.body.user = @request.auth.id',
    updateRule: '@request.auth.id != "" && user = @request.auth.id && (@request.body.user:isset = false || @request.body.user = @request.auth.id)',
    deleteRule: '@request.auth.id != "" && user = @request.auth.id',
    fields: [
      { type: 'relation', name: 'user', required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
      { type: 'text', name: 'endpoint', required: true, max: 1000 },
      { type: 'text', name: 'p256dh', required: true, max: 200 },
      { type: 'text', name: 'auth', required: true, max: 100 },
      { type: 'text', name: 'device', max: 120 },
      { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
      { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_hd_push_user_endpoint ON hd_push_subscriptions (user, endpoint)',
    ],
  });
  app.save(subscriptions);

  const notifications = app.findCollectionByNameOrId('hd_notifications');
  if (!notifications.fields.getByName('push_sent_at')) {
    notifications.fields.add(new DateField({ name: 'push_sent_at' }));
    app.save(notifications);
  }
}, (app) => {
  const notifications = app.findCollectionByNameOrId('hd_notifications');
  if (notifications.fields.getByName('push_sent_at')) {
    notifications.fields.removeByName('push_sent_at');
    app.save(notifications);
  }
  const subscriptions = app.findCollectionByNameOrId('hd_push_subscriptions');
  app.delete(subscriptions);
});
