-- Database tests: run against a fresh database with
--   psql -v ON_ERROR_STOP=1 -f test/supabase_stub.sql -f supabase/migrations/<each, in order>.sql \
--        -f supabase/seed.sql -f test/db_test.sql
-- Each check raises an exception on failure.

create or replace function pg_temp.as_user(u int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when u is null then '{}' else json_build_object('sub', pg_temp.uid(u))::text end, false);
end $$;

create or replace function pg_temp.uid(i int) returns uuid language sql as $$
  select ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid
$$;

-- a verified student account (what Supabase has after the one-time code is entered)
create or replace function pg_temp.student(i int, email text, verified boolean default true) returns void language sql as $$
  insert into auth.users (id, email, email_confirmed_at) values (pg_temp.uid(i), email, case when verified then now() end)
$$;

create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', what; end if;
  raise notice 'ok  %', what;
end $$;

create or replace function pg_temp.save(i int, body text) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(i);
  set local role authenticated;
  perform public.save_my_response(body::jsonb);
  reset role;
end $$;

-- ---------------------------------------------------------------- signup guard
select pg_temp.check((select count(*) from public.list_schools()) = 10, '10 approved schools seeded');
select pg_temp.check((select email_domains from public.list_schools() where slug = 'uottawa') = '{uottawa.ca}', 'schools list their email domains');
do $$ begin
  perform pg_temp.student(90, 'someone@gmail.com');
  raise exception 'FAIL: gmail account created';
exception when sqlstate '22023' then raise notice 'ok  non-school email cannot sign up';
end $$;
do $$ begin
  perform pg_temp.student(91, 'someone@fakeuottawa.ca');
  raise exception 'FAIL: look-alike domain accepted';
exception when sqlstate '22023' then raise notice 'ok  look-alike domain (fakeuottawa.ca) is refused';
end $$;
select pg_temp.student(1, 'Student.One@UOttawa.ca');
select pg_temp.check(true, 'uOttawa email can sign up (case-insensitive)');
select pg_temp.student(40, 'x@cmail.carleton.ca');
select pg_temp.check(public._school_for_email('x@cmail.carleton.ca') = 'carleton', 'student subdomain maps to its school');
do $$ begin
  update auth.users set email = 'me@gmail.com' where id = pg_temp.uid(1);
  raise exception 'FAIL: email changed to gmail';
exception when sqlstate '22023' then raise notice 'ok  email cannot be changed to a non-school address';
end $$;

-- ---------------------------------------------------------------- signed-out visitor
set role anon;
select pg_temp.as_user(null);
select pg_temp.check((select count(*) from public.list_schools()) = 10, 'anon can list schools');
do $$ begin
  perform * from public.responses;
  raise exception 'FAIL: anon read the responses table';
exception when insufficient_privilege then raise notice 'ok  anon cannot read responses directly';
end $$;
do $$ begin
  perform * from auth.users;
  raise exception 'FAIL: anon read auth.users';
exception when insufficient_privilege then raise notice 'ok  anon cannot read emails';
end $$;
do $$ begin
  perform public.save_my_response('{}'::jsonb);
  raise exception 'FAIL: anon saved a response';
exception when insufficient_privilege then raise notice 'ok  anon cannot save';
end $$;
do $$ begin
  perform public.get_my_history();
  raise exception 'FAIL: anon read a history';
exception when insufficient_privilege then raise notice 'ok  anon cannot read history';
end $$;
do $$ begin
  perform * from public.response_history;
  raise exception 'FAIL: anon read the history table';
exception when insufficient_privilege then raise notice 'ok  anon cannot read the history table directly';
end $$;
do $$ begin
  perform public.peer_stats('uottawa', null, null);
  raise exception 'FAIL: anon saw distributions';
exception when insufficient_privilege then raise notice 'ok  anon cannot see distributions';
end $$;
do $$ begin
  perform public._hidden_keys(null, null, null, null);
  raise exception 'FAIL: anon called a helper';
exception when insufficient_privilege then raise notice 'ok  internal helpers are not callable';
end $$;
select pg_temp.check((public.average_student('uottawa', null, null)->>'n')::int = 0, 'anon can ask for the average student');
reset role;

-- ---------------------------------------------------------------- unverified account
select pg_temp.student(20, 'pending@uottawa.ca', false);
set role authenticated;
select pg_temp.as_user(20);
select pg_temp.check(not (public.whoami()->>'verified')::boolean, 'whoami reports unverified');
do $$ begin
  perform public.save_my_response('{"program":"Computer Science","year":2}');
  raise exception 'FAIL: unverified user saved';
exception when sqlstate '28000' then raise notice 'ok  unverified email cannot save';
end $$;
do $$ begin
  perform public.peer_stats('uottawa', null, null);
  raise exception 'FAIL: unverified user saw distributions';
exception when sqlstate '28000' then raise notice 'ok  unverified email cannot see distributions';
end $$;

-- ---------------------------------------------------------------- verified student saves
select pg_temp.as_user(1);
select pg_temp.check(public.whoami() = '{"email":"Student.One@UOttawa.ca","verified":true,"school_slug":"uottawa"}', 'whoami: email, verified, school');
select pg_temp.check(public.get_my_response() is null, 'new student has no response');
select public.save_my_response('{"school_slug":"carleton","program":"CS & Mathematics","year":2,"gpa":8.82,
  "projects":2,"hackathons":1,"hackathon_wins":0,"leetcode":29,"internships":0,"work_months":5,"languages":6}');
select pg_temp.check(public.get_my_response()->>'school_slug' = 'uottawa', 'school comes from the email, not the form');
select pg_temp.check((public.get_my_response()->>'gpa')::numeric = 8.82, 'student reads back own response');
select pg_temp.check(not (public.get_my_response() ? 'user_id'), 'response never exposes user_id');
select public.save_my_response('{"program":"CS & Mathematics","year":2,"gpa":8.82,
  "projects":2,"hackathons":1,"hackathon_wins":0,"leetcode":35,"internships":0,"work_months":5,"languages":6}');
select pg_temp.check((public.get_my_response()->>'leetcode')::int = 35, 'saving again updates instead of duplicating');
select pg_temp.check(jsonb_array_length(public.get_my_history()) = 1, 'history keeps one entry per day');
select pg_temp.check((public.get_my_history()->0->>'leetcode')::int = 35, 'a day''s history keeps the latest save');
select pg_temp.check(not (public.get_my_history()->0 ? 'user_id'), 'history never exposes user_id');
reset role;
update public.response_history set day = day - 30 where user_id = pg_temp.uid(1);
set role authenticated;
select public.save_my_response('{"program":"CS & Mathematics","year":2,"gpa":8.82,
  "projects":2,"hackathons":1,"hackathon_wins":0,"leetcode":35,"internships":0,"work_months":7,"languages":6}');
select pg_temp.check(jsonb_array_length(public.get_my_history()) = 2, 'a later day adds a new history entry');
select pg_temp.check((public.get_my_history()->0->>'work_months')::int = 5 and (public.get_my_history()->1->>'work_months')::int = 7, 'history is oldest first');
do $$ begin
  perform public.save_my_response('{"program":"Computer Science","year":2,"gpa":11}');
  raise exception 'FAIL: GPA above scale accepted';
exception when sqlstate '22023' then raise notice 'ok  GPA above the school scale is rejected';
end $$;
do $$ begin
  perform public.save_my_response('{"program":"Computer Science","year":2,"hackathons":1,"hackathon_wins":3}');
  raise exception 'FAIL: more wins than hackathons accepted';
exception when check_violation then raise notice 'ok  more placements than hackathons is rejected';
end $$;
reset role;

-- ---------------------------------------------------------------- privacy threshold
select pg_temp.student(2, 's2@uottawa.ca'), pg_temp.student(3, 's3@uottawa.ca'), pg_temp.student(4, 's4@uottawa.ca'),
       pg_temp.student(5, 's5@uottawa.ca'), pg_temp.student(6, 's6@uottawa.ca');
select pg_temp.save(2, '{"program":"CS & Mathematics","year":2,"gpa":7.5,"projects":1,"hackathons":0,"hackathon_wins":0,"leetcode":10,"internships":0,"work_months":0,"languages":3}');
select pg_temp.save(3, '{"program":"CS & Mathematics","year":2,"gpa":9.1,"projects":4,"hackathons":3,"hackathon_wins":1,"leetcode":150,"internships":1,"work_months":0,"languages":7}');
select pg_temp.save(4, '{"program":"CS & Mathematics","year":2,"gpa":6.0,"projects":0,"hackathons":0,"hackathon_wins":0,"internships":0,"work_months":12,"languages":2}');
select pg_temp.save(5, '{"program":"CS & Mathematics","year":2,"gpa":8.0,"projects":2,"hackathons":2,"hackathon_wins":0,"internships":0,"work_months":3,"languages":5}');

set role authenticated;
select pg_temp.as_user(1);
select pg_temp.check((public.peer_stats('uottawa','CS & Mathematics',2)->>'n')::int = 4, 'peer count excludes the caller');
select pg_temp.as_user(2);
select pg_temp.check(jsonb_array_length(public.get_my_history()) = 1, 'each student only sees their own history');
select pg_temp.as_user(1);
select pg_temp.check(public.peer_stats('uottawa','CS & Mathematics',2)->'metrics' = 'null'::jsonb, 'distributions hidden below 5 peers');
reset role;

select pg_temp.save(6, '{"program":"CS & Mathematics","year":2,"gpa":8.5,"projects":3,"hackathons":1,"hackathon_wins":0,"leetcode":60,"internships":0,"work_months":0,"languages":4}');

set role authenticated;
select pg_temp.as_user(1);
select pg_temp.check(public.peer_stats('uottawa','CS & Mathematics',2)->'metrics'->'projects' = '[0,1,2,3,4]'::jsonb, 'distributions appear at 5 peers, sorted');
select pg_temp.check(public.peer_stats('uottawa','CS & Mathematics',2)->'metrics'->'gpa_pct' = '[60.0,75.0,80.0,85.0,91.0]'::jsonb, 'GPA normalised to percent of scale');
select pg_temp.check(not (public.peer_stats('uottawa','CS & Mathematics',2)->'metrics' ? 'leetcode'), 'a metric with fewer than 5 answers stays hidden');
select pg_temp.check((public.peer_stats(null,null,null)->>'n')::int = 5, 'all-schools filter works');
select pg_temp.check((public.peer_stats('carleton',null,null)->>'n')::int = 0, 'other schools are separate');
reset role;

-- ---------------------------------------------------------------- average student (signed out)
set role anon;
select pg_temp.as_user(null);
select pg_temp.check((public.average_student('uottawa','CS & Mathematics',2)->>'n')::int = 6, 'average student counts the whole group');
select pg_temp.check((public.average_student('uottawa','CS & Mathematics',2)->'averages'->>'projects')::numeric = 2.0, 'average projects = 2.0');
select pg_temp.check((public.average_student('uottawa','CS & Mathematics',2)->'averages'->>'gpa_pct')::numeric = 79.9, 'average GPA as percent of scale');
select pg_temp.check(not (public.average_student('uottawa','CS & Mathematics',2)->'averages' ? 'leetcode'), 'average hides a metric with fewer than 5 answers');
select pg_temp.check(not (public.average_student('uottawa','CS & Mathematics',2)::text ~ '\[') , 'average student never returns lists of values');
reset role;

-- ---------------------------------------------------------------- differencing protection
-- One Computer Science student joins. "uOttawa, any program" minus "uOttawa, CS & Math" would
-- now expose exactly that one person, so the narrower group must hide.
select pg_temp.student(7, 's7@uottawa.ca');
select pg_temp.save(7, '{"program":"Computer Science","year":2,"gpa":9.9,"projects":9,"hackathons":9,"hackathon_wins":9,"leetcode":900,"internships":3,"work_months":9,"languages":9}');
set role anon;
select pg_temp.as_user(null);
select pg_temp.check((public.average_student('uottawa','CS & Mathematics',2)->>'suppressed')::boolean, 'group hidden when a wider group differs by 1 person');
select pg_temp.check(public.average_student('uottawa','CS & Mathematics',2)->'averages' = 'null'::jsonb, 'no averages leak while hidden');
reset role;
set role authenticated;
select pg_temp.as_user(1);
select pg_temp.check(public.peer_stats('uottawa','CS & Mathematics',2)->'metrics' = 'null'::jsonb, 'distributions hidden by the same rule');
reset role;
-- four more Computer Science students: the difference is now 5, safe again
select pg_temp.student(i, 's' || i || '@uottawa.ca') from generate_series(8, 11) i;
select pg_temp.save(i, '{"program":"Computer Science","year":2,"gpa":7,"projects":1,"hackathons":1,"hackathon_wins":0,"internships":0,"work_months":0,"languages":3}') from generate_series(8, 11) i;
set role anon;
select pg_temp.as_user(null);
select pg_temp.check(not (public.average_student('uottawa','CS & Mathematics',2)->>'suppressed')::boolean, 'group returns once the difference reaches 5');
reset role;
-- a fifth CS & Math LeetCode answer: 5 answers, but the wider group has 6, and subtracting
-- would expose the one Computer Science student's LeetCode count
select pg_temp.student(12, 's12@uottawa.ca');
select pg_temp.save(12, '{"program":"CS & Mathematics","year":2,"gpa":8,"projects":1,"leetcode":20}');
set role anon;
select pg_temp.as_user(null);
select pg_temp.check(not (public.average_student('uottawa','CS & Mathematics',2)->'averages' ? 'leetcode'), 'per-metric differences are protected too');
select pg_temp.check(public.average_student('uottawa','CS & Mathematics',2)->'averages' ? 'projects', 'other metrics in the group still show');
select pg_temp.check(public.average_student('uottawa',null,2)->'averages' ? 'leetcode', 'the wider group still shows the metric');
reset role;

-- ---------------------------------------------------------------- school requests
set role anon;
select pg_temp.as_user(null);
select pg_temp.check(public.request_school('yorku','York University',9,'yorku.ca') = 'requested', 'signed-out student can request a school');
select pg_temp.check(public.request_school('uottawa2','Ottawa U',10,'uottawa.ca') = 'exists', 'a domain already in use is detected');
select pg_temp.check(public.request_school('yorku','York University',9,'my.yorku.ca') = 'exists', 'a duplicate slug is detected');
do $$ begin
  perform public.request_school('tmu','Toronto Metropolitan University',4.33,'https://torontomu.ca');
  raise exception 'FAIL: bad domain accepted';
exception when sqlstate '22023' then raise notice 'ok  malformed domain is rejected';
end $$;
select pg_temp.check(not exists (select 1 from public.list_schools() where slug = 'yorku'), 'requested school hidden until approved');
reset role;
do $$ begin
  perform pg_temp.student(50, 'a@yorku.ca');
  raise exception 'FAIL: pending school signup';
exception when sqlstate '22023' then raise notice 'ok  pending school cannot sign up yet';
end $$;
update public.schools set approved = true where slug = 'yorku';
select pg_temp.student(50, 'a@yorku.ca');
select pg_temp.check(true, 'approved school can sign up');

-- ---------------------------------------------------------------- delete
select pg_temp.as_user(6);
set role authenticated;
select public.delete_my_response();
select pg_temp.check(public.get_my_response() is null, 'student can delete their response');
select pg_temp.check(public.get_my_history() = '[]'::jsonb, 'deleting your numbers deletes their history');
select public.delete_my_account();
reset role;
select pg_temp.check(not exists (select 1 from auth.users where id = pg_temp.uid(6)), 'student can delete their account');
select pg_temp.check((select count(*) from public.responses) = 11, 'deletes removed exactly one row');
select pg_temp.as_user(7);
set role authenticated;
select public.delete_my_account();
reset role;
select pg_temp.check(not exists (select 1 from public.responses r where r.user_id = pg_temp.uid(7)), 'deleting the account removes its response');
select pg_temp.check(not exists (select 1 from public.response_history h where h.user_id = pg_temp.uid(7)), 'deleting the account removes its history');
\echo ALL DATABASE TESTS PASSED
