# Panduan Pengguna (Phase 1)

- **Masuk**: ketik email terdaftar > kode 6 digit dari email > masuk (sesi 30 hari per perangkat).
- **Bahasa**: pilih di pojok kanan atas (Indonesia / English / 中文); tersimpan per perangkat dan per akun.
- **Dashboard**: kartu status equipment, grafik kondisi/status/kategori; kartu bertanda "Fase N" akan terisi saat modulnya dibangun.
- **Equipment**: cari, filter gedung/lokasi/kategori/status; klik baris untuk detail (info, QR, riwayat, log perubahan).
  *Tambah/Ubah* (Supervisor ke atas): pilih gedung dulu, lalu lokasi; foto dapat dari kamera HP (otomatis diperkecil).
  *Hapus* (Manager/Admin): isi alasan dan ketik ID equipment; data tidak dihapus permanen.
- **QR Code**: tab QR > Cetak/PNG; centang beberapa baris > *Cetak QR terpilih* untuk lembar label. Tempel di panel; scan dengan kamera HP.
- **Pengguna** (Admin): tambah email teknisi + role; nonaktifkan untuk mencabut akses seketika.
- **Pengaturan**: Umum (nama perusahaan, URL QR), Master data (gedung/lokasi/kategori/pabrik), Audit log, Sistem.

## Inspeksi harian (Phase 2)
- **Hari ini**: daftar equipment, progres, tombol *Inspeksi*. Scan QR > *Mulai inspeksi* juga bisa.
- Jawab tiap item OK / NG / N/A. Item ukur: isi angka; di luar batas otomatis NG. NG wajib catatan, dan rekomendasi wajib di bawah. Foto opsional per temuan.
- Temuan kritis otomatis mengirim email ke Supervisor/Manager/Admin dan menandai equipment Breakdown (Warning untuk NG biasa).
- **Riwayat**: filter, buka detail, Supervisor/Manager/Admin dapat *review* temuan.
- **Checklist** (Admin/Manager): tambah/ubah/hapus item, tandai kritis, atur batas, salin dari kategori lain. Perubahan tidak mengubah inspeksi lama.

## Preventive Maintenance (Phase 3)
- **Daftar kerja**: PM yang terlambat / segera jatuh tempo. Tekan *Kerjakan*, isi jam, hasil, pengukuran, foto sebelum/sesudah.
- **Jadwal PM** (Supervisor ke atas): tambah/ubah/hapus jadwal, pilih frekuensi dan teknisi, tulis instruksi kerja.
- **Riwayat & approval**: Supervisor/Manager/Admin menyetujui atau menolak (alasan wajib). Yang ditolak muncul lagi di Daftar kerja. Anda tidak bisa menyetujui pekerjaan sendiri.
- Jatuh tempo berikutnya dihitung dari tanggal jatuh tempo, bukan tanggal Anda mengerjakan, supaya jadwal tidak bergeser.

## Corrective Maintenance & Work Order (Phase 4)
- **Lapor kerusakan**: dari menu Corrective atau detail equipment. Prioritas Kritis menandai equipment Breakdown dan memberi tahu Supervisor lewat email.
- **Alur CM**: Baru -> (Supervisor menugaskan) -> teknisi Mulai -> Selesaikan (akar masalah, tindakan, hasil wajib) -> Supervisor Verifikasi & tutup. Anda tidak bisa menutup pekerjaan yang Anda selesaikan sendiri.
- **Work Order**: dibuat dari temuan Inspeksi/PM/Corrective atau manual. Supervisor menyetujui dan menugaskan; teknisi mengerjakan dan mencentang tugas; WO selesai hanya bila semua tugas dicentang dan catatan hasil diisi; orang lain memverifikasi dan menutup.
- Satu temuan hanya boleh punya satu WO aktif. Bila WO ditolak atau dibatalkan, Anda boleh membuat yang baru.

## K3 Listrik (Phase 5)
- **Laporkan temuan**: menu K3 Listrik > Laporkan temuan (Teknisi ke atas). Temuan High/Critical menaikkan status equipment ke Warning dan mengirim email.
- **Nilai risiko** (Supervisor ke atas): pilih Kemungkinan dan Keparahan 1-5; skor dihitung otomatis. Skor >= 10 menunggu persetujuan Manager/Admin.
- **WO dari temuan**: tombol "Buat Work Order" di detail temuan. Di detail WO ada panel risiko dan LOTO.
- **LOTO**: teknisi yang ditugaskan memasang LOTO (titik isolasi, no. gembok, verifikasi 0 V) sebelum bekerja dan melepasnya sebelum WO diselesaikan.
- **Tutup temuan**: isi tindakan yang dilakukan; syarat: WO tindak lanjut sudah selesai/tutup dan risiko (bila High/Critical) sudah dinilai dan disetujui.

## Inventaris / Suku cadang (Phase 6)
- **Tambah/ubah item** (Manager/Admin). Stok awal hanya diisi saat membuat item; selanjutnya stok berubah lewat transaksi.
- **Terima / Keluarkan** (Supervisor ke atas). Keluarkan wajib alasan. **Penyesuaian (opname)** hanya Manager/Admin: isi hasil hitung fisik dan alasan.
- **Pakai di WO**: di detail WO, teknisi yang ditugaskan menekan "Pakai suku cadang". Salah pakai dapat dikembalikan (maksimal sebanyak yang dipakai).
- **Stok menipis**: item dengan stok <= minimum ditandai dan memicu email; atur minimum 0 untuk mematikan peringatan item tertentu.

## Otomasi & Approval (Phase 7)
- **Job harian**: Pengaturan > Otomasi (Admin). Aktifkan, pilih jam, Simpan. Manajemen menerima ringkasan harian, teknisi menerima daftar tugas; email hanya dikirim bila ada isinya dan maksimal sekali per hari.
- **Kuota email**: Gmail pribadi sekitar 100 email/hari (dibagi dengan kode OTP login). Job berhenti otomatis bila kuota habis; lihat sisa kuota di tab Otomasi.
- **Riwayat approval**: Pengaturan > Riwayat approval (Supervisor ke atas). Setiap keputusan punya tanda tangan digital; baris merah "TIDAK VALID" berarti catatan diubah di luar aplikasi.

## Laporan, Backup & Kesehatan sistem (Phase 8)
- **Laporan**: pilih jenis dan rentang tanggal; **CSV** untuk Excel, **Cetak / PDF** untuk arsip. Laporan Kesehatan equipment adalah kondisi saat ini (tanpa rentang).
- **Backup**: Pengaturan > Sistem > Backup sekarang (Admin). Aktifkan backup mingguan otomatis bila job harian aktif. Untuk memulihkan: buka salinan di Drive, lalu ikuti bagian "Pemulihan" di `docs/handover.md`.
- **Kesehatan sistem**: periksa sebelum dan sesudah update; tanda merah berarti perlu tindakan (mis. jalankan `setupEMMS()`).
- **Layar utama HP**: buka aplikasi di Chrome/Safari > menu > Tambahkan ke layar utama. Aplikasi tetap butuh internet.
