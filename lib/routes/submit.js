const { db, ensureSchema, httpError, route, ID_RE, sha256hex } = require('../lib');

// Public: the attendee's phone registers each finished quiz.
// The phone keeps a random device key; only that key can update its claim ID. Another phone that
// happens to pick the same ID gets 409 id_taken and generates a new ID.
module.exports = route(['POST'], null, async (req, body) => {
  const id = String(body.id || '');
  const key = String(body.key || '');
  const score = Number(body.score), total = Number(body.total);
  const csat = body.csat == null ? null : Number(body.csat);
  const learned = body.learned == null ? null : String(body.learned);
  if (!ID_RE.test(id)) throw httpError(400, 'bad_id', 'Invalid claim ID');
  if (!/^[0-9a-f]{32}$/.test(key)) throw httpError(400, 'bad_key', 'Invalid device key');
  if (!Number.isInteger(total) || total < 1 || total > 50 || !Number.isInteger(score) || score < 0 || score > total) throw httpError(400, 'bad_score', 'Invalid score');
  if (csat !== null && !(Number.isInteger(csat) && csat >= 1 && csat <= 5)) throw httpError(400, 'bad_csat', 'Invalid rating');
  if (learned !== null && !['Y', 'S', 'N'].includes(learned)) throw httpError(400, 'bad_learned', 'Invalid answer');
  await ensureSchema();
  const hash = sha256hex(key);
  const full = score === total;

  let status = 'registered';
  let r = await db().query(
    `INSERT INTO scans (id, source, device_key_hash, score, total, attempts, first_full, csat, learned, first_seen, last_seen)
     VALUES ($1, 'self', $2, $3, $4, 1, CASE WHEN $5 THEN 1 END, $6, $7, now(), now())
     ON CONFLICT (id) DO NOTHING
     RETURNING id, score, total, attempts, first_full, redeemed_at`,
    [id, hash, score, total, full, csat, learned]
  );
  if (!r.rowCount) {
    // Same phone again, or a row an admin created by scanning this phone's QR before it could register.
    status = 'updated';
    r = await db().query(
      `UPDATE scans SET
         device_key_hash = $2,
         attempts = COALESCE(attempts, 0) + 1,
         score = GREATEST(COALESCE(score, 0), $3),
         total = $4,
         first_full = COALESCE(first_full, CASE WHEN $5 THEN COALESCE(attempts, 0) + 1 END),
         csat = COALESCE($6, csat),
         learned = COALESCE($7, learned),
         last_seen = now()
       WHERE id = $1 AND source = 'self' AND (device_key_hash = $2 OR device_key_hash IS NULL)
       RETURNING id, score, total, attempts, first_full, redeemed_at`,
      [id, hash, score, total, full, csat, learned]
    );
    if (!r.rowCount) throw httpError(409, 'id_taken', 'This claim ID belongs to another phone');
  }
  const row = r.rows[0];
  await db().query(
    `INSERT INTO submissions (claim_id, attempt, score, total, source) VALUES ($1, $2, $3, $4, 'self')`,
    [id, row.attempts, score, total]
  );
  return {
    status, id: row.id, attempts: row.attempts, firstFull: row.first_full,
    score: row.score, total: row.total, full: row.score === row.total, redeemed: !!row.redeemed_at
  };
});
