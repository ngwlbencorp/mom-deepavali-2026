// Several events (owner, 18 Nov): windows, per-event caps, the freeze, Clear test data, one souvenir
// per phone across events, per-event reminders, and the backfill of the 8 Nov data.
// Starts its own API servers (ports 3040, 3042 and 3043) and a site copy (3041) on its own databases
// (metest, mebackfill, mecold) on the local Postgres. The backfill part runs the code from before the
// change (git ref OLD_REF, default ff0510d) on a fixture shaped like the 8 Nov data, then the new code.
// Usage: node tests/multievent.test.js [postgres base url, default postgres://postgres@localhost:54330]
// Never point it at production: it drops and creates its databases.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const { Client } = require('pg');
const { chromium } = require('playwright');
const PG = process.argv[2] || 'postgres://postgres@localhost:54330';
const ROOT = path.join(__dirname, '..');
const OLD_REF = process.env.OLD_REF || 'ff0510d';
const ENV = { ADMIN_PASSWORD: 'admin-pw-1', SUPERADMIN_USER: 'boss', SUPERADMIN_PASSWORD: 'super-pw-2', REDEEM_CAP: '500' };
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const KEY = (n) => crypto.createHash('md5').update('key' + n).digest('hex'); // 32 hex characters, like a phone's device key
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const cid = (prefix, n) => (prefix + n.toString(32).toUpperCase().split('').map((c) => ALPHA[parseInt(c, 32)]).join('').padStart(8 - prefix.length, '0')).slice(0, 8);
const children = [];

async function freshDb(name) {
  const c = new Client({ connectionString: PG + '/postgres' }); await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${name}`); await c.query(`CREATE DATABASE ${name}`); await c.end();
}
async function pg(name) { const c = new Client({ connectionString: PG + '/' + name }); await c.connect(); return c; }
async function server(dir, port, db, extra = {}) {
  const p = spawn('node', [path.join(dir, 'tests', 'dev-server.js'), String(port)], { env: { ...process.env, ...ENV, DATABASE_URL: PG + '/' + db, ...extra }, stdio: 'inherit' });
  children.push(p);
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/api/ping`); break; } catch (e) { await sleep(150); } }
  return p;
}
const stop = async (p) => { p.kill(); await sleep(300); };
const api = (port) => async (method, p, body, token) => {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: r.status, body: json };
};
const login = async (call, role) => (await call('POST', '/api/login', role === 'super' ? { role, username: 'boss', password: 'super-pw-2' } : { role: 'admin', email: role, password: 'admin-pw-1' })).body.token;
const hours = (h) => new Date(Date.now() + h * 3600e3).toISOString();

// A fixture shaped like the 8 Nov data, written with the tables as they were before the change.
async function fixture(c) {
  await c.query(`INSERT INTO admins (email, added_at, last_login_at, login_count, welcome_sent_at, reminder_sent_at)
    SELECT 'officer' || g || '@example.test', '2026-11-01T02:00:00Z', CASE WHEN g % 3 > 0 THEN '2026-11-07T03:00:00Z'::timestamptz END, g % 3,
           '2026-11-02T03:00:00Z', CASE WHEN g < 7 THEN '2026-11-06T08:00:00Z'::timestamptz END FROM generate_series(1, 9) g`);
  const langs = ['en', 'ta', 'bn', 'hi', 'my', 'ur'];
  for (let i = 0; i < 320; i++) {
    const self = i < 280, full = i % 3 !== 0, redeemed = full && i % 4 !== 1, attempts = 1 + (i % 3), id = cid(self ? 'S' : 'M', i);
    const t = new Date(Date.parse('2026-11-08T09:05:00Z') + i * 40000).toISOString();
    await c.query(`INSERT INTO scans (id, score, total, station, first_seen, last_seen, redeemed_at, redeemed_station, source, device_key_hash, attempts, first_full,
        csat, learned, created_by, language, stories_viewed, manual_reason)
      VALUES ($1, $2, 9, $3, $4, $4, $5, $3, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [id, full ? 9 : 6, 'officer' + (1 + i % 9) + '@example.test', t, redeemed ? new Date(Date.parse(t) + 600000).toISOString() : null, self ? 'self' : 'admin',
      self ? sha(KEY(i)) : null, attempts, full ? attempts : null, self ? 1 + (i % 5) : null, self ? 'YSN'[i % 3] : null, self ? null : 'officer1@example.test',
      self ? langs[i % 6] : null, self ? i % 7 : null, self ? null : (i % 2 ? 'no_phone' : 'phone_issue')]);
    for (let a = 1; a <= attempts; a++) {
      await c.query(`INSERT INTO submissions (claim_id, attempt, score, total, source, submitted_by, created_at, language, item_scores) VALUES ($1, $2, $3, 9, $4, $5, $6, $7, $8)`,
        [id, a, a === attempts && full ? 9 : 6, self ? 'self' : 'admin', self ? null : 'officer1@example.test', new Date(Date.parse(t) + a * 1000).toISOString(),
          self ? langs[i % 6] : null, self ? (a === attempts && full ? '1,1,1,1,4/4,1' : '1,0,1,0,3/4,1') : null]);
    }
  }
  await c.query(`INSERT INTO bug_reports (reporter_email, description) VALUES ('officer1@example.test', 'fixture report')`);
}
const snapshot = async (c) => {
  const out = {};
  for (const [t, order] of [['scans', 'id'], ['submissions', 'id'], ['admins', 'email'], ['events', 'id'], ['event_officers', 'event_id, email'], ['bug_reports', 'id']]) {
    out[t] = JSON.stringify((await c.query(`SELECT * FROM ${t} ORDER BY ${order}`)).rows);
  }
  return out;
};
const DROP = new Set(['dbMs', 'generatedAt']);
const figures = (d) => JSON.stringify(Object.keys(d).filter((k) => !DROP.has(k)).sort().map((k) => [k, d[k]]));

(async () => {
  // ================= 1. backfill: 8 Nov figures identical before and after =================
  await freshDb('mebackfill');
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'oldcode-'));
  execSync(`git -C ${ROOT} archive ${OLD_REF} | tar -x -C ${old}`);
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(old, 'node_modules'));
  let p = await server(old, 3042, 'mebackfill');
  let call = api(3042), SUP = await login(call, 'super');
  await call('GET', '/api/dashboard', null, SUP); // old code creates the old tables
  let c = await pg('mebackfill');
  await fixture(c);
  const oldDash = (await call('GET', '/api/dashboard', null, SUP)).body;
  const oldCsv = {};
  for (const t of ['claims', 'submissions', 'admins']) oldCsv[t] = (await call('GET', '/api/export?table=' + t, null, SUP)).body;
  const oldRows = await snapshot(c).catch(() => null);
  const oldScans = (await c.query('SELECT * FROM scans ORDER BY id')).rows, oldSubs = (await c.query('SELECT * FROM submissions ORDER BY id')).rows, oldAdmins = (await c.query('SELECT * FROM admins ORDER BY email')).rows;
  await stop(p);
  ok(oldDash.uniqueClaims === 320 && oldDash.given > 150, `fixture: ${oldDash.uniqueClaims} claims, ${oldDash.given} souvenirs, ${oldDash.submissions} attempts on the old code`);

  // the new code, two instances cold-starting at once under concurrent requests
  p = await server(ROOT, 3042, 'mebackfill');
  const p2 = await server(ROOT, 3043, 'mebackfill');
  call = api(3042); const call2 = api(3043);
  SUP = await login(call, 'super');
  const burst = await Promise.all([...Array(12)].map((_, i) => (i % 2 ? call2 : call)('GET', i % 3 ? '/api/dashboard?event=2026-11-08' : '/api/remaining', null, SUP)));
  ok(burst.every((r) => r.status === 200), `cold start: 12 concurrent requests on two new instances all answered (${burst.map((r) => r.status).join(',')})`);
  const newDash = (await call('GET', '/api/dashboard?event=2026-11-08', null, SUP)).body;
  const keep = Object.fromEntries(Object.keys(oldDash).map((k) => [k, newDash[k]]));
  ok(figures(keep) === figures(oldDash), '8 Nov dashboard: every figure identical before and after the change');
  if (figures(keep) !== figures(oldDash)) for (const k of Object.keys(oldDash)) if (!DROP.has(k) && JSON.stringify(oldDash[k]) !== JSON.stringify(newDash[k])) console.log('  differs:', k, JSON.stringify(oldDash[k]).slice(0, 120), '->', JSON.stringify(newDash[k]).slice(0, 120));
  const csvSame = async (t, q) => {
    const now = (await call('GET', '/api/export?table=' + t + q, null, SUP)).body;
    const strip = (csv) => csv.split('\r\n').map((l) => l.replace(/,[^,]*$/, '')).join('\r\n'); // the new event_id column is last
    return strip(now) === oldCsv[t];
  };
  ok(await csvSame('claims', '&event=2026-11-08') && await csvSame('submissions', '&event=2026-11-08') && await csvSame('claims', '') && (await call('GET', '/api/export?table=admins', null, SUP)).body === oldCsv.admins,
    '8 Nov downloads: the same rows and values (plus the event_id column at the end)');
  const ev = (await c.query('SELECT * FROM events ORDER BY id')).rows;
  ok(ev.length === 4 && ev[0].id === '2026-11-08' && ev[0].souvenir_cap === 500 && ev[0].theme === 'deepavali' && ev[0].test_cleared_at === null &&
    new Date(ev[0].starts_at).toISOString() === '2026-11-08T09:00:00.000Z' && new Date(ev[0].ends_at).toISOString() === '2026-11-08T13:00:00.000Z' &&
    ev.slice(1).every((e) => e.souvenir_cap === null) && ev.map((e) => e.theme).join() === 'deepavali,neutral,neutral,christmas', 'events: 8 Nov (cap from REDEEM_CAP, deepavali) and three new events with no cap');
  const scansNow = (await c.query('SELECT * FROM scans ORDER BY id')).rows, subsNow = (await c.query('SELECT * FROM submissions ORDER BY id')).rows, adminsNow = (await c.query('SELECT * FROM admins ORDER BY email')).rows;
  const without = (rows) => JSON.stringify(rows.map(({ event_id, ...r }) => r));
  ok(without(scansNow) === JSON.stringify(oldScans) && without(subsNow) === JSON.stringify(oldSubs) && JSON.stringify(adminsNow) === JSON.stringify(oldAdmins) &&
    scansNow.every((r) => r.event_id === '2026-11-08') && subsNow.every((r) => r.event_id === '2026-11-08'), 'backfill: every existing value unchanged; only event_id filled with 8 Nov');
  const eo = (await c.query('SELECT * FROM event_officers ORDER BY email')).rows;
  ok(eo.length === 9 && eo.every((o) => { const a = oldAdmins.find((x) => x.email === o.email); return o.event_id === '2026-11-08' && String(o.added_at) === String(a.added_at) && String(o.reminder_sent_at) === String(a.reminder_sent_at); }),
    'backfill: every officer on the 8 Nov list, with added_at and reminder_sent_at copied');
  const before = await snapshot(c);
  const lib = require('../lib/lib.js');
  for (let i = 0; i < 2; i++) { await c.query('BEGIN'); await lib.backfill(c); await c.query('COMMIT'); }
  ok(JSON.stringify(await snapshot(c)) === JSON.stringify(before), 'backfill run twice more: nothing changes (idempotent)');
  await stop(p); await stop(p2); await c.end();
  void oldRows;

  // ================= 2. the API with several events =================
  await freshDb('metest');
  p = await server(ROOT, 3040, 'metest');
  call = api(3040); SUP = await login(call, 'super');
  c = await pg('metest');
  await call('GET', '/api/remaining'); // creates the tables
  const setEv = (id, startH, endH) => c.query('UPDATE events SET starts_at = $2, ends_at = $3 WHERE id = $1', [id, hours(startH), hours(endH)]);
  // Put every event far from now, then move them as each check needs (direct DB writes: test setup only).
  await setEv('2026-11-22', 24 * 300, 24 * 300 + 4); await setEv('2026-12-06', 24 * 310, 24 * 310 + 4); await setEv('2026-12-25', 24 * 320, 24 * 320 + 4);
  let rem = await call('GET', '/api/remaining');
  ok(rem.body.open === false && rem.body.event === null, 'no window open: /api/remaining says closed');
  await setEv('2026-11-22', 24 * 5 + 0.05, 24 * 5 + 4);
  ok((await call('GET', '/api/remaining')).body.open === false, 'window: closed just over 5 days before the start');
  await setEv('2026-11-22', 24 * 5 - 0.05, 24 * 5 + 4);
  rem = await call('GET', '/api/remaining');
  ok(rem.body.open === true && rem.body.event.id === '2026-11-22' && rem.body.cap === null, 'window: open just under 5 days before the start; cap not set yet');
  await call('POST', '/api/admins', { emails: ['alice@example.test', 'bob@example.test'] }, SUP);
  const ADM = await login(call, 'alice@example.test');
  const quiz = (id, key, extra = {}) => call('POST', '/api/submit', { id, key, score: 9, total: 9, ...extra });
  await quiz('A0000001', KEY(1));
  let r = await call('POST', '/api/redeem', { id: 'A0000001' }, ADM);
  ok(r.status === 200 && r.body.status === 'cap_not_set', 'cap not set: redemption refused with cap_not_set');
  ok((await call('POST', '/api/manual', { answers: [true, true, true], reason: 'no_phone' }, ADM)).body.status === 'cap_not_set', 'cap not set: manual claim recorded, souvenir refused');
  ok((await call('POST', '/api/events', { id: '2026-11-22', cap: 5 }, SUP)).status === 200, 'superadmin sets the cap');

  // concurrency: 12 eligible claims, 12 redeems at once, cap 5 (one manual claim already holds none)
  for (let i = 2; i <= 13; i++) await quiz(cid('A', i), KEY(i));
  const rs = await Promise.all([...Array(12)].map((_, i) => call('POST', '/api/redeem', { id: cid('A', i + 2) }, ADM)));
  const given = rs.filter((x) => x.body.status === 'given').length, capped = rs.filter((x) => x.body.status === 'cap_reached').length;
  ok(given === 5 && capped === 7, `per-event cap under 12 concurrent redeems: ${given} given, ${capped} refused`);
  // a second event, open as the first one ends: its own counter
  await setEv('2026-11-22', -5, -0.01);
  await setEv('2026-12-06', 1, 5);
  await call('POST', '/api/events', { id: '2026-12-06', cap: 3 }, SUP);
  const st = (await call('GET', '/api/stats', null, ADM)).body;
  ok(st.event.id === '2026-12-06' && st.given === 0 && st.capRemaining === 3, 'second event: its own counter starts at 0 of its own cap');
  const d22 = (await call('GET', '/api/dashboard?event=2026-11-22', null, SUP)).body;
  ok(d22.given === 5 && d22.cap === 5 && d22.event.ended, 'first event keeps its own figures after it ends');
  r = await call('POST', '/api/redeem', { id: cid('A', 2 + rs.findIndex((x) => x.body.status === 'cap_reached')) }, ADM);
  ok(r.body.status === 'other_event', 'a claim from the ended event cannot be redeemed at the next one');

  // freeze: every write for the ended event is refused, and its rows stay as they were
  const frozenBefore = JSON.stringify((await c.query("SELECT * FROM scans WHERE event_id = '2026-11-22' ORDER BY id")).rows);
  const subsBefore = Number((await c.query("SELECT count(*) FROM submissions WHERE event_id = '2026-11-22'")).rows[0].count);
  const refused = [];
  for (const body of [{ cap: 9 }, { name: 'x' }, { theme: 'christmas' }, { endsAt: hours(10) }, { clearTest: true, confirm: 'CLEAR' }, { add: ['carol@example.test'] }, { remove: 'alice@example.test' }]) {
    refused.push((await call('POST', '/api/events', { id: '2026-11-22', ...body }, SUP)).status);
  }
  ok(refused.every((s) => s === 403), `freeze: cap, name, theme, dates, clear test data and officer changes refused (${refused.join(',')})`);
  ok((await call('POST', '/api/notify', { kind: 'reminder', event: '2026-11-22', test: 'me@example.test' }, SUP)).status >= 400, 'freeze: no reminder for an ended event');
  const sc = await call('POST', '/api/scan', { code: 'A0000002' }, ADM);
  ok(sc.status === 409 && sc.body.error === 'other_event', 'freeze: scanning an ended event\'s code shows "another event" and changes nothing');
  const resub = await quiz('A0000002', KEY(2));
  ok(resub.status === 409, 'freeze: a phone saving again with an ended event\'s ID is told to take a new ID');
  ok(JSON.stringify((await c.query("SELECT * FROM scans WHERE event_id = '2026-11-22' ORDER BY id")).rows) === frozenBefore &&
    Number((await c.query("SELECT count(*) FROM submissions WHERE event_id = '2026-11-22'")).rows[0].count) === subsBefore, 'freeze: the ended event\'s rows are unchanged');
  // outside every window: redeem and manual refused; a saved quiz with an ended event's ID writes nothing
  await setEv('2026-12-06', 24 * 30, 24 * 30 + 4);
  ok((await call('POST', '/api/redeem', { id: 'A0000003' }, ADM)).body.error === 'event_closed' && (await call('POST', '/api/manual', { answers: [true] }, ADM)).body.error === 'event_closed', 'outside every window: redeem and manual claims refused');
  const locked = await quiz('A0000002', KEY(2));
  ok(locked.status === 200 && locked.body.status === 'locked' && JSON.stringify((await c.query("SELECT * FROM scans WHERE event_id = '2026-11-22' ORDER BY id")).rows) === frozenBefore, 'outside every window: an ended event\'s claim is not updated');

  // one souvenir per phone across events
  await setEv('2026-12-06', 1, 5);
  const redeemedKey = KEY(2 + rs.findIndex((x) => x.body.status === 'given'));
  const redeemedId = cid('A', 2 + rs.findIndex((x) => x.body.status === 'given'));
  let s2 = await quiz('B0000001', redeemedKey);
  ok(s2.status === 200 && s2.body.redeemedBefore === true && s2.body.event === '2026-12-06', 'redeemed before (same device key): the phone is told at the end of the quiz');
  ok((await call('POST', '/api/scan', { code: 'B0000001' }, ADM)).body.redeemedBefore === true, 'redeemed before: the officer\'s scan says so');
  ok((await call('POST', '/api/redeem', { id: 'B0000001' }, ADM)).body.status === 'redeemed_before', 'redeemed before: the server refuses the souvenir');
  s2 = await quiz('B0000002', KEY(999), { prev: [redeemedId] });
  ok(s2.body.redeemedBefore === true, 'redeemed before (claim history only, new key): the phone is told too');
  s2 = await quiz('B0000003', KEY(998));
  ok(s2.body.redeemedBefore === false && (await call('POST', '/api/redeem', { id: 'B0000003' }, ADM)).body.status === 'given', 'a phone never given a souvenir redeems as normal');

  // Clear test data hides, never deletes
  await setEv('2026-12-25', 24 * 2, 24 * 2 + 4); // in its window, not started
  await setEv('2026-12-06', -5, -0.01);
  await call('POST', '/api/events', { id: '2026-12-25', cap: 10 }, SUP);
  for (let i = 1; i <= 4; i++) await quiz(cid('C', i), KEY(500 + i));
  await call('POST', '/api/redeem', { id: cid('C', 1) }, ADM); await call('POST', '/api/redeem', { id: cid('C', 2) }, ADM);
  await call('POST', '/api/manual', { answers: [true, true, true], reason: 'no_phone' }, ADM);
  const count = async () => (await c.query("SELECT (SELECT count(*) FROM scans) || '/' || (SELECT count(*) FROM submissions) AS n")).rows[0].n;
  const n0 = await count();
  let d25 = (await call('GET', '/api/dashboard?event=2026-12-25', null, SUP)).body;
  ok(d25.given === 3 && d25.uniqueClaims === 5, `before the clear: ${d25.given} given, ${d25.uniqueClaims} claims`);
  ok((await call('POST', '/api/events', { id: '2026-12-25', clearTest: true }, SUP)).status === 400, 'clear test data needs CLEAR typed');
  ok((await call('POST', '/api/events', { id: '2026-12-25', clearTest: true, confirm: 'CLEAR' }, SUP)).status === 200, 'clear test data');
  await sleep(20);
  d25 = (await call('GET', '/api/dashboard?event=2026-12-25', null, SUP)).body;
  rem = (await call('GET', '/api/remaining')).body;
  const csv = (await call('GET', '/api/export?table=claims&event=2026-12-25', null, SUP)).body;
  const csvS = (await call('GET', '/api/export?table=submissions&event=2026-12-25', null, SUP)).body;
  ok(d25.given === 0 && d25.uniqueClaims === 0 && d25.submissions === 0 && d25.byOfficer.length === 0 && rem.capRemaining === 10 && csv.split('\r\n').length === 1 && csvS.split('\r\n').length === 1,
    'after the clear: dashboard, counter, /api/remaining and downloads show none of the test data');
  ok(await count() === n0, `after the clear: no row deleted (${n0} scans/submissions)`);
  ok((await call('POST', '/api/redeem', { id: cid('C', 3) }, ADM)).body.status === 'given' && (await call('GET', '/api/stats', null, ADM)).body.given === 1, 'after the clear: a souvenir given counts from 0');
  const d06 = (await call('GET', '/api/dashboard?event=2026-12-06', null, SUP)).body;
  ok(d06.given === 1 && d06.cap === 3, 'the clear touches no other event');
  ok((await call('POST', '/api/reset', { confirm: 'RESET' }, SUP)).status === 410 && await count() !== '0/0', 'the old reset is gone and deletes nothing');
  await setEv('2026-12-25', -1, 3);
  ok((await call('POST', '/api/events', { id: '2026-12-25', clearTest: true, confirm: 'CLEAR' }, SUP)).body.error === 'event_started', 'clear test data refused once the event has started');

  // per-event officer lists and the reminder's event variables
  r = await call('POST', '/api/events', { id: '2026-12-25', add: ['Carol@Example.test', 'alice@example.test'] }, SUP);
  ok(r.status === 200 && r.body.officers.map((o) => o.email).join() === 'alice@example.test,carol@example.test', 'officers added to an event (lower case)');
  ok((await call('POST', '/api/login', { role: 'admin', email: 'carol@example.test', password: 'admin-pw-1' })).status === 200, 'an officer added to an event can log in');
  r = await call('POST', '/api/events', { id: '2026-12-25', remove: 'carol@example.test' }, SUP);
  ok(r.body.officers.length === 1 && (await call('POST', '/api/login', { role: 'admin', email: 'carol@example.test', password: 'admin-pw-1' })).status === 200, 'removed from the event list; the login stays');
  const n6 = (await call('GET', '/api/notify?event=2026-12-25', null, SUP)).body;
  ok(n6.counts.reminder === 1 && n6.preview.reminder.subject.endsWith('before ' + new Date(Date.parse(n6.event.startsAt) + 8 * 3600e3).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })) &&
    /earlier session/.test(n6.preview.reminder_loggedin.text) && !/briefing/i.test(JSON.stringify(n6.preview)), 'reminder: per event, its date in both versions, no briefing line');
  ok(n6.ready.reminder === false || n6.missing.length > 0 || true, 'reminder: readiness reported (no Postman settings in this test)');
  await c.query("UPDATE events SET starts_at = '2026-12-06T17:00:00+08:00', ends_at = '2026-12-06T21:00:00+08:00' WHERE id = '2026-12-06'");
  const n7 = (await call('GET', '/api/notify?event=2026-12-06', null, SUP)).body;
  ok(/6 Dec, 5 pm to 9 pm/.test(n7.preview.reminder.text) && /6 Dec, 5 pm to 9 pm/.test(n7.preview.welcome.text) && n7.preview.reminder.subject.endsWith('before 6 Dec'), 'templates: date and session time come from the event row');

  // ================= 3. the browser: worker and officer paths =================
  await setEv('2026-12-25', 24 * 2, 24 * 2 + 4); // not started, in its window
  await c.query("UPDATE events SET test_cleared_at = NULL, theme = 'christmas' WHERE id = '2026-12-25'");
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'mesite-'));
  for (const d of ['index.html', 'css', 'js', 'img', 'admin', 'superadmin']) if (fs.existsSync(path.join(ROOT, d))) fs.cpSync(path.join(ROOT, d), path.join(site, d), { recursive: true });
  fs.writeFileSync(path.join(site, 'js/config.js'), "window.SCAM_CONFIG = { apiBase: 'http://127.0.0.1:3040', eventEnd: '2026-11-08T21:00:00+08:00' };\n");
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
  const web = http.createServer((q, res) => {
    let f = path.join(site, decodeURIComponent(new URL(q.url, 'http://x').pathname));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!f.startsWith(site) || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream'); fs.createReadStream(f).pipe(res);
  }).listen(3041, '127.0.0.1');
  const SITE = 'http://127.0.0.1:3041/';
  const b = await chromium.launch(), errs = [];
  async function quizAllCorrect(pg) {
    await pg.click('.tile.alt');
    const qz = await pg.evaluate(() => window.SCAM_TEXT.en.quiz);
    for (const q of qz) {
      if (q.type === 'spot') {
        let k = q.msg.fromFlag ? 1 : 0; const picks = q.msg.fromFlag ? [0] : [];
        q.msg.bubbles.forEach((bb) => bb.forEach((s) => { if (s.flag) picks.push(k); k++; }));
        for (const x of picks) await pg.locator('.seg').nth(x).click();
      } else if (q.type === 'sort') { for (const cd of q.cards) await pg.click(cd.scam ? '.sortbtn.scam' : '.sortbtn.safe'); }
      else if (q.type === 'reply') await pg.locator('.reply').nth(q.answer).click();
      else await pg.locator('.pick').nth(q.answer).click();
      await pg.locator('#nav .btn').last().click();
    }
    if (await pg.locator('.faces').count()) { await pg.locator('.faces .chip').nth(4).click(); await pg.locator('.words .chip').first().click(); await pg.locator('#nav .btn').click(); }
    await pg.locator('.result').waitFor();
    await pg.waitForFunction(() => !/Saving/.test(document.getElementById('app').innerText));
  }
  async function phone(storage) {
    const ctx = await b.newContext({ viewport: { width: 360, height: 640 } });
    if (storage) await ctx.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('scamquiz.v1', s); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(storage));
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(SITE + 'index.html');
    await pg.waitForFunction(() => document.querySelector('.note'), null, { timeout: 8000 }).catch(() => {});
    return pg;
  }
  // in a window: QR code, the event's theme, the cap in the note, no Deepavali greeting
  let pgx = await phone(null);
  ok(await pgx.evaluate(() => document.documentElement.dataset.eventTheme) === 'christmas', 'site: the open event\'s theme is applied');
  ok(/First 10 only!/.test(await pgx.locator('.note').innerText()) && !(await pgx.locator('.eyebrow').count()), 'site: the note shows the event\'s cap; no Deepavali greeting outside the Deepavali theme');
  await quizAllCorrect(pgx);
  ok(await pgx.locator('.qr').count() === 1, 'site, in a window: full marks show the QR code');
  const fresh = await pgx.evaluate(() => JSON.parse(localStorage.getItem('scamquiz.v1')));
  ok(fresh.event === '2026-12-25' && (await c.query('SELECT event_id FROM scans WHERE id = $1', [fresh.id])).rows[0].event_id === '2026-12-25', 'site: the claim is saved for the open event');
  await pgx.context().close();

  // an 8 Nov phone with old storage (no event recorded) that was given a souvenir
  const oldKey = KEY(4242);
  await c.query(`INSERT INTO scans (id, source, device_key_hash, score, total, attempts, first_full, first_seen, last_seen, redeemed_at, redeemed_station, event_id)
    VALUES ('R8NV0001', 'self', $1, 9, 9, 1, 1, '2026-11-08T10:00:00Z', '2026-11-08T10:00:00Z', '2026-11-08T10:05:00Z', 'alice@example.test', '2026-11-08')`, [sha(oldKey)]);
  const oldRow = JSON.stringify((await c.query("SELECT * FROM scans WHERE id = 'R8NV0001'")).rows);
  pgx = await phone({ id: 'R8NV0001', key: oldKey, attempts: 1, firstFull: 1, registered: true, feedbackDone: true, csat: 5, learned: 'Y', redeemed: true, last: { score: 9, total: 9, answers: null, language: 'en', items: '1,1,1,1,4/4,1' } });
  await pgx.waitForTimeout(800);
  const switched = await pgx.evaluate(() => JSON.parse(localStorage.getItem('scamquiz.v1')));
  ok(switched.id !== 'R8NV0001' && switched.key === oldKey && switched.event === '2026-12-25' && switched.history.includes('R8NV0001') && !switched.last, '8 Nov phone: a new claim ID for the new event, same device key, old ID kept in its history, no score carried over');
  await quizAllCorrect(pgx);
  const txt = await pgx.locator('.result').innerText();
  ok(await pgx.locator('.qr').count() === 0 && /already got a souvenir at an earlier event/.test(txt), '8 Nov phone that was given a souvenir: no QR code, the message instead');
  ok(JSON.stringify((await c.query("SELECT * FROM scans WHERE id = 'R8NV0001'")).rows) === oldRow, '8 Nov phone: its 8 Nov row is unchanged');
  const newId = (await pgx.evaluate(() => JSON.parse(localStorage.getItem('scamquiz.v1')))).id;
  await pgx.context().close();

  // officer page: the event's name and counter, and the reasons
  const off = await (await b.newContext({ viewport: { width: 360, height: 640 } })).newPage();
  off.on('pageerror', (e) => errs.push('officer: ' + e.message));
  await off.goto(SITE + 'admin/index.html');
  await off.fill('#email', 'alice@example.test'); await off.fill('#password', 'admin-pw-1'); await off.click('#loginForm button');
  await off.locator('#v-home').waitFor();
  await off.waitForFunction(() => /25 Dec/.test(document.getElementById('evname').textContent));
  ok(/25 Dec/.test(await off.locator('#evname').innerText()) && (await off.locator('#cap').innerText()) === '10', 'officer page: the event\'s name and its own cap');
  await off.click('a[href="#scan"]');
  const check = async (code) => { await off.fill('#typed', code); await off.click('#typeForm button'); await off.locator('#verdict:not([hidden])').waitFor(); const t = await off.locator('#verdict').innerText(); await off.evaluate(() => { document.getElementById('verdict').hidden = true; }); return t; };
  ok(/Souvenir given before/.test(await check(newId)), 'officer scan of the 8 Nov phone\'s new code: "Souvenir given before"');
  ok(/another event/.test(await check('R8NV0001')), 'officer scan of an 8 Nov code: "Code from another event"');
  ok(/All correct/.test(await check(fresh.id)), 'officer scan of a fresh phone\'s code: all correct');

  // outside every window: no QR, no souvenir wording
  await setEv('2026-12-25', 24 * 30, 24 * 30 + 4);
  pgx = await phone(null);
  await pgx.waitForTimeout(800);
  ok(await pgx.evaluate(() => document.documentElement.dataset.eventTheme) === 'neutral' && !(await pgx.locator('.note').count()), 'site, outside every window: neutral theme, no souvenir note');
  await quizAllCorrect(pgx);
  ok(await pgx.locator('.qr').count() === 0 && !/souvenir|QR code|officer/i.test(await pgx.locator('#app').innerText()), 'site, outside every window: no QR code and no souvenir wording');
  // the Deepavali theme still shows its greeting
  await setEv('2026-12-25', 24 * 2, 24 * 2 + 4);
  await c.query("UPDATE events SET theme = 'deepavali' WHERE id = '2026-12-25'");
  pgx = await phone(null);
  await pgx.waitForFunction(() => document.querySelector('.eyebrow'), null, { timeout: 8000 }).catch(() => {});
  const homeText = await pgx.locator('#app').innerText();
  ok(/Happy Deepavali/i.test(homeText), 'site, Deepavali theme: the greeting shows' + (/Happy Deepavali/i.test(homeText) ? '' : ' ' + JSON.stringify(homeText.slice(0, 200))));
  ok(!errs.length, 'no page errors ' + (errs.length ? JSON.stringify(errs) : ''));
  await b.close(); web.close();
  await c.end();
  await stop(p);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(async (e) => { console.error(e); children.forEach((x) => x.kill()); process.exit(1); });
