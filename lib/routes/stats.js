const { db, ensureSchema, route, stats, focusEvent } = require('../lib');

// Admin: live counters shown on every admin screen, for the current event (or the next one).
module.exports = route(['GET'], 'admin', async () => {
  await ensureSchema();
  const ev = await focusEvent(db());
  return stats(db(), ev);
});
