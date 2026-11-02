/**
 * Notification.gs
 * Pengiriman email lewat MailApp (akun pemilik script). Phase 1 memakainya untuk kode login (OTP).
 * Phase 7 akan memperluasnya untuk notifikasi PM, NG, Work Order, stok minimum, dll.
 *
 * Batas: akun Gmail pribadi dibatasi sekitar 100 penerima email per hari lewat Apps Script.
 */

var Notify = {
  send: function (to, subject, textBody, htmlBody) {
    var left = MailApp.getRemainingDailyQuota();
    if (left < 1) throw new AppError('MAIL_QUOTA', 'Kuota email harian habis.');
    MailApp.sendEmail({
      to: to,
      subject: subject,
      body: textBody,
      htmlBody: htmlBody,
      name: Settings.get('company_name', 'EMMS') + ' - EMMS'
    });
  },

  otpMessage: function (lang, code, ttlMin) {
    var company = Settings.get('company_name', 'EMMS');
    var T = {
      id: {
        subject: 'Kode masuk EMMS',
        line1: 'Kode masuk Anda:',
        line2: 'Berlaku ' + ttlMin + ' menit. Jangan bagikan kode ini kepada siapa pun.',
        line3: 'Jika Anda tidak meminta kode ini, abaikan email ini.'
      },
      en: {
        subject: 'EMMS sign-in code',
        line1: 'Your sign-in code:',
        line2: 'Valid for ' + ttlMin + ' minutes. Do not share this code with anyone.',
        line3: 'If you did not request this code, please ignore this email.'
      },
      zh: {
        subject: 'EMMS 登录验证码',
        line1: '您的登录验证码：',
        line2: '有效期 ' + ttlMin + ' 分钟。请勿向任何人透露此验证码。',
        line3: '如果您没有请求此验证码，请忽略此邮件。'
      }
    };
    var m = T[lang] || T.id;
    var text = company + '\n\n' + m.line1 + ' ' + code + '\n\n' + m.line2 + '\n' + m.line3;
    var html = '<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:10px">' +
      '<div style="color:#0b1f3a;font-weight:700;font-size:16px">' + Notify.esc_(company) + ' &middot; EMMS</div>' +
      '<p style="color:#334155">' + m.line1 + '</p>' +
      '<div style="font-size:32px;letter-spacing:8px;font-weight:700;color:#0b1f3a;background:#f1f5f9;padding:14px;text-align:center;border-radius:8px">' + code + '</div>' +
      '<p style="color:#64748b;font-size:13px">' + m.line2 + '<br>' + m.line3 + '</p></div>';
    return { subject: m.subject, text: text, html: html };
  },

  esc_: function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
};
