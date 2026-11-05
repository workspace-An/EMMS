# Changelog

## 1.1.0-phase2 - Inspeksi Harian Listrik
- Menu **Inspeksi**: papan "hari ini" (progres, filter, tombol Inspeksi), riwayat (filter tanggal/hasil/milik saya, detail, review), kelola checklist per kategori (Admin/Manager).
- Formulir inspeksi: OK/NG/N/A, nilai ukur (koma desimal diterima), nilai di luar batas otomatis NG, catatan wajib untuk NG, rekomendasi wajib bila ada NG, foto per temuan NG (diperkecil di browser, disimpan di Drive), tanggal mundur maks 7 hari hanya Supervisor+.
- Hasil dihitung ulang di server (klien tidak bisa memalsukan). Temuan NG -> status equipment otomatis Warning, item kritis -> Breakdown; email peringatan ke Supervisor/Manager/Admin (tahan gagal & kuota).
- Checklist bawaan 13 kategori (batas hanyalah CONTOH). Hasil menyimpan salinan atribut item sehingga riwayat tetap benar saat checklist diubah.
- Tombol "Mulai inspeksi" di detail equipment (QR -> detail -> inspeksi). Dashboard: kartu NG terbuka & kritis.
- Skema: kolom baru (ItemKey, NGCount, CriticalCount, ReviewedBy/At, ReviewRemarks, snapshot hasil). **Jalankan ulang `setupEMMS()` setelah update** (idempotent). Pengaman migrasi: tanpa itu, submit ditolak NOT_SETUP.
- Uji: backend 85 + 28 Phase 2, E2E 24, `runSelfTestPhase2()` di Apps Script.

## 1.0.0-phase1
- Backend modular: Config, Schema (26 sheet), Database (LockService, ID otomatis, soft delete, optimistic concurrency),
  Auth (Email OTP + auto-login Google bila tersedia), Users, Master, Equipment, DriveService, Dashboard, AuditLog, Settings, Setup.
- Gerbang API tunggal `api(token, action, payload)` + RBAC di backend untuk setiap aksi.
- Frontend SPA 3 bahasa; QR tanpa library eksternal (QrLib, diverifikasi dengan decoder OpenCV 14/14).
- Uji: backend (85, mock Google), E2E browser (17), `runSelfTest()` di Apps Script.
- Catatan: folder ini sudah berisi percobaan Phase 1 sebelumnya. File backend lama bernama sama tertimpa
  oleh versi ini (tidak ada backup); frontend/tes lama dipindah ke `_archive_phase1_old/`.
