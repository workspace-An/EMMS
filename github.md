# GitHub connection with clasp

This repository includes `clasp-src/`, a flattened Apps Script source folder. Apps Script projects do not display source folders, so the `.gs` and `.html` files are placed together here for synchronization.

## One-time setup (Windows PowerShell)
1. Install Node.js LTS from https://nodejs.org.
2. Open PowerShell and install clasp:
   `npm install -g @google/clasp`
3. Enable Apps Script API at https://script.google.com/home/usersettings (toggle ON).
4. Clone/download this EMMS GitHub repository to your computer.
5. Open PowerShell and enter the `clasp-src` folder.
6. Sign in:
   `clasp login`
7. Create a standalone Apps Script project:
   `clasp create --type standalone --title "EMMS"`
   This creates `.clasp.json` containing the new Script ID.
8. Push the project files:
   `clasp push`
9. Open the project:
   `clasp open`
10. Run `setupEMMS` using the temporary `initializeOnce()` wrapper described in `docs/installation.md`.

## Publish the web app
After the first push, deploy from Apps Script editor: Deploy → New deployment → Web app. Use Execute as Me. Choose an access setting that allows the intended users to open the login screen. Copy the `/exec` URL and save it using a temporary wrapper:
`function saveEmmsUrlOnce(){ return saveWebAppUrl('PASTE_EXEC_URL'); }`
Run it once, then remove the wrapper and push the cleaned code.

## Daily development
- Edit files in `clasp-src/`.
- `clasp push` uploads changes to the Apps Script project.
- Commit and push the same changes to GitHub:
  `git add .`
  `git commit -m "Describe change"`
  `git push`

## Important
- Keep `.clasp.json` local and do not publish its Script ID unless your organization permits it. Add `.clasp.json` to `.gitignore` before the first GitHub push.
- Never commit passwords, OTP values, session tokens, OAuth tokens or customer/plant-sensitive data.
- GitHub is source control only; the live app and database remain in Google.
