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
    seedChecklists_();
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

/**
 * Checklist bawaan per kategori (Phase 2). NILAI BATAS (min/maks) adalah CONTOH awal yang wajar - Maintenance
 * Manager/Admin harus menyesuaikannya dengan spesifikasi peralatan dan standar perusahaan di menu Inspeksi > Checklist.
 */
const CHECKLIST_ITEMS_ = {
  visual: ['Kondisi visual', 'check'], noise: ['Suara abnormal', 'check'], burnsmell: ['Bau terbakar', 'check', true],
  cleanliness: ['Kebersihan panel', 'check'], cable: ['Kondisi kabel', 'check'], terminal: ['Kondisi terminal', 'check'],
  connection: ['Kondisi koneksi', 'check'], indicator: ['Indikator panel', 'check'], protection: ['Kondisi proteksi', 'check'],
  grounding: ['Kondisi grounding', 'check'], vibration: ['Getaran', 'check'],
  temperature: ['Temperatur', 'measure', true, '\u00b0C'], voltage: ['Tegangan', 'measure', false, 'V'], current: ['Arus', 'measure', false, 'A'],
  pf: ['Faktor daya (cos phi)', 'measure', false, ''], freq: ['Frekuensi', 'measure', false, 'Hz'], loadpct: ['Beban', 'measure', false, '%'],
  groundres: ['Tahanan grounding', 'measure', false, 'Ohm'], lux: ['Intensitas cahaya', 'measure', false, 'lux']
};
const CHECKLIST_PLAN_ = {
  MDP: ['visual', 'noise', 'burnsmell', 'cleanliness', 'cable', 'terminal', 'connection', 'indicator', 'protection', 'grounding', ['temperature', '', 60], ['voltage', 380, 420], 'current'],
  SDP: ['visual', 'noise', 'burnsmell', 'cleanliness', 'cable', 'terminal', 'connection', 'indicator', 'protection', 'grounding', ['temperature', '', 60], ['voltage', 380, 420], 'current'],
  MCC: ['visual', 'noise', 'burnsmell', 'cleanliness', 'cable', 'terminal', 'connection', 'indicator', 'protection', 'grounding', ['temperature', '', 60], ['voltage', 380, 420], 'current'],
  DP: ['visual', 'noise', 'burnsmell', 'cleanliness', 'cable', 'terminal', 'connection', 'indicator', 'protection', 'grounding', ['temperature', '', 60], ['voltage', 380, 420], 'current'],
  CAP: ['visual', 'noise', 'burnsmell', 'cleanliness', 'cable', 'terminal', 'connection', 'indicator', 'protection', 'grounding', ['temperature', '', 55], ['pf', 0.9, 1], 'current'],
  TRF: ['visual', 'noise', 'burnsmell', 'cleanliness', 'cable', 'terminal', 'connection', 'indicator', 'protection', 'grounding', ['temperature', '', 90], ['voltage', 380, 420], 'current'],
  GEN: ['visual', 'noise', 'burnsmell', 'cleanliness', 'cable', 'terminal', 'connection', 'indicator', 'protection', 'grounding', ['temperature', '', 90], ['voltage', 380, 420], ['freq', 49.5, 50.5]],
  UPS: ['visual', 'noise', 'burnsmell', 'cleanliness', 'cable', 'terminal', 'connection', 'indicator', 'protection', 'grounding', ['temperature', '', 40], ['voltage', 380, 420], ['loadpct', '', 80]],
  MTR: ['visual', 'noise', 'vibration', 'burnsmell', 'cleanliness', 'cable', 'terminal', 'connection', 'protection', 'grounding', ['temperature', '', 80], 'current'],
  CBL: ['visual', 'burnsmell', 'cable', 'terminal', 'connection', 'grounding', ['temperature', '', 60]],
  GRD: ['visual', 'terminal', 'connection', 'grounding', ['groundres', '', 5]],
  LTG: ['visual', 'noise', 'cable', 'connection', 'indicator', 'protection', ['lux', 100, '']],
  PRT: ['visual', 'noise', 'burnsmell', 'cleanliness', 'terminal', 'connection', 'indicator', 'protection', 'grounding', ['temperature', '', 60]]
};

function seedChecklists_() {
  if (Db.all('INSPECTION_CHECKLISTS', { includeDeleted: true }).length) return;
  const cats = {};
  Db.all('EQUIPMENT_CATEGORIES').forEach(function (c) { cats[c.Code] = c.CategoryID; });
  const recs = [];
  Object.keys(CHECKLIST_PLAN_).forEach(function (code) {
    if (!cats[code]) return;
    CHECKLIST_PLAN_[code].forEach(function (spec, i) {
      const key = Array.isArray(spec) ? spec[0] : spec, def = CHECKLIST_ITEMS_[key];
      recs.push({
        CategoryID: cats[code], ItemNo: i + 1, ItemKey: key, ItemName: def[0], ItemType: def[1], Unit: def[3] || '',
        MinValue: Array.isArray(spec) ? spec[1] : '', MaxValue: Array.isArray(spec) ? spec[2] : '', IsCritical: def[2] === true
      });
    });
  });
  Db.insertMany('INSPECTION_CHECKLISTS', recs, 'system');
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

/**
 * Uji Phase 2 pada Sheet SUNGGUHAN (Run dari editor). Membuat equipment uji, lalu membersihkan.
 * Tidak mengirim email (item uji non-kritis). Hasil muncul di Execution log.
 */
function runSelfTestPhase2() {
  const results = [];
  const t = function (name, fn) {
    try { fn(); results.push('PASS  ' + name); } catch (e) { results.push('FAIL  ' + name + ' -> ' + (e && e.message)); }
  };
  const eq = function (a, b, m) { if (a !== b) throw new Error((m || 'nilai') + ': diharapkan ' + b + ', dapat ' + a); };
  const admin = { email: 'selftest-admin@example.com', name: 'Self Test', role: 'Admin' };
  let e1 = null; const inspIds = [];

  t('Sheet & kolom Phase 2 lengkap (jalankan setupEMMS() bila gagal)', function () {
    ['INSPECTION_CHECKLISTS', 'DAILY_INSPECTIONS', 'INSPECTION_RESULTS'].forEach(function (n) {
      const h = Db.headers(n);
      Schema.columns(n).forEach(function (c) { if (h.indexOf(c.name) === -1) throw new Error(n + ' kehilangan kolom ' + c.name); });
    });
    if (!Db.all('INSPECTION_CHECKLISTS').length) throw new Error('checklist belum di-seed; jalankan setupEMMS()');
  });
  t('Buat equipment uji pada kategori ber-checklist', function () {
    const withCl = {};
    Db.all('INSPECTION_CHECKLISTS').forEach(function (c) { if (c.Status === 'Active') withCl[c.CategoryID] = true; });
    const loc = Db.all('LOCATIONS')[0];
    const cat = Db.all('EQUIPMENT_CATEGORIES').filter(function (c) { return withCl[c.CategoryID]; })[0];
    if (!cat || !loc) throw new Error('kategori/lokasi tidak ada');
    e1 = Equipment.create({ EquipmentName: 'ZZTEST Insp', CategoryID: cat.CategoryID, BuildingID: loc.BuildingID, LocationID: loc.LocationID, SerialNumber: 'ZZ-P2', Brand: 'ZZ' }, admin);
  });
  const answers = function (ngKey) {
    const eqr = Db.get('EQUIPMENT', e1.EquipmentID);
    return Checklist.forCategory(eqr.CategoryID, false).map(function (it) {
      const a = { ChecklistID: it.ChecklistID, Result: 'OK', MeasurementValue: '', Remarks: '' };
      if (it.ItemType === 'measure') {
        a.MeasurementValue = it.MinValue !== '' && it.MaxValue !== '' ? (it.MinValue + it.MaxValue) / 2 : (it.MinValue !== '' ? it.MinValue + 1 : (it.MaxValue !== '' ? it.MaxValue - 1 : 1));
      }
      if (ngKey === it.ChecklistID) { a.Result = 'NG'; a.Remarks = 'uji NG'; }
      return a;
    });
  };
  t('Inspeksi semua OK tersimpan', function () {
    const r = Inspection.submit({ EquipmentID: e1.EquipmentID, items: answers() }, admin);
    inspIds.push(r.InspectionID);
    eq(r.OverallResult, 'OK'); eq(r.Status, 'Completed');
  });
  t('NG tanpa rekomendasi ditolak; dengan rekomendasi -> status Open & equipment Warning', function () {
    const eqr = Db.get('EQUIPMENT', e1.EquipmentID);
    const item = Checklist.forCategory(eqr.CategoryID, false).filter(function (i) { return i.ItemType === 'check' && i.IsCritical !== true; })[0];
    if (!item) throw new Error('tidak ada item non-kritis tipe check');
    try { Inspection.submit({ EquipmentID: e1.EquipmentID, items: answers(item.ChecklistID) }, admin); throw new Error('tidak ditolak'); }
    catch (e) { if (e.code !== 'VALIDATION') throw e; }
    const r = Inspection.submit({ EquipmentID: e1.EquipmentID, Recommendation: 'Cek ulang', items: answers(item.ChecklistID) }, admin);
    inspIds.push(r.InspectionID);
    eq(r.OverallResult, 'NG'); eq(r.Status, 'Open');
    eq(Db.get('EQUIPMENT', e1.EquipmentID).EquipmentStatus, 'Warning');
  });
  t('Review mengubah status ke Reviewed', function () {
    Inspection.review({ id: inspIds[1], remarks: 'ok' }, admin);
    eq(Db.get('DAILY_INSPECTIONS', inspIds[1]).Status, 'Reviewed');
  });
  t('Papan hari ini & riwayat memuat inspeksi uji', function () {
    const b = Inspection.todayStatus({}, admin);
    if (!b.rows.some(function (r) { return r.EquipmentID === e1.EquipmentID && r.inspectedToday; })) throw new Error('tidak di papan');
    if (Inspection.list({}, admin).rows.length < 2) throw new Error('riwayat kurang');
  });
  t('Bersihkan data uji', function () {
    Db.where('INSPECTION_RESULTS', function (r) { return inspIds.indexOf(r.InspectionID) !== -1; }).forEach(function (r) { Db.hardDelete('INSPECTION_RESULTS', r.ResultID); });
    inspIds.forEach(function (id) { Db.hardDelete('DAILY_INSPECTIONS', id); });
    Equipment.remove({ id: e1.EquipmentID, reason: 'self test', confirmId: e1.EquipmentID }, admin);
  });

  const failed = results.filter(function (r) { return r.indexOf('FAIL') === 0; }).length;
  const out = results.join('\n') + '\n\n' + (results.length - failed) + '/' + results.length + ' lulus' + (failed ? ' - ADA YANG GAGAL' : '');
  Logger.log(out);
  return out;
}

/**
 * Uji Phase 3 pada Sheet & Calendar SUNGGUHAN (Run dari editor). Membuat jadwal PM uji (dan satu event Calendar uji),
 * lalu membersihkan semuanya. Tidak mengirim email.
 */
function runSelfTestPhase3() {
  const results = [];
  const t = function (name, fn) {
    try { fn(); results.push('PASS  ' + name); } catch (e) { results.push('FAIL  ' + name + ' -> ' + (e && e.message)); }
  };
  const eq = function (a, b, m) { if (a !== b) throw new Error((m || 'nilai') + ': diharapkan ' + b + ', dapat ' + a); };
  const admin = { email: 'selftest-admin@example.com', name: 'Self Test', role: 'Admin' };
  const other = { email: 'selftest-sup@example.com', name: 'Self Test 2', role: 'Supervisor' };
  let e1 = null, sch = null, recId = '';

  t('Sheet & kolom Phase 3 lengkap (jalankan setupEMMS() bila gagal)', function () {
    ['PM_SCHEDULES', 'PREVENTIVE_MAINTENANCE'].forEach(function (n) {
      const h = Db.headers(n);
      Schema.columns(n).forEach(function (c) { if (h.indexOf(c.name) === -1) throw new Error(n + ' kehilangan kolom ' + c.name); });
    });
  });
  t('Aritmetika tanggal frekuensi', function () {
    eq(PMDate.addMonths('2026-01-31', 1), '2026-02-28');
    eq(PMDate.next('2026-03-01', '2026-06-10', 'Monthly'), '2026-07-01');
    eq(PMDate.next('2026-03-01', '2026-03-08', 'Weekly'), '2026-03-15');
  });
  t('Buat equipment & jadwal uji (event Calendar dibuat)', function () {
    const cat = Db.all('EQUIPMENT_CATEGORIES')[0], loc = Db.all('LOCATIONS')[0];
    if (!cat || !loc) throw new Error('kategori/lokasi tidak ada');
    e1 = Equipment.create({ EquipmentName: 'ZZTEST PM', CategoryID: cat.CategoryID, BuildingID: loc.BuildingID, LocationID: loc.LocationID, SerialNumber: 'ZZ-P3', Brand: 'ZZ' }, admin);
    sch = PM.scheduleSave({ data: { EquipmentID: e1.EquipmentID, PMTitle: 'ZZTEST PM', Frequency: 'Monthly', StartDate: Db.today() } }, admin);
    eq(sch.state, 'DueSoon', 'state');
    if (Cal.enabled() && !sch.hasCalendar) throw new Error('event Calendar tidak terbuat (cek izin Calendar saat Review permissions)');
  });
  t('Selesaikan PM: rekaman Pending, jadwal maju, tidak bisa dobel', function () {
    const r = PM.complete({ PMScheduleID: sch.PMScheduleID, ActualDate: Db.today(), StartTime: '00:00', FinishTime: '00:01', MaintenanceResult: 'Done' }, other);
    recId = r.PMID;
    eq(r.ApprovalStatus, 'Pending');
    if (!(r.NextDueDate > Db.today())) throw new Error('jadwal tidak maju: ' + r.NextDueDate);
    const s = Db.get('PM_SCHEDULES', sch.PMScheduleID);
    eq(s.LastDoneDate, Db.today());
    const advanced = s.NextDueDate;
    ensureThrows_(function () { Db.update('PM_SCHEDULES', s.PMScheduleID, { NextDueDate: Db.today() }, 'x'); PM.complete({ PMScheduleID: s.PMScheduleID, ActualDate: Db.today(), StartTime: '00:00', FinishTime: '00:01', MaintenanceResult: 'Done' }, other); }, 'CONFLICT');
    Db.update('PM_SCHEDULES', s.PMScheduleID, { NextDueDate: advanced }, 'x');
  });
  t('Pelaksana tidak boleh menyetujui sendiri; Admin boleh', function () {
    ensureThrows_(function () { PM.approve({ id: recId, decision: 'Approved' }, other); }, 'FORBIDDEN');
    PM.approve({ id: recId, decision: 'Approved' }, admin);
    eq(Db.get('PREVENTIVE_MAINTENANCE', recId).ApprovalStatus, 'Approved');
  });
  t('Bersihkan data uji (jadwal, event Calendar, rekaman)', function () {
    PM.scheduleDelete({ id: sch.PMScheduleID }, admin);
    Db.where('PREVENTIVE_MAINTENANCE', function (r) { return r.PMScheduleID === sch.PMScheduleID; }).forEach(function (r) { Db.hardDelete('PREVENTIVE_MAINTENANCE', r.PMID); });
    Db.hardDelete('PM_SCHEDULES', sch.PMScheduleID);
    Equipment.remove({ id: e1.EquipmentID, reason: 'self test', confirmId: e1.EquipmentID }, admin);
  });

  const failed = results.filter(function (r) { return r.indexOf('FAIL') === 0; }).length;
  const out = results.join('\n') + '\n\n' + (results.length - failed) + '/' + results.length + ' lulus' + (failed ? ' - ADA YANG GAGAL' : '');
  Logger.log(out);
  return out;
}

/** Pembantu uji: fn harus melempar (dengan code tertentu bila diberikan). */
function ensureThrows_(fn, code) {
  try { fn(); } catch (e) { if (!code || e.code === code) return; throw new Error('kode error ' + e.code + ' != ' + code); }
  throw new Error('tidak melempar error');
}

/**
 * Uji Phase 4 pada Sheet SUNGGUHAN (Run dari editor): siklus Corrective dan Work Order lalu pembersihan.
 * Tidak mengirim email (prioritas Medium, tanpa penugasan lewat email).
 */
function runSelfTestPhase4() {
  const results = [];
  const t = function (name, fn) {
    try { fn(); results.push('PASS  ' + name); } catch (e) { results.push('FAIL  ' + name + ' -> ' + (e && e.message)); }
  };
  const eq = function (a, b, m) { if (a !== b) throw new Error((m || 'nilai') + ': diharapkan ' + b + ', dapat ' + a); };
  const A = { email: 'selftest-admin@example.com', name: 'Self Test', role: 'Admin' };
  const S = { email: 'selftest-sup@example.com', name: 'Self Test 2', role: 'Supervisor' };
  const T = { email: 'selftest-tech@example.com', name: 'Self Test 3', role: 'Technician' };
  let e1 = null, cmNo = '', woId = '';

  t('Sheet & kolom Phase 4 lengkap (jalankan setupEMMS() bila gagal)', function () {
    ['CORRECTIVE_MAINTENANCE', 'WORK_ORDERS', 'WORK_ORDER_TASKS', 'PREVENTIVE_MAINTENANCE'].forEach(function (n) {
      const h = Db.headers(n);
      Schema.columns(n).forEach(function (c) { if (h.indexOf(c.name) === -1) throw new Error(n + ' kehilangan kolom ' + c.name); });
    });
  });
  t('Buat equipment uji & laporan kerusakan Medium', function () {
    const cat = Db.all('EQUIPMENT_CATEGORIES')[0], loc = Db.all('LOCATIONS')[0];
    e1 = Equipment.create({ EquipmentName: 'ZZTEST CM', CategoryID: cat.CategoryID, BuildingID: loc.BuildingID, LocationID: loc.LocationID, SerialNumber: 'ZZ-P4', Brand: 'ZZ' }, A);
    const r = CM.report({ EquipmentID: e1.EquipmentID, ProblemDescription: 'uji', Priority: 'Medium' }, T);
    cmNo = r.ComplaintNo; eq(Db.get('CORRECTIVE_MAINTENANCE', cmNo).Status, 'Open');
  });
  t('Mulai, selesai (validasi), penyelesai tidak boleh menutup, Supervisor menutup', function () {
    CM.start({ id: cmNo }, T);
    ensureThrows_(function () { CM.complete({ id: cmNo }, T); }, 'VALIDATION');
    CM.complete({ id: cmNo, RootCause: 'a', CorrectiveAction: 'b', RepairResult: 'Repaired' }, T);
    ensureThrows_(function () { CM.close({ id: cmNo }, T); }, 'FORBIDDEN');
    eq(CM.close({ id: cmNo }, S).Status, 'Closed');
  });
  t('Work Order: buat, pemohon tidak boleh menyetujui, tugas wajib selesai, penutupan', function () {
    woId = WO.create({ SourceType: 'Corrective', SourceID: cmNo, EquipmentID: e1.EquipmentID, Title: 'ZZTEST WO', Priority: 'Low', tasks: ['a', 'b'] }, T).WorkOrderID;
    ensureThrows_(function () { WO.create({ SourceType: 'Corrective', SourceID: cmNo, EquipmentID: e1.EquipmentID, Title: 'dobel', tasks: [] }, T); }, 'CONFLICT');
    ensureThrows_(function () { WO.decide({ id: woId, decision: 'Approved' }, T); }, 'FORBIDDEN');
    // tanpa AssignedTo agar tidak ada email; penugasan dilakukan langsung pada data uji
    WO.decide({ id: woId, decision: 'Approved' }, S);
    Db.update('WORK_ORDERS', woId, { AssignedTo: T.email }, 'x');
    WO.start({ id: woId }, T);
    ensureThrows_(function () { WO.complete({ id: woId, ResultNotes: 'x' }, T); }, 'CONFLICT');
    WO.get({ id: woId }, T).tasks.forEach(function (k) { WO.toggleTask({ taskId: k.TaskID, done: true }, T); });
    WO.complete({ id: woId, ResultNotes: 'selesai' }, T);
    ensureThrows_(function () { WO.close({ id: woId }, T); }, 'FORBIDDEN');
    eq(WO.close({ id: woId }, S).Status, 'Closed');
  });
  t('Bersihkan data uji', function () {
    Db.where('WORK_ORDER_TASKS', function (k) { return k.WorkOrderID === woId; }).forEach(function (k) { Db.hardDelete('WORK_ORDER_TASKS', k.TaskID); });
    Db.hardDelete('WORK_ORDERS', woId);
    Db.hardDelete('CORRECTIVE_MAINTENANCE', cmNo);
    Equipment.remove({ id: e1.EquipmentID, reason: 'self test', confirmId: e1.EquipmentID }, A);
  });

  const failed = results.filter(function (r) { return r.indexOf('FAIL') === 0; }).length;
  const out = results.join('\n') + '\n\n' + (results.length - failed) + '/' + results.length + ' lulus' + (failed ? ' - ADA YANG GAGAL' : '');
  Logger.log(out);
  return out;
}

/**
 * Uji mandiri Phase 5 (K3 Listrik) di spreadsheet nyata. Jalankan dari editor Apps Script.
 * Membuat data uji lalu menghapusnya. Prioritas Medium, tanpa email.
 */
function runSelfTestPhase5() {
  const results = [];
  const t = function (name, fn) {
    try { fn(); results.push('PASS  ' + name); } catch (e) { results.push('FAIL  ' + name + ' -> ' + (e && e.message)); }
  };
  const eq = function (a, b, m) { if (a !== b) throw new Error((m || 'nilai') + ': diharapkan ' + b + ', dapat ' + a); };
  const A = { email: 'selftest-admin@example.com', name: 'Self Test', role: 'Admin' };
  const S = { email: 'selftest-sup@example.com', name: 'Self Test 2', role: 'Supervisor' };
  const T = { email: 'selftest-tech@example.com', name: 'Self Test 3', role: 'Technician' };
  let e1 = null, sid = '', woId = '', lotoId = '';

  t('Sheet & kolom Phase 5 lengkap (jalankan setupEMMS() bila gagal)', function () {
    ['ELECTRICAL_SAFETY', 'RISK_ASSESSMENTS', 'LOTO_RECORDS'].forEach(function (n) {
      const h = Db.headers(n);
      Schema.columns(n).forEach(function (c) { if (h.indexOf(c.name) === -1) throw new Error(n + ' kehilangan kolom ' + c.name); });
    });
  });
  t('Lapor temuan Medium (tanpa email) & validasi', function () {
    const cat = Db.all('EQUIPMENT_CATEGORIES')[0], loc = Db.all('LOCATIONS')[0];
    e1 = Equipment.create({ EquipmentName: 'ZZTEST K3', CategoryID: cat.CategoryID, BuildingID: loc.BuildingID, LocationID: loc.LocationID, SerialNumber: 'ZZ-P5', Brand: 'ZZ' }, A);
    ensureThrows_(function () { Safety.report({ EquipmentID: e1.EquipmentID }, T); }, 'VALIDATION');
    sid = Safety.report({ EquipmentID: e1.EquipmentID, SafetyType: 'UnsafeCondition', ReportType: 'Grounding', Description: 'uji', RiskLevel: 'Medium' }, T).SafetyID;
    eq(Db.get('ELECTRICAL_SAFETY', sid).Status, 'Open');
  });
  t('Skor risiko dihitung server; skor tinggi butuh persetujuan; penilai tidak boleh menyetujui sendiri', function () {
    const r = Risk.save({ SafetyID: sid, Hazard: 'h', Controls: 'c', Likelihood: 4, Severity: 4 }, S);
    eq(r.RiskScore, 16); eq(r.RiskLevel, 'High'); eq(r.RequiresApproval, true);
    ensureThrows_(function () { Risk.approve({ id: r.RiskID }, S); }, 'FORBIDDEN');
    eq(Risk.approve({ id: r.RiskID, remarks: 'uji' }, A).decision, 'Approved');
  });
  t('WO dari temuan, LOTO, penyelesaian diblok sampai LOTO dilepas', function () {
    woId = WO.create({ SourceType: 'Safety', SourceID: sid, EquipmentID: e1.EquipmentID, Title: 'ZZTEST WO K3', Priority: 'Low', tasks: ['a'] }, T).WorkOrderID;
    eq(Db.get('ELECTRICAL_SAFETY', sid).Status, 'In Action');
    WO.decide({ id: woId, decision: 'Approved' }, S);
    Db.update('WORK_ORDERS', woId, { AssignedTo: T.email }, 'x');
    lotoId = Loto.apply({ WorkOrderID: woId, IsolationPoints: 'uji', LockNo: 'ZZ-LK', VerificationNotes: '0 V' }, T).LOTOID;
    ensureThrows_(function () { Loto.apply({ WorkOrderID: woId, IsolationPoints: 'x', LockNo: 'ZZ-2', VerificationNotes: 'x' }, T); }, 'CONFLICT');
    WO.start({ id: woId }, T);
    WO.get({ id: woId }, T).tasks.forEach(function (k) { WO.toggleTask({ taskId: k.TaskID, done: true }, T); });
    ensureThrows_(function () { WO.complete({ id: woId, ResultNotes: 'x' }, T); }, 'CONFLICT');
    Loto.remove({ id: lotoId }, T);
    WO.complete({ id: woId, ResultNotes: 'selesai' }, T);
    WO.close({ id: woId }, S);
  });
  t('Tutup temuan', function () {
    eq(Safety.close({ id: sid, ActionTaken: 'selesai' }, S).Status, 'Closed');
  });
  t('Bersihkan data uji', function () {
    Db.where('RISK_ASSESSMENTS', function (r) { return r.SafetyID === sid; }).forEach(function (r) { Db.hardDelete('RISK_ASSESSMENTS', r.RiskID); });
    Db.hardDelete('LOTO_RECORDS', lotoId);
    Db.where('WORK_ORDER_TASKS', function (k) { return k.WorkOrderID === woId; }).forEach(function (k) { Db.hardDelete('WORK_ORDER_TASKS', k.TaskID); });
    Db.hardDelete('WORK_ORDERS', woId);
    Db.hardDelete('ELECTRICAL_SAFETY', sid);
    Equipment.remove({ id: e1.EquipmentID, reason: 'self test', confirmId: e1.EquipmentID }, A);
  });

  const failed = results.filter(function (r) { return r.indexOf('FAIL') === 0; }).length;
  const out = results.join('\n') + '\n\n' + (results.length - failed) + '/' + results.length + ' lulus' + (failed ? ' - ADA YANG GAGAL' : '');
  Logger.log(out);
  return out;
}
