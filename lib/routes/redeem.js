const { db, ensureSchema, httpError, route, ID_RE, stats, withRedeemLock, redeemLocked, requireCurrent } = require('../lib');

// Admin: give a souvenir for the event whose window is open now. Atomic across all stations.
// Statuses: given | already | cap_reached | cap_not_set | not_eligible | unknown_id | other_event | redeemed_before
module.exports = route(['POST'], 'admin', async (req, body, who) => {
  const id = String(body.id || '').toUpperCase();
  if (!ID_RE.test(id)) throw httpError(400, 'bad_id', 'id must be the 8-character code');
  await ensureSchema();
  const ev = await requireCurrent(db());
  return withRedeemLock(async (client) => {
    const result = await redeemLocked(client, id, who.user, ev);
    return { ...result, stats: await stats(client, ev) };
  });
});
