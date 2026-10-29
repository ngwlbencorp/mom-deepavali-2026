// iOS Safari zooms in when a form control under 16px gets focus, and does not zoom back out.
// Checks every visible input, select and textarea on the officer and superadmin pages, in every view.
// Usage: node tests/zoom.test.js <siteBase> <adminPw> <superUser> <superPw>   (site copy pointing at a running API)
const { chromium } = require('playwright');
const [site, ADMIN_PW, SUPER_USER, SUPER_PW] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  async function check(name) {
    const small = await pg.evaluate(() => [...document.querySelectorAll('input, select, textarea')]
      .filter((el) => el.offsetParent !== null || el.type === 'file')
      .map((el) => ({ id: el.id || el.name || el.type || el.tagName, px: parseFloat(getComputedStyle(el).fontSize) }))
      .filter((x) => x.px < 16));
    ok(!small.length, `${name}: every form control is at least 16px` + (small.length ? ' (' + JSON.stringify(small) + ')' : ''));
  }
  await pg.goto(site + 'admin/index.html');
  await pg.locator('#loginForm').waitFor();
  await check('officer login');
  await pg.fill('#email', 'alice@mom.gov.sg'); await pg.fill('#password', ADMIN_PW); await pg.click('#loginForm button');
  await pg.locator('#v-home:not([hidden])').waitFor();
  for (const view of ['scan', 'manual', 'bug']) {
    await pg.evaluate((v) => { location.hash = '#' + v; }, view);
    await pg.locator(`#v-${view}:not([hidden])`).waitFor();
    await check('officer ' + view);
  }
  await pg.goto(site + 'superadmin/index.html');
  await pg.locator('#username').waitFor();
  await check('superadmin login');
  await pg.fill('#username', SUPER_USER); await pg.fill('#password', SUPER_PW); await pg.click('#loginForm button');
  for (const t of ['admins', 'data', 'bugs']) {
    await pg.click(`[data-tab="${t}"]`);
    await pg.waitForTimeout(800);
    await check('superadmin ' + t);
  }
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
