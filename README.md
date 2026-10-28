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

- **Home** → **Learn about scams** (5 animated stories: fake MOM officer, fake festive deal, scam mule, fake job/work permit, secret codes + ACT) or **Quiz for a souvenir**.
- **Quiz:** 6 interactive challenges, 9 points in total. The formats are: spot the red flags (tap exactly the number shown; changing your mind is allowed); scam or safe (4 cards, one point each); what would you reply; and pick the safe way. **Answers are revealed only at the end**, under "Review answers".
- **Feedback** (rating + "learned something new") is required once, before the first result.
- **Fits the screen:** every screen fits without scrolling at 320×568, 360×640 and 390×844 (checked by `tests/fit.test.js`). If text is ever longer (big system font, long translation), only the middle area scrolls.
- **Wording** lives in `js/content.js`. Scenarios are drafts from public MOM/ScamShield guidance; check the items marked `VERIFY`.

### Languages

English is live. **Burmese, Hindi and Tamil** (the languages MOM uses for its scam-awareness video) are drafted but **not switched on**: the drafts were machine-written and must be checked by MOM's language team first.

- **Source of truth:** `i18n/<code>.json` (flat `"key": "text"` pairs). `js/lang/<code>.js` is generated from it by `node tools/build-lang.js`, which rejects unknown keys and broken `{n}` placeholders.
- **Review round trip:**
  1. `python tools/review-sheet.py review.xlsx` builds the review workbook: one tab per language, with English, the draft, a yellow "Your correction" column and line-by-line notes.
  2. The language team fills in corrections only where needed.
  3. `python tools/import-review.py reviewed.xlsx` applies them to `i18n/*.json`, then run `node tools/build-lang.js`.
- **Switching a language on:** add `<script src="./js/lang/<code>.js"></script>` to `index.html`, before `js/i18n.js`. The language button appears automatically.
- **Safety:** a translation can only change text. Answers, red flags, scoring, quiz types, icons and feedback codes always come from the English file.
- **Fitting the screen:** with Noto fonts (as on Android), every language fits every screen at 360×640 and 390×844. Burmese and Hindi also fit at 320×568. Tamil at 320×568 (very small, older phones) needs the middle area to scroll on a few screens. If a screen ever overflows (long translation, large system font), `fit()` in `js/app.js` steps the text down automatically, at most twice. Re-run `tests/fit.test.js` with the language code after corrections, because longer corrected text can change this.
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

Logins last 14 hours, and only for the browser tab they were made in.

## Deploy

1. **Neon:** create a project (Singapore region if offered) and copy the pooled connection string. The tables are created automatically on the first call.
2. **Vercel:** new project from this folder (drag and drop the unzipped folder, or import from a repo). Framework preset: **Other**, no build command.
3. Add the env vars above, then **Redeploy**. Env vars do not apply to an existing deployment.
4. **Turn off Deployment Protection** (Vercel Authentication), or phones get a Vercel login page instead of the API.
5. Check from a phone on mobile data: `https://<app>.vercel.app/api/ping` should show `{"ok":true,...}`.
6. All API routes run in **one** Vercel function: `vercel.json` rewrites `/api/<name>` to `api/index.js`, which dispatches to `lib/routes/<name>.js`. This keeps the deployment far below Vercel's per-deployment function limit, and the admins' polling keeps that one function warm. To add a route, add a file in `lib/routes/` and one line in `api/index.js`.

## Hosting the pages on ducks instead

`js/config.js` is already set to `https://ducks-vercel-api.vercel.app` (origin only; change it if the project URL changes). Zip and upload `index.html`, `css/`, `js/`, `admin/` and `superadmin/`. The API stays on Vercel. Admins and the superadmin use the ducks URLs.

## Superadmin prep (before the event)

1. Log in at `/superadmin/index.html`.
2. **Admins tab:** upload a CSV of officer work emails. Any cell containing an email is used, so a column with a header is fine. Choose **Add** or **Replace**. Removing an email locks that officer out on their next action.
3. Give officers the admin page URL and the shared admin password.
4. Rehearse end to end on the real venue network.
5. **Data tab → Clear rehearsal data** (type RESET). Rehearsal souvenirs count towards the cap until you do this.

## Reporting

- **Dashboard** (refreshes every 15 seconds): souvenirs given vs cap; quiz submissions (self and manual); MWs reached (claim IDs); first-try full-score rate; eventual full-score rate; average attempts to full score; average satisfaction and its distribution; "learned something new". There is also a cumulative chart over time, with a table view.
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

The scam content follows public, official guidance, checked on 26 Oct 2026:
- MOM, "Transact safely and securely" (MOM may call about work; the four "never" items; "gov.sg" SMS sender; ".mom.gov.sg" addresses; published fake addresses such as mom-sg.org): https://www.mom.gov.sg/transact-safely-and-securely
- MOM, "Staying safe from scams" (ACT; 1799; video in English, Burmese, Hindi and Tamil): https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-domestic-worker/publications-and-resources/staying-safe-from-scams
- ScamShield, "I can ACT against scams": https://www.scamshield.gov.sg/get-involved/i-can-act-campaign/
- ScamShield, scam mules (fines, jail, caning): https://www.scamshield.gov.sg/i-want-protection-from-scams/scam-mules/
- Police, 24 Sep 2026 (scam mules: up to 12 strokes of the cane at the court's discretion): https://www.police.gov.sg/Media-Hub/News/2026/09/20260924_police_investigate_259_scammers_and_money_mules_in_islandwide_enforcement_operation
- Police, 20 Oct 2026 (fake social media ads leading to app files): https://www.police.gov.sg/Media-Hub/News/2026/10/20261020_police_advisory_on_malware_from_social_media_advertisements

All mock messages are fictional and labelled EXAMPLE. The festive deal is an illustration, not a reported Deepavali case.

## Security notes and residual risks

- Secrets exist only in Vercel env vars. Tokens are HMAC-signed and compared in constant time, and failed logins are slowed by 400 ms.
- **Shared admin password:** anyone who learns it and an officer email can log in. Keep the list to event staff, and remove emails or change the password after the event. There is no lockout after repeated failures. If you need one, turn on Vercel's firewall rate limiting for `/api/login`.
- **`/api/submit` is public** (MW phones have no login), so a scripted client could post fake submissions and inflate counts. A fake full score still has to be scanned by an officer to get a souvenir, which limits the harm.
- **Forged full scores:** the score is computed on the phone, so a technical attacker could register a full score without answering. That's proportionate for souvenirs.
- **Clearing browser data** gives a new claim ID, so one person could claim twice. Your call: MWs are unlikely to know how.

## After the event

1. Download all three CSVs.
2. Change `ADMIN_PASSWORD` and `SUPERADMIN_PASSWORD` (this logs everyone out), or pause the Vercel project.
3. Delete the Neon project once reporting is done.

## Before go-live checklist

- [ ] Env vars set and the project redeployed; Deployment Protection off.
- [ ] Admin CSV uploaded; one officer logs in on the venue network.
- [ ] Camera scanning tested on iPhone and Android over the live HTTPS site (the only path not tested in automation).
- [ ] Comms/legal sign-off on the quiz and the manual questions (`js/content.js`, `manual`); check the `VERIFY` items.
- [ ] Rehearsal data cleared.

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
