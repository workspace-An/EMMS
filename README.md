# EMMS — Electrical Maintenance Management System

Phase 1 foundation built for Google Apps Script + Google Sheets + Google Drive.

## Delivered in Phase 1
- Automatic database spreadsheet and Drive folder setup
- Email OTP login for registered Gmail users
- Role-based backend authorization
- User management
- Equipment CRUD (soft delete)
- Equipment QR payload and QR image link with post-login equipment deep link
- Optional demo data seeder for first-time testing
- Dashboard summary and audit activity
- Responsive web interface for desktop/tablet/mobile

## Not yet delivered
Daily inspection, PM, corrective maintenance, work orders, electrical safety, spare parts, Gmail notifications, Calendar reminders, PDF/Excel reports, photo upload and offline/PWA. These belong to later phases.

## Setup
Follow `docs/installation.md` and `docs/github.md`. Copy each source file into a Google Apps Script project. Apps Script HTML filenames are `Index`, `Styles`, `Client`.

## Important
The app uses email OTP, not Google OAuth sign-in. Deploy as the owner and keep the database private. Review `docs/security.md` before operational use.

## Source layout
- `apps-script/`: backend modules
- `clasp-src/`: flattened source folder ready for clasp/GitHub synchronization
- `frontend/`: HTML UI files
- `database/`: sheet schema
- `docs/`: installation, security and deployment guides

## License
Internal project starter. Add your organization's license and ownership notice before distributing.



