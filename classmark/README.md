# Classmark

An anonymous peer benchmark for computer science and adjacent students. Enter your numbers (GPA, projects, hackathons, LeetCode, internships…) and see your **percentile on each metric** among students at your school, in your program and year, plus an overall standing and a ranked list of what would move you up.

![Classmark dashboard](docs/screenshot.png)

## Features

- **Per-metric percentiles** (mid-rank method) and an **overall standing**, which is the mean of your metric percentiles
- **Dot-plot distributions**, showing every anonymous peer, the median, and you
- **Next moves**: your weakest metrics, each with the 75th-percentile value to aim for
- **Multi-school**: each school has its own GPA scale (4.0, 4.3, 10-point, 12-point, percentage). Students can request new schools, which go live once an admin approves them.
- **Filters**: your school or all schools, any program, any year
- **Share links**: `/?school=uottawa` opens on a school, for growing the sample
- **No accounts**: an anonymous session in the browser lets each student update or delete their own response

## Privacy model

Privacy is enforced in the database, not the UI:

- Tables have row-level security on and **no direct grants**. The browser can only call six `SECURITY DEFINER` functions.
- `peer_stats()` returns **sorted value arrays only**, never rows or IDs, and only when **at least 5** peers match the filter. Any single metric with fewer than 5 answers is also hidden.
- A response is linked to an anonymous auth user, never a name or email. `get_my_response()` only ever returns the caller's own row.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + TypeScript + Vite, no UI framework; hand-built SVG charts |
| Backend | Supabase: Postgres, anonymous auth, PostgREST RPC |
| API client | ~100-line fetch wrapper (`src/api.ts`), no SDK |
| Tests | Node test runner (math), SQL tests on real Postgres (security + logic), Playwright end-to-end |

## Run it yourself

### 1. Create the database (free)

1. Create a project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** and run `supabase/migrations/0001_init.sql`, then `supabase/seed.sql`. The seed adds 10 Canadian schools.
3. In **Authentication** settings, turn on **anonymous sign-ins**.
4. Under **Project Settings → API**, copy the project URL and the `anon` public key.

### 2. Run locally

```bash
cp .env.example .env      # paste the URL and anon key into .env
npm install
npm run dev               # http://localhost:5173
```

### 3. Deploy (free)

Push the repo to GitHub, then import it on [Vercel](https://vercel.com) or [Netlify](https://netlify.com):

- Framework: **Vite**. Build command `npm run build`, output folder `dist`.
- Environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

The anon key is designed to be public. Security comes from the database functions and grants.

## Admin

Run these in the Supabase SQL Editor.

```sql
-- see pending school requests
select slug, name, country, gpa_scale, created_at from schools where not approved;

-- approve one
update schools set approved = true where slug = 'yorku';

-- participation by school
select * from list_schools();
```

## Tests

```bash
npm test                                            # percentile math (Node test runner)
PG_ARGS="-h localhost -U postgres" npm run test:db  # 23 database checks: privacy threshold, ownership, validation
PG_ARGS="-h localhost -U postgres" bash test/e2e/run.sh   # full browser flow
```

The database and end-to-end tests run on plain PostgreSQL. `test/supabase_stub.sql` recreates the bits of Supabase the schema uses (`auth.uid()`, the `anon` and `authenticated` roles). `test/e2e/mock_supabase.py` serves the same API shape as Supabase on top of the real SQL functions, so the browser test exercises the actual grants and privacy rules. The end-to-end run needs Python with `playwright` installed.

## Project layout

```
src/
  api.ts             anonymous auth + RPC client
  stats.ts           percentile, quantile, scoring, gaps
  references.ts      published benchmark figures (with sources)
  App.tsx            page: filters, standing, metrics, moves, share, form
  components/        StripChart, ProfileForm, RequestSchool
supabase/
  migrations/0001_init.sql   schema, privacy functions, grants
  seed.sql                   starter schools
test/                unit, database and end-to-end tests
```

## Known limits and next steps

- **Self-reported data.** Anyone can enter anything. Next step: optional verification with a school email domain, stored as a flag only.
- **Spam.** Supabase rate-limits anonymous sign-ins per IP. Before a big launch, add CAPTCHA (Supabase supports Cloudflare Turnstile).
- **Cross-school GPA** is compared as a percentage of each school's scale, which is a rough approximation. Comparisons within one school are exact.
- **Ideas:** track your own progress over time, add metric weights per career track (SWE, ML, quant), and add a "what-if" slider ("if I solve 50 more LeetCode problems…").
