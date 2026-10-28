const { db, ensureSchema, httpError, route, signToken, same } = require('../lib');

const fail = () => new Promise((r) => setTimeout(r, 400)).then(() => { throw httpError(401, 'bad_login', 'Wrong login ID or password'); });

// { role: "admin", email, password } or { role: "super", username, password } -> { token, role, user }
module.exports = route(['POST'], null, async (req, body) => {
  const e = process.env;
  const password = String(body.password || '');
  if (body.role === 'super') {
    if (!e.SUPERADMIN_USER || !e.SUPERADMIN_PASSWORD) throw httpError(500, 'server_misconfigured', 'SUPERADMIN_USER / SUPERADMIN_PASSWORD are not set');
    if (e.SUPERADMIN_PASSWORD === e.ADMIN_PASSWORD) throw httpError(500, 'server_misconfigured', 'SUPERADMIN_PASSWORD must differ from ADMIN_PASSWORD');
    // Login ID ignores case and surrounding spaces; the password is exact.
    const user = String(body.username || '').trim().toLowerCase();
    if (!same(user, e.SUPERADMIN_USER.trim().toLowerCase()) || !same(password, e.SUPERADMIN_PASSWORD)) return fail();
    return { token: signToken('super', 'superadmin'), role: 'super', user: 'superadmin' };
  }
  if (!e.ADMIN_PASSWORD) throw httpError(500, 'server_misconfigured', 'ADMIN_PASSWORD is not set');
  const email = String(body.email || '').trim().toLowerCase();
  await ensureSchema();
  const { rowCount } = await db().query('SELECT 1 FROM admins WHERE email = $1', [email]);
  const okPassword = same(password, e.ADMIN_PASSWORD); // always compared, so timing does not reveal listed emails
  if (!rowCount || !okPassword) return fail();
  return { token: signToken('admin', email), role: 'admin', user: email };
});
