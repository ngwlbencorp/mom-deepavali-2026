const { db, ensureSchema, httpError, route } = require('../lib');

// Superadmin: emails to officers through Postman (GovTech's email service).
//   GET                                   -> { ready, missing, counts: { welcome, reminder }, preview }
//   GET ?delivery=1                       -> Postman's delivery status for each officer's emails
//   POST { kind, test: "email" }          -> sends one test email to that address; marks nothing
//   POST { kind, send: true, after? }     -> sends the next batch; { sent, failed, remaining, after }
// kind is "welcome" (officers not yet sent it) or "reminder" (never logged in and not yet reminded).
// The page calls "send" again with the returned `after` until nothing remains, so each call stays
// well inside the function's time limit. Each email is sent inside its own row lock (SKIP LOCKED),
// so two tabs pressing Send at once never email the same officer twice. Why buttons, not automatic
// sends: a mistaken upload must not email everyone at once (owner, 2 Nov).
// Why the tracker lives on the admins row: removing an officer deletes the row, so re-adding them
// sends the welcome again, and the rehearsal reset never touches admins (owner, 2 Nov).
// The password and page addresses come from Vercel settings, never from this public repo.

const POSTMAN_URL = () => process.env.POSTMAN_API_URL || 'https://api.postman.gov.sg/v1/transactional/email/send';
// Time limits. Vercel stops a request at its project limit (10 s on older Hobby projects). If it
// stopped mid-batch, the email in flight would go out without being recorded, and the officer would
// stay pending (2 Nov). So no new email starts after START_MS, and every Postman call, retry
// included, ends by DEADLINE_MS from the start of the request.
const BATCH = 10, START_MS = 4000, DEADLINE_MS = 8000;

// Settings may have been added in either case in Vercel; read both.
const setting = (name) => (process.env[name] || process.env[name.toLowerCase()] || '').trim();
const SETTINGS = ['POSTMAN_API_KEY', 'ADMIN_PASSWORD', 'MINISITE_URL', 'OFFICER_SITE_URL', 'ADMIN_CONTACT', 'BRIEFING_URL'];
const NEEDS = { welcome: ['POSTMAN_API_KEY', 'ADMIN_PASSWORD', 'MINISITE_URL', 'OFFICER_SITE_URL'], reminder: ['POSTMAN_API_KEY', 'ADMIN_PASSWORD', 'OFFICER_SITE_URL', 'ADMIN_CONTACT', 'BRIEFING_URL'] };

const TEMPLATES = {
  welcome: {
    subject: 'Digital4Good @ Kranji RC: Your access to the event mini-site and Admin Portal',
    text: `Hello,

You have been added as an officer for the scam-awareness booth at Digital4Good @ Kranji RC on 8 Nov.

There are two sites:

1. Stay Safe from Scams, the mini-site migrant workers will use: {MINISITE_URL}
Workers learn about common scams, then take a short quiz. Full marks earn a QR code for a souvenir.

2. Admin Portal, the officer site: {OFFICER_SITE_URL}
Here you scan workers' QR codes and give out souvenirs.
Log in with your work email (the address this email was sent to) and the password: {PASSWORD}

There will be a short briefing during the MPC Staff Dialogue on 6 Nov, please try both sites before the briefing. Take the quiz on one phone, then scan its QR code with the Admin Portal on another phone (yours or a colleague's). You need full marks for a QR code; you can review the answers and try again. Play around as much as you like: all test data will be wiped just before the event.

If something goes wrong on either site, take a screenshot and report it with "Report a problem" on the Admin Portal. Please do not report site problems by Slack, Teams or email.

This is an automated email. Please do not reply.`
  },
  reminder: {
    subject: '[Reminder] Digital4Good @ Kranji RC: Log in to Admin Portal before 8 Nov',
    text: `Hello,

Our records show you have not logged in to the Admin Portal yet. Please log in before Digital4Good @ Kranji RC on 8 Nov, to confirm your access works.

Admin Portal: {OFFICER_SITE_URL}
Log in with your work email (the address this email was sent to) and the password: {PASSWORD}

Briefing slides: {BRIEFING_URL}
The slides open only on a COMET or SEED device. The Admin Portal and the mini-site work on any phone or computer.

If you cannot log in, message the organiser on Slack: {ADMIN_CONTACT}

This is an automated email. Please do not reply.`
  }
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const link = (u) => /^https?:\/\//i.test(u) ? `<a href="${esc(u)}">${esc(u)}</a>` : esc(u);

// Escapes the template first, then puts each value in: links as links, the password in bold.
function render(kind, { maskPassword = false } = {}) {
  const t = TEMPLATES[kind];
  const values = {
    MINISITE_URL: setting('MINISITE_URL'), OFFICER_SITE_URL: setting('OFFICER_SITE_URL'), ADMIN_CONTACT: setting('ADMIN_CONTACT'),
    BRIEFING_URL: setting('BRIEFING_URL'),
    PASSWORD: maskPassword ? '(the ADMIN_PASSWORD setting)' : setting('ADMIN_PASSWORD')
  };
  const text = t.text.replace(/\{(\w+)\}/g, (_, k) => values[k]);
  const html = t.text.split(/\n\n/).map((para) => '<p>' + esc(para).replace(/\n/g, '<br>')
    .replace(/\{(\w+)\}/g, (_, k) => (k === 'PASSWORD' ? `<b>${esc(values[k])}</b>` : link(values[k]))) + '</p>').join('\n');
  return { subject: t.subject, text, html };
}

const missing = (kind) => (kind ? NEEDS[kind] : SETTINGS).filter((n) => !setting(n));

async function postman(to, kind, deadline) {
  const { subject, html } = render(kind);
  for (let attempt = 0; attempt < 2; attempt++) {
    let r;
    const left = deadline - Date.now();
    if (left < 1000) return { ok: false, skipped: true, message: 'Not tried: out of time in this batch' };
    try {
      r = await fetch(POSTMAN_URL(), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + setting('POSTMAN_API_KEY'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body: html, recipient: to, tag: 'deepavali-' + kind }),
        signal: AbortSignal.timeout(Math.min(5000, left))
      });
    } catch (e) {
      return { ok: false, message: 'Cannot reach Postman (' + (e.name === 'TimeoutError' ? 'timed out' : 'network error') + ')' };
    }
    if (r.ok) return { ok: true };
    if (r.status === 429 && attempt === 0 && deadline - Date.now() > 3000) { await new Promise((res) => setTimeout(res, 1000)); continue; }
    // Postman's reply may repeat the recipient; a failed test send is logged in api_errors, which
    // must hold no personal data, so addresses are blanked out.
    const detail = (await r.text().catch(() => '')).replace(/[^\s@"'<>,;:]+@[^\s@"'<>,;:]+/g, '[address]').replace(/\s+/g, ' ').slice(0, 200);
    return { ok: false, status: r.status, message: 'Postman answered ' + r.status + (detail ? ': ' + detail : '') };
  }
  return { ok: false, status: 429, message: 'Postman is limiting the sending rate; try again in a minute' };
}

const PENDING = {
  welcome: 'welcome_sent_at IS NULL',
  reminder: 'last_login_at IS NULL AND reminder_sent_at IS NULL'
};
const MARK = { welcome: 'welcome_sent_at', reminder: 'reminder_sent_at' };
const EMAIL = /^[^\s@,;"']+@[^\s@,;"']+\.[^\s@,;"']+$/;

async function counts(q) {
  const { rows } = await q.query(`SELECT count(*) FILTER (WHERE ${PENDING.welcome})::int AS welcome,
    count(*) FILTER (WHERE ${PENDING.reminder})::int AS reminder FROM admins`);
  return rows[0];
}

// Delivery status (owner, 2 Nov). Postman sends asynchronously: a 201 only means it accepted the
// email. Its List endpoint returns every email sent with this key, with recipient and status, so
// no Postman id needs storing: each officer's email is the one to their address created nearest
// the welcome_sent_at / reminder_sent_at already on their row (within 10 minutes).
const LIST_URL = () => POSTMAN_URL().replace(/\/send\/?$/, '');
const scrub = (t) => String(t || '').replace(/[^\s@"'<>,;:]+@[^\s@"'<>,;:]+/g, '[address]').replace(/\s+/g, ' ').slice(0, 200);

async function delivery(q) {
  const { rows } = await q.query('SELECT email, welcome_sent_at, reminder_sent_at FROM admins');
  if (!rows.some((r) => r.welcome_sent_at || r.reminder_sent_at)) return { officers: {}, unrecorded: [], complete: true, checked: 0 };
  const times = rows.flatMap((r) => [r.welcome_sent_at, r.reminder_sent_at]).filter(Boolean).map((t) => new Date(t).getTime());
  const since = new Date(Math.min(...times) - 10 * 60000).toISOString();
  const byRecipient = new Map();
  const start = Date.now();
  let offset = 0, more = true, checked = 0;
  while (more && Date.now() - start < 6000) {
    const u = new URL(LIST_URL());
    u.searchParams.set('limit', '100');
    u.searchParams.set('offset', String(offset));
    u.searchParams.set('exclude_params', 'true');
    u.searchParams.set('created_at[gte]', since);
    let r;
    try {
      r = await fetch(u, { headers: { Authorization: 'Bearer ' + setting('POSTMAN_API_KEY') }, signal: AbortSignal.timeout(Math.max(1000, 7500 - (Date.now() - start))) });
    } catch (e) {
      throw httpError(502, 'postman_failed', 'Cannot reach Postman (' + (e.name === 'TimeoutError' ? 'timed out' : 'network error') + ')');
    }
    if (!r.ok) throw httpError(502, 'postman_failed', 'Postman answered ' + r.status + ': ' + scrub(await r.text().catch(() => '')));
    const d = await r.json();
    for (const m of d.data || []) {
      const to = String(m.recipient || '').toLowerCase();
      if (!byRecipient.has(to)) byRecipient.set(to, []);
      byRecipient.get(to).push({ status: m.status, error: [m.error_sub_type, m.error_code].filter(Boolean).join(': '), at: new Date(m.created_at).getTime() });
    }
    checked += (d.data || []).length;
    offset += (d.data || []).length;
    more = !!d.has_more && (d.data || []).length > 0;
  }
  const nearest = (to, t) => {
    if (!t) return null;
    const at = new Date(t).getTime();
    let best = null;
    for (const m of byRecipient.get(to) || []) if (Math.abs(m.at - at) <= 10 * 60000 && (!best || Math.abs(m.at - at) < Math.abs(best.at - at))) best = m;
    return best ? { status: best.status, error: best.error || null } : { status: 'NOT_FOUND', error: null };
  };
  // An officer still pending the welcome who already has an email in Postman was sent one that
  // was never recorded (a request stopped mid-send): sending again would be a duplicate.
  const officers = {}, unrecorded = [];
  for (const r of rows) {
    if (r.welcome_sent_at || r.reminder_sent_at) officers[r.email] = { welcome: nearest(r.email, r.welcome_sent_at), reminder: nearest(r.email, r.reminder_sent_at) };
    if (!r.welcome_sent_at && (byRecipient.get(r.email) || []).length) {
      const latest = byRecipient.get(r.email).reduce((a, b) => (b.at > a.at ? b : a));
      unrecorded.push({ email: r.email, status: latest.status, at: new Date(latest.at).toISOString() });
    }
  }
  return { officers, unrecorded, complete: !more, checked };
}

module.exports = route(['GET', 'POST'], 'super', async (req, body) => {
  await ensureSchema();
  const q = db();
  if (req.method === 'GET') {
    if (new URL(req.url, 'http://x').searchParams.get('delivery')) {
      if (!setting('POSTMAN_API_KEY')) throw httpError(400, 'not_configured', 'Missing Vercel settings: POSTMAN_API_KEY');
      return delivery(q);
    }
    return {
      ready: { welcome: !missing('welcome').length, reminder: !missing('reminder').length },
      missing: missing(),
      counts: await counts(q),
      preview: { welcome: render('welcome', { maskPassword: true }), reminder: render('reminder', { maskPassword: true }) }
    };
  }

  const kind = body.kind;
  if (!TEMPLATES[kind]) throw httpError(400, 'bad_kind', 'kind must be welcome or reminder');
  const gap = missing(kind);
  if (gap.length) throw httpError(400, 'not_configured', 'Missing Vercel settings: ' + gap.join(', '));

  if (body.test !== undefined) {
    const to = String(body.test).trim().toLowerCase();
    if (!EMAIL.test(to)) throw httpError(400, 'bad_email', 'Not a valid email address');
    const r = await postman(to, kind, Date.now() + DEADLINE_MS);
    if (!r.ok) throw httpError(502, 'postman_failed', r.message);
    return { sent: 1 };
  }
  if (body.send !== true) throw httpError(400, 'bad_request', 'Give test or send');

  // One row at a time, each in its own transaction: the row stays locked while its email is sent,
  // and is marked sent in the same transaction. A failed send leaves it unsent; `after` moves past
  // it so one bad address does not stop the rest.
  let after = typeof body.after === 'string' ? body.after : '';
  const sent = [], failed = [];
  const start = Date.now();
  const client = await q.connect();
  try {
    while (sent.length + failed.length < BATCH && Date.now() - start < START_MS) {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT email FROM admins WHERE ${PENDING[kind]} AND email > $1 ORDER BY email LIMIT 1 FOR UPDATE SKIP LOCKED`, [after]);
      if (!rows.length) { await client.query('COMMIT'); break; }
      const email = rows[0].email;
      const r = await postman(email, kind, start + DEADLINE_MS);
      // Out of time before trying: leave it for the next batch, first in line.
      if (r.skipped) { await client.query('COMMIT'); break; }
      after = email;
      if (r.ok) {
        await client.query(`UPDATE admins SET ${MARK[kind]} = now() WHERE email = $1`, [email]);
        sent.push(email);
      } else {
        failed.push({ email, message: r.message });
      }
      await client.query('COMMIT');
      // A wrong key or a Postman outage fails every address the same way: stop at the first.
      if (!r.ok && (r.status === 401 || r.status === 403 || !r.status)) break;
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  const left = await q.query(`SELECT count(*)::int AS n FROM admins WHERE ${PENDING[kind]} AND email > $1`, [after]);
  return { sent: sent.length, failed, after, remaining: left.rows[0].n, counts: await counts(q) };
});

module.exports.render = render;
module.exports.TEMPLATES = TEMPLATES;
