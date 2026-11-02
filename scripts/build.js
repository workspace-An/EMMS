// Menggabungkan apps-script/*.gs + appsscript.json + frontend/*.html ke dist/ (satu folder rata, format yang diminta clasp/Apps Script).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
let n = 0;
[['apps-script', /\.(gs|json)$/], ['frontend', /\.html$/]].forEach(([d, re]) => {
  fs.readdirSync(path.join(root, d)).filter(f => re.test(f)).forEach(f => { fs.copyFileSync(path.join(root, d, f), path.join(dist, f)); n++; });
});
console.log('dist/ siap: ' + n + ' file');
