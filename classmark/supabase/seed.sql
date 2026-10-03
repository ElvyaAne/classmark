-- Starter schools. GPA scale = the top of each school's grading scale.
-- Percent-graded schools use 100. Add more from the app ("Request a school") and approve them here.
insert into public.schools (slug, name, country, gpa_scale, approved) values
  ('uottawa',   'University of Ottawa',       'Canada', 10,  true),
  ('carleton',  'Carleton University',        'Canada', 12,  true),
  ('mcmaster',  'McMaster University',        'Canada', 12,  true),
  ('waterloo',  'University of Waterloo',     'Canada', 100, true),
  ('uoft',      'University of Toronto',      'Canada', 4,   true),
  ('mcgill',    'McGill University',          'Canada', 4,   true),
  ('queens',    'Queen''s University',        'Canada', 4.3, true),
  ('concordia', 'Concordia University',       'Canada', 4.3, true),
  ('western',   'Western University',         'Canada', 100, true),
  ('ubc',       'University of British Columbia', 'Canada', 100, true)
on conflict (slug) do nothing;
