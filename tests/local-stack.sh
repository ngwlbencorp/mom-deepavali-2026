#!/bin/bash
# Brings up (or back up) the local test stack used by the tests in README "Tests (local)":
# Postgres on port 54330, the API on :3000 (test passwords below, REDEEM_CAP=500) and a copy of the
# site on :8832 whose js/config.js points at that API. Safe to re-run: it starts only what is down.
# Usage: bash tests/local-stack.sh [work dir, default ~/teststack]
# Kept in the repo because a session's scratch folder can disappear with the session (1 Nov).
set -u
R=$(cd "$(dirname "$0")/.." && pwd); T=${1:-$HOME/teststack}; PG=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
mkdir -p "$T"
if [ ! -d "$T/pgdata" ]; then mkdir -p "$T/pgdata" && chown postgres "$T/pgdata" && su postgres -c "$PG/initdb -D $T/pgdata -A trust" >/dev/null; fi
if ! psql -h /tmp -p 54330 -U postgres -tc "select 1" >/dev/null 2>&1; then
  rm -f "$T/pgdata/postmaster.pid"
  su postgres -c "$PG/pg_ctl -D $T/pgdata -o '-p 54330 -k /tmp' -l $T/pgdata/log start" >/dev/null
  for i in $(seq 1 30); do psql -h /tmp -p 54330 -U postgres -tc "select 1" >/dev/null 2>&1 && break; sleep 0.5; done
fi
# A fresh copy of the site, pointing at the local API (refreshed on every run).
mkdir -p "$T/serve" && (cd "$R" && tar cf - --exclude=node_modules --exclude=.git --exclude=review --exclude=dist .) | (cd "$T/serve" && tar xf -)
sed -i "s|apiBase: '[^']*'|apiBase: 'http://127.0.0.1:3000'|" "$T/serve/js/config.js"
E="ADMIN_PASSWORD=admin-pw-1 SUPERADMIN_USER=boss SUPERADMIN_PASSWORD=super-pw-2 BUG_API_TOKEN=test-bug-agent-token-0123456789abcdef REDEEM_CAP=500"
curl -s -m 2 http://127.0.0.1:3000/api/ping >/dev/null || (cd "$R" && env $E DATABASE_URL=postgres://postgres@localhost:54330/postgres nohup node tests/dev-server.js 3000 > "$T/dev-3000.log" 2>&1 &)
curl -s -m 2 -o /dev/null http://127.0.0.1:8832/ || (nohup python3 -m http.server 8832 --bind 127.0.0.1 --directory "$T/serve" >/dev/null 2>&1 &)
for i in $(seq 1 20); do curl -s -m 2 http://127.0.0.1:3000/api/ping >/dev/null && break; sleep 0.5; done
echo "stack up: API http://127.0.0.1:3000, site http://127.0.0.1:8832/ (admin-pw-1, boss / super-pw-2)"
