import { useCallback, useEffect, useMemo, useState } from "react";
import { PROGRAMS, type Api, type PeerStats, type ResponseInput, type SavedResponse, type School } from "./api";
import { MIN_PEERS, gaps, ordinal, overall, scoreMetrics, type MetricResult } from "./stats";
import { REFERENCES } from "./references";
import { StripChart } from "./components/StripChart";
import { ProfileForm } from "./components/ProfileForm";
import { RequestSchool } from "./components/RequestSchool";

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

export function App({ api }: { api: Api | null }) {
  if (!api) return <SetupNotice />;
  return <Classmark api={api} />;
}

function Classmark({ api }: { api: Api }) {
  const [schools, setSchools] = useState<School[] | null>(null);
  const [me, setMe] = useState<SavedResponse | null>(null);
  const [filters, setFilters] = useState<Filters | null>(null);
  const [stats, setStats] = useState<PeerStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // initial load: schools + this browser's saved response (if any)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, mine] = await Promise.all([api.listSchools(), api.getMyResponse().catch(() => null)]);
        if (cancelled) return;
        setSchools(list);
        setMe(mine);
        const fromUrl = initialSchoolFromUrl();
        const school = mine?.school_slug ?? (list.some((s) => s.slug === fromUrl) ? fromUrl! : list[0]?.slug ?? "all");
        setFilters(mine
          ? { school, program: mine.program, year: String(mine.year) }
          : { school, program: "all", year: "all" });
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn't reach the database.");
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  const loadStats = useCallback(async (f: Filters) => {
    try {
      setStats(await api.peerStats(
        f.school === "all" ? null : f.school,
        f.program === "all" ? null : f.program,
        f.year === "all" ? null : Number(f.year),
      ));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load peer stats.");
    }
  }, [api]);

  useEffect(() => { if (filters) loadStats(filters); }, [filters, loadStats, me]);

  const schoolBySlug = useMemo(() => new Map((schools ?? []).map((s) => [s.slug, s])), [schools]);
  const myScale = me ? schoolBySlug.get(me.school_slug)?.gpa_scale ?? 4 : 4;
  const results = useMemo(() => scoreMetrics(me, myScale, stats?.metrics ?? null), [me, myScale, stats]);
  const standing = overall(results);
  const n = stats?.n ?? 0;
  const totalResponses = (schools ?? []).reduce((a, s) => a + Number(s.responses), 0);
  const activeSchools = (schools ?? []).filter((s) => Number(s.responses) > 0).length;
  const shareSchool = filters && filters.school !== "all" ? filters.school : me?.school_slug ?? null;
  const shareUrl = `${window.location.origin}${window.location.pathname}${shareSchool ? `?school=${shareSchool}` : ""}`;

  async function save(r: ResponseInput) {
    setSaving(true);
    setNotice(null);
    try {
      const saved = await api.saveMyResponse(r);
      const first = !me;
      setMe(saved);
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

  async function remove() {
    try {
      await api.deleteMyResponse();
      setMe(null);
      setSchools(await api.listSchools());
      setNotice("Your numbers were deleted.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't delete. Try again.");
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

      {!me && schools && (
        <a className="cta" href="#your-numbers">Add your numbers to see your percentiles. It takes a minute, with no account and no name. <span aria-hidden>→</span></a>
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
        <div className="standing">
          <div className="big" aria-live="polite">
            {standing != null ? <>{standing}<sup>{ordinal(standing).replace(/^\d+/, "")}</sup></> : "—"}
          </div>
          <div className="standing-text">
            <h2 id="h-stand">Overall standing</h2>
            <p className="muted small">{standingNote(!!me, standing, n, stats == null)}</p>
            <span className="chip">{stats == null ? "Loading…" : `${n} ${n === 1 ? "peer" : "peers"} in this group`}</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="h-metrics" className="stack">
        <div className="section-head">
          <h2 id="h-metrics">By metric</h2>
          <div className="legend">
            <span className="key"><span className="dot" />Each peer (anonymous)</span>
            <span className="key"><span className="dot you" />You</span>
            <span className="key"><span className="tick" />Peer median</span>
          </div>
        </div>
        <div className="panel metrics">
          {results.map((r) => <MetricRow key={r.metric.key} r={r} me={me} scale={myScale} enough={n >= MIN_PEERS} />)}
        </div>
      </section>

      <section className="panel stack" aria-labelledby="h-moves">
        <h2 id="h-moves">What would move you up</h2>
        <Moves results={results} me={me} />
      </section>

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
            const you = me && ref.you ? ref.you(me, me.school_slug) : null;
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

      <section className="panel stack" id="your-numbers" aria-labelledby="h-me">
        <h2 id="h-me">Your numbers</h2>
        <p className="muted small">
          Stored without your name, linked only to this browser. Leave any field blank to skip it. Update or delete it any time.
        </p>
        {schools && (
          <ProfileForm schools={schools} initial={me} defaultSchool={initialSchoolFromUrl() ?? ""} saving={saving}
            onSave={save} onDelete={me ? remove : null} />
        )}
        {notice && <p className="status" role="status">{notice}</p>}
        <details>
          <summary>School not listed?</summary>
          <div className="stack">
            <p className="muted small">Request it and it'll be added after a quick check.</p>
            <RequestSchool onRequest={api.requestSchool} />
          </div>
        </details>
      </section>

      <footer className="muted small stack tight">
        <h3>How privacy works</h3>
        <p>Each response is tied to an anonymous ID kept in your browser, never to a name or email. Nobody, including other students, can read individual responses. The app only shows sorted values for a group once at least {MIN_PEERS} people match, and hides any single metric with fewer than {MIN_PEERS} answers. GPAs are compared as a percentage of each school's scale, which is a rough way to compare across schools.</p>
      </footer>
    </div>
  );
}

function standingNote(hasMe: boolean, standing: number | null, n: number, loading: boolean): string {
  if (loading) return "Loading peer data…";
  if (!hasMe) return n >= MIN_PEERS
    ? `${n} people in this group so far. Add your numbers to see where you rank.`
    : `Percentiles unlock once ${MIN_PEERS} peers match this filter (${n} so far). Widen the filter or share the link.`;
  if (standing == null) return `Percentiles unlock once ${MIN_PEERS} peers match this filter (${n} so far). Try widening the filter, or share the link below.`;
  const verdict = standing >= 75 ? "You're ahead of most of this group." : standing >= 50 ? "You're above the middle of this group." : "You're below the middle of this group for now. The moves below show where to push.";
  return `Average of your percentiles across metrics, compared with ${n} peers. ${verdict}`;
}

function Header({ total, active }: { total: number | null; active: number | null }) {
  return (
    <header className="stack tight">
      <span className="eyebrow">Anonymous peer benchmark · CS &amp; adjacent programs</span>
      <h1>Classmark</h1>
      <p className="muted lede">See where you stand among students at your school, in your program and year. Every metric gets a percentile, and your biggest gaps turn into a short list of next moves.</p>
      {total != null && (
        <p className="small muted">{total} {total === 1 ? "response" : "responses"} across {active} {active === 1 ? "school" : "schools"}</p>
      )}
    </header>
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
