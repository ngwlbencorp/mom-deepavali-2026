const { db, ensureSchema, httpError, route } = require('../lib');

// Officer: report a problem with the mini-site or the admin page.
// Body: { description, screenshots: ["data:image/jpeg;base64,...", ...] } (up to 3, each up
// to 600 KB; the admin page shrinks photos before sending). -> { id }
const MAX_SHOTS = 3, MAX_BYTES = 600 * 1024;
const MAGIC = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };

function image(dataUrl, i) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw httpError(400, 'bad_image', `Screenshot ${i + 1} must be a JPEG, PNG or WebP image`);
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_BYTES) throw httpError(400, 'image_too_large', `Screenshot ${i + 1} is too large`);
  if (!MAGIC[m[1]].every((b, k) => buf[k] === b)) throw httpError(400, 'bad_image', `Screenshot ${i + 1} is not a valid image`);
  return { type: m[1], buf };
}

// Optional email to the app owner: report number only (no description, no reporter).
async function notify(id) {
  const e = process.env;
  if (!e.RESEND_API_KEY || !e.BUG_NOTIFY_EMAIL) return;
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: 'Bearer ' + e.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: e.BUG_NOTIFY_FROM || 'Scam quiz bug reports <onboarding@resend.dev>',
        to: [e.BUG_NOTIFY_EMAIL],
        subject: `New bug report #${id}`,
        text: `Bug report #${id} was just submitted. Details are in the superadmin page, Bug log tab.`
      })
    });
  } catch (err) { console.error('bug notify failed', err.message); } finally { clearTimeout(timer); }
}

module.exports = route(['POST'], 'admin', async (req, body, who) => {
  const description = String(body.description || '').trim(), screen = String(body.screen || '').trim().slice(0, 100);
  if (description.length < 5 || description.length > 2000) throw httpError(400, 'bad_description', 'Describe the problem in 5 to 2000 characters');
  const shots = Array.isArray(body.screenshots) ? body.screenshots : [];
  if (shots.length > MAX_SHOTS) throw httpError(400, 'too_many_images', `At most ${MAX_SHOTS} screenshots`);
  const images = shots.map(image);
  await ensureSchema();
  const client = await db().connect();
  let id;
  try {
    await client.query('BEGIN');
    id = (await client.query('INSERT INTO bug_reports (reporter_email, screen, description) VALUES ($1, $2, $3) RETURNING id',
      [who.user, screen, description])).rows[0].id;
    for (const im of images) await client.query('INSERT INTO bug_screenshots (report_id, image, mime_type) VALUES ($1, $2, $3)', [id, im.buf, im.type]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  await notify(id);
  return { id: Number(id) };
});
