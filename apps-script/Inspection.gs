/**
 * EMMS - Inspection.gs
 * Phase 2: manajemen checklist per kategori + Daily Electrical Inspection.
 *
 * Aturan inti (semua dihitung di BACKEND; klien hanya mengirim jawaban):
 *  - Setiap item checklist aktif kategori equipment WAJIB dijawab: OK / NG / NA.
 *  - Item "measure": nilai angka wajib (kecuali NA). Di luar batas min/maks -> otomatis NG.
 *  - Setiap NG wajib punya keterangan; bila ada NG, "Recommendation" (tindakan lanjut) wajib.
 *  - OverallResult: Critical bila ada NG pada item IsCritical; NG bila ada NG lain; selain itu OK.
 *  - Status: Completed (OK) | Open (NG/Critical, menunggu review Supervisor) | Reviewed.
 *  - Equipment dinaikkan statusnya otomatis (tidak pernah diturunkan otomatis): NG -> Warning,
 *    Critical -> Breakdown (CFG.CRITICAL_SETS_BREAKDOWN).
 *  - Temuan Critical -> email ke Supervisor/Manager/Admin (Notification.gs).
 *  - Identitas teknisi, jam, dan tanggal diambil dari server/sesi, bukan dari klien
 *    (tanggal mundur maks 7 hari hanya untuk Supervisor ke atas).
 */

// ============================================================ CHECKLIST
const Checklist = {
  TYPES: ['check', 'measure'],

  pub_: function (c) {
    return {
      ChecklistID: c.ChecklistID, CategoryID: c.CategoryID, ItemNo: c.ItemNo, ItemKey: c.ItemKey, ItemName: c.ItemName,
      ItemType: c.ItemType, Unit: c.Unit, MinValue: c.MinValue, MaxValue: c.MaxValue, IsCritical: c.IsCritical === true,
      Status: c.Status, UpdatedAt: c.UpdatedAt
    };
  },

  forCategory: function (categoryId, includeInactive) {
    return Db.where('INSPECTION_CHECKLISTS', function (r) {
      return r.CategoryID === categoryId && (includeInactive || r.Status === 'Active');
    }).sort(function (a, b) { return (a.ItemNo || 0) - (b.ItemNo || 0); });
  },

  list: function (p) {
    const cid = String(p && p.categoryId || '');
    if (!Db.get('EQUIPMENT_CATEGORIES', cid)) throw new AppError('NOT_FOUND', 'Category not found');
    return Checklist.forCategory(cid, true).map(Checklist.pub_);
  },

  num_: function (v, field, errors) {
    const s = String(v === undefined || v === null ? '' : v).trim().replace(',', '.');
    if (s === '') return '';
    const n = Number(s);
    if (isNaN(n) || !isFinite(n)) { errors.push({ field: field, rule: 'invalid' }); return ''; }
    return n;
  },

  save: function (p, user) {
    p = p || {};
    const d = p.data || {};
    const errors = [];
    const cat = String(p.categoryId || d.CategoryID || '');
    if (!Db.get('EQUIPMENT_CATEGORIES', cat)) throw validationError_([{ field: 'CategoryID', rule: 'notFound' }]);

    const name = String(d.ItemName || '').trim();
    const key = String(d.ItemKey || '').trim();
    if (!name) errors.push({ field: 'ItemName', rule: 'required' }); else if (name.length > 150) errors.push({ field: 'ItemName', rule: 'tooLong' });
    const type = String(d.ItemType || 'check');
    if (Checklist.TYPES.indexOf(type) === -1) errors.push({ field: 'ItemType', rule: 'invalid' });
    const unit = String(d.Unit || '').trim();
    if (unit.length > 20) errors.push({ field: 'Unit', rule: 'tooLong' });
    let min = Checklist.num_(d.MinValue, 'MinValue', errors), max = Checklist.num_(d.MaxValue, 'MaxValue', errors);
    if (min !== '' && max !== '' && min > max) errors.push({ field: 'MaxValue', rule: 'range' });
    let no = String(d.ItemNo === undefined || d.ItemNo === null ? '' : d.ItemNo).trim();
    if (no !== '' && !(/^\d{1,3}$/.test(no) && Number(no) >= 1)) errors.push({ field: 'ItemNo', rule: 'invalid' });
    const critical = d.IsCritical === true || String(d.IsCritical).toUpperCase() === 'TRUE';
    const status = d.Status ? String(d.Status) : 'Active';
    if (['Active', 'Inactive'].indexOf(status) === -1) errors.push({ field: 'Status', rule: 'invalid' });
    if (errors.length) throw validationError_(errors);
    if (type === 'check') { min = ''; max = ''; }

    return Db.withLock(function () {
      const siblings = Checklist.forCategory(cat, true);
      const dup = siblings.filter(function (r) { return r.ChecklistID !== d.ChecklistID && r.ItemName.toLowerCase() === name.toLowerCase(); });
      if (dup.length) throw new AppError('CONFLICT', 'Duplicate', { rule: 'duplicate', field: 'ItemName' });
      const itemNo = no === '' ? siblings.reduce(function (m, r) { return Math.max(m, r.ItemNo || 0); }, 0) + 1 : Number(no);
      const rec = {
        CategoryID: cat, ItemNo: itemNo, ItemKey: key, ItemName: name, ItemType: type, Unit: type === 'measure' ? unit : '',
        MinValue: min, MaxValue: max, IsCritical: critical, Status: status
      };
      if (!d.ChecklistID) {
        const r = Db.insert('INSPECTION_CHECKLISTS', rec, user.email);
        Audit.log(user, 'CHECKLIST_CREATE', 'INSPECTION_CHECKLISTS', r.ChecklistID, { category: cat, item: name }, 'OK');
        return Checklist.pub_(r);
      }
      const cur = Db.get('INSPECTION_CHECKLISTS', d.ChecklistID);
      if (!cur || cur.CategoryID !== cat) throw new AppError('NOT_FOUND', 'Item not found');
      // ItemKey (terjemahan bawaan) dipertahankan hanya bila nama tidak diubah
      if (cur.ItemKey && name !== cur.ItemName) rec.ItemKey = '';
      else if (cur.ItemKey) rec.ItemKey = cur.ItemKey;
      const res = Db.update('INSPECTION_CHECKLISTS', d.ChecklistID, rec, user.email, { expectedUpdatedAt: d.UpdatedAt });
      Audit.log(user, 'CHECKLIST_UPDATE', 'INSPECTION_CHECKLISTS', d.ChecklistID,
        diffObjects_(res.before, res.after, ['ItemNo', 'ItemName', 'ItemType', 'Unit', 'MinValue', 'MaxValue', 'IsCritical', 'Status']), 'OK');
      return Checklist.pub_(res.after);
    });
  },

  /** Soft delete. Riwayat inspeksi lama aman karena hasil menyimpan salinan atribut item. */
  remove: function (p, user) {
    const id = String(p && p.id || '');
    return Db.withLock(function () {
      const cur = Db.get('INSPECTION_CHECKLISTS', id);
      if (!cur) throw new AppError('NOT_FOUND', 'Item not found');
      Db.update('INSPECTION_CHECKLISTS', id, { Status: 'Deleted' }, user.email);
      Audit.log(user, 'CHECKLIST_DELETE', 'INSPECTION_CHECKLISTS', id, { item: cur.ItemName }, 'OK');
      return { id: id };
    });
  },

  /** Salin seluruh item aktif dari satu kategori ke kategori lain yang belum punya checklist aktif. */
  copy: function (p, user) {
    const from = String(p && p.fromCategoryId || ''), to = String(p && p.toCategoryId || '');
    if (!Db.get('EQUIPMENT_CATEGORIES', from)) throw validationError_([{ field: 'fromCategoryId', rule: 'notFound' }]);
    if (!Db.get('EQUIPMENT_CATEGORIES', to)) throw validationError_([{ field: 'toCategoryId', rule: 'notFound' }]);
    if (from === to) throw validationError_([{ field: 'toCategoryId', rule: 'invalid' }]);
    return Db.withLock(function () {
      if (Checklist.forCategory(to, false).length) throw new AppError('CONFLICT', 'Target not empty', { rule: 'notEmpty' });
      const src = Checklist.forCategory(from, false);
      const recs = Db.insertMany('INSPECTION_CHECKLISTS', src.map(function (r) {
        return { CategoryID: to, ItemNo: r.ItemNo, ItemKey: r.ItemKey, ItemName: r.ItemName, ItemType: r.ItemType, Unit: r.Unit,
          MinValue: r.MinValue, MaxValue: r.MaxValue, IsCritical: r.IsCritical };
      }), user.email);
      Audit.log(user, 'CHECKLIST_COPY', 'INSPECTION_CHECKLISTS', to, { from: from, count: recs.length }, 'OK');
      return { copied: recs.length };
    });
  }
};

// ============================================================ INSPECTION
const Inspection = {
  isDate_: function (s) { return Equipment.isDate_(s); },

  /** Data untuk membuka formulir: equipment, checklist aktif, inspeksi hari ini. */
  form: function (p, user) {
    const id = String(p && p.equipmentId || '');
    const eq = Db.get('EQUIPMENT', id);
    if (!eq) throw new AppError('NOT_FOUND', 'Equipment not found');
    const lk = Equipment.lookups_();
    const today = Db.today();
    const items = Checklist.forCategory(eq.CategoryID, false).map(Checklist.pub_);
    const todays = Db.where('DAILY_INSPECTIONS', function (i) { return i.EquipmentID === id && i.InspectionDate === today; })
      .map(function (i) { return { InspectionID: i.InspectionID, InspectionTime: i.InspectionTime, TechnicianName: i.TechnicianName, OverallResult: i.OverallResult }; });
    return {
      equipment: {
        EquipmentID: eq.EquipmentID, EquipmentName: eq.EquipmentName, CategoryName: lk.cat[eq.CategoryID] || '',
        BuildingName: lk.bld[eq.BuildingID] || '', LocationName: lk.loc[eq.LocationID] || '', EquipmentStatus: eq.EquipmentStatus
      },
      items: items,
      todayInspections: todays,
      today: today,
      time: Db.now().slice(11, 16),
      canBackdate: Auth.can(user, 'inspection.backdate'),
      backdateMaxDays: CFG.BACKDATE_MAX_DAYS
    };
  },

  submit: function (p, user) {
    p = p || {};
    const eq = Db.get('EQUIPMENT', String(p.EquipmentID || ''));
    if (!eq) throw new AppError('NOT_FOUND', 'Equipment not found');
    const items = Checklist.forCategory(eq.CategoryID, false);
    if (!items.length) throw new AppError('CONFLICT', 'No checklist', { rule: 'noChecklist' });

    const errors = [];
    const answers = {};
    (Array.isArray(p.items) ? p.items : []).forEach(function (a) {
      if (a && a.ChecklistID) answers[a.ChecklistID] = a;
    });

    // ---- tanggal
    const today = Db.today();
    let date = today;
    if (p.InspectionDate && String(p.InspectionDate) !== today) {
      const d = String(p.InspectionDate);
      const okRange = Inspection.isDate_(d) && d < today && d >= Db.addDays(today, -CFG.BACKDATE_MAX_DAYS);
      if (!Auth.can(user, 'inspection.backdate') || !okRange) errors.push({ field: 'InspectionDate', rule: 'invalid' });
      else date = d;
    }

    // ---- item
    const rows = [];
    let ng = 0, crit = 0;
    items.forEach(function (it) {
      const field = 'item_' + it.ChecklistID;
      const a = answers[it.ChecklistID];
      if (!a) { errors.push({ field: field, rule: 'required' }); return; }
      let result = String(a.Result || '').toUpperCase().replace('/', '');
      if (CFG.INSPECTION_RESULTS.indexOf(result) === -1) { errors.push({ field: field, rule: 'required' }); return; }
      let mv = '';
      if (it.ItemType === 'measure' && result !== 'NA') {
        const raw = String(a.MeasurementValue === undefined || a.MeasurementValue === null ? '' : a.MeasurementValue).trim().replace(',', '.');
        if (raw === '') { errors.push({ field: field, rule: 'required' }); return; }
        mv = Number(raw);
        if (isNaN(mv) || !isFinite(mv)) { errors.push({ field: field, rule: 'invalid' }); return; }
        if ((it.MinValue !== '' && mv < it.MinValue) || (it.MaxValue !== '' && mv > it.MaxValue)) result = 'NG'; // paksa NG bila di luar batas
      }
      const remarks = String(a.Remarks || '').trim();
      if (remarks.length > 500) { errors.push({ field: field, rule: 'tooLong' }); return; }
      if (result === 'NG') {
        ng++;
        if (it.IsCritical === true) crit++;
        if (!remarks) { errors.push({ field: field, rule: 'ngRemarks' }); return; }
      }
      rows.push({ it: it, Result: result, MeasurementValue: mv, Remarks: remarks });
    });

    const remarksAll = String(p.Remarks || '').trim();
    const findingIn = String(p.Finding || '').trim();
    const reco = String(p.Recommendation || '').trim();
    if (remarksAll.length > 500) errors.push({ field: 'Remarks', rule: 'tooLong' });
    if (findingIn.length > 1000) errors.push({ field: 'Finding', rule: 'tooLong' });
    if (reco.length > 1000) errors.push({ field: 'Recommendation', rule: 'tooLong' });
    if (ng > 0 && !reco) errors.push({ field: 'Recommendation', rule: 'required' });
    if (errors.length) throw validationError_(errors);

    const overall = crit > 0 ? 'Critical' : (ng > 0 ? 'NG' : 'OK');
    const ngLines = rows.filter(function (r) { return r.Result === 'NG'; }).map(function (r) {
      return r.it.ItemName + (r.MeasurementValue !== '' ? ' = ' + r.MeasurementValue + (r.it.Unit ? ' ' + r.it.Unit : '') : '') + ': ' + r.Remarks;
    });
    let finding = [findingIn].concat(ngLines).filter(Boolean).join('; ');
    if (finding.length > 1000) finding = finding.slice(0, 997) + '...';

    const saved = Db.withLock(function () {
      const cur = Db.get('EQUIPMENT', eq.EquipmentID);
      if (!cur) throw new AppError('NOT_FOUND', 'Equipment not found');
      const head = Db.insert('DAILY_INSPECTIONS', {
        EquipmentID: cur.EquipmentID, InspectionDate: date, InspectionTime: Db.now().slice(11, 16),
        TechnicianEmail: user.email, TechnicianName: user.name, OverallResult: overall, NGCount: ng, CriticalCount: crit,
        Remarks: remarksAll, Finding: finding, Recommendation: reco, Status: overall === 'OK' ? 'Completed' : 'Open'
      }, user.email);
      const res = Db.insertMany('INSPECTION_RESULTS', rows.map(function (r) {
        return {
          InspectionID: head.InspectionID, ChecklistID: r.it.ChecklistID, ItemNo: r.it.ItemNo, ItemKey: r.it.ItemKey,
          ItemName: r.it.ItemName, ItemType: r.it.ItemType, Unit: r.it.Unit, MinValue: r.it.MinValue, MaxValue: r.it.MaxValue,
          IsCritical: r.it.IsCritical === true, Result: r.Result, MeasurementValue: r.MeasurementValue, Remarks: r.Remarks, PhotoFileID: ''
        };
      }), user.email);

      // Auto-update status equipment (hanya naik)
      let newStatus = cur.EquipmentStatus;
      const rank = { Normal: 0, Warning: 1, Breakdown: 2 };
      const target = crit > 0 ? (CFG.CRITICAL_SETS_BREAKDOWN ? 'Breakdown' : 'Warning') : (ng > 0 ? 'Warning' : null);
      if (target && rank[target] > rank[cur.EquipmentStatus]) {
        Db.update('EQUIPMENT', cur.EquipmentID, { EquipmentStatus: target }, user.email);
        Audit.log(user, 'EQUIPMENT_STATUS_AUTO', 'EQUIPMENT', cur.EquipmentID, { from: cur.EquipmentStatus, to: target, inspection: head.InspectionID }, 'OK');
        newStatus = target;
      }
      Audit.log(user, 'INSPECTION_SUBMIT', 'DAILY_INSPECTIONS', head.InspectionID,
        { equipment: cur.EquipmentID, result: overall, ng: ng, critical: crit }, 'OK');
      return { head: head, res: res, newStatus: newStatus, cur: cur };
    });

    // Email di luar lock agar tidak menahan pengguna lain
    let notified = { sent: 0, failed: 0 };
    if (crit > 0) {
      notified = Notify.criticalFinding(saved.head, saved.cur, rows.filter(function (r) { return r.Result === 'NG' && r.it.IsCritical === true; }).map(function (r) {
        return { ItemName: r.it.ItemName, Remarks: r.Remarks, MeasurementValue: r.MeasurementValue, Unit: r.it.Unit };
      }));
    }
    return {
      InspectionID: saved.head.InspectionID, OverallResult: overall, Status: saved.head.Status, NGCount: ng, CriticalCount: crit,
      EquipmentStatus: saved.newStatus, notified: notified,
      results: saved.res.map(function (r) { return { ResultID: r.ResultID, ChecklistID: r.ChecklistID, Result: r.Result }; })
    };
  },

  // ------------------------------------------------------------ daftar & detail
  decorate_: function (i, lk, eqIdx, user) {
    const e = eqIdx[i.EquipmentID] || {};
    return {
      InspectionID: i.InspectionID, EquipmentID: i.EquipmentID, EquipmentName: e.EquipmentName || '',
      LocationName: lk.loc[e.LocationID] || '', BuildingName: lk.bld[e.BuildingID] || '',
      InspectionDate: i.InspectionDate, InspectionTime: i.InspectionTime, TechnicianName: i.TechnicianName,
      OverallResult: i.OverallResult, NGCount: i.NGCount, CriticalCount: i.CriticalCount, Status: i.Status,
      isMine: Auth.norm(i.TechnicianEmail) === Auth.norm(user.email), UpdatedAt: i.UpdatedAt
    };
  },

  list: function (p, user) {
    p = p || {};
    const today = Db.today();
    const from = p.from && Inspection.isDate_(String(p.from)) ? String(p.from) : Db.addDays(today, -7);
    const to = p.to && Inspection.isDate_(String(p.to)) ? String(p.to) : today;
    const limit = Math.min(Number(p.limit) || 300, 500);
    const lk = Equipment.lookups_();
    const eqIdx = {};
    Db.all('EQUIPMENT', { includeDeleted: true }).forEach(function (e) { eqIdx[e.EquipmentID] = e; });
    const rows = Db.where('DAILY_INSPECTIONS', function (i) {
      if (i.InspectionDate < from || i.InspectionDate > to) return false;
      if (p.equipmentId && i.EquipmentID !== p.equipmentId) return false;
      if (p.result && i.OverallResult !== p.result) return false;
      if (p.status && i.Status !== p.status) return false;
      if (p.mine && Auth.norm(i.TechnicianEmail) !== Auth.norm(user.email)) return false;
      return true;
    }).sort(function (a, b) {
      const ka = a.InspectionDate + ' ' + a.InspectionTime, kb = b.InspectionDate + ' ' + b.InspectionTime;
      return ka < kb ? 1 : (ka > kb ? -1 : 0);
    }).slice(0, limit);
    return { from: from, to: to, rows: rows.map(function (i) { return Inspection.decorate_(i, lk, eqIdx, user); }) };
  },

  get: function (p, user) {
    const i = Db.get('DAILY_INSPECTIONS', String(p && p.id || ''));
    if (!i) throw new AppError('NOT_FOUND', 'Inspection not found');
    const lk = Equipment.lookups_();
    const eqIdx = {};
    const e = Db.get('EQUIPMENT', i.EquipmentID, { includeDeleted: true });
    if (e) eqIdx[e.EquipmentID] = e;
    const items = Db.where('INSPECTION_RESULTS', function (r) { return r.InspectionID === i.InspectionID; })
      .sort(function (a, b) { return (a.ItemNo || 0) - (b.ItemNo || 0); })
      .map(function (r) {
        return {
          ResultID: r.ResultID, ChecklistID: r.ChecklistID, ItemNo: r.ItemNo, ItemKey: r.ItemKey, ItemName: r.ItemName, ItemType: r.ItemType,
          Unit: r.Unit, MinValue: r.MinValue, MaxValue: r.MaxValue, IsCritical: r.IsCritical === true, Result: r.Result,
          MeasurementValue: r.MeasurementValue, Remarks: r.Remarks, hasPhoto: !!r.PhotoFileID
        };
      });
    const head = Inspection.decorate_(i, lk, eqIdx, user);
    head.Finding = i.Finding; head.Recommendation = i.Recommendation; head.Remarks = i.Remarks;
    head.ReviewedBy = i.ReviewedBy; head.ReviewedAt = i.ReviewedAt; head.ReviewRemarks = i.ReviewRemarks;
    return { inspection: head, items: items, canReview: Auth.can(user, 'inspection.review') && i.Status === 'Open' };
  },

  review: function (p, user) {
    const id = String(p && p.id || '');
    const remarks = String(p && p.remarks || '').trim();
    if (!remarks) throw validationError_([{ field: 'ReviewRemarks', rule: 'required' }]);
    if (remarks.length > 500) throw validationError_([{ field: 'ReviewRemarks', rule: 'tooLong' }]);
    return Db.withLock(function () {
      const cur = Db.get('DAILY_INSPECTIONS', id);
      if (!cur) throw new AppError('NOT_FOUND', 'Inspection not found');
      if (cur.Status !== 'Open') throw new AppError('CONFLICT', 'Not open', { rule: 'notOpen' });
      Db.update('DAILY_INSPECTIONS', id, { Status: 'Reviewed', ReviewedBy: user.name, ReviewedAt: Db.now(), ReviewRemarks: remarks },
        user.email, { expectedUpdatedAt: p.UpdatedAt });
      Audit.log(user, 'INSPECTION_REVIEW', 'DAILY_INSPECTIONS', id, { remarks: remarks, result: cur.OverallResult }, 'OK');
      return { id: id, Status: 'Reviewed' };
    });
  },

  // ------------------------------------------------------------ foto
  uploadPhoto: function (p, user) {
    const rid = String(p && p.resultId || '');
    const r = Db.get('INSPECTION_RESULTS', rid);
    if (!r) throw new AppError('NOT_FOUND', 'Result not found');
    const insp = Db.get('DAILY_INSPECTIONS', r.InspectionID);
    if (!insp) throw new AppError('NOT_FOUND', 'Inspection not found');
    const mine = Auth.norm(insp.TechnicianEmail) === Auth.norm(user.email);
    if (!mine && !Auth.can(user, 'inspection.review')) throw new AppError('FORBIDDEN', 'Forbidden', { rule: 'inspection.photo' });
    const saved = DriveSvc.saveImage('Inspection_Photos', p.base64, r.InspectionID + '_' + rid);
    return Db.withLock(function () {
      Db.insert('ATTACHMENTS', {
        RefType: 'INSPECTION_RESULT', RefID: rid, DriveFileID: saved.fileId, FileName: saved.name,
        MimeType: saved.mime, FileSize: saved.size, Caption: r.ItemName
      }, user.email);
      Db.update('INSPECTION_RESULTS', rid, { PhotoFileID: saved.fileId }, user.email);
      if (r.PhotoFileID) DriveSvc.trash(r.PhotoFileID);
      Audit.log(user, 'INSPECTION_PHOTO', 'INSPECTION_RESULTS', rid, { inspection: r.InspectionID, size: saved.size }, 'OK');
      return { ok: true };
    });
  },

  photo: function (p) {
    const r = Db.get('INSPECTION_RESULTS', String(p && p.resultId || ''));
    if (!r || !r.PhotoFileID) return { dataUrl: '' };
    return { dataUrl: DriveSvc.readDataUrl(r.PhotoFileID) };
  },

  // ------------------------------------------------------------ papan "hari ini"
  todayStatus: function (p, user) {
    const today = Db.today();
    const lk = Equipment.lookups_();
    const eq = Db.all('EQUIPMENT').filter(function (e) { return e.Status === 'Active'; });
    const sorted = Db.where('DAILY_INSPECTIONS', function (i) { return i.InspectionDate === today; })
      .sort(function (a, b) { return a.InspectionTime < b.InspectionTime ? -1 : 1; });
    const last = {}, cnt = {};
    sorted.forEach(function (i) { last[i.EquipmentID] = i; cnt[i.EquipmentID] = (cnt[i.EquipmentID] || 0) + 1; });
    const hasCl = {};
    Db.where('INSPECTION_CHECKLISTS', function (c) { return c.Status === 'Active'; }).forEach(function (c) { hasCl[c.CategoryID] = true; });
    const rows = eq.map(function (e) {
      const l = last[e.EquipmentID];
      return {
        EquipmentID: e.EquipmentID, EquipmentName: e.EquipmentName, CategoryName: lk.cat[e.CategoryID] || '',
        BuildingID: e.BuildingID, BuildingName: lk.bld[e.BuildingID] || '', LocationName: lk.loc[e.LocationID] || '',
        EquipmentStatus: e.EquipmentStatus, hasChecklist: !!hasCl[e.CategoryID],
        inspectedToday: !!l, count: cnt[e.EquipmentID] || 0,
        lastResult: l ? l.OverallResult : '', lastTime: l ? l.InspectionTime : '', lastBy: l ? l.TechnicianName : '', lastId: l ? l.InspectionID : ''
      };
    }).sort(function (a, b) { return a.EquipmentID < b.EquipmentID ? -1 : 1; });
    return {
      today: today, rows: rows,
      summary: {
        total: rows.length, inspected: rows.filter(function (r) { return r.inspectedToday; }).length,
        ng: rows.filter(function (r) { return r.lastResult === 'NG' || r.lastResult === 'Critical'; }).length
      }
    };
  }
};
