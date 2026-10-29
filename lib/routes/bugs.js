const { db, ensureSchema, httpError, route } = require('../lib');

// Superadmin or the bug-fixing agent (BUG_API_TOKEN).
// GET  /api/bugs[?status=new][&since=<id>] -> { reports: [{ id, reporter_email, screen, description,
//      status, created_at, fixed_at, fix_ref, fix_note, screenshots: [ids] }] }, newest first
// POST /api/bugs { id, status, fix_ref?, fix_note? } -> { report }. Setting status "fixed" stamps
//      fixed_at (once); moving away from "fixed" clears it.
const STATUSES = ['new', 'in_progress', 'needs_decision', 'fixed', 'wont_fix', 'duplicate'];
const COLS = `r.id, r.reporter_email, r.screen, r.description, r.status, r.created_at, r.fixed_at, r.fix_ref, r.fix_note,
  COALESCE((SELECT array_agg(s.id ORDER BY s.id) FROM bug_screenshots s WHERE s.report_id = r.id), '{}') AS screenshots`;
const tidy = (r) => ({ ...r, id: Number(r.id), screenshots: r.screenshots.map(Number) });

module.exports = route(['GET', 'POST'], 'bugs', async (req, body) => {
  await ensureSchema();
  if (req.method === 'GET') {
    const q = new URL(req.url, 'http://x').searchParams, where = [], args = [];
    const status = q.get('status'), since = q.get('since');
    if (status) { if (!STATUSES.includes(status)) throw httpError(400, 'bad_status', 'Unknown status'); args.push(status); where.push(`r.status = $${args.length}`); }
    if (since) { if (!/^\d+$/.test(since)) throw httpError(400, 'bad_since', 'since must be a report number'); args.push(since); where.push(`r.id > $${args.length}`); }
    const r = await db().query(`SELECT ${COLS} FROM bug_reports r ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.id DESC LIMIT 500`, args);
    return { statuses: STATUSES, reports: r.rows.map(tidy) };
  }
  const id = String(body.id || '');
  if (!/^\d+$/.test(id)) throw httpError(400, 'bad_id', 'id must be a report number');
  if (!STATUSES.includes(body.status)) throw httpError(400, 'bad_status', 'status must be one of ' + STATUSES.join(', '));
  const ref = body.fix_ref === undefined ? null : String(body.fix_ref).slice(0, 100);
  const note = body.fix_note === undefined ? null : String(body.fix_note).slice(0, 1000);
  const r = await db().query(
    `UPDATE bug_reports SET status = $2,
       fixed_at = CASE WHEN $2 = 'fixed' THEN COALESCE(fixed_at, now()) ELSE NULL END,
       fix_ref = COALESCE($3, fix_ref), fix_note = COALESCE($4, fix_note)
     WHERE id = $1 RETURNING id`, [id, body.status, ref, note]);
  if (!r.rowCount) throw httpError(404, 'unknown_report', 'No such report');
  const row = await db().query(`SELECT ${COLS} FROM bug_reports r WHERE r.id = $1`, [id]);
  return { report: tidy(row.rows[0]) };
});
