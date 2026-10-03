-- Database tests: run against a fresh database with
--   psql -v ON_ERROR_STOP=1 -f test/supabase_stub.sql -f supabase/migrations/0001_init.sql \
--        -f supabase/seed.sql -f test/db_test.sql
-- Each check raises an exception on failure.

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', case when u is null then '{}' else json_build_object('sub', u)::text end, false);
end $$;

create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', what; end if;
  raise notice 'ok  %', what;
end $$;

-- eight anonymous users
insert into auth.users (id)
select ('00000000-0000-0000-0000-00000000000' || i)::uuid from generate_series(1, 8) i;

-- ---------------------------------------------------------------- anon visitor
set role anon;
select pg_temp.as_user(null);
select pg_temp.check((select count(*) from public.list_schools()) = 10, 'anon can list the 10 approved schools');
do $$ begin
  perform * from public.responses;
  raise exception 'FAIL: anon read the responses table';
exception when insufficient_privilege then raise notice 'ok  anon cannot read responses directly';
end $$;
do $$ begin
  perform public.save_my_response('{}'::jsonb);
  raise exception 'FAIL: anon saved a response';
exception when insufficient_privilege then raise notice 'ok  anon cannot save';
end $$;
reset role;

-- ---------------------------------------------------------------- user 1 saves
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select pg_temp.check(public.get_my_response() is null, 'new user has no response');
select public.save_my_response('{"school_slug":"uottawa","program":"CS & Mathematics","year":2,"gpa":8.82,
  "projects":2,"hackathons":1,"hackathon_wins":0,"leetcode":29,"internships":0,"work_months":5,"languages":6}');
select pg_temp.check((public.get_my_response()->>'gpa')::numeric = 8.82, 'user 1 reads back own response');
select pg_temp.check(not (public.get_my_response() ? 'user_id'), 'response never exposes user_id');
select public.save_my_response('{"school_slug":"uottawa","program":"CS & Mathematics","year":2,"gpa":8.82,
  "projects":2,"hackathons":1,"hackathon_wins":0,"leetcode":35,"internships":0,"work_months":5,"languages":6}');
select pg_temp.check((public.get_my_response()->>'leetcode')::int = 35, 'saving again updates instead of duplicating');

do $$ begin
  perform public.save_my_response('{"school_slug":"uottawa","program":"Computer Science","year":2,"gpa":11}');
  raise exception 'FAIL: GPA above scale accepted';
exception when sqlstate '22023' then raise notice 'ok  GPA above the school scale is rejected';
end $$;
do $$ begin
  perform public.save_my_response('{"school_slug":"nowhere","program":"Computer Science","year":2}');
  raise exception 'FAIL: unknown school accepted';
exception when sqlstate '22023' then raise notice 'ok  unknown school is rejected';
end $$;
do $$ begin
  perform public.save_my_response('{"school_slug":"uottawa","program":"Computer Science","year":2,"hackathons":1,"hackathon_wins":3}');
  raise exception 'FAIL: more wins than hackathons accepted';
exception when check_violation then raise notice 'ok  more placements than hackathons is rejected';
end $$;

-- ---------------------------------------------------------------- privacy threshold
-- users 2..5 (4 peers for user 1)
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
select public.save_my_response('{"school_slug":"uottawa","program":"CS & Mathematics","year":2,"gpa":7.5,"projects":1,"hackathons":0,"hackathon_wins":0,"leetcode":10,"internships":0,"work_months":0,"languages":3}');
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
select public.save_my_response('{"school_slug":"uottawa","program":"CS & Mathematics","year":2,"gpa":9.1,"projects":4,"hackathons":3,"hackathon_wins":1,"leetcode":150,"internships":1,"work_months":0,"languages":7}');
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
select public.save_my_response('{"school_slug":"uottawa","program":"CS & Mathematics","year":2,"gpa":6.0,"projects":0,"hackathons":0,"hackathon_wins":0,"internships":0,"work_months":12,"languages":2}');
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
select public.save_my_response('{"school_slug":"uottawa","program":"CS & Mathematics","year":2,"gpa":8.0,"projects":2,"hackathons":2,"hackathon_wins":0,"internships":0,"work_months":3,"languages":5}');

select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select pg_temp.check((public.peer_stats('uottawa','CS & Mathematics',2)->>'n')::int = 4, 'peer count excludes the caller');
select pg_temp.check(public.peer_stats('uottawa','CS & Mathematics',2)->'metrics' = 'null'::jsonb, 'metrics hidden below 5 peers');

-- user 6 makes 5 peers
select pg_temp.as_user('00000000-0000-0000-0000-000000000006');
select public.save_my_response('{"school_slug":"uottawa","program":"CS & Mathematics","year":2,"gpa":8.5,"projects":3,"hackathons":1,"hackathon_wins":0,"leetcode":60,"internships":0,"work_months":0,"languages":4}');

select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select pg_temp.check(public.peer_stats('uottawa','CS & Mathematics',2)->'metrics'->'projects' = '[0,1,2,3,4]'::jsonb, 'metrics appear at 5 peers, sorted');
select pg_temp.check(public.peer_stats('uottawa','CS & Mathematics',2)->'metrics'->'gpa_pct' = '[60.0,75.0,80.0,85.0,91.0]'::jsonb, 'GPA normalised to percent of scale');
select pg_temp.check(public.peer_stats('uottawa','CS & Mathematics',2)->'metrics'->'leetcode' = 'null'::jsonb, 'a metric with fewer than 5 answers stays hidden');
select pg_temp.check((public.peer_stats(null,null,null)->>'n')::int = 5, 'all-schools filter works');
select pg_temp.check((public.peer_stats('carleton',null,null)->>'n')::int = 0, 'other schools are separate');

-- ---------------------------------------------------------------- school requests
select pg_temp.as_user('00000000-0000-0000-0000-000000000007');
select pg_temp.check(public.request_school('yorku','York University',9) = 'requested', 'school request accepted');
select pg_temp.check(public.request_school('uottawa','University of Ottawa',10) = 'exists', 'duplicate school detected');
select pg_temp.check(not exists (select 1 from public.list_schools() where slug = 'yorku'), 'requested school hidden until approved');
select public.request_school('tmu','Toronto Metropolitan University',4.33);
select public.request_school('ontariotech','Ontario Tech University',4.3);
do $$ begin
  perform public.request_school('laurier','Wilfrid Laurier University',12);
  raise exception 'FAIL: 4th pending request accepted';
exception when sqlstate '22023' then raise notice 'ok  pending requests capped at 3 per person';
end $$;

-- ---------------------------------------------------------------- delete
select pg_temp.as_user('00000000-0000-0000-0000-000000000006');
select public.delete_my_response();
select pg_temp.check(public.get_my_response() is null, 'user can delete their response');
reset role;
select pg_temp.check((select count(*) from public.responses) = 5, 'delete removed exactly one row');
\echo ALL DATABASE TESTS PASSED
