// Membuat frontend/I18n.html dari scripts/i18n-source.txt  (format baris: key|id|en|zh)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const lines = fs.readFileSync(path.join(root, 'scripts', 'i18n-source.txt'), 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#'));
const d = { id: {}, en: {}, zh: {} }, seen = {};
lines.forEach((l, i) => {
  const p = l.split('|');
  if (p.length !== 4) throw new Error('Baris ' + (i + 1) + ' tidak valid (harus 4 kolom): ' + l);
  if (seen[p[0]]) throw new Error('Kunci ganda: ' + p[0]);
  seen[p[0]] = 1; d.id[p[0]] = p[1]; d.en[p[0]] = p[2]; d.zh[p[0]] = p[3];
});
const out = '<script>\n/* EMMS - I18n.html : DIGENERATE oleh scripts/gen-i18n.js dari scripts/i18n-source.txt - jangan edit manual */\nwindow.I18N = ' +
  JSON.stringify(d, null, 1).replace(/<\//g, '<\\/') + ';\n</script>\n';
fs.writeFileSync(path.join(root, 'frontend', 'I18n.html'), out);
console.log('I18n.html: ' + lines.length + ' kunci x 3 bahasa');
