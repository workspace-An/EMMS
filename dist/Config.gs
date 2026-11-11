/**
 * EMMS - Config.gs
 * Konstanta global, matriks hak akses (RBAC) dan kelas error aplikasi.
 * Catatan: file ini TIDAK boleh bergantung pada file lain saat load
 * (Apps Script memuat file berurutan; referensi lintas file hanya di dalam fungsi).
 */

const CFG = {
  APP_NAME: 'EMMS',
  VERSION: '1.6.0-phase7',

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
    'audit.view':       ['Admin', 'Maintenance Manager'],
    'inspection.view':   ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician', 'Viewer'],
    'inspection.create': ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician'],
    'inspection.review': ['Admin', 'Maintenance Manager', 'Supervisor'],
    'inspection.backdate': ['Admin', 'Maintenance Manager', 'Supervisor'],
    'checklist.manage':  ['Admin', 'Maintenance Manager'],
    'pm.view':          ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician', 'Viewer'],
    'pm.execute':       ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician'],
    'pm.schedule':      ['Admin', 'Maintenance Manager', 'Supervisor'],
    'pm.approve':       ['Admin', 'Maintenance Manager', 'Supervisor'],
    'cm.view':          ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician', 'Viewer'],
    'cm.report':        ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician'],
    'cm.work':          ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician'],
    'cm.assign':        ['Admin', 'Maintenance Manager', 'Supervisor'],
    'cm.close':         ['Admin', 'Maintenance Manager', 'Supervisor'],
    'wo.view':          ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician', 'Viewer'],
    'wo.create':        ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician'],
    'wo.work':          ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician'],
    'wo.approve':       ['Admin', 'Maintenance Manager', 'Supervisor'],
    'safety.view':      ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician', 'Viewer'],
    'safety.report':    ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician'],
    'safety.assess':    ['Admin', 'Maintenance Manager', 'Supervisor'],
    'safety.approve':   ['Admin', 'Maintenance Manager'],
    'safety.loto':      ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician'],
    'inventory.view':   ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician', 'Viewer'],
    'inventory.use':    ['Admin', 'Maintenance Manager', 'Supervisor', 'Technician'],
    'inventory.stock':  ['Admin', 'Maintenance Manager', 'Supervisor'],
    'inventory.manage': ['Admin', 'Maintenance Manager'],
    'approvals.view':   ['Admin', 'Maintenance Manager', 'Supervisor'],
    'automation.view':  ['Admin', 'Maintenance Manager'],
    'automation.manage': ['Admin']
  },

  // Kebijakan Phase 2
  INSPECTION_RESULTS: ['OK', 'NG', 'NA'],
  BACKDATE_MAX_DAYS: 7,
  CRITICAL_SETS_BREAKDOWN: true,   // temuan Critical -> status equipment otomatis Breakdown (false = Warning)
  CRITICAL_ALERT_ROLES: ['Supervisor', 'Maintenance Manager', 'Admin'],

  // Kebijakan Phase 3
  PM_FREQUENCIES: ['Weekly', 'Monthly', 'Quarterly', 'Semiannual', 'Yearly', 'Custom'],
  PM_RESULTS: ['Done', 'DoneWithFindings', 'Partial'],
  PM_BACKDATE_MAX_DAYS: 7,
  PM_DEFAULT_LEAD_DAYS: 7,

  // Kebijakan Phase 4
  PRIORITIES: ['Low', 'Medium', 'High', 'Critical'],
  REPAIR_RESULTS: ['Repaired', 'Temporary', 'NotRepaired'],
  CM_MAX_PHOTOS: 5,
  WO_MAX_TASKS: 20,
  WO_SOURCES: ['Inspection', 'PM', 'Corrective', 'Safety', 'Manual'],

  // Kebijakan Phase 5
  SAFETY_TYPES: ['UnsafeCondition', 'UnsafeAct', 'NearMiss', 'Incident', 'EquipmentHazard'],
  HAZARD_CATEGORIES: ['Grounding', 'Insulation', 'Overheating', 'Arc', 'ExposedLive', 'Protection', 'Labelling', 'Housekeeping', 'Other'],
  RISK_LEVELS: ['Low', 'Medium', 'High', 'Critical'],
  // Matriks 5x5: skor >= batas -> tingkat. Skor >= RISK_APPROVAL_MIN wajib disetujui Manager/Admin.
  RISK_THRESHOLDS: { Critical: 17, High: 10, Medium: 5 },
  RISK_APPROVAL_MIN: 10,
  SAFETY_MAX_PHOTOS: 5
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
