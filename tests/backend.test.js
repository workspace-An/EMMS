/** Uji backend EMMS Phase 1 di Node memakai mock GAS. Jalankan: node tests/backend.test.js */
const assert = require('assert');
const { build } = require('./gas-mock');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); }
};
const lastCode = (ctx, email) => {
  const m = ctx.__state.mails.filter(x => x.to === email).pop();
  return m && m.htmlBody.match(/>(\d{6})</)[1];
};

console.log('\n[1] Setup & self-test bawaan (runSelfTest)');
let ctx = build();
ctx.setupEMMS();
ctx.seedDemoData();
const st = ctx.runSelfTest();
st.forEach(r => console.log('  ' + r));
t('semua self-test lulus', () => assert.ok(st.every(r => r.startsWith('PASS')), st.filter(r => !r.startsWith('PASS')).join(' | ')));

console.log('\n[2] Setup idempotent');
t('setup kedua tidak menggandakan data', () => {
  const nCat = ctx.Db.all('EQUIPMENT_CATEGORIES').length, nUsr = ctx.Db.all('USERS').filter(u => u.Email === 'owner@gmail.com').length;
  ctx.setupEMMS();
  assert.strictEqual(ctx.Db.all('EQUIPMENT_CATEGORIES').length, nCat);
  assert.strictEqual(ctx.Db.all('USERS').filter(u => u.Email === 'owner@gmail.com').length, nUsr);
  assert.strictEqual(nCat, 13);
  assert.strictEqual(nUsr, 1);
});
t('26 sheet terbuat, Sheet1 bawaan terhapus, SESSIONS tersembunyi', () => {
  const ss = ctx.Db.ss();
  assert.strictEqual(ss.getSheets().length, 26);
  assert.ok(!ss.getSheetByName('Sheet1'));
  assert.ok(ss.getSheetByName('SESSIONS').hidden);
});

console.log('\n[3] Alur login Email OTP');
ctx = build();
ctx.setupEMMS(); ctx.seedDemoData();
const A = (...a) => ctx.api(...a);
// tambah user
const owner = ctx.Auth.findUser('owner@gmail.com');
t('admin awal = pemilik script', () => assert.strictEqual(owner.Role, 'Admin'));
let tok;
t('email tidak terdaftar: respons generik, tidak ada email terkirim', () => {
  const n = ctx.__state.mails.length;
  const r = A('', 'auth.requestOtp', { email: 'orang@asing.com' });
  assert.ok(r.ok && r.data.sent);
  assert.strictEqual(ctx.__state.mails.length, n);
});
t('email tidak valid ditolak', () => assert.strictEqual(A('', 'auth.requestOtp', { email: 'abc' }).code, 'VALIDATION'));
t('OTP terkirim ke email terdaftar (case-insensitive)', () => {
  const r = A('', 'auth.requestOtp', { email: '  OWNER@gmail.com ' });
  assert.ok(r.ok);
  assert.ok(lastCode(ctx, 'owner@gmail.com'));
});
t('kode salah ditolak, kode benar menerbitkan token', () => {
  assert.strictEqual(A('', 'auth.verifyOtp', { email: 'owner@gmail.com', code: '000000' }).code, 'OTP_INVALID');
  const code = lastCode(ctx, 'owner@gmail.com');
  const r = A('', 'auth.verifyOtp', { email: 'owner@gmail.com', code });
  assert.ok(r.ok, JSON.stringify(r));
  tok = r.data.token;
  assert.strictEqual(tok.length, 64);
  assert.strictEqual(r.data.user.role, 'Admin');
});
t('kode hanya sekali pakai', () => {
  const code = lastCode(ctx, 'owner@gmail.com');
  assert.strictEqual(A('', 'auth.verifyOtp', { email: 'owner@gmail.com', code }).code, 'OTP_INVALID');
});
t('token tersimpan hanya sebagai hash di SESSIONS', () => {
  const rows = ctx.Db.all('SESSIONS');
  assert.ok(rows.length >= 1);
  assert.ok(!JSON.stringify(rows).includes(tok));
});
t('5x salah -> kode hangus meski akhirnya benar', () => {
  A('', 'auth.requestOtp', { email: 'owner@gmail.com' });
  const code = lastCode(ctx, 'owner@gmail.com');
  for (let i = 0; i < 5; i++) A('', 'auth.verifyOtp', { email: 'owner@gmail.com', code: code === '111111' ? '222222' : '111111' });
  assert.strictEqual(A('', 'auth.verifyOtp', { email: 'owner@gmail.com', code }).code, 'OTP_INVALID');
});
t('rate limit permintaan OTP (maks 5/jam/email)', () => {
  let last;
  for (let i = 0; i < 6; i++) last = A('', 'auth.requestOtp', { email: 'owner@gmail.com' });
  assert.strictEqual(last.code, 'RATE_LIMIT');
});
t('kegagalan kirim email -> MAIL, bukan crash', () => {
  const c2 = build(); c2.setupEMMS(); c2.__state.mailFail = true;
  assert.strictEqual(c2.api('', 'auth.requestOtp', { email: 'owner@gmail.com' }).code, 'MAIL');
});
t('bootstrap dengan token sah mengembalikan user, perms, master', () => {
  const r = A(tok, 'app.bootstrap', {});
  assert.ok(r.ok);
  assert.ok(r.data.perms.includes('users.manage'));
  assert.ok(r.data.master.categories.length === 13);
  assert.ok(!JSON.stringify(r.data.master).includes('owner@gmail.com'), 'email bocor di master');
});
t('logout mencabut token', () => {
  A(tok, 'auth.logout', {});
  assert.strictEqual(A(tok, 'app.bootstrap', {}).code, 'AUTH');
});

console.log('\n[4] Auto-login Google (bila email aktif tersedia)');
t('getActiveUser kosong -> auto:false', () => assert.deepStrictEqual(JSON.parse(JSON.stringify(A('', 'auth.auto', {}).data)), { auto: false }));
t('getActiveUser terisi & terdaftar -> token', () => {
  const c = build({ activeUser: 'owner@gmail.com' }); c.setupEMMS();
  const r = c.api('', 'auth.auto', {});
  assert.ok(r.ok && r.data.auto && r.data.token);
});
t('getActiveUser terisi tapi tidak terdaftar -> ditolak', () => {
  const c = build(); c.setupEMMS(); c.__state.activeUser = 'x@gmail.com';
  assert.strictEqual(c.api('', 'auth.auto', {}).data.auto, false);
});
t('auto-login dapat dimatikan lewat setting', () => {
  const c = build({ activeUser: 'owner@gmail.com' }); c.setupEMMS();
  c.Db.update('SETTINGS', 'ALLOW_GOOGLE_AUTOLOGIN', { SettingValue: 'FALSE' }, 'x');
  assert.strictEqual(c.api('', 'auth.auto', {}).data.auto, false);
});

console.log('\n[5] RBAC untuk setiap role (backend)');
function login(c, email) {
  c.api('', 'auth.requestOtp', { email });
  return c.api('', 'auth.verifyOtp', { email, code: lastCode(c, email) }).data.token;
}
ctx = build(); ctx.setupEMMS(); ctx.seedDemoData();
const adm = login(ctx, 'owner@gmail.com');
const roles = ['Maintenance Manager', 'Supervisor', 'Technician', 'Viewer'];
const tokens = {};
roles.forEach((r, i) => {
  const email = 'u' + i + '@gmail.com';
  const res = A(adm, 'users.save', { FullName: 'User ' + r, Email: email, Role: r, Department: 'EM' });
  assert.ok(res.ok, JSON.stringify(res));
  tokens[r] = login(ctx, email);
});
const eq1 = ctx.Db.all('EQUIPMENT')[0];
const matrix = {
  'equipment.list': { 'Maintenance Manager': 1, Supervisor: 1, Technician: 1, Viewer: 1 },
  'equipment.create': { 'Maintenance Manager': 1, Supervisor: 1, Technician: 0, Viewer: 0 },
  'equipment.delete': { 'Maintenance Manager': 1, Supervisor: 0, Technician: 0, Viewer: 0 },
  'users.list': { 'Maintenance Manager': 1, Supervisor: 0, Technician: 0, Viewer: 0 },
  'users.save': { 'Maintenance Manager': 0, Supervisor: 0, Technician: 0, Viewer: 0 },
  'settings.update': { 'Maintenance Manager': 0, Supervisor: 0, Technician: 0, Viewer: 0 },
  'settings.get': { 'Maintenance Manager': 1, Supervisor: 0, Technician: 0, Viewer: 0 },
  'audit.list': { 'Maintenance Manager': 1, Supervisor: 0, Technician: 0, Viewer: 0 },
  'master.save': { 'Maintenance Manager': 1, Supervisor: 0, Technician: 0, Viewer: 0 },
  'dashboard.summary': { 'Maintenance Manager': 1, Supervisor: 1, Technician: 1, Viewer: 1 },
  'equipment.restore': { 'Maintenance Manager': 0, Supervisor: 0, Technician: 0, Viewer: 0 },
  'settings.diagnose': { 'Maintenance Manager': 0, Supervisor: 0, Technician: 0, Viewer: 0 }
};
Object.keys(matrix).forEach(action => roles.forEach(role => {
  t(`${action} sebagai ${role}: ${matrix[action][role] ? 'boleh' : 'FORBIDDEN'}`, () => {
    const r = A(tokens[role], action, { id: eq1.EquipmentID, entity: 'factory', data: {}, confirmId: 'x', reason: 'x' });
    if (matrix[action][role]) assert.notStrictEqual(r.code, 'FORBIDDEN', action);
    else assert.strictEqual(r.code, 'FORBIDDEN');
  });
}));
t('Technician tidak melihat CreatedBy/UpdatedBy (email) di equipment', () => {
  const r = A(tokens.Technician, 'equipment.list', {});
  assert.ok(!JSON.stringify(r.data).includes('@'));
  const r2 = A(tokens.Technician, 'equipment.get', { id: eq1.EquipmentID });
  assert.ok(!JSON.stringify(r2.data).includes('@'));
  assert.strictEqual(JSON.stringify(r2.data.audit), "[]");
});
t('Dashboard: activity hanya untuk yang berhak audit', () => {
  assert.strictEqual(A(tokens.Technician, 'dashboard.summary', {}).data.activity, null);
  assert.ok(Array.isArray(A(tokens['Maintenance Manager'], 'dashboard.summary', {}).data.activity));
});
t('ACCESS_DENIED tercatat di audit', () => {
  assert.ok(ctx.Audit.list({ action: 'ACCESS_DENIED', limit: 5 }).length > 0);
});
t('user dinonaktifkan -> token langsung tidak berlaku', () => {
  const u = ctx.Db.all('USERS').find(x => x.Email === 'u3@gmail.com');
  const r = A(adm, 'users.save', { UserID: u.UserID, FullName: u.FullName, Email: u.Email, Role: u.Role, Department: u.Department, Status: 'Inactive', UpdatedAt: u.UpdatedAt });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(A(tokens.Viewer, 'equipment.list', {}).code, 'AUTH');
});
t('admin tidak bisa menurunkan/menonaktifkan dirinya sendiri', () => {
  const me = ctx.Db.all('USERS').find(x => x.Email === 'owner@gmail.com');
  const r = A(adm, 'users.save', { UserID: me.UserID, FullName: me.FullName, Email: me.Email, Role: 'Viewer', Department: '', Status: 'Active', UpdatedAt: me.UpdatedAt });
  assert.strictEqual(r.code, 'CONFLICT');
});
t('email user duplikat ditolak', () => {
  assert.strictEqual(A(adm, 'users.save', { FullName: 'Dup', Email: 'U0@gmail.com', Role: 'Viewer' }).code, 'CONFLICT');
});

console.log('\n[6] Equipment, master, foto, QR');
t('mass-assignment: field sistem dari klien diabaikan', () => {
  const e = ctx.Db.all('EQUIPMENT')[0];
  const r = A(adm, 'equipment.create', {
    EquipmentName: 'MA test', CategoryID: e.CategoryID, BuildingID: e.BuildingID, LocationID: e.LocationID,
    EquipmentID: 'EQ-HACK', CreatedBy: 'hacker', Status: 'Deleted', PhotoFileID: 'abc'
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.notStrictEqual(r.data.EquipmentID, 'EQ-HACK');
  const raw = ctx.Db.get('EQUIPMENT', r.data.EquipmentID);
  assert.strictEqual(raw.CreatedBy, 'owner@gmail.com');
  assert.strictEqual(raw.Status, 'Active');
  assert.strictEqual(raw.PhotoFileID, '');
});
t('ID tidak dipakai ulang setelah soft delete', () => {
  const e = ctx.Db.all('EQUIPMENT')[0];
  const mk = () => A(adm, 'equipment.create', { EquipmentName: 'ID test', CategoryID: e.CategoryID, BuildingID: e.BuildingID, LocationID: e.LocationID }).data.EquipmentID;
  const a = mk();
  A(adm, 'equipment.delete', { id: a, reason: 'uji', confirmId: a });
  const b = mk();
  assert.notStrictEqual(a, b);
  assert.ok(Number(b.split('-')[1]) > Number(a.split('-')[1]));
});
t('soft delete: hilang dari list, Admin bisa restore', () => {
  const e = ctx.Db.all('EQUIPMENT')[0];
  const a = A(adm, 'equipment.create', { EquipmentName: 'DelRestore', CategoryID: e.CategoryID, BuildingID: e.BuildingID, LocationID: e.LocationID }).data.EquipmentID;
  assert.ok(A(adm, 'equipment.delete', { id: a, reason: 'uji', confirmId: a }).ok);
  assert.ok(!A(adm, 'equipment.list', {}).data.some(x => x.EquipmentID === a));
  assert.ok(A(adm, 'equipment.restore', { id: a }).ok);
  assert.ok(A(adm, 'equipment.list', {}).data.some(x => x.EquipmentID === a));
});
t('hapus ditolak bila ada Work Order terbuka', () => {
  const e = ctx.Db.all('EQUIPMENT')[0];
  ctx.Db.insert('WORK_ORDERS', { EquipmentID: e.EquipmentID, Title: 't', Status: 'Open' }, 'x');
  assert.strictEqual(A(adm, 'equipment.delete', { id: e.EquipmentID, reason: 'uji', confirmId: e.EquipmentID }).code, 'CONFLICT');
});
t('filter & pencarian equipment', () => {
  assert.ok(A(adm, 'equipment.list', { search: 'schneider' }).data.length >= 2);
  assert.strictEqual(A(adm, 'equipment.list', { equipmentStatus: 'Breakdown' }).data.length, 1);
  assert.strictEqual(A(adm, 'equipment.list', { search: '000789zzzz' }).data.length, 0);
});
t('QR: payload memuat URL /exec + ?eq=, regenerasi menaikkan versi', () => {
  const e = ctx.Db.all('EQUIPMENT')[0];
  const g = A(adm, 'equipment.get', { id: e.EquipmentID }).data;
  assert.ok(g.qr.QRPayload.startsWith('https://script.google.com/macros/s/AKfycbTEST123/exec?eq=EQ-'));
  const r = A(adm, 'equipment.regenerateQr', { id: e.EquipmentID });
  assert.strictEqual(r.data.Version, 2);
  assert.strictEqual(A(adm, 'equipment.get', { id: e.EquipmentID }).data.qr.Version, 2);
});
t('master: hapus gedung yang dipakai ditolak; lokasi mismatch ditolak', () => {
  const e = ctx.Db.all('EQUIPMENT')[0];
  assert.strictEqual(A(adm, 'master.delete', { entity: 'building', id: e.BuildingID }).code, 'CONFLICT');
  const f = A(adm, 'master.save', { entity: 'factory', data: { FactoryName: 'Pabrik 2' } });
  assert.ok(f.ok);
  const b = A(adm, 'master.save', { entity: 'building', data: { FactoryID: f.data.FactoryID, BuildingName: 'Gedung Baru' } });
  assert.ok(b.ok);
  assert.ok(A(adm, 'master.delete', { entity: 'building', id: b.data.BuildingID }).ok);
  assert.strictEqual(A(adm, 'master.save', { entity: 'category', data: { CategoryName: 'x', Code: 'bad code!' } }).code, 'VALIDATION');
});
t('foto: PNG valid diterima & dibaca balik; file bukan gambar ditolak', () => {
  const e = ctx.Db.all('EQUIPMENT')[0];
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50, 1)]).toString('base64');
  assert.ok(A(adm, 'equipment.uploadPhoto', { id: e.EquipmentID, base64: 'data:image/png;base64,' + png }).ok);
  const p = A(adm, 'equipment.photo', { id: e.EquipmentID }).data.dataUrl;
  assert.ok(p.startsWith('data:image/png;base64,'));
  assert.strictEqual(A(adm, 'equipment.uploadPhoto', { id: e.EquipmentID, base64: Buffer.from('<?php evil ?>').toString('base64') }).code, 'VALIDATION');
  assert.strictEqual(A(adm, 'equipment.uploadPhoto', { id: e.EquipmentID, base64: '!!!notbase64' }).code, 'VALIDATION');
  assert.strictEqual(A(tokens.Viewer, 'equipment.uploadPhoto', { id: e.EquipmentID, base64: png }).code, 'AUTH'); // viewer u3 sudah nonaktif
});
t('pengaturan: validasi URL & bahasa; hanya whitelist yang berubah', () => {
  assert.strictEqual(A(adm, 'settings.update', { WEBAPP_URL: 'http://evil.com' }).code, 'VALIDATION');
  assert.strictEqual(A(adm, 'settings.update', { DEFAULT_LANGUAGE: 'fr' }).code, 'VALIDATION');
  assert.ok(A(adm, 'settings.update', { COMPANY_NAME: 'PT Uji', SCHEMA_VERSION: '99' }).ok);
  assert.strictEqual(ctx.Settings.get('COMPANY_NAME'), 'PT Uji');
  assert.strictEqual(ctx.Settings.get('SCHEMA_VERSION'), '1');
});
t('injeksi formula tersimpan sebagai teks (tidak dieksekusi)', () => {
  const e = ctx.Db.all('EQUIPMENT')[0];
  const r = A(adm, 'equipment.create', { EquipmentName: '=HYPERLINK("http://x","y")', CategoryID: e.CategoryID, BuildingID: e.BuildingID, LocationID: e.LocationID });
  assert.ok(r.ok);
  assert.strictEqual(ctx.Db.get('EQUIPMENT', r.data.EquipmentID).EquipmentName, '=HYPERLINK("http://x","y")');
});
t('error internal tidak membocorkan stack ke klien', () => {
  const r = ctx.api(adm, 'equipment.get', null);
  assert.ok(!r.ok);
  assert.ok(!JSON.stringify(r).includes('at '));
});
t('doGet tidak crash (setup selesai & belum setup)', () => {
  assert.ok(ctx.doGet({ parameter: { eq: 'EQ-0001' } }));
  assert.ok(build().doGet({ parameter: {} }));
});

console.log(`\nHasil: ${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
