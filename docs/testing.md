# Pengujian

## Otomatis
| Perintah | Isi | Lingkungan |
|---|---|---|
| `npm test` | pemeriksa frontend (sintaks + kunci i18n 3 bahasa) + 85 uji backend Phase 1 + 28 Phase 2 + 23 Phase 3 | Node + **mock** layanan Google |
| `npm run test:e2e` | 29 skenario di Chromium (login OTP, dashboard, equipment, QR, form, bahasa, HP 375px, inspeksi OK/NG, review, checklist, jadwal & pelaksanaan & approval PM) | Playwright + mock |
| `node tests/qr-verify.mjs` | QR dibaca decoder OpenCV (14 kasus) | Python + OpenCV |
| `runSelfTest()` di Apps Script | 17 uji pada **Sheet sungguhan** | Google |
| `runSelfTestPhase3()` di Apps Script | 6 uji PM pada Sheet **dan Calendar** sungguhan (membuat lalu menghapus 1 event uji; tanpa email) | Google |
| `runSelfTestPhase2()` di Apps Script | 7 uji inspeksi pada Sheet sungguhan (data uji dibersihkan; tanpa email) | Google |

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

## Uji manual Phase 2 (di Google, wajib)
Jalankan `setupEMMS()` ulang dulu, lalu `runSelfTestPhase2()` (harus 7/7).
| # | Langkah | Hasil yang benar |
|---|---|---|
| 1 | Technician buka Inspeksi > Inspeksi pada equipment ber-checklist, semua OK | Tersimpan, baris di papan berstatus OK |
| 2 | Pilih NG tanpa catatan / tanpa rekomendasi | Ditolak dengan pesan di item / kolom rekomendasi |
| 3 | Isi suhu di atas batas | Otomatis NG; tombol OK tidak bisa menimpa |
| 4 | NG pada item **kritis** + foto dari HP | Equipment jadi Breakdown; email masuk ke Supervisor/Manager/Admin; foto terbuka di detail |
| 5 | Viewer login | Bisa lihat riwayat, tidak ada tombol Inspeksi; panggilan paksa -> `FORBIDDEN` |
| 6 | Supervisor review temuan | Status Reviewed, tercatat di audit |
| 7 | Scan QR > detail equipment > Mulai inspeksi | Formulir terbuka untuk equipment itu |

## Uji manual Phase 3 (di Google, wajib)
Jalankan `setupEMMS()` ulang (izinkan akses Calendar), lalu `runSelfTestPhase3()` (harus 6/6).
| # | Langkah | Hasil yang benar |
|---|---|---|
| 1 | Supervisor: PM > Jadwal PM > Tambah (Bulanan, mulai hari ini, pilih teknisi) | Muncul di Daftar kerja; event "[PM] ..." ada di Google Calendar pemilik script |
| 2 | Technician: Kerjakan > isi jam, ukur sebelum/sesudah, foto dari HP | Tersimpan "Menunggu approval"; jadwal berikutnya +1 bulan; event Calendar pindah tanggal |
| 3 | Technician coba Approve | Tombol tidak ada; panggilan paksa -> `FORBIDDEN` |
| 4 | Supervisor lain: buka detail > Tolak tanpa alasan | Ditolak validasi; dengan alasan -> PM muncul lagi di Daftar kerja |
| 5 | Kerjakan ulang > Setujui | Status Disetujui; foto tidak bisa diganti lagi |
| 6 | Viewer | Bisa lihat daftar & riwayat; tanpa tombol Kerjakan/Jadwal/Setujui |
| 7 | Dua teknisi menekan Simpan untuk PM yang sama hampir bersamaan | Hanya satu rekaman; yang lain mendapat "PM jatuh tempo ini sudah dikerjakan" |
