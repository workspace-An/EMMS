/**
 * EMMS - Config.gs
 * Konstanta global, matriks hak akses (RBAC) dan kelas error aplikasi.
 * Catatan: file ini TIDAK boleh bergantung pada file lain saat load
 * (Apps Script memuat file berurutan; referensi lintas file hanya di dalam fungsi).
 */

const CFG = {
  APP_NAME: 'EMMS',
  VERSION: '1.0.0-phase1',

  // Kunci Script Properties
  SS_ID_PROP: 'EMMS_SS_ID',
  SALT_PROP: 'EMMS_SALT',
  DRIVE_ROOT_PROP: 'EMMS_DRIVE_ROOT_ID',

  // Autentikasi (email OTP + session token)
  SESSION_DAYS_DEFAULT: 30,
  OTP_TTL_SEC: 600,                 // kode berlaku 10 menit
  OTP_MAX_ATTEMPTS: 5,              // salah maksimal 5x per kode
  OTP_MAX_REQUESTS_PER_HOUR: 5,     // permintaan kode per email per jam
  OTP_UNKNOWN_LOG_PER_HOUR: 20,     // batas pencatatan audit email tak dikenal (anti-flooding)
  MIN_MAIL_QUOTA: 5,                // sisa kuota email harian minimum sebelum menolak kirim OTP

  // Upload
  MAX_PHOTO_BYTES: 5 * 1024 * 1024,

  LANGS: ['id', 'en', 'zh'],
  ROLES: ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician', 'Viewer'],
  CONDITIONS: ['Good', 'Fair', 'Poor'],
  EQUIPMENT_STATUSES: ['Normal', 'Warning', 'Breakdown'],
  RECORD_STATUSES: ['Active', 'Inactive', 'Deleted'],

  // Matriks hak akses. Dicek di BACKEND pada setiap pemanggilan api().
  PERMISSIONS: {
    'dashboard.view':   ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician', 'Viewer'],
    'equipment.view':   ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician', 'Viewer'],
    'equipment.create': ['Admin', 'Maintenance Manager', 'Supervisor'],
    'equipment.edit':   ['Admin', 'Maintenance Manager', 'Supervisor'],
    'equipment.delete': ['Admin', 'Maintenance Manager'],
    'equipment.restore': ['Admin'],
    'master.view':      ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician', 'Viewer'],
    'master.manage':    ['Admin', 'Maintenance Manager'],
    'users.view':       ['Admin', 'Maintenance Manager'],
    'users.manage':     ['Admin'],
    'settings.view':    ['Admin', 'Maintenance Manager'],
    'settings.edit':    ['Admin'],
    'audit.view':       ['Admin', 'Maintenance Manager']
  }
};

/**
 * Error terstruktur. `code` dipetakan ke pesan multi-bahasa di frontend.
 * details: { rule, field, errors:[{field, rule}] }  -> diterjemahkan di frontend.
 */
class AppError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.name = 'AppError';
    this.code = code;
    this.details = details || null;
  }
}

function validationError_(errors) {
  return new AppError('VALIDATION', 'Validation failed', { errors: errors });
}
