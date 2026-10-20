import { test } from "node:test";
import assert from "node:assert/strict";
import { percentile, quantile, ordinal, scoreMetrics, overall, gaps, progress, withValue, METRICS, TRACKS } from "../src/stats.ts";
import type { ResponseInput } from "../src/api.ts";

test("percentile uses mid-rank for ties", () => {
  assert.equal(percentile([1, 2, 3, 4], 5), 100);
  assert.equal(percentile([1, 2, 3, 4], 0), 0);
  assert.equal(percentile([1, 2, 2, 4], 2), 50); // 1 below + half of 2 ties = 2/4
  assert.equal(percentile([0, 1, 2, 3, 4], 2), 50);
});

test("quantile interpolates", () => {
  assert.equal(quantile([0, 10], 0.5), 5);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.75), 4);
  assert.equal(quantile([7], 0.9), 7);
});

test("ordinal suffixes", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal),
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
});

const me: ResponseInput = {
  school_slug: "uottawa", program: "CS & Mathematics", year: 2, gpa: 8.82, projects: 2, hackathons: 1,
  hackathon_wins: 0, leetcode: 29, internships: 0, work_months: 5, languages: 6,
};

test("GPA is normalised against the school's scale", () => {
  const gpa = METRICS.find((m) => m.key === "gpa_pct")!;
  assert.equal(gpa.value(me, 10), 88.2);
  assert.equal(gpa.value({ ...me, gpa: 3.5 }, 4), 87.5);
});

test("scoring hides metrics with fewer than 5 peers and averages the rest", () => {
  const results = scoreMetrics(me, 10, {
    gpa_pct: [60, 75, 80, 85, 91],
    projects: [0, 1, 2, 3, 4],
    leetcode: null,
    languages: [2, 3], // too few: treated as hidden
  });
  const by = Object.fromEntries(results.map((r) => [r.metric.key, r]));
  assert.equal(by.gpa_pct.percentile, 80);
  assert.equal(by.projects.percentile, 50);
  assert.equal(by.leetcode.percentile, null);
  assert.equal(by.languages.percentile, null);
  assert.equal(by.projects.median, 2);
  assert.equal(overall(results), 65);
  assert.deepEqual(gaps(results).map((g) => g.metric.key), ["projects"]);
});

test("no profile yet means no percentiles but distributions still show", () => {
  const results = scoreMetrics(null, 10, { projects: [0, 1, 2, 3, 4] });
  assert.equal(results.find((r) => r.metric.key === "projects")!.percentile, null);
  assert.deepEqual(results.find((r) => r.metric.key === "projects")!.peers, [0, 1, 2, 3, 4]);
  assert.equal(overall(results), null);
});

const peers = {
  gpa_pct: [60, 75, 80, 85, 91],   // you: 88.2 → 80th
  projects: [0, 1, 2, 3, 4],       // you: 2 → 50th
  leetcode: [10, 40, 60, 150, 300], // you: 29 → 20th
  internships: [0, 0, 1, 1, 2],    // you: 0 → 20th
};
const track = (k: string) => TRACKS.find((t) => t.key === k)!.weights;

test("career tracks weight the overall standing", () => {
  const results = scoreMetrics(me, 10, peers);
  assert.equal(overall(results), 43); // (80 + 50 + 20 + 20) / 4
  assert.equal(overall(results, track("balanced")), 43);
  // SWE: leetcode ×3, internships ×3, projects ×2 → (80 + 100 + 60 + 60) / 9
  assert.equal(overall(results, track("swe")), 33);
  // ML: GPA ×3, projects ×3, internships ×2 → (240 + 150 + 20 + 40) / 9
  assert.equal(overall(results, track("ml")), 50);
});

test("next moves follow the track: biggest weighted lift first", () => {
  const results = scoreMetrics(me, 10, peers);
  assert.deepEqual(gaps(results).map((g) => g.metric.key), ["leetcode", "internships", "projects"]);
  assert.deepEqual(gaps(results, 4, track("ml")).map((g) => g.metric.key), ["internships", "leetcode", "projects"]);
  assert.deepEqual(gaps(results, 1, track("swe")).map((g) => g.metric.key), ["leetcode"]);
});

test("what-if rescoring changes one number against the same peers", () => {
  const more = withValue(me, "leetcode", 200);
  assert.equal(more.leetcode, 200);
  assert.equal(me.leetcode, 29, "your saved numbers are untouched");
  const after = scoreMetrics(more, 10, peers);
  assert.equal(after.find((r) => r.metric.key === "leetcode")!.percentile, 80);
  assert.equal(overall(after), 58);
  const gpa = scoreMetrics(withValue(me, "gpa_pct", 9.5), 10, peers);
  assert.equal(gpa.find((r) => r.metric.key === "gpa_pct")!.percentile, 100);
});

test("progress lists each metric's numbers over time, oldest first", () => {
  const history = [
    { ...me, day: "2026-09-01", leetcode: 10, gpa: 8.5, projects: null },
    { ...me, day: "2026-09-15", leetcode: 40, gpa: 8.5, projects: 1 },
    { ...me, day: "2026-10-01", leetcode: 75, gpa: 8.82, projects: 2 },
  ];
  const by = Object.fromEntries(progress(history).map((p) => [p.metric.key, p]));
  assert.deepEqual(by.leetcode.points.map((p) => p.value), [10, 40, 75]);
  assert.equal(by.leetcode.change, 65);
  assert.equal(by.gpa_pct.first, 8.5);
  assert.equal(by.gpa_pct.change, 0.32);
  assert.deepEqual(by.projects.points.map((p) => p.day), ["2026-09-15", "2026-10-01"], "blank days are skipped");
  assert.equal(progress([]).length, 0);
});
