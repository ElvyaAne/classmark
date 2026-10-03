-- Classmark 0002: school-email verification.
--
-- Run after 0001_init.sql (fresh project: 0001, then 0002, then seed.sql).
--
-- What changes:
--   * Accounts are email-only (one-time code), and only for addresses at an approved school's
--     domain. Your school is decided by your verified email, never by what the form says.
--   * Signed-out visitors only get average_student(): one mean per metric for a group.
--     Distributions, percentiles and saving need a verified school email.
--   * Groups (and single metrics) are hidden when they, or their difference from any wider
--     group, have fewer than 5 people. That stops "subtract two filters" tricks from
--     isolating one student.
--   * Responses left over from the anonymous version (no verified email) are deleted.

-- ---------------------------------------------------------------- schools: email domains

alter table public.schools
  add column if not exists email_domains text[] not null default '{}';

alter table public.schools drop constraint if exists schools_email_domains_format;
alter table public.schools add constraint schools_email_domains_format check (
  array_to_string(email_domains, ',') ~ '^([a-z0-9-]+(\.[a-z0-9-]+)+)?(,[a-z0-9-]+(\.[a-z0-9-]+)+)*$'
  and cardinality(email_domains) <= 5
);

-- Domains for the starter schools. A student address on a subdomain also counts
-- (cmail.carleton.ca matches carleton.ca, mail.utoronto.ca matches utoronto.ca).
update public.schools s set email_domains = d.domains
from (values
  ('uottawa',   array['uottawa.ca']),
  ('carleton',  array['carleton.ca']),
  ('mcmaster',  array['mcmaster.ca']),
  ('waterloo',  array['uwaterloo.ca']),
  ('uoft',      array['utoronto.ca']),
  ('mcgill',    array['mcgill.ca']),
  ('queens',    array['queensu.ca']),
  ('concordia', array['concordia.ca']),
  ('western',   array['uwo.ca']),
  ('ubc',       array['ubc.ca'])
) as d(slug, domains)
where s.slug = d.slug and s.email_domains = '{}';

-- ---------------------------------------------------------------- helpers (not callable by clients)

-- The approved school an email address belongs to, or null.
create or replace function public._school_for_email(p_email text)
returns text language sql stable security definer set search_path = public as $$
  select s.slug
  from schools s, unnest(s.email_domains) d,
       lateral (select lower(substring(p_email from '@([^@]+)$')) as host) h
  where s.approved and h.host is not null
    and (h.host = d or h.host like '%.' || d)
  order by s.slug
  limit 1
$$;

-- The caller's school, from their confirmed email. Null when signed out or unverified.
create or replace function public._my_school()
returns text language sql stable security definer set search_path = public, auth as $$
  select public._school_for_email(u.email)
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null
$$;

-- Answer counts for a filter: total people and non-blank answers per metric.
create or replace function public._group_counts(p_school text, p_program text, p_year int, p_exclude uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'n', count(*),
    'gpa_pct', count(gpa), 'projects', count(projects), 'hackathons', count(hackathons),
    'hackathon_wins', count(hackathon_wins), 'leetcode', count(leetcode),
    'internships', count(internships), 'work_months', count(work_months), 'languages', count(languages))
  from responses r
  where (p_school  is null or r.school_slug = p_school)
    and (p_program is null or r.program = p_program)
    and (p_year    is null or r.year = p_year)
    and r.user_id is distinct from p_exclude
$$;

-- Which parts of a group must stay hidden. Returns the keys to hide: 'n' hides the whole group,
-- a metric key hides that metric. A count is unsafe when it is below 5, or when any wider group
-- (drop one or more filters) has between 1 and 4 more people/answers, since subtracting the two
-- would expose those few students.
create or replace function public._hidden_keys(p_school text, p_program text, p_year int, p_exclude uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  keys constant text[] := array['n','gpa_pct','projects','hackathons','hackathon_wins','leetcode',
                                'internships','work_months','languages'];
  mine jsonb := public._group_counts(p_school, p_program, p_year, p_exclude);
  wider jsonb;
  hidden text[] := '{}';
  k text;
  diff int;
  mask int;
begin
  foreach k in array keys loop
    if (mine->>k)::int < 5 then hidden := hidden || k; end if;
  end loop;
  -- every wider group: bit 1 drops school, 2 drops program, 4 drops year
  for mask in 1..7 loop
    continue when (mask & 1 = 1 and p_school is null) or (mask & 2 = 2 and p_program is null)
               or (mask & 4 = 4 and p_year is null);
    wider := public._group_counts(
      case when mask & 1 = 1 then null else p_school end,
      case when mask & 2 = 2 then null else p_program end,
      case when mask & 4 = 4 then null else p_year end,
      p_exclude);
    foreach k in array keys loop
      diff := (wider->>k)::int - (mine->>k)::int;
      if diff between 1 and 4 and not k = any(hidden) then hidden := hidden || k; end if;
    end loop;
  end loop;
  return hidden;
end $$;

-- ---------------------------------------------------------------- signup guard

-- Refuse accounts for addresses outside approved school domains, so the sign-in form can't be
-- used to send codes to arbitrary inboxes. (save_my_response checks again, so this is a
-- second line of defence, not the only one.)
create or replace function public._check_signup_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is null or public._school_for_email(new.email) is null then
    raise exception 'Classmark accounts need a school email from a listed school'
      using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists classmark_school_email on auth.users;
create trigger classmark_school_email
  before insert or update of email on auth.users
  for each row execute function public._check_signup_email();

-- Leftovers from the anonymous version can't be verified, so they are removed.
delete from public.responses r
using auth.users u
where u.id = r.user_id
  and (u.email_confirmed_at is null or public._school_for_email(u.email) is null);

-- ---------------------------------------------------------------- public API

drop function if exists public.request_school(text, text, numeric, text);

-- Who the caller is: their email, whether it's confirmed, and the school it maps to.
create or replace function public.whoami()
returns jsonb language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'email', u.email,
    'verified', u.email_confirmed_at is not null,
    'school_slug', public._school_for_email(u.email))
  from auth.users u where u.id = auth.uid()
$$;

-- Approved schools, now with the email domains that can sign in for them.
drop function if exists public.list_schools();
create or replace function public.list_schools()
returns table (slug text, name text, country text, gpa_scale numeric, responses bigint, email_domains text[])
language sql stable security definer set search_path = public as $$
  select s.slug, s.name, s.country, s.gpa_scale, count(r.user_id), s.email_domains
  from schools s left join responses r on r.school_slug = s.slug
  where s.approved
  group by s.slug
  order by count(r.user_id) desc, s.name
$$;

-- Save the caller's numbers. The school always comes from the verified email.
create or replace function public.save_my_response(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  school text := public._my_school();
  scale  numeric;
  saved  jsonb;
begin
  if uid is null or school is null then
    raise exception 'Verify your school email to save your numbers' using errcode = '28000';
  end if;
  select gpa_scale into scale from schools where slug = school;
  if (p->>'gpa') is not null and (p->>'gpa')::numeric > scale then
    raise exception 'GPA is above this school''s scale of %', scale using errcode = '22023';
  end if;

  insert into responses as r (user_id, school_slug, program, year, gpa, projects, hackathons,
                              hackathon_wins, leetcode, internships, work_months, languages)
  values (uid, school, p->>'program', (p->>'year')::smallint, (p->>'gpa')::numeric,
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

-- Full distributions for a group, excluding the caller. Verified students only.
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
    from responses r join schools s on s.slug = r.school_slug
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

-- What anyone can see without signing in: the average student of a group, one mean per metric,
-- under the same hiding rules as peer_stats.
create or replace function public.average_student(
  p_school text default null, p_program text default null, p_year int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  hidden text[] := public._hidden_keys(p_school, p_program, p_year, null);
  out jsonb;
begin
  with g as (
    select r.*, r.gpa / s.gpa_scale * 100 as gpa_pct
    from responses r join schools s on s.slug = r.school_slug
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

-- Ask for a school to be added, with the email domain its students use. Works signed out,
-- since students of unlisted schools can't make an account yet. Stays hidden until approved:
--   update public.schools set approved = true where slug = '...';
create or replace function public.request_school(
  p_slug text, p_name text, p_gpa_scale numeric, p_email_domain text, p_country text default 'Canada')
returns text language plpgsql security definer set search_path = public as $$
declare
  dom text := lower(trim(p_email_domain));
begin
  if dom !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' then
    raise exception 'Enter the email domain only, like uottawa.ca' using errcode = '22023';
  end if;
  if (select count(*) from schools where not approved) >= 50 then
    raise exception 'Too many schools are waiting for review. Try again later.' using errcode = '22023';
  end if;
  if exists (select 1 from schools where slug = lower(p_slug) or dom = any(email_domains)) then
    return 'exists';
  end if;
  insert into schools (slug, name, country, gpa_scale, approved, requested_by, email_domains)
  values (lower(p_slug), trim(p_name), trim(p_country), p_gpa_scale, false, auth.uid(), array[dom]);
  return 'requested';
end $$;

-- Delete the caller's account entirely (the response goes with it).
create or replace function public.delete_my_account()
returns void language sql security definer set search_path = public, auth as $$
  delete from auth.users where id = auth.uid()
$$;

-- ---------------------------------------------------------------- grants

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.list_schools()                                    to anon, authenticated;
grant execute on function public.average_student(text, text, int)                  to anon, authenticated;
grant execute on function public.request_school(text, text, numeric, text, text)   to anon, authenticated;
grant execute on function public.whoami()                                          to authenticated;
grant execute on function public.peer_stats(text, text, int)                       to authenticated;
grant execute on function public.get_my_response()                                 to authenticated;
grant execute on function public.save_my_response(jsonb)                           to authenticated;
grant execute on function public.delete_my_response()                              to authenticated;
grant execute on function public.delete_my_account()                               to authenticated;
