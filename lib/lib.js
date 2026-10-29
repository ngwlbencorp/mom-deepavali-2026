// Shared helpers for the API routes (lib/routes/*.js, all served by the single function api/index.js).
// Env vars (set in the Vercel dashboard, never in code):
//   DATABASE_URL         Neon POOLED connection string (host contains "-pooler", sslmode=require)
//   ADMIN_PASSWORD       shared password for every admin (admins log in with their work email)
//   SUPERADMIN_USER      superadmin login ID
//   SUPERADMIN_PASSWORD  superadmin password (must differ from ADMIN_PASSWORD)
//   REDEEM_CAP           global souvenir cap (default 500)
//   EVENT_END            when souvenir redemption closes, ISO 8601 (default 2026-11-08T21:00:00+08:00)
//   SESSION_SECRET       optional; signs login tokens. If unset, derived from the passwords,
//                        so changing a password also logs everyone out.
//   ALLOWED_ORIGINS      optional comma-separated list; if unset, any Origin is reflected
//   BUG_API_TOKEN        optional; a long random secret that lets a bug-fixing agent read bug reports
//                        and record fixes (and nothing else). Unset = only the superadmin can.
//   RESEND_API_KEY, BUG_NOTIFY_EMAIL   optional; when both are set, each new bug report sends a short
//                        email (report number only) through Resend. BUG_NOTIFY_FROM
//                        overrides the sender (default onboarding@resend.dev).

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
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = await db().connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(7001)'); // concurrent cold starts must not race the DDL
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
            ADD COLUMN IF NOT EXISTS created_by text;
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
          CREATE INDEX IF NOT EXISTS submissions_created_at ON submissions (created_at);
          CREATE TABLE IF NOT EXISTS admins (
            email text PRIMARY KEY,
            added_at timestamptz DEFAULT now()
          );
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
          );`);
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

const DEFAULT_EVENT_END = '2026-11-08T21:00:00+08:00';
function eventEnd() {
  const t = Date.parse(process.env.EVENT_END || DEFAULT_EVENT_END);
  return Number.isFinite(t) ? t : Date.parse(DEFAULT_EVENT_END);
}
function eventOpen() { return Date.now() < eventEnd(); }
// Redemption is refused once the event has ended, whatever the phone's clock says.
function requireOpen() {
  if (!eventOpen()) throw httpError(403, 'event_closed', 'The event has ended. Souvenirs can no longer be given.');
}

function cap() {
  const n = parseInt(process.env.REDEEM_CAP, 10);
  return Number.isFinite(n) && n >= 0 ? n : 500;
}

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
  const bugToken = process.env.BUG_API_TOKEN;
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
async function logError(req, e) {
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
    await db().query('INSERT INTO api_errors (route, message) VALUES ($1, $2)', [routeName, message]);
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
      send(res, status, { error: e.code || 'server_error', message: status >= 500 && !e.code ? 'Server error' : e.message });
    }
  };
}

// Global souvenir counts, computed inside whatever client/transaction is passed in.
async function stats(q) {
  const { rows } = await q.query(
    `SELECT count(*) FILTER (WHERE redeemed_at IS NOT NULL) AS given,
            count(*) AS claims,
            (SELECT count(*) FROM submissions) AS submissions
     FROM scans`
  );
  const limit = cap(), given = Number(rows[0].given);
  return { given, capRemaining: Math.max(0, limit - given), cap: limit, uniqueClaims: Number(rows[0].claims), submissions: Number(rows[0].submissions) };
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

// Gives a souvenir for an eligible, unredeemed row (already locked by withRedeemLock).
async function redeemLocked(client, id, by) {
  const found = await client.query('SELECT id, score, total, redeemed_at, redeemed_station FROM scans WHERE id = $1', [id]);
  if (!found.rowCount) return { status: 'unknown_id' };
  const row = found.rows[0];
  if (row.redeemed_at) return { status: 'already', record: row };
  if (!(row.total > 0 && row.score === row.total)) return { status: 'not_eligible', record: row };
  if ((await stats(client)).given >= cap()) return { status: 'cap_reached' };
  const upd = await client.query(
    `UPDATE scans SET redeemed_at = now(), redeemed_station = $2
     WHERE id = $1 AND redeemed_at IS NULL
     RETURNING id, score, total, redeemed_at, redeemed_station`,
    [id, by]
  );
  return upd.rowCount ? { status: 'given', record: upd.rows[0] } : { status: 'already' };
}

// Columns safe to return to clients (never the device key hash).
const PUBLIC_COLS = 'id, source, score, total, attempts, first_full, csat, learned, station, created_by, first_seen, last_seen, redeemed_at, redeemed_station';

module.exports = {
  db, ensureSchema, cap, eventEnd, eventOpen, requireOpen, httpError, route, payload, newId, ID_RE, sha256hex, same,
  signToken, stats, withRedeemLock, redeemLocked, PUBLIC_COLS
};
