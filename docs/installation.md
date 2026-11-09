# Instalasi Phase 1 (±20 menit)

Prasyarat: akun Gmail pribadi, komputer dengan Node.js 18+ dan Git. Semua perintah dijalankan di folder proyek (`EMMS/`).

## 1. Buat database & project Apps Script
1. Buka https://sheets.new -> beri nama **EMMS Database**.
2. Menu **Extensions > Apps Script** (project terikat ke Sheet). Beri nama project "EMMS".
3. **Project Settings (ikon roda gigi)**: salin **Script ID**. Pastikan zona waktu `Asia/Jakarta` (diatur oleh `appsscript.json`).

## 2. Unggah kode (clasp, sekaligus siap GitHub)
1. Aktifkan Apps Script API: https://script.google.com/home/usersettings -> **ON**.
2. `npm install -g @google/clasp` lalu `clasp login` (login dengan Gmail pemilik).
3. Salin `.clasp.json.example` menjadi `.clasp.json`, isi `scriptId`.
4. `npm run build && clasp push -f`  (23 file terunggah dari `dist/`).

*Alternatif tanpa clasp:* di editor, buat tiap file `.gs` (Script) dan `.html` (HTML) dengan nama yang sama (tanpa ekstensi untuk HTML), tempel isinya, dan ganti isi `appsscript.json` (Project Settings > "Show appsscript.json").

## 3. Setup database
1. Di editor pilih fungsi **setupEMMS** > **Run**. Pertama kali: *Review permissions* > pilih akun > "Google hasn't verified this app" > **Advanced > Go to EMMS (unsafe) > Allow** (aplikasi milik Anda sendiri).
2. Log (Execution log) harus berisi `EMMS SETUP SELESAI` dan email Admin awal (= akun Anda). Sheet `EMMS Database` kini berisi 25 sheet + `SESSIONS` (tersembunyi).
3. (Opsional, disarankan) jalankan **seedDemoData** untuk contoh 12 equipment.
4. Jalankan **runSelfTest** -> log harus berakhir `SEMUA UJI LULUS`. Jika ada `FAIL`, kirimkan log-nya.

## 4. Deploy sebagai web app
1. **Deploy > New deployment > ikon roda gigi > Web app**.
2. *Execute as*: **Me**. *Who has access*: **Anyone with Google account**. **Deploy**.
3. Salin **Web app URL** (berakhiran `/exec`).

## 5. Buka dari browser & HP
1. Buka URL `/exec` di komputer -> masukkan email Anda -> kode 6 digit tiba di Gmail -> masuk.
2. **Pengaturan > Umum**: isi nama perusahaan; tempel URL `/exec` ke *URL web app (untuk QR)* (atau klik "Pakai URL terdeteksi") > Simpan. **Jangan ubah lagi setelah QR dicetak.**
3. HP: buka URL yang sama (kirim via WhatsApp/email ke diri sendiri). Android Chrome: menu ⋮ > *Add to Home screen*. iPhone Safari: Share > *Add to Home Screen*.
4. Uji QR: **Equipment > buka detail > tab QR**, scan layar dengan kamera HP -> terbuka detail equipment (setelah login).

## 6. Tambah pengguna & uji dengan beberapa akun
1. **Pengguna > Tambah pengguna**: masukkan Gmail teknisi/supervisor + role.
2. Login dengan tiap akun (browser/profil berbeda atau HP) dan verifikasi sesuai tabel di `docs/testing.md`.

## Jika terjadi error
| Gejala | Solusi |
|---|---|
| Halaman "Database belum disetup" | Jalankan `setupEMMS()` lalu muat ulang |
| Kode OTP tidak datang | Cek folder Spam; pastikan email terdaftar di Pengguna; kuota email harian (Pengaturan > Sistem) |
| "Authorization required" saat run | Ulangi Run dan setujui izin (langkah 3.1) |
| Perubahan kode tidak terlihat | Deploy > **Manage deployments > Edit (pensil) > Version: New version > Deploy** |
| Layar putih setelah update | `npm run build && clasp push -f`, lalu deploy versi baru |

## Update dari Phase 1 ke Phase 2
1. Ganti seluruh kode (clasp push, atau salin file `dist/`).
2. Jalankan **`setupEMMS()`** sekali lagi: menambah kolom baru & mengisi checklist bawaan (tidak menghapus data).
3. Jalankan `runSelfTestPhase2()` (harus 7/7).
4. **Manage deployments > Edit > New version** (jangan buat deployment baru, agar URL /exec dan QR tetap valid).
5. Sesuaikan batas checklist (menu Inspeksi > Checklist): nilai bawaan hanya contoh.

## Update dari Phase 2 ke Phase 3
1. Ganti seluruh kode (clasp push / salin `dist/`).
2. Jalankan **`setupEMMS()`** lagi: menambah kolom PM & pengaturan baru. Akan muncul permintaan izin **Google Calendar**: *Review permissions > Allow*.
3. Jalankan `runSelfTestPhase3()` (harus 6/6).
4. **Manage deployments > Edit > New version** (URL /exec tetap).
5. Pengingat Calendar dibuat di kalender akun pemilik script. Agar teknisi ikut melihat, bagikan kalender itu (Calendar > Settings > Share) atau tunggu notifikasi email Phase 7. Matikan lewat Pengaturan > `PM_CALENDAR_ENABLED`.

### Bila log menampilkan "Calendar sync gagal ... does not have permission"
Izin Calendar belum diberikan. Pastikan `appsscript.json` di proyek Anda memuat blok `oauthScopes` (sudah ada di paket Phase 3; di editor: Project Settings > centang *Show appsscript.json manifest file in editor* lalu samakan isinya). Setelah itu jalankan `setupEMMS()` dari editor dan klik **Review permissions > Allow** (muncul daftar izin yang menyertakan Calendar). Bila dialog tidak muncul, buka myaccount.google.com/permissions, hapus akses aplikasi EMMS, lalu jalankan lagi.

## Update dari Phase 3 ke Phase 4
1. Ganti seluruh kode (clasp push dari `dist/`, atau salin semua file `.gs` dan `.html` termasuk **CM.html** dan **WO.html** yang baru).
2. Jalankan **`setupEMMS()`** lagi (menambah kolom baru; tidak menghapus data). Izin tidak berubah dari Phase 3.
3. Jalankan `runSelfTestPhase4()` (harus 5/5).
4. **Manage deployments > Edit > New version**, lalu refresh keras (Ctrl+Shift+R). Menu Corrective Maintenance dan Work Order harus tanpa badge "Fase 4".
5. Email penugasan dan peringatan memakai kuota harian Gmail pribadi (sekitar 100 penerima/hari, dibagi dengan OTP). Kegagalan kirim tidak membatalkan penyimpanan dan dicatat di sheet NOTIFICATIONS.
