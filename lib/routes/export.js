const { db, ensureSchema, httpError, route, PUBLIC_COLS, getEvent, VIS } = require('../lib');

// claims, submissions and event_officers take ?event=<id>: that event's rows only, leaving out
// rows hidden by its "Clear test data" (lib.js VIS). Without event, claims and submissions list
// every row of every event, as before.
const COLS = PUBLIC_COLS.split(', ').map((c) => 's.' + c).join(', ');
const TABLES = {
  claims: (ev) => ev
    ? `SELECT ${COLS} FROM scans s JOIN events e ON e.id = s.event_id WHERE s.event_id = $1 AND ${VIS.claim} ORDER BY s.first_seen`
    : `SELECT ${PUBLIC_COLS} FROM scans ORDER BY first_seen`,
  submissions: (ev) => ev
    ? `SELECT b.id, b.claim_id, b.attempt, b.score, b.total, b.item_scores, b.source, b.language, b.submitted_by, b.created_at, b.event_id
       FROM submissions b JOIN events e ON e.id = b.event_id WHERE b.event_id = $1 AND ${VIS.attempt} ORDER BY b.id`
    : 'SELECT id, claim_id, attempt, score, total, item_scores, source, language, submitted_by, created_at, event_id FROM submissions ORDER BY id',
  admins: () => 'SELECT email, added_at, last_login_at, COALESCE(login_count, 0) AS login_count, welcome_sent_at, reminder_sent_at FROM admins ORDER BY email',
  event_officers: () => `SELECT o.event_id, o.email, o.added_at, o.reminder_sent_at, a.last_login_at, COALESCE(a.login_count, 0) AS login_count, a.welcome_sent_at
       FROM event_officers o LEFT JOIN admins a ON a.email = o.email WHERE o.event_id = $1 ORDER BY o.email`,
  bugs: () => `SELECT id, reporter_email, screen, description, status, created_at, fixed_at,
           round(extract(epoch FROM fixed_at - created_at) / 60) AS minutes_to_fix, fix_ref, fix_note,
           (SELECT count(*) FROM bug_screenshots s WHERE s.report_id = r.id) AS screenshots
         FROM bug_reports r ORDER BY id`,
  errors: () => 'SELECT id, route, message, created_at FROM api_errors ORDER BY id'
};
const PER_EVENT = { claims: 1, submissions: 1, event_officers: 1 };

const cell = (v) => {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

// Superadmin: GET /api/export?table=claims|submissions|admins|event_officers|bugs|errors[&event=<id>] -> CSV
module.exports = route(['GET'], 'super', async (req) => {
  const sp = new URL(req.url, 'http://x').searchParams;
  const table = sp.get('table') || 'claims';
  if (!TABLES[table]) throw httpError(400, 'bad_table', 'table must be claims, submissions, admins, event_officers, bugs or errors');
  await ensureSchema();
  const ev = PER_EVENT[table] && (sp.get('event') || table === 'event_officers') ? await getEvent(db(), sp.get('event')) : null;
  const r = await db().query(TABLES[table](ev), ev ? [ev.id] : []);
  const cols = r.fields.map((f) => f.name);
  const csv = [cols.join(',')].concat(r.rows.map((row) => cols.map((c) => cell(row[c])).join(','))).join('\r\n');
  return { csv: '﻿' + csv, filename: `scam-quiz-${table}${ev ? '-' + ev.id : ''}-${new Date().toISOString().slice(0, 10)}.csv` };
});
