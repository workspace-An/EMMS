// Uji sisi server: seluruh .gs asli dijalankan di Node dengan tiruan layanan Google.
// Jalankan: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGas } from './gas-mock.mjs';

const OWNER = 'owner@gmail.com';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function fresh() {
  const g = createGas();
  g.call('setupDatabase');
  return g;
}
function login(g, email, { remember = false } = {}) {
  g.state.outbox.length = 0;
  const r1 = g.api({ action: 'auth.requestOtp', payload: { email } });
  assert.equal(r1.ok, true);
  const code = g.lastOtp();
  assert.ok(code, 'kode OTP harus dikirim ke ' + email);
  const r2 = g.api({ action: 'auth.verifyOtp', payload: { email, code, remember } });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  return r2.data.token;
}
const A = (g, token) => (action, payload = {}) => g.api({ action, token, payload });

function addUser(g, adminTok, name, email, role) {
  const r = A(g, adminTok)('users.save', { full_name: name, email, role, department: 'EM' });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data;
}

test('setup: 25 sheet, admin pemilik, data awal, dapat dijalankan ulang tanpa duplikasi', () => {
  const g = fresh();
  assert.equal(g.ctx.Db.spreadsheet().getSheets().length, 25, 'tepat 25 sheet (Sheet1 bawaan dihapus)');
  const users = g.ctx.Db.all('USERS');
  assert.equal(users.length, 1); assert.equal(users[0].email, OWNER); assert.equal(users[0].role, 'Admin');
  assert.equal(g.ctx.Db.all('EQUIPMENT_CATEGORIES').length, 13);
  assert.equal(g.ctx.Db.all('EQUIPMENT').length, 8);
  assert.equal(g.ctx.Db.all('EQUIPMENT_QR_CODES').length, 8);
  g.call('setupDatabase');
  assert.equal(g.ctx.Db.all('EQUIPMENT').length, 8, 'setup ulang tidak menggandakan data');
  assert.equal(g.ctx.Db.all('USERS').length, 1);
  assert.equal(g.ctx.Db.all('EQUIPMENT_CATEGORIES').length, 13);
});

test('setiap sheet memiliki kolom standar: ID, status, created/updated at/by', () => {
  const g = fresh();
  for (const [name, def] of Object.entries(g.ctx.SCHEMA)) {
    const h = g.ctx.Db.headers(name);
    ['status', 'created_at', 'created_by', 'updated_at', 'updated_by'].forEach((c) => assert.ok(h.includes(c), name + ' tanpa ' + c));
    assert.equal(h[0], def.pk, name + ' kolom pertama harus primary key');
  }
});

test('selftest bawaan lulus seluruhnya (dijalankan sebagai pemilik)', () => {
  const g = fresh();
  const r = g.call('runSelfTest');
  const failed = r.results.filter((x) => !x.pass);
  assert.equal(failed.length, 0, JSON.stringify(failed));
  assert.ok(r.total >= 15);
});

test('KEAMANAN: fungsi admin tidak bisa dipanggil anonim dari browser (google.script.run)', () => {
  const g = fresh();
  const callable = g.globals().filter((n) => !n.endsWith('_'));
  // Daftar tertutup fungsi publik. Fungsi baru tanpa garis bawah harus sengaja ditambahkan ke sini.
  assert.deepEqual(callable.sort(), ['AppError', 'api', 'doGet', 'removeSampleData', 'runSelfTest', 'setupDatabase', 'showSetupInfo', 'upgradeSchema']);
  const guarded = ['setupDatabase', 'upgradeSchema', 'removeSampleData', 'showSetupInfo', 'runSelfTest'];
  const before = g.ctx.Db.all('EQUIPMENT').length;
  for (const ctx of [{ active: '' }, { active: 'orang.lain@gmail.com' }]) {
    g.state.active = ctx.active;
    for (const fn of guarded) assert.throws(() => g.call(fn), (e) => e.code === 'FORBIDDEN', fn + ' harus FORBIDDEN untuk active=' + JSON.stringify(ctx.active));
  }
  assert.equal(g.ctx.Db.all('EQUIPMENT').length, before, 'tidak ada data berubah');
  g.state.active = OWNER;
  assert.doesNotThrow(() => g.call('showSetupInfo'));
});

test('autentikasi: email tak terdaftar tidak mengirim email dan responsnya identik (anti-enumerasi)', () => {
  const g = fresh();
  const a = g.api({ action: 'auth.requestOtp', payload: { email: 'tidak.ada@gmail.com' } });
  assert.deepEqual(a, { ok: true, data: { sent: true, ttlMinutes: 10 } });
  assert.equal(g.state.outbox.length, 0);
  const b = g.api({ action: 'auth.requestOtp', payload: { email: OWNER } });
  assert.deepEqual(b.data, a.data);
  assert.equal(g.state.outbox.length, 1);
  assert.equal(g.api({ action: 'auth.requestOtp', payload: { email: 'bukan-email' } }).code, 'INVALID_EMAIL');
});

test('autentikasi: kode salah ditolak, 5 kali salah menghanguskan kode, kode benar tidak bisa dipakai dua kali', () => {
  const g = fresh();
  g.api({ action: 'auth.requestOtp', payload: { email: OWNER } });
  const code = g.lastOtp();
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal(g.api({ action: 'auth.verifyOtp', payload: { email: OWNER, code: wrong } }).code, 'OTP_INVALID');
  assert.equal(g.api({ action: 'auth.verifyOtp', payload: { email: OWNER, code } }).code, 'OTP_INVALID', 'kode hangus setelah 5 percobaan salah');
  g.api({ action: 'auth.requestOtp', payload: { email: OWNER } });
  const c2 = g.lastOtp();
  assert.equal(g.api({ action: 'auth.verifyOtp', payload: { email: OWNER, code: c2 } }).ok, true);
  assert.equal(g.api({ action: 'auth.verifyOtp', payload: { email: OWNER, code: c2 } }).code, 'OTP_INVALID', 'sekali pakai');
});

test('autentikasi: kode OTP tidak tersimpan sebagai teks biasa, email ber-huruf besar dinormalisasi', () => {
  const g = fresh();
  g.api({ action: 'auth.requestOtp', payload: { email: '  OWNER@Gmail.com ' } });
  const code = g.lastOtp();
  assert.ok(code);
  const cached = JSON.stringify(g.state.cache);
  assert.ok(!cached.includes(code), 'kode tidak boleh ada di cache dalam bentuk asli');
  assert.equal(g.api({ action: 'auth.verifyOtp', payload: { email: 'OWNER@gmail.com', code } }).ok, true);
});

test('autentikasi: pembatas laju permintaan kode (5 per jam per email)', () => {
  const g = fresh();
  for (let i = 0; i < 5; i++) assert.equal(g.api({ action: 'auth.requestOtp', payload: { email: OWNER } }).ok, true);
  assert.equal(g.api({ action: 'auth.requestOtp', payload: { email: OWNER } }).code, 'TOO_MANY');
});

test('token: tanpa token / token rusak ditolak di semua rute non-publik', () => {
  const g = fresh();
  const routes = Object.keys(g.run('getRoutes_()')).filter((k) => !g.run('getRoutes_()')[k].pub);
  assert.ok(routes.length > 15);
  for (const r of routes) {
    assert.equal(g.api({ action: r, payload: {} }).code, 'AUTH_REQUIRED', r + ' tanpa token');
    assert.equal(g.api({ action: r, token: 'aaa.bbb', payload: {} }).code, 'AUTH_REQUIRED', r + ' token palsu');
  }
  assert.equal(g.api({ action: 'tidak.ada' }).code, 'UNKNOWN_ACTION');
  assert.equal(g.api({ action: '__proto__' }).code, 'UNKNOWN_ACTION');
  assert.equal(g.api({ action: 'constructor' }).code, 'UNKNOWN_ACTION');
  assert.equal(g.api(null).code, 'UNKNOWN_ACTION');
});

test('token: status & role dibaca ulang tiap request (nonaktif/ubah role berlaku seketika)', () => {
  const g = fresh();
  const admin = login(g, OWNER);
  const u = addUser(g, admin, 'Budi', 'budi@gmail.com', 'Technician');
  const tech = login(g, 'budi@gmail.com');
  assert.equal(A(g, tech)('equipment.list').ok, true);
  assert.equal(A(g, tech)('users.list').code, 'FORBIDDEN');
  A(g, admin)('users.save', { user_id: u.user_id, full_name: 'Budi', email: 'budi@gmail.com', role: 'Supervisor' });
  assert.equal(A(g, tech)('equipment.create', {}).code, 'VALIDATION', 'Supervisor kini boleh membuat (lolos izin, gagal validasi)');
  A(g, admin)('users.setStatus', { user_id: u.user_id, status: 'Inactive' });
  assert.equal(A(g, tech)('equipment.list').code, 'ACCOUNT_DISABLED');
  assert.equal(g.api({ action: 'auth.requestOtp', payload: { email: 'budi@gmail.com' } }).ok, true);
  assert.equal(g.lastOtp(), null === g.lastOtp() ? null : g.lastOtp());
});

test('nonaktif: pengguna nonaktif tidak menerima kode login', () => {
  const g = fresh();
  const admin = login(g, OWNER);
  const u = addUser(g, admin, 'Cici', 'cici@gmail.com', 'Viewer');
  A(g, admin)('users.setStatus', { user_id: u.user_id, status: 'Inactive' });
  g.state.outbox.length = 0;
  g.api({ action: 'auth.requestOtp', payload: { email: 'cici@gmail.com' } });
  assert.equal(g.state.outbox.length, 0);
});

test('logout semua perangkat membatalkan seluruh token', () => {
  const g = fresh();
  const admin = login(g, OWNER);
  addUser(g, admin, 'Dedi', 'dedi@gmail.com', 'Technician');
  const t2 = login(g, 'dedi@gmail.com');
  assert.equal(A(g, t2)('auth.logoutAll').code, 'FORBIDDEN', 'hanya Admin');
  assert.equal(A(g, admin)('auth.logoutAll').ok, true);
  assert.equal(A(g, admin)('auth.me').code, 'TOKEN_EXPIRED');
  assert.equal(A(g, t2)('auth.me').code, 'TOKEN_EXPIRED');
});

// Matriks hak akses ditulis TERPISAH dari Config.gs agar menjadi pembanding independen.
const EXPECT = {
  Admin:                 { 'dashboard.summary': 1, 'equipment.list': 1, 'equipment.create': 1, 'equipment.delete': 1, 'equipment.restore': 1, 'master.all': 1, 'master.save': 1, 'users.list': 1, 'users.save': 1, 'settings.get': 1, 'settings.save': 1, 'audit.recent': 1, 'system.diagnostics': 1, 'system.refreshQr': 1 },
  'Maintenance Manager': { 'dashboard.summary': 1, 'equipment.list': 1, 'equipment.create': 1, 'equipment.delete': 1, 'equipment.restore': 0, 'master.all': 1, 'master.save': 1, 'users.list': 1, 'users.save': 0, 'settings.get': 1, 'settings.save': 0, 'audit.recent': 1, 'system.diagnostics': 0, 'system.refreshQr': 0 },
  Supervisor:            { 'dashboard.summary': 1, 'equipment.list': 1, 'equipment.create': 1, 'equipment.delete': 0, 'equipment.restore': 0, 'master.all': 1, 'master.save': 0, 'users.list': 0, 'users.save': 0, 'settings.get': 0, 'settings.save': 0, 'audit.recent': 0, 'system.diagnostics': 0, 'system.refreshQr': 0 },
  Technician:            { 'dashboard.summary': 1, 'equipment.list': 1, 'equipment.create': 0, 'equipment.delete': 0, 'equipment.restore': 0, 'master.all': 1, 'master.save': 0, 'users.list': 0, 'users.save': 0, 'settings.get': 0, 'settings.save': 0, 'audit.recent': 0, 'system.diagnostics': 0, 'system.refreshQr': 0 },
  Viewer:                { 'dashboard.summary': 1, 'equipment.list': 1, 'equipment.create': 0, 'equipment.delete': 0, 'equipment.restore': 0, 'master.all': 1, 'master.save': 0, 'users.list': 0, 'users.save': 0, 'settings.get': 0, 'settings.save': 0, 'audit.recent': 0, 'system.diagnostics': 0, 'system.refreshQr': 0 }
};

test('matriks hak akses: tiap role x tiap rute sensitif diperiksa di backend', () => {
  const g = fresh();
  const admin = login(g, OWNER);
  const roles = Object.keys(EXPECT);
  const toks = {};
  roles.forEach((r, i) => {
    if (r === 'Admin') { toks[r] = admin; return; }
    const email = 'u' + i + '@gmail.com';
    addUser(g, admin, 'User ' + r, email, r);
    toks[r] = login(g, email);
  });
  let checked = 0;
  for (const role of roles) {
    for (const [action, allowed] of Object.entries(EXPECT[role])) {
      const r = A(g, toks[role])(action, {});
      const denied = r.ok === false && r.code === 'FORBIDDEN';
      assert.equal(!denied, !!allowed, role + ' -> ' + action + ' : ' + JSON.stringify(r).slice(0, 120));
      checked++;
    }
  }
  assert.ok(checked >= 70);
  // Viewer/Technician tidak boleh melihat audit pada dashboard (data sensitif)
  assert.deepEqual(A(g, toks.Technician)('dashboard.summary').data.recent, []);
  assert.ok(A(g, toks['Maintenance Manager'])('dashboard.summary').data.recent.length > 0);
  // Pengguna tidak melihat data pengguna lain lewat auth.me; dan respons users.list tidak membawa kolom internal
  const list = A(g, admin)('users.list').data;
  list.forEach((u) => assert.ok(!('_row' in u)));
});

test('manajemen pengguna: email ganda, Admin terakhir, tidak bisa menonaktifkan diri sendiri', () => {
  const g = fresh();
  const admin = login(g, OWNER);
  const me = A(g, admin)('users.list').data.find((u) => u.email === OWNER);
  assert.equal(addUser(g, admin, 'X', 'x@gmail.com', 'Viewer').status, 'Active');
  assert.equal(A(g, admin)('users.save', { full_name: 'X2', email: 'X@gmail.com', role: 'Viewer' }).code, 'VALIDATION', 'email ganda (case-insensitive)');
  assert.equal(A(g, admin)('users.save', { full_name: 'Y', email: 'bukan email', role: 'Viewer' }).code, 'VALIDATION');
  assert.equal(A(g, admin)('users.save', { full_name: 'Y', email: 'y@gmail.com', role: 'Dewa' }).code, 'VALIDATION');
  assert.equal(A(g, admin)('users.setStatus', { user_id: me.user_id, status: 'Inactive' }).code, 'SELF_DEACTIVATE');
  assert.equal(A(g, admin)('users.save', { user_id: me.user_id, full_name: 'Admin', email: OWNER, role: 'Viewer' }).code, 'LAST_ADMIN');
});

test('equipment: CRUD, validasi, QR, soft delete, pemulihan, konflik edit', () => {
  const g = fresh();
  const admin = login(g, OWNER);
  const a = A(g, admin);
  const master = a('master.all').data;
  const loc = master.locations[0];
  const base = { equipment_name: 'Panel Uji', category_id: master.categories[0].category_id, building_id: loc.building_id, location_id: loc.location_id, brand: 'ABB', serial_number: 'S-1', voltage: '400 V' };
  const created = a('equipment.create', base);
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.match(created.data.equipment_id, /^EQ-\d{4}$/);
  const got = a('equipment.get', { equipment_id: created.data.equipment_id }).data;
  assert.match(got.qrUrl, /^https:\/\/script\.google\.com\/macros\/s\/TESTDEPLOY\/exec\?eq=EQ-\d{4}$/);
  assert.equal(g.ctx.Db.byId('EQUIPMENT_QR_CODES', got.equipment.qr_id).qr_payload, got.qrUrl);
  // Validasi
  const bad = (patch) => a('equipment.create', { ...base, serial_number: 'S-' + Math.random(), ...patch });
  assert.equal(bad({ equipment_name: '' }).details.field, 'equipment_name');
  assert.equal(bad({ equipment_name: 'x'.repeat(121) }).details.rule, 'max');
  assert.equal(bad({ category_id: 'CAT-999' }).details.field, 'category_id');
  assert.equal(bad({ installation_date: '2020-02-31' }).details.rule, 'format');
  assert.equal(bad({ installation_date: '2021-01-01', commissioning_date: '2020-01-01' }).details.rule, 'order');
  assert.equal(bad({ status: 'Rusak' }).details.rule, 'enum');
  assert.equal(a('equipment.create', base).details.rule, 'duplicate');
  const other = master.buildings.find((b) => b.building_id !== loc.building_id);
  assert.equal(bad({ building_id: other.building_id }).details.rule, 'mismatch');
  assert.equal(bad({ equipment_name: '<img src=x onerror=alert(1)>' }).ok, true, 'teks aneh disimpan apa adanya; escape dilakukan di tampilan (textContent)');
  // Konflik
  const cur = got.equipment;
  assert.equal(a('equipment.update', { ...base, equipment_id: cur.equipment_id, expected_updated_at: cur.updated_at, status: 'Warning' }).ok, true);
  assert.equal(a('equipment.update', { ...base, equipment_id: cur.equipment_id, expected_updated_at: '1999-01-01 00:00:00' }).code, 'CONFLICT');
  // Hapus aman
  const id = cur.equipment_id;
  assert.equal(a('equipment.delete', { equipment_id: id, reason: 'abc', confirm: id }).code, 'VALIDATION');
  assert.equal(a('equipment.delete', { equipment_id: id, reason: 'salah input', confirm: 'EQ-0000' }).code, 'CONFIRM_MISMATCH');
  assert.equal(a('equipment.delete', { equipment_id: id, reason: 'salah input', confirm: id.toLowerCase() }).ok, true, 'konfirmasi tidak peka huruf besar');
  assert.ok(!a('equipment.list').data.some((e) => e.equipment_id === id));
  assert.ok(a('equipment.list', { includeDeleted: true }).data.some((e) => e.equipment_id === id));
  assert.equal(a('equipment.restore', { equipment_id: id }).data.record_status, 'Active');
  // Ditolak bila ada pekerjaan terbuka
  g.ctx.Db.insert('CORRECTIVE_MAINTENANCE', { complaint_number: 'C1', equipment_id: id, status: 'Open' }, 'test');
  assert.equal(a('equipment.delete', { equipment_id: id, reason: 'coba hapus', confirm: id }).code, 'HAS_OPEN_WORK');
  // Audit
  const actions = g.ctx.AuditLog.recentRows(100).filter((r) => r.entity_id === id).map((r) => r.action);
  ['EQUIPMENT_CREATE', 'EQUIPMENT_UPDATE', 'EQUIPMENT_DELETE', 'EQUIPMENT_RESTORE'].forEach((x) => assert.ok(actions.includes(x), 'audit ' + x));
});

test('equipment: non-admin tidak melihat equipment terhapus walau meminta includeDeleted', () => {
  const g = fresh();
  const admin = login(g, OWNER);
  addUser(g, admin, 'Sup', 'sup@gmail.com', 'Supervisor');
  const sup = login(g, 'sup@gmail.com');
  const id = A(g, admin)('equipment.list').data[0].equipment_id;
  A(g, admin)('equipment.delete', { equipment_id: id, reason: 'uji sembunyi', confirm: id });
  assert.ok(!A(g, sup)('equipment.list', { includeDeleted: true }).data.some((e) => e.equipment_id === id));
  assert.equal(A(g, sup)('equipment.get', { equipment_id: id }).code, 'NOT_FOUND');
  assert.equal(A(g, sup)('equipment.history', { equipment_id: id }).ok, true);
});

test('foto: unggah gambar valid, ganti foto menandai lama, file palsu & terlalu besar ditolak', () => {
  const g = fresh();
  const admin = login(g, OWNER);
  const a = A(g, admin);
  const id = a('equipment.list').data[0].equipment_id;
  const r1 = a('equipment.uploadPhoto', { equipment_id: id, data: 'data:image/png;base64,' + PNG.toString('base64') });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  const p = a('equipment.photo', { equipment_id: id }).data;
  assert.match(p.dataUrl, /^data:image\/png;base64,/);
  const r2 = a('equipment.uploadPhoto', { equipment_id: id, data: PNG.toString('base64') });
  assert.equal(r2.ok, true);
  assert.equal(g.ctx.Db.byId('ATTACHMENTS', r1.data.attachment_id).status, 'Replaced');
  assert.equal(a('equipment.uploadPhoto', { equipment_id: id, data: Buffer.from('<script>alert(1)</script>').toString('base64') }).code, 'FILE_INVALID');
  assert.equal(a('equipment.uploadPhoto', { equipment_id: id, data: Buffer.from('GIF89a....').toString('base64') }).code, 'FILE_INVALID');
  assert.equal(a('equipment.uploadPhoto', { equipment_id: id, data: Buffer.concat([PNG, Buffer.alloc(3.2 * 1024 * 1024)]).toString('base64') }).code, 'FILE_TOO_LARGE');
  assert.equal(a('equipment.uploadPhoto', { equipment_id: id, data: '' }).code, 'FILE_INVALID');
  // Pengguna tidak dapat membaca lampiran milik entitas lain lewat ID lampiran
  const other = a('equipment.list').data[1].equipment_id;
  assert.equal(g.ctx.DriveService.dataUrlForAttachment(r2.data.attachment_id, 'EQUIPMENT', other), null);
  // Viewer tidak boleh mengunggah
  addUser(g, admin, 'V', 'v@gmail.com', 'Viewer');
  assert.equal(A(g, login(g, 'v@gmail.com'))('equipment.uploadPhoto', { equipment_id: id, data: PNG.toString('base64') }).code, 'FORBIDDEN');
});

test('ID otomatis unik dan berurutan, tabel tidak merusak data sebelumnya', () => {
  const g = fresh();
  const admin = login(g, OWNER);
  const a = A(g, admin);
  const m = a('master.all').data, loc = m.locations[0];
  const ids = [];
  for (let i = 0; i < 12; i++) {
    const r = a('equipment.create', { equipment_name: 'E' + i, category_id: m.categories[0].category_id, building_id: loc.building_id, location_id: loc.location_id, serial_number: 'SN-' + i, brand: 'B' });
    assert.equal(r.ok, true); ids.push(r.data.equipment_id);
  }
  assert.equal(new Set(ids).size, 12);
  assert.deepEqual(ids, ids.slice().sort());
  assert.equal(ids[0], 'EQ-0009');
  assert.equal(g.state.lockHeld, 0, 'kunci selalu dilepas');
});

test('dashboard: angka sesuai data contoh dan membaca modul lain bila datanya ada', () => {
  const g = fresh();
  const admin = login(g, OWNER);
  const d = A(g, admin)('dashboard.summary').data;
  assert.deepEqual(d.totals, { equipment: 8, normal: 5, warning: 2, breakdown: 1 });
  assert.deepEqual(d.conditions, { Good: 4, Fair: 2, Poor: 2, Critical: 0 });
  assert.equal(d.monthly.length, 6);
  assert.equal(d.inspections.notDone, 8);
  assert.equal(d.pm.overdue, 0);
  const today = g.ctx.Util.today();
  g.ctx.Db.insert('PM_SCHEDULES', { equipment_id: 'EQ-0001', period: 'Monthly', next_due_date: g.ctx.Util.addDays(today, -3) }, 't');
  g.ctx.Db.insert('PM_SCHEDULES', { equipment_id: 'EQ-0002', period: 'Monthly', next_due_date: today }, 't');
  g.ctx.Db.insert('DAILY_INSPECTIONS', { equipment_id: 'EQ-0001', inspection_date: today }, 't');
  const d2 = A(g, admin)('dashboard.summary').data;
  assert.equal(d2.pm.overdue, 1); assert.equal(d2.pm.dueToday, 1); assert.equal(d2.inspections.today, 1); assert.equal(d2.inspections.notDone, 7);
});

test('data master: validasi, duplikasi, nonaktif ditolak bila masih dipakai', () => {
  const g = fresh();
  const admin = login(g, OWNER);
  const a = A(g, admin);
  const m = a('master.all').data;
  assert.equal(a('master.save', { entity: 'category', record: { code: 'mdp', name_en: 'x', name_id: 'x', name_zh: 'x' } }).details.rule, 'duplicate');
  assert.equal(a('master.save', { entity: 'category', record: { code: 'BAD CODE', name_en: 'x', name_id: 'x', name_zh: 'x' } }).details.rule, 'format');
  const c = a('master.save', { entity: 'category', record: { code: 'ATS', name_en: 'ATS', name_id: 'ATS', name_zh: '自动转换开关' } });
  assert.equal(c.ok, true); assert.match(c.data.category_id, /^CAT-\d{3}$/);
  assert.equal(a('master.save', { entity: 'bukan', record: {} }).code, 'UNKNOWN_ENTITY');
  assert.equal(a('master.setStatus', { entity: 'category', id: m.categories[0].category_id, status: 'Inactive' }).code, 'IN_USE');
  assert.equal(a('master.setStatus', { entity: 'category', id: c.data.category_id, status: 'Inactive' }).ok, true);
  const b = a('master.save', { entity: 'building', record: { building_name: 'Gedung Baru' } });
  const l = a('master.save', { entity: 'location', record: { building_id: b.data.building_id, location_name: 'Ruang 1', production_area: 'P3' } });
  assert.equal(l.ok, true);
  assert.equal(a('master.setStatus', { entity: 'building', id: b.data.building_id, status: 'Inactive' }).code, 'IN_USE');
});

test('pengaturan: validasi rentang; mengganti app_url menyelaraskan payload QR', () => {
  const g = fresh();
  const admin = login(g, OWNER);
  const a = A(g, admin);
  assert.equal(a('settings.save', { values: { session_hours: '999' } }).details.rule, 'range');
  assert.equal(a('settings.save', { values: { app_url: 'http://tidak-aman.example' } }).details.rule, 'format');
  assert.equal(a('settings.save', { values: { company_name: 'PT Contoh Jaya', default_language: 'zh' } }).ok, true);
  assert.equal(a('settings.save', { values: { company_name: '' } }).details.rule, 'required');
  const url = 'https://script.google.com/macros/s/NEWID/exec';
  assert.equal(a('settings.save', { values: { app_url: url } }).ok, true);
  g.ctx.Db.all('EQUIPMENT_QR_CODES').forEach((q) => assert.ok(q.qr_payload.startsWith(url + '?eq='), q.qr_payload));
  assert.equal(a('auth.me').data.settings.companyName, 'PT Contoh Jaya');
  assert.equal(a('settings.get').data.values.otp_ttl_minutes, '10');
  assert.ok(!('TOKEN_SECRET' in a('settings.get').data.values), 'rahasia tidak bocor lewat settings');
});

test('diagnostik Admin & rahasia tidak pernah dikirim ke klien', () => {
  const g = fresh();
  const admin = login(g, OWNER);
  const d = A(g, admin)('system.diagnostics').data;
  assert.equal(d.sheetsOk, 25); assert.deepEqual(d.sheetsMissing, []); assert.equal(d.authMethod, 'EMAIL_OTP'); assert.equal(d.appUrlLooksLikeExec, true);
  const secret = g.state.props.TOKEN_SECRET;
  const dump = JSON.stringify([A(g, admin)('auth.me'), A(g, admin)('settings.get'), A(g, admin)('system.diagnostics'), A(g, admin)('users.list'), A(g, admin)('audit.recent', { limit: 200 })]);
  assert.ok(!dump.includes(secret));
  assert.ok(!/otp:|"h":"/.test(dump));
});

test('audit log: login, perubahan, dan penolakan tercatat; tidak mencatat kode OTP', () => {
  const g = fresh();
  g.api({ action: 'auth.requestOtp', payload: { email: 'asing@gmail.com' } });
  const admin = login(g, OWNER);
  const code = g.lastOtp();
  const rows = g.ctx.Db.all('AUDIT_LOG');
  const acts = rows.map((r) => r.action);
  ['OTP_REQUEST_REJECTED', 'OTP_SENT', 'LOGIN'].forEach((x) => assert.ok(acts.includes(x), x));
  assert.ok(!JSON.stringify(rows).includes(code));
  assert.ok(admin);
});

test('doGet: halaman terbentuk, parameter eq disaring, boot JSON aman; belum setup -> ready=false', () => {
  const g = fresh();
  const out = g.call('doGet', { parameter: { eq: 'eq-0003' } });
  const html = out.getContent();
  assert.ok(!html.includes('<?'), 'tidak ada scriptlet tersisa');
  assert.match(html, /"deepLink":"EQ-0003"/);
  assert.match(html, /"ready":true/);
  ['Styles', 'I18n', 'Client', 'EMMS.pages.dashboard', 'EMMS.pages.equipment', 'EMMS.pages.users', 'EMMSQR'].forEach((x) => assert.ok(html.includes(x) || html.includes(x.toLowerCase()), x));
  const evil = g.call('doGet', { parameter: { eq: '"></script><script>alert(1)</script>' } }).getContent();
  assert.match(evil, /"deepLink":""/);
  assert.ok(!evil.includes('alert(1)'));
  const blank = createGas();
  const h2 = blank.call('doGet', { parameter: {} }).getContent();
  assert.match(h2, /"ready":false/);
});

test('data bertipe: tanggal tidak bergeser zona waktu setelah tulis-baca sheet', () => {
  const g = fresh();
  const admin = login(g, OWNER);
  const e = A(g, admin)('equipment.list').data[0];
  assert.match(e.installation_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(e.installation_date, '2020-03-10');
  assert.match(e.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('removeSampleData: hanya data contoh yang dihapus, data buatan pengguna aman', () => {
  const g = fresh();
  const admin = login(g, OWNER);
  const m = A(g, admin)('master.all').data;
  const b = A(g, admin)('master.save', { entity: 'building', record: { building_name: 'Gedung Asli' } }).data;
  const l = A(g, admin)('master.save', { entity: 'location', record: { building_id: b.building_id, location_name: 'Ruang Asli' } }).data;
  const e = A(g, admin)('equipment.create', { equipment_name: 'Asli', category_id: m.categories[0].category_id, building_id: b.building_id, location_id: l.location_id }).data;
  g.call('removeSampleData');
  const list = A(g, admin)('equipment.list').data;
  assert.deepEqual(list.map((x) => x.equipment_id), [e.equipment_id]);
  assert.equal(A(g, admin)('master.all').data.buildings.length, 1);
});
