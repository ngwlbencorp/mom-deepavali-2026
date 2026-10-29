const { db, ensureSchema, httpError, route } = require('../lib');

// Superadmin or the bug-fixing agent: GET /api/bugshot?id=<screenshot id> -> the image itself.
module.exports = route(['GET'], 'bugs', async (req) => {
  const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
  if (!/^\d+$/.test(id)) throw httpError(400, 'bad_id', 'id must be a screenshot number');
  await ensureSchema();
  const r = await db().query('SELECT image, mime_type FROM bug_screenshots WHERE id = $1', [id]);
  if (!r.rowCount) throw httpError(404, 'unknown_screenshot', 'No such screenshot');
  return { binary: r.rows[0].image, type: r.rows[0].mime_type };
});
