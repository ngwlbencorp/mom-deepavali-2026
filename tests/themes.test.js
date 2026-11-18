// Event themes (css/event-themes.css, js/event-themes.js): for 'deepavali', 'neutral' and 'christmas'
// checks text contrast (WCAG AA), that home, a quiz screen and the result screen fit a phone with no
// scrolling at 320x568, 360x640 and 390x844, that 'deepavali' renders pixel-identical to the page
// without theme files, that reduced motion stops every animation, and how apply() behaves.
// Usage: node tests/themes.test.js [screenshotDir]
// Self-contained: serves this repository on 127.0.0.1 and answers the API from a stub inside the
// browser (js/config.js is rewritten to a fake address), so nothing reaches the live API.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2];
const THEMES = ['deepavali', 'neutral', 'christmas'];
const SIZES = [[320, 568], [360, 640], [390, 844]];
const API = 'http://api.test';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

// ---------- local site ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const THEME_TAGS = /\s*<link[^>]*event-themes\.css[^>]*>|\s*<script[^>]*event-themes\.js[^>]*><\/script>/g;
function page(themed) {
  // plain: the page exactly as before themes existed; themed: the page plus the theme files
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(THEME_TAGS, '');
  if (themed) {
    html = html.replace('</head>', '<link rel="stylesheet" href="./css/event-themes.css">\n</head>')
      .replace('<script src="./js/app.js"></script>', '<script src="./js/event-themes.js"></script>\n  <script src="./js/app.js"></script>');
  }
  return html;
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let body, file = url.pathname;
  if (file === '/plain.html' || file === '/themed.html') body = page(file === '/themed.html');
  else if (file === '/js/config.js') body = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/apiBase:\s*'[^']*'/, `apiBase: '${API}'`);
  else {
    const p = path.normalize(path.join(ROOT, file));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    body = fs.readFileSync(p);
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
});

// ---------- API stub: event open with souvenirs left, every save succeeds ----------
async function stub(ctx, base) {
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (!u.startsWith(API)) return route.abort();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const p = new URL(u).pathname;
    const body = p === '/api/remaining' ? { open: true, capRemaining: 123 } : p === '/api/submit' ? { attempts: 1, firstFull: 1, redeemed: false } : {};
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  });
}

// ---------- checks run in the page ----------
function fitCheck() {
  const d = document.documentElement, m = document.getElementById('app');
  const foot = m.querySelector('.legal'), allow = foot ? foot.offsetHeight + 8 : 0; // the home footer may sit below the fold
  const inner = [...document.querySelectorAll('.phone-body')].some((x) => x.scrollHeight > x.clientHeight + 1);
  const wide = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed'; }).length;
  return { pageY: d.scrollHeight > innerHeight + 1, pageX: d.scrollWidth > innerWidth + 1, main: m.scrollHeight - allow > m.clientHeight + 1, inner, wide };
}
// Every visible text run against the colour actually behind it (backgrounds composited up the
// tree, opacity blended in). Disabled controls are exempt (WCAG 1.4.3), as is hidden text.
function contrastCheck() {
  const rgba = (s) => { const m = s.match(/[\d.]+/g) || [0, 0, 0, 0]; return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]]; };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
  const lum = (c) => { const v = c.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  function behind(el) {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none' && !/url\(/.test(cs.backgroundImage)) return null; // gradient: not measured
      const c = rgba(cs.backgroundColor);
      if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    return layers.reverse().reduce((acc, c) => over(c, acc), [255, 255, 255, 1]);
  }
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (el.closest('[aria-hidden="true"], :disabled, svg, [hidden]') || !el.getClientRects().length) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible') continue;
    let op = 1;
    for (let n = el; n; n = n.parentElement) op *= +getComputedStyle(n).opacity;
    if (op < 0.1) continue;
    const bg = behind(el);
    if (!bg) continue;
    const fg = rgba(cs.color); fg[3] *= op;
    const f = over(fg, bg), a = lum(f), b = lum(bg);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(cs.fontSize), large = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
    out.push({ text: el.textContent.trim().slice(0, 30), cls: el.className && String(el.className), ratio: Math.round(ratio * 100) / 100, need: large ? 3 : 4.5 });
  }
  return out;
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const b = await chromium.launch(), errs = [];
  if (OUT) fs.mkdirSync(OUT, { recursive: true });

  async function open(file, theme, W, H, opts = {}) {
    const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: opts.motion ? 'no-preference' : 'reduce' });
    await stub(ctx, base);
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(e.message));
    pg.ctx = ctx;
    await pg.goto(base + file);
    await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('scamsite.lang', 'en'); });
    if (opts.result) {
      // a saved full score, so the result screen shows its QR code, claim code and "saved" line
      await pg.evaluate(() => {
        const total = window.SCAM_TEXT.en.quiz.reduce((s, q) => s + (q.type === 'sort' ? q.cards.length : 1), 0);
        localStorage.setItem('scamquiz.v1', JSON.stringify({ id: 'K7QD2M9X', key: 'ab'.repeat(16), attempts: 1, firstFull: 1, registered: true, pending: false, feedbackDone: true, csat: 5, learned: 'yes', last: { score: total, total, answers: [], language: 'en' } }));
      });
    }
    await pg.reload();
    await pg.locator('#app h1').waitFor();
    if (theme) await pg.evaluate((t) => window.EventThemes.apply(t), theme);
    if (opts.result) {
      await pg.locator('#leftPill:not([hidden])').waitFor(); // the stubbed "souvenirs left" has arrived
      await pg.click('#app .linkbtn');
      await pg.locator('.result .qr').waitFor();
    }
    if (opts.quiz) { await pg.click('.tile.alt'); await pg.locator('.seg').first().waitFor(); }
    await pg.waitForTimeout(400);
    return pg;
  }
  const screens = [['home', {}], ['quiz', { quiz: true }], ['result', { result: true }]];

  // ---------- 1. fit and contrast, every theme, size and screen ----------
  for (const theme of THEMES) {
    for (const [W, H] of SIZES) {
      for (const [name, opts] of screens) {
        const pg = await open('themed.html', theme, W, H, opts);
        const want = theme === 'deepavali' ? null : theme;
        ok(await pg.evaluate(() => document.documentElement.getAttribute('data-event-theme')) === want, `${theme} ${W}x${H} ${name}: theme attribute set`);
        const r = await pg.evaluate(fitCheck);
        ok(!r.pageY && !r.pageX && !r.main && !r.inner && !r.wide, `${theme} ${W}x${H} ${name}: fits without scrolling` + (r.pageY || r.pageX || r.main || r.inner || r.wide ? ' ' + JSON.stringify(r) : ''));
        const bad = (await pg.evaluate(contrastCheck)).filter((x) => x.ratio < x.need);
        ok(!bad.length, `${theme} ${W}x${H} ${name}: text contrast meets WCAG AA` + (bad.length ? ' ' + JSON.stringify(bad) : ''));
        if (OUT && W === 360) await pg.screenshot({ path: path.join(OUT, `${theme}-360x640-${name}.png`), animations: 'disabled' });
        await pg.ctx.close();
      }
    }
  }

  // ---------- 2. contrast of the theme colours themselves (pairs the pages use) ----------
  {
    const pg = await open('themed.html', null, 360, 640);
    for (const theme of THEMES) {
      const pairs = await pg.evaluate((t) => {
        window.EventThemes.apply(t);
        const cs = getComputedStyle(document.documentElement), v = (n) => cs.getPropertyValue(n).trim();
        const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
        const cr = (a, b) => { const x = lum(a), y = lum(b); return Math.round((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) * 100) / 100; };
        return {
          'white on --plum (buttons, tiles)': cr('#ffffff', v('--plum')), '--plum on --card (headings)': cr(v('--plum'), v('--card')),
          '--plum on --bg': cr(v('--plum'), v('--bg')), '--plum on --gold-soft (secondary buttons)': cr(v('--plum'), v('--gold-soft')),
          '--plum-2 on --card (eyebrow, links)': cr(v('--plum-2'), v('--card')), '--ink on --bg (body text)': cr(v('--ink'), v('--bg')),
          '--muted on --bg (notes)': cr(v('--muted'), v('--bg')), '--muted on --card': cr(v('--muted'), v('--card'))
        };
      }, theme);
      for (const [k, r] of Object.entries(pairs)) ok(r >= 4.5, `${theme}: ${k} ${r}:1 (needs 4.5)`);
    }
    await pg.ctx.close();
  }

  // ---------- 3. deepavali is pixel-identical to the page without theme files ----------
  for (const [name, opts] of screens) {
    const shot = async (file, run) => {
      const pg = await open(file, null, 360, 640, opts);
      if (run) await pg.evaluate(run);
      // the page settles first: shoot until two shots in a row match (as Playwright's own
      // screenshot assertions do), so a late repaint cannot cause a false difference
      let png = await pg.screenshot({ animations: 'disabled' });
      for (let i = 0; i < 10; i++) {
        await pg.waitForTimeout(250);
        const again = await pg.screenshot({ animations: 'disabled' });
        if (again.equals(png)) break;
        png = again;
      }
      await pg.ctx.close();
      return png;
    };
    // The result screen's rounded edges can rasterise a pixel or two differently from one load
    // to the next even without theme files (plain against plain). So each check passes when a
    // themed load matches any plain load byte for byte, trying up to three loads of each.
    const plains = [await shot('plain.html')];
    async function same(file, run) {
      for (let i = 0; i < 3; i++) {
        const png = await shot(file, run);
        if (plains.some((p) => p.equals(png))) return true;
        if (plains.length < 3) plains.push(await shot('plain.html'));
        if (plains.some((p) => p.equals(png))) return true;
      }
      return false;
    }
    ok(await same('themed.html', () => window.EventThemes.apply('deepavali')), `${name}: 'deepavali' is pixel-identical to no theme files`);
    ok(await same('themed.html', () => { const E = window.EventThemes; E.apply('christmas'); E.apply('neutral'); E.apply('deepavali'); }), `${name}: christmas -> neutral -> deepavali is pixel-identical to no theme files`);
    ok(await same('themed.html', () => { window.EventThemes.apply('neutral'); window.EventThemes.apply('halloween'); }), `${name}: an unknown theme name falls back to the original look`);
    ok(!(await same('themed.html', () => window.EventThemes.apply('neutral'))), `${name}: control: 'neutral' does differ from no theme files`);
  }

  // ---------- 4. reduced motion stops every animation; with motion, the icons animate ----------
  for (const theme of THEMES) {
    for (const [name, opts] of [['home', {}], ['quiz', { quiz: true }]]) {
      const pg = await open('themed.html', theme, 360, 640, opts);
      await pg.waitForTimeout(800);
      const running = await pg.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName || a.transitionProperty || 'anim'));
      ok(!running.length, `${theme} ${name}: reduced motion, no animation running` + (running.length ? ' ' + JSON.stringify(running) : ''));
      await pg.ctx.close();
    }
    const pg = await open('themed.html', theme, 360, 640, { motion: true });
    const names = await pg.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName));
    const expect = { deepavali: 'flicker', neutral: null, christmas: 'evtTwinkle' }[theme];
    ok(expect ? names.includes(expect) : !names.length, `${theme}: with motion allowed, icon animation is ${expect || 'none'} (${JSON.stringify(names)})`);
    await pg.ctx.close();
  }

  // ---------- 5. apply(): motifs, idempotence, before render, strict-CSP friendliness ----------
  {
    const pg = await open('themed.html', null, 360, 640);
    const r = await pg.evaluate(async () => {
      const E = window.EventThemes, btn = document.getElementById('homeBtn');
      E.apply('deepavali'); // app.js may already have applied a theme of its own
      const orig = btn.querySelector('svg'), meta = document.querySelector('meta[name="theme-color"]'), color0 = meta.content;
      const res = { start: !!orig.querySelector('.flame') && color0 === '#4a1d5e' };
      E.apply('neutral'); E.apply('neutral');
      res.neutral = btn.querySelectorAll('svg').length === 1 && btn.querySelector('svg.evt-motif[data-motif="neutral"]') !== null;
      E.apply('christmas');
      res.christmas = btn.querySelectorAll('svg').length === 1 && btn.querySelector('svg.evt-motif[data-motif="christmas"]') !== null && meta.content !== color0;
      res.noStyleAttr = !btn.querySelector('[style]');
      res.noDeepavaliShapes = !btn.querySelector('.flame, .lamp');
      res.ret = [E.apply('neutral'), E.apply('nonsense'), E.apply(undefined)];
      res.restored = btn.querySelector('svg') === orig && !document.documentElement.hasAttribute('data-event-theme') && meta.content === color0;
      // before render: a document with no icon yet (as through the ducks.ai shell), icon added later
      const doc = document.implementation.createHTMLDocument('t');
      E.apply('christmas', doc);
      const b2 = doc.createElement('button'); b2.className = 'iconbtn';
      b2.appendChild(doc.createElementNS('http://www.w3.org/2000/svg', 'svg'));
      doc.body.appendChild(b2);
      await new Promise((r) => setTimeout(r, 50));
      res.later = doc.documentElement.dataset.eventTheme === 'christmas' && !!b2.querySelector('svg.evt-motif[data-motif="christmas"]');
      E.apply('deepavali', doc);
      res.laterBack = !b2.querySelector('.evt-motif') && b2.querySelectorAll('svg').length === 1 && !doc.documentElement.hasAttribute('data-event-theme');
      return res;
    });
    ok(r.start, 'apply(deepavali): the original lamp icon and browser bar colour');
    ok(r.neutral, 'apply(neutral) twice: one shield icon in the Home button');
    ok(r.christmas, 'apply(christmas): tree icon replaces it, browser bar colour follows');
    ok(r.noStyleAttr && r.noDeepavaliShapes, 'theme icons use no style attributes and no lamp or flame shapes');
    ok(JSON.stringify(r.ret) === '["neutral","deepavali","deepavali"]', 'apply returns the theme used; unknown names give deepavali');
    ok(r.restored, 'back to deepavali: the original icon element, no attribute, original browser bar colour');
    ok(r.later, 'apply before render: icon swapped once it appears');
    ok(r.laterBack, 'and switched back to the original afterwards');
    await pg.ctx.close();
  }

  ok(!errs.length, 'no page errors ' + (errs.length ? JSON.stringify(errs) : ''));
  await b.close();
  server.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
