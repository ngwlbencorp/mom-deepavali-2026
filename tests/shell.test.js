// Checks the ducks.ai shell for the mini-site (shell/, built by tools/build-shell.js).
// Usage: node tests/shell.test.js <standIn> <standInDir> <shellRemote> <shellDead> <shellFrozen>
//   standIn:     a copy of the site served with CORS (tests/serve-cors.py), standing in for Vercel;
//                its js/config.js points at a running API
//   standInDir:  that copy's folder (the test edits a file there to show a live change, then restores it)
//   shellRemote: unpacked ducks-site-shell.zip whose config.js base is standIn, with an element
//                <div id="ducks-extra"> added before the shell scripts (stands in for ducks.ai's additions)
//   shellDead:   the same zip with base pointing at a port nothing listens on
//   shellFrozen: unpacked ducks-site-shell-frozen.zip
// Run tests/fit.test.js and tests/nav.test.js against shellRemote as well: the site must behave the same.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const [standIn, standInDir, remote, dead, frozen] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const b = await chromium.launch(), errs = [];
  async function open(url, ctx) {
    const pg = await (ctx || b).newPage({ viewport: { width: 360, height: 640 } });
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(url + 'index.html');
    await pg.locator('#app h1').waitFor({ timeout: 10000 });
    return pg;
  }
  const source = (pg) => pg.evaluate(() => window.SITE_SHELL && window.SITE_SHELL.source);

  // 1) remote: the site comes from the stand-in
  let pg = await open(remote);
  ok(await source(pg) === 'remote', 'remote shell: site loaded from the Vercel stand-in');
  ok(await pg.evaluate((s) => [...document.scripts].some((x) => x.src === s + 'js/app.js'), standIn), 'app.js came from the stand-in, not the bundle');
  ok(await pg.locator('#shell-loading').count() === 0 && await pg.locator('header.bar').count() === 1, 'page structure from index.html is in place; loading text removed');
  ok(await pg.locator('#ducks-extra').count() === 1, "ducks.ai's own additions to the page are left alone");
  ok(await pg.evaluate(() => document.body.className) === 'app' && (await pg.title()) === 'Stay Safe from Scams', 'body class and title copied');
  await pg.close();

  // 2) a change on the stand-in shows on the next visit, with no new upload
  const contentFile = path.join(standInDir, 'js', 'content.js'), original = fs.readFileSync(contentFile, 'utf8');
  try {
    fs.writeFileSync(contentFile, original.replace('title: "Stay safe from scams"', 'title: "Stay safe from scams (updated)"'));
    pg = await open(remote);
    ok(/\(updated\)/.test(await pg.locator('#app h1').textContent()), 'a change pushed to the site appears on the next visit');
    await pg.close();
  } finally { fs.writeFileSync(contentFile, original); }

  // 3) the stand-in is down: the bundled copy is used
  const t0 = Date.now();
  pg = await open(dead);
  ok(await source(pg) === 'fallback' && Date.now() - t0 < 9000, `Vercel unreachable: bundled copy shown (${Date.now() - t0} ms)`);
  await pg.close();

  // 4) the stand-in answers but one of its files fails: the bundled copy is used, after one reload
  const ctx = await b.newContext();
  await ctx.route(standIn + 'js/app.js', (r) => r.fulfill({ status: 404, body: 'gone' }));
  pg = await open(remote, ctx);
  ok(await source(pg) === 'fallback', 'a remote file fails to load: the bundled copy takes over');
  await ctx.close();

  // 5) frozen: never contacts the stand-in
  const ctx2 = await b.newContext(), hits = [];
  ctx2.on('request', (r) => { if (r.url().startsWith(standIn)) hits.push(r.url()); });
  pg = await open(frozen, ctx2);
  ok(await source(pg) === 'local' && hits.length === 0, 'frozen zip: bundled copy, no requests to Vercel');
  await ctx2.close();

  ok(!errs.length, 'no page errors ' + (errs.length ? JSON.stringify(errs) : ''));
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
