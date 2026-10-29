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
// Options: --model <id> (default below), --base <url> (default https://api.sea-lion.ai/v1),
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
const MODEL = opt('--model', 'aisingapore/Qwen-SEA-LION-v4.5-27B-IT');
const BASE = opt('--base', 'https://api.sea-lion.ai/v1');
const FRESH = flag('--fresh'), LIST = flag('--models');
const KEY = process.env.SEALION_API_KEY;
const GAP_MS = +process.env.SEALION_GAP_MS || 7000, BATCH = 25;
if (!KEY) { console.error('Set SEALION_API_KEY first.'); process.exit(1); }

const LANGS = require('./languages.json');
const SEA_TUNED = new Set(['my', 'id', 'tl', 'ta', 'th', 'vi']); // per the v4.5 model card
const NAME = { bn: 'Bengali', zh: 'Simplified Chinese', hi: 'Hindi', id: 'Bahasa Indonesia', my: 'Burmese (Unicode)', ta: 'Tamil', tl: 'Tagalog (Filipino)', th: 'Thai', vi: 'Vietnamese' };

global.window = {};
require(path.join(root, 'js/content.js'));
const en = window.SCAM_TEXT.en;
const FIXED = new Set(['type', 'icon', 'code', 'helpline', 'video']);
const english = {};
(function walk(v, p) {
  if (typeof v === 'string') { english[p] = v; return; }
  if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${p}[${i}]`));
  for (const k in v) if (!(p === '' && k === 'manual') && !FIXED.has(k)) walk(v[k], p ? `${p}.${k}` : k);
})(en, '');

// Same protection as tools/build-lang.js: placeholders, web addresses, amounts and numbers.
const protectedBits = (s) => (s.match(/\{\w+\}|\$\d+|\b\d[\dX]{2,}\b|[\w.-]+\.(?:sg|com|org|example)(?:\/\w+)*/g) || []);
function where(key) {
  let m = key.match(/^learn\[(\d+)\]/); if (m) return `Learn story "${en.learn[m[1]].title}"`;
  m = key.match(/^quiz\[(\d+)\]/); if (m) return `Quiz item "${en.quiz[m[1]].title}"`;
  return { event: 'Home screen', ui: 'Button or label', feedback: 'Feedback screen' }[key.split('.')[0]];
}
function hint(key) {
  if (/\.msg\.bubbles/.test(key)) return 'One tappable part of a fake message; the parts are shown in order and must read naturally together.';
  if (/\.chat\.|\.cards\[\d+\]\.text|\.options\[\d+\]$/.test(key)) return 'Fictional scam or everyday chat message: casual, like a real message.';
  if (/^ui\./.test(key)) return 'Short button or label on a phone screen.';
  return '';
}

const SYSTEM = `You are a professional translator and editor. You check translations of a scam-awareness mini-site for migrant workers in Singapore, many with limited schooling. Judge each draft for: (1) same meaning as the English, nothing added or lost; (2) plain, everyday words a worker would use, short sentences; (3) natural grammar and spelling; (4) consistent terms across lines.
Rules for any suggestion: keep MOM, Singpass, ScamShield, OTP, ACT, ADD, CHECK, TELL, SMS and QR in English; keep {placeholders}, web addresses, amounts and numbers exactly as written; keep a similar length (it must fit a phone screen). Only mark "fix" for a real problem, not a style preference.
Reply with JSON only: an array with one object per line, in the same order: {"key": "...", "back": "<literal English back-translation of the DRAFT>", "verdict": "ok" or "fix", "suggestion": "<full corrected text, or empty if ok>", "reason": "<short reason in English, or empty if ok>"}.`;

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
function parseReply(json) {
  const msg = json.choices && json.choices[0] && json.choices[0].message || {};
  let text = String(msg.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = text.indexOf('['), b = text.lastIndexOf(']');
  return JSON.parse(text.slice(a, b + 1));
}

async function reviewBatch(code, keys, draft) {
  const lines = keys.map((k) => ({ key: k, where: where(k), note: hint(k), english: english[k], draft: draft[k] }));
  const body = {
    model: MODEL, temperature: 0.2, max_completion_tokens: 12000,
    // Qwen-based SEA-LION "thinks" before answering by default: ~20x slower, and the thinking can
    // use up the whole token budget. A line-by-line check does not need it.
    chat_template_kwargs: { enable_thinking: false },
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
    const draft = JSON.parse(fs.readFileSync(path.join(root, 'i18n', code + '.json'), 'utf8'));
    const file = path.join(dir, code + '.json');
    const saved = !FRESH && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    const results = saved ? saved.results : {};
    // A line counts as reviewed only if the English and draft are unchanged since.
    const done = (k) => results[k] && results[k].english === english[k] && results[k].draft === draft[k];
    const todo = Object.keys(draft).filter((k) => k in english && !done(k));
    console.log(`${code}: ${todo.length} line(s) to check${SEA_TUNED.has(code) ? '' : ' (not a SEA-LION fine-tuned language: weigh its comments lower)'}`);
    for (let i = 0; i < todo.length; i += BATCH) {
      const keys = todo.slice(i, i + BATCH);
      let got;
      try { got = await reviewBatch(code, keys, draft); }
      catch (e) { console.log(`  batch ${i / BATCH + 1} failed (${e.message}); retrying in halves`);
        got = {};
        for (const half of [keys.slice(0, keys.length >> 1), keys.slice(keys.length >> 1)]) {
          try { Object.assign(got, await reviewBatch(code, half, draft)); } catch (e2) { console.log('  half failed: ' + e2.message); }
        }
      }
      for (const k of Object.keys(got)) results[k] = Object.assign({ english: english[k], draft: draft[k] }, got[k]);
      const missing = keys.filter((k) => !got[k]);
      console.log(`  ${Math.min(i + BATCH, todo.length)}/${todo.length}` + (missing.length ? ` (no answer for ${missing.length}; re-run to retry them)` : ''));
      fs.writeFileSync(file, JSON.stringify({ model: MODEL, checked: new Date().toISOString().slice(0, 10), seaTuned: SEA_TUNED.has(code), results }, null, 1) + '\n');
    }
    const fixes = Object.values(results).filter((r) => r.verdict === 'fix').length;
    console.log(`  ${code}: ${Object.keys(results).length} checked, ${fixes} suggested fix(es) -> review/sealion/${code}.json`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
