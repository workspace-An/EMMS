// Verifikasi encoder QR (QrLib.html) terhadap dekoder OpenCV: render -> PNG -> decode -> bandingkan.
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(dir, '../frontend/QrLib.html'), 'utf8');
const js = html.replace(/^<script>/, '').replace(/<\/script>\s*$/, '');
const win = {}; vm.runInNewContext(js, { window: win });
const Q = win.EMMSQR;

const cases = [
  'EQ-0001', 'https://script.google.com/macros/s/AKfycbxXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/exec?eq=EQ-0001',
  'x'.repeat(14), 'x'.repeat(26), 'x'.repeat(44), 'x'.repeat(62), 'x'.repeat(84), 'x'.repeat(106),
  'x'.repeat(122), 'x'.repeat(152), 'x'.repeat(180), 'x'.repeat(211), 'Pompa 泵 ünïcode ✓',
  'https://example.com/?eq=EQ-0500&u=' + 'ab'.repeat(40)
];
const tmp = fs.mkdtempSync('/tmp/qrv-');
const items = [];
cases.forEach((t, i) => {
  const q = Q.make(t);
  const scale = 8, m = 4, n = q.size + 2 * m;
  const px = n * scale;
  const buf = Buffer.alloc(px * px, 255);
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.modules[y][x])
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) buf[((y + m) * scale + dy) * px + (x + m) * scale + dx] = 0;
  const f = path.join(tmp, `c${i}.pgm`);
  fs.writeFileSync(f, Buffer.concat([Buffer.from(`P5 ${px} ${px} 255\n`), buf]));
  items.push({ f, t, ver: q.version, mask: q.mask });
});
fs.writeFileSync(path.join(tmp, 'items.json'), JSON.stringify(items));
const py = `
import cv2, json, sys
items = json.load(open(sys.argv[1]))
ok = 0
for it in items:
    img = cv2.imread(it['f'], cv2.IMREAD_GRAYSCALE)
    det = cv2.QRCodeDetector()
    val, pts, _ = det.detectAndDecode(img)
    good = (val == it['t'])
    ok += good
    print(('PASS' if good else 'FAIL'), 'v%d mask%d len=%d' % (it['ver'], it['mask'], len(it['t'].encode())), '' if good else repr(val)[:60])
print('SUMMARY', ok, '/', len(items))
sys.exit(0 if ok == len(items) else 1)
`;
fs.writeFileSync(path.join(tmp, 'v.py'), py);
try {
  console.log(execFileSync('python3', ['-I', path.join(tmp, 'v.py'), path.join(tmp, 'items.json')], { encoding: 'utf8' }));
} catch (e) { console.log(e.stdout || e.message); process.exit(1); }
