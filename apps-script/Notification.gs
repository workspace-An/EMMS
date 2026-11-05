/**
 * EMMS - Notification.gs
 * Phase 2: peringatan email untuk temuan KRITIS hasil inspeksi (ke Supervisor, Maintenance Manager, Admin).
 * Phase 7 akan memperluas file ini (jadwal PM, overdue, NG, Work Order, stok minimum, trigger terjadwal).
 *
 * Catatan kuota: Gmail pribadi ±100 penerima/hari, dibagi dengan email OTP. Kegagalan kirim TIDAK
 * menggagalkan penyimpanan inspeksi; hasilnya dicatat di sheet NOTIFICATIONS (DeliveryStatus Sent/Failed).
 */
const Notify = {
  esc_: function (s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  },

  recipients_: function (roles) {
    const seen = {};
    return Db.where('USERS', function (u) { return u.Status === 'Active' && roles.indexOf(u.Role) !== -1; })
      .map(function (u) { return { email: Auth.norm(u.Email), name: u.FullName }; })
      .filter(function (r) { if (seen[r.email]) return false; seen[r.email] = true; return true; });
  },

  /** Kirim satu email dan catat hasilnya di NOTIFICATIONS. Tidak pernah melempar error. */
  sendLogged_: function (type, to, subject, html, refType, refId) {
    let status = 'Sent', err = '';
    try {
      MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: 'EMMS' });
    } catch (e) { status = 'Failed'; err = String(e && e.message || e).slice(0, 200); }
    try {
      Db.insert('NOTIFICATIONS', {
        NotificationType: type, RecipientEmail: to, Subject: subject, RefType: refType, RefID: refId,
        SentAt: Db.now(), DeliveryStatus: status, ErrorMessage: err
      }, 'system');
    } catch (e) { console.error('Notify log: ' + e.message); }
    return status === 'Sent';
  },

  /**
   * @param {Object} insp  header inspeksi (InspectionID, InspectionDate, InspectionTime, TechnicianName, Recommendation)
   * @param {Object} eq    equipment
   * @param {Array}  ngItems  item NG kritis [{ItemName, Remarks, MeasurementValue, Unit}]
   * @returns {{sent:number, failed:number}}
   */
  criticalFinding: function (insp, eq, ngItems) {
    const out = { sent: 0, failed: 0 };
    try {
      const rcpt = Notify.recipients_(CFG.CRITICAL_ALERT_ROLES);
      if (!rcpt.length) return out;
      const base = Settings.webAppUrl();
      const link = base ? base + '?eq=' + encodeURIComponent(eq.EquipmentID) : '';
      const subject = '[EMMS] CRITICAL / 严重 - ' + eq.EquipmentID + ' ' + eq.EquipmentName;
      const rows = ngItems.map(function (i) {
        return '<li><b>' + Notify.esc_(i.ItemName) + '</b>' +
          (i.MeasurementValue !== '' && i.MeasurementValue !== undefined ? ' = ' + Notify.esc_(i.MeasurementValue) + ' ' + Notify.esc_(i.Unit) : '') +
          (i.Remarks ? ' - ' + Notify.esc_(i.Remarks) : '') + '</li>';
      }).join('');
      const html = '<div style="font-family:Arial,sans-serif;max-width:560px;border:1px solid #fecaca;border-radius:8px">' +
        '<div style="background:#b91c1c;color:#fff;padding:12px 18px;font-weight:bold;border-radius:8px 8px 0 0">CRITICAL FINDING / TEMUAN KRITIS / 严重发现</div>' +
        '<div style="padding:18px;color:#1e293b"><p><b>' + Notify.esc_(eq.EquipmentID) + '</b> - ' + Notify.esc_(eq.EquipmentName) + '</p>' +
        '<p>' + Notify.esc_(insp.InspectionDate) + ' ' + Notify.esc_(insp.InspectionTime) + ' &middot; ' + Notify.esc_(insp.TechnicianName) + ' &middot; ' + Notify.esc_(insp.InspectionID) + '</p>' +
        '<ul>' + rows + '</ul>' +
        (insp.Recommendation ? '<p><b>Recommendation / Tindakan lanjut / 建议:</b> ' + Notify.esc_(insp.Recommendation) + '</p>' : '') +
        (link ? '<p><a href="' + Notify.esc_(link) + '">' + Notify.esc_(link) + '</a></p>' : '') +
        '<p style="color:#64748b;font-size:12px">Tinjau di EMMS &gt; Inspeksi. / Review in EMMS &gt; Inspection. / 请在 EMMS 中查看。</p></div></div>';

      let remaining = 0;
      try { remaining = MailApp.getRemainingDailyQuota(); } catch (e) { remaining = 0; }
      rcpt.forEach(function (r, i) {
        if (i >= remaining) {
          out.failed++;
          try {
            Db.insert('NOTIFICATIONS', { NotificationType: 'CRITICAL_FINDING', RecipientEmail: r.email, Subject: subject, RefType: 'DAILY_INSPECTION',
              RefID: insp.InspectionID, SentAt: Db.now(), DeliveryStatus: 'Failed', ErrorMessage: 'quota' }, 'system');
          } catch (e) { console.error('Notify log: ' + e.message); }
          return;
        }
        if (Notify.sendLogged_('CRITICAL_FINDING', r.email, subject, html, 'DAILY_INSPECTION', insp.InspectionID)) out.sent++; else out.failed++;
      });
    } catch (e) {
      console.error('criticalFinding: ' + e.message);
    }
    return out;
  }
};
