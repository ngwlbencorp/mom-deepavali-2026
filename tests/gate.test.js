// ducks.ai adds a "presenter gate" for slide decks to every hosted page: it cancels every n and t
// key press unless the page was opened in presenter mode in this tab. The officer page must turn it
// off, or officers cannot type those letters (emails, password, codes, bug reports).
// Usage: node tests/gate.test.js <officer shell URL with the gate script added> <adminPw>
//   (the gate script, as served by ducks.ai, is in tests/fixtures/ducks-gate.html)
const { chromium, devices } = require('playwright');
const [url, ADMIN_PW] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  for (const [name, opts] of [['desktop', { viewport: { width: 1200, height: 800 } }], ['iPhone', devices['iPhone 13']]]) {
    const ctx = await b.newContext(opts), pg = await ctx.newPage();
    await pg.goto(url);
    await pg.locator('#email').waitFor();
    await pg.waitForTimeout(500); // the page may reload itself once
    await pg.locator('#email').waitFor();
    ok(await pg.evaluate(() => document.documentElement.dataset.ducksOwnerGate) !== 'locked', `${name}: the gate is off on the officer page`);
    await pg.click('#email'); await pg.keyboard.type('nat.tan@mom.gov.sg');
    ok(await pg.inputValue('#email') === 'nat.tan@mom.gov.sg', `${name}: officers can type n and t (got "${await pg.inputValue('#email')}")`);
    await pg.fill('#email', 'alice@mom.gov.sg'); await pg.fill('#password', ADMIN_PW); await pg.click('#loginForm button');
    await pg.locator('#v-home').waitFor();
    await pg.click('a[href="#bug"]'); await pg.click('#bugText'); await pg.keyboard.type('Nothing to tap');
    ok(await pg.inputValue('#bugText') === 'Nothing to tap', `${name}: bug report text keeps its n and t`);
    await ctx.close();
  }
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
