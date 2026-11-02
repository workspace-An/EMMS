/**
 * EMMS - Auth.gs
 * Autentikasi untuk deployment Gmail PRIBADI.
 *
 * Masalah: web app "Execute as: Me" + akun Gmail pribadi -> Session.getActiveUser().getEmail()
 * umumnya KOSONG (hanya terisi untuk domain Google Workspace yang sama). Karena itu identitas
 * tidak boleh bergantung pada fungsi tersebut.
 *
 * Solusi (urutan):
 *  1) Auto-login: bila Session.getActiveUser().getEmail() terisi dan terdaftar -> dipercaya (identitas dari Google).
 *  2) Email OTP: pengguna memasukkan email terdaftar, sistem mengirim kode 6 digit ke inbox email tsb
 *     (membuktikan penguasaan akun email), lalu server menerbitkan session token acak.
 *     Hanya SHA-256 dari token yang disimpan di sheet SESSIONS.
 *  Semua pemanggilan api() memvalidasi token + status user + role di backend.
 */
const Auth = {

  norm: function (e) { return String(e || '').trim().toLowerCase(); },

  validEmail: function (e) {
    return typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  },

  hash: function (s) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
      .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  },

  salt_: function () {
    const props = PropertiesService.getScriptProperties();
    let s = props.getProperty(CFG.SALT_PROP);
    if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty(CFG.SALT_PROP, s); }
    return s;
  },

  randomToken_: function () { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); },

  randomCode_: function () {
    const hex = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    return ('000000' + (parseInt(hex, 16) % 1000000)).slice(-6);
  },

  findUser: function (email) {
    const e = Auth.norm(email);
    if (!e) return null;
    const list = Db.where('USERS', function (u) { return Auth.norm(u.Email) === e && u.Status === 'Active'; });
    return list.length ? list[0] : null;
  },

  publicUser: function (u) {
    return {
      userId: u.UserID, email: u.Email, name: u.FullName, role: u.Role,
      department: u.Department, language: u.Language || ''
    };
  },

  permsFor: function (role) {
    return Object.keys(CFG.PERMISSIONS).filter(function (p) { return CFG.PERMISSIONS[p].indexOf(role) !== -1; });
  },

  can: function (user, perm) {
    if (!user) return false;
    const roles = CFG.PERMISSIONS[perm];
    return !!roles && roles.indexOf(user.role) !== -1;
  },

  require: function (user, perm) {
    if (!perm) return;
    if (!Auth.can(user, perm)) throw new AppError('FORBIDDEN', 'Forbidden', { rule: perm });
  },

  // ---------------------------------------------------------------- OTP
  requestOtp: function (p) {
    const email = Auth.norm(p && p.email);
    if (!Auth.validEmail(email)) throw validationError_([{ field: 'Email', rule: 'invalid' }]);

    return Db.withLock(function () {
      const cache = CacheService.getScriptCache();
      const rlKey = 'otprl:' + Auth.hash(email);
      const n = Number(cache.get(rlKey) || 0);
      if (n >= CFG.OTP_MAX_REQUESTS_PER_HOUR) throw new AppError('RATE_LIMIT', 'Too many requests');
      cache.put(rlKey, String(n + 1), 3600);

      const generic = { sent: true, ttlMinutes: Math.round(CFG.OTP_TTL_SEC / 60) };
      const user = Auth.findUser(email);
      if (!user) {
        // Jangan bocorkan apakah email terdaftar. Batasi pencatatan audit agar log tidak dibanjiri.
        const uk = Number(cache.get('otpunk') || 0);
        if (uk < CFG.OTP_UNKNOWN_LOG_PER_HOUR) {
          cache.put('otpunk', String(uk + 1), 3600);
          Audit.log('anonymous', 'LOGIN_OTP_UNREGISTERED', 'USERS', '', { emailHash: Auth.hash(email).slice(0, 12) }, 'DENIED');
        }
        return generic;
      }
      if (MailApp.getRemainingDailyQuota() < CFG.MIN_MAIL_QUOTA) throw new AppError('MAIL_QUOTA', 'Mail quota exhausted');

      const code = Auth.randomCode_();
      cache.put('otp:' + Auth.hash(email), JSON.stringify({
        h: Auth.hash(code + ':' + email + ':' + Auth.salt_()),
        a: 0,
        exp: Date.now() + CFG.OTP_TTL_SEC * 1000
      }), CFG.OTP_TTL_SEC);

      try {
        MailApp.sendEmail({
          to: user.Email,
          subject: 'EMMS - Kode Login / Login Code / 登录验证码',
          name: 'EMMS',
          htmlBody: Auth.otpMail_(code, user.FullName)
        });
      } catch (err) {
        console.error('Gagal kirim OTP: ' + err.message);
        throw new AppError('MAIL', 'Mail failed');
      }
      Audit.log('anonymous', 'LOGIN_OTP_SENT', 'USERS', user.UserID, null, 'OK');
      return generic;
    });
  },

  otpMail_: function (code, name) {
    const m = Math.round(CFG.OTP_TTL_SEC / 60);
    return '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #e2e8f0;border-radius:8px">' +
      '<div style="background:#0b2a4a;color:#fff;padding:14px 20px;font-weight:bold;border-radius:8px 8px 0 0">EMMS - Electrical Maintenance Management System</div>' +
      '<div style="padding:20px;color:#1e293b">' +
      '<p>Halo / Hello / 您好 <b>' + String(name || '').replace(/[<>&"]/g, '') + '</b>,</p>' +
      '<p style="font-size:30px;letter-spacing:8px;font-weight:bold;color:#1e6fd9;text-align:center;margin:18px 0">' + code + '</p>' +
      '<p>Kode login berlaku ' + m + ' menit. / Login code valid for ' + m + ' minutes. / 验证码 ' + m + ' 分钟内有效。</p>' +
      '<p style="color:#64748b;font-size:12px">Jangan bagikan kode ini. Abaikan email ini jika Anda tidak meminta login. / ' +
      'Do not share this code. Ignore if you did not request it. / 请勿泄露验证码。</p>' +
      '</div></div>';
  },

  verifyOtp: function (p) {
    const email = Auth.norm(p && p.email);
    const code = String((p && p.code) || '').replace(/\D/g, '');
    if (!Auth.validEmail(email) || code.length !== 6) throw new AppError('OTP_INVALID', 'Invalid code');

    return Db.withLock(function () {
      const cache = CacheService.getScriptCache();
      const key = 'otp:' + Auth.hash(email);
      const raw = cache.get(key);
      if (!raw) throw new AppError('OTP_INVALID', 'Invalid or expired code');
      const rec = JSON.parse(raw);
      if (rec.a >= CFG.OTP_MAX_ATTEMPTS || Date.now() > rec.exp) {
        cache.remove(key);
        throw new AppError('OTP_INVALID', 'Invalid or expired code');
      }
      if (Auth.hash(code + ':' + email + ':' + Auth.salt_()) !== rec.h) {
        rec.a += 1;
        const ttl = Math.max(1, Math.ceil((rec.exp - Date.now()) / 1000));
        if (rec.a >= CFG.OTP_MAX_ATTEMPTS) cache.remove(key); else cache.put(key, JSON.stringify(rec), ttl);
        Audit.log('anonymous', 'LOGIN_OTP_WRONG', 'USERS', '', { attempts: rec.a }, 'DENIED');
        throw new AppError('OTP_INVALID', 'Invalid or expired code');
      }
      cache.remove(key);
      const user = Auth.findUser(email);
      if (!user) throw new AppError('OTP_INVALID', 'Invalid or expired code');
      return Auth.createSession_(user, (p && p.device) || '', 'OTP');
    });
  },

  /** Login otomatis bila Google menyediakan email pengguna aktif (umumnya hanya Workspace). */
  autoLogin: function () {
    if (Settings.get('ALLOW_GOOGLE_AUTOLOGIN', 'TRUE') === 'FALSE') return { auto: false };
    let email = '';
    try { email = Auth.norm(Session.getActiveUser().getEmail()); } catch (e) { email = ''; }
    if (!email) return { auto: false };
    const user = Auth.findUser(email);
    if (!user) return { auto: false, denied: true };
    return Db.withLock(function () {
      const s = Auth.createSession_(user, 'auto', 'GOOGLE');
      s.auto = true;
      return s;
    });
  },

  createSession_: function (user, device, method) {
    const token = Auth.randomToken_();
    const days = Number(Settings.get('SESSION_DAYS', String(CFG.SESSION_DAYS_DEFAULT))) || CFG.SESSION_DAYS_DEFAULT;
    const exp = new Date(Date.now() + days * 86400000);
    Db.insert('SESSIONS', {
      TokenHash: Auth.hash(token),
      Email: user.Email,
      ExpiresAt: Utilities.formatDate(exp, Db.tz(), 'yyyy-MM-dd HH:mm:ss'),
      LastUsedAt: Db.now(),
      Device: String(device || '').slice(0, 120),
      Revoked: false
    }, user.Email);
    try {
      Db.update('USERS', user.UserID, { LastLoginAt: Db.now() }, user.Email);
      Auth.purgeSessions_();
    } catch (e) { console.error('post-login: ' + e.message); }
    Audit.log({ email: user.Email, role: user.Role }, 'LOGIN_OK', 'USERS', user.UserID, { method: method }, 'OK');
    return { token: token, user: Auth.publicUser(user) };
  },

  /** Hapus sesi kedaluwarsa/dicabut bila sheet mulai besar. */
  purgeSessions_: function () {
    const rows = Db.all('SESSIONS');
    if (rows.length < 150) return;
    const nowStr = Db.now();
    rows.filter(function (r) { return r.Revoked === true || r.ExpiresAt < nowStr; })
      .forEach(function (r) { Db.hardDelete('SESSIONS', r.SessionID); });
  },

  /** Validasi token -> objek user internal {userId,email,name,role,...}. Melempar AUTH jika tidak sah. */
  authenticate: function (token) {
    if (typeof token !== 'string' || token.length < 32 || token.length > 200) throw new AppError('AUTH', 'Not authenticated');
    const h = Auth.hash(token);
    const s = Db.where('SESSIONS', function (r) { return r.TokenHash === h; })[0];
    if (!s || s.Revoked === true || s.ExpiresAt <= Db.now()) throw new AppError('AUTH', 'Session expired');
    const u = Auth.findUser(s.Email);
    if (!u) throw new AppError('AUTH', 'User inactive or removed');

    // Perbarui LastUsedAt paling sering tiap 15 menit (hemat tulis).
    try {
      const age = Date.now() - new Date(String(s.LastUsedAt).replace(' ', 'T')).getTime();
      if (isNaN(age) || age > 15 * 60000) Db.update('SESSIONS', s.SessionID, { LastUsedAt: Db.now() }, u.Email);
    } catch (e) { /* non-kritis */ }

    return {
      userId: u.UserID, email: u.Email, name: u.FullName, role: u.Role,
      department: u.Department, language: u.Language || '', sessionId: s.SessionID
    };
  },

  logout: function (user) {
    if (user && user.sessionId) {
      Db.update('SESSIONS', user.sessionId, { Revoked: true }, user.email);
      Audit.log(user, 'LOGOUT', 'USERS', user.userId, null, 'OK');
    }
    return { loggedOut: true };
  },

  /** Cabut seluruh sesi aktif suatu email (dipakai saat user dinonaktifkan). */
  revokeAll: function (email) {
    const e = Auth.norm(email);
    Db.where('SESSIONS', function (r) { return Auth.norm(r.Email) === e && r.Revoked !== true; })
      .forEach(function (r) { Db.update('SESSIONS', r.SessionID, { Revoked: true }, 'system'); });
  },

  /** Diagnostik metode autentikasi untuk halaman Settings / diag. */
  diagnose: function () {
    let active = '', effective = '';
    try { active = Session.getActiveUser().getEmail(); } catch (e) { active = ''; }
    try { effective = Session.getEffectiveUser().getEmail(); } catch (e) { effective = ''; }
    let quota = -1;
    try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { /* ignore */ }
    return {
      activeUserEmailAvailable: !!active,
      effectiveUserEmailAvailable: !!effective,
      mailQuotaRemaining: quota,
      recommendedMode: active ? 'GOOGLE_AUTOLOGIN+OTP' : 'EMAIL_OTP',
      autoLoginSetting: Settings.get('ALLOW_GOOGLE_AUTOLOGIN', 'TRUE')
    };
  }
};
