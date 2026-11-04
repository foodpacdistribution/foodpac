#!/usr/bin/env bash
# Copies the whole database from one Postgres to another (e.g. Supabase Dublin → Sydney), then
# checks that every table and order-number counter matches.
#
#   OLD_DATABASE_URL='postgresql://postgres.OLDREF:PASS@aws-0-eu-west-1.pooler.supabase.com:5432/postgres' \
#   NEW_DATABASE_URL='postgresql://postgres.NEWREF:PASS@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres' \
#   ./scripts/move-database.sh
#
# Use each project's *Session pooler* address (port 5432), not the transaction pooler (6543).
# The new database must be empty (or left with empty tables by a failed run). Its tables are
# created by the app's own migrations (so the Data API lock-down from migration 0007 is in place),
# then the rows are copied in one transaction.
# The old database is only read, never changed. To copy again after a rehearsal (e.g. right before
# switching over), add RESET_NEW=1: it empties the new database's tables first.
set -euo pipefail

: "${OLD_DATABASE_URL:?Set OLD_DATABASE_URL to the current database (Session pooler, port 5432)}"
: "${NEW_DATABASE_URL:?Set NEW_DATABASE_URL to the new, empty database (Session pooler, port 5432)}"
# Pasted straight from Vercel is fine: extra ?parameters (pgbouncer=true, supa=…) are dropped, and
# Supabase's transaction pooler (6543) becomes its session pooler (5432), which pg_dump needs.
session_url() { local u="${1%%\?*}"; echo "${u/pooler.supabase.com:6543/pooler.supabase.com:5432}"; }
OLD_DATABASE_URL=$(session_url "$OLD_DATABASE_URL")
NEW_DATABASE_URL=$(session_url "$NEW_DATABASE_URL")
[ "$OLD_DATABASE_URL" != "$NEW_DATABASE_URL" ] || { echo "OLD and NEW are the same database." >&2; exit 1; }

# Homebrew's libpq is keg-only (not on PATH by default).
for d in /opt/homebrew/opt/libpq/bin /usr/local/opt/libpq/bin; do [ -x "$d/pg_dump" ] && PATH="$d:$PATH"; done
command -v pg_dump >/dev/null && command -v psql >/dev/null || { echo "Needs pg_dump and psql: brew install libpq" >&2; exit 1; }

cd "$(dirname "$0")/.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
old() { psql "$OLD_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 "$@"; }
new() { psql "$NEW_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 "$@"; }

echo "1/4 Checking both databases…"
old -c "select 1" >/dev/null
# RESET_NEW=1: empty the new database's tables first, to copy again after a rehearsal run.
if [ "${RESET_NEW:-}" = "1" ]; then
  tables=$(new -c "select string_agg(format('public.%I', tablename), ', ') from pg_tables where schemaname = 'public'")
  if [ -n "$tables" ]; then
    echo "    Emptying the new database (RESET_NEW=1)…"
    new -c "TRUNCATE $tables CASCADE" >/dev/null
  fi
fi
# Empty, or only the empty tables a previous failed run of this script created (the copy is all or nothing).
rows=0
for t in $(new -c "select tablename from pg_tables where schemaname = 'public' and tablename <> 'settings'"); do
  rows=$((rows + $(new -c "select count(*) from public.\"$t\"")))
done
[ "$rows" = "0" ] || { echo "The new database already has data ($rows rows). It must be empty." >&2; exit 1; }

echo "2/4 Creating the tables in the new database (app migrations)…"
# No ADMIN_* variables: the admin accounts come across with the data.
env -u ADMIN_EMAIL -u ADMIN_PASSWORD -u POSTGRES_URL DATABASE_URL="$NEW_DATABASE_URL" npx tsx scripts/migrate.mts

echo "3/4 Copying the data…"
pg_dump "$OLD_DATABASE_URL" --data-only --schema=public --no-owner --no-privileges --file "$work/raw.sql"
# A newer pg_dump writes settings an older server doesn't know (transaction_timeout is Postgres 17+).
grep -v '^SET transaction_timeout' "$work/raw.sql" > "$work/data.sql"
echo "    $(du -h "$work/data.sql" | cut -f1) exported"
# replica mode: rows go in table by table without tripping foreign keys halfway through.
# The migrations inserted the default settings row; the real one replaces it.
psql "$NEW_DATABASE_URL" -X --quiet --single-transaction -v ON_ERROR_STOP=1 \
  -c "SET session_replication_role = replica" \
  -c "DELETE FROM public.settings" \
  -f "$work/data.sql" >/dev/null || { echo "The copy failed and was rolled back (nothing half-copied). Fix the error above and run this again." >&2; exit 1; }

echo "4/4 Comparing…"
fail=0
for t in $(old -c "select tablename from pg_tables where schemaname = 'public' order by 1"); do
  a=$(old -c "select count(*) from public.\"$t\"")
  b=$(new -c "select count(*) from public.\"$t\"")
  if [ "$a" = "$b" ]; then printf "    %-22s %8s rows  ok\n" "$t" "$a"; else printf "    %-22s old %s / new %s  MISMATCH\n" "$t" "$a" "$b"; fail=1; fi
done
for s in $(old -c "select sequencename from pg_sequences where schemaname = 'public' order by 1"); do
  a=$(old -c "select coalesce(last_value, 0) from pg_sequences where schemaname = 'public' and sequencename = '$s'")
  b=$(new -c "select coalesce(last_value, 0) from pg_sequences where schemaname = 'public' and sequencename = '$s'")
  if [ "$a" = "$b" ]; then printf "    %-22s at %8s     ok\n" "$s" "$a"; else printf "    %-22s old %s / new %s  MISMATCH\n" "$s" "$a" "$b"; fail=1; fi
done
[ $fail = 0 ] || { echo "Something didn't copy across. Don't switch over; the old database is unchanged." >&2; exit 1; }
echo "Done. Everything matches. Now point Vercel's DATABASE_URL at the new database and deploy to syd1."
