export const ROLE = {
  USER: 'usuario',
  SUPPORT: 'soporte',
  SUPERVISOR: 'supervisor',
  ADMIN: 'admin',
};

export function normalizedRole(userOrRole) {
  const raw = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  if (!raw) return ROLE.USER;
  if (raw === 'empleado') return ROLE.USER;
  return raw;
}

export function canWorkTickets(userOrRole) {
  return [ROLE.SUPPORT, ROLE.SUPERVISOR, ROLE.ADMIN].includes(normalizedRole(userOrRole));
}

export function canSupervise(userOrRole) {
  return [ROLE.SUPERVISOR, ROLE.ADMIN].includes(normalizedRole(userOrRole));
}

export function isAdmin(userOrRole) {
  return normalizedRole(userOrRole) === ROLE.ADMIN;
}

export function roleLabel(userOrRole) {
  const role = normalizedRole(userOrRole);
  return {
    [ROLE.USER]: 'Usuario',
    [ROLE.SUPPORT]: 'Soporte',
    [ROLE.SUPERVISOR]: 'Supervisor',
    [ROLE.ADMIN]: 'Admin',
  }[role] || role;
}
