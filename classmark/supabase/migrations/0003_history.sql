-- Classmark 0003: your progress over time.
--
-- Run after 0002_school_email.sql.
--
-- Every save also keeps a copy of that day's numbers in response_history (one row per student
-- per day; saving twice in a day keeps the later numbers). Only the student can read their own
-- history, through get_my_history(). History is never used in peer comparisons, and deleting your
-- numbers or your account deletes it too.

create table if not exists public.response_history (
  user_id        uuid not null references auth.users(id) on delete cascade,
  day            date not null default current_date,
  school_slug    text not null,
  program        text not null,
  year           smallint not null,
  gpa            numeric(6,2),
  projects       smallint,
  hackathons     smallint,
  hackathon_wins smallint,
  leetcode       integer,
  internships    smallint,
  work_months    smallint,
  languages      smallint,
  primary key (user_id, day)
);

alter table public.response_history enable row level security;
revoke all on public.response_history from anon, authenticated;

-- Keep today's numbers whenever a response is saved.
create or replace function public._record_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into response_history as h (user_id, day, school_slug, program, year, gpa, projects, hackathons,
                                     hackathon_wins, leetcode, internships, work_months, languages)
  values (new.user_id, current_date, new.school_slug, new.program, new.year, new.gpa, new.projects,
          new.hackathons, new.hackathon_wins, new.leetcode, new.internships, new.work_months, new.languages)
  on conflict (user_id, day) do update set
    school_slug = excluded.school_slug, program = excluded.program, year = excluded.year,
    gpa = excluded.gpa, projects = excluded.projects, hackathons = excluded.hackathons,
    hackathon_wins = excluded.hackathon_wins, leetcode = excluded.leetcode,
    internships = excluded.internships, work_months = excluded.work_months, languages = excluded.languages;
  return null;
end $$;

drop trigger if exists classmark_history on public.responses;
create trigger classmark_history
  after insert or update on public.responses
  for each row execute function public._record_history();

-- Start everyone's history from the numbers they have now.
insert into public.response_history (user_id, day, school_slug, program, year, gpa, projects, hackathons,
                                     hackathon_wins, leetcode, internships, work_months, languages)
select user_id, updated_at::date, school_slug, program, year, gpa, projects, hackathons,
       hackathon_wins, leetcode, internships, work_months, languages
from public.responses
on conflict do nothing;

-- ---------------------------------------------------------------- public API

-- The caller's own history, oldest first. Never anyone else's.
create or replace function public.get_my_history()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(h) - 'user_id' order by h.day), '[]'::jsonb)
  from response_history h where h.user_id = auth.uid()
$$;

-- Deleting your numbers deletes their history as well.
create or replace function public.delete_my_response()
returns void language sql security definer set search_path = public as $$
  delete from response_history where user_id = auth.uid();
  delete from responses where user_id = auth.uid();
$$;

-- ---------------------------------------------------------------- grants

revoke execute on function public._record_history() from public, anon, authenticated;
revoke execute on function public.get_my_history() from public, anon;
grant execute on function public.get_my_history()     to authenticated;
grant execute on function public.delete_my_response() to authenticated;
