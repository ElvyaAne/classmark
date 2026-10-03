import type { MetricKey, ResponseInput } from "./api";

export const MIN_PEERS = 5;

export interface Metric {
  key: MetricKey;
  label: string;
  /** Read this metric's value off a response (GPA is normalised to percent of scale). */
  value: (r: ResponseInput, gpaScale: number) => number | null;
  format: (v: number) => string;
  advice: string;
}

export const METRICS: Metric[] = [
  {
    key: "gpa_pct", label: "CGPA",
    value: (r, scale) => (r.gpa == null ? null : Math.round((r.gpa / scale) * 1000) / 10),
    format: (v) => `${v.toFixed(0)}% of scale`,
    advice: "Protect your GPA. It's the first thing recruiters and grad programs look at, and it compounds.",
  },
  {
    key: "projects", label: "Finished projects", value: (r) => r.projects, format: String,
    advice: "Finish one project end to end, with a README, tests, and a live demo. A finished project beats several started ones.",
  },
  {
    key: "hackathons", label: "Hackathons attended", value: (r) => r.hackathons, format: String,
    advice: "Go to one more hackathon this term. Local ones are the easiest to get into.",
  },
  {
    key: "hackathon_wins", label: "Hackathon placements", value: (r) => r.hackathon_wins, format: String,
    advice: "Aim to place, not just attend. Pick a sponsor track with fewer teams and demo something that works.",
  },
  {
    key: "leetcode", label: "LeetCode solved", value: (r) => r.leetcode, format: String,
    advice: "Do 3–5 problems a week, mostly mediums. They're the gate for most technical interviews.",
  },
  {
    key: "internships", label: "Tech internships / co-ops", value: (r) => r.internships, format: String,
    advice: "Apply widely through the co-op board and job sites. A first internship makes every later one easier.",
  },
  {
    key: "work_months", label: "Other work experience", value: (r) => r.work_months, format: (v) => `${v} mo`,
    advice: "Any steady job shows reliability. List it with one concrete result.",
  },
  {
    key: "languages", label: "Languages known", value: (r) => r.languages, format: String,
    advice: "Go deep rather than wide: one systems language (C++) and one for data (Python).",
  },
];

/** Mid-rank percentile of x within a sorted sample: share below x plus half the ties. 0–100. */
export function percentile(sorted: readonly number[], x: number): number {
  if (sorted.length === 0) throw new Error("empty sample");
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < x) below++;
    else if (v === x) equal++;
  }
  return Math.round(((below + equal / 2) / sorted.length) * 100);
}

/** Linear-interpolated quantile of a sorted sample (q in 0..1). */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) throw new Error("empty sample");
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export interface MetricResult {
  metric: Metric;
  you: number | null;
  peers: number[] | null; // sorted; null when hidden for privacy
  percentile: number | null;
  median: number | null;
  p75: number | null;
}

export function scoreMetrics(
  me: ResponseInput | null,
  gpaScale: number,
  peerMetrics: Partial<Record<MetricKey, number[] | null>> | null,
): MetricResult[] {
  return METRICS.map((metric) => {
    const peers = peerMetrics?.[metric.key] ?? null;
    const you = me ? metric.value(me, gpaScale) : null;
    const has = peers && peers.length >= MIN_PEERS;
    return {
      metric,
      you,
      peers: has ? peers : null,
      percentile: has && you != null ? percentile(peers, you) : null,
      median: has ? quantile(peers, 0.5) : null,
      p75: has ? quantile(peers, 0.75) : null,
    };
  });
}

/** Overall standing: mean of the per-metric percentiles that exist. */
export function overall(results: MetricResult[]): number | null {
  const ps = results.map((r) => r.percentile).filter((p): p is number => p != null);
  if (ps.length === 0) return null;
  return Math.round(ps.reduce((a, b) => a + b, 0) / ps.length);
}

/** Weakest metrics first, only those below the 60th percentile. */
export function gaps(results: MetricResult[], limit = 4): MetricResult[] {
  return results
    .filter((r) => r.percentile != null && r.percentile < 60)
    .sort((a, b) => (a.percentile ?? 0) - (b.percentile ?? 0))
    .slice(0, limit);
}
