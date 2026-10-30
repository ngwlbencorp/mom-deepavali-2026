// Builds files for an independent check of the translations in a chat assistant we cannot call
// directly (e.g. Gemini through an enterprise account). Two steps in ONE chat, so the check stays
// independent: step 1 sends only the English and asks for a translation; step 2 then sends the
// live text and asks for problems only, as CSV, which is triaged by hand like the other checks.
// Usage: node tools/review-pack.js <out folder> [codes...]   (default: the languages live in index.html)
const fs = require('fs'), path = require('path');
const { english, where, hint } = require('./review-common');
const root = path.join(__dirname, '..');
const [out, ...want] = process.argv.slice(2);
if (!out) { console.error('Usage: node tools/review-pack.js <out folder> [codes...]'); process.exit(1); }
const NAMES = Object.fromEntries(require('./languages.json').map((l) => [l.code, l.sheet]));
const live = want.length ? want : [...fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/js\/lang\/(\w+)\.js/g)].map((m) => m[1]);
fs.mkdirSync(out, { recursive: true });
const keys = Object.keys(english).filter((k) => live.some((c) => k in JSON.parse(fs.readFileSync(path.join(root, 'i18n', c + '.json'), 'utf8'))));
const lines = keys.map((k) => ({ key: k, where: where(k), note: hint(k) || undefined, english: english[k] }));

fs.writeFileSync(path.join(out, 'step1-english.md'), `# Step 1: translate (upload this first)

You are a professional translator. Below is the English text of a scam-awareness mini-site for migrant workers in Singapore, many with limited schooling. I will ask you to translate it into one language at a time.

Rules:
- Plain, everyday words a worker would use; short sentences; natural for a native speaker. Fake scam and chat messages should sound like real casual messages.
- Keep MOM, Singpass, ScamShield, OTP, ACT, ADD, CHECK, TELL, SMS and QR in English. Keep {placeholders}, web addresses, phone numbers, amounts and numbers exactly as written.
- Keep a similar length: every line must fit a phone screen.

When I name a language, reply with ONE CSV code block only, columns: key,translation (one row per line below, same order, quote every field, double any quotes inside a field). Do not add commentary.

I will ask for these languages one at a time, by name: ${live.map((c) => NAMES[c]).join(', ')}. Wait until I name one.

Lines (JSON):
\`\`\`json
${JSON.stringify(lines, null, 1)}
\`\`\`
`);

for (const c of live) {
  const d = JSON.parse(fs.readFileSync(path.join(root, 'i18n', c + '.json'), 'utf8'));
  const rows = keys.filter((k) => k in d).map((k) => ({ key: k, english: english[k], live: d[k] }));
  fs.writeFileSync(path.join(out, `step2-${c}-${NAMES[c].toLowerCase()}.md`), `# Step 2 (${NAMES[c]}): compare (upload after your ${NAMES[c]} translation from step 1)

Below is the ${NAMES[c]} text currently live on the site (written by another translator). Compare each line with the English and with your own translation from step 1.

Report ONLY lines where the live text has a real problem:
- MEANING: says something different from the English, or leaves out / adds something that matters;
- ERROR: a grammar or spelling error a native reader would trip on;
- UNCLEAR: hard to understand for a worker with limited schooling.
Do NOT report wording that is merely different from yours, or style preferences.

Reply with ONE CSV code block only, columns: key,type,problem,suggested_fix (type is MEANING, ERROR or UNCLEAR; problem in English; suggested_fix is the full corrected ${NAMES[c]} line, keeping placeholders, web addresses, amounts and English terms exactly). If there are no problems, reply with the header row only.

Lines (JSON):
\`\`\`json
${JSON.stringify(rows, null, 1)}
\`\`\`
`);
}
console.log('wrote', fs.readdirSync(out).join(', '));
