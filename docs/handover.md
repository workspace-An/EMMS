# Serah terima & operasional EMMS v1.0.0

## Checklist go-live
1. Pasang sesuai `docs/installation.md`; jalankan `setupEMMS()`; otorisasi semua izin (termasuk Drive, Calendar, Gmail, trigger).
2. Jalankan self-test di editor: `runSelfTest()`, `runSelfTestPhase2()` ... `runSelfTestPhase8()` - semua harus PASS.
3. Deploy sebagai Web App: Execute as **Me**, akses sesuai kebijakan (lihat `docs/deployment.md`). Simpan URL /exec; jangan buat deployment baru (QR memakai URL ini) - update lewat Manage deployments > Edit > New version.
4. Isi master data (pabrik, gedung, lokasi, kategori), tambah pengguna dan perannya, impor/entri equipment, cetak QR.
5. Pengaturan: nama perusahaan, bahasa, lead time PM; Pengaturan > Otomasi: aktifkan job harian (jam pagi); Pengaturan > Sistem: aktifkan backup mingguan dan jalankan Backup sekarang sekali.
6. Pemeriksaan kesehatan sistem harus hijau. Lakukan uji manual di `docs/testing.md` pada Google asli.
7. Latih pengguna per peran (lihat `docs/user-guide.md`); tetapkan pemilik sistem (Admin) cadangan.

## Peran singkat
Admin: semua + pengaturan, pengguna, otomasi, backup. Maintenance Manager: persetujuan, laporan, inventaris master, penyesuaian stok. Supervisor: penugasan, penilaian risiko, terima/keluarkan stok. Technician: inspeksi, PM, CM, WO tugasnya, LOTO, lapor K3, pakai stok. Viewer: hanya lihat.

## Pemeliharaan rutin
- Mingguan: lihat Pemeriksaan kesehatan; pastikan backup terbaru < 14 hari; cek log notifikasi (Failed).
- Bulanan: tinjau Riwayat approval (tidak ada baris TIDAK VALID); tinjau Audit log; arsipkan data lama jika sheet terbesar mendekati 20.000 baris.
- Setiap update kode: upload file, `setupEMMS()`, New version, self-test.

## Pemulihan dari backup
1. Buka salinan `EMMS_DB_yyyyMMdd_HHmm` di Drive > periksa isinya.
2. Cara aman: salin ID spreadsheet salinan tersebut, lalu di Apps Script > Project Settings > Script Properties ubah nilai `EMMS_SS_ID` (nama properti sesuai `CFG.SS_ID_PROP`) ke ID salinan. Aplikasi akan memakai salinan sebagai database.
3. Jalankan `setupEMMS()` (idempoten) dan Pemeriksaan kesehatan.
Catatan: foto di Drive tidak ikut backup tetapi tidak berubah, sehingga tetap tertaut.

## Batasan yang diketahui
- Aplikasi membutuhkan internet; tidak ada mode offline (Apps Script tidak menyajikan service worker). Banner offline hanya memberi tahu.
- Gmail pribadi: ±100 email/hari (dibagi dengan OTP). Job harian menghemat kuota dengan menggabungkan email.
- Satu spreadsheet = batas 10 juta sel; sheet INSPECTION_RESULTS tumbuh paling cepat. Pantau lewat Pemeriksaan kesehatan.
- Satu gudang suku cadang; tanpa purchase order/lot/serial. Approval satu tingkat (+ verifikasi tutup).
- Tanda tangan approval mencegah edit manual di sheet, bukan perubahan oleh pemilik script.
- Pengujian otomatis memakai mock layanan Google dan browser Chromium; perilaku pada Google asli (kuota, otorisasi, trigger) harus diverifikasi lewat self-test dan uji manual.
