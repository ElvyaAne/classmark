-- Classmark 0007: a school's email domain has to belong to that school.
--
-- Run after 0006_lockdown.sql.
--
-- Anyone can request a school with any email domain, and the request waits for an admin. If a
-- request for "gmail.com" (or a shared ending like "qc.ca", which would match every address under
-- it) were ever approved by mistake, anyone could sign up and post numbers as that school's
-- students. The database now refuses those domains itself, in requests and in manual edits alike.

-- True when any of the domains is one that many unrelated people can get an address on.
create or replace function public._has_shared_email_domain(domains text[])
returns boolean language sql immutable set search_path = public as $$
  select exists (
    select 1 from unnest(domains) d
    where
      -- free email providers, and any subdomain of one
      exists (select 1 from unnest(array[
        'gmail.com','googlemail.com','outlook.com','hotmail.com','hotmail.ca','live.com','live.ca','msn.com',
        'yahoo.com','yahoo.ca','ymail.com','icloud.com','me.com','mac.com','aol.com','proton.me',
        'protonmail.com','pm.me','gmx.com','gmx.net','mail.com','zoho.com','yandex.com','tutanota.com',
        'fastmail.com','hey.com','qq.com','163.com']) p
        where d = p or d like '%.' || p)
      -- shared endings themselves ("umontreal.qc.ca" is fine, "qc.ca" is not)
      or d = any(array['gc.ca','qc.ca','on.ca','bc.ca','ab.ca','mb.ca','sk.ca','ns.ca','nb.ca','nl.ca',
                       'pe.ca','co.uk','ac.uk','org.uk','gov.uk','com.au','edu.au','co.in','ac.in',
                       'co.nz','ac.nz'])
  )
$$;

-- Not checked against rows already there, so a bad pending request doesn't stop this migration;
-- approving one fails, since an update is checked.
alter table public.schools drop constraint if exists schools_no_shared_domains;
alter table public.schools add constraint schools_no_shared_domains
  check (not public._has_shared_email_domain(email_domains)) not valid;

-- Same request as before, with a clear message for a shared domain.
create or replace function public.request_school(
  p_slug text, p_name text, p_gpa_scale numeric, p_email_domain text, p_country text default 'Canada')
returns text language plpgsql security definer set search_path = public as $$
declare
  dom text := lower(trim(p_email_domain));
begin
  if dom !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' then
    raise exception 'Enter the email domain only, like uottawa.ca' using errcode = '22023';
  end if;
  if public._has_shared_email_domain(array[dom]) then
    raise exception 'Use the school''s own email domain, not a personal email provider' using errcode = '22023';
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

revoke execute on function public._has_shared_email_domain(text[]) from public, anon, authenticated;
