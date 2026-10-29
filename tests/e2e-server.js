// End-to-end browser test: MW phones, two admins, superadmin. Site and API on different origins.
// Usage: node tests/e2e-server.js <siteBase> <apiOrigin> <adminPw> <superUser> <superPw> <outDir>
// The site copy at <siteBase> must have js/config.js pointing at <apiOrigin>. The database is reset.
const fs = require('fs');
const { chromium, devices } = require('playwright');
const [site, api, ADMIN_PW, SUPER_USER, SUPER_PW, out] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const post = (path, body, token) => fetch(api + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());

(async () => {
  // fresh data and two admins
  const SUP = (await post('/api/login', { role: 'super', username: SUPER_USER, password: SUPER_PW })).token;
  await post('/api/reset', { confirm: 'RESET' }, SUP);
  await post('/api/admins', { emails: ['alice@mom.gov.sg', 'bob@mom.gov.sg'], mode: 'replace' }, SUP);

  const b = await chromium.launch(), errs = [];
  const phone = async (name) => {
    const ctx = await b.newContext({ ...devices['Pixel 7'] });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    return pg;
  };

  // Answers every item correctly in the current quiz formats, then the one-off feedback.
  async function doQuiz(pg) {
    await pg.click('.tile.alt');
    const quiz = await pg.evaluate(() => window.SCAM_TEXT.en.quiz);
    for (const q of quiz) {
      if (q.type === 'spot') {
        let k = q.msg.fromFlag ? 1 : 0; // the sender line is the first tappable part
        const picks = q.msg.fromFlag ? [0] : [];
        q.msg.bubbles.forEach((bb) => bb.forEach((s) => { if (s.flag) picks.push(k); k++; }));
        for (const p of picks) await pg.locator('.seg').nth(p).click();
      } else if (q.type === 'sort') {
        for (const c of q.cards) await pg.click(c.scam ? '.sortbtn.scam' : '.sortbtn.safe');
      } else if (q.type === 'reply') {
        await pg.locator('.reply').nth(q.answer).click();
      } else {
        await pg.locator('.pick').nth(q.answer).click();
      }
      await pg.locator('#nav .btn').last().click();
    }
    if (await pg.locator('.faces').count()) {
      await pg.locator('.faces .chip').nth(4).click();
      await pg.locator('.words .chip').first().click();
      await pg.locator('#nav .btn').click();
    }
    await pg.locator('.result').waitFor();
    return pg.locator('.code strong').textContent();
  }

  // ---- MW phone A ----
  const A = await phone('A');
  await A.goto(site + 'index.html');
  const idA = await doQuiz(A);
  ok(await A.locator('.saved').count() === 1, `phone A: result saved to server (${idA})`);
  await A.screenshot({ path: out + '/mw-result.png', fullPage: true });

  // ---- MW phone B starts with the SAME ID as A (forced clash) ----
  const B = await phone('B');
  await B.goto(site + 'index.html');
  await B.evaluate((id) => localStorage.setItem('scamquiz.v1', JSON.stringify({ id, key: 'ab'.repeat(16), attempts: 0 })), idA);
  await B.reload();
  const idB = await doQuiz(B);
  ok(idB !== idA && await B.locator('.saved').count() === 1, `phone B: clash detected, new ID issued and saved (${idA} -> ${idB})`);

  // ---- MW phone C: no connection, then retry ----
  const Cp = await phone('C');
  await Cp.goto(site + 'index.html');
  await Cp.route(api + '/**', (r) => r.abort());
  await doQuiz(Cp);
  ok(await Cp.locator('.notice').count() === 1, 'phone C offline: shows "not saved yet" with Retry');
  await Cp.unroute(api + '/**');
  await Cp.click('text=Retry saving');
  await Cp.locator('.saved').waitFor();
  ok(true, 'phone C: retry saves once back online');

  // ---- admins ----
  async function admin(email) {
    const pg = await phone(email);
    await pg.goto(site + 'admin/index.html');
    await pg.fill('#email', email); await pg.fill('#password', ADMIN_PW);
    await pg.click('#loginForm button');
    await pg.locator('#v-home').waitFor();
    await pg.waitForFunction(() => /live/.test(document.getElementById('live').textContent));
    return pg;
  }
  const bad = await phone('bad');
  await bad.goto(site + 'admin/index.html');
  await bad.fill('#email', 'mallory@mom.gov.sg'); await bad.fill('#password', ADMIN_PW); await bad.click('#loginForm button');
  await bad.locator('#loginErr').waitFor();
  ok(/Wrong login/.test(await bad.locator('#loginErr').textContent()), 'unlisted email cannot log in');

  const alice = await admin('alice@mom.gov.sg'), bob = await admin('bob@mom.gov.sg');
  ok(await alice.locator('.bigbtn').count() === 3, 'after login: menu with Scan QR, Manual input and Report a problem');
  ok((await alice.locator('#left').textContent()) === '500', 'live counter shows 500 left');
  await alice.screenshot({ path: out + '/admin-home.png', fullPage: true });

  const typeCode = async (pg, code) => {
    await pg.fill('#typed', code); await pg.click('#typeForm button');
    await pg.waitForFunction(() => !document.getElementById('verdict').hidden && document.querySelector('#verdict .big'));
    return pg.locator('#verdict .big').textContent();
  };
  await alice.click('text=Scan QR');
  ok(await typeCode(alice, idA) === 'All correct', 'alice: typed code shows All correct');
  await alice.click('text=Souvenir given');
  await alice.waitForFunction(() => /Recorded|Already|left|Not/.test(document.querySelector('#verdict .big').textContent));
  ok((await alice.locator('#verdict .big').textContent()) === 'Recorded ✓', 'alice: souvenir recorded');
  ok((await alice.locator('#left').textContent()) === '499', 'alice: counter updates at once (499)');
  await bob.waitForFunction(() => document.getElementById('left').textContent === '499', null, { timeout: 8000 });
  ok(true, "bob's counter updates live without any action (499)");

  await bob.click('text=Scan QR');
  ok(await typeCode(bob, idA) === 'Already given', 'bob: same code shows Already given');
  ok(/alice@mom\.gov\.sg/.test(await bob.locator('#verdict .detail').textContent()), 'bob is told alice gave it');
  await bob.screenshot({ path: out + '/admin-already.png', fullPage: true });

  // QR photo of phone B
  await B.locator('.qr').screenshot({ path: out + '/qrB.png' });
  await alice.click('#verdict >> text=Scan next');
  await alice.setInputFiles('#file', out + '/qrB.png');
  await alice.waitForFunction(() => /All correct/.test(document.querySelector('#verdict .big').textContent));
  ok(true, 'alice: QR photo of phone B decodes and shows All correct');
  await alice.click('text=Souvenir given');
  await alice.waitForFunction(() => /Recorded/.test(document.querySelector('#verdict .big').textContent));

  // manual path
  await bob.goto(site + 'admin/index.html#manual');
  await bob.locator('#v-manual').waitFor();
  ok(await bob.locator('.mq li').count() === 3 && await bob.locator('.mq .expect').count() === 3, 'manual page lists 3 questions with their answers, as a guide');
  ok(await bob.locator('.mq button').count() === 0 && !(await bob.locator('#manualSubmit').isDisabled()), 'no marking: one button records the claim');
  await bob.click('#manualSubmit');
  await bob.waitForFunction(() => /Give a souvenir/.test((document.querySelector('#mverdict .big') || {}).textContent));
  ok(true, 'officer satisfied: give a souvenir');
  await bob.screenshot({ path: out + '/admin-manual.png', fullPage: true });
  await bob.click('text=Next person');
  await bob.click('#manualSubmit');
  await bob.waitForFunction(() => /Give a souvenir/.test((document.querySelector('#mverdict .big') || {}).textContent));
  ok(true, 'next person is a new claim, not treated as a duplicate');
  await alice.waitForFunction(() => document.getElementById('left').textContent === '496', null, { timeout: 8000 });
  ok(true, "alice's counter reflects bob's manual claims live (496)");

  // admin loses the server
  await alice.route(api + '/**', (r) => r.abort());
  await alice.click('#verdict >> text=Scan next');
  ok(await typeCode(alice, idB) === 'Not checked', 'server unreachable: scan says Not checked, no give button');
  await alice.waitForFunction(() => /offline/.test(document.getElementById('live').textContent), null, { timeout: 20000 });
  ok(true, 'counter turns to "offline: do not give souvenirs"');
  await alice.screenshot({ path: out + '/admin-offline.png', fullPage: true });

  // bug report from the officer page, with a real (tall, full-page) screenshot
  await bob.goto(site + 'admin/index.html#bug');
  await bob.locator('#bugForm').waitFor();
  ok(/personal details/.test(await bob.locator('#v-bug .warn').textContent()), 'bug form warns against personal details in screenshots');
  await bob.selectOption('#bugScreen', 'Mini-site: quiz');
  await bob.fill('#bugText', 'Test report: the quiz froze after question 3 on my Android phone.');
  await bob.setInputFiles('#bugFiles', [out + '/admin-manual.png']);
  await bob.locator('#bugThumbs img').waitFor();
  const shrunk = await bob.evaluate(() => document.querySelector('#bugThumbs img').src);
  ok(/^data:image\/jpeg/.test(shrunk) && shrunk.length < 780000, `screenshot shrunk on the phone before upload (${Math.round(shrunk.length / 1024)} KB as text)`);
  await bob.click('#bugSend');
  await bob.waitForFunction(() => /Report #\d+ sent/.test((document.querySelector('#bverdict') || {}).textContent || ''));
  const bugNo = (await bob.locator('#bverdict').textContent()).match(/Report #(\d+)/)[1];
  ok(true, 'officer sends a bug report with a screenshot (#' + bugNo + ')');
  await bob.screenshot({ path: out + '/admin-bug.png', fullPage: true });

  // ---- superadmin ----
  const sup = await phone('super');
  await sup.setViewportSize({ width: 1100, height: 900 });
  await sup.goto(site + 'superadmin/index.html');
  await sup.fill('#username', SUPER_USER); await sup.fill('#password', ADMIN_PW); await sup.click('#loginForm button');
  await sup.locator('#loginErr').waitFor();
  ok(true, 'superadmin login refuses the admin password');
  await sup.fill('#password', SUPER_PW); await sup.click('#loginForm button');
  await sup.waitForFunction(() => document.querySelectorAll('.tile').length === 9);
  const tiles = await sup.locator('.tile').allInnerTexts();
  ok(/4 \/ 500/.test(tiles[0]) && /2 via manual/.test(tiles[0]), 'dashboard: souvenirs given 4 / 500, 2 via manual');
  ok(/^Quiz submissions\s+5\s/.test(tiles[1]), 'dashboard: 5 quiz submissions (3 phones + 2 manual)');
  ok(/^Database\s+Awake\s+responded in \d+ ms/.test(tiles[8]), 'dashboard: database indicator says awake, with response time (' + tiles[8].replace(/\s+/g, ' ') + ')');
  ok(!/Database|responded in/.test(await alice.locator('body').innerText()), 'officers do not see the database indicator');
  ok(await sup.locator('#lineChart path').count() === 2 && await sup.locator('#csatChart path').count() >= 1, 'line chart (2 series) and satisfaction chart render');
  await sup.locator('#lineChart rect').hover();
  ok(!(await sup.locator('#tip').isHidden()), 'hover shows tooltip');
  await sup.screenshot({ path: out + '/superadmin-dash.png', fullPage: true });

  await sup.click('[data-tab="admins"]');
  fs.writeFileSync(out + '/admins.csv', 'Name,Email\r\n"Dan","Dan@MOM.gov.sg"\r\nEve,eve@mom.gov.sg\r\nno email here,\r\n');
  await sup.setInputFiles('#csv', out + '/admins.csv');
  await sup.waitForFunction(() => !document.getElementById('preview').hidden);
  ok(/2 email address/.test(await sup.locator('#previewText').textContent()), 'CSV preview finds 2 emails');
  await sup.click('#uploadBtn');
  await sup.waitForFunction(() => document.getElementById('adminCount').textContent === '4');
  ok(true, 'upload (add mode): 4 admins listed');
  await sup.screenshot({ path: out + '/superadmin-admins.png', fullPage: true });

  await sup.click('[data-tab="data"]');
  const [dl] = await Promise.all([sup.waitForEvent('download'), sup.click('[data-export="claims"]')]);
  await dl.saveAs(out + '/claims.csv');
  const csv = fs.readFileSync(out + '/claims.csv', 'utf8');
  ok(csv.includes(idA) && csv.split('\r\n').length === 6, 'claims CSV downloads (5 claims + header)');

  await sup.click('[data-tab="bugs"]');
  const card = sup.locator('.bug', { hasText: '#' + bugNo + ' · Mini-site: quiz' });
  await card.waitFor();
  ok(/bob@mom\.gov\.sg/.test(await card.textContent()) && /froze after question 3/.test(await card.textContent()) && /New/.test(await card.locator('.badge').textContent()),
    'bug log shows the report: officer, description, status New');
  await sup.waitForFunction((n) => { const c = [...document.querySelectorAll('.bug')].find((x) => x.textContent.includes('#' + n + ' ·')); const i = c && c.querySelector('.bugshots img'); return i && i.complete && i.naturalWidth > 0; }, bugNo);
  ok(true, 'bug log shows the screenshot');
  await card.locator('select').selectOption('fixed');
  await sup.waitForFunction((n) => { const c = [...document.querySelectorAll('.bug')].find((x) => x.textContent.includes('#' + n + ' ·')); return c && /Fixed/.test(c.querySelector('.badge').textContent) && /min\)/.test(c.textContent); }, bugNo);
  ok(/\d+ fixed/.test(await sup.locator('#bugSummary').textContent()), 'superadmin can mark it fixed; time to fix and summary shown');
  await sup.screenshot({ path: out + '/superadmin-bugs.png', fullPage: true });

  ok(!errs.length, 'no page errors ' + (errs.length ? JSON.stringify(errs) : ''));
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
