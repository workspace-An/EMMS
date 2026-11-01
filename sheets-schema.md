# EMMS Phase 1 — Google Sheets Schema

Semua tabel menggunakan header pada baris pertama. ID menjadi primary key logis; jangan menggunakan nomor baris sebagai relasi.

| Sheet | Primary ID | Relasi utama |
|---|---|---|
| SETTINGS | SettingKey | Konfigurasi global |
| USERS | UserID | Email unik; Role menentukan izin |
| FACTORIES | FactoryID | Parent BUILDINGS |
| BUILDINGS | BuildingID | FactoryID → FACTORIES |
| LOCATIONS | LocationID | BuildingID → BUILDINGS |
| EQUIPMENT_CATEGORIES | CategoryID | Referensi EQUIPMENT |
| EQUIPMENT | EquipmentID | CategoryID, BuildingID, LocationID |
| EQUIPMENT_QR_CODES | QRCodeID | EquipmentID → EQUIPMENT |
| AUDIT_LOG | AuditID | ActorEmail → USERS.Email; EntityID → record terkait |

## Header

- SETTINGS: SettingKey, SettingValue, Description, UpdatedAt
- USERS: UserID, FullName, Email, Role, Department, Status, CreatedAt, UpdatedAt, CreatedBy, UpdatedBy
- FACTORIES: FactoryID, FactoryName, Address, Status, CreatedAt, UpdatedAt, CreatedBy, UpdatedBy
- BUILDINGS: BuildingID, FactoryID, BuildingName, Description, Status, CreatedAt, UpdatedAt, CreatedBy, UpdatedBy
- LOCATIONS: LocationID, BuildingID, LocationName, ProductionArea, Description, Status, CreatedAt, UpdatedAt, CreatedBy, UpdatedBy
- EQUIPMENT_CATEGORIES: CategoryID, CategoryName, Description, Status, CreatedAt, UpdatedAt, CreatedBy, UpdatedBy
- EQUIPMENT: EquipmentID, EquipmentName, CategoryID, BuildingID, LocationID, ProductionArea, Brand, Model, SerialNumber, ElectricalSpecification, Voltage, Current, PowerRating, InstallationDate, CommissioningDate, EquipmentCondition, EquipmentStatus, EquipmentPhotoURL, Notes, CreatedAt, UpdatedAt, CreatedBy, UpdatedBy, IsDeleted
- EQUIPMENT_QR_CODES: QRCodeID, EquipmentID, QRPayload, QRImageURL, CreatedAt, CreatedBy
- AUDIT_LOG: AuditID, Timestamp, ActorEmail, ActorName, Action, Entity, EntityID, Details, Source

## Notes
- Penghapusan equipment menggunakan soft delete (`IsDeleted=true`).
- Status equipment: Normal, Warning, Breakdown, Inactive.
- Condition: Good, Fair, Poor, Critical.
- Role: Admin, Maintenance Manager, Supervisor, Technician, Viewer.
- Phase berikutnya menambahkan tabel inspeksi, PM, corrective maintenance, work order, safety, inventory, approval dan attachment tanpa mengubah primary ID Phase 1.
