const { httpError, route } = require('../lib');

// The rehearsal reset used to empty scans and submissions. With several events it could delete a
// past event's data, so it is gone (owner, 18 Nov): "Clear test data" on one event
// (POST /api/events { id, clearTest: true }) hides that event's earlier rows instead, and deletes nothing.
module.exports = route(['POST'], 'super', async () => {
  throw httpError(410, 'gone', 'The reset is replaced by "Clear test data" for one event, which deletes nothing.');
});
