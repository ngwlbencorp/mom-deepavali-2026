// Navigation checks: a clear way out on every screen, and "Previous" only ever goes back one step.
// Usage: node tests/nav.test.js <siteBase>   (site copy's js/config.js must point at a running API)
const { chromium } = require('playwright');
const site = process.argv[2];
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const b = await chromium.launch(), errs = [];
  const pg = await b.newPage({ viewport: { width: 360, height: 640 } });
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(site + 'index.html');
  await pg.evaluate(() => localStorage.clear());
  await pg.reload();
  const navLabels = () => pg.locator('#nav .btn').allTextContents();
  const exit = () => pg.locator('.exitbtn');
  const quiz = await pg.evaluate(() => window.SCAM_TEXT.en.quiz);

  // learn
  await pg.click('.tile >> nth=0');
  ok((await navLabels()).join() === 'Next', 'learn, first frame: no Previous, only Next');
  ok((await exit().textContent()).includes('Home'), 'learn: "Home" shown at the top');
  await pg.locator('#nav .btn').last().click();
  ok((await navLabels()).join() === 'Previous,Next', 'learn, second frame: Previous and Next');
  await pg.locator('#nav .btn').first().click();
  ok((await navLabels()).join() === 'Next', 'learn: Previous goes back one frame, not home');
  await exit().click();
  ok(await pg.locator('h1').count() === 1, 'learn: Home returns to the landing page');

  // quiz
  await pg.click('.tile.alt');
  ok((await navLabels()).join() === 'Next', 'quiz, question 1: no Previous, only Next');
  ok((await exit().textContent()).includes('Exit quiz'), 'quiz: "Exit quiz" shown at the top');
  await exit().click();
  ok(await pg.locator('h1').count() === 1, 'quiz: Exit with nothing answered leaves without asking');
  await pg.click('.tile.alt');
  await pg.locator('.seg').first().click();
  let asked = '';
  pg.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
  await exit().click();
  ok(/Leave the quiz/.test(asked) && await pg.locator('h1').count() === 0, 'quiz: Exit after answering asks first; Cancel stays');
  pg.once('dialog', (d) => d.accept());
  await pg.click('#homeBtn');
  ok(await pg.locator('h1').count() === 1, 'quiz: header lamp also asks, OK goes home');

  // run the quiz to the end
  await pg.click('.tile.alt');
  for (let i = 0; i < quiz.length; i++) {
    const q = quiz[i];
    if (q.type === 'spot') {
      let k = q.msg.fromFlag ? 1 : 0; const picks = q.msg.fromFlag ? [0] : [];
      q.msg.bubbles.forEach((bb) => bb.forEach((s) => { if (s.flag) picks.push(k); k++; }));
      for (const p of picks) await pg.locator('.seg').nth(p).click();
    } else if (q.type === 'sort') { for (const c of q.cards) await pg.click(c.scam ? '.sortbtn.scam' : '.sortbtn.safe'); }
    else if (q.type === 'reply') await pg.locator('.reply').nth(q.answer).click();
    else await pg.locator('.pick').nth(q.answer).click();
    if (i === 1) {
      await pg.locator('#nav .btn').first().click();
      ok(await pg.locator('.seg.on').count() > 0, 'quiz: Previous goes back one question and keeps the answers');
      await pg.locator('#nav .btn').last().click();
    }
    if (i === quiz.length - 1) ok((await navLabels()).pop() === 'Finish', 'quiz: last question says Finish');
    await pg.locator('#nav .btn').last().click();
  }
  await pg.locator('.faces .chip').nth(4).click();
  await pg.locator('.words .chip').first().click();
  await pg.locator('#nav .btn').click();
  await pg.locator('.result').waitFor();
  ok((await exit().textContent()).includes('Home'), 'result: "Home" shown at the top of the QR code screen');

  // review
  await pg.click('#nav >> text=Review answers');
  ok((await navLabels()).join() === 'Next', 'review, first item: no Previous');
  ok((await exit().textContent()).includes('Close review'), 'review: "Close review" shown at the top');
  await exit().click();
  ok(await pg.locator('.result').count() === 1, 'review: Close returns to the QR code');
  await exit().click();
  ok(await pg.locator('h1').count() === 1, 'result: Home returns to the landing page');

  ok(!errs.length, 'no page errors ' + (errs.length ? JSON.stringify(errs) : ''));
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
