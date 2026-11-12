/**
 * EMMS - Reports.gs  (Phase 8: laporan)
 * Semua agregasi dihitung di server dari sheet (klien hanya menampilkan / mengekspor).
 * Format hasil seragam agar tampilan, ekspor CSV, dan cetak memakai kode yang sama:
 *   { type, from, to, kpis: [{key, value, unit?}], tables: [{key, columns: [key], rows: [[...]]}] }
 * Kunci (key) diterjemahkan di klien (rep.k.*, rep.t.*, rep.c.*).
 */
const Reports = {
  TYPES: ['summary', 'inspection', 'pm', 'cm', 'wo', 'safety', 'inventory', 'equipment'],
  MAX_DAYS: 366,
  LIST_CAP: 500,

  range_: function (p) {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const to = String(p.to || Db.today()), from = String(p.from || Db.addDays(to, -29));
    const errors = [];
    if (!re.test(from) || isNaN(new Date(from + 'T00:00:00Z'))) errors.push({ field: 'from', rule: 'invalid' });
    if (!re.test(to) || isNaN(new Date(to + 'T00:00:00Z'))) errors.push({ field: 'to', rule: 'invalid' });
    if (!errors.length) {
      if (from > to) errors.push({ field: 'to', rule: 'dateOrder' });
      else if (Automation.daysBetween_(from, to) > Reports.MAX_DAYS) errors.push({ field: 'to', rule: 'rangeTooLong' });
    }
    if (errors.length) throw validationError_(errors);
    return { from: from, to: to };
  },
  inRange_: function (d, r) { const x = String(d || '').slice(0, 10); return x >= r.from && x <= r.to; },
  r1_: function (n) { return Math.round(n * 10) / 10; },
  pct_: function (a, b) { return b ? Reports.r1_(a * 100 / b) : 0; },
  avg_: function (arr) { return arr.length ? Reports.r1_(arr.reduce(function (s, x) { return s + x; }, 0) / arr.length) : 0; },
  hoursBetween_: function (a, b) { const x = new Date(String(a).replace(' ', 'T') + 'Z'), y = new Date(String(b).replace(' ', 'T') + 'Z'); const h = (y - x) / 3600000; return isFinite(h) && h >= 0 ? h : null; },
  count_: function (rows, fn) { const m = {}; rows.forEach(function (r) { const k = fn(r) || '-'; m[k] = (m[k] || 0) + 1; }); return m; },
  pairs_: function (m, limit) {
    const a = Object.keys(m).map(function (k) { return [k, m[k]]; }).sort(function (x, y) { return y[1] - x[1] || (x[0] < y[0] ? -1 : 1); });
    return limit ? a.slice(0, limit) : a;
  },
  eqMap_: function () { const m = {}; Db.all('EQUIPMENT', { includeDeleted: true }).forEach(function (e) { m[e.EquipmentID] = e; }); return m; },
  eqName_: function (m, id) { return id ? id + ' ' + (m[id] ? m[id].EquipmentName : '') : '-'; },

  run: function (p) {
    p = p || {};
    const type = String(p.type || '');
    if (Reports.TYPES.indexOf(type) === -1) throw validationError_([{ field: 'type', rule: 'invalid' }]);
    const r = Reports.range_(p);
    const out = Reports[type + '_'](r);
    out.type = type; out.from = r.from; out.to = r.to; out.generatedAt = Db.now();
    return out;
  },

  // ----------------------------------------------------------------- inspeksi
  inspection_: function (r) {
    const eq = Reports.eqMap_();
    const rows = Db.all('DAILY_INSPECTIONS').filter(function (i) { return Reports.inRange_(i.InspectionDate, r); });
    const ng = rows.filter(function (i) { return i.OverallResult === 'NG'; }).length, cr = rows.filter(function (i) { return i.OverallResult === 'Critical'; }).length;
    const perDay = {};
    rows.forEach(function (i) { const d = perDay[i.InspectionDate] = perDay[i.InspectionDate] || [0, 0, 0]; d[0]++; if (i.OverallResult === 'NG') d[1]++; if (i.OverallResult === 'Critical') d[2]++; });
    const noOk = rows.filter(function (i) { return i.OverallResult !== 'OK'; });
    const tech = Reports.count_(rows, function (i) { return i.TechnicianName; });
    return {
      kpis: [{ key: 'total', value: rows.length }, { key: 'equipment', value: Object.keys(Reports.count_(rows, function (i) { return i.EquipmentID; })).length }, { key: 'ng', value: ng }, { key: 'critical', value: cr },
        { key: 'okRate', value: Reports.pct_(rows.length - ng - cr, rows.length), unit: '%' }],
      tables: [
        { key: 'perDay', columns: ['date', 'total', 'ng', 'critical'], rows: Object.keys(perDay).sort().map(function (d) { return [d, perDay[d][0], perDay[d][1], perDay[d][2]]; }) },
        { key: 'topNg', columns: ['equipment', 'findings'], rows: Reports.pairs_(Reports.count_(noOk, function (i) { return Reports.eqName_(eq, i.EquipmentID); }), 10) },
        { key: 'byTech', columns: ['technician', 'total'], rows: Reports.pairs_(tech) }
      ]
    };
  },

  // ----------------------------------------------------------------- PM
  pm_: function (r) {
    const eq = Reports.eqMap_(), today = Db.today();
    const rows = Db.all('PREVENTIVE_MAINTENANCE').filter(function (x) { return Reports.inRange_(x.PlannedDate || x.ActualDate, r); });
    const onTime = rows.filter(function (x) { return x.ActualDate && x.PlannedDate && x.ActualDate <= x.PlannedDate; }).length;
    const overdue = Db.where('PM_SCHEDULES', function (s) { return s.Status === 'Active' && s.NextDueDate && s.NextDueDate < today; });
    const byTech = {};
    rows.forEach(function (x) { const d = byTech[x.Technician || '-'] = byTech[x.Technician || '-'] || [0, 0]; d[0]++; if (x.ActualDate && x.PlannedDate && x.ActualDate <= x.PlannedDate) d[1]++; });
    return {
      kpis: [{ key: 'done', value: rows.length }, { key: 'onTime', value: onTime }, { key: 'late', value: rows.length - onTime }, { key: 'compliance', value: Reports.pct_(onTime, rows.length), unit: '%' },
        { key: 'pendingApproval', value: rows.filter(function (x) { return x.ApprovalStatus === 'Pending'; }).length }, { key: 'rejected', value: rows.filter(function (x) { return x.ApprovalStatus === 'Rejected'; }).length },
        { key: 'overdueNow', value: overdue.length }],
      tables: [
        { key: 'byTech', columns: ['technician', 'done', 'onTime'], rows: Object.keys(byTech).sort().map(function (k) { return [k, byTech[k][0], byTech[k][1]]; }) },
        { key: 'overdueList', columns: ['pmTitle', 'equipment', 'dueDate', 'daysLate'], rows: overdue.map(function (s) { return [s.PMTitle, Reports.eqName_(eq, s.EquipmentID), s.NextDueDate, Automation.daysBetween_(s.NextDueDate, today)]; }).sort(function (a, b) { return b[3] - a[3]; }).slice(0, Reports.LIST_CAP) },
        { key: 'results', columns: ['result', 'total'], rows: Reports.pairs_(Reports.count_(rows, function (x) { return x.MaintenanceResult; })) }
      ]
    };
  },

  // ----------------------------------------------------------------- corrective
  cm_: function (r) {
    const eq = Reports.eqMap_();
    const rows = Db.all('CORRECTIVE_MAINTENANCE').filter(function (c) { return Reports.inRange_(c.DateReported, r); });
    const mttr = [];
    rows.forEach(function (c) { if (c.FinishTime && ['Completed', 'Closed'].indexOf(c.Status) !== -1) { const h = Reports.hoursBetween_(c.CreatedAt, c.FinishTime); if (h !== null) mttr.push(h); } });
    const open = rows.filter(function (c) { return ['Completed', 'Closed'].indexOf(c.Status) === -1; }).length;
    const perEq = Reports.count_(rows, function (c) { return c.EquipmentID; });
    const repeat = Object.keys(perEq).filter(function (k) { return perEq[k] >= 2; }).length;
    const matrix = {};
    rows.forEach(function (c) { const m = matrix[c.Priority] = matrix[c.Priority] || {}; m[c.Status] = (m[c.Status] || 0) + 1; });
    const sts = ['Open', 'In Progress', 'Pending', 'Completed', 'Closed'];
    return {
      kpis: [{ key: 'total', value: rows.length }, { key: 'open', value: open }, { key: 'critical', value: rows.filter(function (c) { return c.Priority === 'Critical'; }).length }, { key: 'mttrHours', value: Reports.avg_(mttr), unit: 'h' }, { key: 'repeatEquipment', value: repeat }],
      tables: [
        { key: 'byPriority', columns: ['priority'].concat(sts), rows: ['Critical', 'High', 'Medium', 'Low'].map(function (pr) { return [pr].concat(sts.map(function (s) { return (matrix[pr] || {})[s] || 0; })); }) },
        { key: 'topEquipment', columns: ['equipment', 'failures'], rows: Reports.pairs_(Reports.count_(rows, function (c) { return Reports.eqName_(eq, c.EquipmentID); }), 10) },
        { key: 'list', columns: ['id', 'date', 'equipment', 'priority', 'status', 'mttrHours'], rows: rows.slice(-Reports.LIST_CAP).reverse().map(function (c) { const h = c.FinishTime ? Reports.hoursBetween_(c.CreatedAt, c.FinishTime) : null; return [c.ComplaintNo, c.DateReported, Reports.eqName_(eq, c.EquipmentID), c.Priority, c.Status, h === null ? '' : Reports.r1_(h)]; }) }
      ]
    };
  },

  // ----------------------------------------------------------------- work order
  wo_: function (r) {
    const rows = Db.all('WORK_ORDERS').filter(function (w) { return Reports.inRange_(w.CreatedAt, r); });
    const cyc = [];
    rows.forEach(function (w) { if (w.Status === 'Closed' && w.ClosedAt) { const h = Reports.hoursBetween_(w.CreatedAt, w.ClosedAt); if (h !== null) cyc.push(h / 24); } });
    const closed = rows.filter(function (w) { return w.Status === 'Closed'; }).length;
    const rej = rows.filter(function (w) { return w.Status === 'Rejected' || w.Status === 'Cancelled'; }).length;
    return {
      kpis: [{ key: 'total', value: rows.length }, { key: 'closed', value: closed }, { key: 'open', value: rows.filter(function (w) { return ['Requested', 'Approved', 'In Progress', 'Completed'].indexOf(w.Status) !== -1; }).length },
        { key: 'rejected', value: rej }, { key: 'cycleDays', value: Reports.avg_(cyc), unit: 'd' }, { key: 'closeRate', value: Reports.pct_(closed, rows.length), unit: '%' }],
      tables: [
        { key: 'bySource', columns: ['source', 'total'], rows: Reports.pairs_(Reports.count_(rows, function (w) { return w.SourceType; })) },
        { key: 'byStatus', columns: ['status', 'total'], rows: Reports.pairs_(Reports.count_(rows, function (w) { return w.Status; })) },
        { key: 'byPriority', columns: ['priority', 'total'], rows: Reports.pairs_(Reports.count_(rows, function (w) { return w.Priority; })) },
        { key: 'byAssignee', columns: ['technician', 'total'], rows: Reports.pairs_(Reports.count_(rows, function (w) { return w.AssignedTo; })) }
      ]
    };
  },

  // ----------------------------------------------------------------- K3
  safety_: function (r) {
    const eq = Reports.eqMap_();
    const rows = Db.all('ELECTRICAL_SAFETY').filter(function (s) { return Reports.inRange_(s.ReportDate, r); });
    const days = [];
    rows.forEach(function (s) { if (s.Status === 'Closed' && s.ClosedAt) { const h = Reports.hoursBetween_(s.CreatedAt, s.ClosedAt); if (h !== null) days.push(h / 24); } });
    const loto = Db.all('LOTO_RECORDS').filter(function (l) { return Reports.inRange_(l.AppliedAt, r); });
    return {
      kpis: [{ key: 'total', value: rows.length }, { key: 'open', value: rows.filter(function (s) { return Safety.OPEN.indexOf(s.Status) !== -1; }).length },
        { key: 'highCritical', value: rows.filter(function (s) { return s.RiskLevel === 'High' || s.RiskLevel === 'Critical'; }).length }, { key: 'closeDays', value: Reports.avg_(days), unit: 'd' },
        { key: 'lotoCount', value: loto.length }, { key: 'lotoActive', value: Db.where('LOTO_RECORDS', function (l) { return l.Status === 'Active'; }).length }],
      tables: [
        { key: 'byCategory', columns: ['category', 'total'], rows: Reports.pairs_(Reports.count_(rows, function (s) { return s.ReportType; })) },
        { key: 'byType', columns: ['type', 'total'], rows: Reports.pairs_(Reports.count_(rows, function (s) { return s.SafetyType; })) },
        { key: 'byRisk', columns: ['risk', 'total'], rows: ['Critical', 'High', 'Medium', 'Low'].map(function (k) { return [k, rows.filter(function (s) { return s.RiskLevel === k; }).length]; }) },
        { key: 'list', columns: ['id', 'date', 'equipment', 'category', 'risk', 'status'], rows: rows.slice(-Reports.LIST_CAP).reverse().map(function (s) { return [s.SafetyID, s.ReportDate, Reports.eqName_(eq, s.EquipmentID), s.ReportType, s.RiskLevel, s.Status]; }) }
      ]
    };
  },

  // ----------------------------------------------------------------- inventory
  inventory_: function (r) {
    const items = {};
    Db.all('SPARE_PARTS', { includeDeleted: true }).forEach(function (i) { items[i.ItemCode] = i; });
    const tx = Db.all('INVENTORY_TRANSACTIONS').filter(function (x) { return Reports.inRange_(x.CreatedAt, r); });
    const use = {}, inn = {};
    let sin = 0, sout = 0;
    tx.forEach(function (x) {
      const q = Number(x.Quantity) || 0;
      if (x.TransactionType === 'OUT') { sout += q; const d = use[x.ItemCode] = use[x.ItemCode] || [0, 0]; d[0] += q; if (x.ReferenceType === 'WO') d[1] += q; }
      else if (x.TransactionType === 'IN') { sin += q; inn[x.ItemCode] = (inn[x.ItemCode] || 0) + q; }
    });
    const low = Db.where('SPARE_PARTS', function (i) { return Inventory.low_(i); });
    const nm = function (k) { return items[k] ? k + ' ' + items[k].ItemName : k; };
    return {
      kpis: [{ key: 'items', value: Db.all('SPARE_PARTS').length }, { key: 'lowNow', value: low.length }, { key: 'movements', value: tx.length }, { key: 'qtyIn', value: Reports.r1_(sin) }, { key: 'qtyOut', value: Reports.r1_(sout) }],
      tables: [
        { key: 'usage', columns: ['item', 'qtyOut', 'onWO', 'unit'], rows: Object.keys(use).map(function (k) { return [nm(k), Reports.r1_(use[k][0]), Reports.r1_(use[k][1]), items[k] ? items[k].Unit : '']; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, Reports.LIST_CAP) },
        { key: 'received', columns: ['item', 'qtyIn', 'unit'], rows: Object.keys(inn).map(function (k) { return [nm(k), Reports.r1_(inn[k]), items[k] ? items[k].Unit : '']; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, Reports.LIST_CAP) },
        { key: 'lowList', columns: ['item', 'stock', 'minimum', 'unit'], rows: low.map(function (i) { return [i.ItemCode + ' ' + i.ItemName, Number(i.CurrentStock), Number(i.MinimumStock), i.Unit]; }) }
      ]
    };
  },

  // ----------------------------------------------------------------- equipment (snapshot saat ini)
  equipment_: function () {
    const rows = Db.all('EQUIPMENT');
    const cat = {}; Db.all('EQUIPMENT_CATEGORIES').forEach(function (c) { cat[c.CategoryID] = c.CategoryName; });
    const bld = {}; Db.all('BUILDINGS').forEach(function (b) { bld[b.BuildingID] = b.BuildingName; });
    const loc = {}; Db.all('LOCATIONS').forEach(function (l) { loc[l.LocationID] = l.LocationName; });
    const st = function (k) { return rows.filter(function (e) { return e.EquipmentStatus === k; }).length; };
    return {
      kpis: [{ key: 'total', value: rows.length }, { key: 'normal', value: st('Normal') }, { key: 'warning', value: st('Warning') }, { key: 'breakdown', value: st('Breakdown') },
        { key: 'poor', value: rows.filter(function (e) { return e.Condition === 'Poor'; }).length }, { key: 'availability', value: Reports.pct_(rows.length - st('Breakdown'), rows.length), unit: '%' }],
      tables: [
        { key: 'byCategory', columns: ['category', 'total', 'warning', 'breakdown'], rows: Object.keys(cat).map(function (k) { const g = rows.filter(function (e) { return e.CategoryID === k; }); return [cat[k], g.length, g.filter(function (e) { return e.EquipmentStatus === 'Warning'; }).length, g.filter(function (e) { return e.EquipmentStatus === 'Breakdown'; }).length]; }).filter(function (x) { return x[1] > 0; }) },
        { key: 'byBuilding', columns: ['building', 'total'], rows: Reports.pairs_(Reports.count_(rows, function (e) { return bld[e.BuildingID]; })) },
        { key: 'byCondition', columns: ['condition', 'total'], rows: Reports.pairs_(Reports.count_(rows, function (e) { return e.Condition; })) },
        { key: 'attention', columns: ['id', 'name', 'location', 'status', 'condition'], rows: rows.filter(function (e) { return e.EquipmentStatus !== 'Normal' || e.Condition === 'Poor'; }).map(function (e) { return [e.EquipmentID, e.EquipmentName, loc[e.LocationID] || '', e.EquipmentStatus, e.Condition]; }).slice(0, Reports.LIST_CAP) }
      ]
    };
  },

  // ----------------------------------------------------------------- ringkasan eksekutif
  summary_: function (r) {
    const kpis = [], tables = [];
    [['inspection', ['total', 'okRate', 'ng', 'critical']], ['pm', ['done', 'compliance', 'overdueNow']], ['cm', ['total', 'open', 'mttrHours']], ['wo', ['total', 'closeRate', 'cycleDays']], ['safety', ['total', 'open', 'highCritical']], ['inventory', ['lowNow', 'qtyOut']], ['equipment', ['total', 'warning', 'breakdown', 'availability']]].forEach(function (m) {
      const rep = Reports[m[0] + '_'](r);
      m[1].forEach(function (k) { const kp = rep.kpis.filter(function (x) { return x.key === k; })[0]; if (kp) kpis.push({ key: m[0] + '.' + k, value: kp.value, unit: kp.unit }); });
    });
    tables.push({ key: 'summaryTable', columns: ['indicator', 'value'], rows: kpis.map(function (k) { return [k.key, k.value + (k.unit ? ' ' + k.unit : '')]; }) });
    return { kpis: kpis, tables: tables };
  }
};
