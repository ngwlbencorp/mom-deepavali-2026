# Scam awareness quiz + souvenir system (Vercel + Neon)

The Deepavali scam quiz, with:
- **one claim ID per phone, registered in the database** when the quiz is submitted (clashes are detected and re-issued);
- **per-admin logins** (work email + shared admin password) and a scanner with a **live souvenir counter** on every screen;
- a **manual path** for MWs without a phone, which never blocks on duplicates;
- a **superadmin page** for admin email upload, a live dashboard, CSV downloads and a rehearsal reset.

## Pages

| Page | Who | What |
|---|---|---|
| `/index.html` | MWs | the quiz; the slide QR code points here |
| `/admin/index.html` | officers | log in → **Scan QR** or **Manual input**; live "souvenirs left" counter |
| `/superadmin/index.html` | you | Dashboard · Admins (CSV upload) · Data (CSV download, reset) |

The admin and superadmin pages are not linked from the quiz. Bookmark them.

## The mini-site (for MWs)

- **Home** → **Learn about scams** (6 animated stories: fake MOM officer, fake festive deal, scam mule, fake job/work permit, secret codes, fake MOM message; then a "Remember ACT" screen) or **Quiz for a souvenir**.
- **Quiz:** 6 interactive challenges, 9 points in total. The formats are: spot the red flags (tap exactly the number shown; changing your mind is allowed); scam or safe (4 cards, one point each); what would you reply; and pick the safe way. **Answers are revealed only at the end**, under "Review answers".
- **Feedback** (rating + "learned something new") is required once, before the first result.
- **Fits the screen:** every screen fits without scrolling at 320×568, 360×640 and 390×844 (checked by `tests/fit.test.js`). If text is ever longer (big system font, long translation), only the middle area scrolls.
- **Wording** lives in `js/content.js`, in short plain-English sentences so it translates cleanly. Every rule it teaches, and every quiz answer, is traced to a public MOM, ScamShield, Police or GovTech page in [SOURCES.md](SOURCES.md).

- **Branding and legal footer:** the header shows the MOM logo (`img/mom-logo.png`, on a white bar); the home page ends with the GovTech logo (`img/govtech-logo.png`) and "By using this site, you agree to the Terms of Use and Privacy Statement", linking to GovTech's pages (`https://www.tech.gov.sg/terms-of-use/`, `https://www.tech.gov.sg/privacy/`). The footer may sit below the fold on a short screen; the fit check ignores it. Images go through `asset()` in `js/app.js`, so they load from Vercel when the page comes through the ducks.ai shell.

### Languages

English is live. Drafts exist for the **nine languages MOM uses for its migrant-worker guides and scam materials**: Bahasa Indonesia, Bengali, Burmese, Chinese, Hindi, Tagalog, Tamil, Thai and Vietnamese. MOM also publishes one document, the domestic-worker safety agreement, in Khmer and Sinhalese; those two have no drafts. The evidence, language by language, is in [SOURCES.md](SOURCES.md#languages-mom-publishes-in) (pages checked 29 Oct 2026). **None is switched on**: they were machine-drafted and must be checked by MOM's language team first. MOM decides which ones to publish.

- **Source of truth:** `i18n/<code>.json` (flat `"key": "text"` pairs). `js/lang/<code>.js` is generated from it by `node tools/build-lang.js`, which rejects unknown keys, broken `{n}` placeholders, and any line where a web address, amount or number from the English (`mom-sg.org/pay`, `$500`, `1799`) was changed or dropped.
- **Language list:** `tools/languages.json` (code, menu name, workbook tab). Key terms per language: `tools/glossary.json`.
- **Review round trip:**
  1. `python tools/review-sheet.py review.xlsx [base-commit]` builds the review workbook: a Glossary tab (agree key terms once), a Sources tab, and one tab per language with English, the draft, a yellow "Your correction" column, notes, and the sources behind each line. Lines that changed since `base-commit` (default: the last commit; pass the commit the previous workbook was built from) are marked CHANGED or NEW.
  Before step 1, optionally get a machine second opinion: `node tools/sealion-review.js` sends each line to SEA-LION (AI Singapore's model, tuned for Burmese, Indonesian, Tagalog, Tamil, Thai and Vietnamese) and saves a back-translation and any suggested fix to `review/sealion/<code>.json`. It needs `SEALION_API_KEY` in the environment (never in a file), respects the free tier's 10 requests a minute, and skips lines already checked. Suggestions are not applied automatically: they are triaged by hand, and `review/sealion/triage.json` records why any suggestion was not applied. The workbook's "SEA-LION check" column shows, per line, whether its suggestion was applied, adjusted or not applied, with the reason. Behind an HTTPS proxy, run it with `NODE_USE_ENV_PROXY=1`.
  2. The language team fills in corrections only where needed.
  3. `python tools/import-review.py reviewed.xlsx` applies them to `i18n/*.json`, then run `node tools/build-lang.js`.
- **Changing the English later:** edit `js/content.js`, update the affected lines in every `i18n/<code>.json`, then run `node tools/build-lang.js --snapshot`. Without `--snapshot`, the build reports every translation whose English changed as stale, so an outdated line is never shipped silently.
- **Switching a language on:** add `<script src="./js/lang/<code>.js"></script>` to `index.html`, before `js/i18n.js`. The language button appears automatically.
- **Safety:** a translation can only change text. Answers, red flags, scoring, quiz types, icons and feedback codes always come from the English file.
- **Fitting the screen:** tested with Noto fonts (as on Android). Every language fits every screen at 360×640 and 390×844. At 320×568 (small, older phones) every language fits except Tamil, where the middle area scrolls on 8 screens. If a screen ever overflows (long translation, large system font), `fit()` in `js/app.js` steps the text down automatically, at most twice. Re-run `tests/fit.test.js` with the language code after corrections, because longer corrected text can change this.
- **Burmese** is in Unicode Myanmar script. Very old phones that still use the Zawgyi font will show it garbled.

## Event window and souvenirs left

- **After the event ends** (`EVENT_END` on the server, `eventEnd` in `js/config.js`; default 8 Nov 2026, 9 pm SGT):
  - the mini-site keeps working as a learning quiz but shows **no QR code, no claim code and no souvenir wording**;
  - the server refuses all redemptions (`/api/redeem`, `/api/manual`) with `event_closed`, whatever a phone's clock says. When the server can be reached, its answer overrides the phone's clock on the mini-site too;
  - quiz submissions are still recorded, so later visits appear in the dashboard and exports. Filter by date if you report event-day figures only.
- **Souvenirs left:** the home and result screens show "🎁 N souvenirs left", refreshed every 20 seconds while one of those screens is open. It comes from the public `/api/remaining`, which Vercel's edge caches for 10 seconds, so the database sees about one query per 10 seconds however many phones are open. At 0, the QR code is replaced by "All souvenirs have been given out".

## How claim IDs work

1. On the first visit, the phone makes a random 8-character ID plus a secret 32-hex **device key**, and keeps both in browser storage.
2. When the quiz is finished (after the one-off feedback questions), the phone posts `{id, key, score, ...}` to `/api/submit`.
   - **New ID:** registered to this phone (the server stores a hash of the key).
   - **Same ID, same key:** the same phone retrying, so attempts +1.
   - **Same ID, different key:** another phone already owns it, so the server answers **409**. The phone makes a new ID and key and resubmits, up to 5 times. The MW never sees this.
3. The QR code shows the registered ID. Officers scan it, or type the 8 characters. The database is the source of truth, not the QR contents.
4. **No connection when submitting:** the result page says "not saved yet" with a Retry button, and still shows the QR. An officer's scan of that QR creates the claim from the QR, and the phone can still register it later.

**Odds of a random clash:** about 1 in 2.2 million at 1,000 phones. When one does happen, step 2 handles it.

## How souvenirs are counted

- `/api/redeem` and `/api/manual` both run inside one transaction holding a global lock (`pg_advisory_xact_lock`). Each re-checks "not redeemed yet", "full score" and "under `REDEEM_CAP`" before writing. Two officers can't both give a souvenir to one code, and the cap can't be overshot. Tested with 20 parallel redeems and a mixed burst past the cap.
- **Manual input never rejects duplicates:** each submission without a retry ID creates a new claim. Its souvenirs still count towards the same cap.
- Every admin screen polls `/api/stats` every 5 seconds, and updates instantly after the officer's own actions. If the server can't be reached for about 12 seconds, the counter turns red: "offline: do not give souvenirs". Scans then say "Not checked", with no give button.

## Environment variables (Vercel → Settings → Environment Variables)

| Name | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string (the host contains `-pooler`), ending `?sslmode=require` |
| `ADMIN_PASSWORD` | the shared password for all officers |
| `SUPERADMIN_USER` | your superadmin login ID |
| `SUPERADMIN_PASSWORD` | your superadmin password. **Must differ from `ADMIN_PASSWORD`**, or superadmin login is refused |
| `REDEEM_CAP` | `500` |
| `EVENT_END` | optional; when redemption closes, default `2026-11-08T21:00:00+08:00`. Keep it equal to `eventEnd` in `js/config.js` |
| `SESSION_SECRET` | optional; signs login tokens. If unset, it is derived from the passwords, so changing any password logs everyone out |
| `ALLOWED_ORIGINS` | optional, e.g. `https://ducks.ai.tech.gov.sg`; if unset, any origin is accepted (logins still protect everything except the quiz submit) |
| `BUG_API_TOKEN` | optional; a long random secret (at least 32 characters) that lets the bug-fixing agent read bug reports and record fixes, and nothing else. Put the same value in the Claude environment's secrets. Unset = only the superadmin can read reports |
| `RESEND_API_KEY`, `BUG_NOTIFY_EMAIL` | optional; with both set, each new bug report sends a short email (report number only) through [Resend](https://resend.com). `BUG_NOTIFY_FROM` overrides the sender |

Logins last 14 hours, and only for the browser tab they were made in.

## Deploy

1. **Neon:** create a project (Singapore region if offered) and copy the pooled connection string. The tables are created automatically on the first call.
2. **Vercel:** new project from this folder (drag and drop the unzipped folder, or import from a repo). Framework preset: **Other**, no build command.
3. Add the env vars above, then **Redeploy**. Env vars do not apply to an existing deployment.
4. **Turn off Deployment Protection** (Vercel Authentication), or phones get a Vercel login page instead of the API.
5. Check from a phone on mobile data: `https://<app>.vercel.app/api/ping` should show `{"ok":true,...}`.
6. All API routes run in **one** Vercel function: `vercel.json` rewrites `/api/<name>` to `api/index.js`, which dispatches to `lib/routes/<name>.js`. This keeps the deployment far below Vercel's per-deployment function limit, and the admins' polling keeps that one function warm. To add a route, add a file in `lib/routes/` and one line in `api/index.js`.

## The mini-site on ducks.ai: a shell that loads from Vercel

The ducks.ai page (the address in the QR code) holds a small **shell**, uploaded once. On each visit the shell fetches `index.html` from the Vercel project, puts its page structure in place, and loads its stylesheets and scripts from Vercel. A push to `main` therefore changes the live mini-site with no new upload: the next visit gets the new version. A page already open keeps the version it loaded, so nobody's quiz changes mid-way.

- **Build:** `node tools/build-shell.js` writes `dist/ducks-site-shell.zip`. Upload it to the ducks.ai page in place of the old files.
- **Fallback:** the zip also carries a copy of the site (`fallback/`: `index.html` and every file it refers to) taken when it was built. It is used if Vercel does not answer within 5 seconds, or if one of its files fails to load. Quiz submissions still need the API, so a full Vercel outage still stops souvenir claims. The copy is only as fresh as the last build, so rebuild and re-upload the zip before the event if the site changed a lot since.
- **Frozen:** `node tools/build-shell.js --frozen` makes a zip that never contacts Vercel for the pages (the API is still on Vercel).
- **Storage:** the scripts run in the ducks.ai page, so claim IDs, device keys and the chosen language are stored for the ducks.ai address, as before.
- **Settings:** `shell/config.js` (`base`, the Vercel address; `timeoutMs`). `js/config.js` holds the API address, `https://ducks-vercel-api.vercel.app`.
- **A bad push is live at once.** Run the tests before pushing. If something breaks during the event, use Vercel's **Instant Rollback** to the previous deployment (Vercel → project → Deployments).
- **Officer page on ducks.ai:** `node tools/build-shell.js --admin` writes `dist/ducks-admin-shell.zip`, the same shell set to load `admin/index.html`. Upload it once to its own ducks.ai page (e.g. `deepavali-2026-officers`) and give officers that address. It bundles no copy (the page cannot work without the API); if Vercel cannot be reached it says "Cannot reach the server". The camera works there because the ducks.ai page is served over HTTPS with no policy blocking it; test it on real phones. The Vercel address (`https://ducks-vercel-api.vercel.app/admin/`) keeps working as a backup.
- **ducks.ai's presenter gate:** ducks.ai adds a script for slide decks to every hosted page that cancels every **n** and **t** key press unless the tab is in presenter mode, and presenter mode shows ducks.ai's **edit text** button. The officer page keeps presenter mode off and puts those letters back into its own text boxes; it also hides the edit button. The shells switch off all of ducks.ai's page buttons (catalog link, report, edit, likes, download) with ducks.ai's own switch, `<meta name="ducks-home" content="off">`, and hide the plain "← decks" link it writes into every page; its report page only opens on government networks, so it is no use to the public. With the buttons off, the pages no longer leave room for them. `tests/gate.test.js` checks it with ducks.ai's gate script (`tests/fixtures/ducks-gate.html`) and its `/shared/deck-home.js` served at `/p/<page>/`. The mini-site has no text boxes. For the slides, present with `?ducks-presenter=1` (or ducks.ai's Present action), or the N key (notes) does nothing.
- **Superadmin** stays on Vercel: `https://ducks-vercel-api.vercel.app/superadmin/`.

## Vercel Hobby plan: usage budget

Hobby limits (Vercel's Hobby plan page, via search on 29 Oct 2026; vercel.com was not reachable from the drafting environment): per month, 1,000,000 function invocations, 1,000,000 CDN requests, 100 GB fast data transfer, 4 hours active CPU, 360 GB-hours provisioned memory. They are per **account**, so `remoteducks` shares them. **Exceeding one pauses that feature for up to 30 days**: on event day, that would take the site down.

Estimated use for the event month (measured locally: about 1 ms of CPU per API request; a mini-site visit downloads about 45 KB compressed):

| Meter | Main users | Estimate | Share of limit |
|---|---|---|---|
| Function invocations | officer counters (every 5 s while in use), quiz submits, superadmin | ~90,000 | ~9% |
| CDN requests | the above, plus page files and phones' souvenir-count checks (cached 10 s) | ~150,000 | ~15% |
| Data transfer | ~2,000 visits × 45 KB, officer pages, screenshots | < 1 GB | < 1% |
| Active CPU | ~100,000 requests × 1–10 ms | < 0.3 h | < 8% |

The one meter without a natural ceiling was an officer screen left open: every 5 s is ~17,000 requests a day. After 10 minutes without a tap, the counter now refreshes once a minute (~1,400 a day), which still keeps the database awake; any tap brings back 5 s.

Check **Vercel → Usage** after the briefing and the day before the event. Hobby is limited to personal, non-commercial use by Vercel's terms; for an organisation's event, the Pro plan for the event month removes that question and replaces the 30-day pause with pay-as-you-go.

## Superadmin prep (before the event)

1. Log in at `/superadmin/index.html`.
2. **Admins tab:** upload a CSV of officer work emails. Any cell containing an email is used, so a column with a header is fine. Choose **Add** or **Replace**. Removing an email locks that officer out on their next action.
3. Give officers the officer page's ducks.ai address and the shared admin password.
4. Rehearse end to end on the real venue network.
5. **Data tab → Clear rehearsal data** (type RESET). Rehearsal souvenirs count towards the cap until you do this.

## Reporting

- **Dashboard** (refreshes every 15 seconds): a **Database** tile, superadmin only, showing whether the database was awake and how fast it answered (Neon's free plan sleeps after 5 minutes without queries; the first query after that takes a second or more); souvenirs given vs cap; quiz submissions (self and manual); MWs reached (claim IDs); first-try full-score rate; eventual full-score rate; average attempts to full score; average satisfaction and its distribution; "learned something new". There is also a cumulative chart over time, with a table view.
- **Data tab:** CSV downloads of `claims` (one row per claim ID), `submissions` (one row per quiz attempt) and `admins`.

### ⚠ Check whether the site can really measure first-try and multiple-try success

Attempts are counted **per claim ID, which means per phone browser, not per person**. The figures are only reliable if:
- each MW uses one phone and one browser, and does not clear browser data;
- each phone's submissions reach the server. A submission made offline and never retried is not counted; if the officer's scan registers it, the phone's own count is used;
- you accept that answers are shown after each question, so a second attempt is close to guaranteed to be full marks. "Attempts to full score" therefore mostly measures whether people retried, not how much they learned.

Manual claims use 3 spoken questions, not the 8-question quiz, so they're excluded from the self-submit try rates. Decide whether this is good enough before reporting these as outcome measures. If it isn't, the first-attempt score distribution (in the `submissions` CSV, `attempt = 1`) is the more defensible learning signal.

## Database (Neon Postgres)

The table `scans` keeps the original eight columns from the brief: `id, score, total, station, first_seen, last_seen, redeemed_at, redeemed_station`.
- `station` now holds the email of the last officer who scanned the claim.
- `redeemed_station` holds the email of the officer who gave the souvenir.

**New names added for this build** (rename them before go-live if you prefer):

| Table | Column | Meaning |
|---|---|---|
| `scans` | `source` | `self` (MW's phone) or `admin` (manual input) |
| `scans` | `device_key_hash` | SHA-256 of the phone's device key; never returned or exported |
| `scans` | `attempts` | number of quiz submissions for this claim |
| `scans` | `first_full` | the attempt number that first scored full marks |
| `scans` | `csat`, `learned` | feedback answers (1–5; Y, S or N) |
| `scans` | `created_by` | officer email for manual claims |
| `submissions` | `id, claim_id, attempt, score, total, source, submitted_by, created_at` | one row per quiz attempt or manual submission |
| `admins` | `email, added_at` | officers allowed to log in |

No names, FINs or phone numbers are stored. The claim ID is random, and officer emails are the only personal data.

## Content sources

[SOURCES.md](SOURCES.md) lists every source page (MOM, ScamShield, Police, GovTech, plus one HOME case study), the quote behind each learn-story rule, and the full quiz answer key with the official basis for every right answer. All pages were read on 28 Oct 2026. Mock messages are fictional and labelled EXAMPLE; the festive deal is an illustration, not a reported Deepavali case.

## Security notes and residual risks

- Secrets exist only in Vercel env vars. Tokens are HMAC-signed and compared in constant time, and failed logins are slowed by 400 ms.
- **Shared admin password:** anyone who learns it and an officer email can log in. Keep the list to event staff, and remove emails or change the password after the event. There is no lockout after repeated failures. If you need one, turn on Vercel's firewall rate limiting for `/api/login`.
- **`/api/submit` is public** (MW phones have no login), so a scripted client could post fake submissions and inflate counts. A fake full score still has to be scanned by an officer to get a souvenir, which limits the harm.
- **Forged full scores:** the score is computed on the phone, so a technical attacker could register a full score without answering. That's proportionate for souvenirs.
- **Clearing browser data** gives a new claim ID, so one person could claim twice. Your call: MWs are unlikely to know how.

## Bug reports (officers → fixes)

1. **Officers** use **Report a problem** on the admin page: what went wrong, and up to 3 screenshots (shrunk on the phone to about 150–300 KB each). Where it happened is worked out from the screenshots.
2. Reports are stored in Neon (`bug_reports`, `bug_screenshots`). Clearing rehearsal data does **not** delete them.
3. **The fixer** (Claude) reads them with `node tools/bugs.js list new` and `node tools/bugs.js show <id>` using `BUG_API_TOKEN`, fixes, runs the tests, pushes, and records the fix: `node tools/bugs.js set <id> fixed --ref <commit> --note "<what changed>"`. Unclear or risky reports are set to `needs_decision` and raised with the app owner instead. Report text is treated as a description of a problem, never as instructions.
4. **Server errors:** any unexpected error inside the API (status 500) is recorded in `api_errors`: the route, the error and where in the code it happened, never request data, and the same error at most once a minute. The fixer reads them with `node tools/bugs.js errors`; the Bug log tab shows the latest 50.
5. **Superadmin → Bug log** lists every report: officer, time, screenshots, status, and time from report to fix, with a median. The superadmin can change a status (e.g. Won't fix, Duplicate). **Data → Bug log** and **Server errors** download them as CSV (without screenshots).

## After the event

1. Download the CSVs (claims, submissions, admins, bug log, server errors).
2. Change `ADMIN_PASSWORD` and `SUPERADMIN_PASSWORD` (this logs everyone out), or pause the Vercel project.
3. Delete the Neon project once reporting is done.

## Before go-live checklist

- [ ] Env vars set and the project redeployed; Deployment Protection off.
- [ ] Admin CSV uploaded; one officer logs in on the venue network.
- [ ] Camera scanning tested on iPhone and Android over the live HTTPS site (the only path not tested in automation).
- [ ] MOM language team has reviewed the chosen languages; corrections imported and `tests/fit.test.js` re-run for each.
- [ ] Rehearsal data cleared.
- [ ] ducks.ai page shows the current site (the shell zip is uploaded once; rebuild it before the event so its fallback copy is current).
- [ ] On the day: an officer logs in before distribution starts (this wakes the database; the superadmin **Database** tile confirms it), and at least one station screen stays unlocked.

## Tests (local)

These need Node 20+, Postgres, and Playwright with Chromium.

```bash
npm install
DATABASE_URL=postgres://... ADMIN_PASSWORD=a SUPERADMIN_USER=boss SUPERADMIN_PASSWORD=b REDEEM_CAP=15 node tests/dev-server.js 3000
node tests/api.test.js http://127.0.0.1:3000 a boss b 15        # 46 API checks; needs an EMPTY database
# restart the dev server with REDEEM_CAP=500, serve a copy of the pages whose js/config.js points at :3000, then:
node tests/e2e-server.js http://127.0.0.1:8832/ http://127.0.0.1:3000 a boss b ./shots   # 31 browser checks
```

Both test scripts reset data. Never run them against the production database.

iOS zoom (`tests/zoom.test.js`): every text box, list and file picker on the officer and superadmin pages must be at least 16px, or iPhones zoom in on tap and stay zoomed. Run `node tests/zoom.test.js <site copy> <adminPw> <superUser> <superPw>` after any style change to those pages.

The ducks.ai shell (`tests/shell.test.js`): serve a copy of the pages with CORS as a stand-in for Vercel (`python3 tests/serve-cors.py 8890 <copy>`), build the zips from it (`node tools/build-shell.js --root <copy> --out …`, and again with `--frozen`), unpack three shells (base set to the stand-in, with a `<div id="ducks-extra">` added before the scripts; base set to a dead port; frozen), serve each, then:

```bash
node tests/shell.test.js http://127.0.0.1:8890/ <copy> <remote shell> <dead shell> <frozen shell>   # 10 checks
```

The officer page through the shell: build `--admin` shells with `--base http://127.0.0.1:8890/` (and one with a dead port), unpack, add `hostOverlay: true` to a third copy's `config.js`, serve them, then:

```bash
node tests/admin-shell.test.js <admin shell> <dead admin shell> <overlay admin shell> <adminPw>   # 6 checks, simulated camera
ADMIN_URL=<admin shell>index.html node tests/e2e-server.js ...                                  # the whole officer flow, through the shell
node tests/fit.test.js <remote shell> 360 640 && node tests/nav.test.js <remote shell>             # same site, through the shell
```
