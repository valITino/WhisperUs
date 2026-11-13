#!/usr/bin/env bash
# Applies every migration to a throwaway PostgreSQL on this machine and runs the SQL
# tests in supabase/tests against it. Nothing here touches the real Supabase project.
#
#   supabase/tests/local/run.sh            all tests
#   supabase/tests/local/run.sh push       only tests whose file name contains "push"
#   supabase/tests/local/run.sh digest     no tests: print a fingerprint of the schema, to
#                                          compare with a live project (digest.sql)
#
# Needs PostgreSQL 15 or newer installed locally (initdb, pg_ctl, psql; set PG_BIN if
# they are not on the PATH or under /usr/lib/postgresql). The database lives in a
# temporary folder (under $TMPDIR) and is deleted afterwards. The Supabase-only parts
# (auth, storage, pg_cron, pg_net) are stood in for by supabase_stubs.sql.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"

# PostgreSQL refuses to run as root. Where root is all there is (a sandbox), step into a
# user namespace in which we are somebody else.
if [ "$(id -u)" = 0 ] && [ -z "${WHISPERUS_DB_INSIDE:-}" ]; then
  exec env WHISPERUS_DB_INSIDE=1 unshare -U --map-user=1000 --map-group=1000 "$0" "$@"
fi

bin="${PG_BIN:-}"
if [ -z "$bin" ]; then
  if command -v initdb >/dev/null 2>&1; then
    bin="$(dirname "$(command -v initdb)")"
  else
    bin="$(dirname "$(ls /usr/lib/postgresql/*/bin/initdb 2>/dev/null | sort -V | tail -1)")"
  fi
fi
[ -x "$bin/initdb" ] || { echo "No PostgreSQL found. Install it or set PG_BIN." >&2; exit 2; }

work="$(mktemp -d "${TMPDIR:-/tmp}/fwdb.XXXXXX")"
stop() {
  "$bin/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap stop EXIT

"$bin/initdb" -D "$work/data" -A trust -U postgres --no-sync >/dev/null
# A socket in the temporary folder only: no network port, no clash with other servers.
"$bin/pg_ctl" -D "$work/data" -o "-c listen_addresses='' -c unix_socket_directories='$work' -c fsync=off" -l "$work/log" -w start >/dev/null
sql=("$bin/psql" -X -q -h "$work" -U postgres -d postgres)

"${sql[@]}" -v ON_ERROR_STOP=1 -f "$here/supabase_stubs.sql"
for migration in "$root"/supabase/migrations/*.sql; do
  # Extensions are stood in for; everything else is applied exactly as written.
  sed -E '/^create extension /d' "$migration" | "${sql[@]}" -v ON_ERROR_STOP=1 >/dev/null || { echo "FAILED to apply $(basename "$migration")" >&2; exit 1; }
  echo "applied $(basename "$migration")"
done

# "digest": print the fingerprint of what the migrations made, to compare with a live project.
if [ "${1:-}" = digest ]; then
  "${sql[@]}" -A -F ' | ' -f "$here/digest.sql"
  exit 0
fi

status=0
for test in "$root"/supabase/tests/*${1:-}*.sql; do
  echo
  echo "== $(basename "$test")"
  # Each test ends by raising its report as an error, which rolls everything back.
  report="$("${sql[@]}" -f "$test" 2>&1 || true)"
  echo "$report"
  if ! grep -q "REPORT" <<<"$report" || grep -q "FAIL" <<<"$report"; then status=1; fi
done
[ "$status" = 0 ] && echo && echo "All SQL tests passed." || { echo; echo "SQL tests FAILED." >&2; }
exit "$status"
