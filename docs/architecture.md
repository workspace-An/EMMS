# Arsitektur EMMS

```
 Browser / HP  --google.script.run-->  api(token, action, payload)   [Code.gs, satu-satunya pintu masuk]
   (HTML+JS)                              | 1. Auth.authenticate(token)  -> user + role dari sheet USERS
                                          | 2. Auth.require(user, permission)  (RBAC backend)
                                          | 3. modul: Equipment / Users / Master / Settings / Dashboard
                                          v
                              Database.gs (LockService + validasi) --> Google Sheets (26 sheet)
                              DriveService.gs --> Google Drive (foto, privat)
                              AuditLog.gs --> sheet AUDIT_LOG
```
Web app berjalan **sebagai pemilik script** ("Execute as: Me"). Pengguna lain hanya berinteraksi lewat `api()`; mereka tidak
perlu (dan tidak boleh) punya akses ke Spreadsheet/Drive.

## Autentikasi untuk Gmail pribadi
Masalah: pada Gmail pribadi, `Session.getActiveUser().getEmail()` umumnya **kosong** (hanya terisi untuk Workspace satu domain),
jadi identitas pengunjung tidak bisa dipercaya dari fungsi itu. Alternatif "Execute as: User accessing" memaksa setiap pengguna
punya akses edit langsung ke Sheet/Drive - itu menghapus kontrol akses aplikasi, jadi tidak dipakai.

Solusi:
1. **Auto-login** bila `getActiveUser().getEmail()` terisi dan terdaftar (Workspace / konfigurasi tertentu).
2. **Email OTP** (utama untuk Gmail pribadi): pengguna memasukkan email -> sistem mengirim kode 6 digit lewat `MailApp` ke email
   yang **terdaftar di sheet USERS** -> pengguna memasukkan kode -> server menerbitkan token acak 64 hex (hanya SHA-256-nya
   disimpan di sheet SESSIONS). Token dikirim di setiap panggilan `api()`.
   - Kode berlaku 10 menit, sekali pakai, maks 5 salah, maks 5 permintaan/jam/email; respons tidak membocorkan apakah email terdaftar.
   - Email tidak terdaftar tidak menerima apa pun. Menonaktifkan user langsung mencabut semua sesinya.
   - Halaman uji: `<URL /exec>?page=diag` dan menu Pengaturan > Sistem menampilkan apakah email aktif tersedia.

## Hak akses (RBAC) - diperiksa di backend
Lihat `CFG.PERMISSIONS` di `Config.gs`. Ringkas: Viewer/Technician hanya lihat; Supervisor + tambah/ubah equipment;
Maintenance Manager + hapus equipment, kelola master data, lihat user/audit/pengaturan; Admin = semua (kelola user, pengaturan, restore).

## Risiko & keterbatasan (jujur)
1. **Pemilik script = superuser.** Siapa pun yang punya akses edit ke Spreadsheet, Drive `EMMS_Files`, atau project Apps Script
   melewati seluruh kontrol aplikasi. Jangan bagikan Sheet/Drive/project ke pengguna biasa; amankan akun Google pemilik dengan 2FA.
2. **Kuota email Gmail pribadi ±100 penerima/hari** (OTP + notifikasi Phase 7 berbagi kuota). Dengan sesi 30 hari, cukup untuk 3-10 teknisi.
3. **Sesi di localStorage dalam iframe Apps Script.** Safari/Brave dapat memblokirnya -> pengguna login ulang tiap kali; aplikasi tetap berfungsi.
4. **Tidak ada pencatatan IP** (Apps Script tidak menyediakan). Audit log mencatat email, role, aksi, objek, hasil.
5. **Kuota Apps Script**: eksekusi ≤ 6 menit, panggilan antarmuka ≈ 1-3 detik. Skala 100-500 equipment, 3-10 user aman. `AUDIT_LOG` dibaca 2000 baris terakhir; arsipkan berkala.
6. **Tanda tangan digital (Phase 7)** hanya pencatatan identitas+waktu+persetujuan, bukan tanda tangan elektronik tersertifikasi.
7. **Cache OTP** (CacheService) dapat hilang sewaktu-waktu; bila kode "kedaluwarsa" lebih cepat, minta kode baru.
8. **URL deployment tidak boleh berubah** setelah QR dicetak (lihat deployment.md).
9. Fitur ini bukan pengganti prosedur K3 resmi perusahaan (berlaku untuk Phase 5).
