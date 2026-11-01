function apiListUsers(token) {
  const actor = requireAuth_(token);
  requireRole_(actor, ['Admin', 'Maintenance Manager', 'Supervisor']);
  return rowsAsObjects_(EMMS.SHEETS.USERS).map(u => ({
    userId: u.UserID, fullName: u.FullName, email: u.Email,
    role: u.Role, department: u.Department, status: u.Status
  }));
}

function apiSaveUser(token, data) {
  const actor = requireAuth_(token);
  requireRole_(actor, ['Admin']);
  const email = normalizeEmail_(data && data.email);
  const name = cleanText_(data && data.fullName, 100);
  const role = cleanText_(data && data.role, 40);
  const department = cleanText_(data && data.department, 100);
  if (!/^[^@\s]+@gmail\.com$/.test(email)) throw new Error('Email harus berupa Gmail.');
  if (!name) throw new Error('Nama lengkap wajib diisi.');
  if (EMMS.ROLES.indexOf(role) < 0) throw new Error('Role tidak valid.');

  const existing = rowsAsObjects_(EMMS.SHEETS.USERS).find(u => normalizeEmail_(u.Email) === email);
  const now = new Date();
  if (existing) {
    updateObjectById_(EMMS.SHEETS.USERS, 'UserID', existing.UserID, {
      FullName: name, Role: role, Department: department,
      Status: data.status === 'Inactive' ? 'Inactive' : 'Active',
      UpdatedAt: now, UpdatedBy: actor.Email
    });
    audit_(actor, 'UPDATE', 'USERS', existing.UserID, { email, role });
    return { ok: true, userId: existing.UserID };
  }

  const id = nextId_('USR');
  appendObject_(EMMS.SHEETS.USERS, {
    UserID: id, FullName: name, Email: email, Role: role,
    Department: department, Status: 'Active',
    CreatedAt: now, UpdatedAt: now, CreatedBy: actor.Email, UpdatedBy: actor.Email
  });
  audit_(actor, 'CREATE', 'USERS', id, { email, role });
  return { ok: true, userId: id };
}
