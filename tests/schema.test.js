// Schema setup on a new server instance (lib/lib.js ensureSchema).
// 1. On an empty database it creates exactly the columns and indexes listed in SCHEMA.
// 2. Once they exist, a new instance skips the setup, so it never waits for (or deadlocks with) a
//    query that is reading a table. Found 5 Nov: a cold start's ALTER TABLE deadlocked with the
//    dashboard's two-table query.
// Usage: node tests/schema.test.js [postgres base url, default postgres://postgres@localhost:54330]
// Creates and drops its own database (schematest); never point it at production.
const path = require('path');
const { Client } = require('pg');
const PG = process.argv[2] || 'postgres://postgres@localhost:54330';
const DB = PG + '/schematest';
let failed = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++; };

// A fresh copy of lib/lib.js, as a new server instance would load it.
function freshLib() {
  const file = require.resolve(path.join(__dirname, '..', 'lib', 'lib.js'));
  delete require.cache[file];
  return require(file);
}
const within = (p, ms) => Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);

(async () => {
  const admin = new Client({ connectionString: PG + '/postgres' }); await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS schematest'); await admin.query('CREATE DATABASE schematest');
  process.env.DATABASE_URL = DB;
  try {
    const lib = freshLib();
    await lib.ensureSchema();
    const c = new Client({ connectionString: DB }); await c.connect();
    const { rows } = await c.query(`SELECT table_name || '.' || column_name AS col FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ANY($1)`, [Object.keys(lib.SCHEMA)]);
    const got = new Set(rows.map((r) => r.col));
    const want = new Set(Object.entries(lib.SCHEMA).flatMap(([t, cols]) => cols.map((x) => t + '.' + x)));
    const missing = [...got].filter((x) => !want.has(x)), extra = [...want].filter((x) => !got.has(x));
    ok(!missing.length && !extra.length, `SCHEMA lists exactly the columns the setup creates (not listed: ${missing.join(', ') || 'none'}; listed but not created: ${extra.join(', ') || 'none'})`);
    const idx = await c.query('SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ANY($1)', [lib.SCHEMA_INDEXES]);
    ok(idx.rowCount === lib.SCHEMA_INDEXES.length, 'SCHEMA_INDEXES all exist after the setup');

    // Another connection is part-way through reading scans (like a dashboard query or a redeem).
    await c.query('BEGIN'); await c.query('SELECT count(*) FROM scans');
    const lib2 = freshLib(); // a new server instance starting up meanwhile
    ok(await within(lib2.ensureSchema(), 3000), 'a new instance starts without waiting for a table lock while another query reads scans');
    await c.query('COMMIT'); await c.end();
    await lib.db().end(); await lib2.db().end();
  } finally {
    await admin.query('DROP DATABASE IF EXISTS schematest WITH (FORCE)').catch(() => {});
    await admin.end();
  }
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
