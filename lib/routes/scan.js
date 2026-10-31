const { db, ensureSchema, httpError, route, payload, ID_RE, PUBLIC_COLS } = require('../lib');

// Admin: look up a claim by QR payload or by the 8-character code typed in.
// The database is the source of truth, and only registered claims count: a phone registers its
// result when the quiz ends, which is what keeps two phones from holding the same claim ID. A QR
// from a phone that has not registered (no connection at the time) is refused until it has.
module.exports = route(['POST'], 'admin', async (req, body, who) => {
  const raw = String(body.code || '').trim();
  let id = raw.toUpperCase(), d = null;
  if (!ID_RE.test(id)) {
    d = payload.decode(raw);
    if (!d.ok) throw httpError(400, 'invalid_code', d.reason);
    id = d.id;
  }
  await ensureSchema();
  const r = await db().query(`UPDATE scans SET station = $2, last_seen = now() WHERE id = $1 RETURNING ${PUBLIC_COLS}`, [id, who.user]);
  if (!r.rowCount) {
    if (d) throw httpError(404, 'not_registered', 'This phone\'s result is not saved yet. Ask them to tap "Retry saving" once they have signal, then scan again. Or use manual input.');
    throw httpError(404, 'unknown_id', 'No claim with this code. Check the code, or use manual input.');
  }
  const rec = r.rows[0];
  return { record: rec, eligible: rec.total > 0 && rec.score === rec.total, redeemed: !!rec.redeemed_at };
});
