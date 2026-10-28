const { db, ensureSchema, route, stats } = require('./_lib');

const BUCKET_MIN = 10;

// Superadmin: key figures and a 10-minute timeline for the live dashboard.
module.exports = route(['GET'], 'super', async () => {
  await ensureSchema();
  const q = db();
  const [base, k, sub, tl] = await Promise.all([
    stats(q),
    q.query(`
      SELECT
        count(*) FILTER (WHERE source = 'self') AS self_claims,
        count(*) FILTER (WHERE source = 'admin') AS admin_claims,
        count(*) FILTER (WHERE source = 'self' AND first_full IS NOT NULL) AS self_full,
        count(*) FILTER (WHERE source = 'self' AND first_full = 1) AS self_first_try,
        avg(first_full) FILTER (WHERE source = 'self' AND first_full IS NOT NULL) AS self_avg_attempts_to_full,
        count(*) FILTER (WHERE source = 'admin' AND first_full = 1) AS admin_first_try,
        count(*) FILTER (WHERE redeemed_at IS NOT NULL AND source = 'admin') AS admin_given,
        avg(csat) AS csat_avg,
        count(csat) AS csat_n,
        count(*) FILTER (WHERE csat = 1) AS c1, count(*) FILTER (WHERE csat = 2) AS c2,
        count(*) FILTER (WHERE csat = 3) AS c3, count(*) FILTER (WHERE csat = 4) AS c4,
        count(*) FILTER (WHERE csat = 5) AS c5,
        count(*) FILTER (WHERE learned = 'Y') AS ly, count(*) FILTER (WHERE learned = 'S') AS ls,
        count(*) FILTER (WHERE learned = 'N') AS ln
      FROM scans`),
    q.query(`SELECT count(*) FILTER (WHERE source = 'self') AS self, count(*) FILTER (WHERE source = 'admin') AS admin FROM submissions`),
    q.query(`
      WITH s AS (
        SELECT to_timestamp(floor(extract(epoch FROM created_at) / ${BUCKET_MIN * 60}) * ${BUCKET_MIN * 60}) AS t, count(*) AS n
        FROM submissions GROUP BY 1
      ), g AS (
        SELECT to_timestamp(floor(extract(epoch FROM redeemed_at) / ${BUCKET_MIN * 60}) * ${BUCKET_MIN * 60}) AS t, count(*) AS n
        FROM scans WHERE redeemed_at IS NOT NULL GROUP BY 1
      )
      SELECT COALESCE(s.t, g.t) AS t, COALESCE(s.n, 0) AS submissions, COALESCE(g.n, 0) AS given
      FROM s FULL JOIN g ON s.t = g.t ORDER BY 1`)
  ]);
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
    bucketMinutes: BUCKET_MIN,
    timeline: tl.rows.map((x) => ({ t: x.t, submissions: n(x.submissions), given: n(x.given) })),
    generatedAt: new Date().toISOString()
  };
});
