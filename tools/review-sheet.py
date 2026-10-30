"""Builds the translation review workbook for MOM's language team.
Usage: python tools/review-sheet.py <out.xlsx> [git ref of the last workbook sent, default HEAD]
Reads English from js/content.js (via node), drafts from i18n/<code>.json, languages from
tools/languages.json (only those live on the site: a js/lang/<code>.js script in index.html),
key terms from tools/glossary.json and sources from SOURCES.md."""
import json, os, re, subprocess, sys
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE = re.findall(r'js/lang/(\w+)\.js', open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read())
LANGS = sorted([(l['code'], l['sheet']) for l in json.load(open(os.path.join(ROOT, 'tools', 'languages.json'), encoding='utf-8')) if l['code'] in LIVE], key=lambda x: x[1])
BASE = sys.argv[2] if len(sys.argv) > 2 else 'HEAD'
GLOSSARY = json.load(open(os.path.join(ROOT, 'tools', 'glossary.json'), encoding='utf-8'))
FIXED = {'type', 'icon', 'code', 'helpline', 'video', 'app'}

english = json.loads(subprocess.check_output(['node', '-e', r'''
global.window = {}; require(process.argv[1]);
const out = []; const FIXED = new Set(['type','icon','code','helpline','video','app']);
(function walk(v, p) {
  if (typeof v === 'string') { out.push([p, v]); return; }
  if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${p}[${i}]`));
  for (const k in v) if (!(p === '' && k === 'manual') && !FIXED.has(k)) walk(v[k], p ? `${p}.${k}` : k);
})(window.SCAM_TEXT.en, '');
console.log(JSON.stringify({ items: out, learn: window.SCAM_TEXT.en.learn.map(s => s.title), quiz: window.SCAM_TEXT.en.quiz.map(q => q.title) }));
''', os.path.join(ROOT, 'js', 'content.js')]))

# Which SOURCES.md entries back each learn story and quiz item (IDs as in SOURCES.md).
ITEM_SOURCES = {
    'learn[0]': 'M1, M6, S1', 'learn[1]': 'S5, P2', 'learn[2]': 'S6, P5', 'learn[3]': 'S2, M3, M7, P3, M11, ICA1',
    'learn[4]': 'S3, S4, S5, G1, P3', 'learn[5]': 'M1, S1', 'act': 'S7', 'quiz[0]': 'M1, S1, S7', 'quiz[1]': 'S3, S5, S6', 'quiz[2]': 'S4, S5',
    'quiz[3]': 'S5, P2', 'quiz[4]': 'M1, M3, G1, P3', 'quiz[5]': 'S6, P6, S7',
}
def sources_for(key):
    m = re.match(r'(learn|quiz)\[\d+\]|act\b', key)
    return ITEM_SOURCES.get(m.group(0), '') if m else ''

def previous_draft(code):
    """The draft at BASE (the commit the last workbook was built from), to flag changed lines."""
    try:
        return json.loads(subprocess.check_output(['git', 'show', '%s:i18n/%s.json' % (BASE, code)], cwd=ROOT, stderr=subprocess.DEVNULL))
    except Exception:
        return None

def sealion(code):
    """SEA-LION's second opinion (tools/sealion-review.js), if it has been run for this language."""
    f = os.path.join(ROOT, 'review', 'sealion', code + '.json')
    return json.load(open(f, encoding='utf-8')) if os.path.exists(f) else None

SL_CONFIG = json.load(open(os.path.join(ROOT, 'tools', 'sealion-models.json'), encoding='utf-8'))
NOT_SUPPORTED = 'Not supported by SEA-LION'

def sealion_model_cell(code, sl):
    cfg = SL_CONFIG['languages'].get(code)
    if not cfg: return NOT_SUPPORTED
    base = ' (base-model check: not a SEA-LION-trained language)' if cfg.get('coverage') == 'base' else ''
    if not sl: return '%s (not run yet)%s' % (cfg['model'].split('/')[-1], base)
    if sl['model'] != cfg['model']: return '%s (OUTDATED: config now says %s)' % (sl['model'].split('/')[-1], cfg['model'].split('/')[-1])
    return '%s, checked %s%s' % (sl['model'].split('/')[-1], sl['checked'], base)

TRIAGE_FILE = os.path.join(ROOT, 'review', 'sealion', 'triage.json')
TRIAGE = json.load(open(TRIAGE_FILE, encoding='utf-8'))['notApplied'] if os.path.exists(TRIAGE_FILE) else {}

def sealion_cell(sl, key, en, draft, code):
    if not SL_CONFIG['languages'].get(code): return NOT_SUPPORTED
    r = sl and sl['results'].get(key)
    if not r: return ''
    if r.get('english') != en: return '(checked an older English version of this line)'
    back = '\nBack-translation of the checked text: ' + r['back'] if r.get('back') else ''
    if r['verdict'] == 'ok':
        return ('OK' if r['draft'] == draft else 'OK (this line was changed after the check)') + back
    if draft == r['suggestion']:
        return 'APPLIED its suggestion. Earlier draft: %s\nReason given: %s%s' % (r['draft'], r['reason'], back)
    why = TRIAGE.get(code, {}).get(key)
    if draft != r['draft']:
        return 'ADJUSTED: suggested "%s" (%s). %s%s' % (r['suggestion'], r['reason'], why or 'Applied with small changes.', back)
    return 'NOT APPLIED: suggested "%s" (%s). Why not: %s%s' % (r['suggestion'], r['reason'], why or 'see triage', back)

def where(key):
    m = re.match(r'learn\[(\d+)\]', key)
    if m: return 'Learn story %d: %s' % (int(m.group(1)) + 1, english['learn'][int(m.group(1))])
    m = re.match(r'quiz\[(\d+)\]', key)
    if m: return 'Quiz %d: %s' % (int(m.group(1)) + 1, english['quiz'][int(m.group(1))])
    return {'event': 'Home screen', 'ui': 'Buttons and labels (all screens)', 'act': 'ACT screen (after the last story)', 'feedback': 'Feedback screen'}[key.split('.')[0]]

def note(key, en, code, prev):
    n = []
    if prev is not None and key in prev and prev[key] != DRAFTS[code].get(key):
        n.append('CHANGED since the previous workbook: the English was simplified or corrected; please re-check.')
    elif prev is not None and key not in prev:
        n.append('NEW line since the previous workbook.')
    if re.search(r'\{\w+\}', en): n.append('Keep %s exactly; the site fills in the number.' % ', '.join(sorted(set(re.findall(r'\{\w+\}', en)))))
    if '.msg.bubbles' in key: n.append('Part of a fake message split into tappable parts. Parts always appear in this order, so each part must read naturally in sequence. Do not move a red-flag phrase into another part.')
    if '.chat.' in key or '.cards[' in key and key.endswith('.text') or '.options[' in key and '.label' not in key:
        n.append('Fictional scam/example message: keep it casual, as a real message would read.')
    if code == 'ur' and key == 'event.greeting':
        n.append('Deepavali is written دیپاولی, the name used in Singapore; دیوالی is also common. Change it everywhere if MOM prefers.')
    if code == 'ur' and ('$' in en or 'mom.gov.sg' in en or re.search(r'\d{3,}', en)):
        n.append('Urdu reads right to left; numbers, amounts and web addresses stay in Latin script and read left to right inside the line. Check it on a phone.')
    if code in ('hi', 'ur') and key.startswith('quiz[') and ('.options[' in key):
        n.append('First-person verbs use the masculine form (most attendees are men). Change if MOM prefers neutral wording.')
    if code == 'vi' and key.startswith('quiz[2]'):
        n.append('Pronouns assume an older male cousin ("anh") writing to a younger relative ("em").')
    if code == 'ta' and key in TA_SHORT: n.append('Shortened to fit a phone screen; please keep a similar length.')
    if key == 'ui.example' and code == 'ta': n.append('Shortened to "sample · fake" to fit the message header.')
    if any(t in en for t in ('Singpass', 'ScamShield', 'MOM', 'OTP', 'ACT', 'ADD', 'CHECK', 'TELL')):
        n.append('Keep brand and campaign names (MOM, Singpass, ScamShield, OTP, ACT/ADD/CHECK/TELL) in English.')
    return ' '.join(n)

TA_SHORT = {'event.intro', 'event.souvenirNote', 'learn[0].chat.lines[0]', 'learn[0].chat.lines[1]', 'learn[0].chat.lines[2]',
            'learn[0].chat.lines[3]', 'learn[0].flags[0].label', 'learn[0].flags[1].label', 'quiz[2].chat.lines[0]',
            'quiz[2].chat.lines[1]', 'quiz[2].options[1]', 'quiz[2].options[2]', 'quiz[4].msg.bubbles[0][0].t',
            'quiz[4].msg.bubbles[1][0].t', 'quiz[4].msg.bubbles[2][0].t', 'quiz[4].explain', 'learn[3].todo[0]'}

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
    ('Draft translations of the mini-site text (Learn stories, Quiz, Feedback, buttons) in the languages chosen for the event: %s. They were machine-drafted by Claude and have NOT been checked by a native speaker. They are live on the site so they can be tested; corrections from this review replace them.' % ', '.join(n for _, n in LANGS), False),
    ('Every rule in the text comes from a public MOM, ScamShield, Police or GovTech page. Column H names the sources (see the Sources tab), so you can check the meaning against the official wording.', False),
    ('', False),
    ('How to review', True),
    ('1. Open your language tab (%s). Check the Glossary tab first: agree the key terms once, then use them in every line.' % ', '.join(n for _, n in LANGS), False),
    ('2. Read column C (English) and column D (draft).', False),
    ('3. If the draft is right, leave column E empty.', False),
    ('4. If it needs changing, type the full corrected text in column E (yellow). Do not edit column D.', False),
    ('5. Use column F for questions or comments. Column G has notes about each line; lines marked CHANGED differ from the previous workbook.', False),
    ('Column I is a second opinion from SEA-LION (AI Singapore\'s language models), including a back-translation into English. Column J names the model: for each language, the newest SEA-LION model whose documentation lists that language (see the "SEA-LION models" tab). %s: no SEA-LION model was trained for them; they are checked with Qwen-SEA-LION-v4.5, relying on what its base model (Qwen3.6) knows of them, so give its comments less weight there. It is a machine check, not a native speaker: use it as a pointer, not a ruling.' % (lambda u: ', '.join(u[:-1]) + ' and ' + u[-1] if len(u) > 1 else ''.join(u))([n for c, n in LANGS if (SL_CONFIG['languages'].get(c) or {}).get('coverage') == 'base']), False),
    ('6. Send the file back. Corrections in column E are applied automatically (tools/import-review.py).', False),
    ('', False),
    ('Rules for all languages', True),
    ('Audience: migrant workers with varied reading levels. Use simple, everyday words and short sentences.', False),
    ('Keep in English: MOM, Singpass, ScamShield, OTP, ACT / ADD / CHECK / TELL, web addresses, phone numbers, amounts like $500.', False),
    ('Keep placeholders such as {n}, {k}, {i}, {s}, {t} exactly as written. The site replaces them with numbers.', False),
    ('Keep a similar length to the draft. Every screen must fit on a phone without scrolling.', False),
    ('Scam examples are fictional. They should sound like a real scam message, but must not name real people or companies.', False),
    ('Not translated (stays in English on purpose): masked phone numbers (+65 9XXX XXXX), the fake sender "Likely-SCAM" (the label Singapore phones show for unregistered SMS senders), the fake addresses mom-sg.org/pay and wponlinemomgov.sg.com, the file name "IPA LETTER.pdf", and "SMS".', False),
    ('Web addresses, amounts and numbers ($500, 1799, 99X9999, ".mom.gov.sg") must stay exactly as written. The build tool rejects a line where one is changed.', False),
    ('', False),
    ('Example of a filled-in row', True),
]
for i, (text, bold) in enumerate(rows, start=1):
    c = ws.cell(row=i, column=1, value=text)
    c.font = Font(name=FONT, bold=bold, size=14 if i == 1 else 11)
    c.alignment = Alignment(wrap_text=True, vertical='top')
ws.column_dimensions['A'].width = 120
ex_row = len(rows) + 1
headers = ['Key', 'Where it appears', 'English', 'Draft translation', 'Your correction', 'Reviewer comments', 'Notes', 'Sources', 'SEA-LION check', 'SEA-LION model (newest that supports this language)']
example = ['ui.tryAgain', 'Buttons and labels (all screens)', 'Try again', 'फिर से कोशिश करें', 'दोबारा कोशिश करें', 'Shorter and more common.', '', '', '', '']
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

DRAFTS = {code: json.load(open(os.path.join(ROOT, 'i18n', code + '.json'), encoding='utf-8')) for code, _ in LANGS}

# Glossary: the key terms used in each draft, side by side.
gl = wb.create_sheet('Glossary')
gl_head = ['English term'] + [n for _, n in LANGS]
for j, h in enumerate(gl_head):
    c = gl.cell(row=1, column=j + 1, value=h)
    c.font, c.fill, c.border, c.alignment = head_font, head_fill, border, wrap
for i, term in enumerate(GLOSSARY['terms'], start=2):
    for j, v in enumerate([term] + [GLOSSARY.get(code, {}).get(term, '') for code, _ in LANGS]):
        c = gl.cell(row=i, column=j + 1, value=v)
        c.font, c.border, c.alignment = Font(name=FONT, size=11, bold=(j == 0)), border, wrap
gl.cell(row=len(GLOSSARY['terms']) + 3, column=1, value='Brand and campaign names stay in English in every language: MOM, Singpass, ScamShield, OTP, ACT / ADD / CHECK / TELL.').font = Font(name=FONT, italic=True)
for j in range(len(gl_head)):
    gl.column_dimensions[chr(65 + j)].width = 22 if j else 18
gl.freeze_panes = 'B2'

# Sources: parsed from the table in SOURCES.md.
src = wb.create_sheet('Sources')
for j, h in enumerate(['ID', 'Publisher and page', 'Link']):
    c = src.cell(row=1, column=j + 1, value=h)
    c.font, c.fill, c.border = head_font, head_fill, border
r = 2
for line in open(os.path.join(ROOT, 'SOURCES.md'), encoding='utf-8'):
    m = re.match(r'\| ([A-Z]+\d+) \| (.+?) \| (https?://\S+) \|', line)
    if not m: continue
    for j, v in enumerate(m.groups()):
        c = src.cell(row=r, column=j + 1, value=v)
        c.font, c.border, c.alignment = Font(name=FONT, size=11), border, wrap
        if j == 2: c.hyperlink = v
    r += 1
for col, w in zip('ABC', [8, 60, 80]):
    src.column_dimensions[col].width = w

# SEA-LION models: which model checked each language, and the evidence that it is the newest one
# whose documentation lists that language.
slm = wb.create_sheet('SEA-LION models')
slm.cell(row=1, column=1, value='Each language is checked by the newest SEA-LION model whose documentation lists it (verified on %s). Languages no model lists are checked with Qwen-SEA-LION-v4.5, relying on its base model (Qwen3.6).' % SL_CONFIG['checked']).font = Font(name=FONT, bold=True)
for j, h in enumerate(['Language', 'SEA-LION model used', 'Release', 'Listed in its documentation as', 'Why this model', 'Last run']):
    c = slm.cell(row=3, column=j + 1, value=h)
    c.font, c.fill, c.border, c.alignment = head_font, head_fill, border, wrap
for i, (code, name) in enumerate(LANGS, start=4):
    cfg, sl = SL_CONFIG['languages'].get(code), sealion(code)
    if cfg:
        rel = SL_CONFIG['models'][cfg['model']]['release']
        if cfg.get('coverage') == 'base': newest = cfg['note']
        else: newest = 'Newest model that lists it. ' + (cfg.get('note') or 'v4.8 (Sep 2026) is the latest SEA-LION release and lists %s.' % cfg['listedAs'])
        row = [name, cfg['model'].split('/')[-1], rel, cfg['listedAs'] or 'not listed (base model: Qwen3.6)', newest, sl['checked'] if sl and sl['model'] == cfg['model'] else 'not run with this model yet']
    else:
        row = [name, NOT_SUPPORTED, '', '', 'No SEA-LION model lists this language. ' + SL_CONFIG['evidence']['none'], '']
    for j, v in enumerate(row):
        c = slm.cell(row=i, column=j + 1, value=v)
        c.font, c.border, c.alignment = Font(name=FONT, size=11, bold=(j == 1 and v == NOT_SUPPORTED)), border, wrap
r = len(LANGS) + 6
slm.cell(row=r, column=1, value='Evidence (SEA-LION documentation)').font = Font(name=FONT, bold=True)
for k, v in SL_CONFIG['evidence'].items():
    r += 1
    c = slm.cell(row=r, column=1, value='%s: %s' % (k, v)); c.font, c.alignment = Font(name=FONT, size=11), wrap
    slm.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
    slm.row_dimensions[r].height = 45
for col, w in zip('ABCDEF', [20, 36, 10, 22, 60, 14]):
    slm.column_dimensions[col].width = w

for code, name in LANGS:
    draft, prev, sl = DRAFTS[code], previous_draft(code), sealion(code)
    model_cell = sealion_model_cell(code, sl)
    sh = wb.create_sheet(name)
    for j, h in enumerate(headers):
        c = sh.cell(row=1, column=j + 1, value=h)
        c.font, c.fill, c.border = head_font, head_fill, border
        c.alignment = Alignment(wrap_text=True, vertical='center')
    r = 2
    for key, en in english['items']:
        if key not in draft: continue
        vals = [key, where(key), en, draft[key], None, None, note(key, en, code, prev), sources_for(key), sealion_cell(sl, key, en, draft[key], code), model_cell]
        for j, v in enumerate(vals):
            c = sh.cell(row=r, column=j + 1, value=v)
            c.font = Font(name=FONT, size=11, color='808080' if j == 0 else '000000')
            c.alignment, c.border = wrap, border
            if j == 4: c.fill = edit_fill
        r += 1
    for col, w in zip('ABCDEFGHIJ', [24, 28, 46, 46, 46, 30, 46, 16, 50, 30]):
        sh.column_dimensions[col].width = w
    sh.freeze_panes = 'C2'
    sh.auto_filter.ref = 'A1:J%d' % (r - 1)
    sh.sheet_view.zoomScale = 110

out = sys.argv[1]
wb.save(out)
print('wrote', out, 'rows per language:', {c: sum(1 for k, _ in english['items'] if k in json.load(open(os.path.join(ROOT, 'i18n', c + '.json'), encoding='utf-8'))) for c, _ in LANGS})
