// The officer page's scan result popup (owner, 18 Nov): every scan result opens as a popup over
// the scanner; "All correct" can only be closed with "Souvenir given" or "Not given".
// Usage: DATABASE_URL=<local test db> node tests/popup.test.js <siteBase> <apiOrigin> <adminPw> <superUser> <superPw> [shotDir]
// The site copy at <siteBase> must have js/config.js pointing at <apiOrigin>; the API must use DATABASE_URL.
// Use a fresh local database, never production: the test sets the open event's cap and adds claims.
const crypto = require('crypto');
const { chromium } = require('playwright');
const { Client } = require('pg');
const [site, api, ADMIN_PW, SUPER_USER, SUPER_PW, SHOTS] = process.argv.slice(2);
const ADMIN = site + 'admin/index.html';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const call = (method, path, body, token) => fetch(api + path, {
  method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const newId = () => Array.from(crypto.randomBytes(8), (b) => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[b % 32]).join('');
const newKey = () => crypto.randomBytes(16).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  const SUP = (await call('POST', '/api/login', { role: 'super', username: SUPER_USER, password: SUPER_PW })).body.token;
  const EVT = (await call('GET', '/api/remaining')).body.event.id;
  await call('POST', '/api/events', { id: EVT, cap: 500 }, SUP);
  await call('POST', '/api/admins', { emails: ['alice@mom.gov.sg'], mode: 'add' }, SUP);
  const claim = async (score = 8, key = newKey()) => { const id = newId(); await call('POST', '/api/submit', { id, key, score, total: 8 }); return id; };
  // a phone given a souvenir on 8 Nov, now with a new claim for this event
  const oldClaim = async () => {
    const key = newKey(), old = newId();
    await c.query(`INSERT INTO scans (id, source, device_key_hash, score, total, attempts, first_full, first_seen, last_seen, redeemed_at, redeemed_station, event_id)
      VALUES ($1, 'self', $2, 8, 8, 1, 1, '2026-11-08T10:00:00Z', '2026-11-08T10:00:00Z', '2026-11-08T10:05:00Z', 'alice@mom.gov.sg', '2026-11-08')`, [old, sha(key)]);
    return { old, now: await claim(8, key) };
  };
  const row = async (id) => (await c.query('SELECT redeemed_at, redeemed_station FROM scans WHERE id = $1', [id])).rows[0];
  const given = async () => +(await c.query('SELECT count(*) FROM scans WHERE event_id = $1 AND redeemed_at IS NOT NULL', [EVT])).rows[0].count;

  const b = await chromium.launch(), errs = [];
  async function officer(scheme, w = 360, h = 640) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: scheme, hasTouch: true });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(scheme + ': ' + e.message));
    await pg.goto(ADMIN);
    await pg.fill('#email', 'alice@mom.gov.sg'); await pg.fill('#password', ADMIN_PW); await pg.click('#loginForm button');
    await pg.locator('#v-home').waitFor();
    await pg.click('a[href="#scan"]');
    return pg;
  }
  // Types a code and waits for the popup; returns what it shows.
  const state = (pg) => pg.evaluate(() => {
    const m = document.getElementById('scanModal'), v = document.getElementById('verdict');
    const r = v.getBoundingClientRect();
    return {
      open: !m.hidden && !v.hidden, cls: v.className, title: (v.querySelector('.big') || {}).textContent, detail: (v.querySelector('.detail') || {}).textContent,
      buttons: [...v.querySelectorAll('button')].map((x) => x.textContent), disabled: [...v.querySelectorAll('button')].map((x) => x.disabled),
      role: v.getAttribute('role'), modal: v.getAttribute('aria-modal'), focus: document.activeElement && (document.activeElement.textContent || document.activeElement.id),
      inside: v.contains(document.activeElement), mainInert: document.querySelector('main').inert,
      fits: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && v.scrollHeight <= v.clientHeight + 1,
      minFont: Math.min(...[...v.querySelectorAll('button')].map((x) => parseFloat(getComputedStyle(x).fontSize))),
    };
  });
  const typeCode = async (pg, code) => {
    await pg.fill('#typed', code); await pg.click('#typeForm button');
    await pg.waitForFunction(() => !document.getElementById('scanModal').hidden && document.querySelector('#verdict .big'));
    return state(pg);
  };
  const tap = (pg, label) => pg.locator('#verdict button', { hasText: new RegExp('^' + label + '$') }).click();
  const shot = (pg, name) => SHOTS ? pg.screenshot({ path: `${SHOTS}/${name}.png` }) : null;

  // ---- light: every verdict kind ----
  let pg = await officer('light');
  const A = await claim(), P = await claim(5), OLD = await oldClaim();

  let s = await typeCode(pg, A);
  ok(s.open && s.title === 'All correct' && /give/.test(s.cls), 'All correct opens as a popup (give colour)');
  ok(s.role === 'dialog' && s.modal === 'true', 'popup is role="dialog" with aria-modal="true"');
  ok(JSON.stringify(s.buttons) === '["Souvenir given","Not given"]', 'All correct: two buttons, "Souvenir given" then "Not given" ' + JSON.stringify(s.buttons));
  ok(s.focus === 'Souvenir given', 'focus moves to "Souvenir given" (got ' + s.focus + ')');
  ok(s.mainInert, 'the scanner behind the popup is inert');
  ok(s.fits && s.minFont >= 16, `All correct fits 360x640 without scrolling; buttons ${s.minFont}px`);
  await shot(pg, 'all-correct-light');
  // cannot be closed any other way
  await pg.keyboard.press('Escape');
  ok((await state(pg)).open, 'Escape does not close the popup');
  await pg.mouse.click(8, 8); await pg.touchscreen.tap(350, 630);
  s = await state(pg);
  ok(s.open && s.inside, 'a click or tap outside the popup does not close it, and focus stays inside');
  await pg.evaluate(() => { location.hash = '#home'; }); await pg.waitForTimeout(200);
  ok((await state(pg)).open, 'going back to the menu (back button) leaves the popup open');
  await pg.evaluate(() => { location.hash = '#scan'; }); await pg.waitForTimeout(200);
  // focus trap
  let trapped = true;
  for (let i = 0; i < 5; i++) { await pg.keyboard.press('Tab'); trapped = trapped && (await state(pg)).inside; }
  for (let i = 0; i < 3; i++) { await pg.keyboard.press('Shift+Tab'); trapped = trapped && (await state(pg)).inside; }
  ok(trapped, 'Tab and Shift+Tab keep focus inside the popup');
  await pg.keyboard.press('Tab'); const f1 = (await state(pg)).focus; await pg.keyboard.press('Tab'); const f2 = (await state(pg)).focus;
  ok(f1 !== f2 && ['Souvenir given', 'Not given'].includes(f1) && ['Souvenir given', 'Not given'].includes(f2), 'Tab moves between the two buttons');
  await pg.evaluate(() => document.getElementById('typed').focus());
  ok((await state(pg)).inside, 'focus cannot be moved to the scanner behind');

  // "Not given": records nothing
  const before = await given(), redeems = [];
  pg.on('request', (r) => { if (/\/api\/redeem/.test(r.url())) redeems.push(r.url()); });
  await tap(pg, 'Not given');
  s = await state(pg);
  ok(!s.open && !s.mainInert, '"Not given" closes the popup and the scanner works again');
  ok(redeems.length === 0 && (await row(A)).redeemed_at === null && await given() === before, '"Not given" records nothing (no request, database unchanged)');

  // "Souvenir given": once, even with a double tap; "Recording…" while in flight
  s = await typeCode(pg, A);
  ok(s.title === 'All correct', 'the same code can be scanned again after "Not given"');
  await pg.route('**/api/redeem', async (r) => { await new Promise((res) => setTimeout(res, 700)); r.continue(); });
  const leftBefore = +(await pg.locator('#left').textContent());
  await pg.locator('#verdict button', { hasText: 'Souvenir given' }).dblclick();
  await pg.waitForTimeout(150);
  s = await state(pg);
  ok(JSON.stringify(s.buttons) === '["Recording…","Not given"]' && s.disabled.every(Boolean), 'while recording: "Recording…" and both buttons disabled ' + JSON.stringify(s.buttons));
  ok(s.inside, 'while recording, focus stays in the popup');
  await pg.waitForFunction(() => /Recorded/.test(document.querySelector('#verdict .big').textContent));
  await pg.unroute('**/api/redeem');
  s = await state(pg);
  ok(redeems.length === 1 && await given() === before + 1 && (await row(A)).redeemed_station === 'alice@mom.gov.sg', `"Souvenir given" records exactly once on a double tap (${redeems.length} request)`);
  ok(s.title === 'Recorded ✓' && s.detail === 'Souvenir given to ' + A + '.' && JSON.stringify(s.buttons) === '["Scan next"]' && s.focus === 'Scan next', 'then "Recorded ✓" with one "Scan next" button, focused');
  ok(+(await pg.locator('#left').textContent()) === leftBefore - 1, 'the souvenirs-left counter updates after the redeem');
  await shot(pg, 'recorded-light');
  await tap(pg, 'Scan next');
  ok(!(await state(pg)).open, '"Scan next" closes the popup');

  // stop and retry verdicts: one "Scan next"
  const one = async (code, title, cls, name) => {
    const st = await typeCode(pg, code);
    ok(st.open && st.title === title && st.cls.includes(cls) && JSON.stringify(st.buttons) === '["Scan next"]' && st.focus === 'Scan next' && st.fits,
      `${title}: popup (${cls}) with one focused "Scan next", fits` + (st.fits ? '' : ' (does not fit)'));
    if (name) await shot(pg, name);
    await tap(pg, 'Scan next');
    return st;
  };
  s = await one(A, 'Already given', 'stop', 'already-given-light');
  ok(/alice@mom\.gov\.sg/.test(s.detail), 'Already given still says who gave it');
  await typeCode(pg, A);
  await pg.evaluate(() => { location.hash = '#home'; }); await pg.waitForTimeout(200);
  s = await state(pg);
  ok(!s.open && !s.mainInert && await pg.locator('#v-home').isVisible(), 'the back button closes a result that needs no choice ("Already given")');
  await pg.evaluate(() => { location.hash = '#scan'; }); await pg.waitForTimeout(200);
  await one(P, 'Not all correct yet', 'retry');
  s = await one(OLD.now, 'Souvenir given before', 'stop', 'given-before-light');
  ok(/One souvenir per person: do not give another\./.test(s.detail), 'Souvenir given before keeps its message');
  await one(OLD.old, 'Code from another event', 'stop');
  await one(newId(), 'Code not found', 'stop');
  await one('!!', 'Not valid', 'stop');

  // redeem answers: cap reached, cap not set
  const B = await claim();
  await call('POST', '/api/events', { id: EVT, cap: await given() }, SUP);
  await typeCode(pg, B); await tap(pg, 'Souvenir given');
  await pg.waitForFunction(() => !/All correct/.test(document.querySelector('#verdict .big').textContent));
  s = await state(pg);
  ok(s.title === 'No souvenirs left' && JSON.stringify(s.buttons) === '["Scan next"]', 'cap reached: "No souvenirs left" with "Scan next"');
  await tap(pg, 'Scan next');
  await call('POST', '/api/events', { id: EVT, cap: null }, SUP);
  await typeCode(pg, B); await tap(pg, 'Souvenir given');
  await pg.waitForFunction(() => !/All correct/.test(document.querySelector('#verdict .big').textContent));
  s = await state(pg);
  ok(s.title === 'Souvenir limit not set' && JSON.stringify(s.buttons) === '["Scan next"]', 'cap not set: "Souvenir limit not set" with "Scan next"');
  await tap(pg, 'Scan next');
  await call('POST', '/api/events', { id: EVT, cap: 500 }, SUP);

  // no connection: "Try again" kept, and "Scan next" as the way out
  await pg.route('**/api/scan', (r) => r.abort());
  s = await typeCode(pg, B);
  ok(s.title === 'Not checked' && JSON.stringify(s.buttons) === '["Try again","Scan next"]' && s.focus === 'Try again', 'no connection: "Not checked" with "Try again" (focused) and "Scan next"');
  await pg.unroute('**/api/scan');
  await tap(pg, 'Try again');
  await pg.waitForFunction(() => /All correct/.test(document.querySelector('#verdict .big').textContent));
  ok(true, '"Try again" re-checks the code once the connection is back');
  await tap(pg, 'Not given');
  await pg.context().close();

  // ---- dark: the four screenshots and the colours ----
  if (SHOTS) {
    pg = await officer('dark');
    const D = await claim(), DOLD = await oldClaim();
    await typeCode(pg, D); await shot(pg, 'all-correct-dark');
    const bg = await pg.evaluate(() => getComputedStyle(document.getElementById('verdict')).backgroundColor);
    ok(bg === 'rgb(19, 41, 28)', 'dark: All correct uses the dark green (got ' + bg + ')');
    await tap(pg, 'Souvenir given');
    await pg.waitForFunction(() => /Recorded/.test(document.querySelector('#verdict .big').textContent));
    await shot(pg, 'recorded-dark'); await tap(pg, 'Scan next');
    await typeCode(pg, D); await shot(pg, 'already-given-dark'); await tap(pg, 'Scan next');
    await typeCode(pg, DOLD.now); await shot(pg, 'given-before-dark'); await tap(pg, 'Scan next');
    await pg.context().close();
  }

  // ---- smallest phone: every kind fits ----
  pg = await officer('light', 320, 568);
  const S = await claim(), SP = await claim(5);
  for (const [code, title] of [[S, 'All correct'], [SP, 'Not all correct yet'], [OLD.now, 'Souvenir given before'], [A, 'Already given']]) {
    s = await typeCode(pg, code);
    ok(s.title === title && s.fits && s.minFont >= 16, `320x568: ${title} fits without scrolling, buttons ${s.minFont}px`);
    await tap(pg, title === 'All correct' ? 'Not given' : 'Scan next');
  }
  await pg.context().close();

  ok(!errs.length, 'no page errors ' + (errs.length ? JSON.stringify(errs) : ''));
  await b.close(); await c.end();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
