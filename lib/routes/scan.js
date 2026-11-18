const { db, ensureSchema, httpError, route, payload, ID_RE, PUBLIC_COLS, currentEvent, redeemedBefore } = require('../lib');

// Admin: look up a claim by QR payload or by the 8-character code typed in.
// The database is the source of truth, and only registered claims count: a phone registers its
// result when the quiz ends, which is what keeps two phones from holding the same claim ID. A QR
// from a phone that has not registered (no connection at the time) is refused until it has.
// Only a claim of the event open now can be given a souvenir; a claim from another event is
// shown with the reason and is not changed (a past event's data is locked).
module.exports = route(['POST'], 'admin', async (req, body, who) => {
  const raw = String(body.code || '').trim();
  let id = raw.toUpperCase(), d = null;
  if (!ID_RE.test(id)) {
    d = payload.decode(raw);
    if (!d.ok) throw httpError(400, 'invalid_code', d.reason);
    id = d.id;
  }
  await ensureSchema();
  const q = db(), ev = await currentEvent(q);
  const r = ev
    ? await q.query(`UPDATE scans SET station = $2, last_seen = now() WHERE id = $1 AND event_id = $3 RETURNING ${PUBLIC_COLS}, device_key_hash`, [id, who.user, ev.id])
    : { rowCount: 0 };
  if (!r.rowCount) {
    const other = await q.query(`SELECT s.event_id, e.name FROM scans s LEFT JOIN events e ON e.id = s.event_id WHERE s.id = $1`, [id]);
    if (other.rowCount) {
      if (!ev) throw httpError(403, 'event_closed', 'No event is open now. Souvenirs can no longer be given.');
      throw httpError(409, 'other_event', `This code is from another event (${other.rows[0].name || 'no event'}). Ask them to take the quiz again on their phone for today's event.`);
    }
    if (d) throw httpError(404, 'not_registered', 'This phone\'s result is not saved yet. Ask them to tap "Retry saving" once they have signal, then scan again. Or use manual input.');
    throw httpError(404, 'unknown_id', 'No claim with this code. Check the code, or use manual input.');
  }
  const { device_key_hash: hash, ...rec } = r.rows[0];
  const before = !rec.redeemed_at && await redeemedBefore(q, hash, ev.id);
  return { record: rec, eligible: rec.total > 0 && rec.score === rec.total && !before, redeemed: !!rec.redeemed_at, redeemedBefore: before, event: { id: ev.id, name: ev.name } };
});
