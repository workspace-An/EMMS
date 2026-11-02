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
  await t('modul fase berikutnya menampilkan placeholder', async () => {
    await page.click('[data-nav=pm]'); assert.ok((await page.textContent('.content')).includes('Phase 3'));
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
