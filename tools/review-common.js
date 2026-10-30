// Shared by the machine translation checks (tools/sealion-review.js, tools/sarvam-review.js): the
// English text, the review instructions given to the model, and the checks on its replies.
const path = require('path');
const root = path.join(__dirname, '..');

const NAME = { bn: 'Bengali', zh: 'Simplified Chinese', hi: 'Hindi', id: 'Bahasa Indonesia', my: 'Burmese (Unicode)', ta: 'Tamil', tl: 'Tagalog (Filipino)', th: 'Thai', vi: 'Vietnamese', ur: 'Urdu' };

global.window = global.window || {};
require(path.join(root, 'js/content.js'));
const en = window.SCAM_TEXT.en;
const FIXED = new Set(['type', 'icon', 'code', 'helpline', 'video', 'app']);
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
  return { event: 'Home screen', ui: 'Button or label', act: 'Closing screen after the stories', feedback: 'Feedback screen' }[key.split('.')[0]];
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

function parseReply(json) {
  const msg = json.choices && json.choices[0] && json.choices[0].message || {};
  let text = String(msg.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = text.indexOf('['), b = text.lastIndexOf(']');
  return JSON.parse(text.slice(a, b + 1));
}


module.exports = { NAME, en, english, protectedBits, where, hint, SYSTEM, parseReply };
