migrate((app) => {
  const users = new Collection({
    type: 'auth',
    name: 'users',
    listRule: '@request.auth.id != "" && (@request.auth.role = "admin" || (@request.auth.role = "supervisor" && department = @request.auth.department) || id = @request.auth.id)',
    viewRule: '@request.auth.id != "" && (@request.auth.role = "admin" || (@request.auth.role = "supervisor" && department = @request.auth.department) || id = @request.auth.id)',
    createRule: null,
    updateRule: '@request.auth.id != "" && (id = @request.auth.id || @request.auth.role = "admin")',
    deleteRule: '@request.auth.role = "admin"',
    fields: [
      { type: 'text', name: 'name', required: true, max: 120, presentable: true },
      { type: 'text', name: 'department', required: true, max: 80 },
      { type: 'select', name: 'role', required: true, maxSelect: 1, values: ['empleado', 'supervisor', 'admin'] },
      { type: 'bool', name: 'active' }
    ],
    passwordAuth: {
      enabled: true,
      identityFields: ['email']
    }
  });
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId('users');
  app.delete(users);
});
