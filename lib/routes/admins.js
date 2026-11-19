const { db, ensureSchema, httpError, route } = require('../lib');

const EMAIL = /^[^\s@,;"']+@[^\s@,;"']+\.[^\s@,;"']+$/;

// Superadmin: GET lists admins (email, added_at, last_login_at, login_count, welcome_sent_at,
// reminder_sent_at, and events: the ids of the events whose officer list holds the email, from
// event_officers; owner, 19 Nov). POST { emails: [...], mode: "add" | "replace" } or { remove: "email" }.
// Adding an email already listed keeps its login history and email record. "replace" removes only
// the emails missing from the new list, so officers in both lists are not sent the welcome again;
// a removed officer who is added back is a new row and gets it again (owner, 2 Nov).
// "remove" deletes the login row only: the email stays on any event's officer list (shown there
// as unable to log in) until the officer is added again. Since 19 Nov the superadmin page adds
// officers only through an event's list (/api/events); "emails" stays for older open pages.
module.exports = route(['GET', 'POST'], 'super', async (req, body) => {
  await ensureSchema();
  const q = db();
  if (req.method === 'POST') {
    if (body.remove) {
      await q.query('DELETE FROM admins WHERE email = $1', [String(body.remove).trim().toLowerCase()]);
    } else {
      if (!Array.isArray(body.emails)) throw httpError(400, 'bad_emails', 'emails must be a list');
      const clean = [...new Set(body.emails.map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
      const bad = clean.filter((x) => !EMAIL.test(x));
      if (bad.length) throw httpError(400, 'bad_emails', 'Not valid email addresses: ' + bad.slice(0, 5).join(', '));
      if (clean.length > 2000) throw httpError(400, 'bad_emails', 'Too many emails');
      const client = await q.connect();
      try {
        await client.query('BEGIN');
        if (body.mode === 'replace') await client.query('DELETE FROM admins WHERE NOT (email = ANY($1::text[]))', [clean]);
        if (clean.length) await client.query('INSERT INTO admins (email) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING', [clean]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    }
  }
  const { rows } = await q.query(`SELECT a.email, a.added_at, a.last_login_at, COALESCE(a.login_count, 0) AS login_count, a.welcome_sent_at, a.reminder_sent_at,
      ARRAY(SELECT o.event_id FROM event_officers o WHERE o.email = a.email ORDER BY o.event_id) AS events
    FROM admins a ORDER BY a.email`);
  return { admins: rows };
});
