/**
 * EMMS - Automation.gs  (Phase 7: otomasi, approval terekam, log notifikasi)
 *
 *  - Job harian (trigger waktu) -> emmsDailyJob() -> Automation.run():
 *      * Teknisi: satu email berisi PM jatuh tempo/terlambat, CM dan WO miliknya yang masih berjalan.
 *      * Manajemen (Supervisor/Manager/Admin): satu email ringkasan: persetujuan tertunda, PM terlambat,
 *        CM/WO terlambat, temuan K3 High/Critical yang lama, stok menipis, equipment belum diinspeksi.
 *      * Housekeeping: hapus sesi kedaluwarsa/dicabut > 7 hari.
 *    Hemat kuota Gmail (±100/hari, dibagi dengan OTP): email digabung per penerima, tidak dikirim bila kosong,
 *    manajemen didahulukan, berhenti saat kuota habis, dan hanya satu kali per penerima per tanggal.
 *  - Approvals: setiap keputusan (PM, WO, Risiko, tutup CM/WO) direkam di APPROVALS dengan SignatureHash
 *    = SHA-256(ref|keputusan|email|waktu|garam rahasia) sehingga perubahan manual di sheet dapat dideteksi.
 */
const Approvals = {
  sign_: function (refType, refId, decision, email, at) {
    return Auth.hash([refType, refId, decision, Auth.norm(email), at, Auth.salt_()].join('|'));
  },
  /** Rekam satu keputusan. Tidak pernah melempar error agar tidak menggagalkan transaksi bisnis. */
  record: function (refType, refId, level, decision, user, remarks) {
    try {
      const at = Db.now();
      Db.insert('APPROVALS', {
        RefType: refType, RefID: String(refId), ApprovalLevel: level, ApproverRole: user.role, ApprovedBy: user.name, ApprovalDate: at, Decision: decision,
        Remarks: String(remarks || '').slice(0, 500), SignatureHash: Approvals.sign_(refType, refId, decision, user.email, at), ApproverEmail: Auth.norm(user.email)
      }, user.email);
    } catch (e) { console.error('Approvals.record: ' + e.message); }
  },
  list: function (p) {
    p = p || {};
    const rows = Db.all('APPROVALS').filter(function (a) {
      if (p.refType && a.RefType !== p.refType) return false;
      if (p.refId && a.RefID !== p.refId) return false;
      return true;
    }).map(function (a) {
      return { ApprovalID: a.ApprovalID, RefType: a.RefType, RefID: a.RefID, Level: a.ApprovalLevel, Role: a.ApproverRole, By: a.ApprovedBy, At: a.ApprovalDate, Decision: a.Decision, Remarks: a.Remarks, Signature: String(a.SignatureHash).slice(0, 12), Valid: Approvals.valid_(a) };
    }).reverse();
    return { rows: rows.slice(0, 300) };
  },
  valid_: function (a) {
    return a.SignatureHash === Approvals.sign_(a.RefType, a.RefID, a.Decision, a.ApproverEmail, a.ApprovalDate);
  },
  /** Periksa seluruh riwayat: kembalikan yang tanda tangannya tidak cocok (diedit manual / dipalsukan). */
  verify: function () {
    const all = Db.all('APPROVALS');
    const bad = all.filter(function (a) { return !Approvals.valid_(a); }).map(function (a) { return a.ApprovalID; });
    return { total: all.length, invalid: bad.length, ids: bad.slice(0, 50) };
  }
};

const Automation = {
  JOB: 'emmsDailyJob',
  cfg_: function () {
    const n = function (k, d, lo, hi) { const v = Number(Settings.get(k, d)); return v >= lo && v <= hi ? v : d; };
    return {
      enabled: String(Settings.get('AUTOMATION_ENABLED', 'FALSE')).toUpperCase() === 'TRUE',
      hour: n('AUTOMATION_HOUR', 6, 0, 23), overdueDays: n('OVERDUE_DAYS', 7, 1, 90), safetyDays: n('SAFETY_ESCALATE_DAYS', 3, 1, 60), lead: n('PM_LEAD_DAYS', 7, 0, 60)
    };
  },
  triggers_: function () {
    try { return ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === Automation.JOB; }); } catch (e) { return []; }
  },
  status: function () {
    const c = Automation.cfg_();
    let last = null;
    try { last = JSON.parse(Settings.get('AUTOMATION_LAST_RUN', '') || 'null'); } catch (e) { last = null; }
    let quota = null;
    try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { quota = null; }
    return { enabled: c.enabled, hour: c.hour, overdueDays: c.overdueDays, safetyDays: c.safetyDays, triggerInstalled: Automation.triggers_().length > 0, last: last, mailQuota: quota };
  },

  /** Pasang (atau pasang ulang) trigger harian sesuai pengaturan. Idempoten: tidak pernah menggandakan. */
  install: function (user) {
    const c = Automation.cfg_();
    Automation.triggers_().forEach(function (t) { try { ScriptApp.deleteTrigger(t); } catch (e) { /* abaikan */ } });
    ScriptApp.newTrigger(Automation.JOB).timeBased().everyDays(1).atHour(c.hour).inTimezone(Db.tz()).create();
    Audit.log(user, 'AUTOMATION_INSTALL', 'SETTINGS', '', { hour: c.hour }, 'OK');
    return Automation.status();
  },
  uninstall: function (user) {
    Automation.triggers_().forEach(function (t) { try { ScriptApp.deleteTrigger(t); } catch (e) { /* abaikan */ } });
    Audit.log(user, 'AUTOMATION_UNINSTALL', 'SETTINGS', '', {}, 'OK');
    return Automation.status();
  },
  /** Aktif/nonaktif + jam. Mengaktifkan memasang trigger; menonaktifkan menghapusnya. */
  configure: function (p, user) {
    p = p || {};
    const errors = [];
    const en = String(p.AUTOMATION_ENABLED === undefined ? '' : p.AUTOMATION_ENABLED).toUpperCase();
    if (en !== 'TRUE' && en !== 'FALSE') errors.push({ field: 'AUTOMATION_ENABLED', rule: 'invalid' });
    const chk = function (k, lo, hi) { const v = Number(p[k]); if (!(p[k] !== '' && p[k] !== undefined && v >= lo && v <= hi && Math.floor(v) === v)) errors.push({ field: k, rule: 'invalid' }); };
    chk('AUTOMATION_HOUR', 0, 23); chk('OVERDUE_DAYS', 1, 90); chk('SAFETY_ESCALATE_DAYS', 1, 60);
    if (errors.length) throw validationError_(errors);
    Settings.update({ AUTOMATION_ENABLED: en, AUTOMATION_HOUR: String(p.AUTOMATION_HOUR), OVERDUE_DAYS: String(p.OVERDUE_DAYS), SAFETY_ESCALATE_DAYS: String(p.SAFETY_ESCALATE_DAYS) }, user);
    if (en === 'TRUE') return Automation.install(user);
    return Automation.uninstall(user);
  },

  // ----------------------------------------------------------------- pengumpulan data
  daysBetween_: function (a, b) {   // b - a dalam hari (yyyy-MM-dd)
    return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
  },
  collect_: function (c) {
    const today = Db.today(), lead = Db.addDays(today, c.lead);
    const eq = {};
    Db.all('EQUIPMENT', { includeDeleted: true }).forEach(function (e) { eq[e.EquipmentID] = e; });
    const nm = function (id) { return id + ' ' + (eq[id] ? eq[id].EquipmentName : ''); };
    const pm = Db.where('PM_SCHEDULES', function (s) { return s.Status === 'Active' && s.NextDueDate && s.NextDueDate <= lead && eq[s.EquipmentID] && eq[s.EquipmentID].Status !== 'Deleted'; }).map(function (s) {
      return { id: s.PMScheduleID, text: s.PMTitle + ' - ' + nm(s.EquipmentID), due: s.NextDueDate, days: Automation.daysBetween_(s.NextDueDate, today), tech: Auth.norm(s.AssignedTechnician) };
    });
    const age = function (ts) { return Automation.daysBetween_(String(ts).slice(0, 10), today); };
    const cm = Db.where('CORRECTIVE_MAINTENANCE', function (r) { return ['Open', 'In Progress', 'Pending'].indexOf(r.Status) !== -1; }).map(function (r) {
      return { id: r.ComplaintNo, text: r.ComplaintNo + ' [' + r.Priority + '] ' + nm(r.EquipmentID) + ' - ' + String(r.ProblemDescription).slice(0, 80), age: age(r.DateReported || r.CreatedAt), tech: Auth.norm(r.AssignedTechnician), status: r.Status, prio: r.Priority };
    });
    const wo = Db.where('WORK_ORDERS', function (w) { return ['Requested', 'Approved', 'In Progress'].indexOf(w.Status) !== -1; }).map(function (w) {
      const late = w.DueDate && w.DueDate < today;
      return { id: w.WorkOrderID, text: w.WorkOrderID + ' [' + w.Priority + '] ' + w.Title + ' - ' + nm(w.EquipmentID), age: age(w.CreatedAt), tech: Auth.norm(w.AssignedTo), status: w.Status, late: !!late, due: w.DueDate };
    });
    const k3 = Db.where('ELECTRICAL_SAFETY', function (s) { return Safety.OPEN.indexOf(s.Status) !== -1 && (s.RiskLevel === 'High' || s.RiskLevel === 'Critical'); }).map(function (s) {
      return { id: s.SafetyID, text: s.SafetyID + ' [' + s.RiskLevel + '] ' + (s.EquipmentID ? nm(s.EquipmentID) : s.LocationID) + ' - ' + String(s.Description).slice(0, 80), age: age(s.ReportDate || s.CreatedAt) };
    }).filter(function (s) { return s.age >= c.safetyDays; });
    const low = Db.where('SPARE_PARTS', function (r) { return Inventory.low_(r); }).map(function (r) { return { id: r.ItemCode, text: r.ItemCode + ' ' + r.ItemName + ': ' + r.CurrentStock + ' ' + r.Unit + ' (min ' + r.MinimumStock + ')' }; });
    const pend = {
      pm: Db.where('PREVENTIVE_MAINTENANCE', function (r) { return r.ApprovalStatus === 'Pending'; }).length,
      wo: Db.where('WORK_ORDERS', function (w) { return w.Status === 'Requested'; }).length,
      risk: Db.where('RISK_ASSESSMENTS', function (r) { return r.RequiresApproval === true && !r.ApprovedBy && !/^REJECTED/.test(r.ApprovalRemarks || ''); }).length
    };
    const inspected = {};
    Db.where('DAILY_INSPECTIONS', function (i) { return i.InspectionDate === today; }).forEach(function (i) { inspected[i.EquipmentID] = true; });
    const notInspected = Db.all('EQUIPMENT').filter(function (e) { return e.Status === 'Active' && !inspected[e.EquipmentID]; }).length;
    return { today: today, pm: pm, cm: cm, wo: wo, k3: k3, low: low, pend: pend, notInspected: notInspected };
  },

  // ----------------------------------------------------------------- email
  section_: function (title, items, max) {
    if (!items.length) return '';
    max = max || 15;
    return '<h3 style="margin:16px 0 6px;font-size:14px;color:#0b2a4a">' + Notify.esc_(title) + ' (' + items.length + ')</h3><ul style="margin:0;padding-left:18px">' +
      items.slice(0, max).map(function (x) { return '<li>' + Notify.esc_(x) + '</li>'; }).join('') + (items.length > max ? '<li><i>+' + (items.length - max) + ' ...</i></li>' : '') + '</ul>';
  },
  wrap_: function (title, body) {
    return '<div style="font-family:Arial,sans-serif;max-width:620px;border:1px solid #cbd5e1;border-radius:8px"><div style="background:#0b2a4a;color:#fff;padding:12px 18px;font-weight:bold;border-radius:8px 8px 0 0">' +
      Notify.esc_(title) + '</div><div style="padding:16px 18px;color:#1e293b;font-size:13px">' + body + '</div></div>';
  },
  techBody_: function (d, email, c) {
    const pmM = d.pm.filter(function (x) { return x.tech === email; });
    const cmM = d.cm.filter(function (x) { return x.tech === email; });
    const woM = d.wo.filter(function (x) { return x.tech === email && x.status !== 'Requested'; });
    if (!pmM.length && !cmM.length && !woM.length) return '';
    const pmL = pmM.map(function (x) { return x.text + ' - ' + (x.days > 0 ? 'TERLAMBAT ' + x.days + ' hari' : (x.days === 0 ? 'jatuh tempo HARI INI' : 'jatuh tempo ' + x.due)); });
    return Automation.section_('PM jatuh tempo / terlambat', pmL) + Automation.section_('Corrective Maintenance milik Anda', cmM.map(function (x) { return x.text + ' (' + x.status + ', ' + x.age + ' hari)'; })) +
      Automation.section_('Work Order milik Anda', woM.map(function (x) { return x.text + ' (' + x.status + (x.late ? ', LEWAT TENGGAT ' + x.due : '') + ')'; }));
  },
  mgmtBody_: function (d, c) {
    const p = d.pend, totalPend = p.pm + p.wo + p.risk;
    const pmLate = d.pm.filter(function (x) { return x.days > 0; }).map(function (x) { return x.text + ' - terlambat ' + x.days + ' hari' + (x.tech ? '' : ' (BELUM ADA TEKNISI)'); });
    const pmSoon = d.pm.filter(function (x) { return x.days <= 0; }).map(function (x) { return x.text + ' - ' + x.due; });
    const cmLate = d.cm.filter(function (x) { return x.age >= c.overdueDays || x.prio === 'Critical'; }).map(function (x) { return x.text + ' (' + x.status + ', ' + x.age + ' hari' + (x.tech ? '' : ', belum ditugaskan') + ')'; });
    const woLate = d.wo.filter(function (x) { return x.late || (x.age >= c.overdueDays && x.status !== 'Requested'); }).map(function (x) { return x.text + ' (' + x.status + ', ' + x.age + ' hari' + (x.late ? ', lewat tenggat ' + x.due : '') + ')'; });
    const sections = [
      totalPend ? '<p><b>Menunggu persetujuan:</b> PM ' + p.pm + ' &middot; Work Order ' + p.wo + ' &middot; Penilaian risiko ' + p.risk + '</p>' : '',
      Automation.section_('PM terlambat', pmLate), Automation.section_('PM segera jatuh tempo', pmSoon), Automation.section_('Corrective terlambat / kritis', cmLate), Automation.section_('Work Order terlambat', woLate),
      Automation.section_('Temuan K3 High/Critical belum selesai >= ' + c.safetyDays + ' hari', d.k3.map(function (x) { return x.text + ' (' + x.age + ' hari)'; })), Automation.section_('Stok menipis', d.low.map(function (x) { return x.text; })),
      d.notInspected ? '<p>Equipment belum diinspeksi hari ini: <b>' + d.notInspected + '</b></p>' : ''
    ].join('');
    return sections.trim() ? sections : '';
  },
  sentToday_: function (type, email, date) {
    return Db.where('NOTIFICATIONS', function (n) { return n.NotificationType === type && n.RecipientEmail === email && n.RefID === date && n.DeliveryStatus === 'Sent'; }).length > 0;
  },

  /**
   * Jalankan job. opts.force = abaikan dedup harian; opts.dryRun = hitung tanpa kirim.
   * Selalu mengembalikan ringkasan; tidak melempar error ke pemanggil trigger.
   */
  run: function (opts, user) {
    opts = opts || {};
    const started = Db.now();
    const c = Automation.cfg_();
    const res = { startedAt: started, date: Db.today(), sent: 0, failed: 0, skipped: 0, empty: 0, purged: 0, quotaStop: false, dryRun: !!opts.dryRun, errors: [] };
    try {
      const d = Automation.collect_(c);
      res.counts = { pm: d.pm.length, cm: d.cm.length, wo: d.wo.length, k3: d.k3.length, low: d.low.length, pending: d.pend.pm + d.pend.wo + d.pend.risk };
      let quota = 1e9;
      try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { quota = 1e9; }
      const queue = [];
      const mg = Automation.mgmtBody_(d, c);
      Notify.recipients_(CFG.CRITICAL_ALERT_ROLES).forEach(function (r) {
        if (!mg) { res.empty++; return; }
        queue.push({ type: 'DAILY_DIGEST', to: r.email, subject: '[EMMS] Ringkasan harian ' + d.today + ' / Daily digest / 每日摘要', html: Automation.wrap_('EMMS - Ringkasan harian / Daily digest / 每日摘要 - ' + d.today, mg) });
      });
      Db.where('USERS', function (u) { return u.Status === 'Active' && u.Role === 'Technician'; }).forEach(function (u) {
        const em = Auth.norm(u.Email), body = Automation.techBody_(d, em, c);
        if (!body) { res.empty++; return; }
        queue.push({ type: 'TECH_REMINDER', to: em, subject: '[EMMS] Tugas Anda ' + d.today + ' / Your tasks / 您的任务', html: Automation.wrap_('EMMS - Tugas Anda / Your tasks / 您的任务 - ' + d.today, body) });
      });
      queue.forEach(function (m) {
        if (!opts.force && Automation.sentToday_(m.type, m.to, d.today)) { res.skipped++; return; }
        if (opts.dryRun) { res.sent++; return; }
        if (res.sent + res.failed >= quota) { res.quotaStop = true; res.failed++; return; }
        if (Notify.sendLogged_(m.type, m.to, m.subject, m.html, 'DATE', d.today)) res.sent++; else res.failed++;
      });
      if (!opts.dryRun) { res.purged = Automation.purgeSessions_(); const bk = Backup.auto_(); if (bk) { res.backup = bk.error ? 'ERROR: ' + bk.error : bk.name; if (bk.error) res.errors.push('backup: ' + bk.error); } }
    } catch (e) { res.errors.push(String(e && e.message || e).slice(0, 200)); console.error('Automation.run: ' + e.message); }
    res.finishedAt = Db.now();
    if (!opts.dryRun) {
      try {
        Db.withLock(function () { Settings.setSystem_('AUTOMATION_LAST_RUN', JSON.stringify(res)); });
        Audit.log(user || 'system', 'AUTOMATION_RUN', 'SETTINGS', '', { sent: res.sent, failed: res.failed, skipped: res.skipped, errors: res.errors.length }, res.errors.length ? 'ERROR' : 'OK');
      } catch (e) { console.error('Automation log: ' + e.message); }
    }
    return res;
  },

  purgeSessions_: function () {
    const cut = Db.addDays(Db.today(), -7) + ' 00:00:00';
    let n = 0;
    try {
      Db.where('SESSIONS', function (s) { return (s.Revoked === true || (s.ExpiresAt && s.ExpiresAt < cut)); }).slice(0, 200).forEach(function (s) { Db.hardDelete('SESSIONS', s.SessionID); n++; });
    } catch (e) { console.error('purge: ' + e.message); }
    return n;
  },

  notifications: function (p) {
    p = p || {};
    const rows = Db.all('NOTIFICATIONS').filter(function (n) { return !p.failed || n.DeliveryStatus === 'Failed'; }).map(function (n) {
      return { NotificationID: n.NotificationID, Type: n.NotificationType, To: n.RecipientEmail, Subject: n.Subject, RefType: n.RefType, RefID: n.RefID, SentAt: n.SentAt, Status: n.DeliveryStatus, Error: n.ErrorMessage };
    }).reverse().slice(0, 200);
    return { rows: rows };
  }
};

/** Handler trigger waktu. Nama ini dipakai Automation.JOB; jangan diganti tanpa memasang ulang trigger. */
function emmsDailyJob() {
  const c = Automation.cfg_();
  if (!c.enabled) return;
  Automation.run({}, 'system');
}
