/** Uji backend Phase 8 (laporan, backup, health check, skala data). */
const assert = require('assert');
const { build } = require('./gas-mock');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 4).join('\n       ')); } };
const ctx = build(); ctx.setupEMMS(); ctx.seedDemoData();
const A = (...a) => ctx.api(...a);
const login = (email) => { A('', 'auth.requestOtp', { email }); const m = ctx.__state.mails.filter(x => x.to === email).pop(); return A('', 'auth.verifyOtp', { email, code: m.htmlBody.match(/>(\d{6})</)[1] }).data.token; };
const adm = login('owner@gmail.com'); const tok = {};
[['T', 'Technician'], ['S', 'Supervisor'], ['M', 'Maintenance Manager'], ['V', 'Viewer']].forEach(([k, r]) => {
  assert.ok(A(adm, 'users.save', { FullName: 'User ' + k, Email: k.toLowerCase() + '@gmail.com', Role: r, Department: 'EM' }).ok); tok[k] = login(k.toLowerCase() + '@gmail.com');
});
const code = (r, c, rule) => { assert.strictEqual(r.ok, false, 'harus gagal'); assert.strictEqual(r.code, c, JSON.stringify(r)); if (rule) assert.strictEqual(r.details && r.details.rule, rule, JSON.stringify(r)); };
const st = ctx.__state, D = n => ctx.Db.addDays(ctx.Db.today(), n);
const E1 = ctx.Db.all('EQUIPMENT')[0].EquipmentID, E2 = ctx.Db.all('EQUIPMENT')[1].EquipmentID;
const rep = (type, o) => { const r = A(tok.M, 'reports.run', Object.assign({ type }, o)); assert.ok(r.ok, JSON.stringify(r)); return r.data; };
const kpi = (r, k) => r.kpis.find(x => x.key === k).value;
const tbl = (r, k) => r.tables.find(x => x.key === k);

console.log('\n[1] Validasi & hak akses');
t('Hak akses: Manager/Supervisor/Viewer boleh; Teknisi tidak', () => {
  ['M', 'S', 'V'].forEach(k => assert.ok(A(tok[k], 'reports.run', { type: 'summary' }).ok, k));
  code(A(tok.T, 'reports.run', { type: 'summary' }), 'FORBIDDEN');
});
t('Validasi tipe & rentang tanggal', () => {
  assert.strictEqual(A(tok.M, 'reports.run', { type: 'x' }).code, 'VALIDATION');
  assert.strictEqual(A(tok.M, 'reports.run', { type: 'cm', from: '2026-13-40', to: '2026-01-01' }).code, 'VALIDATION');
  assert.strictEqual(A(tok.M, 'reports.run', { type: 'cm', from: '2026-02-01', to: '2026-01-01' }).code, 'VALIDATION');
  assert.strictEqual(A(tok.M, 'reports.run', { type: 'cm', from: '2020-01-01', to: '2026-01-01' }).code, 'VALIDATION');
  assert.ok(A(tok.M, 'reports.run', { type: 'cm' }).ok);   // default 30 hari
});

console.log('\n[2] Angka laporan (data terkontrol)');
t('Inspeksi: total, NG, kritis, tingkat OK, per hari', () => {
  const today = ctx.Db.today();
  const mk = (eq, res, date, tech) => ctx.Db.insert('DAILY_INSPECTIONS', { EquipmentID: eq, InspectionDate: date, InspectionTime: '08:00', TechnicianEmail: 't@gmail.com', TechnicianName: tech, OverallResult: res, NGCount: res === 'OK' ? 0 : 1, CriticalCount: res === 'Critical' ? 1 : 0, Status: res === 'OK' ? 'Completed' : 'Open' }, 'x');
  mk(E1, 'OK', today, 'Budi'); mk(E1, 'OK', today, 'Budi'); mk(E2, 'NG', today, 'Budi'); mk(E2, 'Critical', D(-1), 'Sari'); mk(E1, 'OK', D(-90), 'Sari');
  const r = rep('inspection', { from: D(-29), to: today });
  assert.strictEqual(kpi(r, 'total'), 4); assert.strictEqual(kpi(r, 'ng'), 1); assert.strictEqual(kpi(r, 'critical'), 1); assert.strictEqual(kpi(r, 'okRate'), 50); assert.strictEqual(kpi(r, 'equipment'), 2);
  const pd = tbl(r, 'perDay').rows; assert.strictEqual(pd.length, 2); assert.strictEqual(pd[1][1], 3);
  assert.strictEqual(tbl(r, 'topNg').rows[0][1], 2); assert.strictEqual(tbl(r, 'byTech').rows[0][0], 'Budi');
  assert.strictEqual(kpi(rep('inspection', { from: D(-120), to: D(-60) }), 'total'), 1, 'rentang lain');
});
t('PM: kepatuhan tepat waktu & PM terlambat sekarang', () => {
  const pm = (pl, ac, ap) => ctx.Db.insert('PREVENTIVE_MAINTENANCE', { PMScheduleID: 'PMS-X', EquipmentID: E1, PMTitle: 'x', PlannedDate: pl, ActualDate: ac, Technician: 'Budi', MaintenanceResult: 'Done', ApprovalStatus: ap, Status: 'Completed' }, 'x');
  pm(D(-5), D(-5), 'Approved'); pm(D(-4), D(-6), 'Approved'); pm(D(-3), D(-1), 'Pending'); pm(D(-2), D(-2), 'Rejected');
  ctx.Db.insert('PM_SCHEDULES', { EquipmentID: E1, PMTitle: 'Telat', Frequency: 'Monthly', AssignedTechnician: 't@gmail.com', StartDate: D(-40), NextDueDate: D(-9), Status: 'Active' }, 'x');
  const r = rep('pm', {}); assert.strictEqual(kpi(r, 'done'), 4); assert.strictEqual(kpi(r, 'onTime'), 3); assert.strictEqual(kpi(r, 'late'), 1); assert.strictEqual(kpi(r, 'compliance'), 75);
  assert.strictEqual(kpi(r, 'pendingApproval'), 1); assert.strictEqual(kpi(r, 'rejected'), 1); assert.strictEqual(kpi(r, 'overdueNow'), 1); assert.strictEqual(tbl(r, 'overdueList').rows[0][3], 9);
});
t('CM: total, terbuka, kritis, MTTR, berulang', () => {
  const cm = (eq, pr, stt, fin) => ctx.Db.insert('CORRECTIVE_MAINTENANCE', { EquipmentID: eq, ProblemDescription: 'x', DateReported: ctx.Db.today(), ReportedBy: 'a', Priority: pr, Status: stt, FinishTime: fin || '' }, 'x');
  const a = cm(E1, 'Critical', 'Open'); cm(E1, 'Low', 'Closed', ctx.Db.addDays(ctx.Db.today(), 0) + ' 23:59:59'); cm(E2, 'High', 'In Progress');
  const r = rep('cm', {}); assert.strictEqual(kpi(r, 'total'), 3); assert.strictEqual(kpi(r, 'open'), 2); assert.strictEqual(kpi(r, 'critical'), 1); assert.strictEqual(kpi(r, 'repeatEquipment'), 1);
  assert.ok(kpi(r, 'mttrHours') >= 0 && kpi(r, 'mttrHours') < 24.1);
  assert.strictEqual(tbl(r, 'byPriority').rows[0][1], 1); assert.strictEqual(tbl(r, 'topEquipment').rows[0][1], 2);
});
t('WO: per sumber/status, tingkat selesai', () => {
  const eq = E1; const w = (src, stt) => ctx.Db.insert('WORK_ORDERS', { SourceType: src, SourceID: '', EquipmentID: eq, Title: 't', Priority: 'Low', RequestedBy: 'a', AssignedTo: 't@gmail.com', Status: stt, ClosedAt: stt === 'Closed' ? ctx.Db.now() : '' }, 'x');
  w('Manual', 'Closed'); w('Manual', 'Requested'); w('Safety', 'Rejected'); w('PM', 'In Progress');
  const r = rep('wo', {}); assert.strictEqual(kpi(r, 'total'), 4); assert.strictEqual(kpi(r, 'closed'), 1); assert.strictEqual(kpi(r, 'open'), 2); assert.strictEqual(kpi(r, 'rejected'), 1); assert.strictEqual(kpi(r, 'closeRate'), 25);
  assert.strictEqual(tbl(r, 'bySource').rows[0][0], 'Manual'); assert.strictEqual(tbl(r, 'bySource').rows[0][1], 2);
});
t('K3: kategori, risiko, LOTO', () => {
  assert.ok(A(tok.T, 'safety.report', { EquipmentID: E1, SafetyType: 'NearMiss', ReportType: 'Arc', Description: 'x', RiskLevel: 'High' }).ok);
  assert.ok(A(tok.T, 'safety.report', { EquipmentID: E1, SafetyType: 'NearMiss', ReportType: 'Arc', Description: 'y', RiskLevel: 'Low' }).ok);
  ctx.Db.insert('LOTO_RECORDS', { WorkOrderID: 'WO-X', EquipmentID: E1, IsolationPoints: 'a', LockNo: 'L', AppliedBy: 'a', AppliedAt: ctx.Db.now(), VerificationNotes: 'v', Status: 'Active' }, 'x');
  const r = rep('safety', {}); assert.strictEqual(kpi(r, 'total'), 2); assert.strictEqual(kpi(r, 'highCritical'), 1); assert.strictEqual(kpi(r, 'lotoCount'), 1); assert.strictEqual(kpi(r, 'lotoActive'), 1);
  assert.strictEqual(tbl(r, 'byCategory').rows[0][0], 'Arc'); assert.strictEqual(tbl(r, 'byRisk').rows[1][1], 1);
});
t('Inventaris: pemakaian, penerimaan, stok menipis', () => {
  const it = A(tok.M, 'inventory.save', { ItemName: 'Fuse', Unit: 'pcs', MinimumStock: 5, CurrentStock: 10 }).data.ItemCode;
  A(tok.S, 'inventory.transact', { ItemCode: it, TransactionType: 'OUT', Quantity: 7, Remarks: 'x' });
  const r = rep('inventory', {}); assert.strictEqual(kpi(r, 'qtyIn'), 10); assert.strictEqual(kpi(r, 'qtyOut'), 7); assert.strictEqual(kpi(r, 'lowNow'), 1);
  assert.strictEqual(tbl(r, 'usage').rows[0][1], 7); assert.strictEqual(tbl(r, 'lowList').rows[0][1], 3);
});
t('Equipment: status & ketersediaan', () => {
  ctx.Db.update('EQUIPMENT', E1, { EquipmentStatus: 'Breakdown' }, 'x'); ctx.Db.update('EQUIPMENT', E2, { EquipmentStatus: 'Warning', Condition: 'Poor' }, 'x');
  const all = ctx.Db.all('EQUIPMENT'), total = all.length, cnt = f => all.filter(f).length;
  const r = rep('equipment', {}); const bd = cnt(e => e.EquipmentStatus === 'Breakdown');
  assert.strictEqual(kpi(r, 'total'), total); assert.strictEqual(kpi(r, 'breakdown'), bd); assert.strictEqual(kpi(r, 'warning'), cnt(e => e.EquipmentStatus === 'Warning')); assert.strictEqual(kpi(r, 'poor'), cnt(e => e.Condition === 'Poor'));
  assert.ok(bd >= 1); assert.strictEqual(kpi(r, 'availability'), Math.round((total - bd) * 1000 / total) / 10); assert.strictEqual(tbl(r, 'attention').rows.length, cnt(e => e.EquipmentStatus !== 'Normal' || e.Condition === 'Poor'));
});
t('Ringkasan eksekutif menggabungkan KPI semua modul', () => {
  const r = rep('summary', {}); assert.ok(kpi(r, 'inspection.total') >= 1); assert.ok(r.kpis.some(k => k.key === 'cm.mttrHours')); assert.ok(r.kpis.length >= 20);
  assert.strictEqual(tbl(r, 'summaryTable').rows.length, r.kpis.length);
});

t('Semua kunci KPI/tabel/kolom/health punya terjemahan 3 bahasa', () => {
  const keys = {}; require('fs').readFileSync(require('path').join(__dirname, '..', 'scripts', 'i18n-source.txt'), 'utf8').split('\n').forEach(l => { const p = l.split('|'); if (p.length >= 4) keys[p[0]] = p.slice(1, 4).every(Boolean); });
  const need = new Set();
  ctx.Reports.TYPES.forEach(ty => {
    need.add('rep.type.' + ty); const r = rep(ty, {});
    r.kpis.forEach(k => need.add('rep.k.' + k.key.split('.').pop())); r.tables.forEach(tb => { need.add('rep.t.' + tb.key); tb.columns.forEach(c => need.add('rep.c.' + c)); });
  });
  A(adm, 'system.health', {}).data.checks.forEach(c => need.add('health.c.' + c.key)); ['ok', 'warn', 'bad'].forEach(x => need.add('health.' + x));
  const miss = [...need].filter(k => keys[k] !== true); assert.deepStrictEqual(miss, [], 'kunci hilang: ' + miss.join(', '));
});

console.log('\n[3] Backup');
t('Hanya Admin membuat backup; salinan dibuat; riwayat tercatat', () => {
  code(A(tok.M, 'backup.create', {}), 'FORBIDDEN'); assert.ok(A(tok.M, 'backup.list', {}).ok);
  const r = A(adm, 'backup.create', {}); assert.ok(r.ok, JSON.stringify(r)); assert.match(r.data.name, /^EMMS_DB_\d{8}_\d{4}$/);
  assert.strictEqual(A(tok.M, 'backup.list', {}).data.rows.length, 1);
});
t('Retensi: hanya N backup terakhir disimpan; yang lama dibuang', () => {
  assert.ok(A(adm, 'backup.configure', { BACKUP_AUTO: 'FALSE', BACKUP_KEEP: '2' }).ok);
  const ids = [];
  for (let i = 0; i < 3; i++) { ctx.Settings.setSystem_('BACKUP_LIST', JSON.stringify(ctx.Backup.list_().map(b => b))); ids.push(A(adm, 'backup.create', {}).data.id); }
  const l = A(adm, 'backup.list', {}).data; assert.strictEqual(l.rows.length, 2); assert.strictEqual(l.keep, 2);
  assert.ok(!st.files[ids[0]], 'backup lama dihapus dari Drive'); assert.ok(st.files[ids[2]]);
});
t('Validasi konfigurasi backup; gagal salin -> error jelas, riwayat utuh', () => {
  assert.strictEqual(A(adm, 'backup.configure', { BACKUP_AUTO: 'x', BACKUP_KEEP: '0' }).code, 'VALIDATION');
  const n = A(adm, 'backup.list', {}).data.rows.length; st.copyFail = true; const r = A(adm, 'backup.create', {}); st.copyFail = false;
  code(r, 'BACKUP_FAILED'); assert.strictEqual(A(adm, 'backup.list', {}).data.rows.length, n);
});
t('Backup otomatis mingguan lewat job harian (hanya bila aktif dan >= 7 hari)', () => {
  assert.ok(A(adm, 'backup.configure', { BACKUP_AUTO: 'TRUE', BACKUP_KEEP: '8' }).ok);
  let r = A(adm, 'automation.runNow', { force: true }).data; assert.strictEqual(r.backup, undefined, 'backup baru < 7 hari -> lewati');
  const list = ctx.Backup.list_(); list[list.length - 1].at = D(-8) + ' 01:00:00'; ctx.Settings.setSystem_('BACKUP_LIST', JSON.stringify(list));
  r = A(adm, 'automation.runNow', { force: true }).data; assert.match(r.backup, /^EMMS_DB_/);
  st.copyFail = true; const l2 = ctx.Backup.list_(); l2[l2.length - 1].at = D(-9) + ' 01:00:00'; ctx.Settings.setSystem_('BACKUP_LIST', JSON.stringify(l2));
  r = A(adm, 'automation.runNow', { force: true }).data; st.copyFail = false; assert.match(r.backup, /^ERROR/); assert.ok(r.errors.length >= 1);
});

console.log('\n[4] Health check');
t('Health check: skema lengkap, deteksi kolom hilang, hak akses', () => {
  code(A(tok.S, 'system.health', {}), 'FORBIDDEN');
  let h = A(tok.M, 'system.health', {}).data; assert.strictEqual(h.checks.find(c => c.key === 'schema').ok, true); assert.strictEqual(h.version, '1.0.0-phase8');
  const sh = ctx.Db.sheet('APPROVALS'); const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]; const idx = hdr.indexOf('SignatureHash');
  sh.getRange(1, idx + 1, 1, 1).setValues([['SignatureHashX']]); ctx.Db.reset();
  h = A(adm, 'system.health', {}).data; const sc = h.checks.find(c => c.key === 'schema'); assert.strictEqual(sc.ok, false); assert.match(sc.detail, /SignatureHash/); assert.strictEqual(h.status, 'bad');
  sh.getRange(1, idx + 1, 1, 1).setValues([['SignatureHash']]); ctx.Db.reset();
  assert.strictEqual(A(adm, 'system.health', {}).data.checks.find(c => c.key === 'schema').ok, true);
});

console.log('\n[5] Skala data');
t('Laporan pada data besar tetap cepat (mock) dan terpotong aman', () => {
  const rows = []; for (let i = 0; i < 1500; i++) rows.push({ EquipmentID: i % 2 ? E1 : E2, InspectionDate: D(-(i % 25)), InspectionTime: '08:00', TechnicianEmail: 't@gmail.com', TechnicianName: 'T' + (i % 7), OverallResult: i % 10 === 0 ? 'NG' : 'OK', NGCount: 0, CriticalCount: 0, Status: 'Completed' });
  ctx.Db.insertMany('DAILY_INSPECTIONS', rows, 'x');
  const t0 = Date.now(); const r = rep('summary', {}); const r2 = rep('inspection', { from: D(-29), to: ctx.Db.today() }); const ms = Date.now() - t0;
  assert.ok(kpi(r2, 'total') >= 1500); assert.ok(ms < 8000, 'terlalu lambat: ' + ms + ' ms'); assert.ok(tbl(r2, 'perDay').rows.length <= 30);
  console.log('       (' + ms + ' ms untuk 2 laporan pada >1500 inspeksi, di mock)');
});
console.log('\nHasil: ' + pass + ' lulus, ' + fail + ' gagal');
process.exit(fail ? 1 : 0);
