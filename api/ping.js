const { route } = require('./_lib');

// Liveness only: no login, no database.
module.exports = route(['GET'], null, async () => ({ ok: true, time: new Date().toISOString() }));
