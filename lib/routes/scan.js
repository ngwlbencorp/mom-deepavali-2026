const { db, ensureSchema, httpError, route, payload, ID_RE, PUBLIC_COLS } = require('../lib');

// Admin: look up a claim by QR payload or by the 8-character code typed in.
// The database is the source of truth; a QR from a phone that could not register is added from its payload.
module.exports = route(['POST'], 'admin', async (req, body, who) => {
  const raw = String(body.code || '').trim();
  let id = raw.toUpperCase(), d = null;
  if (!ID_RE.test(id)) {
    d = payload.decode(raw);
    if (!d.ok) throw httpError(400, 'invalid_code', d.reason);
    id = d.id;
  }
  await ensureSchema();
  if (d) {
    await db().query(
      `INSERT INTO scans (id, source, score, total, attempts, first_full, csat, learned, first_seen, last_seen)
       VALUES ($1, 'self', $2, $3, $4, $5, $6, $7, now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [id, d.score, d.total, d.attempts, d.firstFull, d.csat, d.learned]
    );
  }
  const r = await db().query(`UPDATE scans SET station = $2, last_seen = now() WHERE id = $1 RETURNING ${PUBLIC_COLS}`, [id, who.user]);
  if (!r.rowCount) throw httpError(404, 'unknown_id', 'No claim with this code. Check the code, or use manual input.');
  const rec = r.rows[0];
  return { record: rec, eligible: rec.total > 0 && rec.score === rec.total, redeemed: !!rec.redeemed_at };
});
