const { db, ensureSchema, route, cap, eventEnd, eventOpen } = require('../lib');

// Public: souvenirs left, and whether redemption is still open, for the mini-site.
// Cached at Vercel's edge for 10 s, so the database sees about one query per 10 s however many
// phones are polling. Contains no personal data.
module.exports = route(['GET'], null, async () => {
  const open = eventOpen(), limit = cap();
  let given = 0;
  if (open) {
    await ensureSchema();
    const { rows } = await db().query('SELECT count(*) AS given FROM scans WHERE redeemed_at IS NOT NULL');
    given = Number(rows[0].given);
  }
  const capRemaining = Math.max(0, limit - given);
  return {
    open, eventEnd: new Date(eventEnd()).toISOString(), cap: limit, capRemaining,
    _cache: 'public, max-age=0, s-maxage=10, stale-while-revalidate=20'
  };
});
