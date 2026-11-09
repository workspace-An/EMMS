/**
 * EMMS - WorkOrder.gs  (Phase 4: Work Order)
 * Sumber: Inspection (temuan NG), PM (temuan/sebagian), Corrective, Safety (Phase 5), Manual.
 * Status: Requested -> Approved -> In Progress -> Completed -> Closed; atau Rejected / Cancelled.
 * Aturan: pemohon tidak boleh menyetujui WO-nya sendiri dan penutup tidak boleh orang yang menyelesaikan
 * (kecuali Admin, tercatat di audit); satu sumber hanya boleh punya satu WO aktif; Completed butuh
 * semua tugas selesai + catatan hasil; pekerjaan hanya oleh teknisi yang ditugaskan (atau Supervisor ke atas).
 */
const WO = {
  OPEN: ['Requested', 'Approved', 'In Progress', 'Completed'],
  ctx_: function (user) {
    const eq = {};
    Db.all('EQUIPMENT', { includeDeleted: true }).forEach(function (e) { eq[e.EquipmentID] = e; });
    return { eq: eq, me: user ? Auth.norm(user.email) : '' };
  },
  pub_: function (w, ctx) {
    const e = ctx.eq[w.EquipmentID];
    return {
      WorkOrderID: w.WorkOrderID, SourceType: w.SourceType, SourceID: w.SourceID, EquipmentID: w.EquipmentID, EquipmentName: e ? e.EquipmentName : '',
      Title: w.Title, Priority: w.Priority, RequestedBy: w.RequestedBy, AssignedTo: w.AssignedTo, AssigneeName: PM.userName_(w.AssignedTo),
      PlannedDate: w.PlannedDate, DueDate: w.DueDate, Status: w.Status, ApprovalStatus: w.ApprovalStatus,
      overdue: !!w.DueDate && w.DueDate < Db.today() && WO.OPEN.indexOf(w.Status) !== -1 && w.Status !== 'Completed',
      isMine: !!ctx.me && (Auth.norm(w.AssignedTo) === ctx.me || Auth.norm(w.RequestedByEmail) === ctx.me), UpdatedAt: w.UpdatedAt
    };
  },
  rec_: function (id) {
    const w = Db.get('WORK_ORDERS', String(id || ''));
    if (!w) throw new AppError('NOT_FOUND', 'Work order not found');
    return w;
  },
  tasks_: function (id) {
    return Db.where('WORK_ORDER_TASKS', function (t) { return t.WorkOrderID === id; }).sort(function (a, b) { return a.TaskNo - b.TaskNo; });
  },
  canWork_: function (user, w) {
    return Auth.can(user, 'wo.approve') || (Auth.can(user, 'wo.work') && Auth.norm(w.AssignedTo) === Auth.norm(user.email));
  },

  /** Saran isi WO dari sumber (Inspection/PM/Corrective). Tidak menulis apa pun. */
  prefill: function (p) {
    const type = String(p && p.sourceType || ''), id = String(p && p.sourceId || '');
    if (type === 'Manual') return { SourceType: 'Manual', SourceID: '', EquipmentID: String(p.equipmentId || ''), Title: '', Description: '', Priority: 'Medium', tasks: [] };
    let out = null;
    if (type === 'Inspection') {
      const i = Db.get('DAILY_INSPECTIONS', id);
      if (!i) throw new AppError('NOT_FOUND', 'Source not found');
      const ng = Db.where('INSPECTION_RESULTS', function (r) { return r.InspectionID === id && r.Result === 'NG'; });
      out = {
        EquipmentID: i.EquipmentID, Title: 'Tindak lanjut inspeksi ' + i.InspectionDate, Priority: i.OverallResult === 'Critical' ? 'Critical' : 'High',
        Description: (i.Recommendation || '') + (i.Finding ? '\n' + i.Finding : ''),
        tasks: ng.map(function (r) { return r.ItemName + (r.Remarks ? ' - ' + r.Remarks : ''); }), WorkOrderID: i.WorkOrderID
      };
    } else if (type === 'PM') {
      const r = Db.get('PREVENTIVE_MAINTENANCE', id);
      if (!r) throw new AppError('NOT_FOUND', 'Source not found');
      out = { EquipmentID: r.EquipmentID, Title: 'Tindak lanjut PM: ' + r.PMTitle, Priority: 'Medium', Description: r.Remarks || '', tasks: [], WorkOrderID: r.WorkOrderID };
    } else if (type === 'Corrective') {
      const c = Db.get('CORRECTIVE_MAINTENANCE', id);
      if (!c) throw new AppError('NOT_FOUND', 'Source not found');
      out = { EquipmentID: c.EquipmentID, Title: 'Perbaikan ' + c.ComplaintNo, Priority: c.Priority, Description: c.ProblemDescription, tasks: [], WorkOrderID: c.WorkOrderID };
    } else throw validationError_([{ field: 'SourceType', rule: 'invalid' }]);
    out.SourceType = type; out.SourceID = id;
    return out;
  },

  create: function (p, user) {
    p = p || {};
    const errors = [];
    const type = String(p.SourceType || 'Manual');
    if (CFG.WO_SOURCES.indexOf(type) === -1 || type === 'Safety') errors.push({ field: 'SourceType', rule: 'invalid' });
    const srcId = type === 'Manual' ? '' : String(p.SourceID || '');
    if (type !== 'Manual' && !srcId) errors.push({ field: 'SourceID', rule: 'required' });
    const eq = Db.get('EQUIPMENT', String(p.EquipmentID || ''));
    if (!eq) errors.push({ field: 'EquipmentID', rule: p.EquipmentID ? 'notFound' : 'required' });
    const title = String(p.Title || '').trim(), desc = String(p.Description || '').trim();
    if (!title) errors.push({ field: 'Title', rule: 'required' }); else if (title.length > 150) errors.push({ field: 'Title', rule: 'tooLong' });
    if (desc.length > 1500) errors.push({ field: 'Description', rule: 'tooLong' });
    const prio = String(p.Priority || 'Medium');
    if (CFG.PRIORITIES.indexOf(prio) === -1) errors.push({ field: 'Priority', rule: 'invalid' });
    const planned = String(p.PlannedDate || ''), due = String(p.DueDate || '');
    if (planned && !Equipment.isDate_(planned)) errors.push({ field: 'PlannedDate', rule: 'invalid' });
    if (due && !Equipment.isDate_(due)) errors.push({ field: 'DueDate', rule: 'invalid' });
    if (planned && due && Equipment.isDate_(planned) && Equipment.isDate_(due) && due < planned) errors.push({ field: 'DueDate', rule: 'dateOrder' });
    const tasks = (Array.isArray(p.tasks) ? p.tasks : []).map(function (x) { return String(x || '').trim(); }).filter(Boolean);
    if (tasks.length > CFG.WO_MAX_TASKS) errors.push({ field: 'tasks', rule: 'tooMany' });
    else if (tasks.some(function (x) { return x.length > 300; })) errors.push({ field: 'tasks', rule: 'tooLong' });
    if (errors.length) throw validationError_(errors);

    const rec = Db.withLock(function () {
      if (type !== 'Manual') {
        const src = { Inspection: 'DAILY_INSPECTIONS', PM: 'PREVENTIVE_MAINTENANCE', Corrective: 'CORRECTIVE_MAINTENANCE' }[type];
        const s = Db.get(src, srcId);
        if (!s) throw new AppError('NOT_FOUND', 'Source not found');
        if (s.EquipmentID !== eq.EquipmentID) throw validationError_([{ field: 'EquipmentID', rule: 'invalid' }]);
        const dup = Db.where('WORK_ORDERS', function (w) { return w.SourceType === type && w.SourceID === srcId && ['Rejected', 'Cancelled'].indexOf(w.Status) === -1; });
        if (dup.length) throw new AppError('CONFLICT', 'WO exists', { rule: 'alreadyExists', workOrderId: dup[0].WorkOrderID });
      }
      const w = Db.insert('WORK_ORDERS', {
        SourceType: type, SourceID: srcId, EquipmentID: eq.EquipmentID, Title: title, Description: desc, Priority: prio, RequestedBy: user.name,
        RequestedByEmail: Auth.norm(user.email), PlannedDate: planned, DueDate: due, ApprovalStatus: 'Pending', Status: 'Requested'
      }, user.email);
      Db.insertMany('WORK_ORDER_TASKS', tasks.map(function (d, i) { return { WorkOrderID: w.WorkOrderID, TaskNo: i + 1, TaskDescription: d, IsDone: false }; }), user.email);
      if (type === 'Inspection') Db.update('DAILY_INSPECTIONS', srcId, { WorkOrderID: w.WorkOrderID }, user.email);
      if (type === 'PM') Db.update('PREVENTIVE_MAINTENANCE', srcId, { WorkOrderID: w.WorkOrderID }, user.email);
      if (type === 'Corrective') Db.update('CORRECTIVE_MAINTENANCE', srcId, { WorkOrderID: w.WorkOrderID }, user.email);
      Audit.log(user, 'WO_CREATE', 'WORK_ORDERS', w.WorkOrderID, { source: type + ':' + srcId, equipment: eq.EquipmentID, priority: prio, tasks: tasks.length }, 'OK');
      return w;
    });
    return { WorkOrderID: rec.WorkOrderID, Status: rec.Status };
  },

  list: function (p, user) {
    p = p || {};
    const ctx = WO.ctx_(user);
    const rows = Db.all('WORK_ORDERS').filter(function (w) {
      const open = WO.OPEN.indexOf(w.Status) !== -1;
      if (p.group === 'open' && !open) return false;
      if (p.group === 'done' && open) return false;
      if (p.status && w.Status !== p.status) return false;
      if (p.priority && w.Priority !== p.priority) return false;
      if (p.equipmentId && w.EquipmentID !== p.equipmentId) return false;
      if (p.mine && !(Auth.norm(w.AssignedTo) === ctx.me || Auth.norm(w.RequestedByEmail) === ctx.me)) return false;
      return true;
    }).map(function (w) { return WO.pub_(w, ctx); });
    const pr = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    rows.sort(function (a, b) { return (pr[a.Priority] - pr[b.Priority]) || (a.WorkOrderID < b.WorkOrderID ? 1 : -1); });
    return { rows: rows.slice(0, 500) };
  },

  get: function (p, user) {
    const w = WO.rec_(p && p.id);
    const ctx = WO.ctx_(user);
    const d = WO.pub_(w, ctx);
    ['Description', 'ApprovalRemarks', 'ApprovedBy', 'ApprovedAt', 'StartedAt', 'CompletedBy', 'CompletedAt', 'ResultNotes', 'VerifiedBy', 'ClosedAt'].forEach(function (k) { d[k] = w[k]; });
    const tasks = WO.tasks_(w.WorkOrderID).map(function (t) { return { TaskID: t.TaskID, TaskNo: t.TaskNo, TaskDescription: t.TaskDescription, IsDone: t.IsDone === true, DoneBy: t.DoneBy, DoneAt: t.DoneAt, Remarks: t.Remarks }; });
    const mgr = Auth.can(user, 'wo.approve'), me = ctx.me, st = w.Status;
    const mineReq = Auth.norm(w.RequestedByEmail) === me;
    return {
      wo: d, tasks: tasks,
      can: {
        decide: mgr && st === 'Requested' && (!mineReq || user.role === 'Admin'),
        decideBlockedSelf: mgr && st === 'Requested' && mineReq && user.role !== 'Admin',
        edit: (mgr || (mineReq && Auth.can(user, 'wo.create'))) && (st === 'Requested' || st === 'Approved'),
        assign: mgr && (st === 'Approved' || st === 'In Progress'),
        start: WO.canWork_(user, w) && st === 'Approved' && !!w.AssignedTo,
        toggle: WO.canWork_(user, w) && st === 'In Progress',
        complete: WO.canWork_(user, w) && st === 'In Progress',
        close: mgr && st === 'Completed' && (Auth.norm(w.CompletedBy) !== me || user.role === 'Admin'),
        closeBlockedSelf: mgr && st === 'Completed' && Auth.norm(w.CompletedBy) === me && user.role !== 'Admin',
        cancel: (mgr || mineReq) && (st === 'Requested' || st === 'Approved')
      }
    };
  },

  /** Ubah isi WO selama Requested/Approved; mengganti seluruh daftar tugas bila `tasks` diberikan. */
  update: function (p, user) {
    p = p || {};
    const errors = [];
    const upd = {};
    if (p.Title !== undefined) { const v = String(p.Title || '').trim(); if (!v) errors.push({ field: 'Title', rule: 'required' }); else if (v.length > 150) errors.push({ field: 'Title', rule: 'tooLong' }); else upd.Title = v; }
    if (p.Description !== undefined) { const v = String(p.Description || '').trim(); if (v.length > 1500) errors.push({ field: 'Description', rule: 'tooLong' }); else upd.Description = v; }
    if (p.Priority !== undefined) { if (CFG.PRIORITIES.indexOf(p.Priority) === -1) errors.push({ field: 'Priority', rule: 'invalid' }); else upd.Priority = p.Priority; }
    ['PlannedDate', 'DueDate'].forEach(function (k) { if (p[k] !== undefined) { const v = String(p[k] || ''); if (v && !Equipment.isDate_(v)) errors.push({ field: k, rule: 'invalid' }); else upd[k] = v; } });
    let tasks = null;
    if (p.tasks !== undefined) {
      tasks = (Array.isArray(p.tasks) ? p.tasks : []).map(function (x) { return String(x || '').trim(); }).filter(Boolean);
      if (tasks.length > CFG.WO_MAX_TASKS) errors.push({ field: 'tasks', rule: 'tooMany' });
      else if (tasks.some(function (x) { return x.length > 300; })) errors.push({ field: 'tasks', rule: 'tooLong' });
    }
    if (errors.length) throw validationError_(errors);
    return Db.withLock(function () {
      const w = WO.rec_(p.id);
      const mineReq = Auth.norm(w.RequestedByEmail) === Auth.norm(user.email);
      if (!(Auth.can(user, 'wo.approve') || (mineReq && Auth.can(user, 'wo.create')))) throw new AppError('FORBIDDEN', 'Forbidden', { rule: 'wo.edit' });
      if (w.Status !== 'Requested' && w.Status !== 'Approved') throw new AppError('CONFLICT', 'Bad state', { rule: 'badState' });
      const planned = upd.PlannedDate !== undefined ? upd.PlannedDate : w.PlannedDate, due = upd.DueDate !== undefined ? upd.DueDate : w.DueDate;
      if (planned && due && due < planned) throw validationError_([{ field: 'DueDate', rule: 'dateOrder' }]);
      Db.update('WORK_ORDERS', w.WorkOrderID, upd, user.email, { expectedUpdatedAt: p.UpdatedAt });
      if (tasks) {
        WO.tasks_(w.WorkOrderID).forEach(function (t) { Db.hardDelete('WORK_ORDER_TASKS', t.TaskID); });
        Db.insertMany('WORK_ORDER_TASKS', tasks.map(function (d, i) { return { WorkOrderID: w.WorkOrderID, TaskNo: i + 1, TaskDescription: d, IsDone: false }; }), user.email);
      }
      Audit.log(user, 'WO_UPDATE', 'WORK_ORDERS', w.WorkOrderID, { fields: Object.keys(upd), tasks: tasks ? tasks.length : undefined }, 'OK');
      return { WorkOrderID: w.WorkOrderID };
    });
  },

  decide: function (p, user) {
    p = p || {};
    const decision = String(p.decision || '');
    if (['Approved', 'Rejected'].indexOf(decision) === -1) throw validationError_([{ field: 'decision', rule: 'invalid' }]);
    const remarks = String(p.remarks || '').trim();
    if (decision === 'Rejected' && !remarks) throw validationError_([{ field: 'ApprovalRemarks', rule: 'required' }]);
    if (remarks.length > 500) throw validationError_([{ field: 'ApprovalRemarks', rule: 'tooLong' }]);
    const assignee = Auth.norm(p.AssignedTo || '');
    if (decision === 'Approved' && assignee && !Work.techOk_(assignee)) throw validationError_([{ field: 'AssignedTo', rule: 'notFound' }]);
    const w = Db.withLock(function () {
      const cur = WO.rec_(p.id);
      if (cur.Status !== 'Requested') throw new AppError('CONFLICT', 'Not pending', { rule: 'notPending' });
      const self = Auth.norm(cur.RequestedByEmail) === Auth.norm(user.email);
      if (self && user.role !== 'Admin') throw new AppError('FORBIDDEN', 'Self approval', { rule: 'selfApprove' });
      const upd = { ApprovalStatus: decision, Status: decision === 'Approved' ? 'Approved' : 'Rejected', ApprovedBy: user.name, ApprovedAt: Db.now(), ApprovalRemarks: remarks };
      if (decision === 'Approved' && assignee) upd.AssignedTo = assignee;
      Db.update('WORK_ORDERS', cur.WorkOrderID, upd, user.email, { expectedUpdatedAt: p.UpdatedAt });
      Audit.log(user, decision === 'Approved' ? 'WO_APPROVE' : 'WO_REJECT', 'WORK_ORDERS', cur.WorkOrderID, { remarks: remarks, assignee: assignee, selfApproved: self }, 'OK');
      return Db.get('WORK_ORDERS', cur.WorkOrderID);
    });
    if (decision === 'Approved' && assignee) Notify.assigned('WO_ASSIGNED', assignee, w.WorkOrderID + ' - ' + w.Title, w.Description, 'WORK_ORDER', w.WorkOrderID);
    return { WorkOrderID: w.WorkOrderID, Status: w.Status };
  },

  assign: function (p, user) {
    const assignee = Auth.norm(p && p.AssignedTo || '');
    if (!assignee) throw validationError_([{ field: 'AssignedTo', rule: 'required' }]);
    if (!Work.techOk_(assignee)) throw validationError_([{ field: 'AssignedTo', rule: 'notFound' }]);
    const w = Db.withLock(function () {
      const cur = WO.rec_(p.id);
      if (cur.Status !== 'Approved' && cur.Status !== 'In Progress') throw new AppError('CONFLICT', 'Bad state', { rule: 'badState' });
      Db.update('WORK_ORDERS', cur.WorkOrderID, { AssignedTo: assignee }, user.email);
      Audit.log(user, 'WO_ASSIGN', 'WORK_ORDERS', cur.WorkOrderID, { to: assignee }, 'OK');
      return Db.get('WORK_ORDERS', cur.WorkOrderID);
    });
    Notify.assigned('WO_ASSIGNED', assignee, w.WorkOrderID + ' - ' + w.Title, w.Description, 'WORK_ORDER', w.WorkOrderID);
    return { WorkOrderID: w.WorkOrderID };
  },

  start: function (p, user) {
    return Db.withLock(function () {
      const w = WO.rec_(p && p.id);
      if (!WO.canWork_(user, w)) throw new AppError('FORBIDDEN', 'Not assignee', { rule: 'notAssignee' });
      if (w.Status !== 'Approved') throw new AppError('CONFLICT', 'Bad state', { rule: 'badState' });
      if (!w.AssignedTo) throw new AppError('CONFLICT', 'Unassigned', { rule: 'unassigned' });
      Db.update('WORK_ORDERS', w.WorkOrderID, { Status: 'In Progress', StartedAt: Db.now() }, user.email);
      Audit.log(user, 'WO_START', 'WORK_ORDERS', w.WorkOrderID, {}, 'OK');
      return { WorkOrderID: w.WorkOrderID, Status: 'In Progress' };
    });
  },

  toggleTask: function (p, user) {
    return Db.withLock(function () {
      const t = Db.get('WORK_ORDER_TASKS', String(p && p.taskId || ''));
      if (!t) throw new AppError('NOT_FOUND', 'Task not found');
      const w = WO.rec_(t.WorkOrderID);
      if (!WO.canWork_(user, w)) throw new AppError('FORBIDDEN', 'Not assignee', { rule: 'notAssignee' });
      if (w.Status !== 'In Progress') throw new AppError('CONFLICT', 'Bad state', { rule: 'badState' });
      const done = p.done === true;
      const remarks = String(p.remarks || '').trim();
      if (remarks.length > 300) throw validationError_([{ field: 'Remarks', rule: 'tooLong' }]);
      Db.update('WORK_ORDER_TASKS', t.TaskID, { IsDone: done, DoneBy: done ? user.name : '', DoneAt: done ? Db.now() : '', Remarks: remarks || t.Remarks }, user.email);
      return { TaskID: t.TaskID, IsDone: done };
    });
  },

  complete: function (p, user) {
    const notes = String(p && p.ResultNotes || '').trim();
    if (!notes) throw validationError_([{ field: 'ResultNotes', rule: 'required' }]);
    if (notes.length > 1500) throw validationError_([{ field: 'ResultNotes', rule: 'tooLong' }]);
    return Db.withLock(function () {
      const w = WO.rec_(p.id);
      if (!WO.canWork_(user, w)) throw new AppError('FORBIDDEN', 'Not assignee', { rule: 'notAssignee' });
      if (w.Status !== 'In Progress') throw new AppError('CONFLICT', 'Bad state', { rule: 'badState' });
      const pending = WO.tasks_(w.WorkOrderID).filter(function (t) { return t.IsDone !== true; });
      if (pending.length) throw new AppError('CONFLICT', 'Tasks pending', { rule: 'tasksPending', pending: pending.length });
      Db.update('WORK_ORDERS', w.WorkOrderID, { Status: 'Completed', ResultNotes: notes, CompletedBy: Auth.norm(user.email), CompletedAt: Db.now() }, user.email, { expectedUpdatedAt: p.UpdatedAt });
      Audit.log(user, 'WO_COMPLETE', 'WORK_ORDERS', w.WorkOrderID, {}, 'OK');
      return { WorkOrderID: w.WorkOrderID, Status: 'Completed' };
    });
  },

  close: function (p, user) {
    return Db.withLock(function () {
      const w = WO.rec_(p && p.id);
      if (w.Status !== 'Completed') throw new AppError('CONFLICT', 'Bad state', { rule: 'badState' });
      const self = Auth.norm(w.CompletedBy) === Auth.norm(user.email);
      if (self && user.role !== 'Admin') throw new AppError('FORBIDDEN', 'Self verify', { rule: 'selfApprove' });
      Db.update('WORK_ORDERS', w.WorkOrderID, { Status: 'Closed', VerifiedBy: user.name, ClosedAt: Db.now() }, user.email);
      Audit.log(user, 'WO_CLOSE', 'WORK_ORDERS', w.WorkOrderID, { selfClosed: self }, 'OK');
      return { WorkOrderID: w.WorkOrderID, Status: 'Closed' };
    });
  },

  cancel: function (p, user) {
    const remarks = String(p && p.remarks || '').trim();
    if (!remarks) throw validationError_([{ field: 'ApprovalRemarks', rule: 'required' }]);
    return Db.withLock(function () {
      const w = WO.rec_(p.id);
      const mineReq = Auth.norm(w.RequestedByEmail) === Auth.norm(user.email);
      if (!(Auth.can(user, 'wo.approve') || mineReq)) throw new AppError('FORBIDDEN', 'Forbidden', { rule: 'wo.cancel' });
      if (w.Status !== 'Requested' && w.Status !== 'Approved') throw new AppError('CONFLICT', 'Bad state', { rule: 'badState' });
      Db.update('WORK_ORDERS', w.WorkOrderID, { Status: 'Cancelled', ApprovalRemarks: remarks }, user.email);
      Audit.log(user, 'WO_CANCEL', 'WORK_ORDERS', w.WorkOrderID, { remarks: remarks }, 'OK');
      return { WorkOrderID: w.WorkOrderID, Status: 'Cancelled' };
    });
  }
};
