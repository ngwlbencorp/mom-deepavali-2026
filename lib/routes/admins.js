const { db, ensureSchema, httpError, route } = require('../lib');

const EMAIL = /^[^\s@,;"']+@[^\s@,;"']+\.[^\s@,;"']+$/;

// Superadmin: GET lists admins. POST { emails: [...], mode: "add" | "replace" } or { remove: "email" }.
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
        if (body.mode === 'replace') await client.query('DELETE FROM admins');
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
  const { rows } = await q.query('SELECT email, added_at FROM admins ORDER BY email');
  return { admins: rows };
});
