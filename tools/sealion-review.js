// Second-opinion check of the draft translations by SEA-LION (AI Singapore's LLM for Southeast
// Asian languages), before MOM's language team reviews them. For every line it asks for a back
// translation into English, a verdict (ok / fix) and, if needed, a better wording with a reason.
// Results go to review/sealion/<code>.json; tools/review-sheet.py shows them in the workbook.
// Nothing is changed in i18n/: suggestions are applied by hand after checking them.
//
// Usage (needs Node 18+ and the key in the environment, never in a file):
//   SEALION_API_KEY=... node tools/sealion-review.js                 all languages
//   SEALION_API_KEY=... node tools/sealion-review.js ta my           some languages
//   SEALION_API_KEY=... node tools/sealion-review.js --models        list the models the key can use
// Each language is checked by the model set for it in tools/sealion-models.json: the newest SEA-LION
// model whose documentation lists that language. Hindi, Bengali and Urdu, which no model lists, are
// checked with Qwen-SEA-LION-v4.5 on the strength of its base model (Qwen3.6); a weaker check.
// Options: --model <id> (overrides the config, for experiments), --base <url> (default https://api.sea-lion.ai/v1),
//          --fresh (ignore earlier results; by default, lines already reviewed are skipped).
// Windows PowerShell: $env:SEALION_API_KEY = '<key>'; node tools/sealion-review.js   (key lasts for that window only)
// The free tier allows 10 requests a minute, so requests are spaced 7 seconds apart.
// Behind an HTTPS proxy (e.g. a cloud session), Node's fetch needs NODE_USE_ENV_PROXY=1 (and
// NODE_EXTRA_CA_CERTS if the proxy uses its own certificate).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args.splice(i, 2)[1]; };
const flag = (name) => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const MODEL_OVERRIDE = opt('--model', null);
const BASE = opt('--base', 'https://api.sea-lion.ai/v1');
const FRESH = flag('--fresh'), LIST = flag('--models');
const KEY = process.env.SEALION_API_KEY;
const GAP_MS = +process.env.SEALION_GAP_MS || 7000, BATCH = 25;
if (!KEY) { console.error('Set SEALION_API_KEY first.'); process.exit(1); }

const LANGS = require('./languages.json');
const CONFIG = require('./sealion-models.json');
const modelFor = (code) => MODEL_OVERRIDE || (CONFIG.languages[code] && CONFIG.languages[code].model) || null;
const { NAME, english, protectedBits, where, hint, SYSTEM, parseReply } = require('./review-common');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function call(body) {
  for (let attempt = 1; ; attempt++) {
    const wait = last + GAP_MS - Date.now(); if (wait > 0) await sleep(wait);
    last = Date.now();
    const r = await fetch(BASE + '/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (r.ok) return r.json();
    const text = await r.text();
    if ((r.status === 429 || r.status >= 500) && attempt < 5) { console.log(`  HTTP ${r.status}, retrying in ${attempt * 15}s`); await sleep(attempt * 15000); continue; }
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
  }
}
async function reviewBatch(code, keys, draft, model) {
  const lines = keys.map((k) => ({ key: k, where: where(k), note: hint(k), english: english[k], draft: draft[k] }));
  const body = {
    model, temperature: 0.2, max_completion_tokens: 16000,
    // Thinking is per model (tools/sealion-models.json): on where it stays fast, off where it made
    // each request ~20x slower and could use up the whole token budget.
    chat_template_kwargs: { enable_thinking: !!(CONFIG.models[model] || {}).thinking },
    messages: [{ role: 'system', content: SYSTEM },
      { role: 'user', content: `Language: ${NAME[code]}.\nCheck these ${lines.length} lines:\n${JSON.stringify(lines, null, 1)}` }]
  };
  const out = parseReply(await call(body));
  const got = {};
  for (const r of out) {
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

(async () => {
  if (LIST) {
    const r = await fetch(BASE + '/models', { headers: { Authorization: 'Bearer ' + KEY } });
    console.log(r.status, JSON.stringify(await r.json(), null, 1));
    return;
  }
  const codes = args.length ? args : LANGS.map((l) => l.code);
  const dir = path.join(root, 'review', 'sealion');
  fs.mkdirSync(dir, { recursive: true });
  for (const code of codes) {
    const model = modelFor(code);
    if (!model) { console.log(`${code}: not supported by SEA-LION (no model lists it; see tools/sealion-models.json), skipped`); continue; }
    const draft = JSON.parse(fs.readFileSync(path.join(root, 'i18n', code + '.json'), 'utf8'));
    const file = path.join(dir, code + '.json');
    let saved = !FRESH && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    if (saved && saved.model !== model) saved = null; // a different model: check every line again
    const results = saved ? saved.results : {};
    // A line counts as reviewed only if the English and draft are unchanged since.
    const done = (k) => results[k] && results[k].english === english[k] && results[k].draft === draft[k];
    const todo = Object.keys(draft).filter((k) => k in english && !done(k));
    console.log(`${code}: ${todo.length} line(s) to check with ${model}`);
    for (let i = 0; i < todo.length; i += BATCH) {
      const keys = todo.slice(i, i + BATCH);
      let got;
      try { got = await reviewBatch(code, keys, draft, model); }
      catch (e) { console.log(`  batch ${i / BATCH + 1} failed (${e.message}); retrying in halves`);
        got = {};
        for (const half of [keys.slice(0, keys.length >> 1), keys.slice(keys.length >> 1)]) {
          try { Object.assign(got, await reviewBatch(code, half, draft, model)); } catch (e2) { console.log('  half failed: ' + e2.message); }
        }
      }
      for (const k of Object.keys(got)) results[k] = Object.assign({ english: english[k], draft: draft[k] }, got[k]);
      const missing = keys.filter((k) => !got[k]);
      console.log(`  ${Math.min(i + BATCH, todo.length)}/${todo.length}` + (missing.length ? ` (no answer for ${missing.length}; re-run to retry them)` : ''));
      fs.writeFileSync(file, JSON.stringify({ model, checked: new Date().toISOString().slice(0, 10), results }, null, 1) + '\n');
    }
    const fixes = Object.values(results).filter((r) => r.verdict === 'fix').length;
    console.log(`  ${code}: ${Object.keys(results).length} checked, ${fixes} suggested fix(es) -> review/sealion/${code}.json`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
