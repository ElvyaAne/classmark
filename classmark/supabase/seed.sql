-- Starter schools. GPA scale = the top of each school's grading scale.
-- Percent-graded schools use 100. Email domains decide who can sign in for each school;
-- subdomains count too (cmail.carleton.ca matches carleton.ca).
-- Add more from the app ("School not listed?") and approve them here.
insert into public.schools (slug, name, country, gpa_scale, approved, email_domains) values
  ('uottawa',   'University of Ottawa',            'Canada', 10,  true, array['uottawa.ca']),
  ('carleton',  'Carleton University',             'Canada', 12,  true, array['carleton.ca']),
  ('mcmaster',  'McMaster University',             'Canada', 12,  true, array['mcmaster.ca']),
  ('waterloo',  'University of Waterloo',          'Canada', 100, true, array['uwaterloo.ca']),
  ('uoft',      'University of Toronto',           'Canada', 4,   true, array['utoronto.ca']),
  ('mcgill',    'McGill University',               'Canada', 4,   true, array['mcgill.ca']),
  ('queens',    'Queen''s University',             'Canada', 4.3, true, array['queensu.ca']),
  ('concordia', 'Concordia University',            'Canada', 4.3, true, array['concordia.ca']),
  ('western',   'Western University',              'Canada', 100, true, array['uwo.ca']),
  ('ubc',       'University of British Columbia',  'Canada', 100, true, array['ubc.ca'])
on conflict (slug) do update set email_domains = excluded.email_domains
  where public.schools.email_domains = '{}';
