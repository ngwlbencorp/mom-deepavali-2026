// API checks against a running server with an EMPTY database.
// Usage: node tests/api.test.js <baseUrl> <adminPassword> <superUser> <superPassword> <cap>
// It clears all claims and gives out souvenirs: never point it at the production database.
const crypto = require('crypto');
const { encode } = require('../js/payload.js');
const [base, ADMIN_PW, SUPER_USER, SUPER_PW, CAP] = [process.argv[2], process.argv[3], process.argv[4], process.argv[5], +process.argv[6]];
const ORIGIN = 'https://ducks.example';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
const id = () => Array.from(crypto.randomBytes(8), (b) => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[b % 32]).join('');
const key = () => crypto.randomBytes(16).toString('hex');
const call = (method, path, body, token) => fetch(base + path, {
  method,
  headers: { origin: ORIGIN, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
  body: body === undefined || body === null ? undefined : JSON.stringify(body)
}).then(async (r) => {
  const text = await r.text();
  let json = {};
  try { json = JSON.parse(text); } catch (e) { json = { text }; }
  return { status: r.status, h: r.headers, body: json };
});

(async () => {
  // ---- plumbing ----
  const ping = await call('GET', '/api/ping');
  ok(ping.status === 200 && ping.h.get('access-control-allow-origin') === ORIGIN, 'ping, CORS reflects Origin');
  const pre = await fetch(base + '/api/scan', { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } });
  ok(pre.status === 204 && pre.headers.get('access-control-allow-headers') === 'authorization,content-type', 'preflight 204 allows authorization header');

  // ---- superadmin ----
  ok((await call('POST', '/api/login', { role: 'super', username: SUPER_USER, password: ADMIN_PW })).status === 401, 'superadmin cannot log in with the admin password');
  const sl = await call('POST', '/api/login', { role: 'super', username: SUPER_USER, password: SUPER_PW });
  ok(sl.status === 200 && sl.body.token, 'superadmin login');
  const SUP = sl.body.token;
  ok((await call('GET', '/api/dashboard')).status === 401, 'dashboard needs login');
  ok((await call('GET', '/api/dashboard', null, SUP + 'x')).status === 401, 'tampered token rejected');
  ok((await call('POST', '/api/reset', { confirm: 'RESET' }, SUP)).status === 200, 'reset clears data');

  let a = await call('POST', '/api/admins', { emails: ['Alice@MOM.gov.sg', 'bob@mom.gov.sg', 'alice@mom.gov.sg'], mode: 'replace' }, SUP);
  ok(a.status === 200 && a.body.admins.length === 2 && a.body.admins[0].email === 'alice@mom.gov.sg', 'upload admins: lowercased, de-duplicated');
  a = await call('POST', '/api/admins', { emails: ['carol@mom.gov.sg'], mode: 'add' }, SUP);
  ok(a.body.admins.length === 3, 'add mode keeps existing admins');
  ok((await call('POST', '/api/admins', { emails: ['not-an-email'] }, SUP)).status === 400, 'invalid email rejected');

  // ---- admin login ----
  ok((await call('POST', '/api/login', { role: 'admin', email: 'mallory@mom.gov.sg', password: ADMIN_PW })).status === 401, 'unlisted email cannot log in');
  ok((await call('POST', '/api/login', { role: 'admin', email: 'alice@mom.gov.sg', password: SUPER_PW })).status === 401, 'admin cannot log in with the superadmin password');
  const ADM = (await call('POST', '/api/login', { role: 'admin', email: ' ALICE@mom.gov.sg ', password: ADMIN_PW })).body.token;
  const ADM2 = (await call('POST', '/api/login', { role: 'admin', email: 'bob@mom.gov.sg', password: ADMIN_PW })).body.token;
  const ADM3 = (await call('POST', '/api/login', { role: 'admin', email: 'carol@mom.gov.sg', password: ADMIN_PW })).body.token;
  ok(ADM && ADM2 && ADM3, 'listed admins log in (email case and spaces ignored)');
  ok((await call('GET', '/api/dashboard', null, ADM)).status === 403, 'admin cannot open the superadmin dashboard');
  ok((await call('GET', '/api/export?table=claims', null, ADM)).status === 403, 'admin cannot export data');

  // ---- self-submit: registration and clash ----
  const A = id(), keyA = key();
  let s = await call('POST', '/api/submit', { id: A, key: keyA, score: 6, total: 8, csat: 4, learned: 'Y' });
  ok(s.status === 200 && s.body.status === 'registered' && s.body.attempts === 1 && s.body.firstFull === null, 'first submit registers the ID');
  s = await call('POST', '/api/submit', { id: A, key: keyA, score: 8, total: 8 });
  ok(s.body.status === 'updated' && s.body.attempts === 2 && s.body.firstFull === 2 && s.body.full, 'same phone retries: attempt 2, first full on attempt 2');
  s = await call('POST', '/api/submit', { id: A, key: key(), score: 8, total: 8 });
  ok(s.status === 409 && s.body.error === 'id_taken', 'another phone with the same ID gets 409 id_taken');
  ok((await call('POST', '/api/submit', { id: 'ILOU0000', key: keyA, score: 8, total: 8 })).status === 400, 'ID with excluded letters rejected');
  ok((await call('POST', '/api/submit', { id: id(), key: keyA, score: 9, total: 8 })).status === 400, 'score above total rejected');
  ok((await call('POST', '/api/submit', { id: id(), key: 'short', score: 8, total: 8 })).status === 400, 'bad device key rejected');

  // ---- scanning ----
  let sc = await call('POST', '/api/scan', { code: A.toLowerCase() }, ADM);
  ok(sc.status === 200 && sc.body.eligible && sc.body.record.attempts === 2 && !('device_key_hash' in sc.body.record), 'scan by typed code (any case); key hash never returned');
  sc = await call('POST', '/api/scan', { code: encode({ id: A, score: 3, total: 8, attempts: 9 }) }, ADM);
  ok(sc.body.record.score === 8 && sc.body.record.attempts === 2, 'server record wins over QR contents for registered IDs');
  ok((await call('POST', '/api/scan', { code: id() }, ADM)).status === 404, 'unknown typed code: 404');
  ok((await call('POST', '/api/scan', { code: encode({ id: A, score: 8, total: 8, attempts: 1 }).replace('|8/8|', '|7/8|') }, ADM)).status === 400, 'edited QR rejected');

  // A phone that could not register: the officer's scan creates the claim, the phone claims it later.
  const B = id(), keyB = key();
  sc = await call('POST', '/api/scan', { code: encode({ id: B, score: 8, total: 8, attempts: 1, firstFull: 1, csat: 5, learned: 'Y' }) }, ADM);
  ok(sc.status === 200 && sc.body.eligible && sc.body.record.source === 'self', 'offline phone QR: scan creates the claim');
  s = await call('POST', '/api/submit', { id: B, key: keyB, score: 8, total: 8 });
  ok(s.status === 200 && s.body.attempts === 2, 'that phone can still register its own ID later');
  ok((await call('POST', '/api/submit', { id: B, key: key(), score: 8, total: 8 })).status === 409, 'and after that, other phones are locked out of it');

  // ---- redeem ----
  ok((await call('POST', '/api/redeem', { id: A })).status === 401, 'redeem needs login');
  const race = await Promise.all(Array.from({ length: 20 }, (_, i) => call('POST', '/api/redeem', { id: A }, [ADM, ADM2, ADM3][i % 3])));
  const st = race.map((r) => r.body.status);
  ok(st.filter((x) => x === 'given').length === 1 && st.filter((x) => x === 'already').length === 19, '20 parallel redeems from 3 admins: exactly 1 given');
  sc = await call('POST', '/api/scan', { code: A }, ADM2);
  ok(!!sc.body.record.redeemed_at && /@mom\.gov\.sg$/.test(sc.body.record.redeemed_station), 'record shows who gave it');
  const P = id();
  await call('POST', '/api/submit', { id: P, key: key(), score: 7, total: 8 });
  ok((await call('POST', '/api/redeem', { id: P }, ADM)).body.status === 'not_eligible', 'partial score cannot redeem');

  // ---- manual (admin-assisted) ----
  let m = await call('POST', '/api/manual', { answers: [true, true, true] }, ADM);
  const m2 = await call('POST', '/api/manual', { answers: [true, true, true] }, ADM);
  ok(m.body.status === 'given' && m2.body.status === 'given' && m.body.id !== m2.body.id, 'manual all-correct gives a souvenir; identical repeats are NOT treated as duplicates');
  m = await call('POST', '/api/manual', { answers: [true, false, true] }, ADM2);
  ok(m.body.status === 'not_eligible' && m.body.attempts === 1, 'manual with a wrong answer: not eligible');
  const m3 = await call('POST', '/api/manual', { answers: [true, true, true], id: m.body.id }, ADM2);
  ok(m3.body.status === 'given' && m3.body.id === m.body.id && m3.body.attempts === 2, 'ask again on the same manual claim: attempt 2, given');
  ok((await call('POST', '/api/manual', { answers: [true, true, true], id: m.body.id }, ADM2)).status === 404, 'a redeemed manual claim cannot be resubmitted');
  ok((await call('POST', '/api/manual', { answers: [true, true, true], id: A }, ADM2)).status === 404, 'manual retry cannot touch a self-submitted claim');
  ok((await call('POST', '/api/manual', { answers: ['yes'] }, ADM)).status === 400, 'manual answers must be true/false');

  // ---- cap, shared by both paths ----
  let stats = (await call('GET', '/api/stats', null, ADM)).body;
  const remaining = stats.capRemaining;
  const ids = Array.from({ length: remaining + 4 }, id);
  await Promise.all(ids.map((i) => call('POST', '/api/submit', { id: i, key: key(), score: 8, total: 8 })));
  const burst = await Promise.all(ids.map((i, k) => k % 3 === 0
    ? call('POST', '/api/manual', { answers: [true, true, true] }, ADM3)
    : call('POST', '/api/redeem', { id: i }, ADM2)));
  const given = burst.filter((r) => r.body.status === 'given').length;
  const capped = burst.filter((r) => r.body.status === 'cap_reached').length;
  ok(given === remaining && capped === 4, `parallel self + manual burst past the cap: ${given} given (expected ${remaining}), ${capped} cap_reached (expected 4)`);
  stats = (await call('GET', '/api/stats', null, ADM)).body;
  ok(stats.given === CAP && stats.capRemaining === 0, `stats: ${stats.given}/${stats.cap} given`);

  // ---- dashboard and export ----
  const d = (await call('GET', '/api/dashboard', null, SUP)).body;
  ok(d.given === CAP && d.submissions === d.selfSubmissions + d.adminSubmissions && d.adminClaims > 0 && d.timeline.length >= 1, 'dashboard totals add up');
  ok(d.csatN === 2 && d.csat[3] === 1 && d.csat[4] === 1 && d.learned.Y === 2, 'dashboard rating counts (phone submit + scanned offline QR)');
  ok(d.firstTryRate !== null && d.selfFirstTry >= 1, `first-try rate computed (${Math.round(d.firstTryRate * 100)}%)`);
  const ex = await call('GET', '/api/export?table=claims', null, SUP);
  ok(ex.status === 200 && /text\/csv/.test(ex.h.get('content-type')) && ex.body.text.includes(A) && !ex.body.text.includes('device_key_hash'), 'claims CSV export, without device keys');
  const exs = await call('GET', '/api/export?table=submissions', null, SUP);
  ok(exs.body.text.split('\r\n').length - 1 === d.submissions, 'submissions CSV has one row per submission');

  // ---- removing an admin revokes access ----
  await call('POST', '/api/admins', { remove: 'carol@mom.gov.sg' }, SUP);
  ok((await call('GET', '/api/stats', null, ADM3)).status === 401, 'removed admin is locked out immediately');

  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
