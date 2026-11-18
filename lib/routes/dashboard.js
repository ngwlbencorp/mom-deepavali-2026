const { db, ensureSchema, route, stats, getEvent, listEvents, VIS } = require('../lib');

const BUCKET_MIN = 10;

// Superadmin: key figures and a 10-minute timeline for the live dashboard, for one event
// (?event=<id>; default: the current event, else the next, else the latest). Every figure counts
// only that event's rows, and leaves out rows hidden by its "Clear test data" (lib.js VIS).
// Claims (scans s) and attempts (submissions b) are joined with their event (e).
const S = (where) => `FROM scans s JOIN events e ON e.id = s.event_id WHERE s.event_id = $1 AND ${VIS.claim}${where ? ' AND ' + where : ''}`;
const B = (where) => `FROM submissions b JOIN events e ON e.id = b.event_id WHERE b.event_id = $1 AND ${VIS.attempt}${where ? ' AND ' + where : ''}`;
module.exports = route(['GET'], 'super', async (req) => {
  // Database response time, for the superadmin's "awake" indicator. Neon's free plan sleeps after
  // 5 minutes without queries; the first query after that takes a second or more while it wakes.
  const t0 = Date.now();
  await db().query('SELECT 1');
  const dbMs = Date.now() - t0;
  await ensureSchema();
  const q = db();
  const ev = await getEvent(q, new URL(req.url, 'http://x').searchParams.get('event'));
  const P = [ev.id];
  const [base, k, sub, tl, langs, stories, reasons, items, officers, listed] = await Promise.all([
    stats(q, ev),
    q.query(`
      SELECT
        count(*) FILTER (WHERE source = 'self') AS self_claims,
        count(*) FILTER (WHERE source = 'admin') AS admin_claims,
        count(*) FILTER (WHERE source = 'self' AND first_full IS NOT NULL) AS self_full,
        count(*) FILTER (WHERE source = 'self' AND first_full = 1) AS self_first_try,
        avg(first_full) FILTER (WHERE source = 'self' AND first_full IS NOT NULL) AS self_avg_attempts_to_full,
        count(*) FILTER (WHERE source = 'admin' AND first_full = 1) AS admin_first_try,
        count(*) FILTER (WHERE ${VIS.given} AND source = 'admin') AS admin_given,
        avg(csat) AS csat_avg,
        count(csat) AS csat_n,
        count(*) FILTER (WHERE csat = 1) AS c1, count(*) FILTER (WHERE csat = 2) AS c2,
        count(*) FILTER (WHERE csat = 3) AS c3, count(*) FILTER (WHERE csat = 4) AS c4,
        count(*) FILTER (WHERE csat = 5) AS c5,
        count(*) FILTER (WHERE learned = 'Y') AS ly, count(*) FILTER (WHERE learned = 'S') AS ls,
        count(*) FILTER (WHERE learned = 'N') AS ln
      ${S()}`, P),
    q.query(`SELECT count(*) FILTER (WHERE source = 'self') AS self, count(*) FILTER (WHERE source = 'admin') AS admin ${B()}`, P),
    q.query(`
      WITH sb AS (
        SELECT to_timestamp(floor(extract(epoch FROM created_at) / ${BUCKET_MIN * 60}) * ${BUCKET_MIN * 60}) AS t, count(*) AS n
        ${B()} GROUP BY 1
      ), g AS (
        SELECT to_timestamp(floor(extract(epoch FROM redeemed_at) / ${BUCKET_MIN * 60}) * ${BUCKET_MIN * 60}) AS t, count(*) AS n
        FROM scans s JOIN events e ON e.id = s.event_id WHERE s.event_id = $1 AND ${VIS.given} GROUP BY 1
      )
      SELECT COALESCE(sb.t, g.t) AS t, COALESCE(sb.n, 0) AS submissions, COALESCE(g.n, 0) AS given
      FROM sb FULL JOIN g ON sb.t = g.t ORDER BY 1`, P),
    // phones' claims by the language of their latest attempt (manual claims have none)
    q.query(`SELECT COALESCE(language, '?') AS language, count(*) AS n ${S("source = 'self'")} GROUP BY 1 ORDER BY 2 DESC, 1`, P),
    // first-try full score for phones that viewed learning stories before their first attempt, and those that did not
    q.query(`SELECT stories_viewed > 0 AS viewed, count(*) AS n, count(*) FILTER (WHERE first_full = 1) AS first_try
             ${S("source = 'self' AND stories_viewed IS NOT NULL")} GROUP BY 1`, P),
    q.query(`SELECT COALESCE(manual_reason, '?') AS reason, count(*) AS n ${S("source = 'admin'")} GROUP BY 1 ORDER BY 2 DESC`, P),
    // each phone's first attempt, question by question
    q.query(`SELECT item_scores ${B("source = 'self' AND attempt = 1 AND item_scores IS NOT NULL")}`, P),
    // souvenirs given per officer: redeemed_station holds the email of the officer logged in when it was given
    q.query(`SELECT redeemed_station AS officer, count(*) AS n, count(*) FILTER (WHERE source = 'admin') AS manual, max(redeemed_at) AS last
             FROM scans s JOIN events e ON e.id = s.event_id WHERE s.event_id = $1 AND ${VIS.given} GROUP BY 1 ORDER BY 2 DESC, 1`, P),
    q.query('SELECT count(*) AS n FROM admins')
  ]);
  // Share of available points scored on each question in first attempts ("3/4" counts 3 of 4).
  const perItem = [];
  for (const row of items.rows) {
    row.item_scores.split(',').forEach((v, i) => {
      const [p, m] = v.split('/').map(Number);
      perItem[i] = perItem[i] || { got: 0, max: 0, full: 0, n: 0 };
      perItem[i].got += p; perItem[i].max += m || 1; perItem[i].n += 1;
      if (p === (m || 1)) perItem[i].full += 1;
    });
  }
  const r = k.rows[0], n = (v) => Number(v || 0);
  const selfClaims = n(r.self_claims), selfFull = n(r.self_full), adminClaims = n(r.admin_claims);
  return {
    ...base,
    selfClaims, adminClaims,
    selfSubmissions: n(sub.rows[0].self), adminSubmissions: n(sub.rows[0].admin),
    selfFull, selfFirstTry: n(r.self_first_try),
    firstTryRate: selfClaims ? n(r.self_first_try) / selfClaims : null,
    eventualFullRate: selfClaims ? selfFull / selfClaims : null,
    avgAttemptsToFull: r.self_avg_attempts_to_full == null ? null : Number(r.self_avg_attempts_to_full),
    adminFirstTryRate: adminClaims ? n(r.admin_first_try) / adminClaims : null,
    adminGiven: n(r.admin_given),
    csatAvg: r.csat_avg == null ? null : Number(r.csat_avg), csatN: n(r.csat_n),
    csat: [n(r.c1), n(r.c2), n(r.c3), n(r.c4), n(r.c5)],
    learned: { Y: n(r.ly), S: n(r.ls), N: n(r.ln) },
    languages: langs.rows.map((x) => ({ language: x.language, claims: n(x.n) })),
    storiesFirstTry: stories.rows.map((x) => ({ viewed: x.viewed, claims: n(x.n), firstTry: n(x.first_try) })),
    byOfficer: officers.rows.map((x) => ({ officer: x.officer, given: n(x.n), manual: n(x.manual), last: x.last })),
    listedOfficers: n(listed.rows[0].n),
    manualReasons: reasons.rows.map((x) => ({ reason: x.reason, claims: n(x.n) })),
    firstAttemptItems: { attempts: items.rows.length, items: perItem.map((x) => ({ share: x.max ? x.got / x.max : null, allCorrect: x.full, n: x.n })) },
    bucketMinutes: BUCKET_MIN,
    timeline: tl.rows.map((x) => ({ t: x.t, submissions: n(x.submissions), given: n(x.given) })),
    event: ev, events: await listEvents(q),
    eventOfficers: Number((await q.query('SELECT count(*) AS n FROM event_officers WHERE event_id = $1', P)).rows[0].n),
    dbMs,
    generatedAt: new Date().toISOString()
  };
});
