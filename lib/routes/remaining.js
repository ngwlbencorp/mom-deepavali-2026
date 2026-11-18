const { db, ensureSchema, route, currentEvent, stats } = require('../lib');

// Public: the event whose window is open now (from 5 days before it starts until it ends), and
// its souvenirs left, for the mini-site. open = false when no event's window is open.
// Cached at Vercel's edge for 10 s, so the database sees about one query per 10 s however many
// phones are polling. Contains no personal data.
module.exports = route(['GET'], null, async () => {
  await ensureSchema();
  const ev = await currentEvent(db());
  let cap = null, capRemaining = null;
  if (ev) ({ cap, capRemaining } = await stats(db(), ev));
  return {
    open: !!ev, eventEnd: ev ? ev.endsAt : null, cap, capRemaining,
    event: ev ? { id: ev.id, name: ev.name, startsAt: ev.startsAt, endsAt: ev.endsAt, theme: ev.theme } : null,
    _cache: 'public, max-age=0, s-maxage=10, stale-while-revalidate=20'
  };
});
