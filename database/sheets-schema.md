# Skema Database EMMS (Google Sheets)

> Digenerate otomatis dari `apps-script/Schema.gs` dengan `npm run docs`. Jangan diedit manual.

Semua sel diformat **teks** dan ditulis sebagai string. Tipe di bawah adalah tipe logis yang dikonversi saat dibaca. Setiap tabel memiliki kolom umum: `CreatedAt`, `CreatedBy`, `UpdatedAt`, `UpdatedBy`, `Status`. Sheet `SESSIONS` adalah tambahan sistem di luar 25 sheet yang diminta (menyimpan hash token login).

## Daftar tabel

| # | Sheet | PK | Relasi (FK) | Fungsi |
|---|---|---|---|---|
| 1 | SETTINGS | SettingKey | - | Pengaturan aplikasi (key-value). |
| 2 | USERS | UserID | - | Daftar email yang diizinkan mengakses aplikasi beserta role. |
| 3 | FACTORIES | FactoryID | - | Data pabrik (master). |
| 4 | BUILDINGS | BuildingID | FactoryID -> FACTORIES.FactoryID | Gedung dalam pabrik. |
| 5 | LOCATIONS | LocationID | BuildingID -> BUILDINGS.BuildingID | Lokasi/ruangan/area produksi di dalam gedung. |
| 6 | EQUIPMENT_CATEGORIES | CategoryID | - | Kategori equipment kelistrikan (MDP, SDP, MCC, dst). |
| 7 | EQUIPMENT | EquipmentID | CategoryID -> EQUIPMENT_CATEGORIES; BuildingID -> BUILDINGS; LocationID -> LOCATIONS; PhotoFileID -> ATTACHMENTS.DriveFileID | Master equipment kelistrikan. EquipmentStatus = Normal/Warning/Breakdown; Condition = Good/Fair/Poor. |
| 8 | EQUIPMENT_QR_CODES | QRID | EquipmentID -> EQUIPMENT.EquipmentID | Riwayat QR Code tiap equipment (versi). QR hanya berisi URL; gambar dibuat di browser. |
| 9 | DAILY_INSPECTIONS | InspectionID | EquipmentID -> EQUIPMENT; WorkOrderID -> WORK_ORDERS | Header inspeksi harian (Phase 2). Status: Draft/Submitted/Reviewed. |
| 10 | INSPECTION_CHECKLISTS | ChecklistID | CategoryID -> EQUIPMENT_CATEGORIES | Template item checklist per kategori equipment (Phase 2). |
| 11 | INSPECTION_RESULTS | ResultID | InspectionID -> DAILY_INSPECTIONS; ChecklistID -> INSPECTION_CHECKLISTS | Hasil tiap item checklist (OK/NG/N/A) (Phase 2). |
| 12 | PM_SCHEDULES | PMScheduleID | EquipmentID -> EQUIPMENT | Jadwal preventive maintenance (Phase 3). Status: Active/Inactive. |
| 13 | PREVENTIVE_MAINTENANCE | PMID | PMScheduleID -> PM_SCHEDULES; EquipmentID -> EQUIPMENT | Pelaksanaan PM (Phase 3). |
| 14 | CORRECTIVE_MAINTENANCE | ComplaintNo | EquipmentID -> EQUIPMENT; WorkOrderID -> WORK_ORDERS | Laporan kerusakan & perbaikan (Phase 4). Status: Open/In Progress/Pending/Completed/Closed. |
| 15 | WORK_ORDERS | WorkOrderID | EquipmentID -> EQUIPMENT; SourceID -> (tabel sesuai SourceType) | Work Order (Phase 4). SourceType: Inspection/PM/Corrective/Safety. |
| 16 | WORK_ORDER_TASKS | TaskID | WorkOrderID -> WORK_ORDERS | Rincian tugas dalam Work Order (Phase 4). |
| 17 | ELECTRICAL_SAFETY | SafetyID | EquipmentID -> EQUIPMENT; WorkOrderID -> WORK_ORDERS | Temuan & inspeksi K3 listrik (Phase 5). |
| 18 | RISK_ASSESSMENTS | RiskID | SafetyID -> ELECTRICAL_SAFETY; WorkOrderID -> WORK_ORDERS | Penilaian risiko (Phase 5). RiskLevel: Low/Medium/High/Critical. |
| 19 | LOTO_RECORDS | LOTOID | WorkOrderID -> WORK_ORDERS; EquipmentID -> EQUIPMENT | Catatan Lock Out Tag Out (Phase 5). |
| 20 | SPARE_PARTS | ItemCode | - | Master spare part (Phase 6). |
| 21 | INVENTORY_TRANSACTIONS | TransactionID | ItemCode -> SPARE_PARTS; ReferenceID -> WORK_ORDERS (bila ReferenceType=WO) | Mutasi stok (Phase 6). TransactionType: IN/OUT/ADJUST. |
| 22 | APPROVALS | ApprovalID | RefType + RefID -> tabel terkait | Riwayat approval & tanda tangan digital sederhana (Phase 7). |
| 23 | ATTACHMENTS | AttachmentID | RefType + RefID -> tabel terkait | Metadata file di Google Drive (foto/dokumen). File privat; dibaca via backend. |
| 24 | NOTIFICATIONS | NotificationID | RefType + RefID -> tabel terkait | Log notifikasi email (Phase 7). |
| 25 | AUDIT_LOG | AuditID | Entity + EntityID -> tabel terkait | Catatan audit append-only seluruh aktivitas penting. |
| 26 | SESSIONS | SessionID | Email -> USERS.Email | Tambahan sistem: sesi login (hanya hash token). Sheet tersembunyi; jangan diedit manual. |

## Diagram relasi (inti)

```
FACTORIES 1--* BUILDINGS 1--* LOCATIONS 1--* EQUIPMENT *--1 EQUIPMENT_CATEGORIES
EQUIPMENT 1--* EQUIPMENT_QR_CODES
EQUIPMENT 1--* DAILY_INSPECTIONS 1--* INSPECTION_RESULTS *--1 INSPECTION_CHECKLISTS *--1 EQUIPMENT_CATEGORIES
EQUIPMENT 1--* PM_SCHEDULES 1--* PREVENTIVE_MAINTENANCE
EQUIPMENT 1--* CORRECTIVE_MAINTENANCE
EQUIPMENT 1--* WORK_ORDERS 1--* WORK_ORDER_TASKS
WORK_ORDERS *--* (Inspection | PM | Corrective | Safety)  via SourceType+SourceID
ELECTRICAL_SAFETY 1--* RISK_ASSESSMENTS ;  WORK_ORDERS 1--* LOTO_RECORDS
SPARE_PARTS 1--* INVENTORY_TRANSACTIONS (ReferenceID -> WORK_ORDERS)
APPROVALS / ATTACHMENTS / NOTIFICATIONS / AUDIT_LOG -> RefType+RefID (polimorfik)
USERS 1--* SESSIONS (Email)
```

## SETTINGS

Pengaturan aplikasi (key-value).

| Kolom | Tipe | Keterangan |
|---|---|---|
| SettingKey | text | Primary key |
| SettingValue | text |  |
| Description | text |  |
| Category | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## USERS

Daftar email yang diizinkan mengakses aplikasi beserta role.

| Kolom | Tipe | Keterangan |
|---|---|---|
| UserID | text | Primary key |
| FullName | text |  |
| Email | text |  |
| Role | text |  |
| Department | text |  |
| Language | text |  |
| LastLoginAt | datetime |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## FACTORIES

Data pabrik (master).

| Kolom | Tipe | Keterangan |
|---|---|---|
| FactoryID | text | Primary key |
| FactoryName | text |  |
| Address | text |  |
| Description | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## BUILDINGS

Gedung dalam pabrik.

| Kolom | Tipe | Keterangan |
|---|---|---|
| BuildingID | text | Primary key |
| FactoryID | text |  |
| BuildingName | text |  |
| Description | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## LOCATIONS

Lokasi/ruangan/area produksi di dalam gedung.

| Kolom | Tipe | Keterangan |
|---|---|---|
| LocationID | text | Primary key |
| BuildingID | text |  |
| LocationName | text |  |
| ProductionArea | text |  |
| Description | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## EQUIPMENT_CATEGORIES

Kategori equipment kelistrikan (MDP, SDP, MCC, dst).

| Kolom | Tipe | Keterangan |
|---|---|---|
| CategoryID | text | Primary key |
| CategoryName | text |  |
| Code | text |  |
| Description | text |  |
| InspectionType | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## EQUIPMENT

Master equipment kelistrikan. EquipmentStatus = Normal/Warning/Breakdown; Condition = Good/Fair/Poor.

| Kolom | Tipe | Keterangan |
|---|---|---|
| EquipmentID | text | Primary key |
| EquipmentName | text |  |
| CategoryID | text |  |
| BuildingID | text |  |
| LocationID | text |  |
| ProductionArea | text |  |
| Brand | text |  |
| Model | text |  |
| SerialNumber | text |  |
| ElectricalSpec | text |  |
| Voltage | text |  |
| Current | text |  |
| PowerRating | text |  |
| InstallationDate | date |  |
| CommissioningDate | date |  |
| Condition | text |  |
| EquipmentStatus | text |  |
| PhotoFileID | text |  |
| Notes | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## EQUIPMENT_QR_CODES

Riwayat QR Code tiap equipment (versi). QR hanya berisi URL; gambar dibuat di browser.

| Kolom | Tipe | Keterangan |
|---|---|---|
| QRID | text | Primary key |
| EquipmentID | text |  |
| QRPayload | text |  |
| Version | number |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## DAILY_INSPECTIONS

Header inspeksi harian (Phase 2). Status: Draft/Submitted/Reviewed.

| Kolom | Tipe | Keterangan |
|---|---|---|
| InspectionID | text | Primary key |
| EquipmentID | text |  |
| InspectionDate | date |  |
| InspectionTime | text |  |
| TechnicianEmail | text |  |
| TechnicianName | text |  |
| OverallResult | text |  |
| Remarks | text |  |
| Finding | text |  |
| Recommendation | text |  |
| WorkOrderID | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## INSPECTION_CHECKLISTS

Template item checklist per kategori equipment (Phase 2).

| Kolom | Tipe | Keterangan |
|---|---|---|
| ChecklistID | text | Primary key |
| CategoryID | text |  |
| ItemNo | number |  |
| ItemName | text |  |
| ItemType | text |  |
| Unit | text |  |
| MinValue | number |  |
| MaxValue | number |  |
| IsCritical | boolean |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## INSPECTION_RESULTS

Hasil tiap item checklist (OK/NG/N/A) (Phase 2).

| Kolom | Tipe | Keterangan |
|---|---|---|
| ResultID | text | Primary key |
| InspectionID | text |  |
| ChecklistID | text |  |
| Result | text |  |
| MeasurementValue | text |  |
| Remarks | text |  |
| PhotoFileID | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## PM_SCHEDULES

Jadwal preventive maintenance (Phase 3). Status: Active/Inactive.

| Kolom | Tipe | Keterangan |
|---|---|---|
| PMScheduleID | text | Primary key |
| EquipmentID | text |  |
| PMTitle | text |  |
| Frequency | text |  |
| ScheduleRule | text |  |
| AssignedTechnician | text |  |
| StartDate | date |  |
| NextDueDate | date |  |
| LastDoneDate | date |  |
| CalendarEventID | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## PREVENTIVE_MAINTENANCE

Pelaksanaan PM (Phase 3).

| Kolom | Tipe | Keterangan |
|---|---|---|
| PMID | text | Primary key |
| PMScheduleID | text |  |
| EquipmentID | text |  |
| PlannedDate | date |  |
| ActualDate | date |  |
| StartTime | text |  |
| FinishTime | text |  |
| Technician | text |  |
| MaintenanceResult | text |  |
| MeasurementBefore | text |  |
| MeasurementAfter | text |  |
| PhotoBeforeID | text |  |
| PhotoAfterID | text |  |
| ApprovalStatus | text |  |
| Remarks | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## CORRECTIVE_MAINTENANCE

Laporan kerusakan & perbaikan (Phase 4). Status: Open/In Progress/Pending/Completed/Closed.

| Kolom | Tipe | Keterangan |
|---|---|---|
| ComplaintNo | text | Primary key |
| EquipmentID | text |  |
| ProblemDescription | text |  |
| DateReported | date |  |
| ReportedBy | text |  |
| Priority | text |  |
| RootCause | text |  |
| CorrectiveAction | text |  |
| AssignedTechnician | text |  |
| SparePartUsed | text |  |
| StartTime | text |  |
| FinishTime | text |  |
| PhotoEvidenceIDs | text |  |
| RepairResult | text |  |
| WorkOrderID | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## WORK_ORDERS

Work Order (Phase 4). SourceType: Inspection/PM/Corrective/Safety.

| Kolom | Tipe | Keterangan |
|---|---|---|
| WorkOrderID | text | Primary key |
| SourceType | text |  |
| SourceID | text |  |
| EquipmentID | text |  |
| Title | text |  |
| Description | text |  |
| Priority | text |  |
| RequestedBy | text |  |
| AssignedTo | text |  |
| PlannedDate | date |  |
| DueDate | date |  |
| ApprovalStatus | text |  |
| ResultNotes | text |  |
| VerifiedBy | text |  |
| ClosedAt | datetime |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## WORK_ORDER_TASKS

Rincian tugas dalam Work Order (Phase 4).

| Kolom | Tipe | Keterangan |
|---|---|---|
| TaskID | text | Primary key |
| WorkOrderID | text |  |
| TaskNo | number |  |
| TaskDescription | text |  |
| IsDone | boolean |  |
| DoneBy | text |  |
| DoneAt | datetime |  |
| Remarks | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## ELECTRICAL_SAFETY

Temuan & inspeksi K3 listrik (Phase 5).

| Kolom | Tipe | Keterangan |
|---|---|---|
| SafetyID | text | Primary key |
| EquipmentID | text |  |
| SafetyType | text |  |
| ReportType | text |  |
| Description | text |  |
| RiskLevel | text |  |
| ReportedBy | text |  |
| ReportDate | date |  |
| ActionRequired | text |  |
| ActionTaken | text |  |
| PhotoFileIDs | text |  |
| WorkOrderID | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## RISK_ASSESSMENTS

Penilaian risiko (Phase 5). RiskLevel: Low/Medium/High/Critical.

| Kolom | Tipe | Keterangan |
|---|---|---|
| RiskID | text | Primary key |
| SafetyID | text |  |
| WorkOrderID | text |  |
| Hazard | text |  |
| Likelihood | number |  |
| Severity | number |  |
| RiskScore | number |  |
| RiskLevel | text |  |
| Controls | text |  |
| RequiresApproval | boolean |  |
| ApprovedBy | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## LOTO_RECORDS

Catatan Lock Out Tag Out (Phase 5).

| Kolom | Tipe | Keterangan |
|---|---|---|
| LOTOID | text | Primary key |
| WorkOrderID | text |  |
| EquipmentID | text |  |
| IsolationPoints | text |  |
| LockNo | text |  |
| AppliedBy | text |  |
| AppliedAt | datetime |  |
| RemovedBy | text |  |
| RemovedAt | datetime |  |
| VerificationNotes | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## SPARE_PARTS

Master spare part (Phase 6).

| Kolom | Tipe | Keterangan |
|---|---|---|
| ItemCode | text | Primary key |
| ItemName | text |  |
| Category | text |  |
| Brand | text |  |
| Specification | text |  |
| Unit | text |  |
| CurrentStock | number |  |
| MinimumStock | number |  |
| StorageLocation | text |  |
| Supplier | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## INVENTORY_TRANSACTIONS

Mutasi stok (Phase 6). TransactionType: IN/OUT/ADJUST.

| Kolom | Tipe | Keterangan |
|---|---|---|
| TransactionID | text | Primary key |
| ItemCode | text |  |
| TransactionType | text |  |
| Quantity | number |  |
| StockBefore | number |  |
| StockAfter | number |  |
| ReferenceType | text |  |
| ReferenceID | text |  |
| Remarks | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## APPROVALS

Riwayat approval & tanda tangan digital sederhana (Phase 7).

| Kolom | Tipe | Keterangan |
|---|---|---|
| ApprovalID | text | Primary key |
| RefType | text |  |
| RefID | text |  |
| ApprovalLevel | number |  |
| ApproverRole | text |  |
| ApprovedBy | text |  |
| ApprovalDate | datetime |  |
| Decision | text |  |
| Remarks | text |  |
| SignatureHash | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## ATTACHMENTS

Metadata file di Google Drive (foto/dokumen). File privat; dibaca via backend.

| Kolom | Tipe | Keterangan |
|---|---|---|
| AttachmentID | text | Primary key |
| RefType | text |  |
| RefID | text |  |
| DriveFileID | text |  |
| FileName | text |  |
| MimeType | text |  |
| FileSize | number |  |
| Caption | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## NOTIFICATIONS

Log notifikasi email (Phase 7).

| Kolom | Tipe | Keterangan |
|---|---|---|
| NotificationID | text | Primary key |
| NotificationType | text |  |
| RecipientEmail | text |  |
| Subject | text |  |
| RefType | text |  |
| RefID | text |  |
| SentAt | datetime |  |
| DeliveryStatus | text |  |
| ErrorMessage | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## AUDIT_LOG

Catatan audit append-only seluruh aktivitas penting.

| Kolom | Tipe | Keterangan |
|---|---|---|
| AuditID | text | Primary key |
| EventTime | datetime |  |
| UserEmail | text |  |
| UserRole | text |  |
| Action | text |  |
| Entity | text |  |
| EntityID | text |  |
| Details | text |  |
| Result | text |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

## SESSIONS

Tambahan sistem: sesi login (hanya hash token). Sheet tersembunyi; jangan diedit manual.

| Kolom | Tipe | Keterangan |
|---|---|---|
| SessionID | text | Primary key |
| TokenHash | text |  |
| Email | text |  |
| ExpiresAt | datetime |  |
| LastUsedAt | datetime |  |
| Device | text |  |
| Revoked | boolean |  |
| CreatedAt | datetime |  |
| CreatedBy | text |  |
| UpdatedAt | datetime |  |
| UpdatedBy | text |  |
| Status | text |  |

