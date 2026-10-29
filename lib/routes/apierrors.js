const { db, ensureSchema, httpError, route } = require('../lib');

// Superadmin or the bug-fixing agent: GET /api/apierrors[?since=<id>] -> { errors: [{ id, route,
// message, created_at }] }, newest first (at most 200).
module.exports = route(['GET'], 'bugs', async (req) => {
  const since = new URL(req.url, 'http://x').searchParams.get('since');
  if (since && !/^\d+$/.test(since)) throw httpError(400, 'bad_since', 'since must be an error number');
  await ensureSchema();
  const r = await db().query(`SELECT id, route, message, created_at FROM api_errors ${since ? 'WHERE id > $1' : ''} ORDER BY id DESC LIMIT 200`, since ? [since] : []);
  return { errors: r.rows.map((x) => ({ ...x, id: Number(x.id) })) };
});
