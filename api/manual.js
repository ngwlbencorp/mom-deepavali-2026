const { ensureSchema, httpError, route, newId, ID_RE, stats, withRedeemLock, redeemLocked } = require('./_lib');

// Admin-assisted claim, for MWs without a phone (or with a problem code).
// Body: { answers: [true, false, true], id? }. Each call without an id creates a NEW claim:
// duplicates are deliberately not checked for admin submissions. Passing the id from a previous
// not-all-correct attempt records a retry for the same person.
// If all answers are correct, the souvenir is given in the same transaction (subject to the cap).
module.exports = route(['POST'], 'admin', async (req, body, who) => {
  const answers = body.answers;
  if (!Array.isArray(answers) || answers.length < 1 || answers.length > 10 || !answers.every((a) => typeof a === 'boolean')) {
    throw httpError(400, 'bad_answers', 'answers must be a list of true/false');
  }
  const score = answers.filter(Boolean).length, total = answers.length, full = score === total;
  const retryId = body.id ? String(body.id).toUpperCase() : null;
  if (retryId && !ID_RE.test(retryId)) throw httpError(400, 'bad_id', 'Invalid id');
  await ensureSchema();

  return withRedeemLock(async (client) => {
    let row;
    if (retryId) {
      const r = await client.query(
        `UPDATE scans SET attempts = attempts + 1, score = GREATEST(score, $2), total = $3,
           first_full = COALESCE(first_full, CASE WHEN $4 THEN attempts + 1 END), station = $5, last_seen = now()
         WHERE id = $1 AND source = 'admin' AND redeemed_at IS NULL
         RETURNING id, attempts, first_full`,
        [retryId, score, total, full, who.user]
      );
      if (!r.rowCount) throw httpError(404, 'unknown_id', 'That manual claim cannot be retried. Start a new one.');
      row = r.rows[0];
    } else {
      for (let i = 0; i < 5 && !row; i++) {
        const r = await client.query(
          `INSERT INTO scans (id, source, score, total, attempts, first_full, station, created_by, first_seen, last_seen)
           VALUES ($1, 'admin', $2, $3, 1, CASE WHEN $4 THEN 1 END, $5, $5, now(), now())
           ON CONFLICT (id) DO NOTHING
           RETURNING id, attempts, first_full`,
          [newId(), score, total, full, who.user]
        );
        row = r.rows[0];
      }
      if (!row) throw httpError(500, 'id_exhausted', 'Could not create a claim ID');
    }
    await client.query(
      `INSERT INTO submissions (claim_id, attempt, score, total, source, submitted_by) VALUES ($1, $2, $3, $4, 'admin', $5)`,
      [row.id, row.attempts, score, total, who.user]
    );
    const result = full ? await redeemLocked(client, row.id, who.user) : { status: 'not_eligible' };
    return { ...result, id: row.id, score, total, attempts: row.attempts, stats: await stats(client) };
  });
});
