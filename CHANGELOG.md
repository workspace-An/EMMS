# Changelog

## 1.2.0-phase3 - Preventive Maintenance
- Menu **PM**: Daftar kerja (terlambat / segera / milik saya, tombol Kerjakan), Jadwal PM (Admin/Manager/Supervisor), Riwayat & approval.
- Jadwal: frekuensi Mingguan, Bulanan, 3 bulanan, 6 bulanan, Tahunan, atau interval hari kustom; teknisi penanggung jawab; instruksi kerja; aktif/nonaktif.
- Pelaksanaan: tanggal (maks 7 hari ke belakang), jam mulai/selesai, hasil (Selesai / Selesai dengan temuan / Sebagian), ukur sebelum-sesudah, catatan (wajib bila bukan "Selesai"), foto sebelum & sesudah.
- Jatuh tempo berikutnya dimajukan dari tanggal jatuh tempo (tidak bergeser); periode terlewat dilompati. Satu jatuh tempo hanya bisa diselesaikan sekali.
- Approval Supervisor/Manager/Admin: Setujui atau Tolak (alasan wajib). Tolak mengembalikan jadwal ke jatuh tempo semula. Pelaksana tidak bisa menyetujui pekerjaannya sendiri (Admin dikecualikan, tercatat di audit). Foto terkunci setelah disetujui.
- Pengingat **Google Calendar** (event seharian di kalender pemilik script, otomatis dibuat/diubah/dihapus). Kegagalan Calendar tidak menggagalkan penyimpanan.
- Dashboard: kartu PM menunggu approval; kartu PM tanpa label fase; grafik PM selesai tidak menghitung yang ditolak.
- Pengaturan baru: `PM_LEAD_DAYS` (default 7), `PM_CALENDAR_ENABLED` (default TRUE).
- Skema: kolom baru PM_SCHEDULES.Instructions; PREVENTIVE_MAINTENANCE.PMTitle/TechnicianEmail/ApprovedBy/ApprovedAt/ApprovalRemarks. **Jalankan ulang `setupEMMS()` setelah update.** Izin Calendar akan diminta saat otorisasi ulang.
- Uji: backend 85 + 28 + 23 (Phase 3), E2E 29, `runSelfTestPhase3()` di Apps Script. Perbaikan kecil: label status Aktif/Nonaktif kini diterjemahkan.

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
