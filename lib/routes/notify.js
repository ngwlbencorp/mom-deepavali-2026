const { db, ensureSchema, httpError, route } = require('../lib');

// Superadmin: emails to officers through Postman (GovTech's email service).
//   GET                                   -> { ready, missing, counts: { welcome, reminder }, preview }
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
const BATCH = 10, BATCH_MS = 7000;

// Settings may have been added in either case in Vercel; read both.
const setting = (name) => (process.env[name] || process.env[name.toLowerCase()] || '').trim();
const SETTINGS = ['POSTMAN_API_KEY', 'ADMIN_PASSWORD', 'MINISITE_URL', 'OFFICER_SITE_URL', 'ADMIN_CONTACT'];
const NEEDS = { welcome: ['POSTMAN_API_KEY', 'ADMIN_PASSWORD', 'MINISITE_URL', 'OFFICER_SITE_URL'], reminder: ['POSTMAN_API_KEY', 'ADMIN_PASSWORD', 'OFFICER_SITE_URL', 'ADMIN_CONTACT'] };

const TEMPLATES = {
  welcome: {
    subject: 'Deepavali event on 8 Nov: your access to the scam quiz and Souvenir Station',
    text: `Hello,

You have been added as an officer for the scam-awareness booth at MOM's Deepavali event on 8 Nov.

There are two sites:

1. Stay Safe from Scams, the mini-site migrant workers will use: {MINISITE_URL}
Workers learn about common scams, then take a short quiz. Full marks earn a QR code for a souvenir.

2. Souvenir Station, the officer site: {OFFICER_SITE_URL}
Here you scan workers' QR codes and give out souvenirs.
Log in with your work email (the address this email was sent to) and the password: {PASSWORD}

Please try both sites before the briefing on 6 Nov. Take the quiz on one phone, then scan its QR code with Souvenir Station on another phone (yours or a colleague's). You need full marks for a QR code; you can review the answers and try again. Play around as much as you like: all test data will be wiped just before the event.

If something goes wrong on either site, take a screenshot and report it with "Report a problem" on Souvenir Station. Please do not report site problems by Slack, Teams or email.

This is an automated email. Please do not reply.`
  },
  reminder: {
    subject: 'Reminder: please log in to Souvenir Station before 8 Nov',
    text: `Hello,

Our records show you have not logged in to Souvenir Station yet. Please log in before the Deepavali event on 8 Nov, to confirm your access works.

Souvenir Station: {OFFICER_SITE_URL}
Log in with your work email (the address this email was sent to) and the password: {PASSWORD}

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
    PASSWORD: maskPassword ? '(the ADMIN_PASSWORD setting)' : setting('ADMIN_PASSWORD')
  };
  const text = t.text.replace(/\{(\w+)\}/g, (_, k) => values[k]);
  const html = t.text.split(/\n\n/).map((para) => '<p>' + esc(para).replace(/\n/g, '<br>')
    .replace(/\{(\w+)\}/g, (_, k) => (k === 'PASSWORD' ? `<b>${esc(values[k])}</b>` : link(values[k]))) + '</p>').join('\n');
  return { subject: t.subject, text, html };
}

const missing = (kind) => (kind ? NEEDS[kind] : SETTINGS).filter((n) => !setting(n));

async function postman(to, kind) {
  const { subject, html } = render(kind);
  for (let attempt = 0; attempt < 2; attempt++) {
    let r;
    try {
      r = await fetch(POSTMAN_URL(), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + setting('POSTMAN_API_KEY'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body: html, recipient: to, tag: 'deepavali-' + kind }),
        signal: AbortSignal.timeout(8000)
      });
    } catch (e) {
      return { ok: false, message: 'Cannot reach Postman (' + (e.name === 'TimeoutError' ? 'timed out' : 'network error') + ')' };
    }
    if (r.ok) return { ok: true };
    if (r.status === 429 && attempt === 0) { await new Promise((res) => setTimeout(res, 1500)); continue; }
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

module.exports = route(['GET', 'POST'], 'super', async (req, body) => {
  await ensureSchema();
  const q = db();
  if (req.method === 'GET') {
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
    const r = await postman(to, kind);
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
    while (sent.length + failed.length < BATCH && Date.now() - start < BATCH_MS) {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT email FROM admins WHERE ${PENDING[kind]} AND email > $1 ORDER BY email LIMIT 1 FOR UPDATE SKIP LOCKED`, [after]);
      if (!rows.length) { await client.query('COMMIT'); break; }
      const email = rows[0].email;
      after = email;
      const r = await postman(email, kind);
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
