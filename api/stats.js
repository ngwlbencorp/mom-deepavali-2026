const { db, ensureSchema, route, stats } = require('./_lib');

// Admin: live counters shown on every admin screen.
module.exports = route(['GET'], 'admin', async () => {
  await ensureSchema();
  return stats(db());
});
