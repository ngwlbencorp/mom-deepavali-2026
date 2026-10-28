"""Builds the translation review workbook for MOM's language team.
Usage: python tools/review-sheet.py <out.xlsx>
Reads English from js/content.js (via node) and drafts from i18n/<code>.json."""
import json, os, re, subprocess, sys
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LANGS = [('my', 'Burmese'), ('hi', 'Hindi'), ('ta', 'Tamil')]
FIXED = {'type', 'icon', 'code', 'helpline'}

english = json.loads(subprocess.check_output(['node', '-e', r'''
global.window = {}; require(process.argv[1]);
const out = []; const FIXED = new Set(['type','icon','code','helpline']);
(function walk(v, p) {
  if (typeof v === 'string') { out.push([p, v]); return; }
  if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${p}[${i}]`));
  for (const k in v) if (!(p === '' && k === 'manual') && !FIXED.has(k)) walk(v[k], p ? `${p}.${k}` : k);
})(window.SCAM_TEXT.en, '');
console.log(JSON.stringify({ items: out, learn: window.SCAM_TEXT.en.learn.map(s => s.title), quiz: window.SCAM_TEXT.en.quiz.map(q => q.title) }));
''', os.path.join(ROOT, 'js', 'content.js')]))

def where(key):
    m = re.match(r'learn\[(\d+)\]', key)
    if m: return 'Learn story %d: %s' % (int(m.group(1)) + 1, english['learn'][int(m.group(1))])
    m = re.match(r'quiz\[(\d+)\]', key)
    if m: return 'Quiz %d: %s' % (int(m.group(1)) + 1, english['quiz'][int(m.group(1))])
    return {'event': 'Home screen', 'ui': 'Buttons and labels (all screens)', 'feedback': 'Feedback screen'}[key.split('.')[0]]

def note(key, en, code):
    n = []
    if re.search(r'\{\w+\}', en): n.append('Keep %s exactly; the site fills in the number.' % ', '.join(sorted(set(re.findall(r'\{\w+\}', en)))))
    if '.msg.bubbles' in key: n.append('Part of a fake message split into tappable parts. Parts always appear in this order, so each part must read naturally in sequence. Do not move a red-flag phrase into another part.')
    if '.chat.' in key or '.cards[' in key and key.endswith('.text') or '.options[' in key and '.label' not in key:
        n.append('Fictional scam/example message: keep it casual, as a real message would read.')
    if code == 'hi' and key.startswith('quiz[') and ('.options[' in key):
        n.append('First-person verbs use the masculine form (most attendees are men). Change if MOM prefers neutral wording.')
    if code == 'ta' and key in TA_SHORT: n.append('Shortened to fit a phone screen; please keep a similar length.')
    if key == 'ui.example' and code == 'ta': n.append('Shortened to "sample · fake" to fit the message header.')
    if any(t in en for t in ('Singpass', 'ScamShield', 'MOM', 'OTP', 'ACT', 'ADD', 'CHECK', 'TELL')):
        n.append('Keep brand and campaign names (MOM, Singpass, ScamShield, OTP, ACT/ADD/CHECK/TELL) in English.')
    return ' '.join(n)

TA_SHORT = {'event.intro', 'event.souvenirNote', 'learn[0].chat.lines[0]', 'learn[0].chat.lines[1]', 'learn[0].chat.lines[2]',
            'learn[0].chat.lines[3]', 'learn[0].flags[0].label', 'learn[0].flags[1].label', 'quiz[2].chat.lines[0]',
            'quiz[2].chat.lines[1]', 'quiz[2].options[1]', 'quiz[2].options[2]', 'quiz[4].msg.bubbles[2][0].t', 'quiz[4].explain'}

FONT = 'Arial'
head_font = Font(name=FONT, bold=True, color='FFFFFF')
head_fill = PatternFill('solid', fgColor='4A1D5E')
edit_fill = PatternFill('solid', fgColor='FFFF00')
thin = Side(style='thin', color='BFBFBF')
border = Border(left=thin, right=thin, top=thin, bottom=thin)
wrap = Alignment(wrap_text=True, vertical='top')

wb = Workbook()
ws = wb.active
ws.title = 'How to review'
rows = [
    ('Translation review: Deepavali scam-awareness mini-site', True),
    ('', False),
    ('What this is', True),
    ('Draft translations of the mini-site text (Learn stories, Quiz, Feedback, buttons). They were machine-drafted by Claude and have NOT been checked by a native speaker. They will only go live after your review.', False),
    ('', False),
    ('How to review', True),
    ('1. Open your language tab (Burmese, Hindi or Tamil).', False),
    ('2. Read column C (English) and column D (draft).', False),
    ('3. If the draft is right, leave column E empty.', False),
    ('4. If it needs changing, type the full corrected text in column E (yellow). Do not edit column D.', False),
    ('5. Use column F for questions or comments. Column G has notes about each line.', False),
    ('6. Send the file back. Corrections in column E are applied automatically (tools/import-review.py).', False),
    ('', False),
    ('Rules for all languages', True),
    ('Audience: migrant workers with varied reading levels. Use simple, everyday words and short sentences.', False),
    ('Keep in English: MOM, Singpass, ScamShield, OTP, ACT / ADD / CHECK / TELL, web addresses, phone numbers, amounts like $500.', False),
    ('Keep placeholders such as {n}, {k}, {i}, {s}, {t} exactly as written. The site replaces them with numbers.', False),
    ('Keep a similar length to the draft. Every screen must fit on a phone without scrolling.', False),
    ('Scam examples are fictional. They should sound like a real scam message, but must not name real people or companies.', False),
    ('Not translated (stays in English on purpose): masked phone numbers (+65 9XXX XXXX), the fake sender "MOM-ALERT", the fake address mom-sg.org/pay, the file name "WORK PERMIT APPROVAL.pdf", and "SMS".', False),
    ('', False),
    ('Example of a filled-in row', True),
]
for i, (text, bold) in enumerate(rows, start=1):
    c = ws.cell(row=i, column=1, value=text)
    c.font = Font(name=FONT, bold=bold, size=14 if i == 1 else 11)
    c.alignment = Alignment(wrap_text=True, vertical='top')
ws.column_dimensions['A'].width = 120
ex_row = len(rows) + 1
headers = ['Key', 'Where it appears', 'English', 'Draft translation', 'Your correction', 'Reviewer comments', 'Notes']
example = ['ui.tryAgain', 'Buttons and labels (all screens)', 'Try again', 'फिर से कोशिश करें', 'दोबारा कोशिश करें', 'Shorter and more common.', '']
ws2col = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
for j, h in enumerate(headers):
    c = ws.cell(row=ex_row, column=j + 1, value=h)
    c.font, c.fill, c.border = head_font, head_fill, border
for j, v in enumerate(example):
    c = ws.cell(row=ex_row + 1, column=j + 1, value=v)
    c.font, c.border, c.alignment = Font(name=FONT), border, wrap
    if j == 4: c.fill = edit_fill
for col, w in zip('BCDEFG', [30, 30, 30, 30, 30, 20]):
    ws.column_dimensions[col].width = max(ws.column_dimensions[col].width or 0, w)

for code, name in LANGS:
    draft = json.load(open(os.path.join(ROOT, 'i18n', code + '.json'), encoding='utf-8'))
    sh = wb.create_sheet(name)
    for j, h in enumerate(headers):
        c = sh.cell(row=1, column=j + 1, value=h)
        c.font, c.fill, c.border = head_font, head_fill, border
        c.alignment = Alignment(wrap_text=True, vertical='center')
    r = 2
    for key, en in english['items']:
        if key not in draft: continue
        vals = [key, where(key), en, draft[key], None, None, note(key, en, code)]
        for j, v in enumerate(vals):
            c = sh.cell(row=r, column=j + 1, value=v)
            c.font = Font(name=FONT, size=11, color='808080' if j == 0 else '000000')
            c.alignment, c.border = wrap, border
            if j == 4: c.fill = edit_fill
        r += 1
    for col, w in zip('ABCDEFG', [24, 28, 46, 46, 46, 30, 46]):
        sh.column_dimensions[col].width = w
    sh.freeze_panes = 'C2'
    sh.auto_filter.ref = 'A1:G%d' % (r - 1)
    sh.sheet_view.zoomScale = 110

out = sys.argv[1]
wb.save(out)
print('wrote', out, 'rows per language:', {c: sum(1 for k, _ in english['items'] if k in json.load(open(os.path.join(ROOT, 'i18n', c + '.json'), encoding='utf-8'))) for c, _ in LANGS})
