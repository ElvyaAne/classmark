-- Classmark database schema (Supabase / PostgreSQL 15+)
--
-- Design:
--   * Every visitor who submits gets an anonymous Supabase Auth user. One response per user.
--   * Tables are locked down (RLS on, no policies, no grants). All access goes through the
--     SECURITY DEFINER functions below, which enforce ownership and the anonymity threshold.
--   * peer_stats() never returns individual rows: only sorted value arrays, and only when at
--     least MIN_PEERS (5) people match the filter.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables

create table if not exists public.schools (
  slug         text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name         text not null check (char_length(name) between 3 and 120),
  country      text not null default 'Canada' check (char_length(country) between 2 and 60),
  gpa_scale    numeric(5,2) not null check (gpa_scale between 1 and 100),
  approved     boolean not null default false,
  requested_by uuid,
  created_at   timestamptz not null default now()
);

create table if not exists public.responses (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  school_slug    text not null references public.schools(slug) on update cascade,
  program        text not null check (program in (
                   'Computer Science','CS & Mathematics','Mathematics','Software Engineering',
                   'Computer Engineering','Electrical Engineering','Data Science','Statistics','Other')),
  year           smallint not null check (year between 1 and 6),
  gpa            numeric(6,2) check (gpa >= 0),
  projects       smallint check (projects between 0 and 100),
  hackathons     smallint check (hackathons between 0 and 200),
  hackathon_wins smallint check (hackathon_wins between 0 and 200),
  leetcode       integer  check (leetcode between 0 and 5000),
  internships    smallint check (internships between 0 and 20),
  work_months    smallint check (work_months between 0 and 240),
  languages      smallint check (languages between 0 and 50),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint wins_not_more_than_attended
    check (hackathon_wins is null or hackathons is null or hackathon_wins <= hackathons)
);

create index if not exists responses_group_idx on public.responses (school_slug, program, year);

alter table public.schools   enable row level security;
alter table public.responses enable row level security;
revoke all on public.schools, public.responses from anon, authenticated;

-- ---------------------------------------------------------------- helpers

create or replace function public._metric_array(vals numeric[])
returns jsonb language sql immutable as $$
  -- sorted, nulls dropped; null when fewer than 5 values so a single metric can't expose anyone
  select case when count(v) >= 5 then jsonb_agg(v order by v) else null end
  from unnest(vals) v where v is not null
$$;

-- ---------------------------------------------------------------- public API

-- Approved schools with participation counts (for pickers and the landing page).
create or replace function public.list_schools()
returns table (slug text, name text, country text, gpa_scale numeric, responses bigint)
language sql stable security definer set search_path = public as $$
  select s.slug, s.name, s.country, s.gpa_scale, count(r.user_id)
  from schools s left join responses r on r.school_slug = s.slug
  where s.approved
  group by s.slug
  order by count(r.user_id) desc, s.name
$$;

-- The caller's own response, or null.
create or replace function public.get_my_response()
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(r) - 'user_id' from responses r where r.user_id = auth.uid()
$$;

-- Create or replace the caller's response. Returns the saved row.
create or replace function public.save_my_response(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  scale numeric;
  saved jsonb;
begin
  if uid is null then
    raise exception 'Sign-in required' using errcode = '28000';
  end if;
  select gpa_scale into scale from schools where slug = p->>'school_slug' and approved;
  if scale is null then
    raise exception 'Unknown school' using errcode = '22023';
  end if;
  if (p->>'gpa') is not null and (p->>'gpa')::numeric > scale then
    raise exception 'GPA is above this school''s scale of %', scale using errcode = '22023';
  end if;

  insert into responses as r (user_id, school_slug, program, year, gpa, projects, hackathons,
                              hackathon_wins, leetcode, internships, work_months, languages)
  values (uid, p->>'school_slug', p->>'program', (p->>'year')::smallint, (p->>'gpa')::numeric,
          (p->>'projects')::smallint, (p->>'hackathons')::smallint, (p->>'hackathon_wins')::smallint,
          (p->>'leetcode')::integer, (p->>'internships')::smallint, (p->>'work_months')::smallint,
          (p->>'languages')::smallint)
  on conflict (user_id) do update set
    school_slug = excluded.school_slug, program = excluded.program, year = excluded.year,
    gpa = excluded.gpa, projects = excluded.projects, hackathons = excluded.hackathons,
    hackathon_wins = excluded.hackathon_wins, leetcode = excluded.leetcode,
    internships = excluded.internships, work_months = excluded.work_months,
    languages = excluded.languages, updated_at = now()
  returning to_jsonb(r) - 'user_id' into saved;
  return saved;
end $$;

create or replace function public.delete_my_response()
returns void language sql security definer set search_path = public as $$
  delete from responses where user_id = auth.uid()
$$;

-- Distribution of each metric for a peer group, excluding the caller.
-- Any filter left null means "all". Below 5 matching peers, metrics is null.
create or replace function public.peer_stats(
  p_school text default null, p_program text default null, p_year int default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with peers as (
    select r.*, round(r.gpa / s.gpa_scale * 100, 1) as gpa_pct
    from responses r join schools s on s.slug = r.school_slug
    where (p_school  is null or r.school_slug = p_school)
      and (p_program is null or r.program = p_program)
      and (p_year    is null or r.year = p_year)
      and r.user_id is distinct from auth.uid()
  )
  select jsonb_build_object(
    'n', count(*),
    'min_n', 5,
    'metrics', case when count(*) < 5 then null else jsonb_build_object(
      'gpa_pct',        _metric_array(array_agg(gpa_pct)),
      'projects',       _metric_array(array_agg(projects::numeric)),
      'hackathons',     _metric_array(array_agg(hackathons::numeric)),
      'hackathon_wins', _metric_array(array_agg(hackathon_wins::numeric)),
      'leetcode',       _metric_array(array_agg(leetcode::numeric)),
      'internships',    _metric_array(array_agg(internships::numeric)),
      'work_months',    _metric_array(array_agg(work_months::numeric)),
      'languages',      _metric_array(array_agg(languages::numeric))
    ) end)
  from peers
$$;

-- Ask for a school to be added. It stays hidden until an admin approves it:
--   update public.schools set approved = true where slug = '...';
create or replace function public.request_school(
  p_slug text, p_name text, p_gpa_scale numeric, p_country text default 'Canada')
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign-in required' using errcode = '28000';
  end if;
  if (select count(*) from schools where requested_by = uid and not approved) >= 3 then
    raise exception 'You already have 3 pending school requests' using errcode = '22023';
  end if;
  if exists (select 1 from schools where slug = lower(p_slug)) then
    return 'exists';
  end if;
  insert into schools (slug, name, country, gpa_scale, approved, requested_by)
  values (lower(p_slug), trim(p_name), trim(p_country), p_gpa_scale, false, uid);
  return 'requested';
end $$;

-- ---------------------------------------------------------------- grants

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.list_schools()                         to anon, authenticated;
grant execute on function public.peer_stats(text, text, int)            to anon, authenticated;
grant execute on function public.get_my_response()                      to authenticated;
grant execute on function public.save_my_response(jsonb)                to authenticated;
grant execute on function public.delete_my_response()                   to authenticated;
grant execute on function public.request_school(text, text, numeric, text) to authenticated;
