// ducks.ai adds a "presenter gate" for slide decks to every hosted page: it cancels every n and t
// key press unless the tab is in presenter mode, and presenter mode shows ducks.ai's "edit text"
// button. The officer page must keep presenter mode off and still let officers type n and t.
// Usage: node tests/gate.test.js <officer shell URL with ducks.ai's scripts> <adminPw>
//   The URL should look like ducks.ai's: /p/<page>/ with the gate script (tests/fixtures/ducks-gate.html)
//   in its head and ducks.ai's /shared/deck-home.js loaded, so the real "edit text" logic runs.
const { chromium, devices } = require('playwright');
const [url, ADMIN_PW] = process.argv.slice(2);
const slug = new URL(url).pathname.split('/')[2] || '';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  for (const [name, opts] of [['desktop', { viewport: { width: 1200, height: 800 } }], ['iPhone', devices['iPhone 13']]]) {
    const ctx = await b.newContext(opts), pg = await ctx.newPage();
    // a tab where an earlier version of the page had switched presenter mode on
    await pg.addInitScript((k) => { if (!sessionStorage.getItem('seen')) { sessionStorage.setItem(k, '1'); sessionStorage.setItem('seen', '1'); } }, 'ducks-presenter:' + slug);
    await pg.goto(url); await pg.locator('#email').waitFor();
    ok(await pg.evaluate((k) => sessionStorage.getItem(k), 'ducks-presenter:' + slug) === null, `${name}: the page clears presenter mode left by the earlier version`);
    await pg.reload(); await pg.locator('#email').waitFor(); await pg.waitForTimeout(1500);
    ok(await pg.evaluate(() => document.documentElement.dataset.ducksOwnerGate) === 'locked', `${name}: presenter mode stays off (gate active)`);
    const chip = await pg.evaluate(() => { const e = document.getElementById('ducks-edit-text'); return e ? getComputedStyle(e).display : 'none'; });
    ok(chip === 'none', `${name}: no "edit text" button`);
    await pg.click('#email'); await pg.keyboard.type('Nat.Tan@mom.gov.sg');
    ok(await pg.inputValue('#email') === 'Nat.Tan@mom.gov.sg', `${name}: email keeps its n and t (got "${await pg.inputValue('#email')}")`);
    await pg.click('#password'); await pg.keyboard.type('tnTN');
    ok(await pg.inputValue('#password') === 'tnTN', `${name}: password keeps its n and t`);
    await pg.fill('#email', 'alice@mom.gov.sg'); await pg.fill('#password', ADMIN_PW); await pg.click('#loginForm button');
    await pg.locator('#v-home').waitFor();
    await pg.click('a[href="#scan"]'); await pg.click('#typed'); await pg.keyboard.type('TN23ABCD');
    ok(await pg.inputValue('#typed') === 'TN23ABCD', `${name}: typed code keeps its T and N`);
    await pg.click('a[href="#home"]').catch(() => {}); await pg.evaluate(() => { location.hash = '#bug'; });
    await pg.click('#bugText'); await pg.keyboard.type('Nothing to tap');
    ok(await pg.inputValue('#bugText') === 'Nothing to tap', `${name}: bug report keeps its n and t`);
    await ctx.close();
  }
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
