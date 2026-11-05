/**
 * Mock sederhana layanan Google Apps Script (in-memory) agar logika backend EMMS
 * dapat diuji di Node tanpa akun Google. BUKAN pengganti uji di Apps Script sungguhan
 * (lihat runSelfTest() di Setup.gs), tetapi menangkap bug logika, ID, validasi, RBAC, dan alur OTP.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function colLetter() { return ''; }

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) {
        const v = (this.sheet.data[this.r - 1 + i] || [])[this.c - 1 + j];
        row.push(v === undefined ? '' : v);
      }
      out.push(row);
    }
    return out;
  }
  setValues(vals) {
    if (this.r + this.nr - 1 > this.sheet.maxRows || this.c + this.nc - 1 > this.sheet.maxCols) {
      throw new Error('The coordinates or dimensions of the range are invalid.');
    }
    for (let i = 0; i < vals.length; i++) {
      const rr = this.r - 1 + i;
      this.sheet.data[rr] = this.sheet.data[rr] || [];
      for (let j = 0; j < vals[i].length; j++) {
        if (typeof vals[i][j] !== 'string' && vals[i][j] !== '') throw new Error('MOCK: nilai non-string ditulis ke sel teks: ' + typeof vals[i][j]);
        this.sheet.data[rr][this.c - 1 + j] = vals[i][j];
      }
    }
    return this;
  }
  setNumberFormat() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setFontWeight() { return this; }
}

class Sheet {
  constructor(ss, name) { this.ss = ss; this.name = name; this.data = []; this.maxRows = 1000; this.maxCols = 26; this.hidden = false; this.prot = []; }
  getLastRow() { let l = 0; this.data.forEach((row, i) => { if (row && row.some(v => v !== '' && v !== undefined)) l = i + 1; }); return l; }
  getLastColumn() { let l = 0; this.data.forEach(row => { (row || []).forEach((v, j) => { if (v !== '' && v !== undefined) l = Math.max(l, j + 1); }); }); return l; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
  insertRowsAfter(after, n) { this.maxRows += n; }
  insertColumnsAfter(after, n) { this.maxCols += n; }
  deleteRow(r) { this.data.splice(r - 1, 1); this.maxRows -= 1; }
  setFrozenRows() {} setTabColor() {}
  protect() { const p = { setWarningOnly() { return p; }, setDescription() { return p; } }; this.prot.push(p); return p; }
  getProtections() { return this.prot; }
  isSheetHidden() { return this.hidden; }
  hideSheet() { this.hidden = true; }
}

class Spreadsheet {
  constructor(id) { this.id = id; this.sheets = [new Sheet(this, 'Sheet1')]; }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(this, n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
}

function tzParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const o = {}; f.formatToParts(date).forEach(p => { o[p.type] = p.value; });
  if (o.hour === '24') o.hour = '00';
  return o;
}

function build(opts) {
  opts = opts || {};
  const state = { props: {}, cache: {}, mails: [], spreadsheets: {}, folders: {}, files: {}, activeUser: opts.activeUser || '', effectiveUser: 'owner@gmail.com' };
  const ctx = {
    console, Date, Math, JSON, Object, Array, String, Number, Error, RegExp, isNaN, parseInt, encodeURIComponent,
    Logger: { log: (m) => { state.log = (state.log || []).concat(String(m)); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in state.props ? state.props[k] : null), setProperty: (k, v) => { state.props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in state.cache ? state.cache[k] : null), put: (k, v) => { state.cache[k] = v; }, remove: k => { delete state.cache[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    SpreadsheetApp: {
      ProtectionType: { SHEET: 'SHEET' },
      getActiveSpreadsheet: () => null,
      openById: id => { if (!state.spreadsheets[id]) throw new Error('no ss'); return state.spreadsheets[id]; },
      create: () => { const ss = new Spreadsheet('ss_' + Math.random().toString(36).slice(2)); state.spreadsheets[ss.id] = ss; return ss; },
      flush: () => {}
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, pat) => {
        const p = tzParts(d, tz);
        return pat.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
      },
      base64Decode: s => { if (/[^A-Za-z0-9+/=]/.test(s)) throw new Error('bad b64'); return Array.from(Buffer.from(s, 'base64')).map(b => (b > 127 ? b - 256 : b)); },
      base64Encode: b => Buffer.from(b.map(x => x & 255)).toString('base64'),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name, getBytes: () => bytes, getContentType: () => mime })
    },
    Session: {
      getScriptTimeZone: () => 'Asia/Jakarta',
      getActiveUser: () => ({ getEmail: () => state.activeUser }),
      getEffectiveUser: () => ({ getEmail: () => state.effectiveUser })
    },
    MailApp: { sendEmail: m => { if (state.mailFail) throw new Error('mail down'); state.mails.push(m); }, getRemainingDailyQuota: () => 90 },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/AKfycbTEST123/exec' }) },
    DriveApp: {
      getFoldersByName: n => { const f = state.folders[n]; let used = false; return { hasNext: () => !!f && !used, next: () => { used = true; return f; } }; },
      createFolder: n => { const f = mkFolder(n); state.folders[n] = f; return f; },
      getFolderById: id => { const f = Object.values(state.folders).find(x => x.getId() === id); if (!f) throw new Error('no folder'); return f; },
      getFileById: id => { const f = state.files[id]; if (!f) throw new Error('no file'); return f; }
    },
    HtmlService: { createTemplateFromFile: () => ({ evaluate: () => ({ setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; } }) }), XFrameOptionsMode: { ALLOWALL: 1 }, createHtmlOutput: h => ({ html: h, setTitle() { return this; } }), createHtmlOutputFromFile: () => ({ getContent: () => '' }) },
    __state: state
  };
  function mkFolder(name) {
    const id = 'fld_' + Math.random().toString(36).slice(2);
    const sub = {};
    const f = {
      getId: () => id,
      getFoldersByName: n => { const x = sub[n]; let used = false; return { hasNext: () => !!x && !used, next: () => { used = true; return x; } }; },
      createFolder: n => { const x = mkFolder(n); sub[n] = x; return x; },
      createFile: blob => { const fid = 'file_' + Math.random().toString(36).slice(2); const file = { getId: () => fid, getBlob: () => blob, setTrashed: () => { delete state.files[fid]; } }; state.files[fid] = file; return file; }
    };
    return f;
  }
  ctx.Utilities.getUuid = () => crypto.randomUUID();
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'apps-script');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort();
  const code = files.map(f => '// ==== ' + f + '\n' + fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  // Ekspos deklarasi top-level (const/class tidak otomatis jadi properti global)
  const expose = '\n;Object.assign(globalThis,{CFG,AppError,SCHEMA,SHEET_ORDER,Schema,Db,Audit,Auth,Settings,Users,Master,Equipment,Dashboard,DriveSvc,Checklist,Inspection,Notify,api,getRoutes_,doGet,setupEMMS,seedDemoData,runSelfTest,addAdminUser,diagnoseAuth});';
  vm.runInContext(code + expose, ctx, { filename: 'emms-all.gs' });
  return ctx;
}

module.exports = { build };
