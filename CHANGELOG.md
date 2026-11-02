# Changelog

## 1.0.0-phase1
- Backend modular: Config, Schema (26 sheet), Database (LockService, ID otomatis, soft delete, optimistic concurrency),
  Auth (Email OTP + auto-login Google bila tersedia), Users, Master, Equipment, DriveService, Dashboard, AuditLog, Settings, Setup.
- Gerbang API tunggal `api(token, action, payload)` + RBAC di backend untuk setiap aksi.
- Frontend SPA 3 bahasa; QR tanpa library eksternal (QrLib, diverifikasi dengan decoder OpenCV 14/14).
- Uji: backend (85, mock Google), E2E browser (17), `runSelfTest()` di Apps Script.
- Catatan: folder ini sudah berisi percobaan Phase 1 sebelumnya. File backend lama bernama sama tertimpa
  oleh versi ini (tidak ada backup); frontend/tes lama dipindah ke `_archive_phase1_old/`.
