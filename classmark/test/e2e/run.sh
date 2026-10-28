#!/usr/bin/env bash
# End-to-end test. Needs: a running PostgreSQL you can connect to (PG_ARGS), Python with
# Playwright + Chromium, and node_modules installed. Example:
#   PG_ARGS="-h localhost -p 5432 -U postgres" bash test/e2e/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
PG_ARGS=${PG_ARGS:-"-h localhost -U postgres"}
MIGRATIONS=(); for f in supabase/migrations/*.sql; do MIGRATIONS+=(-f "$f"); done
DB=classmark_e2e
psql $PG_ARGS -qc "drop database if exists $DB" -c "create database $DB"
psql $PG_ARGS -d $DB -q -v ON_ERROR_STOP=1 -f test/supabase_stub.sql "${MIGRATIONS[@]}" -f supabase/seed.sql >/dev/null

# six other verified students in the same group
psql $PG_ARGS -d $DB -q -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users (id, email, email_confirmed_at) select gen_random_uuid(), 'peer' || i || '@uottawa.ca', now() from generate_series(1,6) i;
insert into public.responses (user_id, school_slug, program, year, gpa, projects, hackathons, hackathon_wins, leetcode, internships, work_months, languages)
select id, 'uottawa', 'CS & Mathematics', 2, v.gpa, v.p, v.h, v.w, v.l, v.i, v.m, v.lang
from (select id, row_number() over () rn from auth.users) u
join (values (1, 7.5, 1, 0, 0, 10, 0, 0, 3), (2, 9.1, 4, 3, 1, 150, 1, 0, 7), (3, 6.0, 0, 0, 0, 5, 0, 12, 2),
             (4, 8.0, 2, 2, 0, 40, 0, 3, 5), (5, 8.5, 3, 1, 0, 60, 0, 0, 4), (6, 9.4, 5, 4, 2, 300, 1, 4, 8))
  as v(rn, gpa, p, h, w, l, i, m, lang) using (rn);
SQL

node test/e2e/build.mjs test/e2e/dist http://127.0.0.1:8787 >/dev/null
mkdir -p test/e2e/shots
python3 test/e2e/mock_supabase.py --static test/e2e/dist --psql="$PG_ARGS -d $DB" &
SERVER=$!
trap 'kill $SERVER' EXIT
sleep 1.5
python3 test/e2e/e2e_test.py http://127.0.0.1:8787 test/e2e/shots
