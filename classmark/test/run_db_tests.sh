#!/usr/bin/env bash
# Runs the database tests on a throwaway database. Needs a local PostgreSQL 15+.
#   PG_ARGS="-h localhost -U postgres" npm run test:db
set -euo pipefail
cd "$(dirname "$0")/.."
PG_ARGS=${PG_ARGS:-"-h localhost -U postgres"}
MIGRATIONS=(); for f in supabase/migrations/*.sql; do MIGRATIONS+=(-f "$f"); done
psql $PG_ARGS -qc "drop database if exists classmark_test" -c "create database classmark_test"
psql $PG_ARGS -d classmark_test -q -v ON_ERROR_STOP=1 \
  -f test/supabase_stub.sql "${MIGRATIONS[@]}" -f supabase/seed.sql -f test/db_test.sql 2>&1 \
  | grep -E "ok  |FAIL|PASSED|ERROR"
