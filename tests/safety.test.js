/** Uji backend Phase 5 (K3 Listrik: temuan, risiko 5x5, LOTO, integrasi WO). */
const assert = require('assert');
const { build } = require('./gas-mock');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 4).join('\n       ')); } };

const ctx = build(); ctx.setupEMMS(); ctx.seedDemoData();
const A = (...a) => ctx.api(...a);
const login = (email) => { A('', 'auth.requestOtp', { email }); const m = ctx.__state.mails.filter(x => x.to === email).pop(); return A('', 'auth.verifyOtp', { email, code: m.htmlBody.match(/>(\d{6})</)[1] }).data.token; };
const adm = login('owner@gmail.com');
const tok = {};
[['T', 'Technician'], ['T2', 'Technician'], ['S', 'Supervisor'], ['M', 'Maintenance Manager'], ['V', 'Viewer']].forEach(([k, r]) => {
  assert.ok(A(adm, 'users.save', { FullName: 'User ' + k, Email: k.toLowerCase() + '@gmail.com', Role: r, Department: 'EM' }).ok);
  tok[k] = login(k.toLowerCase() + '@gmail.com');
});
const eqs = ctx.Db.all('EQUIPMENT');
const E1 = eqs[0].EquipmentID, E2 = eqs[1].EquipmentID;
const st = id => ctx.Db.get('EQUIPMENT', id).EquipmentStatus;
const rep = (token, o = {}) => A(token, 'safety.report', Object.assign({ EquipmentID: E1, SafetyType: 'UnsafeCondition', ReportType: 'Grounding', Description: 'Kabel grounding panel lepas', RiskLevel: 'Medium' }, o));
const ensureCode = (r, code, rule) => { assert.strictEqual(r.ok, false, 'harus gagal'); assert.strictEqual(r.code, code, JSON.stringify(r)); if (rule) assert.strictEqual(r.details && r.details.rule, rule, JSON.stringify(r)); };

console.log('\n[1] Laporan temuan');
let S1, S2;
t('Technician melapor; SAF-xxxx, status Open, identitas dari sesi', () => {
  const r = rep(tok.T); assert.ok(r.ok, JSON.stringify(r)); S1 = r.data.SafetyID;
  assert.match(S1, /^SAF-\d{4}$/);
  const s = ctx.Db.get('ELECTRICAL_SAFETY', S1);
  assert.strictEqual(s.Status, 'Open'); assert.strictEqual(s.ReportedBy, 'User T'); assert.strictEqual(s.ReportedByEmail, 't@gmail.com');
  assert.strictEqual(st(E1), 'Normal');
});
t('Validasi & RBAC', () => {
  const r = rep(tok.T, { EquipmentID: 'EQ-9999', SafetyType: 'x', ReportType: 'y', Description: ' ', RiskLevel: 'Z' });
  assert.strictEqual(r.code, 'VALIDATION'); assert.ok(r.details.errors.length >= 4);
  assert.strictEqual(rep(tok.V).code, 'FORBIDDEN');
  assert.ok(A(tok.V, 'safety.list', {}).ok);
});
t('High -> equipment Warning + email; Critical tidak menurunkan Breakdown', () => {
  const before = ctx.__state.mails.length;
  const r = rep(tok.T, { EquipmentID: E2, RiskLevel: 'High' }); assert.ok(r.ok); S2 = r.data.SafetyID;
  assert.strictEqual(st(E2), 'Warning'); assert.ok(r.data.notified.sent >= 1); assert.ok(ctx.__state.mails.length > before);
  ctx.Db.update('EQUIPMENT', E2, { EquipmentStatus: 'Breakdown' }, 'x');
  assert.ok(rep(tok.T, { EquipmentID: E2, RiskLevel: 'Critical' }).ok); assert.strictEqual(st(E2), 'Breakdown');
  ctx.Db.update('EQUIPMENT', E2, { EquipmentStatus: 'Normal' }, 'x');
});
t('Foto: pelapor boleh, orang lain (teknisi lain) tidak; batas 5', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  assert.ok(A(tok.T, 'safety.uploadPhoto', { id: S1, base64: png }).ok);
  ensureCode(A(tok.T2, 'safety.uploadPhoto', { id: S1, base64: png }), 'FORBIDDEN');
  for (let i = 0; i < 4; i++) assert.ok(A(tok.T, 'safety.uploadPhoto', { id: S1, base64: png }).ok);
  ensureCode(A(tok.T, 'safety.uploadPhoto', { id: S1, base64: png }), 'CONFLICT', 'maxPhotos');
  assert.ok(A(tok.V, 'safety.photo', { id: S1, index: 0 }).data.dataUrl);
});

console.log('\n[2] Penilaian risiko');
t('Skor dihitung server; Teknisi tidak boleh menilai', () => {
  ensureCode(A(tok.T, 'risk.save', { SafetyID: S1, Hazard: 'h', Controls: 'c', Likelihood: 2, Severity: 2 }), 'FORBIDDEN');
  const r = A(tok.S, 'risk.save', { SafetyID: S1, Hazard: 'Sengatan', Controls: 'Pasang grounding', Likelihood: 2, Severity: 3, RiskScore: 25, RiskLevel: 'Critical' });
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.data.RiskScore, 6); assert.strictEqual(r.data.RiskLevel, 'Medium'); assert.strictEqual(r.data.RequiresApproval, false);
  assert.strictEqual(ctx.Db.get('ELECTRICAL_SAFETY', S1).RiskLevel, 'Medium');
});
t('Batas tingkat 5x5: 4,5,9,10,16,17,25', () => {
  const lv = [[1, 4, 'Low'], [1, 5, 'Medium'], [3, 3, 'Medium'], [2, 5, 'High'], [4, 4, 'High'], [5, 5, 'Critical'], [3, 6 > 5 ? 5 : 6, 'High']];
  lv.forEach(([l, s, e]) => assert.strictEqual(ctx.Risk.level_(l * s), e, l + 'x' + s));
  assert.strictEqual(ctx.Risk.level_(17), 'Critical'); assert.strictEqual(ctx.Risk.level_(16), 'High'); assert.strictEqual(ctx.Risk.level_(9), 'Medium'); assert.strictEqual(ctx.Risk.level_(4), 'Low');
});
t('Validasi risiko', () => {
  const r = A(tok.S, 'risk.save', { SafetyID: S1, Hazard: '', Controls: '', Likelihood: 6, Severity: 1.5 });
  assert.strictEqual(r.code, 'VALIDATION'); assert.strictEqual(r.details.errors.length, 4);
  ensureCode(A(tok.S, 'risk.save', { SafetyID: 'SAF-9999', Hazard: 'h', Controls: 'c', Likelihood: 1, Severity: 1 }), 'NOT_FOUND');
});
let R2;
t('Skor >= 10 wajib persetujuan; penilai tidak bisa menyetujui sendiri; Manager bisa', () => {
  const r = A(tok.S, 'risk.save', { SafetyID: S2, Hazard: 'Arc', Controls: 'LOTO', Likelihood: 4, Severity: 4 });
  assert.ok(r.ok); R2 = r.data.RiskID; assert.strictEqual(r.data.RiskLevel, 'High'); assert.strictEqual(r.data.RequiresApproval, true);
  ensureCode(A(tok.S, 'risk.approve', { id: R2 }), 'FORBIDDEN');           // Supervisor tidak punya safety.approve
  ensureCode(A(tok.T, 'risk.approve', { id: R2 }), 'FORBIDDEN');
  const mg = A(tok.M, 'risk.approve', { id: R2, remarks: 'ok' }); assert.ok(mg.ok, JSON.stringify(mg));
  assert.strictEqual(ctx.Db.get('RISK_ASSESSMENTS', R2).ApprovedBy, 'User M');
  ensureCode(A(tok.M, 'risk.approve', { id: R2 }), 'CONFLICT', 'notPending');
});
t('Manager menilai sendiri lalu menyetujui -> ditolak; Admin boleh (audit)', () => {
  const r = A(tok.M, 'risk.save', { SafetyID: S2, Hazard: 'x', Controls: 'y', Likelihood: 5, Severity: 5 }); assert.ok(r.ok);
  ensureCode(A(tok.M, 'risk.approve', { id: r.data.RiskID }), 'FORBIDDEN', 'selfApprove');
  const rj = A(adm, 'risk.approve', { id: r.data.RiskID, decision: 'Rejected' }); assert.strictEqual(rj.code, 'VALIDATION'); // tolak wajib alasan
  assert.ok(A(adm, 'risk.approve', { id: r.data.RiskID, decision: 'Rejected', remarks: 'kurang kontrol' }).ok);
  assert.strictEqual(ctx.Db.get('RISK_ASSESSMENTS', r.data.RiskID).ApprovedBy, '');
});
t('Tanpa persetujuan: tidak perlu approve', () => {
  const low = A(tok.S, 'risk.list', { safetyId: S1 }).data.rows[0];
  ensureCode(A(tok.M, 'risk.approve', { id: low.RiskID }), 'CONFLICT', 'noApprovalNeeded');
});

console.log('\n[3] Work Order dari temuan + LOTO');
let W1;
t('WO dari Safety: prefill, create, duplikat ditolak, temuan -> In Action', () => {
  const p = A(tok.S, 'wo.prefill', { sourceType: 'Safety', sourceId: S2 }); assert.ok(p.ok, JSON.stringify(p)); assert.strictEqual(p.data.Priority, 'Critical'); // tingkat mengikuti penilaian terakhir (5x5 = Critical)
  const c = A(tok.S, 'wo.create', Object.assign({}, p.data, { SourceType: 'Safety', SourceID: S2 })); assert.ok(c.ok, JSON.stringify(c)); W1 = c.data.WorkOrderID;
  assert.strictEqual(ctx.Db.get('ELECTRICAL_SAFETY', S2).Status, 'In Action'); assert.strictEqual(ctx.Db.get('ELECTRICAL_SAFETY', S2).WorkOrderID, W1);
  ensureCode(A(tok.S, 'wo.create', Object.assign({}, p.data, { SourceType: 'Safety', SourceID: S2 })), 'CONFLICT', 'alreadyExists');
});
t('Temuan tidak bisa ditutup selagi WO berjalan', () => {
  ensureCode(A(tok.S, 'safety.close', { id: S2, ActionTaken: 'x' }), 'CONFLICT', 'woOpen');
});
t('LOTO butuh WO Approved & pelaksana; WO belum disetujui gagal', () => {
  ensureCode(A(tok.T, 'loto.apply', { WorkOrderID: W1, IsolationPoints: 'a', LockNo: 'L1', VerificationNotes: 'v' }), 'CONFLICT', 'badState');
  assert.ok(A(tok.M, 'wo.decide', { id: W1, decision: 'Approved', AssignedTo: 't@gmail.com' }).ok);
  ensureCode(A(tok.T2, 'loto.apply', { WorkOrderID: W1, IsolationPoints: 'a', LockNo: 'L1', VerificationNotes: 'v' }), 'FORBIDDEN', 'notAssignee');
  const v = A(tok.T, 'loto.apply', { WorkOrderID: W1, IsolationPoints: '', LockNo: '', VerificationNotes: '' }); assert.strictEqual(v.code, 'VALIDATION');
});
t('LOTO ganda per equipment & nomor gembok unik; WO tidak bisa dibatalkan saat LOTO aktif', () => {
  const r = A(tok.T, 'loto.apply', { WorkOrderID: W1, IsolationPoints: 'Q1 panel', LockNo: 'LK-01', VerificationNotes: '0 V' }); assert.ok(r.ok, JSON.stringify(r));
  ensureCode(A(tok.T, 'loto.apply', { WorkOrderID: W1, IsolationPoints: 'b', LockNo: 'LK-02', VerificationNotes: 'v' }), 'CONFLICT', 'lotoActive');
  ensureCode(A(tok.S, 'wo.cancel', { id: W1, remarks: 'x' }), 'CONFLICT', 'lotoActive');
  ctx.__lotoId = r.data.LOTOID;
});
t('Mulai WO ditolak bila risiko belum disetujui; setelah disetujui boleh', () => {
  // penilaian terakhir temuan S2 = milik Manager yang ditolak Admin -> belum disetujui
  ensureCode(A(tok.T, 'wo.start', { id: W1 }), 'CONFLICT', 'riskNotApproved');
  const r = A(tok.S, 'risk.save', { WorkOrderID: W1, Hazard: 'Arc', Controls: 'APD & LOTO', Likelihood: 2, Severity: 4 }); assert.ok(r.ok); assert.strictEqual(r.data.RiskLevel, 'Medium');
  assert.ok(A(tok.T, 'wo.start', { id: W1 }).ok);
});
t('Selesai WO ditolak selama LOTO aktif; hanya pemasang/Supervisor melepas', () => {
  ctx.Db.all('WORK_ORDER_TASKS').filter(x => x.WorkOrderID === W1).forEach(x => A(tok.T, 'wo.toggleTask', { taskId: x.TaskID, done: true }));
  ensureCode(A(tok.T, 'wo.complete', { id: W1, ResultNotes: 'selesai' }), 'CONFLICT', 'lotoActive');
  ensureCode(A(tok.T2, 'loto.remove', { id: ctx.__lotoId }), 'FORBIDDEN');
  assert.strictEqual(A(tok.S, 'loto.remove', { id: ctx.__lotoId }).code, 'VALIDATION');   // oleh orang lain wajib alasan
  assert.ok(A(tok.T, 'loto.remove', { id: ctx.__lotoId }).ok);
  ensureCode(A(tok.T, 'loto.remove', { id: ctx.__lotoId }), 'CONFLICT', 'notActive');
  assert.ok(A(tok.T, 'wo.complete', { id: W1, ResultNotes: 'selesai' }).ok);
});
t('Tutup WO lalu tutup temuan (High butuh penilaian disetujui)', () => {
  assert.ok(A(tok.M, 'wo.close', { id: W1 }).ok);
  // penilaian terakhir temuan masih yang ditolak -> belum boleh
  ensureCode(A(tok.S, 'safety.close', { id: S2, ActionTaken: 'ok' }), 'CONFLICT', 'riskNotApproved');
  const r = A(tok.S, 'risk.save', { SafetyID: S2, Hazard: 'Arc', Controls: 'Ganti MCB', Likelihood: 1, Severity: 4 }); assert.ok(r.ok);
  assert.strictEqual(A(tok.S, 'safety.close', { id: S2, ActionTaken: ' ' }).code, 'VALIDATION');
  assert.ok(A(tok.S, 'safety.close', { id: S2, ActionTaken: 'MCB diganti' }).ok);
  assert.strictEqual(ctx.Db.get('ELECTRICAL_SAFETY', S2).Status, 'Closed');
  ensureCode(A(tok.S, 'risk.save', { SafetyID: S2, Hazard: 'h', Controls: 'c', Likelihood: 1, Severity: 1 }), 'CONFLICT', 'badState');
});
t('Temuan High tanpa penilaian tidak bisa ditutup; Dismiss wajib alasan', () => {
  const x = rep(tok.T, { RiskLevel: 'Critical', EquipmentID: E1 }).data.SafetyID;
  ensureCode(A(tok.S, 'safety.close', { id: x, ActionTaken: 'ok' }), 'CONFLICT', 'needsAssessment');
  assert.strictEqual(A(tok.S, 'safety.dismiss', { id: x }).code, 'VALIDATION');
  assert.ok(A(tok.S, 'safety.dismiss', { id: x, remarks: 'salah lapor' }).ok);
  assert.strictEqual(ctx.Db.get('ELECTRICAL_SAFETY', x).Status, 'Dismissed');
});

console.log('\n[4] Dashboard, daftar & audit');
t('Dashboard k3Findings hanya menghitung Open/In Action', () => {
  const open = ctx.Db.all('ELECTRICAL_SAFETY').filter(s => ['Open', 'In Action'].includes(s.Status)).length;
  assert.strictEqual(A(adm, 'dashboard.summary', {}).data.cards.k3Findings, open);
});
t('safety.list filter group/risk; viewer read-only; forWO', () => {
  assert.ok(A(tok.V, 'safety.list', { group: 'open' }).data.rows.every(r => ['Open', 'In Action'].includes(r.Status)));
  assert.ok(A(tok.V, 'safety.list', { group: 'done' }).data.rows.every(r => ['Closed', 'Dismissed'].includes(r.Status)));
  ensureCode(A(tok.V, 'risk.save', { SafetyID: S1, Hazard: 'h', Controls: 'c', Likelihood: 1, Severity: 1 }), 'FORBIDDEN');
  const f = A(tok.V, 'safety.forWO', { workOrderId: W1 }); assert.ok(f.ok); assert.ok(f.data.risks.length >= 1 && f.data.lotos.length === 1);
  assert.strictEqual(f.data.can.applyLoto, false);
});
t('Audit tercatat', () => {
  const acts = new Set(ctx.Db.all('AUDIT_LOG').map(a => a.Action));
  ['SAFETY_REPORT', 'RISK_ASSESS', 'RISK_APPROVE', 'RISK_REJECT', 'LOTO_APPLY', 'LOTO_REMOVE', 'SAFETY_CLOSE', 'SAFETY_DISMISS', 'SAFETY_PHOTO'].forEach(a => assert.ok(acts.has(a), a));
});

console.log('\nHasil: ' + pass + ' lulus, ' + fail + ' gagal');
process.exit(fail ? 1 : 0);
