/**
 * EMMS - Database.gs
 * Lapisan akses Google Sheets: CRUD generik, ID otomatis, LockService, soft delete.
 *
 * Prinsip:
 *  - Semua sel data diformat teks ('@') dan ditulis sebagai string -> tidak ada konversi otomatis
 *    (nomor seri "00123" tetap "00123", tanggal tidak berubah jadi serial number).
 *  - Pembacaan memakai header baris 1 sheet yang sebenarnya (urutan kolom boleh berubah).
 *  - Semua penulisan memakai Script Lock (anti tabrakan antar pengguna).
 */
const Db = (function () {
  let _ss = null;
  const _hdr = {};
  let _depth = 0;

  function reset() { _ss = null; Object.keys(_hdr).forEach(function (k) { delete _hdr[k]; }); }

  function tz() { return Session.getScriptTimeZone() || 'Asia/Jakarta'; }
  function now() { return Utilities.formatDate(new Date(), tz(), 'yyyy-MM-dd HH:mm:ss'); }
  function today() { return Utilities.formatDate(new Date(), tz(), 'yyyy-MM-dd'); }
  function addDays(dateStr, n) {
    const p = String(dateStr).split('-');
    const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n, 12, 0, 0);
    return Utilities.formatDate(d, tz(), 'yyyy-MM-dd');
  }
  function addMonthsKey(n) { // yyyy-MM, n bulan dari bulan ini
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n);
    return Utilities.formatDate(d, tz(), 'yyyy-MM');
  }

  function ss() {
    if (_ss) return _ss;
    const id = PropertiesService.getScriptProperties().getProperty(CFG.SS_ID_PROP);
    if (!id) throw new AppError('NOT_SETUP', 'Database belum disetup. Jalankan setupEMMS().');
    _ss = SpreadsheetApp.openById(id);
    return _ss;
  }

  function sheet(name) {
    const sh = ss().getSheetByName(name);
    if (!sh) throw new AppError('NOT_SETUP', 'Sheet tidak ditemukan: ' + name, { sheet: name });
    return sh;
  }

  function headers(name) {
    if (_hdr[name]) return _hdr[name];
    const sh = sheet(name);
    const n = sh.getLastColumn();
    _hdr[name] = n > 0 ? sh.getRange(1, 1, 1, n).getValues()[0].map(String) : [];
    return _hdr[name];
  }

  function cast(v, type) {
    if (v instanceof Date) {
      return Utilities.formatDate(v, tz(), type === 'd' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss');
    }
    if (v === null || v === undefined || v === '') return '';
    if (type === 'n') { const n = Number(v); return isNaN(n) ? '' : n; }
    if (type === 'b') return v === true || String(v).toLowerCase() === 'true';
    return String(v);
  }

  function ser(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  function rowToObj(hdr, types, row) {
    const o = {};
    for (let i = 0; i < hdr.length; i++) {
      if (hdr[i]) o[hdr[i]] = cast(row[i], types[hdr[i]] || 's');
    }
    return o;
  }

  function withLock(fn, timeoutMs) {
    if (_depth > 0) return fn(); // sudah memegang lock di eksekusi ini
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(timeoutMs || 20000)) {
      throw new AppError('BUSY', 'System busy, try again.');
    }
    _depth++;
    try {
      const r = fn();
      SpreadsheetApp.flush();
      return r;
    } finally {
      _depth--;
      lock.releaseLock();
    }
  }

  /** Semua baris sebagai objek. Default: tanpa record Status=Deleted. */
  function all(name, opts) {
    opts = opts || {};
    const sh = sheet(name);
    const last = sh.getLastRow();
    if (last < 2) return [];
    const hdr = headers(name);
    const types = Schema.types(name);
    const vals = sh.getRange(2, 1, last - 1, hdr.length).getValues();
    const pkIdx = hdr.indexOf(SCHEMA[name].pk);
    const out = [];
    for (let i = 0; i < vals.length; i++) {
      if (vals[i][pkIdx] === '' || vals[i][pkIdx] === null) continue;
      const o = rowToObj(hdr, types, vals[i]);
      if (!opts.includeDeleted && o.Status === 'Deleted') continue;
      out.push(o);
    }
    return out;
  }

  /** N baris terakhir (untuk tabel besar seperti AUDIT_LOG). */
  function tail(name, n) {
    const sh = sheet(name);
    const last = sh.getLastRow();
    if (last < 2) return [];
    const hdr = headers(name);
    const types = Schema.types(name);
    const start = Math.max(2, last - n + 1);
    const vals = sh.getRange(start, 1, last - start + 1, hdr.length).getValues();
    return vals.map(function (r) { return rowToObj(hdr, types, r); });
  }

  function where(name, pred, opts) { return all(name, opts).filter(pred); }
  function count(name, pred) { return where(name, pred || function () { return true; }).length; }

  function findRow(name, id) {
    const sh = sheet(name);
    const last = sh.getLastRow();
    if (last < 2) return 0;
    const col = headers(name).indexOf(SCHEMA[name].pk) + 1;
    const ids = sh.getRange(2, col, last - 1, 1).getValues();
    const want = String(id);
    for (let i = 0; i < ids.length; i++) { if (String(ids[i][0]) === want) return i + 2; }
    return 0;
  }

  function get(name, id, opts) {
    const r = findRow(name, id);
    if (!r) return null;
    const sh = sheet(name);
    const hdr = headers(name);
    const o = rowToObj(hdr, Schema.types(name), sh.getRange(r, 1, 1, hdr.length).getValues()[0]);
    if (!(opts && opts.includeDeleted) && o.Status === 'Deleted') return null;
    return o;
  }

  function maxSuffix(name) {
    const def = SCHEMA[name];
    const sh = sheet(name);
    const last = sh.getLastRow();
    if (last < 2 || !def.prefix) return 0;
    const col = headers(name).indexOf(def.pk) + 1;
    const ids = sh.getRange(2, col, last - 1, 1).getValues();
    let max = 0;
    for (let i = 0; i < ids.length; i++) {
      const m = String(ids[i][0]).match(/-(\d+)$/);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max;
  }

  /** ID berikutnya, mis. EQ-0001. HARUS dipanggil dalam lock. */
  function nextId(name) {
    const def = SCHEMA[name];
    if (!def.prefix) throw new Error('Sheet ' + name + ' tidak memakai ID otomatis');
    const props = PropertiesService.getScriptProperties();
    const key = 'CNT_' + name;
    const cur = Math.max(Number(props.getProperty(key) || 0), maxSuffix(name)) + 1;
    props.setProperty(key, String(cur));
    const s = String(cur);
    return def.prefix + '-' + (s.length < 4 ? ('0000' + s).slice(-4) : s);
  }

  /**
   * Menyusun baris sesuai header sheet. Pengaman migrasi: bila skema punya kolom baru yang belum ada di sheet
   * (setupEMMS() belum dijalankan ulang setelah update) dan ada nilai untuk kolom itu, tolak - jangan hilangkan diam-diam.
   */
  function buildRow(name, rec) {
    const hdr = headers(name);
    Schema.columns(name).forEach(function (c) {
      if (hdr.indexOf(c.name) === -1 && rec[c.name] !== undefined && rec[c.name] !== '' && rec[c.name] !== null) {
        throw new AppError('NOT_SETUP', 'Sheet ' + name + ' belum punya kolom ' + c.name + '. Jalankan setupEMMS() lagi.', { rule: 'migrate', sheet: name, column: c.name });
      }
    });
    return hdr.map(function (h) { return ser(rec[h]); });
  }

  function appendRows(name, rows) {
    const sh = sheet(name);
    const hdr = headers(name);
    const start = sh.getLastRow() + 1;
    const need = start + rows.length - 1;
    if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 200);
    const range = sh.getRange(start, 1, rows.length, hdr.length);
    range.setNumberFormat('@');
    range.setValues(rows);
  }

  function prepare(name, obj, by) {
    const def = SCHEMA[name];
    const ts = now();
    const rec = Object.assign({}, obj);
    rec.CreatedAt = ts; rec.CreatedBy = by || 'system';
    rec.UpdatedAt = ts; rec.UpdatedBy = by || 'system';
    if (!rec.Status) rec.Status = 'Active';
    return rec;
  }

  function insert(name, obj, by) {
    return withLock(function () {
      const def = SCHEMA[name];
      const rec = prepare(name, obj, by);
      if (!rec[def.pk]) rec[def.pk] = nextId(name);
      else if (findRow(name, rec[def.pk])) throw new AppError('CONFLICT', 'Duplicate key', { rule: 'duplicate', field: def.pk });
      appendRows(name, [buildRow(name, rec)]);
      return rec;
    });
  }

  function insertMany(name, objs, by) {
    return withLock(function () {
      if (!objs.length) return [];
      const def = SCHEMA[name];
      const recs = objs.map(function (o) {
        const r = prepare(name, o, by);
        if (!r[def.pk]) r[def.pk] = nextId(name);
        return r;
      });
      appendRows(name, recs.map(function (r) { return buildRow(name, r); }));
      return recs;
    });
  }

  /**
   * Update sebagian field. opts.expectedUpdatedAt -> optimistic concurrency.
   * Kolom PK, CreatedAt, CreatedBy tidak dapat diubah.
   */
  function update(name, id, patch, by, opts) {
    return withLock(function () {
      opts = opts || {};
      const r = findRow(name, id);
      if (!r) throw new AppError('NOT_FOUND', 'Record not found', { field: id });
      const sh = sheet(name);
      const hdr = headers(name);
      const cur = rowToObj(hdr, Schema.types(name), sh.getRange(r, 1, 1, hdr.length).getValues()[0]);
      if (opts.expectedUpdatedAt && cur.UpdatedAt && String(opts.expectedUpdatedAt) !== String(cur.UpdatedAt)) {
        throw new AppError('CONFLICT', 'Stale data', { rule: 'stale' });
      }
      const pk = SCHEMA[name].pk;
      const rec = Object.assign({}, cur);
      Object.keys(patch).forEach(function (k) {
        if (k === pk || k === 'CreatedAt' || k === 'CreatedBy') return;
        rec[k] = patch[k];
      });
      rec.UpdatedAt = now();
      rec.UpdatedBy = by || 'system';
      const range = sh.getRange(r, 1, 1, hdr.length);
      range.setNumberFormat('@');
      range.setValues([buildRow(name, rec)]);
      return { before: cur, after: rec };
    });
  }

  /** Hapus permanen satu baris (hanya untuk data sistem seperti SESSIONS). */
  function hardDelete(name, id) {
    return withLock(function () {
      const r = findRow(name, id);
      if (r) sheet(name).deleteRow(r);
      return !!r;
    });
  }

  return {
    reset: reset, tz: tz, now: now, today: today, addDays: addDays, addMonthsKey: addMonthsKey,
    ss: ss, sheet: sheet, headers: headers, withLock: withLock,
    all: all, tail: tail, where: where, count: count, get: get, findRow: findRow,
    nextId: nextId, insert: insert, insertMany: insertMany, update: update, hardDelete: hardDelete
  };
})();

/** Pembanding sederhana before/after untuk Audit Log -> { Field: [lama, baru] } */
function diffObjects_(before, after, fields) {
  const d = {};
  (fields || Object.keys(after)).forEach(function (k) {
    if (String(before[k] === undefined ? '' : before[k]) !== String(after[k] === undefined ? '' : after[k])) {
      d[k] = [before[k], after[k]];
    }
  });
  return d;
}
