// API checks against a running server with an EMPTY database.
// Usage: node tests/api.test.js <baseUrl> <adminPassword> <superUser> <superPassword> <cap>
// With BUG_API_TOKEN set (the same value as the server's), the bug-agent token is checked too.
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
  ok((await call('POST', '/api/login', { role: 'super', username: ' ' + SUPER_USER.toUpperCase() + ' ', password: SUPER_PW })).status === 200, 'superadmin login ID ignores case and spaces');
  ok((await call('POST', '/api/login', { role: 'super', username: SUPER_USER, password: SUPER_PW.toUpperCase() })).status === 401, 'superadmin password is case-sensitive');
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
  const carolAdded = a.body.admins.find((x) => x.email === 'carol@mom.gov.sg').added_at;
  a = await call('POST', '/api/admins', { emails: [' CAROL@mom.gov.sg', 'bob@mom.gov.sg', 'dave@mom.gov.sg'], mode: 'add' }, SUP);
  ok(a.status === 200 && a.body.admins.length === 4 && a.body.admins.find((x) => x.email === 'carol@mom.gov.sg').added_at === carolAdded,
    'uploading emails already listed: no error, no duplicates, existing entries untouched, new ones added');
  await call('POST', '/api/admins', { remove: 'dave@mom.gov.sg' }, SUP);
  ok((await call('POST', '/api/admins', { emails: ['not-an-email'] }, SUP)).status === 400, 'invalid email rejected');

  // ---- admin login ----
  ok((await call('POST', '/api/login', { role: 'admin', email: 'mallory@mom.gov.sg', password: ADMIN_PW })).status === 401, 'unlisted email cannot log in');
  ok((await call('POST', '/api/login', { role: 'admin', email: 'alice@mom.gov.sg', password: SUPER_PW })).status === 401, 'admin cannot log in with the superadmin password');
  const ADM = (await call('POST', '/api/login', { role: 'admin', email: ' ALICE@mom.gov.sg ', password: ADMIN_PW })).body.token;
  const ADM2 = (await call('POST', '/api/login', { role: 'admin', email: 'bob@mom.gov.sg', password: ADMIN_PW })).body.token;
  const ADM3 = (await call('POST', '/api/login', { role: 'admin', email: 'carol@mom.gov.sg', password: ADMIN_PW })).body.token;
  ok(ADM && ADM2 && ADM3, 'listed admins log in (email case and spaces ignored)');
  let seen = (await call('GET', '/api/admins', null, SUP)).body.admins;
  ok(seen.every((x) => x.login_count === 1 && x.last_login_at), 'each successful login is recorded: last login time and count (failed tries are not counted)');
  seen = (await call('POST', '/api/admins', { emails: ['alice@mom.gov.sg'], mode: 'add' }, SUP)).body.admins;
  ok(seen.find((x) => x.email === 'alice@mom.gov.sg').login_count === 1, 're-uploading an admin keeps their login history');
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

  // A phone that could not register: its QR is refused until it has (no claim is created from a QR).
  const B = id(), keyB = key();
  sc = await call('POST', '/api/scan', { code: encode({ id: B, score: 8, total: 8, attempts: 1, firstFull: 1, csat: 5, learned: 'Y' }) }, ADM);
  ok(sc.status === 404 && sc.body.error === 'not_registered', 'unregistered phone QR: refused as not saved yet');
  s = await call('POST', '/api/submit', { id: B, key: keyB, score: 8, total: 8, csat: 5, learned: 'Y' });
  ok(s.status === 200 && s.body.attempts === 1, 'that phone registers once back online');
  sc = await call('POST', '/api/scan', { code: encode({ id: B, score: 8, total: 8, attempts: 1, firstFull: 1 }) }, ADM);
  ok(sc.status === 200 && sc.body.eligible, 'then its QR scans as normal');
  ok((await call('POST', '/api/submit', { id: B, key: key(), score: 8, total: 8 })).status === 409, 'and other phones are locked out of its ID');

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
  ok(d.csatN === 2 && d.csat[3] === 1 && d.csat[4] === 1 && d.learned.Y === 2, 'dashboard rating counts (two phone submits)');
  ok(d.firstTryRate !== null && d.selfFirstTry >= 1, `first-try rate computed (${Math.round(d.firstTryRate * 100)}%)`);
  const ex = await call('GET', '/api/export?table=claims', null, SUP);
  ok(ex.status === 200 && /text\/csv/.test(ex.h.get('content-type')) && ex.body.text.includes(A) && !ex.body.text.includes('device_key_hash'), 'claims CSV export, without device keys');
  const exs = await call('GET', '/api/export?table=submissions', null, SUP);
  ok(exs.body.text.split('\r\n').length - 1 === d.submissions, 'submissions CSV has one row per submission');

  // ---- removing an admin revokes access ----
  await call('POST', '/api/admins', { remove: 'carol@mom.gov.sg' }, SUP);
  ok((await call('GET', '/api/stats', null, ADM3)).status === 401, 'removed admin is locked out immediately');

  // ---- bug reports ----
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  let br = await call('POST', '/api/bugreport', { screen: 'Mini-site: quiz', description: 'The Next button does nothing on quiz 3.', screenshots: [PNG, PNG] }, ADM);
  ok(br.status === 200 && br.body.id > 0, 'officer sends a bug report with 2 screenshots');
  const bugId = br.body.id;
  ok((await call('POST', '/api/bugreport', { description: 'Broken page', screenshots: [] })).status === 401, 'bug report needs an officer login');
  ok((await call('POST', '/api/bugreport', { description: 'x' }, ADM)).status === 400, 'bug report: too-short description refused');
  ok((await call('POST', '/api/bugreport', { description: 'Four pictures', screenshots: [PNG, PNG, PNG, PNG] }, ADM)).status === 400, 'bug report: more than 3 screenshots refused');
  ok((await call('POST', '/api/bugreport', { description: 'Not a picture', screenshots: ['data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64')] }, ADM)).body.error === 'bad_image', 'bug report: a file that is not really an image is refused');
  ok((await call('POST', '/api/bugreport', { description: 'Huge picture', screenshots: ['data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(700 * 1024)]).toString('base64')] }, ADM)).body.error === 'image_too_large', 'bug report: screenshot over 600 KB refused');
  ok((await call('GET', '/api/bugs', null, ADM)).status === 403, 'officers cannot read the bug log');
  const officerView = async (tok) => ((await call('GET', '/api/bugreport', null, tok)).body.reports || []).find((x) => x.id === bugId);
  let ov = await officerView(ADM);
  ok(ov && ov.status === 'new' && ov.mine === true && ov.note === '' && ov.reporter === 'alice@mom.gov.sg', 'officer sees their own report as new, marked as theirs, with who reported it');
  ok(ov && !('fix_ref' in ov) && !('screenshots' in ov) && !('screen' in ov), 'officers see no commit or screenshots');
  ov = await officerView(ADM2);
  ok(ov && ov.mine === false && ov.reporter === 'alice@mom.gov.sg', "another officer sees the report too, and who sent it, but not as theirs");
  // reports about the superadmin page never reach officers
  const ownIds = [];
  ownIds.push((await call('POST', '/api/bugreport', { description: 'The Super-Admin bug log tab is slow' }, ADM)).body.id);
  ownIds.push((await call('POST', '/api/bugreport', { description: 'Tab bar is cut off on my phone' }, SUP)).body.id);
  const marked = (await call('POST', '/api/bugreport', { description: 'Download button does nothing' }, ADM)).body.id;
  ok((await call('GET', '/api/bugreport', null, ADM2)).body.reports.some((x) => x.id === marked), 'a report is listed for officers until marked otherwise');
  ok((await call('POST', '/api/bugs', { id: marked, status: 'new', screen: 'superadmin' }, SUP)).body.report.screen === 'superadmin', 'superadmin can mark a report as about their page');
  ownIds.push(marked);
  const fixedNote = (await call('POST', '/api/bugreport', { description: 'Counter looked wrong' }, ADM)).body.id;
  await call('POST', '/api/bugs', { id: fixedNote, status: 'fixed', fix_note: 'Counter fixed on the officer and superadmin pages' }, SUP);
  ownIds.push(fixedNote);
  const offList = (await call('GET', '/api/bugreport', null, ADM2)).body.reports;
  ok(ownIds.every((id) => !offList.some((x) => x.id === id)) && !JSON.stringify(offList).match(/super[\s_-]*admin/i),
    'officers never see a report that mentions the superadmin page, is marked as about it, or was sent from its login');
  ok((await call('GET', '/api/bugs', null, SUP)).body.reports.filter((x) => ownIds.includes(x.id)).length === 4, 'the superadmin still sees all of them');
  ok((await call('GET', '/api/bugreport')).status === 401, 'report status needs an officer login');
  ok((await call('GET', '/api/bugs')).status === 401, 'bug log needs a login');
  let bl = await call('GET', '/api/bugs', null, SUP);
  const rep = bl.body.reports && bl.body.reports.find((x) => x.id === bugId);
  ok(rep && rep.status === 'new' && rep.reporter_email === 'alice@mom.gov.sg' && rep.screenshots.length === 2, 'superadmin sees the report: new, reporter, 2 screenshots');
  const img = await fetch(base + '/api/bugshot?id=' + rep.screenshots[0], { headers: { authorization: 'Bearer ' + SUP } });
  const bytes = Buffer.from(await img.arrayBuffer());
  ok(img.status === 200 && img.headers.get('content-type') === 'image/png' && bytes[0] === 0x89 && /no-store/.test(img.headers.get('cache-control')), 'screenshot comes back as the image, not cached');
  ok((await call('GET', '/api/bugshot?id=' + rep.screenshots[0], null, ADM)).status === 403, 'officers cannot open screenshots');
  let up = await call('POST', '/api/bugs', { id: bugId, status: 'fixed', fix_ref: 'abc1234', fix_note: 'Button wired up' }, SUP);
  ok(up.status === 200 && up.body.report.status === 'fixed' && up.body.report.fixed_at && up.body.report.fix_ref === 'abc1234', 'marking fixed stamps the fix time and keeps the commit');
  const firstFixed = up.body.report.fixed_at;
  up = await call('POST', '/api/bugs', { id: bugId, status: 'fixed', fix_note: 'Also checked on iPhone' }, SUP);
  ok(up.body.report.fixed_at === firstFixed && up.body.report.fix_ref === 'abc1234', 'marking fixed again keeps the first fix time');
  ov = await officerView(ADM2);
  ok(ov.status === 'fixed' && ov.fixed_at === firstFixed && ov.note === 'Also checked on iPhone', 'officers see a fixed report with its fix time and note');
  up = await call('POST', '/api/bugs', { id: bugId, status: 'in_progress' }, SUP);
  ok(up.body.report.fixed_at === null, 'reopening clears the fix time');
  ok((await officerView(ADM)).note === '', "an open report's note (the fixer's working notes) is not shown to officers");
  ok((await call('POST', '/api/bugs', { id: bugId, status: 'done' }, SUP)).status === 400, 'unknown status refused');
  ok((await call('POST', '/api/bugs', { id: 999999, status: 'fixed' }, SUP)).status === 404, 'unknown report: 404');
  const BUG_TOKEN = process.env.BUG_API_TOKEN;
  if (BUG_TOKEN) {
    bl = await call('GET', '/api/bugs?status=in_progress', null, BUG_TOKEN);
    ok(bl.status === 200 && bl.body.reports.some((x) => x.id === bugId), 'bug-agent token can read the bug log, filtered by status');
    ok((await call('POST', '/api/bugs', { id: bugId, status: 'fixed', fix_ref: 'def5678' }, BUG_TOKEN)).body.report.fix_ref === 'def5678', 'bug-agent token can record a fix');
    ok((await call('GET', '/api/bugs', null, BUG_TOKEN + 'x')).status === 401, 'a wrong bug-agent token is refused');
    ok((await call('GET', '/api/dashboard', null, BUG_TOKEN)).status === 401 && (await call('GET', '/api/stats', null, BUG_TOKEN)).status === 401, 'bug-agent token opens nothing else');
  }
  const ae = await call('GET', '/api/apierrors', null, SUP);
  ok(ae.status === 200 && Array.isArray(ae.body.errors), 'superadmin can read the server error log');
  ok((await call('GET', '/api/apierrors', null, ADM)).status === 403 && (await call('GET', '/api/apierrors')).status === 401, 'officers and visitors cannot read the server error log');
  if (BUG_TOKEN) ok((await call('GET', '/api/apierrors?since=0', null, BUG_TOKEN)).status === 200, 'bug-agent token can read the server error log');
  const adminsBefore = JSON.stringify((await call('GET', '/api/admins', null, SUP)).body.admins);
  await call('POST', '/api/reset', { confirm: 'RESET' }, SUP);
  ok((await call('GET', '/api/bugs', null, SUP)).body.reports.some((x) => x.id === bugId), 'clearing rehearsal data keeps the bug log');
  ok(JSON.parse(adminsBefore).length > 0 && JSON.stringify((await call('GET', '/api/admins', null, SUP)).body.admins) === adminsBefore && (await call('POST', '/api/login', { role: 'admin', email: 'bob@mom.gov.sg', password: ADMIN_PW })).status === 200,
    'clearing rehearsal data keeps every admin, and they can still log in');

  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
