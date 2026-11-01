function db_() {
  const c = assertConfigured_();
  return SpreadsheetApp.openById(c.spreadsheetId);
}

function sheet_(name) {
  const sh = db_().getSheetByName(name);
  if (!sh) throw new Error('Sheet tidak ditemukan: ' + name);
  return sh;
}

function headers_(sh) {
  const n = sh.getLastColumn();
  return n ? sh.getRange(1, 1, 1, n).getValues()[0] : [];
}

function rowsAsObjects_(sheetName) {
  const sh = sheet_(sheetName);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter(row => row.some(v => v !== '')).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i] instanceof Date ? row[i].toISOString() : row[i]);
    return obj;
  });
}

function appendObject_(sheetName, obj) {
  const sh = sheet_(sheetName);
  const headers = headers_(sh);
  const row = headers.map(h => obj[h] === undefined ? '' : obj[h]);
  sh.appendRow(row);
  return obj;
}

function updateObjectById_(sheetName, idHeader, id, updates) {
  const sh = sheet_(sheetName);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) throw new Error('Data tidak ditemukan.');
  const headers = values[0];
  const idCol = headers.indexOf(idHeader);
  if (idCol < 0) throw new Error('Kolom ID tidak ditemukan.');
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(id)) {
      Object.keys(updates).forEach(key => {
        const col = headers.indexOf(key);
        if (col >= 0) sh.getRange(r + 1, col + 1).setValue(updates[key]);
      });
      return true;
    }
  }
  throw new Error('Data tidak ditemukan: ' + id);
}

function nextId_(prefix) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const props = PropertiesService.getScriptProperties();
    const key = 'SEQ_' + prefix;
    const next = Number(props.getProperty(key) || 0) + 1;
    props.setProperty(key, String(next));
    return prefix + '-' + Utilities.formatString('%06d', next);
  } finally {
    lock.releaseLock();
  }
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function cleanText_(value, max) {
  const s = String(value == null ? '' : value).trim();
  if (s.length > (max || 500)) throw new Error('Panjang teks melebihi batas.');
  return s;
}

function audit_(actor, action, entity, entityId, details) {
  appendObject_(EMMS.SHEETS.AUDIT_LOG, {
    AuditID: nextId_('AUD'), Timestamp: new Date(),
    ActorEmail: actor.Email, ActorName: actor.FullName,
    Action: action, Entity: entity, EntityID: entityId || '',
    Details: JSON.stringify(details || {}), Source: 'WebApp'
  });
}
