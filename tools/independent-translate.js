// Independent translation from the English only, to compare with the live drafts. A model that
// reviews a draft tends to accept it; one that translates without seeing it shows where a draft's
// meaning or key terms differ. The draft and the glossary are deliberately NOT sent.
//   Tamil, Burmese: SEA-LION (the model set in tools/sealion-models.json), needs SEALION_API_KEY
//   Hindi, Bengali: Sarvam-105B; Urdu: Sarvam Translate (formal style only), need SARVAM_API_KEY
//   Any language with --provider gemini [--model <id>]: Google Gemini, needs GEMINI_API_KEY
//     (node tools/independent-translate.js --provider gemini --models lists the models the key can use)
// Results go to review/independent/<code>.json, or <code>.<provider>.json with --provider:
// { provider, model, checked, results: { key: { english, translation } } }.
// Nothing in i18n/ is changed; differences are compared and triaged by hand.
// Usage: node tools/independent-translate.js ta my     (or hi bn ur)    [--fresh]
// Behind an HTTPS proxy (e.g. a cloud session), Node's fetch needs NODE_USE_ENV_PROXY=1.
const fs = require('fs'), path = require('path');
const { NAME, english, protectedBits, where, hint, parseReply } = require('./review-common');
const root = path.join(__dirname, '..');
const CONFIG = require('./sealion-models.json');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1]; };
const PROVIDER = opt('--provider'), MODEL = opt('--model');
const FRESH = args.includes('--fresh'), LIST = args.includes('--models');
const codes = args.filter((a) => !a.startsWith('--'));

const SYSTEM = `You are a professional translator. Translate the English text of a scam-awareness mini-site for migrant workers in Singapore, many with limited schooling, into the language given. Use plain, everyday words a worker would use and short sentences, natural for a native speaker. Fake scam and chat messages should sound like real casual messages. Keep MOM, Singpass, ScamShield, OTP, ACT, ADD, CHECK, TELL, SMS and QR in English; keep {placeholders}, web addresses, phone numbers, amounts and numbers exactly as written. Keep a similar length (it must fit a phone screen). Each line has a key, where it appears, and sometimes a note.
Reply with JSON only: an array with one object per line, in the same order: {"key": "...", "translation": "..."}.`;

const PLAN = {
  ta: { provider: 'sealion', how: 'chat' }, my: { provider: 'sealion', how: 'chat' },
  hi: { provider: 'sarvam', how: 'chat', model: 'sarvam-105b' }, bn: { provider: 'sarvam', how: 'chat', model: 'sarvam-105b' },
  ur: { provider: 'sarvam', how: 'translate', model: 'sarvam-translate:v1' }
};
const PROVIDERS = {
  sealion: { base: 'https://api.sea-lion.ai/v1', key: 'SEALION_API_KEY', gap: 7000, batch: 20, auth: (k) => ({ Authorization: 'Bearer ' + k }) },
  sarvam: { base: 'https://api.sarvam.ai', key: 'SARVAM_API_KEY', gap: 1500, batch: 15, auth: (k) => ({ 'api-subscription-key': k }) },
  // Gemini's OpenAI-compatible endpoint; the free tier allows a few requests a minute.
  gemini: { base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: 'GEMINI_API_KEY', gap: 13000, batch: 25, auth: (k) => ({ Authorization: 'Bearer ' + k }), model: 'gemini-2.5-pro' }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function post(p, url, body) {
  const KEY = process.env[p.key];
  for (let attempt = 1; ; attempt++) {
    const wait = last + p.gap - Date.now(); if (wait > 0) await sleep(wait);
    last = Date.now();
    const r = await fetch(p.base + url, { method: 'POST', headers: { ...p.auth(KEY), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return r.json();
    const text = await r.text();
    if ([401, 402, 403].includes(r.status)) throw Object.assign(new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`), { fatal: true });
    if ((r.status === 429 || r.status >= 500) && attempt < 5) { console.log(`  HTTP ${r.status}, retrying in ${attempt * 15}s`); await sleep(attempt * 15000); continue; }
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
  }
}

async function chatBatch(code, plan, keys) {
  const p = PROVIDERS[plan.provider], model = plan.model || CONFIG.languages[code].model;
  const url = (plan.provider === 'sarvam' ? '/v1' : '') + '/chat/completions';
  const lines = keys.map((k) => ({ key: k, where: where(k), note: hint(k), english: english[k] }));
  const body = { model, temperature: 0.2, messages: [{ role: 'system', content: SYSTEM },
    { role: 'user', content: `Language: ${NAME[code]}.\nTranslate these ${lines.length} lines:\n${JSON.stringify(lines, null, 1)}` }] };
  if (plan.provider === 'sealion') Object.assign(body, { max_completion_tokens: 16000, chat_template_kwargs: { enable_thinking: !!(CONFIG.models[model] || {}).thinking } });
  else if (plan.provider === 'gemini') body.max_tokens = 32000; // includes its thinking
  else body.max_tokens = 12000;
  const got = {};
  for (const r of parseReply(await post(p, url, body))) {
    if (r && keys.includes(r.key) && typeof r.translation === 'string' && r.translation.trim()) got[r.key] = r.translation.trim();
  }
  return got;
}

(async () => {
  if (LIST) {
    const p = PROVIDERS[PROVIDER || 'gemini'];
    const r = await fetch(p.base + '/models', { headers: p.auth(process.env[p.key]) });
    const j = await r.json();
    console.log(r.status, (j.data || []).map((m) => m.id).join('\n') || JSON.stringify(j).slice(0, 300));
    return;
  }
  const dir = path.join(root, 'review', 'independent');
  for (const code of codes) {
    const plan = PROVIDER ? { provider: PROVIDER, how: 'chat', model: MODEL || PROVIDERS[PROVIDER].model } : PLAN[code];
    if (!plan) { console.log(`${code}: no plan, skipped`); continue; }
    const p = PROVIDERS[plan.provider];
    if (!process.env[p.key]) { console.log(`${code}: set ${p.key} first, skipped`); continue; }
    const model = plan.model || CONFIG.languages[code].model;
    const draft = JSON.parse(fs.readFileSync(path.join(root, 'i18n', code + '.json'), 'utf8')); // only to know which lines are translated
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, code + (PROVIDER ? '.' + PROVIDER : '') + '.json');
    let saved = !FRESH && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    if (saved && saved.model !== model) saved = null;
    const results = saved ? saved.results : {};
    const todo = Object.keys(draft).filter((k) => k in english && !(results[k] && results[k].english === english[k]));
    const save = () => fs.writeFileSync(file, JSON.stringify({ provider: plan.provider, model, checked: new Date().toISOString().slice(0, 10), results }, null, 1) + '\n');
    console.log(`${code}: ${todo.length} line(s) to translate with ${model}`);
    const keep = (k, t) => {
      const lost = protectedBits(english[k]).filter((x) => !t.includes(x));
      results[k] = { english: english[k], translation: t, ...(lost.length ? { note: 'changes or drops ' + lost.join(', ') } : {}) };
    };
    try {
      if (plan.how === 'chat') {
        for (let i = 0; i < todo.length; i += p.batch) {
          const keys = todo.slice(i, i + p.batch);
          let got = {};
          try { got = await chatBatch(code, plan, keys); } catch (e) { if (e.fatal) throw e; console.log(`  batch failed (${e.message}); re-run to retry it`); }
          for (const [k, t] of Object.entries(got)) keep(k, t);
          const missing = keys.filter((k) => !got[k]).length;
          console.log(`  ${Math.min(i + p.batch, todo.length)}/${todo.length}` + (missing ? ` (no answer for ${missing}; re-run to retry them)` : ''));
          save();
        }
      } else {
        for (const [n, k] of todo.entries()) {
          try {
            const r = await post(p, '/translate', { input: english[k], source_language_code: 'en-IN', target_language_code: 'ur-IN', model, mode: 'formal' });
            if (r.translated_text) keep(k, r.translated_text.trim());
          } catch (e) { if (e.fatal) throw e; console.log(`  ${k}: ${e.message}`); }
          if ((n + 1) % 25 === 0 || n === todo.length - 1) { console.log(`  ${n + 1}/${todo.length}`); save(); }
        }
      }
    } finally { save(); }
    console.log(`  ${code}: ${Object.keys(results).length} lines -> review/independent/${code}.json`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
