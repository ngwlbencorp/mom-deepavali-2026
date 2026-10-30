const { db, ensureSchema, httpError, route, PUBLIC_COLS } = require('../lib');

const TABLES = {
  claims: `SELECT ${PUBLIC_COLS} FROM scans ORDER BY first_seen`,
  submissions: 'SELECT id, claim_id, attempt, score, total, source, submitted_by, created_at FROM submissions ORDER BY id',
  admins: 'SELECT email, added_at, last_login_at, COALESCE(login_count, 0) AS login_count FROM admins ORDER BY email',
  bugs: `SELECT id, reporter_email, screen, description, status, created_at, fixed_at,
           round(extract(epoch FROM fixed_at - created_at) / 60) AS minutes_to_fix, fix_ref, fix_note,
           (SELECT count(*) FROM bug_screenshots s WHERE s.report_id = r.id) AS screenshots
         FROM bug_reports r ORDER BY id`,
  errors: 'SELECT id, route, message, created_at FROM api_errors ORDER BY id'
};

const cell = (v) => {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

// Superadmin: GET /api/export?table=claims|submissions|admins|bugs|errors -> CSV
module.exports = route(['GET'], 'super', async (req) => {
  const table = new URL(req.url, 'http://x').searchParams.get('table') || 'claims';
  if (!TABLES[table]) throw httpError(400, 'bad_table', 'table must be claims, submissions, admins, bugs or errors');
  await ensureSchema();
  const r = await db().query(TABLES[table]);
  const cols = r.fields.map((f) => f.name);
  const csv = [cols.join(',')].concat(r.rows.map((row) => cols.map((c) => cell(row[c])).join(','))).join('\r\n');
  return { csv: '﻿' + csv, filename: `scam-quiz-${table}-${new Date().toISOString().slice(0, 10)}.csv` };
});
