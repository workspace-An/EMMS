/** Uji backend Phase 2 (inspeksi harian & checklist) di Node dengan mock GAS. */
const assert = require('assert');
const { build } = require('./gas-mock');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 4).join('\n       ')); } };

const ctx = build(); ctx.setupEMMS(); ctx.seedDemoData();
const A = (...a) => ctx.api(...a);
const login = (email) => { A('', 'auth.requestOtp', { email }); const m = ctx.__state.mails.filter(x => x.to === email).pop(); return A('', 'auth.verifyOtp', { email, code: m.htmlBody.match(/>(\d{6})</)[1] }).data.token; };
const adm = login('owner@gmail.com');
const tok = {};
[['T', 'Technician'], ['T2', 'Technician'], ['S', 'Supervisor'], ['M', 'Maintenance Manager'], ['V', 'Viewer']].forEach(([k, r]) => {
  assert.ok(A(adm, 'users.save', { FullName: 'User ' + k, Email: k.toLowerCase() + '@gmail.com', Role: r, Department: 'EM' }).ok);
  tok[k] = login(k.toLowerCase() + '@gmail.com');
});
const eqs = ctx.Db.all('EQUIPMENT');
const byName = n => eqs.find(e => e.EquipmentName === n);
const mdp = byName('Main Distribution Panel 1'), sdp = byName('Sub Panel Produksi 1'), mcc = byName('MCC Line 1'), cap = byName('Capacitor Bank 300 kVAr'), trf = byName('Transformer 1600 kVA');
const status = id => ctx.Db.get('EQUIPMENT', id).EquipmentStatus;

/** jawaban semua OK; measure diisi nilai di tengah batas */
function allOk(token, equipmentId, over = {}) {
  const f = A(token, 'inspection.form', { equipmentId });
  assert.ok(f.ok, JSON.stringify(f));
  const items = f.data.items.map(i => {
    const o = { ChecklistID: i.ChecklistID, Result: 'OK', Remarks: '' };
    if (i.ItemType === 'measure') o.MeasurementValue = i.MinValue !== '' && i.MaxValue !== '' ? (i.MinValue + i.MaxValue) / 2 : (i.MaxValue !== '' ? i.MaxValue - 1 : (i.MinValue !== '' ? i.MinValue + 1 : 10));
    return Object.assign(o, over[i.ItemKey] || {});
  });
  return { form: f.data, payload: { EquipmentID: equipmentId, items } };
}
const key = (form, k) => form.items.find(i => i.ItemKey === k).ChecklistID;

console.log('\n[1] Seed & akses');
t('13 kategori punya checklist bawaan; MDP 13 item, nilai batas numerik', () => {
  const cats = ctx.Db.all('EQUIPMENT_CATEGORIES');
  cats.forEach(c => assert.ok(ctx.Checklist.forCategory(c.CategoryID, false).length >= 5, c.Code));
  const m = ctx.Checklist.forCategory(mdp.CategoryID, false);
  assert.strictEqual(m.length, 13);
  const volt = m.find(i => i.ItemKey === 'voltage');
  assert.strictEqual(volt.MinValue, 380); assert.strictEqual(volt.MaxValue, 420); assert.strictEqual(volt.ItemType, 'measure');
  assert.strictEqual(m.find(i => i.ItemKey === 'burnsmell').IsCritical, true);
});
t('seed checklist idempotent (setup ulang tidak menggandakan)', () => {
  const n = ctx.Db.all('INSPECTION_CHECKLISTS').length; ctx.setupEMMS(); assert.strictEqual(ctx.Db.all('INSPECTION_CHECKLISTS').length, n);
});
t('Viewer: boleh lihat riwayat, tidak boleh form/submit/foto/review/checklist', () => {
  assert.ok(A(tok.V, 'inspection.list', {}).ok); assert.ok(A(tok.V, 'inspection.todayStatus', {}).ok);
  ['inspection.form', 'inspection.submit', 'inspection.uploadPhoto', 'inspection.review', 'checklist.list', 'checklist.save', 'checklist.copy', 'checklist.delete']
    .forEach(a => assert.strictEqual(A(tok.V, a, {}).code, 'FORBIDDEN', a));
});
t('Technician & Supervisor tidak boleh kelola checklist; Technician tidak boleh review', () => {
  ['T', 'S'].forEach(k => ['checklist.list', 'checklist.save', 'checklist.delete', 'checklist.copy'].forEach(a => assert.strictEqual(A(tok[k], a, {}).code, 'FORBIDDEN')));
  assert.strictEqual(A(tok.T, 'inspection.review', {}).code, 'FORBIDDEN');
});

console.log('\n[2] Submit inspeksi - semua OK');
let okId;
t('semua OK -> Completed, status equipment tidak berubah, identitas dari sesi', () => {
  const { payload } = allOk(tok.T, sdp.EquipmentID);
  payload.TechnicianName = 'PALSU'; payload.TechnicianEmail = 'palsu@x.com'; payload.OverallResult = 'OK'; payload.Status = 'Reviewed';
  const r = A(tok.T, 'inspection.submit', payload);
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.data.OverallResult, 'OK'); assert.strictEqual(r.data.Status, 'Completed'); assert.strictEqual(r.data.notified.sent, 0);
  okId = r.data.InspectionID;
  const h = ctx.Db.get('DAILY_INSPECTIONS', okId);
  assert.strictEqual(h.TechnicianEmail, 't@gmail.com'); assert.strictEqual(h.TechnicianName, 'User T');
  assert.strictEqual(h.InspectionDate, ctx.Db.today()); assert.ok(/^\d\d:\d\d$/.test(h.InspectionTime));
  assert.strictEqual(status(sdp.EquipmentID), 'Normal');
  assert.strictEqual(ctx.Db.where('INSPECTION_RESULTS', x => x.InspectionID === okId).length, 13);
});
t('papan hari ini menandai equipment terinspeksi', () => {
  const b = A(tok.T, 'inspection.todayStatus', {}).data;
  assert.strictEqual(b.rows.find(r => r.EquipmentID === sdp.EquipmentID).inspectedToday, true);
  assert.strictEqual(b.summary.inspected, 1); assert.strictEqual(b.summary.total, 12);
  assert.strictEqual(A(tok.T, 'inspection.form', { equipmentId: sdp.EquipmentID }).data.todayInspections.length, 1);
});
t('dashboard: inspeksi hari ini 1, belum diinspeksi 11', () => {
  const c = A(tok.V, 'dashboard.summary', {}).data.cards; assert.strictEqual(c.inspectionsToday, 1); assert.strictEqual(c.notInspected, 11);
});

console.log('\n[3] Validasi');
t('jawaban tidak lengkap ditolak per item (field item_<id>)', () => {
  const { payload } = allOk(tok.T, mdp.EquipmentID); payload.items = payload.items.slice(0, 5);
  const r = A(tok.T, 'inspection.submit', payload); assert.strictEqual(r.code, 'VALIDATION');
  assert.strictEqual(r.details.errors.length, 8); assert.ok(r.details.errors.every(e => e.field.startsWith('item_') && e.rule === 'required'));
});
t('NG tanpa keterangan ditolak (ngRemarks); NG tanpa Recommendation ditolak', () => {
  const { form, payload } = allOk(tok.T, mdp.EquipmentID);
  payload.items.find(i => i.ChecklistID === key(form, 'cable')).Result = 'NG';
  let r = A(tok.T, 'inspection.submit', payload); assert.strictEqual(r.code, 'VALIDATION');
  assert.strictEqual(JSON.stringify(r.details.errors.map(e => e.rule)), '["ngRemarks","required"]');
  assert.strictEqual(r.details.errors[1].field, 'Recommendation');
});
t('measure: kosong -> required, huruf -> invalid, NA boleh tanpa nilai, koma desimal diterima', () => {
  const { form, payload } = allOk(tok.T, cap.EquipmentID);
  const pf = payload.items.find(i => i.ChecklistID === key(form, 'pf'));
  pf.MeasurementValue = ''; assert.strictEqual(A(tok.T, 'inspection.submit', payload).details.errors[0].rule, 'required');
  pf.MeasurementValue = 'abc'; assert.strictEqual(A(tok.T, 'inspection.submit', payload).details.errors[0].rule, 'invalid');
  pf.Result = 'NA'; pf.MeasurementValue = ''; const r = A(tok.T, 'inspection.submit', payload); assert.ok(r.ok, JSON.stringify(r));
  const row = ctx.Db.where('INSPECTION_RESULTS', x => x.InspectionID === r.data.InspectionID && x.ItemKey === 'pf')[0];
  assert.strictEqual(row.Result, 'NA'); assert.strictEqual(row.MeasurementValue, '');
  const f2 = allOk(tok.T, cap.EquipmentID); f2.payload.items.find(i => i.ChecklistID === key(f2.form, 'pf')).MeasurementValue = '0,95';
  const r2 = A(tok.T, 'inspection.submit', f2.payload); assert.ok(r2.ok); assert.strictEqual(ctx.Db.where('INSPECTION_RESULTS', x => x.InspectionID === r2.data.InspectionID && x.ItemKey === 'pf')[0].MeasurementValue, 0.95);
});
t('hasil di luar daftar & item asing diabaikan/ditolak; equipment tak ada ditolak', () => {
  const { payload } = allOk(tok.T, mdp.EquipmentID); payload.items[0].Result = 'MAYBE';
  assert.strictEqual(A(tok.T, 'inspection.submit', payload).code, 'VALIDATION');
  assert.strictEqual(A(tok.T, 'inspection.submit', { EquipmentID: 'EQ-9999', items: [] }).code, 'NOT_FOUND');
});

console.log('\n[4] NG, Critical, status otomatis, email');
let ngId, critId;
t('NG non-kritis -> Open, equipment Normal -> Warning, tanpa email', () => {
  const { form, payload } = allOk(tok.T, mcc.EquipmentID);
  Object.assign(payload.items.find(i => i.ChecklistID === key(form, 'cleanliness')), { Result: 'NG', Remarks: 'Debu tebal' });
  payload.Recommendation = 'Bersihkan panel minggu ini';
  const n = ctx.__state.mails.length;
  const r = A(tok.T, 'inspection.submit', payload); assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.data.OverallResult, 'NG'); assert.strictEqual(r.data.Status, 'Open'); assert.strictEqual(r.data.EquipmentStatus, 'Warning');
  assert.strictEqual(status(mcc.EquipmentID), 'Warning'); assert.strictEqual(ctx.__state.mails.length, n);
  ngId = r.data.InspectionID;
  assert.ok(ctx.Db.get('DAILY_INSPECTIONS', ngId).Finding.includes('Kebersihan panel: Debu tebal'));
  assert.ok(ctx.Audit.list({ action: 'EQUIPMENT_STATUS_AUTO', limit: 5 }).length >= 1);
});
t('suhu di luar batas -> otomatis NG & Critical -> Breakdown + email ke Supervisor/Manager/Admin saja', () => {
  const { form, payload } = allOk(tok.T, mdp.EquipmentID);
  const temp = payload.items.find(i => i.ChecklistID === key(form, 'temperature')); temp.MeasurementValue = 75; temp.Result = 'OK'; temp.Remarks = 'Panas di busbar';
  payload.Recommendation = 'Matikan beban, cek terminal';
  const n0 = ctx.__state.mails.length;
  const r = A(tok.T, 'inspection.submit', payload); assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.data.OverallResult, 'Critical'); assert.strictEqual(r.data.CriticalCount, 1); assert.strictEqual(r.data.EquipmentStatus, 'Breakdown');
  assert.strictEqual(r.data.results.find(x => x.ChecklistID === temp.ChecklistID).Result, 'NG', 'dipaksa NG oleh server');
  critId = r.data.InspectionID;
  const sent = ctx.__state.mails.slice(n0).map(m => m.to).sort();
  assert.strictEqual(JSON.stringify(sent), JSON.stringify(['m@gmail.com', 'owner@gmail.com', 's@gmail.com']));
  assert.ok(ctx.__state.mails[n0].subject.includes('CRITICAL')); assert.ok(ctx.__state.mails[n0].htmlBody.includes('75'));
  assert.strictEqual(r.data.notified.sent, 3);
  const nt = ctx.Db.where('NOTIFICATIONS', x => x.RefID === critId); assert.strictEqual(nt.length, 3); assert.ok(nt.every(x => x.DeliveryStatus === 'Sent'));
});
t('kegagalan email tidak menggagalkan inspeksi; dicatat Failed', () => {
  ctx.__state.mailFail = true;
  const { form, payload } = allOk(tok.T, trf.EquipmentID);
  const b = payload.items.find(i => i.ChecklistID === key(form, 'burnsmell')); b.Result = 'NG'; b.Remarks = 'Bau gosong'; payload.Recommendation = 'Padamkan';
  const r = A(tok.T, 'inspection.submit', payload); ctx.__state.mailFail = false;
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.data.OverallResult, 'Critical'); assert.strictEqual(r.data.notified.failed, 3);
  assert.ok(ctx.Db.where('NOTIFICATIONS', x => x.RefID === r.data.InspectionID).every(x => x.DeliveryStatus === 'Failed'));
});
t('status equipment tidak pernah turun otomatis (inspeksi OK setelah Breakdown)', () => {
  const { payload } = allOk(tok.T2, mdp.EquipmentID); assert.ok(A(tok.T2, 'inspection.submit', payload).ok);
  assert.strictEqual(status(mdp.EquipmentID), 'Breakdown');
});
t('HTML pada keterangan di-escape di email', () => {
  const { form, payload } = allOk(tok.T, sdp.EquipmentID);
  const b = payload.items.find(i => i.ChecklistID === key(form, 'burnsmell')); b.Result = 'NG'; b.Remarks = '<script>alert(1)</script>'; payload.Recommendation = 'x';
  const n0 = ctx.__state.mails.length; assert.ok(A(tok.T, 'inspection.submit', payload).ok);
  assert.ok(!ctx.__state.mails[n0].htmlBody.includes('<script>')); assert.ok(ctx.__state.mails[n0].htmlBody.includes('&lt;script&gt;'));
});

console.log('\n[5] Tanggal mundur');
t('Technician tidak boleh mundur; Supervisor boleh 1-7 hari; 8 hari & masa depan ditolak', () => {
  const today = ctx.Db.today(), d3 = ctx.Db.addDays(today, -3), d8 = ctx.Db.addDays(today, -8), fut = ctx.Db.addDays(today, 1);
  const base = allOk(tok.S, cap.EquipmentID);
  const send = (token, d) => A(token, 'inspection.submit', Object.assign({}, base.payload, { InspectionDate: d }));
  assert.strictEqual(send(tok.T, d3).details.errors[0].field, 'InspectionDate');
  const r = send(tok.S, d3); assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(ctx.Db.get('DAILY_INSPECTIONS', r.data.InspectionID).InspectionDate, d3);
  assert.strictEqual(send(tok.S, d8).code, 'VALIDATION'); assert.strictEqual(send(tok.S, fut).code, 'VALIDATION'); assert.strictEqual(send(tok.S, 'abc').code, 'VALIDATION');
});

console.log('\n[6] Riwayat, detail, review');
t('list: default 7 hari terakhir, filter hasil, mine, equipment', () => {
  const all = A(tok.V, 'inspection.list', { from: ctx.Db.addDays(ctx.Db.today(), -10) }).data.rows;
  assert.ok(all.length >= 8);
  assert.ok(A(tok.V, 'inspection.list', { result: 'Critical' }).data.rows.every(r => r.OverallResult === 'Critical'));
  const mine = A(tok.T2, 'inspection.list', { mine: true }).data.rows; assert.ok(mine.length === 1 && mine[0].isMine);
  assert.ok(A(tok.V, 'inspection.list', { equipmentId: mcc.EquipmentID }).data.rows.every(r => r.EquipmentID === mcc.EquipmentID));
  assert.ok(!JSON.stringify(A(tok.V, 'inspection.list', {}).data).includes('@'), 'email teknisi bocor');
});
t('detail memuat item + snapshot tetap walau checklist diubah/dihapus kemudian', () => {
  const before = A(tok.V, 'inspection.get', { id: critId }).data;
  assert.strictEqual(before.items.length, 13); assert.strictEqual(before.items.find(i => i.ItemKey === 'temperature').Result, 'NG');
  const it = ctx.Checklist.forCategory(mdp.CategoryID, false).find(i => i.ItemKey === 'temperature');
  assert.ok(A(adm, 'checklist.save', { categoryId: mdp.CategoryID, data: Object.assign({}, it, { ItemName: 'Suhu busbar', MaxValue: 50 }) }).ok);
  const after = A(tok.V, 'inspection.get', { id: critId }).data;
  assert.strictEqual(after.items.find(i => i.ItemKey === 'temperature').ItemName, 'Temperatur');
  assert.strictEqual(after.items.find(i => i.ItemKey === 'temperature').MaxValue, 60);
  assert.strictEqual(A(adm, 'checklist.delete', { id: it.ChecklistID }).ok, true);
  assert.strictEqual(A(tok.V, 'inspection.get', { id: critId }).data.items.length, 13);
  assert.strictEqual(A(tok.T, 'inspection.form', { equipmentId: mdp.EquipmentID }).data.items.length, 12);
});
t('review: Technician ditolak; Supervisor wajib keterangan; hanya status Open; tidak bisa dua kali', () => {
  assert.strictEqual(A(tok.T, 'inspection.review', { id: ngId, remarks: 'x' }).code, 'FORBIDDEN');
  assert.strictEqual(A(tok.S, 'inspection.review', { id: ngId, remarks: '' }).code, 'VALIDATION');
  assert.strictEqual(A(tok.S, 'inspection.review', { id: okId, remarks: 'ok' }).code, 'CONFLICT');
  assert.ok(A(tok.V, 'inspection.get', { id: ngId }).data.canReview === false);
  assert.ok(A(tok.S, 'inspection.get', { id: ngId }).data.canReview === true);
  const r = A(tok.S, 'inspection.review', { id: ngId, remarks: 'Sudah dijadwalkan pembersihan' }); assert.ok(r.ok, JSON.stringify(r));
  const h = A(tok.V, 'inspection.get', { id: ngId }).data.inspection; assert.strictEqual(h.Status, 'Reviewed'); assert.strictEqual(h.ReviewedBy, 'User S'); assert.ok(h.ReviewedAt);
  assert.strictEqual(A(tok.M, 'inspection.review', { id: ngId, remarks: 'lagi' }).details.rule, 'notOpen');
  assert.strictEqual(A(adm, 'dashboard.summary', {}).data.cards.ngOpen, A(adm, 'inspection.list', { status: 'Open', from: '2000-01-01' }).data.rows.length);
});
t('dashboard: ngOpen & criticalOpen', () => {
  const c = A(adm, 'dashboard.summary', {}).data.cards; assert.ok(c.criticalOpen >= 2); assert.ok(c.ngOpen >= c.criticalOpen);
});

console.log('\n[7] Foto bukti');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]).toString('base64');
t('pemilik & supervisor boleh unggah; teknisi lain & viewer tidak; file palsu ditolak', () => {
  const rid = A(tok.V, 'inspection.get', { id: critId }).data.items.find(i => i.Result === 'NG').ResultID;
  assert.strictEqual(A(tok.T2, 'inspection.uploadPhoto', { resultId: rid, base64: PNG }).code, 'FORBIDDEN');
  assert.strictEqual(A(tok.V, 'inspection.uploadPhoto', { resultId: rid, base64: PNG }).code, 'FORBIDDEN');
  assert.strictEqual(A(tok.T, 'inspection.uploadPhoto', { resultId: rid, base64: Buffer.from('MZ-exe').toString('base64') }).code, 'VALIDATION');
  assert.ok(A(tok.T, 'inspection.uploadPhoto', { resultId: rid, base64: 'data:image/png;base64,' + PNG }).ok);
  assert.ok(A(tok.S, 'inspection.uploadPhoto', { resultId: rid, base64: PNG }).ok);
  assert.ok(A(tok.V, 'inspection.photo', { resultId: rid }).data.dataUrl.startsWith('data:image/png;base64,'));
  assert.strictEqual(A(tok.V, 'inspection.get', { id: critId }).data.items.find(i => i.ResultID === rid).hasPhoto, true);
  assert.strictEqual(ctx.Db.where('ATTACHMENTS', a => a.RefType === 'INSPECTION_RESULT' && a.RefID === rid).length, 2);
  assert.strictEqual(Object.keys(ctx.__state.files).length, 1, 'foto lama harus dibuang dari Drive');
});

console.log('\n[8] Manajemen checklist');
t('validasi item: tipe, rentang, duplikat, nomor', () => {
  const c = mdp.CategoryID, save = d => A(tok.M, 'checklist.save', { categoryId: c, data: d });
  assert.strictEqual(save({ ItemName: '', ItemType: 'check' }).code, 'VALIDATION');
  assert.strictEqual(save({ ItemName: 'X', ItemType: 'foo' }).code, 'VALIDATION');
  assert.strictEqual(save({ ItemName: 'X', ItemType: 'measure', MinValue: 10, MaxValue: 5 }).details.errors[0].rule, 'range');
  assert.strictEqual(save({ ItemName: 'X', ItemType: 'measure', MinValue: 'abc' }).code, 'VALIDATION');
  assert.strictEqual(save({ ItemName: 'Kondisi visual', ItemType: 'check' }).code, 'CONFLICT');
  assert.strictEqual(save({ ItemName: 'Y', ItemType: 'check', ItemNo: '0' }).code, 'VALIDATION');
});
t('buat, ubah (pertahankan ItemKey hanya bila nama sama), nonaktifkan, hapus', () => {
  const c = mdp.CategoryID;
  const n = A(tok.M, 'checklist.save', { categoryId: c, data: { ItemName: 'Kelembapan ruang', ItemType: 'measure', Unit: '%', MaxValue: '80', IsCritical: 'FALSE' } }); assert.ok(n.ok, JSON.stringify(n));
  assert.strictEqual(n.data.ItemNo, 14, 'nomor otomatis = nomor tertinggi + 1');
  const u = A(tok.M, 'checklist.save', { categoryId: c, data: Object.assign({}, n.data, { Status: 'Inactive' }) }); assert.ok(u.ok); assert.strictEqual(u.data.Status, 'Inactive');
  assert.ok(!A(tok.T, 'inspection.form', { equipmentId: mdp.EquipmentID }).data.items.some(i => i.ItemName === 'Kelembapan ruang'));
  const vis = ctx.Checklist.forCategory(c, true).find(i => i.ItemKey === 'visual');
  const renamed = A(tok.M, 'checklist.save', { categoryId: c, data: Object.assign({}, vis, { ItemName: 'Visual panel depan' }) }); assert.strictEqual(renamed.data.ItemKey, '');
  const same = A(tok.M, 'checklist.save', { categoryId: c, data: Object.assign({}, ctx.Checklist.forCategory(c, true).find(i => i.ItemKey === 'noise'), { IsCritical: 'TRUE' }) }); assert.strictEqual(same.data.ItemKey, 'noise'); assert.strictEqual(same.data.IsCritical, true);
  assert.ok(A(tok.M, 'checklist.delete', { id: n.data.ChecklistID }).ok);
  assert.ok(!A(tok.M, 'checklist.list', { categoryId: c }).data.some(i => i.ChecklistID === n.data.ChecklistID));
});
t('salin checklist: ke kategori kosong OK, ke yang berisi ditolak; kategori tanpa item -> noChecklist saat submit', () => {
  const newCat = A(adm, 'master.save', { entity: 'category', data: { CategoryName: 'Kategori Uji', Code: 'ZZ' } }).data;
  const e = A(adm, 'equipment.create', { EquipmentName: 'Equip Uji', CategoryID: newCat.CategoryID, BuildingID: mdp.BuildingID, LocationID: mdp.LocationID }).data;
  assert.strictEqual(A(tok.T, 'inspection.submit', { EquipmentID: e.EquipmentID, items: [] }).details.rule, 'noChecklist');
  assert.strictEqual(A(tok.M, 'checklist.copy', { fromCategoryId: mdp.CategoryID, toCategoryId: mdp.CategoryID }).code, 'VALIDATION');
  assert.strictEqual(A(tok.M, 'checklist.copy', { fromCategoryId: sdp.CategoryID, toCategoryId: mdp.CategoryID }).details.rule, 'notEmpty');
  const r = A(tok.M, 'checklist.copy', { fromCategoryId: sdp.CategoryID, toCategoryId: newCat.CategoryID }); assert.ok(r.ok); assert.strictEqual(r.data.copied, 13);
  assert.ok(A(tok.T, 'inspection.form', { equipmentId: e.EquipmentID }).data.items.length === 13);
  assert.strictEqual(A(tok.M, 'checklist.list', { categoryId: 'CAT-9999' }).code, 'NOT_FOUND');
});

console.log('\n[9] Pengaman migrasi & histori equipment');
t('sheet lama tanpa kolom baru: submit ditolak NOT_SETUP (bukan hilang diam-diam); setup ulang memperbaiki', () => {
  const sh = ctx.Db.sheet('DAILY_INSPECTIONS'); const hdr = sh.data[0]; const idx = hdr.indexOf('CriticalCount'); const saved = hdr[idx]; hdr[idx] = ''; ctx.Db.reset();
  const { payload } = allOk(tok.T, cap.EquipmentID);
  assert.strictEqual(A(tok.T, 'inspection.submit', payload).code, 'NOT_SETUP');
  ctx.setupEMMS(); ctx.Db.reset();
  assert.ok(ctx.Db.headers('DAILY_INSPECTIONS').includes('CriticalCount'));
  assert.ok(A(tok.T, 'inspection.submit', allOk(tok.T, cap.EquipmentID).payload).ok);
});
t('detail equipment menampilkan riwayat inspeksi', () => {
  const g = A(tok.V, 'equipment.get', { id: mdp.EquipmentID }).data; assert.ok(g.history.inspections.length >= 2);
  assert.ok(g.history.inspections.every(h => h.OverallResult && h.Status));
});
t('audit mencatat submit, review, foto, checklist', () => {
  ['INSPECTION_SUBMIT', 'INSPECTION_REVIEW', 'INSPECTION_PHOTO', 'CHECKLIST_CREATE', 'CHECKLIST_UPDATE', 'CHECKLIST_DELETE', 'CHECKLIST_COPY'].forEach(a => assert.ok(ctx.Audit.list({ action: a, limit: 1 }).length, a));
});

console.log(`\nPhase 2 backend: ${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
