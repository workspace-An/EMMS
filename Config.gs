const EMMS = Object.freeze({
  APP_NAME: 'Electrical Maintenance Management System',
  VERSION: '1.0.0-phase1',
  TIMEZONE: 'Asia/Jakarta',
  SESSION_TTL_SECONDS: 21600, // 6 hours
  OTP_TTL_SECONDS: 300,       // 5 minutes
  OTP_MAX_ATTEMPTS: 5,
  OTP_RESEND_SECONDS: 60,
  PAGE_SIZE: 100,
  SHEETS: {
    SETTINGS: 'SETTINGS',
    USERS: 'USERS',
    FACTORIES: 'FACTORIES',
    BUILDINGS: 'BUILDINGS',
    LOCATIONS: 'LOCATIONS',
    EQUIPMENT_CATEGORIES: 'EQUIPMENT_CATEGORIES',
    EQUIPMENT: 'EQUIPMENT',
    EQUIPMENT_QR_CODES: 'EQUIPMENT_QR_CODES',
    AUDIT_LOG: 'AUDIT_LOG'
  },
  ROLES: ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician', 'Viewer'],
  EQUIPMENT_STATUSES: ['Normal', 'Warning', 'Breakdown', 'Inactive'],
  CONDITIONS: ['Good', 'Fair', 'Poor', 'Critical']
});

function getConfig_() {
  const p = PropertiesService.getScriptProperties();
  return {
    spreadsheetId: p.getProperty('EMMS_SPREADSHEET_ID'),
    driveFolderId: p.getProperty('EMMS_DRIVE_FOLDER_ID'),
    webAppUrl: p.getProperty('EMMS_WEB_APP_URL') || '',
    initialized: p.getProperty('EMMS_INITIALIZED') === 'true'
  };
}

function assertConfigured_() {
  const c = getConfig_();
  if (!c.initialized || !c.spreadsheetId) {
    throw new Error('EMMS belum diinisialisasi. Jalankan setupEMMS("email-admin@gmail.com") dari Apps Script editor.');
  }
  return c;
}

function jsonSafe_(value) {
  return JSON.parse(JSON.stringify(value));
}
