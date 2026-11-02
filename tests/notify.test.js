// Officer emails through Postman (lib/routes/notify.js), against a local stand-in for Postman.
// Starts its own API server (port 3020) and stand-in (3021) on its own database "notifytest",
// so it never touches the data the other tests use. Needs the local Postgres from local-stack.sh.
// Usage: node tests/notify.test.js [postgres base url, default postgres://postgres@localhost:54330]
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { Client } = require('pg');

const PG = process.argv[2] || 'postgres://postgres@localhost:54330';
const API = 'http://127.0.0.1:3020', FAKE_PORT = 3021, KEY = 'test-postman-key-0123456789';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };

// The stand-in records every email; an address starting "fail" gets a 500; /mode sets a status for all.
const got = [];
let forceStatus = 0, delayMs = 60, listCalls = 0;
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.method === 'GET') {  // List emails: newest first, created_at[gte], limit, offset, has_more
      const u = new URL(req.url, 'http://x');
      if (u.pathname !== '/v1/transactional/email' || req.headers.authorization !== 'Bearer ' + KEY) { res.statusCode = 401; return res.end('{}'); }
      const gte = u.searchParams.get('created_at[gte]'), limit = Math.min(10, +u.searchParams.get('limit') || 10), offset = +u.searchParams.get('offset') || 0;
      const all = got.map((m, i) => ({ id: i + 1, recipient: m.recipient, status: /^bounce/.test(m.recipient) ? 'BOUNCED' : 'DELIVERED',
        error_code: /^bounce/.test(m.recipient) ? 'Blacklisted recipeint' : null, error_sub_type: /^bounce/.test(m.recipient) ? 'Hard Bounce' : null, created_at: m.at }))
        .filter((m) => !gte || m.created_at >= gte).reverse();
      listCalls++;
      return res.end(JSON.stringify({ has_more: offset + limit < all.length, data: all.slice(offset, offset + limit) }));
    }
    if (req.url === '/mode') { const m = JSON.parse(raw); forceStatus = m.status || 0; delayMs = m.delay || 60; return res.end('{}'); }
    const b = JSON.parse(raw || '{}');
    setTimeout(() => {
      if (forceStatus) { res.statusCode = forceStatus; return res.end(JSON.stringify({ message: 'forced for ' + b.recipient })); }
      if (/^fail/.test(b.recipient)) { res.statusCode = 500; return res.end('{"message":"stand-in failure"}'); }
      got.push({ auth: req.headers.authorization, at: new Date().toISOString(), ...b });
      res.statusCode = 201; res.end(JSON.stringify({ id: 'e' + got.length }));
    }, delayMs);
  });
});

const call = (method, p, body, token) => fetch(API + p, {
  method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
  body: body ? JSON.stringify(body) : undefined
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const mode = (status, delay) => fetch(`http://127.0.0.1:${FAKE_PORT}/mode`, { method: 'POST', body: JSON.stringify({ status, delay }) });

(async () => {
  const admin = new Client({ connectionString: PG + '/postgres' });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS notifytest');
  await admin.query('CREATE DATABASE notifytest');
  await admin.end();
  await new Promise((r) => fake.listen(FAKE_PORT, '127.0.0.1', r));
  const env = {
    ...process.env, DATABASE_URL: PG + '/notifytest', ADMIN_PASSWORD: 'admin-pw-<1>', SUPERADMIN_USER: 'boss', SUPERADMIN_PASSWORD: 'super-pw-2',
    POSTMAN_API_KEY: KEY, POSTMAN_API_URL: `http://127.0.0.1:${FAKE_PORT}/v1/transactional/email/send`,
    MINISITE_URL: 'https://example.test/mini/', officer_site_url: 'https://example.test/officer/', // lower case on purpose
    ADMIN_CONTACT: 'https://example.slack.com/team/U0TEST'
  };
  const server = spawn('node', [path.join(__dirname, 'dev-server.js'), '3020'], { env, stdio: 'inherit' });
  try {
    for (let i = 0; i < 40; i++) { try { await fetch(API + '/api/ping'); break; } catch (e) { await new Promise((r) => setTimeout(r, 250)); } }
    ok((await call('GET', '/api/notify')).status === 401, 'notify needs the superadmin login');
    const dbs_unrecord = async (email) => { const c = new Client({ connectionString: PG + '/notifytest' }); await c.connect(); await c.query('UPDATE admins SET welcome_sent_at = NULL WHERE email = $1', [email]); await c.end(); };
    const SUP = (await call('POST', '/api/login', { role: 'super', username: 'boss', password: 'super-pw-2' })).body.token;
    const pending = async () => (await call('GET', '/api/notify', null, SUP)).body.counts;
    const admins = async () => Object.fromEntries((await call('GET', '/api/admins', null, SUP)).body.admins.map((a) => [a.email, a]));
    const sendAll = async (kind) => {
      let after = '', sent = 0, failed = [];
      for (;;) {
        const r = await call('POST', '/api/notify', { kind, send: true, after }, SUP);
        if (r.status !== 200) return { status: r.status, body: r.body, sent, failed };
        sent += r.body.sent; failed = failed.concat(r.body.failed); after = r.body.after;
        if (!(r.body.remaining > 0 && r.body.sent > 0)) return { status: 200, sent, failed, remaining: r.body.remaining };
      }
    };

    let g = (await call('GET', '/api/notify', null, SUP)).body;
    ok(g.missing.length === 0 && g.ready.welcome && g.ready.reminder, 'all settings found, including one set in lower case');
    ok(/example\.test\/officer/.test(g.preview.welcome.text) && !g.preview.welcome.text.includes('admin-pw'), 'preview fills the links but not the password');

    await call('POST', '/api/admins', { emails: ['a@example.test', 'b@example.test', 'c@example.test'], mode: 'add' }, SUP);
    let c = await pending();
    ok(c.welcome === 3 && c.reminder === 3, 'three new officers are pending both emails');

    const t = await call('POST', '/api/notify', { kind: 'welcome', test: 'me@example.test' }, SUP);
    const tm = got[got.length - 1];
    ok(t.status === 200 && tm.recipient === 'me@example.test' && tm.auth === 'Bearer ' + KEY, 'test email goes to the given address with the API key');
    ok(tm.body.includes('<a href="https://example.test/mini/">') && tm.body.includes('<b>admin-pw-&lt;1&gt;</b>') && tm.subject === 'Digital4Good @ Kranji RC: Your access to the event mini-site and Admin Portal', 'email has the links and the escaped password');
    ok((await pending()).welcome === 3, 'a test marks nobody as sent');

    let n0 = got.length, s = await sendAll('welcome');
    ok(s.status === 200 && s.sent === 3 && got.length - n0 === 3, 'welcome goes to all three');
    let a = await admins();
    ok(a['a@example.test'].welcome_sent_at && a['c@example.test'].welcome_sent_at, 'admins list shows when the welcome was sent');
    n0 = got.length; s = await sendAll('welcome');
    ok(s.sent === 0 && got.length === n0, 'sending again emails nobody');

    await call('POST', '/api/admins', { emails: ['d@example.test'], mode: 'add' }, SUP);
    await call('POST', '/api/admins', { emails: ['a@example.test'], mode: 'add' }, SUP);
    ok((await pending()).welcome === 1, 're-adding a listed officer changes nothing; a new one is pending');
    await call('POST', '/api/admins', { remove: 'b@example.test' }, SUP);
    await call('POST', '/api/admins', { emails: ['b@example.test'], mode: 'add' }, SUP);
    ok((await pending()).welcome === 2, 'an officer removed and added back gets the welcome again');
    n0 = got.length; s = await sendAll('welcome');
    ok(s.sent === 2 && got.slice(n0).map((m) => m.recipient).sort().join() === 'b@example.test,d@example.test', 'only the new and re-added officers are emailed');

    await call('POST', '/api/admins', { emails: ['a@example.test', 'b@example.test', 'c@example.test', 'e@example.test'], mode: 'replace' }, SUP);
    a = await admins();
    ok(!a['d@example.test'] && a['a@example.test'].welcome_sent_at && !a['e@example.test'].welcome_sent_at, 'replace drops missing officers and keeps the others\' email record');
    ok((await call('POST', '/api/reset', { confirm: 'RESET' }, SUP)).status === 200 && (await admins())['a@example.test'].welcome_sent_at, 'the rehearsal reset keeps the email record');

    // Reminder: only officers who never logged in, once.
    ok((await call('POST', '/api/login', { role: 'admin', email: 'A@example.test', password: 'admin-pw-<1>' })).status === 200, 'officer a logs in');
    c = await pending();
    ok(c.reminder === 3, 'officers who logged in are not pending the reminder');
    n0 = got.length; s = await sendAll('reminder');
    const rem = got.slice(n0);
    ok(s.sent === 3 && !rem.some((m) => m.recipient === 'a@example.test') && rem[0].subject === '[Reminder] Digital4Good @ Kranji RC: Log in to Admin Portal before 8 Nov' && rem[0].body.includes('https://example.slack.com/team/U0TEST'), 'reminder goes to the three who never logged in, with the Slack contact');
    ok((await sendAll('reminder')).sent === 0, 'nobody is reminded twice');

    // Failures: one bad address does not stop the rest, and stays pending.
    await call('POST', '/api/admins', { emails: ['f1@example.test', 'fail@example.test', 'g@example.test'], mode: 'add' }, SUP);
    s = await sendAll('welcome');
    ok(s.sent === 3 && s.failed.length === 1 && s.failed[0].email === 'fail@example.test' && /500/.test(s.failed[0].message), 'a failed address is reported and the others still go');
    ok((await pending()).welcome === 1, 'the failed address stays pending for a retry');
    await mode(401);
    s = await sendAll('welcome');
    ok(s.sent === 0 && s.failed.length === 1 && /401/.test(s.failed[0].message), 'a wrong key stops at the first email');
    const bad = await call('POST', '/api/notify', { kind: 'welcome', test: 'me@example.test' }, SUP);
    ok(bad.status === 502 && /401/.test(bad.body.message) && !bad.body.message.includes('me@example.test'), 'a failed test send says what Postman answered, without the address');
    await mode(0);

    // Two tabs pressing Send at once never email the same officer twice.
    const many = Array.from({ length: 12 }, (_, i) => `p${String(i).padStart(2, '0')}@example.test`);
    await call('POST', '/api/admins', { emails: many, mode: 'add' }, SUP);
    n0 = got.length;
    const [x, y] = await Promise.all([sendAll('welcome'), sendAll('welcome')]);
    const to = got.slice(n0).map((m) => m.recipient);
    ok(new Set(to).size === to.length && many.every((m) => to.includes(m)), `parallel sends: ${to.length} emails, no officer twice (${x.sent} + ${y.sent})`);

    // A slow Postman: every request still ends well inside Vercel's 10-second limit, and nobody is skipped.
    const slow = Array.from({ length: 6 }, (_, i) => `s${i}@example.test`);
    await call('POST', '/api/admins', { emails: slow, mode: 'add' }, SUP);
    await mode(0, 3000);
    n0 = got.length;
    let longest = 0, after = '', rounds = 0;
    for (;;) {
      const t0 = Date.now();
      const r = await call('POST', '/api/notify', { kind: 'welcome', send: true, after }, SUP);
      longest = Math.max(longest, Date.now() - t0); rounds++;
      after = r.body.after;
      if (!(r.body.remaining > 0 && r.body.sent > 0)) break;
    }
    await mode(0, 60);
    const slowTo = got.slice(n0).map((m) => m.recipient);
    ok(longest < 8500 && slow.every((m) => slowTo.includes(m)) && new Set(slowTo).size === slowTo.length && (await admins().then((a) => slow.every((m) => a[m].welcome_sent_at))),
      `slow Postman (3 s per email): ${rounds} batches, longest ${longest} ms, all 6 sent once`);

    // Delivery status from Postman's List endpoint, matched by address and send time.
    await call('POST', '/api/admins', { emails: ['bounce@example.test'], mode: 'add' }, SUP);
    await sendAll('welcome');
    const dl = await call('GET', '/api/notify?delivery=1', null, SUP);
    const o = dl.body.officers || {};
    ok(dl.status === 200 && dl.body.complete && o['a@example.test'].welcome.status === 'DELIVERED' && o['b@example.test'].reminder.status === 'DELIVERED',
      `delivery: welcome and reminder statuses found for each officer (${dl.body.checked} emails read, ${listCalls} list calls)`);
    ok(o['bounce@example.test'].welcome.status === 'BOUNCED' && /Hard Bounce/.test(o['bounce@example.test'].welcome.error), 'a bounced address shows as bounced with the reason');
    ok(o['a@example.test'].reminder === null && !o['fail@example.test'], 'no reminder sent = no status; never-sent officers are not listed');
    ok((await call('GET', '/api/notify?delivery=1')).status === 401, 'delivery check needs the superadmin login');
    // An officer emailed but not recorded (a request stopped mid-send) is flagged before a resend.
    await dbs_unrecord('a@example.test');
    const un = (await call('GET', '/api/notify?delivery=1', null, SUP)).body.unrecorded;
    ok(un.length === 1 && un[0].email === 'a@example.test' && un[0].status === 'DELIVERED' && !un.some((u) => u.email === 'fail@example.test'),
      'a pending officer who already has an email in Postman is flagged; one who never got one is not');

    ok((await call('POST', '/api/notify', { kind: 'other', send: true }, SUP)).status === 400, 'unknown kind refused');
    ok((await call('POST', '/api/notify', { kind: 'welcome', test: 'not-an-email' }, SUP)).status === 400, 'bad test address refused');
  } finally {
    server.kill();
    fake.close();
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
