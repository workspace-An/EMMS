/**
 * EMMS - Dashboard.gs
 * Ringkasan dashboard. Dihitung dari tabel yang ada; modul fase berikutnya (inspeksi, PM, CM, WO, K3)
 * otomatis terisi saat tabelnya mulai berisi data - tidak perlu mengubah file ini.
 */
const Dashboard = {
  summary: function (p, user) {
    const today = Db.today();
    const soon = Db.addDays(today, 7);
    const eq = Db.all('EQUIPMENT').filter(function (e) { return e.Status === 'Active'; });
    const lk = Equipment.lookups_();

    const countBy = function (arr, fn) {
      const m = {};
      arr.forEach(function (x) { const k = fn(x); m[k] = (m[k] || 0) + 1; });
      return m;
    };

    const byStatus = countBy(eq, function (e) { return e.EquipmentStatus; });
    const byCond = countBy(eq, function (e) { return e.Condition; });
    const byCat = countBy(eq, function (e) { return lk.cat[e.CategoryID] || '-'; });

    const activeIds = {};
    eq.forEach(function (e) { activeIds[e.EquipmentID] = true; });
    const inspToday = Db.where('DAILY_INSPECTIONS', function (i) { return i.InspectionDate === today; });
    const inspected = {};
    inspToday.forEach(function (i) { if (activeIds[i.EquipmentID]) inspected[i.EquipmentID] = true; });

    const pm = Db.where('PM_SCHEDULES', function (s) { return s.Status === 'Active' && s.NextDueDate; });
    const cmOpen = Db.where('CORRECTIVE_MAINTENANCE', function (c) { return ['Open', 'In Progress', 'Pending'].indexOf(c.Status) !== -1; });
    const woOpen = Db.where('WORK_ORDERS', function (w) { return ['Closed', 'Cancelled', 'Rejected'].indexOf(w.Status) === -1; });
    const ngOpen = Db.where('DAILY_INSPECTIONS', function (i) { return i.Status === 'Open'; });
    const k3Open = Db.where('ELECTRICAL_SAFETY', function (s) { return s.Status !== 'Closed'; });

    // 12 bulan terakhir (PM selesai + CM dilaporkan)
    const months = [];
    for (let i = 11; i >= 0; i--) months.push(Db.addMonthsKey(-i));
    const pmDone = countBy(Db.where('PREVENTIVE_MAINTENANCE', function (r) { return r.ActualDate && r.ApprovalStatus !== 'Rejected'; }), function (r) { return r.ActualDate.slice(0, 7); });
    const cmRep = countBy(Db.all('CORRECTIVE_MAINTENANCE'), function (r) { return String(r.DateReported).slice(0, 7); });

    const users = {};
    Db.all('USERS').forEach(function (u) { users[Auth.norm(u.Email)] = u.FullName; });
    const tech = countBy(woOpen.filter(function (w) { return w.AssignedTo; }), function (w) { return users[Auth.norm(w.AssignedTo)] || w.AssignedTo; });

    const topCat = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });

    return {
      cards: {
        totalEquipment: eq.length,
        normal: byStatus.Normal || 0,
        warning: byStatus.Warning || 0,
        breakdown: byStatus.Breakdown || 0,
        inspectionsToday: inspToday.length,
        notInspected: eq.length - Object.keys(inspected).length,
        ngOpen: ngOpen.length,
        criticalOpen: ngOpen.filter(function (i) { return i.OverallResult === 'Critical'; }).length,
        pmUpcoming: pm.filter(function (s) { return s.NextDueDate >= today && s.NextDueDate <= soon; }).length,
        pmOverdue: pm.filter(function (s) { return s.NextDueDate < today; }).length,
        pmAwaiting: Db.where('PREVENTIVE_MAINTENANCE', function (r) { return r.ApprovalStatus === 'Pending'; }).length,
        cmActive: cmOpen.length,
        woOpen: woOpen.length,
        woAwaiting: woOpen.filter(function (w) { return w.Status === 'Requested'; }).length,
        k3Findings: k3Open.length
      },
      charts: {
        condition: { labels: CFG.CONDITIONS, values: CFG.CONDITIONS.map(function (c) { return byCond[c] || 0; }) },
        status: { labels: CFG.EQUIPMENT_STATUSES, values: CFG.EQUIPMENT_STATUSES.map(function (s) { return byStatus[s] || 0; }) },
        category: { labels: topCat.slice(0, 10), values: topCat.slice(0, 10).map(function (k) { return byCat[k]; }) },
        monthly: {
          labels: months,
          pm: months.map(function (m) { return pmDone[m] || 0; }),
          cm: months.map(function (m) { return cmRep[m] || 0; })
        },
        technician: { labels: Object.keys(tech), values: Object.keys(tech).map(function (k) { return tech[k]; }) }
      },
      activity: Auth.can(user, 'audit.view') ? Audit.list({ limit: 12 }) : null,
      today: today
    };
  }
};
