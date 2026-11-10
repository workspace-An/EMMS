/**
 * EMMS - Inventory.gs  (Phase 6: Suku cadang)
 * Master suku cadang + mutasi stok. Aturan inti:
 *  - Stok HANYA berubah lewat transaksi (IN / OUT / ADJUST) yang dihitung server di dalam kunci:
 *    StockBefore/StockAfter dicatat, stok tidak boleh negatif, klien tidak bisa menulis CurrentStock.
 *  - OUT pada Work Order hanya untuk WO Approved/In Progress oleh teknisi yang ditugaskan (atau Supervisor+).
 *  - Pengembalian dari WO tidak boleh melebihi jumlah yang dipakai WO tersebut.
 *  - ADJUST (stock opname) hanya Manager/Admin dan wajib alasan.
 *  - Saat stok turun melewati batas minimum, email ke Supervisor/Manager/Admin (sekali per penurunan).
 */
const Inventory = {
  TYPES: ['IN', 'OUT', 'ADJUST'],
  MAX_QTY: 1000000,
  rec_: function (code) {
    const r = Db.get('SPARE_PARTS', String(code || ''));
    if (!r) throw new AppError('NOT_FOUND', 'Item not found');
    return r;
  },
  qty_: function (v, allowZero) {
    const n = Number(String(v === undefined || v === null ? '' : v).replace(',', '.'));
    if (!isFinite(n) || n < 0 || (!allowZero && n === 0) || n > Inventory.MAX_QTY) throw validationError_([{ field: 'Quantity', rule: 'invalid' }]);
    return Math.round(n * 1000) / 1000;
  },
  low_: function (r) { return Number(r.CurrentStock) <= Number(r.MinimumStock) && Number(r.MinimumStock) > 0; },
  pub_: function (r) {
    return {
      ItemCode: r.ItemCode, ItemName: r.ItemName, Category: r.Category, Brand: r.Brand, Specification: r.Specification, Unit: r.Unit, CurrentStock: Number(r.CurrentStock) || 0,
      MinimumStock: Number(r.MinimumStock) || 0, StorageLocation: r.StorageLocation, Supplier: r.Supplier, Low: Inventory.low_(r), UpdatedAt: r.UpdatedAt
    };
  },

  list: function (p) {
    p = p || {};
    const q = String(p.q || '').toLowerCase();
    const rows = Db.all('SPARE_PARTS').filter(function (r) {
      if (p.low && !Inventory.low_(r)) return false;
      if (q && [r.ItemCode, r.ItemName, r.Brand, r.Category, r.Specification].join(' ').toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).map(Inventory.pub_);
    rows.sort(function (a, b) { return (b.Low - a.Low) || (a.ItemName < b.ItemName ? -1 : 1); });
    return { rows: rows.slice(0, 500) };
  },

  get: function (p) {
    const r = Inventory.rec_(p && p.id);
    const tx = Db.where('INVENTORY_TRANSACTIONS', function (x) { return x.ItemCode === r.ItemCode; }).reverse().slice(0, 100).map(Inventory.txPub_);
    return { item: Inventory.pub_(r), transactions: tx };
  },

  txPub_: function (x) {
    return {
      TransactionID: x.TransactionID, ItemCode: x.ItemCode, TransactionType: x.TransactionType, Quantity: Number(x.Quantity), StockBefore: Number(x.StockBefore), StockAfter: Number(x.StockAfter),
      ReferenceType: x.ReferenceType, ReferenceID: x.ReferenceID, Remarks: x.Remarks, By: x.CreatedBy, At: x.CreatedAt
    };
  },

  validateItem_: function (p) {
    const errors = [];
    const name = String(p.ItemName || '').trim(), unit = String(p.Unit || '').trim();
    if (!name) errors.push({ field: 'ItemName', rule: 'required' }); else if (name.length > 120) errors.push({ field: 'ItemName', rule: 'tooLong' });
    if (!unit) errors.push({ field: 'Unit', rule: 'required' }); else if (unit.length > 20) errors.push({ field: 'Unit', rule: 'tooLong' });
    [['Category', 60], ['Brand', 60], ['Specification', 300], ['StorageLocation', 80], ['Supplier', 120]].forEach(function (f) {
      if (String(p[f[0]] || '').length > f[1]) errors.push({ field: f[0], rule: 'tooLong' });
    });
    let min = 0;
    if (p.MinimumStock !== undefined && p.MinimumStock !== '') { min = Number(String(p.MinimumStock).replace(',', '.')); if (!isFinite(min) || min < 0 || min > Inventory.MAX_QTY) errors.push({ field: 'MinimumStock', rule: 'invalid' }); }
    return { errors: errors, v: { ItemName: name, Unit: unit, MinimumStock: min, Category: String(p.Category || '').trim(), Brand: String(p.Brand || '').trim(), Specification: String(p.Specification || '').trim(), StorageLocation: String(p.StorageLocation || '').trim(), Supplier: String(p.Supplier || '').trim() } };
  },

  save: function (p, user) {
    p = p || {};
    const chk = Inventory.validateItem_(p);
    let opening = 0;
    if (!p.ItemCode) {
      if (p.CurrentStock !== undefined && p.CurrentStock !== '') { try { opening = Inventory.qty_(p.CurrentStock, true); } catch (e) { chk.errors.push({ field: 'CurrentStock', rule: 'invalid' }); } }
    }
    if (chk.errors.length) throw validationError_(chk.errors);
    return Db.withLock(function () {
      const dup = Db.all('SPARE_PARTS').filter(function (r) {
        return r.ItemCode !== p.ItemCode && r.ItemName.toLowerCase() === chk.v.ItemName.toLowerCase() && String(r.Brand).toLowerCase() === chk.v.Brand.toLowerCase() && String(r.Specification).toLowerCase() === chk.v.Specification.toLowerCase();
      })[0];
      if (dup) throw new AppError('CONFLICT', 'Duplicate', { rule: 'duplicate', itemCode: dup.ItemCode });
      if (p.ItemCode) {
        const cur = Inventory.rec_(p.ItemCode);
        if (p.expectedUpdatedAt && p.expectedUpdatedAt !== cur.UpdatedAt) throw new AppError('CONFLICT', 'Stale', { rule: 'stale' });
        Db.update('SPARE_PARTS', cur.ItemCode, chk.v, user.email);
        Audit.log(user, 'ITEM_UPDATE', 'SPARE_PARTS', cur.ItemCode, chk.v, 'OK');
        return { ItemCode: cur.ItemCode };
      }
      const rec = Db.insert('SPARE_PARTS', Object.assign({ CurrentStock: 0, Status: 'Active' }, chk.v), user.email);
      Audit.log(user, 'ITEM_CREATE', 'SPARE_PARTS', rec.ItemCode, chk.v, 'OK');
      if (opening > 0) Inventory.move_(rec.ItemCode, 'IN', opening, { remarks: 'Stok awal' }, user);
      return { ItemCode: rec.ItemCode };
    });
  },

  remove: function (p, user) {
    const why = String(p && p.reason || '').trim();
    if (!why) throw validationError_([{ field: 'reason', rule: 'required' }]);
    return Db.withLock(function () {
      const r = Inventory.rec_(p.id);
      if ((Number(r.CurrentStock) || 0) > 0) throw new AppError('CONFLICT', 'Stock not zero', { rule: 'stockNotZero' });
      Db.update('SPARE_PARTS', r.ItemCode, { Status: 'Deleted' }, user.email);
      Audit.log(user, 'ITEM_DELETE', 'SPARE_PARTS', r.ItemCode, { reason: why }, 'OK');
      return { ItemCode: r.ItemCode };
    });
  },

  /** Inti mutasi stok. HARUS dipanggil di dalam Db.withLock (reentrant). */
  move_: function (code, type, qty, o, user) {
    return Db.withLock(function () {
      const r = Inventory.rec_(code);
      const before = Number(r.CurrentStock) || 0;
      let after;
      if (type === 'IN') after = before + qty;
      else if (type === 'OUT') { after = before - qty; if (after < -1e-9) throw new AppError('CONFLICT', 'Insufficient', { rule: 'insufficient', available: before }); }
      else after = qty;                                    // ADJUST: qty = hasil hitung fisik
      after = Math.round(after * 1000) / 1000;
      const tx = Db.insert('INVENTORY_TRANSACTIONS', {
        ItemCode: r.ItemCode, TransactionType: type, Quantity: type === 'ADJUST' ? Math.abs(after - before) : qty, StockBefore: before, StockAfter: after,
        ReferenceType: o.refType || '', ReferenceID: o.refId || '', Remarks: o.remarks || ''
      }, user.email);
      Db.update('SPARE_PARTS', r.ItemCode, { CurrentStock: after }, user.email);
      Audit.log(user, 'STOCK_' + type, 'SPARE_PARTS', r.ItemCode, { qty: qty, before: before, after: after, ref: o.refId || '' }, 'OK');
      const crossed = Number(r.MinimumStock) > 0 && before > Number(r.MinimumStock) && after <= Number(r.MinimumStock);
      return { TransactionID: tx.TransactionID, StockBefore: before, StockAfter: after, crossedLow: crossed, item: r };
    });
  },

  /** Transaksi manual: IN (penerimaan), OUT (pengeluaran umum), ADJUST (opname). */
  transact: function (p, user) {
    p = p || {};
    const type = String(p.TransactionType || '');
    if (Inventory.TYPES.indexOf(type) === -1) throw validationError_([{ field: 'TransactionType', rule: 'invalid' }]);
    const qty = Inventory.qty_(p.Quantity, type === 'ADJUST');
    const remarks = String(p.Remarks || '').trim();
    if (remarks.length > 300) throw validationError_([{ field: 'Remarks', rule: 'tooLong' }]);
    if (type === 'ADJUST') {
      if (!Auth.can(user, 'inventory.manage')) throw new AppError('FORBIDDEN', 'Forbidden', { rule: 'inventory.manage' });
      if (!remarks) throw validationError_([{ field: 'Remarks', rule: 'required' }]);
    }
    if (type === 'OUT' && !remarks) throw validationError_([{ field: 'Remarks', rule: 'required' }]);   // OUT tanpa WO wajib beralasan
    const res = Inventory.move_(p.ItemCode, type, qty, { remarks: remarks, refType: type === 'IN' ? 'PO' : '', refId: String(p.Reference || '').slice(0, 60) }, user);
    const alerted = res.crossedLow ? Notify.lowStock(Inventory.rec_(p.ItemCode)) : null;
    return { TransactionID: res.TransactionID, StockAfter: res.StockAfter, low: res.crossedLow, notified: alerted };
  },

  // ----------------------------------------------------------------- pemakaian pada Work Order
  woCtx_: function (woId, user) {
    const wo = Db.get('WORK_ORDERS', String(woId || ''));
    if (!wo) throw new AppError('NOT_FOUND', 'Work order not found');
    const mine = Auth.norm(wo.AssignedTo) === Auth.norm(user.email);
    if (!(mine || Auth.can(user, 'inventory.stock'))) throw new AppError('FORBIDDEN', 'Not assignee', { rule: 'notAssignee' });
    return wo;
  },
  usedOnWO_: function (woId) {
    // net per item = OUT - IN yang mereferensi WO ini
    const net = {};
    Db.where('INVENTORY_TRANSACTIONS', function (x) { return x.ReferenceType === 'WO' && x.ReferenceID === woId; }).forEach(function (x) {
      net[x.ItemCode] = (net[x.ItemCode] || 0) + (x.TransactionType === 'OUT' ? Number(x.Quantity) : -Number(x.Quantity));
    });
    return net;
  },
  forWO: function (p, user) {
    const wo = Db.get('WORK_ORDERS', String(p && p.workOrderId || ''));
    if (!wo) throw new AppError('NOT_FOUND', 'Work order not found');
    const net = Inventory.usedOnWO_(wo.WorkOrderID);
    const rows = Object.keys(net).filter(function (k) { return Math.abs(net[k]) > 1e-9; }).map(function (k) {
      const it = Db.get('SPARE_PARTS', k, { includeDeleted: true });
      return { ItemCode: k, ItemName: it ? it.ItemName : k, Unit: it ? it.Unit : '', Quantity: Math.round(net[k] * 1000) / 1000 };
    });
    const mine = Auth.norm(wo.AssignedTo) === Auth.norm(user.email);
    return { rows: rows, can: { use: Auth.can(user, 'inventory.use') && ['Approved', 'In Progress'].indexOf(wo.Status) !== -1 && (mine || Auth.can(user, 'inventory.stock')) } };
  },
  useOnWO: function (p, user) {
    p = p || {};
    const qty = Inventory.qty_(p.Quantity);
    const out = Db.withLock(function () {
      const wo = Inventory.woCtx_(p.WorkOrderID, user);
      if (['Approved', 'In Progress'].indexOf(wo.Status) === -1) throw new AppError('CONFLICT', 'Bad state', { rule: 'badState' });
      const r = Inventory.move_(p.ItemCode, 'OUT', qty, { refType: 'WO', refId: wo.WorkOrderID, remarks: String(p.Remarks || '').slice(0, 300) }, user);
      return r;
    });
    const alerted = out.crossedLow ? Notify.lowStock(Inventory.rec_(p.ItemCode)) : null;
    return { TransactionID: out.TransactionID, StockAfter: out.StockAfter, low: out.crossedLow, notified: alerted };
  },
  returnFromWO: function (p, user) {
    p = p || {};
    const qty = Inventory.qty_(p.Quantity);
    return Db.withLock(function () {
      const wo = Inventory.woCtx_(p.WorkOrderID, user);
      if (['Approved', 'In Progress', 'Completed'].indexOf(wo.Status) === -1) throw new AppError('CONFLICT', 'Bad state', { rule: 'badState' });
      const used = Inventory.usedOnWO_(wo.WorkOrderID)[String(p.ItemCode)] || 0;
      if (qty > used + 1e-9) throw new AppError('CONFLICT', 'Return exceeds used', { rule: 'returnExceeds', used: used });
      const r = Inventory.move_(p.ItemCode, 'IN', qty, { refType: 'WO', refId: wo.WorkOrderID, remarks: 'Pengembalian dari WO' }, user);
      return { TransactionID: r.TransactionID, StockAfter: r.StockAfter };
    });
  },

  transactions: function (p) {
    p = p || {};
    const rows = Db.all('INVENTORY_TRANSACTIONS').filter(function (x) {
      if (p.itemCode && x.ItemCode !== p.itemCode) return false;
      if (p.type && x.TransactionType !== p.type) return false;
      return true;
    }).map(Inventory.txPub_).reverse().slice(0, 300);
    return { rows: rows };
  }
};
