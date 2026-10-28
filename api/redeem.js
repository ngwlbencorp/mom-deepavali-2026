const { ensureSchema, httpError, route, ID_RE, stats, withRedeemLock, redeemLocked } = require('./_lib');

// Admin: give a souvenir. Atomic across all stations.
// Statuses: given | already | cap_reached | not_eligible | unknown_id
module.exports = route(['POST'], 'admin', async (req, body, who) => {
  const id = String(body.id || '').toUpperCase();
  if (!ID_RE.test(id)) throw httpError(400, 'bad_id', 'id must be the 8-character code');
  await ensureSchema();
  return withRedeemLock(async (client) => {
    const result = await redeemLocked(client, id, who.user);
    return { ...result, stats: await stats(client) };
  });
});
