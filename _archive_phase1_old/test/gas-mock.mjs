// Mock layanan Google Apps Script (Node) agar SELURUH kode .gs asli bisa dijalankan dan diuji di luar Google.
// Catatan kejujuran: ini meniru perilaku yang didokumentasikan, BUKAN pengganti uji di Apps Script sungguhan.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
export const SRC = path.join(dir, '../apps-script');
const TZ = 'Asia/Jakarta'; // UTC+7 tanpa DST

const signed = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const unsigned = (arr) => Buffer.from(arr.map((b) => b & 255));
const toBuf = (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : unsigned(v));

function fmtDate(d, tz, f) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  return f.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day).replace('HH', parts.hour)
    .replace('mm', parts.minute).replace('ss', parts.second).replace('SSS', String(d.getMilliseconds()).padStart(3, '0'));
}
function parseLocal(str) { // 'yyyy-MM-dd[ HH:mm:ss]' di zona Asia/Jakarta -> Date
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/.exec(str);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], (+m[4] || 0) - 7, +m[5] || 0, +m[6] || 0));
}

export function createGas(opts = {}) {
  const state = {
    props: {}, sheets: {}, folders: {}, files: {}, cache: {}, outbox: [], logs: [], nextId: 1,
    active: opts.active ?? 'owner@gmail.com', effective: opts.effective ?? 'owner@gmail.com',
    serviceUrl: opts.serviceUrl ?? 'https://script.google.com/macros/s/TESTDEPLOY/exec', mailSent: 0, lockHeld: 0, lockMax: 0
  };
  const uid = () => 'ID' + String(state.nextId++).padStart(6, '0');

  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const v = (this.sh.data[this.r - 1 + i] || [])[this.c - 1 + j]; row.push(v === undefined ? '' : v); } out.push(row); }
      return out;
    }
    getValue() { return this.getValues()[0][0]; }
    setValues(vals) {
      for (let i = 0; i < vals.length; i++) for (let j = 0; j < vals[i].length; j++) {
        const rr = this.r - 1 + i, cc = this.c - 1 + j;
        while (this.sh.data.length <= rr) this.sh.data.push([]);
        let v = vals[i][j];
        const fmt = this.sh.colFmt[cc];
        if (typeof v === 'string' && (fmt === 'yyyy-mm-dd' || fmt === 'yyyy-mm-dd hh:mm:ss') && /^\d{4}-\d{2}-\d{2}/.test(v)) { const d = parseLocal(v); if (d) v = d; }
        this.sh.data[rr][cc] = v;
      }
      return this;
    }
    setNumberFormat(f) { if (this.r === 1) for (let j = 0; j < this.nc; j++) this.sh.colFmt[this.c - 1 + j] = f; return this; }
    setFontWeight() { return this; } setBackground() { return this; } setFontColor() { return this; }
  }
  class Sheet {
    constructor(ss, name) { this.ss = ss; this.name = name; this.data = []; this.colFmt = {}; }
    getName() { return this.name; }
    getLastRow() { let last = 0; this.data.forEach((row, i) => { if (row.some((v) => v !== '' && v !== undefined)) last = i + 1; }); return last; }
    getLastColumn() { let last = 0; this.data.forEach((row) => row.forEach((v, j) => { if (v !== '' && v !== undefined) last = Math.max(last, j + 1); })); return last; }
    getMaxRows() { return Math.max(1000, this.data.length); }
    getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
    setFrozenRows() {}
    deleteRow(row) { this.data.splice(row - 1, 1); }
  }
  class Spreadsheet {
    constructor(name) { this.id = 'SS' + uid(); this.name = name; this.sheets = [new Sheet(this, 'Sheet1')]; state.sheets[this.id] = this; }
    getId() { return this.id; } getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; }
    setSpreadsheetTimeZone() {}
    getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
    insertSheet(n) { const s = new Sheet(this, n); this.sheets.push(s); return s; }
    getSheets() { return this.sheets.slice(); }
    deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  }

  const makeBlob = (bytes, mime, name) => ({ _b: Array.from(bytes), getBytes: () => signed(Buffer.from(bytes)), getDataAsString: () => Buffer.from(bytes).toString('utf8'), getContentType: () => mime, getName: () => name });
  class Folder {
    constructor(name) { this.id = 'FD' + uid(); this.name = name; this.children = []; state.folders[this.id] = this; }
    getId() { return this.id; } getUrl() { return 'https://drive.google.com/drive/folders/' + this.id; }
    getFoldersByName(n) { const m = this.children.filter((c) => c instanceof Folder && c.name === n); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++] }; }
    createFolder(n) { const f = new Folder(n); this.children.push(f); return f; }
    createFile(blob) { const f = { id: 'FL' + uid(), blob, trashed: false, getId() { return this.id; }, getBlob() { return this.blob; }, setTrashed(v) { this.trashed = v; } }; state.files[f.id] = f; this.children.push(f); return f; }
  }

  const sandbox = {
    console, Date, Math, JSON, Object, Array, String, Number, RegExp, Error, parseInt, parseFloat, isFinite, Promise,
    Logger: { log: (m) => state.logs.push(String(m)) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in state.props ? state.props[k] : null), setProperty: (k, v) => { state.props[k] = String(v); }, deleteProperty: (k) => { delete state.props[k]; } }) },
    SpreadsheetApp: { create: (n) => new Spreadsheet(n), openById: (id) => { if (!state.sheets[id]) throw new Error('No spreadsheet ' + id); return state.sheets[id]; }, flush() {} },
    DriveApp: {
      createFolder: (n) => new Folder(n),
      getFolderById: (id) => { if (!state.folders[id]) throw new Error('No folder'); return state.folders[id]; },
      getFileById: (id) => { if (!state.files[id]) throw new Error('No file'); return state.files[id]; }
    },
    Session: { getScriptTimeZone: () => TZ, getEffectiveUser: () => ({ getEmail: () => state.effective }), getActiveUser: () => ({ getEmail: () => state.active }) },
    LockService: { getScriptLock: () => ({ waitLock() { state.lockHeld++; state.lockMax = Math.max(state.lockMax, state.lockHeld); if (state.lockHeld > 1) throw new Error('Lock acquired twice (not reentrant)'); }, releaseLock() { state.lockHeld--; } }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => { const e = state.cache[k]; if (!e) return null; if (e.x < Date.now()) { delete state.cache[k]; return null; } return e.v; },
        put: (k, v, ttl) => { state.cache[k] = { v: String(v), x: Date.now() + (ttl || 600) * 1000 }; },
        remove: (k) => { delete state.cache[k]; }
      })
    },
    MailApp: { sendEmail: (o) => { state.mailSent++; state.outbox.push(o); }, getRemainingDailyQuota: () => 100 - state.mailSent },
    ScriptApp: { getService: () => ({ getUrl: () => state.serviceUrl }) },
    Utilities: {
      Charset: { UTF_8: 'UTF_8' }, DigestAlgorithm: { SHA_256: 'SHA_256' },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, v) => signed(crypto.createHash('sha256').update(toBuf(v)).digest()),
      computeHmacSha256Signature: (v, key) => signed(crypto.createHmac('sha256', toBuf(key)).update(toBuf(v)).digest()),
      base64EncodeWebSafe: (v) => toBuf(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: (s) => signed(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      base64Encode: (v) => toBuf(v).toString('base64'),
      base64Decode: (s) => { if (/[^A-Za-z0-9+/=\s]/.test(s)) throw new Error('Invalid base64'); return signed(Buffer.from(String(s), 'base64')); },
      newBlob: (bytes, mime, name) => makeBlob(toBuf(bytes), mime, name),
      formatDate: (d, tz, f) => fmtDate(d, tz, f)
    },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutputFromFile: (n) => ({ getContent: () => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8') }),
      createTemplateFromFile: null // diisi di bawah
    }
  };
  // Template: scriptlet <?!= expr ?> dievaluasi dengan properti template sebagai variabel (meniru HtmlService).
  sandbox.HtmlService.createTemplateFromFile = (n) => {
    const tpl = {};
    const t = new Proxy(tpl, { set(o, k, v) { o[k] = v; return true; } });
    t.evaluate = function () {
      const src = fs.readFileSync(path.join(SRC, n + '.html'), 'utf8');
      sandbox.__TPL = Object.assign(Object.create(null), tpl);
      const out = src.replace(/<\?!=([\s\S]*?)\?>/g, (m, expr) => String(vm.runInContext('with (__TPL) { (' + expr + ') }', ctx)));
      return { content: out, title: '', meta: {}, setTitle(x) { this.title = x; return this; }, addMetaTag(k, v) { this.meta[k] = v; return this; }, setXFrameOptionsMode() { return this; }, getContent() { return this.content; } };
    };
    return t;
  };
  const ctx = vm.createContext(sandbox);
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.gs')).sort();
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f }));

  const call = (name, ...args) => ctx[name](...args);
  const run = (code) => vm.runInContext(code, ctx);
  return {
    ctx, state, call, run, files,
    api: (req) => JSON.parse(JSON.stringify(ctx.api(req))),
    globals: () => files.flatMap((f) => [...fs.readFileSync(path.join(SRC, f), 'utf8').matchAll(/^function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map((m) => m[1])),
    lastOtp: () => { const m = state.outbox.length ? /(\d{6})/.exec(state.outbox[state.outbox.length - 1].body) : null; return m ? m[1] : null; }
  };
}
