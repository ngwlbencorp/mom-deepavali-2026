// Event cutoff and sold-out checks.
// Usage: node tests/event.test.js <closedApi> <soldOutApi> <siteClosedClock> <siteOpenClock> <siteSoldOut> <adminPw>
//   closedApi:       API started with EVENT_END in the past
//   soldOutApi:      API that is open but has no souvenirs left
//   siteClosedClock: site copy whose js/config.js eventEnd is in the past, apiBase = an unreachable server
//   siteOpenClock:   site copy whose eventEnd is in the future, apiBase = closedApi (server must win)
//   siteSoldOut:     site copy whose eventEnd is in the future, apiBase = soldOutApi
const { chromium } = require('playwright');
const [closedApi, soldApi, siteClosed, siteOpen, siteSold, ADMIN_PW] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const call = (base, path, body, token) => fetch(base + path, {
  method: body ? 'POST' : 'GET',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
  body: body ? JSON.stringify(body) : undefined
}).then(async (r) => ({ status: r.status, body: await r.json() }));

(async () => {
  // ---- server side ----
  const rem = await call(closedApi, '/api/remaining');
  ok(rem.status === 200 && rem.body.open === false, 'closed API: /api/remaining says open = false');
  const tok = (await call(closedApi, '/api/login', { role: 'admin', email: 'alice@mom.gov.sg', password: ADMIN_PW })).body.token;
  ok(!!tok, 'closed API: admins can still log in');
  const r1 = await call(closedApi, '/api/redeem', { id: 'ABCDEFGH' }, tok);
  ok(r1.status === 403 && r1.body.error === 'event_closed', 'closed API: redeem refused with event_closed');
  const r2 = await call(closedApi, '/api/manual', { answers: [true, true, true] }, tok);
  ok(r2.status === 403 && r2.body.error === 'event_closed', 'closed API: manual claim refused with event_closed');
  const sub = await call(closedApi, '/api/submit', { id: 'EVNT0001', key: 'ab'.repeat(16), score: 9, total: 9 });
  ok(sub.status === 200, 'closed API: quiz submissions are still recorded');
  const sold = await call(soldApi, '/api/remaining');
  ok(sold.body.open === true && sold.body.capRemaining === 0, 'sold-out API: open with 0 left');

  // ---- site side ----
  const b = await chromium.launch(), errs = [];
  async function quizAllCorrect(pg) {
    await pg.click('.tile.alt');
    const quiz = await pg.evaluate(() => window.SCAM_TEXT.en.quiz);
    for (const q of quiz) {
      if (q.type === 'spot') {
        let k = 0; const picks = [];
        q.msg.bubbles.forEach((bb) => bb.forEach((s) => { if (s.flag) picks.push(k); k++; }));
        for (const p of picks) await pg.locator('.seg').nth(p).click();
      } else if (q.type === 'sort') { for (const c of q.cards) await pg.click(c.scam ? '.sortbtn.scam' : '.sortbtn.safe'); }
      else if (q.type === 'reply') await pg.locator('.reply').nth(q.answer).click();
      else await pg.locator('.pick').nth(q.answer).click();
      await pg.locator('#nav .btn').last().click();
    }
    if (await pg.locator('.faces').count()) {
      await pg.locator('.faces .chip').nth(4).click(); await pg.locator('.words .chip').first().click(); await pg.locator('#nav .btn').click();
    }
    await pg.locator('.result').waitFor();
  }
  async function page(url) {
    const pg = await b.newPage({ viewport: { width: 360, height: 640 } });
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(url); await pg.evaluate(() => localStorage.clear()); await pg.reload();
    return pg;
  }
  const noSouvenirText = async (pg) => !/souvenir|QR code|officer/i.test(await pg.locator('#app').innerText());

  // 1) phone clock past the end, server unreachable: phone clock decides
  let pg = await page(siteClosed + 'index.html');
  ok(await pg.locator('.note').count() === 0 && await pg.locator('#leftPill').count() === 0, 'after end (phone clock): home has no souvenir note or count');
  ok((await pg.locator('.tile.alt b').textContent()) === 'Take the quiz', 'after end: quiz tile says "Take the quiz"');
  ok(await noSouvenirText(pg), 'after end: no souvenir wording on home');
  await quizAllCorrect(pg);
  ok(await pg.locator('.qr').count() === 0 && await pg.locator('.code').count() === 0, 'after end: result has no QR code and no claim code');
  ok(/spot scams/.test(await pg.locator('.result').innerText()) && await noSouvenirText(pg), 'after end: result shows a well-done message only');
  await pg.close();

  // 2) phone clock says open, but the server says closed: server wins
  pg = await page(siteOpen + 'index.html');
  await pg.waitForFunction(() => !document.querySelector('.note'), null, { timeout: 8000 });
  ok(await noSouvenirText(pg), 'server says closed: souvenir wording removed even though the phone clock says open');
  await quizAllCorrect(pg);
  ok(await pg.locator('.qr').count() === 0, 'server says closed: no QR code');
  await pg.close();

  // 3) open but sold out: count shows "given out", and the result has no QR code
  pg = await page(siteSold + 'index.html');
  await pg.waitForFunction(() => /given out/.test((document.getElementById('leftPill') || {}).textContent || ''), null, { timeout: 8000 });
  ok(true, 'sold out: home shows "All souvenirs have been given out"');
  await quizAllCorrect(pg);
  ok(await pg.locator('.qr').count() === 0 && /given out/.test(await pg.locator('.result').innerText()), 'sold out: no QR code, sold-out message');
  await pg.close();

  ok(!errs.length, 'no page errors ' + (errs.length ? JSON.stringify(errs) : ''));
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
