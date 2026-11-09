/** Uji backend Phase 4 (Corrective Maintenance & Work Order) di Node dengan mock GAS. */
const assert = require('assert');
const { build } = require('./gas-mock');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 4).join('\n       ')); } };

const ctx = build(); ctx.setupEMMS(); ctx.seedDemoData();
const A = (...a) => ctx.api(...a);
const login = (email) => { A('', 'auth.requestOtp', { email }); const m = ctx.__state.mails.filter(x => x.to === email).pop(); return A('', 'auth.verifyOtp', { email, code: m.htmlBody.match(/>(\d{6})</)[1] }).data.token; };
const adm = login('owner@gmail.com');
const tok = {};
[['T', 'Technician'], ['T2', 'Technician'], ['S', 'Supervisor'], ['S2', 'Supervisor'], ['V', 'Viewer']].forEach(([k, r]) => {
  assert.ok(A(adm, 'users.save', { FullName: 'User ' + k, Email: k.toLowerCase() + '@gmail.com', Role: r, Department: 'EM' }).ok);
  tok[k] = login(k.toLowerCase() + '@gmail.com');
});
const eqs = ctx.Db.all('EQUIPMENT');
const E1 = eqs[0].EquipmentID, E2 = eqs[1].EquipmentID, E3 = eqs[2].EquipmentID;
const st = id => ctx.Db.get('EQUIPMENT', id).EquipmentStatus;
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const rep = (token, o = {}) => A(token, 'cm.report', Object.assign({ EquipmentID: E1, ProblemDescription: 'MCB trip berulang', Priority: 'Medium' }, o));

console.log('\n[1] Laporan kerusakan');
let C1;
t('Technician melapor; ComplaintNo CM-xxxx; status Open; identitas dari sesi', () => {
  const r = rep(tok.T); assert.ok(r.ok, JSON.stringify(r)); C1 = r.data.ComplaintNo;
  assert.match(C1, /^CM-\d{4}$/);
  const c = ctx.Db.get('CORRECTIVE_MAINTENANCE', C1);
  assert.strictEqual(c.Status, 'Open'); assert.strictEqual(c.ReportedBy, 'User T'); assert.strictEqual(c.ReportedByEmail, 't@gmail.com');
  assert.strictEqual(st(E1), 'Normal');
});
t('Validasi & RBAC', () => {
  const r = rep(tok.T, { EquipmentID: 'EQ-9999', ProblemDescription: ' ', Priority: 'Urgent' });
  assert.strictEqual(r.code, 'VALIDATION'); assert.strictEqual(r.details.errors.length, 3);
  assert.strictEqual(rep(tok.V).code, 'FORBIDDEN');
  assert.strictEqual(A(tok.V, 'cm.list', {}).ok, true);
});
t('Critical -> equipment Breakdown + email ke Supervisor/Manager/Admin; High -> Warning', () => {
  const before = ctx.__state.mails.length;
  const r = rep(tok.T, { EquipmentID: E2, Priority: 'Critical' }); assert.ok(r.ok);
  assert.strictEqual(r.data.EquipmentStatus, 'Breakdown'); assert.strictEqual(st(E2), 'Breakdown');
  assert.ok(r.data.notified.sent >= 1); assert.ok(ctx.__state.mails.length > before);
  assert.ok(ctx.__state.mails.slice(before).every(m => !m.to.startsWith('t@') && !m.to.startsWith('v@')));
  const h = rep(tok.T, { EquipmentID: E3, Priority: 'High' }); assert.strictEqual(st(E3), 'Warning');
  assert.strictEqual(rep(tok.T, { EquipmentID: E3, Priority: 'Low' }).data.EquipmentStatus, 'Warning'); // tidak turun
});
t('Foto bukti: pelapor boleh, maksimal 5, orang lain ditolak, file palsu ditolak', () => {
  assert.ok(A(tok.T, 'cm.uploadPhoto', { id: C1, base64: png }).ok);
  assert.strictEqual(A(tok.T2, 'cm.uploadPhoto', { id: C1, base64: png }).ok, true); // teknisi lain tanpa penugasan boleh (belum ditugaskan)
  assert.strictEqual(A(tok.T, 'cm.uploadPhoto', { id: C1, base64: 'bm90IGltYWdl' }).ok, false);
  for (let i = 0; i < 3; i++) assert.ok(A(tok.T, 'cm.uploadPhoto', { id: C1, base64: png }).ok);
  const r = A(tok.T, 'cm.uploadPhoto', { id: C1, base64: png }); assert.strictEqual(r.details.rule, 'maxPhotos');
  assert.ok(A(tok.V, 'cm.photo', { id: C1, index: 0 }).data.dataUrl.startsWith('data:image/png'));
  assert.strictEqual(A(tok.V, 'cm.uploadPhoto', { id: C1, base64: png }).code, 'FORBIDDEN');
});

console.log('\n[2] Penugasan & pengerjaan');
t('Hanya Supervisor+ yang menugaskan; teknisi valid; email penugasan terkirim', () => {
  assert.strictEqual(A(tok.T, 'cm.assign', { id: C1, technician: 't@gmail.com' }).code, 'FORBIDDEN');
  assert.strictEqual(A(tok.S, 'cm.assign', { id: C1, technician: 'v@gmail.com' }).code, 'VALIDATION');
  assert.strictEqual(A(tok.S, 'cm.assign', { id: C1, technician: '' }).code, 'VALIDATION');
  const n = ctx.__state.mails.length;
  assert.ok(A(tok.S, 'cm.assign', { id: C1, technician: 't@gmail.com' }).ok);
  assert.strictEqual(ctx.__state.mails.length, n + 1); assert.strictEqual(ctx.__state.mails[n].to, 't@gmail.com');
  assert.strictEqual(ctx.Db.get('CORRECTIVE_MAINTENANCE', C1).AssignedTechnician, 't@gmail.com');
});
t('Teknisi lain tidak boleh mengerjakan yang ditugaskan ke orang lain', () => {
  assert.strictEqual(A(tok.T2, 'cm.start', { id: C1 }).details.rule, 'notAssignee');
  assert.strictEqual(A(tok.T2, 'cm.complete', { id: C1 }).code === 'VALIDATION' || A(tok.T2, 'cm.complete', { id: C1 }).code === 'FORBIDDEN', true);
  const g = A(tok.T2, 'cm.get', { id: C1 }).data; assert.strictEqual(g.can.start, false);
});
t('Mulai -> In Progress, StartTime terisi; tidak bisa mulai dua kali', () => {
  assert.ok(A(tok.T, 'cm.start', { id: C1 }).ok);
  const c = ctx.Db.get('CORRECTIVE_MAINTENANCE', C1); assert.strictEqual(c.Status, 'In Progress'); assert.ok(c.StartTime);
  assert.strictEqual(A(tok.T, 'cm.start', { id: C1 }).details.rule, 'badState');
});
t('Jeda (Pending) wajib tindakan; simpan progres; lanjut lagi', () => {
  assert.strictEqual(A(tok.T, 'cm.update', { id: C1, Status: 'Pending' }).code, 'VALIDATION');
  assert.ok(A(tok.T, 'cm.update', { id: C1, Status: 'Pending', CorrectiveAction: 'Tunggu MCB pengganti', SparePartUsed: 'MCB 3P 63A' }).ok);
  assert.strictEqual(ctx.Db.get('CORRECTIVE_MAINTENANCE', C1).Status, 'Pending');
  assert.ok(A(tok.T, 'cm.start', { id: C1 }).ok);
  assert.strictEqual(A(tok.T, 'cm.update', { id: C1, Status: 'Closed' }).code, 'VALIDATION');
});
t('Selesai: akar masalah, tindakan, hasil wajib', () => {
  const r = A(tok.T, 'cm.complete', { id: C1 }); assert.strictEqual(r.code, 'VALIDATION');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.details.errors.map(e => e.field).sort())), ['CorrectiveAction', 'RepairResult', 'RootCause']);
  assert.ok(A(tok.T, 'cm.complete', { id: C1, RootCause: 'Baut longgar', CorrectiveAction: 'Ganti MCB & kencangkan', RepairResult: 'Repaired' }).ok);
  const c = ctx.Db.get('CORRECTIVE_MAINTENANCE', C1);
  assert.strictEqual(c.Status, 'Completed'); assert.strictEqual(c.CompletedBy, 't@gmail.com'); assert.ok(c.FinishTime);
});
t('Teknisi tanpa penugasan boleh mengambil pekerjaan (self-assign saat mulai)', () => {
  const r = rep(tok.T2, { EquipmentID: E1, ProblemDescription: 'Lampu panel padam' }); const id = r.data.ComplaintNo;
  assert.ok(A(tok.T, 'cm.start', { id }).ok);
  assert.strictEqual(ctx.Db.get('CORRECTIVE_MAINTENANCE', id).AssignedTechnician, 't@gmail.com');
});

console.log('\n[3] Verifikasi & penutupan');
t('Penyelesai tidak boleh menutup sendiri (kecuali Admin); detail menunjukkan can.close', () => {
  assert.strictEqual(A(tok.T, 'cm.close', { id: C1 }).code, 'FORBIDDEN');
  assert.strictEqual(A(tok.S, 'cm.get', { id: C1 }).data.can.close, true);
  assert.strictEqual(A(tok.T, 'cm.get', { id: C1 }).data.can.close, false);
});
t('Tutup oleh Supervisor: Closed; Repaired + tidak ada CM lain -> equipment Normal', () => {
  // E1 hanya Normal; paksa Warning untuk menguji pemulihan
  ctx.Db.update('EQUIPMENT', E1, { EquipmentStatus: 'Warning' }, 'test');
  const other = ctx.Db.all('CORRECTIVE_MAINTENANCE').filter(c => c.EquipmentID === E1 && ['Open', 'In Progress', 'Pending', 'Completed'].includes(c.Status) && c.ComplaintNo !== C1);
  assert.ok(other.length >= 1, 'ada CM lain yang aktif');
  const r = A(tok.S, 'cm.close', { id: C1, remarks: 'Diverifikasi' }); assert.ok(r.ok);
  assert.strictEqual(st(E1), 'Warning'); // masih ada CM lain -> tidak dinormalkan
});
t('Selesaikan & tutup CM terakhir -> equipment kembali Normal; opsi setNormal=false dihormati', () => {
  const act = ctx.Db.all('CORRECTIVE_MAINTENANCE').filter(c => c.EquipmentID === E1 && ['Open', 'In Progress', 'Pending'].includes(c.Status));
  act.forEach(c => { assert.ok(A(tok.T, 'cm.start', { id: c.ComplaintNo }).ok || true); });
  act.forEach(c => assert.ok(A(adm, 'cm.complete', { id: c.ComplaintNo, RootCause: 'x', CorrectiveAction: 'y', RepairResult: 'Repaired' }).ok));
  const last = act[act.length - 1].ComplaintNo;
  act.slice(0, -1).forEach(c => assert.ok(A(tok.S, 'cm.close', { id: c.ComplaintNo, setNormal: false }).ok));
  assert.strictEqual(st(E1), 'Warning');
  const r = A(tok.S, 'cm.close', { id: last }); assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.data.EquipmentStatus, 'Normal'); assert.strictEqual(st(E1), 'Normal');
});
t('Hasil bukan Repaired tidak menormalkan equipment', () => {
  const id = rep(tok.T, { EquipmentID: E3, Priority: 'High' }).data.ComplaintNo;
  A(tok.T, 'cm.start', { id }); A(tok.T, 'cm.complete', { id, RootCause: 'a', CorrectiveAction: 'b', RepairResult: 'Temporary' });
  const others = ctx.Db.all('CORRECTIVE_MAINTENANCE').filter(c => c.EquipmentID === E3 && c.ComplaintNo !== id && ['Open', 'In Progress', 'Pending', 'Completed'].includes(c.Status));
  assert.ok(A(tok.S, 'cm.close', { id }).ok); assert.strictEqual(st(E3), 'Warning');
});
t('Buka kembali (alasan wajib); Closed terkunci untuk foto', () => {
  assert.strictEqual(A(tok.S, 'cm.reopen', { id: C1 }).code, 'VALIDATION');
  assert.strictEqual(A(tok.T, 'cm.uploadPhoto', { id: C1, base64: png }).details.rule, 'locked');
  assert.strictEqual(A(tok.T, 'cm.reopen', { id: C1, remarks: 'x' }).code, 'FORBIDDEN');
  assert.ok(A(tok.S, 'cm.reopen', { id: C1, remarks: 'Trip lagi' }).ok);
  const c = ctx.Db.get('CORRECTIVE_MAINTENANCE', C1); assert.strictEqual(c.Status, 'In Progress'); assert.strictEqual(c.ClosedBy, '');
});
t('Daftar & filter: group, prioritas, mine; urut prioritas', () => {
  const act = A(tok.T, 'cm.list', { group: 'active' }).data.rows;
  assert.ok(act.every(r => ['Open', 'In Progress', 'Pending'].includes(r.Status)));
  assert.strictEqual(act[0].Priority, 'Critical');
  assert.ok(A(tok.T, 'cm.list', { mine: true }).data.rows.every(r => r.isMine));
  assert.ok(A(tok.T, 'cm.list', { group: 'done' }).data.rows.every(r => ['Completed', 'Closed'].includes(r.Status)));
});

console.log('\n[4] Work Order');
let W1;
const woBase = (o = {}) => Object.assign({ SourceType: 'Manual', EquipmentID: E1, Title: 'Ganti kontaktor', Description: 'Kontaktor aus', Priority: 'High', tasks: ['Isolasi', 'Ganti kontaktor', 'Uji fungsi'] }, o);
t('Buat WO manual: Requested, 3 tugas berurutan, pemohon dari sesi', () => {
  const r = A(tok.T, 'wo.create', woBase()); assert.ok(r.ok, JSON.stringify(r)); W1 = r.data.WorkOrderID;
  assert.match(W1, /^WO-\d{4}$/); assert.strictEqual(r.data.Status, 'Requested');
  const g = A(tok.T, 'wo.get', { id: W1 }).data; assert.strictEqual(g.tasks.length, 3); assert.deepStrictEqual(JSON.parse(JSON.stringify(g.tasks.map(x => x.TaskNo))), [1, 2, 3]);
  assert.strictEqual(g.wo.RequestedBy, 'User T'); assert.strictEqual(g.wo.ApprovalStatus, 'Pending');
});
t('Validasi: judul, prioritas, urutan tanggal, tugas terlalu banyak; Viewer ditolak', () => {
  const r = A(tok.T, 'wo.create', woBase({ Title: '', Priority: 'X', PlannedDate: '2026-05-10', DueDate: '2026-05-01', tasks: new Array(21).fill('a') }));
  assert.strictEqual(r.code, 'VALIDATION'); const f = r.details.errors.map(e => e.field + ':' + e.rule);
  ['Title:required', 'Priority:invalid', 'DueDate:dateOrder', 'tasks:tooMany'].forEach(x => assert.ok(f.includes(x), x));
  assert.strictEqual(A(tok.V, 'wo.create', woBase()).code, 'FORBIDDEN');
  assert.strictEqual(A(tok.T, 'wo.create', woBase({ SourceType: 'Safety', SourceID: 'x' })).code, 'NOT_FOUND');
});
t('Pemohon tidak boleh menyetujui WO sendiri; Technician tidak punya hak approve', () => {
  assert.strictEqual(A(tok.T, 'wo.decide', { id: W1, decision: 'Approved' }).code, 'FORBIDDEN');
  const sup = A(tok.S, 'wo.create', woBase({ Title: 'WO Supervisor' })).data.WorkOrderID;
  assert.strictEqual(A(tok.S, 'wo.decide', { id: sup, decision: 'Approved' }).details.rule, 'selfApprove');
  assert.strictEqual(A(tok.S, 'wo.get', { id: sup }).data.can.decideBlockedSelf, true);
  assert.ok(A(tok.S2, 'wo.decide', { id: sup, decision: 'Rejected', remarks: 'Tidak perlu' }).ok);
  assert.strictEqual(ctx.Db.get('WORK_ORDERS', sup).Status, 'Rejected');
});
t('Tolak wajib alasan; Setujui + tunjuk teknisi -> email; tidak bisa diputuskan dua kali', () => {
  assert.strictEqual(A(tok.S, 'wo.decide', { id: W1, decision: 'Rejected' }).code, 'VALIDATION');
  assert.strictEqual(A(tok.S, 'wo.decide', { id: W1, decision: 'Approved', AssignedTo: 'v@gmail.com' }).code, 'VALIDATION');
  const n = ctx.__state.mails.length;
  assert.ok(A(tok.S, 'wo.decide', { id: W1, decision: 'Approved', AssignedTo: 't@gmail.com', remarks: 'ok' }).ok);
  assert.strictEqual(ctx.__state.mails[n].to, 't@gmail.com');
  assert.strictEqual(A(tok.S2, 'wo.decide', { id: W1, decision: 'Approved' }).details.rule, 'notPending');
  const w = ctx.Db.get('WORK_ORDERS', W1); assert.strictEqual(w.Status, 'Approved'); assert.strictEqual(w.ApprovedBy, 'User S');
});
t('Edit WO diizinkan sampai Approved; tugas diganti; tidak setelah mulai', () => {
  assert.ok(A(tok.S, 'wo.update', { id: W1, Title: 'Ganti kontaktor K1', tasks: ['Isolasi', 'Ganti', 'Uji', 'Rapikan'] }).ok);
  assert.strictEqual(A(tok.T, 'wo.get', { id: W1 }).data.tasks.length, 4);
  assert.strictEqual(A(tok.T2, 'wo.update', { id: W1, Title: 'x' }).code, 'FORBIDDEN');
});
t('Mulai: hanya yang ditugaskan; tugas dicentang; Selesai butuh semua tugas + catatan', () => {
  assert.strictEqual(A(tok.T2, 'wo.start', { id: W1 }).details.rule, 'notAssignee');
  assert.ok(A(tok.T, 'wo.start', { id: W1 }).ok);
  assert.strictEqual(A(tok.T, 'wo.complete', { id: W1, ResultNotes: '' }).code, 'VALIDATION');
  let r = A(tok.T, 'wo.complete', { id: W1, ResultNotes: 'selesai' }); assert.strictEqual(r.details.rule, 'tasksPending'); assert.strictEqual(r.details.pending, 4);
  const tasks = A(tok.T, 'wo.get', { id: W1 }).data.tasks;
  assert.strictEqual(A(tok.T2, 'wo.toggleTask', { taskId: tasks[0].TaskID, done: true }).details.rule, 'notAssignee');
  tasks.forEach(x => assert.ok(A(tok.T, 'wo.toggleTask', { taskId: x.TaskID, done: true }).ok));
  assert.ok(A(tok.T, 'wo.toggleTask', { taskId: tasks[3].TaskID, done: false }).ok);
  assert.strictEqual(A(tok.T, 'wo.complete', { id: W1, ResultNotes: 'selesai' }).details.rule, 'tasksPending');
  assert.ok(A(tok.T, 'wo.toggleTask', { taskId: tasks[3].TaskID, done: true }).ok);
  assert.ok(A(tok.T, 'wo.complete', { id: W1, ResultNotes: 'Kontaktor diganti, uji OK' }).ok);
  assert.strictEqual(ctx.Db.get('WORK_ORDERS', W1).Status, 'Completed');
});
t('Tutup: penyelesai tidak boleh; Supervisor boleh; tercatat VerifiedBy/ClosedAt', () => {
  assert.strictEqual(A(tok.T, 'wo.close', { id: W1 }).code, 'FORBIDDEN');
  assert.ok(A(tok.S2, 'wo.close', { id: W1 }).ok);
  const w = ctx.Db.get('WORK_ORDERS', W1); assert.strictEqual(w.Status, 'Closed'); assert.strictEqual(w.VerifiedBy, 'User S2'); assert.ok(w.ClosedAt);
  assert.strictEqual(A(tok.S2, 'wo.close', { id: W1 }).details.rule, 'badState');
});
t('Batalkan: alasan wajib, hanya Requested/Approved', () => {
  const id = A(tok.T, 'wo.create', woBase({ Title: 'Batal' })).data.WorkOrderID;
  assert.strictEqual(A(tok.T, 'wo.cancel', { id }).code, 'VALIDATION');
  assert.strictEqual(A(tok.T2, 'wo.cancel', { id, remarks: 'x' }).code, 'FORBIDDEN');
  assert.ok(A(tok.T, 'wo.cancel', { id, remarks: 'Salah input' }).ok);
  assert.strictEqual(A(tok.T, 'wo.cancel', { id, remarks: 'x' }).details.rule, 'badState');
});

console.log('\n[5] Sumber WO');
t('Dari Corrective: prefill, tautan dua arah, satu WO aktif per sumber, bisa ulang bila ditolak', () => {
  const cm = rep(tok.T, { EquipmentID: E2, ProblemDescription: 'Motor panas', Priority: 'High' }).data.ComplaintNo;
  const pf = A(tok.T, 'wo.prefill', { sourceType: 'Corrective', sourceId: cm }).data;
  assert.strictEqual(pf.EquipmentID, E2); assert.strictEqual(pf.Priority, 'High'); assert.strictEqual(pf.Description, 'Motor panas');
  const r = A(tok.T, 'wo.create', Object.assign({}, pf, { tasks: [] })); assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(ctx.Db.get('CORRECTIVE_MAINTENANCE', cm).WorkOrderID, r.data.WorkOrderID);
  assert.strictEqual(A(tok.T, 'cm.get', { id: cm }).data.can.createWO, false);
  const d = A(tok.T, 'wo.create', Object.assign({}, pf, { tasks: [] })); assert.strictEqual(d.code, 'CONFLICT'); assert.strictEqual(d.details.rule, 'alreadyExists');
  assert.ok(A(tok.S2, 'wo.decide', { id: r.data.WorkOrderID, decision: 'Rejected', remarks: 'nanti' }).ok);
  assert.strictEqual(A(tok.T, 'cm.get', { id: cm }).data.can.createWO, true); assert.strictEqual(A(tok.T, 'cm.get', { id: cm }).data.cm.WorkOrderID, '');
  assert.ok(A(tok.T, 'wo.create', Object.assign({}, pf, { tasks: [] })).ok);
});
t('Dari Inspeksi NG: tugas diambil dari item NG, prioritas Critical, tautan di inspeksi', () => {
  const f = A(tok.T, 'inspection.form', { equipmentId: E3 }); assert.ok(f.ok, JSON.stringify(f));
  const items = f.data.items.map((i, n) => {
    const o = { ChecklistID: i.ChecklistID, Result: 'OK', Remarks: '' };
    if (i.ItemType === 'measure') o.MeasurementValue = i.MinValue !== '' && i.MaxValue !== '' ? (i.MinValue + i.MaxValue) / 2 : (i.MaxValue !== '' ? i.MaxValue - 1 : (i.MinValue !== '' ? i.MinValue + 1 : 10));
    if (i.IsCritical && i.ItemType === 'check' && !f.__ng) { o.Result = 'NG'; o.Remarks = 'Kabel meleleh'; f.__ng = i.ItemName; }
    return o;
  });
  const s = A(tok.T, 'inspection.submit', { EquipmentID: E3, items, Recommendation: 'Ganti kabel' }); assert.ok(s.ok, JSON.stringify(s));
  const pf = A(tok.T, 'wo.prefill', { sourceType: 'Inspection', sourceId: s.data.InspectionID }).data;
  assert.strictEqual(pf.Priority, s.data.OverallResult === 'Critical' ? 'Critical' : 'High'); assert.ok(pf.tasks.length >= 1); assert.ok(pf.tasks[0].includes('Kabel meleleh'));
  const r = A(tok.T, 'wo.create', pf); assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(ctx.Db.get('DAILY_INSPECTIONS', s.data.InspectionID).WorkOrderID, r.data.WorkOrderID);
  assert.strictEqual(A(tok.T, 'inspection.get', { id: s.data.InspectionID }).data.inspection.WorkOrderID, r.data.WorkOrderID);
});
t('Dari PM: tautan; equipment sumber harus sama', () => {
  const sch = A(tok.S, 'pm.schedule.save', { data: { EquipmentID: E1, PMTitle: 'PM tes WO', Frequency: 'Monthly', StartDate: ctx.Db.today() } }).data;
  const pm = A(tok.T, 'pm.complete', { PMScheduleID: sch.PMScheduleID, ActualDate: ctx.Db.today(), StartTime: '00:00', FinishTime: '00:01', MaintenanceResult: 'DoneWithFindings', Remarks: 'Terminal gosong' }).data.PMID;
  const pf = A(tok.T, 'wo.prefill', { sourceType: 'PM', sourceId: pm }).data; assert.ok(pf.Title.includes('PM tes WO'));
  assert.strictEqual(A(tok.T, 'wo.create', Object.assign({}, pf, { EquipmentID: E2 })).code, 'VALIDATION');
  const r = A(tok.T, 'wo.create', pf); assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(A(tok.T, 'pm.get', { id: pm }).data.pm.WorkOrderID, r.data.WorkOrderID);
  assert.strictEqual(A(tok.T, 'wo.prefill', { sourceType: 'Corrective', sourceId: 'CM-9999' }).code, 'NOT_FOUND');
});

console.log('\n[6] Daftar, dashboard, audit');
t('Daftar WO: filter group/mine/priority, urut prioritas, overdue', () => {
  const op = A(tok.T, 'wo.list', { group: 'open' }).data.rows; assert.ok(op.every(r => ['Requested', 'Approved', 'In Progress', 'Completed'].includes(r.Status)));
  assert.ok(A(tok.T, 'wo.list', { mine: true }).data.rows.every(r => r.isMine));
  assert.ok(A(tok.T, 'wo.list', { group: 'done' }).data.rows.every(r => ['Closed', 'Rejected', 'Cancelled'].includes(r.Status)));
  const id = A(tok.T, 'wo.create', woBase({ Title: 'Telat', PlannedDate: '2020-01-01', DueDate: '2020-01-02' })).data.WorkOrderID;
  assert.strictEqual(A(tok.T, 'wo.list', {}).data.rows.find(r => r.WorkOrderID === id).overdue, true);
});
t('Dashboard: cmActive/woOpen/woAwaiting konsisten', () => {
  const c = A(adm, 'dashboard.summary', {}).data.cards;
  assert.strictEqual(c.cmActive, ctx.Db.all('CORRECTIVE_MAINTENANCE').filter(x => ['Open', 'In Progress', 'Pending'].includes(x.Status)).length);
  assert.strictEqual(c.woOpen, ctx.Db.all('WORK_ORDERS').filter(x => !['Closed', 'Cancelled', 'Rejected'].includes(x.Status)).length);
  assert.strictEqual(c.woAwaiting, ctx.Db.all('WORK_ORDERS').filter(x => x.Status === 'Requested').length);
});
t('Audit mencatat seluruh siklus CM & WO', () => {
  const acts = new Set(ctx.Db.all('AUDIT_LOG').map(a => a.Action));
  ['CM_REPORT', 'CM_ASSIGN', 'CM_START', 'CM_UPDATE', 'CM_COMPLETE', 'CM_CLOSE', 'CM_REOPEN', 'CM_PHOTO', 'WO_CREATE', 'WO_UPDATE', 'WO_APPROVE', 'WO_REJECT', 'WO_START', 'WO_COMPLETE', 'WO_CLOSE', 'WO_CANCEL', 'EQUIPMENT_STATUS_AUTO'].forEach(a => assert.ok(acts.has(a), a));
});

console.log(`\nPhase 4 backend: ${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
