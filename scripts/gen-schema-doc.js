// Membuat database/sheets-schema.md dari apps-script/Schema.gs (sumber tunggal).
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Schema.gs'), 'utf8');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(src + '\n;this.out={SCHEMA,SHEET_ORDER,Schema,COMMON_COLS};', ctx);
const { SCHEMA, SHEET_ORDER, Schema } = ctx.out;
const T = { s: 'text', n: 'number', d: 'date', dt: 'datetime', b: 'boolean' };
let md = '# Skema Database EMMS (Google Sheets)\n\n> Digenerate otomatis dari `apps-script/Schema.gs` dengan `npm run docs`. Jangan diedit manual.\n\n' +
  'Semua sel diformat **teks** dan ditulis sebagai string. Tipe di bawah adalah tipe logis yang dikonversi saat dibaca. ' +
  'Setiap tabel memiliki kolom umum: `CreatedAt`, `CreatedBy`, `UpdatedAt`, `UpdatedBy`, `Status`. ' +
  'Sheet `SESSIONS` adalah tambahan sistem di luar 25 sheet yang diminta (menyimpan hash token login).\n\n## Daftar tabel\n\n| # | Sheet | PK | Relasi (FK) | Fungsi |\n|---|---|---|---|---|\n';
SHEET_ORDER.forEach((n, i) => { const d = SCHEMA[n]; md += `| ${i + 1} | ${n} | ${d.pk} | ${d.fk} | ${d.desc} |\n`; });
md += '\n## Diagram relasi (inti)\n\n```\nFACTORIES 1--* BUILDINGS 1--* LOCATIONS 1--* EQUIPMENT *--1 EQUIPMENT_CATEGORIES\nEQUIPMENT 1--* EQUIPMENT_QR_CODES\nEQUIPMENT 1--* DAILY_INSPECTIONS 1--* INSPECTION_RESULTS *--1 INSPECTION_CHECKLISTS *--1 EQUIPMENT_CATEGORIES\nEQUIPMENT 1--* PM_SCHEDULES 1--* PREVENTIVE_MAINTENANCE\nEQUIPMENT 1--* CORRECTIVE_MAINTENANCE\nEQUIPMENT 1--* WORK_ORDERS 1--* WORK_ORDER_TASKS\nWORK_ORDERS *--* (Inspection | PM | Corrective | Safety)  via SourceType+SourceID\nELECTRICAL_SAFETY 1--* RISK_ASSESSMENTS ;  WORK_ORDERS 1--* LOTO_RECORDS\nSPARE_PARTS 1--* INVENTORY_TRANSACTIONS (ReferenceID -> WORK_ORDERS)\nAPPROVALS / ATTACHMENTS / NOTIFICATIONS / AUDIT_LOG -> RefType+RefID (polimorfik)\nUSERS 1--* SESSIONS (Email)\n```\n\n';
SHEET_ORDER.forEach(n => {
  md += `## ${n}\n\n${SCHEMA[n].desc}\n\n| Kolom | Tipe | Keterangan |\n|---|---|---|\n`;
  Schema.columns(n).forEach((c, i) => { md += `| ${c.name} | ${T[c.type]} | ${i === 0 ? 'Primary key' : ''} |\n`; });
  md += '\n';
});
fs.writeFileSync(path.join(__dirname, '..', 'database', 'sheets-schema.md'), md);
console.log('database/sheets-schema.md dibuat (' + SHEET_ORDER.length + ' tabel)');
