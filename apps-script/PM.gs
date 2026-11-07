/**
 * EMMS - PM.gs  (Phase 3: Preventive Maintenance)
 * Jadwal PM, daftar kerja, pelaksanaan, foto sebelum/sesudah, approval, pengingat Google Calendar.
 *
 * Aturan inti:
 *  - NextDueDate dimajukan dari tanggal jatuh tempo (bukan tanggal selesai) agar jadwal tidak "bergeser";
 *    periode yang terlewat dilompati sampai tanggal berikut > tanggal pelaksanaan.
 *  - Satu jatuh tempo hanya bisa diselesaikan sekali (cegah klik ganda / dua teknisi).
 *  - Approval Rejected mengembalikan jadwal ke jatuh tempo semula (PM muncul lagi sebagai pekerjaan).
 *  - Pelaksana tidak boleh menyetujui PM miliknya sendiri, kecuali Admin (tercatat di audit).
 */

// ============================================================ tanggal
const PMDate = {
  parse_: function (s) { const p = String(s).split('-').map(Number); return { y: p[0], m: p[1], d: p[2] }; },
  fmt_: function (y, m, d) { return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d; },
  daysIn_: function (y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); },
  addMonths: function (s, n) {
    const p = PMDate.parse_(s);
    const total = p.y * 12 + (p.m - 1) + n;
    const y = Math.floor(total / 12), m = (total % 12) + 1;
    return PMDate.fmt_(y, m, Math.min(p.d, PMDate.daysIn_(y, m)));
  },
  /** Satu langkah frekuensi dari tanggal s. */
  step: function (s, freq, days) {
    switch (freq) {
      case 'Weekly': return Db.addDays(s, 7);
      case 'Monthly': return PMDate.addMonths(s, 1);
      case 'Quarterly': return PMDate.addMonths(s, 3);
      case 'Semiannual': return PMDate.addMonths(s, 6);
      case 'Yearly': return PMDate.addMonths(s, 12);
      default: return Db.addDays(s, Math.max(1, Number(days) || 30));
    }
  },
  /** Jatuh tempo berikutnya setelah PM selesai pada `actual` untuk jatuh tempo `due`. */
  next: function (due, actual, freq, days) {
    let n = PMDate.step(due, freq, days), guard = 0;
    while (n <= actual && guard++ < 1000) n = PMDate.step(n, freq, days);
    return n;
  }
};

// ============================================================ Google Calendar
const Cal = {
  enabled: function () { return String(Settings.get('PM_CALENDAR_ENABLED', 'TRUE')).toUpperCase() === 'TRUE'; },
  /** Buat/ubah event seharian di kalender default pemilik script. Tidak pernah melempar error. Mengembalikan EventID. */
  sync: function (sch, eq) {
    const old = sch.CalendarEventID || '';
    if (!Cal.enabled()) return old;
    try {
      if (sch.Status !== 'Active' || !sch.NextDueDate) { Cal.remove(old); return ''; }
      const cal = CalendarApp.getDefaultCalendar();
      const p = PMDate.parse_(sch.NextDueDate);
      const date = new Date(p.y, p.m - 1, p.d);
      const title = '[PM] ' + sch.PMTitle + ' - ' + (eq ? eq.EquipmentID + ' ' + eq.EquipmentName : sch.EquipmentID);
      const desc = 'EMMS ' + sch.PMScheduleID + (sch.Instructions ? '\n' + sch.Instructions : '');
      let ev = null;
      if (old) { try { ev = cal.getEventById(old); } catch (e) { ev = null; } }
      if (ev) { ev.setTitle(title); ev.setAllDayDate(date); ev.setDescription(desc); }
      else { ev = cal.createAllDayEvent(title, date, { description: desc }); try { ev.addPopupReminder(24 * 60); } catch (e) { /* abaikan */ } }
      return ev.getId();
    } catch (e) {
      Logger.log('Calendar sync gagal (' + sch.PMScheduleID + '): ' + (e && e.message));
      return old;
    }
  },
  remove: function (id) {
    if (!id) return;
    try { const ev = CalendarApp.getDefaultCalendar().getEventById(id); if (ev) ev.deleteEvent(); } catch (e) { /* abaikan */ }
  }
};

// ============================================================ PM
const PM = {
  leadDays_: function () {
    const n = Number(Settings.get('PM_LEAD_DAYS', String(CFG.PM_DEFAULT_LEAD_DAYS)));
    return isNaN(n) ? CFG.PM_DEFAULT_LEAD_DAYS : n;
  },
  userName_: function (email) {
    if (!email) return '';
    const u = Db.where('USERS', function (x) { return Auth.norm(x.Email) === Auth.norm(email); })[0];
    return u ? u.FullName : email;
  },
  state_: function (s, today, lead) {
    if (s.Status !== 'Active') return 'Inactive';
    if (!s.NextDueDate) return 'Scheduled';
    if (s.NextDueDate < today) return 'Overdue';
    if (s.NextDueDate <= Db.addDays(today, lead)) return 'DueSoon';
    return 'Scheduled';
  },
  decorate_: function (s, ctx) {
    const e = ctx.eq[s.EquipmentID];
    return {
      PMScheduleID: s.PMScheduleID, EquipmentID: s.EquipmentID, EquipmentName: e ? e.EquipmentName : '',
      CategoryName: e ? (ctx.lk.cat[e.CategoryID] || '') : '', BuildingName: e ? (ctx.lk.bld[e.BuildingID] || '') : '',
      LocationName: e ? (ctx.lk.loc[e.LocationID] || '') : '', PMTitle: s.PMTitle, Frequency: s.Frequency, ScheduleRule: s.ScheduleRule,
      AssignedTechnician: s.AssignedTechnician, TechnicianName: PM.userName_(s.AssignedTechnician), StartDate: s.StartDate,
      NextDueDate: s.NextDueDate, LastDoneDate: s.LastDoneDate, Instructions: s.Instructions, Status: s.Status,
      state: PM.state_(s, ctx.today, ctx.lead), hasCalendar: !!s.CalendarEventID, UpdatedAt: s.UpdatedAt,
      daysLeft: s.NextDueDate ? Math.round((Date.parse(s.NextDueDate) - Date.parse(ctx.today)) / 86400000) : null,
      isMine: !!ctx.me && Auth.norm(s.AssignedTechnician) === ctx.me
    };
  },
  ctx_: function (user) {
    const eq = {};
    Db.all('EQUIPMENT', { includeDeleted: true }).forEach(function (e) { eq[e.EquipmentID] = e; });
    return { eq: eq, lk: Equipment.lookups_(), today: Db.today(), lead: PM.leadDays_(), me: user ? Auth.norm(user.email) : '' };
  },

  /** Data pendukung formulir jadwal. */
  meta: function () {
    return {
      frequencies: CFG.PM_FREQUENCIES,
      technicians: Db.where('USERS', function (u) { return u.Status === 'Active' && u.Role !== 'Viewer'; })
        .map(function (u) { return { email: u.Email, name: u.FullName, role: u.Role }; }),
      leadDays: PM.leadDays_(), calendarEnabled: Cal.enabled()
    };
  },

  // -------------------------------------------------------- jadwal
  scheduleList: function (p, user) {
    const ctx = PM.ctx_(user);
    const rows = Db.all('PM_SCHEDULES').filter(function (s) {
      if (p && p.equipmentId && s.EquipmentID !== p.equipmentId) return false;
      return true;
    }).map(function (s) { return PM.decorate_(s, ctx); });
    const order = { Overdue: 0, DueSoon: 1, Scheduled: 2, Inactive: 3 };
    rows.sort(function (a, b) { return (order[a.state] - order[b.state]) || (a.NextDueDate < b.NextDueDate ? -1 : (a.NextDueDate > b.NextDueDate ? 1 : 0)); });
    return { today: ctx.today, leadDays: ctx.lead, rows: rows };
  },

  scheduleSave: function (p, user) {
    p = p || {};
    const d = p.data || {};
    const errors = [];
    const eq = Db.get('EQUIPMENT', String(d.EquipmentID || ''));
    if (!eq) errors.push({ field: 'EquipmentID', rule: d.EquipmentID ? 'notFound' : 'required' });
    const title = String(d.PMTitle || '').trim();
    if (!title) errors.push({ field: 'PMTitle', rule: 'required' }); else if (title.length > 150) errors.push({ field: 'PMTitle', rule: 'tooLong' });
    const freq = String(d.Frequency || '');
    if (CFG.PM_FREQUENCIES.indexOf(freq) === -1) errors.push({ field: 'Frequency', rule: 'invalid' });
    let rule = '';
    if (freq === 'Custom') {
      rule = String(d.ScheduleRule === undefined || d.ScheduleRule === null ? '' : d.ScheduleRule).trim();
      const n = Number(rule);
      if (!rule) errors.push({ field: 'ScheduleRule', rule: 'required' });
      else if (!(n >= 1 && n <= 730 && Math.floor(n) === n)) errors.push({ field: 'ScheduleRule', rule: 'invalid' });
    }
    const start = String(d.StartDate || '');
    if (!start) errors.push({ field: 'StartDate', rule: 'required' }); else if (!Equipment.isDate_(start)) errors.push({ field: 'StartDate', rule: 'invalid' });
    let due = String(d.NextDueDate || '');
    if (due && !Equipment.isDate_(due)) errors.push({ field: 'NextDueDate', rule: 'invalid' });
    const instr = String(d.Instructions || '').trim();
    if (instr.length > 1000) errors.push({ field: 'Instructions', rule: 'tooLong' });
    const tech = String(d.AssignedTechnician || '').trim();
    if (tech) {
      const u = Db.where('USERS', function (x) { return Auth.norm(x.Email) === Auth.norm(tech) && x.Status === 'Active' && x.Role !== 'Viewer'; })[0];
      if (!u) errors.push({ field: 'AssignedTechnician', rule: 'notFound' });
    }
    const status = d.Status ? String(d.Status) : 'Active';
    if (['Active', 'Inactive'].indexOf(status) === -1) errors.push({ field: 'Status', rule: 'invalid' });
    if (errors.length) throw validationError_(errors);

    const saved = Db.withLock(function () {
      const dup = Db.where('PM_SCHEDULES', function (s) {
        return s.EquipmentID === eq.EquipmentID && s.PMTitle.toLowerCase() === title.toLowerCase() && s.PMScheduleID !== d.PMScheduleID;
      });
      if (dup.length) throw new AppError('CONFLICT', 'Duplicate', { rule: 'duplicate', field: 'PMTitle' });
      const rec = {
        EquipmentID: eq.EquipmentID, PMTitle: title, Frequency: freq, ScheduleRule: rule, AssignedTechnician: Auth.norm(tech),
        StartDate: start, Instructions: instr, Status: status
      };
      if (!d.PMScheduleID) {
        rec.NextDueDate = due || start;
        const r = Db.insert('PM_SCHEDULES', rec, user.email);
        Audit.log(user, 'PM_SCHEDULE_CREATE', 'PM_SCHEDULES', r.PMScheduleID, { equipment: eq.EquipmentID, title: title, freq: freq, next: r.NextDueDate }, 'OK');
        return { rec: r, created: true };
      }
      const cur = Db.get('PM_SCHEDULES', d.PMScheduleID);
      if (!cur) throw new AppError('NOT_FOUND', 'Schedule not found');
      rec.NextDueDate = due || cur.NextDueDate || start;
      const res = Db.update('PM_SCHEDULES', d.PMScheduleID, rec, user.email, { expectedUpdatedAt: d.UpdatedAt });
      Audit.log(user, 'PM_SCHEDULE_UPDATE', 'PM_SCHEDULES', d.PMScheduleID,
        diffObjects_(res.before, res.after, ['EquipmentID', 'PMTitle', 'Frequency', 'ScheduleRule', 'AssignedTechnician', 'StartDate', 'NextDueDate', 'Instructions', 'Status']), 'OK');
      return { rec: res.after, created: false };
    });
    PM.syncCalendar_(saved.rec, eq);
    return PM.decorate_(Db.get('PM_SCHEDULES', saved.rec.PMScheduleID), PM.ctx_(user));
  },

  /** Sinkronkan Calendar di luar lock (lambat), lalu simpan EventID. */
  syncCalendar_: function (sch, eq) {
    const id = Cal.sync(sch, eq);
    if (id !== (sch.CalendarEventID || '')) {
      Db.withLock(function () { Db.update('PM_SCHEDULES', sch.PMScheduleID, { CalendarEventID: id }, 'system'); });
    }
  },

  scheduleDelete: function (p, user) {
    const id = String(p && p.id || '');
    const cur = Db.withLock(function () {
      const c = Db.get('PM_SCHEDULES', id);
      if (!c) throw new AppError('NOT_FOUND', 'Schedule not found');
      Db.update('PM_SCHEDULES', id, { Status: 'Deleted' }, user.email);
      Audit.log(user, 'PM_SCHEDULE_DELETE', 'PM_SCHEDULES', id, { title: c.PMTitle, equipment: c.EquipmentID }, 'OK');
      return c;
    });
    Cal.remove(cur.CalendarEventID);
    Db.withLock(function () { Db.update('PM_SCHEDULES', id, { CalendarEventID: '' }, 'system', { includeDeleted: true }); });
    return { id: id };
  },

  // -------------------------------------------------------- pelaksanaan
  form: function (p, user) {
    const s = Db.get('PM_SCHEDULES', String(p && p.scheduleId || ''));
    if (!s) throw new AppError('NOT_FOUND', 'Schedule not found');
    const ctx = PM.ctx_(user);
    return {
      schedule: PM.decorate_(s, ctx), today: ctx.today, now: Db.now().slice(11, 16),
      minDate: Db.addDays(ctx.today, -CFG.PM_BACKDATE_MAX_DAYS), results: CFG.PM_RESULTS
    };
  },

  complete: function (p, user) {
    p = p || {};
    const errors = [];
    const s0 = Db.get('PM_SCHEDULES', String(p.PMScheduleID || ''));
    if (!s0) throw new AppError('NOT_FOUND', 'Schedule not found');
    if (s0.Status !== 'Active') throw new AppError('CONFLICT', 'Inactive', { rule: 'inactive' });
    const eq = Db.get('EQUIPMENT', s0.EquipmentID);
    if (!eq) throw new AppError('NOT_FOUND', 'Equipment not found');

    const today = Db.today();
    const actual = String(p.ActualDate || today);
    if (!Equipment.isDate_(actual) || actual > today || actual < Db.addDays(today, -CFG.PM_BACKDATE_MAX_DAYS)) errors.push({ field: 'ActualDate', rule: 'invalid' });
    const tm = /^([01]\d|2[0-3]):[0-5]\d$/;
    const st = String(p.StartTime || ''), fn = String(p.FinishTime || '');
    if (!tm.test(st)) errors.push({ field: 'StartTime', rule: st ? 'invalid' : 'required' });
    if (!tm.test(fn)) errors.push({ field: 'FinishTime', rule: fn ? 'invalid' : 'required' });
    if (tm.test(st) && tm.test(fn) && fn < st) errors.push({ field: 'FinishTime', rule: 'timeOrder' });
    if (actual === today && tm.test(fn) && fn > Db.now().slice(11, 16)) errors.push({ field: 'FinishTime', rule: 'future' });
    const result = String(p.MaintenanceResult || '');
    if (CFG.PM_RESULTS.indexOf(result) === -1) errors.push({ field: 'MaintenanceResult', rule: 'required' });
    const before = String(p.MeasurementBefore || '').trim(), after = String(p.MeasurementAfter || '').trim();
    if (before.length > 300) errors.push({ field: 'MeasurementBefore', rule: 'tooLong' });
    if (after.length > 300) errors.push({ field: 'MeasurementAfter', rule: 'tooLong' });
    const remarks = String(p.Remarks || '').trim();
    if (remarks.length > 1000) errors.push({ field: 'Remarks', rule: 'tooLong' });
    else if (result && result !== 'Done' && !remarks) errors.push({ field: 'Remarks', rule: 'required' });
    if (errors.length) throw validationError_(errors);

    const out = Db.withLock(function () {
      const s = Db.get('PM_SCHEDULES', s0.PMScheduleID);
      if (!s || s.Status !== 'Active') throw new AppError('CONFLICT', 'Inactive', { rule: 'inactive' });
      const planned = s.NextDueDate;
      const dupe = Db.where('PREVENTIVE_MAINTENANCE', function (r) {
        return r.PMScheduleID === s.PMScheduleID && r.PlannedDate === planned && r.ApprovalStatus !== 'Rejected';
      });
      if (dupe.length) throw new AppError('CONFLICT', 'Already done', { rule: 'alreadyDone' });
      const rec = Db.insert('PREVENTIVE_MAINTENANCE', {
        PMScheduleID: s.PMScheduleID, EquipmentID: s.EquipmentID, PMTitle: s.PMTitle, PlannedDate: planned, ActualDate: actual,
        StartTime: st, FinishTime: fn, Technician: user.name, TechnicianEmail: Auth.norm(user.email), MaintenanceResult: result,
        MeasurementBefore: before, MeasurementAfter: after, ApprovalStatus: 'Pending', Remarks: remarks, Status: 'Completed'
      }, user.email);
      const next = PMDate.next(planned || actual, actual, s.Frequency, s.ScheduleRule);
      const upd = Db.update('PM_SCHEDULES', s.PMScheduleID, { LastDoneDate: actual, NextDueDate: next }, user.email);
      Audit.log(user, 'PM_COMPLETE', 'PREVENTIVE_MAINTENANCE', rec.PMID, { schedule: s.PMScheduleID, equipment: s.EquipmentID, planned: planned, actual: actual, result: result, next: next }, 'OK');
      return { rec: rec, sch: upd.after, next: next };
    });
    PM.syncCalendar_(out.sch, eq);
    return { PMID: out.rec.PMID, NextDueDate: out.next, ApprovalStatus: 'Pending' };
  },

  // -------------------------------------------------------- foto
  uploadPhoto: function (p, user) {
    const kind = String(p && p.kind || '');
    if (kind !== 'before' && kind !== 'after') throw validationError_([{ field: 'kind', rule: 'invalid' }]);
    const rec = Db.get('PREVENTIVE_MAINTENANCE', String(p && p.pmId || ''));
    if (!rec) throw new AppError('NOT_FOUND', 'PM not found');
    const mine = Auth.norm(rec.TechnicianEmail) === Auth.norm(user.email);
    const approver = Auth.can(user, 'pm.approve');
    if (!(mine || approver)) throw new AppError('FORBIDDEN', 'Forbidden', { rule: 'pm.photo' });
    if (rec.ApprovalStatus === 'Approved') throw new AppError('CONFLICT', 'Locked', { rule: 'locked' });
    const saved = DriveSvc.saveImage('PM_Photos', p.base64, rec.PMID + '_' + kind);
    const col = kind === 'before' ? 'PhotoBeforeID' : 'PhotoAfterID';
    return Db.withLock(function () {
      Db.insert('ATTACHMENTS', { RefType: 'PM', RefID: rec.PMID, DriveFileID: saved.fileId, FileName: saved.name, MimeType: saved.mime, FileSize: saved.size, Caption: kind }, user.email);
      const old = Db.get('PREVENTIVE_MAINTENANCE', rec.PMID)[col];
      const upd = {}; upd[col] = saved.fileId;
      Db.update('PREVENTIVE_MAINTENANCE', rec.PMID, upd, user.email);
      if (old) DriveSvc.trash(old);
      Audit.log(user, 'PM_PHOTO', 'PREVENTIVE_MAINTENANCE', rec.PMID, { kind: kind, size: saved.size }, 'OK');
      return { ok: true };
    });
  },

  photo: function (p) {
    const rec = Db.get('PREVENTIVE_MAINTENANCE', String(p && p.pmId || ''));
    const id = rec ? (p.kind === 'after' ? rec.PhotoAfterID : rec.PhotoBeforeID) : '';
    return { dataUrl: id ? DriveSvc.readDataUrl(id) : '' };
  },

  // -------------------------------------------------------- riwayat & approval
  recPub_: function (r, ctx) {
    const e = ctx.eq[r.EquipmentID];
    return {
      PMID: r.PMID, PMScheduleID: r.PMScheduleID, EquipmentID: r.EquipmentID, EquipmentName: e ? e.EquipmentName : '', PMTitle: r.PMTitle,
      PlannedDate: r.PlannedDate, ActualDate: r.ActualDate, StartTime: r.StartTime, FinishTime: r.FinishTime, Technician: r.Technician,
      MaintenanceResult: r.MaintenanceResult, ApprovalStatus: r.ApprovalStatus, isMine: !!ctx.me && Auth.norm(r.TechnicianEmail) === ctx.me,
      UpdatedAt: r.UpdatedAt
    };
  },

  list: function (p, user) {
    p = p || {};
    const ctx = PM.ctx_(user);
    const from = p.from && Equipment.isDate_(String(p.from)) ? String(p.from) : Db.addDays(ctx.today, -30);
    const to = p.to && Equipment.isDate_(String(p.to)) ? String(p.to) : ctx.today;
    const limit = Math.min(Number(p.limit) || 300, 500);
    const rows = Db.where('PREVENTIVE_MAINTENANCE', function (r) {
      if (r.ActualDate < from || r.ActualDate > to) return false;
      if (p.approval && r.ApprovalStatus !== p.approval) return false;
      if (p.equipmentId && r.EquipmentID !== p.equipmentId) return false;
      if (p.mine && Auth.norm(r.TechnicianEmail) !== ctx.me) return false;
      return true;
    }).sort(function (a, b) { return a.ActualDate + a.StartTime < b.ActualDate + b.StartTime ? 1 : -1; }).slice(0, limit);
    return { from: from, to: to, rows: rows.map(function (r) { return PM.recPub_(r, ctx); }) };
  },

  get: function (p, user) {
    const r = Db.get('PREVENTIVE_MAINTENANCE', String(p && p.id || ''));
    if (!r) throw new AppError('NOT_FOUND', 'PM not found');
    const ctx = PM.ctx_(user);
    const head = PM.recPub_(r, ctx);
    ['MeasurementBefore', 'MeasurementAfter', 'Remarks', 'ApprovedBy', 'ApprovedAt', 'ApprovalRemarks'].forEach(function (k) { head[k] = r[k]; });
    head.hasBefore = !!r.PhotoBeforeID; head.hasAfter = !!r.PhotoAfterID;
    const s = Db.get('PM_SCHEDULES', r.PMScheduleID, { includeDeleted: true });
    head.Instructions = s ? s.Instructions : '';
    const mine = head.isMine;
    return {
      pm: head,
      canApprove: Auth.can(user, 'pm.approve') && r.ApprovalStatus === 'Pending' && (!mine || user.role === 'Admin'),
      canPhoto: r.ApprovalStatus !== 'Approved' && (mine || Auth.can(user, 'pm.approve'))
    };
  },

  approve: function (p, user) {
    const id = String(p && p.id || '');
    const decision = String(p && p.decision || '');
    if (['Approved', 'Rejected'].indexOf(decision) === -1) throw validationError_([{ field: 'decision', rule: 'invalid' }]);
    const remarks = String(p && p.remarks || '').trim();
    if (decision === 'Rejected' && !remarks) throw validationError_([{ field: 'ApprovalRemarks', rule: 'required' }]);
    if (remarks.length > 500) throw validationError_([{ field: 'ApprovalRemarks', rule: 'tooLong' }]);
    const out = Db.withLock(function () {
      const r = Db.get('PREVENTIVE_MAINTENANCE', id);
      if (!r) throw new AppError('NOT_FOUND', 'PM not found');
      if (r.ApprovalStatus !== 'Pending') throw new AppError('CONFLICT', 'Not pending', { rule: 'notPending' });
      if (Auth.norm(r.TechnicianEmail) === Auth.norm(user.email) && user.role !== 'Admin') throw new AppError('FORBIDDEN', 'Self approval', { rule: 'selfApprove' });
      Db.update('PREVENTIVE_MAINTENANCE', id, { ApprovalStatus: decision, ApprovedBy: user.name, ApprovedAt: Db.now(), ApprovalRemarks: remarks }, user.email, { expectedUpdatedAt: p.UpdatedAt });
      let sch = null;
      if (decision === 'Rejected') {
        // kembalikan jadwal: PM harus dikerjakan ulang
        const s = Db.get('PM_SCHEDULES', r.PMScheduleID);
        if (s && s.Status === 'Active') {
          const others = Db.where('PREVENTIVE_MAINTENANCE', function (x) { return x.PMScheduleID === s.PMScheduleID && x.PMID !== id && x.ApprovalStatus !== 'Rejected'; })
            .map(function (x) { return x.ActualDate; }).sort();
          const back = {};
          back.LastDoneDate = others.length ? others[others.length - 1] : '';
          if (!s.NextDueDate || s.NextDueDate > r.PlannedDate) back.NextDueDate = r.PlannedDate;
          sch = Db.update('PM_SCHEDULES', s.PMScheduleID, back, user.email).after;
        }
      }
      Audit.log(user, decision === 'Approved' ? 'PM_APPROVE' : 'PM_REJECT', 'PREVENTIVE_MAINTENANCE', id,
        { remarks: remarks, selfApproved: Auth.norm(r.TechnicianEmail) === Auth.norm(user.email) }, 'OK');
      return { rec: r, sch: sch };
    });
    if (out.sch) PM.syncCalendar_(out.sch, Db.get('EQUIPMENT', out.sch.EquipmentID));
    return { id: id, ApprovalStatus: decision };
  }
};
