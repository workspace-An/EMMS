const SCHEMA = {
  SETTINGS: ['SettingKey','SettingValue','Description','UpdatedAt'],
  USERS: ['UserID','FullName','Email','Role','Department','Status','CreatedAt','UpdatedAt','CreatedBy','UpdatedBy'],
  FACTORIES: ['FactoryID','FactoryName','Address','Status','CreatedAt','UpdatedAt','CreatedBy','UpdatedBy'],
  BUILDINGS: ['BuildingID','FactoryID','BuildingName','Description','Status','CreatedAt','UpdatedAt','CreatedBy','UpdatedBy'],
  LOCATIONS: ['LocationID','BuildingID','LocationName','ProductionArea','Description','Status','CreatedAt','UpdatedAt','CreatedBy','UpdatedBy'],
  EQUIPMENT_CATEGORIES: ['CategoryID','CategoryName','Description','Status','CreatedAt','UpdatedAt','CreatedBy','UpdatedBy'],
  EQUIPMENT: ['EquipmentID','EquipmentName','CategoryID','BuildingID','LocationID','ProductionArea','Brand','Model','SerialNumber','ElectricalSpecification','Voltage','Current','PowerRating','InstallationDate','CommissioningDate','EquipmentCondition','EquipmentStatus','EquipmentPhotoURL','Notes','CreatedAt','UpdatedAt','CreatedBy','UpdatedBy','IsDeleted'],
  EQUIPMENT_QR_CODES: ['QRCodeID','EquipmentID','QRPayload','QRImageURL','CreatedAt','CreatedBy'],
  AUDIT_LOG: ['AuditID','Timestamp','ActorEmail','ActorName','Action','Entity','EntityID','Details','Source']
};

/**
 * Run once manually from Apps Script editor:
 * setupEMMS('your-admin@gmail.com')
 * Creates the database spreadsheet, Drive folder and first Admin.
 */
function setupEMMS(adminEmail) {
  const email = normalizeEmail_(adminEmail);
  if (!email || !/^[^@\s]+@gmail\.com$/.test(email)) {
    throw new Error('Masukkan email admin Gmail yang valid, contoh: admin@gmail.com');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('EMMS_INITIALIZED') === 'true') {
      throw new Error('EMMS sudah diinisialisasi. Untuk menghindari database ganda, setup dihentikan.');
    }

    const ss = SpreadsheetApp.create('EMMS Database');
    ss.setSpreadsheetTimeZone(EMMS.TIMEZONE);
    const first = ss.getSheets()[0];
    first.setName(EMMS.SHEETS.SETTINGS);

    Object.keys(SCHEMA).forEach(name => {
      const sheetName = EMMS.SHEETS[name] || name;
      const sh = name === 'SETTINGS' ? first : ss.insertSheet(sheetName);
      const headers = SCHEMA[name];
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#17365D').setFontColor('#FFFFFF');
      sh.autoResizeColumns(1, headers.length);
    });

    const folder = DriveApp.createFolder('EMMS - Maintenance Attachments');
    props.setProperties({
      EMMS_SPREADSHEET_ID: ss.getId(),
      EMMS_DRIVE_FOLDER_ID: folder.getId(),
      EMMS_INITIALIZED: 'true',
      EMMS_TIMEZONE: EMMS.TIMEZONE
    });

    const now = new Date();
    // Avoid reacquiring the script lock through nextId_ while setup holds it.
    props.setProperty('SEQ_USR', '1');
    appendObject_(EMMS.SHEETS.USERS, {
      UserID: 'USR-000001', FullName: 'System Administrator', Email: email,
      Role: 'Admin', Department: 'Electrical Maintenance', Status: 'Active',
      CreatedAt: now, UpdatedAt: now, CreatedBy: email, UpdatedBy: email
    });

    const settings = [
      ['APP_NAME', EMMS.APP_NAME, 'Nama aplikasi'],
      ['APP_VERSION', EMMS.VERSION, 'Versi aplikasi'],
      ['TIMEZONE', EMMS.TIMEZONE, 'Zona waktu aplikasi'],
      ['DEFAULT_LANGUAGE', 'id', 'Bahasa default: id, en, zh'],
      ['COMPANY_NAME', 'Your Company', 'Ganti dengan nama perusahaan']
    ];
    const sh = SpreadsheetApp.openById(ss.getId()).getSheetByName(EMMS.SHEETS.SETTINGS);
    sh.getRange(2, 1, settings.length, 4).setValues(settings.map(r => [r[0], r[1], r[2], now]));
    SpreadsheetApp.flush();

    Logger.log('EMMS database: ' + ss.getUrl());
    Logger.log('EMMS Drive folder: ' + folder.getUrl());
    Logger.log('Admin: ' + email);
    return { spreadsheetUrl: ss.getUrl(), folderUrl: folder.getUrl(), adminEmail: email };
  } finally {
    lock.releaseLock();
  }
}

/** Optional: run after first deployment to store the /exec URL for QR links. */
function saveWebAppUrl(url) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(String(url || ''))) {
    throw new Error('Masukkan URL Web App /exec yang valid.');
  }
  PropertiesService.getScriptProperties().setProperty('EMMS_WEB_APP_URL', url);
  return 'Web App URL tersimpan.';
}


/**
 * Optional demo data for testing. Run only on a fresh/test database.
 * Does not overwrite existing records.
 */
function seedEMMSTestData() {
  assertConfigured_();
  const actor = rowsAsObjects_(EMMS.SHEETS.USERS).find(u => u.Role === 'Admin' && u.Status === 'Active');
  if (!actor) throw new Error('Admin aktif tidak ditemukan.');
  const existing = rowsAsObjects_(EMMS.SHEETS.EQUIPMENT);
  if (existing.length) throw new Error('Data equipment sudah ada. Seed dihentikan agar tidak menggandakan data.');

  const now = new Date();
  const factoryId = 'FAC-000001';
  const buildingId = 'BLD-000001';
  const locationId = 'LOC-000001';
  const categoryId = 'CAT-000001';
  appendObject_(EMMS.SHEETS.FACTORIES, {
    FactoryID: factoryId, FactoryName: 'Demo Factory', Address: 'Alamat contoh - silakan ubah',
    Status: 'Active', CreatedAt: now, UpdatedAt: now, CreatedBy: actor.Email, UpdatedBy: actor.Email
  });
  appendObject_(EMMS.SHEETS.BUILDINGS, {
    BuildingID: buildingId, FactoryID: factoryId, BuildingName: 'Production Building A',
    Description: 'Data contoh', Status: 'Active', CreatedAt: now, UpdatedAt: now,
    CreatedBy: actor.Email, UpdatedBy: actor.Email
  });
  appendObject_(EMMS.SHEETS.LOCATIONS, {
    LocationID: locationId, BuildingID: buildingId, LocationName: 'Electrical Room A',
    ProductionArea: 'Production Line A', Description: 'Data contoh', Status: 'Active',
    CreatedAt: now, UpdatedAt: now, CreatedBy: actor.Email, UpdatedBy: actor.Email
  });
  appendObject_(EMMS.SHEETS.EQUIPMENT_CATEGORIES, {
    CategoryID: categoryId, CategoryName: 'Motor Control Center (MCC)',
    Description: 'Demo category', Status: 'Active', CreatedAt: now, UpdatedAt: now,
    CreatedBy: actor.Email, UpdatedBy: actor.Email
  });
  const equipmentId = nextId_('EQP');
  appendObject_(EMMS.SHEETS.EQUIPMENT, {
    EquipmentID: equipmentId, EquipmentName: 'MCC-AREA-A-01', CategoryID: categoryId,
    BuildingID: buildingId, LocationID: locationId, ProductionArea: 'Production Line A',
    Brand: 'Demo Brand', Model: 'MCC-400V', SerialNumber: 'DEMO-0001',
    ElectricalSpecification: '3 Phase, 400 V, 50 Hz', Voltage: '400 V',
    Current: '250 A', PowerRating: 'N/A', InstallationDate: '', CommissioningDate: '',
    EquipmentCondition: 'Good', EquipmentStatus: 'Normal', EquipmentPhotoURL: '',
    Notes: 'Sample data — replace with actual plant information.',
    CreatedAt: now, UpdatedAt: now, CreatedBy: actor.Email, UpdatedBy: actor.Email, IsDeleted: false
  });
  createEquipmentQr_(actor, equipmentId);
  audit_(actor, 'SEED', 'EQUIPMENT', equipmentId, { sample: true });
  return { ok: true, equipmentId: equipmentId, message: 'Data demo berhasil dibuat.' };
}

