/**
 * EMMS - Safety.gs  (Phase 5: Electrical Safety / K3 Listrik)
 * Temuan K3, penilaian risiko 5x5, dan LOTO (Lock Out Tag Out).
 *
 * Aturan inti (dipakai juga oleh Work Order):
 *  - Skor risiko = Likelihood x Severity dihitung SERVER (klien tidak bisa memalsukan tingkat risiko).
 *  - Skor >= RISK_APPROVAL_MIN (High/Critical) wajib disetujui Manager/Admin; penilai tidak boleh menyetujui
 *    penilaiannya sendiri (kecuali Admin, tercatat di audit).
 *  - WO tidak boleh Mulai bila penilaian risiko terakhirnya belum disetujui, dan tidak boleh Selesai
 *    selama LOTO-nya masih terpasang.
 *  - Satu LOTO aktif per equipment dan nomor gembok aktif harus unik.
 *  - Temuan tidak boleh ditutup selama WO tindak lanjutnya masih berjalan, dan temuan High/Critical butuh
 *    penilaian risiko sebelum ditutup.
 */
const Risk = {
  level_: function (score) {
    const th = CFG.RISK_THRESHOLDS;
    return score >= th.Critical ? 'Critical' : (score >= th.High ? 'High' : (score >= th.Medium ? 'Medium' : 'Low'));
  },
  rec_: function (id) {
    const r = Db.get('RISK_ASSESSMENTS', String(id || ''));
    if (!r) throw new AppError('NOT_FOUND', 'Risk assessment not found');
    return r;
  },
  /** Penilaian terakhir untuk Safety/WO (urut ID naik = urut waktu). */
  latest_: function (field, id) {
    const rows = Db.where('RISK_ASSESSMENTS', function (r) { return r[field] === id; });
    return rows.length ? rows[rows.length - 1] : null;
  },
  pub_: function (r) {
    return {
      RiskID: r.RiskID, SafetyID: r.SafetyID, WorkOrderID: r.WorkOrderID, Hazard: r.Hazard, Likelihood: r.Likelihood, Severity: r.Severity, RiskScore: r.RiskScore,
      RiskLevel: r.RiskLevel, Controls: r.Controls, RequiresApproval: r.RequiresApproval === true, AssessedBy: r.AssessedBy, ApprovedBy: r.ApprovedBy,
      ApprovedAt: r.ApprovedAt, ApprovalRemarks: r.ApprovalRemarks, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt
    };
  },

  list: function (p) {
    p = p || {};
    const rows = Db.where('RISK_ASSESSMENTS', function (r) {
      if (p.safetyId && r.SafetyID !== p.safetyId) return false;
      if (p.workOrderId && r.WorkOrderID !== p.workOrderId) return false;
      if (!p.safetyId && !p.workOrderId && p.pending && !(r.RequiresApproval === true && !r.ApprovedBy)) return false;
      return true;
    }).map(Risk.pub_);
    return { rows: rows };
  },

  save: function (p, user) {
    p = p || {};
    const errors = [];
    const safetyId = String(p.SafetyID || ''), woId = String(p.WorkOrderID || '');
    if (!safetyId && !woId) errors.push({ field: 'SafetyID', rule: 'required' });
    const hazard = String(p.Hazard || '').trim(), controls = String(p.Controls || '').trim();
    if (!hazard) errors.push({ field: 'Hazard', rule: 'required' }); else if (hazard.length > 500) errors.push({ field: 'Hazard', rule: 'tooLong' });
    if (!controls) errors.push({ field: 'Controls', rule: 'required' }); else if (controls.length > 1000) errors.push({ field: 'Controls', rule: 'tooLong' });
    const L = Number(p.Likelihood), S = Number(p.Severity);
    if (!(L >= 1 && L <= 5 && Math.floor(L) === L)) errors.push({ field: 'Likelihood', rule: 'invalid' });
    if (!(S >= 1 && S <= 5 && Math.floor(S) === S)) errors.push({ field: 'Severity', rule: 'invalid' });
    if (errors.length) throw validationError_(errors);
    const score = L * S, level = Risk.level_(score), needs = score >= CFG.RISK_APPROVAL_MIN;
    return Db.withLock(function () {
      let safety = null, wo = null;
      if (safetyId) { safety = Db.get('ELECTRICAL_SAFETY', safetyId); if (!safety) throw new AppError('NOT_FOUND', 'Finding not found'); if (safety.Status === 'Closed' || safety.Status === 'Dismissed') throw new AppError('CONFLICT', 'Bad state', { rule: 'badState' }); }
      if (woId) { wo = Db.get('WORK_ORDERS', woId); if (!wo) throw new AppError('NOT_FOUND', 'Work order not found'); if (['Completed', 'Closed', 'Rejected', 'Cancelled'].indexOf(wo.Status) !== -1) throw new AppError('CONFLICT', 'Bad state', { rule: 'badState' }); }
      const r = Db.insert('RISK_ASSESSMENTS', {
        SafetyID: safetyId, WorkOrderID: woId, Hazard: hazard, Likelihood: L, Severity: S, RiskScore: score, RiskLevel: level, Controls: controls,
        RequiresApproval: needs, ApprovedBy: '', AssessedBy: user.name, AssessedByEmail: Auth.norm(user.email)
      }, user.email);
      if (safety) Db.update('ELECTRICAL_SAFETY', safetyId, { RiskLevel: level }, user.email);
      Audit.log(user, 'RISK_ASSESS', 'RISK_ASSESSMENTS', r.RiskID, { safety: safetyId, wo: woId, score: score, level: level, needsApproval: needs }, 'OK');
      return { RiskID: r.RiskID, RiskScore: score, RiskLevel: level, RequiresApproval: needs };
    });
  },

  approve: function (p, user) {
    const decision = String(p && p.decision || 'Approved');
    if (['Approved', 'Rejected'].indexOf(decision) === -1) throw validationError_([{ field: 'decision', rule: 'invalid' }]);
    const remarks = String(p && p.remarks || '').trim();
    if (decision === 'Rejected' && !remarks) throw validationError_([{ field: 'ApprovalRemarks', rule: 'required' }]);
    if (remarks.length > 500) throw validationError_([{ field: 'ApprovalRemarks', rule: 'tooLong' }]);
    return Db.withLock(function () {
      const r = Risk.rec_(p && p.id);
      if (r.RequiresApproval !== true) throw new AppError('CONFLICT', 'No approval needed', { rule: 'noApprovalNeeded' });
      if (r.ApprovedBy) throw new AppError('CONFLICT', 'Already decided', { rule: 'notPending' });
      const self = Auth.norm(r.AssessedByEmail) === Auth.norm(user.email);
      if (self && user.role !== 'Admin') throw new AppError('FORBIDDEN', 'Self approval', { rule: 'selfApprove' });
      // Penolakan: ApprovedBy tetap kosong dan penilaian ditandai lewat catatan; penilai harus membuat penilaian baru.
      if (decision === 'Rejected') {
        Db.update('RISK_ASSESSMENTS', r.RiskID, { ApprovalRemarks: 'REJECTED: ' + remarks, ApprovedBy: '', RequiresApproval: true }, user.email);
      } else {
        Db.update('RISK_ASSESSMENTS', r.RiskID, { ApprovedBy: user.name, ApprovedAt: Db.now(), ApprovalRemarks: remarks }, user.email);
      }
      Approvals.record('RISK', r.RiskID, 1, decision, user, remarks);
      Audit.log(user, decision === 'Approved' ? 'RISK_APPROVE' : 'RISK_REJECT', 'RISK_ASSESSMENTS', r.RiskID, { remarks: remarks, selfApproved: self }, 'OK');
      return { RiskID: r.RiskID, decision: decision };
    });
  }
};

const Loto = {
  rec_: function (id) {
    const l = Db.get('LOTO_RECORDS', String(id || ''));
    if (!l) throw new AppError('NOT_FOUND', 'LOTO not found');
    return l;
  },
  pub_: function (l, ctx) {
    const e = ctx.eq[l.EquipmentID];
    return {
      LOTOID: l.LOTOID, WorkOrderID: l.WorkOrderID, EquipmentID: l.EquipmentID, EquipmentName: e ? e.EquipmentName : '', IsolationPoints: l.IsolationPoints, LockNo: l.LockNo,
      AppliedBy: l.AppliedBy, AppliedAt: l.AppliedAt, RemovedBy: l.RemovedBy, RemovedAt: l.RemovedAt, VerificationNotes: l.VerificationNotes, RemoveRemarks: l.RemoveRemarks,
      Status: l.Status, isMine: !!ctx.me && Auth.norm(l.AppliedByEmail) === ctx.me, UpdatedAt: l.UpdatedAt
    };
  },
  list: function (p, user) {
    p = p || {};
    const eq = {};
    Db.all('EQUIPMENT', { includeDeleted: true }).forEach(function (e) { eq[e.EquipmentID] = e; });
    const ctx = { eq: eq, me: Auth.norm(user.email) };
    const rows = Db.all('LOTO_RECORDS').filter(function (l) {
      if (p.active && l.Status !== 'Active') return false;
      if (p.workOrderId && l.WorkOrderID !== p.workOrderId) return false;
      if (p.equipmentId && l.EquipmentID !== p.equipmentId) return false;
      return true;
    }).map(function (l) { return Loto.pub_(l, ctx); });
    rows.sort(function (a, b) { return a.LOTOID < b.LOTOID ? 1 : -1; });
    return { rows: rows.slice(0, 300), canRemoveAny: Auth.can(user, 'safety.assess') };
  },

  apply: function (p, user) {
    p = p || {};
    const errors = [];
    const pts = String(p.IsolationPoints || '').trim(), lock = String(p.LockNo || '').trim(), ver = String(p.VerificationNotes || '').trim();
    if (!pts) errors.push({ field: 'IsolationPoints', rule: 'required' }); else if (pts.length > 500) errors.push({ field: 'IsolationPoints', rule: 'tooLong' });
    if (!lock) errors.push({ field: 'LockNo', rule: 'required' }); else if (lock.length > 40) errors.push({ field: 'LockNo', rule: 'tooLong' });
    if (!ver) errors.push({ field: 'VerificationNotes', rule: 'required' }); else if (ver.length > 500) errors.push({ field: 'VerificationNotes', rule: 'tooLong' });
    if (!p.WorkOrderID) errors.push({ field: 'WorkOrderID', rule: 'required' });
    if (errors.length) throw validationError_(errors);
    return Db.withLock(function () {
      const wo = Db.get('WORK_ORDERS', String(p.WorkOrderID));
      if (!wo) throw new AppError('NOT_FOUND', 'Work order not found');
      if (['Approved', 'In Progress'].indexOf(wo.Status) === -1) throw new AppError('CONFLICT', 'Bad state', { rule: 'badState' });
      if (!(Auth.can(user, 'safety.assess') || Auth.norm(wo.AssignedTo) === Auth.norm(user.email))) throw new AppError('FORBIDDEN', 'Not assignee', { rule: 'notAssignee' });
      const active = Db.where('LOTO_RECORDS', function (l) { return l.Status === 'Active'; });
      const sameEq = active.filter(function (l) { return l.EquipmentID === wo.EquipmentID; })[0];
      if (sameEq) throw new AppError('CONFLICT', 'LOTO active', { rule: 'lotoActive', lotoId: sameEq.LOTOID, workOrderId: sameEq.WorkOrderID });
      if (active.some(function (l) { return String(l.LockNo).toLowerCase() === lock.toLowerCase(); })) throw new AppError('CONFLICT', 'Lock in use', { rule: 'lockInUse' });
      const rec = Db.insert('LOTO_RECORDS', {
        WorkOrderID: wo.WorkOrderID, EquipmentID: wo.EquipmentID, IsolationPoints: pts, LockNo: lock, AppliedBy: user.name, AppliedByEmail: Auth.norm(user.email),
        AppliedAt: Db.now(), VerificationNotes: ver, Status: 'Active'
      }, user.email);
      Audit.log(user, 'LOTO_APPLY', 'LOTO_RECORDS', rec.LOTOID, { wo: wo.WorkOrderID, equipment: wo.EquipmentID, lock: lock }, 'OK');
      return { LOTOID: rec.LOTOID };
    });
  },

  remove: function (p, user) {
    const remarks = String(p && p.remarks || '').trim();
    if (remarks.length > 500) throw validationError_([{ field: 'RemoveRemarks', rule: 'tooLong' }]);
    return Db.withLock(function () {
      const l = Loto.rec_(p && p.id);
      if (l.Status !== 'Active') throw new AppError('CONFLICT', 'Not active', { rule: 'notActive' });
      const mine = Auth.norm(l.AppliedByEmail) === Auth.norm(user.email);
      if (!mine) {
        if (!Auth.can(user, 'safety.assess')) throw new AppError('FORBIDDEN', 'Only applier', { rule: 'lotoApplierOnly' });
        if (!remarks) throw validationError_([{ field: 'RemoveRemarks', rule: 'required' }]); // pelepasan oleh orang lain wajib beralasan
      }
      Db.update('LOTO_RECORDS', l.LOTOID, { Status: 'Removed', RemovedBy: user.name, RemovedAt: Db.now(), RemoveRemarks: remarks }, user.email);
      Audit.log(user, 'LOTO_REMOVE', 'LOTO_RECORDS', l.LOTOID, { wo: l.WorkOrderID, byOther: !mine, remarks: remarks }, 'OK');
      return { LOTOID: l.LOTOID };
    });
  }
};

const Safety = {
  OPEN: ['Open', 'In Action'],
  ctx_: function (user) {
    const eq = {};
    Db.all('EQUIPMENT', { includeDeleted: true }).forEach(function (e) { eq[e.EquipmentID] = e; });
    return { eq: eq, lk: Equipment.lookups_(), me: user ? Auth.norm(user.email) : '' };
  },
  rec_: function (id) {
    const s = Db.get('ELECTRICAL_SAFETY', String(id || ''));
    if (!s) throw new AppError('NOT_FOUND', 'Finding not found');
    return s;
  },
  pub_: function (s, ctx) {
    const e = ctx.eq[s.EquipmentID];
    return {
      SafetyID: s.SafetyID, EquipmentID: s.EquipmentID, EquipmentName: e ? e.EquipmentName : '', LocationID: s.LocationID,
      LocationName: s.LocationID ? (ctx.lk.loc[s.LocationID] || '') : (e ? (ctx.lk.loc[e.LocationID] || '') : ''),
      SafetyType: s.SafetyType, ReportType: s.ReportType, Description: s.Description, RiskLevel: s.RiskLevel, ReportedBy: s.ReportedBy, ReportDate: s.ReportDate,
      Status: s.Status, WorkOrderID: Work.liveWO_(s.WorkOrderID), isMine: !!ctx.me && Auth.norm(s.ReportedByEmail) === ctx.me, UpdatedAt: s.UpdatedAt
    };
  },

  report: function (p, user) {
    p = p || {};
    const errors = [];
    let eq = null;
    const eqId = String(p.EquipmentID || ''), locId = String(p.LocationID || '');
    if (eqId) { eq = Db.get('EQUIPMENT', eqId); if (!eq) errors.push({ field: 'EquipmentID', rule: 'notFound' }); }
    else if (locId) { if (!Db.get('LOCATIONS', locId)) errors.push({ field: 'LocationID', rule: 'notFound' }); }
    else errors.push({ field: 'EquipmentID', rule: 'required' });
    if (CFG.SAFETY_TYPES.indexOf(String(p.SafetyType || '')) === -1) errors.push({ field: 'SafetyType', rule: 'required' });
    if (CFG.HAZARD_CATEGORIES.indexOf(String(p.ReportType || '')) === -1) errors.push({ field: 'ReportType', rule: 'required' });
    const desc = String(p.Description || '').trim(), act = String(p.ActionRequired || '').trim();
    if (!desc) errors.push({ field: 'Description', rule: 'required' }); else if (desc.length > 1500) errors.push({ field: 'Description', rule: 'tooLong' });
    if (act.length > 500) errors.push({ field: 'ActionRequired', rule: 'tooLong' });
    const level = String(p.RiskLevel || 'Medium');
    if (CFG.RISK_LEVELS.indexOf(level) === -1) errors.push({ field: 'RiskLevel', rule: 'invalid' });
    if (errors.length) throw validationError_(errors);
    const out = Db.withLock(function () {
      const rec = Db.insert('ELECTRICAL_SAFETY', {
        EquipmentID: eq ? eq.EquipmentID : '', LocationID: eq ? '' : locId, SafetyType: p.SafetyType, ReportType: p.ReportType, Description: desc, RiskLevel: level,
        ReportedBy: user.name, ReportedByEmail: Auth.norm(user.email), ReportDate: Db.today(), ActionRequired: act, Status: 'Open'
      }, user.email);
      Audit.log(user, 'SAFETY_REPORT', 'ELECTRICAL_SAFETY', rec.SafetyID, { type: p.SafetyType, category: p.ReportType, level: level, equipment: rec.EquipmentID }, 'OK');
      let status = eq ? eq.EquipmentStatus : '';
      if (eq && (level === 'High' || level === 'Critical')) status = EqStatus.raise(eq.EquipmentID, 'Warning', user, rec.SafetyID);
      return { rec: rec, status: status };
    });
    let notified = { sent: 0, failed: 0 };
    if (level === 'High' || level === 'Critical') notified = Notify.safety(out.rec, eq);
    return { SafetyID: out.rec.SafetyID, EquipmentStatus: out.status, notified: notified };
  },

  list: function (p, user) {
    p = p || {};
    const ctx = Safety.ctx_(user);
    const rows = Db.all('ELECTRICAL_SAFETY').filter(function (s) {
      const open = Safety.OPEN.indexOf(s.Status) !== -1;
      if (p.group === 'open' && !open) return false;
      if (p.group === 'done' && open) return false;
      if (p.risk && s.RiskLevel !== p.risk) return false;
      if (p.equipmentId && s.EquipmentID !== p.equipmentId) return false;
      if (p.mine && Auth.norm(s.ReportedByEmail) !== ctx.me) return false;
      return true;
    }).map(function (s) { return Safety.pub_(s, ctx); });
    const pr = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    rows.sort(function (a, b) { return (pr[a.RiskLevel] - pr[b.RiskLevel]) || (a.SafetyID < b.SafetyID ? 1 : -1); });
    return { rows: rows.slice(0, 500) };
  },

  get: function (p, user) {
    const s = Safety.rec_(p && p.id);
    const ctx = Safety.ctx_(user);
    const d = Safety.pub_(s, ctx);
    ['ActionRequired', 'ActionTaken', 'ClosedBy', 'ClosedAt'].forEach(function (k) { d[k] = s[k]; });
    d.photos = s.PhotoFileIDs ? s.PhotoFileIDs.split(',').filter(Boolean) : [];
    const open = Safety.OPEN.indexOf(s.Status) !== -1;
    const risks = Risk.list({ safetyId: s.SafetyID }).rows;
    const me = ctx.me;
    return {
      safety: d, risks: risks,
      can: {
        assess: Auth.can(user, 'safety.assess') && open,
        approve: Auth.can(user, 'safety.approve'),
        close: Auth.can(user, 'safety.assess') && open,
        dismiss: Auth.can(user, 'safety.assess') && s.Status === 'Open',
        photo: open && (Auth.norm(s.ReportedByEmail) === me || Auth.can(user, 'safety.assess')) && d.photos.length < CFG.SAFETY_MAX_PHOTOS,
        createWO: Auth.can(user, 'wo.create') && open && !d.WorkOrderID
      },
      maxPhotos: CFG.SAFETY_MAX_PHOTOS
    };
  },

  uploadPhoto: function (p, user) {
    const s0 = Safety.rec_(p && p.id);
    if (!(Auth.norm(s0.ReportedByEmail) === Auth.norm(user.email) || Auth.can(user, 'safety.assess'))) throw new AppError('FORBIDDEN', 'Forbidden', { rule: 'safety.photo' });
    if (Safety.OPEN.indexOf(s0.Status) === -1) throw new AppError('CONFLICT', 'Locked', { rule: 'locked' });
    const have = s0.PhotoFileIDs ? s0.PhotoFileIDs.split(',').filter(Boolean) : [];
    if (have.length >= CFG.SAFETY_MAX_PHOTOS) throw new AppError('CONFLICT', 'Too many photos', { rule: 'maxPhotos' });
    const saved = DriveSvc.saveImage('Safety_Photos', p.base64, s0.SafetyID + '_' + (have.length + 1));
    return Db.withLock(function () {
      const s = Safety.rec_(s0.SafetyID);
      const ids = s.PhotoFileIDs ? s.PhotoFileIDs.split(',').filter(Boolean) : [];
      if (ids.length >= CFG.SAFETY_MAX_PHOTOS) { DriveSvc.trash(saved.fileId); throw new AppError('CONFLICT', 'Too many photos', { rule: 'maxPhotos' }); }
      ids.push(saved.fileId);
      Db.insert('ATTACHMENTS', { RefType: 'SAFETY', RefID: s.SafetyID, DriveFileID: saved.fileId, FileName: saved.name, MimeType: saved.mime, FileSize: saved.size, Caption: '' }, user.email);
      Db.update('ELECTRICAL_SAFETY', s.SafetyID, { PhotoFileIDs: ids.join(',') }, user.email);
      Audit.log(user, 'SAFETY_PHOTO', 'ELECTRICAL_SAFETY', s.SafetyID, { size: saved.size }, 'OK');
      return { count: ids.length };
    });
  },

  photo: function (p) {
    const s = Safety.rec_(p && p.id);
    const ids = s.PhotoFileIDs ? s.PhotoFileIDs.split(',').filter(Boolean) : [];
    const i = Number(p && p.index);
    return { dataUrl: ids[i] ? DriveSvc.readDataUrl(ids[i]) : '' };
  },

  close: function (p, user) {
    const taken = String(p && p.ActionTaken || '').trim();
    if (!taken) throw validationError_([{ field: 'ActionTaken', rule: 'required' }]);
    if (taken.length > 1000) throw validationError_([{ field: 'ActionTaken', rule: 'tooLong' }]);
    return Db.withLock(function () {
      const s = Safety.rec_(p.id);
      if (Safety.OPEN.indexOf(s.Status) === -1) throw new AppError('CONFLICT', 'Bad state', { rule: 'badState' });
      const wo = s.WorkOrderID ? Db.get('WORK_ORDERS', s.WorkOrderID) : null;
      if (wo && ['Requested', 'Approved', 'In Progress', 'Completed'].indexOf(wo.Status) !== -1) throw new AppError('CONFLICT', 'WO open', { rule: 'woOpen', workOrderId: wo.WorkOrderID });
      const last = Risk.latest_('SafetyID', s.SafetyID);
      if ((s.RiskLevel === 'High' || s.RiskLevel === 'Critical') && !last) throw new AppError('CONFLICT', 'Needs risk assessment', { rule: 'needsAssessment' });
      if (last && last.RequiresApproval === true && !last.ApprovedBy) throw new AppError('CONFLICT', 'Risk not approved', { rule: 'riskNotApproved' });
      Db.update('ELECTRICAL_SAFETY', s.SafetyID, { Status: 'Closed', ActionTaken: taken, ClosedBy: user.name, ClosedAt: Db.now() }, user.email);
      Audit.log(user, 'SAFETY_CLOSE', 'ELECTRICAL_SAFETY', s.SafetyID, { level: s.RiskLevel }, 'OK');
      return { SafetyID: s.SafetyID, Status: 'Closed' };
    });
  },

  dismiss: function (p, user) {
    const why = String(p && p.remarks || '').trim();
    if (!why) throw validationError_([{ field: 'ActionTaken', rule: 'required' }]);
    return Db.withLock(function () {
      const s = Safety.rec_(p.id);
      if (s.Status !== 'Open') throw new AppError('CONFLICT', 'Bad state', { rule: 'badState' });
      Db.update('ELECTRICAL_SAFETY', s.SafetyID, { Status: 'Dismissed', ActionTaken: why, ClosedBy: user.name, ClosedAt: Db.now() }, user.email);
      Audit.log(user, 'SAFETY_DISMISS', 'ELECTRICAL_SAFETY', s.SafetyID, { remarks: why }, 'OK');
      return { SafetyID: s.SafetyID, Status: 'Dismissed' };
    });
  },

  /** Gerbang Mulai WO: penilaian risiko terakhir (milik WO, jika tidak ada milik temuan sumber) harus sudah disetujui bila wajib. */
  startGate_: function (w) {
    let last = Risk.latest_('WorkOrderID', w.WorkOrderID);
    if (!last && w.SourceType === 'Safety') {
      last = Risk.latest_('SafetyID', w.SourceID);
      const f = Db.get('ELECTRICAL_SAFETY', w.SourceID);
      if (!last && f && (f.RiskLevel === 'High' || f.RiskLevel === 'Critical')) throw new AppError('CONFLICT', 'Needs risk assessment', { rule: 'needsAssessment' });
    }
    if (last && last.RequiresApproval === true && !last.ApprovedBy) throw new AppError('CONFLICT', 'Risk not approved', { rule: 'riskNotApproved' });
  },

  /** Ringkasan keselamatan untuk satu WO: penilaian risiko terakhir + LOTO. */
  forWorkOrder: function (p, user) {
    const id = String(p && p.workOrderId || '');
    const wo = Db.get('WORK_ORDERS', id);
    if (!wo) throw new AppError('NOT_FOUND', 'Work order not found');
    const risks = Risk.list({ workOrderId: id }).rows;
    const lotos = Loto.list({ workOrderId: id }, user).rows;
    const open = ['Approved', 'In Progress'].indexOf(wo.Status) !== -1;
    const mineWork = Auth.can(user, 'safety.assess') || Auth.norm(wo.AssignedTo) === Auth.norm(user.email);
    return {
      risks: risks, lotos: lotos,
      can: {
        assess: Auth.can(user, 'safety.assess') && ['Completed', 'Closed', 'Rejected', 'Cancelled'].indexOf(wo.Status) === -1,
        approve: Auth.can(user, 'safety.approve'),
        applyLoto: Auth.can(user, 'safety.loto') && open && mineWork && !lotos.some(function (l) { return l.Status === 'Active'; }),
        removeAny: Auth.can(user, 'safety.assess')
      }
    };
  }
};
