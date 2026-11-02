# Deployment & GitHub

## Update aplikasi TANPA mengubah URL (wajib untuk QR)
Perubahan kode baru tampil di URL `/exec` hanya setelah **Deploy > Manage deployments > Edit > New version**.
**Jangan** memakai "New deployment" untuk update: itu membuat URL baru dan QR yang sudah dicetak menunjuk ke versi lama.

## Alur kerja harian
```
git pull
(ubah kode di apps-script/ atau frontend/)
npm test            # cek frontend + uji backend (mock)
npm run push        # build ke dist/ lalu clasp push
(Apps Script) Manage deployments > Edit > New version
git add -A && git commit -m "..." && git push
```

## Hubungkan ke GitHub
```
git init -b main                       # (sudah dilakukan di folder ini)
git remote add origin https://github.com/<akun-anda>/emms.git
git push -u origin main
```
Buat repo kosong lebih dulu di https://github.com/new (disarankan **Private**). GitHub hanya menyimpan kode; data tetap di Google Sheets.
Jangan commit `.clasp.json`/`.clasprc.json` (sudah di `.gitignore`); data bisnis tidak ada di repo.

## Backup
Setup Phase 8 menambah backup terjadwal. Sementara: **File > Make a copy** pada Spreadsheet secara berkala.
