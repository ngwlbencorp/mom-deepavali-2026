const { db, ensureSchema, httpError, route, listEvents, getEvent, requireNotEnded, THEMES, stats } = require('../lib');

const EMAIL = /^[^\s@,;"']+@[^\s@,;"']+\.[^\s@,;"']+$/;

// Superadmin: the events and each event's officer list (owner, 18 Nov).
//   GET                         -> { events: [...] } (each with its souvenir counts)
//   GET ?officers=<id>          -> { event, officers: [...] } that event's list, with each officer's login record
//   POST { id, cap?, name?, theme?, startsAt?, endsAt? }   -> changes an event that has not ended
//   POST { id, clearTest: true, confirm: "CLEAR" }          -> "Clear test data": sets test_cleared_at to
//        now, which hides that event's earlier claims, attempts and souvenirs everywhere. Deletes nothing.
//        Only before the event starts: during it, a clear would hide real souvenirs and reset the count.
//   POST { id, add: [emails] }  -> adds officers to the event, and to the login list (admins) if new,
//        so the welcome email flow still finds them
//   POST { id, remove: email }  -> takes an officer off the event's list (they keep their login)
// Once an event has ended, every change to it is refused (its data is locked).
module.exports = route(['GET', 'POST'], 'super', async (req, body) => {
  await ensureSchema();
  const q = db();
  const officers = async (id) => (await q.query(
    `SELECT o.email, o.added_at, o.reminder_sent_at, a.last_login_at, COALESCE(a.login_count, 0) AS login_count, a.welcome_sent_at, a.email IS NOT NULL AS can_log_in
     FROM event_officers o LEFT JOIN admins a ON a.email = o.email WHERE o.event_id = $1 ORDER BY o.email`, [id])).rows;
  if (req.method === 'GET') {
    const id = new URL(req.url, 'http://x').searchParams.get('officers');
    if (id) {
      const ev = await getEvent(q, id);
      return { event: ev, officers: await officers(ev.id) };
    }
    const events = await listEvents(q);
    for (const e of events) {
      const st = await stats(q, e);
      e.given = st.given; e.claims = st.uniqueClaims;
      e.officers = Number((await q.query('SELECT count(*) AS n FROM event_officers WHERE event_id = $1', [e.id])).rows[0].n);
    }
    return { events };
  }

  const ev = await getEvent(q, String(body.id || '') || '-');
  requireNotEnded(ev);

  if (body.clearTest) {
    if (body.confirm !== 'CLEAR') throw httpError(400, 'confirm_required', 'Type CLEAR to confirm');
    if (ev.started) throw httpError(403, 'event_started', 'This event has started: clearing now would hide real souvenirs and reset the count.');
    await q.query('UPDATE events SET test_cleared_at = now() WHERE id = $1 AND starts_at > now()', [ev.id]);
  } else if (body.add !== undefined || body.remove !== undefined) {
    if (body.remove !== undefined) {
      await q.query('DELETE FROM event_officers WHERE event_id = $1 AND email = $2', [ev.id, String(body.remove).trim().toLowerCase()]);
    } else {
      if (!Array.isArray(body.add)) throw httpError(400, 'bad_emails', 'add must be a list');
      const clean = [...new Set(body.add.map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
      const bad = clean.filter((x) => !EMAIL.test(x));
      if (bad.length) throw httpError(400, 'bad_emails', 'Not valid email addresses: ' + bad.slice(0, 5).join(', '));
      if (clean.length > 2000) throw httpError(400, 'bad_emails', 'Too many emails');
      const client = await q.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO admins (email) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING', [clean]);
        await client.query('INSERT INTO event_officers (event_id, email) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING', [ev.id, clean]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    }
    return { event: ev, officers: await officers(ev.id) };
  } else {
    const set = [], vals = [ev.id];
    const put = (col, v) => { vals.push(v); set.push(`${col} = $${vals.length}`); };
    if (body.cap !== undefined) {
      const cap = body.cap === null || body.cap === '' ? null : Number(body.cap);
      if (cap !== null && !(Number.isInteger(cap) && cap >= 0 && cap <= 100000)) throw httpError(400, 'bad_cap', 'The cap must be a whole number from 0');
      put('souvenir_cap', cap);
    }
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name || name.length > 60) throw httpError(400, 'bad_name', 'The name must be 1 to 60 characters');
      put('name', name);
    }
    if (body.theme !== undefined) {
      if (!THEMES.includes(body.theme)) throw httpError(400, 'bad_theme', 'The theme must be one of ' + THEMES.join(', '));
      put('theme', body.theme);
    }
    if (body.startsAt !== undefined || body.endsAt !== undefined) {
      const startsAt = Date.parse(body.startsAt !== undefined ? body.startsAt : ev.startsAt);
      const endsAt = Date.parse(body.endsAt !== undefined ? body.endsAt : ev.endsAt);
      if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) throw httpError(400, 'bad_times', 'The end must be after the start');
      if (endsAt <= Date.now()) throw httpError(400, 'bad_times', 'The end must be in the future');
      if (body.startsAt !== undefined) put('starts_at', new Date(startsAt).toISOString());
      if (body.endsAt !== undefined) put('ends_at', new Date(endsAt).toISOString());
    }
    if (!set.length) throw httpError(400, 'bad_request', 'Nothing to change');
    // ends_at > now() again here, so a change cannot slip in as the event ends
    const r = await q.query(`UPDATE events SET ${set.join(', ')} WHERE id = $1 AND ends_at > now()`, vals);
    if (!r.rowCount) throw httpError(403, 'event_frozen', 'This event has ended. Its data is locked and cannot be changed.');
  }
  return { event: await getEvent(q, ev.id) };
});
