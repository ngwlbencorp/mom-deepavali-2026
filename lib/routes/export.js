const { db, ensureSchema, httpError, route, PUBLIC_COLS } = require('../lib');

const TABLES = {
  claims: `SELECT ${PUBLIC_COLS} FROM scans ORDER BY first_seen`,
  submissions: 'SELECT id, claim_id, attempt, score, total, source, submitted_by, created_at FROM submissions ORDER BY id',
  admins: 'SELECT email, added_at FROM admins ORDER BY email'
};

const cell = (v) => {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

// Superadmin: GET /api/export?table=claims|submissions|admins -> CSV
module.exports = route(['GET'], 'super', async (req) => {
  const table = new URL(req.url, 'http://x').searchParams.get('table') || 'claims';
  if (!TABLES[table]) throw httpError(400, 'bad_table', 'table must be claims, submissions or admins');
  await ensureSchema();
  const r = await db().query(TABLES[table]);
  const cols = r.fields.map((f) => f.name);
  const csv = [cols.join(',')].concat(r.rows.map((row) => cols.map((c) => cell(row[c])).join(','))).join('\r\n');
  return { csv: '﻿' + csv, filename: `scam-quiz-${table}-${new Date().toISOString().slice(0, 10)}.csv` };
});
