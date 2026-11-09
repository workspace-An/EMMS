/**
 * EMMS - Equipment.gs
 * CRUD equipment, QR Code, foto, detail dengan riwayat. Hapus = soft delete berpengaman.
 */
const Equipment = {
  FIELDS: ['EquipmentName', 'CategoryID', 'BuildingID', 'LocationID', 'ProductionArea', 'Brand', 'Model', 'SerialNumber',
    'ElectricalSpec', 'Voltage', 'Current', 'PowerRating', 'InstallationDate', 'CommissioningDate', 'Condition',
    'EquipmentStatus', 'Notes'],
  DATE_FIELDS: ['InstallationDate', 'CommissioningDate'],
  REQUIRED: ['EquipmentName', 'CategoryID', 'BuildingID', 'LocationID'],
  MAXLEN: { Notes: 1000, ElectricalSpec: 300 }, // default 200

  isDate_: function (s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const p = s.split('-').map(Number);
    const d = new Date(p[0], p[1] - 1, p[2]);
    return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
  },

  /** Whitelist + validasi. Field di luar daftar diabaikan (mencegah mass-assignment). */
  clean_: function (p) {
    const errors = [];
    const out = {};
    Equipment.FIELDS.forEach(function (f) {
      let v = p[f] === undefined || p[f] === null ? '' : String(p[f]).trim();
      const max = Equipment.MAXLEN[f] || 200;
      if (v.length > max) errors.push({ field: f, rule: 'tooLong' });
      if (Equipment.REQUIRED.indexOf(f) !== -1 && !v) errors.push({ field: f, rule: 'required' });
      if (Equipment.DATE_FIELDS.indexOf(f) !== -1 && v && !Equipment.isDate_(v)) errors.push({ field: f, rule: 'invalid' });
      out[f] = v;
    });
    if (!out.Condition) out.Condition = 'Good';
    if (!out.EquipmentStatus) out.EquipmentStatus = 'Normal';
    if (CFG.CONDITIONS.indexOf(out.Condition) === -1) errors.push({ field: 'Condition', rule: 'invalid' });
    if (CFG.EQUIPMENT_STATUSES.indexOf(out.EquipmentStatus) === -1) errors.push({ field: 'EquipmentStatus', rule: 'invalid' });
    if (out.InstallationDate && out.CommissioningDate && Equipment.isDate_(out.InstallationDate) &&
      Equipment.isDate_(out.CommissioningDate) && out.CommissioningDate < out.InstallationDate) {
      errors.push({ field: 'CommissioningDate', rule: 'dateOrder' });
    }
    if (errors.length) throw validationError_(errors);
    return out;
  },

  checkRefs_: function (c) {
    if (!Db.get('EQUIPMENT_CATEGORIES', c.CategoryID)) throw validationError_([{ field: 'CategoryID', rule: 'notFound' }]);
    if (!Db.get('BUILDINGS', c.BuildingID)) throw validationError_([{ field: 'BuildingID', rule: 'notFound' }]);
    const loc = Db.get('LOCATIONS', c.LocationID);
    if (!loc) throw validationError_([{ field: 'LocationID', rule: 'notFound' }]);
    if (loc.BuildingID !== c.BuildingID) throw validationError_([{ field: 'LocationID', rule: 'mismatch' }]);
  },

  checkDuplicateSerial_: function (c, selfId) {
    if (!c.SerialNumber) return;
    const dup = Db.where('EQUIPMENT', function (e) {
      return e.EquipmentID !== selfId && e.SerialNumber.toLowerCase() === c.SerialNumber.toLowerCase() &&
        e.Brand.toLowerCase() === c.Brand.toLowerCase();
    });
    if (dup.length) throw new AppError('CONFLICT', 'Duplicate serial', { rule: 'duplicate', field: 'SerialNumber' });
  },

  /** Peta nama relasi sekali untuk dekorasi daftar. */
  lookups_: function () {
    const m = Master.all();
    const idx = function (arr, k, v) { const o = {}; arr.forEach(function (r) { o[r[k]] = r[v]; }); return o; };
    return {
      cat: idx(m.categories, 'CategoryID', 'CategoryName'),
      bld: idx(m.buildings, 'BuildingID', 'BuildingName'),
      loc: idx(m.locations, 'LocationID', 'LocationName')
    };
  },

  pub_: function (e, lk, user) {
    const o = {
      EquipmentID: e.EquipmentID, EquipmentName: e.EquipmentName, CategoryID: e.CategoryID, BuildingID: e.BuildingID,
      LocationID: e.LocationID, ProductionArea: e.ProductionArea, Brand: e.Brand, Model: e.Model,
      SerialNumber: e.SerialNumber, ElectricalSpec: e.ElectricalSpec, Voltage: e.Voltage, Current: e.Current,
      PowerRating: e.PowerRating, InstallationDate: e.InstallationDate, CommissioningDate: e.CommissioningDate,
      Condition: e.Condition, EquipmentStatus: e.EquipmentStatus, PhotoFileID: e.PhotoFileID ? true : false,
      Notes: e.Notes, Status: e.Status, UpdatedAt: e.UpdatedAt, CreatedAt: e.CreatedAt,
      CategoryName: lk.cat[e.CategoryID] || '', BuildingName: lk.bld[e.BuildingID] || '', LocationName: lk.loc[e.LocationID] || ''
    };
    if (Auth.can(user, 'users.view')) { o.CreatedBy = e.CreatedBy; o.UpdatedBy = e.UpdatedBy; }
    return o;
  },

  list: function (p, user) {
    p = p || {};
    const lk = Equipment.lookups_();
    const q = String(p.search || '').trim().toLowerCase();
    const rows = Db.all('EQUIPMENT', { includeDeleted: !!(p.includeDeleted && Auth.can(user, 'equipment.restore')) }).filter(function (e) {
      if (p.categoryId && e.CategoryID !== p.categoryId) return false;
      if (p.buildingId && e.BuildingID !== p.buildingId) return false;
      if (p.locationId && e.LocationID !== p.locationId) return false;
      if (p.equipmentStatus && e.EquipmentStatus !== p.equipmentStatus) return false;
      if (p.condition && e.Condition !== p.condition) return false;
      if (q) {
        const hay = [e.EquipmentID, e.EquipmentName, e.Brand, e.Model, e.SerialNumber, e.ProductionArea,
          lk.cat[e.CategoryID], lk.bld[e.BuildingID], lk.loc[e.LocationID]].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    rows.sort(function (a, b) { return a.EquipmentID < b.EquipmentID ? -1 : 1; });
    return rows.map(function (e) { return Equipment.pub_(e, lk, user); });
  },

  get: function (p, user) {
    const id = String(p && p.id || '');
    const e = Db.get('EQUIPMENT', id, { includeDeleted: Auth.can(user, 'equipment.restore') });
    if (!e) throw new AppError('NOT_FOUND', 'Equipment not found');
    const lk = Equipment.lookups_();
    const byEq = function (r) { return r.EquipmentID === id; };
    const desc = function (key) { return function (a, b) { return a[key] < b[key] ? 1 : -1; }; };
    const slim = function (arr, fields) {
      return arr.map(function (r) { const o = {}; fields.forEach(function (f) { o[f] = r[f]; }); return o; });
    };
    const qrs = Db.where('EQUIPMENT_QR_CODES', byEq).sort(desc('Version'));
    const out = {
      equipment: Equipment.pub_(e, lk, user),
      qr: qrs.length ? { Version: qrs[0].Version, QRPayload: qrs[0].QRPayload, CreatedAt: qrs[0].CreatedAt } : null,
      history: {
        inspections: slim(Db.where('DAILY_INSPECTIONS', byEq).sort(desc('InspectionDate')).slice(0, 20),
          ['InspectionID', 'InspectionDate', 'TechnicianName', 'OverallResult', 'Status']),
        preventive: slim(Db.where('PREVENTIVE_MAINTENANCE', byEq).sort(desc('PlannedDate')).slice(0, 20),
          ['PMID', 'PlannedDate', 'ActualDate', 'Technician', 'MaintenanceResult', 'Status']),
        corrective: slim(Db.where('CORRECTIVE_MAINTENANCE', byEq).sort(desc('DateReported')).slice(0, 20),
          ['ComplaintNo', 'DateReported', 'ProblemDescription', 'Priority', 'Status']),
        workOrders: slim(Db.where('WORK_ORDERS', byEq).sort(desc('CreatedAt')).slice(0, 20),
          ['WorkOrderID', 'Title', 'Priority', 'AssignedTo', 'Status'])
      },
      audit: Auth.can(user, 'audit.view') ? Audit.list({ entity: 'EQUIPMENT', entityId: id, limit: 20 }) : []
    };
    return out;
  },

  create: function (p, user) {
    const c = Equipment.clean_(p || {});
    return Db.withLock(function () {
      Equipment.checkRefs_(c);
      Equipment.checkDuplicateSerial_(c, null);
      const rec = Db.insert('EQUIPMENT', Object.assign({ PhotoFileID: '' }, c), user.email);
      Equipment.addQr_(rec.EquipmentID, 1, user.email);
      Audit.log(user, 'EQUIPMENT_CREATE', 'EQUIPMENT', rec.EquipmentID, { name: c.EquipmentName, category: c.CategoryID, location: c.LocationID }, 'OK');
      return Equipment.pub_(rec, Equipment.lookups_(), user);
    });
  },

  update: function (p, user) {
    const id = String(p && p.EquipmentID || '');
    const c = Equipment.clean_(p || {});
    return Db.withLock(function () {
      const cur = Db.get('EQUIPMENT', id);
      if (!cur) throw new AppError('NOT_FOUND', 'Equipment not found');
      Equipment.checkRefs_(c);
      Equipment.checkDuplicateSerial_(c, id);
      const res = Db.update('EQUIPMENT', id, c, user.email, { expectedUpdatedAt: p.UpdatedAt });
      Audit.log(user, 'EQUIPMENT_UPDATE', 'EQUIPMENT', id, diffObjects_(res.before, res.after, Equipment.FIELDS), 'OK');
      return Equipment.pub_(res.after, Equipment.lookups_(), user);
    });
  },

  /**
   * Hapus berpengaman: wajib alasan + ketik ulang ID, ditolak jika masih ada pekerjaan terbuka.
   * Data tidak dihapus fisik (Status=Deleted) sehingga riwayat tetap utuh dan dapat dipulihkan Admin.
   */
  remove: function (p, user) {
    const id = String(p && p.id || '');
    const reason = String(p && p.reason || '').trim();
    if (!reason) throw validationError_([{ field: 'reason', rule: 'required' }]);
    if (reason.length > 300) throw validationError_([{ field: 'reason', rule: 'tooLong' }]);
    if (String(p.confirmId || '') !== id) throw validationError_([{ field: 'confirmId', rule: 'mismatch' }]);
    return Db.withLock(function () {
      const cur = Db.get('EQUIPMENT', id);
      if (!cur) throw new AppError('NOT_FOUND', 'Equipment not found');
      const openStatuses = ['Open', 'In Progress', 'Pending', 'Draft', 'Submitted', 'Approved', 'Assigned'];
      const open = ['WORK_ORDERS', 'CORRECTIVE_MAINTENANCE'].some(function (t) {
        return Db.count(t, function (r) { return r.EquipmentID === id && openStatuses.indexOf(r.Status) !== -1; }) > 0;
      });
      if (open) throw new AppError('CONFLICT', 'Open work exists', { rule: 'openWork' });
      Db.update('EQUIPMENT', id, { Status: 'Deleted' }, user.email);
      Audit.log(user, 'EQUIPMENT_DELETE', 'EQUIPMENT', id, { reason: reason, name: cur.EquipmentName }, 'OK');
      return { id: id };
    });
  },

  restore: function (p, user) {
    const id = String(p && p.id || '');
    return Db.withLock(function () {
      const cur = Db.get('EQUIPMENT', id, { includeDeleted: true });
      if (!cur || cur.Status !== 'Deleted') throw new AppError('NOT_FOUND', 'Equipment not found');
      Db.update('EQUIPMENT', id, { Status: 'Active' }, user.email);
      Audit.log(user, 'EQUIPMENT_RESTORE', 'EQUIPMENT', id, null, 'OK');
      return { id: id };
    });
  },

  // ---------------------------------------------------------------- QR
  addQr_: function (equipmentId, version, by) {
    const base = Settings.webAppUrl();
    return Db.insert('EQUIPMENT_QR_CODES', {
      EquipmentID: equipmentId,
      QRPayload: (base ? base : '') + '?eq=' + encodeURIComponent(equipmentId),
      Version: version
    }, by);
  },

  regenerateQr: function (p, user) {
    const id = String(p && p.id || '');
    return Db.withLock(function () {
      if (!Db.get('EQUIPMENT', id)) throw new AppError('NOT_FOUND', 'Equipment not found');
      const olds = Db.where('EQUIPMENT_QR_CODES', function (r) { return r.EquipmentID === id; });
      const ver = olds.reduce(function (m, r) { return Math.max(m, r.Version || 0); }, 0) + 1;
      olds.forEach(function (r) { if (r.Status === 'Active') Db.update('EQUIPMENT_QR_CODES', r.QRID, { Status: 'Inactive' }, user.email); });
      const rec = Equipment.addQr_(id, ver, user.email);
      Audit.log(user, 'EQUIPMENT_QR_REGENERATE', 'EQUIPMENT', id, { version: ver }, 'OK');
      return { Version: rec.Version, QRPayload: rec.QRPayload };
    });
  },

  // ---------------------------------------------------------------- Foto
  uploadPhoto: function (p, user) {
    const id = String(p && p.id || '');
    const cur = Db.get('EQUIPMENT', id);
    if (!cur) throw new AppError('NOT_FOUND', 'Equipment not found');
    const saved = DriveSvc.saveImage('Equipment_Photos', p.base64, id);
    return Db.withLock(function () {
      Db.insert('ATTACHMENTS', {
        RefType: 'EQUIPMENT', RefID: id, DriveFileID: saved.fileId, FileName: saved.name,
        MimeType: saved.mime, FileSize: saved.size, Caption: 'Equipment photo'
      }, user.email);
      Db.update('EQUIPMENT', id, { PhotoFileID: saved.fileId }, user.email);
      if (cur.PhotoFileID) DriveSvc.trash(cur.PhotoFileID);
      Audit.log(user, 'EQUIPMENT_PHOTO', 'EQUIPMENT', id, { file: saved.name, size: saved.size }, 'OK');
      return { ok: true };
    });
  },

  photo: function (p) {
    const id = String(p && p.id || '');
    const cur = Db.get('EQUIPMENT', id);
    if (!cur || !cur.PhotoFileID) return { dataUrl: '' };
    return { dataUrl: DriveSvc.readDataUrl(cur.PhotoFileID) };
  }
};
