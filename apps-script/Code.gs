/**
 * EMMS - Code.gs
 * Titik masuk web app: doGet, include, dan SATU gerbang API: api(token, action, payload).
 *
 * Setiap aksi didaftarkan di getRoutes_() dengan permission yang dicek di BACKEND.
 * Frontend tidak pernah memanggil fungsi modul langsung -> tidak ada fungsi sensitif yang terekspos.
 * Respons selalu {ok:true,data} atau {ok:false,code,details}. Tidak ada stack trace ke klien.
 */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.page === 'diag') return diagPage_();
    let setupDone = true;
    try { Db.ss(); } catch (err) { setupDone = false; }
    const eq = /^[A-Za-z0-9_-]{1,40}$/.test(p.eq || '') ? p.eq : '';
    const boot = {
      version: CFG.VERSION,
      setupDone: setupDone,
      eq: eq,
      webAppUrl: setupDone ? Settings.webAppUrl() : '',
      defaultLang: setupDone ? Settings.get('DEFAULT_LANGUAGE', 'id') : 'id',
      company: setupDone ? Settings.get('COMPANY_NAME', 'EMMS') : 'EMMS'
    };
    const t = HtmlService.createTemplateFromFile('Index');
    t.bootJson = JSON.stringify(boot).replace(/</g, '\\u003c');
    return t.evaluate()
      .setTitle('EMMS - Electrical Maintenance')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    console.error('doGet: ' + err.message);
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px">EMMS: terjadi kesalahan saat memuat aplikasi. Lihat log Apps Script.</p>');
  }
}

/** Menyisipkan file HTML lain ke template: <?!= include('Styles') ?> */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Halaman uji metode autentikasi: /exec?page=diag (tanpa data sensitif). */
function diagPage_() {
  const d = Auth.diagnose();
  const html = '<body style="font-family:Arial;padding:24px;line-height:1.7"><h2>EMMS - Diagnostik Autentikasi</h2>' +
    '<p>Session.getActiveUser().getEmail() tersedia: <b>' + (d.activeUserEmailAvailable ? 'YA' : 'TIDAK') + '</b></p>' +
    '<p>Mode login yang dipakai: <b>' + d.recommendedMode + '</b></p>' +
    '<p>Sisa kuota email harian: <b>' + d.mailQuotaRemaining + '</b></p>' +
    '<p style="color:#64748b">Jika "TIDAK": normal untuk Gmail pribadi. Aplikasi memakai email OTP.</p></body>';
  return HtmlService.createHtmlOutput(html).setTitle('EMMS Diag');
}

function getRoutes_() {
  return {
    // --- publik (sebelum login) ---
    'auth.requestOtp': { pub: true, fn: function (p) { return Auth.requestOtp(p); } },
    'auth.verifyOtp': { pub: true, fn: function (p) { return Auth.verifyOtp(p); } },
    'auth.auto': { pub: true, fn: function () { return Auth.autoLogin(); } },

    // --- terautentikasi ---
    'auth.logout': { fn: function (p, u) { return Auth.logout(u); } },
    'app.bootstrap': { fn: function (p, u) { return bootstrap_(u); } },
    'profile.setLanguage': { fn: function (p, u) { return Users.setLanguage(p, u); } },

    'dashboard.summary': { perm: 'dashboard.view', fn: function (p, u) { return Dashboard.summary(p, u); } },

    'equipment.list': { perm: 'equipment.view', fn: function (p, u) { return Equipment.list(p, u); } },
    'equipment.get': { perm: 'equipment.view', fn: function (p, u) { return Equipment.get(p, u); } },
    'equipment.photo': { perm: 'equipment.view', fn: function (p) { return Equipment.photo(p); } },
    'equipment.create': { perm: 'equipment.create', fn: function (p, u) { return Equipment.create(p, u); } },
    'equipment.update': { perm: 'equipment.edit', fn: function (p, u) { return Equipment.update(p, u); } },
    'equipment.uploadPhoto': { perm: 'equipment.edit', fn: function (p, u) { return Equipment.uploadPhoto(p, u); } },
    'equipment.delete': { perm: 'equipment.delete', fn: function (p, u) { return Equipment.remove(p, u); } },
    'equipment.restore': { perm: 'equipment.restore', fn: function (p, u) { return Equipment.restore(p, u); } },
    'equipment.regenerateQr': { perm: 'equipment.edit', fn: function (p, u) { return Equipment.regenerateQr(p, u); } },

    'master.all': { perm: 'master.view', fn: function () { return Master.all(); } },
    'master.save': { perm: 'master.manage', fn: function (p, u) { return Master.save(p, u); } },
    'master.delete': { perm: 'master.manage', fn: function (p, u) { return Master.remove(p, u); } },

    'users.list': { perm: 'users.view', fn: function () { return Users.list(); } },
    'users.save': { perm: 'users.manage', fn: function (p, u) { return Users.save(p, u); } },

    'settings.get': { perm: 'settings.view', fn: function () { return Settings.getAll(); } },
    'settings.update': { perm: 'settings.edit', fn: function (p, u) { return Settings.update(p, u); } },
    'settings.diagnose': { perm: 'settings.edit', fn: function () { return Auth.diagnose(); } },

    'audit.list': { perm: 'audit.view', fn: function (p) { return Audit.list(p); } },

    // --- Phase 2: inspeksi harian & checklist ---
    'inspection.todayStatus': { perm: 'inspection.view', fn: function (p, u) { return Inspection.todayStatus(p, u); } },
    'inspection.form': { perm: 'inspection.create', fn: function (p, u) { return Inspection.form(p, u); } },
    'inspection.submit': { perm: 'inspection.create', fn: function (p, u) { return Inspection.submit(p, u); } },
    'inspection.uploadPhoto': { perm: 'inspection.create', fn: function (p, u) { return Inspection.uploadPhoto(p, u); } },
    'inspection.list': { perm: 'inspection.view', fn: function (p, u) { return Inspection.list(p, u); } },
    'inspection.get': { perm: 'inspection.view', fn: function (p, u) { return Inspection.get(p, u); } },
    'inspection.photo': { perm: 'inspection.view', fn: function (p) { return Inspection.photo(p); } },
    'inspection.review': { perm: 'inspection.review', fn: function (p, u) { return Inspection.review(p, u); } },
    'checklist.list': { perm: 'checklist.manage', fn: function (p) { return Checklist.list(p); } },
    'checklist.save': { perm: 'checklist.manage', fn: function (p, u) { return Checklist.save(p, u); } },
    'checklist.delete': { perm: 'checklist.manage', fn: function (p, u) { return Checklist.remove(p, u); } },
    'checklist.copy': { perm: 'checklist.manage', fn: function (p, u) { return Checklist.copy(p, u); } },

    // --- Phase 3: preventive maintenance ---
    'pm.meta': { perm: 'pm.view', fn: function () { return PM.meta(); } },
    'pm.schedule.list': { perm: 'pm.view', fn: function (p, u) { return PM.scheduleList(p, u); } },
    'pm.schedule.save': { perm: 'pm.schedule', fn: function (p, u) { return PM.scheduleSave(p, u); } },
    'pm.schedule.delete': { perm: 'pm.schedule', fn: function (p, u) { return PM.scheduleDelete(p, u); } },
    'pm.form': { perm: 'pm.execute', fn: function (p, u) { return PM.form(p, u); } },
    'pm.complete': { perm: 'pm.execute', fn: function (p, u) { return PM.complete(p, u); } },
    'pm.uploadPhoto': { perm: 'pm.execute', fn: function (p, u) { return PM.uploadPhoto(p, u); } },
    'pm.photo': { perm: 'pm.view', fn: function (p) { return PM.photo(p); } },
    'pm.list': { perm: 'pm.view', fn: function (p, u) { return PM.list(p, u); } },
    'pm.get': { perm: 'pm.view', fn: function (p, u) { return PM.get(p, u); } },
    'pm.approve': { perm: 'pm.approve', fn: function (p, u) { return PM.approve(p, u); } }
  };
}

function bootstrap_(user) {
  return {
    user: { userId: user.userId, email: user.email, name: user.name, role: user.role, department: user.department, language: user.language },
    perms: Auth.permsFor(user.role),
    settings: Settings.publicMap(),
    master: Master.all(),
    webAppUrl: Settings.webAppUrl(),
    version: CFG.VERSION
  };
}

/**
 * Gerbang API tunggal. Dipanggil frontend: google.script.run.api(token, action, payload)
 */
function api(token, action, payload) {
  try {
    const route = getRoutes_()[String(action)];
    if (!route) return { ok: false, code: 'NOT_FOUND', details: null };
    let user = null;
    if (!route.pub) {
      user = Auth.authenticate(token);
      Auth.require(user, route.perm);
    }
    const data = route.fn(payload && typeof payload === 'object' ? payload : {}, user);
    return { ok: true, data: data === undefined ? null : data };
  } catch (err) {
    if (err instanceof AppError || (err && err.name === 'AppError')) {
      if (err.code === 'FORBIDDEN') {
        Audit.log(safeUser_(token), 'ACCESS_DENIED', 'API', String(action), { perm: err.details && err.details.rule }, 'DENIED');
      }
      return { ok: false, code: err.code, details: err.details || null };
    }
    const ref = Utilities.getUuid().slice(0, 8);
    console.error('[' + ref + '] ' + action + ': ' + (err && err.stack ? err.stack : err));
    return { ok: false, code: 'SERVER', details: { ref: ref } };
  }
}

function safeUser_(token) {
  try { return Auth.authenticate(token); } catch (e) { return 'anonymous'; }
}
