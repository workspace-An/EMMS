/**
 * EMMS - Schema.gs
 * Definisi SELURUH tabel (sheet) database. Satu sumber kebenaran untuk Setup,
 * Database layer, dan dokumen database/sheets-schema.md (digenerate oleh scripts/gen-schema-doc.js).
 *
 * Tipe kolom: (default) string | n = number | d = date (yyyy-MM-dd) | dt = datetime (yyyy-MM-dd HH:mm:ss) | b = boolean
 * Setiap tabel otomatis mendapat kolom umum: CreatedAt, CreatedBy, UpdatedAt, UpdatedBy, Status.
 * `Status` = status record (Active/Inactive/Deleted) untuk tabel master, atau status alur kerja untuk tabel transaksi.
 */

const COMMON_COLS = ['CreatedAt:dt', 'CreatedBy', 'UpdatedAt:dt', 'UpdatedBy', 'Status'];

const SCHEMA = {
  SETTINGS: {
    pk: 'SettingKey', prefix: null, tab: '#64748b',
    desc: 'Pengaturan aplikasi (key-value).',
    fk: '-',
    cols: ['SettingValue', 'Description', 'Category']
  },
  USERS: {
    pk: 'UserID', prefix: 'USR', tab: '#0b2a4a',
    desc: 'Daftar email yang diizinkan mengakses aplikasi beserta role.',
    fk: '-',
    cols: ['FullName', 'Email', 'Role', 'Department', 'Language', 'LastLoginAt:dt']
  },
  FACTORIES: {
    pk: 'FactoryID', prefix: 'FAC', tab: '#0b2a4a',
    desc: 'Data pabrik (master).',
    fk: '-',
    cols: ['FactoryName', 'Address', 'Description']
  },
  BUILDINGS: {
    pk: 'BuildingID', prefix: 'BLD', tab: '#0b2a4a',
    desc: 'Gedung dalam pabrik.',
    fk: 'FactoryID -> FACTORIES.FactoryID',
    cols: ['FactoryID', 'BuildingName', 'Description']
  },
  LOCATIONS: {
    pk: 'LocationID', prefix: 'LOC', tab: '#0b2a4a',
    desc: 'Lokasi/ruangan/area produksi di dalam gedung.',
    fk: 'BuildingID -> BUILDINGS.BuildingID',
    cols: ['BuildingID', 'LocationName', 'ProductionArea', 'Description']
  },
  EQUIPMENT_CATEGORIES: {
    pk: 'CategoryID', prefix: 'CAT', tab: '#0b2a4a',
    desc: 'Kategori equipment kelistrikan (MDP, SDP, MCC, dst).',
    fk: '-',
    cols: ['CategoryName', 'Code', 'Description', 'InspectionType']
  },
  EQUIPMENT: {
    pk: 'EquipmentID', prefix: 'EQ', tab: '#1e6fd9',
    desc: 'Master equipment kelistrikan. EquipmentStatus = Normal/Warning/Breakdown; Condition = Good/Fair/Poor.',
    fk: 'CategoryID -> EQUIPMENT_CATEGORIES; BuildingID -> BUILDINGS; LocationID -> LOCATIONS; PhotoFileID -> ATTACHMENTS.DriveFileID',
    cols: ['EquipmentName', 'CategoryID', 'BuildingID', 'LocationID', 'ProductionArea', 'Brand', 'Model',
      'SerialNumber', 'ElectricalSpec', 'Voltage', 'Current', 'PowerRating', 'InstallationDate:d',
      'CommissioningDate:d', 'Condition', 'EquipmentStatus', 'PhotoFileID', 'Notes']
  },
  EQUIPMENT_QR_CODES: {
    pk: 'QRID', prefix: 'QR', tab: '#1e6fd9',
    desc: 'Riwayat QR Code tiap equipment (versi). QR hanya berisi URL; gambar dibuat di browser.',
    fk: 'EquipmentID -> EQUIPMENT.EquipmentID',
    cols: ['EquipmentID', 'QRPayload', 'Version:n']
  },
  DAILY_INSPECTIONS: {
    pk: 'InspectionID', prefix: 'INS', tab: '#16a34a',
    desc: 'Header inspeksi harian. OverallResult: OK/NG/Critical. Status: Completed (semua OK) | Open (ada NG, menunggu review) | Reviewed.',
    fk: 'EquipmentID -> EQUIPMENT; WorkOrderID -> WORK_ORDERS',
    cols: ['EquipmentID', 'InspectionDate:d', 'InspectionTime', 'TechnicianEmail', 'TechnicianName', 'OverallResult',
      'NGCount:n', 'CriticalCount:n', 'Remarks', 'Finding', 'Recommendation', 'ReviewedBy', 'ReviewedAt:dt',
      'ReviewRemarks', 'WorkOrderID']
  },
  INSPECTION_CHECKLISTS: {
    pk: 'ChecklistID', prefix: 'CHK', tab: '#16a34a',
    desc: 'Template item checklist per kategori equipment. ItemType: check (OK/NG/N/A) | measure (angka + batas min/maks). ItemKey = kunci terjemahan item bawaan.',
    fk: 'CategoryID -> EQUIPMENT_CATEGORIES',
    cols: ['CategoryID', 'ItemNo:n', 'ItemKey', 'ItemName', 'ItemType', 'Unit', 'MinValue:n', 'MaxValue:n', 'IsCritical:b']
  },
  INSPECTION_RESULTS: {
    pk: 'ResultID', prefix: 'RES', tab: '#16a34a',
    desc: 'Hasil tiap item checklist: Result OK/NG/NA. Atribut item disalin (snapshot) agar riwayat tetap valid walau checklist diubah.',
    fk: 'InspectionID -> DAILY_INSPECTIONS; ChecklistID -> INSPECTION_CHECKLISTS',
    cols: ['InspectionID', 'ChecklistID', 'ItemNo:n', 'ItemKey', 'ItemName', 'ItemType', 'Unit', 'MinValue:n', 'MaxValue:n',
      'IsCritical:b', 'Result', 'MeasurementValue:n', 'Remarks', 'PhotoFileID']
  },
  PM_SCHEDULES: {
    pk: 'PMScheduleID', prefix: 'PMS', tab: '#f59e0b',
    desc: 'Jadwal preventive maintenance (Phase 3). Status: Active/Inactive.',
    fk: 'EquipmentID -> EQUIPMENT',
    cols: ['EquipmentID', 'PMTitle', 'Frequency', 'ScheduleRule', 'AssignedTechnician', 'StartDate:d', 'NextDueDate:d',
      'LastDoneDate:d', 'CalendarEventID', 'Instructions']
  },
  PREVENTIVE_MAINTENANCE: {
    pk: 'PMID', prefix: 'PM', tab: '#f59e0b',
    desc: 'Pelaksanaan PM (Phase 3). Status: Completed. ApprovalStatus: Pending/Approved/Rejected. MaintenanceResult: Done/DoneWithFindings/Partial.',
    fk: 'PMScheduleID -> PM_SCHEDULES; EquipmentID -> EQUIPMENT',
    cols: ['PMScheduleID', 'EquipmentID', 'PMTitle', 'PlannedDate:d', 'ActualDate:d', 'StartTime', 'FinishTime', 'Technician',
      'TechnicianEmail', 'MaintenanceResult', 'MeasurementBefore', 'MeasurementAfter', 'PhotoBeforeID', 'PhotoAfterID',
      'ApprovalStatus', 'ApprovedBy', 'ApprovedAt:dt', 'ApprovalRemarks', 'Remarks', 'WorkOrderID']
  },
  CORRECTIVE_MAINTENANCE: {
    pk: 'ComplaintNo', prefix: 'CM', tab: '#ef4444',
    desc: 'Laporan kerusakan & perbaikan (Phase 4). Status: Open/In Progress/Pending/Completed/Closed.',
    fk: 'EquipmentID -> EQUIPMENT; WorkOrderID -> WORK_ORDERS',
    cols: ['EquipmentID', 'ProblemDescription', 'DateReported:d', 'ReportedBy', 'Priority', 'RootCause', 'CorrectiveAction',
      'AssignedTechnician', 'SparePartUsed', 'StartTime', 'FinishTime', 'PhotoEvidenceIDs', 'RepairResult', 'WorkOrderID',
      'ReportedByEmail', 'CompletedBy', 'ClosedBy', 'ClosedAt:dt', 'CloseRemarks']
  },
  WORK_ORDERS: {
    pk: 'WorkOrderID', prefix: 'WO', tab: '#ef4444',
    desc: 'Work Order (Phase 4). SourceType: Inspection/PM/Corrective/Safety/Manual. Status: Requested/Approved/In Progress/Completed/Closed/Rejected/Cancelled.',
    fk: 'EquipmentID -> EQUIPMENT; SourceID -> (tabel sesuai SourceType)',
    cols: ['SourceType', 'SourceID', 'EquipmentID', 'Title', 'Description', 'Priority', 'RequestedBy', 'AssignedTo',
      'PlannedDate:d', 'DueDate:d', 'ApprovalStatus', 'ResultNotes', 'VerifiedBy', 'ClosedAt:dt',
      'RequestedByEmail', 'ApprovedBy', 'ApprovedAt:dt', 'ApprovalRemarks', 'StartedAt:dt', 'CompletedBy', 'CompletedAt:dt']
  },
  WORK_ORDER_TASKS: {
    pk: 'TaskID', prefix: 'WOT', tab: '#ef4444',
    desc: 'Rincian tugas dalam Work Order (Phase 4).',
    fk: 'WorkOrderID -> WORK_ORDERS',
    cols: ['WorkOrderID', 'TaskNo:n', 'TaskDescription', 'IsDone:b', 'DoneBy', 'DoneAt:dt', 'Remarks']
  },
  ELECTRICAL_SAFETY: {
    pk: 'SafetyID', prefix: 'SAF', tab: '#7c3aed',
    desc: 'Temuan & inspeksi K3 listrik (Phase 5).',
    fk: 'EquipmentID -> EQUIPMENT; WorkOrderID -> WORK_ORDERS',
    cols: ['EquipmentID', 'SafetyType', 'ReportType', 'Description', 'RiskLevel', 'ReportedBy', 'ReportDate:d',
      'ActionRequired', 'ActionTaken', 'PhotoFileIDs', 'WorkOrderID']
  },
  RISK_ASSESSMENTS: {
    pk: 'RiskID', prefix: 'RSK', tab: '#7c3aed',
    desc: 'Penilaian risiko (Phase 5). RiskLevel: Low/Medium/High/Critical.',
    fk: 'SafetyID -> ELECTRICAL_SAFETY; WorkOrderID -> WORK_ORDERS',
    cols: ['SafetyID', 'WorkOrderID', 'Hazard', 'Likelihood:n', 'Severity:n', 'RiskScore:n', 'RiskLevel', 'Controls',
      'RequiresApproval:b', 'ApprovedBy']
  },
  LOTO_RECORDS: {
    pk: 'LOTOID', prefix: 'LOTO', tab: '#7c3aed',
    desc: 'Catatan Lock Out Tag Out (Phase 5).',
    fk: 'WorkOrderID -> WORK_ORDERS; EquipmentID -> EQUIPMENT',
    cols: ['WorkOrderID', 'EquipmentID', 'IsolationPoints', 'LockNo', 'AppliedBy', 'AppliedAt:dt', 'RemovedBy',
      'RemovedAt:dt', 'VerificationNotes']
  },
  SPARE_PARTS: {
    pk: 'ItemCode', prefix: 'SP', tab: '#0891b2',
    desc: 'Master spare part (Phase 6).',
    fk: '-',
    cols: ['ItemName', 'Category', 'Brand', 'Specification', 'Unit', 'CurrentStock:n', 'MinimumStock:n', 'StorageLocation', 'Supplier']
  },
  INVENTORY_TRANSACTIONS: {
    pk: 'TransactionID', prefix: 'TRX', tab: '#0891b2',
    desc: 'Mutasi stok (Phase 6). TransactionType: IN/OUT/ADJUST.',
    fk: 'ItemCode -> SPARE_PARTS; ReferenceID -> WORK_ORDERS (bila ReferenceType=WO)',
    cols: ['ItemCode', 'TransactionType', 'Quantity:n', 'StockBefore:n', 'StockAfter:n', 'ReferenceType', 'ReferenceID', 'Remarks']
  },
  APPROVALS: {
    pk: 'ApprovalID', prefix: 'APR', tab: '#64748b',
    desc: 'Riwayat approval & tanda tangan digital sederhana (Phase 7).',
    fk: 'RefType + RefID -> tabel terkait',
    cols: ['RefType', 'RefID', 'ApprovalLevel:n', 'ApproverRole', 'ApprovedBy', 'ApprovalDate:dt', 'Decision', 'Remarks', 'SignatureHash']
  },
  ATTACHMENTS: {
    pk: 'AttachmentID', prefix: 'ATT', tab: '#64748b',
    desc: 'Metadata file di Google Drive (foto/dokumen). File privat; dibaca via backend.',
    fk: 'RefType + RefID -> tabel terkait',
    cols: ['RefType', 'RefID', 'DriveFileID', 'FileName', 'MimeType', 'FileSize:n', 'Caption']
  },
  NOTIFICATIONS: {
    pk: 'NotificationID', prefix: 'NTF', tab: '#64748b',
    desc: 'Log notifikasi email (Phase 7).',
    fk: 'RefType + RefID -> tabel terkait',
    cols: ['NotificationType', 'RecipientEmail', 'Subject', 'RefType', 'RefID', 'SentAt:dt', 'DeliveryStatus', 'ErrorMessage']
  },
  AUDIT_LOG: {
    pk: 'AuditID', prefix: 'AUD', tab: '#334155',
    desc: 'Catatan audit append-only seluruh aktivitas penting.',
    fk: 'Entity + EntityID -> tabel terkait',
    cols: ['EventTime:dt', 'UserEmail', 'UserRole', 'Action', 'Entity', 'EntityID', 'Details', 'Result']
  },
  SESSIONS: {
    pk: 'SessionID', prefix: 'SES', tab: '#334155', hidden: true,
    desc: 'Tambahan sistem: sesi login (hanya hash token). Sheet tersembunyi; jangan diedit manual.',
    fk: 'Email -> USERS.Email',
    cols: ['TokenHash', 'Email', 'ExpiresAt:dt', 'LastUsedAt:dt', 'Device', 'Revoked:b']
  }
};

const SHEET_ORDER = ['SETTINGS', 'USERS', 'FACTORIES', 'BUILDINGS', 'LOCATIONS', 'EQUIPMENT_CATEGORIES', 'EQUIPMENT',
  'EQUIPMENT_QR_CODES', 'DAILY_INSPECTIONS', 'INSPECTION_CHECKLISTS', 'INSPECTION_RESULTS', 'PM_SCHEDULES',
  'PREVENTIVE_MAINTENANCE', 'CORRECTIVE_MAINTENANCE', 'WORK_ORDERS', 'WORK_ORDER_TASKS', 'ELECTRICAL_SAFETY',
  'RISK_ASSESSMENTS', 'LOTO_RECORDS', 'SPARE_PARTS', 'INVENTORY_TRANSACTIONS', 'APPROVALS', 'ATTACHMENTS',
  'NOTIFICATIONS', 'AUDIT_LOG', 'SESSIONS'];

const Schema = {
  /** Daftar kolom lengkap [{name,type}] : PK + kolom spesifik + kolom umum. */
  columns: function (name) {
    const def = SCHEMA[name];
    if (!def) throw new Error('Unknown sheet: ' + name);
    return [def.pk].concat(def.cols).concat(COMMON_COLS).map(function (spec) {
      const p = String(spec).split(':');
      return { name: p[0], type: p[1] || 's' };
    });
  },
  /** Peta nama kolom -> tipe. */
  types: function (name) {
    const m = {};
    Schema.columns(name).forEach(function (c) { m[c.name] = c.type; });
    return m;
  }
};
