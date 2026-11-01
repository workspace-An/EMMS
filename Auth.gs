/**
 * Passwordless email OTP. Only active, pre-registered Gmail users can request OTP.
 * OTP and session tokens are stored as hashes in Script Properties.
 */
function apiRequestOtp(email) {
  try {
    const normalized = normalizeEmail_(email);
    if (!/^[^@\s]+@gmail\.com$/.test(normalized)) throw new Error('Gunakan alamat Gmail yang terdaftar.');
    const user = rowsAsObjects_(EMMS.SHEETS.USERS).find(u =>
      normalizeEmail_(u.Email) === normalized && String(u.Status).toLowerCase() === 'active');
    if (!user) throw new Error('Email belum terdaftar atau akun tidak aktif.');

    const props = PropertiesService.getScriptProperties();
    const throttleKey = 'OTP_LAST_' + sha256_(normalized);
    const last = Number(props.getProperty(throttleKey) || 0);
    if (Date.now() - last < EMMS.OTP_RESEND_SECONDS * 1000) {
      throw new Error('Tunggu 60 detik sebelum meminta OTP baru.');
    }

    const entropy = parseInt(Utilities.getUuid().replace(/-/g, '').substring(0, 8), 16);
    const otp = String((entropy % 900000) + 100000);
    const otpKey = 'OTP_' + sha256_(normalized);
    props.setProperty(otpKey, JSON.stringify({
      hash: sha256_(normalized + ':' + otp),
      expiresAt: Date.now() + EMMS.OTP_TTL_SECONDS * 1000,
      attempts: 0
    }));
    props.setProperty(throttleKey, String(Date.now()));

    if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Kuota email harian habis. Coba lagi besok.');
    MailApp.sendEmail({
      to: normalized,
      subject: 'Kode Login EMMS',
      body: 'Kode OTP EMMS Anda: ' + otp + '\nBerlaku 5 menit. Jangan bagikan kode ini kepada siapa pun.',
      name: 'EMMS Security'
    });
    return { ok: true, message: 'OTP dikirim ke email terdaftar. Periksa Inbox/Spam.' };
  } catch (err) {
    return { ok: false, message: err.message || 'Gagal mengirim OTP.' };
  }
}

function apiVerifyOtp(email, otp) {
  try {
    const normalized = normalizeEmail_(email);
    const code = String(otp || '').trim();
    if (!/^[0-9]{6}$/.test(code)) throw new Error('OTP harus terdiri dari 6 angka.');

    const props = PropertiesService.getScriptProperties();
    const otpKey = 'OTP_' + sha256_(normalized);
    const raw = props.getProperty(otpKey);
    if (!raw) throw new Error('OTP tidak ditemukan. Minta kode baru.');
    const record = JSON.parse(raw);
    if (Date.now() > record.expiresAt) {
      props.deleteProperty(otpKey);
      throw new Error('OTP kedaluwarsa. Minta kode baru.');
    }
    if (record.attempts >= EMMS.OTP_MAX_ATTEMPTS) {
      props.deleteProperty(otpKey);
      throw new Error('Terlalu banyak percobaan. Minta OTP baru.');
    }
    if (sha256_(normalized + ':' + code) !== record.hash) {
      record.attempts++;
      props.setProperty(otpKey, JSON.stringify(record));
      throw new Error('OTP salah.');
    }

    props.deleteProperty(otpKey);
    const user = rowsAsObjects_(EMMS.SHEETS.USERS).find(u =>
      normalizeEmail_(u.Email) === normalized && String(u.Status).toLowerCase() === 'active');
    if (!user) throw new Error('Akun tidak aktif.');

    const token = Utilities.getUuid() + Utilities.getUuid();
    const tokenHash = sha256_(token);
    const sessionKey = 'SESSION_' + tokenHash;
    props.setProperty(sessionKey, JSON.stringify({
      email: normalized, userId: user.UserID,
      expiresAt: Date.now() + EMMS.SESSION_TTL_SECONDS * 1000
    }));
    audit_(user, 'LOGIN', 'USERS', user.UserID, { method: 'email_otp' });
    return {
      ok: true, token: token,
      user: { userId: user.UserID, fullName: user.FullName, email: user.Email, role: user.Role }
    };
  } catch (err) {
    return { ok: false, message: err.message || 'Verifikasi gagal.' };
  }
}

function requireAuth_(token) {
  if (!token || String(token).length < 30) throw new Error('Sesi tidak valid. Silakan login kembali.');
  const props = PropertiesService.getScriptProperties();
  const key = 'SESSION_' + sha256_(String(token));
  const raw = props.getProperty(key);
  if (!raw) throw new Error('Sesi berakhir atau tidak valid. Silakan login kembali.');
  const session = JSON.parse(raw);
  if (Date.now() > session.expiresAt) {
    props.deleteProperty(key);
    throw new Error('Sesi kedaluwarsa. Silakan login kembali.');
  }
  const user = rowsAsObjects_(EMMS.SHEETS.USERS).find(u =>
    String(u.UserID) === String(session.userId) && String(u.Status).toLowerCase() === 'active');
  if (!user) {
    props.deleteProperty(key);
    throw new Error('Akun dinonaktifkan.');
  }
  return user;
}

function requireRole_(user, allowed) {
  if (allowed.indexOf(user.Role) < 0) throw new Error('Anda tidak memiliki izin untuk melakukan tindakan ini.');
}

function apiLogout(token) {
  if (token) PropertiesService.getScriptProperties().deleteProperty('SESSION_' + sha256_(String(token)));
  return { ok: true };
}

function sha256_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}

