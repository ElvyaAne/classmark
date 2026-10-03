import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PROGRAMS, sessionFromUrlHash,
  type AverageStudent, type Api, type Me, type PeerStats, type ResponseInput, type SavedResponse, type School,
} from "./api";
import { METRICS, MIN_PEERS, gaps, ordinal, overall, scoreMetrics, type Metric, type MetricResult } from "./stats";
import { REFERENCES } from "./references";
import { StripChart } from "./components/StripChart";
import { ProfileForm } from "./components/ProfileForm";
import { RequestSchool } from "./components/RequestSchool";
import { SignIn } from "./components/SignIn";

interface Filters {
  school: string; // slug or "all"
  program: string; // program or "all"
  year: string; // "1".."6" or "all"
}

function initialSchoolFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("school");
  } catch {
    return null;
  }
}

export function App({ api, captchaKey }: { api: Api | null; captchaKey?: string }) {
  if (!api) return <SetupNotice />;
  return <Classmark api={api} captchaKey={captchaKey} />;
}

function Classmark({ api, captchaKey }: { api: Api; captchaKey?: string }) {
  const [schools, setSchools] = useState<School[] | null>(null);
  const [who, setWho] = useState<Me | null>(null);
  const [mine, setMine] = useState<SavedResponse | null>(null);
  const [filters, setFilters] = useState<Filters | null>(null);
  const [stats, setStats] = useState<PeerStats | null>(null);
  const [avg, setAvg] = useState<AverageStudent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const verified = !!(who?.verified && who.school_slug);

  /** Who is signed in, and their saved numbers. Returns the filters to start on. */
  const loadIdentity = useCallback(async (list: School[]): Promise<Filters> => {
    const me = await api.whoami().catch(() => null);
    const ok = !!(me?.verified && me.school_slug);
    const saved = ok ? await api.getMyResponse().catch(() => null) : null;
    setWho(me);
    setMine(saved);
    if (saved) return { school: saved.school_slug, program: saved.program, year: String(saved.year) };
    if (ok) return { school: me!.school_slug!, program: "all", year: "all" };
    const fromUrl = initialSchoolFromUrl();
    return { school: list.some((s) => s.slug === fromUrl) ? fromUrl! : list[0]?.slug ?? "all", program: "all", year: "all" };
  }, [api]);

  // initial load: pick up a magic-link session if there is one, then schools + identity
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fromLink = sessionFromUrlHash(window.location.hash);
      if (fromLink) {
        if (fromLink.session) api.adoptSession(fromLink.session);
        if (fromLink.error) setAuthNotice(fromLink.error);
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      try {
        const list = await api.listSchools();
        if (cancelled) return;
        setSchools(list);
        const f = await loadIdentity(list);
        if (!cancelled) setFilters(f);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn't reach the database.");
      }
    })();
    return () => { cancelled = true; };
  }, [api, loadIdentity]);

  const loadGroup = useCallback(async (f: Filters, full: boolean) => {
    const args = [
      f.school === "all" ? null : f.school,
      f.program === "all" ? null : f.program,
      f.year === "all" ? null : Number(f.year),
    ] as const;
    try {
      if (full) { setStats(await api.peerStats(...args)); setAvg(null); }
      else { setAvg(await api.averageStudent(...args)); setStats(null); }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load peer data.");
    }
  }, [api]);

  useEffect(() => { if (filters) loadGroup(filters, verified); }, [filters, verified, loadGroup, mine]);

  const schoolBySlug = useMemo(() => new Map((schools ?? []).map((s) => [s.slug, s])), [schools]);
  const mySchool = who?.school_slug ? schoolBySlug.get(who.school_slug) ?? null : null;
  const myScale = mySchool?.gpa_scale ?? 4;
  const results = useMemo(() => scoreMetrics(mine, myScale, stats?.metrics ?? null), [mine, myScale, stats]);
  const standing = overall(results);
  const group = verified ? stats : avg;
  const n = group?.n ?? 0;
  const totalResponses = (schools ?? []).reduce((a, s) => a + Number(s.responses), 0);
  const activeSchools = (schools ?? []).filter((s) => Number(s.responses) > 0).length;
  const shareSchool = filters && filters.school !== "all" ? filters.school : who?.school_slug ?? null;
  const shareUrl = `${window.location.origin}${window.location.pathname}${shareSchool ? `?school=${shareSchool}` : ""}`;
  const filterSchool = filters && filters.school !== "all" ? schoolBySlug.get(filters.school) ?? null : null;

  async function signedIn() {
    setAuthNotice(null);
    if (!schools) return;
    const f = await loadIdentity(schools);
    setFilters(f);
    document.getElementById("standing")?.scrollIntoView({ behavior: "smooth" });
  }

  async function signOut() {
    await api.signOut();
    setWho(null);
    setMine(null);
    setNotice(null);
    setAuthNotice("Signed out.");
    setFilters((f) => (f ? { ...f } : f));
  }

  async function save(r: ResponseInput) {
    setSaving(true);
    setNotice(null);
    try {
      const saved = await api.saveMyResponse(r);
      const first = !mine;
      setMine(saved);
      setSchools(await api.listSchools());
      if (first) setFilters({ school: saved.school_slug, program: saved.program, year: String(saved.year) });
      setNotice(first ? "Saved. Your percentiles are above." : "Updated.");
      if (first) document.getElementById("standing")?.scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function removeNumbers() {
    try {
      await api.deleteMyResponse();
      setMine(null);
      setSchools(await api.listSchools());
      setNotice("Your numbers were deleted.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't delete. Try again.");
    }
  }

  async function removeAccount() {
    try {
      await api.deleteMyAccount();
      setWho(null);
      setMine(null);
      setConfirmLeave(false);
      setSchools(await api.listSchools());
      setAuthNotice("Your account and numbers were deleted.");
      setFilters((f) => (f ? { ...f } : f));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't delete your account. Try again.");
    }
  }

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (loadError && !schools) {
    return (
      <div className="wrap"><Header total={null} active={null} />
        <div className="panel"><h2>Can't load Classmark right now</h2><p className="muted">{loadError}</p></div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <Header total={schools ? totalResponses : null} active={schools ? activeSchools : null} />

      {schools && !verified && (
        <section className="panel stack join" id="sign-in" aria-labelledby="h-join">
          <div className="stack tight">
            <h2 id="h-join">See where you stand</h2>
            <p className="muted small">
              Below is the average student. To see your own percentile on every metric, confirm you're a student with your school email.
              Your email is never shown to anyone or attached to your numbers.
            </p>
          </div>
          {who && !verified && (
            <p className="status error" role="alert">
              {who.school_slug
                ? `${who.email} isn't confirmed yet. Sign out and sign in again with a fresh code.`
                : `${who.email} isn't from a listed school, so it can't be used here.`}{" "}
              <button type="button" className="link" onClick={signOut}>Sign out</button>
            </p>
          )}
          {!who && <SignIn api={api} schools={schools} captchaKey={captchaKey} onSignedIn={signedIn} />}
          {authNotice && <p className="status" role="status">{authNotice}</p>}
        </section>
      )}

      {verified && !mine && (
        <a className="cta" href="#your-numbers">You're verified. Add your numbers to see your percentiles. <span aria-hidden>→</span></a>
      )}

      <section className="panel" id="standing" aria-labelledby="h-stand">
        {filters && schools && (
          <div className="filters">
            <div className="field">
              <label htmlFor="f-school">Compare within</label>
              <select id="f-school" value={filters.school} onChange={(e) => setFilters({ ...filters, school: e.target.value })}>
                {schools.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
                <option value="all">All schools</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-program">Program</label>
              <select id="f-program" value={filters.program} onChange={(e) => setFilters({ ...filters, program: e.target.value })}>
                <option value="all">All programs</option>
                {PROGRAMS.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-year">Year</label>
              <select id="f-year" value={filters.year} onChange={(e) => setFilters({ ...filters, year: e.target.value })}>
                <option value="all">All years</option>
                {[1, 2, 3, 4, 5, 6].map((y) => <option key={y} value={y}>{y === 6 ? "6+" : `Year ${y}`}</option>)}
              </select>
            </div>
          </div>
        )}
        {verified ? (
          <div className="standing">
            <div className="big" aria-live="polite">
              {standing != null ? <>{standing}<sup>{ordinal(standing).replace(/^\d+/, "")}</sup></> : "—"}
            </div>
            <div className="standing-text">
              <h2 id="h-stand">Overall standing</h2>
              <p className="muted small">{standingNote(!!mine, standing, n, stats == null, !!stats?.suppressed)}</p>
              <span className="chip">{stats == null ? "Loading…" : `${n} ${n === 1 ? "peer" : "peers"} in this group`}</span>
            </div>
          </div>
        ) : (
          <div className="standing-text">
            <h2 id="h-stand">The average student</h2>
            <p className="muted small">{averageNote(avg, filterSchool?.name ?? null)}</p>
            <span className="chip">{avg == null ? "Loading…" : `${n} ${n === 1 ? "student" : "students"} in this group`}</span>
          </div>
        )}
      </section>

      <section aria-labelledby="h-metrics" className="stack">
        <div className="section-head">
          <h2 id="h-metrics">By metric</h2>
          {verified && (
            <div className="legend">
              <span className="key"><span className="dot" />Each peer (anonymous)</span>
              <span className="key"><span className="dot you" />You</span>
              <span className="key"><span className="tick" />Peer median</span>
            </div>
          )}
        </div>
        <div className="panel metrics">
          {verified
            ? results.map((r) => <MetricRow key={r.metric.key} r={r} me={mine} scale={myScale} enough={n >= MIN_PEERS && !stats?.suppressed} />)
            : METRICS.map((m) => <AverageRow key={m.key} metric={m} value={avg?.averages?.[m.key] ?? null} school={filterSchool} />)}
        </div>
      </section>

      {verified && (
        <section className="panel stack" aria-labelledby="h-moves">
          <h2 id="h-moves">What would move you up</h2>
          <Moves results={results} me={mine} />
        </section>
      )}

      <section className="panel share" aria-labelledby="h-share">
        <div className="stack tight">
          <h2 id="h-share">Grow your school's sample</h2>
          <p className="muted small">Percentiles get more accurate with every response. Share this link with classmates; it opens on {shareSchool ? schoolBySlug.get(shareSchool)?.name ?? "your school" : "Classmark"}.</p>
        </div>
        <div className="share-row">
          <code className="share-url">{shareUrl}</code>
          <button type="button" className="ghost" onClick={copyShare}>{copied ? "Copied" : "Copy link"}</button>
        </div>
      </section>

      <section className="stack" aria-labelledby="h-refs">
        <h2 id="h-refs">Published reference points</h2>
        <p className="muted small">Context while your group is small. These describe other cohorts, mostly graduating classes, so compare with care.</p>
        <div className="refs">
          {REFERENCES.map((ref) => {
            const you = mine && ref.you ? ref.you(mine, mine.school_slug) : null;
            return (
              <div className="ref" key={ref.text}>
                <span className="fig">{ref.figure}</span>
                <p className="small">{ref.text}</p>
                {you && <p className="small you-line">{you}</p>}
                <a href={ref.url} target="_blank" rel="noreferrer">{ref.source}</a>
              </div>
            );
          })}
        </div>
      </section>

      {verified && mySchool && (
        <section className="panel stack" id="your-numbers" aria-labelledby="h-me">
          <h2 id="h-me">Your numbers</h2>
          <p className="muted small">
            Stored without your name or email. Leave any field blank to skip it. Update or delete it any time.
          </p>
          <ProfileForm school={mySchool} initial={mine} saving={saving} onSave={save} onDelete={mine ? removeNumbers : null} />
          {notice && <p className="status" role="status">{notice}</p>}
        </section>
      )}

      {who && (
        <section className="panel account" aria-labelledby="h-account">
          <h2 id="h-account" className="sr-only">Account</h2>
          <p className="small muted">Signed in as <b>{who.email}</b></p>
          <div className="actions">
            <button type="button" className="ghost" onClick={signOut}>Sign out</button>
            {!confirmLeave && <button type="button" className="ghost" onClick={() => setConfirmLeave(true)}>Delete my account</button>}
            {confirmLeave && (
              <span className="confirm">
                Delete your account and numbers for good?
                <button type="button" className="danger" onClick={removeAccount}>Delete account</button>
                <button type="button" className="ghost" onClick={() => setConfirmLeave(false)}>Keep</button>
              </span>
            )}
          </div>
        </section>
      )}

      <details className="panel">
        <summary>School not listed?</summary>
        <div className="stack">
          <p className="muted small">Request it with the email domain students use, and it'll be added after a quick check.</p>
          <RequestSchool onRequest={api.requestSchool} />
        </div>
      </details>

      <footer className="muted small stack tight">
        <h3>How privacy works</h3>
        <p>
          You sign in with a one-time code sent to your school email. That only proves you're a student there: your numbers are stored
          without your name or email, and nobody, including other students, can read individual responses. Signed-out visitors only
          see averages. Verified students see sorted values for a group once at least {MIN_PEERS} people match, and any single metric
          with fewer than {MIN_PEERS} answers stays hidden. A group is also hidden when comparing it with a wider group would single out
          fewer than {MIN_PEERS} people. GPAs are compared as a percentage of each school's scale, which is a rough way to compare
          across schools.
        </p>
      </footer>
    </div>
  );
}

function standingNote(hasMe: boolean, standing: number | null, n: number, loading: boolean, suppressed: boolean): string {
  if (loading) return "Loading peer data…";
  if (suppressed) return "Hidden for privacy: this group differs from a wider one by fewer than 5 people. Widen the filter.";
  if (!hasMe) return n >= MIN_PEERS
    ? `${n} people in this group so far. Add your numbers to see where you rank.`
    : `Percentiles unlock once ${MIN_PEERS} peers match this filter (${n} so far). Widen the filter or share the link.`;
  if (standing == null) return `Percentiles unlock once ${MIN_PEERS} peers match this filter (${n} so far). Try widening the filter, or share the link below.`;
  const verdict = standing >= 75 ? "You're ahead of most of this group." : standing >= 50 ? "You're above the middle of this group." : "You're below the middle of this group for now. The moves below show where to push.";
  return `Average of your percentiles across metrics, compared with ${n} peers. ${verdict}`;
}

function averageNote(avg: AverageStudent | null, schoolName: string | null): string {
  if (avg == null) return "Loading…";
  if (avg.suppressed) return "Hidden for privacy: this group differs from a wider one by fewer than 5 people. Widen the filter.";
  if (!avg.averages) return `Averages unlock once ${MIN_PEERS} students match this filter (${avg.n} so far). Widen the filter or share the link.`;
  return `What a typical student${schoolName ? ` at ${schoolName}` : ""} in this group reports. Verify your school email to see your own percentile on each one.`;
}

function Header({ total, active }: { total: number | null; active: number | null }) {
  return (
    <header className="stack tight">
      <span className="eyebrow">Verified peer benchmark · CS &amp; adjacent programs</span>
      <h1>Classmark</h1>
      <p className="muted lede">See where you stand among students at your school, in your program and year. Every metric gets a percentile, and your biggest gaps turn into a short list of next moves.</p>
      {total != null && (
        <p className="small muted">{total} {total === 1 ? "response" : "responses"} across {active} {active === 1 ? "school" : "schools"}</p>
      )}
    </header>
  );
}

function formatAverage(metric: Metric, v: number, school: School | null): string {
  if (metric.key === "gpa_pct") {
    return school ? `${(Math.round((v / 100) * school.gpa_scale * 100) / 100).toFixed(2)} / ${Number(school.gpa_scale)}` : `${v.toFixed(0)}% of scale`;
  }
  const shown = metric.key === "leetcode" ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  return metric.key === "work_months" ? `${shown} mo` : shown;
}

function AverageRow({ metric, value, school }: { metric: Metric; value: number | null; school: School | null }) {
  return (
    <div className="row avg-row">
      <div className="name"><span>{metric.label}</span></div>
      <div className="avg">
        <span className="val">{value == null ? "—" : formatAverage(metric, value, school)}</span>
        <span className="small muted">{value == null ? "not enough answers yet" : "average"}</span>
      </div>
      <div className="pct">
        <b className="tone-none">?</b>
        <span className="small muted"><a href="#sign-in">verify →</a></span>
      </div>
    </div>
  );
}

function MetricRow({ r, me, scale, enough }: { r: MetricResult; me: SavedResponse | null; scale: number; enough: boolean }) {
  const { metric, you, peers, percentile: p, median } = r;
  const all = [...(peers ?? []), ...(you != null ? [you] : [])];
  const domain: [number, number] = metric.key === "gpa_pct"
    ? [Math.min(50, ...all), 100]
    : [0, Math.max(1, ...all)];
  const shown = you == null ? (me ? "not set" : "—") : metric.key === "gpa_pct" && me?.gpa != null ? `${me.gpa} / ${scale}` : metric.format(you);
  const tone = p == null ? "none" : p >= 60 ? "good" : p >= 40 ? "mid" : "low";
  return (
    <div className="row">
      <div className="name">
        <span>{metric.label}</span>
        <span className="val">{shown}</span>
      </div>
      <StripChart label={metric.label} peers={peers} you={you} median={median} domain={domain} format={metric.format} />
      <div className="pct">
        <b className={`tone-${tone}`}>{p != null ? ordinal(p) : "—"}</b>
        <span className="small muted">
          {p != null ? "percentile" : !enough ? `needs ${MIN_PEERS} peers` : !me ? "add yours" : you == null ? "not set" : "too few answers"}
        </span>
      </div>
    </div>
  );
}

function Moves({ results, me }: { results: MetricResult[]; me: SavedResponse | null }) {
  if (!me) return <p className="muted">Add your numbers and this turns into a ranked list of what would raise your standing most.</p>;
  const weak = gaps(results);
  const scored = results.some((r) => r.percentile != null);
  const items = scored
    ? weak.map((g) => ({
        tag: `${ordinal(g.percentile!)} pct`,
        title: g.metric.label,
        text: `${g.metric.advice} The 75th percentile here is ${g.metric.format(g.metric.key === "gpa_pct" ? round(g.p75!) : Math.ceil(g.p75!))}; you have ${g.metric.format(g.you!)}.`,
      }))
    : fallbackMoves(me, results);
  if (items.length === 0) {
    return <p className="muted">You're at or above the 60th percentile on every metric here. Compare against all schools for a tougher benchmark.</p>;
  }
  return (
    <ul className="moves">
      {items.map((m) => (
        <li key={m.title}>
          <span className="tag">{m.tag}</span>
          <div><h3>{m.title}</h3><p className="muted small">{m.text}</p></div>
        </li>
      ))}
    </ul>
  );
}

function round(v: number) {
  return Math.round(v * 10) / 10;
}

function fallbackMoves(me: SavedResponse, results: MetricResult[]) {
  const advice = (k: string) => results.find((r) => r.metric.key === k)!.metric.advice;
  const out: { tag: string; title: string; text: string }[] = [];
  if ((me.projects ?? 0) < 3) out.push({ tag: "vs ref", title: "Finished projects", text: `The top third of Waterloo grads finish 3 or more; you have ${me.projects ?? 0}. ${advice("projects")}` });
  if ((me.leetcode ?? 0) < 100) out.push({ tag: "vs ref", title: "LeetCode solved", text: `At ${me.leetcode ?? 0}, interview practice is your thinnest area. ${advice("leetcode")}` });
  if ((me.internships ?? 0) < 1) out.push({ tag: "vs ref", title: "Tech internships / co-ops", text: advice("internships") });
  if ((me.hackathon_wins ?? 0) < 1) out.push({ tag: "vs ref", title: "Hackathon placements", text: advice("hackathon_wins") });
  return out.slice(0, 4);
}

function SetupNotice() {
  return (
    <div className="wrap">
      <Header total={null} active={null} />
      <div className="panel stack">
        <h2>Connect a database to start</h2>
        <p className="muted">Classmark needs a Supabase project. Copy <code>.env.example</code> to <code>.env</code>, fill in <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server. The README walks through it step by step.</p>
      </div>
    </div>
  );
}
