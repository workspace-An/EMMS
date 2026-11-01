# Instalasi EMMS Phase 1

## Prasyarat
- Akun Google pribadi pemilik aplikasi.
- Browser desktop untuk setup pertama.
- Akun Gmail setiap pengguna yang akan diizinkan masuk.
- Akun GitHub untuk version control.

## 1. Buat project Apps Script
1. Buka https://script.google.com dan pilih New project.
2. Beri nama `EMMS`.
3. Di panel Files, buat file `.gs` dan `.html` sesuai struktur pada folder `apps-script/` dan `frontend/`.
4. Salin isi setiap file dengan nama yang sama. Untuk file HTML, nama file di Apps Script adalah `Index`, `Styles`, dan `Client` (tanpa ekstensi).
5. Pastikan `doGet()` berada di `Code.gs`.

## 2. Inisialisasi database
1. Dari editor Apps Script, tambahkan sementara fungsi berikut di file `Code.gs` (Apps Script editor tidak menyediakan input argumen langsung pada tombol Run):
   `function initializeOnce(){ return setupEMMS('adminanda@gmail.com'); }`
2. Ganti email contoh dengan email Gmail admin yang benar.
3. Jalankan `initializeOnce`, setujui permintaan izin Google.
4. Buka Execution log untuk mendapatkan URL Google Sheets dan folder Drive.
5. Setelah sukses, hapus fungsi sementara `initializeOnce`.

## 2A. Data demo (opsional)
Untuk pengujian awal, jalankan `seedEMMSTestData()` satu kali dari editor setelah setup selesai. Fungsi ini membuat contoh factory, building, location, category dan satu equipment. Jangan jalankan pada database yang sudah berisi equipment.

## 3. Setelan zona waktu
Di Project Settings, set timezone ke `Asia/Jakarta`. Spreadsheet juga dibuat dengan timezone tersebut.

## 4. Deploy Web App
1. Klik Deploy → New deployment.
2. Pilih type: Web app.
3. Execute as: **Me** (pemilik).
4. Who has access: **Anyone** (jika pilihan ini tersedia pada akun Anda).
5. Klik Deploy, selesaikan otorisasi, lalu salin URL `/exec`.
6. Jangan publikasikan URL aplikasi di tempat umum. Akses tetap dibatasi oleh daftar email + OTP.
7. Tambahkan sementara fungsi berikut di `Code.gs`, ganti URL dengan URL `/exec` hasil deployment, lalu jalankan fungsi tersebut:
   `function saveEmmsUrlOnce(){ return saveWebAppUrl('PASTE_URL_EXEC_DI_SINI'); }`
8. Hapus fungsi sementara setelah berhasil menyimpan URL.
9. Buka URL `/exec` pada browser dan login dengan Gmail admin yang didaftarkan saat setup.

Jika opsi akses “Anyone” tidak tersedia pada akun Anda, jangan memilih opsi lain secara asal. Berhenti dan periksa kebijakan akun/Google; deployment harus bisa diakses oleh pengguna sasaran agar OTP dapat digunakan.

## 5. Tambahkan pengguna
1. Login sebagai Admin.
2. Buka User Management.
3. Tambahkan nama, Gmail, departemen dan role.
4. Pengguna baru dapat meminta OTP setelah disimpan.

## 6. Uji equipment
1. Buka Equipment → Add Equipment.
2. Isi minimal Equipment Name.
3. Simpan.
4. Pastikan ID otomatis muncul pada tabel.
5. Klik QR untuk melihat QR payload/image. QR akan membuka URL equipment jika Web App URL sudah disimpan sebelum record dibuat; jika belum, payload berbentuk `EMMS-EQUIPMENT:<id>`.

## 7. Update deployment
Setelah mengubah kode, buka Deploy → Manage deployments → Edit (ikon pensil) → pilih New version → Deploy. URL /exec biasanya tetap sama untuk deployment yang diedit.

## Troubleshooting
- `EMMS belum diinisialisasi`: jalankan `setupEMMS` satu kali dari editor.
- OTP tidak masuk: cek Spam, email admin/user, kuota email harian dan izin MailApp.
- Akses ditolak: pastikan email terdaftar dan status Active.
- Error sheet: jangan ubah nama sheet atau header kolom secara manual.
- Tampilan tidak berubah: deploy versi baru, bukan hanya Save project.


