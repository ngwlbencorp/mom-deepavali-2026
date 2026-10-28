// Walks every mini-site screen at a given phone size and fails if anything needs scrolling
// (the page, the middle area, or a message mock-up), or if scoring is wrong.
// Usage: node tests/fit.test.js <siteBase> <width> <height> [outDir] [lang]
// For a language other than English, the site copy must load js/lang/<lang>.js.
// The site copy at <siteBase> must have js/config.js pointing at a running API.
const { chromium } = require('playwright');
const [site, W, H, out, LANG] = [process.argv[2], +process.argv[3], +process.argv[4], process.argv[5], process.argv[6] || 'en'];
let fails = 0, shots = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const b = await chromium.launch(), errs = [];
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(e.message));

  async function fits(name) {
    const r = await pg.evaluate(() => {
      const d = document.documentElement, m = document.getElementById('app');
      const inner = [...document.querySelectorAll('.phone-body')].some((x) => x.scrollHeight > x.clientHeight + 1);
      return { pageY: d.scrollHeight > innerHeight + 1, pageX: d.scrollWidth > innerWidth + 1, main: m.scrollHeight > m.clientHeight + 1, inner, over: m.scrollHeight - m.clientHeight };
    });
    const good = !r.pageY && !r.pageX && !r.main && !r.inner;
    ok(good, `${LANG} ${W}x${H} fits without scrolling: ${name}` + (good ? '' : ` (page-y ${r.pageY}, page-x ${r.pageX}, main overflow ${r.over}px, message box ${r.inner})`));
    if (out) await pg.screenshot({ path: `${out}/${LANG}-${W}x${H}-${String(++shots).padStart(2, '0')}-${name.replace(/\W+/g, '_')}.png` });
  }
  const next = () => pg.locator('#nav .btn').last().click();

  await pg.goto(site + 'index.html');
  await pg.evaluate((l) => { localStorage.clear(); localStorage.setItem('scamsite.lang', l); }, LANG);
  await pg.reload();
  ok(await pg.evaluate(() => document.documentElement.lang) === LANG, `page is in ${LANG}`);
  await fits('home');

  // learn: 5 stories x 2 frames
  await pg.click('.tile >> nth=0');
  const frames = await pg.evaluate(() => window.SCAM_TEXT.en.learn.length * 2);
  for (let i = 0; i < frames; i++) {
    await fits('learn frame ' + (i + 1));
    if (i < frames - 1) await next();
  }
  await next(); // "Take the quiz"

  const quiz = await pg.evaluate(() => window.SCAM_TEXT.en.quiz);
  async function answerAll(wrongAt) {
    for (let i = 0; i < quiz.length; i++) {
      const q = quiz[i], wrong = i === wrongAt;
      if (q.type === 'spot') {
        const segs = pg.locator('.seg');
        const flags = q.msg.fromFlag ? [0] : [], others = []; // the sender line is the first tappable part
        let k = q.msg.fromFlag ? 1 : 0;
        q.msg.bubbles.forEach((bb) => bb.forEach((s) => { (s.flag ? flags : others).push(k++); }));
        const picks = wrong ? [others[0]].concat(flags.slice(1)) : flags;
        for (const p of picks) await segs.nth(p).click();
      } else if (q.type === 'sort') {
        for (let c = 0; c < q.cards.length; c++) {
          const scam = wrong && c === 0 ? !q.cards[c].scam : q.cards[c].scam;
          await pg.click(scam ? '.sortbtn.scam' : '.sortbtn.safe');
        }
      } else if (q.type === 'reply') {
        await pg.locator('.reply').nth(wrong ? (q.answer + 1) % q.options.length : q.answer).click();
      } else {
        await pg.locator('.pick').nth(wrong ? (q.answer + 1) % q.options.length : q.answer).click();
      }
      if (wrongAt === -1) await fits(`quiz ${i + 1} (${q.type}) answered`);
      ok(await pg.locator('#nav .btn').last().isEnabled(), `quiz ${i + 1}: Next enabled once answered`);
      await next();
    }
  }

  // Next stays disabled until a spot item has exactly n picks
  await answerAll(0);
  await fits('feedback');
  ok(await pg.locator('#nav .btn').isDisabled(), 'feedback: submit disabled until both answered');
  await pg.locator('.faces .chip').nth(4).click();
  await pg.locator('.words .chip').first().click();
  await next();
  await pg.locator('.result').waitFor();
  const total = await pg.evaluate(() => window.SCAM_TEXT.en.quiz.reduce((s, q) => s + (q.type === 'sort' ? q.cards.length : 1), 0));
  const last = () => pg.evaluate(() => JSON.parse(localStorage.getItem('scamquiz.v1')).last);
  ok((await last()).score === total - 1 && await pg.locator('.result.partial').count() === 1, `one wrong spot item scores ${total - 1}/${total}`);
  ok(await pg.locator('.qr').count() === 0 && await pg.locator('.code').count() === 0, 'not all correct: no QR code and no claim code');
  ok(await pg.evaluate(() => JSON.parse(localStorage.getItem('scamquiz.v1')).pending) === false, 'result saved to the API');
  await fits('result (partial)');
  await pg.click('#nav .btn >> nth=0'); // Review answers
  for (let i = 0; i < quiz.length; i++) {
    await fits(`review ${i + 1} (${quiz[i].type})`);
    if (i === 0) ok(await pg.locator('.verdict.no').count() === 1 && await pg.locator('.seg.wrong').count() === 1, 'review shows the wrong pick and the right flags');
    await next();
  }
  ok(await pg.locator('.result').count() === 1, 'review ends back at the QR code');

  await pg.locator('#nav .btn').last().click(); // Try again
  await answerAll(-1);
  await pg.locator('.result.full').waitFor();
  ok((await last()).score === total && await pg.locator('.result.full').count() === 1, `all correct scores ${total}/${total}`);
  ok(await pg.evaluate(() => JSON.parse(localStorage.getItem('scamquiz.v1')).attempts) === 2, 'second attempt counted');
  ok(await pg.locator('.qr').count() === 1, 'all correct: QR code shown');
  await fits('result (all correct)');

  // a later attempt with a mistake keeps the QR code (the best score counts)
  await pg.locator('#nav .btn').last().click(); // Try again
  await answerAll(0);
  await pg.locator('.result').waitFor();
  ok(await pg.locator('.result.partial').count() === 1 && await pg.locator('.qr').count() === 1, 'later attempt with a mistake: QR code kept');
  await fits('result (partial, earned before)');

  ok(!errs.length, 'no page errors ' + (errs.length ? JSON.stringify(errs) : ''));
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
