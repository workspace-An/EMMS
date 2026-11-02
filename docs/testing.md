# Pengujian

## Otomatis
| Perintah | Isi | Lingkungan |
|---|---|---|
| `npm test` | pemeriksa frontend (sintaks + kunci i18n 3 bahasa) + 85 uji backend | Node + **mock** layanan Google |
| `npm run test:e2e` | 17 skenario di Chromium (login OTP, dashboard, equipment, QR, form, bahasa, HP 375px) | Playwright + mock |
| `node tests/qr-verify.mjs` | QR dibaca decoder OpenCV (14 kasus) | Python + OpenCV |
| `runSelfTest()` di Apps Script | 17 uji pada **Sheet sungguhan** | Google |

Mock meniru perilaku yang didokumentasikan; ia **bukan** pengganti uji di Google. `runSelfTest()` dan uji manual di bawah wajib dilakukan sendiri.

## Uji manual multi-akun (wajib sebelum Phase 2)
Siapkan 3 Gmail: A (Admin), B (Technician), C (tidak terdaftar).
| # | Langkah | Hasil yang benar |
|---|---|---|
| 1 | C meminta kode login | Pesan "terkirim" generik, **tidak ada** email masuk ke C |
| 2 | B login dengan kode | Masuk; menu Pengguna/Pengaturan **tidak ada** |
| 3 | B coba tambah/hapus equipment | Tombol tidak ada; jika dipaksa lewat konsol -> `FORBIDDEN` |
| 4 | A nonaktifkan B | Sesi B berakhir pada aksi berikutnya |
| 5 | A ubah role B ke Supervisor | B bisa tambah/ubah equipment, tidak bisa hapus |
| 6 | Dua orang edit equipment yang sama | Yang kedua mendapat "data sudah diubah pengguna lain" |
| 7 | Scan QR dengan HP | Login (bila perlu) lalu detail equipment terbuka |
| 8 | Buka `?page=diag` | Menunjukkan apakah email aktif tersedia |
| 9 | Hapus equipment | Wajib alasan + ketik ID; hilang dari daftar; Admin bisa restore |
