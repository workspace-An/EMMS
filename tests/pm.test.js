/** Uji backend Phase 3 (Preventive Maintenance) di Node dengan mock GAS. */
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
const E1 = eqs[0].EquipmentID, E2 = eqs[1].EquipmentID;
const today = ctx.Db.today();
const D = n => ctx.Db.addDays(today, n);
const sched = (token, d) => A(token, 'pm.schedule.save', { data: Object.assign({ EquipmentID: E1, PMTitle: 'Cek terminal & torsi baut', Frequency: 'Monthly', StartDate: D(-3), AssignedTechnician: 't@gmail.com' }, d) });
const comp = (token, id, o = {}) => A(token, 'pm.complete', Object.assign({ PMScheduleID: id, ActualDate: today, StartTime: '00:00', FinishTime: '00:01', MaintenanceResult: 'Done' }, o));

console.log('\n[1] Tanggal & frekuensi');
t('PMDate.addMonths menjepit akhir bulan; step/next melompati periode terlewat', () => {
  assert.strictEqual(ctx.PMDate.addMonths('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(ctx.PMDate.addMonths('2026-11-30', 3), '2027-02-28');
  assert.strictEqual(ctx.PMDate.addMonths('2026-12-15', 1), '2027-01-15');
  assert.strictEqual(ctx.PMDate.step('2026-03-01', 'Weekly'), '2026-03-08');
  assert.strictEqual(ctx.PMDate.step('2026-03-01', 'Custom', 10), '2026-03-11');
  assert.strictEqual(ctx.PMDate.next('2026-03-01', '2026-03-01', 'Monthly'), '2026-04-01');
  assert.strictEqual(ctx.PMDate.next('2026-03-01', '2026-02-20', 'Monthly'), '2026-04-01'); // lebih awal
  assert.strictEqual(ctx.PMDate.next('2026-03-01', '2026-06-10', 'Monthly'), '2026-07-01'); // terlambat: lompat
  assert.strictEqual(ctx.PMDate.next('2026-03-01', '2026-03-08', 'Weekly'), '2026-03-15');
});

console.log('\n[2] Jadwal');
let S1;
t('Supervisor membuat jadwal; NextDueDate = StartDate; event Calendar dibuat', () => {
  const r = sched(tok.S, {}); assert.ok(r.ok, JSON.stringify(r)); S1 = r.data;
  assert.strictEqual(S1.NextDueDate, D(-3)); assert.strictEqual(S1.state, 'Overdue'); assert.strictEqual(S1.hasCalendar, true);
  const ev = ctx.__state.events.filter(e => !e.deleted);
  assert.strictEqual(ev.length, 1); assert.ok(ev[0].title.startsWith('[PM] Cek terminal'));
});
t('Validasi: judul, frekuensi, custom, tanggal, teknisi tak dikenal', () => {
  const r = A(tok.S, 'pm.schedule.save', { data: { EquipmentID: 'EQ-9999', Frequency: 'Daily', StartDate: '2026-02-30', AssignedTechnician: 'nobody@x.com', PMTitle: '' } });
  assert.strictEqual(r.code, 'VALIDATION');
  const f = r.details.errors.map(e => e.field).sort();
  assert.strictEqual(JSON.stringify(f), JSON.stringify(['AssignedTechnician', 'EquipmentID', 'Frequency', 'PMTitle', 'StartDate']));
  assert.strictEqual(sched(tok.S, { PMTitle: 'x', Frequency: 'Custom' }).code, 'VALIDATION');
  assert.strictEqual(sched(tok.S, { PMTitle: 'x', Frequency: 'Custom', ScheduleRule: '0' }).code, 'VALIDATION');
  assert.strictEqual(sched(tok.S, { PMTitle: 'x', Frequency: 'Custom', ScheduleRule: '45' }).ok, true);
  assert.strictEqual(sched(tok.S, { AssignedTechnician: 'v@gmail.com', PMTitle: 'y' }).code, 'VALIDATION'); // Viewer tak boleh
});
t('Duplikat (equipment+judul) ditolak CONFLICT', () => {
  const r = sched(tok.S, {}); assert.strictEqual(r.code, 'CONFLICT'); assert.strictEqual(r.details.rule, 'duplicate');
});
t('RBAC: Technician & Viewer tidak boleh kelola jadwal; semua boleh lihat', () => {
  assert.strictEqual(sched(tok.T, { PMTitle: 'z' }).code, 'FORBIDDEN');
  assert.strictEqual(A(tok.V, 'pm.schedule.delete', { id: S1.PMScheduleID }).code, 'FORBIDDEN');
  assert.strictEqual(A(tok.V, 'pm.schedule.list', {}).ok, true);
  assert.strictEqual(A(tok.V, 'pm.complete', {}).code, 'FORBIDDEN');
  assert.strictEqual(A(tok.T, 'pm.approve', {}).code, 'FORBIDDEN');
});
t('Daftar: urut Overdue dulu, isMine & nama teknisi terisi', () => {
  const l = A(tok.T, 'pm.schedule.list', {}).data;
  assert.strictEqual(l.rows[0].state, 'Overdue');
  const mine = l.rows.find(r => r.PMScheduleID === S1.PMScheduleID);
  assert.strictEqual(mine.isMine, true); assert.strictEqual(mine.TechnicianName, 'User T');
  assert.strictEqual(A(tok.T2, 'pm.schedule.list', {}).data.rows.find(r => r.PMScheduleID === S1.PMScheduleID).isMine, false);
});
t('Ubah jadwal + konflik versi (optimistic)', () => {
  const r1 = sched(tok.S, { PMScheduleID: S1.PMScheduleID, UpdatedAt: S1.UpdatedAt, Instructions: 'Gunakan torque wrench' });
  assert.ok(r1.ok, JSON.stringify(r1));
  const r2 = sched(tok.S, { PMScheduleID: S1.PMScheduleID, UpdatedAt: '2000-01-01 00:00:00', Instructions: 'lama' });
  assert.strictEqual(r2.code, 'CONFLICT');
  S1 = r1.data;
});
t('Calendar gagal tidak menggagalkan penyimpanan', () => {
  ctx.__state.calFail = true;
  const r = sched(tok.S, { EquipmentID: E2, PMTitle: 'Tes kalender' });
  ctx.__state.calFail = false;
  assert.ok(r.ok); assert.strictEqual(r.data.hasCalendar, false);
});
t('PM_CALENDAR_ENABLED=FALSE: tidak membuat event', () => {
  assert.ok(A(adm, 'settings.update', { PM_CALENDAR_ENABLED: 'FALSE' }).ok);
  const n = ctx.__state.events.length;
  assert.ok(sched(tok.S, { EquipmentID: E2, PMTitle: 'Tanpa kalender' }).ok);
  assert.strictEqual(ctx.__state.events.length, n);
  assert.ok(A(adm, 'settings.update', { PM_CALENDAR_ENABLED: 'TRUE' }).ok);
  assert.strictEqual(A(adm, 'settings.update', { PM_LEAD_DAYS: '-1' }).code, 'VALIDATION');
});

console.log('\n[3] Pelaksanaan');
let R1;
t('Form: data jadwal, rentang tanggal', () => {
  const f = A(tok.T, 'pm.form', { scheduleId: S1.PMScheduleID }); assert.ok(f.ok);
  assert.strictEqual(f.data.minDate, D(-7)); assert.strictEqual(f.data.schedule.PMTitle, S1.PMTitle);
});
t('Validasi: waktu, hasil, catatan wajib bila bukan Done, tanggal di luar rentang', () => {
  const id = S1.PMScheduleID;
  assert.strictEqual(comp(tok.T, id, { StartTime: '', FinishTime: 'zz' }).code, 'VALIDATION');
  let r = comp(tok.T, id, { StartTime: '10:00', FinishTime: '09:00', ActualDate: D(-1) });
  assert.ok(r.details.errors.some(e => e.rule === 'timeOrder'));
  r = comp(tok.T, id, { MaintenanceResult: 'Partial' }); assert.ok(r.details.errors.some(e => e.field === 'Remarks'));
  r = comp(tok.T, id, { MaintenanceResult: 'X' }); assert.strictEqual(r.code, 'VALIDATION');
  r = comp(tok.T, id, { ActualDate: D(-30) }); assert.strictEqual(r.code, 'VALIDATION');
  r = comp(tok.T, id, { ActualDate: D(1) }); assert.strictEqual(r.code, 'VALIDATION');
  assert.strictEqual(ctx.Db.all('PREVENTIVE_MAINTENANCE').length, 0);
});
t('Selesaikan PM: rekaman Pending, jadwal maju (dari jatuh tempo), identitas dari sesi', () => {
  const r = comp(tok.T, S1.PMScheduleID, { MeasurementBefore: 'Torsi 8 Nm', MeasurementAfter: 'Torsi 10 Nm', ActualDate: D(-1), Remarks: 'Normal' });
  assert.ok(r.ok, JSON.stringify(r)); R1 = r.data.PMID;
  const rec = ctx.Db.get('PREVENTIVE_MAINTENANCE', R1);
  assert.strictEqual(rec.ApprovalStatus, 'Pending'); assert.strictEqual(rec.Technician, 'User T'); assert.strictEqual(rec.TechnicianEmail, 't@gmail.com');
  assert.strictEqual(rec.PlannedDate, D(-3)); assert.strictEqual(rec.PMTitle, S1.PMTitle);
  const s = ctx.Db.get('PM_SCHEDULES', S1.PMScheduleID);
  assert.strictEqual(s.LastDoneDate, D(-1));
  assert.strictEqual(s.NextDueDate, ctx.PMDate.next(D(-3), D(-1), 'Monthly'));
  assert.ok(s.NextDueDate > today);
  assert.ok(ctx.__state.events.some(e => !e.deleted && e.date.getTime() === new Date(...s.NextDueDate.split('-').map((x, i) => i === 1 ? x - 1 : +x)).getTime()), 'event kalender ikut maju');
});
t('Jatuh tempo yang sama tidak bisa diselesaikan dua kali (alreadyDone) bila belum maju', () => {
  const s = ctx.Db.get('PM_SCHEDULES', S1.PMScheduleID);
  ctx.Db.update('PM_SCHEDULES', S1.PMScheduleID, { NextDueDate: D(-3) }, 'test'); // simulasi balapan data
  const r = comp(tok.T2, S1.PMScheduleID); assert.strictEqual(r.code, 'CONFLICT'); assert.strictEqual(r.details.rule, 'alreadyDone');
  ctx.Db.update('PM_SCHEDULES', S1.PMScheduleID, { NextDueDate: s.NextDueDate }, 'test');
});
t('Jadwal nonaktif tidak bisa diselesaikan', () => {
  const r0 = sched(tok.S, { EquipmentID: E2, PMTitle: 'Nonaktif', Status: 'Inactive' }); assert.ok(r0.ok);
  assert.strictEqual(comp(tok.T, r0.data.PMScheduleID).details.rule, 'inactive');
  assert.strictEqual(r0.data.state, 'Inactive');
});

console.log('\n[4] Foto');
t('Upload foto sebelum/sesudah oleh pemilik; orang lain ditolak; approver boleh', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  assert.ok(A(tok.T, 'pm.uploadPhoto', { pmId: R1, kind: 'before', base64: png }).ok);
  assert.strictEqual(A(tok.T2, 'pm.uploadPhoto', { pmId: R1, kind: 'after', base64: png }).code, 'FORBIDDEN');
  assert.ok(A(tok.S, 'pm.uploadPhoto', { pmId: R1, kind: 'after', base64: png }).ok);
  assert.strictEqual(A(tok.T, 'pm.uploadPhoto', { pmId: R1, kind: 'bad', base64: png }).code, 'VALIDATION');
  assert.strictEqual(A(tok.T, 'pm.uploadPhoto', { pmId: R1, kind: 'before', base64: 'bm90IGltYWdl' }).ok, false);
  assert.ok(A(tok.V, 'pm.photo', { pmId: R1, kind: 'before' }).data.dataUrl.startsWith('data:image/png'));
  const g = A(tok.T, 'pm.get', { id: R1 }).data; assert.ok(g.pm.hasBefore && g.pm.hasAfter);
});

console.log('\n[5] Approval');
t('Pelaksana tidak boleh menyetujui sendiri (kecuali Admin); detail menunjukkan canApprove', () => {
  const sup = A(tok.S, 'pm.schedule.list', {}); assert.ok(sup.ok);
  const r = comp(tok.S, S1.PMScheduleID, {}); // S melaksanakan jatuh tempo berikutnya (tidak dibatasi tanggal)
  ctx.Db.update('PM_SCHEDULES', S1.PMScheduleID, { NextDueDate: D(-2) }, 'test');
  const r2 = comp(tok.S, S1.PMScheduleID, {}); assert.ok(r2.ok, JSON.stringify(r2));
  const id = r2.data.PMID;
  assert.strictEqual(A(tok.S, 'pm.get', { id }).data.canApprove, false);
  assert.strictEqual(A(tok.S, 'pm.approve', { id, decision: 'Approved' }).code, 'FORBIDDEN');
  assert.strictEqual(A(tok.S2, 'pm.get', { id }).data.canApprove, true);
  assert.strictEqual(A(tok.T, 'pm.get', { id: R1 }).data.canApprove, false);
  assert.ok(A(tok.S2, 'pm.approve', { id, decision: 'Approved' }).ok);
});
t('Setujui: status & pencatat; tidak bisa diputuskan dua kali; foto terkunci', () => {
  const x = A(tok.S2, 'pm.approve', { id: R1, decision: 'Approved', remarks: 'OK' }); assert.ok(x.ok, JSON.stringify(x));
  const rec = ctx.Db.get('PREVENTIVE_MAINTENANCE', R1);
  assert.strictEqual(rec.ApprovalStatus, 'Approved'); assert.strictEqual(rec.ApprovedBy, 'User S2');
  assert.strictEqual(A(tok.S2, 'pm.approve', { id: R1, decision: 'Rejected', remarks: 'x' }).details.rule, 'notPending');
  assert.strictEqual(A(tok.S2, 'pm.uploadPhoto', { pmId: R1, kind: 'before', base64: 'iVBORw0KGgo=' }).details.rule, 'locked');
});
t('Tolak: wajib alasan; jadwal kembali ke jatuh tempo semula & LastDone dihitung ulang', () => {
  const s = sched(tok.S, { EquipmentID: E2, PMTitle: 'PM tolak', StartDate: D(-2), Frequency: 'Weekly' }).data;
  const id = comp(tok.T, s.PMScheduleID).data.PMID;
  assert.strictEqual(ctx.Db.get('PM_SCHEDULES', s.PMScheduleID).NextDueDate, D(5));
  assert.strictEqual(A(tok.S, 'pm.approve', { id, decision: 'Rejected' }).code, 'VALIDATION');
  assert.ok(A(tok.S, 'pm.approve', { id, decision: 'Rejected', remarks: 'Foto tidak jelas' }).ok);
  const after = ctx.Db.get('PM_SCHEDULES', s.PMScheduleID);
  assert.strictEqual(after.NextDueDate, D(-2)); assert.strictEqual(after.LastDoneDate, '');
  assert.strictEqual(A(tok.T, 'pm.schedule.list', {}).data.rows.find(r => r.PMScheduleID === s.PMScheduleID).state, 'Overdue');
  // bisa dikerjakan ulang (rekaman Rejected tidak memblokir)
  assert.ok(comp(tok.T, s.PMScheduleID).ok);
});
t('Admin boleh menyetujui PM miliknya sendiri; tercatat di audit (selfApproved)', () => {
  const s = sched(adm, { EquipmentID: E2, PMTitle: 'PM admin', StartDate: D(0) }).data;
  const id = comp(adm, s.PMScheduleID).data.PMID;
  assert.ok(A(adm, 'pm.approve', { id, decision: 'Approved' }).ok);
  const a = ctx.Db.all('AUDIT_LOG').filter(x => x.Action === 'PM_APPROVE' && x.EntityID === id)[0];
  assert.ok(a.Details.includes('"selfApproved":true'));
});

console.log('\n[6] Riwayat, dashboard, hapus, audit');
t('Riwayat: filter approval/mine; detail memuat instruksi', () => {
  const all = A(tok.T, 'pm.list', {}).data.rows; assert.ok(all.length >= 4);
  assert.ok(A(tok.T, 'pm.list', { approval: 'Pending' }).data.rows.every(r => r.ApprovalStatus === 'Pending'));
  assert.ok(A(tok.T, 'pm.list', { mine: true }).data.rows.every(r => r.isMine));
  assert.strictEqual(A(tok.T, 'pm.get', { id: R1 }).data.pm.Instructions, 'Gunakan torque wrench');
  assert.strictEqual(A(tok.T, 'pm.get', { id: 'PM-9999' }).code, 'NOT_FOUND');
});
t('Dashboard: pmOverdue/pmUpcoming/pmAwaiting konsisten dengan jadwal', () => {
  const c = A(adm, 'dashboard.summary', {}).data.cards;
  const rows = A(adm, 'pm.schedule.list', {}).data.rows;
  assert.strictEqual(c.pmOverdue, rows.filter(r => r.state === 'Overdue').length);
  assert.strictEqual(c.pmAwaiting, ctx.Db.all('PREVENTIVE_MAINTENANCE').filter(r => r.ApprovalStatus === 'Pending').length);
});
t('Hapus jadwal = soft delete, event kalender dihapus, riwayat tetap ada', () => {
  const before = ctx.Db.all('PREVENTIVE_MAINTENANCE').length;
  assert.ok(A(tok.S, 'pm.schedule.delete', { id: S1.PMScheduleID }).ok);
  assert.ok(!A(tok.S, 'pm.schedule.list', {}).data.rows.some(r => r.PMScheduleID === S1.PMScheduleID));
  assert.strictEqual(ctx.Db.all('PREVENTIVE_MAINTENANCE').length, before);
  assert.strictEqual(ctx.Db.get('PM_SCHEDULES', S1.PMScheduleID, { includeDeleted: true }).Status, 'Deleted');
  assert.strictEqual(A(tok.T, 'pm.get', { id: R1 }).ok, true);
  assert.strictEqual(A(tok.S, 'pm.schedule.delete', { id: 'PMS-9999' }).code, 'NOT_FOUND');
});
t('Audit mencatat jadwal, selesai, foto, approval', () => {
  const acts = new Set(ctx.Db.all('AUDIT_LOG').map(a => a.Action));
  ['PM_SCHEDULE_CREATE', 'PM_SCHEDULE_UPDATE', 'PM_SCHEDULE_DELETE', 'PM_COMPLETE', 'PM_PHOTO', 'PM_APPROVE', 'PM_REJECT'].forEach(a => assert.ok(acts.has(a), a));
});

console.log(`\nPhase 3 backend: ${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
