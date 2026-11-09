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
