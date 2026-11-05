// Email alerts (lib/alert.js): a new bug report, a server error (first of a burst only), the test
// endpoint, and a failing email service. Runs its own API server (port 3030), a stand-in for Resend
// (3031) and its own database `alerttest` on the local Postgres, so no real email is sent.
// Usage: node tests/alerts.test.js [postgres base url, default postgres://postgres@localhost:54330]
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { Client } = require('pg');

const PG = process.argv[2] || 'postgres://postgres@localhost:54330';
const API = 'http://127.0.0.1:3030', FAKE_PORT = 3031, KEY = 'test-resend-key-0123456789';
const BUG_TOKEN = 'test-bug-agent-token-0123456789abcdef';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };

const got = [];
let failWith = 0;
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url === '/mode') { failWith = JSON.parse(raw).status || 0; return res.end('{}'); }
    if (failWith) { res.statusCode = failWith; return res.end('{"message":"stand-in failure"}'); }
    got.push({ auth: req.headers.authorization, ...JSON.parse(raw || '{}') });
    res.end('{"id":"r' + got.length + '"}');
  });
});
const call = (method, p, body, token) => fetch(API + p, {
  method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
  body: body ? JSON.stringify(body) : undefined
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const mode = (status) => fetch(`http://127.0.0.1:${FAKE_PORT}/mode`, { method: 'POST', body: JSON.stringify({ status }) });
const PNG = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');

(async () => {
  const admin = new Client({ connectionString: PG + '/postgres' });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS alerttest WITH (FORCE)');
  await admin.query('CREATE DATABASE alerttest');
  await admin.end();
  await new Promise((r) => fake.listen(FAKE_PORT, '127.0.0.1', r));
  const env = {
    ...process.env, DATABASE_URL: PG + '/alerttest', ADMIN_PASSWORD: 'admin-pw-1', SUPERADMIN_USER: 'boss', SUPERADMIN_PASSWORD: 'super-pw-2',
    BUG_API_TOKEN: BUG_TOKEN, RESEND_API_KEY: KEY, BUG_NOTIFY_EMAIL: 'owner@example.test',
    RESEND_API_URL: `http://127.0.0.1:${FAKE_PORT}/emails`
  };
  const server = spawn('node', [path.join(__dirname, 'dev-server.js'), '3030'], { env, stdio: 'inherit' });
  const db = new Client({ connectionString: PG + '/alerttest' });
  try {
    for (let i = 0; i < 40; i++) { try { await fetch(API + '/api/ping'); break; } catch (e) { await new Promise((r) => setTimeout(r, 250)); } }
    await db.connect();
    const SUP = (await call('POST', '/api/login', { role: 'super', username: 'boss', password: 'super-pw-2' })).body.token;
    await call('POST', '/api/admins', { emails: ['officer@example.test'], mode: 'add' }, SUP);
    const ADM = (await call('POST', '/api/login', { role: 'admin', email: 'officer@example.test', password: 'admin-pw-1' })).body.token;

    // 1. A new bug report emails its number only.
    const rep = await call('POST', '/api/bugreport', { description: 'SECRET-TEXT the scan button froze', screenshots: [PNG] }, ADM);
    ok(rep.status === 200 && rep.body.id, 'officer files a bug report');
    const bugMail = got.find((m) => m.subject === `New bug report #${rep.body.id}`);
    ok(!!bugMail && bugMail.auth === 'Bearer ' + KEY && bugMail.to[0] === 'owner@example.test', 'a new bug report emails the owner, with the key and address from the settings');
    ok(!JSON.stringify(got).includes('SECRET-TEXT') && !JSON.stringify(got).includes('officer@'), 'the bug alert carries no report text and no reporter');

    // 2. The test endpoint: superadmin and bug agent only.
    ok((await call('POST', '/api/alerttest', { kind: 'both' })).status === 401, 'test alerts need a login');
    ok((await call('POST', '/api/alerttest', { kind: 'both' }, ADM)).status === 403, 'officers cannot send test alerts');
    ok((await call('POST', '/api/alerttest', { kind: 'nope' }, SUP)).status === 400, 'an unknown kind is refused');
    let n = got.length;
    const t = await call('POST', '/api/alerttest', { kind: 'both' }, SUP);
    const two = got.slice(n);
    ok(t.status === 200 && t.body.bug.sent === true && two.length === 2, `superadmin test sends two alerts (${two.map((m) => m.subject).join(' / ')})`);
    ok(two.some((m) => m.subject === 'New bug report #TEST') && two.some((m) => /^Server error #\d+ on \/api\/alerttest$/.test(m.subject)), 'one bug-report alert and one server-error alert');
    const errMail = two.find((m) => /^Server error/.test(m.subject));
    ok(!/Test alert \(not a real error\)/.test(errMail.text), 'the server-error alert names the route and number only, not the message');
    const row = await db.query("SELECT count(*)::int AS n FROM api_errors WHERE message LIKE 'Test alert (not a real error)%'");
    ok(row.rows[0].n === 1, 'the test error is recorded in the Server errors list');
    n = got.length;
    ok((await call('POST', '/api/alerttest', { kind: 'error' }, BUG_TOKEN)).status === 200 && got.length === n + 1, 'the bug agent token can send a test alert too');

    // 3. A real error: only the first after 15 quiet minutes is emailed.
    await db.query('DELETE FROM api_errors');
    process.env.DATABASE_URL = env.DATABASE_URL; process.env.RESEND_API_KEY = KEY; process.env.BUG_NOTIFY_EMAIL = env.BUG_NOTIFY_EMAIL; process.env.RESEND_API_URL = env.RESEND_API_URL;
    const lib = require(path.join(__dirname, '..', 'lib', 'lib.js'));
    const req = { url: '/api/redeem', headers: {} };
    n = got.length;
    await lib.logError(req, new Error('first failure'));
    ok(got.length === n + 1 && got[n].subject.endsWith('on /api/redeem'), 'the first server error after a quiet spell is emailed');
    await lib.logError(req, new Error('second failure'));
    await lib.logError({ url: '/api/scan', headers: {} }, new Error('third failure'));
    const logged = await db.query('SELECT count(*)::int AS n FROM api_errors');
    ok(got.length === n + 1 && logged.rows[0].n === 3, 'later errors in the burst are recorded but not emailed');

    // 4. A failing email service: recorded once, never a loop.
    await db.query('DELETE FROM api_errors');
    await mode(500);
    n = got.length;
    const f = await call('POST', '/api/alerttest', { kind: 'both' }, SUP);
    ok(f.status === 200 && f.body.bug.sent === false && /HTTP 500/.test(f.body.bug.reason), 'a failed bug alert is reported to the superadmin');
    const fails2 = await db.query("SELECT message FROM api_errors ORDER BY id");
    ok(fails2.rows.length === 2 && /^Email alert not sent: Resend answered HTTP 500/.test(fails2.rows[1].message), 'a failed server-error alert is recorded once, with no loop (' + fails2.rows.length + ' rows)');
    await mode(0);
    await lib.db().end();
  } finally {
    server.kill(); fake.close(); await db.end().catch(() => {});
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
