-- Classmark 0004: release new and changed numbers in batches.
--
-- Run after 0003_history.sql.
--
-- The problem: someone who checks a small group, waits for one classmate to join (or edit their
-- numbers), then checks again could subtract the two views and recover that one person's numbers.
--
-- The fix: comparisons no longer read the live responses table. They read published_responses,
-- and a new or changed response is only copied there together with at least 4 others from the same
-- school, program and year. Every filter is a union of those (school, program, year) cells, so
-- between any two moments the visible data of any group changes by 0 people or by 5 or more.
-- A student who changes program or year counts toward both the cell they leave and the one they
-- join, and only moves when both are ready.
--
-- Deleting your numbers or your account still removes them everywhere at once. That is your right,
-- and the trade-off is that someone watching the group closely could notice who left.

create table if not exists public.published_responses (
  user_id        uuid primary key references auth.users(id) on delete cascade,
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
  published_at   timestamptz not null default now()
);

create index if not exists published_responses_group_idx on public.published_responses (school_slug, program, year);

alter table public.published_responses enable row level security;
revoke all on public.published_responses from anon, authenticated;

-- Everything already visible stays visible.
insert into public.published_responses (user_id, school_slug, program, year, gpa, projects, hackathons, hackathon_wins, leetcode, internships, work_months, languages)
select user_id, school_slug, program, year, gpa, projects, hackathons, hackathon_wins, leetcode, internships, work_months, languages from public.responses
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------- helpers (not callable by clients)

-- Responses that differ from what is published, with the cells ("school|program|year") a release
-- would change: the cell the response is in now, and the one it was published in if that differs.
create or replace function public._pending()
returns table (user_id uuid, cells text[])
language sql stable security definer set search_path = public as $$
  select r.user_id,
         array_remove(array[
           r.school_slug || '|' || r.program || '|' || r.year,
           case when p.user_id is not null and (p.school_slug, p.program, p.year) is distinct from (r.school_slug, r.program, r.year)
                then p.school_slug || '|' || p.program || '|' || p.year end
         ], null)
  from responses r
  left join published_responses p on p.user_id = r.user_id
  where p.user_id is null
     or (p.school_slug, p.program, p.year, p.gpa, p.projects, p.hackathons, p.hackathon_wins, p.leetcode, p.internships, p.work_months, p.languages) is distinct from (r.school_slug, r.program, r.year, r.gpa, r.projects, r.hackathons, r.hackathon_wins, r.leetcode, r.internships, r.work_months, r.languages)
$$;

-- Publish every pending response whose cells each have at least 5 pending responses ready to go.
-- A response that also needs a cell that isn't ready waits, which can leave another cell short, so
-- this repeats until the set of ready cells stops shrinking.
create or replace function public._release_ready()
returns void language plpgsql security definer set search_path = public as $$
declare
  ready text[];
  still text[];
begin
  select coalesce(array_agg(c), '{}') into ready
  from (select c from public._pending() p, unnest(p.cells) c group by c having count(*) >= 5) x;
  loop
    exit when cardinality(ready) = 0;
    select coalesce(array_agg(c), '{}') into still
    from (select c from public._pending() p, unnest(p.cells) c
          where p.cells <@ ready group by c having count(*) >= 5) x;
    exit when still @> ready and ready @> still;
    ready := still;
  end loop;
  if cardinality(ready) = 0 then return; end if;

  insert into published_responses as p (user_id, school_slug, program, year, gpa, projects, hackathons, hackathon_wins, leetcode, internships, work_months, languages, published_at)
  select r.user_id, r.school_slug, r.program, r.year, r.gpa, r.projects, r.hackathons, r.hackathon_wins, r.leetcode, r.internships, r.work_months, r.languages, now()
  from responses r join public._pending() q on q.user_id = r.user_id
  where q.cells <@ ready
  on conflict (user_id) do update set
    school_slug = excluded.school_slug,
    program = excluded.program,
    year = excluded.year,
    gpa = excluded.gpa,
    projects = excluded.projects,
    hackathons = excluded.hackathons,
    hackathon_wins = excluded.hackathon_wins,
    leetcode = excluded.leetcode,
    internships = excluded.internships,
    work_months = excluded.work_months,
    languages = excluded.languages,
    published_at = now();
end $$;

create or replace function public._release_after_save()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._release_ready();
  return null;
end $$;

drop trigger if exists classmark_release on public.responses;
create trigger classmark_release
  after insert or update on public.responses
  for each statement execute function public._release_after_save();

-- Deleting your numbers takes them out of every comparison straight away.
create or replace function public._unpublish_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from published_responses where user_id = old.user_id;
  return null;
end $$;

drop trigger if exists classmark_unpublish on public.responses;
create trigger classmark_unpublish
  after delete on public.responses
  for each row execute function public._unpublish_deleted();

-- ---------------------------------------------------------------- comparisons read published data

create or replace function public._group_counts(p_school text, p_program text, p_year int, p_exclude uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'n', count(*),
    'gpa_pct', count(gpa), 'projects', count(projects), 'hackathons', count(hackathons),
    'hackathon_wins', count(hackathon_wins), 'leetcode', count(leetcode),
    'internships', count(internships), 'work_months', count(work_months), 'languages', count(languages))
  from published_responses r
  where (p_school  is null or r.school_slug = p_school)
    and (p_program is null or r.program = p_program)
    and (p_year    is null or r.year = p_year)
    and r.user_id is distinct from p_exclude
$$;

create or replace function public.peer_stats(
  p_school text default null, p_program text default null, p_year int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  hidden text[];
  out jsonb;
begin
  if public._my_school() is null then
    raise exception 'Verify your school email to see the full comparison' using errcode = '28000';
  end if;
  hidden := public._hidden_keys(p_school, p_program, p_year, me);
  with peers as (
    select r.*, round(r.gpa / s.gpa_scale * 100, 1) as gpa_pct
    from published_responses r join schools s on s.slug = r.school_slug
    where (p_school  is null or r.school_slug = p_school)
      and (p_program is null or r.program = p_program)
      and (p_year    is null or r.year = p_year)
      and r.user_id is distinct from me
  )
  select jsonb_build_object(
    'n', count(*),
    'min_n', 5,
    'suppressed', 'n' = any(hidden) and count(*) >= 5,
    'metrics', case when 'n' = any(hidden) then null else jsonb_strip_nulls(jsonb_build_object(
      'gpa_pct',        case when 'gpa_pct'        = any(hidden) then null else jsonb_agg(gpa_pct        order by gpa_pct)        filter (where gpa_pct is not null) end,
      'projects',       case when 'projects'       = any(hidden) then null else jsonb_agg(projects       order by projects)       filter (where projects is not null) end,
      'hackathons',     case when 'hackathons'     = any(hidden) then null else jsonb_agg(hackathons     order by hackathons)     filter (where hackathons is not null) end,
      'hackathon_wins', case when 'hackathon_wins' = any(hidden) then null else jsonb_agg(hackathon_wins order by hackathon_wins) filter (where hackathon_wins is not null) end,
      'leetcode',       case when 'leetcode'       = any(hidden) then null else jsonb_agg(leetcode       order by leetcode)       filter (where leetcode is not null) end,
      'internships',    case when 'internships'    = any(hidden) then null else jsonb_agg(internships    order by internships)    filter (where internships is not null) end,
      'work_months',    case when 'work_months'    = any(hidden) then null else jsonb_agg(work_months    order by work_months)    filter (where work_months is not null) end,
      'languages',      case when 'languages'      = any(hidden) then null else jsonb_agg(languages      order by languages)      filter (where languages is not null) end
    )) end)
  into out
  from peers;
  return out;
end $$;

create or replace function public.average_student(
  p_school text default null, p_program text default null, p_year int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  hidden text[] := public._hidden_keys(p_school, p_program, p_year, null);
  out jsonb;
begin
  with g as (
    select r.*, r.gpa / s.gpa_scale * 100 as gpa_pct
    from published_responses r join schools s on s.slug = r.school_slug
    where (p_school  is null or r.school_slug = p_school)
      and (p_program is null or r.program = p_program)
      and (p_year    is null or r.year = p_year)
  )
  select jsonb_build_object(
    'n', count(*),
    'min_n', 5,
    'suppressed', 'n' = any(hidden) and count(*) >= 5,
    'averages', case when 'n' = any(hidden) then null else jsonb_strip_nulls(jsonb_build_object(
      'gpa_pct',        case when 'gpa_pct'        = any(hidden) then null else round(avg(gpa_pct), 1) end,
      'projects',       case when 'projects'       = any(hidden) then null else round(avg(projects), 1) end,
      'hackathons',     case when 'hackathons'     = any(hidden) then null else round(avg(hackathons), 1) end,
      'hackathon_wins', case when 'hackathon_wins' = any(hidden) then null else round(avg(hackathon_wins), 1) end,
      'leetcode',       case when 'leetcode'       = any(hidden) then null else round(avg(leetcode), 0) end,
      'internships',    case when 'internships'    = any(hidden) then null else round(avg(internships), 1) end,
      'work_months',    case when 'work_months'    = any(hidden) then null else round(avg(work_months), 1) end,
      'languages',      case when 'languages'      = any(hidden) then null else round(avg(languages), 1) end
    )) end)
  into out
  from g;
  return out;
end $$;

-- ---------------------------------------------------------------- grants

revoke execute on function public._pending()            from public, anon, authenticated;
revoke execute on function public._release_ready()      from public, anon, authenticated;
revoke execute on function public._release_after_save() from public, anon, authenticated;
revoke execute on function public._unpublish_deleted()  from public, anon, authenticated;
