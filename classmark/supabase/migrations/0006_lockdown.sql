-- Classmark 0006: private by default.
--
-- Run after 0005_account_deletion.sql.
--
-- Supabase gives the public roles (anon = anyone with the site's key, authenticated = any signed-in
-- student) full access to every new table and function in the public schema unless a migration
-- takes it away again. Every migration so far has done that by hand. This one:
--   * switches that default off, so new tables start private and have to be shared on purpose;
--   * takes every grant away again and hands back exactly the functions the app calls, so this
--     file is the one list of what the browser can reach;
--   * makes the per-school counts on the landing page follow the batched release from 0004,
--     so they no longer show the moment one student joins or leaves.

-- ---------------------------------------------------------------- new tables start private

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
-- Postgres itself still lets everyone run a new function. That default can only be changed for the
-- whole database, which could break Supabase's own extensions, so it stays; the database tests
-- check the exact list of callable functions instead and fail if anything new slips in.

-- ---------------------------------------------------------------- landing-page counts

create or replace function public.list_schools()
returns table (slug text, name text, country text, gpa_scale numeric, responses bigint, email_domains text[])
language sql stable security definer set search_path = public as $$
  select s.slug, s.name, s.country, s.gpa_scale, count(r.user_id), s.email_domains
  from schools s left join published_responses r on r.school_slug = s.slug
  where s.approved
  group by s.slug
  order by count(r.user_id) desc, s.name
$$;

-- ---------------------------------------------------------------- the whole API, in one place

revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Anyone: the school list, the average student, and asking for a new school.
grant execute on function public.list_schools()                                  to anon, authenticated;
grant execute on function public.average_student(text, text, int)                to anon, authenticated;
grant execute on function public.request_school(text, text, numeric, text, text) to anon, authenticated;
-- Signed-in students: their own account and numbers, and peer distributions.
grant execute on function public.whoami()                                        to authenticated;
grant execute on function public.peer_stats(text, text, int)                     to authenticated;
grant execute on function public.get_my_response()                               to authenticated;
grant execute on function public.get_my_history()                                to authenticated;
grant execute on function public.save_my_response(jsonb)                         to authenticated;
grant execute on function public.delete_my_response()                            to authenticated;
grant execute on function public.delete_my_account()                             to authenticated;
