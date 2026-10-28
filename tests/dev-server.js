// Local stand-in for Vercel: serves the static site and routes /api/<name> to api/<name>.js.
// Usage: DATABASE_URL=... ADMIN_PASSWORD=... SUPERADMIN_USER=... SUPERADMIN_PASSWORD=... node tests/dev-server.js [port]
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain', '.png': 'image/png' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/api\/([a-z]+)$/);
  if (m) {
    const file = path.join(root, 'api', m[1] + '.js');
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
    return require(file)(req, res);
  }
  let p = path.join(root, decodeURIComponent(url.pathname));
  if (!p.startsWith(root) || /[\\/](api|tests|node_modules)([\\/]|$)/.test(p.slice(root.length))) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', types[path.extname(p)] || 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
}).listen(+process.argv[2] || 3000, '127.0.0.1');
