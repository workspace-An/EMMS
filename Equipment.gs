function apiListEquipment(token, filters) {
  const actor = requireAuth_(token);
  const f = filters || {};
  let rows = rowsAsObjects_(EMMS.SHEETS.EQUIPMENT).filter(r => String(r.IsDeleted).toLowerCase() !== 'true');
  if (f.search) {
    const q = String(f.search).toLowerCase();
    rows = rows.filter(r => [r.EquipmentID,r.EquipmentName,r.Brand,r.Model,r.SerialNumber].join(' ').toLowerCase().includes(q));
  }
  if (f.status) rows = rows.filter(r => r.EquipmentStatus === f.status);
  if (f.categoryId) rows = rows.filter(r => r.CategoryID === f.categoryId);
  if (f.buildingId) rows = rows.filter(r => r.BuildingID === f.buildingId);
  rows.sort((a,b) => String(b.UpdatedAt).localeCompare(String(a.UpdatedAt)));
  return rows.slice(0, EMMS.PAGE_SIZE);
}

function apiGetEquipment(token, equipmentId) {
  requireAuth_(token);
  const row = rowsAsObjects_(EMMS.SHEETS.EQUIPMENT).find(r =>
    r.EquipmentID === String(equipmentId) && String(r.IsDeleted).toLowerCase() !== 'true');
  if (!row) throw new Error('Equipment tidak ditemukan.');
  return row;
}

function apiSaveEquipment(token, data) {
  const actor = requireAuth_(token);
  requireRole_(actor, ['Admin','Maintenance Manager','Supervisor','Technician']);
  const d = data || {};
  const name = cleanText_(d.equipmentName, 120);
  if (!name) throw new Error('Equipment Name wajib diisi.');
  const status = d.equipmentStatus || 'Normal';
  const condition = d.equipmentCondition || 'Good';
  if (EMMS.EQUIPMENT_STATUSES.indexOf(status) < 0) throw new Error('Equipment Status tidak valid.');
  if (EMMS.CONDITIONS.indexOf(condition) < 0) throw new Error('Equipment Condition tidak valid.');

  const now = new Date();
  const payload = {
    EquipmentName: name,
    CategoryID: cleanText_(d.categoryId, 50),
    BuildingID: cleanText_(d.buildingId, 50),
    LocationID: cleanText_(d.locationId, 50),
    ProductionArea: cleanText_(d.productionArea, 120),
    Brand: cleanText_(d.brand, 100),
    Model: cleanText_(d.model, 100),
    SerialNumber: cleanText_(d.serialNumber, 100),
    ElectricalSpecification: cleanText_(d.electricalSpecification, 250),
    Voltage: cleanText_(d.voltage, 40),
    Current: cleanText_(d.current, 40),
    PowerRating: cleanText_(d.powerRating, 40),
    InstallationDate: cleanText_(d.installationDate, 30),
    CommissioningDate: cleanText_(d.commissioningDate, 30),
    EquipmentCondition: condition,
    EquipmentStatus: status,
    EquipmentPhotoURL: cleanText_(d.equipmentPhotoURL, 500),
    Notes: cleanText_(d.notes, 1000),
    UpdatedAt: now, UpdatedBy: actor.Email
  };

  if (d.equipmentId) {
    const existing = rowsAsObjects_(EMMS.SHEETS.EQUIPMENT).find(r => r.EquipmentID === d.equipmentId);
    if (!existing) throw new Error('Equipment tidak ditemukan.');
    Object.assign(payload, { IsDeleted: false });
    updateObjectById_(EMMS.SHEETS.EQUIPMENT, 'EquipmentID', d.equipmentId, payload);
    audit_(actor, 'UPDATE', 'EQUIPMENT', d.equipmentId, { equipmentName: name });
    return { ok: true, equipmentId: d.equipmentId };
  }

  const id = nextId_('EQP');
  const row = Object.assign({
    EquipmentID: id, CreatedAt: now, CreatedBy: actor.Email, IsDeleted: false
  }, payload);
  appendObject_(EMMS.SHEETS.EQUIPMENT, row);
  createEquipmentQr_(actor, id);
  audit_(actor, 'CREATE', 'EQUIPMENT', id, { equipmentName: name });
  return { ok: true, equipmentId: id };
}

function apiDeleteEquipment(token, equipmentId) {
  const actor = requireAuth_(token);
  requireRole_(actor, ['Admin','Maintenance Manager']);
  const row = rowsAsObjects_(EMMS.SHEETS.EQUIPMENT).find(r => r.EquipmentID === equipmentId);
  if (!row) throw new Error('Equipment tidak ditemukan.');
  updateObjectById_(EMMS.SHEETS.EQUIPMENT, 'EquipmentID', equipmentId, {
    IsDeleted: true, EquipmentStatus: 'Inactive', UpdatedAt: new Date(), UpdatedBy: actor.Email
  });
  audit_(actor, 'SOFT_DELETE', 'EQUIPMENT', equipmentId, {});
  return { ok: true };
}

function createEquipmentQr_(actor, equipmentId) {
  const webUrl = getConfig_().webAppUrl;
  const payload = webUrl ? webUrl + '?equipment=' + encodeURIComponent(equipmentId) : 'EMMS-EQUIPMENT:' + equipmentId;
  const imageUrl = 'https://chart.googleapis.com/chart?cht=qr&chs=220x220&chl=' + encodeURIComponent(payload);
  appendObject_(EMMS.SHEETS.EQUIPMENT_QR_CODES, {
    QRCodeID: nextId_('QR'), EquipmentID: equipmentId,
    QRPayload: payload, QRImageURL: imageUrl,
    CreatedAt: new Date(), CreatedBy: actor.Email
  });
}

function apiGetEquipmentQr(token, equipmentId) {
  requireAuth_(token);
  const qr = rowsAsObjects_(EMMS.SHEETS.EQUIPMENT_QR_CODES).find(r => r.EquipmentID === equipmentId);
  if (!qr) throw new Error('QR belum tersedia.');
  return qr;
}
