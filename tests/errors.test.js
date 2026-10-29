// Checks that unexpected API errors are recorded in api_errors, and nothing else is.
// Usage: DATABASE_URL=postgres://... node tests/errors.test.js   (a test database: it adds rows to api_errors)
const { route, httpError, db } = require('../lib/lib.js');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
function call(handler, url) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b) }); } };
    handler({ method: 'GET', url, headers: {} }, res);
  });
}
const rows = async (tag) => (await db().query('SELECT route, message FROM api_errors WHERE message LIKE $1', ['%' + tag + '%'])).rows;

(async () => {
  const tag = 'Kaboom-' + Date.now();
  const boom = route(['GET'], null, async () => { throw new Error(tag + ' secret=should-not-matter'); });
  const r = await call(boom, '/api/index?route=testboom&id=SHOULDNOTBESTORED');
  ok(r.status === 500 && r.body.message === 'Server error' && !JSON.stringify(r.body).includes(tag), 'the caller sees only "Server error", not the details');
  let found = await rows(tag);
  ok(found.length === 1 && found[0].route === 'testboom', 'the error is recorded with its route');
  ok(!found[0].message.includes('SHOULDNOTBESTORED'), 'request data (the query string) is not recorded');
  await call(boom, '/api/testboom');
  ok((await rows(tag)).length === 1, 'the same error again within a minute is not recorded twice');
  const dbFail = route(['GET'], null, async () => { const e = new Error('connect ECONNREFUSED 10.0.0.5:5432 ' + tag); e.code = 'ECONNREFUSED'; throw e; });
  const d = await call(dbFail, '/api/testdb');
  ok(d.status === 500 && d.body.error === 'server_error' && d.body.message === 'Server error', 'a database error does not reveal its details (host, code) to the caller');
  const refuse = route(['GET'], null, async () => { throw httpError(400, 'bad_thing', tag + '-400'); });
  ok((await call(refuse, '/api/testrefuse')).status === 400 && (await rows(tag + '-400')).length === 0, 'ordinary refusals (4xx) are not recorded');
  await db().query('DELETE FROM api_errors WHERE message LIKE $1', ['%' + tag + '%']);
  await db().end();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
