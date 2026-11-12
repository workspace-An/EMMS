/**
 * EMMS - System.gs  (Phase 8: finalisasi) - backup spreadsheet ke Drive & pemeriksaan kesehatan sistem.
 */
const Backup = {
  KEEP_DEFAULT: 8,
  list_: function () { try { const a = JSON.parse(Settings.get('BACKUP_LIST', '') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } },
  list: function () { return { rows: Backup.list_().slice().reverse(), auto: String(Settings.get('BACKUP_AUTO', 'FALSE')).toUpperCase() === 'TRUE', keep: Backup.keep_() }; },
  keep_: function () { const n = Number(Settings.get('BACKUP_KEEP', Backup.KEEP_DEFAULT)); return n >= 1 && n <= 52 ? n : Backup.KEEP_DEFAULT; },
  /** Salin spreadsheet database ke Drive (EMMS_Files/Backups). Foto tidak ikut disalin (tetap di Drive). */
  create: function (user, reason) {
    return Db.withLock(function () {
      SpreadsheetApp.flush();
      const id = PropertiesService.getScriptProperties().getProperty(CFG.SS_ID_PROP);
      if (!id) throw new AppError('NOT_SETUP', 'Database belum disetup.');
      const name = 'EMMS_DB_' + Utilities.formatDate(new Date(), Db.tz(), 'yyyyMMdd_HHmm');
      let file;
      try { file = DriveApp.getFileById(id).makeCopy(name, DriveSvc.subFolder_('Backups')); }
      catch (e) { throw new AppError('BACKUP_FAILED', 'Backup gagal: ' + String(e.message || e).slice(0, 120), { rule: 'backupFailed' }); }
      const list = Backup.list_();
      list.push({ id: file.getId(), name: name, at: Db.now(), by: user && user.email ? user.email : 'system', reason: reason || 'manual' });
      let removed = 0;
      while (list.length > Backup.keep_()) {
        const old = list.shift();
        try { DriveApp.getFileById(old.id).setTrashed(true); removed++; } catch (e) { /* sudah hilang */ }
      }
      Settings.setSystem_('BACKUP_LIST', JSON.stringify(list));
      Audit.log(user || 'system', 'BACKUP_CREATE', 'SETTINGS', file.getId(), { name: name, removed: removed, reason: reason || 'manual' }, 'OK');
      return { name: name, id: file.getId(), removed: removed, kept: list.length };
    });
  },
  /** Dipanggil job harian: backup otomatis bila aktif dan backup terakhir >= 7 hari. Tidak melempar error. */
  auto_: function () {
    try {
      if (String(Settings.get('BACKUP_AUTO', 'FALSE')).toUpperCase() !== 'TRUE') return null;
      const last = Backup.list_().slice(-1)[0];
      if (last && Automation.daysBetween_(String(last.at).slice(0, 10), Db.today()) < 7) return null;
      return Backup.create('system', 'auto');
    } catch (e) { console.error('Backup.auto_: ' + e.message); return { error: String(e.message || e).slice(0, 120) }; }
  }
};

const SystemCheck = {
  health: function () {
    const checks = [];
    const add = function (key, ok, detail, level) { checks.push({ key: key, ok: !!ok, level: ok ? 'ok' : (level || 'bad'), detail: String(detail || '') }); };
    // skema
    try {
      const missing = [];
      Object.keys(SCHEMA).forEach(function (n) {
        let h; try { h = Db.headers(n); } catch (e) { missing.push(n + ' (sheet tidak ada)'); return; }
        Schema.columns(n).forEach(function (c) { if (h.indexOf(c.name) === -1) missing.push(n + '.' + c.name); });
      });
      add('schema', !missing.length, missing.length ? 'Kurang: ' + missing.slice(0, 5).join(', ') + (missing.length > 5 ? ' ...' : '') + ' - jalankan setupEMMS()' : Object.keys(SCHEMA).length + ' sheet lengkap');
    } catch (e) { add('schema', false, e.message); }
    // admin aktif
    try { const n = Db.where('USERS', function (u) { return u.Status === 'Active' && u.Role === 'Admin'; }).length; add('admin', n >= 1, n + ' Admin aktif'); } catch (e) { add('admin', false, e.message); }
    // folder Drive
    try { DriveSvc.rootFolder_(); add('drive', true, 'Folder EMMS_Files dapat diakses'); } catch (e) { add('drive', false, e.message); }
    // trigger otomasi
    try {
      const c = Automation.cfg_(), inst = Automation.triggers_().length;
      add('trigger', c.enabled && inst === 1, c.enabled ? inst + ' trigger terpasang' : 'Otomasi nonaktif', c.enabled ? 'bad' : 'warn');
    } catch (e) { add('trigger', false, e.message); }
    // job terakhir
    try {
      const last = JSON.parse(Settings.get('AUTOMATION_LAST_RUN', '') || 'null');
      if (String(Settings.get('AUTOMATION_ENABLED', 'FALSE')).toUpperCase() === 'TRUE') {
        const fresh = last && Automation.daysBetween_(String(last.finishedAt).slice(0, 10), Db.today()) <= 2 && !(last.errors && last.errors.length);
        add('lastRun', fresh, last ? 'Terakhir ' + last.finishedAt + (last.errors && last.errors.length ? ' (ada error)' : '') : 'Belum pernah berjalan');
      }
    } catch (e) { add('lastRun', false, e.message); }
    // backup
    try {
      const last = Backup.list_().slice(-1)[0];
      const age = last ? Automation.daysBetween_(String(last.at).slice(0, 10), Db.today()) : null;
      add('backup', last && age <= 14, last ? 'Terakhir ' + last.at + ' (' + age + ' hari lalu)' : 'Belum ada backup', 'warn');
    } catch (e) { add('backup', false, e.message, 'warn'); }
    // kuota email
    try { const q = MailApp.getRemainingDailyQuota(); add('mailQuota', q >= 20, 'Sisa ' + q + ' email hari ini', 'warn'); } catch (e) { add('mailQuota', false, e.message, 'warn'); }
    // lonjakan data / batas sel
    try {
      const big = Object.keys(SCHEMA).map(function (n) { return [n, Math.max(0, Db.sheet(n).getLastRow() - 1)]; }).sort(function (a, b) { return b[1] - a[1]; })[0];
      add('dataSize', big[1] < 20000, 'Sheet terbesar: ' + big[0] + ' (' + big[1] + ' baris)', 'warn');
    } catch (e) { add('dataSize', false, e.message, 'warn'); }
    const bad = checks.filter(function (c) { return c.level === 'bad'; }).length, warn = checks.filter(function (c) { return c.level === 'warn'; }).length;
    return { version: CFG.VERSION, checks: checks, bad: bad, warn: warn, status: bad ? 'bad' : (warn ? 'warn' : 'ok'), checkedAt: Db.now() };
  }
};
