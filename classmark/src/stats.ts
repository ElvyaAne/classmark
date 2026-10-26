import type { MetricKey, ResponseInput } from "./api";

export const MIN_PEERS = 5;

export interface Metric {
  key: MetricKey;
  label: string;
  /** How the metric reads inside a sentence */
  noun: string;
  /** Read this metric's value off a response (GPA is normalised to percent of scale). */
  value: (r: ResponseInput, gpaScale: number) => number | null;
  format: (v: number) => string;
  advice: string;
}

export const METRICS: Metric[] = [
  {
    key: "gpa_pct", noun: "your GPA", label: "CGPA",
    value: (r, scale) => (r.gpa == null ? null : Math.round((r.gpa / scale) * 1000) / 10),
    format: (v) => `${v.toFixed(0)}% of scale`,
    advice: "Protect your GPA. It's the first thing recruiters and grad programs look at, and it compounds.",
  },
  {
    key: "projects", noun: "finished projects", label: "Finished projects", value: (r) => r.projects, format: String,
    advice: "Finish one project end to end, with a README, tests, and a live demo. A finished project beats several started ones.",
  },
  {
    key: "hackathons", noun: "hackathons", label: "Hackathons attended", value: (r) => r.hackathons, format: String,
    advice: "Go to one more hackathon this term. Local ones are the easiest to get into.",
  },
  {
    key: "hackathon_wins", noun: "hackathon placements", label: "Hackathon placements", value: (r) => r.hackathon_wins, format: String,
    advice: "Aim to place, not just attend. Pick a sponsor track with fewer teams and demo something that works.",
  },
  {
    key: "leetcode", noun: "LeetCode practice", label: "LeetCode solved", value: (r) => r.leetcode, format: String,
    advice: "Do 3–5 problems a week, mostly mediums. They're the gate for most technical interviews.",
  },
  {
    key: "internships", noun: "internship experience", label: "Tech internships / co-ops", value: (r) => r.internships, format: String,
    advice: "Apply widely through the co-op board and job sites. A first internship makes every later one easier.",
  },
  {
    key: "work_months", noun: "other work experience", label: "Other work experience", value: (r) => r.work_months, format: (v) => `${v} mo`,
    advice: "Any steady job shows reliability. List it with one concrete result.",
  },
  {
    key: "languages", noun: "programming languages", label: "Languages known", value: (r) => r.languages, format: String,
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

/** A word for a percentile, so results read as a judgment rather than a number. */
export function tier(p: number): { word: string; tone: "good" | "mid" | "low" } {
  if (p >= 75) return { word: "A strength", tone: "good" };
  if (p >= 60) return { word: "Ahead", tone: "good" };
  if (p >= 40) return { word: "On par", tone: "mid" };
  return { word: "Room to grow", tone: "low" };
}

/** "top 20%" / "bottom 30%" / "around the middle", for plain-language sentences. */
export function position(p: number): string {
  if (p >= 60) return `top ${Math.max(1, 100 - p)}%`;
  if (p >= 40) return "around the middle";
  return `bottom ${Math.max(1, p)}%`;
}

export interface Read {
  headline: string;
  detail: string | null;
}

/** A two-sentence plain-language read of the results: overall, then strongest area and biggest gap. */
export function plainRead(results: MetricResult[], standing: number | null): Read | null {
  const scored = results.filter((r) => r.percentile != null);
  if (standing == null || scored.length === 0) return null;
  const headline = standing >= 75 ? "You're ahead of most students in this group."
    : standing >= 60 ? "You're ahead of the typical student in this group."
    : standing >= 40 ? "You're right around the typical student in this group."
    : "You're still building compared with this group, which is normal earlier on.";
  const best = scored.reduce((a, b) => (b.percentile! > a.percentile! ? b : a));
  const worst = scored.reduce((a, b) => (b.percentile! < a.percentile! ? b : a));
  const parts: string[] = [];
  if (best.percentile! >= 50) parts.push(`Your strongest area is ${best.metric.noun} (${position(best.percentile!)}).`);
  if (worst !== best && worst.percentile! < 50) parts.push(`The biggest gap is ${worst.metric.noun} (${position(worst.percentile!)}), so that's where effort pays off most.`);
  return { headline, detail: parts.length ? parts.join(" ") : null };
}

/** Weakest metrics first, only those below the 60th percentile. */
export function gaps(results: MetricResult[], limit = 4): MetricResult[] {
  return results
    .filter((r) => r.percentile != null && r.percentile < 60)
    .sort((a, b) => (a.percentile ?? 0) - (b.percentile ?? 0))
    .slice(0, limit);
}
