/**
 * EMMS - Users.gs
 * Manajemen pengguna (daftar email yang diizinkan). Hak akses dicek di router (api) + guard bisnis di sini.
 */
const Users = {
  pub_: function (u) {
    return {
      UserID: u.UserID, FullName: u.FullName, Email: u.Email, Role: u.Role, Department: u.Department,
      Language: u.Language, Status: u.Status, CreatedAt: u.CreatedAt, UpdatedAt: u.UpdatedAt, LastLoginAt: u.LastLoginAt
    };
  },

  list: function () {
    return Db.all('USERS').map(Users.pub_).sort(function (a, b) { return a.FullName.localeCompare(b.FullName); });
  },

  activeAdmins_: function () {
    return Db.where('USERS', function (u) { return u.Role === 'Admin' && u.Status === 'Active'; });
  },

  save: function (p, actor) {
    p = p || {};
    const errors = [];
    const name = String(p.FullName || '').trim();
    const email = Auth.norm(p.Email);
    const role = String(p.Role || '');
    const dept = String(p.Department || '').trim();
    const status = p.Status ? String(p.Status) : 'Active';

    if (!name) errors.push({ field: 'FullName', rule: 'required' }); else if (name.length > 100) errors.push({ field: 'FullName', rule: 'tooLong' });
    if (!Auth.validEmail(email)) errors.push({ field: 'Email', rule: email ? 'invalid' : 'required' });
    if (CFG.ROLES.indexOf(role) === -1) errors.push({ field: 'Role', rule: 'invalid' });
    if (dept.length > 100) errors.push({ field: 'Department', rule: 'tooLong' });
    if (['Active', 'Inactive'].indexOf(status) === -1) errors.push({ field: 'Status', rule: 'invalid' });
    if (errors.length) throw validationError_(errors);

    return Db.withLock(function () {
      const dup = Db.where('USERS', function (u) { return Auth.norm(u.Email) === email && u.UserID !== p.UserID; });
      if (dup.length) throw new AppError('CONFLICT', 'Duplicate email', { rule: 'duplicate', field: 'Email' });

      if (!p.UserID) {
        const rec = Db.insert('USERS', {
          FullName: name, Email: email, Role: role, Department: dept, Language: '', Status: status
        }, actor.email);
        Audit.log(actor, 'USER_CREATE', 'USERS', rec.UserID, { email: email, role: role }, 'OK');
        return Users.pub_(rec);
      }

      const cur = Db.get('USERS', p.UserID);
      if (!cur) throw new AppError('NOT_FOUND', 'User not found');
      const isSelf = Auth.norm(cur.Email) === Auth.norm(actor.email);

      // Guard: tidak boleh mengubah role/status/email diri sendiri (mencegah terkunci)
      if (isSelf && (role !== cur.Role || status !== cur.Status || email !== Auth.norm(cur.Email))) {
        throw new AppError('CONFLICT', 'Cannot change own access', { rule: 'selfChange' });
      }
      // Guard: minimal satu Admin aktif
      const losesAdmin = cur.Role === 'Admin' && cur.Status === 'Active' && (role !== 'Admin' || status !== 'Active');
      if (losesAdmin && Users.activeAdmins_().length <= 1) {
        throw new AppError('CONFLICT', 'Last admin', { rule: 'lastAdmin' });
      }

      const res = Db.update('USERS', p.UserID, {
        FullName: name, Email: email, Role: role, Department: dept, Status: status
      }, actor.email, { expectedUpdatedAt: p.UpdatedAt });
      if (status !== 'Active' || email !== Auth.norm(cur.Email)) Auth.revokeAll(cur.Email);
      Audit.log(actor, 'USER_UPDATE', 'USERS', p.UserID,
        diffObjects_(res.before, res.after, ['FullName', 'Email', 'Role', 'Department', 'Status']), 'OK');
      return Users.pub_(res.after);
    });
  },

  setLanguage: function (p, user) {
    const lang = String((p && p.language) || '');
    if (CFG.LANGS.indexOf(lang) === -1) throw validationError_([{ field: 'Language', rule: 'invalid' }]);
    Db.update('USERS', user.userId, { Language: lang }, user.email);
    return { language: lang };
  }
};
