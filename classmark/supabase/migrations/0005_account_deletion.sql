-- Classmark 0005: account deletion leaves nothing behind.
--
-- Run after 0004_batched_release.sql.
--
-- Deleting your account already removed your login, your numbers, their history and their
-- published copy (all cascade from auth.users). The one thing left was your user id on any school
-- you had requested while signed in. It pointed at nothing, but it is cleared now too.

create or replace function public.delete_my_account()
returns void language sql security definer set search_path = public, auth as $$
  update public.schools set requested_by = null where requested_by = auth.uid();
  delete from auth.users where id = auth.uid();
$$;

-- Clean up ids left behind by accounts deleted before this migration.
update public.schools s set requested_by = null
where requested_by is not null and not exists (select 1 from auth.users u where u.id = s.requested_by);
