/** Uji backend Phase 6 (Inventory: master suku cadang, mutasi stok, pemakaian di WO). */
const assert = require('assert');
const { build } = require('./gas-mock');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 4).join('\n       ')); } };
const ctx = build(); ctx.setupEMMS(); ctx.seedDemoData();
const A = (...a) => ctx.api(...a);
const login = (email) => { A('', 'auth.requestOtp', { email }); const m = ctx.__state.mails.filter(x => x.to === email).pop(); return A('', 'auth.verifyOtp', { email, code: m.htmlBody.match(/>(\d{6})</)[1] }).data.token; };
const adm = login('owner@gmail.com'); const tok = {};
[['T', 'Technician'], ['T2', 'Technician'], ['S', 'Supervisor'], ['M', 'Maintenance Manager'], ['V', 'Viewer']].forEach(([k, r]) => {
  assert.ok(A(adm, 'users.save', { FullName: 'User ' + k, Email: k.toLowerCase() + '@gmail.com', Role: r, Department: 'EM' }).ok); tok[k] = login(k.toLowerCase() + '@gmail.com');
});
const code = (r, c, rule) => { assert.strictEqual(r.ok, false, 'harus gagal'); assert.strictEqual(r.code, c, JSON.stringify(r)); if (rule) assert.strictEqual(r.details && r.details.rule, rule, JSON.stringify(r)); };
const stock = id => Number(ctx.Db.get('SPARE_PARTS', id).CurrentStock);
const item = { ItemName: 'Kontaktor 25A', Unit: 'pcs', MinimumStock: 3, Brand: 'Schneider', Category: 'Kontaktor', CurrentStock: 10 };
let I1;

console.log('\n[1] Master suku cadang');
t('Manager membuat item; stok awal tercatat sebagai transaksi IN', () => {
  const r = A(tok.M, 'inventory.save', item); assert.ok(r.ok, JSON.stringify(r)); I1 = r.data.ItemCode; assert.match(I1, /^SP-\d{4}$/);
  assert.strictEqual(stock(I1), 10);
  const tx = ctx.Db.all('INVENTORY_TRANSACTIONS').filter(x => x.ItemCode === I1); assert.strictEqual(tx.length, 1); assert.strictEqual(tx[0].Remarks, 'Stok awal');
});
t('RBAC & validasi & duplikat', () => {
  code(A(tok.S, 'inventory.save', item), 'FORBIDDEN'); code(A(tok.T, 'inventory.save', item), 'FORBIDDEN');
  const v = A(tok.M, 'inventory.save', { ItemName: ' ', Unit: '', MinimumStock: -1, CurrentStock: 'abc' }); assert.strictEqual(v.code, 'VALIDATION'); assert.strictEqual(v.details.errors.length, 4);
  code(A(tok.M, 'inventory.save', item), 'CONFLICT', 'duplicate');
  assert.ok(A(tok.V, 'inventory.list', {}).ok);
});
t('CurrentStock tidak bisa diubah lewat edit', () => {
  const r = A(tok.M, 'inventory.save', Object.assign({}, item, { ItemCode: I1, CurrentStock: 999, MinimumStock: 4 })); assert.ok(r.ok);
  assert.strictEqual(stock(I1), 10); assert.strictEqual(Number(ctx.Db.get('SPARE_PARTS', I1).MinimumStock), 4);
});
t('Edit dengan token usang ditolak', () => {
  code(A(tok.M, 'inventory.save', Object.assign({}, item, { ItemCode: I1, MinimumStock: 4, expectedUpdatedAt: '2000-01-01 00:00:00' })), 'CONFLICT', 'stale');
});

console.log('\n[2] Mutasi stok');
t('IN menambah, OUT mengurangi, before/after dicatat', () => {
  assert.ok(A(tok.S, 'inventory.transact', { ItemCode: I1, TransactionType: 'IN', Quantity: '5', Reference: 'PO-1' }).ok); assert.strictEqual(stock(I1), 15);
  const o = A(tok.S, 'inventory.transact', { ItemCode: I1, TransactionType: 'OUT', Quantity: 2, Remarks: 'Pakai umum' }); assert.ok(o.ok); assert.strictEqual(o.data.StockAfter, 13);
  const last = ctx.Db.all('INVENTORY_TRANSACTIONS').pop(); assert.strictEqual(Number(last.StockBefore), 15); assert.strictEqual(Number(last.StockAfter), 13);
});
t('Stok tidak boleh negatif; jumlah invalid; OUT wajib alasan; Teknisi/Viewer tidak boleh', () => {
  code(A(tok.S, 'inventory.transact', { ItemCode: I1, TransactionType: 'OUT', Quantity: 99, Remarks: 'x' }), 'CONFLICT', 'insufficient'); assert.strictEqual(stock(I1), 13);
  ['0', '-1', 'abc', '1e9'].forEach(q => assert.strictEqual(A(tok.S, 'inventory.transact', { ItemCode: I1, TransactionType: 'IN', Quantity: q }).code, 'VALIDATION', q));
  assert.strictEqual(A(tok.S, 'inventory.transact', { ItemCode: I1, TransactionType: 'OUT', Quantity: 1 }).code, 'VALIDATION');
  code(A(tok.T, 'inventory.transact', { ItemCode: I1, TransactionType: 'IN', Quantity: 1 }), 'FORBIDDEN'); code(A(tok.V, 'inventory.transact', { ItemCode: I1, TransactionType: 'IN', Quantity: 1 }), 'FORBIDDEN');
  code(A(tok.S, 'inventory.transact', { ItemCode: 'SP-9999', TransactionType: 'IN', Quantity: 1 }), 'NOT_FOUND');
});
t('Desimal koma diterima & dibulatkan 3 digit', () => {
  assert.ok(A(tok.S, 'inventory.transact', { ItemCode: I1, TransactionType: 'IN', Quantity: '0,5' }).ok); assert.strictEqual(stock(I1), 13.5);
  assert.ok(A(tok.S, 'inventory.transact', { ItemCode: I1, TransactionType: 'OUT', Quantity: '0.5', Remarks: 'balik' }).ok); assert.strictEqual(stock(I1), 13);
});
t('ADJUST: hanya Manager/Admin, wajib alasan, set stok ke hasil hitung', () => {
  code(A(tok.S, 'inventory.transact', { ItemCode: I1, TransactionType: 'ADJUST', Quantity: 12, Remarks: 'opname' }), 'FORBIDDEN');
  assert.strictEqual(A(tok.M, 'inventory.transact', { ItemCode: I1, TransactionType: 'ADJUST', Quantity: 12 }).code, 'VALIDATION');
  assert.ok(A(tok.M, 'inventory.transact', { ItemCode: I1, TransactionType: 'ADJUST', Quantity: 12, Remarks: 'opname' }).ok); assert.strictEqual(stock(I1), 12);
  const last = ctx.Db.all('INVENTORY_TRANSACTIONS').pop(); assert.strictEqual(Number(last.Quantity), 1);
});
t('Stok turun melewati minimum -> email sekali; penurunan lanjutan tidak mengirim ulang', () => {
  const before = ctx.__state.mails.length;
  const r = A(tok.S, 'inventory.transact', { ItemCode: I1, TransactionType: 'OUT', Quantity: 8, Remarks: 'proyek' }); assert.ok(r.ok); assert.strictEqual(r.data.low, true); assert.ok(r.data.notified.sent >= 1); assert.ok(ctx.__state.mails.length > before);
  const m2 = ctx.__state.mails.length;
  const r2 = A(tok.S, 'inventory.transact', { ItemCode: I1, TransactionType: 'OUT', Quantity: 1, Remarks: 'lagi' }); assert.strictEqual(r2.data.low, false); assert.strictEqual(ctx.__state.mails.length, m2);
  assert.strictEqual(A(adm, 'dashboard.summary', {}).data.cards.lowStock, 1);
  assert.strictEqual(A(tok.V, 'inventory.list', { low: true }).data.rows.length, 1);
});

console.log('\n[3] Pemakaian pada Work Order');
let W;
t('Siapkan WO Approved untuk T', () => {
  A(tok.S, 'inventory.transact', { ItemCode: I1, TransactionType: 'IN', Quantity: 20 });   // stok 23
  const eq = ctx.Db.all('EQUIPMENT')[0].EquipmentID;
  const c = A(tok.S, 'wo.create', { SourceType: 'Manual', SourceID: '', EquipmentID: eq, Title: 'Ganti kontaktor', Priority: 'Low', Description: 'x', tasks: ['a'] }); assert.ok(c.ok, JSON.stringify(c)); W = c.data.WorkOrderID;
  code(A(tok.T, 'inventory.useOnWO', { WorkOrderID: W, ItemCode: I1, Quantity: 1 }), 'FORBIDDEN');        // bukan penanggung jawab & WO belum Approved
  assert.ok(A(tok.M, 'wo.decide', { id: W, decision: 'Approved', AssignedTo: 't@gmail.com' }).ok);
});
t('Teknisi yang ditugaskan memakai; orang lain tidak; Viewer tidak', () => {
  const r = A(tok.T, 'inventory.useOnWO', { WorkOrderID: W, ItemCode: I1, Quantity: 3 }); assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(stock(I1), 20);
  code(A(tok.T2, 'inventory.useOnWO', { WorkOrderID: W, ItemCode: I1, Quantity: 1 }), 'FORBIDDEN'); code(A(tok.V, 'inventory.useOnWO', { WorkOrderID: W, ItemCode: I1, Quantity: 1 }), 'FORBIDDEN');
  const x = ctx.Db.all('INVENTORY_TRANSACTIONS').pop(); assert.strictEqual(x.ReferenceType, 'WO'); assert.strictEqual(x.ReferenceID, W);
  assert.strictEqual(A(tok.T, 'inventory.useOnWO', { WorkOrderID: W, ItemCode: I1, Quantity: 999 }).code, 'CONFLICT');
});
t('forWO menampilkan pemakaian bersih; pengembalian tidak boleh melebihi', () => {
  assert.strictEqual(A(tok.V, 'inventory.forWO', { workOrderId: W }).data.rows[0].Quantity, 3);
  code(A(tok.T, 'inventory.returnFromWO', { WorkOrderID: W, ItemCode: I1, Quantity: 4 }), 'CONFLICT', 'returnExceeds');
  assert.ok(A(tok.T, 'inventory.returnFromWO', { WorkOrderID: W, ItemCode: I1, Quantity: 1 }).ok); assert.strictEqual(stock(I1), 21);
  assert.strictEqual(A(tok.V, 'inventory.forWO', { workOrderId: W }).data.rows[0].Quantity, 2);
  code(A(tok.T, 'inventory.returnFromWO', { WorkOrderID: W, ItemCode: 'SP-0002', Quantity: 1 }), 'CONFLICT', 'returnExceeds');
});
t('WO yang sudah ditutup tidak bisa memakai stok', () => {
  ctx.Db.update('WORK_ORDERS', W, { Status: 'Closed' }, 'x');
  code(A(tok.T, 'inventory.useOnWO', { WorkOrderID: W, ItemCode: I1, Quantity: 1 }), 'CONFLICT', 'badState');
  code(A(tok.T, 'inventory.returnFromWO', { WorkOrderID: W, ItemCode: I1, Quantity: 1 }), 'CONFLICT', 'badState');
});

console.log('\n[4] Hapus, riwayat & audit');
t('Hapus item hanya saat stok 0 dan wajib alasan; item terhapus hilang dari daftar', () => {
  code(A(tok.M, 'inventory.remove', { id: I1, reason: 'x' }), 'CONFLICT', 'stockNotZero');
  assert.ok(A(tok.M, 'inventory.transact', { ItemCode: I1, TransactionType: 'ADJUST', Quantity: 0, Remarks: 'habis' }).ok);
  assert.strictEqual(A(tok.M, 'inventory.remove', { id: I1 }).code, 'VALIDATION'); code(A(tok.S, 'inventory.remove', { id: I1, reason: 'x' }), 'FORBIDDEN');
  assert.ok(A(tok.M, 'inventory.remove', { id: I1, reason: 'obsolete' }).ok);
  assert.ok(!A(tok.V, 'inventory.list', {}).data.rows.some(r => r.ItemCode === I1));
  assert.ok(A(tok.V, 'inventory.transactions', {}).data.rows.length > 5);
});
t('Konsistensi: tiap transaksi StockAfter = StockBefore ± Quantity', () => {
  ctx.Db.all('INVENTORY_TRANSACTIONS').forEach(x => {
    const d = Number(x.StockAfter) - Number(x.StockBefore);
    if (x.TransactionType === 'IN') assert.ok(Math.abs(d - Number(x.Quantity)) < 1e-9);
    if (x.TransactionType === 'OUT') assert.ok(Math.abs(d + Number(x.Quantity)) < 1e-9);
  });
});
t('Audit tercatat', () => {
  const acts = new Set(ctx.Db.all('AUDIT_LOG').map(a => a.Action));
  ['ITEM_CREATE', 'ITEM_UPDATE', 'ITEM_DELETE', 'STOCK_IN', 'STOCK_OUT', 'STOCK_ADJUST'].forEach(a => assert.ok(acts.has(a), a));
});
console.log('\nHasil: ' + pass + ' lulus, ' + fail + ' gagal');
process.exit(fail ? 1 : 0);
