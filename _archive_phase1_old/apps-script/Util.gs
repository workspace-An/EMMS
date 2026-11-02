/**
 * Util.gs
 * Fungsi bantu umum + AppError (kesalahan terkontrol yang aman ditampilkan ke pengguna).
 */

function AppError(code, message, details) {
  this.name = 'AppError';
  this.code = code;
  this.message = message || code;
  this.details = details || null;
}
AppError.prototype = Object.create(Error.prototype);
AppError.prototype.constructor = AppError;

var Util = {
  tz: function () {
    return Session.getScriptTimeZone() || 'Asia/Jakarta';
  },

  today: function () {
    return Utilities.formatDate(new Date(), Util.tz(), 'yyyy-MM-dd');
  },

  isDate: function (v) {
    return Object.prototype.toString.call(v) === '[object Date]';
  },

  isIsoDate: function (s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-');
    var y = +p[0], m = +p[1], d = +p[2];
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1950 && y <= 2100;
  },

  addDays: function (iso, n) {
    var p = iso.split('-');
    var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return dt.toISOString().slice(0, 10);
  },

  // Daftar kunci bulan 'yyyy-MM' untuk n bulan terakhir (termasuk bulan ini).
  monthKeys: function (iso, n) {
    var p = iso.split('-');
    var y = +p[0], m = +p[1] - 1, out = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(Date.UTC(y, m - i, 1));
      out.push(d.toISOString().slice(0, 7));
    }
    return out;
  },

  vErr: function (field, rule, extra) {
    var d = { field: field, rule: rule };
    if (extra) Object.keys(extra).forEach(function (k) { d[k] = extra[k]; });
    return new AppError('VALIDATION', 'Data tidak valid: ' + field + ' (' + rule + ')', d);
  },

  // Validasi teks: trim, buang karakter kontrol, batasi panjang.
  text: function (v, max, field, required) {
    var s = (v === null || v === undefined) ? '' : String(v);
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
    if (required && !s) throw Util.vErr(field, 'required');
    if (s.length > max) throw Util.vErr(field, 'max', { max: max });
    return s;
  },

  isoDateOrEmpty: function (v, field) {
    var s = Util.text(v, 10, field, false);
    if (s && !Util.isIsoDate(s)) throw Util.vErr(field, 'format');
    return s;
  },

  oneOf: function (v, list, field, def) {
    var s = Util.text(v, 40, field, false);
    if (!s) {
      if (def !== undefined) return def;
      throw Util.vErr(field, 'required');
    }
    if (list.indexOf(s) < 0) throw Util.vErr(field, 'enum');
    return s;
  },

  hex: function (bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      out += ('0' + (bytes[i] & 0xff).toString(16)).slice(-2);
    }
    return out;
  },

  sha256: function (s) {
    return Util.hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
  },

  safeEq: function (a, b) {
    a = String(a); b = String(b);
    if (a.length !== b.length) return false;
    var r = 0;
    for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  },

  // Perbedaan nilai untuk audit log: { field: [sebelum, sesudah] }
  diff: function (before, after, keys) {
    var out = {};
    keys.forEach(function (k) {
      if (String(before[k]) !== String(after[k])) out[k] = [before[k], after[k]];
    });
    return out;
  },

  // Buang properti internal (_row) sebelum dikirim ke klien.
  pub: function (o) {
    if (!o) return o;
    var c = {};
    Object.keys(o).forEach(function (k) { if (k !== '_row') c[k] = o[k]; });
    return c;
  },

  pubAll: function (arr) {
    return arr.map(Util.pub);
  }
};
