# Deployment and operational checklist

- [ ] Run `setupEMMS()` exactly once.
- [ ] Confirm database spreadsheet and attachment folder are private to owner.
- [ ] Set project timezone to Asia/Jakarta.
- [ ] Deploy as owner; choose access scope that permits the intended users.
- [ ] Save the `/exec` URL using `saveWebAppUrl()`.
- [ ] Test admin OTP login.
- [ ] Create a test Technician and Viewer.
- [ ] Confirm Viewer cannot create or edit equipment (backend rejects).
- [ ] Confirm Technician can create equipment but cannot manage users.
- [ ] Confirm inactive user cannot request OTP.
- [ ] Confirm logout invalidates the session.
- [ ] Test desktop and mobile browser.
- [ ] Keep a copy of the spreadsheet and project source in a controlled backup location.
