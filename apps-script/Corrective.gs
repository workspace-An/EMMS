/**
 * EMMS - Corrective.gs  (Phase 4: Corrective Maintenance)
 * Laporan kerusakan -> penugasan -> pengerjaan -> selesai -> verifikasi/tutup.
 * Status: Open -> In Progress <-> Pending -> Completed -> Closed (Closed/Completed dapat dibuka lagi).
 * Aturan: pelaporan Critical menandai equipment Breakdown (High -> Warning) dan mengirim email;
 * penutup tidak boleh orang yang menyelesaikan (kecuali Admin); menutup dengan hasil "Repaired"
 * dapat mengembalikan status equipment ke Normal bila tidak ada CM lain yang masih berjalan.
 */
const EqStatus = {
  rank: { Normal: 0, Warning: 1, Breakdown: 2 },
  /** Naikkan status equipment (tidak pernah menurunkan). Mengembalikan status akhir. */
  raise: function (eqId, target, user, ref) {
    const e = Db.get('EQUIPMENT', eqId);
    if (!e || EqStatus.rank[target] === undefined) return e ? e.EquipmentStatus : '';
    if (EqStatus.rank[target] > EqStatus.rank[e.EquipmentStatus]) {
      Db.update('EQUIPMENT', eqId, { EquipmentStatus: target }, user.email);
      Audit.log(user, 'EQUIPMENT_STATUS_AUTO', 'EQUIPMENT', eqId, { from: e.EquipmentStatus, to: target, ref: ref }, 'OK');
      return target;
    }
    return e.EquipmentStatus;
  }
};

const Work = {
  techOk_: function (email) {
    return !!Db.where('USERS', function (x) { return Auth.norm(x.Email) === Auth.norm(email) && x.Status === 'Active' && x.Role !== 'Viewer'; })[0];
  },
  /** WorkOrderID yang masih berlaku (bukan Rejected/Cancelled), atau ''. */
  liveWO_: function (id) {
    if (!id) return '';
    const w = Db.get('WORK_ORDERS', id);
    return w && ['Rejected', 'Cancelled'].indexOf(w.Status) === -1 ? id : '';
  }
};

const CM = {
  ACTIVE: ['Open', 'In Progress', 'Pending'],
  ctx_: function (user) {
    const eq = {};
    Db.all('EQUIPMENT', { includeDeleted: true }).forEach(function (e) { eq[e.EquipmentID] = e; });
    return { eq: eq, lk: Equipment.lookups_(), me: user ? Auth.norm(user.email) : '' };
  },
  pub_: function (c, ctx) {
    const e = ctx.eq[c.EquipmentID];
    return {
      ComplaintNo: c.ComplaintNo, EquipmentID: c.EquipmentID, EquipmentName: e ? e.EquipmentName : '', LocationName: e ? (ctx.lk.loc[e.LocationID] || '') : '',
      ProblemDescription: c.ProblemDescription, DateReported: c.DateReported, ReportedBy: c.ReportedBy, Priority: c.Priority, Status: c.Status,
      AssignedTechnician: c.AssignedTechnician, TechnicianName: PM.userName_(c.AssignedTechnician), RepairResult: c.RepairResult, WorkOrderID: Work.liveWO_(c.WorkOrderID),
      isMine: !!ctx.me && (Auth.norm(c.AssignedTechnician) === ctx.me || Auth.norm(c.ReportedByEmail) === ctx.me), UpdatedAt: c.UpdatedAt
    };
  },
  rec_: function (id) {
    const c = Db.get('CORRECTIVE_MAINTENANCE', String(id || ''));
    if (!c) throw new AppError('NOT_FOUND', 'Complaint not found');
    return c;
  },
  canWork_: function (user, c) {
    if (Auth.can(user, 'cm.assign')) return true;
    if (!Auth.can(user, 'cm.work')) return false;
    return !c.AssignedTechnician || Auth.norm(c.AssignedTechnician) === Auth.norm(user.email);
  },

  report: function (p, user) {
    p = p || {};
    const errors = [];
    const eq = Db.get('EQUIPMENT', String(p.EquipmentID || ''));
    if (!eq) errors.push({ field: 'EquipmentID', rule: p.EquipmentID ? 'notFound' : 'required' });
    const desc = String(p.ProblemDescription || '').trim();
    if (!desc) errors.push({ field: 'ProblemDescription', rule: 'required' }); else if (desc.length > 1000) errors.push({ field: 'ProblemDescription', rule: 'tooLong' });
    const prio = String(p.Priority || 'Medium');
    if (CFG.PRIORITIES.indexOf(prio) === -1) errors.push({ field: 'Priority', rule: 'invalid' });
    if (errors.length) throw validationError_(errors);
    const out = Db.withLock(function () {
      const rec = Db.insert('CORRECTIVE_MAINTENANCE', {
        EquipmentID: eq.EquipmentID, ProblemDescription: desc, DateReported: Db.today(), ReportedBy: user.name, ReportedByEmail: Auth.norm(user.email),
        Priority: prio, Status: 'Open'
      }, user.email);
      Audit.log(user, 'CM_REPORT', 'CORRECTIVE_MAINTENANCE', rec.ComplaintNo, { equipment: eq.EquipmentID, priority: prio }, 'OK');
      let status = eq.EquipmentStatus;
      if (prio === 'Critical') status = EqStatus.raise(eq.EquipmentID, 'Breakdown', user, rec.ComplaintNo);
      else if (prio === 'High') status = EqStatus.raise(eq.EquipmentID, 'Warning', user, rec.ComplaintNo);
      return { rec: rec, status: status };
    });
    let notified = { sent: 0, failed: 0 };
    if (prio === 'Critical' || prio === 'High') notified = Notify.complaint(out.rec, eq);
    return { ComplaintNo: out.rec.ComplaintNo, EquipmentStatus: out.status, notified: notified };
  },

  list: function (p, user) {
    p = p || {};
    const ctx = CM.ctx_(user);
    const rows = Db.all('CORRECTIVE_MAINTENANCE').filter(function (c) {
      if (p.group === 'active' && CM.ACTIVE.indexOf(c.Status) === -1) return false;
      if (p.group === 'done' && CM.ACTIVE.indexOf(c.Status) !== -1) return false;
      if (p.status && c.Status !== p.status) return false;
      if (p.priority && c.Priority !== p.priority) return false;
      if (p.equipmentId && c.EquipmentID !== p.equipmentId) return false;
      if (p.mine && !(Auth.norm(c.AssignedTechnician) === ctx.me || Auth.norm(c.ReportedByEmail) === ctx.me)) return false;
      return true;
    }).map(function (c) { return CM.pub_(c, ctx); });
    const pr = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    rows.sort(function (a, b) { return (pr[a.Priority] - pr[b.Priority]) || (a.DateReported < b.DateReported ? 1 : (a.DateReported > b.DateReported ? -1 : 0)); });
    return { rows: rows.slice(0, 500) };
  },

  get: function (p, user) {
    const c = CM.rec_(p && p.id);
    const ctx = CM.ctx_(user);
    const d = CM.pub_(c, ctx);
    ['RootCause', 'CorrectiveAction', 'SparePartUsed', 'StartTime', 'FinishTime', 'CompletedBy', 'ClosedBy', 'ClosedAt', 'CloseRemarks'].forEach(function (k) { d[k] = c[k]; });
    d.photos = c.PhotoEvidenceIDs ? c.PhotoEvidenceIDs.split(',').filter(Boolean) : [];
    const open = c.Status !== 'Closed';
    const mine = Auth.norm(c.ReportedByEmail) === ctx.me;
    return {
      cm: d,
      can: {
        assign: Auth.can(user, 'cm.assign') && open && c.Status !== 'Completed',
        start: CM.canWork_(user, c) && (c.Status === 'Open' || c.Status === 'Pending'),
        edit: CM.canWork_(user, c) && (c.Status === 'In Progress' || c.Status === 'Pending'),
        complete: CM.canWork_(user, c) && (c.Status === 'In Progress' || c.Status === 'Pending'),
        close: Auth.can(user, 'cm.close') && c.Status === 'Completed' && (Auth.norm(c.CompletedBy) !== ctx.me || user.role === 'Admin'),
        closeBlockedSelf: Auth.can(user, 'cm.close') && c.Status === 'Completed' && Auth.norm(c.CompletedBy) === ctx.me && user.role !== 'Admin',
        reopen: Auth.can(user, 'cm.close') && (c.Status === 'Completed' || c.Status === 'Closed'),
        photo: open && (mine || CM.canWork_(user, c)) && d.photos.length < CFG.CM_MAX_PHOTOS,
        createWO: Auth.can(user, 'wo.create') && !Work.liveWO_(c.WorkOrderID) && open
      },
      maxPhotos: CFG.CM_MAX_PHOTOS
    };
  },

  assign: function (p, user) {
    const tech = Auth.norm(p && p.technician || '');
    if (!tech) throw validationError_([{ field: 'AssignedTechnician', rule: 'required' }]);
    if (!Work.techOk_(tech)) throw validationError_([{ field: 'AssignedTechnician', rule: 'notFound' }]);
    const c = Db.withLock(function () {
      const cur = CM.rec_(p.id);
      if (cur.Status === 'Closed' || cur.Status === 'Completed') throw new AppError('CONFLICT', 'Not assignable', { rule: 'notAssignable' });
      Db.update('CORRECTIVE_MAINTENANCE', cur.ComplaintNo, { AssignedTechnician: tech }, user.email);
      Audit.log(user, 'CM_ASSIGN', 'CORRECTIVE_MAINTENANCE', cur.ComplaintNo, { to: tech }, 'OK');
      return Db.get('CORRECTIVE_MAINTENANCE', cur.ComplaintNo);
    });
    Notify.assigned('CM_ASSIGNED', tech, c.ComplaintNo + ' - ' + c.EquipmentID, c.ProblemDescription, 'CORRECTIVE_MAINTENANCE', c.ComplaintNo);
    return { ComplaintNo: c.ComplaintNo };
  },

  start: function (p, user) {
    return Db.withLock(function () {
      const c = CM.rec_(p && p.id);
      if (!CM.canWork_(user, c)) throw new AppError('FORBIDDEN', 'Not assignee', { rule: 'notAssignee' });
      if (c.Status !== 'Open' && c.Status !== 'Pending') throw new AppError('CONFLICT', 'Bad state', { rule: 'badState' });
      const upd = { Status: 'In Progress' };
      if (!c.StartTime) upd.StartTime = Db.now();
      if (!c.AssignedTechnician) upd.AssignedTechnician = Auth.norm(user.email);
      Db.update('CORRECTIVE_MAINTENANCE', c.ComplaintNo, upd, user.email);
      Audit.log(user, 'CM_START', 'CORRECTIVE_MAINTENANCE', c.ComplaintNo, { from: c.Status }, 'OK');
      return { ComplaintNo: c.ComplaintNo, Status: 'In Progress' };
    });
  },

  /** Simpan progres (akar masalah, tindakan, suku cadang) dan/atau jeda (Pending) / lanjut (In Progress). */
  update: function (p, user) {
    p = p || {};
    const errors = [];
    const f = { RootCause: 1000, CorrectiveAction: 1000, SparePartUsed: 500 };
    const upd = {};
    Object.keys(f).forEach(function (k) {
      if (p[k] === undefined) return;
      const v = String(p[k] || '').trim();
      if (v.length > f[k]) errors.push({ field: k, rule: 'tooLong' }); else upd[k] = v;
    });
    if (p.Status !== undefined && ['In Progress', 'Pending'].indexOf(p.Status) === -1) errors.push({ field: 'Status', rule: 'invalid' });
    if (errors.length) throw validationError_(errors);
    return Db.withLock(function () {
      const c = CM.rec_(p.id);
      if (!CM.canWork_(user, c)) throw new AppError('FORBIDDEN', 'Not assignee', { rule: 'notAssignee' });
      if (c.Status !== 'In Progress' && c.Status !== 'Pending') throw new AppError('CONFLICT', 'Bad state', { rule: 'badState' });
      if (p.Status === 'Pending' && !String(p.CorrectiveAction !== undefined ? p.CorrectiveAction : c.CorrectiveAction).trim()) throw validationError_([{ field: 'CorrectiveAction', rule: 'required' }]);
      if (p.Status) upd.Status = p.Status;
      Db.update('CORRECTIVE_MAINTENANCE', c.ComplaintNo, upd, user.email, { expectedUpdatedAt: p.UpdatedAt });
      Audit.log(user, 'CM_UPDATE', 'CORRECTIVE_MAINTENANCE', c.ComplaintNo, { status: p.Status || c.Status }, 'OK');
      return { ComplaintNo: c.ComplaintNo };
    });
  },

  complete: function (p, user) {
    p = p || {};
    const errors = [];
    const rc = String(p.RootCause || '').trim(), ca = String(p.CorrectiveAction || '').trim(), sp = String(p.SparePartUsed || '').trim();
    if (!rc) errors.push({ field: 'RootCause', rule: 'required' }); else if (rc.length > 1000) errors.push({ field: 'RootCause', rule: 'tooLong' });
    if (!ca) errors.push({ field: 'CorrectiveAction', rule: 'required' }); else if (ca.length > 1000) errors.push({ field: 'CorrectiveAction', rule: 'tooLong' });
    if (sp.length > 500) errors.push({ field: 'SparePartUsed', rule: 'tooLong' });
    if (CFG.REPAIR_RESULTS.indexOf(String(p.RepairResult || '')) === -1) errors.push({ field: 'RepairResult', rule: 'required' });
    if (errors.length) throw validationError_(errors);
    return Db.withLock(function () {
      const c = CM.rec_(p.id);
      if (!CM.canWork_(user, c)) throw new AppError('FORBIDDEN', 'Not assignee', { rule: 'notAssignee' });
      if (c.Status !== 'In Progress' && c.Status !== 'Pending') throw new AppError('CONFLICT', 'Bad state', { rule: 'badState' });
      Db.update('CORRECTIVE_MAINTENANCE', c.ComplaintNo, {
        RootCause: rc, CorrectiveAction: ca, SparePartUsed: sp, RepairResult: p.RepairResult, Status: 'Completed', FinishTime: Db.now(),
        CompletedBy: Auth.norm(user.email), StartTime: c.StartTime || Db.now(), AssignedTechnician: c.AssignedTechnician || Auth.norm(user.email)
      }, user.email, { expectedUpdatedAt: p.UpdatedAt });
      Audit.log(user, 'CM_COMPLETE', 'CORRECTIVE_MAINTENANCE', c.ComplaintNo, { result: p.RepairResult }, 'OK');
      return { ComplaintNo: c.ComplaintNo, Status: 'Completed' };
    });
  },

  close: function (p, user) {
    p = p || {};
    const remarks = String(p.remarks || '').trim();
    if (remarks.length > 500) throw validationError_([{ field: 'CloseRemarks', rule: 'tooLong' }]);
    return Db.withLock(function () {
      const c = CM.rec_(p.id);
      if (c.Status !== 'Completed') throw new AppError('CONFLICT', 'Bad state', { rule: 'badState' });
      if (Auth.norm(c.CompletedBy) === Auth.norm(user.email) && user.role !== 'Admin') throw new AppError('FORBIDDEN', 'Self verify', { rule: 'selfApprove' });
      Db.update('CORRECTIVE_MAINTENANCE', c.ComplaintNo, { Status: 'Closed', ClosedBy: user.name, ClosedAt: Db.now(), CloseRemarks: remarks }, user.email);
      let eqStatus = '';
      const e = Db.get('EQUIPMENT', c.EquipmentID);
      if (e && c.RepairResult === 'Repaired' && p.setNormal !== false && e.EquipmentStatus !== 'Normal') {
        const others = Db.where('CORRECTIVE_MAINTENANCE', function (x) { return x.EquipmentID === c.EquipmentID && x.ComplaintNo !== c.ComplaintNo && ['Open', 'In Progress', 'Pending', 'Completed'].indexOf(x.Status) !== -1; });
        if (!others.length) {
          Db.update('EQUIPMENT', e.EquipmentID, { EquipmentStatus: 'Normal' }, user.email);
          Audit.log(user, 'EQUIPMENT_STATUS_AUTO', 'EQUIPMENT', e.EquipmentID, { from: e.EquipmentStatus, to: 'Normal', ref: c.ComplaintNo }, 'OK');
          eqStatus = 'Normal';
        }
      }
      Audit.log(user, 'CM_CLOSE', 'CORRECTIVE_MAINTENANCE', c.ComplaintNo, { result: c.RepairResult, selfClosed: Auth.norm(c.CompletedBy) === Auth.norm(user.email) }, 'OK');
      Approvals.record('CM', c.ComplaintNo, 2, 'Verified', user, '');
      return { ComplaintNo: c.ComplaintNo, Status: 'Closed', EquipmentStatus: eqStatus };
    });
  },

  reopen: function (p, user) {
    const remarks = String(p && p.remarks || '').trim();
    if (!remarks) throw validationError_([{ field: 'CloseRemarks', rule: 'required' }]);
    if (remarks.length > 500) throw validationError_([{ field: 'CloseRemarks', rule: 'tooLong' }]);
    return Db.withLock(function () {
      const c = CM.rec_(p.id);
      if (c.Status !== 'Completed' && c.Status !== 'Closed') throw new AppError('CONFLICT', 'Bad state', { rule: 'badState' });
      Db.update('CORRECTIVE_MAINTENANCE', c.ComplaintNo, { Status: 'In Progress', FinishTime: '', ClosedBy: '', ClosedAt: '', CloseRemarks: '', CompletedBy: '' }, user.email);
      Audit.log(user, 'CM_REOPEN', 'CORRECTIVE_MAINTENANCE', c.ComplaintNo, { from: c.Status, remarks: remarks }, 'OK');
      return { ComplaintNo: c.ComplaintNo, Status: 'In Progress' };
    });
  },

  uploadPhoto: function (p, user) {
    const c0 = CM.rec_(p && p.id);
    const mine = Auth.norm(c0.ReportedByEmail) === Auth.norm(user.email);
    if (!(mine || CM.canWork_(user, c0))) throw new AppError('FORBIDDEN', 'Forbidden', { rule: 'cm.photo' });
    if (c0.Status === 'Closed') throw new AppError('CONFLICT', 'Locked', { rule: 'locked' });
    const have = c0.PhotoEvidenceIDs ? c0.PhotoEvidenceIDs.split(',').filter(Boolean) : [];
    if (have.length >= CFG.CM_MAX_PHOTOS) throw new AppError('CONFLICT', 'Too many photos', { rule: 'maxPhotos' });
    const saved = DriveSvc.saveImage('CM_Photos', p.base64, c0.ComplaintNo + '_' + (have.length + 1));
    return Db.withLock(function () {
      const c = CM.rec_(c0.ComplaintNo);
      const ids = c.PhotoEvidenceIDs ? c.PhotoEvidenceIDs.split(',').filter(Boolean) : [];
      if (ids.length >= CFG.CM_MAX_PHOTOS) { DriveSvc.trash(saved.fileId); throw new AppError('CONFLICT', 'Too many photos', { rule: 'maxPhotos' }); }
      ids.push(saved.fileId);
      Db.insert('ATTACHMENTS', { RefType: 'CM', RefID: c.ComplaintNo, DriveFileID: saved.fileId, FileName: saved.name, MimeType: saved.mime, FileSize: saved.size, Caption: '' }, user.email);
      Db.update('CORRECTIVE_MAINTENANCE', c.ComplaintNo, { PhotoEvidenceIDs: ids.join(',') }, user.email);
      Audit.log(user, 'CM_PHOTO', 'CORRECTIVE_MAINTENANCE', c.ComplaintNo, { size: saved.size }, 'OK');
      return { count: ids.length };
    });
  },

  photo: function (p) {
    const c = CM.rec_(p && p.id);
    const idx = Number(p && p.index);
    const ids = c.PhotoEvidenceIDs ? c.PhotoEvidenceIDs.split(',').filter(Boolean) : [];
    return { dataUrl: ids[idx] ? DriveSvc.readDataUrl(ids[idx]) : '' };
  }
};
