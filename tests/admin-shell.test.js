// Checks the officer page loaded through the ducks.ai shell (tools/build-shell.js --admin).
// Usage: node tests/admin-shell.test.js <adminShell> <deadShell> <overlayShell> <adminPw>
//   adminShell:   unpacked ducks-admin-shell.zip whose base is a running copy of the site (with CORS)
//   deadShell:    the same with base pointing at a port nothing listens on
//   overlayShell: the same as adminShell with hostOverlay: true in config.js (as on ducks.ai)
// Run tests/e2e-server.js with ADMIN_URL=<adminShell>index.html too: the whole officer flow.
// The camera is simulated (Chromium's fake camera): real phones still need a manual check.
const { chromium } = require('playwright');
const [shell, dead, overlay, ADMIN_PW] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
  let pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(shell + 'index.html');
  await pg.locator('#loginForm').waitFor();
  ok(await pg.evaluate(() => window.SITE_SHELL && window.SITE_SHELL.source === 'remote' && window.SITE_SHELL.page === 'admin/index.html'), 'officer page loaded through the shell');
  ok((await pg.title()) === 'Souvenir Station' && !/vercel/i.test(await pg.locator('body').innerText()), 'title is the officer page\'s; no mention of Vercel on screen');
  await pg.fill('#email', 'alice@mom.gov.sg'); await pg.fill('#password', ADMIN_PW); await pg.click('#loginForm button');
  await pg.locator('#v-home').waitFor();
  await pg.click('a[href="#scan"]');
  await pg.waitForFunction(() => { const v = document.getElementById('video'); return v && v.videoWidth > 0 && !v.paused; }, null, { timeout: 10000 });
  ok(true, 'camera starts in the shell page (simulated camera)');
  await pg.click('a[href="#home"], .linkbtn[href="#home"]').catch(() => {});
  await ctx.close();

  // ducks.ai's buttons: header makes room
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 } });
  pg = await ctx2.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(overlay + 'index.html');
  await pg.locator('#loginForm').waitFor();
  const pad = await pg.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.top.slim')).paddingTop));
  ok(await pg.evaluate(() => document.documentElement.classList.contains('on-ducks')) && pad >= 60, `on ducks.ai the header leaves room for ducks.ai's buttons (${pad}px)`);
  await ctx2.close();

  // server unreachable
  const ctx3 = await b.newContext();
  pg = await ctx3.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(dead + 'index.html');
  await pg.waitForFunction(() => /Cannot reach the server/.test(document.body.textContent), null, { timeout: 10000 });
  ok(!/vercel/i.test(await pg.locator('body').innerText()), 'server unreachable: plain message, no mention of Vercel');
  await ctx3.close();

  ok(!errs.length, 'no page errors ' + (errs.length ? JSON.stringify(errs) : ''));
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
