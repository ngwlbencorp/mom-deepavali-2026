const { db, ensureSchema, httpError, route, getEvent, requireNotEnded } = require('../lib');

// Superadmin: emails to officers through Postman (GovTech's email service).
//   GET                                   -> { ready, missing, counts: { welcome, reminder }, preview }
//   GET ?delivery=1                       -> Postman's delivery status for each officer's emails
//   POST { kind, test: "email" }          -> sends one test email to that address; marks nothing
//   POST { kind, send: true, after? }     -> sends the next batch; { sent, failed, remaining, after }
// kind is "welcome" (officers not yet sent it, once per officer) or "reminder" (per event: the
// event's officers not yet reminded for it, tracked in event_officers.reminder_sent_at; owner, 18 Nov).
// Every call takes `event` (an event id; default: the current event, else the next one); its date
// and session time go into both templates. A reminder for an event that has ended is refused.
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
const SETTINGS = ['POSTMAN_API_KEY', 'ADMIN_PASSWORD', 'MINISITE_URL', 'OFFICER_SITE_URL', 'ADMIN_CONTACT'];
const NEEDS = { welcome: ['POSTMAN_API_KEY', 'ADMIN_PASSWORD', 'MINISITE_URL', 'OFFICER_SITE_URL'], reminder: ['POSTMAN_API_KEY', 'ADMIN_PASSWORD', 'MINISITE_URL', 'OFFICER_SITE_URL', 'ADMIN_CONTACT'] };

const TEMPLATES = {
  welcome: {
    subject: 'Digital4Good @ Kranji RC: Your access to the event mini-site and Admin Portal',
    text: `Hello,

You have been added as an officer for the scam-awareness booth at Digital4Good @ Kranji RC on {EVENT_DATE}, {EVENT_TIME}.

There are two sites:

1. Stay Safe from Scams, the mini-site migrant workers will use: {MINISITE_URL}
Workers learn about common scams, then take a short quiz. Full marks earn a QR code for a souvenir.

2. Admin Portal, the officer site: {OFFICER_SITE_URL}
Here you scan workers' QR codes and give out souvenirs.
Log in with your work email (the address this email was sent to) and the password: {PASSWORD}

Please try both sites before the event. Take the quiz on one phone, then scan its QR code with the Admin Portal on another phone (yours or a colleague's). You need full marks for a QR code; you can review the answers and try again. Play around as much as you like: all test data will be wiped just before the event.

If something goes wrong on either site, take a screenshot and report it with "Report a problem" on the Admin Portal. Please do not report site problems by Slack, Teams or email.

This is an automated email. Please do not reply.`
  },
  // The reminder goes to every officer on the event's list (owner, 5 Nov; per event since 18 Nov).
  // Officers who never logged in get the "not logged in yet" version; the rest, who logged in for
  // this or an earlier session, get reminder_loggedin, asking them to log in again to confirm their
  // access still works. Only "reminder" is a kind the API accepts; the variant is picked per officer
  // from admins.last_login_at. The briefing-slides line is removed for now (owner, 18 Nov: no deck
  // for 22 Nov and 6 Dec). Wording to be cleared by the owner before any real send.
  reminder: {
    subject: '[Reminder] Digital4Good @ Kranji RC: Log in to Admin Portal before {EVENT_DATE}',
    text: `Hello,

Our records show you have not logged in to the Admin Portal yet. Please log in before Digital4Good @ Kranji RC on {EVENT_DATE}, {EVENT_TIME}, to confirm your access works.

Admin Portal, the officer site: {OFFICER_SITE_URL}
Log in with your work email (the address this email was sent to) and the password: {PASSWORD}

Stay Safe from Scams, the mini-site migrant workers will use: {MINISITE_URL}

If something goes wrong on either site, take a screenshot and report it with "Report a problem" on the Admin Portal.

If you cannot log in, message the organiser on Slack: {ADMIN_CONTACT}

This is an automated email. Please do not reply.`
  },
  reminder_loggedin: {
    subject: '[Reminder] Digital4Good @ Kranji RC on {EVENT_DATE}: please log in again to check your access',
    text: `Hello,

You are an officer for Digital4Good @ Kranji RC on {EVENT_DATE}, {EVENT_TIME}. Our records show you logged in to the Admin Portal for an earlier session. We are sending this reminder anyway: please log in again before {EVENT_DATE} to confirm your access still works.

Admin Portal, the officer site: {OFFICER_SITE_URL}
Log in with your work email (the address this email was sent to) and the password: {PASSWORD}

Stay Safe from Scams, the mini-site migrant workers will use: {MINISITE_URL}

If something goes wrong on either site, take a screenshot and report it with "Report a problem" on the Admin Portal.

If you cannot log in, message the organiser on Slack: {ADMIN_CONTACT}

This is an automated email. Please do not reply.`
  }
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const link = (u) => /^https?:\/\//i.test(u) ? `<a href="${esc(u)}">${esc(u)}</a>` : esc(u);

// The event's date and session time in Singapore time, e.g. "22 Nov" and "5 pm to 9 pm".
const SGT = 8 * 3600e3;
function sgtDate(iso) { return new Date(Date.parse(iso) + SGT).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }
function sgtTime(iso) {
  const d = new Date(Date.parse(iso) + SGT), h = d.getUTCHours(), m = d.getUTCMinutes();
  return (h % 12 || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? ' am' : ' pm');
}
function eventValues(ev) {
  return ev ? { EVENT_DATE: sgtDate(ev.startsAt), EVENT_TIME: sgtTime(ev.startsAt) + ' to ' + sgtTime(ev.endsAt) } : { EVENT_DATE: '(event date)', EVENT_TIME: '(session time)' };
}

// Escapes the template first, then puts each value in: links as links, the password in bold.
function render(kind, { maskPassword = false, event = null } = {}) {
  const t = TEMPLATES[kind];
  const values = {
    MINISITE_URL: setting('MINISITE_URL'), OFFICER_SITE_URL: setting('OFFICER_SITE_URL'), ADMIN_CONTACT: setting('ADMIN_CONTACT'),
    ...eventValues(event),
    PASSWORD: maskPassword ? '(the ADMIN_PASSWORD setting)' : setting('ADMIN_PASSWORD')
  };
  const plain = { EVENT_DATE: 1, EVENT_TIME: 1 };
  const text = t.text.replace(/\{(\w+)\}/g, (_, k) => values[k]);
  const html = t.text.split(/\n\n/).map((para) => '<p>' + esc(para).replace(/\n/g, '<br>')
    .replace(/\{(\w+)\}/g, (_, k) => (k === 'PASSWORD' ? `<b>${esc(values[k])}</b>` : plain[k] ? esc(values[k]) : link(values[k]))) + '</p>').join('\n');
  return { subject: t.subject.replace(/\{(\w+)\}/g, (_, k) => values[k]), text, html };
}

const missing = (kind) => (kind ? NEEDS[kind] : SETTINGS).filter((n) => !setting(n));

async function postman(to, kind, deadline, variant, event) {
  const { subject, html } = render(variant || kind, { event });
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

// Who is pending: the welcome on admins (once per officer), the reminder on event_officers (per
// event). $1 = the email to start after, $2 = the event id.
const PENDING = {
  welcome: `SELECT a.email, a.last_login_at IS NOT NULL AS logged_in FROM admins a WHERE a.welcome_sent_at IS NULL AND a.email > $1 AND $2::text IS NOT NULL`,
  reminder: `SELECT o.email, a.last_login_at IS NOT NULL AS logged_in FROM event_officers o JOIN admins a ON a.email = o.email
             WHERE o.event_id = $2 AND o.reminder_sent_at IS NULL AND o.email > $1`
};
const LOCK = { welcome: 'FOR UPDATE OF a SKIP LOCKED', reminder: 'FOR UPDATE OF o SKIP LOCKED' };
const MARK = {
  welcome: 'UPDATE admins SET welcome_sent_at = now() WHERE email = $1 AND $2::text IS NOT NULL',
  reminder: 'UPDATE event_officers SET reminder_sent_at = now() WHERE email = $1 AND event_id = $2'
};
const EMAIL = /^[^\s@,;"']+@[^\s@,;"']+\.[^\s@,;"']+$/;

async function counts(q, ev) {
  const w = await q.query('SELECT count(*)::int AS n FROM admins WHERE welcome_sent_at IS NULL');
  const r = await q.query(`SELECT count(*)::int AS reminder, count(*) FILTER (WHERE NOT logged_in)::int AS reminder_not_logged_in FROM (${PENDING.reminder}) p`, ['', ev.id]);
  return { welcome: w.rows[0].n, reminder: r.rows[0].reminder, reminder_not_logged_in: r.rows[0].reminder_not_logged_in, event: ev.id };
}

// Delivery status (owner, 2 Nov). Postman sends asynchronously: a 201 only means it accepted the
// email. Its List endpoint returns every email sent with this key, with recipient and status, so
// no Postman id needs storing: each officer's email is the one to their address created nearest
// the welcome_sent_at / reminder_sent_at already on their row (within 10 minutes).
const LIST_URL = () => POSTMAN_URL().replace(/\/send\/?$/, '');
const scrub = (t) => String(t || '').replace(/[^\s@"'<>,;:]+@[^\s@"'<>,;:]+/g, '[address]').replace(/\s+/g, ' ').slice(0, 200);

async function delivery(q, ev) {
  const { rows } = await q.query(`SELECT a.email, a.welcome_sent_at, o.reminder_sent_at FROM admins a
    LEFT JOIN event_officers o ON o.email = a.email AND o.event_id = $1`, [ev.id]);
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
    const sp = new URL(req.url, 'http://x').searchParams;
    const ev = await getEvent(q, sp.get('event'));
    if (sp.get('delivery')) {
      if (!setting('POSTMAN_API_KEY')) throw httpError(400, 'not_configured', 'Missing Vercel settings: POSTMAN_API_KEY');
      return delivery(q, ev);
    }
    const p = { maskPassword: true, event: ev };
    return {
      ready: { welcome: !missing('welcome').length, reminder: !missing('reminder').length && !ev.ended },
      missing: missing(),
      counts: await counts(q, ev),
      event: ev,
      preview: { welcome: render('welcome', p), reminder: render('reminder', p), reminder_loggedin: render('reminder_loggedin', p) }
    };
  }

  const kind = body.kind;
  if (kind !== 'welcome' && kind !== 'reminder') throw httpError(400, 'bad_kind', 'kind must be welcome or reminder');
  const gap = missing(kind);
  if (gap.length) throw httpError(400, 'not_configured', 'Missing Vercel settings: ' + gap.join(', '));
  const ev = await getEvent(q, body.event);
  if (kind === 'reminder') requireNotEnded(ev);

  if (body.test !== undefined) {
    const to = String(body.test).trim().toLowerCase();
    if (!EMAIL.test(to)) throw httpError(400, 'bad_email', 'Not a valid email address');
    // A test reminder sends both versions, so the owner sees what each group receives.
    const variants = kind === 'reminder' ? ['reminder', 'reminder_loggedin'] : [kind];
    const deadline = Date.now() + DEADLINE_MS;
    for (const v of variants) {
      const r = await postman(to, kind, deadline, v, ev);
      if (!r.ok) throw httpError(502, 'postman_failed', r.message);
    }
    return { sent: variants.length };
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
      const { rows } = await client.query(`${PENDING[kind]} ORDER BY 1 LIMIT 1 ${LOCK[kind]}`, [after, ev.id]);
      if (!rows.length) { await client.query('COMMIT'); break; }
      const email = rows[0].email;
      const variant = kind === 'reminder' && rows[0].logged_in ? 'reminder_loggedin' : kind;
      const r = await postman(email, kind, start + DEADLINE_MS, variant, ev);
      // Out of time before trying: leave it for the next batch, first in line.
      if (r.skipped) { await client.query('COMMIT'); break; }
      after = email;
      if (r.ok) {
        await client.query(MARK[kind], [email, ev.id]);
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
  const left = await q.query(`SELECT count(*)::int AS n FROM (${PENDING[kind]}) p`, [after, ev.id]);
  return { sent: sent.length, failed, after, remaining: left.rows[0].n, counts: await counts(q, ev) };
});

module.exports.render = render;
module.exports.TEMPLATES = TEMPLATES;
