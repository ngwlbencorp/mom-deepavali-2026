// Email alerts to the app owner through Resend (RESEND_API_KEY, BUG_NOTIFY_EMAIL; optional
// BUG_NOTIFY_FROM). Used for new bug reports (lib/routes/bugreport.js) and server errors
// (logError in lib/lib.js). Alerts carry a number and a route only, never report text or error
// details: those can hold what officers typed or database values. The details stay on the
// superadmin page.
// Returns { sent: true } or { sent: false, reason } and never throws; 'off' means neither
// setting exists (alerts switched off on purpose).
async function sendAlert(subject, text) {
  const e = process.env;
  if (!e.RESEND_API_KEY && !e.BUG_NOTIFY_EMAIL) return { sent: false, reason: 'off' };
  if (!e.RESEND_API_KEY || !e.BUG_NOTIFY_EMAIL) return { sent: false, reason: (e.RESEND_API_KEY ? 'BUG_NOTIFY_EMAIL' : 'RESEND_API_KEY') + ' is not set' };
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await fetch(e.RESEND_API_URL || 'https://api.resend.com/emails', { // RESEND_API_URL: tests only
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: 'Bearer ' + e.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: e.BUG_NOTIFY_FROM || 'Scam quiz bug reports <onboarding@resend.dev>', to: [e.BUG_NOTIFY_EMAIL], subject, text })
    });
    if (r.ok) return { sent: true };
    const j = await r.json().catch(() => ({}));
    return { sent: false, reason: `Resend answered HTTP ${r.status}: ${String(j.message || j.name || '').slice(0, 300)}` };
  } catch (err) {
    return { sent: false, reason: err.name === 'AbortError' ? 'Resend did not answer within 3 s' : String(err.message).slice(0, 300) };
  } finally { clearTimeout(timer); }
}

const bugAlert = (id) => sendAlert(`New bug report #${id}`, `Bug report #${id} was just submitted. Details are in the superadmin page, Bug log tab.`);

module.exports = { sendAlert, bugAlert };
