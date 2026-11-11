# Changelog

## 1.6.0-phase7 - Automation & Approval
> Catatan: teks spesifikasi asli Phase 7 tidak tersedia; fitur disusun dari skema Phase 1 (APPROVALS, NOTIFICATIONS) dan komentar kode Phase 2 ("jadwal PM, overdue, NG, Work Order, stok minimum, trigger terjadwal"). Mohon dicocokkan dengan kebutuhan pabrik.
- **Job harian otomatis** (trigger waktu `emmsDailyJob`): ringkasan harian ke Supervisor/Manager/Admin (persetujuan tertunda, PM terlambat/segera, CM & WO terlambat/kritis, temuan K3 High/Critical yang lama, stok menipis, equipment belum diinspeksi) dan satu email tugas per teknisi (PM jatuh tempo/terlambat, CM & WO miliknya).
- Hemat kuota Gmail: email digabung per penerima, tidak dikirim bila kosong, manajemen didahulukan, berhenti saat kuota habis, satu kali per penerima per tanggal (idempoten), isian pengguna di-escape. Kegagalan kirim dicatat dan tidak menghentikan job.
- **Pengaturan > Otomasi** (Admin mengatur, Manager melihat): aktif/nonaktif, jam, batas hari terlambat CM/WO, batas hari eskalasi K3; memasang/menghapus trigger tanpa menggandakan; status & ringkasan eksekusi terakhir; Pratinjau (tanpa kirim); Jalankan sekarang; log notifikasi (Sent/Failed).
- **Riwayat approval bertanda tangan** (Pengaturan > Riwayat approval): keputusan PM, Work Order, penilaian risiko, serta verifikasi tutup CM/WO direkam ke APPROVALS dengan peran, level, dan SignatureHash (SHA-256 + garam rahasia). Tombol verifikasi otomatis menandai catatan yang diedit manual di sheet. Keputusan yang ditolak aturan (mis. menyetujui sendiri) tidak terekam.
- Housekeeping: sesi login kedaluwarsa/dicabut > 7 hari dihapus oleh job harian.
- Izin baru `approvals.view`, `automation.view`, `automation.manage`; rute `automation.*`, `notifications.list`, `approvals.*`. Pengaturan baru AUTOMATION_ENABLED (default FALSE), AUTOMATION_HOUR (6), OVERDUE_DAYS (7), SAFETY_ESCALATE_DAYS (3).
- Skema: kolom baru APPROVALS.ApproverEmail. **Jalankan ulang `setupEMMS()` setelah update.** Otorisasi ulang akan meminta izin "trigger" (sudah ada di manifest).
- Uji: backend 18 (Phase 7), Phase 1-6 tetap lulus, E2E 36, `runSelfTestPhase7()`.
- Batasan: approval bertingkat/multi-level belum ada (level 1 = keputusan, level 2 = verifikasi tutup); tanda tangan melindungi dari edit manual tetapi bukan dari pemilik script yang memegang garam; trigger Apps Script berjalan pada jendela ±1 jam dari jam yang dipilih.

## 1.5.0-phase6 - Inventory (Suku Cadang)
> Catatan: teks spesifikasi asli Phase 6 tidak tersedia; fitur disusun dari skema Phase 1 (SPARE_PARTS, INVENTORY_TRANSACTIONS) dan praktik CMMS umum. Mohon dicocokkan dengan kebutuhan pabrik.
- Menu **Inventaris**: daftar stok (cari, filter "hanya yang menipis", penanda Menipis/Cukup), detail dengan riwayat mutasi, tab Mutasi (300 terakhir).
- Master suku cadang (Admin/Manager): nama, kategori, merek, spesifikasi, satuan, stok minimum, lokasi simpan, pemasok. Item kembar (nama+merek+spesifikasi) ditolak; hapus hanya saat stok 0 dan wajib alasan; edit memakai pengaman konflik.
- **Stok hanya berubah lewat transaksi** yang dihitung server di dalam kunci: Terima (IN, Supervisor+), Keluarkan (OUT, Supervisor+, alasan wajib), Penyesuaian/opname (ADJUST, hanya Manager/Admin, alasan wajib). StockBefore/StockAfter dicatat; stok tidak boleh negatif; stok awal tercatat sebagai transaksi.
- **Pemakaian pada Work Order**: panel "Suku cadang dipakai" di detail WO. Teknisi yang ditugaskan (atau Supervisor+) memakai stok pada WO Approved/In Progress; pengembalian tidak boleh melebihi jumlah yang dipakai WO itu.
- **Stok menipis**: saat stok turun melewati minimum, email ke Supervisor/Manager/Admin sekali per penurunan (tahan gagal & kuota). Dashboard: kartu "Stok menipis".
- Rute `inventory.*`, izin `inventory.view/use/stock/manage`. Skema tidak berubah dari Phase 5 (tidak perlu kolom baru), namun tetap jalankan `setupEMMS()` setelah update.
- Uji: backend 16 (Phase 6), Phase 1-5 tetap lulus, E2E 35, `runSelfTestPhase6()`.
- Batasan: belum ada purchase order, reservasi stok, lot/serial, atau satuan konversi; stok per satu gudang.

## 1.4.0-phase5 - K3 Listrik (Electrical Safety)
> Catatan: teks spesifikasi asli Phase 5 tidak tersedia saat membangun; fitur disusun dari skema Phase 1 (ELECTRICAL_SAFETY, RISK_ASSESSMENTS, LOTO_RECORDS) dan praktik K3/CMMS umum. Mohon dicocokkan dengan kebutuhan pabrik.
- Menu **K3 Listrik**: temuan (jenis: kondisi/tindakan tidak aman, nyaris celaka, insiden, bahaya peralatan; kategori: grounding, isolasi, panas berlebih, arc, bagian bertegangan terbuka, proteksi, label, kerapian), tingkat risiko awal, tindakan diperlukan, sampai 5 foto. Status Open -> In Action -> Closed / Dismissed.
- Temuan High/Critical: equipment naik ke **Warning** (hanya naik) + email ke Supervisor/Manager/Admin.
- **Penilaian risiko 5x5**: skor = Kemungkinan x Keparahan dihitung server (Low <5, Medium 5-9, High 10-16, Critical >=17). Skor >= 10 wajib disetujui Manager/Admin; penilai tidak boleh menyetujui sendiri (Admin dikecualikan, diaudit); penolakan wajib alasan.
- **LOTO**: dipasang pada WO yang disetujui oleh teknisi yang ditugaskan (titik isolasi, no. gembok, verifikasi tegangan nol). Satu LOTO aktif per equipment, no. gembok unik. WO tidak bisa **Selesai/Dibatalkan** selama LOTO aktif. Pelepasan oleh orang lain wajib alasan.
- Integrasi WO: sumber **Safety** diaktifkan; WO tidak bisa **Mulai** bila penilaian risikonya belum disetujui; temuan tidak bisa ditutup selama WO berjalan, dan temuan High/Critical butuh penilaian yang disetujui.
- Dashboard: kartu temuan K3 terbuka tanpa label fase. Rute baru `safety.*`, `risk.*`, `loto.*` dan izin `safety.view/report/assess/approve/loto`.
- Skema: kolom baru pada 3 sheet Phase 5. **Jalankan ulang `setupEMMS()` setelah update.**
- Uji: backend 21 (Phase 5), total Phase 1-4 tetap lulus, E2E 34, `runSelfTestPhase5()`.

## 1.3.0-phase4 - Corrective Maintenance & Work Order
- Menu **Corrective Maintenance**: lapor kerusakan (prioritas, uraian, sampai 5 foto bukti), penugasan teknisi, mulai/jeda/lanjut, akar masalah + tindakan + suku cadang + hasil perbaikan, verifikasi & tutup, buka kembali (alasan wajib).
- Prioritas Critical menandai equipment **Breakdown** dan High menandai **Warning** (hanya naik, tidak pernah turun otomatis) disertai email ke Supervisor/Manager/Admin. Menutup CM dengan hasil "Sudah diperbaiki" dapat mengembalikan equipment ke Normal bila tidak ada CM lain yang berjalan (opsi dapat dimatikan).
- Menu **Work Order**: dibuat dari temuan Inspeksi, PM, Corrective, atau manual; tugas (checklist) per WO; alur Requested -> Approved -> In Progress -> Completed -> Closed (juga Rejected / Cancelled). Satu sumber hanya boleh punya satu WO aktif; WO yang ditolak/dibatalkan boleh dibuat ulang.
- Kontrol: pemohon tidak boleh menyetujui WO-nya sendiri, penyelesai tidak boleh menutup pekerjaannya sendiri (CM maupun WO), kecuali Admin (tercatat di audit). Hanya teknisi yang ditugaskan (atau Supervisor ke atas) yang mengerjakan. Selesai butuh semua tugas dicentang + catatan hasil.
- Tombol "Lapor kerusakan" di detail equipment; "Buat Work Order dari temuan ini" di detail Inspeksi NG dan PM yang tidak "Selesai, normal".
- Email penugasan ke teknisi (CM dan WO). Dashboard: kartu WO menunggu persetujuan; kartu CM/WO/grafik teknisi tanpa label fase.
- Skema: kolom baru pada CORRECTIVE_MAINTENANCE, WORK_ORDERS, PREVENTIVE_MAINTENANCE (WorkOrderID). **Jalankan ulang `setupEMMS()` setelah update.**
- Uji: backend 85 + 28 + 23 + 30 (Phase 4), E2E 34, `runSelfTestPhase4()`.

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
