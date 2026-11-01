# Security notes — Phase 1

## Authentication model
Phase 1 uses email OTP to a pre-registered `@gmail.com` mailbox. This verifies control of the mailbox, not Google OAuth identity. OTP is short-lived, rate-limited, attempt-limited and stored as a SHA-256 hash. Session token is random and only its hash is stored in Script Properties.

## Important controls
- The backend checks session and role for each data operation.
- The spreadsheet and Drive folder should remain private to the app owner.
- Do not expose `ScriptApp.getOAuthToken()` to browser code.
- Do not put secrets in HTML/JavaScript.
- Use HTTPS deployment URL only.
- Restrict editor access to trusted maintainers.
- Review Apps Script execution logs periodically.
- Rotate/revoke sessions if a user leaves; set their USERS.Status to Inactive.
- Do not use this prototype as a substitute for a formal security review or company IT policy.

## Limitations and residual risks
- The app is deployed to execute as its owner. The owner account's Google quotas and permissions are shared by all users.
- Anyone who can reach the deployment page can see the login screen; only registered emails can receive OTP.
- OTP email delivery depends on consumer Gmail quotas and anti-abuse controls.
- Script Properties have finite storage. This design is suitable for a small team (3–10 users), not thousands of concurrent users.
- A user who controls a registered mailbox can authenticate. Protect Gmail accounts with 2-Step Verification.
- No brute-force protection across IP addresses is available in this first Apps Script-only implementation.
- Google Apps Script and Sheets are not a transactional relational database. Keep writes small, use LockService, and consider a dedicated database only if scale/availability requirements outgrow Sheets.
- QR image rendering uses Google's Chart endpoint. The payload is stored in the database; if the image endpoint changes, replace the renderer without changing QRPayload.
