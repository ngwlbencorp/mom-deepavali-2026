// The only Vercel function: every /api/<name> request is rewritten here (see vercel.json) and
// dispatched to lib/routes/<name>.js. One function keeps the deployment far below Vercel's
// per-deployment function limit, and the admins' 5-second polling keeps it warm for redeems.
// Routes are required statically so Vercel's bundler includes them.
const routes = {
  admins: require('../lib/routes/admins'),
  dashboard: require('../lib/routes/dashboard'),
  export: require('../lib/routes/export'),
  login: require('../lib/routes/login'),
  manual: require('../lib/routes/manual'),
  ping: require('../lib/routes/ping'),
  redeem: require('../lib/routes/redeem'),
  remaining: require('../lib/routes/remaining'),
  reset: require('../lib/routes/reset'),
  scan: require('../lib/routes/scan'),
  stats: require('../lib/routes/stats'),
  submit: require('../lib/routes/submit')
};

module.exports = (req, res) => {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/api\/([a-z]+)\/?$/);
  const name = url.searchParams.get('route') || (m && m[1]);
  const handler = Object.prototype.hasOwnProperty.call(routes, name) ? routes[name] : null;
  if (handler) return handler(req, res);
  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: 'not_found', message: 'No such API route' }));
};
