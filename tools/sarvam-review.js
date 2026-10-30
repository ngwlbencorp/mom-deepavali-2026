// Second-opinion check of the draft translations by Sarvam AI (models trained on Indian languages),
// for the languages SEA-LION was not trained on. Same idea as tools/sealion-review.js:
//   Hindi, Bengali: Sarvam-105B reviews each line (back translation, verdict, suggested fix).
//   Urdu: Sarvam-105B does not support Urdu, so Sarvam Translate gives an independent back
//         translation into English only; compare it with the English by hand.
// Results go to review/sarvam/<code>.json; tools/review-sheet.py shows them in the workbook.
// Nothing is changed in i18n/: suggestions are applied by hand after checking them.
//
// Usage (key in the environment, never in a file):
//   SARVAM_API_KEY=... node tools/sarvam-review.js            hi, bn and ur
//   SARVAM_API_KEY=... node tools/sarvam-review.js ur         some languages
// Options: --fresh (check every line again; by default unchanged lines already checked are skipped).
// Cost (Oct 2026, pay as you go): chat ₹15 / ₹60 per million input / output tokens; translation
// ₹2 to ₹5 per 1,000 characters (docs and dashboard differ). A full run is roughly ₹40.
// Behind an HTTPS proxy (e.g. a cloud session), Node's fetch needs NODE_USE_ENV_PROXY=1.
const fs = require('fs'), path = require('path');
const { NAME, english, protectedBits, where, hint, SYSTEM, parseReply } = require('./review-common');
const root = path.join(__dirname, '..');

const args = process.argv.slice(2);
const FRESH = args.includes('--fresh');
const codes = args.filter((a) => !a.startsWith('--'));
const KEY = process.env.SARVAM_API_KEY;
if (!KEY) { console.error('Set SARVAM_API_KEY first.'); process.exit(1); }
const BASE = 'https://api.sarvam.ai';
const CHAT_MODEL = 'sarvam-105b', TRANSLATE_MODEL = 'sarvam-translate:v1';
// Which check each language gets (docs.sarvam.ai, checked 30 Oct 2026: Sarvam-105B and Mayura cover
// 10 Indian languages + English, without Urdu; Sarvam Translate covers all 22 scheduled languages).
const PLAN = { hi: 'review', bn: 'review', ur: 'back-translate' };
const LOCALE = { hi: 'hi-IN', bn: 'bn-IN', ur: 'ur-IN' };
const GAP_MS = 1500, BATCH = 15; // limits are 60 requests a minute; small batches keep replies within max_tokens

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function post(url, body) {
  for (let attempt = 1; ; attempt++) {
    const wait = last + GAP_MS - Date.now(); if (wait > 0) await sleep(wait);
    last = Date.now();
    const r = await fetch(BASE + url, { method: 'POST', headers: { 'api-subscription-key': KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return r.json();
    const text = await r.text();
    // Stop the whole run (not just this line) when retrying cannot help.
    const fatal = (m) => Object.assign(new Error(m), { fatal: true });
    if (r.status === 402) throw fatal('Out of Sarvam credits (HTTP 402). Top up on the Sarvam dashboard.');
    if (r.status === 401 || r.status === 403) throw fatal(`Sarvam refused the key (HTTP ${r.status}): ${text.slice(0, 200)}`);
    if ((r.status === 429 || r.status >= 500) && attempt < 5) { console.log(`  HTTP ${r.status}, retrying in ${attempt * 15}s`); await sleep(attempt * 15000); continue; }
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
  }
}

async function reviewBatch(code, keys, draft) {
  const lines = keys.map((k) => ({ key: k, where: where(k), note: hint(k), english: english[k], draft: draft[k] }));
  const json = await post('/v1/chat/completions', {
    model: CHAT_MODEL, temperature: 0.2, max_tokens: 12000,
    messages: [{ role: 'system', content: SYSTEM },
      { role: 'user', content: `Language: ${NAME[code]}.\nCheck these ${lines.length} lines:\n${JSON.stringify(lines, null, 1)}` }]
  });
  const got = {};
  for (const r of parseReply(json)) {
    if (!r || !keys.includes(r.key)) continue;
    let { verdict, suggestion = '', reason = '', back = '' } = r;
    verdict = verdict === 'fix' && suggestion.trim() && suggestion.trim() !== draft[r.key] ? 'fix' : 'ok';
    if (verdict === 'fix') {
      const lost = protectedBits(english[r.key]).filter((t) => !suggestion.includes(t));
      if (lost.length) reason = `[suggestion changes ${lost.join(', ')}; do not apply as is] ` + reason;
    }
    got[r.key] = { verdict, back, suggestion: verdict === 'fix' ? suggestion.trim() : '', reason: verdict === 'fix' ? reason : '' };
  }
  return got;
}

async function backTranslate(code, key, draft) {
  const r = await post('/translate', { input: draft[key], source_language_code: LOCALE[code], target_language_code: 'en-IN', model: TRANSLATE_MODEL, mode: 'formal' });
  return { verdict: 'back-translation', back: r.translated_text || '', suggestion: '', reason: '' };
}

(async () => {
  const dir = path.join(root, 'review', 'sarvam');
  fs.mkdirSync(dir, { recursive: true });
  for (const code of codes.length ? codes : Object.keys(PLAN)) {
    if (!PLAN[code]) { console.log(`${code}: no Sarvam check planned (see PLAN in this file), skipped`); continue; }
    const model = PLAN[code] === 'review' ? CHAT_MODEL : TRANSLATE_MODEL;
    const draft = JSON.parse(fs.readFileSync(path.join(root, 'i18n', code + '.json'), 'utf8'));
    const file = path.join(dir, code + '.json');
    let saved = !FRESH && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    if (saved && saved.model !== model) saved = null;
    const results = saved ? saved.results : {};
    const done = (k) => results[k] && results[k].english === english[k] && results[k].draft === draft[k];
    const todo = Object.keys(draft).filter((k) => k in english && !done(k));
    console.log(`${code}: ${todo.length} line(s) to check with ${model}`);
    const save = () => fs.writeFileSync(file, JSON.stringify({ model, mode: PLAN[code], checked: new Date().toISOString().slice(0, 10), results }, null, 1) + '\n');
    if (PLAN[code] === 'review') {
      for (let i = 0; i < todo.length; i += BATCH) {
        const keys = todo.slice(i, i + BATCH);
        let got = {};
        try { got = await reviewBatch(code, keys, draft); } catch (e) { if (e.fatal) throw e; console.log(`  batch failed (${e.message}); re-run to retry it`); }
        for (const k of Object.keys(got)) results[k] = Object.assign({ english: english[k], draft: draft[k] }, got[k]);
        const missing = keys.filter((k) => !got[k]).length;
        console.log(`  ${Math.min(i + BATCH, todo.length)}/${todo.length}` + (missing ? ` (no answer for ${missing}; re-run to retry them)` : ''));
        save();
      }
    } else {
      for (const [n, k] of todo.entries()) {
        try { results[k] = Object.assign({ english: english[k], draft: draft[k] }, await backTranslate(code, k, draft)); }
        catch (e) { if (e.fatal) throw e; console.log(`  ${k}: ${e.message}`); }
        if ((n + 1) % 25 === 0 || n === todo.length - 1) { console.log(`  ${n + 1}/${todo.length}`); save(); }
      }
      save();
    }
    const fixes = Object.values(results).filter((r) => r.verdict === 'fix').length;
    console.log(`  ${code}: ${Object.keys(results).length} checked` + (PLAN[code] === 'review' ? `, ${fixes} suggested fix(es)` : ' (back translations)') + ` -> review/sarvam/${code}.json`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
