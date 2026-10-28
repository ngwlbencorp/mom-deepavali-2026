const { db, ensureSchema, httpError, route } = require('../lib');

// Superadmin: clear rehearsal data before the event. Admin emails are kept.
module.exports = route(['POST'], 'super', async (req, body) => {
  if (body.confirm !== 'RESET') throw httpError(400, 'confirm_required', 'Type RESET to confirm');
  await ensureSchema();
  await db().query('TRUNCATE scans, submissions');
  return { ok: true };
});
