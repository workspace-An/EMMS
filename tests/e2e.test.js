/**
 * E2E frontend: browser nyata (Chromium via Playwright) + backend asli di mock GAS.
 * google.script.run dijembatani ke fungsi api() backend. Jalankan: NODE_PATH=<global modules> node tests/e2e.test.js
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('playwright');
const { build } = require('./gas-mock');

const FE = path.join(__dirname, '..', 'frontend');
const shots = process.env.SHOTS_DIR;
const ctx = build();
ctx.setupEMMS(); ctx.seedDemoData();
const boot = { version: ctx.CFG.VERSION, setupDone: true, eq: '', webAppUrl: ctx.Settings.webAppUrl(), defaultLang: 'id', company: 'PT Contoh' };
let html = fs.readFileSync(path.join(FE, 'Index.html'), 'utf8')
  .replace(/<\?!= include\('([A-Za-z0-9]+)'\) \?>/g, (m, n) => fs.readFileSync(path.join(FE, n + '.html'), 'utf8'))
  .replace('<?!= bootJson ?>', JSON.stringify(boot));
const shim = `window.google={script:{run:(function(){function mk(ok,fail){return new Proxy({},{get:function(_,p){
  if(p==='withSuccessHandler')return function(f){return mk(f,fail)};
  if(p==='withFailureHandler')return function(f){return mk(ok,f)};
  return function(){var a=[].slice.call(arguments);window.__api(p,JSON.stringify(a)).then(function(r){ok&&ok(JSON.parse(r))},function(e){fail&&fail(e)})}}})}
  return mk()})()}};`;

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n').slice(0, 3).join('\n       ')); } }

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.exposeFunction('__api', (fn, args) => {
    assert.strictEqual(fn, 'api');
    const a = JSON.parse(args);
    return JSON.stringify(ctx.api(a[0], a[1], a[2]));
  });
  await page.route('http://emms.test/**', r => r.fulfill({ contentType: 'text/html', body: html.replace('<head>', '<head><script>' + shim + '</script>') }));
  await page.goto('http://emms.test/');

  await t('halaman login tampil (bahasa Indonesia)', async () => {
    await page.waitForSelector('#le');
    assert.ok((await page.textContent('.login-card')).includes('Kirim kode login'));
  });
  await t('ganti bahasa di login ke 中文 & English', async () => {
    await page.click('[data-lang=zh]'); assert.ok((await page.textContent('.login-card')).includes('发送登录验证码'));
    await page.click('[data-lang=en]'); assert.ok((await page.textContent('.login-card')).includes('Send login code'));
    await page.click('[data-lang=id]');
  });
  await t('email tidak valid ditolak di klien', async () => {
    await page.fill('#le', 'abc'); await page.click('#lsend');
    assert.ok((await page.textContent('#lerr')).length > 0);
  });
  await t('kode salah ditolak', async () => {
    await page.fill('#le', 'owner@gmail.com'); await page.click('#lsend');
    await page.waitForSelector('#lc'); await page.fill('#lc', '123456');
    await page.waitForFunction(() => document.querySelector('#lerr').textContent.length > 0);
  });
  await t('login OTP benar -> dashboard', async () => {
    await page.click('#lresend'); await page.waitForTimeout(300);
    const mail = ctx.__state.mails.filter(m => m.to === 'owner@gmail.com').pop();
    const code = mail.htmlBody.match(/>(\d{6})</)[1];
    await page.fill('#lc', code);
    await page.waitForSelector('.stat .v');
    assert.ok((await page.textContent('#ptitle')).includes('Dashboard'));
  });
  await t('dashboard: kartu, grafik & aktivitas', async () => {
    const vals = await page.$$eval('.stat .v', e => e.map(x => x.textContent));
    assert.strictEqual(vals[0], '12'); assert.strictEqual(vals[1], '10'); assert.strictEqual(vals[2], '1'); assert.strictEqual(vals[3], '1');
    assert.ok(await page.$('.donut svg')); assert.ok(await page.$('.chart-svg'));
    assert.ok((await page.textContent('.content')).includes('LOGIN_OK'));
    if (shots) await page.screenshot({ path: path.join(shots, 'dashboard.png') });
  });
  await t('menu equipment: 12 baris, pencarian & filter', async () => {
    await page.click('[data-nav=equipment]'); await page.waitForSelector('#eqbody tr.click');
    assert.strictEqual((await page.$$('#eqbody tr.click')).length, 12);
    await page.fill('#fq', 'schneider'); await page.waitForTimeout(400);
    assert.strictEqual((await page.$$('#eqbody tr.click')).length, 2);
    await page.fill('#fq', '');  await page.waitForTimeout(400);
    await page.selectOption('#fsta', 's:Breakdown'); assert.strictEqual((await page.$$('#eqbody tr.click')).length, 1);
    await page.selectOption('#fsta', '');
    if (shots) await page.screenshot({ path: path.join(shots, 'equipment.png') });
  });
  await t('detail equipment + QR memuat URL /exec?eq=', async () => {
    await page.click('#eqbody tr.click >> nth=0'); await page.waitForSelector('.modal .hero');
    await page.click('.tabs button[data-t=qr]');
    assert.ok((await page.textContent('.modal .url')).includes('/exec?eq=EQ-0001'));
    assert.ok(await page.$('.modal .qr svg path'));
    if (shots) await page.screenshot({ path: path.join(shots, 'qr.png') });
  });
  await t('cetak label QR membuka pratinjau', async () => {
    await page.click('#qrbtn button >> nth=0'); await page.waitForSelector('.label-grid');
    assert.strictEqual((await page.$$('.label')).length, 1);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  });
  await t('tambah equipment lewat form (lokasi mengikuti gedung)', async () => {
    await page.click('text=Tambah equipment');
    await page.waitForSelector('#f_EquipmentName');
    await page.click('.modal-f .btn.primary');       // kosong -> validasi server
    await page.waitForSelector('.field.invalid');
    await page.fill('#f_EquipmentName', 'Panel Uji E2E');
    await page.selectOption('[name=CategoryID]', { index: 1 });
    await page.selectOption('[name=BuildingID]', { index: 1 });
    assert.ok((await page.$$('[name=LocationID] option')).length > 1);
    await page.selectOption('[name=LocationID]', { index: 1 });
    await page.click('.modal-f .btn.primary');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    await page.fill('#fq', 'E2E'); await page.waitForTimeout(400);
    assert.strictEqual((await page.$$('#eqbody tr.click')).length, 1);
  });
  await t('hapus equipment berpengaman (alasan + ketik ID)', async () => {
    await page.click('#eqbody tr.click'); await page.waitForSelector('.modal .hero');
    await page.click('.modal-f .btn.danger');
    const ok = '.modal >> nth=1 >> .modal-f .btn.danger.solid';
    await page.waitForSelector('[data-reason]');
    assert.ok(await page.isDisabled('.btn.danger.solid'));
    await page.fill('[data-reason]', 'uji e2e');
    const id = (await page.textContent('.modal-h h3 >> nth=0'));
    await page.fill('[data-type]', (await ctx.Db.all('EQUIPMENT').pop().EquipmentID));
    await page.click('.btn.danger.solid');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    await page.fill('#fq', 'E2E'); await page.waitForTimeout(400);
    assert.strictEqual((await page.$$('#eqbody tr.click')).length, 0);
  });
  await t('ganti bahasa ke 中文 di aplikasi (menu & judul)', async () => {
    await page.selectOption('#langsel', 'zh');
    assert.ok((await page.textContent('.nav')).includes('设备'));
    assert.ok((await page.textContent('#ptitle')).includes('设备'));
    await page.selectOption('#langsel', 'id');
  });
  await t('halaman Pengguna & Pengaturan (4 tab untuk Admin)', async () => {
    await page.click('[data-nav=users]'); await page.waitForSelector('table tbody tr');
    assert.ok((await page.textContent('table')).includes('owner@gmail.com'));
    await page.click('[data-nav=settings]'); await page.waitForSelector('.tabs button');
    assert.strictEqual((await page.$$('.tabs button')).length, 4);
    await page.click('.tabs button[data-t=master]'); await page.waitForSelector('#stab table');
    await page.click('.tabs button[data-t=audit]'); await page.waitForSelector('#stab table tbody tr');
    await page.click('.tabs button[data-t=system]'); await page.waitForSelector('#stab .dl');
    assert.ok((await page.textContent('#stab')).includes('EMAIL_OTP'));
  });
  // ---------------------------------------------------------------- Phase 2
  const mid = it => (it.MinValue !== '' && it.MaxValue !== '') ? (it.MinValue + it.MaxValue) / 2 : (it.MinValue !== '' ? it.MinValue + 1 : (it.MaxValue !== '' ? it.MaxValue - 1 : 1));
  async function openInspect(eqId) {
    await page.click('[data-nav=inspection]'); await page.waitForSelector('#tb tr');
    await page.fill('#tq', eqId); await page.waitForSelector('#tb [data-i="' + eqId + '"]');
    await page.click('#tb [data-i="' + eqId + '"]'); await page.waitForSelector('.modal .ci');
  }
  function itemsOf(eqId) { const e = ctx.Db.get('EQUIPMENT', eqId); return ctx.Checklist.forCategory(e.CategoryID, false); }
  async function answerAll(eqId, ng) { // ng: {ChecklistID: 'remarks'}
    const items = itemsOf(eqId);
    for (const it of items) {
      const c = '.ci[data-id="' + it.ChecklistID + '"]';
      if (it.ItemType === 'measure') await page.fill(c + ' [data-v]', String(mid(it)).replace('.', ','));
      await page.click(c + ' .seg button[data-r=' + (ng && ng[it.ChecklistID] !== undefined ? 'NG' : 'OK') + ']');
      if (ng && ng[it.ChecklistID] !== undefined) await page.fill(c + ' [data-rm]', ng[it.ChecklistID]);
    }
    return items;
  }
  const withCl = () => ctx.Db.all('EQUIPMENT').filter(e => ctx.Checklist.forCategory(e.CategoryID, false).length && e.EquipmentStatus === 'Normal');
  const E1 = withCl()[0].EquipmentID, E2 = withCl()[1].EquipmentID;

  await t('menu Inspeksi: papan hari ini & progres', async () => {
    await page.click('[data-nav=inspection]'); await page.waitForSelector('.progress');
    assert.ok((await page.textContent('#itab')).includes('0 dari'));
    assert.ok((await page.$$('.tabs button')).length >= 3);
  });
  await t('inspeksi semua OK: tombol "semua OK", nilai ukur koma, tersimpan', async () => {
    await openInspect(E1);
    for (const it of itemsOf(E1)) if (it.ItemType === 'measure') await page.fill('.ci[data-id="' + it.ChecklistID + '"] [data-v]', String(mid(it)).replace('.', ','));
    await page.click('#iallok');
    // item ukur yang sudah diisi otomatis OK
    await page.click('.modal-f .btn.primary');
    await page.waitForSelector('.modal .ci', { state: 'detached' });
    const rows = ctx.Db.all('DAILY_INSPECTIONS').filter(i => i.EquipmentID === E1);
    assert.strictEqual(rows.length, 1); assert.strictEqual(rows[0].OverallResult, 'OK');
    await page.waitForSelector('#tb tr'); await page.fill('#tq', E1);
    assert.ok((await page.textContent('#tb')).includes('OK'));
  });
  await t('submit ditolak di klien bila ada item belum dijawab', async () => {
    await openInspect(E2);
    await page.click('.modal-f .btn.primary');
    assert.ok((await page.$$('.ci.invalid')).length > 0);
    assert.strictEqual(ctx.Db.all('DAILY_INSPECTIONS').filter(i => i.EquipmentID === E2).length, 0);
  });
  await t('NG: wajib catatan & rekomendasi; nilai di luar batas otomatis NG', async () => {
    const items = itemsOf(E2); const meas = items.find(i => i.ItemType === 'measure' && (i.MaxValue !== '' || i.MinValue !== ''));
    const ngId = items.find(i => i.ItemType === 'check').ChecklistID;
    const ng = {}; ng[ngId] = '';
    await answerAll(E2, ng);
    // paksa nilai ukur keluar batas -> otomatis NG
    const bad = meas.MaxValue !== '' ? meas.MaxValue + 50 : meas.MinValue - 50;
    await page.fill('.ci[data-id="' + meas.ChecklistID + '"] [data-v]', String(bad));
    assert.ok(await page.$('.ci[data-id="' + meas.ChecklistID + '"].ng'), 'tidak otomatis NG');
    // klik OK pada item di luar batas tidak boleh menjadi OK
    await page.click('.ci[data-id="' + meas.ChecklistID + '"] .seg button[data-r=OK]');
    assert.ok(await page.$('.ci[data-id="' + meas.ChecklistID + '"].ng'));
    await page.click('.modal-f .btn.primary');
    assert.ok((await page.$$('.ci.invalid')).length >= 1, 'catatan NG wajib');
    await page.fill('.ci[data-id="' + ngId + '"] [data-rm]', 'Kabel panas'); await page.fill('.ci[data-id="' + meas.ChecklistID + '"] [data-rm]', 'Di luar batas');
    await page.click('.modal-f .btn.primary');
    assert.ok(await page.$('.field[data-f=Recommendation].invalid'), 'rekomendasi wajib');
    assert.strictEqual(ctx.Db.all('DAILY_INSPECTIONS').filter(i => i.EquipmentID === E2).length, 0);
    await page.fill('[name=Recommendation]', 'Kencangkan terminal dan ukur ulang');
    await page.click('.modal-f .btn.primary');
    await page.waitForSelector('.modal .ci', { state: 'detached' });
    const r = ctx.Db.all('DAILY_INSPECTIONS').filter(i => i.EquipmentID === E2)[0];
    assert.ok(r.OverallResult === 'NG' || r.OverallResult === 'Critical'); assert.strictEqual(r.Status, 'Open');
    assert.notStrictEqual(ctx.Db.get('EQUIPMENT', E2).EquipmentStatus, 'Normal');
  });
  await t('riwayat: filter, detail, dan review temuan', async () => {
    await page.click('.tabs button[data-t=history]'); await page.waitForSelector('#hbody tr[data-id]');
    assert.ok((await page.$$('#hbody tr[data-id]')).length >= 2);
    await page.selectOption('#hres', ctx.Db.all('DAILY_INSPECTIONS').find(i => i.EquipmentID === E2).OverallResult);
    await page.waitForFunction(() => document.querySelectorAll('#hbody tr[data-id]').length === 1);
    await page.click('#hbody tr[data-id]'); await page.waitForSelector('.modal [name=ReviewRemarks]');
    await page.click('.modal-f .btn.primary');
    assert.ok(await page.$('.field[data-f=ReviewRemarks].invalid'));
    await page.fill('[name=ReviewRemarks]', 'Sudah ditindaklanjuti'); await page.click('.modal-f .btn.primary');
    await page.waitForSelector('.modal', { state: 'detached' });
    assert.strictEqual(ctx.Db.all('DAILY_INSPECTIONS').find(i => i.EquipmentID === E2).Status, 'Reviewed');
  });
  await t('tab Checklist (Admin): daftar item & catatan contoh batas', async () => {
    await page.click('[data-nav=inspection]'); await page.click('.tabs button[data-t=checklist]');
    await page.waitForSelector('#cbody table tbody tr');
    assert.ok((await page.textContent('#itab')).includes('CONTOH'));
  });
  await t('detail equipment punya tombol Mulai inspeksi', async () => {
    await page.click('[data-nav=equipment]'); await page.waitForTimeout(600);
    await page.fill('#fq', ''); await page.waitForTimeout(400);
    await page.waitForSelector('#eqbody tr.click');
    await page.click('#eqbody tr.click'); await page.waitForSelector('.modal-f');
    assert.ok((await page.textContent('.modal-f')).includes('Mulai inspeksi'));
    await page.keyboard.press('Escape');
  });
  // ---------------------------------------------------------------- Phase 3
  await t('menu PM: 3 tab untuk Admin, daftar kerja kosong', async () => {
    await page.click('[data-nav=pm]'); await page.waitForSelector('#wb tr');
    assert.strictEqual((await page.$$('.tabs button')).length, 3);
    assert.ok((await page.textContent('#wb')).includes('Tidak ada PM'));
  });
  await t('buat jadwal PM lewat form (Custom menampilkan interval) + event Calendar', async () => {
    await page.click('.tabs button[data-t=schedule]'); await page.waitForSelector('#stools button');
    await page.click('#stools button'); await page.waitForSelector('.modal [name=PMTitle]');
    await page.selectOption('[name=EquipmentID]', E1); await page.fill('[name=PMTitle]', 'Kencangkan terminal');
    assert.strictEqual(await page.isVisible('.field[data-f=ScheduleRule]'), false);
    await page.selectOption('[name=Frequency]', 'Custom'); assert.ok(await page.isVisible('.field[data-f=ScheduleRule]'));
    await page.click('.modal-f .btn.primary');
    assert.ok(await page.$('.field[data-f=ScheduleRule].invalid'), 'interval custom wajib');
    await page.fill('[name=ScheduleRule]', '30'); await page.click('.modal-f .btn.primary');
    await page.waitForSelector('.modal', { state: 'detached' });
    assert.strictEqual(ctx.Db.all('PM_SCHEDULES').length, 1);
    assert.ok(ctx.__state.events.some(e => !e.deleted && e.title.includes('Kencangkan terminal')));
  });
  await t('daftar kerja: jadwal hari ini muncul; kerjakan PM (validasi jam) dan tersimpan Pending', async () => {
    await page.click('.tabs button[data-t=work]'); await page.waitForSelector('#wb [data-x]');
    await page.click('#wb [data-x]'); await page.waitForSelector('.modal [name=StartTime]');
    await page.click('.modal-f .btn.primary');
    assert.ok(await page.$('.field[data-f=StartTime].invalid'), 'jam mulai wajib');
    await page.fill('[name=StartTime]', '00:01'); await page.selectOption('[name=MaintenanceResult]', 'Partial');
    await page.click('.modal-f .btn.primary');
    assert.ok(await page.$('.field[data-f=Remarks].invalid'), 'catatan wajib bila Partial');
    await page.selectOption('[name=MaintenanceResult]', 'Done'); await page.fill('[name=MeasurementBefore]', 'Torsi 8 Nm');
    await page.click('.modal-f .btn.primary');
    await page.waitForSelector('.modal', { state: 'detached' });
    const rec = ctx.Db.all('PREVENTIVE_MAINTENANCE'); assert.strictEqual(rec.length, 1); assert.strictEqual(rec[0].ApprovalStatus, 'Pending');
    assert.ok(ctx.Db.all('PM_SCHEDULES')[0].NextDueDate > ctx.Db.today());
  });
  await t('riwayat PM: buka detail dan setujui (Admin)', async () => {
    await page.click('.tabs button[data-t=history]'); await page.waitForSelector('#hbody tr[data-id]');
    await page.click('#hbody tr[data-id]'); await page.waitForSelector('.modal .btn.primary');
    assert.ok((await page.textContent('.modal')).includes('Torsi 8 Nm'));
    await page.click('.modal-f .btn.primary'); await page.waitForSelector('.modal', { state: 'detached' });
    assert.strictEqual(ctx.Db.all('PREVENTIVE_MAINTENANCE')[0].ApprovalStatus, 'Approved');
  });
  await t('dashboard menampilkan kartu PM tanpa label fase', async () => {
    await page.click('[data-nav=dashboard]'); await page.waitForSelector('.stat .v');
    const txt = await page.textContent('.content');
    assert.ok(txt.includes('menunggu approval') || txt.includes('PM menunggu')); assert.ok(!/PM 7 hari ke depan\s*Phase/.test(txt));
  });
  await t('modul fase berikutnya menampilkan placeholder', async () => {
    await page.click('[data-nav=cm]'); assert.ok((await page.textContent('.content')).includes('Phase 4'));
  });
  await t('tampilan HP (375px): menu geser & tanpa scroll horizontal halaman', async () => {
    await page.setViewportSize({ width: 375, height: 760 });
    await page.click('[data-nav=dashboard]', { force: true }).catch(() => {});
    await page.click('#burger'); await page.waitForSelector('.side.open'); await page.click('[data-nav=equipment]');
    await page.fill('#fq', ''); await page.waitForSelector('#eqbody tr.click');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 1, 'overflow horizontal ' + over);
    if (shots) await page.screenshot({ path: path.join(shots, 'mobile.png') });
  });
  await t('logout kembali ke login & token dicabut', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.click('#logout'); await page.waitForSelector('#le');
    assert.ok(ctx.Db.all('SESSIONS').some(s => s.Revoked === true));
  });
  await t('tidak ada error JavaScript di konsol browser', async () => assert.deepStrictEqual(errors, []));

  await browser.close();
  console.log(`\nE2E: ${pass} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
})();
