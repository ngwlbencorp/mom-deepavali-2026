const { route, logError, httpError } = require('../lib');
const { bugAlert } = require('../alert');

// Superadmin or bug agent: send test alerts through the real paths, to confirm the email setup.
// POST { kind: "bug" | "error" | "both" } -> { bug?: { sent, reason }, error?: { recorded } }
//   bug:   the same email a new bug report sends, numbered TEST (no report is created, because
//          officers see every report).
//   error: records a server error "Test alert (not a real error)" through logError, the path every
//          unexpected error takes, and emails it even inside a burst. It shows in the Server
//          errors card; an email failure is recorded there too.
module.exports = route(['POST'], 'bugs', async (req, body) => {
  const kind = String(body.kind || 'both');
  if (!['bug', 'error', 'both'].includes(kind)) throw httpError(400, 'bad_kind', 'kind must be bug, error or both');
  const out = {};
  if (kind !== 'error') out.bug = await bugAlert('TEST');
  if (kind !== 'bug') {
    await logError(req, new Error('Test alert (not a real error) ' + new Date().toISOString()), { alwaysAlert: true });
    out.error = { recorded: true };
  }
  return out;
});
