// Builds a zip to upload to ducks.ai: the shell (shell/), which loads one page of the live site
// from Vercel.
//   Mini-site (default): also bundles a fallback copy of the site in fallback/ (index.html and every
//   stylesheet and script it refers to), used if Vercel cannot be reached.
//   Officer page (--admin): loads admin/index.html; nothing bundled, since it cannot work without
//   the API anyway.
// Usage: node tools/build-shell.js [--admin] [--frozen] [--out <file.zip>] [--root <dir>] [--base <url>]
//   --frozen  mini-site only: always use the bundled copy, never Vercel
//   --root    take the site files from another copy of the site (for tests)
//   --base    the site address to load from, instead of the one in shell/config.js (for tests)
// Output: dist/ducks-site-shell.zip, dist/ducks-site-shell-frozen.zip or dist/ducks-admin-shell.zip.
// No dependencies.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const repo = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const admin = args.includes('--admin'), frozen = args.includes('--frozen');
if (admin && frozen) { console.error('--frozen is for the mini-site only: the officer page needs the API.'); process.exit(1); }
const site = opt('--root') ? path.resolve(opt('--root')) : repo;
const page = admin ? 'admin/index.html' : 'index.html';
const out = opt('--out') || path.join(repo, 'dist', admin ? 'ducks-admin-shell.zip' : frozen ? 'ducks-site-shell-frozen.zip' : 'ducks-site-shell.zip');

const pageHtml = fs.readFileSync(path.join(site, page), 'utf8');
const files = []; // [name in zip, Buffer]
let shellHtml = fs.readFileSync(path.join(repo, 'shell', 'index.html'), 'utf8');
const title = (pageHtml.match(/<title>([^<]*)<\/title>/) || [])[1];
if (title) shellHtml = shellHtml.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
if (admin) shellHtml = shellHtml.replace(/<noscript>[\s\S]*?<\/noscript>/, '<noscript><p>Please turn on JavaScript.</p></noscript>')
  .replace('<meta name="color-scheme" content="light">', '<meta name="color-scheme" content="light">\n<meta name="robots" content="noindex, nofollow">');
files.push(['index.html', Buffer.from(shellHtml)]);
files.push(['shell.js', fs.readFileSync(path.join(repo, 'shell', 'shell.js'))]);
let config = fs.readFileSync(path.join(repo, 'shell', 'config.js'), 'utf8');
if (frozen) config = config.replace(/mode:\s*'remote'/, "mode: 'local'");
if (admin) config = config.replace(/page:\s*'[^']*'/, `page: '${page}'`).replace(/fallback:\s*true/, 'fallback: false');
if (opt('--base')) config = config.replace(/base:\s*'[^']*'/, `base: '${opt('--base')}'`);
files.push(['config.js', Buffer.from(config)]);
if (!admin) {
  files.push(['fallback/index.html', Buffer.from(pageHtml)]);
  const refs = [...pageHtml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="(?:\.\/)?([^"#?:]+)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    const p = path.join(site, ref);
    if (!fs.existsSync(p)) { console.error(page + ' refers to a missing file: ' + ref); process.exit(1); }
    files.push(['fallback/' + ref, fs.readFileSync(p)]);
  }
  for (const extra of ['js/vendor/LICENSES.txt']) if (fs.existsSync(path.join(site, extra))) files.push(['fallback/' + extra, fs.readFileSync(path.join(site, extra))]);
  // images the scripts show (logos): not referenced from index.html, so bundle the whole folder
  const img = path.join(site, 'img');
  if (fs.existsSync(img)) for (const f of fs.readdirSync(img).sort()) files.push(['fallback/img/' + f, fs.readFileSync(path.join(img, f))]);
}

// Only file types ducks.ai accepts.
const ALLOWED = /\.(avif|cjs|css|gif|html|ico|jpe?g|js|json|m4v|map|md|mjs|mov|mp4|ogv|otf|pdf|png|svg|ttf|txt|vtt|webm|webp|woff2?|xml|ya?ml)$/i;
const bad = files.filter(([n]) => !ALLOWED.test(n)).map(([n]) => n);
if (bad.length) { console.error('Not allowed on ducks.ai: ' + bad.join(', ')); process.exit(1); }

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const parts = [], central = [];
let offset = 0;
for (const [name, data] of files) {
  const nameBuf = Buffer.from(name), comp = zlib.deflateRawSync(data), crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(0x00210000, 10); // 1 Jan 1980, fixed so builds are reproducible
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  parts.push(local, nameBuf, comp);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
  cen.writeUInt32LE(0x00210000, 12); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
  central.push(cen, nameBuf);
  offset += 30 + nameBuf.length + comp.length;
}
const cenSize = central.reduce((s, b) => s + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cenSize, 12); end.writeUInt32LE(offset, 16);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat(parts.concat(central, [end])));
console.log(`${out}: ${files.length} files${frozen ? ' (frozen: never loads from Vercel)' : ''}`);
