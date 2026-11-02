/**
 * EMMS - Setup.gs
 * Dijalankan SEKALI dari editor Apps Script (atau menu "EMMS" di Google Sheets bila script terikat ke Sheet).
 *   1. setupEMMS()      -> membuat semua sheet, pengaturan awal, kategori, dan Admin pertama (akun pemilik script)
 *   2. seedDemoData()   -> (opsional) data contoh untuk pengujian
 *   3. runSelfTest()    -> uji otomatis backend Phase 1 (hasil di Execution log)
 * Aman dijalankan berulang (idempotent): sheet/kolom yang ada tidak dihapus.
 */

function setupEMMS() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    let ss = null;
    try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
    if (!ss) {
      const savedId = props.getProperty(CFG.SS_ID_PROP);
      ss = savedId ? SpreadsheetApp.openById(savedId) : SpreadsheetApp.create('EMMS Database');
    }
    props.setProperty(CFG.SS_ID_PROP, ss.getId());
    Db.reset();
    Auth.salt_();

    SHEET_ORDER.forEach(function (name) { ensureSheet_(ss, name); });
    removeDefaultSheet_(ss);

    seedSettings_();
    seedCategories_();
    const admin = seedFirstAdmin_();
    DriveSvc.rootFolder_();

    Logger.log('==== EMMS SETUP SELESAI ====');
    Logger.log('Database  : ' + ss.getUrl());
    Logger.log('Admin awal: ' + admin);
    Logger.log('Langkah berikut: Deploy > New deployment > Web app (lihat docs/installation.md)');
    return { spreadsheetUrl: ss.getUrl(), admin: admin };
  } finally {
    lock.releaseLock();
  }
}

function ensureSheet_(ss, name) {
  const cols = Schema.columns(name).map(function (c) { return c.name; });
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  let existing = [];
  const lastCol = sh.getLastColumn();
  if (lastCol > 0) {
    existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
    while (existing.length && existing[existing.length - 1] === '') existing.pop();
  }
  const missing = cols.filter(function (c) { return existing.indexOf(c) === -1; });
  const total = existing.length + missing.length;
  if (sh.getMaxColumns() < total) sh.insertColumnsAfter(sh.getMaxColumns(), total - sh.getMaxColumns());
  if (missing.length) {
    sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
    existing = existing.concat(missing);
  }

  const header = sh.getRange(1, 1, 1, existing.length);
  header.setBackground('#0b2a4a').setFontColor('#ffffff').setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setTabColor(SCHEMA[name].tab || '#64748b');
  const rows = Math.max(sh.getMaxRows() - 1, 1);
  sh.getRange(2, 1, rows, existing.length).setNumberFormat('@'); // semua data = teks
  if (name === 'AUDIT_LOG' || name === 'SESSIONS') {
    if (sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length === 0) {
      sh.protect().setWarningOnly(true).setDescription('Dikelola sistem - jangan diedit manual');
    }
  }
  if (SCHEMA[name].hidden && !sh.isSheetHidden()) {
    try { sh.hideSheet(); } catch (e) { /* sheet terakhir tidak bisa disembunyikan */ }
  }
}

function removeDefaultSheet_(ss) {
  ['Sheet1', 'Sheet 1', 'Lembar1', 'Lembar 1'].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s && ss.getSheets().length > 1 && s.getLastRow() === 0 && s.getLastColumn() === 0) ss.deleteSheet(s);
  });
}

function seedSettings_() {
  Settings.DEFAULTS.forEach(function (d) {
    if (!Db.get('SETTINGS', d.key)) {
      Db.insert('SETTINGS', { SettingKey: d.key, SettingValue: d.value, Description: d.desc, Category: d.cat }, 'system');
    }
  });
}

function seedCategories_() {
  if (Db.all('EQUIPMENT_CATEGORIES', { includeDeleted: true }).length) return;
  const rows = [
    ['Main Distribution Panel (MDP)', 'MDP', 'Panel distribusi utama'],
    ['Sub Distribution Panel (SDP)', 'SDP', 'Panel distribusi cabang'],
    ['Motor Control Center (MCC)', 'MCC', 'Panel kontrol motor'],
    ['Distribution Panel', 'DP', 'Panel distribusi beban'],
    ['Capacitor Bank', 'CAP', 'Bank kapasitor / koreksi faktor daya'],
    ['Transformer', 'TRF', 'Transformator daya'],
    ['Generator', 'GEN', 'Genset'],
    ['UPS', 'UPS', 'Uninterruptible Power Supply'],
    ['Electric Motor', 'MTR', 'Motor listrik'],
    ['Cable Installation', 'CBL', 'Instalasi kabel & tray'],
    ['Grounding System', 'GRD', 'Sistem pentanahan'],
    ['Lighting System', 'LTG', 'Sistem penerangan'],
    ['Electrical Protection System', 'PRT', 'Sistem proteksi listrik (MCB/MCCB/ELCB/relay)']
  ];
  Db.insertMany('EQUIPMENT_CATEGORIES', rows.map(function (r) {
    return { CategoryName: r[0], Code: r[1], Description: r[2], InspectionType: r[1] };
  }), 'system');
}

function seedFirstAdmin_() {
  let email = '';
  try { email = Session.getActiveUser().getEmail(); } catch (e) { email = ''; }
  if (!email) { try { email = Session.getEffectiveUser().getEmail(); } catch (e) { email = ''; } }
  email = Auth.norm(email);
  if (!email) {
    Logger.log('PERINGATAN: email pemilik tidak terdeteksi. Jalankan addAdminUser("emailanda@gmail.com").');
    return '(belum ada)';
  }
  addAdminUser(email);
  return email;
}

/** Menambah/mengaktifkan Admin berdasarkan email. Dapat dijalankan manual dari editor. */
function addAdminUser(email, fullName) {
  email = Auth.norm(email);
  if (!Auth.validEmail(email)) throw new Error('Email tidak valid: ' + email);
  const existing = Db.where('USERS', function (u) { return Auth.norm(u.Email) === email; }, { includeDeleted: true })[0];
  if (existing) {
    Db.update('USERS', existing.UserID, { Role: 'Admin', Status: 'Active' }, 'system');
  } else {
    Db.insert('USERS', {
      FullName: fullName || email.split('@')[0], Email: email, Role: 'Admin', Department: 'Electrical Maintenance',
      Language: '', Status: 'Active'
    }, 'system');
  }
  Audit.log('system', 'USER_ADMIN_SEED', 'USERS', email, null, 'OK');
}

/** Menu di Google Sheets (hanya bila script terikat ke Sheet). */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('EMMS')
      .addItem('1. Setup database', 'setupEMMS')
      .addItem('2. Isi data contoh (opsional)', 'seedDemoData')
      .addItem('3. Jalankan uji otomatis', 'runSelfTest')
      .addItem('Diagnostik autentikasi', 'diagnoseAuth')
      .addToUi();
  } catch (e) { /* standalone: tidak ada UI */ }
}

function diagnoseAuth() {
  Logger.log(JSON.stringify(Auth.diagnose(), null, 2));
  Logger.log('URL web app terdeteksi: ' + (Settings.detectedUrl() || '(belum ada deployment /exec)'));
}

// ====================================================================== DATA CONTOH
function seedDemoData() {
  const sys = { email: 'system', role: 'Admin' };
  Db.withLock(function () {
    if (!Db.all('FACTORIES').length) {
      const f = Db.insert('FACTORIES', { FactoryName: 'Pabrik Utama', Address: 'Kawasan Industri', Description: 'Pabrik contoh' }, 'system');
      const bA = Db.insert('BUILDINGS', { FactoryID: f.FactoryID, BuildingName: 'Gedung A - Produksi', Description: '' }, 'system');
      const bB = Db.insert('BUILDINGS', { FactoryID: f.FactoryID, BuildingName: 'Gedung B - Gudang', Description: '' }, 'system');
      const bU = Db.insert('BUILDINGS', { FactoryID: f.FactoryID, BuildingName: 'Gedung Utilitas', Description: '' }, 'system');
      [
        [bA, 'Ruang Panel A1', 'Produksi 1'], [bA, 'Ruang Panel A2', 'Produksi 2'], [bA, 'Lini Packing', 'Packing'],
        [bB, 'Ruang Panel Gudang', 'Gudang'], [bU, 'Ruang Trafo', 'Utilitas'], [bU, 'Ruang Genset', 'Utilitas'],
        [bU, 'Ruang UPS', 'Utilitas']
      ].forEach(function (l) {
        Db.insert('LOCATIONS', { BuildingID: l[0].BuildingID, LocationName: l[1], ProductionArea: l[2], Description: '' }, 'system');
      });
    }
  });

  if (Db.all('EQUIPMENT').length) { Logger.log('Equipment sudah ada, data contoh equipment dilewati.'); return; }
  const cats = {}; Db.all('EQUIPMENT_CATEGORIES').forEach(function (c) { cats[c.Code] = c.CategoryID; });
  const locs = {}; Db.all('LOCATIONS').forEach(function (l) { locs[l.LocationName] = l; });
  const demo = [
    ['Main Distribution Panel 1', 'MDP', 'Ruang Trafo', 'Schneider', 'Blokset', '0001001', '400V 3P 4W', '400 V', '2500 A', '1600 kVA', 'Good', 'Normal'],
    ['Sub Panel Produksi 1', 'SDP', 'Ruang Panel A1', 'ABB', 'ArTu', '0001002', '400V 3P 4W', '400 V', '630 A', '', 'Good', 'Normal'],
    ['Sub Panel Produksi 2', 'SDP', 'Ruang Panel A2', 'ABB', 'ArTu', '0001003', '400V 3P 4W', '400 V', '630 A', '', 'Fair', 'Warning'],
    ['MCC Line 1', 'MCC', 'Ruang Panel A1', 'Siemens', 'Sivacon', '0002001', '400V 3P', '400 V', '1000 A', '', 'Good', 'Normal'],
    ['MCC Line 2', 'MCC', 'Ruang Panel A2', 'Siemens', 'Sivacon', '0002002', '400V 3P', '400 V', '1000 A', '', 'Poor', 'Breakdown'],
    ['Capacitor Bank 300 kVAr', 'CAP', 'Ruang Trafo', 'Schneider', 'Varset', '0003001', '400V 50Hz', '400 V', '433 A', '300 kVAr', 'Good', 'Normal'],
    ['Transformer 1600 kVA', 'TRF', 'Ruang Trafo', 'Trafindo', 'TD-1600', '0004001', '20kV/400V Dyn5', '20 kV / 400 V', '46 A / 2309 A', '1600 kVA', 'Good', 'Normal'],
    ['Genset 800 kVA', 'GEN', 'Ruang Genset', 'Cummins', 'C800D5', '0005001', '400V 50Hz', '400 V', '1155 A', '640 kW', 'Good', 'Normal'],
    ['UPS 60 kVA', 'UPS', 'Ruang UPS', 'Eaton', '93PM', '0006001', '400V 3P', '400 V', '87 A', '60 kVA', 'Fair', 'Normal'],
    ['Motor Compressor 90 kW', 'MTR', 'Lini Packing', 'WEG', 'W22', '0007001', 'IE3 4P', '400 V', '160 A', '90 kW', 'Good', 'Normal'],
    ['Panel Penerangan Gudang', 'DP', 'Ruang Panel Gudang', 'Legrand', 'XL3', '0008001', '230/400V', '400 V', '125 A', '', 'Good', 'Normal'],
    ['Grounding Pit Utama', 'GRD', 'Ruang Trafo', '-', '-', '', 'Rod 3m Cu', '', '', '', 'Good', 'Normal']
  ];
  demo.forEach(function (d) {
    const loc = locs[d[2]];
    Equipment.create({
      EquipmentName: d[0], CategoryID: cats[d[1]], BuildingID: loc.BuildingID, LocationID: loc.LocationID,
      ProductionArea: loc.ProductionArea, Brand: d[3], Model: d[4], SerialNumber: d[5], ElectricalSpec: d[6],
      Voltage: d[7], Current: d[8], PowerRating: d[9], InstallationDate: '2022-03-15', CommissioningDate: '2022-04-01',
      Condition: d[10], EquipmentStatus: d[11], Notes: 'Data contoh'
    }, sys);
  });
  Logger.log('Data contoh dibuat: 1 pabrik, 3 gedung, 7 lokasi, ' + demo.length + ' equipment.');
}

// ====================================================================== SELF TEST
/**
 * Uji otomatis backend (memakai Sheet sungguhan). Membuat data uji berprefiks "ZZTEST" lalu
 * menghapusnya (soft delete) di akhir. Lihat hasil PASS/FAIL di Execution log.
 */
function runSelfTest() {
  const results = [];
  const t = function (name, fn) {
    try { fn(); results.push('PASS  ' + name); } catch (e) { results.push('FAIL  ' + name + ' -> ' + (e && e.message)); }
  };
  const eq = function (a, b, m) { if (a !== b) throw new Error((m || 'nilai') + ': diharapkan ' + b + ', dapat ' + a); };
  const throwsCode = function (fn, code) {
    try { fn(); } catch (e) { if (e.code === code) return; throw new Error('kode error ' + e.code + ' != ' + code); }
    throw new Error('tidak melempar ' + code);
  };

  const admin = { email: 'selftest-admin@example.com', role: 'Admin' };
  let tech = null, techToken = '', created = null;
  const testEmail = 'zztest-tech@example.com';

  t('Skema: semua sheet ada & header lengkap', function () {
    SHEET_ORDER.forEach(function (n) {
      const h = Db.headers(n);
      Schema.columns(n).forEach(function (c) { if (h.indexOf(c.name) === -1) throw new Error(n + ' kehilangan kolom ' + c.name); });
    });
  });
  t('ID otomatis berurutan (EQ-xxxx)', function () {
    const cat = Db.all('EQUIPMENT_CATEGORIES')[0];
    const loc = Db.all('LOCATIONS')[0];
    if (!cat || !loc) throw new Error('Jalankan seedDemoData() dulu');
    created = Equipment.create({
      EquipmentName: 'ZZTEST Panel', CategoryID: cat.CategoryID, BuildingID: loc.BuildingID, LocationID: loc.LocationID,
      SerialNumber: 'ZZ-00123', Brand: 'ZZBrand'
    }, admin);
    if (!/^EQ-\d{4,}$/.test(created.EquipmentID)) throw new Error('format ID: ' + created.EquipmentID);
  });
  t('Nomor seri tidak kehilangan nol di depan', function () {
    const e = Db.get('EQUIPMENT', created.EquipmentID);
    eq(e.SerialNumber, 'ZZ-00123');
    const z = Equipment.create({ EquipmentName: 'ZZTEST 2', CategoryID: e.CategoryID, BuildingID: e.BuildingID, LocationID: e.LocationID, SerialNumber: '000789', Brand: 'ZZB2' }, admin);
    eq(Db.get('EQUIPMENT', z.EquipmentID).SerialNumber, '000789');
    Equipment.remove({ id: z.EquipmentID, reason: 'self test', confirmId: z.EquipmentID }, admin);
  });
  t('Validasi: nama wajib & tanggal salah ditolak', function () {
    throwsCode(function () { Equipment.create({}, admin); }, 'VALIDATION');
    const e = Db.get('EQUIPMENT', created.EquipmentID);
    throwsCode(function () {
      Equipment.create({ EquipmentName: 'x', CategoryID: e.CategoryID, BuildingID: e.BuildingID, LocationID: e.LocationID, InstallationDate: '2022-13-45' }, admin);
    }, 'VALIDATION');
  });
  t('Serial+merek duplikat ditolak', function () {
    const e = Db.get('EQUIPMENT', created.EquipmentID);
    throwsCode(function () {
      Equipment.create({ EquipmentName: 'dup', CategoryID: e.CategoryID, BuildingID: e.BuildingID, LocationID: e.LocationID, SerialNumber: 'zz-00123', Brand: 'zzbrand' }, admin);
    }, 'CONFLICT');
  });
  t('QR Code dibuat bersama equipment', function () {
    const n = Db.count('EQUIPMENT_QR_CODES', function (r) { return r.EquipmentID === created.EquipmentID; });
    eq(n, 1, 'jumlah QR');
  });
  t('Optimistic concurrency: data basi ditolak', function () {
    const cur = Db.get('EQUIPMENT', created.EquipmentID);
    throwsCode(function () {
      Equipment.update(Object.assign({}, cur, { EquipmentName: 'ZZTEST edit', UpdatedAt: '2000-01-01 00:00:00' }), admin);
    }, 'CONFLICT');
  });
  t('Update equipment + audit log tercatat', function () {
    const cur = Db.get('EQUIPMENT', created.EquipmentID);
    Equipment.update(Object.assign({}, cur, { EquipmentName: 'ZZTEST edit', UpdatedAt: cur.UpdatedAt }), admin);
    const a = Audit.list({ entity: 'EQUIPMENT', entityId: created.EquipmentID, limit: 10 });
    if (!a.some(function (x) { return x.Action === 'EQUIPMENT_UPDATE'; })) throw new Error('audit update tidak ada');
  });
  t('API menolak token palsu (AUTH)', function () {
    eq(api('x'.repeat(64), 'equipment.list', {}).code, 'AUTH');
    eq(api('', 'equipment.list', {}).code, 'AUTH');
  });
  t('API menolak aksi tidak dikenal', function () { eq(api('', 'nope.nope', {}).code, 'NOT_FOUND'); });

  t('RBAC: Technician tidak boleh hapus/kelola user (FORBIDDEN di backend)', function () {
    tech = Db.insert('USERS', { FullName: 'ZZTEST Tech', Email: testEmail, Role: 'Technician', Department: 'EM', Status: 'Active' }, 'system');
    const s = Auth.createSession_(tech, 'selftest', 'TEST');
    techToken = s.token;
    eq(api(techToken, 'equipment.list', {}).ok, true, 'tech boleh lihat');
    eq(api(techToken, 'equipment.delete', { id: created.EquipmentID }).code, 'FORBIDDEN');
    eq(api(techToken, 'equipment.create', {}).code, 'FORBIDDEN');
    eq(api(techToken, 'users.list', {}).code, 'FORBIDDEN');
    eq(api(techToken, 'settings.update', { COMPANY_NAME: 'x' }).code, 'FORBIDDEN');
    eq(api(techToken, 'audit.list', {}).code, 'FORBIDDEN');
  });
  t('Hapus berpengaman: butuh alasan & konfirmasi ID', function () {
    throwsCode(function () { Equipment.remove({ id: created.EquipmentID, reason: '', confirmId: created.EquipmentID }, admin); }, 'VALIDATION');
    throwsCode(function () { Equipment.remove({ id: created.EquipmentID, reason: 'uji', confirmId: 'EQ-9999' }, admin); }, 'VALIDATION');
  });
  t('Sesi dicabut saat user dinonaktifkan', function () {
    const u = Db.get('USERS', tech.UserID);
    Users.save({ UserID: u.UserID, FullName: u.FullName, Email: u.Email, Role: u.Role, Department: u.Department, Status: 'Inactive', UpdatedAt: u.UpdatedAt }, admin);
    eq(api(techToken, 'equipment.list', {}).code, 'AUTH');
  });
  t('Admin terakhir tidak bisa diturunkan', function () {
    const admins = Users.activeAdmins_();
    if (admins.length !== 1) return; // hanya relevan bila tepat satu admin
    const a = admins[0];
    throwsCode(function () {
      Users.save({ UserID: a.UserID, FullName: a.FullName, Email: a.Email, Role: 'Viewer', Department: a.Department, Status: 'Active', UpdatedAt: a.UpdatedAt }, { email: 'other@example.com', role: 'Admin' });
    }, 'CONFLICT');
  });
  t('Dashboard menghitung equipment', function () {
    const d = Dashboard.summary({}, admin);
    if (d.cards.totalEquipment < 1) throw new Error('total 0');
    eq(d.cards.normal + d.cards.warning + d.cards.breakdown, d.cards.totalEquipment, 'jumlah status');
  });
  t('Master: lokasi harus sesuai gedung', function () {
    const e = Db.get('EQUIPMENT', created.EquipmentID);
    const other = Db.all('BUILDINGS').filter(function (b) { return b.BuildingID !== e.BuildingID; })[0];
    if (!other) return;
    throwsCode(function () {
      Equipment.update(Object.assign({}, e, { BuildingID: other.BuildingID, UpdatedAt: e.UpdatedAt }), admin);
    }, 'VALIDATION');
  });
  t('Pembersihan data uji', function () {
    Equipment.remove({ id: created.EquipmentID, reason: 'self test cleanup', confirmId: created.EquipmentID }, admin);
    if (tech) Db.update('USERS', tech.UserID, { Status: 'Deleted' }, 'system');
  });

  Logger.log(results.join('\n'));
  const failed = results.filter(function (r) { return r.indexOf('FAIL') === 0; }).length;
  Logger.log(failed ? '==== ' + failed + ' UJI GAGAL ====' : '==== SEMUA UJI LULUS (' + results.length + ') ====');
  return results;
}
