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

export type Weights = Record<MetricKey, number>;

export interface Track {
  key: string;
  label: string;
  blurb: string;
  weights: Weights;
}

const EVEN: Weights = {
  gpa_pct: 1, projects: 1, hackathons: 1, hackathon_wins: 1, leetcode: 1, internships: 1, work_months: 1, languages: 1,
};

/** How much each metric counts toward the overall standing for a career goal. A rough guide, not a hiring formula. */
export const TRACKS: Track[] = [
  { key: "balanced", label: "Balanced", blurb: "Every metric counts the same.", weights: EVEN },
  {
    key: "swe", label: "Software engineering",
    blurb: "Internships and interview practice count most, then finished projects.",
    weights: { ...EVEN, leetcode: 3, internships: 3, projects: 2 },
  },
  {
    key: "ml", label: "ML / research",
    blurb: "GPA and finished projects count most (grad school and research labs look there first), then internships.",
    weights: { ...EVEN, gpa_pct: 3, projects: 3, internships: 2 },
  },
  {
    key: "quant", label: "Quant",
    blurb: "GPA and problem solving count most, then internships.",
    weights: { ...EVEN, gpa_pct: 3, leetcode: 3, internships: 2 },
  },
];

/** Overall standing: mean of the per-metric percentiles that exist, weighted by track (even by default). */
export function overall(results: MetricResult[], weights: Weights = EVEN): number | null {
  let sum = 0;
  let total = 0;
  for (const r of results) {
    const w = weights[r.metric.key];
    if (r.percentile == null || !w) continue;
    sum += r.percentile * w;
    total += w;
  }
  return total === 0 ? null : Math.round(sum / total);
}

/** Metrics below the 60th percentile, the ones that would lift the (weighted) standing most first. */
export function gaps(results: MetricResult[], limit = 4, weights: Weights = EVEN): MetricResult[] {
  const lift = (r: MetricResult) => (60 - (r.percentile ?? 60)) * weights[r.metric.key];
  return results
    .filter((r) => r.percentile != null && r.percentile < 60 && weights[r.metric.key] > 0)
    .sort((a, b) => lift(b) - lift(a) || (a.percentile ?? 0) - (b.percentile ?? 0))
    .slice(0, limit);
}

/** The response field behind a metric (GPA is stored raw, on the school's scale). */
export type MetricField = Exclude<keyof ResponseInput, "school_slug" | "program" | "year">;
export function fieldOf(key: MetricKey): MetricField {
  return key === "gpa_pct" ? "gpa" : key;
}

/** Your numbers with one field changed, for "what if" scoring against the same peers. */
export function withValue(me: ResponseInput, key: MetricKey, raw: number): ResponseInput {
  return { ...me, [fieldOf(key)]: raw };
}
