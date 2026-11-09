/**
 * EMMS - Settings.gs
 * Pengaturan aplikasi (sheet SETTINGS). Hanya kunci dalam whitelist yang dapat diubah.
 */
const Settings = {
  DEFAULTS: [
    { key: 'COMPANY_NAME', value: 'PT Contoh Manufaktur', desc: 'Nama perusahaan (header laporan & UI)', cat: 'General', pub: true },
    { key: 'COMPANY_ADDRESS', value: '', desc: 'Alamat perusahaan (header laporan)', cat: 'General', pub: true },
    { key: 'DEFAULT_LANGUAGE', value: 'id', desc: 'Bahasa default: id | en | zh', cat: 'General', pub: true },
    { key: 'WEBAPP_URL', value: '', desc: 'URL web app (/exec) yang dipakai di QR Code. Jangan diubah setelah QR dicetak.', cat: 'QR', pub: true },
    { key: 'ALLOW_GOOGLE_AUTOLOGIN', value: 'TRUE', desc: 'Izinkan login otomatis bila Google menyediakan email pengguna', cat: 'Security', pub: false },
    { key: 'SESSION_DAYS', value: '30', desc: 'Masa berlaku sesi login (hari)', cat: 'Security', pub: false },
    { key: 'PM_LEAD_DAYS', value: '7', desc: 'PM dianggap "segera jatuh tempo" N hari sebelum tanggalnya', cat: 'PM', pub: true },
    { key: 'PM_CALENDAR_ENABLED', value: 'TRUE', desc: 'Buat pengingat PM di Google Calendar milik pemilik script', cat: 'PM', pub: false },
    { key: 'SCHEMA_VERSION', value: '1', desc: 'Versi skema database', cat: 'System', pub: false }
  ],

  EDITABLE: ['COMPANY_NAME', 'COMPANY_ADDRESS', 'DEFAULT_LANGUAGE', 'WEBAPP_URL', 'ALLOW_GOOGLE_AUTOLOGIN', 'SESSION_DAYS', 'PM_LEAD_DAYS', 'PM_CALENDAR_ENABLED'],

  get: function (key, fallback) {
    const r = Db.get('SETTINGS', key);
    return r && r.SettingValue !== '' ? r.SettingValue : (fallback === undefined ? '' : fallback);
  },

  map: function () {
    const m = {};
    Db.all('SETTINGS').forEach(function (r) { m[r.SettingKey] = r.SettingValue; });
    return m;
  },

  publicMap: function () {
    const m = Settings.map();
    const out = {};
    Settings.DEFAULTS.forEach(function (d) { if (d.pub) out[d.key] = m[d.key] !== undefined ? m[d.key] : d.value; });
    return out;
  },

  webAppUrl: function () {
    const saved = Settings.get('WEBAPP_URL', '');
    if (saved) return saved;
    try {
      const u = ScriptApp.getService().getUrl();
      return /\/exec$/.test(u) ? u : '';
    } catch (e) { return ''; }
  },

  /** URL /exec yang terdeteksi saat ini (untuk peringatan bila berbeda dari yang tersimpan). */
  detectedUrl: function () {
    try { const u = ScriptApp.getService().getUrl(); return /\/exec$/.test(u) ? u : ''; } catch (e) { return ''; }
  },

  getAll: function () {
    const m = Settings.map();
    return {
      values: Settings.EDITABLE.reduce(function (o, k) { o[k] = m[k] !== undefined ? m[k] : ''; return o; }, {}),
      detectedUrl: Settings.detectedUrl()
    };
  },

  update: function (p, user) {
    const errors = [];
    const clean = {};
    Object.keys(p || {}).forEach(function (k) {
      if (Settings.EDITABLE.indexOf(k) === -1) return;
      let v = String(p[k] === null || p[k] === undefined ? '' : p[k]).trim();
      if (k === 'COMPANY_NAME' && (!v || v.length > 100)) errors.push({ field: k, rule: v ? 'tooLong' : 'required' });
      if (k === 'COMPANY_ADDRESS' && v.length > 300) errors.push({ field: k, rule: 'tooLong' });
      if (k === 'DEFAULT_LANGUAGE' && CFG.LANGS.indexOf(v) === -1) errors.push({ field: k, rule: 'invalid' });
      if (k === 'WEBAPP_URL' && v && !/^https:\/\/script\.google\.com\/(a\/[^\/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(v)) errors.push({ field: k, rule: 'invalid' });
      if (k === 'ALLOW_GOOGLE_AUTOLOGIN') { v = v.toUpperCase(); if (v !== 'TRUE' && v !== 'FALSE') errors.push({ field: k, rule: 'invalid' }); }
      if (k === 'SESSION_DAYS') { const n = Number(v); if (!(n >= 1 && n <= 90)) errors.push({ field: k, rule: 'invalid' }); }
      if (k === 'PM_LEAD_DAYS') { const n = Number(v); if (!(v !== '' && n >= 0 && n <= 60 && Math.floor(n) === n)) errors.push({ field: k, rule: 'invalid' }); }
      if (k === 'PM_CALENDAR_ENABLED') { v = v.toUpperCase(); if (v !== 'TRUE' && v !== 'FALSE') errors.push({ field: k, rule: 'invalid' }); }
      clean[k] = v;
    });
    if (errors.length) throw validationError_(errors);

    return Db.withLock(function () {
      const changes = {};
      Object.keys(clean).forEach(function (k) {
        const cur = Db.get('SETTINGS', k);
        const def = Settings.DEFAULTS.filter(function (d) { return d.key === k; })[0] || {};
        if (!cur) {
          Db.insert('SETTINGS', { SettingKey: k, SettingValue: clean[k], Description: def.desc || '', Category: def.cat || '' }, user.email);
          changes[k] = ['', clean[k]];
        } else if (cur.SettingValue !== clean[k]) {
          Db.update('SETTINGS', k, { SettingValue: clean[k] }, user.email);
          changes[k] = [cur.SettingValue, clean[k]];
        }
      });
      if (Object.keys(changes).length) Audit.log(user, 'SETTINGS_UPDATE', 'SETTINGS', '', changes, 'OK');
      return Settings.getAll();
    });
  }
};
