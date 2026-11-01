function apiGetDashboard(token) {
  requireAuth_(token);
  const equipment = rowsAsObjects_(EMMS.SHEETS.EQUIPMENT).filter(r => String(r.IsDeleted).toLowerCase() !== 'true');
  const count = status => equipment.filter(r => r.EquipmentStatus === status).length;
  const users = rowsAsObjects_(EMMS.SHEETS.USERS).filter(u => u.Status === 'Active').length;
  const byCategory = {};
  equipment.forEach(r => {
    const key = r.CategoryID || 'Uncategorized';
    byCategory[key] = (byCategory[key] || 0) + 1;
  });
  const audit = rowsAsObjects_(EMMS.SHEETS.AUDIT_LOG).slice(-8).reverse();
  return {
    totalEquipment: equipment.length,
    normal: count('Normal'), warning: count('Warning'),
    breakdown: count('Breakdown'), inactive: count('Inactive'),
    activeUsers: users,
    categoryBreakdown: Object.keys(byCategory).map(k => ({ category: k, count: byCategory[k] })),
    recentActivity: audit
  };
}
