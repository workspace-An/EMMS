/**
 * SelfTest.gs
 * Uji otomatis sisi server. Jalankan runSelfTest() dari editor Apps Script dan lihat hasilnya
 * di Execution log. Pengujian membuat data sementara lalu menghapusnya kembali.
 * Uji ini TIDAK menggantikan uji manual dengan beberapa akun (lihat docs/testing.md).
 */

function runSelfTest() {
  assertOwnerContext_();
  var results = [];
  function check(name, fn) {
    try {
      var ok = fn();
      results.push({ name: name, pass: ok !== false, error: '' });
    } catch (e) {
      results.push({ name: name, pass: false, error: (e && e.message) || String(e) });
    }
  }
  function expectError(code, fn) {
    try { fn(); } catch (e) { return e && e.code === code; }
    return false;
  }

  var admin = { email: 'selftest@example.invalid', role: 'Admin', user_id: 'USR-TEST' };
  var viewer = { email: 'viewer@example.invalid', role: 'Viewer', user_id: 'USR-TEST2' };
  var tmpId = '';

  check('Semua 25 sheet ada dan kolomnya lengkap', function () {
    return Object.keys(SCHEMA).every(function (n) {
      var h = Db.headers(n);
      return SCHEMA[n].columns.every(function (c) { return h.indexOf(c) >= 0; });
    });
  });

  check('Pengaturan awal tersedia', function () { return Settings.get('default_language', '') !== ''; });
  check('Minimal satu Admin aktif', function () {
    return Db.all('USERS').filter(function (u) { return u.role === 'Admin' && u.status === 'Active'; }).length >= 1;
  });
  check('Kategori equipment ter-seed (13)', function () { return Db.all('EQUIPMENT_CATEGORIES').length >= 13; });

  check('Token: tanda tangan valid diterima', function () {
    var now = Date.now();
    var t = Auth._sign({ e: 'a@b.co', i: now, x: now + 60000, v: Auth._epoch() });
    return Auth._parse(t).e === 'a@b.co';
  });
  check('Token: dimodifikasi ditolak', function () {
    var now = Date.now();
    var t = Auth._sign({ e: 'a@b.co', i: now, x: now + 60000, v: Auth._epoch() });
    var bad = t.split('.')[0] + 'x.' + t.split('.')[1];
    return expectError('AUTH_REQUIRED', function () { Auth._parse(bad); });
  });
  check('Token: kedaluwarsa ditolak', function () {
    var t = Auth._sign({ e: 'a@b.co', i: 1, x: Date.now() - 1000, v: Auth._epoch() });
    return expectError('TOKEN_EXPIRED', function () { Auth._parse(t); });
  });
  check('Token: epoch lama ditolak (logout semua perangkat)', function () {
    var t = Auth._sign({ e: 'a@b.co', i: 1, x: Date.now() + 60000, v: 'epoch-lama' });
    return expectError('TOKEN_EXPIRED', function () { Auth._parse(t); });
  });
  check('Hak akses: Viewer tidak boleh membuat equipment, Admin boleh', function () {
    return !Auth.can(viewer, 'equipment.create') && Auth.can(admin, 'equipment.create') &&
      !Auth.can(viewer, 'users.write') && !Auth.can({ role: 'Technician' }, 'equipment.delete');
  });
  check('Hak akses: permission tidak dikenal ditolak', function () { return !Auth.can(admin, 'tidak.ada'); });

  var cat = Db.all('EQUIPMENT_CATEGORIES').filter(function (c) { return c.status === 'Active'; })[0];
  var loc = Db.all('LOCATIONS').filter(function (l) { return l.status === 'Active'; })[0];
  var base = cat && loc ? {
    equipment_name: 'ZZ SELF TEST', category_id: cat.category_id, building_id: loc.building_id,
    location_id: loc.location_id, serial_number: 'ZZ-TEST-' + Date.now(), brand: 'TEST'
  } : null;

  check('Prasyarat uji: ada kategori dan lokasi aktif', function () { return !!base; });

  if (base) {
    check('Equipment: validasi menolak nama kosong', function () {
      return expectError('VALIDATION', function () { Equipment.create(Object.assign({}, base, { equipment_name: '' }), admin); });
    });
    check('Equipment: validasi menolak lokasi yang bukan milik gedung', function () {
      var other = Db.all('BUILDINGS').filter(function (b) { return b.building_id !== loc.building_id; })[0];
      if (!other) return true;
      return expectError('VALIDATION', function () { Equipment.create(Object.assign({}, base, { building_id: other.building_id }), admin); });
    });
    check('Equipment: buat -> ID otomatis + QR terbentuk', function () {
      var e = Equipment.create(base, admin);
      tmpId = e.equipment_id;
      return /^EQ-\d{4,}$/.test(tmpId) && !!e.qr_id && Db.byId('EQUIPMENT_QR_CODES', e.qr_id).equipment_id === tmpId;
    });
    check('Equipment: serial duplikat ditolak', function () {
      return expectError('VALIDATION', function () { Equipment.create(base, admin); });
    });
    check('Equipment: ubah + deteksi konflik edit bersamaan', function () {
      var cur = Equipment.get({ equipment_id: tmpId }, admin).equipment;
      var upd = Equipment.update(Object.assign({}, base, { equipment_id: tmpId, status: 'Warning', expected_updated_at: cur.updated_at }), admin);
      var conflict = expectError('CONFLICT', function () {
        Equipment.update(Object.assign({}, base, { equipment_id: tmpId, expected_updated_at: '1999-01-01 00:00:00' }), admin);
      });
      return upd.status === 'Warning' && conflict;
    });
    check('Equipment: hapus ditolak tanpa konfirmasi ID', function () {
      return expectError('CONFIRM_MISMATCH', function () { Equipment.remove({ equipment_id: tmpId, reason: 'uji coba hapus', confirm: 'SALAH' }, admin); });
    });
    check('Equipment: soft delete -> hilang dari daftar, bisa dipulihkan Admin', function () {
      Equipment.remove({ equipment_id: tmpId, reason: 'uji coba hapus', confirm: tmpId }, admin);
      var inList = Equipment.list({}, admin).some(function (e) { return e.equipment_id === tmpId; });
      var inDeleted = Equipment.list({ includeDeleted: true }, admin).some(function (e) { return e.equipment_id === tmpId; });
      var restored = Equipment.restore({ equipment_id: tmpId }, admin);
      return !inList && inDeleted && restored.record_status === 'Active';
    });
    check('Audit log tercatat untuk perubahan equipment', function () {
      return AuditLog.recentRows(50).some(function (r) { return r.entity_id === tmpId && r.action === 'EQUIPMENT_CREATE'; });
    });
    check('Dashboard summary dapat dihitung', function () {
      var s = Dashboard.summary({}, admin);
      return s.totals.equipment >= 1 && s.monthly.length === 6;
    });
  }

  check('Foto: file non-gambar ditolak', function () {
    var txt = Utilities.base64Encode('ini bukan gambar, hanya teks biasa');
    return expectError('FILE_INVALID', function () { DriveService.saveImage('Equipment Photos', 'ZZ', txt); });
  });

  // Pembersihan data uji
  if (tmpId) {
    Db.hardDeleteWhere('EQUIPMENT_QR_CODES', function (r) { return r.equipment_id === tmpId; });
    Db.hardDeleteWhere('EQUIPMENT', function (r) { return r.equipment_id === tmpId; });
  }

  var failed = results.filter(function (r) { return !r.pass; });
  results.forEach(function (r) { Logger.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.error ? '  -> ' + r.error : '')); });
  Logger.log('RINGKASAN: ' + (results.length - failed.length) + ' lulus, ' + failed.length + ' gagal dari ' + results.length + ' uji.');
  return { total: results.length, failed: failed.length, results: results };
}
