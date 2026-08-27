migrate((app) => {
  const users = app.findCollectionByNameOrId('hd_users');
  const tickets = app.findCollectionByNameOrId('hd_tickets');

  const assets = new Collection({
    type: 'base',
    name: 'hd_assets',
    listRule: '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "supervisor" || @request.auth.role = "soporte" || assigned_to = @request.auth.id)',
    viewRule: '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "supervisor" || @request.auth.role = "soporte" || assigned_to = @request.auth.id)',
    createRule: '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "supervisor")',
    updateRule: '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "supervisor")',
    deleteRule: '@request.auth.role = "admin"',
    fields: [
      { type: 'text', name: 'asset_tag', required: true, max: 60, presentable: true },
      { type: 'select', name: 'type', required: true, maxSelect: 1, values: ['laptop','desktop','monitor','telefono','impresora','red','servidor','accesorio','otro'] },
      { type: 'text', name: 'brand', max: 80 },
      { type: 'text', name: 'model', max: 120 },
      { type: 'text', name: 'serial_number', max: 120 },
      { type: 'select', name: 'status', required: true, maxSelect: 1, values: ['disponible','asignado','mantenimiento','reparacion','baja'] },
      { type: 'relation', name: 'assigned_to', collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { type: 'text', name: 'department', max: 80 },
      { type: 'text', name: 'location', max: 120 },
      { type: 'date', name: 'purchase_date' },
      { type: 'date', name: 'warranty_until' },
      { type: 'number', name: 'purchase_cost', min: 0 },
      { type: 'text', name: 'processor', max: 120 },
      { type: 'text', name: 'ram', max: 80 },
      { type: 'text', name: 'storage', max: 120 },
      { type: 'text', name: 'operating_system', max: 120 },
      { type: 'text', name: 'ip_address', max: 64 },
      { type: 'text', name: 'mac_address', max: 64 },
      { type: 'editor', name: 'notes' }
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_hd_assets_asset_tag ON hd_assets (asset_tag)',
      'CREATE INDEX idx_hd_assets_status ON hd_assets (status)',
      'CREATE INDEX idx_hd_assets_assigned_to ON hd_assets (assigned_to)'
    ]
  });
  app.save(assets);

  const links = new Collection({
    type: 'base',
    name: 'hd_asset_ticket_links',
    listRule: '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "supervisor" || @request.auth.role = "soporte" || asset.assigned_to = @request.auth.id || ticket.requester = @request.auth.id)',
    viewRule: '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "supervisor" || @request.auth.role = "soporte" || asset.assigned_to = @request.auth.id || ticket.requester = @request.auth.id)',
    createRule: '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "supervisor" || @request.auth.role = "soporte")',
    updateRule: '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "supervisor" || @request.auth.role = "soporte")',
    deleteRule: '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "supervisor")',
    fields: [
      { type: 'relation', name: 'asset', required: true, collectionId: assets.id, maxSelect: 1, cascadeDelete: true },
      { type: 'relation', name: 'ticket', required: true, collectionId: tickets.id, maxSelect: 1, cascadeDelete: true },
      { type: 'relation', name: 'linked_by', collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { type: 'text', name: 'notes', max: 300 }
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_hd_asset_ticket_unique ON hd_asset_ticket_links (asset, ticket)'
    ]
  });
  app.save(links);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId('hd_asset_ticket_links')); } catch (_) {}
  try { app.delete(app.findCollectionByNameOrId('hd_assets')); } catch (_) {}
});
