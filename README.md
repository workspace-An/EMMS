# EMMS - Electrical Maintenance Management System

Aplikasi CMMS kelistrikan berbasis **Google Apps Script + Google Sheets + Google Drive** (akun Gmail pribadi, tanpa server/hosting berbayar).
UI 3 bahasa (Indonesia, English, 中文), responsif untuk komputer/tablet/HP.

**Status: Phase 7 - Automation & Approval** (lihat `CHANGELOG.md`). Phase 8 belum dibangun; menu-nya tampil sebagai placeholder.

## Isi Phase 1
Database 26 sheet otomatis · login Email OTP + RBAC 5 role (dicek di backend) · manajemen pengguna · dashboard ·
equipment CRUD (foto, pencarian, filter, hapus berpengaman/soft delete) · QR Code per equipment + cetak label ·
master data (pabrik, gedung, lokasi, kategori) · pengaturan · audit log · 3 bahasa.

## Struktur
```
apps-script/   Backend .gs (Config, Schema, Database, Auth, Equipment, ... Setup, Code) + appsscript.json
frontend/      Index.html, Styles, Client (inti), I18n, Dashboard, Equipment, Users, Settings, QrLib
database/      sheets-schema.md (digenerate dari Schema.gs)
docs/          architecture.md, installation.md, deployment.md, user-guide.md, testing.md
scripts/       build.js (gabung ke dist/), gen-schema-doc.js, check-frontend.js
tests/         backend.test.js, e2e.test.js (Chromium), qr-verify.mjs, mock layanan Google
_archive_phase1_old/   sisa percobaan Phase 1 sebelumnya (hanya arsip, tidak dipakai)
```
Apps Script butuh semua file dalam satu folder rata, jadi `npm run build` menggabungkan `apps-script/` + `frontend/` ke `dist/`.

## Mulai cepat
1. Ikuti **docs/installation.md** (±20 menit).
2. Perintah pengembangan: `npm run build` · `npm test` · `npm run test:e2e` · `npm run push` (build + clasp push).

## Dokumen penting
- `docs/architecture.md` - arsitektur, **alur autentikasi Gmail pribadi**, risiko & keterbatasan keamanan.
- `docs/deployment.md` - deploy, update tanpa mengubah URL (penting untuk QR), hubungan ke GitHub.
