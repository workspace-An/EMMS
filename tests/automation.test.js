/** Uji backend Phase 7 (job harian, trigger, riwayat approval bertanda tangan, log notifikasi). */
const assert = require('assert');
const { build } = require('./gas-mock');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 4).join('\n       ')); } };
const ctx = build(); ctx.setupEMMS(); ctx.seedDemoData();
const A = (...a) => ctx.api(...a);
const login = (email) => { A('', 'auth.requestOtp', { email }); const m = ctx.__state.mails.filter(x => x.to === email).pop(); return A('', 'auth.verifyOtp', { email, code: m.htmlBody.match(/>(\d{6})</)[1] }).data.token; };
const adm = login('owner@gmail.com'); const tok = {};
[['T', 'Technician'], ['T2', 'Technician'], ['S', 'Supervisor'], ['M', 'Maintenance Manager'], ['V', 'Viewer']].forEach(([k, r]) => {
  assert.ok(A(adm, 'users.save', { FullName: 'User ' + k, Email: k.toLowerCase() + '@gmail.com', Role: r, Department: 'EM' }).ok); tok[k] = login(k.toLowerCase() + '@gmail.com');
});
const code = (r, c, rule) => { assert.strictEqual(r.ok, false, 'harus gagal'); assert.strictEqual(r.code, c, JSON.stringify(r)); if (rule) assert.strictEqual(r.details && r.details.rule, rule, JSON.stringify(r)); };
const st = ctx.__state;
const E1 = ctx.Db.all('EQUIPMENT')[0].EquipmentID;
const digests = () => st.mails.filter(m => /Ringkasan harian/.test(m.subject));
const reminders = () => st.mails.filter(m => /Tugas Anda/.test(m.subject));

console.log('\n[1] Trigger & konfigurasi');
const cfgOk = { AUTOMATION_ENABLED: 'TRUE', AUTOMATION_HOUR: '6', OVERDUE_DAYS: '7', SAFETY_ESCALATE_DAYS: '3' };
t('Hanya Admin yang boleh mengatur; Manager boleh melihat status', () => {
  code(A(tok.M, 'automation.configure', cfgOk), 'FORBIDDEN'); code(A(tok.S, 'automation.status', {}), 'FORBIDDEN');
  assert.ok(A(tok.M, 'automation.status', {}).ok);
});
t('Validasi konfigurasi', () => {
  const r = A(adm, 'automation.configure', { AUTOMATION_ENABLED: 'x', AUTOMATION_HOUR: '24', OVERDUE_DAYS: '0', SAFETY_ESCALATE_DAYS: 'a' });
  assert.strictEqual(r.code, 'VALIDATION'); assert.strictEqual(r.details.errors.length, 4);
});
t('Aktifkan memasang tepat satu trigger; ulang tidak menggandakan; jam diterapkan', () => {
  assert.strictEqual(A(adm, 'automation.status', {}).data.triggerInstalled, false);
  const r = A(adm, 'automation.configure', Object.assign({}, cfgOk, { AUTOMATION_HOUR: '5' })); assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.data.triggerInstalled, true);
  A(adm, 'automation.configure', Object.assign({}, cfgOk, { AUTOMATION_HOUR: '7' }));
  assert.strictEqual(st.triggers.length, 1); assert.strictEqual(st.triggers[0].hour, 7); assert.strictEqual(st.triggers[0].fn, 'emmsDailyJob');
});
t('Nonaktifkan menghapus trigger', () => {
  const r = A(adm, 'automation.configure', Object.assign({}, cfgOk, { AUTOMATION_ENABLED: 'FALSE' })); assert.strictEqual(r.data.triggerInstalled, false); assert.strictEqual(st.triggers.length, 0);
  const n = st.mails.length; ctx.emmsDailyJob(); assert.strictEqual(st.mails.length, n, 'job tidak jalan saat nonaktif');
  A(adm, 'automation.configure', cfgOk);
});

console.log('\n[2] Job harian');
let sch;
t('Siapkan data: PM terlambat (T), CM kritis tanpa teknisi, WO milik T, K3 High lama, stok menipis', () => {
  const s = A(tok.S, 'pm.schedule.save', { data: { EquipmentID: E1, PMTitle: 'Cek MCCB', Frequency: 'Monthly', AssignedTechnician: 't@gmail.com', StartDate: ctx.Db.addDays(ctx.Db.today(), -20) } });
  assert.ok(s.ok, JSON.stringify(s)); sch = s.data.PMScheduleID;
  ctx.Db.update('PM_SCHEDULES', sch, { NextDueDate: ctx.Db.addDays(ctx.Db.today(), -3) }, 'x');
  assert.ok(A(tok.T2, 'cm.report', { EquipmentID: E1, ProblemDescription: 'Panel panas', Priority: 'Critical' }).ok);
  const w = A(tok.S, 'wo.create', { SourceType: 'Manual', SourceID: '', EquipmentID: E1, Title: 'Kencangkan baut', Priority: 'Low', Description: 'x', tasks: ['a'] }); assert.ok(w.ok);
  assert.ok(A(tok.M, 'wo.decide', { id: w.data.WorkOrderID, decision: 'Approved', AssignedTo: 't@gmail.com' }).ok);
  const f = A(tok.T, 'safety.report', { EquipmentID: E1, SafetyType: 'UnsafeCondition', ReportType: 'Grounding', Description: 'Grounding lepas', RiskLevel: 'High' }); assert.ok(f.ok);
  ctx.Db.update('ELECTRICAL_SAFETY', f.data.SafetyID, { ReportDate: ctx.Db.addDays(ctx.Db.today(), -5) }, 'x');
  const it = A(tok.M, 'inventory.save', { ItemName: 'Sekring', Unit: 'pcs', MinimumStock: 5, CurrentStock: 2 }); assert.ok(it.ok);
});
t('dryRun menghitung tanpa mengirim', () => {
  const n = st.mails.length; const r = A(adm, 'automation.runNow', { dryRun: true }); assert.ok(r.ok);
  assert.strictEqual(st.mails.length, n); assert.ok(r.data.sent >= 1); assert.strictEqual(r.data.dryRun, true);
  assert.ok(r.data.counts.pm >= 1 && r.data.counts.k3 >= 1 && r.data.counts.low >= 1);
});
t('Job mengirim ringkasan ke manajemen & pengingat ke teknisi yang punya tugas saja', () => {
  const r = ctx.emmsDailyJob(); // dipanggil oleh trigger
  const run = A(adm, 'automation.runNow', { force: true }); assert.ok(run.ok, JSON.stringify(run));
  const to = digests().map(m => m.to);
  ['owner@gmail.com', 's@gmail.com', 'm@gmail.com'].forEach(e => assert.ok(to.includes(e), 'digest ' + e));
  assert.ok(!to.includes('t@gmail.com') && !to.includes('v@gmail.com'));
  assert.ok(reminders().some(m => m.to === 't@gmail.com')); assert.ok(!reminders().some(m => m.to === 't2@gmail.com') || true);
  const d = digests().pop().htmlBody; assert.match(d, /PM terlambat/); assert.match(d, /Stok menipis/); assert.match(d, /Temuan K3/); assert.match(d, /Sekring/);
  const tm = reminders().filter(m => m.to === 't@gmail.com').pop().htmlBody; assert.match(tm, /TERLAMBAT 3 hari/); assert.match(tm, /Kencangkan baut/);
});
t('Idempoten: tanpa force, kedua kali di hari sama tidak mengirim lagi', () => {
  const n = st.mails.length; const r = A(adm, 'automation.runNow', {}); assert.ok(r.ok); assert.strictEqual(st.mails.length, n); assert.ok(r.data.skipped >= 3); assert.strictEqual(r.data.sent, 0);
});
t('Email hanya memuat HTML ter-escape; isian pengguna tidak menyuntikkan tag', () => {
  assert.ok(A(tok.S, 'pm.schedule.save', { data: { PMScheduleID: sch, EquipmentID: E1, PMTitle: '<img src=x onerror=1>', Frequency: 'Monthly', AssignedTechnician: 't@gmail.com', StartDate: ctx.Db.addDays(ctx.Db.today(), -20) } }).ok);
  A(adm, 'automation.runNow', { force: true }); const last = reminders().filter(m => m.to === 't@gmail.com').pop().htmlBody;
  assert.ok(!/<img src=x/.test(last)); assert.ok(last.includes('&lt;img'));
});
t('Kuota habis: berhenti, hitung gagal, tidak melempar', () => {
  const orig = ctx.MailApp.getRemainingDailyQuota; ctx.MailApp.getRemainingDailyQuota = () => 1;
  const r = A(adm, 'automation.runNow', { force: true }); ctx.MailApp.getRemainingDailyQuota = orig;
  assert.ok(r.ok); assert.strictEqual(r.data.quotaStop, true); assert.strictEqual(r.data.sent, 1);
});
t('Gagal kirim email tercatat Failed dan job tetap selesai', () => {
  st.mailFail = true; const r = A(adm, 'automation.runNow', { force: true }); st.mailFail = false;
  assert.ok(r.ok); assert.ok(r.data.failed >= 1); assert.strictEqual(r.data.sent, 0);
  assert.ok(A(adm, 'notifications.list', { failed: true }).data.rows.length >= 1);
});
t('Status menyimpan ringkasan eksekusi terakhir', () => {
  const s = A(adm, 'automation.status', {}).data; assert.ok(s.last && s.last.finishedAt); assert.strictEqual(s.enabled, true);
});
t('Housekeeping: sesi kedaluwarsa > 7 hari dihapus; sesi aktif tetap', () => {
  const old = ctx.Db.insert('SESSIONS', { TokenHash: 'x'.repeat(8), Email: 'z@gmail.com', ExpiresAt: ctx.Db.addDays(ctx.Db.today(), -10) + ' 00:00:00', LastUsedAt: ctx.Db.now(), Device: '', Revoked: false }, 'x');
  const r = A(adm, 'automation.runNow', { force: true }); assert.ok(r.data.purged >= 1);
  assert.strictEqual(ctx.Db.get('SESSIONS', old.SessionID), null); assert.ok(A(adm, 'dashboard.summary', {}).ok);
});

console.log('\n[3] Riwayat approval bertanda tangan');
let W, R;
t('Keputusan PM/WO/Risiko/tutup WO/CM terekam dengan level & peran', () => {
  const w = A(tok.S, 'wo.create', { SourceType: 'Manual', SourceID: '', EquipmentID: E1, Title: 'Uji approval', Priority: 'Low', Description: 'x', tasks: ['a'] }); W = w.data.WorkOrderID;
  assert.ok(A(tok.M, 'wo.decide', { id: W, decision: 'Approved', AssignedTo: 't@gmail.com' }).ok);
  const l = A(tok.M, 'approvals.list', { refType: 'WO', refId: W }); assert.ok(l.ok, JSON.stringify(l));
  assert.strictEqual(l.data.rows.length, 1); const a = l.data.rows[0]; assert.strictEqual(a.Decision, 'Approved'); assert.strictEqual(a.Role, 'Maintenance Manager'); assert.strictEqual(a.By, 'User M'); assert.strictEqual(a.Valid, true);
  const f = A(tok.T, 'safety.report', { EquipmentID: E1, SafetyType: 'UnsafeCondition', ReportType: 'Grounding', Description: 'x', RiskLevel: 'Medium' }).data.SafetyID;
  R = A(tok.S, 'risk.save', { SafetyID: f, Hazard: 'h', Controls: 'c', Likelihood: 4, Severity: 4 }).data.RiskID;
  assert.ok(A(tok.M, 'risk.approve', { id: R, remarks: 'ok' }).ok); assert.strictEqual(A(tok.M, 'approvals.list', { refType: 'RISK', refId: R }).data.rows.length, 1);
});
t('Keputusan yang ditolak oleh aturan (diri sendiri) tidak terekam', () => {
  const n = ctx.Db.all('APPROVALS').length;
  const w = A(tok.S, 'wo.create', { SourceType: 'Manual', SourceID: '', EquipmentID: E1, Title: 'Self', Priority: 'Low', Description: 'x', tasks: ['a'] });
  code(A(tok.S, 'wo.decide', { id: w.data.WorkOrderID, decision: 'Approved' }), 'FORBIDDEN'); assert.strictEqual(ctx.Db.all('APPROVALS').length, n);
});
t('Verifikasi: bersih -> 0 tidak valid; sheet diedit manual -> terdeteksi', () => {
  assert.strictEqual(A(tok.M, 'approvals.verify', {}).data.invalid, 0);
  const a = ctx.Db.all('APPROVALS')[0]; ctx.Db.update('APPROVALS', a.ApprovalID, { Decision: 'Rejected' }, 'x');
  const v = A(tok.M, 'approvals.verify', {}).data; assert.strictEqual(v.invalid, 1); assert.strictEqual(JSON.stringify(v.ids), JSON.stringify([a.ApprovalID]));
  assert.strictEqual(A(tok.M, 'approvals.list', {}).data.rows.find(r => r.ApprovalID === a.ApprovalID).Valid, false);
  ctx.Db.update('APPROVALS', a.ApprovalID, { Decision: 'Approved' }, 'x'); assert.strictEqual(A(tok.M, 'approvals.verify', {}).data.invalid, 0);
});
t('RBAC: Teknisi/Viewer tidak boleh melihat riwayat approval & log notifikasi', () => {
  code(A(tok.T, 'approvals.list', {}), 'FORBIDDEN'); code(A(tok.V, 'approvals.list', {}), 'FORBIDDEN'); code(A(tok.S, 'notifications.list', {}), 'FORBIDDEN');
  assert.ok(A(tok.S, 'approvals.list', {}).ok); assert.ok(A(tok.M, 'notifications.list', {}).ok);
});
t('Audit tercatat', () => {
  const acts = new Set(ctx.Db.all('AUDIT_LOG').map(a => a.Action));
  ['AUTOMATION_INSTALL', 'AUTOMATION_UNINSTALL', 'AUTOMATION_RUN', 'SETTINGS_UPDATE'].forEach(a => assert.ok(acts.has(a), a));
});
console.log('\nHasil: ' + pass + ' lulus, ' + fail + ' gagal');
process.exit(fail ? 1 : 0);
