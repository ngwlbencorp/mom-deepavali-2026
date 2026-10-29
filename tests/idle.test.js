// The officer page's live counter slows down when nobody uses the page, to save Vercel requests.
// Usage: node tests/idle.test.js <officer page URL> <adminPw>   (e.g. http://127.0.0.1:8832/admin/index.html)
const { chromium } = require('playwright');
const [url, ADMIN_PW] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(), pg = await b.newPage();
  await pg.addInitScript(() => { window.ADMIN_POLL_TEST = { idleAfter: 3000, idlePoll: 20000 }; });
  const polls = [];
  pg.on('request', (r) => { if (/\/api\/stats/.test(r.url())) polls.push(Date.now()); });
  await pg.goto(url);
  await pg.fill('#email', 'alice@mom.gov.sg'); await pg.fill('#password', ADMIN_PW); await pg.click('#loginForm button');
  await pg.locator('#v-home').waitFor();
  await pg.waitForTimeout(8000);
  const t1 = Date.now(), n1 = polls.length;
  await pg.waitForTimeout(12000);
  const idleCount = polls.filter((t) => t > t1).length;
  ok(idleCount === 0, `idle: no counter refresh in 12 s once idle (was every 5 s); got ${idleCount}`);
  ok(!/offline/.test(await pg.locator('#live').textContent()), 'idle: the counter does not falsely show offline');
  const t2 = Date.now();
  await pg.mouse.click(5, 5);
  await pg.waitForTimeout(1500);
  ok(polls.some((t) => t > t2), 'a tap brings the counter back at once');
  const t3 = Date.now();
  await pg.waitForTimeout(5500);
  ok(polls.filter((t) => t > t3).length >= 1, 'then refreshes every 5 s again');
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
