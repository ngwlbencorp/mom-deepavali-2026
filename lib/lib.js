// Shared helpers for the API routes (lib/routes/*.js, all served by the single function api/index.js).
// Env vars (set in the Vercel dashboard, never in code):
//   DATABASE_URL         Neon POOLED connection string (host contains "-pooler", sslmode=require)
//   ADMIN_PASSWORD       shared password for every admin (admins log in with their work email)
//   SUPERADMIN_USER      superadmin login ID
//   SUPERADMIN_PASSWORD  superadmin password (must differ from ADMIN_PASSWORD)
//   REDEEM_CAP           read once, when the events table is first created: the 8 Nov event's cap
//                        (fallback 502). After that each event's cap lives in events.souvenir_cap.
//   (EVENT_END no longer governs anything: each event's times live in the events table.)
//   SESSION_SECRET       optional; signs login tokens. If unset, derived from the passwords,
//                        so changing a password also logs everyone out.
//   ALLOWED_ORIGINS      optional comma-separated list; if unset, any Origin is reflected
//   BUG_API_TOKEN        optional; a long random secret that lets a bug-fixing agent read bug reports
//                        and record fixes (and nothing else). Unset = only the superadmin can.
//   RESEND_API_KEY, BUG_NOTIFY_EMAIL   optional; when both are set, each new bug report sends a short
//                        email (report number only) through Resend. BUG_NOTIFY_FROM
//                        overrides the sender (default onboarding@resend.dev).
//   POSTMAN_API_KEY      optional; lets the superadmin email officers through Postman (lib/routes/notify.js).
//   MINISITE_URL, OFFICER_SITE_URL, ADMIN_CONTACT   the mini-site and officer page addresses, and who
//                        to contact on Slack, put into those emails (kept out of this public repo).
//   POSTMAN_API_URL      optional; overrides Postman's send address (tests use a local stand-in).

const crypto = require('crypto');
const { Pool } = require('pg');
const payload = require('../js/payload.js');

const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ID_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const SESSION_HOURS = 14;

let pool;
function db() {
  if (!process.env.DATABASE_URL) throw httpError(500, 'server_misconfigured', 'DATABASE_URL is not set');
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 10000 });
  return pool;
}

// scans: one row per claim ID. The first eight columns are the original table; the rest were
// added for self-registration, admin-assisted claims and reporting.
let schemaReady;
// Every column and index the setup below creates. A new server instance first checks these in the
// catalog (no table locks) and skips the setup when all exist. Why: the setup's ALTER TABLE takes
// an exclusive lock even when nothing changes, and a cold start deadlocked against a dashboard
// query that reads two tables (5 Nov). tests/api.test.js checks this list against a fresh database,
// so a column added to the setup but not here fails the tests.
const SCHEMA = {
  scans: ['id', 'score', 'total', 'station', 'first_seen', 'last_seen', 'redeemed_at', 'redeemed_station', 'source',
    'device_key_hash', 'attempts', 'first_full', 'csat', 'learned', 'created_by', 'language', 'stories_viewed', 'manual_reason'],
  submissions: ['id', 'claim_id', 'attempt', 'score', 'total', 'source', 'submitted_by', 'created_at', 'language', 'item_scores'],
  admins: ['email', 'added_at', 'last_login_at', 'login_count', 'welcome_sent_at', 'reminder_sent_at'],
  bug_reports: ['id', 'reporter_email', 'screen', 'description', 'status', 'created_at', 'fixed_at', 'fix_ref', 'fix_note'],
  bug_screenshots: ['id', 'report_id', 'image', 'mime_type', 'created_at'],
  api_errors: ['id', 'route', 'message', 'created_at'],
  events: ['id', 'name', 'starts_at', 'ends_at', 'souvenir_cap', 'test_cleared_at', 'theme'],
  event_officers: ['event_id', 'email', 'added_at', 'reminder_sent_at']
};
SCHEMA.scans.push('event_id');
SCHEMA.submissions.push('event_id');
const SCHEMA_INDEXES = ['submissions_created_at', 'bug_screenshots_report'];
async function schemaCurrent(client) {
  const pairs = Object.entries(SCHEMA).flatMap(([t, cols]) => cols.map((c) => t + '.' + c));
  const { rows } = await client.query(
    `SELECT (SELECT count(*) FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name || '.' || column_name = ANY($1))::int AS cols,
            (SELECT count(*) FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ANY($2))::int AS idx`,
    [pairs, SCHEMA_INDEXES]);
  return rows[0].cols === pairs.length && rows[0].idx === SCHEMA_INDEXES.length;
}
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = await db().connect();
      try {
        if (await schemaCurrent(client)) return;
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(7001)'); // concurrent cold starts must not race the DDL
        // Wait at most a few seconds for a table lock: if a query holds one, give up and let the next
        // request try again, rather than queue every request behind this one (5 Nov deadlock).
        await client.query("SET LOCAL lock_timeout = '4s'");
        if (await schemaCurrent(client)) { await client.query('COMMIT'); return; } // another instance just did it
        await client.query(`
          CREATE TABLE IF NOT EXISTS scans (
            id text PRIMARY KEY,
            score int,
            total int,
            station text,
            first_seen timestamptz DEFAULT now(),
            last_seen timestamptz,
            redeemed_at timestamptz,
            redeemed_station text
          );
          ALTER TABLE scans
            ADD COLUMN IF NOT EXISTS source text,
            ADD COLUMN IF NOT EXISTS device_key_hash text,
            ADD COLUMN IF NOT EXISTS attempts int,
            ADD COLUMN IF NOT EXISTS first_full int,
            ADD COLUMN IF NOT EXISTS csat int,
            ADD COLUMN IF NOT EXISTS learned text,
            ADD COLUMN IF NOT EXISTS created_by text,
            ADD COLUMN IF NOT EXISTS language text,
            ADD COLUMN IF NOT EXISTS stories_viewed int,
            ADD COLUMN IF NOT EXISTS manual_reason text;
          CREATE TABLE IF NOT EXISTS submissions (
            id bigserial PRIMARY KEY,
            claim_id text NOT NULL,
            attempt int,
            score int,
            total int,
            source text,
            submitted_by text,
            created_at timestamptz DEFAULT now()
          );
          ALTER TABLE submissions
            ADD COLUMN IF NOT EXISTS language text,
            ADD COLUMN IF NOT EXISTS item_scores text;
          CREATE INDEX IF NOT EXISTS submissions_created_at ON submissions (created_at);
          CREATE TABLE IF NOT EXISTS admins (
            email text PRIMARY KEY,
            added_at timestamptz DEFAULT now()
          );
          ALTER TABLE admins
            ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
            ADD COLUMN IF NOT EXISTS login_count int DEFAULT 0,
            ADD COLUMN IF NOT EXISTS welcome_sent_at timestamptz,
            ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;
          CREATE TABLE IF NOT EXISTS bug_reports (
            id bigserial PRIMARY KEY,
            reporter_email text,
            screen text,
            description text,
            status text DEFAULT 'new',
            created_at timestamptz DEFAULT now(),
            fixed_at timestamptz,
            fix_ref text,
            fix_note text
          );
          CREATE TABLE IF NOT EXISTS bug_screenshots (
            id bigserial PRIMARY KEY,
            report_id bigint REFERENCES bug_reports (id) ON DELETE CASCADE,
            image bytea,
            mime_type text,
            created_at timestamptz DEFAULT now()
          );
          CREATE INDEX IF NOT EXISTS bug_screenshots_report ON bug_screenshots (report_id);
          CREATE TABLE IF NOT EXISTS api_errors (
            id bigserial PRIMARY KEY,
            route text,
            message text,
            created_at timestamptz DEFAULT now()
          );
          CREATE TABLE IF NOT EXISTS events (
            id text PRIMARY KEY,
            name text NOT NULL,
            starts_at timestamptz NOT NULL,
            ends_at timestamptz NOT NULL,
            souvenir_cap int,
            test_cleared_at timestamptz,
            theme text NOT NULL DEFAULT 'neutral' CHECK (theme IN ('deepavali', 'neutral', 'christmas'))
          );
          CREATE TABLE IF NOT EXISTS event_officers (
            event_id text NOT NULL REFERENCES events (id),
            email text NOT NULL,
            added_at timestamptz DEFAULT now(),
            reminder_sent_at timestamptz,
            PRIMARY KEY (event_id, email)
          );`);
        // Multi-event (owner, 18 Nov). Added last, so the catalog check above finds them only once
        // the backfill below has run in the same transaction.
        await client.query('ALTER TABLE scans ADD COLUMN IF NOT EXISTS event_id text');
        await client.query('ALTER TABLE submissions ADD COLUMN IF NOT EXISTS event_id text');
        await backfill(client);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

// ---------- events (owner, 18 Nov) ----------
// The 8 Nov event is history; three more follow, each 5 pm to 9 pm Singapore time. Rows are
// created once, by the setup above; the owner then sets each cap, name and theme on the
// superadmin page. Every value already in scans, submissions and admins stays as it was: the
// backfill only fills the new event_id with the 8 Nov event and copies the officer list.
const PAST_EVENT = '2026-11-08';
const SEED_EVENTS = [
  { id: '2026-11-08', name: '8 Nov 2026', day: '2026-11-08', theme: 'deepavali' },
  { id: '2026-11-22', name: '22 Nov 2026', day: '2026-11-22', theme: 'neutral' },
  { id: '2026-12-06', name: '6 Dec 2026', day: '2026-12-06', theme: 'neutral' },
  { id: '2026-12-25', name: '25 Dec 2026', day: '2026-12-25', theme: 'christmas' }
];
async function backfill(client) {
  const n = parseInt(process.env.REDEEM_CAP, 10);
  const pastCap = Number.isFinite(n) && n >= 0 ? n : 502;
  for (const e of SEED_EVENTS) {
    await client.query(
      `INSERT INTO events (id, name, starts_at, ends_at, souvenir_cap, theme) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [e.id, e.name, e.day + 'T17:00:00+08:00', e.day + 'T21:00:00+08:00', e.id === PAST_EVENT ? pastCap : null, e.theme]);
  }
  await client.query('UPDATE scans SET event_id = $1 WHERE event_id IS NULL', [PAST_EVENT]);
  await client.query('UPDATE submissions SET event_id = $1 WHERE event_id IS NULL', [PAST_EVENT]);
  await client.query(
    `INSERT INTO event_officers (event_id, email, added_at, reminder_sent_at)
     SELECT $1, email, added_at, reminder_sent_at FROM admins ON CONFLICT DO NOTHING`, [PAST_EVENT]);
}

// QR codes and souvenir wording show from 5 days before an event starts until it ends (owner).
const WINDOW_DAYS = 5;
const THEMES = ['deepavali', 'neutral', 'christmas'];
function eventInfo(e, now = Date.now()) {
  if (!e) return null;
  const starts = new Date(e.starts_at).getTime(), ends = new Date(e.ends_at).getTime();
  return {
    id: e.id, name: e.name, startsAt: new Date(starts).toISOString(), endsAt: new Date(ends).toISOString(),
    opensAt: new Date(starts - WINDOW_DAYS * 864e5).toISOString(),
    cap: e.souvenir_cap == null ? null : Number(e.souvenir_cap), theme: e.theme,
    testClearedAt: e.test_cleared_at ? new Date(e.test_cleared_at).toISOString() : null,
    open: now >= starts - WINDOW_DAYS * 864e5 && now < ends, ended: now >= ends, started: now >= starts
  };
}
async function listEvents(q) {
  await ensureSchema();
  const { rows } = await q.query('SELECT * FROM events ORDER BY starts_at, id');
  return rows.map((e) => eventInfo(e));
}
// The event whose window is open now (the one ending first if two overlap), or null.
async function currentEvent(q) {
  return (await listEvents(q)).filter((e) => e.open).sort((a, b) => a.endsAt.localeCompare(b.endsAt))[0] || null;
}
// For staff pages: the current event, else the next one, else the latest past one.
async function focusEvent(q) {
  const all = await listEvents(q), now = new Date().toISOString();
  return all.filter((e) => e.open).sort((a, b) => a.endsAt.localeCompare(b.endsAt))[0]
    || all.filter((e) => e.startsAt > now)[0] || all[all.length - 1] || null;
}
async function getEvent(q, id) {
  if (!id) return focusEvent(q);
  const ev = (await listEvents(q)).find((e) => e.id === String(id));
  if (!ev) throw httpError(404, 'unknown_event', 'No such event');
  return ev;
}
// Redemptions and manual claims need an open window; the server decides, whatever a phone's clock says.
async function requireCurrent(q) {
  const ev = await currentEvent(q);
  if (!ev) throw httpError(403, 'event_closed', 'No event is open now. Souvenirs can no longer be given.');
  return ev;
}
// Once an event has ended its data is locked: no writes of any kind for it.
function requireNotEnded(ev) {
  if (ev.ended) throw httpError(403, 'event_frozen', 'This event has ended. Its data is locked and cannot be changed.');
}

// "Clear test data" (events.test_cleared_at) hides, never deletes. For an event: a claim counts if
// anything happened to it at or after the clear (created, saved again, scanned or redeemed); a
// souvenir counts if it was given at or after the clear; an attempt if it was saved at or after.
// These are SQL conditions on scans (s) or submissions (b) joined with events (e).
const VIS = {
  claim: "(e.test_cleared_at IS NULL OR GREATEST(s.first_seen, s.last_seen, s.redeemed_at) >= e.test_cleared_at)",
  given: "(s.redeemed_at IS NOT NULL AND (e.test_cleared_at IS NULL OR s.redeemed_at >= e.test_cleared_at))",
  attempt: "(e.test_cleared_at IS NULL OR b.created_at >= e.test_cleared_at)"
};

function httpError(status, code, message) {
  const e = new Error(message || code);
  e.status = status;
  e.code = code;
  return e;
}

function newId() {
  const b = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += ID_ALPHABET[b[i] % 32];
  return out;
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sha256hex = (s) => sha256(s).toString('hex');
function same(a, b) { return crypto.timingSafeEqual(sha256(a), sha256(b)); }

// ---------- login tokens (HMAC-signed, sent as "Authorization: Bearer ...") ----------
function secret() {
  const e = process.env;
  return e.SESSION_SECRET || sha256hex('scamsite|' + (e.ADMIN_PASSWORD || '') + '|' + (e.SUPERADMIN_PASSWORD || '') + '|' + (e.DATABASE_URL || ''));
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function signToken(role, user) {
  const body = b64u(JSON.stringify({ r: role, u: user, x: Date.now() + SESSION_HOURS * 3600e3 }));
  return body + '.' + b64u(crypto.createHmac('sha256', secret()).update(body).digest());
}
function readToken(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+([\w-]+)\.([\w-]+)$/);
  if (!m) return null;
  const expect = b64u(crypto.createHmac('sha256', secret()).update(m[1]).digest());
  if (!same(expect, m[2])) return null;
  try {
    const t = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
    return t.x > Date.now() ? t : null;
  } catch (e) { return null; }
}

// role "admin" also accepts the superadmin, so the superadmin can test the scanner.
// role "bugs" accepts the superadmin, or the BUG_API_TOKEN secret (the bug-fixing agent).
async function requireRole(req, role) {
  const bugToken = (process.env.BUG_API_TOKEN || '').trim(); // a pasted value often carries a line break
  if (role === 'bugs' && bugToken && bugToken.length >= 32) {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/);
    if (m && same(m[1], bugToken)) return { role: 'bot', user: 'bug-agent' };
  }
  const t = readToken(req);
  if (!t) throw httpError(401, 'login_required', 'Please log in again');
  if (t.r === 'super') return { role: 'super', user: 'superadmin' };
  if (role === 'super' || role === 'bugs' || t.r !== 'admin') throw httpError(403, 'forbidden', 'Not allowed for this login');
  await ensureSchema();
  const { rowCount } = await db().query('SELECT 1 FROM admins WHERE email = $1', [t.u]);
  if (!rowCount) throw httpError(401, 'login_required', 'This admin login has been removed');
  return { role: 'admin', user: t.u };
}

// ---------- HTTP plumbing ----------
// CORS headers go on every response, including errors, so the browser shows the real error
// instead of "Failed to fetch".
function cors(req, res) {
  const origin = req.headers.origin;
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origin && (!allowed.length || allowed.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'content-type, authorization');
  res.setHeader('Access-Control-Max-Age', '600');
}

function send(res, status, body, type, cache) {
  res.statusCode = status;
  res.setHeader('Cache-Control', cache || 'no-store');
  if (type) { res.setHeader('Content-Type', type); return res.end(body); }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body; // Vercel parses JSON bodies
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 3e6) throw httpError(413, 'too_large', 'Body too large'); // bug reports carry up to 3 screenshots; Vercel's own limit is 4.5 MB
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

// Unexpected server errors go to the api_errors table, so whoever fixes bugs can see them
// (tools/bugs.js errors; superadmin Bug log). Only the route, the error and where in the code it
// happened: never request data. The same error is recorded at most once a minute per instance.
const lastLogged = new Map();
// Records an unexpected error in api_errors and emails the owner when it starts a burst: the
// first error after 15 minutes without any. Later errors in the burst are only recorded, so a
// broken route cannot flood the inbox. The email names the route and error number only; the
// message stays in the database (it can hold database values). An alert that fails is recorded
// directly, never through logError again, so a broken email setup cannot loop.
// opts.alwaysAlert: email even inside a burst (the superadmin's test alert).
const ALERT_QUIET_MIN = 15;
async function logError(req, e, opts = {}) {
  try {
    const url = new URL(req.url, 'http://x');
    const routeName = (url.searchParams.get('route') || (url.pathname.match(/^\/api\/([a-z]+)/) || [])[1] || url.pathname).slice(0, 40);
    const where = (String(e.stack || '').split('\n').find((l) => /\/(lib|api)\//.test(l) && !/node_modules/.test(l)) || '').replace(/^.*?((lib|api)\/[^)]*).*$/, '$1');
    const message = ((e.code ? '[' + e.code + '] ' : '') + String(e.message || e) + (where ? ' at ' + where : '')).slice(0, 1000);
    const key = routeName + '|' + message, now = Date.now();
    if (now - (lastLogged.get(key) || 0) < 60000) return;
    lastLogged.set(key, now);
    if (lastLogged.size > 200) lastLogged.clear();
    await ensureSchema();
    const { rows } = await db().query(
      `WITH recent AS (SELECT count(*) AS n FROM api_errors WHERE created_at > now() - make_interval(mins => $3))
       INSERT INTO api_errors (route, message) VALUES ($1, $2) RETURNING id, (SELECT n FROM recent)::int AS recent`,
      [routeName, message, ALERT_QUIET_MIN]);
    const isAlertFailure = /^Email alert not sent/.test(message);
    if (isAlertFailure || !(opts.alwaysAlert || rows[0].recent === 0)) return;
    const { sendAlert } = require('./alert');
    const r = await sendAlert(`Server error #${rows[0].id} on /api/${routeName}`,
      `Server error #${rows[0].id} on /api/${routeName} at ${new Date().toISOString()} (UTC). ` +
      `Any more errors in the next ${ALERT_QUIET_MIN} minutes are recorded but not emailed. ` +
      'Details are in the superadmin page, Server errors card.');
    if (!r.sent && r.reason !== 'off') {
      await db().query('INSERT INTO api_errors (route, message) VALUES ($1, $2)', [routeName, ('Email alert not sent: ' + r.reason).slice(0, 1000)]);
    }
  } catch (x) { console.error('could not record the error', x.message); } // e.g. the database itself is down
}

// Wraps a route: CORS, OPTIONS 204, method check, optional role check, error mapping.
// fn(req, body, who) returns a JSON-able object, or { csv, filename } for a CSV download.
function route(methods, role, fn) {
  return async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    try {
      if (!methods.includes(req.method)) throw httpError(405, 'method_not_allowed');
      let body = {};
      if (req.method === 'POST') {
        try { body = await readBody(req); } catch (e) { throw e.status ? e : httpError(400, 'bad_json', 'Body must be JSON'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'bad_json', 'Body must be a JSON object');
      }
      const who = role ? await requireRole(req, role) : null;
      const out = await fn(req, body, who);
      if (out && out._cache) { // opt-in CDN caching for public, non-personal responses
        const cache = out._cache;
        delete out._cache;
        return send(res, 200, out, null, cache);
      }
      if (out && out.binary) return send(res, 200, out.binary, out.type); // e.g. a bug screenshot (not cached)
      if (out && out.csv !== undefined) {
        res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
        return send(res, 200, out.csv, 'text/csv; charset=utf-8');
      }
      send(res, 200, out);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) { console.error(e); await logError(req, e); }
      // Only errors we raised on purpose (httpError) explain themselves. Anything unexpected, e.g. a
      // database error, says "Server error": its details (hosts, SQL) stay in api_errors.
      const ours = !!e.status;
      send(res, status, { error: ours ? e.code || 'server_error' : 'server_error', message: ours ? e.message : 'Server error' });
    }
  };
}

// One event's souvenir counts (never another event's), computed inside whatever client or
// transaction is passed in. cap is null until the owner sets it; then nothing can be redeemed.
async function stats(q, ev) {
  const { rows } = await q.query(
    `SELECT count(*) FILTER (WHERE ${VIS.given}) AS given,
            count(s.id) FILTER (WHERE ${VIS.claim}) AS claims,
            (SELECT count(*) FROM submissions b JOIN events e ON e.id = b.event_id WHERE b.event_id = $1 AND ${VIS.attempt}) AS submissions
     FROM events e LEFT JOIN scans s ON s.event_id = e.id
     WHERE e.id = $1`, [ev.id]
  );
  const limit = ev.cap, given = Number(rows[0].given);
  return {
    given, capRemaining: limit == null ? null : Math.max(0, limit - given), cap: limit,
    uniqueClaims: Number(rows[0].claims), submissions: Number(rows[0].submissions),
    event: { id: ev.id, name: ev.name, startsAt: ev.startsAt, endsAt: ev.endsAt, open: ev.open, ended: ev.ended }
  };
}

// Whether the phone that holds this device key hash, or any of the claim IDs it held before,
// was given a souvenir at another event (owner, 18 Nov: one souvenir per phone across events).
async function redeemedBefore(q, hash, eventId, prevIds) {
  if (!hash && !(prevIds && prevIds.length)) return false;
  const { rows } = await q.query(
    `SELECT 1 FROM scans s JOIN events e ON e.id = s.event_id
     WHERE s.event_id IS DISTINCT FROM $2 AND ${VIS.given}
       AND ((s.device_key_hash = $1 AND $1 IS NOT NULL) OR s.id = ANY($3::text[])) LIMIT 1`,
    [hash || null, eventId, prevIds || []]);
  return rows.length > 0;
}

// Runs fn(client) in a transaction holding the global redemption lock, so cap checks
// and redemptions never interleave across stations.
const REDEEM_LOCK = 26102026;
async function withRedeemLock(fn) {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [REDEEM_LOCK]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Gives a souvenir for an eligible, unredeemed row of the current event ev (already locked by
// withRedeemLock). Statuses: given | already | not_eligible | unknown_id | other_event |
// redeemed_before | cap_not_set | cap_reached.
async function redeemLocked(client, id, by, ev) {
  const found = await client.query('SELECT id, score, total, redeemed_at, redeemed_station, event_id, device_key_hash FROM scans WHERE id = $1', [id]);
  if (!found.rowCount) return { status: 'unknown_id' };
  const { device_key_hash: hash, ...row } = found.rows[0];
  if (row.event_id !== ev.id) return { status: 'other_event', record: row };
  if (row.redeemed_at) return { status: 'already', record: row };
  if (!(row.total > 0 && row.score === row.total)) return { status: 'not_eligible', record: row };
  if (await redeemedBefore(client, hash, ev.id)) return { status: 'redeemed_before', record: row };
  if (ev.cap == null) return { status: 'cap_not_set' };
  if ((await stats(client, ev)).given >= ev.cap) return { status: 'cap_reached' };
  const upd = await client.query(
    `UPDATE scans SET redeemed_at = now(), redeemed_station = $2
     WHERE id = $1 AND redeemed_at IS NULL
     RETURNING id, score, total, redeemed_at, redeemed_station`,
    [id, by]
  );
  return upd.rowCount ? { status: 'given', record: upd.rows[0] } : { status: 'already' };
}

// Columns safe to return to clients (never the device key hash).
const PUBLIC_COLS = 'id, source, score, total, attempts, first_full, csat, learned, language, stories_viewed, manual_reason, station, created_by, first_seen, last_seen, redeemed_at, redeemed_station, event_id';

module.exports = {
  SCHEMA, SCHEMA_INDEXES,
  db, ensureSchema, httpError, PAST_EVENT, SEED_EVENTS, WINDOW_DAYS, THEMES, VIS, eventInfo, listEvents, currentEvent, focusEvent,
  getEvent, requireCurrent, requireNotEnded, redeemedBefore, backfill, route, payload, newId, ID_RE, sha256hex, same,
  signToken, stats, withRedeemLock, redeemLocked, PUBLIC_COLS, logError
};
