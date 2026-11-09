/**
 * EMMS - AuditLog.gs
 * Pencatatan audit append-only. Kegagalan mencatat audit tidak boleh menggagalkan proses utama,
 * tetapi selalu dicatat ke log Apps Script (console.error).
 */
const Audit = {
  /**
   * @param {Object|string|null} user  objek user (email, role) atau string email/'system'
   * @param {string} action  mis. EQUIPMENT_CREATE, LOGIN_OK
   */
  log: function (user, action, entity, entityId, details, result) {
    try {
      let text = '';
      if (details !== undefined && details !== null) {
        text = typeof details === 'string' ? details : JSON.stringify(details);
        if (text.length > 4000) text = text.slice(0, 4000) + '...';
      }
      const email = user && typeof user === 'object' ? user.email : (user || 'system');
      const role = user && typeof user === 'object' ? user.role : '';
      Db.insert('AUDIT_LOG', {
        EventTime: Db.now(),
        UserEmail: email,
        UserRole: role,
        Action: action,
        Entity: entity || '',
        EntityID: entityId || '',
        Details: text,
        Result: result || 'OK'
      }, email);
    } catch (e) {
      console.error('Audit gagal: ' + (e && e.message));
    }
  },

  /** Daftar audit terbaru (maks 2000 baris terakhir dibaca). Filter: entity, entityId, limit. */
  list: function (p) {
    p = p || {};
    const limit = Math.min(Number(p.limit) || 50, 500);
    let rows = Db.tail('AUDIT_LOG', 2000);
    if (p.entity) rows = rows.filter(function (r) { return r.Entity === p.entity; });
    if (p.entityId) rows = rows.filter(function (r) { return r.EntityID === p.entityId; });
    if (p.action) rows = rows.filter(function (r) { return r.Action === p.action; });
    return rows.reverse().slice(0, limit).map(Audit.pub_);
  },

  pub_: function (r) {
    return {
      AuditID: r.AuditID, EventTime: r.EventTime, UserEmail: r.UserEmail, UserRole: r.UserRole,
      Action: r.Action, Entity: r.Entity, EntityID: r.EntityID, Details: r.Details, Result: r.Result
    };
  }
};
