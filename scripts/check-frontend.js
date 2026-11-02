// Memeriksa: (1) sintaks JS di tiap file HTML, (2) semua kunci i18n yang dipakai ada di 3 bahasa.
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..', 'frontend');
let bad = 0;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
const used = new Set();
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const m = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]);
  m.filter(js => !js.includes('<?')).forEach((js, i) => { try { new vm.Script(js, { filename: f }); } catch (e) { bad++; console.log('SYNTAX', f, e.message); } });
  if (f === 'Index.html') { const rest = src.replace(/<\?!= (include\('[A-Za-z0-9]+'\)|bootJson) \?>/g, ''); if (rest.includes('<?')) { bad++; console.log('scriptlet tak dikenal di Index.html'); } }
  if (f !== 'I18n.html' && f !== 'Index.html') {
    for (const k of src.matchAll(/\bt\('([A-Za-z0-9_.]+)'/g)) used.add(k[1]);
    for (const k of src.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'\s*,/g)) used.add(k[1]);
  }
}
const i18n = {}; vm.runInNewContext(fs.readFileSync(path.join(dir, 'I18n.html'), 'utf8').replace(/<\/?script>/g, ''), { window: i18n });
['nav.dashboard','nav.equipment','nav.inspection','nav.pm','nav.cm','nav.wo','nav.safety','nav.inventory','nav.reports','nav.users','nav.settings'].forEach(k => used.add(k));
for (const lang of ['id', 'en', 'zh']) {
  const d = i18n.I18N[lang];
  [...used].filter(k => !k.endsWith('.') && !(k in d)).forEach(k => { bad++; console.log('MISSING', lang, k); });
  if (Object.keys(d).length !== Object.keys(i18n.I18N.id).length) { bad++; console.log('jumlah kunci berbeda', lang); }
}
console.log(files.length, 'file HTML,', used.size, 'kunci dipakai,', bad ? bad + ' MASALAH' : 'OK');
process.exit(bad ? 1 : 0);
